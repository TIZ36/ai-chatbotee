from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class TaskState(str, Enum):
    READY = "READY"
    RUNNING = "RUNNING"
    WAIT_CONFIRM = "WAIT_CONFIRM"
    WAIT_TAKEOVER = "WAIT_TAKEOVER"
    FINISHED = "FINISHED"
    CANCELLED = "CANCELLED"
    ERROR = "ERROR"


@dataclass(frozen=True)
class Screenshot:
    base64_data: str
    width: int  # device screen width in pixels (for action mapping)
    height: int  # device screen height in pixels (for action mapping)
    image_width: int | None = None  # encoded image width in pixels
    image_height: int | None = None  # encoded image height in pixels
    mime_type: str = "image/png"
    is_sensitive: bool = False


@dataclass(frozen=True)
class DeviceInfo:
    device_id: str
    status: str
    model: str | None = None


@dataclass(frozen=True)
class ActionResult:
    success: bool
    should_finish: bool
    message: str | None = None
    requires_confirmation: bool = False
    requires_takeover: bool = False


JSON = dict[str, Any]
