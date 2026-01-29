"""
Actor 管理器

管理所有活跃的 Actor 实例：
- 创建/获取 Actor
- Redis Pub/Sub 订阅管理
- 事件分发
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Dict, List, TYPE_CHECKING

from database import get_redis_client

if TYPE_CHECKING:
    from .actor_base import ActorBase

logger = logging.getLogger(__name__)


class ActorManager:
    """
    Actor 管理器 - 单例模式
    
    负责管理所有活跃的 Actor 实例，以及全局 Redis Pub/Sub 监听。
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
        self._channel_to_agents: Dict[str, List[str]] = {}
        
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
    
    def remove_actor(self, agent_id: str):
        """移除 Actor"""
        with self._lock:
            if agent_id in self.actors:
                actor = self.actors.pop(agent_id)
                actor.stop()
                logger.info(f"[ActorManager] Removed actor: {agent_id}")
    
    def subscribe_for_agent(self, actor: 'ActorBase', channel: str):
        """
        为 Agent 订阅频道
        
        Args:
            actor: Actor 实例
            channel: Redis 频道名
        """
        with self._lock:
            if channel not in self._channel_to_agents:
                self._channel_to_agents[channel] = []
                
                if self._pubsub:
                    try:
                        self._pubsub.subscribe(channel)
                        logger.info(f"[ActorManager] Subscribed to: {channel}")
                    except Exception as e:
                        logger.warning(f"[ActorManager] Subscribe failed, restarting: {e}")
                        self._restart_global_listener_locked()
                else:
                    self._start_global_listener(channel)
            
            if actor.agent_id not in self._channel_to_agents[channel]:
                self._channel_to_agents[channel].append(actor.agent_id)
                logger.info(f"[ActorManager] Agent {actor.agent_id} added to {channel}")
    
    def unsubscribe_for_agent(self, actor: 'ActorBase', channel: str):
        """
        取消 Agent 订阅
        
        Args:
            actor: Actor 实例
            channel: Redis 频道名
        """
        with self._lock:
            if channel in self._channel_to_agents:
                if actor.agent_id in self._channel_to_agents[channel]:
                    self._channel_to_agents[channel].remove(actor.agent_id)
                
                # 如果没有 Agent 订阅，取消频道订阅
                if not self._channel_to_agents[channel]:
                    del self._channel_to_agents[channel]
                    if self._pubsub:
                        try:
                            self._pubsub.unsubscribe(channel)
                        except Exception:
                            pass
    
    def _start_global_listener(self, first_channel: str):
        """启动全局 Redis 监听线程"""
        if not self._redis_client:
            logger.warning("[ActorManager] Redis not available")
            return
        
        self._pubsub = self._redis_client.pubsub(ignore_subscribe_messages=True)
        self._pubsub.subscribe(first_channel)
        
        def _listen():
            logger.info(f"[ActorManager] Listener started on {first_channel}")
            
            while True:
                try:
                    message = self._pubsub.get_message(timeout=1.0)
                    if not message:
                        time.sleep(0.05)
                        continue
                    
                    if message.get('type') != 'message':
                        continue
                    
                    channel = message.get('channel')
                    if isinstance(channel, bytes):
                        channel = channel.decode('utf-8', errors='ignore')
                    
                    raw = message.get('data')
                    if isinstance(raw, bytes):
                        raw = raw.decode('utf-8', errors='ignore')
                    
                    try:
                        data = json.loads(raw)
                    except Exception:
                        continue
                    
                    event_type = data.get('type')
                    
                    # 分发相关事件
                    if event_type in (
                        'new_message',
                        'topic_updated',
                        'topic_participants_updated',
                        'agent_joined',
                        'participant_left',
                        'messages_rolled_back',
                    ):
                        agents = self._channel_to_agents.get(channel, [])
                        if agents:
                            logger.debug(
                                f"[ActorManager] Dispatching {event_type} on {channel} "
                                f"to {len(agents)} agents"
                            )
                        
                        for agent_id in agents:
                            actor = self.actors.get(agent_id)
                            if actor:
                                topic_id = channel.split(':')[-1]
                                actor.on_event(topic_id, data)
                                
                except Exception as e:
                    msg = str(e)
                    if 'Timeout reading from socket' in msg:
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
        """重建 pubsub 并重新订阅（需在持锁状态下调用）"""
        try:
            if self._pubsub:
                try:
                    self._pubsub.close()
                except Exception:
                    pass
        finally:
            self._pubsub = self._redis_client.pubsub(ignore_subscribe_messages=True)
            channels = list(self._channel_to_agents.keys())
            if channels:
                self._pubsub.subscribe(*channels)
                logger.info(f"[ActorManager] Listener restarted, channels: {len(channels)}")
    
    def get_active_agents(self) -> Dict[str, 'ActorBase']:
        """获取所有活跃的 Actor"""
        return dict(self.actors)
    
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
