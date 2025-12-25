"""
消息数据模型
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, List
import json


@dataclass
class Message:
    """消息数据模型"""
    
    message_id: str
    session_id: str
    role: str  # user, assistant, system, tool
    content: str
    thinking: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    token_count: Optional[int] = None
    acc_token: Optional[int] = None
    ext: Optional[Dict[str, Any]] = None
    mcpdetail: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None
    
    @classmethod
    def from_db_row(cls, row: dict) -> 'Message':
        """从数据库行创建实例"""
        tool_calls = row.get('tool_calls')
        if isinstance(tool_calls, str):
            tool_calls = json.loads(tool_calls)
        
        ext = row.get('ext')
        if isinstance(ext, str):
            ext = json.loads(ext)
        
        mcpdetail = row.get('mcpdetail')
        if isinstance(mcpdetail, str):
            mcpdetail = json.loads(mcpdetail)
        
        return cls(
            message_id=row['message_id'],
            session_id=row['session_id'],
            role=row['role'],
            content=row['content'],
            thinking=row.get('thinking'),
            tool_calls=tool_calls,
            token_count=row.get('token_count'),
            acc_token=row.get('acc_token'),
            ext=ext,
            mcpdetail=mcpdetail,
            created_at=row.get('created_at'),
        )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'message_id': self.message_id,
            'session_id': self.session_id,
            'role': self.role,
            'content': self.content,
            'thinking': self.thinking,
            'tool_calls': self.tool_calls,
            'token_count': self.token_count,
            'acc_token': self.acc_token,
            'ext': self.ext,
            'mcpdetail': self.mcpdetail,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
    
    def to_db_params(self) -> dict:
        """转换为数据库插入参数"""
        return {
            'message_id': self.message_id,
            'session_id': self.session_id,
            'role': self.role,
            'content': self.content,
            'thinking': self.thinking,
            'tool_calls': json.dumps(self.tool_calls) if self.tool_calls else None,
            'token_count': self.token_count,
            'acc_token': self.acc_token,
            'ext': json.dumps(self.ext) if self.ext else None,
            'mcpdetail': json.dumps(self.mcpdetail) if self.mcpdetail else None,
        }


class MessageRepository:
    """消息数据仓库"""
    
    def __init__(self, get_connection):
        self.get_connection = get_connection
    
    def find_by_session(self, session_id: str, limit: int = 100, 
                        before: str = None) -> List[Message]:
        """获取会话消息列表"""
        conn = self.get_connection()
        if not conn:
            return []
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            if before:
                sql = """
                    SELECT * FROM messages 
                    WHERE session_id = %s AND created_at < (
                        SELECT created_at FROM messages WHERE message_id = %s
                    )
                    ORDER BY created_at DESC
                    LIMIT %s
                """
                cursor.execute(sql, (session_id, before, limit))
            else:
                sql = """
                    SELECT * FROM messages 
                    WHERE session_id = %s
                    ORDER BY created_at DESC
                    LIMIT %s
                """
                cursor.execute(sql, (session_id, limit))
            
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            
            # 反转顺序，使最早的消息在前
            messages = [Message.from_db_row(row) for row in reversed(rows)]
            return messages
        except Exception as e:
            print(f"[MessageRepository] Error finding by session: {e}")
            if conn:
                conn.close()
            return []
    
    def find_by_id(self, message_id: str) -> Optional[Message]:
        """根据 ID 获取消息"""
        conn = self.get_connection()
        if not conn:
            return None
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("SELECT * FROM messages WHERE message_id = %s", (message_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if row:
                return Message.from_db_row(row)
            return None
        except Exception as e:
            print(f"[MessageRepository] Error finding by id: {e}")
            if conn:
                conn.close()
            return None
    
    def save(self, message: Message) -> bool:
        """保存消息"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            params = message.to_db_params()
            
            sql = """
            INSERT INTO messages 
            (message_id, session_id, role, content, thinking, tool_calls, 
             token_count, acc_token, ext, mcpdetail)
            VALUES (%(message_id)s, %(session_id)s, %(role)s, %(content)s, 
                    %(thinking)s, %(tool_calls)s, %(token_count)s, %(acc_token)s,
                    %(ext)s, %(mcpdetail)s)
            ON DUPLICATE KEY UPDATE
                content = VALUES(content),
                thinking = VALUES(thinking),
                tool_calls = VALUES(tool_calls),
                token_count = VALUES(token_count),
                acc_token = VALUES(acc_token),
                ext = VALUES(ext),
                mcpdetail = VALUES(mcpdetail)
            """
            cursor.execute(sql, params)
            conn.commit()
            cursor.close()
            conn.close()
            return True
        except Exception as e:
            print(f"[MessageRepository] Error saving: {e}")
            if conn:
                conn.close()
            return False
    
    def save_batch(self, messages: List[Message]) -> bool:
        """批量保存消息"""
        if not messages:
            return True
        
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            
            sql = """
            INSERT INTO messages 
            (message_id, session_id, role, content, thinking, tool_calls, 
             token_count, acc_token, ext, mcpdetail)
            VALUES (%(message_id)s, %(session_id)s, %(role)s, %(content)s, 
                    %(thinking)s, %(tool_calls)s, %(token_count)s, %(acc_token)s,
                    %(ext)s, %(mcpdetail)s)
            ON DUPLICATE KEY UPDATE
                content = VALUES(content),
                thinking = VALUES(thinking),
                tool_calls = VALUES(tool_calls),
                token_count = VALUES(token_count),
                acc_token = VALUES(acc_token),
                ext = VALUES(ext),
                mcpdetail = VALUES(mcpdetail)
            """
            
            for message in messages:
                cursor.execute(sql, message.to_db_params())
            
            conn.commit()
            cursor.close()
            conn.close()
            return True
        except Exception as e:
            print(f"[MessageRepository] Error saving batch: {e}")
            if conn:
                conn.close()
            return False
    
    def delete(self, message_id: str) -> bool:
        """删除消息"""
        conn = self.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM messages WHERE message_id = %s", (message_id,))
            conn.commit()
            affected = cursor.rowcount
            cursor.close()
            conn.close()
            return affected > 0
        except Exception as e:
            print(f"[MessageRepository] Error deleting: {e}")
            if conn:
                conn.close()
            return False
    
    def delete_by_session(self, session_id: str) -> int:
        """删除会话的所有消息"""
        conn = self.get_connection()
        if not conn:
            return 0
        
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM messages WHERE session_id = %s", (session_id,))
            conn.commit()
            affected = cursor.rowcount
            cursor.close()
            conn.close()
            return affected
        except Exception as e:
            print(f"[MessageRepository] Error deleting by session: {e}")
            if conn:
                conn.close()
            return 0
    
    def count_by_session(self, session_id: str) -> int:
        """统计会话消息数量"""
        conn = self.get_connection()
        if not conn:
            return 0
        
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM messages WHERE session_id = %s", (session_id,))
            count = cursor.fetchone()[0]
            cursor.close()
            conn.close()
            return count
        except Exception as e:
            print(f"[MessageRepository] Error counting: {e}")
            if conn:
                conn.close()
            return 0
    
    def delete_after(self, session_id: str, message_id: str) -> int:
        """
        删除指定消息之后的所有消息（用于回退功能）
        
        Args:
            session_id: 会话ID
            message_id: 从此消息之后开始删除（不包含此消息）
            
        Returns:
            删除的消息数量
        """
        conn = self.get_connection()
        if not conn:
            return 0
        
        try:
            cursor = conn.cursor()
            # 先获取指定消息的 created_at
            cursor.execute(
                "SELECT created_at FROM messages WHERE message_id = %s AND session_id = %s",
                (message_id, session_id)
            )
            row = cursor.fetchone()
            if not row:
                cursor.close()
                conn.close()
                return 0
            
            created_at = row[0]
            
            # 删除 created_at 大于指定消息的所有消息
            cursor.execute(
                "DELETE FROM messages WHERE session_id = %s AND created_at > %s",
                (session_id, created_at)
            )
            conn.commit()
            affected = cursor.rowcount
            cursor.close()
            conn.close()
            return affected
        except Exception as e:
            print(f"[MessageRepository] Error deleting after: {e}")
            if conn:
                conn.close()
            return 0
    
    def find_latest(self, session_id: str) -> Optional[Message]:
        """获取会话的最新消息"""
        conn = self.get_connection()
        if not conn:
            return None
        
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute(
                "SELECT * FROM messages WHERE session_id = %s ORDER BY created_at DESC LIMIT 1",
                (session_id,)
            )
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if row:
                return Message.from_db_row(row)
            return None
        except Exception as e:
            print(f"[MessageRepository] Error finding latest: {e}")
            if conn:
                conn.close()
            return None