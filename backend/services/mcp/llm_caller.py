"""
LLM 调用包装器

提供统一的 LLM 调用接口，支持普通聊天和 Tool Calling。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from services.providers.factory import create_provider
from services.providers.base import LLMMessage, LLMResponse


@dataclass
class LLMCallResult:
    """LLM 调用结果"""
    success: bool
    content: str = ""
    tool_calls: Optional[List[Dict[str, Any]]] = None
    finish_reason: Optional[str] = None
    error: Optional[str] = None


class LLMCaller:
    """
    LLM 调用器
    
    封装 Provider SDK 调用，提供简洁的接口。
    
    Example:
        caller = LLMCaller(llm_config)
        result = caller.chat(system_prompt, user_input)
        result = caller.chat_with_tools(messages, tools)
    """
    
    def __init__(self, config: Dict[str, Any], log_func: Optional[Callable] = None):
        """
        Args:
            config: LLM 配置（包含 provider, api_key, model 等）
            log_func: 日志函数（可选）
        """
        self._config = config
        self._log = log_func or (lambda x: None)
        
        self._provider = config.get('provider', '')
        self._api_key = config.get('api_key', '')
        self._api_url = config.get('api_url')
        self._model = config.get('model', '')
    
    def _validate_config(self) -> Optional[str]:
        """验证配置，返回错误信息或 None"""
        if not self._provider:
            return "缺少 provider"
        if not self._api_key:
            return "缺少 api_key"
        if not self._model:
            return "缺少 model"
        return None
    
    def _create_provider(self):
        """创建 Provider 实例"""
        return create_provider(
            provider_type=self._provider,
            api_key=self._api_key,
            api_url=self._api_url,
            model=self._model,
        )
    
    def chat(
        self,
        system_prompt: str,
        user_input: str,
        temperature: float = 0.1,
        max_tokens: int = 8192,
    ) -> LLMCallResult:
        """
        普通聊天调用
        
        Args:
            system_prompt: 系统提示词
            user_input: 用户输入
            temperature: 温度参数
            max_tokens: 最大 token 数
            
        Returns:
            LLMCallResult
        """
        error = self._validate_config()
        if error:
            self._log(f"❌ {error}")
            return LLMCallResult(success=False, error=error)
        
        try:
            provider = self._create_provider()
            
            messages = [
                LLMMessage(role='system', content=system_prompt),
                LLMMessage(role='user', content=user_input),
            ]
            
            self._log(f"🔄 调用 {self._provider}/{self._model}")
            response = provider.chat(
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            
            self._log(f"✅ 返回 {len(response.content or '')} 字符")
            
            return LLMCallResult(
                success=True,
                content=response.content or "",
                finish_reason=response.finish_reason,
            )
            
        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}"
            self._log(f"❌ {error_msg}")
            return LLMCallResult(success=False, error=error_msg)
    
    def chat_with_tools(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        tool_choice: str = "auto",
        temperature: float = 0.1,
        max_tokens: int = 4096,
    ) -> LLMCallResult:
        """
        Tool Calling 调用
        
        Args:
            messages: 消息列表（OpenAI 格式）
            tools: 工具列表（OpenAI function calling 格式）
            tool_choice: 工具选择策略
            temperature: 温度参数
            max_tokens: 最大 token 数
            
        Returns:
            LLMCallResult
        """
        error = self._validate_config()
        if error:
            self._log(f"❌ {error}")
            return LLMCallResult(success=False, error=error)
        
        try:
            provider = self._create_provider()
            
            # 转换消息格式
            llm_messages = [
                LLMMessage(
                    role=msg.get('role', 'user'),
                    content=msg.get('content', ''),
                    tool_calls=msg.get('tool_calls'),
                    tool_call_id=msg.get('tool_call_id'),
                    name=msg.get('name'),
                )
                for msg in messages
            ]
            
            self._log(f"🔧 Tool Calling: {len(tools)} 工具")
            response = provider.chat(
                llm_messages,
                tools=tools,
                tool_choice=tool_choice,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            
            tool_count = len(response.tool_calls or [])
            self._log(f"✅ {tool_count} 个工具调用")
            
            return LLMCallResult(
                success=True,
                content=response.content or "",
                tool_calls=response.tool_calls,
                finish_reason=response.finish_reason,
            )
            
        except Exception as e:
            error_msg = f"{type(e).__name__}: {e}"
            self._log(f"❌ {error_msg}")
            return LLMCallResult(success=False, error=error_msg)


# ==================== 便捷函数（向后兼容） ====================

def call_llm_api(
    llm_config: Dict[str, Any],
    system_prompt: str,
    user_input: str,
    add_log: Optional[Callable] = None,
) -> Optional[str]:
    """
    调用 LLM API（向后兼容接口）
    
    Args:
        llm_config: LLM 配置
        system_prompt: 系统提示词
        user_input: 用户输入
        add_log: 日志函数
        
    Returns:
        响应内容或 None
    """
    caller = LLMCaller(llm_config, add_log)
    result = caller.chat(system_prompt, user_input)
    return result.content if result.success else None


def call_llm_with_tools(
    llm_config: Dict[str, Any],
    messages: List[Dict[str, Any]],
    tools: List[Dict[str, Any]],
    add_log: Optional[Callable] = None,
) -> Optional[Dict[str, Any]]:
    """
    使用原生 Tool Calling 调用 LLM（向后兼容接口）
    
    Args:
        llm_config: LLM 配置
        messages: 消息列表
        tools: 工具列表
        add_log: 日志函数
        
    Returns:
        {'content', 'tool_calls', 'finish_reason'} 或 None
    """
    caller = LLMCaller(llm_config, add_log)
    result = caller.chat_with_tools(messages, tools)
    
    if not result.success:
        return None
    
    return {
        'content': result.content,
        'tool_calls': result.tool_calls or [],
        'finish_reason': result.finish_reason,
    }
