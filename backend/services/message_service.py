"""
消息服务层
处理消息相关的业务逻辑
"""

from typing import List, Optional, Dict, Any
import uuid

from models.message import Message, MessageRepository


class MessageService:
    """消息服务"""
    
    def __init__(self, get_connection):
        """
        Args:
            get_connection: 获取数据库连接的函数
        """
        self.repository = MessageRepository(get_connection)
        self._session_repository = None
    
    def set_session_repository(self, session_repository):
        """设置会话仓库（用于更新 last_message_at）"""
        self._session_repository = session_repository
    
    def get_messages(self, session_id: str, limit: int = 100,
                     before: str = None) -> List[dict]:
        """
        获取会话消息列表
        
        Args:
            session_id: 会话 ID
            limit: 返回数量限制
            before: 在此消息 ID 之前的消息
        """
        messages = self.repository.find_by_session(session_id, limit=limit, before=before)
        return [msg.to_dict() for msg in messages]
    
    def get_message(self, message_id: str) -> Optional[dict]:
        """获取单个消息"""
        message = self.repository.find_by_id(message_id)
        if message:
            return message.to_dict()
        return None
    
    def save_message(self, data: dict) -> dict:
        """
        保存消息
        
        Args:
            data: 消息数据
        
        Returns:
            保存的消息
        """
        if not data.get('session_id'):
            raise ValueError('session_id is required')
        if not data.get('role'):
            raise ValueError('role is required')
        if 'content' not in data:
            raise ValueError('content is required')
        
        message_id = data.get('message_id') or f"msg_{uuid.uuid4().hex[:12]}"
        
        message = Message(
            message_id=message_id,
            session_id=data['session_id'],
            role=data['role'],
            content=data['content'],
            thinking=data.get('thinking'),
            tool_calls=data.get('tool_calls'),
            token_count=data.get('token_count'),
            acc_token=data.get('acc_token'),
            ext=data.get('ext'),
            mcpdetail=data.get('mcpdetail'),
        )
        
        if self.repository.save(message):
            # 更新会话的 last_message_at
            if self._session_repository:
                self._session_repository.update_last_message_at(data['session_id'])
            return message.to_dict()
        raise RuntimeError('Failed to save message')
    
    def save_messages_batch(self, messages_data: List[dict]) -> List[dict]:
        """
        批量保存消息
        
        Args:
            messages_data: 消息数据列表
        
        Returns:
            保存的消息列表
        """
        messages = []
        session_ids = set()
        
        for data in messages_data:
            if not data.get('session_id'):
                raise ValueError('session_id is required')
            if not data.get('role'):
                raise ValueError('role is required')
            
            message_id = data.get('message_id') or f"msg_{uuid.uuid4().hex[:12]}"
            session_ids.add(data['session_id'])
            
            message = Message(
                message_id=message_id,
                session_id=data['session_id'],
                role=data['role'],
                content=data.get('content', ''),
                thinking=data.get('thinking'),
                tool_calls=data.get('tool_calls'),
                token_count=data.get('token_count'),
                acc_token=data.get('acc_token'),
                ext=data.get('ext'),
                mcpdetail=data.get('mcpdetail'),
            )
            messages.append(message)
        
        if self.repository.save_batch(messages):
            # 更新所有涉及会话的 last_message_at
            if self._session_repository:
                for session_id in session_ids:
                    self._session_repository.update_last_message_at(session_id)
            return [msg.to_dict() for msg in messages]
        raise RuntimeError('Failed to save messages')
    
    def update_message(self, message_id: str, data: dict) -> Optional[dict]:
        """更新消息"""
        existing = self.repository.find_by_id(message_id)
        if not existing:
            return None
        
        if 'content' in data:
            existing.content = data['content']
        if 'thinking' in data:
            existing.thinking = data['thinking']
        if 'tool_calls' in data:
            existing.tool_calls = data['tool_calls']
        if 'token_count' in data:
            existing.token_count = data['token_count']
        if 'acc_token' in data:
            existing.acc_token = data['acc_token']
        if 'ext' in data:
            existing.ext = data['ext']
        if 'mcpdetail' in data:
            existing.mcpdetail = data['mcpdetail']
        
        if self.repository.save(existing):
            return existing.to_dict()
        return None
    
    def delete_message(self, message_id: str) -> bool:
        """删除消息"""
        return self.repository.delete(message_id)
    
    def delete_session_messages(self, session_id: str) -> int:
        """删除会话的所有消息"""
        return self.repository.delete_by_session(session_id)
    
    def count_messages(self, session_id: str) -> int:
        """统计会话消息数量"""
        return self.repository.count_by_session(session_id)


# 全局服务实例
message_service: Optional[MessageService] = None


def init_message_service(get_connection, session_repository=None):
    """初始化消息服务"""
    global message_service
    message_service = MessageService(get_connection)
    if session_repository:
        message_service.set_session_repository(session_repository)
    return message_service


def get_message_service() -> MessageService:
    """获取消息服务实例"""
    if message_service is None:
        raise RuntimeError('Message service not initialized')
    return message_service
