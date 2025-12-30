"""
Provider 工厂

创建和管理 LLM Provider 实例
"""

from typing import Optional, Dict, Type

from .base import BaseLLMProvider, LLMMessage, LLMResponse
from .openai_provider import OpenAIProvider, DeepSeekProvider
from .anthropic_provider import AnthropicProvider
from .google_provider import GoogleProvider
from .ollama_provider import OllamaProvider


# Provider 注册表
PROVIDER_REGISTRY: Dict[str, Type[BaseLLMProvider]] = {
    'openai': OpenAIProvider,
    'anthropic': AnthropicProvider,
    'claude': AnthropicProvider,  # 别名
    'google': GoogleProvider,
    'gemini': GoogleProvider,  # 别名
    'ollama': OllamaProvider,
    'local': OllamaProvider,  # 别名
    'deepseek': DeepSeekProvider,
}


def get_provider(provider_type: str) -> Optional[Type[BaseLLMProvider]]:
    """
    获取 Provider 类
    
    Args:
        provider_type: Provider 类型
        
    Returns:
        Provider 类，如果不存在返回 None
    """
    return PROVIDER_REGISTRY.get(provider_type.lower())


def create_provider(
    provider_type: str,
    api_key: str,
    api_url: Optional[str] = None,
    model: Optional[str] = None,
    **kwargs
) -> BaseLLMProvider:
    """
    创建 Provider 实例
    
    Args:
        provider_type: Provider 类型
        api_key: API 密钥
        api_url: 自定义 API 地址
        model: 模型名称
        **kwargs: 其他配置
        
    Returns:
        Provider 实例
        
    Raises:
        ValueError: 如果 provider_type 不支持
    """
    provider_class = get_provider(provider_type)
    
    if not provider_class:
        raise ValueError(f"Unsupported provider type: {provider_type}")
    
    return provider_class(
        api_key=api_key,
        api_url=api_url,
        model=model,
        **kwargs
    )


def list_providers() -> list:
    """
    列出所有支持的 Provider
    
    Returns:
        Provider 类型列表
    """
    # 返回去重后的列表
    unique_providers = set()
    for name, cls in PROVIDER_REGISTRY.items():
        unique_providers.add((name, cls.provider_type))
    
    return [
        {
            'name': name,
            'type': ptype,
            'class': PROVIDER_REGISTRY[name].__name__
        }
        for name, ptype in sorted(unique_providers)
    ]


def register_provider(name: str, provider_class: Type[BaseLLMProvider]):
    """
    注册自定义 Provider
    
    Args:
        name: Provider 名称
        provider_class: Provider 类
    """
    PROVIDER_REGISTRY[name.lower()] = provider_class
