import os
import uuid
from dataclasses import asdict

from flask import Flask, jsonify, request

from phone_service.core.agent import AgentConfig, PhoneAgentTask
from phone_service.core.adb import list_devices
from phone_service.core.model import ModelConfig
from phone_service.core.types import TaskState


app = Flask(__name__)

TASKS: dict[str, PhoneAgentTask] = {}


def _json_error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.get("/devices")
def devices():
    return jsonify({"ok": True, "devices": [asdict(d) for d in list_devices()]})


@app.post("/tasks")
def create_task():
    payload = request.get_json(silent=True) or {}
    task_text = str(payload.get("task") or "").strip()
    if not task_text:
        return _json_error("Missing required field: task")

    task_id = str(uuid.uuid4())

    model_payload = payload.get("model") or {}
    model_config = ModelConfig(
        base_url=str(
            model_payload.get("base_url") or os.getenv("PHONE_MODEL_BASE_URL", "http://localhost:8000/v1")
        ),
        model_name=str(model_payload.get("model_name") or os.getenv("PHONE_MODEL_NAME", "autoglm-phone-9b")),
        api_key=str(model_payload.get("api_key") or os.getenv("PHONE_MODEL_API_KEY", "EMPTY")),
        max_tokens=int(model_payload.get("max_tokens") or os.getenv("PHONE_MODEL_MAX_TOKENS", "3000")),
        temperature=float(model_payload.get("temperature") or os.getenv("PHONE_MODEL_TEMPERATURE", "0.0")),
    )

    agent_payload = payload.get("agent") or {}
    agent_config = AgentConfig(
        device_id=payload.get("device_id") or agent_payload.get("device_id") or os.getenv("PHONE_DEVICE_ID") or None,
        lang=str(payload.get("lang") or agent_payload.get("lang") or os.getenv("PHONE_LANG", "cn")),
        max_steps=int(agent_payload.get("max_steps") or os.getenv("PHONE_MAX_STEPS", "100")),
        history_window=int(agent_payload.get("history_window") or os.getenv("PHONE_HISTORY_WINDOW", "24")),
    )

    task = PhoneAgentTask(task_id=task_id, model_config=model_config, agent_config=agent_config)
    task.start(task_text)
    TASKS[task_id] = task

    return jsonify({"ok": True, "task_id": task_id, "state": task.state.value})


@app.get("/tasks/<task_id>")
def get_task(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        return _json_error("Task not found", 404)
    return jsonify({"ok": True, **task.to_public_dict()})


@app.post("/tasks/<task_id>/step")
def step_task(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        return _json_error("Task not found", 404)

    if task.state in (TaskState.CANCELLED, TaskState.FINISHED):
        return jsonify({"ok": True, **task.to_public_dict()})

    if task.state == TaskState.WAIT_CONFIRM:
        return _json_error("Task is waiting for confirmation; call /confirm first", 409)
    if task.state == TaskState.WAIT_TAKEOVER:
        return _json_error("Task is waiting for takeover; call /takeover_done first", 409)

    step_result = task.step()
    return jsonify({"ok": True, **step_result})


@app.post("/tasks/<task_id>/confirm")
def confirm_task(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        return _json_error("Task not found", 404)

    payload = request.get_json(silent=True) or {}
    approved = bool(payload.get("approved"))

    if task.state != TaskState.WAIT_CONFIRM:
        return _json_error("Task is not waiting for confirmation", 409)

    task.confirm(approved)
    return jsonify({"ok": True, **task.to_public_dict()})


@app.post("/tasks/<task_id>/takeover_done")
def takeover_done(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        return _json_error("Task not found", 404)

    if task.state != TaskState.WAIT_TAKEOVER:
        return _json_error("Task is not waiting for takeover", 409)

    task.takeover_done()
    return jsonify({"ok": True, **task.to_public_dict()})


@app.post("/tasks/<task_id>/cancel")
def cancel_task(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        return _json_error("Task not found", 404)
    task.cancel()
    return jsonify({"ok": True, **task.to_public_dict()})


def main():
    port = int(os.getenv("PHONE_SERVICE_PORT", "3010"))
    app.run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
