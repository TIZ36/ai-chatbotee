"""
ActionChain System for Agent Collaboration

This module defines the ActionChain system for tracking and coordinating
agent actions across topics. It supports:
- Standard action types for agent behaviors
- Chain-based action sequences with progress tracking
- Redis persistence for cross-agent handoff
- Event callbacks for frontend Processing component updates
"""

import json
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Optional, Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from services.topic_service import TopicService


# =============================================================================
# Action Type Enumeration
# =============================================================================

class AgentActionType(str, Enum):
    """
    Agent action types that define behavior during message processing.
    
    Each action type represents a specific decision or behavior the agent
    can take during a single response or across multiple responses.
    """
    
    # Single-response actions (can complete in one response)
    AG_ACCEPT = 'ag_accept'           # Accept and process the message
    AG_REFUSE = 'ag_refuse'           # Refuse to process (triggers interrupt)
    AG_SELF_GEN = 'ag_self_gen'       # Self-generate response content
    AG_SELF_DECISION = 'ag_self_decision'  # Make a decision
    AG_USE_MCP = 'ag_use_mcp'         # Use MCP tool to complete task
    AG_CALL_HUMAN = 'ag_call_human'   # Request human input/action (@ user)
    
    # Multi-response actions (requires handoff)
    AG_CALL_AG = 'ag_call_ag'         # Call another agent (@ another agent)


class ActionStepStatus(str, Enum):
    """Status of an action step in the chain."""
    PENDING = 'pending'       # Not yet started
    RUNNING = 'running'       # Currently executing
    COMPLETED = 'completed'   # Successfully completed
    ERROR = 'error'           # Failed with error
    INTERRUPTED = 'interrupted'  # Interrupted by user or AG_REFUSE


# =============================================================================
# Action Step Base Class
# =============================================================================

@dataclass
class ActionStep:
    """
    Base class for a single action step in an ActionChain.
    
    Each step has:
    - action_type: The type of action to perform
    - params: Input parameters for the action (e.g., MCP tool args)
    - result: Output result after execution
    - interrupt: Whether this step should interrupt subsequent actions
    - do_before/do_after: Callbacks for event publishing
    
    Attributes:
        step_id: Unique identifier for this step
        action_type: The AgentActionType for this step
        params: Key-value parameters for execution
        result: Execution result (empty until completed)
        interrupt: If True, stops chain execution after this step
        status: Current status of the step
        description: Human-readable description of what this step does
        started_at: Timestamp when execution started
        completed_at: Timestamp when execution completed
        error_message: Error message if status is ERROR
    """
    
    step_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    action_type: AgentActionType = AgentActionType.AG_SELF_GEN
    params: Dict[str, Any] = field(default_factory=dict)
    result: Dict[str, Any] = field(default_factory=dict)
    interrupt: bool = False
    status: ActionStepStatus = ActionStepStatus.PENDING
    description: str = ''
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    error_message: Optional[str] = None
    
    # MCP-specific fields
    mcp_server_id: Optional[str] = None
    mcp_tool_name: Optional[str] = None
    
    # AG_CALL_AG specific fields
    target_agent_id: Optional[str] = None
    target_topic_id: Optional[str] = None
    
    def do_before(self, topic_service: 'TopicService', topic_id: str, agent_id: str) -> None:
        """
        Callback executed before the action runs.
        Publishes ACTION_STEP_START event to frontend Processing component.
        
        Args:
            topic_service: TopicService instance for event publishing
            topic_id: Current topic ID
            agent_id: Current agent ID
        """
        self.status = ActionStepStatus.RUNNING
        self.started_at = time.time()
        
        topic_service.publish_process_event(
            topic_id=topic_id,
            phase='action_step_start',
            agent_id=agent_id,
            status='running',
            data={
                'step_id': self.step_id,
                'action_type': self.action_type.value,
                'description': self.description,
                'params': self.params,
                'mcp_server_id': self.mcp_server_id,
                'mcp_tool_name': self.mcp_tool_name,
                'target_agent_id': self.target_agent_id,
            }
        )
    
    def do_after(self, topic_service: 'TopicService', topic_id: str, agent_id: str,
                 success: bool = True, error: Optional[str] = None) -> None:
        """
        Callback executed after the action completes.
        Publishes ACTION_STEP_DONE event to frontend Processing component.
        
        Args:
            topic_service: TopicService instance for event publishing
            topic_id: Current topic ID
            agent_id: Current agent ID
            success: Whether the action completed successfully
            error: Error message if failed
        """
        self.completed_at = time.time()
        
        if success:
            self.status = ActionStepStatus.COMPLETED
        else:
            self.status = ActionStepStatus.ERROR
            self.error_message = error
            
        # AG_REFUSE always triggers interrupt
        if self.action_type == AgentActionType.AG_REFUSE:
            self.interrupt = True
        
        duration = self.completed_at - (self.started_at or self.completed_at)
        
        topic_service.publish_process_event(
            topic_id=topic_id,
            phase='action_step_done',
            agent_id=agent_id,
            status='completed' if success else 'error',
            data={
                'step_id': self.step_id,
                'action_type': self.action_type.value,
                'result': self.result,
                'interrupt': self.interrupt,
                'duration': duration,
                'error': error,
            }
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize step to dictionary for Redis storage."""
        return {
            'step_id': self.step_id,
            'action_type': self.action_type.value,
            'params': self.params,
            'result': self.result,
            'interrupt': self.interrupt,
            'status': self.status.value,
            'description': self.description,
            'started_at': self.started_at,
            'completed_at': self.completed_at,
            'error_message': self.error_message,
            'mcp_server_id': self.mcp_server_id,
            'mcp_tool_name': self.mcp_tool_name,
            'target_agent_id': self.target_agent_id,
            'target_topic_id': self.target_topic_id,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ActionStep':
        """Deserialize step from dictionary."""
        return cls(
            step_id=data.get('step_id', str(uuid.uuid4())[:8]),
            action_type=AgentActionType(data.get('action_type', 'ag_self_gen')),
            params=data.get('params', {}),
            result=data.get('result', {}),
            interrupt=data.get('interrupt', False),
            status=ActionStepStatus(data.get('status', 'pending')),
            description=data.get('description', ''),
            started_at=data.get('started_at'),
            completed_at=data.get('completed_at'),
            error_message=data.get('error_message'),
            mcp_server_id=data.get('mcp_server_id'),
            mcp_tool_name=data.get('mcp_tool_name'),
            target_agent_id=data.get('target_agent_id'),
            target_topic_id=data.get('target_topic_id'),
        )


# =============================================================================
# ActionChain Class
# =============================================================================

@dataclass
class ActionChain:
    """
    A chain of action steps representing an agent's work plan.
    
    The ActionChain is:
    - Created when an agent starts processing a message
    - Passed between agents via @ mentions for handoff
    - Stored in Redis for persistence across agent boundaries
    - Used to track progress for frontend display
    
    Attributes:
        chain_id: Unique identifier for this chain
        name: Human-readable name for this chain
        steps: List of ActionStep objects
        current_index: Index of current step being executed
        status: Overall chain status
        origin_agent_id: Agent that created this chain
        origin_topic_id: Topic where chain was created
        created_at: Timestamp when chain was created
        updated_at: Timestamp when chain was last updated
    """
    
    chain_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ''
    steps: List[ActionStep] = field(default_factory=list)
    current_index: int = 0
    status: ActionStepStatus = ActionStepStatus.PENDING
    origin_agent_id: Optional[str] = None
    origin_topic_id: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    
    # Redis TTL in seconds (1 hour, though execution expected in minutes)
    REDIS_TTL: int = 3600
    
    def add_step(self, action_type: AgentActionType, 
                 description: str = '',
                 params: Dict[str, Any] = None,
                 **kwargs) -> 'ActionChain':
        """
        Add a step to the chain (fluent API).
        
        Args:
            action_type: Type of action for this step
            description: Human-readable description
            params: Parameters for the action
            **kwargs: Additional ActionStep fields
            
        Returns:
            Self for method chaining
        """
        step = ActionStep(
            action_type=action_type,
            description=description,
            params=params or {},
            **kwargs
        )
        self.steps.append(step)
        self.updated_at = time.time()
        return self
    
    def get_current(self) -> Optional[ActionStep]:
        """Get the current step to execute."""
        if 0 <= self.current_index < len(self.steps):
            return self.steps[self.current_index]
        return None
    
    def advance(self) -> Optional[ActionStep]:
        """
        Move to the next step in the chain.
        
        Returns:
            The next step, or None if chain is complete
        """
        current = self.get_current()
        
        # Check if current step triggers interrupt
        if current and current.interrupt:
            self.status = ActionStepStatus.INTERRUPTED
            return None
        
        self.current_index += 1
        self.updated_at = time.time()
        
        if self.current_index >= len(self.steps):
            self.status = ActionStepStatus.COMPLETED
            return None
            
        return self.get_current()
    
    def get_progress(self) -> Dict[str, Any]:
        """
        Get current progress for frontend display.
        
        Returns:
            Dict with progress info including current/total steps
        """
        completed = sum(1 for s in self.steps if s.status == ActionStepStatus.COMPLETED)
        
        return {
            'chain_id': self.chain_id,
            'name': self.name,
            'current_index': self.current_index,
            'total_steps': len(self.steps),
            'completed_steps': completed,
            'status': self.status.value,
            'current_step': self.get_current().to_dict() if self.get_current() else None,
            'progress_text': f'{completed}/{len(self.steps)}',
        }
    
    def mark_interrupted(self, reason: str = 'user_interrupt') -> None:
        """Mark chain as interrupted."""
        self.status = ActionStepStatus.INTERRUPTED
        self.updated_at = time.time()
        current = self.get_current()
        if current:
            current.status = ActionStepStatus.INTERRUPTED
            current.error_message = reason
    
    def to_json(self) -> str:
        """Serialize chain to JSON for Redis storage."""
        return json.dumps(self.to_dict())
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize chain to dictionary."""
        return {
            'chain_id': self.chain_id,
            'name': self.name,
            'steps': [step.to_dict() for step in self.steps],
            'current_index': self.current_index,
            'status': self.status.value,
            'origin_agent_id': self.origin_agent_id,
            'origin_topic_id': self.origin_topic_id,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
        }
    
    @classmethod
    def from_json(cls, json_str: str) -> 'ActionChain':
        """Deserialize chain from JSON string."""
        data = json.loads(json_str)
        return cls.from_dict(data)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ActionChain':
        """Deserialize chain from dictionary."""
        steps = [ActionStep.from_dict(s) for s in data.get('steps', [])]
        return cls(
            chain_id=data.get('chain_id', str(uuid.uuid4())),
            name=data.get('name', ''),
            steps=steps,
            current_index=data.get('current_index', 0),
            status=ActionStepStatus(data.get('status', 'pending')),
            origin_agent_id=data.get('origin_agent_id'),
            origin_topic_id=data.get('origin_topic_id'),
            created_at=data.get('created_at', time.time()),
            updated_at=data.get('updated_at', time.time()),
        )


# =============================================================================
# Redis Persistence Helper
# =============================================================================

class ActionChainStore:
    """
    Redis-based storage for ActionChains.
    
    Provides methods to save, load, and manage ActionChains in Redis
    with automatic TTL handling.
    """
    
    KEY_PREFIX = 'action_chain:'
    INTERRUPT_PREFIX = 'interrupt:'
    
    def __init__(self, redis_client):
        """
        Initialize the store with a Redis client.
        
        Args:
            redis_client: Redis client instance from redis_client.py
        """
        self._redis = redis_client
    
    def save(self, chain: ActionChain) -> bool:
        """
        Save an ActionChain to Redis.
        
        Args:
            chain: ActionChain to save
            
        Returns:
            True if saved successfully
        """
        if not self._redis:
            return False
            
        key = f'{self.KEY_PREFIX}{chain.chain_id}'
        try:
            self._redis.setex(key, chain.REDIS_TTL, chain.to_json())
            return True
        except Exception as e:
            print(f'[ActionChainStore] Failed to save chain {chain.chain_id}: {e}')
            return False
    
    def load(self, chain_id: str) -> Optional[ActionChain]:
        """
        Load an ActionChain from Redis.
        
        Args:
            chain_id: ID of the chain to load
            
        Returns:
            ActionChain if found, None otherwise
        """
        if not self._redis:
            return None
            
        key = f'{self.KEY_PREFIX}{chain_id}'
        try:
            data = self._redis.get(key)
            if data:
                return ActionChain.from_json(data)
            return None
        except Exception as e:
            print(f'[ActionChainStore] Failed to load chain {chain_id}: {e}')
            return None
    
    def delete(self, chain_id: str) -> bool:
        """Delete an ActionChain from Redis."""
        if not self._redis:
            return False
            
        key = f'{self.KEY_PREFIX}{chain_id}'
        try:
            self._redis.delete(key)
            return True
        except Exception as e:
            print(f'[ActionChainStore] Failed to delete chain {chain_id}: {e}')
            return False
    
    def set_interrupt(self, topic_id: str, agent_id: str, ttl: int = 60) -> bool:
        """
        Set interrupt flag for an agent in a topic.
        
        Args:
            topic_id: Topic ID
            agent_id: Agent ID to interrupt
            ttl: Time-to-live for interrupt flag (default 60s)
            
        Returns:
            True if set successfully
        """
        if not self._redis:
            return False
            
        key = f'{self.INTERRUPT_PREFIX}{topic_id}:{agent_id}'
        try:
            self._redis.setex(key, ttl, '1')
            return True
        except Exception as e:
            print(f'[ActionChainStore] Failed to set interrupt: {e}')
            return False
    
    def check_interrupt(self, topic_id: str, agent_id: str) -> bool:
        """
        Check if interrupt flag is set for an agent.
        
        Args:
            topic_id: Topic ID
            agent_id: Agent ID to check
            
        Returns:
            True if interrupt flag is set
        """
        if not self._redis:
            return False
            
        key = f'{self.INTERRUPT_PREFIX}{topic_id}:{agent_id}'
        try:
            return self._redis.get(key) is not None
        except Exception:
            return False
    
    def clear_interrupt(self, topic_id: str, agent_id: str) -> bool:
        """Clear interrupt flag for an agent."""
        if not self._redis:
            return False
            
        key = f'{self.INTERRUPT_PREFIX}{topic_id}:{agent_id}'
        try:
            self._redis.delete(key)
            return True
        except Exception:
            return False


# =============================================================================
# Factory Functions
# =============================================================================

def create_action_step(action_type: AgentActionType, 
                       description: str = '',
                       **kwargs) -> ActionStep:
    """
    Factory function to create an ActionStep.
    
    Args:
        action_type: Type of action
        description: Human-readable description
        **kwargs: Additional fields
        
    Returns:
        Configured ActionStep instance
    """
    return ActionStep(
        action_type=action_type,
        description=description,
        **kwargs
    )


def create_mcp_step(mcp_server_id: str, 
                    mcp_tool_name: str,
                    params: Dict[str, Any] = None,
                    description: str = '') -> ActionStep:
    """
    Factory function to create an MCP tool call step.
    
    Args:
        mcp_server_id: MCP server ID
        mcp_tool_name: Tool name to call
        params: Tool parameters
        description: Human-readable description
        
    Returns:
        ActionStep configured for MCP call
    """
    return ActionStep(
        action_type=AgentActionType.AG_USE_MCP,
        description=description or f'调用 MCP 工具: {mcp_tool_name}',
        params=params or {},
        mcp_server_id=mcp_server_id,
        mcp_tool_name=mcp_tool_name,
    )


def create_call_agent_step(target_agent_id: str,
                           target_topic_id: Optional[str] = None,
                           message: str = '',
                           description: str = '') -> ActionStep:
    """
    Factory function to create an agent handoff step.
    
    Args:
        target_agent_id: Agent ID to hand off to
        target_topic_id: Topic ID where target agent is (optional)
        message: Message to send with handoff
        description: Human-readable description
        
    Returns:
        ActionStep configured for AG_CALL_AG
    """
    return ActionStep(
        action_type=AgentActionType.AG_CALL_AG,
        description=description or f'转交给 Agent: {target_agent_id}',
        params={'message': message},
        target_agent_id=target_agent_id,
        target_topic_id=target_topic_id,
    )


# =============================================================================
# Response Decision (from legacy actions.py)
# =============================================================================

class ResponseAction(str, Enum):
    """响应决策动作"""
    REPLY = 'reply'       # 回复
    SILENT = 'silent'     # 沉默
    DELEGATE = 'delegate' # 委托给其他 Agent
    DEFER = 'defer'       # 延迟处理


@dataclass
class ResponseDecision:
    """
    响应决策
    
    _should_respond 方法的返回值，决定 Agent 如何响应消息
    """
    
    # 决策动作
    action: str = 'reply'  # 'reply', 'silent', 'delegate', 'defer'
    
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


# =============================================================================
# Action Result (from legacy actions.py)
# =============================================================================

@dataclass
class ActionResult:
    """
    行动执行结果
    
    统一的执行结果结构，用于 ActionStep 和旧版 Action
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
    
    # 原始 ActionStep（用于追溯）
    step: Optional[ActionStep] = None
    
    # 工具名称（便于显示）
    tool_name: Optional[str] = None
    
    # 兼容旧调用：thinking / process_steps 曾作为直接参数传入，现保留为可选字段避免 init 报错
    thinking: Optional[str] = None
    process_steps: Any = None
    
    def __post_init__(self):
        """初始化后处理"""
        # 从 step 提取 tool_name
        if self.step and not self.tool_name:
            if self.step.action_type == AgentActionType.AG_USE_MCP:
                self.tool_name = f"{self.step.mcp_server_id}:{self.step.mcp_tool_name}"
            elif self.step.target_agent_id:
                self.tool_name = f"@{self.step.target_agent_id}"
        # 兼容：若通过 thinking/process_steps 传入，同步到 metadata 便于下游使用
        if self.thinking is not None and "thinking" not in self.metadata:
            self.metadata = dict(self.metadata)
            self.metadata["thinking"] = self.thinking
        if self.process_steps is not None and "process_steps" not in self.metadata:
            self.metadata = dict(self.metadata)
            self.metadata["process_steps"] = self.process_steps
    
    @classmethod
    def success_result(
        cls,
        action_type: str,
        data: Any = None,
        text_result: str = "",
        duration_ms: int = 0,
        step: ActionStep = None,
    ) -> 'ActionResult':
        """创建成功结果"""
        return cls(
            action_type=action_type,
            success=True,
            data=data,
            text_result=text_result,
            duration_ms=duration_ms,
            step=step,
        )
    
    @classmethod
    def error_result(
        cls,
        action_type: str,
        error: str,
        error_code: str = None,
        duration_ms: int = 0,
        step: ActionStep = None,
    ) -> 'ActionResult':
        """创建失败结果"""
        return cls(
            action_type=action_type,
            success=False,
            error=error,
            error_code=error_code,
            duration_ms=duration_ms,
            step=step,
        )
    
    def to_step_dict(self) -> Dict[str, Any]:
        """转换为 processStep 格式"""
        step_dict = {
            'type': f"{self.action_type}_result",
            'timestamp': self.timestamp,
            'status': 'completed' if self.success else 'error',
            'duration': self.duration_ms,
        }
        
        if self.tool_name:
            step_dict['tool'] = self.tool_name
        
        if self.error:
            step_dict['error'] = self.error
        
        if self.text_result:
            # 截断长文本
            result = self.text_result
            if len(result) > 500:
                result = result[:500] + '...'
            step_dict['result'] = result
        
        return step_dict
