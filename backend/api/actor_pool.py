"""
Actor 池监控 API
提供正在工作的 Actor 列表及状态（上下文大小、persona、错误率、默认模型等）
"""

from flask import Blueprint, jsonify

actor_pool_bp = Blueprint('actor_pool_api', __name__)


@actor_pool_bp.route('/status', methods=['GET'])
def get_pool_status():
    """获取 Actor 池状态：所有已激活的 Actor 及其监控指标"""
    try:
        from services.actor import ActorManager
        manager = ActorManager.get_instance()
        items = manager.get_pool_status()
        return jsonify({
            'ok': True,
            'count': len(items),
            'actors': items,
        })
    except Exception as e:
        return jsonify({
            'ok': False,
            'error': str(e),
            'count': 0,
            'actors': [],
        }), 500
