"""Runway 视频接口：POST submit, GET status/:task_id"""

from flask import request, jsonify
from . import media_bp
from services import media_service as svc


@media_bp.route('/runway/video/submit', methods=['POST'])
def runway_video_submit():
    """提交图生视频/文生视频。Body: { "prompt_text": str?, "prompt_image": str? (data URI or URL), "model": str?, "ratio": str?, "duration": int? }"""
    try:
        body = request.get_json(silent=True) or {}
        prompt_text = body.get('prompt_text') or body.get('prompt')
        prompt_image = body.get('prompt_image') or body.get('image_url')
        model = body.get('model') or 'gen4_turbo'
        ratio = body.get('ratio') or '1280:720'
        duration = body.get('duration')
        result = svc.runway_video_submit(
            prompt_text=prompt_text, prompt_image=prompt_image,
            model=model, ratio=ratio, duration=duration
        )
        if result.get('error'):
            return jsonify(result), 400
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@media_bp.route('/runway/video/status/<task_id>', methods=['GET'])
def runway_video_status(task_id):
    """查询任务状态与结果"""
    try:
        result = svc.runway_video_status(task_id)
        if result.get('error') and 'not configured' in (result.get('error') or '').lower():
            return jsonify(result), 503
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
