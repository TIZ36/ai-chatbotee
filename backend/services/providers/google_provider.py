"""
Google Gemini Provider

支持 Gemini 模型，包括图片生成
优先使用 google-genai SDK，回退到 REST API
"""

from typing import List, Optional, Dict, Any, Generator, Tuple
import json
import base64
import time
import requests

from .base import BaseLLMProvider, LLMMessage, LLMResponse

# 模块级缓存: (api_url, api_key) -> (timestamp, list_models_result)，TTL 5 分钟
_LIST_MODELS_CACHE: Dict[Tuple[str, str], Tuple[float, List[Dict[str, Any]]]] = {}
_LIST_MODELS_CACHE_TTL = 300


class GoogleProvider(BaseLLMProvider):
    """Google Gemini Provider"""
    
    provider_type = "gemini"
    sdk_available = False
    
    def __init__(self, api_key: str, api_url: Optional[str] = None,
                 model: Optional[str] = None, **kwargs):
        self._client = None
        self._types = None
        self.use_thoughtsig = kwargs.get('use_thoughtsig', True)  # 签名开关，默认开启
        # 联网搜索 (Google Search Grounding)：从 metadata.enableGoogleSearch 或 enable_google_search 读取
        self._enable_google_search = kwargs.get('enableGoogleSearch', False) or kwargs.get('enable_google_search', False)
        super().__init__(api_key, api_url, model, **kwargs)
    
    def _init_sdk(self):
        """初始化 Google GenAI SDK"""
        try:
            from google import genai
            from google.genai import types
            import os
            
            # 构建 http_options
            http_options = {'api_version': 'v1beta'}
            
            # 1. 检查是否配置了自定义 API URL
            if self.api_url:
                base_url = self.api_url.rstrip('/')
                # 如果 URL 包含 /v1beta 或 /v1，去掉它（SDK 会自己加）
                if '/v1beta' in base_url:
                    base_url = base_url.split('/v1beta')[0]
                elif '/v1' in base_url:
                    base_url = base_url.split('/v1')[0]
                
                # 检测是否是官方地址
                is_official = 'generativelanguage.googleapis.com' in base_url
                
                http_options['base_url'] = base_url
                if is_official:
                    self._log(f"✅ Using official API URL: {base_url}")
                    print(f"[GEMINIProvider] ✅ SDK 使用官方 API: {base_url}")
                else:
                    self._log(f"✅ Using custom API URL (proxy): {base_url}")
                    print(f"[GEMINIProvider] ✅ SDK 使用代理: {base_url}")
            
            # 2. 检查系统代理环境变量（HTTP_PROXY / HTTPS_PROXY）
            http_proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY') or \
                         os.environ.get('https_proxy') or os.environ.get('http_proxy')
            
            if http_proxy:
                # 配置 httpx 客户端使用代理
                http_options['client_args'] = {
                    'proxy': http_proxy,
                    'timeout': 120.0,
                }
                self._log(f"✅ Using system proxy: {http_proxy}")
                print(f"[GEMINIProvider] ✅ SDK 使用系统代理: {http_proxy}")
            
            # 3. 创建 Client
            if http_options.get('base_url') or http_options.get('client_args'):
                self._client = genai.Client(
                    api_key=self.api_key,
                    http_options=http_options
                )
                self._log("SDK initialized with custom http_options")
            else:
                # 无代理配置，直接使用官方 API
                self._log("⚠️ No proxy configured, using official API directly")
                print("[GEMINIProvider] ⚠️ 未检测到代理配置，直接使用官方 API")
                print("[GEMINIProvider] 💡 提示：如遇地区限制，请设置环境变量 HTTPS_PROXY 或在 LLM 配置中设置 api_url")
                self._client = genai.Client(api_key=self.api_key)
            
            self._types = types
            self.sdk_available = True
            self._log(f"SDK initialized successfully")
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
            
            # 图片生成模型配置：宽高比与生成数量
            if self._is_image_generation_model():
                config['response_modalities'] = ['TEXT', 'IMAGE']
                self._log("Enabled response_modalities: ['TEXT', 'IMAGE']")
                ar = kwargs.get('image_aspect_ratio')
                if ar and self._types and hasattr(self._types, 'ImageConfig'):
                    try:
                        config['image_config'] = self._types.ImageConfig(aspect_ratio=ar)
                        self._log(f"Image aspect_ratio: {ar}")
                    except Exception as e:
                        self._log(f"ImageConfig aspect_ratio skip: {e}")
                cand = kwargs.get('image_candidate_count')
                if cand is not None and isinstance(cand, int) and 1 <= cand <= 4:
                    config['candidate_count'] = cand
                    self._log(f"Image candidate_count: {cand}")
            elif self._enable_google_search and self._types:
                # 联网搜索 (Google Search Grounding)，仅非图片模型
                try:
                    config['tools'] = [self._types.Tool(google_search=self._types.GoogleSearch())]
                    self._log("Enabled Google Search Grounding")
                except Exception as e:
                    self._log(f"Could not add google_search tool: {e}")
            
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
            elif self._enable_google_search and self._types:
                try:
                    config['tools'] = [self._types.Tool(google_search=self._types.GoogleSearch())]
                    self._log("Enabled Google Search Grounding (stream)")
                except Exception as e:
                    self._log(f"Could not add google_search tool: {e}")
            
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
    
    def models(self) -> List[str]:
        """
        获取可用模型列表
        优先使用 SDK，回退到 REST API
        """
        try:
            # 优先使用 SDK
            if self.sdk_available and self._client:
                try:
                    # Google GenAI SDK 可能没有直接的 models.list() 方法
                    # 尝试使用 REST API
                    pass
                except Exception as e:
                    self._log(f"SDK models() not available: {e}, using REST API")
            
            # 使用 REST API
            # Gemini API: https://generativelanguage.googleapis.com/v1beta/models?key=API_KEY
            base_url = self.api_url or 'https://generativelanguage.googleapis.com'
            if '/v1beta' not in base_url and '/v1' not in base_url:
                base_url = f"{base_url.rstrip('/')}/v1beta"
            elif base_url.endswith('/v1'):
                base_url = base_url.replace('/v1', '/v1beta')
            
            models_url = f"{base_url}/models"
            params = {'key': self.api_key}
            
            self._log(f"Fetching models via REST API: {models_url}")
            response = requests.get(models_url, params=params, timeout=10)
            
            if response.status_code != 200:
                raise RuntimeError(f"Failed to fetch models: {response.status_code} {response.text}")
            
            data = response.json()
            # Gemini 返回格式：{ models: [{ name: "...", ... }] }
            if isinstance(data, dict) and isinstance(data.get('models'), list):
                model_names = [model.get('name') for model in data['models'] if model.get('name')]
                # 提取模型 ID（从完整名称中，如 "models/gemini-2.0-flash-exp" -> "gemini-2.0-flash-exp"）
                model_ids = []
                for name in model_names:
                    if '/' in name:
                        model_ids.append(name.split('/')[-1])
                    else:
                        model_ids.append(name)
                self._log(f"Fetched {len(model_ids)} models via REST API")
                return model_ids
            
            # 兼容其他格式
            if isinstance(data, list):
                model_ids = [item.get('name') if isinstance(item, dict) else item for item in data if item]
                # 提取模型 ID
                extracted_ids = []
                for name in model_ids:
                    if isinstance(name, str) and '/' in name:
                        extracted_ids.append(name.split('/')[-1])
                    elif name:
                        extracted_ids.append(name)
                self._log(f"Fetched {len(extracted_ids)} models via REST API (array format)")
                return extracted_ids
            
            raise RuntimeError("Invalid response format from models API")
            
        except Exception as e:
            self._log_error(f"Failed to fetch models: {e}", e)
            raise

    def list_models(self) -> List[Dict[str, Any]]:
        """
        获取模型列表及可调用性信息（用于聊天 generateContent）。
        解析 Google API 返回的 supportedGenerationMethods，仅支持 generateContent 的模型视为可对话。
        结果带简单内存缓存，TTL 5 分钟。
        """
        cache_key = (self.api_url or '', self.api_key or '')
        now = time.time()
        if cache_key in _LIST_MODELS_CACHE:
            ts, cached = _LIST_MODELS_CACHE[cache_key]
            if now - ts < _LIST_MODELS_CACHE_TTL:
                self._log(f"Using cached list_models ({len(cached)} models)")
                return cached
        base_url = self.api_url or 'https://generativelanguage.googleapis.com'
        if '/v1beta' not in base_url and '/v1' not in base_url:
            base_url = f"{base_url.rstrip('/')}/v1beta"
        elif base_url.endswith('/v1'):
            base_url = base_url.replace('/v1', '/v1beta')
        models_url = f"{base_url}/models"
        params = {'key': self.api_key}
        self._log(f"Fetching list_models via REST: {models_url}")
        response = requests.get(models_url, params=params, timeout=10)
        if response.status_code != 200:
            raise RuntimeError(f"Failed to fetch models: {response.status_code} {response.text}")
        data = response.json()
        result = []
        if not isinstance(data, dict) or not isinstance(data.get('models'), list):
            raise RuntimeError("Invalid response format from models API")
        for model in data['models']:
            name = model.get('name')
            if not name or not isinstance(name, str):
                continue
            model_id = name.split('/')[-1] if '/' in name else name
            methods = model.get('supportedGenerationMethods') or model.get('supported_generation_methods') or []
            if isinstance(methods, str):
                methods = [methods]
            is_callable = 'generateContent' in methods
            result.append({
                'id': model_id,
                'is_callable': is_callable,
                'supported_generation_methods': list(methods),
            })
        _LIST_MODELS_CACHE[cache_key] = (now, result)
        self._log(f"list_models: {len(result)} models, {sum(1 for r in result if r['is_callable'])} callable for chat")
        return result
