"""媒体创作产出持久化 API"""

from flask import request, jsonify, Response, send_file
from . import media_bp
from services.media_output_service import get_media_output_service


@media_bp.route('/outputs', methods=['POST'])
def save_output():
    """
    保存媒体产出。
    Body: {
        "data": str,           // base64 或 data URI（图片/视频）
        "media_type": str,     // "image" | "video"
        "mime_type": str?,
        "prompt": str?,
        "model": str?,
        "provider": str?,
        "source": str?,
        "metadata": dict?
    }
    """
    try:
        body = request.get_json(silent=True) or {}
        data = body.get('data')
        if not data:
            return jsonify({'error': '缺少 data（base64 或 data URI）'}), 400
        media_type = (body.get('media_type') or '').strip().lower()
        if media_type not in ('image', 'video'):
            return jsonify({'error': 'media_type 须为 image 或 video'}), 400

        svc = get_media_output_service()
        result = svc.save_output(
            file_data=data,
            media_type=media_type,
            mime_type=body.get('mime_type'),
            prompt=body.get('prompt'),
            model=body.get('model'),
            provider=body.get('provider'),
            source=body.get('source') or 'generated',
            metadata=body.get('metadata'),
        )
        if result.get('error'):
            return jsonify(result), 400
        return jsonify(result), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@media_bp.route('/outputs', methods=['GET'])
def list_outputs():
    """产出列表。Query: limit=50&offset=0"""
    try:
        limit = min(int(request.args.get('limit', 50)), 100)
        offset = max(0, int(request.args.get('offset', 0)))
        svc = get_media_output_service()
        items = svc.list_outputs(limit=limit, offset=offset)
        return jsonify({'items': items}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@media_bp.route('/outputs/<output_id>/file', methods=['GET'])
def get_output_file(output_id: str):
    """下载/预览产出文件"""
    try:
        svc = get_media_output_service()
        path = svc.get_output_file_path(output_id)
        if not path:
            return jsonify({'error': '产出不存在或文件已丢失'}), 404
        return send_file(
            str(path),
            mimetype=None,
            as_attachment=request.args.get('download') == '1',
            download_name=path.name,
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@media_bp.route('/outputs/<output_id>', methods=['DELETE'])
def delete_output(output_id: str):
    """删除产出"""
    try:
        svc = get_media_output_service()
        result = svc.delete_output(output_id)
        if result.get('error'):
            return jsonify(result), 400
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
