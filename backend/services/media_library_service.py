"""
媒体库服务（Redis 缓存 7 天）

目标：
- 聚合某个 session/topic 的多媒体（目前以 image 为主）
- 将解析后的媒体条目缓存到 Redis，减少 MySQL 扫描与 JSON 解析开销
- 缓存与会话共享：当会话写入/删除消息时，触发 invalidate 以保持一致性
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from database import get_redis_client, get_mysql_connection


class MediaLibraryService:
    # 7 天
    CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
    KEY_PREFIX = "media:session"
    KEY_VERSION = "v1"

    def __init__(self):
        self.redis = get_redis_client()

    def _cache_key(self, session_id: str) -> str:
        return f"{self.KEY_PREFIX}:{session_id}:items:{self.KEY_VERSION}"

    def invalidate_session(self, session_id: str) -> None:
        """失效某个会话的媒体缓存"""
        if not self.redis:
            return
        try:
            self.redis.delete(self._cache_key(session_id))
        except Exception as e:
            print(f"[MediaLibrary] invalidate_session error: {e}")

    def _extract_media_from_message(
        self,
        *,
        session_id: str,
        message_id: str,
        role: Optional[str],
        content: Any,
        ext: Any,
        created_dt: Optional[datetime],
    ) -> List[Dict[str, Any]]:
        """从单条消息中提取媒体条目（用于增量更新缓存）"""
        created_iso = created_dt.isoformat() if created_dt else None
        created_ts = created_dt.timestamp() if created_dt else 0.0

        items: List[Dict[str, Any]] = []

        # ext.media
        ext_obj: Dict[str, Any] = {}
        if ext:
            try:
                if isinstance(ext, (str, bytes)):
                    ext_obj = json.loads(ext)
                elif isinstance(ext, dict):
                    ext_obj = ext
            except Exception:
                ext_obj = {}

        media_list = ext_obj.get("media") if isinstance(ext_obj, dict) else None
        if isinstance(media_list, list):
            for m in media_list:
                if not isinstance(m, dict):
                    continue
                m_type = m.get("type")
                if m_type not in ("image", "video", "audio"):
                    continue
                items.append(
                    {
                        "type": m_type,
                        "mimeType": m.get("mimeType") or m.get("mime_type") or "application/octet-stream",
                        "data": m.get("data") or "",
                        "url": m.get("url"),
                        "created_at": created_iso,
                        "created_at_ts": created_ts,
                        "message_id": message_id,
                        "role": role,
                        "session_id": session_id,
                    }
                )

        # 兼容旧标记：[MCP_IMAGE|mime|base64]（仅图片）
        if isinstance(content, str) and "[MCP_IMAGE|" in content:
            import re

            for match in re.finditer(r"\[MCP_IMAGE\|(.*?)\|(.*?)\]", content):
                mime = match.group(1) or "image/png"
                data = match.group(2) or ""
                items.append(
                    {
                        "type": "image",
                        "mimeType": mime,
                        "data": data,
                        "created_at": created_iso,
                        "created_at_ts": created_ts,
                        "message_id": message_id,
                        "role": role,
                        "session_id": session_id,
                    }
                )

        return items

    def upsert_message_media(
        self,
        *,
        session_id: str,
        message_id: str,
        role: Optional[str],
        content: Any,
        ext: Any,
        created_ts: Optional[float] = None,
    ) -> None:
        """
        增量更新：当新增/覆盖一条消息时，把该消息的 media 条目合并进 Redis 缓存。
        - 不做全量 delete，避免频繁重建
        - 如果缓存不存在，则直接写入“仅本条消息”的缓存（后续再逐步累积）
        """
        if not self.redis:
            return

        key = self._cache_key(session_id)
        try:
            cached_raw = self.redis.get(key)
        except Exception as e:
            print(f"[MediaLibrary] cache read error (upsert): {e}")
            cached_raw = None

        created_dt = None
        try:
            if created_ts is not None:
                created_dt = datetime.fromtimestamp(float(created_ts))
        except Exception:
            created_dt = None
        if created_dt is None:
            created_dt = datetime.now()

        new_items = self._extract_media_from_message(
            session_id=session_id,
            message_id=message_id,
            role=role,
            content=content,
            ext=ext,
            created_dt=created_dt,
        )
        if not new_items:
            return

        existing: List[Dict[str, Any]] = []
        if cached_raw:
            try:
                parsed = json.loads(cached_raw)
                if isinstance(parsed, list):
                    existing = parsed
            except Exception:
                existing = []

        # 移除旧的同 message_id（支持“同 message_id 覆盖写”场景）
        existing = [x for x in existing if x.get("message_id") != message_id]

        # 新消息时间更靠后：按 DESC 逻辑，prepend
        merged = new_items + existing

        # 控制上限，避免缓存无限增长（媒体库前端本来也做 limit）
        if len(merged) > 6000:
            merged = merged[:6000]

        try:
            self.redis.setex(key, self.CACHE_TTL_SECONDS, json.dumps(merged, ensure_ascii=False))
        except Exception as e:
            print(f"[MediaLibrary] cache write error (upsert): {e}")

    def remove_message_media(self, *, session_id: str, message_id: str) -> None:
        """增量更新：当删除一条消息时，从 Redis 缓存中移除该 message_id 关联的媒体条目。"""
        if not self.redis:
            return
        key = self._cache_key(session_id)
        try:
            cached_raw = self.redis.get(key)
            if not cached_raw:
                return
            parsed = json.loads(cached_raw)
            if not isinstance(parsed, list):
                return
            updated = [x for x in parsed if x.get("message_id") != message_id]
            self.redis.setex(key, self.CACHE_TTL_SECONDS, json.dumps(updated, ensure_ascii=False))
        except Exception as e:
            print(f"[MediaLibrary] cache update error (remove): {e}")

    def get_session_media_items(self, session_id: str) -> List[Dict[str, Any]]:
        """
        获取 session 的媒体条目（带 created_at_ts 用于排序）
        返回的 item 结构（最小集）：
          - type: image/video/audio
          - mimeType
          - data (base64 或路径)
          - url (可选)
          - created_at (iso)
          - created_at_ts (float 秒)
          - message_id
          - role
          - session_id
        """
        # 1) 读缓存
        if self.redis:
            try:
                cached = self.redis.get(self._cache_key(session_id))
                if cached:
                    data = json.loads(cached)
                    if isinstance(data, list):
                        return data
            except Exception as e:
                print(f"[MediaLibrary] cache read error: {e}")

        # 2) Miss：扫 MySQL messages
        conn = get_mysql_connection()
        if not conn:
            return []

        items: List[Dict[str, Any]] = []
        cursor = None
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT message_id, role, content, ext, created_at
                FROM messages
                WHERE session_id = %s
                ORDER BY created_at DESC
                """,
                (session_id,),
            )
            rows = cursor.fetchall()
            for (message_id, role, content, ext, created_at) in rows:
                created_dt: Optional[datetime] = created_at
                created_iso = created_dt.isoformat() if created_dt else None
                created_ts = created_dt.timestamp() if created_dt else 0.0

                # ext.media
                ext_obj: Dict[str, Any] = {}
                if ext:
                    try:
                        ext_obj = json.loads(ext) if isinstance(ext, (str, bytes)) else (ext or {})
                    except Exception:
                        ext_obj = {}
                media_list = ext_obj.get("media") if isinstance(ext_obj, dict) else None
                if isinstance(media_list, list):
                    for m in media_list:
                        if not isinstance(m, dict):
                            continue
                        m_type = m.get("type")
                        if m_type not in ("image", "video", "audio"):
                            continue
                        items.append(
                            {
                                "type": m_type,
                                "mimeType": m.get("mimeType") or m.get("mime_type") or "application/octet-stream",
                                "data": m.get("data") or "",
                                "url": m.get("url"),
                                "created_at": created_iso,
                                "created_at_ts": created_ts,
                                "message_id": message_id,
                                "role": role,
                                "session_id": session_id,
                            }
                        )

                # 兼容旧标记：[MCP_IMAGE|mime|base64]（仅图片）
                if isinstance(content, str) and "[MCP_IMAGE|" in content:
                    import re

                    for match in re.finditer(r"\[MCP_IMAGE\|(.*?)\|(.*?)\]", content):
                        mime = match.group(1) or "image/png"
                        data = match.group(2) or ""
                        items.append(
                            {
                                "type": "image",
                                "mimeType": mime,
                                "data": data,
                                "created_at": created_iso,
                                "created_at_ts": created_ts,
                                "message_id": message_id,
                                "role": role,
                                "session_id": session_id,
                            }
                        )
        finally:
            if cursor:
                cursor.close()
            conn.close()

        # 3) 写缓存（7 天）
        if self.redis:
            try:
                self.redis.setex(self._cache_key(session_id), self.CACHE_TTL_SECONDS, json.dumps(items, ensure_ascii=False))
            except Exception as e:
                print(f"[MediaLibrary] cache write error: {e}")

        return items


_media_library_service: Optional[MediaLibraryService] = None


def get_media_library_service() -> MediaLibraryService:
    global _media_library_service
    if _media_library_service is None:
        _media_library_service = MediaLibraryService()
    return _media_library_service


