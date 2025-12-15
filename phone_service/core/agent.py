from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from phone_service.core.actions import ActionHandler, parse_action
from phone_service.core.adb import get_current_app, get_screenshot
from phone_service.core.model import (
    ModelClient,
    ModelConfig,
    build_assistant_message,
    build_system_message,
    build_user_message,
    remove_images_from_message,
)
from phone_service.core.prompts import get_system_prompt
from phone_service.core.types import ActionResult, Screenshot, TaskState


@dataclass(frozen=True)
class AgentConfig:
    device_id: str | None = None
    lang: str = "cn"
    max_steps: int = 100
    history_window: int = 24


@dataclass
class PhoneAgentTask:
    task_id: str
    model_config: ModelConfig
    agent_config: AgentConfig

    state: TaskState = TaskState.READY
    created_task: str | None = None
    step_count: int = 0
    context: list[dict[str, Any]] = field(default_factory=list)

    last_screenshot: Screenshot | None = None
    last_current_app: str | None = None
    last_thinking: str | None = None
    last_action_text: str | None = None
    last_action: dict[str, Any] | None = None

    pending_confirmation_action: dict[str, Any] | None = None
    pending_confirmation_message: str | None = None
    pending_takeover_message: str | None = None

    final_message: str | None = None
    error: str | None = None

    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def start(self, task: str) -> None:
        with self._lock:
            self.created_task = task
            self.step_count = 0
            self.context = []
            self.state = TaskState.RUNNING
            self.final_message = None
            self.error = None

            system_prompt = get_system_prompt(self.agent_config.lang)
            self.context.append(build_system_message(system_prompt))

    def cancel(self) -> None:
        with self._lock:
            self.state = TaskState.CANCELLED

    def confirm(self, approved: bool) -> None:
        with self._lock:
            if self.state != TaskState.WAIT_CONFIRM:
                return
            if not approved:
                self.state = TaskState.FINISHED
                self.final_message = f"User cancelled sensitive operation: {self.pending_confirmation_message or ''}".strip()
                return
            # approved: execute the pending action by stripping message and re-running execute
            if not self.pending_confirmation_action:
                self.state = TaskState.ERROR
                self.error = "Missing pending action"
                return
            action = dict(self.pending_confirmation_action)
            action.pop("message", None)
            self.pending_confirmation_action = None
            self.pending_confirmation_message = None
            self.state = TaskState.RUNNING
            self._execute_action_only(action)

    def takeover_done(self) -> None:
        with self._lock:
            if self.state == TaskState.WAIT_TAKEOVER:
                self.pending_takeover_message = None
                self.state = TaskState.RUNNING

    def step(self) -> dict[str, Any]:
        with self._lock:
            if self.state != TaskState.RUNNING:
                return self.to_public_dict()

            if not self.created_task:
                self.state = TaskState.ERROR
                self.error = "Task not started"
                return self.to_public_dict()

            self.step_count += 1
            if self.step_count > self.agent_config.max_steps:
                self.state = TaskState.FINISHED
                self.final_message = "Max steps reached"
                return self.to_public_dict()

            screenshot = get_screenshot(self.agent_config.device_id)
            current_app = get_current_app(self.agent_config.device_id)
            self.last_screenshot = screenshot
            self.last_current_app = current_app

            is_first = len(self.context) == 1  # only system prompt
            if is_first:
                screen_info = json.dumps({"current_app": current_app}, ensure_ascii=False)
                text = f"{self.created_task}\n\n{screen_info}"
            else:
                screen_info = json.dumps({"current_app": current_app}, ensure_ascii=False)
                text = f"** Screen Info **\n\n{screen_info}"

            self.context.append(
                build_user_message(text=text, image_base64=screenshot.base64_data, image_mime_type=screenshot.mime_type)
            )
            self._trim_context()

            model = ModelClient(self.model_config)
            try:
                response = model.chat_completions(self.context)
            except Exception as e:
                self.state = TaskState.ERROR
                self.error = f"Model error: {e}"
                return self.to_public_dict()

            self.last_thinking = response.thinking
            self.last_action_text = response.action

            try:
                action = parse_action(response.action)
            except Exception:
                action = {"_metadata": "finish", "message": response.action}

            self.last_action = action

            # remove image from last user msg to save tokens
            self.context[-1] = remove_images_from_message(self.context[-1])

            # execute
            handler = ActionHandler(device_id=self.agent_config.device_id)
            result = handler.execute(action, screenshot.width, screenshot.height)

            if result.requires_confirmation:
                self.state = TaskState.WAIT_CONFIRM
                self.pending_confirmation_action = action
                self.pending_confirmation_message = result.message
            elif result.requires_takeover:
                self.state = TaskState.WAIT_TAKEOVER
                self.pending_takeover_message = result.message
            elif result.should_finish:
                self.state = TaskState.FINISHED
                self.final_message = result.message or action.get("message") or "Done"

            # append assistant to context (keeps action trace for next steps)
            self.context.append(
                build_assistant_message(f"<think>{response.thinking}</think><answer>{response.action}</answer>")
            )
            self._trim_context()

            return self.to_public_dict()

    def _execute_action_only(self, action: dict[str, Any]) -> None:
        screenshot = get_screenshot(self.agent_config.device_id)
        handler = ActionHandler(device_id=self.agent_config.device_id)
        result = handler.execute(action, screenshot.width, screenshot.height)
        if result.should_finish:
            self.state = TaskState.FINISHED
            self.final_message = result.message or action.get("message") or "Done"

    def _trim_context(self) -> None:
        # keep system + last N assistant/user pairs, but always keep system prompt
        history_window = max(6, int(self.agent_config.history_window))
        if len(self.context) <= 1 + history_window:
            return
        self.context = [self.context[0]] + self.context[-history_window:]

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "state": self.state.value,
            "step_count": self.step_count,
            "model": {
                "base_url": self.model_config.base_url,
                "model_name": self.model_config.model_name,
            },
            "current_app": self.last_current_app,
            "thinking": self.last_thinking,
            "action_text": self.last_action_text,
            "action": self.last_action,
            "screenshot": self.last_screenshot.base64_data if self.last_screenshot else None,
            "screenshot_meta": {
                "width": self.last_screenshot.width,
                "height": self.last_screenshot.height,
                "image_width": self.last_screenshot.image_width,
                "image_height": self.last_screenshot.image_height,
                "mime_type": self.last_screenshot.mime_type,
                "is_sensitive": self.last_screenshot.is_sensitive,
            }
            if self.last_screenshot
            else None,
            "pending": {
                "confirmation_message": self.pending_confirmation_message,
                "takeover_message": self.pending_takeover_message,
            },
            "final_message": self.final_message,
            "error": self.error,
        }
