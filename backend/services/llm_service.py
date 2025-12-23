"""
LLM 服务层
处理 LLM 配置相关的业务逻辑
"""

from typing import List, Optional, Dict, Any
import uuid

from models.llm_config import LLMConfig, LLMConfigRepository


class LLMService:
    """LLM 服务"""
    
    def __init__(self, get_connection):
        """
        Args:
            get_connection: 获取数据库连接的函数
        """
        self.repository = LLMConfigRepository(get_connection)
    
    def get_all_configs(self, enabled_only: bool = False, 
                        include_api_key: bool = False) -> List[dict]:
        """
        获取所有 LLM 配置
        
        Args:
            enabled_only: 是否只返回启用的配置
            include_api_key: 是否包含 API Key
        """
        configs = self.repository.find_all(enabled_only=enabled_only)
        return [config.to_dict(include_api_key=include_api_key) for config in configs]
    
    def get_config(self, config_id: str, include_api_key: bool = False) -> Optional[dict]:
        """
        获取单个配置
        
        Args:
            config_id: 配置 ID
            include_api_key: 是否包含 API Key
        """
        config = self.repository.find_by_id(config_id)
        if config:
            return config.to_dict(include_api_key=include_api_key)
        return None
    
    def get_api_key(self, config_id: str) -> Optional[str]:
        """
        获取配置的 API Key（安全接口）
        
        Args:
            config_id: 配置 ID
        """
        config = self.repository.find_by_id(config_id)
        if config:
            return config.api_key
        return None
    
    def create_config(self, data: dict) -> dict:
        """
        创建 LLM 配置
        
        Args:
            data: 配置数据
        
        Returns:
            创建的配置
        
        Raises:
            ValueError: 如果数据无效
        """
        # 验证必填字段
        if not data.get('name'):
            raise ValueError('Name is required')
        if not data.get('provider'):
            raise ValueError('Provider is required')
        
        # 生成 ID
        config_id = data.get('config_id') or f"llm_{uuid.uuid4().hex[:8]}"
        
        config = LLMConfig(
            config_id=config_id,
            name=data['name'],
            provider=data['provider'],
            api_key=data.get('api_key'),
            api_url=data.get('api_url'),
            model=data.get('model'),
            tags=data.get('tags'),
            enabled=data.get('enabled', True),
            description=data.get('description'),
            metadata=data.get('metadata'),
        )
        
        if self.repository.save(config):
            return config.to_dict(include_api_key=False)
        raise RuntimeError('Failed to save config')
    
    def update_config(self, config_id: str, data: dict) -> Optional[dict]:
        """
        更新 LLM 配置
        
        Args:
            config_id: 配置 ID
            data: 更新数据
        
        Returns:
            更新后的配置，如果不存在返回 None
        """
        existing = self.repository.find_by_id(config_id)
        if not existing:
            return None
        
        # 更新字段
        if 'name' in data:
            existing.name = data['name']
        if 'provider' in data:
            existing.provider = data['provider']
        if 'api_key' in data:
            existing.api_key = data['api_key']
        if 'api_url' in data:
            existing.api_url = data['api_url']
        if 'model' in data:
            existing.model = data['model']
        if 'tags' in data:
            existing.tags = data['tags']
        if 'enabled' in data:
            existing.enabled = data['enabled']
        if 'description' in data:
            existing.description = data['description']
        if 'metadata' in data:
            existing.metadata = data['metadata']
        
        if self.repository.save(existing):
            return existing.to_dict(include_api_key=False)
        return None
    
    def delete_config(self, config_id: str) -> bool:
        """
        删除 LLM 配置
        
        Args:
            config_id: 配置 ID
        
        Returns:
            是否删除成功
        """
        return self.repository.delete(config_id)
    
    def toggle_enabled(self, config_id: str, enabled: bool) -> Optional[dict]:
        """
        切换配置启用状态
        
        Args:
            config_id: 配置 ID
            enabled: 是否启用
        
        Returns:
            更新后的配置
        """
        return self.update_config(config_id, {'enabled': enabled})


# 全局服务实例（延迟初始化）
llm_service: Optional[LLMService] = None


def init_llm_service(get_connection):
    """初始化 LLM 服务"""
    global llm_service
    llm_service = LLMService(get_connection)
    return llm_service


def get_llm_service() -> LLMService:
    """获取 LLM 服务实例"""
    if llm_service is None:
        raise RuntimeError('LLM service not initialized')
    return llm_service
