"""
兼容层

提供从旧 agent_actor.py API 到新 Actor 架构的迁移桥接。
允许渐进式迁移，保持向后兼容。
"""

from __future__ import annotations

import logging
import warnings
from typing import Any, Dict, List, Optional

from .actor_manager import ActorManager, activate_agent
from .agents import ChatAgent

logger = logging.getLogger(__name__)


class AgentActorCompat:
    """
    兼容层 - 封装新的 ActorBase 以提供旧 API
    
    此类允许旧代码继续使用 AgentActor 接口，
    而实际实现已迁移到新的 ActorBase 架构。
    
    使用方式：
    ```python
    # 推荐使用新 API
    from services.actor import ChatAgent, activate_agent
    ```
    """
    
    def __init__(self, agent_id: str):
        """
        初始化兼容层
        
        Args:
            agent_id: Agent ID
        """
        warnings.warn(
            "AgentActor 已迁移到新架构，请使用 services.actor.ChatAgent 或 activate_agent()",
            DeprecationWarning,
            stacklevel=2,
        )
        
        self.agent_id = agent_id
        self._actor: Optional[ChatAgent] = None
        
        # 创建新的 Actor 实例
        manager = ActorManager.get_instance()
        self._actor = manager.get_or_create_actor(agent_id, ChatAgent)
        
        # 兼容旧属性
        self.info = self._actor.info
        self.mailbox = self._actor.mailbox
        self.is_running = self._actor.is_running
    
    def activate(self, topic_id: str, trigger_message: dict = None):
        """
        激活 Agent
        
        Args:
            topic_id: 话题 ID
            trigger_message: 触发消息
        """
        if self._actor:
            self._actor.activate(topic_id, trigger_message)
            self.is_running = self._actor.is_running
    
    def stop(self):
        """停止 Agent"""
        if self._actor:
            self._actor.stop()
            self.is_running = False
    
    def on_event(self, topic_id: str, event: dict):
        """
        接收事件
        
        Args:
            topic_id: 话题 ID
            event: 事件数据
        """
        if self._actor:
            self._actor.on_event(topic_id, event)
    
    @property
    def _topic_state(self) -> dict:
        """兼容旧的 _topic_state 属性"""
        if self._actor:
            return {
                self._actor.topic_id: {
                    'history': self._actor.state.history,
                    'participants': self._actor.state.participants,
                }
            }
        return {}
    
    @property
    def _processed_messages(self) -> set:
        """兼容旧的 _processed_messages 属性"""
        if self._actor:
            return self._actor.state._processed_ids
        return set()


# ==================== 兼容函数 ====================

def get_or_create_agent_actor(agent_id: str) -> AgentActorCompat:
    """
    获取或创建 AgentActor
    
    已废弃，请使用 activate_agent()
    """
    warnings.warn(
        "get_or_create_agent_actor 已废弃，请使用 services.actor.activate_agent()",
        DeprecationWarning,
        stacklevel=2,
    )
    return AgentActorCompat(agent_id)


def activate_agent_on_topic(agent_id: str, topic_id: str, trigger_message: dict = None):
    """
    在 Topic 上激活 Agent
    
    已废弃，请使用 activate_agent()
    """
    warnings.warn(
        "activate_agent_on_topic 已废弃，请使用 services.actor.activate_agent()",
        DeprecationWarning,
        stacklevel=2,
    )
    return activate_agent(agent_id, topic_id, trigger_message)


# ==================== 导出 ====================

# 提供别名以支持旧导入
AgentActor = AgentActorCompat
