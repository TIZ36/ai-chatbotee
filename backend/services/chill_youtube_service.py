"""
YouTube Data API v3 代理：供 Chill 氛围音频使用（不在前端暴露 API Key）。
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

YOUTUBE_API = "https://www.googleapis.com/youtube/v3"


def _get_api_key(config: Optional[dict]) -> str:
    if not config:
        return ""
    yt = config.get("youtube") or {}
    return (yt.get("api_key") or "").strip()


def _yt_get(path: str, params: Dict[str, Any], api_key: str) -> Tuple[Optional[dict], Optional[str]]:
    p = {**params, "key": api_key}
    try:
        r = requests.get(f"{YOUTUBE_API}/{path}", params=p, timeout=20)
        data = r.json()
        if r.status_code != 200:
            err = (data or {}).get("error", {})
            msg = err.get("message") if isinstance(err, dict) else str(data)
            return None, msg or f"HTTP {r.status_code}"
        return data, None
    except Exception as e:
        logger.exception("[ChillYouTube] request failed")
        return None, str(e)


def _snippet_item(item: dict) -> Dict[str, Any]:
    sn = item.get("snippet") or {}
    thumbs = sn.get("thumbnails") or {}
    thumb = (
        (thumbs.get("high") or {}).get("url")
        or (thumbs.get("medium") or {}).get("url")
        or (thumbs.get("default") or {}).get("url")
        or ""
    )
    vid = (item.get("id") or {}).get("videoId") if isinstance(item.get("id"), dict) else None
    if not vid and item.get("contentDetails"):
        vid = (item.get("contentDetails") or {}).get("videoId")
    if not vid and isinstance(item.get("id"), str) and item["id"].startswith("UC"):
        return {
            "kind": "channel",
            "channelId": item["id"],
            "title": sn.get("title") or "",
            "description": (sn.get("description") or "")[:200],
            "thumbnailUrl": thumb,
        }
    return {
        "kind": "video",
        "videoId": vid or "",
        "title": sn.get("title") or "",
        "channelTitle": sn.get("channelTitle") or "",
        "description": (sn.get("description") or "")[:200],
        "thumbnailUrl": thumb,
        "liveBroadcastContent": (sn.get("liveBroadcastContent") or "none"),
    }


def fetch_live_streams(config: Optional[dict]) -> Dict[str, Any]:
    api_key = _get_api_key(config)
    if not api_key:
        return {"ok": False, "error": "youtube.api_key not configured", "items": []}

    yt_cfg = (config or {}).get("youtube") or {}
    channel_ids: List[str] = list(yt_cfg.get("default_live_channel_ids") or [])
    fallback_q = (yt_cfg.get("fallback_live_search_query") or "lofi hip hop radio live").strip()
    seen: set = set()
    items: List[Dict[str, Any]] = []

    for cid in channel_ids:
        if not cid or not cid.strip():
            continue
        cid = cid.strip()
        data, err = _yt_get(
            "search",
            {
                "part": "snippet",
                "type": "video",
                "channelId": cid,
                "eventType": "live",
                "maxResults": 5,
            },
            api_key,
        )
        if err:
            logger.warning("[ChillYouTube] live search channel=%s: %s", cid, err)
            continue
        for it in (data or {}).get("items") or []:
            row = _snippet_item(it)
            if row.get("kind") == "video" and row.get("videoId"):
                if row["videoId"] in seen:
                    continue
                seen.add(row["videoId"])
                row["isLive"] = True
                items.append(row)

    if not items and fallback_q:
        data, err = _yt_get(
            "search",
            {
                "part": "snippet",
                "type": "video",
                "eventType": "live",
                "q": fallback_q,
                "maxResults": 15,
            },
            api_key,
        )
        if err:
            return {"ok": False, "error": err, "items": []}
        for it in (data or {}).get("items") or []:
            row = _snippet_item(it)
            if row.get("kind") == "video" and row.get("videoId"):
                if row["videoId"] in seen:
                    continue
                seen.add(row["videoId"])
                row["isLive"] = True
                items.append(row)

    return {"ok": True, "items": items}


def search_youtube(config: Optional[dict], q: str) -> Dict[str, Any]:
    api_key = _get_api_key(config)
    if not api_key:
        return {"ok": False, "error": "youtube.api_key not configured", "items": []}

    q = (q or "").strip()
    if len(q) < 2:
        return {"ok": True, "items": []}

    data, err = _yt_get(
        "search",
        {
            "part": "snippet",
            "type": "video,channel",
            "q": q[:200],
            "maxResults": 15,
        },
        api_key,
    )
    if err:
        return {"ok": False, "error": err, "items": []}

    items: List[Dict[str, Any]] = []
    for it in (data or {}).get("items") or []:
        id_obj = it.get("id")
        if isinstance(id_obj, dict):
            kind = id_obj.get("kind") or ""
            if kind == "youtube#video":
                row = _snippet_item(it)
                if row.get("videoId"):
                    items.append(row)
            elif kind == "youtube#channel":
                cid = id_obj.get("channelId") or ""
                sn = it.get("snippet") or {}
                thumbs = sn.get("thumbnails") or {}
                thumb = (
                    (thumbs.get("high") or {}).get("url")
                    or (thumbs.get("medium") or {}).get("url")
                    or (thumbs.get("default") or {}).get("url")
                    or ""
                )
                items.append(
                    {
                        "kind": "channel",
                        "channelId": cid,
                        "title": sn.get("title") or "",
                        "description": (sn.get("description") or "")[:200],
                        "thumbnailUrl": thumb,
                    }
                )
    return {"ok": True, "items": items}


def channel_live_video(config: Optional[dict], channel_id: str) -> Dict[str, Any]:
    """解析某频道当前直播（若有）。"""
    api_key = _get_api_key(config)
    if not api_key:
        return {"ok": False, "error": "youtube.api_key not configured", "videoId": None}

    channel_id = (channel_id or "").strip()
    if not channel_id:
        return {"ok": False, "error": "channel_id required", "videoId": None}

    data, err = _yt_get(
        "search",
        {
            "part": "snippet",
            "type": "video",
            "channelId": channel_id,
            "eventType": "live",
            "maxResults": 1,
        },
        api_key,
    )
    if err:
        return {"ok": False, "error": err, "videoId": None}
    items = (data or {}).get("items") or []
    if not items:
        return {"ok": True, "videoId": None, "message": "no live stream"}
    row = _snippet_item(items[0])
    vid = row.get("videoId") or ""
    return {"ok": True, "videoId": vid or None, "title": row.get("title"), "thumbnailUrl": row.get("thumbnailUrl")}
