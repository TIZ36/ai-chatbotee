"""
MCP 服务器 API 路由
"""

from flask import Blueprint, request, jsonify

from services.mcp_service import get_mcp_service

# 创建 Blueprint
mcp_bp = Blueprint('mcp_api', __name__)


@mcp_bp.route('/servers', methods=['GET'])
def get_servers():
    """获取所有 MCP 服务器配置"""
    try:
        service = get_mcp_service()
        enabled_only = request.args.get('enabled', 'false').lower() == 'true'
        servers = service.get_all_servers(enabled_only=enabled_only)
        # 返回格式与原始 API 保持一致
        return jsonify({'servers': servers, 'total': len(servers)})
    except Exception as e:
        return jsonify({'servers': [], 'total': 0, 'error': str(e)}), 500


@mcp_bp.route('/servers/<server_id>', methods=['GET'])
def get_server(server_id):
    """获取单个 MCP 服务器配置"""
    try:
        service = get_mcp_service()
        server = service.get_server(server_id)
        if server:
            return jsonify(server)
        return jsonify({'error': 'Server not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@mcp_bp.route('/servers', methods=['POST'])
def create_server():
    """创建 MCP 服务器配置"""
    try:
        service = get_mcp_service()
        data = request.get_json()
        server = service.create_server(data)
        # 返回格式与原始 API 保持一致
        return jsonify({
            'server_id': server.get('server_id'),
            'message': 'Server created successfully'
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@mcp_bp.route('/servers/<server_id>', methods=['PUT'])
def update_server(server_id):
    """更新 MCP 服务器配置"""
    try:
        service = get_mcp_service()
        data = request.get_json()
        server = service.update_server(server_id, data)
        if server:
            # 返回格式与原始 API 保持一致
            return jsonify({'message': 'Server updated successfully'})
        return jsonify({'error': 'Server not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@mcp_bp.route('/servers/<server_id>', methods=['DELETE'])
def delete_server(server_id):
    """删除 MCP 服务器配置"""
    try:
        service = get_mcp_service()
        if service.delete_server(server_id):
            # 返回格式与原始 API 保持一致
            return jsonify({'message': 'Server deleted successfully'})
        return jsonify({'error': 'Server not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@mcp_bp.route('/servers/<server_id>/health', methods=['GET'])
def check_server_health(server_id):
    """检查单个服务器健康状态"""
    try:
        service = get_mcp_service()
        server = service.get_server(server_id)
        if not server:
            return jsonify({'error': 'Server not found'}), 404
        
        timeout = request.args.get('timeout', 10, type=int)
        result = service.check_health(server['url'], timeout=timeout)
        result['server_id'] = server_id
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@mcp_bp.route('/health', methods=['GET'])
def check_all_health():
    """检查所有服务器健康状态"""
    try:
        service = get_mcp_service()
        timeout = request.args.get('timeout', 10, type=int)
        results = service.check_all_health(timeout=timeout)
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
