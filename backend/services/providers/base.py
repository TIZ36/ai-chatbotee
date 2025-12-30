"""
LLM Provider 基类

定义统一的接口和数据结构
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Generator
import traceback


@dataclass
class LLMMessage:
    """统一的消息格式"""
    role: str  # system, user, assistant, tool
    content: str
    media: Optional[List[Dict[str, Any]]] = None  # 多模态内容
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None


@dataclass
class LLMResponse:
    """统一的响应格式"""
    content: str
    thinking: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    finish_reason: Optional[str] = None
    media: Optional[List[Dict[str, Any]]] = None  # 响应中的媒体（如生成的图片）
    usage: Optional[Dict[str, int]] = None
    raw: Optional[Dict[str, Any]] = None


class BaseLLMProvider(ABC):
    """LLM Provider 基类"""
    
    # Provider 类型标识
    provider_type: str = "base"
    
    # 是否有可用的 SDK
    sdk_available: bool = False
    
    def __init__(self, api_key: str, api_url: Optional[str] = None, 
                 model: Optional[str] = None, **kwargs):
        """
        初始化 Provider
        
        Args:
            api_key: API 密钥
            api_url: 自定义 API 地址（可选）
            model: 模型名称
            **kwargs: 其他配置参数
        """
        self.api_key = api_key
        self.api_url = api_url
        self.model = model
        self.config = kwargs
        
        # 尝试初始化 SDK
        self._init_sdk()
    
    def _init_sdk(self):
        """初始化 SDK（子类实现）"""
        pass
    
    @abstractmethod
    def chat(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """
        非流式聊天
        
        Args:
            messages: 消息列表
            **kwargs: 其他参数
            
        Returns:
            LLMResponse
        """
        pass
    
    @abstractmethod
    def chat_stream(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """
        流式聊天
        
        Args:
            messages: 消息列表
            **kwargs: 其他参数
            
        Yields:
            流式文本 chunk
            
        Returns:
            最终的 LLMResponse
        """
        pass
    
    def _convert_messages(self, messages: List[LLMMessage]) -> List[Dict[str, Any]]:
        """
        转换消息格式为 Provider 特定格式
        
        默认实现返回标准格式，子类可覆盖
        """
        return [
            {
                'role': msg.role,
                'content': msg.content,
                **(({'media': msg.media} if msg.media else {})),
                **(({'tool_calls': msg.tool_calls} if msg.tool_calls else {})),
                **(({'tool_call_id': msg.tool_call_id} if msg.tool_call_id else {})),
                **(({'name': msg.name} if msg.name else {})),
            }
            for msg in messages
        ]
    
    def _log(self, message: str, level: str = "info"):
        """日志输出"""
        prefix = f"[{self.provider_type.upper()}Provider]"
        print(f"{prefix} {message}")
    
    def _log_error(self, message: str, exc: Optional[Exception] = None):
        """错误日志"""
        self._log(f"ERROR: {message}", "error")
        if exc:
            traceback.print_exc()
