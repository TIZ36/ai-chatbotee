"""
Discord 频道绑定数据模型
每个 Discord 频道 → 一个专属 Chaya Session（独立 Actor + 独立消息历史）
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any, List
import json

_TAG = "[Discord]"


# ━━━━━━━━━━━━━━━━ 数据类 ━━━━━━━━━━━━━━━━


@dataclass
class DiscordChannel:
    """Discord 频道 ↔ Chaya 会话 绑定"""

    channel_id: str
    guild_id: str
    guild_name: str = ""
    channel_name: str = ""
    session_id: str = ""
    enabled: bool = True
    trigger_mode: str = "mention"  # mention | all
    config_override: Optional[Dict[str, Any]] = field(default=None)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @classmethod
    def from_db_row(cls, row: dict) -> "DiscordChannel":
        config = row.get("config_override")
        if isinstance(config, str):
            try:
                config = json.loads(config)
            except Exception:
                config = None
        return cls(
            channel_id=row["channel_id"],
            guild_id=row["guild_id"],
            guild_name=row.get("guild_name") or "",
            channel_name=row.get("channel_name") or "",
            session_id=row["session_id"],
            enabled=bool(row.get("enabled", True)),
            trigger_mode=row.get("trigger_mode") or "mention",
            config_override=config,
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )

    def to_dict(self) -> dict:
        return {
            "channel_id": self.channel_id,
            "guild_id": self.guild_id,
            "guild_name": self.guild_name,
            "channel_name": self.channel_name,
            "session_id": self.session_id,
            "enabled": self.enabled,
            "trigger_mode": self.trigger_mode,
            "config_override": self.config_override,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


# ━━━━━━━━━━━━━━━━ 仓库 ━━━━━━━━━━━━━━━━


class DiscordChannelRepository:
    """discord_channels 表 CRUD"""

    def __init__(self, get_connection):
        """
        Args:
            get_connection: callable，每次调用返回一个新 MySQL 连接
        """
        self._get_conn = get_connection

    # ── 查 ──

    def find_by_channel_id(self, channel_id: str) -> Optional[DiscordChannel]:
        return self._find_one("channel_id", channel_id)

    def find_by_session_id(self, session_id: str) -> Optional[DiscordChannel]:
        return self._find_one("session_id", session_id)

    def list_all(self, enabled_only: bool = False) -> List[DiscordChannel]:
        conn = self._get_conn()
        if not conn:
            return []
        try:
            import pymysql
            cur = conn.cursor(pymysql.cursors.DictCursor)
            sql = "SELECT * FROM discord_channels"
            if enabled_only:
                sql += " WHERE enabled = 1"
            sql += " ORDER BY updated_at DESC"
            cur.execute(sql)
            rows = cur.fetchall()
            cur.close()
            conn.close()
            return [DiscordChannel.from_db_row(r) for r in rows]
        except Exception as e:
            print(f"{_TAG} list_all error: {e}")
            self._safe_close(conn)
            return []

    # ── 写 ──

    def save(self, dc: DiscordChannel) -> bool:
        conn = self._get_conn()
        if not conn:
            return False
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO discord_channels
                  (channel_id, guild_id, guild_name, channel_name,
                   session_id, enabled, trigger_mode, config_override)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  guild_id       = VALUES(guild_id),
                  guild_name     = VALUES(guild_name),
                  channel_name   = VALUES(channel_name),
                  session_id     = VALUES(session_id),
                  enabled        = VALUES(enabled),
                  trigger_mode   = VALUES(trigger_mode),
                  config_override= VALUES(config_override),
                  updated_at     = CURRENT_TIMESTAMP
                """,
                (
                    dc.channel_id, dc.guild_id, dc.guild_name, dc.channel_name,
                    dc.session_id, 1 if dc.enabled else 0, dc.trigger_mode,
                    json.dumps(dc.config_override) if dc.config_override else None,
                ),
            )
            conn.commit()
            cur.close()
            conn.close()
            return True
        except Exception as e:
            print(f"{_TAG} save error: {e}")
            self._safe_close(conn)
            return False

    def update(self, channel_id: str, **kwargs) -> bool:
        """部分更新。支持字段: enabled, trigger_mode, config_override, channel_name, guild_name"""
        _allowed = {"enabled", "trigger_mode", "config_override", "channel_name", "guild_name"}
        sets, params = [], []
        for k, v in kwargs.items():
            if k not in _allowed:
                continue
            if k == "config_override":
                sets.append("config_override = %s")
                params.append(json.dumps(v) if v else None)
            elif k == "enabled":
                sets.append("enabled = %s")
                params.append(1 if v else 0)
            else:
                sets.append(f"`{k}` = %s")
                params.append(v)
        if not sets:
            return True
        params.append(channel_id)

        conn = self._get_conn()
        if not conn:
            return False
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE discord_channels SET "
                + ", ".join(sets)
                + ", updated_at = CURRENT_TIMESTAMP WHERE channel_id = %s",
                params,
            )
            conn.commit()
            cur.close()
            conn.close()
            return True
        except Exception as e:
            print(f"{_TAG} update error: {e}")
            self._safe_close(conn)
            return False

    def delete(self, channel_id: str) -> bool:
        conn = self._get_conn()
        if not conn:
            return False
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM discord_channels WHERE channel_id = %s", (channel_id,))
            conn.commit()
            affected = cur.rowcount
            cur.close()
            conn.close()
            return affected > 0
        except Exception as e:
            print(f"{_TAG} delete error: {e}")
            self._safe_close(conn)
            return False

    # ── 内部 ──

    def _find_one(self, column: str, value: str) -> Optional[DiscordChannel]:
        conn = self._get_conn()
        if not conn:
            return None
        try:
            import pymysql
            cur = conn.cursor(pymysql.cursors.DictCursor)
            cur.execute(f"SELECT * FROM discord_channels WHERE `{column}` = %s", (value,))
            row = cur.fetchone()
            cur.close()
            conn.close()
            return DiscordChannel.from_db_row(row) if row else None
        except Exception as e:
            print(f"{_TAG} _find_one({column}) error: {e}")
            self._safe_close(conn)
            return None

    @staticmethod
    def _safe_close(conn):
        try:
            conn.close()
        except Exception:
            pass


# ━━━━━━━━━━━━━━━━ Discord 应用配置（单表单行，前端录入默认模型等） ━━━━━━━━━━━━━━━━


class DiscordAppConfigRepository:
    """discord_app_config 表：应用级配置，如默认 LLM（新频道/未覆盖时使用）"""

    def __init__(self, get_connection):
        self._get_conn = get_connection

    def get_default_llm_config_id(self) -> Optional[str]:
        conn = self._get_conn()
        if not conn:
            return None
        try:
            import pymysql
            cur = conn.cursor(pymysql.cursors.DictCursor)
            cur.execute("SELECT default_llm_config_id FROM discord_app_config WHERE id = 1")
            row = cur.fetchone()
            cur.close()
            conn.close()
            if row and row.get("default_llm_config_id"):
                return row["default_llm_config_id"].strip()
            return None
        except Exception as e:
            print(f"{_TAG} get_default_llm_config_id error: {e}")
            self._safe_close(conn)
            return None

    def set_default_llm_config_id(self, config_id: Optional[str]) -> bool:
        conn = self._get_conn()
        if not conn:
            return False
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE discord_app_config SET default_llm_config_id = %s, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
                (config_id.strip() if config_id and config_id.strip() else None,),
            )
            conn.commit()
            cur.close()
            conn.close()
            return True
        except Exception as e:
            print(f"{_TAG} set_default_llm_config_id error: {e}")
            self._safe_close(conn)
            return False


def backfill_discord_sessions_default_llm(get_connection) -> int:
    """
    启动时回填：为所有已绑定 Discord 但 session 未配置 LLM 的会话写入应用默认模型，避免历史绑定报「未配置默认LLM模型」。
    返回被更新的 session 数量。
    """
    default = DiscordAppConfigRepository(get_connection).get_default_llm_config_id()
    if not default:
        return 0
    conn = get_connection()
    if not conn:
        return 0
    try:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE sessions s
            INNER JOIN discord_channels d ON s.session_id = d.session_id
            SET s.llm_config_id = %s, s.updated_at = CURRENT_TIMESTAMP
            WHERE (s.llm_config_id IS NULL OR s.llm_config_id = '')
            """,
            (default,),
        )
        n = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        if n:
            print(f"{_TAG} 启动回填：已为 {n} 个历史 Discord 会话应用默认模型: {default}")
        return n
    except Exception as e:
        print(f"{_TAG} backfill_discord_sessions_default_llm error: {e}")
        if conn:
            try:
                conn.close()
            except Exception:
                pass
        return 0


# ━━━━━━━━━━━━━━━━ Session 自动创建 ━━━━━━━━━━━━━━━━


def ensure_channel_session(
    get_connection,
    channel_id: str,
    guild_id: str,
    channel_name: str = "",
    guild_name: str = "",
    config_override: Optional[Dict[str, Any]] = None,
    default_trigger_mode: str = "mention",
    default_llm_config_id: Optional[str] = None,
    session_id_prefix: str = "dc",
    chaya_session_id: str = "agent_chaya",
) -> Optional[DiscordChannel]:
    """
    确保 Discord 频道有专属 Chaya Session。

    首次触发时：
      1. 生成 session_id = dc_{guild_id}_{channel_id}
      2. 从 agent_chaya 克隆 system_prompt + llm_config_id + avatar
      3. 若有 config_override，覆盖对应字段
      4. 创建 Session（type=agent）并写入 discord_channels
    """
    repo = DiscordChannelRepository(get_connection)

    # 已存在：若该 session 未配置 LLM，用频道覆盖或应用默认补齐，避免 Actor 报「未配置默认LLM模型」
    existing = repo.find_by_channel_id(channel_id)
    if existing:
        from models.session import SessionRepository

        session_repo = SessionRepository(get_connection)
        session = session_repo.find_by_id(existing.session_id) if existing.session_id else None
        if session:
            current = session.llm_config_id
            need_repair = not current or (isinstance(current, str) and not current.strip())
            if need_repair:
                default_llm = None
                if existing.config_override:
                    default_llm = (existing.config_override.get("llm_config_id") or "").strip() or None
                if not default_llm:
                    default_llm = DiscordAppConfigRepository(get_connection).get_default_llm_config_id()
                if default_llm:
                    session.llm_config_id = default_llm
                    if session_repo.save(session):
                        print(f"{_TAG} 已为历史会话 {existing.session_id} 补齐默认模型: {default_llm}")
        return existing

    # ── 生成 session_id ──
    session_id = f"{session_id_prefix}_{guild_id}_{channel_id}"
    if len(session_id) > 95:  # VARCHAR(100) 留余量
        import hashlib
        h = hashlib.md5(f"{guild_id}_{channel_id}".encode()).hexdigest()[:16]
        session_id = f"{session_id_prefix}_{h}"

    # ── 从 agent_chaya 克隆配置 ──
    from models.session import Session, SessionRepository

    session_repo = SessionRepository(get_connection)
    chaya = session_repo.find_by_id(chaya_session_id)

    system_prompt = chaya.system_prompt if chaya else None
    llm_config_id = default_llm_config_id or (chaya.llm_config_id if chaya else None)
    avatar = chaya.avatar if chaya else None

    # 应用频道级覆盖
    if config_override:
        system_prompt = config_override.get("system_prompt", system_prompt)
        llm_config_id = config_override.get("llm_config_id", llm_config_id)

    # 兜底默认 prompt
    if not system_prompt:
        system_prompt = "你是 Chaya，一个友善的 AI 助手。请使用中文回复。"

    # ── 创建 Session ──
    display_name = f"Discord #{channel_name}" if channel_name else f"Discord {channel_id}"
    new_session = Session(
        session_id=session_id,
        title=display_name,
        name=display_name,
        llm_config_id=llm_config_id,
        session_type="agent",
        owner_id=f"discord:{guild_id}",
        avatar=avatar,
        system_prompt=system_prompt,
        ext={
            "source": "discord",
            "discord_channel_id": channel_id,
            "discord_guild_id": guild_id,
        },
        creator_ip="discord",
    )
    if not session_repo.save(new_session):
        print(f"{_TAG} 创建 Session 失败: {session_id}")
        return None

    # ── 写入绑定 ──
    dc = DiscordChannel(
        channel_id=channel_id,
        guild_id=guild_id,
        guild_name=guild_name,
        channel_name=channel_name,
        session_id=session_id,
        enabled=True,
        trigger_mode=default_trigger_mode,
        config_override=config_override,
    )
    if not repo.save(dc):
        print(f"{_TAG} 保存频道绑定失败: {channel_id}")
        return None

    print(f"{_TAG} ✓ 新建频道绑定 #{channel_name or channel_id} → {session_id}")
    return dc
