"""
Chill / YouTube 氛围音频 API
"""
from flask import Blueprint, request, jsonify

chill_bp = Blueprint("chill", __name__)


def _config():
    try:
        from pathlib import Path
        import yaml

        p = Path(__file__).resolve().parent.parent / "config.yaml"
        with open(p, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


@chill_bp.route("/youtube/live", methods=["GET", "OPTIONS"])
def youtube_live():
    if request.method == "OPTIONS":
        return "", 204
    from services.chill_youtube_service import fetch_live_streams

    out = fetch_live_streams(_config())
    status = 200 if out.get("ok") else 503
    return jsonify(out), status


@chill_bp.route("/youtube/search", methods=["GET", "OPTIONS"])
def youtube_search():
    if request.method == "OPTIONS":
        return "", 204
    from services.chill_youtube_service import search_youtube

    q = request.args.get("q") or ""
    out = search_youtube(_config(), q)
    status = 200 if out.get("ok") else 503
    return jsonify(out), status


@chill_bp.route("/youtube/channel-live", methods=["GET", "OPTIONS"])
def youtube_channel_live():
    if request.method == "OPTIONS":
        return "", 204
    from services.chill_youtube_service import channel_live_video

    cid = request.args.get("channelId") or request.args.get("channel_id") or ""
    out = channel_live_video(_config(), cid)
    status = 200 if out.get("ok") else 503
    return jsonify(out), status
