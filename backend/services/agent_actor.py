"""
Agent Actor 服务层
实现 Agent 的 Actor 模型。每个 Agent 在激活后以顺序处理消息。
使用 Redis Pub/Sub 订阅 Topic 频道，并根据人设和上下文产生回答。
"""

import json
import threading
import time
import queue
import traceback
from typing import Dict, List, Any, Optional

from database import get_mysql_connection, get_redis_client
from services.llm_service import get_llm_service
from services.topic_service import get_topic_service

class AgentActor:
    """Agent Actor 实现"""
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.mailbox = queue.Queue()  # 消息邮箱，顺序处理
        self.is_running = False
        self._thread = None
        self._active_channels = set()
        self._redis_sub = None
        
        # 加载 Agent 基础信息
        self.info = self._load_agent_info()
        print(f"[AgentActor:{agent_id}] Initialized")

    def _load_agent_info(self) -> dict:
        """加载 Agent 的模型和人设配置"""
        conn = get_mysql_connection()
        if not conn: return {}
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT s.*, lc.provider, lc.model, lc.api_url, lc.api_key
                FROM sessions s
                LEFT JOIN llm_configs lc ON s.llm_config_id = lc.config_id
                WHERE s.session_id = %s AND s.session_type = 'agent'
            """, (self.agent_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            return row or {}
        except Exception as e:
            print(f"[AgentActor:{self.agent_id}] Error loading info: {e}")
            if conn: conn.close()
            return {}

    def start(self):
        """启动 Actor 线程"""
        if self.is_running: return
        self.is_running = True
        self._thread = threading.Thread(target=self._run, name=f"AgentActor-{self.agent_id}")
        self._thread.daemon = True
        self._thread.start()
        print(f"[AgentActor:{self.agent_id}] Thread started")

    def stop(self):
        """停止 Actor"""
        self.is_running = False
        if self._redis_sub:
            try:
                self._redis_sub.close()
            except: pass

    def subscribe_topic(self, topic_id: str):
        """让该 Agent 订阅某个 Topic 频道"""
        channel = f"topic:{topic_id}"
        if channel in self._active_channels: return
        
        self._active_channels.add(channel)
        print(f"[AgentActor:{self.agent_id}] Subscribing to {channel}")
        
        # 这种方式需要 Redis 客户端支持动态订阅
        # 为了简单，我们让一个单独的线程监听所有频道并分发到对应 Actor 的 mailbox
        AgentActorManager.get_instance().subscribe_for_agent(self, channel)

    def on_event(self, topic_id: str, event: dict):
        """接收到来自 Topic 的事件"""
        event['topic_id'] = topic_id
        self.mailbox.put(event)

    def _run(self):
        """Actor 主循环"""
        while self.is_running:
            try:
                # 阻塞获取任务，超时 1 秒以检查 is_running
                try:
                    event = self.mailbox.get(timeout=1.0)
                except queue.Empty:
                    continue

                event_type = event.get('type')
                if event_type == 'new_message':
                    self._handle_new_message(event['topic_id'], event['data'])
                elif event_type == 'topic_updated':
                    print(f"[AgentActor:{self.agent_id}] Topic {event['topic_id']} updated")
                
                self.mailbox.task_done()
            except Exception as e:
                print(f"[AgentActor:{self.agent_id}] Loop error: {e}")
                traceback.print_exc()

    def _handle_new_message(self, topic_id: str, msg_data: dict):
        """处理新消息并决定是否回答"""
        sender_id = msg_data.get('sender_id')
        sender_type = msg_data.get('sender_type')
        content = msg_data.get('content', '')
        mentions = msg_data.get('mentions', []) or []
        
        # 1. 过滤掉自己的消息
        if sender_id == self.agent_id:
            return

        # 2. 判断是否需要响应
        # 策略：如果是私聊模式，直接回答；如果是 Topic 模式，被 @ 时回答。
        should_reply = False
        
        # 获取 Topic 类型
        topic = get_topic_service().get_topic(topic_id)
        if not topic: return
        
        session_type = topic.get('session_type')
        if session_type == 'private_chat':
            should_reply = True
        elif self.agent_id in mentions:
            should_reply = True
        
        if not should_reply:
            return

        print(f"[AgentActor:{self.agent_id}] Processing message in {topic_id}")

        # 3. 构建上下文并产生回答
        try:
            # 简单模拟生成过程
            # 实际需要调用 llm_service 并获取历史消息
            llm_service = get_llm_service()
            
            # 获取历史（简化：仅当前消息）
            messages = [
                {"role": "system", "content": self.info.get('system_prompt', "你是一个AI助手。")},
                {"role": "user", "content": content}
            ]
            
            # 记录产生回答的开始 (可以发送一个 'thinking' 事件到 Redis)
            get_topic_service()._publish_event(topic_id, 'agent_thinking', {
                'agent_id': self.agent_id,
                'status': 'generating'
            })
            
            # 调用 LLM
            # 注意：Actor 是顺序执行的，所以这里的阻塞调用不会导致并发冲突
            response = llm_service.chat_completion(
                config_id=self.info.get('llm_config_id'),
                messages=messages,
                stream=False
            )
            
            reply_content = response.get('content', '')
            
            # 4. 发送回复回 Topic
            get_topic_service().send_message(
                topic_id=topic_id,
                sender_id=self.agent_id,
                sender_type='agent',
                content=reply_content,
                role='assistant'
            )
            
        except Exception as e:
            print(f"[AgentActor:{self.agent_id}] Error generating reply: {e}")
            get_topic_service().send_message(
                topic_id=topic_id,
                sender_id=self.agent_id,
                sender_type='system',
                content=f"[错误] {self.info.get('name', 'Agent')} 无法产生回复: {str(e)}",
                role='system'
            )

class AgentActorManager:
    """管理所有活跃的 Agent Actor"""
    
    _instance = None
    
    @classmethod
    def get_instance(cls):
        if not cls._instance:
            cls._instance = cls()
        return cls._instance
    
    def __init__(self):
        self.actors: Dict[str, AgentActor] = {}
        self._lock = threading.Lock()
        self._redis_client = get_redis_client()
        self._pubsub = None
        self._sub_thread = None
        self._channel_to_agents: Dict[str, List[str]] = {}
    
    def get_or_create_actor(self, agent_id: str) -> AgentActor:
        with self._lock:
            if agent_id not in self.actors:
                actor = AgentActor(agent_id)
                actor.start()
                self.actors[agent_id] = actor
            return self.actors[agent_id]

    def subscribe_for_agent(self, actor: AgentActor, channel: str):
        """为 Agent 订阅频道，并在全局监听线程中注册"""
        with self._lock:
            if channel not in self._channel_to_agents:
                self._channel_to_agents[channel] = []
                if self._pubsub:
                    self._pubsub.subscribe(channel)
                else:
                    self._start_global_listener(channel)
            
            if actor.agent_id not in self._channel_to_agents[channel]:
                self._channel_to_agents[channel].append(actor.agent_id)

    def _start_global_listener(self, first_channel: str):
        """启动一个全局 Redis 监听线程"""
        if not self._redis_client: return
        
        self._pubsub = self._redis_client.pubsub()
        self._pubsub.subscribe(first_channel)
        
        def _listen():
            print("[AgentActorManager] Global Redis listener started")
            for message in self._pubsub.listen():
                if message['type'] == 'message':
                    channel = message['channel']
                    try:
                        data = json.loads(message['data'])
                        # 分发给所有订阅该频道的 Agent Actor
                        agents = self._channel_to_agents.get(channel, [])
                        for agent_id in agents:
                            actor = self.actors.get(agent_id)
                            if actor:
                                topic_id = channel.split(':')[-1]
                                actor.on_event(topic_id, data)
                    except Exception as e:
                        print(f"[AgentActorManager] Error in listener: {e}")
        
        self._sub_thread = threading.Thread(target=_listen, name="AgentActorManager-RedisListener")
        self._sub_thread.daemon = True
        self._sub_thread.start()

# 辅助函数
def activate_agent(agent_id: str, topic_id: str):
    """激活 Agent 并让其加入某个 Topic"""
    manager = AgentActorManager.get_instance()
    actor = manager.get_or_create_actor(agent_id)
    actor.subscribe_topic(topic_id)
    return actor

