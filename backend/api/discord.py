"""
Discord 集成 API
- Bot 状态查询
- 频道绑定 CRUD
- Bot 启停控制
"""

from flask import Blueprint, request, jsonify
from database import get_mysql_connection
from models.discord_channel import (
    DiscordChannelRepository,
    DiscordAppConfigRepository,
    ensure_channel_session,
)
from services.discord_service import DiscordService

discord_bp = Blueprint("discord", __name__)


def _svc() -> DiscordService:
    return DiscordService.get_instance()


# ━━━━━━━━━━━━━━━━ Bot 状态 ━━━━━━━━━━━━━━━━


@discord_bp.route("/status", methods=["GET"])
def get_status():
    """Bot 运行状态（在线、服务器数、绑定频道数）"""
    try:
        svc = _svc()
        info = svc.get_bot_info()
        info["running"] = svc.is_running()
        try:
            info["bound_channels"] = len(
                DiscordChannelRepository(get_mysql_connection).list_all(enabled_only=True)
            )
        except Exception:
            info["bound_channels"] = 0
        return jsonify(info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ━━━━━━━━━━━━━━━━ Discord 应用配置（默认模型等，表存储，前端录入） ━━━━━━━━━━━━━━━━


@discord_bp.route("/config", methods=["GET"])
def get_discord_config():
    """获取 Discord 应用配置（如默认 LLM），供前端展示与编辑"""
    try:
        repo = DiscordAppConfigRepository(get_mysql_connection)
        default_llm_config_id = repo.get_default_llm_config_id()
        return jsonify({"default_llm_config_id": default_llm_config_id or ""})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _apply_default_llm_to_discord_sessions_without_model(default_llm_config_id: str):
    """将默认模型应用到所有尚未配置 LLM 的 Discord 频道会话，避免之前绑定的频道报错"""
    if not default_llm_config_id:
        return
    conn = get_mysql_connection()
    if not conn:
        return
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE sessions s
            INNER JOIN discord_channels d ON s.session_id = d.session_id
            SET s.llm_config_id = %s, s.updated_at = NOW()
            WHERE (s.llm_config_id IS NULL OR s.llm_config_id = '')
            """,
            (default_llm_config_id,),
        )
        n = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        if n:
            print(f"[Discord API] 已为 {n} 个未配置模型的 Discord 会话应用默认模型: {default_llm_config_id}")
    except Exception as e:
        print(f"[Discord API] 批量应用默认模型失败: {e}")
        if conn:
            conn.close()


@discord_bp.route("/config", methods=["PUT"])
def update_discord_config():
    """更新 Discord 应用配置（如默认模型），立即持久化到表；并为尚未配置模型的已绑定频道会话批量应用该默认"""
    try:
        data = request.get_json(silent=True) or {}
        default_llm_config_id = (data.get("default_llm_config_id") or "").strip() or None
        repo = DiscordAppConfigRepository(get_mysql_connection)
        repo.set_default_llm_config_id(default_llm_config_id)
        if default_llm_config_id:
            _apply_default_llm_to_discord_sessions_without_model(default_llm_config_id)
        return jsonify({"default_llm_config_id": default_llm_config_id or ""})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ━━━━━━━━━━━━━━━━ 频道列表 ━━━━━━━━━━━━━━━━


@discord_bp.route("/channels", methods=["GET"])
def list_channels():
    """已绑定频道列表（附带消息统计）"""
    try:
        repo = DiscordChannelRepository(get_mysql_connection)
        enabled_only = request.args.get("enabled_only", "false").lower() == "true"
        channels = repo.list_all(enabled_only=enabled_only)

        if not channels:
            return jsonify({"channels": []})

        # 批量查询消息统计（一条 SQL，不再循环）
        session_ids = [c.session_id for c in channels]
        stats = _batch_message_stats(session_ids)

        out = []
        for c in channels:
            d = c.to_dict()
            s = stats.get(c.session_id, {})
            d["message_count"] = s.get("cnt", 0)
            d["last_message_at"] = s.get("last_at")
            out.append(d)

        return jsonify({"channels": out})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _batch_message_stats(session_ids: list) -> dict:
    """批量获取多个 session 的消息数和最后活跃时间"""
    if not session_ids:
        return {}
    conn = get_mysql_connection()
    if not conn:
        return {}
    try:
        import pymysql
        cur = conn.cursor(pymysql.cursors.DictCursor)
        placeholders = ",".join(["%s"] * len(session_ids))
        cur.execute(
            f"SELECT session_id, COUNT(*) AS cnt, MAX(created_at) AS last_at "
            f"FROM messages WHERE session_id IN ({placeholders}) "
            f"GROUP BY session_id",
            session_ids,
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        result = {}
        for r in rows:
            result[r["session_id"]] = {
                "cnt": r["cnt"],
                "last_at": str(r["last_at"]) if r["last_at"] else None,
            }
        return result
    except Exception:
        if conn:
            conn.close()
        return {}


# ━━━━━━━━━━━━━━━━ 绑定 / 更新 / 解绑 ━━━━━━━━━━━━━━━━


def _resolve_discord_default_llm_config_id():
    """优先从表读取 Discord 默认模型，其次 config.yaml"""
    repo = DiscordAppConfigRepository(get_mysql_connection)
    from_table = repo.get_default_llm_config_id()
    if from_table:
        return from_table
    cfg = getattr(_svc(), "_config", {}) or {}
    return (cfg.get("default_llm_config_id") or "").strip() or None


@discord_bp.route("/channels", methods=["POST"])
def bind_channel():
    """手动绑定频道（自动创建专属会话）"""
    try:
        data = request.get_json() or {}
        channel_id = data.get("channel_id")
        if not channel_id:
            return jsonify({"error": "channel_id required"}), 400

        cfg = getattr(_svc(), "_config", {}) or {}
        default_llm = _resolve_discord_default_llm_config_id()
        binding = ensure_channel_session(
            get_mysql_connection,
            channel_id=str(channel_id),
            guild_id=str(data.get("guild_id", "")),
            channel_name=str(data.get("channel_name", "")),
            guild_name=str(data.get("guild_name", "")),
            config_override=data.get("config_override"),
            default_trigger_mode=data.get("trigger_mode") or cfg.get("default_trigger_mode") or "mention",
            default_llm_config_id=default_llm,
            session_id_prefix=cfg.get("session_id_prefix") or "dc",
        )
        if not binding:
            return jsonify({"error": "Failed to create binding"}), 500
        return jsonify(binding.to_dict()), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _sync_channel_session_llm(channel_id: str, config_override: dict):
    """将频道的 config_override.llm_config_id 同步到 sessions 表，使 Actor 立即使用该模型；未设置时用应用默认"""
    repo = DiscordChannelRepository(get_mysql_connection)
    binding = repo.find_by_channel_id(channel_id)
    if not binding or not binding.session_id:
        return
    llm_id = (config_override or {}).get("llm_config_id")
    if not (llm_id and str(llm_id).strip()):
        llm_id = DiscordAppConfigRepository(get_mysql_connection).get_default_llm_config_id()
    conn = get_mysql_connection()
    if not conn:
        return
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE sessions SET llm_config_id = %s, updated_at = NOW() WHERE session_id = %s",
            (llm_id or None, binding.session_id),
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[Discord API] 同步 session llm_config_id 失败: {e}")
        if conn:
            conn.close()


def _sync_channel_session_persona(channel_id: str, config_override: dict):
    """将频道的 config_override.system_prompt 同步到 sessions 表，使人设立即生效；并触发运行中 Actor 重载配置（仅当请求中显式带了 system_prompt 时同步）"""
    co = config_override or {}
    if "system_prompt" not in co:
        return
    repo = DiscordChannelRepository(get_mysql_connection)
    binding = repo.find_by_channel_id(channel_id)
    if not binding or not binding.session_id:
        return
    system_prompt = co.get("system_prompt")
    conn = get_mysql_connection()
    if not conn:
        return
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE sessions SET system_prompt = %s, updated_at = NOW() WHERE session_id = %s",
            (system_prompt, binding.session_id),
        )
        conn.commit()
        cur.close()
        conn.close()
        try:
            from services.actor import ActorManager
            ActorManager.get_instance().reload_actor_config(binding.session_id)
        except Exception as e:
            print(f"[Discord API] 触发 Actor 重载配置失败: {e}")
    except Exception as e:
        print(f"[Discord API] 同步 session system_prompt 失败: {e}")
        if conn:
            conn.close()


@discord_bp.route("/channels/<channel_id>", methods=["PUT"])
def update_channel(channel_id):
    """更新频道配置（trigger_mode / enabled / config_override 等）；config_override.llm_config_id 会同步到 session，立即生效"""
    try:
        repo = DiscordChannelRepository(get_mysql_connection)
        existing = repo.find_by_channel_id(channel_id)
        if not existing:
            return jsonify({"error": "Channel not found"}), 404

        data = request.get_json() or {}
        updates = {
            k: data[k]
            for k in ("trigger_mode", "enabled", "config_override", "channel_name", "guild_name")
            if k in data
        }
        if updates:
            repo.update(channel_id, **updates)
            if "config_override" in updates and isinstance(updates["config_override"], dict):
                co = updates["config_override"]
                _sync_channel_session_llm(channel_id, co)
                _sync_channel_session_persona(channel_id, co)

        updated = repo.find_by_channel_id(channel_id)
        return jsonify(updated.to_dict() if updated else existing.to_dict())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@discord_bp.route("/channels/<channel_id>", methods=["DELETE"])
def unbind_channel(channel_id):
    """解绑频道（body 中 delete_session=true 可同时删除关联会话）"""
    try:
        repo = DiscordChannelRepository(get_mysql_connection)
        existing = repo.find_by_channel_id(channel_id)
        if not existing:
            return jsonify({"error": "Channel not found"}), 404

        session_id = existing.session_id
        repo.delete(channel_id)

        data = request.get_json(silent=True) or {}
        if data.get("delete_session") and session_id:
            try:
                from models.session import SessionRepository
                SessionRepository(get_mysql_connection).delete(session_id)
            except Exception as e:
                print(f"[Discord API] 删除会话失败: {e}")

        return jsonify({"ok": True, "channel_id": channel_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ━━━━━━━━━━━━━━━━ Bot 启停 ━━━━━━━━━━━━━━━━


@discord_bp.route("/start", methods=["POST"])
def start_bot():
    """手动启动 Bot（token 来源：body > 持久化文件 > config.yaml）。body 传入 token 时会持久化，重启后可不依赖 config 自动启动。"""
    try:
        svc = _svc()
        if svc.is_running():
            return jsonify({"ok": True, "message": "Bot already running", "info": svc.get_bot_info()})

        data = request.get_json(silent=True) or {}
        token_from_body = (data.get("bot_token") or "").strip()
        token = token_from_body
        if not token:
            token = DiscordService.get_persisted_token()
        if not token:
            cfg = getattr(svc, "_config", {}) or {}
            token = (cfg.get("bot_token") or "").strip()
        if not token:
            return jsonify({"error": "bot_token required (body、持久化文件或 config.yaml discord.bot_token)"}), 400

        ok = svc.start(token)
        if not ok:
            return jsonify({"error": "启动失败（检查 token 或安装 discord.py）"}), 500
        # 前端录入的 token 持久化，重启后 auto_start 时可用
        if token_from_body:
            DiscordService.persist_token(token_from_body)
        return jsonify({"ok": True, "message": "Bot 正在启动，请稍后查询 /status"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@discord_bp.route("/stop", methods=["POST"])
def stop_bot():
    """手动停止 Bot"""
    try:
        _svc().stop()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
