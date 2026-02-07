"""媒体供应商列表：GET /api/media/providers"""

from flask import jsonify
from . import media_bp
from services import media_service as svc


@media_bp.route('/providers', methods=['GET'])
def list_providers():
    """返回已配置的媒体供应商及能力，供前端展示与选择。"""
    try:
        result = svc.list_media_providers()
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'providers': [], 'error': str(e)}), 200
