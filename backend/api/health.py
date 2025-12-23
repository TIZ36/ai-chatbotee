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
    
    result = {
        'mysql': False,
        'redis': False,
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
        redis_client = get_redis_client()
        if redis_client:
            redis_client.ping()
            result['redis'] = True
    except Exception as e:
        print(f"[Health] Redis check failed: {e}")
    
    return jsonify(result)
