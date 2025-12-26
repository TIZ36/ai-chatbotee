"""
Topic 服务层
处理 Topic（统一会话）业务逻辑，包括成员管理和 Redis Pub/Sub 消息分发。
"""

import json
import uuid
import time
from typing import List, Optional, Dict, Any
from datetime import datetime

from models.session import Session, SessionRepository
from database import get_redis_client

class TopicService:
    """Topic 服务"""
    
    def __init__(self, get_connection, redis_client=None):
        self.repository = SessionRepository(get_connection)
        self.get_connection = get_connection
        self.redis_client = redis_client or get_redis_client()
    
    def get_topic(self, topic_id: str) -> Optional[dict]:
        """获取 Topic 详情及其参与者"""
        session = self.repository.find_by_id(topic_id)
        if not session:
            return None
        
        topic_dict = session.to_dict()
        topic_dict['participants'] = self.get_participants(topic_id)
        return topic_dict
    
    def create_topic(self, data: dict, owner_id: str, creator_ip: str = None) -> dict:
        """创建新 Topic"""
        topic_id = data.get('topic_id') or f"topic_{uuid.uuid4().hex[:8]}"
        
        # 默认 Topic 类型为 topic_general
        session_type = data.get('session_type', 'topic_general')
        
        session = Session(
            session_id=topic_id,
            title=data.get('title') or "新 Topic",
            name=data.get('name'),
            llm_config_id=data.get('llm_config_id'),
            session_type=session_type,
            owner_id=owner_id,
            avatar=data.get('avatar'),
            system_prompt=data.get('system_prompt'),
            ext=data.get('ext', {}),
            creator_ip=creator_ip
        )
        
        if self.repository.save(session):
            # 添加所有者为参与者
            self.add_participant(topic_id, owner_id, 'user', 'owner')
            
            # 如果是私聊模式，自动添加目标 Agent
            if session_type == 'private_chat' and data.get('agent_id'):
                self.add_participant(topic_id, data['agent_id'], 'agent', 'member')
            
            return session.to_dict()
        raise RuntimeError('Failed to create topic')

    def update_topic_type(self, topic_id: str, session_type: str) -> bool:
        """切换 Topic 类型 (normal, research, brainstorm)"""
        conn = self.get_connection()
        if not conn: return False
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE sessions SET session_type = %s WHERE session_id = %s",
                (session_type, topic_id)
            )
            conn.commit()
            cursor.close()
            conn.close()
            
            # 通知参与者类型已变动
            self._publish_event(topic_id, 'topic_updated', {'session_type': session_type})
            return True
        except Exception as e:
            print(f"[TopicService] Error updating topic type: {e}")
            if conn: conn.close()
            return False

    # ==================== 参与者管理 ====================

    def get_participants(self, topic_id: str) -> List[dict]:
        """获取 Topic 参与者列表"""
        conn = self.get_connection()
        if not conn: return []
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT p.*, s.name as agent_name, s.avatar as agent_avatar, s.system_prompt as agent_prompt
                FROM session_participants p
                LEFT JOIN sessions s ON p.participant_id = s.session_id AND p.participant_type = 'agent'
                WHERE p.session_id = %s
            """, (topic_id,))
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            
            participants = []
            for row in rows:
                p = {
                    'participant_id': row['participant_id'],
                    'participant_type': row['participant_type'],
                    'role': row['role'],
                    'joined_at': row['joined_at'].isoformat() if row['joined_at'] else None
                }
                if row['participant_type'] == 'agent':
                    p['name'] = row['agent_name']
                    p['avatar'] = row['agent_avatar']
                    p['system_prompt'] = row['agent_prompt']
                participants.append(p)
            return participants
        except Exception as e:
            print(f"[TopicService] Error getting participants: {e}")
            if conn: conn.close()
            return []

    def add_participant(self, topic_id: str, participant_id: str, 
                        p_type: str = 'agent', role: str = 'member') -> bool:
        """添加参与者"""
        conn = self.get_connection()
        if not conn: return False
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO session_participants (session_id, participant_id, participant_type, role)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE role = VALUES(role)
            """, (topic_id, participant_id, p_type, role))
            conn.commit()
            cursor.close()
            conn.close()
            
            # 如果是 Agent，通知它加入 Topic (激活 Actor)
            if p_type == 'agent':
                self._publish_event(topic_id, 'agent_joined', {'agent_id': participant_id})
            
            return True
        except Exception as e:
            print(f"[TopicService] Error adding participant: {e}")
            if conn: conn.close()
            return False

    def remove_participant(self, topic_id: str, participant_id: str) -> bool:
        """移除参与者"""
        conn = self.get_connection()
        if not conn: return False
        try:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM session_participants WHERE session_id = %s AND participant_id = %s",
                (topic_id, participant_id)
            )
            conn.commit()
            cursor.close()
            conn.close()
            
            self._publish_event(topic_id, 'participant_left', {'participant_id': participant_id})
            return True
        except Exception as e:
            print(f"[TopicService] Error removing participant: {e}")
            if conn: conn.close()
            return False

    # ==================== 消息分发 ====================

    def send_message(self, topic_id: str, sender_id: str, sender_type: str, 
                    content: str, role: str = 'user', mentions: List[str] = None,
                    ext: dict = None) -> Optional[dict]:
        """在 Topic 中发送消息，并触发 Redis 通知"""
        # 1. 保存消息到数据库
        # 注意：这里需要 message_service 的逻辑，暂且简化实现
        msg_id = f"msg_{uuid.uuid4().hex[:8]}"
        
        conn = self.get_connection()
        if not conn: return None
        try:
            cursor = conn.cursor()
            sql = """
                INSERT INTO messages 
                (message_id, session_id, role, sender_id, sender_type, content, mentions, ext)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (
                msg_id, topic_id, role, sender_id, sender_type, content,
                json.dumps(mentions) if mentions else None,
                json.dumps(ext) if ext else None
            ))
            
            # 更新 Topic 的最后消息时间
            cursor.execute(
                "UPDATE sessions SET last_message_at = CURRENT_TIMESTAMP WHERE session_id = %s",
                (topic_id,)
            )
            
            conn.commit()
            cursor.close()
            conn.close()
            
            # 2. 发布到 Redis 频道
            # Topic 频道：topic:{topic_id}
            message_data = {
                'message_id': msg_id,
                'topic_id': topic_id,
                'sender_id': sender_id,
                'sender_type': sender_type,
                'role': role,
                'content': content,
                'mentions': mentions,
                'timestamp': time.time()
            }
            
            self._publish_event(topic_id, 'new_message', message_data)
            
            return message_data
        except Exception as e:
            print(f"[TopicService] Error sending message: {e}")
            if conn: conn.close()
            return None

    def _publish_event(self, topic_id: str, event_type: str, data: dict):
        """发布事件到 Redis"""
        if not self.redis_client:
            return
        
        channel = f"topic:{topic_id}"
        payload = {
            'type': event_type,
            'data': data
        }
        self.redis_client.publish(channel, json.dumps(payload))
        print(f"[TopicService] Published {event_type} to {channel}")

# 全局实例
topic_service: Optional[TopicService] = None

def init_topic_service(get_connection, redis_client=None):
    global topic_service
    topic_service = TopicService(get_connection, redis_client)
    return topic_service

def get_topic_service() -> TopicService:
    if topic_service is None:
        raise RuntimeError('Topic service not initialized')
    return topic_service

