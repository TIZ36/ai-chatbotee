"""
Google Gemini Provider

支持 Gemini 模型，包括图片生成
优先使用 google-genai SDK，回退到 REST API
"""

from typing import List, Optional, Dict, Any, Generator
import json
import base64
import requests

from .base import BaseLLMProvider, LLMMessage, LLMResponse


class GoogleProvider(BaseLLMProvider):
    """Google Gemini Provider"""
    
    provider_type = "gemini"
    sdk_available = False
    
    def __init__(self, api_key: str, api_url: Optional[str] = None,
                 model: Optional[str] = None, **kwargs):
        self._client = None
        self._types = None
        super().__init__(api_key, api_url, model, **kwargs)
    
    def _init_sdk(self):
        """初始化 Google GenAI SDK"""
        try:
            from google import genai
            from google.genai import types
            
            self._client = genai.Client(api_key=self.api_key)
            self._types = types
            self.sdk_available = True
            self._log("SDK initialized")
        except ImportError:
            self._log("google-genai SDK not installed, using REST API")
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
        # 图片生成模型不支持流式，使用非流式
        if self._is_image_generation_model():
            self._log("Image generation model detected, using non-streaming")
            response = self.chat(messages, **kwargs)
            if response.content:
                yield response.content
            return response
        
        if self.sdk_available and self._client:
            yield from self._chat_stream_sdk(messages, **kwargs)
        else:
            yield from self._chat_stream_rest(messages, **kwargs)
    
    def _is_image_generation_model(self) -> bool:
        """检查是否是图片生成模型"""
        return self.model and 'image' in self.model.lower()
    
    def _chat_sdk(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """使用 SDK 的非流式聊天"""
        try:
            contents, system_instruction = self._convert_messages_for_gemini_sdk(messages)
            
            # 构建配置
            config = {}
            if system_instruction:
                config['system_instruction'] = system_instruction
            
            # 图片生成模型配置
            if self._is_image_generation_model():
                config['response_modalities'] = ['TEXT', 'IMAGE']
                self._log("Enabled response_modalities: ['TEXT', 'IMAGE']")
            
            self._log(f"Calling SDK: model={self.model}, contents={len(contents)}")
            
            # 调用 API
            response = self._client.models.generate_content(
                model=self.model or 'gemini-2.5-flash',
                contents=contents,
                config=self._types.GenerateContentConfig(**config) if config else None
            )
            
            # 解析响应
            content = ""
            media = []
            
            if response.candidates:
                for candidate in response.candidates:
                    if candidate.content and candidate.content.parts:
                        for part in candidate.content.parts:
                            if hasattr(part, 'text') and part.text:
                                content += part.text
                            elif hasattr(part, 'inline_data') and part.inline_data:
                                mime_type = part.inline_data.mime_type or 'image/png'
                                image_data = part.inline_data.data
                                if isinstance(image_data, bytes):
                                    data = base64.b64encode(image_data).decode('utf-8')
                                else:
                                    data = image_data

                                # 提取 thoughtSignature（Gemini 2.5+）
                                thought_sig = None
                                if hasattr(part, 'thought_signature') and part.thought_signature:
                                    thought_sig = part.thought_signature
                                    self._log(f"Found thoughtSignature in image: {len(thought_sig)} chars")

                                # 保存到 media 列表（前端用缩略图/预览展示，不再往 Markdown content 里塞图）
                                media_item = {
                                    'type': 'image',
                                    'mimeType': mime_type,
                                    'data': data
                                }
                                # 保存 thoughtSignature（如果存在），供后续请求使用
                                if thought_sig:
                                    media_item['thoughtSignature'] = thought_sig
                                media.append(media_item)
                                self._log(f"Received image: {mime_type} ({len(data)} chars)")
            
            return LLMResponse(
                content=content,
                media=media if media else None,
                finish_reason=response.candidates[0].finish_reason if response.candidates else None
            )
        except Exception as e:
            self._log_error(f"SDK chat error: {e}", e)
            raise RuntimeError(f"Google API error: {str(e)}")
    
    def _chat_stream_sdk(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """使用 SDK 的流式聊天"""
        try:
            contents, system_instruction = self._convert_messages_for_gemini_sdk(messages)
            
            # 构建配置
            config = {}
            if system_instruction:
                config['system_instruction'] = system_instruction
            
            # 图片生成模型配置
            if self._is_image_generation_model():
                config['response_modalities'] = ['TEXT', 'IMAGE']
            
            self._log(f"Calling SDK stream: model={self.model}")
            
            # 流式调用
            stream = self._client.models.generate_content_stream(
                model=self.model or 'gemini-2.5-flash',
                contents=contents,
                config=self._types.GenerateContentConfig(**config) if config else None
            )
            
            full_content = ""
            finish_reason = None
            media = []
            
            for chunk in stream:
                if chunk.candidates:
                    for candidate in chunk.candidates:
                        if candidate.content and candidate.content.parts:
                            for part in candidate.content.parts:
                                if hasattr(part, 'text') and part.text:
                                    full_content += part.text
                                    yield part.text
                                elif hasattr(part, 'inline_data') and part.inline_data:
                                    # 提取图片数据
                                    mime_type = part.inline_data.mime_type or 'image/png'
                                    image_data = part.inline_data.data
                                    if isinstance(image_data, bytes):
                                        data = base64.b64encode(image_data).decode('utf-8')
                                    else:
                                        data = image_data
                                    
                                    # 提取 thoughtSignature（Gemini 2.5+）
                                    thought_sig = None
                                    if hasattr(part, 'thought_signature') and part.thought_signature:
                                        thought_sig = part.thought_signature
                                        self._log(f"[Stream] Found thoughtSignature in image: {len(thought_sig)} chars")
                                    
                                    media_item = {
                                        'type': 'image',
                                        'mimeType': mime_type,
                                        'data': data
                                    }
                                    if thought_sig:
                                        media_item['thoughtSignature'] = thought_sig
                                    media.append(media_item)
                                    self._log(f"[Stream] Received image: {mime_type} ({len(data)} chars)")
                        if candidate.finish_reason:
                            finish_reason = candidate.finish_reason
            
            return LLMResponse(
                content=full_content,
                media=media if media else None,
                finish_reason=finish_reason
            )
        except Exception as e:
            self._log_error(f"SDK stream error: {e}", e)
            raise RuntimeError(f"Google API error: {str(e)}")
    
    def _chat_rest(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """使用 REST API 的非流式聊天"""
        url = self._get_api_url(stream=False)
        contents, system_instruction = self._convert_messages_for_gemini_rest(messages)
        
        payload = {'contents': contents}
        if system_instruction:
            payload['system_instruction'] = system_instruction
        
        # 图片生成模型配置
        if self._is_image_generation_model():
            payload['generationConfig'] = {
                'responseModalities': ['TEXT', 'IMAGE']
            }
        
        self._log(f"Calling REST API: {url.split('?')[0]}...")
        
        response = requests.post(url, json=payload, timeout=120)
        
        if response.status_code != 200:
            error_text = self._parse_error_response(response)
            raise RuntimeError(f"Google API error: {error_text}")
        
        data = response.json()
        content = ""
        media = []
        
        candidates = data.get('candidates', [])
        for candidate in candidates:
            parts = candidate.get('content', {}).get('parts', [])
            for part in parts:
                if 'text' in part:
                    content += part['text']
                elif 'inlineData' in part:
                    media_item = {
                        'type': 'image',
                        'mimeType': part['inlineData'].get('mimeType', 'image/png'),
                        'data': part['inlineData'].get('data', '')
                    }
                    # 提取 thoughtSignature（Gemini 2.5+）- REST API 格式
                    thought_sig = part.get('thoughtSignature')
                    if thought_sig:
                        media_item['thoughtSignature'] = thought_sig
                        self._log(f"[REST] Found thoughtSignature in image: {len(thought_sig)} chars")
                    media.append(media_item)
        
        return LLMResponse(
            content=content,
            media=media if media else None,
            raw=data
        )
    
    def _chat_stream_rest(self, messages: List[LLMMessage], **kwargs) -> Generator[str, None, LLMResponse]:
        """使用 REST API 的流式聊天"""
        url = self._get_api_url(stream=True)
        contents, system_instruction = self._convert_messages_for_gemini_rest(messages)
        
        payload = {'contents': contents}
        if system_instruction:
            payload['system_instruction'] = system_instruction
        
        response = requests.post(url, json=payload, stream=True, timeout=120)
        
        if response.status_code != 200:
            error_text = self._parse_error_response(response)
            raise RuntimeError(f"Google API error: {error_text}")
        
        full_content = ""
        finish_reason = None
        
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    try:
                        chunk = json.loads(line[6:])
                        candidates = chunk.get('candidates', [])
                        if candidates:
                            parts = candidates[0].get('content', {}).get('parts', [])
                            for part in parts:
                                if 'text' in part:
                                    text = part['text']
                                    full_content += text
                                    yield text
                            if candidates[0].get('finishReason'):
                                finish_reason = candidates[0]['finishReason']
                    except json.JSONDecodeError:
                        continue
        
        return LLMResponse(
            content=full_content,
            finish_reason=finish_reason
        )
    
    def _get_api_url(self, stream: bool = False) -> str:
        """获取 API URL"""
        model = self.model or 'gemini-2.5-flash'
        endpoint = 'streamGenerateContent?alt=sse' if stream else 'generateContent'
        
        if self.api_url:
            base = self.api_url.rstrip('/')
            url = f"{base}/models/{model}:{endpoint}"
        else:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:{endpoint}"
        
        # 添加 API key
        separator = '&' if '?' in url else '?'
        url += f"{separator}key={self.api_key}"
        
        return url
    
    def _convert_messages_for_gemini_sdk(self, messages: List[LLMMessage]) -> tuple:
        """转换消息格式为 Gemini SDK 格式"""
        contents = []
        system_instruction = None
        
        # 预检查：过滤掉包含没有thoughtSignature图片的消息
        self._log("=== ThoughtSignature 检查 ===")
        filtered_messages = []
        content_idx = 0

        for msg in messages:
            if msg.role == 'system':
                filtered_messages.append(msg)
                continue

            # 检查消息中的媒体是否都有thoughtSignature（仅对助手消息要求）
            has_invalid_media = False
            media_count = len(msg.media) if msg.media else 0
            sig_count = 0

            if msg.media:
                for media_item in msg.media:
                    if isinstance(media_item, dict) and media_item.get('type') == 'image':
                        has_sig = bool(media_item.get('thoughtSignature') or media_item.get('thought_signature'))

                        # 只有助手消息（model）中的图片才需要thoughtSignature
                        if msg.role == 'assistant' and not has_sig:
                            has_invalid_media = True
                        elif has_sig:
                            sig_count += 1

            if has_invalid_media:
                self._log(f"  Content[{content_idx}] {msg.role}: 跳过消息（助手图片缺少thoughtSignature）")
                continue
            else:
                filtered_messages.append(msg)
                if media_count > 0:
                    status = f"✅ {sig_count} sig"
                    self._log(f"  Content[{content_idx}] {msg.role}: {media_count}张图 {status}")

            content_idx += 1

        self._log(f"过滤后消息数量: {len(filtered_messages)}/{len(messages)}")
        self._log("=============================")

        # 使用过滤后的消息
        messages = filtered_messages
        
        for msg in messages:
            if msg.role == 'system':
                system_instruction = msg.content
            else:
                role = 'user' if msg.role == 'user' else 'model'
                parts = []
                
                # 添加文本
                if msg.content:
                    parts.append(self._types.Part.from_text(text=msg.content))
                
                # 添加媒体
                if msg.media:
                    for media_item in msg.media:
                        if not isinstance(media_item, dict):
                            continue
                        
                        media_data = media_item.get('data') or media_item.get('url', '')
                        mime_type = media_item.get('mimeType') or media_item.get('mime_type', 'image/jpeg')
                        
                        # 处理 base64 数据
                        if isinstance(media_data, str):
                            if media_data.startswith('data:'):
                                if ';base64,' in media_data:
                                    media_data = media_data.split(';base64,', 1)[1]
                                elif ',' in media_data:
                                    media_data = media_data.split(',', 1)[1]
                            media_data = media_data.strip().replace('\n', '').replace('\r', '').replace(' ', '')
                        
                        if media_data and mime_type:
                            try:
                                image_bytes = base64.b64decode(media_data)
                                thought_sig = media_item.get('thoughtSignature') or media_item.get('thought_signature')

                                # 只有助手消息（model）中的图片才需要thoughtSignature
                                if thought_sig:
                                    # 使用 SDK 原生 thought_signature 支持
                                    self._log(f"Including thoughtSignature for image ({len(thought_sig)} chars)")
                                    parts.append(self._types.Part(
                                        inline_data=self._types.Blob(mime_type=mime_type, data=image_bytes),
                                        thought_signature=thought_sig
                                    ))
                                elif role == 'model':
                                    # 助手消息中的图片没有thoughtSignature，跳过
                                    self._log(f"Skipping assistant image without thoughtSignature")
                                    continue
                                else:
                                    # 用户消息中的图片不需要thoughtSignature，直接包含
                                    self._log(f"Including user image without thoughtSignature")
                                    parts.append(self._types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
                            except Exception as e:
                                self._log_error(f"Failed to decode image: {e}")
                
                if parts:
                    contents.append(self._types.Content(role=role, parts=parts))
        
        return contents, system_instruction
    
    def _convert_messages_for_gemini_rest(self, messages: List[LLMMessage]) -> tuple:
        """转换消息格式为 Gemini REST API 格式"""
        contents = []
        system_instruction = None
        
        # 预检查：过滤掉包含没有thoughtSignature图片的消息
        self._log("=== ThoughtSignature 检查 (REST) ===")
        filtered_messages = []
        content_idx = 0

        for msg in messages:
            if msg.role == 'system':
                filtered_messages.append(msg)
                continue

            # 检查消息中的媒体是否都有thoughtSignature（仅对助手消息要求）
            has_invalid_media = False
            media_count = len(msg.media) if msg.media else 0
            sig_count = 0

            if msg.media:
                for media_item in msg.media:
                    if isinstance(media_item, dict) and media_item.get('type') == 'image':
                        has_sig = bool(media_item.get('thoughtSignature') or media_item.get('thought_signature'))

                        # 只有助手消息（model）中的图片才需要thoughtSignature
                        if msg.role == 'assistant' and not has_sig:
                            has_invalid_media = True
                        elif has_sig:
                            sig_count += 1

            if has_invalid_media:
                self._log(f"  Content[{content_idx}] {msg.role}: 跳过消息（助手图片缺少thoughtSignature）")
                continue
            else:
                filtered_messages.append(msg)
                if media_count > 0:
                    status = f"✅ {sig_count} sig"
                    self._log(f"  Content[{content_idx}] {msg.role}: {media_count}张图 {status}")

            content_idx += 1

        self._log(f"过滤后消息数量: {len(filtered_messages)}/{len(messages)}")
        self._log("=====================================")

        # 使用过滤后的消息
        messages = filtered_messages
        
        for msg in messages:
            if msg.role == 'system':
                system_instruction = {'parts': [{'text': msg.content}]}
            else:
                role = 'user' if msg.role == 'user' else 'model'
                parts = []
                
                if msg.content:
                    parts.append({'text': msg.content})
                
                if msg.media:
                    for media_item in msg.media:
                        if not isinstance(media_item, dict):
                            continue
                        
                        media_data = media_item.get('data') or media_item.get('url', '')
                        mime_type = media_item.get('mimeType') or media_item.get('mime_type', 'image/jpeg')
                        
                        if isinstance(media_data, str):
                            if media_data.startswith('data:'):
                                if ';base64,' in media_data:
                                    media_data = media_data.split(';base64,', 1)[1]
                                elif ',' in media_data:
                                    media_data = media_data.split(',', 1)[1]
                            media_data = media_data.strip().replace('\n', '').replace('\r', '').replace(' ', '')
                        
                        if media_data and mime_type:
                            thought_sig = media_item.get('thoughtSignature') or media_item.get('thought_signature')

                            if thought_sig:
                                part_data = {
                                    'inlineData': {
                                        'mimeType': mime_type,
                                        'data': media_data
                                    },
                                    'thoughtSignature': thought_sig
                                }
                                self._log(f"Including thoughtSignature for image ({len(thought_sig)} chars)")
                                parts.append(part_data)
                            elif role == 'model':
                                # 助手消息中的图片没有thoughtSignature，跳过
                                self._log(f"Skipping assistant image without thoughtSignature")
                                continue
                            else:
                                # 用户消息中的图片不需要thoughtSignature，直接包含
                                self._log(f"Including user image without thoughtSignature")
                                part_data = {
                                    'inlineData': {
                                        'mimeType': mime_type,
                                        'data': media_data
                                    }
                                }
                                parts.append(part_data)
                
                if parts:
                    contents.append({'role': role, 'parts': parts})
        
        return contents, system_instruction
    
    def _parse_error_response(self, response) -> str:
        """解析错误响应"""
        try:
            error_data = response.json()
            return error_data.get('error', {}).get('message', '') or response.text
        except:
            return response.text or f"HTTP {response.status_code}"
