"""
LLM 配置 API 路由
"""

from flask import Blueprint, request, jsonify

from services.llm_service import get_llm_service

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
