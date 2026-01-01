"""
迭代上下文

管理消息处理的迭代状态：
- 当前迭代轮次
- 规划的行动列表
- 执行结果
- 处理步骤（供前端显示）
- 完成/中断状态
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .actions import Action, ActionResult


@dataclass
class IterationContext:
    """迭代上下文"""
    
    # 迭代配置
    max_iterations: int = 10
    iteration: int = 0
    
    # 原始消息
    original_message: Optional[Dict[str, Any]] = None
    topic_id: Optional[str] = None
    reply_message_id: Optional[str] = None

    # 用户选择的模型信息（优先于session默认配置）
    user_selected_model: Optional[str] = None
    user_selected_llm_config_id: Optional[str] = None
    
    # 行动规划与执行
    planned_actions: List['Action'] = field(default_factory=list)
    executed_results: List['ActionResult'] = field(default_factory=list)
    
    # 处理步骤（供前端显示 processSteps）
    process_steps: List[Dict[str, Any]] = field(default_factory=list)
    
    # 状态标记
    is_complete: bool = False
    is_interrupted: bool = False
    
    # 最终输出
    final_content: str = ""
    final_media: Optional[List[Dict[str, Any]]] = None
    final_ext: Dict[str, Any] = field(default_factory=dict)
    
    # 累积的工具结果（用于构建 LLM 上下文）
    tool_results_text: str = ""
    
    # 错误信息
    error: Optional[str] = None
    
    def add_step(
        self,
        step_type: str,
        thinking: str = None,
        status: str = 'running',
        **kwargs
    ) -> Dict[str, Any]:
        """
        添加处理步骤
        
        Args:
            step_type: 步骤类型（thinking/mcp_call/llm_generating/agent_decision 等）
            thinking: 思考/说明文字
            status: 状态（running/completed/error）
            **kwargs: 其他字段
            
        Returns:
            添加的步骤对象
        """
        step = {
            'type': step_type,
            'timestamp': int(time.time() * 1000),
            'status': status,
            **kwargs,
        }
        if thinking:
            step['thinking'] = thinking
        
        self.process_steps.append(step)
        return step
    
    def update_last_step(self, status: str = None, **kwargs):
        """
        更新最后一个步骤
        
        Args:
            status: 新状态
            **kwargs: 其他更新字段
        """
        if not self.process_steps:
            return
        
        step = self.process_steps[-1]
        if status:
            step['status'] = status
        
        # 计算耗时
        if status in ('completed', 'error') and 'timestamp' in step:
            step['duration'] = int(time.time() * 1000) - step['timestamp']
        
        step.update(kwargs)
    
    def get_step_by_type(self, step_type: str) -> Optional[Dict[str, Any]]:
        """
        获取指定类型的最后一个步骤
        
        Args:
            step_type: 步骤类型
            
        Returns:
            步骤对象或 None
        """
        for step in reversed(self.process_steps):
            if step.get('type') == step_type:
                return step
        return None
    
    def mark_complete(self, content: str = "", media: List[Dict[str, Any]] = None):
        """
        标记处理完成
        
        Args:
            content: 最终内容
            media: 媒体列表
        """
        self.is_complete = True
        self.final_content = content
        if media:
            self.final_media = media
    
    def mark_interrupted(self, reason: str = "用户中断"):
        """
        标记处理被中断
        
        Args:
            reason: 中断原因
        """
        self.is_interrupted = True
        self.add_step('interrupted', thinking=reason, status='completed')
    
    def mark_error(self, error: str):
        """
        标记处理错误
        
        Args:
            error: 错误信息
        """
        self.is_complete = True
        self.error = error
        self.add_step('error', thinking=f'处理失败: {error}', status='error', error=error)
    
    def append_tool_result(self, tool_name: str, result_text: str):
        """
        追加工具结果文本
        
        Args:
            tool_name: 工具名称
            result_text: 结果文本
        """
        if result_text:
            if self.tool_results_text:
                self.tool_results_text += "\n\n"
            self.tool_results_text += f"[{tool_name}]\n{result_text}"
    
    def get_executed_tool_names(self) -> List[str]:
        """获取已执行的工具名称列表"""
        names = []
        for result in self.executed_results:
            if hasattr(result, 'action_type') and result.action_type:
                if hasattr(result, 'tool_name') and result.tool_name:
                    names.append(f"{result.action_type}:{result.tool_name}")
                else:
                    names.append(result.action_type)
        return names
    
    def has_pending_actions(self) -> bool:
        """检查是否还有待执行的行动"""
        executed_count = len(self.executed_results)
        planned_count = len(self.planned_actions)
        return executed_count < planned_count
    
    def get_next_action(self) -> Optional['Action']:
        """获取下一个待执行的行动"""
        executed_count = len(self.executed_results)
        if executed_count < len(self.planned_actions):
            return self.planned_actions[executed_count]
        return None
    
    def to_process_steps_dict(self) -> List[Dict[str, Any]]:
        """转换为 processSteps 格式（供前端）"""
        return self.process_steps.copy()
    
    def build_ext_data(self) -> Dict[str, Any]:
        """构建扩展数据（用于消息存储）"""
        ext = {
            'processSteps': self.process_steps,
            **self.final_ext,
        }
        if self.final_media:
            ext['media'] = self.final_media
        if self.error:
            ext['error'] = self.error
        return ext


@dataclass
class DecisionContext:
    """决策上下文 - 用于 _should_respond 决策"""
    
    topic_id: str
    message_id: str
    sender_id: str
    sender_type: str  # 'user' | 'agent' | 'system'
    content: str
    mentions: List[str] = field(default_factory=list)
    
    # 会话类型
    session_type: Optional[str] = None  # 'agent' | 'topic_general' | 'memory' | 'private_chat'
    
    # Agent 配置
    response_mode: str = 'normal'  # 'normal' | 'persona'
    
    # 是否被 @ 提及
    is_mentioned: bool = False
    
    # 是否是问题
    is_question: bool = False
    
    def __post_init__(self):
        """初始化后处理"""
        # 检测是否是问题
        self.is_question = self._detect_question(self.content)
    
    def _detect_question(self, text: str) -> bool:
        """检测是否是问题"""
        if not text:
            return False
        
        t = text.strip()
        
        # 问号
        if '？' in t or '?' in t:
            return True
        
        # 疑问词
        keywords = ['为什么', '怎么', '如何', '能否', '是否', '吗', '么', '多少', '哪', '哪里', '哪个']
        return any(k in t for k in keywords)
