"""
Actor 管理器

与 Actor 的线程模型：Manager 运行在独立的后台线程（Redis 监听）；每个激活的 Actor 各自一个
工作线程（mailbox 循环 _run）。Manager 与 Actor 不在同一线程。

职责：
- 维护 topic → agent 映射（channel → [agent_id, ...]），按 DB 解析并按需激活/销毁
- Redis 全局监听 topic:*（psubscribe），收到 new_message 时若无订阅者则 _ensure_topic_handled 激活
- 收到 action_chain_interrupt（前端打断）时：解绑并销毁旧 Actor，激活全新 Actor 并重新绑定 topic
- 事件分发；deactivate_agent / deactivate_topic 用于显式取消订阅或销毁
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Dict, List, TYPE_CHECKING

from database import get_redis_client, get_mysql_connection

if TYPE_CHECKING:
    from .actor_base import ActorBase

logger = logging.getLogger(__name__)


def _channel_to_topic_id(channel: str) -> str:
    """从 Redis 频道名解析 topic_id，例如 topic:agent_chaya -> agent_chaya"""
    if isinstance(channel, bytes):
        channel = channel.decode("utf-8", errors="ignore")
    if channel.startswith("topic:"):
        return channel[6:]  # len("topic:") == 6
    return channel


class ActorManager:
    """
    Actor 管理器 - 单例模式
    
    负责：映射关系（topic → 负责的 agent）、Actor 激活与销毁、全局 Redis 监听与事件分发。
    使用 psubscribe("topic:*") 接收所有 topic 事件；收到 new_message 时若该 channel 尚无 agent，
    则根据 DB 解析应由哪些 Agent 处理并自动激活、再分发消息。
    """
    
    _instance = None
    
    @classmethod
    def get_instance(cls) -> 'ActorManager':
        """获取单例实例"""
        if not cls._instance:
            cls._instance = cls()
        return cls._instance
    
    def __init__(self):
        self.actors: Dict[str, 'ActorBase'] = {}
        self._lock = threading.Lock()
        self._redis_client = get_redis_client()
        self._pubsub = None
        self._sub_thread = None
        # channel (e.g. topic:agent_chaya) -> [agent_id, ...]
        self._channel_to_agents: Dict[str, List[str]] = {}
        # 启动全局监听，首条消息到达时按 DB 解析并激活 Agent，不依赖调用方先 activate_agent
        self._start_global_listener()
        
        logger.info("[ActorManager] Initialized")
    
    def get_or_create_actor(
        self,
        agent_id: str,
        actor_class: type = None,
    ) -> 'ActorBase':
        """
        获取或创建 Actor
        
        Args:
            agent_id: Agent ID
            actor_class: Actor 类（默认为 ChatAgent）
            
        Returns:
            Actor 实例
        """
        with self._lock:
            if agent_id not in self.actors:
                if actor_class is None:
                    from .agents import ChatAgent
                    actor_class = ChatAgent
                
                actor = actor_class(agent_id)
                self.actors[agent_id] = actor
                logger.info(f"[ActorManager] Created actor: {agent_id} ({actor_class.__name__})")
            
            return self.actors[agent_id]
    
    def get_actor(self, agent_id: str) -> 'ActorBase':
        """获取 Actor（如果存在）"""
        return self.actors.get(agent_id)
    
    def _resolve_agent_ids_for_topic(self, topic_id: str) -> List[str]:
        """
        根据 DB 解析应由哪些 Agent 处理该 topic。
        - session_type=agent：该 topic 即私聊的 agent_id，返回 [topic_id]
        - session_type=topic_general：返回该话题下 participant_type=agent 的 participant_id 列表
        - 其他或查库失败：返回 []
        """
        conn = get_mysql_connection()
        if not conn:
            return []
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute(
                "SELECT session_type FROM sessions WHERE session_id = %s",
                (topic_id,),
            )
            row = cursor.fetchone()
            if not row:
                cursor.close()
                conn.close()
                return []
            session_type = (row.get("session_type") or "").strip()
            if session_type == "agent":
                cursor.close()
                conn.close()
                return [topic_id]
            if session_type == "topic_general":
                cursor.execute(
                    """
                    SELECT participant_id FROM session_participants
                    WHERE session_id = %s AND participant_type = 'agent'
                    """,
                    (topic_id,),
                )
                rows = cursor.fetchall()
                cursor.close()
                conn.close()
                return [r["participant_id"] for r in rows if r.get("participant_id")]
            cursor.close()
            conn.close()
            return []
        except Exception as e:
            logger.warning(f"[ActorManager] _resolve_agent_ids_for_topic({topic_id!r}) error: {e}")
            try:
                conn.close()
            except Exception:
                pass
            return []

    def _ensure_topic_handled(self, topic_id: str) -> None:
        """
        确保该 topic 有 Agent 在负责：若当前无订阅者，则根据 DB 解析 agent_ids，
        创建/获取 Actor 并激活（订阅），不传 trigger_message，由后续分发统一递送。
        """
        channel = f"topic:{topic_id}"
        with self._lock:
            agents = self._channel_to_agents.get(channel, [])
        if agents:
            return
        agent_ids = self._resolve_agent_ids_for_topic(topic_id)
        if not agent_ids:
            logger.debug(f"[ActorManager] No agents resolved for topic {topic_id}, skip ensure")
            return
        for agent_id in agent_ids:
            try:
                actor = self.get_or_create_actor(agent_id)
                # 激活并订阅该 channel；不传 trigger_message，避免与 Redis 递送重复
                actor.activate(topic_id, trigger_message=None)
            except Exception as e:
                logger.warning(f"[ActorManager] ensure activate {agent_id} on {topic_id} failed: {e}")

    def _on_interrupt(self, topic_id: str, channel: str, data: dict) -> None:
        """
        前端打断：解绑 topic 与当前 Actor 的映射、将旧 Actor 标记为待销毁并停止，
        再激活全新 Actor 并重新绑定 topic。随后发布 agent_interrupt_ack 供前端展示「处理已终止」。
        """
        agent_id = data.get("agent_id")
        reason = data.get("reason", "user_interrupt")
        if not agent_id:
            logger.warning("[ActorManager] action_chain_interrupt missing agent_id, skip")
            return
        # 1. 解绑并销毁旧 Actor（stop_actor=True 会 remove_actor，旧线程退出）
        self.deactivate_agent(agent_id, topic_id, stop_actor=True)
        # 2. 激活全新 Actor 并重新绑定 topic（下一轮 new_message 或已订阅的客户端由新 Actor 处理）
        self._ensure_topic_handled(topic_id)
        # 3. 通知前端：处理已终止，可立即输入下一条
        try:
            from services.topic_service import get_topic_service
            get_topic_service()._publish_event(
                topic_id,
                "agent_interrupt_ack",
                {"reason": reason, "message": "处理已终止，您可以继续输入"},
            )
        except Exception as e:
            logger.warning(f"[ActorManager] Failed to publish agent_interrupt_ack: {e}")
        logger.info(f"[ActorManager] Interrupt handled: topic={topic_id}, agent={agent_id}, new actor bound")

    def remove_actor(self, agent_id: str):
        """移除 Actor（停止并从池中删除）"""
        with self._lock:
            if agent_id in self.actors:
                actor = self.actors.pop(agent_id)
                actor.stop()
                logger.info(f"[ActorManager] Removed actor: {agent_id}")
    
    def reload_actor_config(self, agent_id: str) -> bool:
        """
        让指定 Agent 从数据库重新加载配置（含 system_prompt）。
        人设更新后调用，使运行中或池中的 Actor 下次使用新人设。
        """
        actor = self.get_actor(agent_id)
        if actor is None:
            return False
        try:
            actor.reload_config()
            logger.info(f"[ActorManager] Reloaded config for actor: {agent_id}")
            return True
        except Exception as e:
            logger.warning(f"[ActorManager] Failed to reload config for {agent_id}: {e}")
            return False
    
    def subscribe_for_agent(self, actor: 'ActorBase', channel: str):
        """
        将 Agent 登记到该 channel 的负责列表（全局已 psubscribe topic:*，无需再 subscribe(channel)）。
        """
        with self._lock:
            if channel not in self._channel_to_agents:
                self._channel_to_agents[channel] = []
            if actor.agent_id not in self._channel_to_agents[channel]:
                self._channel_to_agents[channel].append(actor.agent_id)
                logger.info(f"[ActorManager] Agent {actor.agent_id} added to {channel}")
    
    def unsubscribe_for_agent(self, actor: 'ActorBase', channel: str):
        """从该 channel 的负责列表中移除 Agent（不取消 Redis 订阅，因使用 psubscribe topic:*）。"""
        with self._lock:
            if channel in self._channel_to_agents:
                if actor.agent_id in self._channel_to_agents[channel]:
                    self._channel_to_agents[channel].remove(actor.agent_id)
                if not self._channel_to_agents[channel]:
                    del self._channel_to_agents[channel]
                    logger.info(f"[ActorManager] Channel {channel} has no agents, removed")
    
    def _start_global_listener(self):
        """启动全局 Redis 监听线程，使用 psubscribe('topic:*') 接收所有 topic 事件"""
        if not self._redis_client:
            logger.warning("[ActorManager] Redis not available")
            return
        with self._lock:
            if self._pubsub is not None:
                return
            self._pubsub = self._redis_client.pubsub(ignore_subscribe_messages=True)
            self._pubsub.psubscribe("topic:*")
        
        def _listen():
            logger.info("[ActorManager] Listener started (psubscribe topic:*)")
            while True:
                try:
                    message = self._pubsub.get_message(timeout=1.0)
                    if not message:
                        time.sleep(0.05)
                        continue
                    # 模式订阅返回 type='pmessage'，普通订阅为 'message'
                    if message.get("type") not in ("message", "pmessage"):
                        continue
                    channel = message.get("channel")
                    if channel is None:
                        continue
                    if isinstance(channel, bytes):
                        channel = channel.decode("utf-8", errors="ignore")
                    raw = message.get("data")
                    if isinstance(raw, bytes):
                        raw = raw.decode("utf-8", errors="ignore")
                    try:
                        data = json.loads(raw)
                    except Exception:
                        continue
                    event_type = data.get("type")
                    topic_id = _channel_to_topic_id(channel)

                    # 前端打断：解绑并销毁旧 Actor，激活全新 Actor 并重新绑定，发布 agent_interrupt_ack
                    if event_type == "action_chain_interrupt":
                        self._on_interrupt(topic_id, channel, data)
                        continue

                    if event_type not in (
                        "new_message",
                        "topic_updated",
                        "topic_participants_updated",
                        "agent_joined",
                        "participant_left",
                        "messages_rolled_back",
                    ):
                        continue
                    agents = self._channel_to_agents.get(channel, [])
                    # 收到 new_message 且该 channel 尚无 agent 时，由 Manager 按 DB 解析并激活
                    if not agents and event_type == "new_message":
                        self._ensure_topic_handled(topic_id)
                        agents = self._channel_to_agents.get(channel, [])
                    if agents:
                        logger.debug(
                            f"[ActorManager] Dispatching {event_type} on {channel} to {len(agents)} agents"
                        )
                    for agent_id in agents:
                        actor = self.actors.get(agent_id)
                        if actor:
                            actor.on_event(topic_id, data)
                except Exception as e:
                    msg = str(e)
                    if "Timeout reading from socket" in msg or "Connection" in msg:
                        time.sleep(0.1)
                        continue
                    logger.error(f"[ActorManager] Listener error: {e}")
                    try:
                        with self._lock:
                            self._restart_global_listener_locked()
                    except Exception as e2:
                        logger.error(f"[ActorManager] Restart failed: {e2}")
                    time.sleep(1.0)
        
        self._sub_thread = threading.Thread(
            target=_listen,
            name="ActorManager-RedisListener",
        )
        self._sub_thread.daemon = True
        self._sub_thread.start()
    
    def _restart_global_listener_locked(self):
        """重建 pubsub 并重新 psubscribe topic:*（需在持锁状态下调用）"""
        try:
            if self._pubsub:
                try:
                    self._pubsub.close()
                except Exception:
                    pass
        finally:
            self._pubsub = self._redis_client.pubsub(ignore_subscribe_messages=True)
            self._pubsub.psubscribe("topic:*")
            logger.info("[ActorManager] Listener restarted (psubscribe topic:*)")
    
    def get_active_agents(self) -> Dict[str, 'ActorBase']:
        """获取所有活跃的 Actor"""
        return dict(self.actors)
    
    def deactivate_agent(self, agent_id: str, topic_id: str, stop_actor: bool = False) -> bool:
        """
        取消某 Agent 对该 topic 的订阅（销毁映射）；可选是否停止并移除 Actor。
        
        Returns:
            True 若曾订阅并已取消
        """
        channel = f"topic:{topic_id}"
        actor = self.get_actor(agent_id)
        if not actor:
            return False
        with self._lock:
            if channel not in self._channel_to_agents or agent_id not in self._channel_to_agents[channel]:
                return False
            self._channel_to_agents[channel].remove(agent_id)
            if not self._channel_to_agents[channel]:
                del self._channel_to_agents[channel]
        actor._active_channels.discard(channel)
        logger.info(f"[ActorManager] Deactivated agent {agent_id} from topic {topic_id}")
        if stop_actor:
            self.remove_actor(agent_id)
        return True

    def deactivate_topic(self, topic_id: str, stop_actors: bool = False) -> None:
        """取消该 topic 下所有 Agent 的订阅；可选是否停止并移除这些 Actor。"""
        channel = f"topic:{topic_id}"
        with self._lock:
            agent_ids = list(self._channel_to_agents.get(channel, []))
            if not agent_ids:
                return
            del self._channel_to_agents[channel]
        for agent_id in agent_ids:
            actor = self.get_actor(agent_id)
            if actor:
                actor._active_channels.discard(channel)
            if stop_actors and actor:
                self.remove_actor(agent_id)
        logger.info(f"[ActorManager] Deactivated topic {topic_id} (agents: {agent_ids})")

    def get_pool_status(self) -> List[Dict]:
        """
        获取 Actor 池状态（用于前端监控）
        仅返回已激活（is_running 且 topic_id 非空）的 Actor 状态。
        
        Returns:
            list of dict: 每个元素为 get_status() 的返回值
        """
        result = []
        with self._lock:
            for actor in self.actors.values():
                if not getattr(actor, "is_running", False) or not getattr(actor, "topic_id", None):
                    continue
                try:
                    result.append(actor.get_status())
                except Exception as e:
                    logger.warning(f"[ActorManager] get_status for {actor.agent_id} failed: {e}")
        return result
    
    def shutdown(self):
        """关闭管理器"""
        with self._lock:
            for agent_id, actor in list(self.actors.items()):
                actor.stop()
            self.actors.clear()
            
            if self._pubsub:
                try:
                    self._pubsub.close()
                except Exception:
                    pass
        
        logger.info("[ActorManager] Shutdown complete")


# ==================== 辅助函数 ====================

def activate_agent(
    agent_id: str,
    topic_id: str,
    trigger_message: dict = None,
    actor_class: type = None,
) -> 'ActorBase':
    """
    激活 Agent 并让其加入某个 Topic
    
    Args:
        agent_id: Agent ID
        topic_id: Topic/会话 ID
        trigger_message: 触发消息（如果提供，会立即处理）
        actor_class: Actor 类（默认为 ChatAgent）
        
    Returns:
        Actor 实例
    """
    manager = ActorManager.get_instance()
    actor = manager.get_or_create_actor(agent_id, actor_class)
    actor.activate(topic_id, trigger_message)
    
    logger.info(f"[activate_agent] Agent {agent_id} activated on topic {topic_id}")
    
    return actor


def get_active_agents() -> Dict[str, 'ActorBase']:
    """获取所有活跃的 Actor"""
    return ActorManager.get_instance().get_active_agents()


def deactivate_agent(agent_id: str, topic_id: str, stop_actor: bool = False) -> bool:
    """取消某 Agent 对该 topic 的订阅；可选是否停止并移除 Actor。由 ActorManager 统一管理。"""
    return ActorManager.get_instance().deactivate_agent(agent_id, topic_id, stop_actor=stop_actor)


def deactivate_topic(topic_id: str, stop_actors: bool = False) -> None:
    """取消该 topic 下所有 Agent 的订阅；可选是否停止并移除这些 Actor。"""
    ActorManager.get_instance().deactivate_topic(topic_id, stop_actors=stop_actors)
