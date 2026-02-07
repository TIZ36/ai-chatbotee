"""Gemini 媒体接口：图像 + 视频（Veo）"""

from flask import request, jsonify, Response
from . import media_bp
from services import media_service as svc


# ─── 图像 ───

@media_bp.route('/gemini/image/generate', methods=['POST'])
def gemini_image_generate():
    """文生图。Body: { "prompt": str, "config_id": str?, "model": str? }"""
    try:
        body = request.get_json(silent=True) or {}
        prompt = body.get('prompt') or ''
        config_id = body.get('config_id')
        model = body.get('model')
        result = svc.gemini_image_generate(prompt=prompt, config_id=config_id, model=model)
        if result.get('error'):
            return jsonify(result), 400
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@media_bp.route('/gemini/image/edit', methods=['POST'])
def gemini_image_edit():
    """图生图。Body: { "prompt": str, "image_b64": str?, "thought_signature": str?, "config_id": str?, "model": str? }"""
    try:
        body = request.get_json(silent=True) or {}
        prompt = body.get('prompt') or ''
        image_b64 = body.get('image_b64')
        images_b64 = body.get('images_b64')  # 多图支持
        thought_signature = body.get('thought_signature')
        config_id = body.get('config_id')
        model = body.get('model')
        result = svc.gemini_image_edit(
            prompt=prompt, image_b64=image_b64, images_b64=images_b64,
            config_id=config_id, model=model,
            thought_signature=thought_signature
        )
        if result.get('error'):
            return jsonify(result), 400
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── 视频 (Veo) ───

@media_bp.route('/gemini/video/submit', methods=['POST'])
def gemini_video_submit():
    """
    提交 Gemini Veo 视频生成任务。
    Body: {
        "prompt": str,
        "image_b64": str?,    // 可选首帧图片
        "config_id": str?,    // 指定 LLM 配置
        "model": str?         // 覆盖模型名 (如 veo-2.0-generate-001)
    }
    """
    try:
        body = request.get_json(silent=True) or {}
        prompt = body.get('prompt') or body.get('prompt_text') or ''
        image_b64 = body.get('image_b64') or body.get('prompt_image')
        config_id = body.get('config_id')
        model = body.get('model')
        result = svc.gemini_video_submit(
            prompt=prompt, image_b64=image_b64,
            config_id=config_id, model=model
        )
        if result.get('error'):
            return jsonify(result), 400
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@media_bp.route('/gemini/video/status/<path:task_name>', methods=['GET'])
def gemini_video_status(task_name: str):
    """
    查询 Gemini Veo 视频生成任务状态。
    task_name: 操作名称 (如 operations/xxx)
    Query: ?config_id=xxx
    """
    try:
        config_id = request.args.get('config_id')
        result = svc.gemini_video_status(task_name=task_name, config_id=config_id)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({'error': str(e), 'status': 'UNKNOWN'}), 500


# ─── 视频下载代理 ───

@media_bp.route('/gemini/video/download', methods=['POST'])
def gemini_video_download():
    """
    代理下载 Gemini Veo 视频。
    前端无法直接访问 Google 的视频 URI（需要 API Key），
    通过此接口中转下载。
    Body: { "video_uri": str, "config_id": str? }
    """
    try:
        body = request.get_json(silent=True) or {}
        video_uri = body.get('video_uri') or ''
        config_id = body.get('config_id')
        if not video_uri:
            return jsonify({'error': '缺少 video_uri'}), 400

        result = svc.gemini_video_download(video_uri=video_uri, config_id=config_id)
        if result.get('error'):
            return jsonify(result), 400

        return Response(
            result['data'],
            mimetype=result.get('content_type', 'video/mp4'),
            headers={
                'Content-Disposition': 'attachment; filename="generated_video.mp4"',
                'Cache-Control': 'public, max-age=3600',
            },
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── 模型能力查询 ───

@media_bp.route('/gemini/model-capabilities', methods=['GET'])
def gemini_model_capabilities():
    """返回系统支持的 Gemini 模型能力注册表。"""
    try:
        registry = [
            {k: v for k, v in cap.items()}
            for cap in svc.GEMINI_MODEL_CAPABILITIES
        ]
        return jsonify({'models': registry}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
