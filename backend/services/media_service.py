"""
媒体生成服务层：按供应商封装图像/视频生成
- Gemini 图像：gemini-2.x-flash-image 等走 generateContent。
- Imagen：imagen-3 / imagen-4 使用 generate_images 或 REST :predict，不支持 generateContent。
- 视频：Veo 通过 generateVideos REST API 生成。
- OpenAI：Images API (generations, edits)。
- Runway：视频生成 (REST API)。
"""

from typing import Optional, Dict, Any, List
import base64
import requests
import time
import logging

from services.providers import create_provider
from services.providers.base import LLMMessage

logger = logging.getLogger(__name__)


def _ensure_media_json_serializable(media: List[Dict[str, Any]], strip_thought_signature: bool = True) -> List[Dict[str, Any]]:
    """确保 media 中每项的 data 为 base64 字符串，避免 bytes 导致 JSON 序列化报错。
    
    strip_thought_signature: 默认 True，从返回给前端的 media 中去掉 thoughtSignature
    （该字段可达数 MB，仅用于后续 SDK 调用，不需要传给前端，避免巨型 JSON 导致 500 或超慢响应）。
    """
    out = []
    for item in (media or []):
        if not isinstance(item, dict):
            out.append(item)
            continue
        cleaned = dict(item)
        # bytes → base64 str
        data = cleaned.get('data')
        if data is not None and isinstance(data, (bytes, bytearray)):
            cleaned['data'] = base64.b64encode(bytes(data)).decode('utf-8')
        # thoughtSignature 也可能是 bytes
        ts = cleaned.get('thoughtSignature')
        if ts is not None and isinstance(ts, (bytes, bytearray)):
            cleaned['thoughtSignature'] = base64.b64encode(bytes(ts)).decode('utf-8')
        # 剥离 thoughtSignature（不传给前端，太大了）
        if strip_thought_signature:
            cleaned.pop('thoughtSignature', None)
            cleaned.pop('thought_signature', None)
        out.append(cleaned)
    return out

# ════════════════════════════════════════════════════════════════════
# Gemini 模型能力注册表
# 用于前端展示与后端调用时判断模型支持哪些媒体能力。
# 匹配规则：model 名中包含 key 中的关键词即命中（大小写不敏感）。
# 每条记录: {
#   'pattern': str,           # 模型名匹配模式（包含即命中）
#   'label': str,             # 前端展示名
#   'image': bool,            # 支持图像生成/编辑
#   'video': bool,            # 支持视频生成（Veo 系列）
#   'recommended': bool,      # 系统推荐
#   'note': str,              # 说明
# }
# ════════════════════════════════════════════════════════════════════
GEMINI_MODEL_CAPABILITIES: List[Dict[str, Any]] = [
    # ─── 图像模型 ───
    {
        'pattern': 'gemini-2.5-flash-image',
        'label': 'Gemini 2.5 Flash Image (Nano Banana)',
        'image': True, 'video': False, 'recommended': True,
        'note': 'Gemini 2.5 Flash 图像生成（推荐）',
    },
    {
        'pattern': 'gemini-2.0-flash-preview-image-generation',
        'label': 'Gemini 2.0 Flash Image',
        'image': True, 'video': False, 'recommended': True,
        'note': '2.0 Flash 图像生成预览版',
    },
    {
        'pattern': 'gemini-2.0-flash-exp',
        'label': 'Gemini 2.0 Flash Exp (Image)',
        'image': True, 'video': False, 'recommended': False,
        'note': '实验版，支持图像输出',
    },
    {
        'pattern': 'imagen-3',
        'label': 'Imagen 3',
        'image': True, 'video': False, 'recommended': True,
        'note': 'Google Imagen 3 专用图像模型',
    },
    {
        'pattern': 'imagen-4',
        'label': 'Imagen 4',
        'image': True, 'video': False, 'recommended': True,
        'note': 'Google Imagen 4 最新图像模型',
    },
    # ─── 视频模型 (Veo 系列，通过 Gemini API Key 调用) ───
    {
        'pattern': 'veo-2',
        'label': 'Veo 2',
        'image': False, 'video': True, 'recommended': True,
        'note': 'Google Veo 2 视频生成（通过 Gemini API）',
    },
    {
        'pattern': 'veo-3.1',
        'label': 'Veo 3.1',
        'image': False, 'video': True, 'recommended': True,
        'note': 'Google Veo 3.1 最新视频模型，支持参考图、首尾帧、视频续写',
    },
    {
        'pattern': 'veo-3',
        'label': 'Veo 3',
        'image': False, 'video': True, 'recommended': True,
        'note': 'Google Veo 3 视频生成，支持对话和音效',
    },
    # ─── 通用 fallback：模型名含 image 的 ───
    {
        'pattern': 'image',
        'label': 'Gemini Image (通用)',
        'image': True, 'video': False, 'recommended': False,
        'note': '模型名含 image 的通用图像模型',
    },
]


def get_model_capabilities(model_name: str) -> Dict[str, bool]:
    """查询模型的媒体能力。返回 {'image': bool, 'video': bool}。"""
    if not model_name:
        return {'image': False, 'video': False}
    name_lower = model_name.lower()
    # 精确匹配优先（pattern 越长越精确）
    sorted_caps = sorted(GEMINI_MODEL_CAPABILITIES, key=lambda c: -len(c['pattern']))
    for cap in sorted_caps:
        if cap['pattern'].lower() in name_lower:
            return {'image': cap.get('image', False), 'video': cap.get('video', False)}
    return {'image': False, 'video': False}


def _is_imagen_model(model_name: str) -> bool:
    """判断是否为 Imagen 系列模型。Imagen 使用 generate_images/:predict API，不支持 generateContent。"""
    if not model_name:
        return False
    name_lower = model_name.lower()
    return 'imagen-3' in name_lower or 'imagen-4' in name_lower


def _get_llm_service():
    from services.llm_service import get_llm_service
    return get_llm_service()


def _first_config_by_provider(provider: str, prefer_image_model: bool = False) -> Optional[dict]:
    """获取第一个已启用的指定 provider 的配置。
    优先级：media_purpose 标记 > 模型名含 image > 普通配置。
    """
    svc = _get_llm_service()
    configs = svc.get_all_configs(enabled_only=True, include_api_key=True)
    provider_configs = [c for c in configs if (c.get('provider') or '').lower() == provider.lower()]

    # 1. 优先 media_purpose 标记的配置
    for c in provider_configs:
        meta = c.get('metadata') or {}
        if meta.get('media_purpose'):
            if prefer_image_model:
                caps = meta.get('capabilities') or {}
                if caps.get('image_gen') or caps.get('image'):
                    return c
            else:
                return c

    # 2. 模型名含 image（legacy 兼容）
    if prefer_image_model and provider in ('gemini', 'google'):
        for c in provider_configs:
            model = (c.get('model') or '').lower()
            if 'image' in model:
                return c

    # 3. 任一配置
    return provider_configs[0] if provider_configs else None


def _create_genai_client(config: dict):
    """从 LLM 配置创建 google.genai.Client 实例，用于 Veo 视频生成。"""
    from google import genai
    api_key = config.get('api_key', '')
    base_url = (config.get('api_url') or '').rstrip('/')

    # 清理 URL 后缀
    if base_url:
        for suffix in ('/v1beta', '/v1', '/v1beta/', '/v1/'):
            if base_url.endswith(suffix):
                base_url = base_url[:-len(suffix)]
                break

    default_base = 'https://generativelanguage.googleapis.com'
    if base_url and base_url != default_base:
        try:
            return genai.Client(
                api_key=api_key,
                http_options={'base_url': base_url, 'api_version': 'v1beta'},
            )
        except Exception as e:
            logger.warning(f'[Gemini Video] 自定义 URL 创建客户端失败，回退默认: {e}')

    return genai.Client(api_key=api_key)


def _imagen_generate_via_sdk(client, model: str, prompt: str) -> Dict[str, Any]:
    """
    通过 google.genai Client 的 generate_images 调用 Imagen（仅文生图）。
    Imagen 不支持 generateContent，必须用此专用 API。
    """
    try:
        from google.genai import types as genai_types
        config = genai_types.GenerateImagesConfig(number_of_images=1)
        response = client.models.generate_images(
            model=model,
            prompt=prompt or 'A beautiful image',
            config=config,
        )
        generated = getattr(response, 'generated_images', None) or []
        media = []
        for gen in generated:
            img = getattr(gen, 'image', None) or gen
            raw = getattr(img, 'image_bytes', None)
            if raw is None and hasattr(img, '_image_bytes'):
                raw = getattr(img, '_image_bytes', None)
            if isinstance(raw, bytes):
                media.append({'type': 'image', 'mimeType': 'image/png', 'data': base64.b64encode(raw).decode('ascii')})
            elif isinstance(raw, str):
                media.append({'type': 'image', 'mimeType': 'image/png', 'data': raw})
            if media:
                break
        if media:
            return {'media': media, 'content': ''}
        return {'error': 'Imagen 未返回图像'}
    except Exception as e:
        logger.exception('[Imagen SDK] generate_images error')
        return {'error': str(e)}


def _imagen_generate_via_rest(api_key: str, base_url: str, model: str, prompt: str) -> Dict[str, Any]:
    """
    Imagen 通过 REST :predict 调用（与 Gemini generateContent 不同）。
    https://ai.google.dev/gemini-api/docs/imagen
    """
    url = (base_url or 'https://generativelanguage.googleapis.com').rstrip('/')
    for suffix in ('/v1beta', '/v1', '/v1beta/', '/v1/'):
        if url.endswith(suffix):
            url = url[:-len(suffix)]
            break
    predict_url = f'{url}/v1beta/models/{model}:predict'
    payload = {
        'instances': [{'prompt': prompt or 'A beautiful image'}],
        'parameters': {'sampleCount': 1},
    }
    headers = {'x-goog-api-key': api_key, 'Content-Type': 'application/json'}
    try:
        r = requests.post(predict_url, json=payload, headers=headers, timeout=120)
        if r.status_code != 200:
            return {'error': r.text or f'HTTP {r.status_code}'}
        data = r.json()
        predictions = data.get('predictions') or []
        media = []
        for pred in predictions:
            b64 = (
                pred.get('bytesBase64Encoded')
                or (pred.get('image') or {}).get('bytesBase64Encoded')
                or pred.get('imageBytes')
            )
            if b64:
                media.append({'type': 'image', 'mimeType': 'image/png', 'data': b64})
                break
        if media:
            return {'media': media, 'content': ''}
        return {'error': 'Imagen 响应中无图像', 'raw': data}
    except Exception as e:
        return {'error': str(e)}


def gemini_image_generate(prompt: str, config_id: Optional[str] = None, model: Optional[str] = None) -> Dict[str, Any]:
    """
    文生图（Gemini / Imagen）。
    - Gemini 图像模型（如 gemini-2.5-flash-image）：走 generateContent。
    - Imagen 模型（imagen-3.x / imagen-4.x）：走 generate_images/:predict，不支持 generateContent。
    Returns: {'media': [{'type':'image','mimeType':...,'data':base64}], 'content': str} or {'error': str}
    """
    try:
        svc = _get_llm_service()
        if config_id:
            config = svc.get_config(config_id, include_api_key=True)
        else:
            config = _first_config_by_provider('gemini', prefer_image_model=True)
        if not config or not config.get('api_key'):
            return {'error': 'No Gemini config or API key'}
        provider_type = (config.get('provider') or 'gemini').lower()
        if provider_type not in ('gemini', 'google'):
            return {'error': 'Config is not Gemini'}
        use_model = model or config.get('model') or 'gemini-2.5-flash-image'

        # Imagen 系列：使用 generate_images API，不能用 generateContent
        if _is_imagen_model(use_model):
            client = _create_genai_client(config)
            result = _imagen_generate_via_sdk(client, use_model, prompt or '请生成一张图')
            err = (result.get('error') or '').lower()
            # SDK 无 generate_images 或服务端返回 not supported/404 时回退 REST :predict
            if 'error' in result and any(
                x in err for x in ('generate_content', 'not supported', 'not found', '404', 'generate_images', 'attribute')
            ):
                base_url = (config.get('api_url') or '').rstrip('/') or 'https://generativelanguage.googleapis.com'
                result = _imagen_generate_via_rest(
                    config['api_key'], base_url, use_model, prompt or '请生成一张图'
                )
            return result

        # Gemini 图像模型：走 generateContent
        provider = create_provider(
            provider_type=provider_type,
            api_key=config['api_key'],
            api_url=config.get('api_url'),
            model=use_model,
            **(config.get('metadata') or {})
        )
        llm_messages = [
            LLMMessage(role='system', content='你是一个 AI 画师。根据用户的文字描述生成一张图片。只输出图像，不要输出多余文字。'),
            LLMMessage(role='user', content=prompt or '请生成一张图'),
        ]
        resp = provider.chat(llm_messages)
        media = getattr(resp, 'media', None) or []
        for item in media:
            if (item or {}).get('type') == 'image' and (item or {}).get('data'):
                return {'media': _ensure_media_json_serializable([item]), 'content': (resp.content or '').strip()}
        return {'error': '模型未返回图像', 'content': (resp.content or '').strip()}
    except Exception as e:
        return {'error': str(e)}


def gemini_image_edit(prompt: str, image_b64: Optional[str] = None,
                      images_b64: Optional[List[str]] = None,
                      config_id: Optional[str] = None,
                      model: Optional[str] = None, thought_signature: Optional[str] = None) -> Dict[str, Any]:
    """
    图生图（Gemini）：支持单张或多张参考图。
    - image_b64: 单张兼容（向后兼容）
    - images_b64: 多张参考图 base64 列表
    - Imagen 系列仅支持文生图，不支持图生图；此处会返回友好错误并建议使用 Gemini 图像模型。
    """
    try:
        svc = _get_llm_service()
        if config_id:
            config = svc.get_config(config_id, include_api_key=True)
        else:
            config = _first_config_by_provider('gemini', prefer_image_model=True)
        if not config or not config.get('api_key'):
            return {'error': 'No Gemini config or API key'}
        provider_type = (config.get('provider') or 'gemini').lower()
        if provider_type not in ('gemini', 'google'):
            return {'error': 'Config is not Gemini'}
        use_model = model or config.get('model') or 'gemini-2.5-flash-image'

        # Imagen 不支持图生图/参考图编辑，仅支持文生图
        if _is_imagen_model(use_model):
            return {
                'error': '当前选择的 Imagen 模型仅支持「文生图」，不支持图生图或参考图编辑。请改用 Gemini 图像模型（如 gemini-2.5-flash-image）进行图生图，或使用「文生图」功能。',
            }

        provider = create_provider(
            provider_type=provider_type,
            api_key=config['api_key'],
            api_url=config.get('api_url'),
            model=use_model,
            **(config.get('metadata') or {})
        )

        # 构建参考图列表（多图优先，否则回退单图）
        raw_images = images_b64 if images_b64 else ([image_b64] if image_b64 else [])
        user_media = []
        for raw in raw_images:
            if not raw:
                continue
            data = raw.strip()
            if data.startswith('data:'):
                if ';base64,' in data:
                    data = data.split(';base64,', 1)[1]
                else:
                    data = data.split(',', 1)[-1]
            item = {'type': 'image', 'mimeType': 'image/png', 'data': data}
            if thought_signature:
                item['thoughtSignature'] = thought_signature
            user_media.append(item)

        num_images = len(user_media)
        sys_prompt = (
            '你是一个 AI 画师。根据用户提供的参考图和文字描述，生成或修改出一张新图。只输出图像。'
            if num_images <= 1 else
            f'你是一个 AI 画师。用户提供了 {num_images} 张参考图和文字描述。请综合所有参考图的元素和风格，生成一张新图。只输出图像。'
        )

        llm_messages = [
            LLMMessage(role='system', content=sys_prompt),
            LLMMessage(role='user', content=prompt or '请根据上图生成', media=user_media or None),
        ]
        resp = provider.chat(llm_messages)
        media = getattr(resp, 'media', None) or []
        for item in media:
            if (item or {}).get('type') == 'image' and (item or {}).get('data'):
                return {'media': _ensure_media_json_serializable([item]), 'content': (resp.content or '').strip()}
        return {'error': '模型未返回图像', 'content': (resp.content or '').strip()}
    except Exception as e:
        return {'error': str(e)}


def gemini_video_submit(prompt: str, image_b64: Optional[str] = None,
                        config_id: Optional[str] = None,
                        model: Optional[str] = None) -> Dict[str, Any]:
    """
    通过 google-genai SDK 提交 Veo 视频生成任务。
    参考: https://ai.google.dev/gemini-api/docs/video

    使用 SDK 的 client.models.generate_videos() 方法，自动处理请求格式，
    避免 REST API 手动拼装导致的 inlineData 等格式问题。

    Args:
        prompt: 视频描述
        image_b64: 可选首帧图片 (base64 或 data URI)
        config_id: 指定使用的 LLM 配置 ID
        model: 覆盖模型名（默认取 config 中的模型）

    Returns: {'task_name': str} or {'error': str}
    """
    try:
        from google.genai import types as genai_types

        svc = _get_llm_service()
        if config_id:
            config = svc.get_config(config_id, include_api_key=True)
        else:
            # 优先找 Veo 模型的配置
            all_configs = svc.get_all_configs(enabled_only=True, include_api_key=True)
            config = None
            for c in all_configs:
                if (c.get('provider') or '').lower() not in ('gemini', 'google'):
                    continue
                caps = get_model_capabilities(c.get('model') or '')
                if caps['video']:
                    config = c
                    break
            # fallback: 任何 Gemini 配置
            if not config:
                config = _first_config_by_provider('gemini')
        if not config or not config.get('api_key'):
            return {'error': '未找到 Gemini 配置或 API Key，请在「大模型录入」中添加 Gemini/Veo 模型配置'}

        client = _create_genai_client(config)
        use_model = model or config.get('model') or 'veo-3.1-generate-preview'

        # 构建图片参数（首帧）
        image_obj = None
        if image_b64:
            raw = image_b64.strip()
            mime_type = 'image/png'
            if raw.startswith('data:'):
                header_part = raw.split(';base64,', 1)[0] if ';base64,' in raw else ''
                if header_part.startswith('data:'):
                    mime_type = header_part[5:] or 'image/png'
                if ';base64,' in raw:
                    raw = raw.split(';base64,', 1)[1]
                else:
                    raw = raw.split(',', 1)[-1]
            try:
                image_obj = genai_types.Image(
                    image_bytes=base64.b64decode(raw),
                    mime_type=mime_type,
                )
            except (TypeError, AttributeError):
                # 兼容不同版本 SDK，使用 dict fallback
                image_obj = {
                    'image_bytes': base64.b64decode(raw),
                    'mime_type': mime_type,
                }

        logger.info(f'[Gemini Video SDK] Submitting model={use_model}, has_image={image_obj is not None}')

        operation = client.models.generate_videos(
            model=use_model,
            prompt=prompt or '',
            image=image_obj,
        )

        task_name = getattr(operation, 'name', '') or ''
        if not task_name:
            return {'error': '未返回任务 ID'}

        logger.info(f'[Gemini Video SDK] Task submitted: {task_name}')
        return {'task_name': task_name, 'model': use_model}

    except Exception as e:
        logger.exception('[Gemini Video SDK] Submit error')
        err_str = str(e)
        # 对常见错误提供更友好的提示
        if '403' in err_str and 'SERVICE_DISABLED' in err_str:
            return {
                'error': '您的 API Key 所属 GCP 项目未启用 Generative Language API。'
                         '请访问 Google Cloud Console → API 库 → 搜索 "Generative Language API" → 点击启用，'
                         '等待几分钟后重试。',
            }
        if '403' in err_str:
            return {'error': f'API 权限不足 (403)，请检查 API Key 权限或项目设置。详情: {err_str[:300]}'}
        if '404' in err_str:
            return {'error': f'API 端点不存在 (404)，可能模型名称不正确或未开放。详情: {err_str[:300]}'}
        return {'error': err_str}


def gemini_video_status(task_name: str, config_id: Optional[str] = None) -> Dict[str, Any]:
    """
    通过 google-genai SDK 查询 Veo 视频任务状态。

    Args:
        task_name: 任务名称 (operations/xxx)
        config_id: 指定使用的 LLM 配置 ID（用于获取 API Key）

    Returns: {'status': str, 'output': str?, 'progress': float?, 'error': str?}
    """
    try:
        from google.genai import types as genai_types

        svc = _get_llm_service()
        if config_id:
            config = svc.get_config(config_id, include_api_key=True)
        else:
            config = _first_config_by_provider('gemini')
        if not config or not config.get('api_key'):
            return {'error': 'Gemini API Key 未配置', 'status': 'FAILED'}

        client = _create_genai_client(config)

        # 从 task_name 重建 operation 并查询状态
        op = genai_types.GenerateVideosOperation(name=task_name)
        op = client.operations.get(op)

        def _extract_video_uri(obj: Any) -> Optional[str]:
            """Best-effort extract video URI from various SDK response shapes."""
            if obj is None:
                return None
            # common object attributes
            video = getattr(obj, 'video', None)
            if video is not None:
                uri = getattr(video, 'uri', None) or getattr(video, 'video_uri', None)
                if uri:
                    return uri
            uri = (
                getattr(obj, 'uri', None)
                or getattr(obj, 'video_uri', None)
                or getattr(obj, 'videoUri', None)
            )
            if uri:
                return uri
            # dict-like fallback
            if isinstance(obj, dict):
                if obj.get('uri') or obj.get('video_uri') or obj.get('videoUri'):
                    return obj.get('uri') or obj.get('video_uri') or obj.get('videoUri')
                if isinstance(obj.get('video'), dict):
                    v = obj.get('video') or {}
                    return v.get('uri') or v.get('video_uri') or v.get('videoUri')
            return None

        def _extract_payload_dict(obj: Any) -> Dict[str, Any]:
            """尽量把 SDK 对象转成可遍历字典，用于日志与兜底解析。"""
            if obj is None:
                return {}
            if isinstance(obj, dict):
                return obj
            for method_name in ('model_dump', 'to_dict', 'dict'):
                method = getattr(obj, method_name, None)
                if callable(method):
                    try:
                        data = method()
                        if isinstance(data, dict):
                            return data
                    except Exception:
                        pass
            to_json = getattr(obj, 'to_json', None)
            if callable(to_json):
                try:
                    import json
                    raw = to_json()
                    data = json.loads(raw) if isinstance(raw, str) else raw
                    if isinstance(data, dict):
                        return data
                except Exception:
                    pass
            data = getattr(obj, '__dict__', None)
            return data if isinstance(data, dict) else {}

        def _search_uri_tree(obj: Any, max_nodes: int = 2000) -> Optional[str]:
            """Breadth-first search for keys that look like video uri."""
            queue = [obj]
            seen = 0
            while queue and seen < max_nodes:
                cur = queue.pop(0)
                seen += 1
                uri = _extract_video_uri(cur)
                if uri:
                    return uri
                if isinstance(cur, dict):
                    queue.extend(cur.values())
                elif isinstance(cur, (list, tuple)):
                    queue.extend(list(cur))
                else:
                    # try object __dict__ to inspect nested attrs
                    data = getattr(cur, '__dict__', None)
                    if isinstance(data, dict):
                        queue.extend(data.values())
            return None

        def _compact_json(obj: Any, max_len: int = 4000) -> str:
            """用于日志：尽量序列化对象并截断，避免日志过大。"""
            try:
                import json
                payload = _extract_payload_dict(obj)
                s = json.dumps(payload, ensure_ascii=False, default=str)
            except Exception:
                try:
                    s = str(obj)
                except Exception:
                    s = '<unserializable>'
            return s[:max_len]

        done = getattr(op, 'done', False)
        if done:
            # 检查错误
            error = getattr(op, 'error', None)
            if error:
                err_msg = getattr(error, 'message', None) or str(error)
                return {'status': 'FAILED', 'error': err_msg}

            # 提取视频 URI
            response = getattr(op, 'response', None)
            generated_videos = getattr(response, 'generated_videos', []) if response else []
            if generated_videos:
                video_obj = generated_videos[0]
                video_uri = _extract_video_uri(video_obj)
                if not video_uri:
                    video_uri = _search_uri_tree(video_obj)
                if video_uri:
                    return {
                        'status': 'SUCCEEDED',
                        'output': video_uri,
                    }

            # 兼容 SDK/返回字段变化（如 preview 版本）
            for candidate in (
                response,
                getattr(op, 'result', None),
                getattr(op, 'response', None),
                getattr(op, 'metadata', None),
                getattr(op, '__dict__', None),
            ):
                video_uri = _search_uri_tree(candidate)
                if video_uri:
                    return {
                        'status': 'SUCCEEDED',
                        'output': video_uri,
                    }

            # SDK 解析不到时，回退 REST operations.get 再查一次（部分版本字段映射有差异）
            api_key = config.get('api_key') or ''
            base_url = (config.get('api_url') or 'https://generativelanguage.googleapis.com').rstrip('/')
            for suffix in ('/v1beta', '/v1', '/v1beta/', '/v1/'):
                if base_url.endswith(suffix):
                    base_url = base_url[:-len(suffix)]
                    break
            op_path = task_name.lstrip('/')
            rest_url = f'{base_url}/v1beta/{op_path}'
            try:
                r = requests.get(
                    rest_url,
                    headers={'x-goog-api-key': api_key, 'Content-Type': 'application/json'},
                    timeout=30,
                )
                if r.status_code == 200:
                    payload = r.json()
                    video_uri = _search_uri_tree(payload)
                    if video_uri:
                        return {'status': 'SUCCEEDED', 'output': video_uri}
                    logger.warning(
                        '[Gemini Video SDK] SUCCEEDED but no URI. REST payload keys=%s task=%s',
                        list(payload.keys())[:20], task_name
                    )
                else:
                    logger.warning(
                        '[Gemini Video SDK] REST fallback failed status=%s task=%s body=%s',
                        r.status_code, task_name, (r.text or '')[:500]
                    )
            except Exception as rest_err:
                logger.warning('[Gemini Video SDK] REST fallback exception task=%s err=%s', task_name, rest_err)

            # 记录 SDK/REST 关键结构，便于后续定位
            logger.warning(
                '[Gemini Video SDK] SUCCEEDED but no URI. task=%s op_keys=%s response_keys=%s metadata_keys=%s op_json=%s response_json=%s metadata_json=%s',
                task_name,
                list(_extract_payload_dict(op).keys())[:20],
                list(_extract_payload_dict(response).keys())[:20],
                list(_extract_payload_dict(getattr(op, 'metadata', None)).keys())[:20],
                _compact_json(op),
                _compact_json(response),
                _compact_json(getattr(op, 'metadata', None)),
            )
            return {
                # 某些 Veo preview 任务会先标记 done，再异步补齐可下载 URI；
                # 返回 PROCESSING 让前端继续轮询，避免提前终止为“无视频地址”。
                'status': 'PROCESSING',
                'output': None,
                'error': '任务已完成但视频地址尚未就绪，继续轮询中',
            }
        else:
            return {'status': 'PROCESSING'}

    except Exception as e:
        logger.exception('[Gemini Video SDK] Status error')
        return {'error': str(e), 'status': 'UNKNOWN'}


def gemini_video_download(video_uri: str, config_id: Optional[str] = None) -> Dict[str, Any]:
    """
    代理下载 Gemini Veo 生成的视频。
    根据官方文档，下载视频 URI 需要附带 x-goog-api-key header。
    返回视频的二进制内容和 content-type，或错误信息。

    Returns: {'data': bytes, 'content_type': str} or {'error': str}
    """
    try:
        svc = _get_llm_service()
        if config_id:
            config = svc.get_config(config_id, include_api_key=True)
        else:
            config = _first_config_by_provider('gemini')
        if not config or not config.get('api_key'):
            return {'error': 'Gemini API Key 未配置'}

        api_key = config['api_key']
        headers = {
            'x-goog-api-key': api_key,
        }

        logger.info(f'[Gemini Video] Downloading video from: {video_uri[:100]}...')
        r = requests.get(video_uri, headers=headers, timeout=120, allow_redirects=True)
        if r.status_code != 200:
            err_text = r.text[:300] if r.text else f'HTTP {r.status_code}'
            logger.error(f'[Gemini Video] Download failed: {err_text}')
            return {'error': f'视频下载失败 (HTTP {r.status_code})'}

        content_type = r.headers.get('Content-Type', 'video/mp4')
        logger.info(f'[Gemini Video] Downloaded {len(r.content)} bytes, type={content_type}')
        return {'data': r.content, 'content_type': content_type}

    except Exception as e:
        logger.exception('[Gemini Video] Download error')
        return {'error': str(e)}


def openai_image_generations(prompt: str, config_id: Optional[str] = None,
                             model: Optional[str] = None, size: Optional[str] = None,
                             response_format: Optional[str] = None) -> Dict[str, Any]:
    """
    文生图（OpenAI DALL·E / GPT Image）。
    Returns: {'media': [{'type':'image','mimeType':'image/png','data':base64}], 'url': ...} or {'error': str}
    """
    try:
        svc = _get_llm_service()
        if config_id:
            config = svc.get_config(config_id, include_api_key=True)
        else:
            config = _first_config_by_provider('openai')
        if not config or not config.get('api_key'):
            return {'error': 'No OpenAI config or API key'}
        api_key = config['api_key']
        base_url = (config.get('api_url') or 'https://api.openai.com/v1').rstrip('/')
        if '/v1' not in base_url and not base_url.endswith('/v1'):
            base_url = base_url + '/v1'
        url = f"{base_url}/images/generations"
        use_model = model or 'dall-e-3'
        payload = {
            'model': use_model,
            'prompt': prompt or 'a cute cat',
            'n': 1,
        }
        if size:
            payload['size'] = size
        if response_format:
            payload['response_format'] = response_format
        if use_model.lower().startswith('dall-e-3'):
            payload.setdefault('size', '1024x1024')
            payload.setdefault('quality', 'standard')
        headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
        r = requests.post(url, json=payload, headers=headers, timeout=120)
        if r.status_code != 200:
            return {'error': r.text or f'HTTP {r.status_code}'}
        data = r.json()
        out_media = []
        for item in data.get('data', []):
            b64 = item.get('b64_json')
            url_val = item.get('url')
            if b64:
                out_media.append({'type': 'image', 'mimeType': 'image/png', 'data': b64})
            elif url_val:
                out_media.append({'type': 'image', 'mimeType': 'image/png', 'url': url_val})
        if not out_media:
            return {'error': 'No image in response', 'raw': data}
        return {'media': out_media, 'raw': data}
    except Exception as e:
        return {'error': str(e)}


def list_media_providers() -> Dict[str, Any]:
    """
    返回已配置的媒体供应商及能力，每个 config 附带 capabilities 标记。
    Returns: {
        'providers': [{
            'id': str,
            'name': str,
            'image': {...},
            'video': {...},
            'configs': [{
                'config_id': str,
                'name': str,
                'model': str,
                'provider': str,
                'capabilities': {'image': bool, 'video': bool},
            }, ...]
        }, ...],
        'model_registry': [...]   # 系统支持的 Gemini 模型能力表
    }
    """
    providers = []
    try:
        svc = _get_llm_service()
        # 获取所有配置（包括禁用的），因为 media_purpose 配置可能不用于聊天而 enabled=True
        all_configs = svc.get_all_configs(enabled_only=False, include_api_key=False)

        # 过滤规则：
        # 1. 有 media_purpose 标记的配置（无论 enabled 状态）
        # 2. 已启用的配置（兼容旧流程）
        def is_media_eligible(c: dict) -> bool:
            meta = c.get('metadata') or {}
            if meta.get('media_purpose'):
                return True
            return c.get('enabled', False)

        configs = [c for c in all_configs if is_media_eligible(c)]

        # Gemini / Google — 按模型能力标注
        gemini_configs = []
        has_image = False
        has_video = False
        seen_ids = set()
        for c in configs:
            if (c.get('provider') or '').lower() not in ('gemini', 'google'):
                continue
            if c['config_id'] in seen_ids:
                continue
            seen_ids.add(c['config_id'])
            model = c.get('model') or ''
            meta = c.get('metadata') or {}
            # 优先使用 metadata 中存储的能力（来自前端录入），回退到模式匹配
            meta_caps = meta.get('capabilities') or {}
            if meta_caps.get('image_gen') is not None or meta_caps.get('video_gen') is not None:
                caps = {
                    'image': bool(meta_caps.get('image_gen')),
                    'video': bool(meta_caps.get('video_gen')),
                }
            else:
                caps = get_model_capabilities(model)
            gemini_configs.append({
                'config_id': c['config_id'],
                'name': c.get('name', ''),
                'model': model,
                'provider': c.get('provider', ''),
                'capabilities': caps,
                'media_purpose': bool(meta.get('media_purpose')),
            })
            if caps['image']:
                has_image = True
            if caps['video']:
                has_video = True
        if gemini_configs:
            providers.append({
                'id': 'gemini',
                'name': 'Gemini',
                'image': {'generate': has_image, 'edit': has_image} if has_image else {},
                'video': {'submit': has_video, 'status': has_video} if has_video else {},
                'configs': gemini_configs,
            })

        # OpenAI 媒体创作已移除（仅保留 Gemini）
    except Exception:
        pass

    # Runway: 从 config.yaml media.runway.api_key 判断
    cfg = _load_media_config()
    if (cfg.get('runway') or {}).get('api_key'):
        providers.append({
            'id': 'runway',
            'name': 'Runway',
            'image': {},
            'video': {'submit': True, 'status': True},
            'configs': [{
                'config_id': 'runway_default', 'name': 'Runway',
                'model': 'gen4_turbo', 'provider': 'runway',
                'capabilities': {'image': False, 'video': True},
            }],
        })

    # 返回模型能力注册表供前端参考
    registry = [
        {k: v for k, v in cap.items() if k != 'pattern'}
        for cap in GEMINI_MODEL_CAPABILITIES
        if cap.get('recommended')
    ]
    return {'providers': providers, 'model_registry': registry}


def _load_media_config() -> dict:
    """从 config.yaml 读取 media 配置。"""
    try:
        from pathlib import Path
        import yaml
        path = Path(__file__).resolve().parent.parent / 'config.yaml'
        if path.exists():
            with open(path, 'r', encoding='utf-8') as f:
                cfg = yaml.safe_load(f) or {}
                return cfg.get('media') or {}
    except Exception:
        pass
    return {}


def runway_video_submit(prompt_text: Optional[str] = None, prompt_image: Optional[str] = None,
                        model: str = 'gen4_turbo', ratio: str = '1280:720',
                        duration: Optional[int] = None) -> Dict[str, Any]:
    """
    提交 Runway 图生视频或文生视频。prompt_image 为 data URI / HTTPS URL 时走 image_to_video；
    仅 prompt_text 时走 text_to_video。
    Returns: {'task_id': str} or {'error': str}
    """
    cfg = _load_media_config().get('runway') or {}
    api_key = (cfg.get('api_key') or '').strip() or None
    if not api_key:
        return {'error': 'Runway API key not configured (media.runway.api_key in config.yaml)'}
    base = (cfg.get('api_base') or 'https://api.runwayml.com').rstrip('/')
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json',
        'X-Runway-Version': '2024-11-06',
    }
    if prompt_image:
        url = f'{base}/v1/image_to_video'
        body = {
            'model': model,
            'promptImage': prompt_image,
            'ratio': ratio,
        }
        if prompt_text:
            body['promptText'] = prompt_text[:1000]
        if duration is not None and 2 <= duration <= 10:
            body['duration'] = duration
        try:
            r = requests.post(url, json=body, headers=headers, timeout=60)
            if r.status_code != 200:
                return {'error': r.text or f'HTTP {r.status_code}'}
            data = r.json()
            task_id = data.get('id')
            if not task_id:
                return {'error': 'No task id in response', 'raw': data}
            return {'task_id': task_id}
        except Exception as e:
            return {'error': str(e)}
    else:
        url = f'{base}/v1/text_to_video'
        body = {
            'model': model if model in ('veo3.1', 'veo3.1_fast', 'veo3') else 'veo3.1',
            'promptText': (prompt_text or '')[:1000] or 'A beautiful scene',
            'ratio': ratio,
        }
        if duration in (4, 6, 8):
            body['duration'] = duration
        try:
            r = requests.post(url, json=body, headers=headers, timeout=60)
            if r.status_code != 200:
                return {'error': r.text or f'HTTP {r.status_code}'}
            data = r.json()
            task_id = data.get('id')
            if not task_id:
                return {'error': 'No task id in response', 'raw': data}
            return {'task_id': task_id}
        except Exception as e:
            return {'error': str(e)}


def runway_video_status(task_id: str) -> Dict[str, Any]:
    """查询 Runway 任务状态。Returns: {'status': str, 'output': url or null, 'error': str?}"""
    cfg = _load_media_config().get('runway') or {}
    api_key = (cfg.get('api_key') or '').strip() or None
    if not api_key:
        return {'error': 'Runway API key not configured'}
    base = (cfg.get('api_base') or 'https://api.runwayml.com').rstrip('/')
    url = f'{base}/v1/tasks/{task_id}'
    headers = {'Authorization': f'Bearer {api_key}', 'X-Runway-Version': '2024-11-06'}
    try:
        r = requests.get(url, headers=headers, timeout=30)
        if r.status_code != 200:
            return {'error': r.text or f'HTTP {r.status_code}', 'status': 'unknown'}
        data = r.json()
        status = data.get('status') or data.get('state') or 'unknown'
        output = None
        if data.get('output'):
            output = data.get('output')
        elif isinstance(data.get('result'), dict) and data.get('result', {}).get('output'):
            output = data['result']['output']
        return {'status': status, 'output': output, 'raw': data}
    except Exception as e:
        return {'error': str(e), 'status': 'unknown'}


def openai_image_edits(prompt: str, image_b64: Optional[str] = None, image_mime: Optional[str] = None,
                       config_id: Optional[str] = None, model: Optional[str] = None) -> Dict[str, Any]:
    """
    图生图/编辑（OpenAI Images Edits）。需 multipart 或 JSON with image. 此处用 JSON 传 base64 需看 OpenAI 是否支持；
    文档多为 multipart。为简单先使用 multipart：image 为文件上传或 base64 写入临时文件。
    """
    try:
        svc = _get_llm_service()
        if config_id:
            config = svc.get_config(config_id, include_api_key=True)
        else:
            config = _first_config_by_provider('openai')
        if not config or not config.get('api_key'):
            return {'error': 'No OpenAI config or API key'}
        api_key = config['api_key']
        base_url = (config.get('api_url') or 'https://api.openai.com/v1').rstrip('/')
        if '/v1' not in base_url:
            base_url = base_url + '/v1'
        url = f"{base_url}/images/edits"
        use_model = model or 'gpt-image-1.5'
        if not image_b64:
            return {'error': 'image_b64 or image file required'}
        # OpenAI edits 通常要求 multipart: image=file, prompt=text
        import tempfile
        import os
        data = image_b64.strip()
        if data.startswith('data:'):
            if ';base64,' in data:
                data = data.split(';base64,', 1)[1]
            else:
                data = data.split(',', 1)[-1]
        raw = base64.b64decode(data)
        ext = 'png' if (image_mime or '').find('png') >= 0 else 'jpg'
        with tempfile.NamedTemporaryFile(suffix=f'.{ext}', delete=False) as f:
            f.write(raw)
            path = f.name
        try:
            with open(path, 'rb') as f:
                files = {'image': (f'image.{ext}', f, image_mime or f'image/{ext}')}
                payload = {'prompt': prompt or 'edit this image', 'model': use_model}
                headers = {'Authorization': f'Bearer {api_key}'}
                r = requests.post(url, data=payload, files=files, timeout=120)
            if r.status_code != 200:
                return {'error': r.text or f'HTTP {r.status_code}'}
            data = r.json()
            out_media = []
            for item in data.get('data', []):
                b64 = item.get('b64_json')
                url_val = item.get('url')
                if b64:
                    out_media.append({'type': 'image', 'mimeType': 'image/png', 'data': b64})
                elif url_val:
                    out_media.append({'type': 'image', 'mimeType': 'image/png', 'url': url_val})
            if not out_media:
                return {'error': 'No image in response', 'raw': data}
            return {'media': out_media, 'raw': data}
        finally:
            try:
                os.unlink(path)
            except Exception:
                pass
    except Exception as e:
        return {'error': str(e)}
