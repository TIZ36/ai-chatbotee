"""
会话数据模型
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, List
import json


@dataclass
class Session:
    """会话数据模型"""
    
    session_id: str
    title: Optional[str] = None
    name: Optional[str] = None
    llm_config_id: Optional[str] = None
    session_type: str = 'memory'  # temporary, memory, agent
    avatar: Optional[str] = None
    system_prompt: Optional[str] = None
    media_output_path: Optional[str] = None
    role_id: Optional[str] = None
    role_version_id: Optional[str] = None
    role_snapshot: Optional[Dict[str, Any]] = None
    role_applied_at: Optional[datetime] = None
    creator_ip: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    last_message_at: Optional[datetime] = None
    
    @classmethod
    def from_db_row(cls, row: dict) -> 'Session':
        """从数据库行创建实例"""
        role_snapshot = row.get('role_snapshot')
        if isinstance(role_snapshot, str):
            role_snapshot = json.loads(role_snapshot)
        
        return cls(
            session_id=row['session_id'],
            title=row.get('title'),
            name=row.get('name'),
            llm_config_id=row.get('llm_config_id'),
            session_type=row.get('session_type', 'memory'),
            avatar=row.get('avatar'),
            system_prompt=row.get('system_prompt'),
            media_output_path=row.get('media_output_path'),
            role_id=row.get('role_id'),
            role_version_id=row.get('role_version_id'),
            role_snapshot=role_snapshot,
            role_applied_at=row.get('role_applied_at'),
            creator_ip=row.get('creator_ip'),
            created_at=row.get('created_at'),
            updated_at=row.get('updated_at'),
            last_message_at=row.get('last_message_at'),
        )
    
    def to_dict(self, include_avatar: bool = True) -> dict:
        """转换为字典"""
        result = {
            'session_id': self.session_id,
            'title': self.title,
            'name': self.name,
            'llm_config_id': self.llm_config_id,
            'session_type': self.session_type,
            'system_prompt': self.system_prompt,
            'media_output_path': self.media_output_path,
            'role_id': self.role_id,
            'role_version_id': self.role_version_id,
            'role_snapshot': self.role_snapshot,
            'role_applied_at': self.role_applied_at.isoformat() if self.role_applied_at else None,
            'creator_ip': self.creator_ip,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'last_message_at': self.last_message_at.isoformat() if self.last_message_at else None,
        }
        
        if include_avatar:
            result['avatar'] = self.avatar
        else:
            result['has_avatar'] = bool(self.avatar)
        
        return result
    
    def to_db_params(self) -> dict:
        """转换为数据库插入/更新参数"""
        return {
            'session_id': self.session_id,
            'title': self.title,
            'name': self.name,
            'llm_config_id': self.llm_config_id,
            'session_type': self.session_type,
            'avatar': self.avatar,
            'system_prompt': self.system_prompt,
            'media_output_path': self.media_output_path,
            'role_id': self.role_id,
            'role_version_id': self.role_version_id,
            'role_snapshot': json.dumps(self.role_snapshot) if self.role_snapshot else None,
            'role_applied_at': self.role_applied_at,
            'creator_ip': self.creator_ip,
        }


class SessionRepository:
    """会话数据仓库"""
    
    def __init__(self, get_connection):
        self.get_connection = get_connection
    
    def find_all(self, session_type: str = None, limit: int = 100, 
                 offset: int = 0, creator_ip: str = None) -> List[Session]:
        """获取会话列表"""
        conn = self.get_connection()
        if not conn:
            return []
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            conditions = []
            params = []
            
            if session_type:
                conditions.append("session_type = %s")
                params.append(session_type)
            
            if creator_ip:
                conditions.append("creator_ip = %s")
                params.append(creator_ip)
            
            where_clause = " AND ".join(conditions) if conditions else "1=1"
            
            sql = f"""
                SELECT * FROM sessions 
                WHERE {where_clause}
                ORDER BY last_message_at DESC, created_at DESC
                LIMIT %s OFFSET %s
            """
            params.extend([limit, offset])
            
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            
            return [Session.from_db_row(row) for row in rows]
        except Exception as e:
            print(f"[SessionRepository] Error finding all: {e}")
            if conn:
                conn.close()
            return []
    
    def find_by_id(self, session_id: str) -> Optional[Session]:
        """根据 ID 获取会话"""
        conn = self.get_connection()
        if not conn:
            return None
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("SELECT * FROM sessions WHERE session_id = %s", (session_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if row:
                return Session.from_db_row(row)
            return None
        except Exception as e:
            print(f"[SessionRepository] Error finding by id: {e}")
            if conn:
                conn.close()
            return None
    
    def save(self, session: Session) -> bool:
        """保存会话"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            params = session.to_db_params()
            
            sql = """
            INSERT INTO sessions 
            (session_id, title, name, llm_config_id, session_type, avatar, 
             system_prompt, media_output_path, role_id, role_version_id, 
             role_snapshot, role_applied_at, creator_ip)
            VALUES (%(session_id)s, %(title)s, %(name)s, %(llm_config_id)s, 
                    %(session_type)s, %(avatar)s, %(system_prompt)s, 
                    %(media_output_path)s, %(role_id)s, %(role_version_id)s,
                    %(role_snapshot)s, %(role_applied_at)s, %(creator_ip)s)
            ON DUPLICATE KEY UPDATE
                title = VALUES(title),
                name = VALUES(name),
                llm_config_id = VALUES(llm_config_id),
                session_type = VALUES(session_type),
                avatar = VALUES(avatar),
                system_prompt = VALUES(system_prompt),
                media_output_path = VALUES(media_output_path),
                role_id = VALUES(role_id),
                role_version_id = VALUES(role_version_id),
                role_snapshot = VALUES(role_snapshot),
                role_applied_at = VALUES(role_applied_at),
                updated_at = CURRENT_TIMESTAMP
            """
            cursor.execute(sql, params)
            conn.commit()
            cursor.close()
            conn.close()
            return True
        except Exception as e:
            print(f"[SessionRepository] Error saving: {e}")
            if conn:
                conn.close()
            return False
    
    def delete(self, session_id: str) -> bool:
        """删除会话"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sessions WHERE session_id = %s", (session_id,))
            conn.commit()
            affected = cursor.rowcount
            cursor.close()
            conn.close()
            return affected > 0
        except Exception as e:
            print(f"[SessionRepository] Error deleting: {e}")
            if conn:
                conn.close()
            return False
    
    def update_last_message_at(self, session_id: str) -> bool:
        """更新最后消息时间"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE sessions SET last_message_at = CURRENT_TIMESTAMP WHERE session_id = %s",
                (session_id,)
            )
            conn.commit()
            cursor.close()
            conn.close()
            return True
        except Exception as e:
            print(f"[SessionRepository] Error updating last_message_at: {e}")
            if conn:
                conn.close()
            return False
