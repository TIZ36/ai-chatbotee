"""
消息服务层
处理消息相关的业务逻辑

优化策略:
1. 使用 Redis 缓存消息，减少数据库查询
2. 按需批量获取消息（默认50条）
3. 媒体列表使用 ZSET 索引，支持快速导航
4. 消息编辑/回退时清除缓存
"""

from typing import List, Optional, Dict, Any, Tuple
import uuid

from models.message import Message, MessageRepository
from services.message_cache_service import get_message_cache_service


class MessageService:
    """消息服务"""
    
    # 默认批量获取数量
    DEFAULT_BATCH_SIZE = 50
    
    def __init__(self, get_connection):
        """
        Args:
            get_connection: 获取数据库连接的函数
        """
        self.repository = MessageRepository(get_connection)
        self._session_repository = None
        self._cache_service = None
    
    @property
    def cache_service(self):
        """延迟获取缓存服务"""
        if self._cache_service is None:
            self._cache_service = get_message_cache_service()
        return self._cache_service
    
    def set_session_repository(self, session_repository):
        """设置会话仓库（用于更新 last_message_at）"""
        self._session_repository = session_repository
    
    def get_latest_message_id(self, session_id: str) -> Optional[str]:
        """
        获取会话的最新消息ID
        
        优先从缓存获取，缓存未命中则查询数据库
        """
        # 先尝试从缓存获取
        latest_id = self.cache_service.get_latest_message_id(session_id)
        if latest_id:
            return latest_id
        
        # 缓存未命中，查询数据库
        messages = self.repository.find_by_session(session_id, limit=1)
        if messages:
            latest_msg = messages[0]
            return latest_msg.message_id
        return None
    
    def get_messages_paginated(
        self, 
        session_id: str, 
        limit: int = DEFAULT_BATCH_SIZE,
        before_id: Optional[str] = None,
        after_id: Optional[str] = None,
        use_cache: bool = True
    ) -> Tuple[List[dict], bool, Optional[str]]:
        """
        分页获取会话消息（优化版）
        
        Args:
            session_id: 会话 ID
            limit: 返回数量限制（默认50条）
            before_id: 获取此消息之前的消息
            after_id: 获取此消息之后的消息
            use_cache: 是否使用缓存
            
        Returns:
            (消息列表, 是否有更多消息, 最新消息ID)
        """
        # 尝试从缓存获取
        if use_cache and self.cache_service.is_cache_valid(session_id):
            messages, has_more = self.cache_service.get_cached_messages(
                session_id, limit=limit, before_id=before_id, after_id=after_id
            )
            if messages:
                latest_id = self.cache_service.get_latest_message_id(session_id)
                return messages, has_more, latest_id
        
        # 缓存未命中或未启用，从数据库获取
        db_messages = self.repository.find_by_session(
            session_id, limit=limit + 1, before=before_id
        )
        
        has_more = len(db_messages) > limit
        if has_more:
            db_messages = db_messages[:limit]
        
        messages = [msg.to_dict() for msg in db_messages]
        
        # 更新缓存
        if use_cache and messages:
            self.cache_service.cache_messages_batch(session_id, messages)
        
        # 获取最新消息ID
        latest_id = messages[-1]['message_id'] if messages else None
        
        return messages, has_more, latest_id
    
    def get_messages(self, session_id: str, limit: int = 100,
                     before: str = None, use_cache: bool = True) -> List[dict]:
        """
        获取会话消息列表（保持向后兼容）
        
        Args:
            session_id: 会话 ID
            limit: 返回数量限制
            before: 在此消息 ID 之前的消息
            use_cache: 是否使用缓存
        """
        # 尝试从缓存获取
        if use_cache and self.cache_service.is_cache_valid(session_id):
            messages, _ = self.cache_service.get_cached_messages(
                session_id, limit=limit, before_id=before
            )
            if messages:
                return messages
        
        # 缓存未命中，从数据库获取
        db_messages = self.repository.find_by_session(session_id, limit=limit, before=before)
        messages = [msg.to_dict() for msg in db_messages]
        
        # 更新缓存
        if use_cache and messages:
            self.cache_service.cache_messages_batch(session_id, messages)
        
        return messages
    
    def get_message(self, message_id: str, session_id: str = None) -> Optional[dict]:
        """
        获取单个消息
        
        Args:
            message_id: 消息ID
            session_id: 会话ID（可选，提供后可使用缓存）
        """
        # 如果提供了 session_id，尝试从缓存获取
        if session_id:
            cached_msg = self.cache_service.get_message(session_id, message_id)
            if cached_msg:
                return cached_msg
        
        # 从数据库获取
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
        session_id = data['session_id']
        
        message = Message(
            message_id=message_id,
            session_id=session_id,
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
                self._session_repository.update_last_message_at(session_id)
            
            # 更新缓存
            msg_dict = message.to_dict()
            self.cache_service.cache_message(msg_dict)
            
            return msg_dict
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
            
            # 按 session_id 分组更新缓存
            messages_dict = [msg.to_dict() for msg in messages]
            session_messages = {}
            for msg in messages_dict:
                sid = msg['session_id']
                if sid not in session_messages:
                    session_messages[sid] = []
                session_messages[sid].append(msg)
            
            for sid, msgs in session_messages.items():
                self.cache_service.cache_messages_batch(sid, msgs)
            
            return messages_dict
        raise RuntimeError('Failed to save messages')
    
    def update_message(self, message_id: str, data: dict) -> Optional[dict]:
        """
        更新消息
        
        更新消息时会同步更新缓存
        """
        existing = self.repository.find_by_id(message_id)
        if not existing:
            return None
        
        session_id = existing.session_id
        
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
            msg_dict = existing.to_dict()
            # 更新缓存中的消息
            self.cache_service.update_message(session_id, message_id, msg_dict)
            return msg_dict
        return None
    
    def delete_message(self, message_id: str) -> bool:
        """
        删除消息
        
        删除消息时会使整个会话缓存失效（因为可能影响消息顺序）
        """
        # 先获取消息以获取 session_id
        existing = self.repository.find_by_id(message_id)
        session_id = existing.session_id if existing else None
        
        result = self.repository.delete(message_id)
        
        # 删除成功后使缓存失效
        if result and session_id:
            self.cache_service.invalidate_session_cache(session_id)
        
        return result
    
    def delete_messages_after(self, session_id: str, message_id: str) -> int:
        """
        删除指定消息之后的所有消息（用于回退功能）
        
        Args:
            session_id: 会话ID
            message_id: 从此消息之后开始删除
            
        Returns:
            删除的消息数量
        """
        # 先使缓存失效
        self.cache_service.invalidate_session_cache(session_id)
        # 同时使媒体库缓存失效（否则 media-library 可能继续展示已回退消息的 ext.media）
        try:
            from services.media_library_service import get_media_library_service
            get_media_library_service().invalidate_session(session_id)
        except Exception as e:
            print(f"[MessageService] Warning: Failed to invalidate media library cache: {e}")
        
        # 删除数据库中的消息
        return self.repository.delete_after(session_id, message_id)
    
    def delete_session_messages(self, session_id: str) -> int:
        """
        删除会话的所有消息
        
        删除时会清空会话缓存
        """
        # 先使缓存失效
        self.cache_service.invalidate_session_cache(session_id)
        # 同时使媒体库缓存失效
        try:
            from services.media_library_service import get_media_library_service
            get_media_library_service().invalidate_session(session_id)
        except Exception as e:
            print(f"[MessageService] Warning: Failed to invalidate media library cache: {e}")
        
        return self.repository.delete_by_session(session_id)
    
    def count_messages(self, session_id: str) -> int:
        """统计会话消息数量"""
        return self.repository.count_by_session(session_id)
    
    # ==================== 媒体列表相关 ====================
    
    def get_media_list(
        self, 
        session_id: str, 
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[List[dict], int]:
        """
        获取会话的媒体列表
        
        Args:
            session_id: 会话ID
            limit: 获取数量
            offset: 偏移量
            
        Returns:
            (媒体消息列表, 总数)
        """
        return self.cache_service.get_media_list(session_id, limit=limit, offset=offset)
    
    def get_cache_stats(self, session_id: str) -> Dict[str, Any]:
        """获取会话缓存统计信息"""
        return self.cache_service.get_cache_stats(session_id)
    
    def refresh_cache(self, session_id: str, limit: int = DEFAULT_BATCH_SIZE) -> bool:
        """
        刷新会话缓存
        
        从数据库重新加载消息到缓存
        """
        # 先清空缓存
        self.cache_service.invalidate_session_cache(session_id)
        
        # 从数据库获取消息
        db_messages = self.repository.find_by_session(session_id, limit=limit)
        messages = [msg.to_dict() for msg in db_messages]
        
        if messages:
            return self.cache_service.cache_messages_batch(session_id, messages)
        
        return True


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
