"""
LLM 配置 API 路由
"""

from flask import Blueprint, request, jsonify, Response
import base64
import json

from services.llm_service import get_llm_service
from utils.cors import get_cors_headers

# 创建 Blueprint
llm_bp = Blueprint('llm', __name__)


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
        return jsonify({'error': {'message': str(e)}}), 400
    except Exception as e:
        return jsonify({'error': {'message': str(e)}}), 500


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
    if request.method == 'OPTIONS':
        response = Response(status=200)
        response.headers.update(get_cors_headers())
        return response
    
    try:
        import requests
        from flask import Response, stream_with_context
        
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
            response = requests.post(
                api_url,
                json=body,
                headers=filtered_headers,
                stream=True,
                timeout=600  # 10分钟超时
            )
            
            def generate():
                try:
                    for chunk in response.iter_content(chunk_size=8192):
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
            response = requests.post(
                api_url,
                json=body,
                headers=filtered_headers,
                timeout=600  # 10分钟超时
            )
            
            # 返回响应
            proxy_response = Response(
                response.content,
                status=response.status_code,
                headers={
                    **get_cors_headers(),
                    'Content-Type': response.headers.get('Content-Type', 'application/json'),
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
