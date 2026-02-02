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


# ==================== 事件类型定义 ====================

class TopicEventType:
    """Topic 事件类型"""
    # 消息相关
    NEW_MESSAGE = 'new_message'
    MESSAGES_ROLLED_BACK = 'messages_rolled_back'
    
    # Topic 状态
    TOPIC_UPDATED = 'topic_updated'
    TOPIC_PARTICIPANTS_UPDATED = 'topic_participants_updated'
    
    # 参与者状态
    AGENT_JOINED = 'agent_joined'
    PARTICIPANT_LEFT = 'participant_left'
    
    # Agent 状态
    AGENT_RECEIVED = 'agent_received'
    AGENT_DECIDING = 'agent_deciding'
    AGENT_DECISION_MADE = 'agent_decision_made'
    AGENT_THINKING = 'agent_thinking'
    AGENT_STREAM_CHUNK = 'agent_stream_chunk'
    AGENT_STREAM_DONE = 'agent_stream_done'
    AGENT_SILENT = 'agent_silent'
    
    # 处理流程事件（新增）
    PROCESS_EVENT = 'process_event'  # Topic.Event.Process 统一事件
    
    # ActionChain 事件
    ACTION_STEP_START = 'action_step_start'       # ActionStep 开始执行
    ACTION_STEP_DONE = 'action_step_done'         # ActionStep 执行完成
    ACTION_CHAIN_PROGRESS = 'action_chain_progress'  # ActionChain 进度更新
    ACTION_CHAIN_INTERRUPT = 'action_chain_interrupt'  # ActionChain 被中断


class ProcessEventPhase:
    """处理流程事件阶段"""
    LOAD_LLM_TOOL = 'load_llm_tool'           # 加载LLM和工具
    PREPARE_CONTEXT = 'prepare_context'        # 准备上下文消息
    MSG_TYPE_CLASSIFY = 'msg_type_classify'    # 消息类型分类
    MSG_PRE_DEAL = 'msg_pre_deal'              # 消息预处理
    MSG_DEAL = 'msg_deal'                      # 消息处理（LLM调用）
    POST_MSG_DEAL = 'post_msg_deal'            # 消息后处理



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
            
            # 通知所有参与者：参与者列表已更新（发送完整列表，便于各 actor 收敛决策）
            try:
                participants = self.get_participants(topic_id)
                self._publish_event(topic_id, 'topic_participants_updated', {
                    'participants': participants
                })
            except Exception as e:
                print(f"[TopicService] Error publishing participants updated: {e}")
            
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
            # 通知所有参与者：参与者列表已更新
            try:
                participants = self.get_participants(topic_id)
                self._publish_event(topic_id, 'topic_participants_updated', {
                    'participants': participants
                })
            except Exception as e:
                print(f"[TopicService] Error publishing participants updated: {e}")
            return True
        except Exception as e:
            print(f"[TopicService] Error removing participant: {e}")
            if conn: conn.close()
            return False

    # ==================== 消息分发 ====================
    
    def _get_sender_info(self, sender_id: str, sender_type: str) -> tuple:
        """获取发送者的名称和头像信息"""
        sender_name = None
        sender_avatar = None
        
        if sender_type == 'agent':
            # 从 sessions 表查询 Agent 信息
            conn = self.get_connection()
            if conn:
                try:
                    import pymysql
                    cursor = conn.cursor(pymysql.cursors.DictCursor)
                    cursor.execute("""
                        SELECT name, avatar FROM sessions 
                        WHERE session_id = %s AND session_type = 'agent'
                    """, (sender_id,))
                    row = cursor.fetchone()
                    cursor.close()
                    conn.close()
                    if row:
                        sender_name = row.get('name')
                        sender_avatar = row.get('avatar')
                except Exception as e:
                    print(f"[TopicService] Error getting sender info: {e}")
                    if conn:
                        try:
                            conn.close()
                        except:
                            pass
        elif sender_type == 'user':
            # 用户发送者，可以从用户表获取或使用默认值
            sender_name = '用户'
        
        return sender_name, sender_avatar

    def send_message(self, topic_id: str, sender_id: str, sender_type: str, 
                    content: str, role: str = 'user', mentions: List[str] = None,
                    ext: dict = None, message_id: str = None,
                    sender_name: str = None, sender_avatar: str = None) -> Optional[dict]:
        """在 Topic 中发送消息，并触发 Redis 通知
        
        Args:
            topic_id: Topic ID
            sender_id: 发送者 ID
            sender_type: 发送者类型 (user/agent/system)
            content: 消息内容
            role: 消息角色 (user/assistant/system)
            mentions: @提及的用户/Agent ID 列表
            ext: 扩展数据
            message_id: 消息 ID（可选，自动生成）
            sender_name: 发送者名称（可选，自动从DB获取）
            sender_avatar: 发送者头像（可选，自动从DB获取）
        """
        # 1. 保存消息到数据库
        msg_id = message_id or f"msg_{uuid.uuid4().hex[:8]}"
        
        # 如果没有提供 sender_name/sender_avatar，自动获取
        if sender_name is None or sender_avatar is None:
            auto_name, auto_avatar = self._get_sender_info(sender_id, sender_type)
            if sender_name is None:
                sender_name = auto_name
            if sender_avatar is None:
                sender_avatar = auto_avatar

        # 不要在每条消息里携带 base64(data URI) 头像：会导致 Redis/SSE/前端渲染负担巨大
        if isinstance(sender_avatar, str) and sender_avatar.startswith('data:image/'):
            sender_avatar = None
        
        # 将 sender 信息添加到 ext 中存储
        if ext is None:
            ext = {}
        ext['sender_name'] = sender_name
        # 同步避免把 data-uri/超大字段写进 ext（DB & 事件 payload）
        ext['sender_avatar'] = sender_avatar

        # 确保持久化：ext 可能包含 bytes/复杂对象（例如 LLM raw），这里做序列化兜底
        def _json_safe(obj, max_depth: int = 8):
            import base64
            import json

            def _inner(x, depth: int):
                if depth > max_depth:
                    return str(x)
                if x is None or isinstance(x, (bool, int, float, str)):
                    return x
                if isinstance(x, (bytes, bytearray)):
                    # bytes 统一转为 base64 字符串，避免 JSON 序列化失败（并满足“图片转base64字符串”需求）
                    try:
                        return bytes(x).decode('utf-8')
                    except Exception:
                        return base64.b64encode(bytes(x)).decode('utf-8')
                if isinstance(x, Exception):
                    return str(x)
                if isinstance(x, dict):
                    out = {}
                    for k, v in x.items():
                        try:
                            kk = k if isinstance(k, str) else str(k)
                        except Exception:
                            kk = repr(k)
                        out[kk] = _inner(v, depth + 1)
                    return out
                if isinstance(x, (list, tuple, set)):
                    return [_inner(v, depth + 1) for v in list(x)]
                try:
                    json.dumps(x)
                    return x
                except Exception:
                    return str(x)

            return _inner(obj, 0)

        ext = _json_safe(ext)
        
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
                'sender_name': sender_name,
                'sender_avatar': sender_avatar,
                'role': role,
                'content': content,
                'mentions': mentions,
                'timestamp': time.time(),
                'ext': ext
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
        # 运行时兜底：事件 payload 里可能混入 bytes/bytearray（例如媒体/原始响应/第三方结果），
        # Redis publish 这里会直接 json.dumps，必须保证可序列化，避免整个链路报错。
        def _json_safe(obj, max_depth: int = 8):
            import base64
            import json as _json

            def _inner(x, depth: int):
                if depth > max_depth:
                    return str(x)
                if x is None or isinstance(x, (bool, int, float, str)):
                    return x
                if isinstance(x, (bytes, bytearray)):
                    # bytes 统一转 base64 字符串
                    try:
                        return bytes(x).decode('utf-8')
                    except Exception:
                        return base64.b64encode(bytes(x)).decode('utf-8')
                if isinstance(x, Exception):
                    return str(x)
                if isinstance(x, dict):
                    out = {}
                    for k, v in x.items():
                        try:
                            kk = k if isinstance(k, str) else str(k)
                        except Exception:
                            kk = repr(k)
                        out[kk] = _inner(v, depth + 1)
                    return out
                if isinstance(x, (list, tuple, set)):
                    return [_inner(v, depth + 1) for v in list(x)]
                try:
                    _json.dumps(x)
                    return x
                except Exception:
                    return str(x)

            return _inner(obj, 0)

        safe_payload = _json_safe(payload)
        self.redis_client.publish(channel, json.dumps(safe_payload))
        
        # ANSI 颜色码（蓝色加粗）
        CYAN = '\033[96m'
        BOLD = '\033[1m'
        RESET = '\033[0m'
        
        if event_type == 'new_message':
            ext = data.get('ext', {}) or {}
            if ext.get('auto_trigger') and ext.get('retry'):
                print(f"{CYAN}{BOLD}[TopicService] 📤 发布重试消息到 {channel} (message_id: {data.get('message_id', 'N/A')}){RESET}")
            else:
                print(f"{CYAN}{BOLD}[TopicService] 📤 发布新消息到 {channel} (message_id: {data.get('message_id', 'N/A')}){RESET}")
        else:
            print(f"[TopicService] Published {event_type} to {channel}")
    
    def publish_process_event(
        self,
        topic_id: str,
        phase: str,
        agent_id: str,
        status: str = 'running',
        data: Dict[str, Any] = None,
        agent_name: str = None,
        agent_avatar: str = None,
    ):
        """
        发布处理流程事件 (Topic.Event.Process)
        
        Args:
            topic_id: Topic ID
            phase: 处理阶段（ProcessEventPhase 中的值）
            agent_id: Agent ID
            status: 状态（running/completed/error）
            data: 阶段数据
            agent_name: Agent 名称
            agent_avatar: Agent 头像
        """
        event_data = {
            'phase': phase,
            'agent_id': agent_id,
            'agent_name': agent_name,
            'agent_avatar': agent_avatar,
            'status': status,
            'timestamp': time.time(),
            **(data or {}),
        }
        self._publish_event(topic_id, TopicEventType.PROCESS_EVENT, event_data)

    def publish_interrupt(self, topic_id: str, agent_id: str, reason: str = 'user_interrupt') -> bool:
        """
        发布中断信号并设置 Redis 标记
        
        Args:
            topic_id: Topic ID
            agent_id: 要中断的 Agent ID
            reason: 中断原因
            
        Returns:
            True if interrupt was published successfully
        """
        if not self.redis_client:
            return False
        
        # 设置 Redis 中断标记 (TTL 60秒)
        interrupt_key = f'interrupt:{topic_id}:{agent_id}'
        try:
            self.redis_client.setex(interrupt_key, 60, reason)
        except Exception as e:
            print(f"[TopicService] Failed to set interrupt flag: {e}")
            return False
        
        # 发布中断事件
        event_data = {
            'agent_id': agent_id,
            'reason': reason,
            'timestamp': time.time(),
        }
        self._publish_event(topic_id, TopicEventType.ACTION_CHAIN_INTERRUPT, event_data)
        print(f"[TopicService] 🛑 Published interrupt for agent {agent_id} in {topic_id}")
        return True

    def check_interrupt(self, topic_id: str, agent_id: str) -> bool:
        """
        检查是否有中断信号
        
        Args:
            topic_id: Topic ID
            agent_id: Agent ID
            
        Returns:
            True if interrupt flag is set
        """
        if not self.redis_client:
            return False
        
        interrupt_key = f'interrupt:{topic_id}:{agent_id}'
        try:
            return self.redis_client.get(interrupt_key) is not None
        except Exception:
            return False

    def clear_interrupt(self, topic_id: str, agent_id: str) -> bool:
        """
        清除中断标记
        
        Args:
            topic_id: Topic ID
            agent_id: Agent ID
            
        Returns:
            True if cleared successfully
        """
        if not self.redis_client:
            return False
        
        interrupt_key = f'interrupt:{topic_id}:{agent_id}'
        try:
            self.redis_client.delete(interrupt_key)
            return True
        except Exception:
            return False

    def publish_action_chain_progress(self, topic_id: str, agent_id: str,
                                       chain_id: str, current_index: int,
                                       total_steps: int, status: str,
                                       current_step: dict = None):
        """
        发布 ActionChain 进度事件
        
        Args:
            topic_id: Topic ID
            agent_id: Agent ID
            chain_id: ActionChain ID
            current_index: 当前步骤索引
            total_steps: 总步骤数
            status: 链状态
            current_step: 当前步骤详情
        """
        event_data = {
            'chain_id': chain_id,
            'agent_id': agent_id,
            'current_index': current_index,
            'total_steps': total_steps,
            'status': status,
            'progress_text': f'{current_index}/{total_steps}',
            'current_step': current_step,
            'timestamp': time.time(),
        }
        self._publish_event(topic_id, TopicEventType.ACTION_CHAIN_PROGRESS, event_data)

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

