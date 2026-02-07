"""
媒体 API：按供应商区分的图像/视频生成接口
前缀: /api/media
"""

from flask import Blueprint

media_bp = Blueprint('media', __name__, url_prefix='/api/media')

# 注册各供应商路由（导入时装饰器会执行，将路由挂到 media_bp 上）
from . import routes_gemini
from . import routes_openai
from . import routes_runway
from . import routes_veo
from . import routes_providers
from . import routes_outputs
