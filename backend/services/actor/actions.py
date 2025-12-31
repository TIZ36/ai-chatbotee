"""
行动定义

定义 Agent 可执行的行动类型及结果：
- Action: 行动定义（MCP/Skill/Tool/LLM）
- ActionResult: 行动执行结果
- ResponseDecision: 响应决策
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union


class ActionType(str, Enum):
    """行动类型枚举"""
    MCP = 'mcp'           # MCP 工具调用
    SKILL = 'skill'       # Skill 调用
    TOOL = 'tool'         # 内置工具调用
    LLM = 'llm'           # LLM 生成
    COMPOSITE = 'composite'  # 组合行动


class ResponseAction(str, Enum):
    """响应决策动作"""
    REPLY = 'reply'       # 回复
    SILENT = 'silent'     # 沉默
    DELEGATE = 'delegate' # 委托给其他 Agent
    DEFER = 'defer'       # 延迟处理


@dataclass
class Action:
    """
    行动定义
    
    统一表示 Agent 可执行的各类行动
    """
    
    # 行动类型
    type: Literal['mcp', 'skill', 'tool', 'llm', 'composite']
    
    # MCP 调用参数
    server_id: Optional[str] = None     # MCP 服务器 ID
    mcp_tool_name: Optional[str] = None # MCP 工具名称
    
    # Skill 调用参数
    skill_id: Optional[str] = None
    
    # 内置工具调用参数
    tool_name: Optional[str] = None
    
    # 通用参数
    params: Dict[str, Any] = field(default_factory=dict)
    
    # 行动描述（用于显示）
    description: str = ""
    
    # 超时（毫秒）
    timeout_ms: int = 60000
    
    # 是否需要 LLM 确认结果
    requires_llm_review: bool = True
    
    # 依赖的前置行动索引
    depends_on: List[int] = field(default_factory=list)
    
    # 子行动（组合行动）
    sub_actions: List['Action'] = field(default_factory=list)
    
    def __post_init__(self):
        """初始化后处理"""
        # 自动设置描述
        if not self.description:
            self.description = self._generate_description()
    
    def _generate_description(self) -> str:
        """生成行动描述"""
        if self.type == 'mcp':
            return f"调用 MCP 工具 {self.server_id}:{self.mcp_tool_name}"
        elif self.type == 'skill':
            return f"执行 Skill {self.skill_id}"
        elif self.type == 'tool':
            return f"调用工具 {self.tool_name}"
        elif self.type == 'llm':
            return "LLM 生成内容"
        elif self.type == 'composite':
            return f"组合行动（{len(self.sub_actions)} 步）"
        return "未知行动"
    
    @classmethod
    def mcp(
        cls,
        server_id: str,
        tool_name: str,
        params: Dict[str, Any] = None,
        timeout_ms: int = 60000,
        description: str = None,
    ) -> 'Action':
        """创建 MCP 行动"""
        return cls(
            type='mcp',
            server_id=server_id,
            mcp_tool_name=tool_name,
            params=params or {},
            timeout_ms=timeout_ms,
            description=description or f"调用 {server_id}:{tool_name}",
        )
    
    @classmethod
    def skill(
        cls,
        skill_id: str,
        params: Dict[str, Any] = None,
        description: str = None,
    ) -> 'Action':
        """创建 Skill 行动"""
        return cls(
            type='skill',
            skill_id=skill_id,
            params=params or {},
            description=description or f"执行 Skill {skill_id}",
        )
    
    @classmethod
    def tool(
        cls,
        tool_name: str,
        params: Dict[str, Any] = None,
        description: str = None,
    ) -> 'Action':
        """创建内置工具行动"""
        return cls(
            type='tool',
            tool_name=tool_name,
            params=params or {},
            description=description or f"调用 {tool_name}",
        )
    
    @classmethod
    def llm(
        cls,
        params: Dict[str, Any] = None,
        description: str = None,
    ) -> 'Action':
        """创建 LLM 行动"""
        return cls(
            type='llm',
            params=params or {},
            description=description or "LLM 生成",
        )


@dataclass
class ActionResult:
    """
    行动执行结果
    """
    
    # 对应的行动类型
    action_type: str
    
    # 执行是否成功
    success: bool = True
    
    # 返回数据
    data: Any = None
    
    # 格式化的文本结果（用于构建 LLM 上下文）
    text_result: str = ""
    
    # 错误信息
    error: Optional[str] = None
    error_code: Optional[str] = None
    
    # 耗时（毫秒）
    duration_ms: int = 0
    
    # 时间戳
    timestamp: int = field(default_factory=lambda: int(time.time() * 1000))
    
    # 额外元数据
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    # 原始行动（用于追溯）
    action: Optional[Action] = None
    
    # 工具名称（便于显示）
    tool_name: Optional[str] = None
    
    def __post_init__(self):
        """初始化后处理"""
        # 从 action 提取 tool_name
        if self.action and not self.tool_name:
            if self.action.type == 'mcp':
                self.tool_name = f"{self.action.server_id}:{self.action.mcp_tool_name}"
            elif self.action.type == 'skill':
                self.tool_name = self.action.skill_id
            elif self.action.type == 'tool':
                self.tool_name = self.action.tool_name
    
    @classmethod
    def success_result(
        cls,
        action_type: str,
        data: Any = None,
        text_result: str = "",
        duration_ms: int = 0,
        action: Action = None,
    ) -> 'ActionResult':
        """创建成功结果"""
        return cls(
            action_type=action_type,
            success=True,
            data=data,
            text_result=text_result,
            duration_ms=duration_ms,
            action=action,
        )
    
    @classmethod
    def error_result(
        cls,
        action_type: str,
        error: str,
        error_code: str = None,
        duration_ms: int = 0,
        action: Action = None,
    ) -> 'ActionResult':
        """创建失败结果"""
        return cls(
            action_type=action_type,
            success=False,
            error=error,
            error_code=error_code,
            duration_ms=duration_ms,
            action=action,
        )
    
    def to_step_dict(self) -> Dict[str, Any]:
        """转换为 processStep 格式"""
        step = {
            'type': f"{self.action_type}_result",
            'timestamp': self.timestamp,
            'status': 'completed' if self.success else 'error',
            'duration': self.duration_ms,
        }
        
        if self.tool_name:
            step['tool'] = self.tool_name
        
        if self.error:
            step['error'] = self.error
        
        if self.text_result:
            # 截断长文本
            result = self.text_result
            if len(result) > 500:
                result = result[:500] + '...'
            step['result'] = result
        
        return step


@dataclass
class ResponseDecision:
    """
    响应决策
    
    _should_respond 方法的返回值
    """
    
    # 决策动作
    action: Literal['reply', 'silent', 'delegate', 'defer'] = 'reply'
    
    # 原因/说明
    reason: str = ""
    
    # 委托目标（当 action='delegate' 时）
    delegate_to: Optional[str] = None
    
    # 延迟时间（毫秒，当 action='defer' 时）
    defer_ms: int = 0
    
    # 是否需要思考（显示 thinking 步骤）
    needs_thinking: bool = True
    
    # 响应优先级（用于多 Agent 竞争）
    priority: int = 0
    
    # 置信度（0-1）
    confidence: float = 1.0
    
    @classmethod
    def reply(cls, reason: str = "", needs_thinking: bool = True) -> 'ResponseDecision':
        """创建回复决策"""
        return cls(action='reply', reason=reason, needs_thinking=needs_thinking)
    
    @classmethod
    def silent(cls, reason: str = "") -> 'ResponseDecision':
        """创建沉默决策"""
        return cls(action='silent', reason=reason, needs_thinking=False)
    
    @classmethod
    def delegate(cls, target: str, reason: str = "") -> 'ResponseDecision':
        """创建委托决策"""
        return cls(action='delegate', delegate_to=target, reason=reason)
    
    @classmethod
    def defer(cls, delay_ms: int, reason: str = "") -> 'ResponseDecision':
        """创建延迟决策"""
        return cls(action='defer', defer_ms=delay_ms, reason=reason)


# 便捷别名
MCPAction = Action.mcp
SkillAction = Action.skill
ToolAction = Action.tool
LLMAction = Action.llm
