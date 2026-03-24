"""Google Drive 集成路由（OAuth + 上传媒体产出）。"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from typing import Any, Dict, Optional, List
from urllib.parse import urlencode

import requests
from flask import jsonify, request, Response

from . import media_bp
from services.media_output_service import get_media_output_service
from database import get_oauth_config, save_oauth_config, delete_oauth_config, get_oauth_token, save_oauth_token


GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
GOOGLE_DRIVE_TOKEN_KEY = "google_drive:default"
DEFAULT_DRIVE_FOLDER_NAME = "chaya"
THUMB_CACHE_TTL_SECONDS = 600
_thumb_cache: Dict[str, Dict[str, Any]] = {}


def _backend_config() -> Dict[str, Any]:
    import yaml
    from pathlib import Path

    cfg_path = Path(__file__).resolve().parents[2] / "config.yaml"
    try:
        with cfg_path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


def _google_drive_config() -> Dict[str, str]:
    cfg = _backend_config()
    gd = (cfg.get("google_drive") or {}) if isinstance(cfg, dict) else {}
    return {
        "client_id": (gd.get("client_id") or "").strip(),
        "client_secret": (gd.get("client_secret") or "").strip(),
        "redirect_uri": (gd.get("redirect_uri") or "").strip(),
        "folder_name": (gd.get("folder_name") or DEFAULT_DRIVE_FOLDER_NAME).strip() or DEFAULT_DRIVE_FOLDER_NAME,
    }


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")
    return verifier, challenge


def _build_auth_url(client_id: str, redirect_uri: str, state: str, code_challenge: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": GOOGLE_DRIVE_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{GOOGLE_OAUTH_AUTH_URL}?{urlencode(params)}"


def _refresh_google_token(token_info: Dict[str, Any], oauth_cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    refresh_token = token_info.get("refresh_token")
    if not refresh_token:
        return None
    client_id = oauth_cfg.get("client_id")
    client_secret = oauth_cfg.get("client_secret")
    if not client_id:
        return None

    payload = {
        "client_id": client_id,
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
    }
    if client_secret:
        payload["client_secret"] = client_secret

    r = requests.post(GOOGLE_OAUTH_TOKEN_URL, data=payload, timeout=30)
    if r.status_code != 200:
        return None
    data = r.json() or {}
    new_access = data.get("access_token")
    if not new_access:
        return None

    expires_in = int(data.get("expires_in") or 0) or None
    new_token = {
        "client_id": client_id,
        "access_token": new_access,
        "refresh_token": data.get("refresh_token") or refresh_token,
        "token_type": (data.get("token_type") or "Bearer").lower(),
        "expires_in": expires_in,
        "expires_at": int(time.time()) + expires_in if expires_in else None,
        "scope": data.get("scope") or GOOGLE_DRIVE_SCOPE,
        "mcp_url": GOOGLE_DRIVE_TOKEN_KEY,
    }
    save_oauth_token(GOOGLE_DRIVE_TOKEN_KEY, new_token)
    return new_token


def _resolve_access_token() -> tuple[Optional[str], Optional[str]]:
    token_info = get_oauth_token(GOOGLE_DRIVE_TOKEN_KEY)
    if not token_info:
        return None, "Google Drive 未授权，请先连接 Google 账号"

    access_token = token_info.get("access_token")
    expires_at = token_info.get("expires_at")
    now = int(time.time())
    if access_token and expires_at and now < int(expires_at) - 30:
        return access_token, None
    if access_token and not expires_at:
        return access_token, None

    refresh_cfg = get_oauth_config("refresh_google_drive")
    if not refresh_cfg:
        return None, "Google Drive 授权已过期，请重新授权"
    refreshed = _refresh_google_token(token_info, refresh_cfg)
    if not refreshed:
        return None, "Google Drive token 刷新失败，请重新授权"
    return refreshed.get("access_token"), None


def _drive_headers(access_token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}


def _thumb_cache_get(file_id: str) -> Optional[Dict[str, Any]]:
    entry = _thumb_cache.get(file_id)
    if not entry:
        return None
    if int(time.time()) > int(entry.get("expires_at") or 0):
        _thumb_cache.pop(file_id, None)
        return None
    return entry


def _thumb_cache_set(file_id: str, content: bytes, mime_type: str) -> None:
    _thumb_cache[file_id] = {
        "content": content,
        "mime_type": mime_type,
        "expires_at": int(time.time()) + THUMB_CACHE_TTL_SECONDS,
    }
    # 简易上限控制，避免无限增长
    if len(_thumb_cache) > 300:
        # 删除最早过期的一批（按过期时间排序）
        keys = sorted(_thumb_cache.keys(), key=lambda k: _thumb_cache[k].get("expires_at", 0))[:80]
        for k in keys:
            _thumb_cache.pop(k, None)


def _ensure_drive_folder(access_token: str, folder_name: str) -> tuple[Optional[str], Optional[str]]:
    headers = _drive_headers(access_token)
    query = (
        f"name = '{folder_name}' and "
        "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    list_url = (
        f"{GOOGLE_DRIVE_FILES_URL}?q={requests.utils.quote(query)}"
        "&spaces=drive&fields=files(id,name)&pageSize=1"
    )
    r = requests.get(list_url, headers=headers, timeout=30)
    if r.status_code == 200:
        files = (r.json() or {}).get("files") or []
        if files:
            return files[0].get("id"), None

    payload = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
    }
    create = requests.post(
        f"{GOOGLE_DRIVE_FILES_URL}?fields=id,name",
        headers={**headers, "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    if create.status_code not in (200, 201):
        return None, "创建 Drive 目录失败"
    return (create.json() or {}).get("id"), None


@media_bp.route("/google-drive/auth/start", methods=["POST"])
def google_drive_auth_start():
    cfg = _google_drive_config()
    client_id = cfg["client_id"]
    client_secret = cfg["client_secret"]
    redirect_uri = cfg["redirect_uri"]
    if not client_id or not redirect_uri:
        return jsonify({
            "error": "请先在 backend/config.yaml 配置 google_drive.client_id 与 google_drive.redirect_uri",
        }), 400

    state = f"gd_{secrets.token_urlsafe(24)}"
    code_verifier, code_challenge = _pkce_pair()
    auth_url = _build_auth_url(client_id, redirect_uri, state, code_challenge)
    save_oauth_config(state, {
        "provider": "google_drive",
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
        "token_endpoint": GOOGLE_OAUTH_TOKEN_URL,
        "scope": GOOGLE_DRIVE_SCOPE,
    }, ttl=900)

    return jsonify({"auth_url": auth_url, "state": state})


@media_bp.route("/google-drive/auth/callback", methods=["GET"])
def google_drive_auth_callback():
    error = request.args.get("error")
    if error:
        return (
            "<html><body><h3>Google Drive 授权失败</h3>"
            f"<p>{error}</p><script>window.close && window.close();</script></body></html>",
            400,
            {"Content-Type": "text/html; charset=utf-8"},
        )

    code = request.args.get("code")
    state = request.args.get("state")
    if not code or not state:
        return (
            "<html><body><h3>Google Drive 授权失败</h3><p>缺少 code/state</p></body></html>",
            400,
            {"Content-Type": "text/html; charset=utf-8"},
        )

    oauth_cfg = get_oauth_config(state)
    if not oauth_cfg:
        return (
            "<html><body><h3>Google Drive 授权失败</h3><p>状态已过期，请重试</p></body></html>",
            400,
            {"Content-Type": "text/html; charset=utf-8"},
        )

    payload = {
        "code": code,
        "client_id": oauth_cfg.get("client_id"),
        "client_secret": oauth_cfg.get("client_secret"),
        "redirect_uri": oauth_cfg.get("redirect_uri"),
        "grant_type": "authorization_code",
        "code_verifier": oauth_cfg.get("code_verifier"),
    }
    r = requests.post(GOOGLE_OAUTH_TOKEN_URL, data=payload, timeout=30)
    if r.status_code != 200:
        delete_oauth_config(state)
        return (
            "<html><body><h3>Google Drive 授权失败</h3><p>Token 交换失败</p></body></html>",
            400,
            {"Content-Type": "text/html; charset=utf-8"},
        )

    token_data = r.json() or {}
    access_token = token_data.get("access_token")
    if not access_token:
        delete_oauth_config(state)
        return (
            "<html><body><h3>Google Drive 授权失败</h3><p>未获取到 access_token</p></body></html>",
            400,
            {"Content-Type": "text/html; charset=utf-8"},
        )

    expires_in = int(token_data.get("expires_in") or 0) or None
    token_info = {
        "client_id": oauth_cfg.get("client_id"),
        "access_token": access_token,
        "refresh_token": token_data.get("refresh_token"),
        "token_type": (token_data.get("token_type") or "Bearer").lower(),
        "expires_in": expires_in,
        "expires_at": int(time.time()) + expires_in if expires_in else None,
        "scope": token_data.get("scope") or GOOGLE_DRIVE_SCOPE,
        "mcp_url": GOOGLE_DRIVE_TOKEN_KEY,
    }
    save_oauth_token(GOOGLE_DRIVE_TOKEN_KEY, token_info)
    save_oauth_config("refresh_google_drive", {
        "client_id": oauth_cfg.get("client_id"),
        "client_secret": oauth_cfg.get("client_secret"),
    }, ttl=None)
    delete_oauth_config(state)

    return (
        "<html><body><h3>Google Drive 授权成功</h3>"
        "<p>你可以关闭这个窗口并回到应用。</p>"
        "<script>window.close && window.close();</script></body></html>",
        200,
        {"Content-Type": "text/html; charset=utf-8"},
    )


@media_bp.route("/google-drive/auth/status", methods=["GET"])
def google_drive_auth_status():
    token_info = get_oauth_token(GOOGLE_DRIVE_TOKEN_KEY)
    return jsonify({"connected": bool(token_info)})


@media_bp.route("/outputs/<output_id>/upload-drive", methods=["POST"])
def upload_output_to_drive(output_id: str):
    access_token, err = _resolve_access_token()
    if err or not access_token:
        return jsonify({"error": err or "Google Drive 未连接"}), 401

    cfg = _google_drive_config()
    folder_name = cfg.get("folder_name") or DEFAULT_DRIVE_FOLDER_NAME
    folder_id, folder_err = _ensure_drive_folder(access_token, folder_name)
    if folder_err or not folder_id:
        return jsonify({"error": folder_err or "准备 Drive 目录失败"}), 400

    svc = get_media_output_service()
    item = svc.get_output(output_id)
    file_path = svc.get_output_file_path(output_id)
    if not item or not file_path:
        return jsonify({"error": "产出不存在或文件已丢失"}), 404

    filename = os.path.basename(str(file_path))
    mime_type = (item.get("mime_type") or "application/octet-stream").strip()
    metadata: Dict[str, Any] = {"name": filename}
    metadata["parents"] = [folder_id]

    headers = _drive_headers(access_token)
    files = {
        "metadata": ("metadata", json.dumps(metadata), "application/json; charset=UTF-8"),
        "file": (filename, file_path.read_bytes(), mime_type),
    }
    r = requests.post(
        f"{GOOGLE_DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,webViewLink,thumbnailLink,mimeType",
        headers=headers,
        files=files,
        timeout=120,
    )
    if r.status_code not in (200, 201):
        return jsonify({"error": f"上传失败: HTTP {r.status_code}", "detail": r.text[:500]}), 400

    data = r.json() or {}
    return jsonify({
        "ok": True,
        "drive_file_id": data.get("id"),
        "name": data.get("name"),
        "mime_type": data.get("mimeType"),
        "thumbnail_link": data.get("thumbnailLink"),
        "web_view_link": data.get("webViewLink"),
        "folder_name": folder_name,
        "folder_id": folder_id,
    })


@media_bp.route("/google-drive/files", methods=["GET"])
def list_google_drive_files():
    access_token, err = _resolve_access_token()
    if err or not access_token:
        return jsonify({"error": err or "Google Drive 未连接"}), 401

    cfg = _google_drive_config()
    folder_name = cfg.get("folder_name") or DEFAULT_DRIVE_FOLDER_NAME
    folder_id, folder_err = _ensure_drive_folder(access_token, folder_name)
    if folder_err or not folder_id:
        return jsonify({"error": folder_err or "准备 Drive 目录失败"}), 400

    page_size = max(1, min(100, int(request.args.get("page_size", 40))))
    page_token = (request.args.get("page_token") or "").strip()

    q = (
        f"'{folder_id}' in parents and trashed = false and "
        "(mimeType contains 'image/' or mimeType contains 'video/')"
    )
    params = {
        "q": q,
        "spaces": "drive",
        "orderBy": "createdTime desc",
        "pageSize": page_size,
        "fields": "nextPageToken,files(id,name,mimeType,createdTime,size,webViewLink,thumbnailLink)",
    }
    if page_token:
        params["pageToken"] = page_token

    r = requests.get(
        GOOGLE_DRIVE_FILES_URL,
        headers=_drive_headers(access_token),
        params=params,
        timeout=30,
    )
    if r.status_code != 200:
        return jsonify({"error": "读取 Drive 图库失败", "detail": r.text[:500]}), 400

    data = r.json() or {}
    files: List[Dict[str, Any]] = []
    for f in (data.get("files") or []):
        fid = f.get("id")
        files.append({
            "id": fid,
            "name": f.get("name"),
            "mime_type": f.get("mimeType"),
            "created_at": f.get("createdTime"),
            "size": f.get("size"),
            "web_view_link": f.get("webViewLink"),
            "thumbnail_link": f.get("thumbnailLink"),
            "preview_url": f"/api/media/google-drive/files/{fid}/content" if fid else None,
            "thumb_url": f"/api/media/google-drive/files/{fid}/thumb" if fid else None,
        })

    return jsonify({
        "items": files,
        "next_page_token": data.get("nextPageToken"),
        "folder_id": folder_id,
        "folder_name": folder_name,
    })


@media_bp.route("/google-drive/files/<file_id>/content", methods=["GET"])
def get_google_drive_file_content(file_id: str):
    access_token, err = _resolve_access_token()
    if err or not access_token:
        return jsonify({"error": err or "Google Drive 未连接"}), 401

    meta = requests.get(
        f"{GOOGLE_DRIVE_FILES_URL}/{file_id}",
        headers=_drive_headers(access_token),
        params={"fields": "id,mimeType,name"},
        timeout=30,
    )
    if meta.status_code != 200:
        return jsonify({"error": "读取 Drive 文件信息失败"}), 404
    meta_data = meta.json() or {}
    mime_type = meta_data.get("mimeType") or "application/octet-stream"
    filename = meta_data.get("name") or file_id

    if mime_type.startswith("application/vnd.google-apps"):
        return jsonify({"error": "该文件不支持直接预览"}), 400

    dl = requests.get(
        f"{GOOGLE_DRIVE_FILES_URL}/{file_id}",
        headers=_drive_headers(access_token),
        params={"alt": "media"},
        timeout=120,
    )
    if dl.status_code != 200:
        return jsonify({"error": "下载 Drive 文件失败"}), 400

    return Response(
        dl.content,
        mimetype=mime_type,
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "public, max-age=300",
        },
    )


@media_bp.route("/google-drive/files/<file_id>/thumb", methods=["GET"])
def get_google_drive_file_thumb(file_id: str):
    access_token, err = _resolve_access_token()
    if err or not access_token:
        return jsonify({"error": err or "Google Drive 未连接"}), 401

    cached = _thumb_cache_get(file_id)
    if cached:
        return Response(
            cached["content"],
            mimetype=cached["mime_type"],
            headers={"Cache-Control": "public, max-age=600"},
        )

    headers = _drive_headers(access_token)
    meta = requests.get(
        f"{GOOGLE_DRIVE_FILES_URL}/{file_id}",
        headers=headers,
        params={"fields": "id,mimeType,name,thumbnailLink"},
        timeout=30,
    )
    if meta.status_code != 200:
        return jsonify({"error": "读取 Drive 缩略图信息失败"}), 404
    meta_data = meta.json() or {}
    mime_type = meta_data.get("mimeType") or "application/octet-stream"
    thumb_link = meta_data.get("thumbnailLink")
    if not thumb_link:
        # 回退：没有缩略图时直接返回原图（对小图也能接受）
        return get_google_drive_file_content(file_id)

    # 谷歌缩略图支持 sz 参数，减少体积以提升列表渲染速度
    thumb_url = f"{thumb_link}&sz=w320-h320"
    dl = requests.get(thumb_url, headers=headers, timeout=30)
    if dl.status_code != 200:
        return get_google_drive_file_content(file_id)

    # 缩略图通常是 image/jpeg
    resp_mime = (dl.headers.get("Content-Type") or "").split(";")[0].strip() or "image/jpeg"
    # 视频缩略图也作为图片返回
    if mime_type.startswith("video/") and not resp_mime.startswith("image/"):
        resp_mime = "image/jpeg"

    _thumb_cache_set(file_id, dl.content, resp_mime)

    return Response(
        dl.content,
        mimetype=resp_mime,
        headers={"Cache-Control": "public, max-age=600"},
    )
