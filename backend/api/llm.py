"""
LLM 配置 API 路由
"""

from flask import Blueprint, request, jsonify, Response
import base64
import json
import requests
from urllib.parse import quote
import pymysql.cursors

from services.llm_service import get_llm_service
from utils.cors import get_cors_headers
from database import get_mysql_connection

# 创建 Blueprint
llm_bp = Blueprint('llm', __name__)

# Provider 到 LobeHub icon slug 的映射
PROVIDER_LOBEHUB_SLUG = {
    'openai': 'openai',
    'anthropic': 'anthropic',
    'gemini': 'google',  # Google Gemini 使用 google slug
    'google': 'google',
    'deepseek': 'deepseek',
    'ollama': 'ollama',
}


def infer_model_capabilities(model_id: str, provider: str = None) -> dict:
    """
    推断模型能力（识图/生图/生视频）
    
    Args:
        model_id: 模型 ID
        provider: Provider 类型（可选，用于更精确的推断）
    
    Returns:
        {
            'vision': bool,      # 是否支持识图
            'image_gen': bool,   # 是否支持生图
            'video_gen': bool,  # 是否支持生视频
        }
    """
    model_lower = model_id.lower()
    
    # 默认能力（基于已知模型）
    capabilities = {
        'vision': False,
        'image_gen': False,
        'video_gen': False,
    }
    
    # 基于模型名推断
    # 识图能力：包含 vision, multimodal, image, gpt-4o, gpt-4-turbo, claude-3, gemini-1.5, gemini-2.0
    vision_keywords = ['vision', 'multimodal', 'image', 'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision', 
                       'claude-3', 'claude-3.5', 'gemini-1.5', 'gemini-2.0', 'gemini-pro', 
                       'gemini-flash', 'o1', 'o1-mini', 'o3', 'o3-mini']
    if any(kw in model_lower for kw in vision_keywords):
        capabilities['vision'] = True
    
    # 生图能力：包含 image, image-generation, dalle, midjourney, stable-diffusion, flux
    image_gen_keywords = ['image-generation', 'dalle', 'midjourney', 'stable-diffusion', 
                         'flux', 'imagen', 'gemini-2.0-flash-image', 'gemini-2.5-flash-image',
                         'gemini-3-pro-image', 'image-gen', 'text-to-image']
    if any(kw in model_lower for kw in image_gen_keywords):
        capabilities['image_gen'] = True
    
    # 生视频能力：包含 video, video-generation, runway, pika, sora, veo
    video_gen_keywords = ['video-generation', 'runway', 'pika', 'sora', 'veo', 
                         'video-gen', 'text-to-video', 'gemini-2.0-flash-video']
    if any(kw in model_lower for kw in video_gen_keywords):
        capabilities['video_gen'] = True
    
    # Provider 特定的默认能力
    if provider:
        provider_lower = provider.lower()
        if provider_lower in ['gemini', 'google']:
            # Gemini 模型默认支持识图
            if 'gemini' in model_lower:
                capabilities['vision'] = True
        elif provider_lower in ['openai']:
            # OpenAI GPT-4o 系列默认支持识图
            if 'gpt-4o' in model_lower or 'gpt-4-turbo' in model_lower:
                capabilities['vision'] = True
        elif provider_lower in ['anthropic']:
            # Claude 3+ 系列默认支持识图
            if 'claude-3' in model_lower or 'claude-3.5' in model_lower:
                capabilities['vision'] = True
    
    return capabilities


def safe_infer_model_capabilities(model_id: str, provider: str = None):
    """
    安全获取模型能力。失败时记录日志并返回 None，避免影响主流程。
    """
    try:
        return infer_model_capabilities(model_id, provider)
    except Exception as e:
        print(f"[LLM Models] Failed to infer capabilities for {model_id}: {e}")
        return None


def build_model_with_capabilities(model_id: str, provider: str = None) -> dict:
    item = {'id': model_id}
    capabilities = safe_infer_model_capabilities(model_id, provider)
    if capabilities is not None:
        item['capabilities'] = capabilities
    return item


@llm_bp.route('/configs', methods=['GET'])
def get_configs():
    """获取所有 LLM 配置"""
    try:
        service = get_llm_service()
        enabled_only = request.args.get('enabled', 'false').lower() == 'true'
        configs = service.get_all_configs(enabled_only=enabled_only)
        # 返回格式与原始 API 保持一致
        return jsonify({'configs': configs, 'total': len(configs)})
    except Exception as e:
        return jsonify({'configs': [], 'total': 0, 'error': str(e)}), 500


@llm_bp.route('/configs/<config_id>', methods=['GET'])
def get_config(config_id):
    """获取单个 LLM 配置"""
    try:
        service = get_llm_service()
        config = service.get_config(config_id)
        if config:
            return jsonify(config)
        return jsonify({'error': 'Config not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/configs', methods=['POST'])
def create_config():
    """创建 LLM 配置"""
    try:
        service = get_llm_service()
        data = request.get_json()
        config = service.create_config(data)
        # 返回格式与原始 API 保持一致
        return jsonify({
            'config_id': config.get('config_id'),
            'message': 'Config created successfully'
        }), 201
    except ValueError as e:
        error_msg = str(e)
        print(f"[LLM API] Validation error: {error_msg}")
        return jsonify({'error': {'message': error_msg}}), 400
    except Exception as e:
        import traceback
        error_msg = str(e)
        error_trace = traceback.format_exc()
        print(f"[LLM API] Failed to create LLM config: {error_msg}")
        print(f"[LLM API] Traceback:\n{error_trace}")
        # 返回更详细的错误信息
        return jsonify({
            'error': {
                'message': f'Failed to create LLM config: {error_msg}',
                'type': type(e).__name__
            }
        }), 500


@llm_bp.route('/configs/<config_id>', methods=['PUT'])
def update_config(config_id):
    """更新 LLM 配置"""
    try:
        service = get_llm_service()
        data = request.get_json()
        config = service.update_config(config_id, data)
        if config:
            # 返回格式与原始 API 保持一致
            return jsonify({'message': 'Config updated successfully'})
        return jsonify({'error': {'message': 'Config not found'}}), 404
    except Exception as e:
        return jsonify({'error': {'message': str(e)}}), 500


@llm_bp.route('/configs/<config_id>', methods=['DELETE'])
def delete_config(config_id):
    """删除 LLM 配置"""
    try:
        service = get_llm_service()
        if service.delete_config(config_id):
            # 返回格式与原始 API 保持一致
            return jsonify({'message': 'Config deleted successfully'})
        return jsonify({'error': {'message': 'Config not found'}}), 404
    except Exception as e:
        return jsonify({'error': {'message': str(e)}}), 500


@llm_bp.route('/configs/<config_id>/api-key', methods=['GET'])
def get_api_key(config_id):
    """
    获取配置的 API Key
    安全接口：应该在前端需要调用 LLM 时才请求
    注意：使用 /api-key 路径与原始 API 保持一致
    """
    try:
        service = get_llm_service()
        api_key = service.get_api_key(config_id)
        if api_key is not None:
            return jsonify({'api_key': api_key})
        return jsonify({'error': {'message': 'Config not found'}}), 404
    except Exception as e:
        return jsonify({'error': {'message': str(e)}}), 500


# 为了向后兼容，同时支持 /key 路径
@llm_bp.route('/configs/<config_id>/key', methods=['GET'])
def get_api_key_compat(config_id):
    """获取配置的 API Key（向后兼容路径）"""
    return get_api_key(config_id)


@llm_bp.route('/configs/<config_id>/toggle', methods=['POST'])
def toggle_config(config_id):
    """切换配置启用状态"""
    try:
        service = get_llm_service()
        data = request.get_json()
        enabled = data.get('enabled', True)
        config = service.toggle_enabled(config_id, enabled)
        if config:
            return jsonify(config)
        return jsonify({'error': 'Config not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/generate-avatar', methods=['POST', 'OPTIONS'])
def generate_avatar():
    """
    使用 LLM 生成头像
    请求体: { "config_id": "...", "description": "...", "name": "..." }
    """
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    try:
        data = request.get_json()
        config_id = data.get('config_id')
        description = data.get('description', '')
        name = data.get('name', '智能体')
        
        if not config_id:
            return jsonify({'error': 'config_id is required'}), 400
        if not description:
            return jsonify({'error': 'description is required'}), 400
        
        service = get_llm_service()
        
        # 调用生成头像
        result = service.generate_avatar(config_id, name, description)
        
        if result.get('success'):
            avatar_data = result.get('avatar')
            # 确保返回的是完整的 data URI
            if avatar_data and not avatar_data.startswith('data:'):
                # 如果只是 base64，添加 data URI 头
                avatar_data = f"data:image/png;base64,{avatar_data}"
            
            return jsonify({
                'success': True,
                'avatar': avatar_data
            })
        else:
            return jsonify({
                'success': False,
                'error': result.get('error', '头像生成失败')
            }), 400
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/refine-prompt', methods=['POST', 'OPTIONS'])
def refine_prompt():
    """
    使用 LLM 优化系统提示词
    请求体: { "config_id": "...", "current_prompt": "...", "instruction": "..." }
    """
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    try:
        data = request.get_json()
        config_id = data.get('config_id')
        current_prompt = data.get('current_prompt', '')
        instruction = data.get('instruction', '')
        
        if not config_id:
            return jsonify({'error': 'config_id is required'}), 400
        if not instruction:
            return jsonify({'error': 'instruction is required'}), 400
        
        service = get_llm_service()
        
        # 调用优化提示词
        result = service.refine_system_prompt(config_id, current_prompt, instruction)
        
        if result.get('success'):
            return jsonify({
                'success': True,
                'refined_prompt': result.get('refined_prompt')
            })
        else:
            return jsonify({
                'success': False,
                'error': result.get('error', '优化失败')
            }), 400
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/models', methods=['GET', 'OPTIONS'])
def get_models():
    """
    获取模型列表（代理端点，解决 CORS 问题）
    查询参数:
        - api_url: API 基础 URL（如 https://integrate.api.nvidia.com/v1 或 http://localhost:11434）
        - api_key: API Key（可选，某些 API 需要）
        - provider: Provider 类型（可选，用于区分不同 API）
        - include_capabilities: 是否包含模型能力信息（可选，默认 false）
    """
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        import requests
        from services.providers.factory import create_provider
        
        api_url = request.args.get('api_url')
        api_key = request.args.get('api_key')
        provider = request.args.get('provider', '').lower()
        include_capabilities = request.args.get('include_capabilities', 'false').lower() == 'true'
        
        if not api_url:
            return jsonify({'error': 'api_url is required'}), 400
        
        # 规范化 URL：移除尾部斜杠
        normalized_url = api_url.rstrip('/')
        
        # 优先使用 Provider 的 models() 方法
        # 注意：只有当 provider 明确指定且不是 'openai'（避免使用默认 OpenAI URL）时才使用
        # 如果 provider 是 'openai' 但 api_url 不是 OpenAI 默认 URL，则直接使用 REST API
        # 注意：subprovider 参数用于标识真正的供应商（如 nvidia），但不影响 SDK 路由选择
        use_provider_sdk = (
            api_key and 
            provider and 
            provider not in ['ollama', 'local'] and
            # 如果 provider 是 'openai' 但 URL 不是 OpenAI 默认 URL，则使用传入的 URL（通过 REST API）
            not (provider == 'openai' and normalized_url and 'api.openai.com' not in normalized_url)
        )
        
        if use_provider_sdk:
            try:
                # 尝试创建 provider 并调用 models() 方法
                provider_instance = create_provider(
                    provider_type=provider,
                    api_key=api_key,
                    api_url=normalized_url,
                    model=None  # 不需要指定模型
                )
                
                if hasattr(provider_instance, 'models'):
                    try:
                        model_list = provider_instance.models()
                        if model_list:
                            # 过滤无效模型
                            model_list = [m for m in model_list if m and isinstance(m, str) and m.strip()]
                            print(f"[LLM Models] Successfully fetched {len(model_list)} models via provider.models()")
                            
                            if include_capabilities:
                                # 返回包含能力的对象数组
                                models_with_caps = [
                                    build_model_with_capabilities(model_id, provider)
                                    for model_id in model_list
                                ]
                                return jsonify({
                                    'models': models_with_caps,
                                    'total': len(models_with_caps)
                                })
                            else:
                                # 返回字符串数组（向后兼容）
                                return jsonify({
                                    'models': model_list,
                                    'total': len(model_list)
                                })
                    except Exception as e:
                        print(f"[LLM Models] provider.models() failed: {e}, falling back to REST API")
            except Exception as e:
                print(f"[LLM Models] Failed to create provider: {e}, using REST API")
        
        # Ollama 特殊处理
        if provider == 'ollama' or provider == 'local' or 'ollama' in normalized_url.lower() or ':11434' in normalized_url:
            # Ollama API: /api/tags
            if '/api/tags' in normalized_url:
                models_url = normalized_url
            else:
                models_url = f"{normalized_url}/api/tags"
            
            print(f"[LLM Models] Fetching Ollama models from: {models_url}")
            
            # Ollama 不需要 API Key
            response = requests.get(
                models_url,
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            
            if response.status_code != 200:
                error_msg = response.text
                print(f"[LLM Models] Ollama request failed: {response.status_code} - {error_msg}")
                if response.status_code == 404:
                    return jsonify({'error': f'无法连接到 Ollama 服务器: {normalized_url}。请检查服务器地址是否正确。'}), 404
                return jsonify({'error': f'获取模型列表失败: {response.status_code} {response.reason}'}), response.status_code
            
            data = response.json()
            
            # Ollama 格式：{ models: [{ name: "...", ... }] }
            if isinstance(data, dict) and 'models' in data and isinstance(data['models'], list):
                model_names = [model.get('name') for model in data['models'] if model.get('name')]
                # 过滤无效模型
                model_names = [name for name in model_names if name and isinstance(name, str) and name.strip()]
                print(f"[LLM Models] Successfully fetched {len(model_names)} Ollama models")
                
                if include_capabilities:
                    # 返回包含能力的对象数组
                    models_with_caps = [
                        build_model_with_capabilities(model_id, provider)
                        for model_id in model_names
                    ]
                    return jsonify({
                        'models': models_with_caps,
                        'total': len(models_with_caps)
                    })
                else:
                    return jsonify({
                        'models': model_names,
                        'total': len(model_names)
                    })
            
            return jsonify({'error': 'Ollama 服务器返回的数据格式不正确'}), 500
        
        # 根据 provider 类型选择 REST API 端点
        if provider in ['gemini', 'google']:
            # Gemini API: /v1beta/models?key=API_KEY
            if '/v1beta' not in normalized_url and '/v1' not in normalized_url:
                normalized_url = f"{normalized_url}/v1beta"
            elif normalized_url.endswith('/v1'):
                normalized_url = normalized_url.replace('/v1', '/v1beta')
            
            models_url = f"{normalized_url}/models"
            params = {'key': api_key} if api_key else {}
            
            print(f"[LLM Models] Fetching Gemini models from: {models_url}")
            response = requests.get(models_url, params=params, timeout=10)
            
            if response.status_code != 200:
                error_msg = response.text
                print(f"[LLM Models] Request failed: {response.status_code} - {error_msg}")
                if response.status_code == 401:
                    return jsonify({'error': 'API Key 无效或未授权'}), 401
                if response.status_code == 404:
                    return jsonify({'error': f'无法找到模型列表端点: {models_url}。请检查 URL 是否正确。'}), 404
                return jsonify({'error': f'获取模型列表失败: {response.status_code} {response.reason}'}), response.status_code
            
            data = response.json()
            # Gemini 格式：{ models: [{ name: "models/gemini-2.0-flash-exp", ... }] }
            if isinstance(data, dict) and isinstance(data.get('models'), list):
                model_names = [model.get('name') for model in data['models'] if model.get('name')]
                # 提取模型 ID
                model_ids = []
                for name in model_names:
                    if name and isinstance(name, str) and name.strip():
                        if '/' in name:
                            model_ids.append(name.split('/')[-1])
                        else:
                            model_ids.append(name)
                # 过滤无效模型
                model_ids = [mid for mid in model_ids if mid and isinstance(mid, str) and mid.strip()]
                print(f"[LLM Models] Successfully fetched {len(model_ids)} Gemini models")
                
                if include_capabilities:
                    # 返回包含能力的对象数组
                    models_with_caps = [
                        build_model_with_capabilities(model_id, provider)
                        for model_id in model_ids
                    ]
                    return jsonify({
                        'models': models_with_caps,
                        'total': len(models_with_caps)
                    })
                else:
                    return jsonify({
                        'models': model_ids,
                        'total': len(model_ids)
                    })
            
            return jsonify({'error': 'Gemini 服务器返回的数据格式不正确'}), 500
        
        elif provider in ['anthropic', 'claude']:
            # Anthropic API: /v1/models
            if not normalized_url.endswith('/v1'):
                if normalized_url.endswith('/v1/'):
                    normalized_url = normalized_url.rstrip('/')
                else:
                    normalized_url = f"{normalized_url}/v1"
            
            models_url = f"{normalized_url}/models"
            headers = {
                'x-api-key': api_key or '',
                'anthropic-version': '2023-06-01'
            }
            
            print(f"[LLM Models] Fetching Anthropic models from: {models_url}")
            response = requests.get(models_url, headers=headers, timeout=10)
            
            if response.status_code != 200:
                error_msg = response.text
                print(f"[LLM Models] Request failed: {response.status_code} - {error_msg}")
                if response.status_code == 401:
                    return jsonify({'error': 'API Key 无效或未授权'}), 401
                if response.status_code == 404:
                    return jsonify({'error': f'无法找到模型列表端点: {models_url}。请检查 URL 是否正确。'}), 404
                return jsonify({'error': f'获取模型列表失败: {response.status_code} {response.reason}'}), response.status_code
            
            data = response.json()
            # Anthropic 格式：{ data: [{ id: "...", ... }] }
            if isinstance(data, dict) and isinstance(data.get('data'), list):
                model_ids = [model.get('id') for model in data['data'] if model.get('id')]
                # 过滤无效模型
                model_ids = [mid for mid in model_ids if mid and isinstance(mid, str) and mid.strip()]
                print(f"[LLM Models] Successfully fetched {len(model_ids)} Anthropic models")
                
                if include_capabilities:
                    # 返回包含能力的对象数组
                    models_with_caps = [
                        build_model_with_capabilities(model_id, provider)
                        for model_id in model_ids
                    ]
                    return jsonify({
                        'models': models_with_caps,
                        'total': len(models_with_caps)
                    })
                else:
                    return jsonify({
                        'models': model_ids,
                        'total': len(model_ids)
                    })
            
            return jsonify({'error': 'Anthropic 服务器返回的数据格式不正确'}), 500
        
        else:
            # OpenAI 兼容 API 处理（包括 DeepSeek）
            # 移除 /chat/completions 后缀（如果存在）
            if '/chat/completions' in normalized_url:
                normalized_url = normalized_url.replace('/chat/completions', '').rstrip('/')
            
            # 确保以 /v1 结尾，然后添加 /models
            if not normalized_url.endswith('/v1'):
                if normalized_url.endswith('/v1/'):
                    normalized_url = normalized_url.rstrip('/')
                else:
                    normalized_url = f"{normalized_url}/v1"
            
            models_url = f"{normalized_url}/models"
            
            # 构建请求头
            request_headers = {
                'Content-Type': 'application/json',
            }
            
            # 添加 Authorization header（如果提供了 api_key）
            if api_key:
                request_headers['Authorization'] = f'Bearer {api_key}'
            
            print(f"[LLM Models] Fetching models from: {models_url}")
            
            # 发送 GET 请求
            response = requests.get(
                models_url,
                headers=request_headers,
                timeout=10  # 10秒超时
            )
            
            if response.status_code != 200:
                error_msg = response.text
                print(f"[LLM Models] Request failed: {response.status_code} - {error_msg}")
                if response.status_code == 401:
                    return jsonify({'error': 'API Key 无效或未授权'}), 401
                if response.status_code == 404:
                    return jsonify({'error': f'无法找到模型列表端点: {models_url}。请检查 URL 是否正确。'}), 404
                return jsonify({'error': f'获取模型列表失败: {response.status_code} {response.reason}'}), response.status_code
            
            data = response.json()
            
            # OpenAI 兼容格式：{ object: "list", data: [{ id: "...", ... }] }
            if isinstance(data, dict) and data.get('object') == 'list' and isinstance(data.get('data'), list):
                model_ids = [model.get('id') for model in data['data'] if model.get('id')]
                # 过滤无效模型（空字符串、None、只包含空白字符的）
                model_ids = [mid for mid in model_ids if mid and isinstance(mid, str) and mid.strip()]
                print(f"[LLM Models] Successfully fetched {len(model_ids)} models (filtered from {len(data['data'])} total)")
                
                if include_capabilities:
                    # 返回包含能力的对象数组
                    models_with_caps = [
                        build_model_with_capabilities(model_id, provider)
                        for model_id in model_ids
                    ]
                    return jsonify({
                        'models': models_with_caps,
                        'total': len(models_with_caps)
                    })
                else:
                    return jsonify({
                        'models': model_ids,
                        'total': len(model_ids)
                    })
            
            # 兼容其他格式：直接是数组
            if isinstance(data, list):
                model_ids = [item.get('id') if isinstance(item, dict) else item for item in data if item]
                # 过滤无效模型
                model_ids = [mid for mid in model_ids if mid and isinstance(mid, str) and mid.strip()]
                print(f"[LLM Models] Successfully fetched {len(model_ids)} models (array format, filtered from {len(data)} total)")
                
                if include_capabilities:
                    # 返回包含能力的对象数组
                    models_with_caps = [
                        build_model_with_capabilities(model_id, provider)
                        for model_id in model_ids
                    ]
                    return jsonify({
                        'models': models_with_caps,
                        'total': len(models_with_caps)
                    })
                else:
                    return jsonify({
                        'models': model_ids,
                        'total': len(model_ids)
                    })
            
            return jsonify({'error': '服务器返回的数据格式不正确'}), 500
        
    except requests.exceptions.Timeout:
        print(f"[LLM Models] Request timeout")
        return jsonify({'error': '请求超时：无法在10秒内连接到服务器。请检查 URL 和网络连接。'}), 504
    except requests.exceptions.RequestException as e:
        print(f"[LLM Models] Request error: {e}")
        return jsonify({'error': f'请求失败: {str(e)}'}), 500
    except Exception as e:
        print(f"[LLM Models] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/proxy', methods=['POST', 'OPTIONS'])
def llm_proxy():
    """
    LLM API 代理端点（解决 CORS 问题）
    请求体: {
        "api_url": "https://integrate.api.nvidia.com/v1/chat/completions",
        "api_key": "...",
        "headers": {...},
        "body": {...}
    }
    """
    from flask import stream_with_context
    
    if request.method == 'OPTIONS':
        resp = Response(status=200)
        resp.headers.update(get_cors_headers())
        return resp
    
    try:
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body is required'}), 400
        
        api_url = data.get('api_url')
        api_key = data.get('api_key')
        headers = data.get('headers', {})
        body = data.get('body', {})
        stream = data.get('stream', False)
        
        if not api_url:
            return jsonify({'error': 'api_url is required'}), 400
        
        # 构建请求头
        request_headers = {
            'Content-Type': 'application/json',
            **headers
        }
        
        # 添加 Authorization header（如果提供了 api_key）
        if api_key:
            request_headers['Authorization'] = f'Bearer {api_key}'
        
        # 过滤掉一些不需要转发的头
        filtered_headers = {
            k: v for k, v in request_headers.items()
            if k.lower() not in ['host', 'content-length', 'transfer-encoding', 'connection']
        }
        
        print(f"[LLM Proxy] Proxying request to: {api_url}")
        print(f"[LLM Proxy] Method: POST, Stream: {stream}")
        
        # 发送请求
        if stream:
            # 流式响应
            resp = requests.post(
                api_url,
                json=body,
                headers=filtered_headers,
                stream=True,
                timeout=600  # 10分钟超时
            )
            
            def generate():
                try:
                    for chunk in resp.iter_content(chunk_size=8192):
                        if chunk:
                            yield chunk
                except Exception as e:
                    print(f"[LLM Proxy] Stream error: {e}")
                    yield f"data: {json.dumps({'error': str(e)})}\n\n".encode()
            
            return Response(
                stream_with_context(generate()),
                mimetype='text/event-stream',
                headers={
                    **get_cors_headers(),
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                }
            )
        else:
            # 非流式响应
            resp = requests.post(
                api_url,
                json=body,
                headers=filtered_headers,
                timeout=600  # 10分钟超时
            )
            
            # 返回响应
            proxy_response = Response(
                resp.content,
                status=resp.status_code,
                headers={
                    **get_cors_headers(),
                    'Content-Type': resp.headers.get('Content-Type', 'application/json'),
                }
            )
            
            return proxy_response
            
    except requests.exceptions.RequestException as e:
        print(f"[LLM Proxy] Request error: {e}")
        return jsonify({'error': f'Proxy request failed: {str(e)}'}), 500
    except Exception as e:
        print(f"[LLM Proxy] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/providers/logo-options', methods=['GET', 'OPTIONS'])
def get_provider_logo_options():
    """
    获取供应商的多个 Logo 选项
    查询参数:
        - provider: 供应商名称或slug（支持直接搜索，如 "claude", "openai", "gemini" 等）
    返回: {
        "options": [
            {
                "type": "png_light",
                "name": "PNG 浅色",
                "light": "data:image/png;base64,...",
                "dark": null,
                "preview": "data:image/png;base64,..."
            },
            {
                "type": "png_dark",
                "name": "PNG 深色",
                "light": null,
                "dark": "data:image/png;base64,...",
                "preview": "data:image/png;base64,..."
            },
            {
                "type": "png_both",
                "name": "PNG 完整版（浅色+深色）",
                "light": "data:image/png;base64,...",
                "dark": "data:image/png;base64,...",
                "preview": "data:image/png;base64,..."
            },
            {
                "type": "svg",
                "name": "SVG（自适应主题）",
                "light": "data:image/svg+xml;base64,...",
                "dark": "data:image/svg+xml;base64,...",
                "preview": "data:image/svg+xml;base64,..."
            }
        ]
    }
    """
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        provider = request.args.get('provider', '').strip().lower()
        
        if not provider:
            return jsonify({'error': 'provider parameter is required'}), 400
        
        # 1. 首先尝试从映射表获取slug（向后兼容）
        slug = PROVIDER_LOBEHUB_SLUG.get(provider)
        
        # 2. 如果映射表中没有，尝试直接使用用户输入的名称作为slug
        # 同时尝试一些常见的变体
        possible_slugs = []
        if slug:
            possible_slugs.append(slug)
        else:
            # 直接使用用户输入
            possible_slugs.append(provider)
            # 尝试一些常见变体
            if 'claude' in provider:
                possible_slugs.extend(['anthropic', 'claude'])
            elif 'gemini' in provider or 'google' in provider:
                possible_slugs.extend(['google', 'gemini'])
            elif 'gpt' in provider or 'openai' in provider:
                possible_slugs.extend(['openai', 'chatgpt'])
            elif 'deepseek' in provider:
                possible_slugs.append('deepseek')
            elif 'ollama' in provider:
                possible_slugs.append('ollama')
        
        # 去重
        possible_slugs = list(dict.fromkeys(possible_slugs))
        
        # 尝试每个可能的slug，直到找到可用的图标
        options = []
        found_slug = None
        
        for test_slug in possible_slugs:
            if found_slug:
                break
                
            # 测试SVG是否存在（最快的方式）
            try:
                svg_url = f'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/{test_slug}.svg'
                svg_test = requests.head(svg_url, timeout=5, allow_redirects=True)
                if svg_test.status_code == 200:
                    found_slug = test_slug
                    break
            except:
                continue
        
        # 如果所有slug都失败，使用第一个作为默认尝试
        if not found_slug and possible_slugs:
            found_slug = possible_slugs[0]
        
        if not found_slug:
            return jsonify({
                'error': f'未找到图标 "{provider}"，请尝试其他名称（如 openai, anthropic, google, deepseek, ollama 等）',
                'suggestions': ['openai', 'anthropic', 'google', 'deepseek', 'ollama', 'claude', 'gemini']
            }), 404
        
        # 使用找到的slug获取浅色和深色两组图标
        slug = found_slug
        
        light_options = []
        dark_options = []
        
        # 1. 浅色模式选项（优先PNG，回退到SVG）
        try:
            png_light_url = f'https://unpkg.com/@lobehub/icons-static-png@latest/light/{slug}.png'
            png_light_response = requests.get(png_light_url, timeout=10)
            if png_light_response.status_code == 200:
                png_light_base64 = base64.b64encode(png_light_response.content).decode('utf-8')
                light_options.append({
                    'type': 'png',
                    'url': f'data:image/png;base64,{png_light_base64}',
                    'preview': f'data:image/png;base64,{png_light_base64}'
                })
        except Exception as e:
            print(f"[Logo Options] Failed to download PNG light for {slug}: {e}")
        
        # 如果PNG失败，尝试SVG
        if not light_options:
            try:
                svg_url = f'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/{slug}.svg'
                svg_response = requests.get(svg_url, timeout=10)
                svg_response.raise_for_status()
                svg_text = svg_response.text
                svg_base64 = base64.b64encode(svg_text.encode('utf-8')).decode('utf-8')
                logo_data_url = f'data:image/svg+xml;base64,{svg_base64}'
                light_options.append({
                    'type': 'svg',
                    'url': logo_data_url,
                    'preview': logo_data_url
                })
            except Exception as e:
                print(f"[Logo Options] Failed to download SVG for {slug}: {e}")
        
        # 2. 深色模式选项（优先PNG，回退到SVG）
        try:
            png_dark_url = f'https://unpkg.com/@lobehub/icons-static-png@latest/dark/{slug}.png'
            png_dark_response = requests.get(png_dark_url, timeout=10)
            if png_dark_response.status_code == 200:
                png_dark_base64 = base64.b64encode(png_dark_response.content).decode('utf-8')
                dark_options.append({
                    'type': 'png',
                    'url': f'data:image/png;base64,{png_dark_base64}',
                    'preview': f'data:image/png;base64,{png_dark_base64}'
                })
        except Exception as e:
            print(f"[Logo Options] Failed to download PNG dark for {slug}: {e}")
        
        # 如果PNG失败，尝试SVG
        if not dark_options:
            try:
                svg_url = f'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/{slug}.svg'
                svg_response = requests.get(svg_url, timeout=10)
                svg_response.raise_for_status()
                svg_text = svg_response.text
                svg_base64 = base64.b64encode(svg_text.encode('utf-8')).decode('utf-8')
                logo_data_url = f'data:image/svg+xml;base64,{svg_base64}'
                dark_options.append({
                    'type': 'svg',
                    'url': logo_data_url,
                    'preview': logo_data_url
                })
            except Exception as e:
                print(f"[Logo Options] Failed to download SVG for {slug}: {e}")
        
        if not light_options and not dark_options:
            return jsonify({
                'error': f'未找到图标 "{provider}" 的可用格式',
                'suggestions': ['openai', 'anthropic', 'google', 'deepseek', 'ollama', 'claude', 'gemini']
            }), 404
        
        return jsonify({
            'light_options': light_options,
            'dark_options': dark_options,
            'slug': slug
        })
        
    except Exception as e:
        print(f"[Logo Options] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/providers/download-logo', methods=['GET', 'OPTIONS'])
def download_provider_logo():
    """
    从 LobeHub CDN 下载供应商 Logo
    支持浅色和深色主题
    查询参数:
        - provider: 供应商类型 (openai, anthropic, gemini, deepseek, ollama)
        - theme: 主题 (light, dark, auto) - 默认 auto
    返回: {
        "logo_light": "data:image/svg+xml;base64,...",
        "logo_dark": "data:image/svg+xml;base64,...",
        "theme": "auto"
    }
    """
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        provider = request.args.get('provider', '').lower()
        theme = request.args.get('theme', 'auto').lower()
        
        if not provider:
            return jsonify({'error': 'provider parameter is required'}), 400
        
        # 获取 LobeHub slug
        slug = PROVIDER_LOBEHUB_SLUG.get(provider)
        if not slug:
            return jsonify({'error': f'Provider {provider} not supported'}), 400
        
        # 尝试下载多个版本的logo（PNG light/dark 和 SVG）
        result = {
            'logo_light': None,
            'logo_dark': None,
            'theme': theme,
            'format': 'svg'
        }
        
        # 1. 优先下载 PNG 版本（更清晰明显）
        try:
            # 下载 light 版本 PNG
            png_light_url = f'https://unpkg.com/@lobehub/icons-static-png@latest/light/{slug}.png'
            png_light_response = requests.get(png_light_url, timeout=10)
            if png_light_response.status_code == 200:
                png_light_base64 = base64.b64encode(png_light_response.content).decode('utf-8')
                result['logo_light'] = f'data:image/png;base64,{png_light_base64}'
                result['format'] = 'png'
        except Exception as e:
            print(f"[Download Logo] Failed to download PNG light for {provider}: {e}")
        
        try:
            # 下载 dark 版本 PNG
            png_dark_url = f'https://unpkg.com/@lobehub/icons-static-png@latest/dark/{slug}.png'
            png_dark_response = requests.get(png_dark_url, timeout=10)
            if png_dark_response.status_code == 200:
                png_dark_base64 = base64.b64encode(png_dark_response.content).decode('utf-8')
                result['logo_dark'] = f'data:image/png;base64,{png_dark_base64}'
                result['format'] = 'png'
        except Exception as e:
            print(f"[Download Logo] Failed to download PNG dark for {provider}: {e}")
        
        # 2. 如果 PNG 下载失败，回退到 SVG
        if not result['logo_light'] or not result['logo_dark']:
            try:
                svg_url = f'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/{slug}.svg'
                svg_response = requests.get(svg_url, timeout=10)
                svg_response.raise_for_status()
                svg_text = svg_response.text
                
                # 转换为 base64
                svg_base64 = base64.b64encode(svg_text.encode('utf-8')).decode('utf-8')
                logo_data_url = f'data:image/svg+xml;base64,{svg_base64}'
                
                # 如果 PNG 下载失败，使用 SVG 作为回退
                if not result['logo_light']:
                    result['logo_light'] = logo_data_url
                if not result['logo_dark']:
                    result['logo_dark'] = logo_data_url
                result['format'] = 'svg'
            except Exception as e:
                print(f"[Download Logo] Failed to download SVG for {provider}: {e}")
                # 如果所有下载都失败，返回错误
                if not result['logo_light'] and not result['logo_dark']:
                    raise
        
        return jsonify(result)
        
    except Exception as e:
        print(f"[Download Logo] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/providers', methods=['GET', 'OPTIONS'])
def get_providers():
    """获取所有供应商列表"""
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'Database not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        # 先检查表是否存在
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'llm_providers'
        """)
        table_exists = cursor.fetchone()['count'] > 0
        
        if not table_exists:
            cursor.close()
            conn.close()
            return jsonify({
                'error': 'Table llm_providers does not exist',
                'message': 'Please run database migration first'
            }), 500
        
        cursor.execute("""
            SELECT 
                provider_id,
                name,
                provider_type,
                is_system,
                override_url,
                default_api_url,
                logo_light,
                logo_dark,
                logo_theme,
                metadata,
                created_at,
                updated_at
            FROM llm_providers
            ORDER BY is_system DESC, name ASC
        """)
        providers = cursor.fetchall()
        
        # 转换 datetime 为字符串，处理 JSON 字段
        for provider in providers:
            if provider.get('created_at'):
                provider['created_at'] = provider['created_at'].isoformat() if hasattr(provider['created_at'], 'isoformat') else str(provider['created_at'])
            if provider.get('updated_at'):
                provider['updated_at'] = provider['updated_at'].isoformat() if hasattr(provider['updated_at'], 'isoformat') else str(provider['updated_at'])
            # 处理 JSON 字段（如果数据库返回的是字符串，需要解析）
            if provider.get('metadata'):
                if isinstance(provider['metadata'], str):
                    try:
                        provider['metadata'] = json.loads(provider['metadata'])
                    except:
                        provider['metadata'] = {}
                elif provider['metadata'] is None:
                    provider['metadata'] = {}
        
        cursor.close()
        conn.close()
        
        return jsonify({'providers': providers, 'total': len(providers)})
        
    except Exception as e:
        error_msg = str(e)
        print(f"[Get Providers] Error: {error_msg}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': error_msg,
            'type': type(e).__name__
        }), 500


@llm_bp.route('/providers', methods=['POST', 'OPTIONS'])
def create_provider():
    """创建自定义供应商"""
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body is required'}), 400
        
        name = data.get('name')
        provider_type = data.get('provider_type')
        override_url = data.get('override_url', False)
        default_api_url = data.get('default_api_url')
        
        if not name:
            return jsonify({'error': 'name is required'}), 400
        if not provider_type:
            return jsonify({'error': 'provider_type is required'}), 400
        
        # provider_id 直接使用供应商名称（作为 supplier）
        # 供应商名称 = supplier，兼容类型 = provider
        provider_id = name.strip()
        
        # 确保唯一性
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'Database not available'}), 503
        
        cursor = conn.cursor()
        
        # 检查是否已存在
        cursor.execute("SELECT COUNT(*) FROM llm_providers WHERE provider_id = %s", (provider_id,))
        if cursor.fetchone()[0] > 0:
            return jsonify({'error': f'供应商名称 "{name}" 已存在，请使用其他名称'}), 400
        
        # 插入新供应商
        cursor.execute("""
            INSERT INTO llm_providers 
            (provider_id, name, provider_type, is_system, override_url, default_api_url, logo_theme, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            provider_id,
            name,
            provider_type,
            0,  # 自定义供应商
            override_url,
            default_api_url,
            data.get('logo_theme', 'auto'),
            json.dumps(data.get('metadata', {}))
        ))
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            'provider_id': provider_id,
            'message': 'Provider created successfully'
        }), 201
        
    except Exception as e:
        print(f"[Create Provider] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/providers/<provider_id>', methods=['GET', 'OPTIONS'])
def get_provider(provider_id):
    """获取单个供应商"""
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'Database not available'}), 503
        
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        cursor.execute("""
            SELECT 
                provider_id,
                name,
                provider_type,
                is_system,
                override_url,
                default_api_url,
                logo_light,
                logo_dark,
                logo_theme,
                metadata,
                created_at,
                updated_at
            FROM llm_providers
            WHERE provider_id = %s
        """, (provider_id,))
        
        provider = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not provider:
            return jsonify({'error': 'Provider not found'}), 404
        
        # 转换 datetime
        if provider.get('created_at'):
            provider['created_at'] = provider['created_at'].isoformat() if hasattr(provider['created_at'], 'isoformat') else str(provider['created_at'])
        if provider.get('updated_at'):
            provider['updated_at'] = provider['updated_at'].isoformat() if hasattr(provider['updated_at'], 'isoformat') else str(provider['updated_at'])
        
        return jsonify(provider)
        
    except Exception as e:
        print(f"[Get Provider] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/providers/<provider_id>', methods=['PUT', 'OPTIONS'])
def update_provider(provider_id):
    """更新供应商"""
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Request body is required'}), 400
        
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'Database not available'}), 503
        
        cursor = conn.cursor()
        
        # 检查是否存在
        cursor.execute("SELECT is_system FROM llm_providers WHERE provider_id = %s", (provider_id,))
        result = cursor.fetchone()
        if not result:
            cursor.close()
            conn.close()
            return jsonify({'error': 'Provider not found'}), 404
        
        is_system = result[0]
        
        # 构建更新字段
        update_fields = []
        update_values = []
        
        if 'name' in data:
            update_fields.append("name = %s")
            update_values.append(data['name'])
        
        if 'provider_type' in data:
            update_fields.append("provider_type = %s")
            update_values.append(data['provider_type'])
        
        if 'override_url' in data:
            update_fields.append("override_url = %s")
            update_values.append(data['override_url'])
        
        if 'default_api_url' in data:
            update_fields.append("default_api_url = %s")
            update_values.append(data['default_api_url'])
        
        if 'logo_light' in data:
            update_fields.append("logo_light = %s")
            update_values.append(data['logo_light'])
        
        if 'logo_dark' in data:
            update_fields.append("logo_dark = %s")
            update_values.append(data['logo_dark'])
        
        if 'logo_theme' in data:
            update_fields.append("logo_theme = %s")
            update_values.append(data['logo_theme'])
        
        if 'metadata' in data:
            update_fields.append("metadata = %s")
            update_values.append(json.dumps(data['metadata']))
        
        if not update_fields:
            cursor.close()
            conn.close()
            return jsonify({'error': 'No fields to update'}), 400
        
        update_values.append(provider_id)
        
        sql = f"""
            UPDATE llm_providers 
            SET {', '.join(update_fields)}
            WHERE provider_id = %s
        """
        
        cursor.execute(sql, update_values)
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'message': 'Provider updated successfully'})
        
    except Exception as e:
        print(f"[Update Provider] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/providers/<provider_id>', methods=['DELETE', 'OPTIONS'])
def delete_provider(provider_id):
    """删除供应商（仅限自定义供应商）"""
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        conn = get_mysql_connection()
        if not conn:
            return jsonify({'error': 'Database not available'}), 503
        
        cursor = conn.cursor()
        
        # 检查供应商是否存在
        cursor.execute("SELECT is_system FROM llm_providers WHERE provider_id = %s", (provider_id,))
        result = cursor.fetchone()
        if not result:
            cursor.close()
            conn.close()
            return jsonify({'error': 'Provider not found'}), 404
        
        # 检查是否有配置使用此供应商（系统供应商和自定义供应商都需要检查）
        cursor.execute("SELECT COUNT(*) FROM llm_configs WHERE provider_id = %s", (provider_id,))
        config_count = cursor.fetchone()[0]
        if config_count > 0:
            cursor.close()
            conn.close()
            return jsonify({'error': f'Cannot delete provider: {config_count} config(s) are using it'}), 400
        
        # 删除供应商
        cursor.execute("DELETE FROM llm_providers WHERE provider_id = %s", (provider_id,))
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'message': 'Provider deleted successfully'})
        
    except Exception as e:
        print(f"[Delete Provider] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@llm_bp.route('/providers/supported', methods=['GET', 'OPTIONS'])
def get_supported_providers():
    """
    获取系统支持的主流供应商列表
    返回所有系统支持的供应商类型及其默认配置
    """
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        from services.providers.factory import PROVIDER_REGISTRY
        
        # 定义系统支持的供应商及其默认信息
        supported_providers = [
            {
                'provider_type': 'openai',
                'name': 'OpenAI',
                'description': 'OpenAI GPT 系列模型（GPT-4, GPT-3.5等）',
                'default_api_url': 'https://api.openai.com/v1/chat/completions',
                'requires_api_key': True,
                'icon': '🤖',
                'color': '#10A37F',
            },
            {
                'provider_type': 'deepseek',
                'name': 'DeepSeek',
                'description': 'DeepSeek 大语言模型',
                'default_api_url': 'https://api.deepseek.com/v1/chat/completions',
                'requires_api_key': True,
                'icon': '🔮',
                'color': '#5B68DF',
            },
            {
                'provider_type': 'anthropic',
                'name': 'Anthropic (Claude)',
                'description': 'Anthropic Claude 系列模型',
                'default_api_url': 'https://api.anthropic.com/v1/messages',
                'requires_api_key': True,
                'icon': '🧠',
                'color': '#D4A574',
            },
            {
                'provider_type': 'gemini',
                'name': 'Google Gemini',
                'description': 'Google Gemini 系列模型',
                'default_api_url': 'https://generativelanguage.googleapis.com/v1beta',
                'requires_api_key': True,
                'icon': '✨',
                'color': '#4285F4',
            },
            {
                'provider_type': 'ollama',
                'name': 'Ollama',
                'description': '本地 Ollama 模型服务',
                'default_api_url': 'http://localhost:11434',
                'requires_api_key': False,
                'icon': '🦙',
                'color': '#1D4ED8',
            },
        ]
        
        # 过滤出实际支持的供应商（在PROVIDER_REGISTRY中存在的）
        available_providers = []
        for provider in supported_providers:
            provider_type = provider['provider_type']
            if provider_type in PROVIDER_REGISTRY or any(
                alias in PROVIDER_REGISTRY for alias in [provider_type, provider_type.lower()]
            ):
                available_providers.append(provider)
        
        return jsonify({
            'providers': available_providers,
            'total': len(available_providers)
        })
        
    except Exception as e:
        print(f"[Get Supported Providers] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
