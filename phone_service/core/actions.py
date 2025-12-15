from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Any

from phone_service.core.adb import (
    back,
    clear_text,
    detect_and_set_adb_keyboard,
    home,
    launch_app,
    restore_keyboard,
    swipe,
    tap,
    type_text,
    wait_seconds,
)
from phone_service.core.types import ActionResult


def parse_action(text: str) -> dict[str, Any]:
    s = (text or "").strip()
    if s.startswith("do"):
        tree = ast.parse(s, mode="eval")
        if not isinstance(tree.body, ast.Call):
            raise ValueError("Expected do(...) call")
        call = tree.body
        action: dict[str, Any] = {"_metadata": "do"}
        for keyword in call.keywords:
            if not keyword.arg:
                continue
            action[keyword.arg] = ast.literal_eval(keyword.value)
        return action

    if s.startswith("finish"):
        m = re.match(r'^finish\\(message=(?P<msg>.*)\\)\\s*$', s)
        if not m:
            raise ValueError("Invalid finish(...) format")
        msg_raw = m.group("msg").strip()
        # msg_raw is expected to be a Python string literal; try literal_eval for safety
        try:
            msg = ast.literal_eval(msg_raw)
        except Exception:
            msg = msg_raw.strip('"').strip("'")
        return {"_metadata": "finish", "message": msg}

    raise ValueError(f"Unrecognized action: {s[:80]}")


@dataclass
class ActionHandler:
    device_id: str | None = None

    def execute(self, action: dict[str, Any], screen_width: int, screen_height: int) -> ActionResult:
        t = action.get("_metadata")
        if t == "finish":
            return ActionResult(success=True, should_finish=True, message=action.get("message"))
        if t != "do":
            return ActionResult(success=False, should_finish=True, message=f"Unknown action type: {t}")

        action_name = action.get("action")
        if action_name == "Launch":
            app_name = action.get("app")
            if not app_name:
                return ActionResult(False, False, "Missing app")
            ok = launch_app(str(app_name), self.device_id)
            return ActionResult(ok, False, None if ok else f"App not found: {app_name}")

        if action_name == "Tap":
            element = action.get("element")
            if not element or not isinstance(element, list) or len(element) != 2:
                return ActionResult(False, False, "Missing element")
            if "message" in action:
                return ActionResult(
                    success=True,
                    should_finish=False,
                    message=str(action.get("message") or "Sensitive operation"),
                    requires_confirmation=True,
                )
            x, y = self._rel_to_abs(element, screen_width, screen_height)
            tap(x, y, self.device_id)
            return ActionResult(True, False)

        if action_name == "Swipe":
            start = action.get("start")
            end = action.get("end")
            if not start or not end:
                return ActionResult(False, False, "Missing swipe coordinates")
            sx, sy = self._rel_to_abs(start, screen_width, screen_height)
            ex, ey = self._rel_to_abs(end, screen_width, screen_height)
            swipe(sx, sy, ex, ey, device_id=self.device_id)
            return ActionResult(True, False)

        if action_name == "Back":
            back(self.device_id)
            return ActionResult(True, False)

        if action_name == "Home":
            home(self.device_id)
            return ActionResult(True, False)

        if action_name == "Wait":
            duration_str = str(action.get("duration") or "1 seconds")
            seconds = _parse_duration_seconds(duration_str)
            wait_seconds(seconds)
            return ActionResult(True, False)

        if action_name == "Take_over":
            return ActionResult(
                success=True,
                should_finish=False,
                message=str(action.get("message") or "User intervention required"),
                requires_takeover=True,
            )

        if action_name in ("Type", "Type_Name"):
            text = str(action.get("text") or "")
            original_ime = detect_and_set_adb_keyboard(self.device_id)
            clear_text(self.device_id)
            type_text(text, self.device_id)
            restore_keyboard(original_ime, self.device_id)
            return ActionResult(True, False)

        return ActionResult(False, False, f"Unknown action: {action_name}")

    @staticmethod
    def _rel_to_abs(element: list[int], width: int, height: int) -> tuple[int, int]:
        x = int(int(element[0]) / 1000 * width)
        y = int(int(element[1]) / 1000 * height)
        return x, y


def _parse_duration_seconds(duration: str) -> float:
    s = duration.strip().lower().replace("seconds", "s").replace("second", "s")
    s = s.replace("sec", "s").replace(" ", "")
    if s.endswith("s"):
        s = s[:-1]
    try:
        return max(0.2, min(float(s), 10.0))
    except Exception:
        return 1.0
