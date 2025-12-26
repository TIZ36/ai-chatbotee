"""
会话服务层
处理会话相关的业务逻辑
"""

from typing import List, Optional, Dict, Any
import uuid

from models.session import Session, SessionRepository


class SessionService:
    """会话服务"""
    
    def __init__(self, get_connection):
        """
        Args:
            get_connection: 获取数据库连接的函数
        """
        self.repository = SessionRepository(get_connection)
    
    def get_sessions(self, session_type: str = None, limit: int = 100,
                     offset: int = 0, creator_ip: str = None,
                     include_avatar: bool = False) -> List[dict]:
        """
        获取会话列表
        
        Args:
            session_type: 会话类型过滤
            limit: 返回数量限制
            offset: 偏移量
            creator_ip: 创建者 IP 过滤
            include_avatar: 是否包含头像数据
        """
        sessions = self.repository.find_all(
            session_type=session_type,
            limit=limit,
            offset=offset,
            creator_ip=creator_ip
        )
        return [session.to_dict(include_avatar=include_avatar) for session in sessions]
    
    def get_session(self, session_id: str, include_avatar: bool = True) -> Optional[dict]:
        """获取单个会话"""
        session = self.repository.find_by_id(session_id)
        if session:
            return session.to_dict(include_avatar=include_avatar)
        return None
    
    def create_session(self, data: dict, creator_ip: str = None) -> dict:
        """
        创建会话
        
        Args:
            data: 会话数据
            creator_ip: 创建者 IP
        
        Returns:
            创建的会话
        """
        session_id = data.get('session_id') or f"session_{uuid.uuid4().hex[:8]}"
        
        session = Session(
            session_id=session_id,
            title=data.get('title'),
            name=data.get('name'),
            llm_config_id=data.get('llm_config_id'),
            session_type=data.get('session_type', 'memory'),
            avatar=data.get('avatar'),
            system_prompt=data.get('system_prompt'),
            media_output_path=data.get('media_output_path'),
            role_id=data.get('role_id'),
            role_version_id=data.get('role_version_id'),
            role_snapshot=data.get('role_snapshot'),
            role_applied_at=data.get('role_applied_at'),
            creator_ip=creator_ip,
        )
        
        if self.repository.save(session):
            return session.to_dict()
        raise RuntimeError('Failed to save session')
    
    def update_session(self, session_id: str, data: dict) -> Optional[dict]:
        """更新会话"""
        existing = self.repository.find_by_id(session_id)
        if not existing:
            return None
        
        if 'title' in data:
            existing.title = data['title']
        if 'name' in data:
            existing.name = data['name']
        if 'llm_config_id' in data:
            existing.llm_config_id = data['llm_config_id']
        if 'session_type' in data:
            existing.session_type = data['session_type']
        if 'avatar' in data:
            existing.avatar = data['avatar']
        if 'system_prompt' in data:
            existing.system_prompt = data['system_prompt']
        if 'media_output_path' in data:
            existing.media_output_path = data['media_output_path']
        if 'role_id' in data:
            existing.role_id = data['role_id']
        if 'role_version_id' in data:
            existing.role_version_id = data['role_version_id']
        if 'role_snapshot' in data:
            existing.role_snapshot = data['role_snapshot']
        if 'role_applied_at' in data:
            existing.role_applied_at = data['role_applied_at']
        if 'ext' in data:
            existing.ext = data['ext']
        
        if self.repository.save(existing):
            return existing.to_dict()
        return None
    
    def delete_session(self, session_id: str) -> bool:
        """删除会话"""
        return self.repository.delete(session_id)
    
    def update_last_message_at(self, session_id: str) -> bool:
        """更新最后消息时间"""
        return self.repository.update_last_message_at(session_id)
    
    # ==================== Agent 相关 ====================
    
    def get_agents(self, creator_ip: str = None, 
                   include_avatar: bool = False) -> List[dict]:
        """
        获取智能体列表
        
        Args:
            creator_ip: 创建者 IP（用于权限过滤）
            include_avatar: 是否包含头像
        """
        return self.get_sessions(
            session_type='agent',
            creator_ip=creator_ip,
            include_avatar=include_avatar
        )
    
    def create_agent(self, data: dict, creator_ip: str = None) -> dict:
        """
        创建智能体
        
        Args:
            data: 智能体数据
            creator_ip: 创建者 IP
        """
        data['session_type'] = 'agent'
        return self.create_session(data, creator_ip=creator_ip)
    
    # ==================== Memory 相关 ====================
    
    def get_memories(self, include_avatar: bool = False) -> List[dict]:
        """获取记忆体列表（包含普通话题）"""
        # 同时获取 memory 和 topic_general 类型的会话
        memories = self.repository.find_all(
            session_type='memory',
            include_avatar=include_avatar
        )
        topics = self.repository.find_all(
            session_type='topic_general',
            include_avatar=include_avatar
        )
        
        all_items = memories + topics
        # 按最后更新时间排序
        all_items.sort(key=lambda x: x.last_message_at or x.created_at or '', reverse=True)
        
        return [item.to_dict(include_avatar=include_avatar) for item in all_items]
    
    def create_memory(self, data: dict, creator_ip: str = None) -> dict:
        """创建记忆体"""
        data['session_type'] = 'memory'
        return self.create_session(data, creator_ip=creator_ip)
    
    # ==================== 参与者管理 ====================
    
    def get_participants(self, session_id: str) -> List[dict]:
        """获取会话参与者列表"""
        return self.repository.get_participants(session_id)
    
    def add_participant(self, session_id: str, participant_id: str, 
                        participant_type: str = 'agent', role: str = 'member') -> bool:
        """添加参与者到会话"""
        return self.repository.add_participant(session_id, participant_id, participant_type, role)
    
    def remove_participant(self, session_id: str, participant_id: str) -> bool:
        """从会话移除参与者"""
        return self.repository.remove_participant(session_id, participant_id)


# 全局服务实例
session_service: Optional[SessionService] = None


def init_session_service(get_connection):
    """初始化会话服务"""
    global session_service
    session_service = SessionService(get_connection)
    return session_service


def get_session_service() -> SessionService:
    """获取会话服务实例"""
    if session_service is None:
        raise RuntimeError('Session service not initialized')
    return session_service
