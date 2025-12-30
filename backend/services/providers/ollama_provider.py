"""
Ollama Provider

支持本地 Ollama 模型
优先使用 ollama SDK，回退到 REST API
"""

from typing import List, Optional, Dict, Any, Generator
import json
import requests

from .base import BaseLLMProvider, LLMMessage, LLMResponse


class OllamaProvider(BaseLLMProvider):
    """Ollama Provider"""
    
    provider_type = "ollama"
    sdk_available = False
    
    def __init__(self, api_key: str = None, api_url: Optional[str] = None,
                 model: Optional[str] = None, **kwargs):
        self._client = None
        # Ollama 不需要 API key
        super().__init__(api_key or '', api_url, model, **kwargs)
    
    def _init_sdk(self):
        """初始化 Ollama SDK"""
        try:
            import ollama
            
            # 设置自定义 host
            if self.api_url:
                # 从 URL 提取 host
                host = self.api_url.replace('/api/chat', '').replace('/api', '').rstrip('/')
                self._client = ollama.Client(host=host)
            else:
                self._client = ollama.Client()
            
            self.sdk_available = True
            self._log(f"SDK initialized (host: {self.api_url or 'default'})")
        except ImportError:
            self._log("ollama SDK not installed, using REST API")
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
            msg_list = self._convert_messages_for_ollama(messages)
            
            response = self._client.chat(
                model=self.model or 'llama3',
                messages=msg_list,
                stream=False
            )
            
            return LLMResponse(
                content=response['message']['content'],
                finish_reason='stop',
                raw=response
            )
        except Exception as e:
            self._log_error(f"SDK chat error: {e}", e)
            raise RuntimeError(f"Ollama API error: {str(e)}")
    
    def _chat_stream_sdk(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """使用 SDK 的流式聊天"""
        try:
            msg_list = self._convert_messages_for_ollama(messages)
            
            stream = self._client.chat(
                model=self.model or 'llama3',
                messages=msg_list,
                stream=True
            )
            
            full_content = ""
            
            for chunk in stream:
                if chunk.get('message', {}).get('content'):
                    text = chunk['message']['content']
                    full_content += text
                    yield text
            
            return LLMResponse(
                content=full_content,
                finish_reason='stop'
            )
        except Exception as e:
            self._log_error(f"SDK stream error: {e}", e)
            raise RuntimeError(f"Ollama API error: {str(e)}")
    
    def _chat_rest(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """使用 REST API 的非流式聊天"""
        url = self._get_api_url()
        
        payload = {
            'model': self.model or 'llama3',
            'messages': self._convert_messages_for_ollama(messages),
            'stream': False
        }
        
        response = requests.post(url, json=payload, timeout=120)
        
        if response.status_code != 200:
            raise RuntimeError(f"Ollama API error: {response.text}")
        
        data = response.json()
        
        return LLMResponse(
            content=data['message']['content'],
            finish_reason='stop',
            raw=data
        )
    
    def _chat_stream_rest(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """使用 REST API 的流式聊天"""
        url = self._get_api_url()
        
        payload = {
            'model': self.model or 'llama3',
            'messages': self._convert_messages_for_ollama(messages),
            'stream': True
        }
        
        response = requests.post(url, json=payload, stream=True, timeout=120)
        
        if response.status_code != 200:
            raise RuntimeError(f"Ollama API error: {response.text}")
        
        full_content = ""
        
        for line in response.iter_lines():
            if line:
                try:
                    chunk = json.loads(line)
                    if chunk.get('message', {}).get('content'):
                        text = chunk['message']['content']
                        full_content += text
                        yield text
                except json.JSONDecodeError:
                    continue
        
        return LLMResponse(
            content=full_content,
            finish_reason='stop'
        )
    
    def _get_api_url(self) -> str:
        """获取 API URL"""
        if not self.api_url:
            return 'http://localhost:11434/api/chat'
        
        if not self.api_url.endswith('/api/chat'):
            return f"{self.api_url.rstrip('/')}/api/chat"
        
        return self.api_url
    
    def _convert_messages_for_ollama(self, messages: List[LLMMessage]) -> List[Dict[str, Any]]:
        """转换消息格式为 Ollama 格式"""
        result = []
        for msg in messages:
            item = {
                'role': msg.role,
                'content': msg.content
            }
            
            # Ollama 支持图片（通过 images 字段）
            if msg.media:
                images = []
                for media_item in msg.media:
                    if isinstance(media_item, dict):
                        data = media_item.get('data', '')
                        if data:
                            # 移除 base64 前缀
                            if data.startswith('data:'):
                                if ';base64,' in data:
                                    data = data.split(';base64,', 1)[1]
                            images.append(data)
                if images:
                    item['images'] = images
            
            result.append(item)
        
        return result
