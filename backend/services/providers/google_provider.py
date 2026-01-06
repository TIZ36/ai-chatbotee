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
        self.use_thoughtsig = kwargs.get('use_thoughtsig', True)  # 签名开关，默认开启
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

    def _requires_thought_signature_workaround(self) -> bool:
        """
        部分 Gemini 图像/多模态模型在“回灌历史 model 输出”时，会要求每个 part 都携带 thoughtSignature，
        但历史数据通常没有保存 text part 的 thoughtSignature，导致 400 INVALID_ARGUMENT。

        这里做一个保守的兼容策略：当使用图像相关模型时，把历史 assistant/tool 的文本降级为 user role 发送，
        以避免触发 thoughtSignature 强校验，同时不影响用户上传图片（图生图）。
        """
        m = (self.model or '').lower()
        return ('image' in m) or ('image-preview' in m)
    
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
                                    self._log(f"✅ 图片包含 thoughtSignature ({len(thought_sig)} 字符)")
                                else:
                                    self._log(f"⚠️ 图片不包含 thoughtSignature")
                                media.append(media_item)
                                self._log(f"Received image: {mime_type} ({len(data)} chars)")
            
            return LLMResponse(
                content=content,
                media=media if media else None,
                finish_reason=response.candidates[0].finish_reason if response.candidates else None
            )
        except Exception as e:
            self._log_error(f"SDK chat error: {e}", e)
            detail = str(e) or repr(e)
            raise RuntimeError(f"Google API error: {detail}")
    
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
                                        self._log(f"✅ 图片包含 thoughtSignature ({len(thought_sig)} 字符)")
                                    else:
                                        self._log(f"⚠️ 图片不包含 thoughtSignature")
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
            detail = str(e) or repr(e)
            raise RuntimeError(f"Google API error: {detail}")
    
    def _chat_rest(self, messages: List[LLMMessage], **kwargs) -> LLMResponse:
        """使用 REST API 的非流式聊天"""
        url = self._get_api_url(stream=False)
        contents, system_instruction = self._convert_messages_for_gemini_rest(messages)
        
        payload = {'contents': contents}
        if system_instruction:
            # Gemini REST API 使用 systemInstruction（camelCase）
            payload['systemInstruction'] = system_instruction
        
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
                        self._log(f"✅ 图片包含 thoughtSignature ({len(thought_sig)} 字符)")
                    else:
                        self._log(f"⚠️ 图片不包含 thoughtSignature")
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
            # Gemini REST API 使用 systemInstruction（camelCase）
            payload['systemInstruction'] = system_instruction
        
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
    
    def _find_recent_thought_signature(self, messages: List[LLMMessage]) -> Optional[str]:
        """
        查找最近的 LLM 输出的带有 thought signature 的图片的签名
        
        Args:
            messages: 消息列表
            
        Returns:
            最近的 thought signature，如果没找到返回 None
        """
        # 从后往前查找（最近的优先）
        for msg in reversed(messages):
            if msg.role in ('assistant', 'model') and msg.media:
                for media_item in msg.media:
                    if isinstance(media_item, dict):
                        thought_sig = media_item.get('thoughtSignature') or media_item.get('thought_signature')
                        if thought_sig:
                            return thought_sig
        return None
    
    def _convert_messages_for_gemini_sdk(self, messages: List[LLMMessage]) -> tuple:
        """转换消息格式为 Gemini SDK 格式"""
        contents = []
        system_instruction = None
        
        # 查找最近的 thought signature（用于签名开关打开时的参考）
        recent_thought_sig = self._find_recent_thought_signature(messages)
        if recent_thought_sig:
            self._log(f"找到最近的 thoughtSignature 参考: {len(recent_thought_sig)} 字符")
        
        # 预检查：打印哪些消息包含 thoughtSignature
        self._log("=== ThoughtSignature 检查 ===")
        content_idx = 0
        for i, msg in enumerate(messages):
            if msg.role == 'system':
                continue
            has_sig = False
            sig_count = 0
            if msg.media:
                for media_item in msg.media:
                    if isinstance(media_item, dict):
                        if media_item.get('thoughtSignature') or media_item.get('thought_signature'):
                            has_sig = True
                            sig_count += 1
            media_count = len(msg.media) if msg.media else 0
            status = f"✅ {sig_count} sig" if has_sig else (f"⚠️ 无sig ({media_count}图)" if media_count > 0 else "")
            if media_count > 0:
                self._log(f"  Content[{content_idx}] {msg.role}: {media_count}张图 {status}")
            content_idx += 1
        self._log("=============================")
        
        for msg in messages:
            if msg.role == 'system':
                system_instruction = msg.content
            else:
                # 兼容：图像模型下历史 assistant/tool 文本可能要求 thoughtSignature（我们没有），降级为 user
                if msg.role == 'user':
                    role = 'user'
                else:
                    role = 'user' if self._requires_thought_signature_workaround() else 'model'
                parts = []
                
                # 添加文本
                if msg.content:
                    if role == 'user' and msg.role != 'user' and self._requires_thought_signature_workaround():
                        parts.append(self._types.Part.from_text(text=f"[历史助手消息] {msg.content}"))
                    else:
                        parts.append(self._types.Part.from_text(text=msg.content))
                
                # 添加媒体
                if msg.media:
                    for media_item in msg.media:
                        if not isinstance(media_item, dict):
                            continue
                        
                        media_data = media_item.get('data') or media_item.get('url', '')
                        mime_type = media_item.get('mimeType') or media_item.get('mime_type', 'image/jpeg')
                        
                        # 运行时兜底：media_data 可能是 bytes/bytearray（会导致后续 JSON/处理失败）
                        # - SDK 路径：可以直接使用原始 bytes
                        if isinstance(media_data, (bytes, bytearray)):
                            image_bytes = bytes(media_data)
                            thought_sig = media_item.get('thoughtSignature') or media_item.get('thought_signature')
                            
                            # 如果签名开关打开且没有签名，尝试使用最近的签名作为参考
                            if not thought_sig and self.use_thoughtsig and role != 'user' and recent_thought_sig:
                                thought_sig = recent_thought_sig
                                self._log(f"🔄 使用最近的 thoughtSignature 作为参考 ({len(thought_sig)} chars)")
                            
                            if thought_sig:
                                self._log(f"Including thoughtSignature for image ({len(thought_sig)} chars)")
                                parts.append(self._types.Part(
                                    inline_data=self._types.Blob(mime_type=mime_type, data=image_bytes),
                                    thought_signature=thought_sig
                                ))
                            else:
                                if role == 'user':
                                    parts.append(self._types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
                                else:
                                    self._log("⚠️ Model image missing thoughtSignature, omitting image and adding placeholder text")
                                    parts.append(self._types.Part.from_text(
                                        text='[图片已省略：缺少 thoughtSignature（旧历史数据），无法发送给 Gemini 2.5+]'
                                    ))
                            continue

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
                                # Gemini 2.5+：如果“把模型生成的图片”再喂回模型，必须带 thought_signature；
                                # 但“用户上传的图片”通常没有 thought_signature，仍应允许用于图生图。
                                thought_sig = media_item.get('thoughtSignature') or media_item.get('thought_signature')
                                
                                # 如果签名开关打开且没有签名，尝试使用最近的签名作为参考
                                if not thought_sig and self.use_thoughtsig and role != 'user' and recent_thought_sig:
                                    thought_sig = recent_thought_sig
                                    self._log(f"🔄 使用最近的 thoughtSignature 作为参考 ({len(thought_sig)} chars)")
                                
                                if thought_sig:
                                    # 使用 SDK 原生 thought_signature 支持
                                    self._log(f"Including thoughtSignature for image ({len(thought_sig)} chars)")
                                    parts.append(self._types.Part(
                                        inline_data=self._types.Blob(mime_type=mime_type, data=image_bytes),
                                        thought_signature=thought_sig
                                    ))
                                else:
                                    if role == 'user':
                                        # 用户图片：允许无 thoughtSignature（用于图生图）
                                        parts.append(self._types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
                                    else:
                                        # assistant/model 图片：无 thoughtSignature 会触发 400，降级为文本占位
                                        self._log("⚠️ Model image missing thoughtSignature, omitting image and adding placeholder text")
                                        parts.append(self._types.Part.from_text(
                                            text='[图片已省略：缺少 thoughtSignature（旧历史数据），无法发送给 Gemini 2.5+]'
                                        ))
                            except Exception as e:
                                self._log_error(f"Failed to decode image: {e}")
                
                if parts:
                    contents.append(self._types.Content(role=role, parts=parts))
        
        return contents, system_instruction
    
    def _convert_messages_for_gemini_rest(self, messages: List[LLMMessage]) -> tuple:
        """转换消息格式为 Gemini REST API 格式"""
        contents = []
        system_instruction = None
        
        # 查找最近的 thought signature（用于签名开关打开时的参考）
        recent_thought_sig = self._find_recent_thought_signature(messages)
        if recent_thought_sig:
            self._log(f"找到最近的 thoughtSignature 参考: {len(recent_thought_sig)} 字符")
        
        # 预检查：打印哪些消息包含 thoughtSignature
        self._log("=== ThoughtSignature 检查 (REST) ===")
        content_idx = 0
        for i, msg in enumerate(messages):
            if msg.role == 'system':
                continue
            has_sig = False
            sig_count = 0
            if msg.media:
                for media_item in msg.media:
                    if isinstance(media_item, dict):
                        if media_item.get('thoughtSignature') or media_item.get('thought_signature'):
                            has_sig = True
                            sig_count += 1
            media_count = len(msg.media) if msg.media else 0
            status = f"✅ {sig_count} sig" if has_sig else (f"⚠️ 无sig ({media_count}图)" if media_count > 0 else "")
            if media_count > 0:
                self._log(f"  Content[{content_idx}] {msg.role}: {media_count}张图 {status}")
            content_idx += 1
        self._log("=====================================")
        
        for msg in messages:
            if msg.role == 'system':
                system_instruction = {'parts': [{'text': msg.content}]}
            else:
                # 兼容：图像模型下历史 assistant/tool 文本可能要求 thoughtSignature（我们没有），降级为 user
                if msg.role == 'user':
                    role = 'user'
                else:
                    role = 'user' if self._requires_thought_signature_workaround() else 'model'
                parts = []
                
                if msg.content:
                    if role == 'user' and msg.role != 'user' and self._requires_thought_signature_workaround():
                        parts.append({'text': f"[历史助手消息] {msg.content}"})
                    else:
                        parts.append({'text': msg.content})
                
                if msg.media:
                    for media_item in msg.media:
                        if not isinstance(media_item, dict):
                            continue
                        
                        media_data = media_item.get('data') or media_item.get('url', '')
                        mime_type = media_item.get('mimeType') or media_item.get('mime_type', 'image/jpeg')
                        
                        # 运行时兜底：REST payload 必须是 JSON，可序列化；bytes/bytearray 必须转 base64 字符串
                        if isinstance(media_data, (bytes, bytearray)):
                            media_data = base64.b64encode(bytes(media_data)).decode('utf-8')

                        if isinstance(media_data, str):
                            if media_data.startswith('data:'):
                                if ';base64,' in media_data:
                                    media_data = media_data.split(';base64,', 1)[1]
                                elif ',' in media_data:
                                    media_data = media_data.split(',', 1)[1]
                            media_data = media_data.strip().replace('\n', '').replace('\r', '').replace(' ', '')
                        
                        if media_data and mime_type:
                            # Gemini 2.5+：模型生成的图片回灌必须带 thoughtSignature；用户上传图片可无签名用于图生图。
                            thought_sig = media_item.get('thoughtSignature') or media_item.get('thought_signature')
                            
                            # 如果签名开关打开且没有签名，尝试使用最近的签名作为参考
                            if not thought_sig and self.use_thoughtsig and role != 'user' and recent_thought_sig:
                                thought_sig = recent_thought_sig
                                self._log(f"🔄 使用最近的 thoughtSignature 作为参考 ({len(thought_sig)} chars)")
                            
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
                            else:
                                if role == 'user':
                                    # 用户图片：允许无 thoughtSignature（用于图生图）
                                    parts.append({
                                        'inlineData': {
                                            'mimeType': mime_type,
                                            'data': media_data
                                        }
                                    })
                                else:
                                    # assistant/model 图片：无 thoughtSignature 会触发 400，降级为文本占位
                                    self._log("⚠️ Model image missing thoughtSignature, omitting image and adding placeholder text")
                                    parts.append({'text': '[图片已省略：缺少 thoughtSignature（旧历史数据），无法发送给 Gemini 2.5+]'})
                
                if parts:
                    contents.append({'role': role, 'parts': parts})
        
        return contents, system_instruction
    
    def _parse_error_response(self, response) -> str:
        """解析错误响应"""
        try:
            error_data = response.json()
            msg = (error_data.get('error', {}) or {}).get('message', '')
            if msg:
                return msg
            if response.text:
                return response.text
            return f"HTTP {response.status_code}"
        except:
            return response.text or f"HTTP {response.status_code}"
