"""
MCP 服务器数据模型
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any, List
import json


@dataclass
class MCPServer:
    """MCP 服务器配置数据模型"""
    
    server_id: str
    name: str
    url: str
    type: str = 'http-stream'  # http-stream, http-post, stdio
    enabled: bool = True
    use_proxy: bool = True  # 是否使用后端代理（解决CORS）
    description: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    ext: Optional[Dict[str, Any]] = None  # 扩展配置（如 Notion 的额外配置）
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    @classmethod
    def from_db_row(cls, row: dict) -> 'MCPServer':
        """从数据库行创建实例"""
        metadata = row.get('metadata')
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        
        ext = row.get('ext')
        if isinstance(ext, str):
            ext = json.loads(ext)
        
        return cls(
            server_id=row['server_id'],
            name=row['name'],
            url=row['url'],
            type=row.get('type', 'http-stream'),
            enabled=bool(row.get('enabled', True)),
            use_proxy=bool(row.get('use_proxy', True)),
            description=row.get('description'),
            metadata=metadata,
            ext=ext,
            created_at=row.get('created_at'),
            updated_at=row.get('updated_at'),
        )
    
    def to_dict(self, include_ext: bool = True) -> dict:
        """转换为字典"""
        result = {
            'server_id': self.server_id,
            'name': self.name,
            'url': self.url,
            'type': self.type,
            'enabled': self.enabled,
            'use_proxy': self.use_proxy,
            'description': self.description,
            'metadata': self.metadata,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        
        if include_ext:
            result['ext'] = self.ext
        
        return result
    
    def to_db_params(self) -> dict:
        """转换为数据库插入/更新参数"""
        return {
            'server_id': self.server_id,
            'name': self.name,
            'url': self.url,
            'type': self.type,
            'enabled': 1 if self.enabled else 0,
            'use_proxy': 1 if self.use_proxy else 0,
            'description': self.description,
            'metadata': json.dumps(self.metadata) if self.metadata else None,
            'ext': json.dumps(self.ext) if self.ext else None,
        }


class MCPServerRepository:
    """MCP 服务器数据仓库"""
    
    def __init__(self, get_connection):
        """
        Args:
            get_connection: 获取数据库连接的函数
        """
        self.get_connection = get_connection
    
    def find_all(self, enabled_only: bool = False) -> List[MCPServer]:
        """获取所有服务器配置"""
        conn = self.get_connection()
        if not conn:
            return []
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            if enabled_only:
                cursor.execute("SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY created_at DESC")
            else:
                cursor.execute("SELECT * FROM mcp_servers ORDER BY created_at DESC")
            
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            
            return [MCPServer.from_db_row(row) for row in rows]
        except Exception as e:
            print(f"[MCPServerRepository] Error finding all: {e}")
            if conn:
                conn.close()
            return []
    
    def find_by_id(self, server_id: str) -> Optional[MCPServer]:
        """根据 ID 获取服务器配置"""
        conn = self.get_connection()
        if not conn:
            return None
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("SELECT * FROM mcp_servers WHERE server_id = %s", (server_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if row:
                return MCPServer.from_db_row(row)
            return None
        except Exception as e:
            print(f"[MCPServerRepository] Error finding by id: {e}")
            if conn:
                conn.close()
            return None
    
    def find_by_url(self, url: str) -> Optional[MCPServer]:
        """根据 URL 获取服务器配置"""
        conn = self.get_connection()
        if not conn:
            return None
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("SELECT * FROM mcp_servers WHERE url = %s", (url,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if row:
                return MCPServer.from_db_row(row)
            return None
        except Exception as e:
            print(f"[MCPServerRepository] Error finding by url: {e}")
            if conn:
                conn.close()
            return None
    
    def save(self, server: MCPServer) -> bool:
        """保存服务器配置（插入或更新）"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            params = server.to_db_params()
            
            sql = """
            INSERT INTO mcp_servers 
            (server_id, name, url, type, enabled, use_proxy, description, metadata, ext)
            VALUES (%(server_id)s, %(name)s, %(url)s, %(type)s, %(enabled)s, 
                    %(use_proxy)s, %(description)s, %(metadata)s, %(ext)s)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                url = VALUES(url),
                type = VALUES(type),
                enabled = VALUES(enabled),
                use_proxy = VALUES(use_proxy),
                description = VALUES(description),
                metadata = VALUES(metadata),
                ext = VALUES(ext),
                updated_at = CURRENT_TIMESTAMP
            """
            cursor.execute(sql, params)
            conn.commit()
            cursor.close()
            conn.close()
            return True
        except Exception as e:
            print(f"[MCPServerRepository] Error saving: {e}")
            if conn:
                conn.close()
            return False
    
    def delete(self, server_id: str) -> bool:
        """删除服务器配置"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM mcp_servers WHERE server_id = %s", (server_id,))
            conn.commit()
            affected = cursor.rowcount
            cursor.close()
            conn.close()
            return affected > 0
        except Exception as e:
            print(f"[MCPServerRepository] Error deleting: {e}")
            if conn:
                conn.close()
            return False
