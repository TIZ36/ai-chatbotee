"""
Agent 实现模块

提供不同类型的 Agent 实现：
- ChatAgent: 默认对话 Agent
- ResearchAgent: 研究型 Agent（待实现）
- CodingAgent: 编码型 Agent（待实现）
"""

from .chat_agent import ChatAgent

__all__ = [
    'ChatAgent',
]


def get_agent_class(agent_type: str = 'chat'):
    """
    根据类型获取 Agent 类
    
    Args:
        agent_type: Agent 类型 ('chat', 'research', 'coding')
        
    Returns:
        Agent 类
    """
    agent_classes = {
        'chat': ChatAgent,
        # 'research': ResearchAgent,  # 待实现
        # 'coding': CodingAgent,      # 待实现
    }
    return agent_classes.get(agent_type, ChatAgent)
