"""
API 路由层
负责处理 HTTP 请求，参数验证，调用服务层
"""

from flask import Blueprint

# 导入子路由
from .llm import llm_bp
from .mcp import mcp_bp
from .session import session_bp
from .message import message_bp
from .workflow import workflow_bp, init_workflow_api
from .health import health_bp


def register_api_routes(app, get_connection=None, config=None):
    """
    注册所有 API 路由到 Flask 应用
    
    Args:
        app: Flask 应用实例
        get_connection: 获取数据库连接的函数
        config: 应用配置
    """
    # 初始化服务
    if get_connection:
        from services.llm_service import init_llm_service
        from services.mcp_service import init_mcp_service
        from services.session_service import init_session_service
        from services.message_service import init_message_service
        from models.session import SessionRepository
        
        # 初始化服务
        init_llm_service(get_connection)
        init_mcp_service(get_connection, config)
        init_session_service(get_connection)
        
        # 初始化消息服务，传入会话仓库用于更新 last_message_at
        session_repo = SessionRepository(get_connection)
        init_message_service(get_connection, session_repo)
        
        # 初始化工作流 API
        init_workflow_api(get_connection)
    
    # 注册 Blueprint
    app.register_blueprint(llm_bp, url_prefix='/api/llm')
    app.register_blueprint(mcp_bp, url_prefix='/api/mcp')
    app.register_blueprint(session_bp, url_prefix='/api/sessions')
    app.register_blueprint(message_bp, url_prefix='/api/messages')
    app.register_blueprint(workflow_bp, url_prefix='/api/workflows')
    app.register_blueprint(health_bp, url_prefix='/api/health')
    
    print("[API] All API routes registered successfully")
