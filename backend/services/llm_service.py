"""
LLM 服务层
处理 LLM 配置相关的业务逻辑
"""

from typing import List, Optional, Dict, Any
import uuid
import requests
import json

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

    def chat_completion(self, config_id: str, messages: List[dict], stream: bool = False) -> dict:
        """
        执行聊天补全
        
        Args:
            config_id: 配置 ID
            messages: 消息列表
            stream: 是否使用流式
            
        Returns:
            响应内容
        """
        config = self.get_config(config_id, include_api_key=True)
        if not config:
            raise ValueError(f"LLM config not found: {config_id}")
            
        provider = config['provider']
        api_key = config['api_key']
        api_url = config.get('api_url') or ''
        model_name = config.get('model')
        
        if provider == 'openai':
            default_url = 'https://api.openai.com/v1/chat/completions'
            if not api_url:
                api_url = default_url
            elif '/chat/completions' not in api_url:
                base_url = api_url.rstrip('/')
                if base_url.endswith('/v1'):
                    api_url = f"{base_url}/chat/completions"
                else:
                    api_url = f"{base_url}/v1/chat/completions"
            
            response = requests.post(
                api_url,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_key}',
                },
                json={
                    'model': model_name,
                    'messages': messages,
                    'stream': stream,
                },
                timeout=60
            )
            
            if response.status_code != 200:
                raise RuntimeError(f"OpenAI API error: {response.text}")
                
            data = response.json()
            return {
                'content': data['choices'][0]['message']['content'],
                'raw': data
            }
            
        elif provider == 'ollama':
            # Ollama 默认地址
            if not api_url:
                api_url = 'http://localhost:11434/api/chat'
            elif not api_url.endswith('/api/chat'):
                api_url = f"{api_url.rstrip('/')}/api/chat"
                
            response = requests.post(
                api_url,
                json={
                    'model': model_name,
                    'messages': messages,
                    'stream': False, # 暂时只支持非流式
                },
                timeout=60
            )
            
            if response.status_code != 200:
                raise RuntimeError(f"Ollama API error: {response.text}")
                
            data = response.json()
            return {
                'content': data['message']['content'],
                'raw': data
            }
        elif provider == 'anthropic':
            # Anthropic API
            target_url = api_url or 'https://api.anthropic.com/v1/messages'
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01'
            }
            
            # 转换消息格式
            system_msg = next((m['content'] for m in messages if m['role'] == 'system'), None)
            user_msgs = [m for m in messages if m['role'] != 'system']
            
            payload = {
                'model': model_name,
                'messages': user_msgs,
                'max_tokens': 4096,
            }
            if system_msg:
                payload['system'] = system_msg
                
            response = requests.post(target_url, headers=headers, json=payload, timeout=60)
            if response.status_code != 200:
                raise RuntimeError(f"Anthropic API error: {response.text}")
                
            data = response.json()
            return {
                'content': data['content'][0]['text'],
                'raw': data
            }
        elif provider in ('google', 'gemini'):
            # Gemini API
            api_key_param = f"?key={api_key}"
            target_url = api_url or f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent{api_key_param}"
            if api_key and 'key=' not in target_url:
                target_url += api_key_param
                
            # 转换消息格式
            contents = []
            system_instruction = None
            for m in messages:
                if m['role'] == 'system':
                    system_instruction = {'parts': [{'text': m['content']}]}
                else:
                    role = 'user' if m['role'] == 'user' else 'model'
                    contents.append({'role': role, 'parts': [{'text': m['content']}]})
            
            payload = {'contents': contents}
            if system_instruction:
                payload['system_instruction'] = system_instruction
                
            response = requests.post(target_url, json=payload, timeout=60)
            if response.status_code != 200:
                raise RuntimeError(f"Google API error: {response.text}")
                
            data = response.json()
            return {
                'content': data['candidates'][0]['content']['parts'][0]['text'],
                'raw': data
            }
        else:
            raise NotImplementedError(f"Provider {provider} not supported for backend chat yet")


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
