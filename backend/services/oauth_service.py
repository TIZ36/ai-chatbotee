"""
OAuth 服务层
处理 MCP OAuth 流程
"""

from typing import Optional, Dict, Any
import time
import uuid
import json


class OAuthService:
    """OAuth 服务"""
    
    def __init__(self, get_mysql_connection, redis_client=None):
        """
        Args:
            get_mysql_connection: 获取 MySQL 连接的函数
            redis_client: Redis 客户端（用于缓存）
        """
        self.get_mysql_connection = get_mysql_connection
        self.redis_client = redis_client
    
    # ==================== OAuth 配置缓存 ====================
    
    def save_oauth_config(self, state: str, config: dict, ttl: int = 600) -> bool:
        """
        保存 OAuth 配置到 Redis
        
        Args:
            state: OAuth state 参数
            config: OAuth 配置
            ttl: 过期时间（秒），默认 10 分钟；None 表示永不过期
        """
        if not self.redis_client:
            print("[OAuth] Redis not available, cannot save config")
            return False
        
        try:
            key = f"oauth:config:{state}"
            value = json.dumps(config)
            
            if ttl is None:
                self.redis_client.set(key, value)
            else:
                self.redis_client.setex(key, ttl, value)
            
            return True
        except Exception as e:
            print(f"[OAuth] Error saving config: {e}")
            return False
    
    def get_oauth_config(self, state: str) -> Optional[dict]:
        """从 Redis 获取 OAuth 配置"""
        if not self.redis_client:
            return None
        
        try:
            key = f"oauth:config:{state}"
            value = self.redis_client.get(key)
            
            if value:
                if isinstance(value, bytes):
                    value = value.decode('utf-8')
                return json.loads(value)
            return None
        except Exception as e:
            print(f"[OAuth] Error getting config: {e}")
            return None
    
    def delete_oauth_config(self, state: str) -> bool:
        """删除 OAuth 配置"""
        if not self.redis_client:
            return False
        
        try:
            key = f"oauth:config:{state}"
            return self.redis_client.delete(key) > 0
        except Exception as e:
            print(f"[OAuth] Error deleting config: {e}")
            return False
    
    # ==================== Token 管理 ====================
    
    def get_token(self, mcp_url: str) -> Optional[dict]:
        """
        获取 MCP 服务器的 Token
        
        Args:
            mcp_url: MCP 服务器 URL
        
        Returns:
            Token 信息
        """
        # 先从 Redis 获取
        if self.redis_client:
            try:
                key = f"oauth:token:{mcp_url}"
                value = self.redis_client.get(key)
                if value:
                    if isinstance(value, bytes):
                        value = value.decode('utf-8')
                    return json.loads(value)
            except Exception as e:
                print(f"[OAuth] Error getting token from Redis: {e}")
        
        # 从 MySQL 获取
        conn = self.get_mysql_connection()
        if conn:
            try:
                import pymysql
                cursor = conn.cursor(pymysql.cursors.DictCursor)
                cursor.execute(
                    "SELECT * FROM oauth_tokens WHERE mcp_url = %s ORDER BY updated_at DESC LIMIT 1",
                    (mcp_url,)
                )
                row = cursor.fetchone()
                cursor.close()
                conn.close()
                
                if row:
                    return {
                        'client_id': row.get('client_id'),
                        'access_token': row.get('access_token'),
                        'refresh_token': row.get('refresh_token'),
                        'token_type': row.get('token_type'),
                        'expires_in': row.get('expires_in'),
                        'expires_at': row.get('expires_at'),
                        'scope': row.get('scope'),
                        'mcp_url': mcp_url,
                    }
            except Exception as e:
                print(f"[OAuth] Error getting token from MySQL: {e}")
                if conn:
                    conn.close()
        
        return None
    
    def save_token(self, mcp_url: str, token_info: dict) -> bool:
        """
        保存 Token
        
        Args:
            mcp_url: MCP 服务器 URL
            token_info: Token 信息
        """
        # 保存到 Redis
        if self.redis_client:
            try:
                key = f"oauth:token:{mcp_url}"
                value = json.dumps(token_info)
                self.redis_client.set(key, value)
            except Exception as e:
                print(f"[OAuth] Error saving token to Redis: {e}")
        
        # 保存到 MySQL
        client_id = token_info.get('client_id')
        if client_id:
            conn = self.get_mysql_connection()
            if conn:
                try:
                    cursor = conn.cursor()
                    sql = """
                    INSERT INTO oauth_tokens 
                    (client_id, access_token, refresh_token, token_type, expires_in, expires_at, scope, mcp_url)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        access_token = VALUES(access_token),
                        refresh_token = VALUES(refresh_token),
                        token_type = VALUES(token_type),
                        expires_in = VALUES(expires_in),
                        expires_at = VALUES(expires_at),
                        scope = VALUES(scope),
                        mcp_url = VALUES(mcp_url),
                        updated_at = CURRENT_TIMESTAMP
                    """
                    cursor.execute(sql, (
                        client_id,
                        token_info.get('access_token'),
                        token_info.get('refresh_token'),
                        token_info.get('token_type', 'bearer'),
                        token_info.get('expires_in'),
                        token_info.get('expires_at'),
                        token_info.get('scope', ''),
                        mcp_url,
                    ))
                    conn.commit()
                    cursor.close()
                    conn.close()
                    return True
                except Exception as e:
                    print(f"[OAuth] Error saving token to MySQL: {e}")
                    if conn:
                        conn.close()
        
        return self.redis_client is not None
    
    def is_token_expired(self, token_info: dict) -> bool:
        """检查 Token 是否过期"""
        if not token_info:
            return True
        
        expires_at = token_info.get('expires_at')
        if not expires_at:
            return False  # 没有过期时间，认为永不过期
        
        return time.time() >= expires_at
    
    def delete_token(self, mcp_url: str) -> bool:
        """删除 Token"""
        success = True
        
        # 从 Redis 删除
        if self.redis_client:
            try:
                key = f"oauth:token:{mcp_url}"
                self.redis_client.delete(key)
            except Exception as e:
                print(f"[OAuth] Error deleting token from Redis: {e}")
                success = False
        
        # 从 MySQL 删除
        conn = self.get_mysql_connection()
        if conn:
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM oauth_tokens WHERE mcp_url = %s", (mcp_url,))
                conn.commit()
                cursor.close()
                conn.close()
            except Exception as e:
                print(f"[OAuth] Error deleting token from MySQL: {e}")
                success = False
                if conn:
                    conn.close()
        
        return success
    
    # ==================== OAuth 流程 ====================
    
    def generate_state(self) -> str:
        """生成 OAuth state 参数"""
        return f"oauth_{uuid.uuid4().hex}"
    
    def build_authorization_url(self, oauth_config: dict, state: str,
                                 redirect_uri: str) -> str:
        """
        构建授权 URL
        
        Args:
            oauth_config: OAuth 配置（包含 authorization_endpoint, client_id 等）
            state: state 参数
            redirect_uri: 回调 URL
        
        Returns:
            完整的授权 URL
        """
        from urllib.parse import urlencode
        
        params = {
            'client_id': oauth_config['client_id'],
            'response_type': 'code',
            'redirect_uri': redirect_uri,
            'state': state,
        }
        
        if 'scope' in oauth_config:
            params['scope'] = oauth_config['scope']
        
        if 'resource' in oauth_config:
            params['resource'] = oauth_config['resource']
        
        authorization_endpoint = oauth_config['authorization_endpoint']
        return f"{authorization_endpoint}?{urlencode(params)}"


# 全局服务实例
oauth_service: Optional[OAuthService] = None


def init_oauth_service(get_mysql_connection, redis_client=None):
    """初始化 OAuth 服务"""
    global oauth_service
    oauth_service = OAuthService(get_mysql_connection, redis_client)
    return oauth_service


def get_oauth_service() -> OAuthService:
    """获取 OAuth 服务实例"""
    if oauth_service is None:
        raise RuntimeError('OAuth service not initialized')
    return oauth_service
