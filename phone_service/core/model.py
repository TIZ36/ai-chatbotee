from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class ModelConfig:
    base_url: str
    model_name: str
    api_key: str = "EMPTY"
    max_tokens: int = 3000
    temperature: float = 0.0


@dataclass(frozen=True)
class ModelResponse:
    thinking: str
    action: str
    raw_content: str


class ModelClient:
    def __init__(self, config: ModelConfig):
        self.config = config

    def chat_completions(self, messages: list[dict[str, Any]]) -> ModelResponse:
        url = self.config.base_url.rstrip("/") + "/chat/completions"
        headers = {"Content-Type": "application/json"}
        if self.config.api_key and self.config.api_key != "EMPTY":
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        payload = {
            "model": self.config.model_name,
            "messages": messages,
            "max_tokens": self.config.max_tokens,
            "temperature": self.config.temperature,
            "stream": False,
        }

        r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=60)
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code} from model endpoint: {r.text[:2000]}")
        data = r.json()
        content = (((data.get("choices") or [])[0] or {}).get("message") or {}).get("content") or ""
        raw = str(content).strip()
        thinking, action = _parse_response(raw)
        return ModelResponse(thinking=thinking, action=action, raw_content=raw)


def _parse_response(content: str) -> tuple[str, str]:
    if "finish(message=" in content:
        before, after = content.split("finish(message=", 1)
        return before.strip(), "finish(message=" + after
    if "do(action=" in content:
        before, after = content.split("do(action=", 1)
        return before.strip(), "do(action=" + after
    if "<answer>" in content:
        before, after = content.split("<answer>", 1)
        thinking = before.replace("<think>", "").replace("</think>", "").strip()
        action = after.replace("</answer>", "").strip()
        return thinking, action
    return "", content.strip()


def build_user_message(text: str, image_base64: str | None, image_mime_type: str | None = None) -> dict[str, Any]:
    parts: list[dict[str, Any]] = []
    if image_base64:
        mime = image_mime_type or "image/png"
        parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_base64}"}})
    parts.append({"type": "text", "text": text})
    return {"role": "user", "content": parts}


def build_system_message(text: str) -> dict[str, Any]:
    return {"role": "system", "content": text}


def build_assistant_message(text: str) -> dict[str, Any]:
    return {"role": "assistant", "content": text}


def remove_images_from_message(message: dict[str, Any]) -> dict[str, Any]:
    if isinstance(message.get("content"), list):
        message["content"] = [item for item in message["content"] if item.get("type") == "text"]
    return message
