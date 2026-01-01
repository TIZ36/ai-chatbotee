"""
健康检查 API 路由
"""

from flask import Blueprint, jsonify

# 创建 Blueprint
health_bp = Blueprint('health_api', __name__)


@health_bp.route('', methods=['GET'])
def health_check():
    """健康检查端点"""
    from database import get_mysql_connection, get_redis_client
    import database
    
    result = {
        'mysql': False,
        'redis': False,
        'redis_enabled': False,
        'redis_error': None,
    }
    
    # 检查 MySQL
    try:
        conn = get_mysql_connection()
        if conn:
            cursor = conn.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
            cursor.close()
            result['mysql'] = True
    except Exception as e:
        print(f"[Health] MySQL check failed: {e}")
    
    # 检查 Redis
    try:
        # 检查Redis是否在配置中启用
        redis_config = getattr(database, 'redis_config', None)
        if redis_config and redis_config.get('enabled', False):
            result['redis_enabled'] = True
            redis_client = get_redis_client()
            if redis_client is not None:
                try:
                    redis_client.ping()
                    result['redis'] = True
                except Exception as ping_error:
                    result['redis'] = False
                    result['redis_error'] = f'Redis连接已断开: {str(ping_error)}'
            else:
                result['redis'] = False
                result['redis_error'] = 'Redis客户端未初始化 (请检查Redis服务是否运行，以及配置中的密码是否正确)'
        else:
            result['redis_enabled'] = False
            result['redis_error'] = 'Redis在配置中已禁用'
    except Exception as e:
        print(f"[Health] Redis check failed: {e}")
        result['redis'] = False
        result['redis_error'] = f'Redis检查失败: {str(e)}'
    
    return jsonify(result)
