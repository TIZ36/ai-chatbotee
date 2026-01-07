"""
OpenAI Provider

支持 OpenAI API 和兼容 API（如 DeepSeek）
优先使用 openai SDK，回退到 REST API
"""

from typing import List, Optional, Dict, Any, Generator
import json
import requests

from .base import BaseLLMProvider, LLMMessage, LLMResponse


class OpenAIProvider(BaseLLMProvider):
    """OpenAI Provider"""
    
    provider_type = "openai"
    sdk_available = False
    
    def __init__(self, api_key: str, api_url: Optional[str] = None,
                 model: Optional[str] = None, **kwargs):
        self._client = None
        super().__init__(api_key, api_url, model, **kwargs)
    
    def _init_sdk(self):
        """初始化 OpenAI SDK"""
        try:
            from openai import OpenAI
            
            # 构建 base_url
            base_url = None
            if self.api_url:
                # 移除 /chat/completions 后缀
                base_url = self.api_url.replace('/chat/completions', '').rstrip('/')
                # 确保以 /v1 结尾（OpenAI SDK 需要）
                if not base_url.endswith('/v1'):
                    # 如果已经以 /v1/ 结尾，移除多余的斜杠
                    if base_url.endswith('/v1/'):
                        base_url = base_url.rstrip('/')
                    else:
                        base_url = f"{base_url}/v1"
            
            self._client = OpenAI(
                api_key=self.api_key,
                base_url=base_url
            )
            self.sdk_available = True
            self._log(f"SDK initialized (base_url: {base_url or 'default'})")
        except ImportError:
            self._log("openai SDK not installed, using REST API")
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
            msg_list = self._convert_messages_for_openai(messages)
            
            response = self._client.chat.completions.create(
                model=self.model or 'gpt-4',
                messages=msg_list,
                **kwargs
            )
            
            choice = response.choices[0]
            return LLMResponse(
                content=choice.message.content or '',
                finish_reason=choice.finish_reason,
                tool_calls=self._parse_tool_calls(choice.message.tool_calls) if choice.message.tool_calls else None,
                usage={
                    'prompt_tokens': response.usage.prompt_tokens if response.usage else 0,
                    'completion_tokens': response.usage.completion_tokens if response.usage else 0,
                    'total_tokens': response.usage.total_tokens if response.usage else 0,
                } if response.usage else None,
                raw=response.model_dump()
            )
        except Exception as e:
            self._log_error(f"SDK chat error: {e}", e)
            raise RuntimeError(f"OpenAI API error: {str(e)}")
    
    def _chat_stream_sdk(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """使用 SDK 的流式聊天"""
        try:
            msg_list = self._convert_messages_for_openai(messages)
            
            stream = self._client.chat.completions.create(
                model=self.model or 'gpt-4',
                messages=msg_list,
                stream=True,
                **kwargs
            )
            
            full_content = ""
            finish_reason = None
            
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    text = chunk.choices[0].delta.content
                    full_content += text
                    yield text
                
                if chunk.choices and chunk.choices[0].finish_reason:
                    finish_reason = chunk.choices[0].finish_reason
            
            return LLMResponse(
                content=full_content,
                finish_reason=finish_reason
            )
        except Exception as e:
            self._log_error(f"SDK stream error: {e}", e)
            raise RuntimeError(f"OpenAI API error: {str(e)}")
    
    def _chat_rest(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """使用 REST API 的非流式聊天（DeepSeek 特殊处理）"""
        url = self._get_api_url()
        headers = self._get_headers()

        # 过滤 DeepSeek 不支持的参数
        filtered_kwargs = self._filter_deepseek_params(kwargs)

        payload = {
            'model': self.model or ('deepseek-chat' if self.provider_type == 'deepseek' else 'gpt-4'),
            'messages': self._convert_messages_for_openai(messages),
            'stream': False,
            **filtered_kwargs
        }

        self._log(f"REST API request: {url}")
        response = requests.post(url, headers=headers, json=payload, timeout=120)

        if response.status_code != 200:
            error_msg = response.text
            self._log_error(f"API request failed: {response.status_code} - {error_msg}")
            raise RuntimeError(f"{'DeepSeek' if self.provider_type == 'deepseek' else 'OpenAI'} API error ({response.status_code}): {error_msg}")

        data = response.json()
        choice = data['choices'][0]

        return LLMResponse(
            content=choice['message']['content'],
            finish_reason=choice.get('finish_reason'),
            raw=data
        )
    
    def _chat_stream_rest(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """使用 REST API 的流式聊天（DeepSeek 特殊处理）"""
        url = self._get_api_url()
        headers = self._get_headers()

        # 过滤 DeepSeek 不支持的参数
        filtered_kwargs = self._filter_deepseek_params(kwargs)

        payload = {
            'model': self.model or ('deepseek-chat' if self.provider_type == 'deepseek' else 'gpt-4'),
            'messages': self._convert_messages_for_openai(messages),
            'stream': True,
            **filtered_kwargs
        }

        self._log(f"REST API stream request: {url}")
        response = requests.post(url, headers=headers, json=payload, stream=True, timeout=120)

        if response.status_code != 200:
            error_msg = response.text
            self._log_error(f"API stream request failed: {response.status_code} - {error_msg}")
            raise RuntimeError(f"{'DeepSeek' if self.provider_type == 'deepseek' else 'OpenAI'} API error ({response.status_code}): {error_msg}")

        full_content = ""
        finish_reason = None

        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data = line[6:]
                    if data == '[DONE]':
                        break
                    try:
                        chunk = json.loads(data)
                        if chunk.get('choices') and chunk['choices'][0].get('delta', {}).get('content'):
                            text = chunk['choices'][0]['delta']['content']
                            full_content += text
                            yield text
                        if chunk.get('choices') and chunk['choices'][0].get('finish_reason'):
                            finish_reason = chunk['choices'][0]['finish_reason']
                    except json.JSONDecodeError:
                        continue

        return LLMResponse(
            content=full_content,
            finish_reason=finish_reason
        )
    
    def _get_api_url(self) -> str:
        """获取 API URL"""
        if not self.api_url:
            return 'https://api.openai.com/v1/chat/completions'
        
        # 如果已经包含完整路径，直接返回
        if '/chat/completions' in self.api_url:
            return self.api_url
        
        # 否则构建完整路径
        base = self.api_url.rstrip('/')
        
        # 处理各种情况
        if base.endswith('/v1'):
            # 已经是 /v1 结尾，直接拼接
            return f"{base}/chat/completions"
        elif base.endswith('/v1/'):
            # 以 /v1/ 结尾，移除末尾斜杠后拼接
            return f"{base.rstrip('/')}/chat/completions"
        elif '/v1/' in base or base.endswith('/v1'):
            # 包含 /v1/ 或 /v1，直接拼接
            return f"{base}/chat/completions"
        else:
            # 如果 base 不包含 /v1，添加它
            return f"{base}/v1/chat/completions"
    
    def _get_headers(self) -> Dict[str, str]:
        """获取请求头"""
        return {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.api_key}'
        }
    
    def _convert_messages_for_openai(self, messages: List[LLMMessage]) -> List[Dict[str, Any]]:
        """转换消息格式为 OpenAI 格式"""
        result = []
        for msg in messages:
            item = {
                'role': msg.role,
                'content': msg.content
            }
            if msg.tool_call_id:
                item['tool_call_id'] = msg.tool_call_id
            if msg.name:
                item['name'] = msg.name
            if msg.tool_calls:
                item['tool_calls'] = msg.tool_calls
            result.append(item)
        return result
    
    def _parse_tool_calls(self, tool_calls) -> List[Dict[str, Any]]:
        """解析工具调用"""
        if not tool_calls:
            return []
        return [
            {
                'id': tc.id,
                'type': tc.type,
                'function': {
                    'name': tc.function.name,
                    'arguments': tc.function.arguments
                }
            }
            for tc in tool_calls
        ]


class DeepSeekProvider(OpenAIProvider):
    """DeepSeek Provider（使用 OpenAI 兼容 API）"""
    
    provider_type = "deepseek"
    
    def __init__(self, api_key: str, api_url: Optional[str] = None,
                 model: Optional[str] = None, **kwargs):
        # 设置默认 URL
        if not api_url:
            api_url = 'https://api.deepseek.com/v1/chat/completions'
        super().__init__(api_key, api_url, model or 'deepseek-chat', **kwargs)

    def _chat_sdk(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """使用 SDK 的非流式聊天（DeepSeek 特殊处理）"""
        try:
            # DeepSeek 不支持某些 OpenAI 参数，需要过滤
            filtered_kwargs = self._filter_deepseek_params(kwargs)

            msg_list = self._convert_messages_for_openai(messages)

            response = self._client.chat.completions.create(
                model=self.model or 'deepseek-chat',
                messages=msg_list,
                **filtered_kwargs
            )

            choice = response.choices[0]
            return LLMResponse(
                content=choice.message.content or '',
                finish_reason=choice.finish_reason,
                tool_calls=self._parse_tool_calls(choice.message.tool_calls) if choice.message.tool_calls else None,
                usage={
                    'prompt_tokens': response.usage.prompt_tokens if response.usage else 0,
                    'completion_tokens': response.usage.completion_tokens if response.usage else 0,
                    'total_tokens': response.usage.total_tokens if response.usage else 0,
                } if response.usage else None,
                raw=response.model_dump()
            )
        except Exception as e:
            self._log_error(f"DeepSeek SDK chat error: {e}", e)
            raise RuntimeError(f"DeepSeek API error: {str(e)}")

    def _filter_deepseek_params(self, kwargs: Dict[str, Any]) -> Dict[str, Any]:
        """过滤 DeepSeek 不支持的参数"""
        # 移除 DeepSeek 不支持的参数
        unsupported_params = [
            'reasoning_effort',  # DeepSeek 使用不同的参数名
            'thinking_budget',   # 这个参数不存在
        ]

        filtered = {k: v for k, v in kwargs.items() if k not in unsupported_params}

        # 如果有 thinking_mode，转换为 DeepSeek 支持的参数
        if kwargs.get('thinking_mode') and self.model == 'deepseek-reasoner':
            # DeepSeek reasoning 模型有特殊处理，这里暂时移除可能有问题的参数
            pass

        return filtered
    
    def models(self) -> List[str]:
        """
        获取可用模型列表
        优先使用 SDK，回退到 REST API
        """
        try:
            # 优先使用 SDK
            if self.sdk_available and self._client:
                try:
                    models = self._client.models.list()
                    model_ids = [model.id for model in models.data if hasattr(model, 'id')]
                    self._log(f"Fetched {len(model_ids)} models via SDK")
                    return model_ids
                except Exception as e:
                    self._log(f"SDK models() failed: {e}, falling back to REST API")
            
            # 回退到 REST API
            base_url = None
            if self.api_url:
                base_url = self.api_url.replace('/chat/completions', '').rstrip('/')
                if not base_url.endswith('/v1'):
                    if base_url.endswith('/v1/'):
                        base_url = base_url.rstrip('/')
                    else:
                        base_url = f"{base_url}/v1"
            else:
                base_url = 'https://api.openai.com/v1'
            
            models_url = f"{base_url}/models"
            headers = self._get_headers()
            
            self._log(f"Fetching models via REST API: {models_url}")
            response = requests.get(models_url, headers=headers, timeout=10)
            
            if response.status_code != 200:
                raise RuntimeError(f"Failed to fetch models: {response.status_code} {response.text}")
            
            data = response.json()
            if isinstance(data, dict) and data.get('object') == 'list' and isinstance(data.get('data'), list):
                model_ids = [model.get('id') for model in data['data'] if model.get('id')]
                self._log(f"Fetched {len(model_ids)} models via REST API")
                return model_ids
            
            raise RuntimeError("Invalid response format from models API")
            
        except Exception as e:
            self._log_error(f"Failed to fetch models: {e}", e)
            raise
