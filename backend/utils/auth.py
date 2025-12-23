"""
认证和授权工具
处理用户身份识别和权限检查
"""

from flask import request
from typing import Optional
import pymysql


def get_client_ip() -> str:
    """
    获取客户端真实IP地址（考虑代理）
    
    Returns:
        客户端 IP 地址字符串
    """
    # 优先从 X-Forwarded-For 获取（如果经过代理）
    forwarded_for = request.headers.get('X-Forwarded-For')
    if forwarded_for:
        # X-Forwarded-For 可能包含多个IP，取第一个
        ip = forwarded_for.split(',')[0].strip()
        if ip:
            return ip
    
    # 其次从 X-Real-IP 获取
    real_ip = request.headers.get('X-Real-IP')
    if real_ip:
        return real_ip.strip()
    
    # 最后使用 request.remote_addr
    return request.remote_addr or 'unknown'


def is_owner_ip(ip: str, config: dict = None, get_mysql_connection=None) -> bool:
    """
    检查IP是否为软件拥有者（包括配置的拥有者IP和管理员）
    
    Args:
        ip: 要检查的 IP 地址
        config: 应用配置字典
        get_mysql_connection: 获取 MySQL 连接的函数
        
    Returns:
        是否为拥有者 IP
    """
    # 1. 检查配置的拥有者IP列表
    if config:
        owner_config = config.get('owner', {}) or {}
        owner_ips_str = owner_config.get('ip_addresses', '127.0.0.1,::1')
        owner_ips = [ip.strip() for ip in owner_ips_str.split(',') if ip.strip()]
        if ip in owner_ips:
            return True
    
    # 2. 检查本机访问（127.0.0.1, ::1, localhost）
    if ip in ['127.0.0.1', '::1', 'localhost']:
        return True
    
    # 3. 检查数据库中是否为管理员
    if get_mysql_connection:
        try:
            conn = get_mysql_connection()
            if conn:
                cursor = conn.cursor(pymysql.cursors.DictCursor)
                cursor.execute("""
                    SELECT is_admin FROM user_access WHERE ip_address = %s
                """, (ip,))
                user = cursor.fetchone()
                cursor.close()
                conn.close()
                if user and user.get('is_admin'):
                    return True
        except Exception as e:
            print(f"[Owner Check] Error checking admin status: {e}")
    
    return False


def require_owner(config: dict = None, get_mysql_connection=None):
    """
    装饰器：要求请求者为拥有者
    
    Usage:
        @app.route('/admin/...')
        @require_owner(config, get_mysql_connection)
        def admin_endpoint():
            ...
    """
    def decorator(f):
        from functools import wraps
        from flask import jsonify
        
        @wraps(f)
        def decorated_function(*args, **kwargs):
            client_ip = get_client_ip()
            if not is_owner_ip(client_ip, config, get_mysql_connection):
                return jsonify({
                    'error': 'Forbidden',
                    'message': 'Only owner can access this endpoint'
                }), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator
