"""
Discord Bot 服务：桥接 Discord ↔ Chaya Actor 管道

设计原则：
  - Bot 只是消息桥接器，不含业务逻辑
  - 每个频道绑定到已有 Agent，共享该 Agent 消息历史
  - 通过 Redis Pub/Sub 异步接收 Actor 回复
"""

import asyncio
import json
import os
import hashlib
import threading
import time
import traceback
from typing import Optional, Callable, Dict

_TAG = "[Discord]"


# 前端录入的 Token 持久化路径（backend/.discord_bot_token），重启后可不依赖 config 自动启动
def _discord_token_path() -> str:
    return os.path.join(os.path.dirname(__file__), "..", ".discord_bot_token")


def _discord_tokens_path() -> str:
    return os.path.join(os.path.dirname(__file__), "..", ".discord_bot_tokens.json")


class DiscordService:
    """Discord Bot 单例服务"""

    _instance: Optional["DiscordService"] = None
    _lock = threading.Lock()

    def __init__(self):
        self.bot = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._redis_thread: Optional[threading.Thread] = None
        self._running = False
        self._config: dict = {}
        self._get_connection: Optional[Callable] = None
        self._session_id_prefix = "dc"
        self._max_len = 1900
        # linked_agent_id(session_id) → channel_id 内存缓存（避免 Redis 回复时每次查 DB）
        self._session_to_channel: Dict[str, str] = {}
        # 上次启动失败原因（如 Token 无效），供状态接口返回、前端展示
        self._last_error: Optional[str] = None
        self._owner_agent_id: Optional[str] = None
        # 流式回复状态：session_id -> { channel_id, message_id, content, last_sent_len, last_edit_time }
        self._stream_state: Dict[str, dict] = {}
        self._stream_lock = threading.Lock()
        # 流式编辑节流：最少间隔（秒），避免触发 Discord 限频（5 次/5 秒）
        self._stream_edit_interval = 2.0
        self._stream_chunk_threshold = 1200

    @classmethod
    def get_instance(cls) -> "DiscordService":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    # ━━━━━━━━━━━━━━━━ 配置 ━━━━━━━━━━━━━━━━

    def configure(self, config: dict, get_connection: Callable):
        self._config = config.get("discord") or {}
        self._get_connection = get_connection
        self._session_id_prefix = self._config.get("session_id_prefix") or "dc"
        self._max_len = int(self._config.get("max_response_length") or 1900)

    # ━━━━━━━━━━━━━━━━ Token 持久化（前端录入后写入，重启可不依赖 config） ━━━━━━━━━━━━━━━━

    @staticmethod
    def _load_tokens_map() -> Dict[str, str]:
        path = _discord_tokens_path()
        if not os.path.isfile(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return {}
            out: Dict[str, str] = {}
            for k, v in data.items():
                if isinstance(k, str) and isinstance(v, str) and v.strip():
                    out[k] = v.strip()
            return out
        except Exception as e:
            print(f"{_TAG} 读取 Token 映射失败: {e}")
            return {}

    @staticmethod
    def _save_tokens_map(tokens: Dict[str, str]) -> bool:
        path = _discord_tokens_path()
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(tokens, f, ensure_ascii=False, indent=2)
            try:
                os.chmod(path, 0o600)
            except Exception:
                pass
            return True
        except Exception as e:
            print(f"{_TAG} 写入 Token 映射失败: {e}")
            return False

    @staticmethod
    def get_persisted_token(agent_id: Optional[str] = None) -> Optional[str]:
        """读取指定 Agent 的持久化 Bot Token。"""
        aid = (agent_id or "agent_chaya").strip() or "agent_chaya"
        tokens = DiscordService._load_tokens_map()
        token = (tokens.get(aid) or "").strip()
        if token:
            return token

        # 兼容历史单 token 文件，仅作为 agent_chaya 的回退
        if aid == "agent_chaya":
            legacy = _discord_token_path()
            if os.path.isfile(legacy):
                try:
                    with open(legacy, "r", encoding="utf-8") as f:
                        t = (f.read() or "").strip()
                    return t if t else None
                except Exception:
                    return None
        return None

    @staticmethod
    def persist_token(agent_id: str, token: str) -> bool:
        """按 Agent 维度持久化 Bot Token。"""
        aid = (agent_id or "agent_chaya").strip() or "agent_chaya"
        tv = (token or "").strip()
        if not tv:
            return False
        tokens = DiscordService._load_tokens_map()
        tokens[aid] = tv
        return DiscordService._save_tokens_map(tokens)

    @staticmethod
    def has_persisted_token(agent_id: str) -> bool:
        return bool(DiscordService.get_persisted_token(agent_id))

    @staticmethod
    def find_token_owner(token: str) -> Optional[str]:
        tv = (token or "").strip()
        if not tv:
            return None
        tokens = DiscordService._load_tokens_map()
        for aid, tk in tokens.items():
            if tk == tv:
                return aid
        return None

    # ━━━━━━━━━━━━━━━━ 启停 ━━━━━━━━━━━━━━━━

    def start(self, bot_token: str, owner_agent_id: str = "agent_chaya") -> bool:
        if not bot_token or self._running:
            return False
        try:
            import discord
        except ImportError:
            print(f"{_TAG} discord.py 未安装。pip install discord.py")
            return False

        intents = discord.Intents.default()
        intents.message_content = True
        intents.messages = True
        intents.guilds = True

        client = discord.Client(intents=intents)
        self.bot = client
        self._running = True
        self._last_error = None
        self._owner_agent_id = owner_agent_id
        svc = self  # closure 引用

        @client.event
        async def on_ready():
            guilds = [g.name for g in client.guilds]
            print(f"{_TAG} ✓ Bot 上线 {client.user}  |  服务器: {guilds}")
            # 预热缓存：加载所有已绑定频道
            svc._warm_cache()

        @client.event
        async def on_message(message):
            if message.author == client.user or message.author.bot:
                return
            if message.guild is None:
                return  # 忽略私信
            await svc._on_message(message)

        # ── Bot 事件循环线程 ──
        def _run():
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            try:
                self._loop.run_until_complete(client.start(bot_token))
            except Exception as e:
                err_msg = str(e).strip() or type(e).__name__
                self._last_error = err_msg
                print(f"{_TAG} Bot 事件循环退出: {e}")
            finally:
                self._running = False

        self._thread = threading.Thread(target=_run, daemon=True, name="discord-bot")
        self._thread.start()

        # ── Redis 响应监听线程 ──
        self._redis_thread = threading.Thread(
            target=self._redis_listener, daemon=True, name="discord-redis"
        )
        self._redis_thread.start()
        return True

    def stop(self):
        self._running = False
        if self.bot and self._loop:
            try:
                asyncio.run_coroutine_threadsafe(self.bot.close(), self._loop).result(
                    timeout=5
                )
            except Exception:
                pass
        self.bot = None
        self._loop = None
        self._session_to_channel.clear()
        with self._stream_lock:
            self._stream_state.clear()
        self._last_error = None
        self._owner_agent_id = None

    def is_running(self) -> bool:
        return self._running and self.bot is not None

    def get_bot_info(self) -> dict:
        out = {"online": False, "username": None, "guilds": 0}
        if self._last_error and not self._running:
            out["last_error"] = self._last_error
        if not self.bot or not self.bot.user:
            return out
        out["online"] = not self.bot.is_closed()
        out["username"] = str(self.bot.user)
        out["guilds"] = len(self.bot.guilds) if self.bot.guilds else 0
        out["owner_agent_id"] = self._owner_agent_id
        return out

    def get_owner_agent_id(self) -> Optional[str]:
        return self._owner_agent_id

    # ━━━━━━━━━━━━━━━━ 缓存 ━━━━━━━━━━━━━━━━

    def _warm_cache(self):
        """启动时加载所有绑定到内存缓存"""
        try:
            from models.discord_channel import DiscordChannelRepository

            repo = DiscordChannelRepository(self._get_connection)
            for dc in repo.list_all(enabled_only=True):
                cache_key = dc.linked_agent_id or dc.session_id
                self._session_to_channel[cache_key] = dc.channel_id
            print(f"{_TAG} 缓存预热: {len(self._session_to_channel)} 个频道绑定")
        except Exception as e:
            print(f"{_TAG} 缓存预热失败: {e}")

    # ━━━━━━━━━━━━━━━━ 收消息 ━━━━━━━━━━━━━━━━

    async def _on_message(self, message):
        """Discord 消息入口"""
        try:
            channel_id = str(message.channel.id)
            guild_id = str(message.guild.id)
            guild_name = message.guild.name or ""
            channel_name = getattr(message.channel, "name", "") or ""

            from models.discord_channel import (
                DiscordChannelRepository,
                DiscordAppConfigRepository,
                ensure_channel_session,
            )

            repo = DiscordChannelRepository(self._get_connection)
            binding = repo.find_by_channel_id(channel_id)

            bot_mentioned = self.bot.user and self.bot.user.mentioned_in(message)

            # ── 未绑定：auto_create + @Bot 时创建 ──
            if not binding:
                if not (
                    self._config.get("auto_create_session", True) and bot_mentioned
                ):
                    return
                # 默认模型：优先表（前端录入），其次 config.yaml
                app_cfg = DiscordAppConfigRepository(self._get_connection)
                default_llm = app_cfg.get_default_llm_config_id()
                if not default_llm:
                    default_llm = (
                        self._config.get("default_llm_config_id") or ""
                    ).strip() or None
                binding = ensure_channel_session(
                    self._get_connection,
                    channel_id=channel_id,
                    guild_id=guild_id,
                    channel_name=channel_name,
                    guild_name=guild_name,
                    default_trigger_mode=self._config.get("default_trigger_mode")
                    or "mention",
                    default_llm_config_id=default_llm,
                    session_id_prefix=self._session_id_prefix,
                    linked_agent_id="agent_chaya",
                )
                if not binding:
                    print(f"{_TAG} 自动创建频道会话失败: {channel_id}")
                    return
                # 更新缓存（按绑定 agent 维度）
                cache_key = binding.linked_agent_id or binding.session_id
                self._session_to_channel[cache_key] = channel_id
                print(f"{_TAG} ✓ 新绑定 #{channel_name} → {cache_key}")

            if not binding.enabled:
                return
            if binding.trigger_mode == "mention" and not bot_mentioned:
                return

            # ── 提取文本（移除 @mention 标记） ──
            content = message.content or ""
            if self.bot.user:
                for tag in (f"<@{self.bot.user.id}>", f"<@!{self.bot.user.id}>"):
                    content = content.replace(tag, "")
                content = content.strip()

            # ── 处理附件（放入线程池，避免阻塞事件循环） ──
            loop = asyncio.get_running_loop()
            attachments_data = await loop.run_in_executor(
                None, self._fetch_attachments, message.attachments
            )

            if not content and not attachments_data:
                return

            # ── 构造 ext ──
            ext = {
                "source": "discord",
                "discord_message_id": str(message.id),
                "discord_channel_id": channel_id,
                "discord_guild_id": guild_id,
                "sender_name": message.author.display_name or str(message.author),
                "sender_avatar": str(message.author.display_avatar.url)
                if message.author.display_avatar
                else None,
            }
            if attachments_data:
                ext["attachments"] = attachments_data
                if not content:
                    content = "[附件]"

            # ── 发送 typing 指示 + 投递到 Actor 管道 ──
            session_id = binding.linked_agent_id or binding.session_id
            sender_id = f"discord:{message.author.id}"

            async with message.channel.typing():
                await loop.run_in_executor(
                    None,
                    self._dispatch_to_actor,
                    session_id,
                    sender_id,
                    content,
                    ext,
                )

        except Exception as e:
            print(f"{_TAG} _on_message 异常: {e}")
            traceback.print_exc()

    # ── 同步辅助方法（在线程池中执行） ──

    @staticmethod
    def _fetch_attachments(attachments) -> list:
        """下载 Discord 附件并转为 base64 列表"""
        result = []
        for att in attachments:
            ct = att.content_type or ""
            if not (ct.startswith("image/") or ct.startswith("video/")):
                continue
            try:
                import base64, requests as _req

                resp = _req.get(att.url, timeout=15)
                if resp.status_code == 200:
                    result.append(
                        {
                            "type": "image" if ct.startswith("image/") else "video",
                            "mimeType": ct,
                            "data": base64.b64encode(resp.content).decode("utf-8"),
                        }
                    )
            except Exception as e:
                print(f"{_TAG} 附件下载失败 {att.filename}: {e}")
        return result

    def _dispatch_to_actor(
        self, session_id: str, sender_id: str, content: str, ext: dict
    ):
        """发送消息到 TopicService → 激活 Actor（同步，在线程池中调用）"""
        try:
            from services.topic_service import get_topic_service

            topic_svc = get_topic_service()
            msg = topic_svc.send_message(
                topic_id=session_id,
                sender_id=sender_id,
                sender_type="user",
                content=content,
                role="user",
                ext=ext,
                sender_name=ext.get("sender_name"),
                sender_avatar=ext.get("sender_avatar"),
            )
            if not msg:
                print(f"{_TAG} send_message 返回 None (session={session_id})")
                return
            # 不在此处 activate_agent：ActorManager 收到 new_message 后会按 DB 解析并自动激活
        except Exception as e:
            print(f"{_TAG} _dispatch_to_actor 异常: {e}")
            traceback.print_exc()

    # ━━━━━━━━━━━━━━━━ Redis 响应监听 ━━━━━━━━━━━━━━━━

    def _redis_listener(self):
        """后台线程：订阅 topic:dc_*，将 assistant 回复转发到 Discord"""
        # 等 Bot ready
        for _ in range(30):
            if self.bot and self.bot.user:
                break
            if not self._running:
                return
            time.sleep(1)

        from database import get_redis_client

        rc = get_redis_client()
        if not rc:
            print(f"{_TAG} Redis 不可用，响应监听已禁用")
            return

        # 现在 Discord 直接绑定已有 agent，会话 ID 不再限定 dc_* 前缀
        pattern = "topic:*"
        ps = rc.pubsub()
        ps.psubscribe(pattern)
        print(f"{_TAG} Redis 监听已启动 pattern={pattern}")

        while self._running:
            try:
                raw = ps.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if not raw or raw.get("type") != "pmessage":
                    continue

                # channel → session_id
                ch = raw.get("channel")
                if isinstance(ch, bytes):
                    ch = ch.decode("utf-8")
                if not ch or not ch.startswith("topic:"):
                    continue
                session_id = ch.replace("topic:", "", 1)

                # 仅处理已绑定到 Discord 的会话（linked_agent_id）
                if not self._get_channel_id(session_id):
                    continue

                # 解析 payload
                data = raw.get("data")
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                if isinstance(data, str):
                    try:
                        data = json.loads(data)
                    except Exception:
                        continue
                if not isinstance(data, dict):
                    continue

                event_type = data.get("type")
                payload = data.get("data") or {}
                ext = payload.get("ext") or {}

                # 防回环：来自 Discord 触发的消息不再发回 Discord
                if ext.get("source") == "discord":
                    continue

                # ── 思考过程：先发一条「思考中」，后续流式会覆盖该条 ──
                if event_type == "agent_thinking":
                    channel_id = self._get_channel_id(session_id)
                    if not channel_id:
                        continue
                    with self._stream_lock:
                        if session_id not in self._stream_state:
                            msg_id = self._send_and_return_message_id(
                                channel_id, "💭 思考中..."
                            )
                            if msg_id:
                                self._stream_state[session_id] = {
                                    "channel_id": channel_id,
                                    "message_id": msg_id,
                                    "content": "💭 思考中...",
                                    "last_sent_len": 0,
                                    "last_edit_time": 0.0,
                                }
                    continue

                # ── 流式 chunk：累积内容并节流编辑同一条消息 ──
                if event_type == "agent_stream_chunk":
                    accumulated = (payload.get("accumulated") or "").strip()
                    if not accumulated:
                        continue
                    channel_id = self._get_channel_id(session_id)
                    if not channel_id:
                        continue
                    now = time.time()
                    with self._stream_lock:
                        state = self._stream_state.get(session_id)
                        if not state:
                            msg_id = self._send_and_return_message_id(
                                channel_id, accumulated[:2000]
                            )
                            if msg_id:
                                self._stream_state[session_id] = {
                                    "channel_id": channel_id,
                                    "message_id": msg_id,
                                    "content": accumulated,
                                    "last_sent_len": min(len(accumulated), 2000),
                                    "last_edit_time": now,
                                }
                        else:
                            state["content"] = accumulated
                            need_edit = (
                                len(accumulated) - state["last_sent_len"]
                            ) >= self._stream_chunk_threshold or (
                                now - state["last_edit_time"]
                            ) >= self._stream_edit_interval
                            if need_edit:
                                if self._edit_message(
                                    state["channel_id"],
                                    state["message_id"],
                                    accumulated[:2000],
                                ):
                                    state["last_sent_len"] = min(len(accumulated), 2000)
                                    state["last_edit_time"] = now
                    continue

                # ── 流式结束：最终编辑 + 超长分段发送，并清除状态 ──
                if event_type == "agent_stream_done":
                    content = (payload.get("content") or "").strip()
                    if not content and payload.get("error"):
                        content = f"⚠️ {payload.get('error', '')[:500]}"
                    with self._stream_lock:
                        state = self._stream_state.pop(session_id, None)
                    if state:
                        self._edit_message(
                            state["channel_id"],
                            state["message_id"],
                            content[:2000] or "（无内容）",
                        )
                        if len(content) > 2000:
                            for part in self._split(content[2000:], self._max_len):
                                self._send(state["channel_id"], part)
                    elif content:
                        self._relay_to_discord(session_id, content)
                    continue

                # ── 兜底：new_message（无流式时直接整条发送） ──
                if event_type == "new_message":
                    if payload.get("role") != "assistant":
                        continue
                    with self._stream_lock:
                        if session_id in self._stream_state:
                            continue
                    content = (payload.get("content") or "").strip()
                    if not content:
                        continue
                    self._relay_to_discord(session_id, content)

            except Exception as e:
                print(f"{_TAG} Redis 监听异常: {e}")
                time.sleep(2)

        try:
            ps.punsubscribe(pattern)
            ps.close()
        except Exception:
            pass
        print(f"{_TAG} Redis 监听已停止")

    # ━━━━━━━━━━━━━━━━ 发回 Discord ━━━━━━━━━━━━━━━━

    def _get_channel_id(self, session_id: str) -> Optional[int]:
        """根据 linked_agent_id(session_id) 解析 Discord 频道 ID（带缓存）"""
        channel_id_str = self._session_to_channel.get(session_id)
        if not channel_id_str:
            from models.discord_channel import DiscordChannelRepository

            repo = DiscordChannelRepository(self._get_connection)
            binding = repo.find_by_linked_agent_id(session_id)
            if not binding:
                return None
            channel_id_str = binding.channel_id
            self._session_to_channel[session_id] = channel_id_str
        return int(channel_id_str)

    def _send_and_return_message_id(self, channel_id: int, text: str) -> Optional[int]:
        """发送一条消息并返回 Discord message_id（用于后续编辑），失败返回 None"""
        if not self.bot or not self._loop or self.bot.is_closed():
            return None

        result = [None]

        async def _do():
            ch = self.bot.get_channel(channel_id)
            if not ch:
                try:
                    ch = await self.bot.fetch_channel(channel_id)
                except Exception:
                    print(f"{_TAG} 频道 {channel_id} 不可达")
                    return
            msg = await ch.send((text or "...")[:2000])
            result[0] = msg.id

        try:
            fut = asyncio.run_coroutine_threadsafe(_do(), self._loop)
            fut.result(timeout=15)
            return result[0]
        except Exception as e:
            print(f"{_TAG} 发送失败 (channel={channel_id}): {e}")
            return None

    def _edit_message(self, channel_id: int, message_id: int, content: str) -> bool:
        """线程安全地编辑 Discord 消息（单条消息最多 2000 字符）"""
        if not self.bot or not self._loop or self.bot.is_closed():
            return False
        content = (content or "")[:2000]

        async def _do():
            ch = self.bot.get_channel(channel_id)
            if not ch:
                try:
                    ch = await self.bot.fetch_channel(channel_id)
                except Exception:
                    return
            msg = await ch.fetch_message(message_id)
            await msg.edit(content=content)

        try:
            fut = asyncio.run_coroutine_threadsafe(_do(), self._loop)
            fut.result(timeout=10)
            return True
        except Exception as e:
            print(f"{_TAG} 编辑消息失败 (channel={channel_id}): {e}")
            return False

    def _relay_to_discord(self, session_id: str, content: str):
        """将 Chaya 回复发送到对应 Discord 频道"""
        # 先查缓存
        channel_id_str = self._session_to_channel.get(session_id)
        if not channel_id_str:
            # 缓存未命中，查 DB
            from models.discord_channel import DiscordChannelRepository

            repo = DiscordChannelRepository(self._get_connection)
            binding = repo.find_by_linked_agent_id(session_id)
            if not binding:
                return
            channel_id_str = binding.channel_id
            self._session_to_channel[session_id] = channel_id_str

        channel_id = int(channel_id_str)
        for chunk in self._split(content, self._max_len):
            self._send(channel_id, chunk)

    def _split(self, text: str, limit: int) -> list:
        """
        智能分段：
        1. 优先在换行处切割
        2. 保持代码块 ``` 的完整性
        3. 回退到空格，最后强制截断
        """
        if not text or len(text) <= limit:
            return [text] if text else []

        chunks = []
        rest = text
        while rest:
            if len(rest) <= limit:
                chunks.append(rest)
                break

            # 如果当前段包含未闭合的代码块，尝试找到闭合位置
            segment = rest[:limit]
            # 统计 ``` 出现次数
            fence_count = segment.count("```")
            if fence_count % 2 == 1:
                # 未闭合代码块：尝试往前找到最后一个 ``` 之前切割
                last_fence = segment.rfind("```")
                if last_fence > limit // 4:
                    cut = last_fence
                    chunks.append(rest[:cut].rstrip())
                    rest = rest[cut:].lstrip("\n")
                    continue

            # 正常切割：优先换行 → 空格 → 强制
            cut = segment.rfind("\n")
            if cut <= limit // 4:
                cut = segment.rfind(" ")
            if cut <= limit // 4:
                cut = limit
            chunks.append(rest[:cut].rstrip())
            rest = rest[cut:].lstrip("\n")

        return chunks

    def _send(self, channel_id: int, text: str):
        """线程安全地向 Discord 频道发送一条消息"""
        if not self.bot or not self._loop or self.bot.is_closed():
            return

        async def _do():
            ch = self.bot.get_channel(channel_id)
            if not ch:
                # get_channel 仅从缓存读取；fetch_channel 走 API
                try:
                    ch = await self.bot.fetch_channel(channel_id)
                except Exception:
                    print(f"{_TAG} 频道 {channel_id} 不可达")
                    return
            await ch.send(text[:2000])

        try:
            fut = asyncio.run_coroutine_threadsafe(_do(), self._loop)
            fut.result(timeout=15)
        except Exception as e:
            print(f"{_TAG} 发送失败 (channel={channel_id}): {e}")
