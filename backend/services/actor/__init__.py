"""
Actor 模块 - Agent Actor 架构重构

提供基于 Actor 模型的 Agent 实现，支持：
- 迭代式消息处理（ReAct 模式）
- 记忆管理与自动摘要
- MCP/Skill/Tool 能力调用
- 多 Agent 协作

核心类：
- ActorBase: 抽象基类，定义 Agent 生命周期
- ActorState: 状态管理（历史、摘要、参与者）
- IterationContext: 迭代上下文
- CapabilityRegistry: 能力注册（MCP/Skill/Tool）
- ActorManager: Actor 管理器（单例）

辅助函数：
- activate_agent: 激活 Agent
- get_active_agents: 获取所有活跃 Agent

兼容层：
- AgentActor: 旧 API 兼容（已废弃）
"""

from .actor_state import ActorState
from .iteration_context import IterationContext, DecisionContext
from .actions import Action, ActionResult, ResponseDecision  # Action = ActionStep 别名
from .capability_registry import CapabilityRegistry
from .actor_base import ActorBase
from .actor_manager import ActorManager, activate_agent, get_active_agents
from .agents import ChatAgent
from .action_chain import (
    ActionChain, ActionStep, ActionChainStore,
    AgentActionType, ActionStepStatus,
    create_action_step, create_mcp_step, create_call_agent_step,
)

# 兼容层（延迟导入避免循环）
def _get_compat():
    from .compat import AgentActor, AgentActorCompat
    return AgentActor, AgentActorCompat

__all__ = [
    # 核心类
    'ActorBase',
    'ActorState',
    'IterationContext',
    'DecisionContext',
    'Action',
    'ActionResult',
    'ResponseDecision',
    'CapabilityRegistry',
    'ActorManager',
    # Agent 实现
    'ChatAgent',
    # ActionChain 系统
    'ActionChain',
    'ActionStep',
    'ActionChainStore',
    'AgentActionType',
    'ActionStepStatus',
    'create_action_step',
    'create_mcp_step',
    'create_call_agent_step',
    # 辅助函数
    'activate_agent',
    'get_active_agents',
]
