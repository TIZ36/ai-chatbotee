"""
行动定义 - 兼容层

此文件保留用于向后兼容。所有类已迁移到 action_chain.py。

导出的类：
- ActionStep: 替代旧的 Action 类
- ActionResult: 行动执行结果  
- ResponseDecision: 响应决策
- AgentActionType: 替代旧的 ActionType 枚举

旧的 Action 类已废弃，请使用 ActionStep。
"""

from __future__ import annotations

# 从新的 action_chain 模块导入所有内容
from .action_chain import (
    # 枚举
    AgentActionType,
    ActionStepStatus,
    ResponseAction,
    
    # 核心类
    ActionStep,
    ActionChain,
    ActionResult,
    ResponseDecision,
    
    # 存储
    ActionChainStore,
    
    # 工厂函数
    create_action_step,
    create_mcp_step,
    create_call_agent_step,
)


# =============================================================================
# 向后兼容别名
# =============================================================================

# ActionType 已废弃，使用 AgentActionType
ActionType = AgentActionType

# Action 类已废弃，使用 ActionStep
# 提供一个兼容的 Action 别名
Action = ActionStep


# =============================================================================
# 旧版工厂函数别名 (向后兼容)
# =============================================================================

def MCPAction(
    server_id: str,
    tool_name: str,
    params: dict = None,
    timeout_ms: int = 60000,
    description: str = None,
) -> ActionStep:
    """
    创建 MCP 行动 (向后兼容)
    
    已废弃：请使用 create_mcp_step()
    """
    return create_mcp_step(
        mcp_server_id=server_id,
        mcp_tool_name=tool_name,
        params=params or {},
        description=description or f"调用 {server_id}:{tool_name}",
    )


def SkillAction(
    skill_id: str,
    params: dict = None,
    description: str = None,
) -> ActionStep:
    """
    创建 Skill 行动 (向后兼容)
    
    已废弃：Skill 功能已整合到 ActionStep
    """
    return ActionStep(
        action_type=AgentActionType.AG_SELF_GEN,
        description=description or f"执行 Skill {skill_id}",
        params={'skill_id': skill_id, **(params or {})},
    )


def ToolAction(
    tool_name: str,
    params: dict = None,
    description: str = None,
) -> ActionStep:
    """
    创建内置工具行动 (向后兼容)
    
    已废弃：Tool 功能已整合到 ActionStep
    """
    return ActionStep(
        action_type=AgentActionType.AG_SELF_GEN,
        description=description or f"调用 {tool_name}",
        params={'tool_name': tool_name, **(params or {})},
    )


def LLMAction(
    params: dict = None,
    description: str = None,
) -> ActionStep:
    """
    创建 LLM 行动 (向后兼容)
    
    已废弃：请使用 ActionStep(action_type=AgentActionType.AG_SELF_GEN)
    """
    return ActionStep(
        action_type=AgentActionType.AG_SELF_GEN,
        description=description or "LLM 生成",
        params=params or {},
    )


# =============================================================================
# 导出
# =============================================================================

__all__ = [
    # 新系统
    'AgentActionType',
    'ActionStepStatus',
    'ResponseAction',
    'ActionStep',
    'ActionChain',
    'ActionResult',
    'ResponseDecision',
    'ActionChainStore',
    'create_action_step',
    'create_mcp_step',
    'create_call_agent_step',
    
    # 向后兼容别名
    'ActionType',  # deprecated, use AgentActionType
    'Action',      # deprecated, use ActionStep
    'MCPAction',   # deprecated
    'SkillAction', # deprecated
    'ToolAction',  # deprecated
    'LLMAction',   # deprecated
]
