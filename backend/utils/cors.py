"""
CORS 配置工具
统一管理跨域请求配置
"""

from flask import Flask
from flask_cors import CORS

# 统一定义所有允许的CORS请求头
CORS_ALLOWED_HEADERS = [
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Requested-With',
    'mcp-protocol-version',
    'mcp-session-id',
    'Notion-Version',
    'notion-version',
    'X-CSRF-Token',
    'X-API-Key',
    'Cookie',
    'Origin',
    'Referer',
    'User-Agent'
]

# 统一定义所有允许的HTTP方法
CORS_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']

# 统一定义所有暴露的响应头
CORS_EXPOSE_HEADERS = [
    'mcp-session-id',
    'Content-Type',
    'Content-Length',
    'Content-Range',
    'X-Total-Count',
    'X-Page-Count',
    'Location',
    'Set-Cookie'
]

# 将列表转换为字符串（用于响应头）
CORS_ALLOWED_HEADERS_STR = ', '.join(CORS_ALLOWED_HEADERS)
CORS_ALLOWED_METHODS_STR = ', '.join(CORS_ALLOWED_METHODS)
CORS_EXPOSE_HEADERS_STR = ', '.join(CORS_EXPOSE_HEADERS)


def setup_cors(app: Flask, config: dict = None):
    """
    设置 Flask 应用的 CORS 配置
    
    Args:
        app: Flask 应用实例
        config: 可选的配置字典，可包含 origins 列表
    """
    origins = ['*']
    if config and 'cors' in config:
        origins = config['cors'].get('origins', ['*'])
    
    CORS(
        app,
        resources={r"/*": {"origins": origins}},
        allow_headers=CORS_ALLOWED_HEADERS,
        methods=CORS_ALLOWED_METHODS,
        expose_headers=CORS_EXPOSE_HEADERS,
        supports_credentials=True
    )


def get_cors_headers():
    """
    获取 CORS 响应头字典
    用于手动设置响应头
    """
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS_STR,
        'Access-Control-Allow-Methods': CORS_ALLOWED_METHODS_STR,
        'Access-Control-Expose-Headers': CORS_EXPOSE_HEADERS_STR,
        'Access-Control-Allow-Credentials': 'true',
    }


def add_cors_headers(response):
    """
    为响应添加 CORS 头
    可用作 after_request 处理器
    """
    for key, value in get_cors_headers().items():
        response.headers[key] = value
    return response
