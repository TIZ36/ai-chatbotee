"""OpenAI 媒体接口：POST /api/media/openai/image/generations, /edits, /variations"""

from flask import request, jsonify
from . import media_bp
from services import media_service as svc


@media_bp.route('/openai/image/generations', methods=['POST'])
def openai_image_generations():
    """文生图。Body: { "prompt": str, "config_id": str?, "model": str?, "size": str?, "response_format": str? }"""
    try:
        body = request.get_json(silent=True) or {}
        prompt = body.get('prompt') or ''
        config_id = body.get('config_id')
        model = body.get('model')
        size = body.get('size')
        response_format = body.get('response_format')
        result = svc.openai_image_generations(
            prompt=prompt, config_id=config_id, model=model, size=size, response_format=response_format
        )
        if result.get('error'):
            return jsonify(result), 400
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@media_bp.route('/openai/image/edits', methods=['POST'])
def openai_image_edits():
    """图生图/编辑。Body: { "prompt": str, "image_b64": str?, "image_mime": str?, "config_id": str?, "model": str? }"""
    try:
        body = request.get_json(silent=True) or {}
        prompt = body.get('prompt') or ''
        image_b64 = body.get('image_b64')
        image_mime = body.get('image_mime')
        config_id = body.get('config_id')
        model = body.get('model')
        result = svc.openai_image_edits(
            prompt=prompt, image_b64=image_b64, image_mime=image_mime, config_id=config_id, model=model
        )
        if result.get('error'):
            return jsonify(result), 400
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@media_bp.route('/openai/image/variations', methods=['POST'])
def openai_image_variations():
    """图生变体（DALL-E 2）。Body: { "image_b64": str?, "config_id": str?, "model": str?, ... }"""
    return jsonify({'error': 'Not implemented', 'provider': 'openai'}), 501
