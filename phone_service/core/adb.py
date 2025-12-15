from __future__ import annotations

import base64
import os
import subprocess
import tempfile
import time
import uuid
from io import BytesIO

from PIL import Image

from phone_service.core.apps import APP_PACKAGES
from phone_service.core.types import DeviceInfo, Screenshot


def _adb_prefix(device_id: str | None) -> list[str]:
    if device_id:
        return ["adb", "-s", device_id]
    return ["adb"]


def list_devices() -> list[DeviceInfo]:
    try:
        result = subprocess.run(["adb", "devices", "-l"], capture_output=True, text=True, timeout=5)
        lines = result.stdout.strip().split("\n")
        devices: list[DeviceInfo] = []
        for line in lines[1:]:
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            device_id = parts[0]
            status = parts[1]
            model = None
            for part in parts[2:]:
                if part.startswith("model:"):
                    model = part.split(":", 1)[1]
                    break
            devices.append(DeviceInfo(device_id=device_id, status=status, model=model))
        return devices
    except Exception:
        return []


def get_current_app(device_id: str | None = None) -> str:
    """
    Best-effort foreground app detection.

    Notes:
      - Some Android builds return different dumpsys formats; we try window first, then activity.
      - Returns "System Home" when not recognized.
    """
    prefix = _adb_prefix(device_id)
    output = ""
    try:
        r = subprocess.run(prefix + ["shell", "dumpsys", "window"], capture_output=True, text=True, timeout=5)
        output = (r.stdout or "") + "\n" + (r.stderr or "")
    except Exception:
        output = ""

    for line in output.split("\n"):
        if "mCurrentFocus" in line or "mFocusedApp" in line:
            for app_name, package in APP_PACKAGES.items():
                if package and package in line:
                    return app_name

    # Fallback: activity topResumedActivity
    try:
        r = subprocess.run(prefix + ["shell", "dumpsys", "activity", "activities"], capture_output=True, text=True, timeout=5)
        out2 = (r.stdout or "") + "\n" + (r.stderr or "")
        for line in out2.split("\n"):
            if "topResumedActivity" in line or "mResumedActivity" in line:
                for app_name, package in APP_PACKAGES.items():
                    if package and package in line:
                        return app_name
    except Exception:
        pass

    return "System Home"


def get_screenshot(device_id: str | None = None, timeout: int = 10) -> Screenshot:
    tmp_name = f"screenshot_{uuid.uuid4()}.png"
    local_path = os.path.join(tempfile.gettempdir(), tmp_name)
    prefix = _adb_prefix(device_id)

    try:
        result = subprocess.run(prefix + ["shell", "screencap", "-p", "/sdcard/phone_service_tmp.png"], capture_output=True, text=True, timeout=timeout)
        out = (result.stdout or "") + (result.stderr or "")
        if "Status: -1" in out or "Failed" in out:
            return _fallback_screenshot(is_sensitive=True)

        subprocess.run(prefix + ["pull", "/sdcard/phone_service_tmp.png", local_path], capture_output=True, text=True, timeout=5)
        if not os.path.exists(local_path):
            return _fallback_screenshot(is_sensitive=False)

        img = Image.open(local_path)
        device_width, device_height = img.size

        # Compress/resize to improve provider compatibility (request-size limits)
        max_edge = int(os.getenv("PHONE_SCREENSHOT_MAX_EDGE", "1280"))
        screenshot_format = os.getenv("PHONE_SCREENSHOT_FORMAT", "jpeg").lower()
        jpeg_quality = int(os.getenv("PHONE_SCREENSHOT_JPEG_QUALITY", "70"))

        if max_edge > 0:
            longest = max(device_width, device_height)
            if longest > max_edge:
                scale = max_edge / float(longest)
                new_w = max(1, int(device_width * scale))
                new_h = max(1, int(device_height * scale))
                img = img.resize((new_w, new_h))
        image_width, image_height = img.size

        buffered = BytesIO()
        if screenshot_format in ("jpg", "jpeg"):
            mime_type = "image/jpeg"
            img_rgb = img.convert("RGB")
            img_rgb.save(buffered, format="JPEG", quality=jpeg_quality, optimize=True)
        else:
            mime_type = "image/png"
            img.save(buffered, format="PNG", optimize=True)

        base64_data = base64.b64encode(buffered.getvalue()).decode("utf-8")

        try:
            os.remove(local_path)
        except OSError:
            pass

        return Screenshot(
            base64_data=base64_data,
            width=device_width,
            height=device_height,
            image_width=image_width,
            image_height=image_height,
            mime_type=mime_type,
            is_sensitive=False,
        )
    except Exception:
        return _fallback_screenshot(is_sensitive=False)


def _fallback_screenshot(is_sensitive: bool) -> Screenshot:
    default_width, default_height = 1080, 2400
    img = Image.new("RGB", (default_width, default_height), color="black")
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    base64_data = base64.b64encode(buffered.getvalue()).decode("utf-8")
    return Screenshot(
        base64_data=base64_data,
        width=default_width,
        height=default_height,
        image_width=default_width,
        image_height=default_height,
        mime_type="image/png",
        is_sensitive=is_sensitive,
    )


def tap(x: int, y: int, device_id: str | None = None, delay: float = 0.8) -> None:
    subprocess.run(_adb_prefix(device_id) + ["shell", "input", "tap", str(x), str(y)], capture_output=True)
    time.sleep(delay)


def swipe(
    start_x: int,
    start_y: int,
    end_x: int,
    end_y: int,
    device_id: str | None = None,
    duration_ms: int | None = None,
    delay: float = 0.8,
) -> None:
    if duration_ms is None:
        dist_sq = (start_x - end_x) ** 2 + (start_y - end_y) ** 2
        duration_ms = max(800, min(int(dist_sq / 1200), 1800))
    subprocess.run(
        _adb_prefix(device_id)
        + ["shell", "input", "swipe", str(start_x), str(start_y), str(end_x), str(end_y), str(duration_ms)],
        capture_output=True,
    )
    time.sleep(delay)


def back(device_id: str | None = None, delay: float = 0.6) -> None:
    subprocess.run(_adb_prefix(device_id) + ["shell", "input", "keyevent", "4"], capture_output=True)
    time.sleep(delay)


def home(device_id: str | None = None, delay: float = 0.8) -> None:
    subprocess.run(_adb_prefix(device_id) + ["shell", "input", "keyevent", "KEYCODE_HOME"], capture_output=True)
    time.sleep(delay)


def launch_app(app_name: str, device_id: str | None = None, delay: float = 1.2) -> bool:
    package = APP_PACKAGES.get(app_name)
    if not package:
        return False
    subprocess.run(
        _adb_prefix(device_id)
        + ["shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"],
        capture_output=True,
    )
    time.sleep(delay)
    return True


def wait_seconds(seconds: float) -> None:
    time.sleep(seconds)


def detect_and_set_adb_keyboard(device_id: str | None = None) -> str:
    prefix = _adb_prefix(device_id)
    result = subprocess.run(
        prefix + ["shell", "settings", "get", "secure", "default_input_method"],
        capture_output=True,
        text=True,
        timeout=5,
    )
    current_ime = (result.stdout + result.stderr).strip()

    if "com.android.adbkeyboard/.AdbIME" not in current_ime:
        subprocess.run(
            prefix + ["shell", "ime", "set", "com.android.adbkeyboard/.AdbIME"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        time.sleep(0.6)

    # warm up
    type_text("", device_id)
    return current_ime


def restore_keyboard(ime: str, device_id: str | None = None) -> None:
    if not ime:
        return
    subprocess.run(_adb_prefix(device_id) + ["shell", "ime", "set", ime], capture_output=True, text=True, timeout=5)
    time.sleep(0.4)


def clear_text(device_id: str | None = None) -> None:
    subprocess.run(_adb_prefix(device_id) + ["shell", "am", "broadcast", "-a", "ADB_CLEAR_TEXT"], capture_output=True, text=True, timeout=5)
    time.sleep(0.3)


def type_text(text: str, device_id: str | None = None) -> None:
    encoded = base64.b64encode(text.encode("utf-8")).decode("utf-8")
    subprocess.run(
        _adb_prefix(device_id)
        + ["shell", "am", "broadcast", "-a", "ADB_INPUT_B64", "--es", "msg", encoded],
        capture_output=True,
        text=True,
        timeout=10,
    )
    time.sleep(0.4)
