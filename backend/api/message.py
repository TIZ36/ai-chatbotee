"""
消息 API 路由

优化的消息获取机制:
1. 支持按需分页获取消息（默认50条）
2. 返回最新消息ID用于增量同步
3. 支持缓存状态查询和刷新
4. 支持媒体列表快速获取
"""

from flask import Blueprint, request, jsonify

from services.message_service import get_message_service

# 创建 Blueprint
message_bp = Blueprint('message', __name__)


@message_bp.route('/session/<session_id>', methods=['GET'])
def get_session_messages(session_id):
    """
    获取会话消息列表（向后兼容）
    
    Query Parameters:
        - limit: 获取数量（默认100）
        - before: 获取此消息ID之前的消息
        - use_cache: 是否使用缓存（默认true）
    """
    try:
        service = get_message_service()
        
        limit = request.args.get('limit', 100, type=int)
        before = request.args.get('before')
        use_cache = request.args.get('use_cache', 'true').lower() == 'true'
        
        messages = service.get_messages(session_id, limit=limit, before=before, use_cache=use_cache)
        return jsonify(messages)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/session/<session_id>/paginated', methods=['GET'])
def get_session_messages_paginated(session_id):
    """
    分页获取会话消息（优化版）
    
    Query Parameters:
        - limit: 获取数量（默认50）
        - before_id: 获取此消息之前的消息
        - after_id: 获取此消息之后的消息
        - use_cache: 是否使用缓存（默认true）
    
    Returns:
        {
            "messages": [...],
            "has_more": true/false,
            "latest_message_id": "msg_xxx",
            "count": 50
        }
    """
    try:
        service = get_message_service()
        
        limit = request.args.get('limit', 50, type=int)
        before_id = request.args.get('before_id')
        after_id = request.args.get('after_id')
        use_cache = request.args.get('use_cache', 'true').lower() == 'true'
        
        messages, has_more, latest_id = service.get_messages_paginated(
            session_id, 
            limit=limit, 
            before_id=before_id, 
            after_id=after_id,
            use_cache=use_cache
        )
        
        return jsonify({
            'messages': messages,
            'has_more': has_more,
            'latest_message_id': latest_id,
            'count': len(messages)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/session/<session_id>/latest', methods=['GET'])
def get_latest_message_id(session_id):
    """
    获取会话的最新消息ID
    
    用于前端检测是否有新消息
    """
    try:
        service = get_message_service()
        latest_id = service.get_latest_message_id(session_id)
        return jsonify({
            'latest_message_id': latest_id
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/session/<session_id>/media', methods=['GET'])
def get_session_media(session_id):
    """
    获取会话的媒体列表
    
    Query Parameters:
        - limit: 获取数量（默认50）
        - offset: 偏移量（默认0）
    
    Returns:
        {
            "media": [...],
            "total": 100,
            "offset": 0,
            "limit": 50
        }
    """
    try:
        service = get_message_service()
        
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        media_list, total = service.get_media_list(session_id, limit=limit, offset=offset)
        
        return jsonify({
            'media': media_list,
            'total': total,
            'offset': offset,
            'limit': limit
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/session/<session_id>/cache/stats', methods=['GET'])
def get_cache_stats(session_id):
    """获取会话缓存统计信息"""
    try:
        service = get_message_service()
        stats = service.get_cache_stats(session_id)
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/session/<session_id>/cache/refresh', methods=['POST'])
def refresh_session_cache(session_id):
    """
    刷新会话缓存
    
    Body (optional):
        - limit: 缓存的消息数量（默认50）
    """
    try:
        service = get_message_service()
        
        data = request.get_json() or {}
        limit = data.get('limit', 50)
        
        success = service.refresh_cache(session_id, limit=limit)
        return jsonify({'success': success})
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
    """
    删除会话的所有消息
    
    同时会清空该会话的缓存
    """
    try:
        service = get_message_service()
        count = service.delete_session_messages(session_id)
        return jsonify({'success': True, 'deleted_count': count})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@message_bp.route('/session/<session_id>/rollback/<message_id>', methods=['DELETE'])
def rollback_to_message(session_id, message_id):
    """
    回退到指定消息（删除该消息之后的所有消息）
    
    用于用户编辑历史消息后重新生成的场景
    """
    try:
        service = get_message_service()
        count = service.delete_messages_after(session_id, message_id)
        # 通知 Actor：会话已回滚，本地历史/摘要必须同步更新（否则会出现“幽灵记忆”）
        try:
            from services.topic_service import get_topic_service
            get_topic_service()._publish_event(session_id, 'messages_rolled_back', {'to_message_id': message_id, 'deleted_count': count})
        except Exception as e:
            # 不影响回滚本身
            print(f"[Message API] Warning: failed to publish messages_rolled_back: {e}")
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
