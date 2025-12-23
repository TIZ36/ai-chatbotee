"""
消息 API 路由
"""

from flask import Blueprint, request, jsonify

from services.message_service import get_message_service

# 创建 Blueprint
message_bp = Blueprint('message', __name__)


@message_bp.route('/session/<session_id>', methods=['GET'])
def get_session_messages(session_id):
    """获取会话消息列表"""
    try:
        service = get_message_service()
        
        limit = request.args.get('limit', 100, type=int)
        before = request.args.get('before')
        
        messages = service.get_messages(session_id, limit=limit, before=before)
        return jsonify(messages)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/<message_id>', methods=['GET'])
def get_message(message_id):
    """获取单个消息"""
    try:
        service = get_message_service()
        message = service.get_message(message_id)
        if message:
            return jsonify(message)
        return jsonify({'error': 'Message not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('', methods=['POST'])
def create_message():
    """保存消息"""
    try:
        service = get_message_service()
        data = request.get_json()
        message = service.save_message(data)
        return jsonify(message), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/batch', methods=['POST'])
def create_messages_batch():
    """批量保存消息"""
    try:
        service = get_message_service()
        data = request.get_json()
        
        if not isinstance(data, list):
            return jsonify({'error': 'Expected array of messages'}), 400
        
        messages = service.save_messages_batch(data)
        return jsonify(messages), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/<message_id>', methods=['PUT'])
def update_message(message_id):
    """更新消息"""
    try:
        service = get_message_service()
        data = request.get_json()
        message = service.update_message(message_id, data)
        if message:
            return jsonify(message)
        return jsonify({'error': 'Message not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/<message_id>', methods=['DELETE'])
def delete_message(message_id):
    """删除消息"""
    try:
        service = get_message_service()
        if service.delete_message(message_id):
            return jsonify({'success': True})
        return jsonify({'error': 'Message not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/session/<session_id>', methods=['DELETE'])
def delete_session_messages(session_id):
    """删除会话的所有消息"""
    try:
        service = get_message_service()
        count = service.delete_session_messages(session_id)
        return jsonify({'success': True, 'deleted_count': count})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/session/<session_id>/count', methods=['GET'])
def count_session_messages(session_id):
    """统计会话消息数量"""
    try:
        service = get_message_service()
        count = service.count_messages(session_id)
        return jsonify({'count': count})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
