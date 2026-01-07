"""
Anthropic Provider

支持 Claude 模型
优先使用 anthropic SDK，回退到 REST API
"""

from typing import List, Optional, Dict, Any, Generator
import json
import requests

from .base import BaseLLMProvider, LLMMessage, LLMResponse


class AnthropicProvider(BaseLLMProvider):
    """Anthropic (Claude) Provider"""
    
    provider_type = "anthropic"
    sdk_available = False
    
    def __init__(self, api_key: str, api_url: Optional[str] = None,
                 model: Optional[str] = None, **kwargs):
        self._client = None
        super().__init__(api_key, api_url, model, **kwargs)
    
    def _init_sdk(self):
        """初始化 Anthropic SDK"""
        try:
            from anthropic import Anthropic
            
            self._client = Anthropic(
                api_key=self.api_key,
                base_url=self.api_url if self.api_url else None
            )
            self.sdk_available = True
            self._log("SDK initialized")
        except ImportError:
            self._log("anthropic SDK not installed, using REST API")
            self.sdk_available = False
        except Exception as e:
            self._log_error(f"Failed to initialize SDK: {e}")
            self.sdk_available = False
    
    def chat(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """非流式聊天"""
        if self.sdk_available and self._client:
            return self._chat_sdk(messages, **kwargs)
        return self._chat_rest(messages, **kwargs)
    
    def chat_stream(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """流式聊天"""
        if self.sdk_available and self._client:
            yield from self._chat_stream_sdk(messages, **kwargs)
        else:
            yield from self._chat_stream_rest(messages, **kwargs)
    
    def _chat_sdk(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """使用 SDK 的非流式聊天"""
        try:
            system_msg, user_msgs = self._split_messages(messages)
            
            create_params = {
                'model': self.model or 'claude-3-5-sonnet-20241022',
                'messages': user_msgs,
                'max_tokens': kwargs.get('max_tokens', 4096),
            }
            if system_msg:
                create_params['system'] = system_msg
            
            response = self._client.messages.create(**create_params)
            
            content = ""
            for block in response.content:
                if hasattr(block, 'text'):
                    content += block.text
            
            return LLMResponse(
                content=content,
                finish_reason=response.stop_reason,
                usage={
                    'prompt_tokens': response.usage.input_tokens if response.usage else 0,
                    'completion_tokens': response.usage.output_tokens if response.usage else 0,
                } if response.usage else None,
                raw=response.model_dump()
            )
        except Exception as e:
            self._log_error(f"SDK chat error: {e}", e)
            raise RuntimeError(f"Anthropic API error: {str(e)}")
    
    def _chat_stream_sdk(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """使用 SDK 的流式聊天"""
        try:
            system_msg, user_msgs = self._split_messages(messages)
            
            create_params = {
                'model': self.model or 'claude-3-5-sonnet-20241022',
                'messages': user_msgs,
                'max_tokens': kwargs.get('max_tokens', 4096),
            }
            if system_msg:
                create_params['system'] = system_msg
            
            full_content = ""
            finish_reason = None
            
            with self._client.messages.stream(**create_params) as stream:
                for text in stream.text_stream:
                    full_content += text
                    yield text
                
                # 获取最终响应
                final_message = stream.get_final_message()
                if final_message:
                    finish_reason = final_message.stop_reason
            
            return LLMResponse(
                content=full_content,
                finish_reason=finish_reason
            )
        except Exception as e:
            self._log_error(f"SDK stream error: {e}", e)
            raise RuntimeError(f"Anthropic API error: {str(e)}")
    
    def _chat_rest(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """使用 REST API 的非流式聊天"""
        url = self.api_url or 'https://api.anthropic.com/v1/messages'
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': self.api_key,
            'anthropic-version': '2023-06-01'
        }
        
        system_msg, user_msgs = self._split_messages(messages)
        
        payload = {
            'model': self.model or 'claude-3-5-sonnet-20241022',
            'messages': user_msgs,
            'max_tokens': kwargs.get('max_tokens', 4096),
        }
        if system_msg:
            payload['system'] = system_msg
        
        response = requests.post(url, headers=headers, json=payload, timeout=120)
        
        if response.status_code != 200:
            raise RuntimeError(f"Anthropic API error: {response.text}")
        
        data = response.json()
        content = data['content'][0]['text'] if data.get('content') else ''
        
        return LLMResponse(
            content=content,
            finish_reason=data.get('stop_reason'),
            raw=data
        )
    
    def _chat_stream_rest(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """使用 REST API 的流式聊天"""
        url = self.api_url or 'https://api.anthropic.com/v1/messages'
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': self.api_key,
            'anthropic-version': '2023-06-01'
        }
        
        system_msg, user_msgs = self._split_messages(messages)
        
        payload = {
            'model': self.model or 'claude-3-5-sonnet-20241022',
            'messages': user_msgs,
            'max_tokens': kwargs.get('max_tokens', 4096),
            'stream': True,
        }
        if system_msg:
            payload['system'] = system_msg
        
        response = requests.post(url, headers=headers, json=payload, stream=True, timeout=120)
        
        if response.status_code != 200:
            raise RuntimeError(f"Anthropic API error: {response.text}")
        
        full_content = ""
        finish_reason = None
        
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    try:
                        data = json.loads(line[6:])
                        if data.get('type') == 'content_block_delta':
                            delta = data.get('delta', {})
                            if delta.get('type') == 'text_delta':
                                text = delta.get('text', '')
                                full_content += text
                                yield text
                        elif data.get('type') == 'message_delta':
                            finish_reason = data.get('delta', {}).get('stop_reason')
                    except json.JSONDecodeError:
                        continue
        
        return LLMResponse(
            content=full_content,
            finish_reason=finish_reason
        )
    
    def _split_messages(self, messages: List[LLMMessage]) -> tuple:
        """分离 system 消息和用户消息"""
        system_msg = None
        user_msgs = []
        
        for msg in messages:
            if msg.role == 'system':
                system_msg = msg.content
            else:
                user_msgs.append({
                    'role': msg.role,
                    'content': msg.content
                })
        
        return system_msg, user_msgs
    
    def models(self) -> List[str]:
        """
        获取可用模型列表
        优先使用 SDK，回退到 REST API
        """
        try:
            # 优先使用 SDK
            if self.sdk_available and self._client:
                try:
                    # Anthropic SDK 可能没有直接的 models.list() 方法
                    # 尝试使用 REST API
                    pass
                except Exception as e:
                    self._log(f"SDK models() not available: {e}, using REST API")
            
            # 使用 REST API
            base_url = self.api_url or 'https://api.anthropic.com'
            if not base_url.endswith('/v1'):
                if base_url.endswith('/v1/'):
                    base_url = base_url.rstrip('/')
                else:
                    base_url = f"{base_url}/v1"
            
            models_url = f"{base_url}/models"
            headers = {
                'x-api-key': self.api_key,
                'anthropic-version': '2023-06-01'
            }
            
            self._log(f"Fetching models via REST API: {models_url}")
            response = requests.get(models_url, headers=headers, timeout=10)
            
            if response.status_code != 200:
                raise RuntimeError(f"Failed to fetch models: {response.status_code} {response.text}")
            
            data = response.json()
            # Anthropic 返回格式：{ data: [{ id: "...", ... }] }
            if isinstance(data, dict) and isinstance(data.get('data'), list):
                model_ids = [model.get('id') for model in data['data'] if model.get('id')]
                self._log(f"Fetched {len(model_ids)} models via REST API")
                return model_ids
            
            # 兼容其他格式
            if isinstance(data, list):
                model_ids = [item.get('id') if isinstance(item, dict) else item for item in data if item]
                self._log(f"Fetched {len(model_ids)} models via REST API (array format)")
                return model_ids
            
            raise RuntimeError("Invalid response format from models API")
            
        except Exception as e:
            self._log_error(f"Failed to fetch models: {e}", e)
            raise