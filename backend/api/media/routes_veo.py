"""Veo (Vertex) 视频接口：POST submit, GET status/:task_id"""

from flask import request, jsonify
from . import media_bp


@media_bp.route('/veo/video/submit', methods=['POST'])
def veo_video_submit():
    """提交文生视频/图生视频"""
    return jsonify({'error': 'Not implemented', 'provider': 'veo'}), 501


@media_bp.route('/veo/video/status/<task_id>', methods=['GET'])
def veo_video_status(task_id):
    """查询任务状态与结果"""
    return jsonify({'error': 'Not implemented', 'provider': 'veo'}), 501
