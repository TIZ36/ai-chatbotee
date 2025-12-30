"""
LLM Provider 模块

统一的 LLM 调用接口，优先使用官方 SDK，回退到 REST API。

支持的 Provider：
- OpenAI (openai SDK)
- Anthropic (anthropic SDK)
- Google Gemini (google-genai SDK)
- Ollama (ollama SDK)
- DeepSeek (使用 OpenAI 兼容 API)
"""

from .base import BaseLLMProvider, LLMResponse, LLMMessage
from .factory import get_provider, create_provider

__all__ = [
    'BaseLLMProvider',
    'LLMResponse',
    'LLMMessage',
    'get_provider',
    'create_provider',
]
