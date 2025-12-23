"""
会话 API 路由
"""

from flask import Blueprint, request, jsonify

from services.session_service import get_session_service
from utils.auth import get_client_ip

# 创建 Blueprint
session_bp = Blueprint('session', __name__)


@session_bp.route('', methods=['GET'])
def get_sessions():
    """获取会话列表"""
    try:
        service = get_session_service()
        
        session_type = request.args.get('type')
        limit = request.args.get('limit', 100, type=int)
        offset = request.args.get('offset', 0, type=int)
        include_avatar = request.args.get('include_avatar', 'false').lower() == 'true'
        
        sessions = service.get_sessions(
            session_type=session_type,
            limit=limit,
            offset=offset,
            include_avatar=include_avatar
        )
        return jsonify(sessions)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@session_bp.route('/<session_id>', methods=['GET'])
def get_session(session_id):
    """获取单个会话"""
    try:
        service = get_session_service()
        include_avatar = request.args.get('include_avatar', 'true').lower() == 'true'
        session = service.get_session(session_id, include_avatar=include_avatar)
        if session:
            return jsonify(session)
        return jsonify({'error': 'Session not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@session_bp.route('', methods=['POST'])
def create_session():
    """创建会话"""
    try:
        service = get_session_service()
        data = request.get_json()
        creator_ip = get_client_ip()
        session = service.create_session(data, creator_ip=creator_ip)
        return jsonify(session), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@session_bp.route('/<session_id>', methods=['PUT'])
def update_session(session_id):
    """更新会话"""
    try:
        service = get_session_service()
        data = request.get_json()
        session = service.update_session(session_id, data)
        if session:
            return jsonify(session)
        return jsonify({'error': 'Session not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@session_bp.route('/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    """删除会话"""
    try:
        service = get_session_service()
        if service.delete_session(session_id):
            return jsonify({'success': True})
        return jsonify({'error': 'Session not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ==================== Agent 路由 ====================

@session_bp.route('/agents', methods=['GET'])
def get_agents():
    """获取智能体列表"""
    try:
        service = get_session_service()
        
        # 获取请求者 IP 用于权限过滤
        client_ip = get_client_ip()
        filter_by_ip = request.args.get('filter_by_ip', 'false').lower() == 'true'
        include_avatar = request.args.get('include_avatar', 'false').lower() == 'true'
        
        agents = service.get_agents(
            creator_ip=client_ip if filter_by_ip else None,
            include_avatar=include_avatar
        )
        return jsonify(agents)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@session_bp.route('/agents', methods=['POST'])
def create_agent():
    """创建智能体"""
    try:
        service = get_session_service()
        data = request.get_json()
        creator_ip = get_client_ip()
        agent = service.create_agent(data, creator_ip=creator_ip)
        return jsonify(agent), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ==================== Memory 路由 ====================

@session_bp.route('/memories', methods=['GET'])
def get_memories():
    """获取记忆体列表"""
    try:
        service = get_session_service()
        include_avatar = request.args.get('include_avatar', 'false').lower() == 'true'
        memories = service.get_memories(include_avatar=include_avatar)
        return jsonify(memories)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@session_bp.route('/memories', methods=['POST'])
def create_memory():
    """创建记忆体"""
    try:
        service = get_session_service()
        data = request.get_json()
        creator_ip = get_client_ip()
        memory = service.create_memory(data, creator_ip=creator_ip)
        return jsonify(memory), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500
