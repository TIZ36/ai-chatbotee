"""
Agent Actor 服务层
实现 Agent 的 Actor 模型。每个 Agent 在激活后以顺序处理消息。
使用 Redis Pub/Sub 订阅 Topic 频道，并根据人设和上下文产生回答。

核心流程:
1. Agent 参与 Topic → 初始化 AgentActor 实例 → 订阅 Topic 的 Redis Pub/Sub
2. 用户发消息 → Redis Pub/Sub 广播给所有 AgentActor
3. AgentActor 处理消息 → 流式调用 LLM
4. 流式输出 → 通过 Redis Pub/Sub 发送 chunk → 前端 SSE 实时显示
"""

import json
import threading
import time
import queue
import traceback
import uuid
import requests
from typing import Dict, List, Any, Optional

from database import get_mysql_connection, get_redis_client
from services.llm_service import get_llm_service
from services.message_service import get_message_service
from services.topic_service import get_topic_service


class AgentActor:
    """Agent Actor 实现 - 每个 Agent 一个 Actor 实例"""
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.mailbox = queue.Queue()  # 消息邮箱，顺序处理
        self.is_running = False
        self._thread = None
        self._active_channels = set()
        self._redis_sub = None
        self._redis_client = get_redis_client()
        # topic 级别的本地状态：历史消息 + 参与者信息（用于会话收敛）
        self._topic_state: Dict[str, Dict[str, Any]] = {}
        # 已处理的消息 ID 集合（用于去重）
        self._processed_messages: set = set()
        
        # 加载 Agent 基础信息
        self.info = self._load_agent_info()
        print(f"[AgentActor:{agent_id}] Initialized")

    def _load_agent_info(self) -> dict:
        """加载 Agent 的模型、人设和头像配置"""
        conn = get_mysql_connection()
        if not conn: return {}
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT s.session_id, s.name, s.avatar, s.system_prompt, s.llm_config_id,
                       lc.provider, lc.model as config_model, lc.api_url, lc.api_key
                FROM sessions s
                LEFT JOIN llm_configs lc ON s.llm_config_id = lc.config_id
                WHERE s.session_id = %s AND s.session_type = 'agent'
            """, (self.agent_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            if row:
                print(f"[AgentActor:{self.agent_id}] Info loaded: {row.get('name')} (LLM: {row.get('llm_config_id')}, Provider: {row.get('provider')}, Avatar: {'Yes' if row.get('avatar') else 'No'})")
            else:
                print(f"[AgentActor:{self.agent_id}] Warning: No agent info found in database")
            return row or {}
        except Exception as e:
            print(f"[AgentActor:{self.agent_id}] Error loading info: {e}")
            if conn: conn.close()
            return {}
    
    def _load_agent_skill_packs(self) -> List[dict]:
        """加载 Agent 的技能包列表"""
        conn = get_mysql_connection()
        if not conn: return []
        try:
            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT sp.skill_pack_id, sp.name, sp.summary, sp.process_steps
                FROM skill_packs sp
                INNER JOIN skill_pack_assignments spa ON sp.skill_pack_id = spa.skill_pack_id
                WHERE spa.target_session_id = %s
                ORDER BY spa.created_at DESC
            """, (self.agent_id,))
            skill_packs = cursor.fetchall()
            cursor.close()
            conn.close()
            
            if skill_packs:
                print(f"[AgentActor:{self.agent_id}] Loaded {len(skill_packs)} skill packs")
            return skill_packs or []
        except Exception as e:
            print(f"[AgentActor:{self.agent_id}] Error loading skill packs: {e}")
            if conn: conn.close()
            return []
    
    def _build_skill_pack_prompt(self, skill_packs: List[dict]) -> str:
        """构建技能包提示词，供 Agent 在回复时参考"""
        if not skill_packs:
            return ""
        
        prompt_parts = ["\n\n=== 技能包参考 ==="]
        prompt_parts.append("你已学习以下技能包，可以在回复时参考这些执行模式和能力：\n")
        
        for sp in skill_packs:
            name = sp.get('name', '未命名技能')
            summary = sp.get('summary', '')
            process_steps = sp.get('process_steps')
            
            prompt_parts.append(f"【{name}】")
            if summary:
                # 限制summary长度，避免过长
                truncated_summary = summary[:500] + '...' if len(summary) > 500 else summary
                prompt_parts.append(f"执行能力描述：{truncated_summary}")
            
            # 如果有结构化的执行步骤，也添加进去
            if process_steps:
                try:
                    steps = json.loads(process_steps) if isinstance(process_steps, str) else process_steps
                    if isinstance(steps, list) and len(steps) > 0:
                        step_descriptions = []
                        for step in steps[:5]:  # 最多显示5个步骤
                            step_type = step.get('type', 'unknown')
                            if step_type == 'thinking' and step.get('thinking'):
                                step_descriptions.append(f"  - 思考: {step['thinking'][:100]}")
                            elif step_type == 'mcp_call' and step.get('toolName'):
                                step_descriptions.append(f"  - MCP调用: {step['toolName']}")
                            elif step_type == 'workflow' and step.get('workflowInfo', {}).get('name'):
                                step_descriptions.append(f"  - 工作流: {step['workflowInfo']['name']}")
                        if step_descriptions:
                            prompt_parts.append("执行步骤参考：")
                            prompt_parts.extend(step_descriptions)
                except:
                    pass
            
            prompt_parts.append("")  # 空行分隔
        
        prompt_parts.append("当用户请求与上述技能相关的任务时，请参考这些执行模式进行回复。")
        prompt_parts.append("=== 技能包参考结束 ===")
        
        return "\n".join(prompt_parts)

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
        
        # 通过 Manager 订阅，以便全局监听器分发消息
        AgentActorManager.get_instance().subscribe_for_agent(self, channel)

        # 激活时加载 Topic 历史消息 & 参与者列表，构建本地上下文（规则 1 / 5）
        try:
            self._load_topic_context(topic_id)
        except Exception as e:
            print(f"[AgentActor:{self.agent_id}] ⚠️ Failed to load topic context: {e}")

    def on_event(self, topic_id: str, event: dict):
        """接收到来自 Topic 的事件，放入 mailbox 队列"""
        event['topic_id'] = topic_id
        self.mailbox.put(event)

    def _run(self):
        """Actor 主循环 - 顺序处理 mailbox 中的消息"""
        while self.is_running:
            try:
                try:
                    event = self.mailbox.get(timeout=1.0)
                except queue.Empty:
                    continue

                event_type = event.get('type')
                if event_type == 'new_message':
                    self._handle_new_message(event['topic_id'], event['data'])
                elif event_type == 'topic_updated':
                    print(f"[AgentActor:{self.agent_id}] Topic {event['topic_id']} updated")
                elif event_type == 'topic_participants_updated':
                    self._handle_participants_updated(event['topic_id'], event.get('data') or {})
                elif event_type in ('agent_joined', 'participant_left'):
                    # 参与者增删：触发一次全量刷新即可（保持 state 收敛且简单）
                    try:
                        self._load_topic_participants(event['topic_id'])
                    except Exception as e:
                        print(f"[AgentActor:{self.agent_id}] ⚠️ Failed to refresh participants: {e}")
                
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
        message_id = msg_data.get('message_id')
        ext = msg_data.get('ext', {}) or {}
        
        # 0. 消息去重：避免同一消息被处理两次（trigger_message + Redis 事件）
        if message_id:
            if message_id in self._processed_messages:
                print(f"[AgentActor:{self.agent_id}] Skipping duplicate message: {message_id}")
                return
            self._processed_messages.add(message_id)
            # 限制集合大小，避免内存无限增长
            if len(self._processed_messages) > 1000:
                # 移除最早的 500 个
                self._processed_messages = set(list(self._processed_messages)[-500:])
        
        # 1. 过滤掉自己的消息
        if sender_id == self.agent_id:
            return

        # 规则 1：维护本地历史（包含 user/agent/system），用于后续决策与上下文
        self._append_topic_history(topic_id, msg_data)

        print(f"[AgentActor:{self.agent_id}] Received message: {content[:50]}... (mentions: {mentions})")

        # 检查会话类型，判断是否为积极模式（Agent 私聊）
        topic = get_topic_service().get_topic(topic_id) or {}
        session_type = topic.get('session_type')
        is_eager_mode = session_type in ('private_chat', 'agent')  # 积极模式：私聊场景
        
        # 初始化决策过程步骤列表（用于记录到 processSteps）
        decision_process_steps = []
        decision_start_time = int(time.time() * 1000)
        
        if is_eager_mode:
            # === 积极模式：跳过决策过程，直接回答 ===
            print(f"[AgentActor:{self.agent_id}] Eager mode enabled (session_type={session_type}), skipping decision process")
            
            # 只记录简单的激活步骤
            decision_process_steps.append({
                'type': 'agent_activated',
                'timestamp': decision_start_time,
                'agent_id': self.agent_id,
                'agent_name': self.info.get('name', 'Agent'),
                'thinking': '私聊模式，直接响应',
                'status': 'completed'
            })
            
            # 直接设置 action 为 reply，跳过 LLM 决策
            action = 'reply'
            action_type = 'reply'
            
        else:
            # === 标准模式：完整的决策过程 ===
            
            # 2. 记录激活步骤
            decision_process_steps.append({
                'type': 'agent_activated',
                'timestamp': decision_start_time,
                'agent_id': self.agent_id,
                'agent_name': self.info.get('name', 'Agent'),
                'status': 'completed'
            })
            
            # 3. 记录开始决策
            decision_process_steps.append({
                'type': 'agent_deciding',
                'timestamp': int(time.time() * 1000),
                'thinking': f"{self.info.get('name', 'Agent')} 正在分析是否需要回答这个问题...",
                'status': 'running'
            })
            
            # 通知前端：Agent 开始决策（包含 processSteps）
            get_topic_service()._publish_event(topic_id, 'agent_deciding', {
                'agent_id': self.agent_id,
                'agent_name': self.info.get('name', 'Agent'),
                'agent_avatar': self.info.get('avatar'),
                'status': 'deciding',
                'in_reply_to': message_id,
                'timestamp': time.time(),
                'processSteps': decision_process_steps
            })

            # 4. 会话收敛：判断行为（reply/like/oppose/silent）
            # 传入 decision_steps 以记录决策过程中的 LLM 调用
            action = self._decide_action(topic_id, msg_data, decision_steps=decision_process_steps)
            
            # 5. 更新 agent_deciding 步骤状态为 completed
            for step in decision_process_steps:
                if step.get('type') == 'agent_deciding':
                    step['status'] = 'completed'
                    step['duration'] = int(time.time() * 1000) - step.get('timestamp', 0)
                    break
            
            # 6. 记录决策结果
            action_type = action.split(':')[0] if isinstance(action, str) and ':' in action else action
            decision_process_steps.append({
                'type': 'agent_decision',
                'timestamp': int(time.time() * 1000),
                'action': action_type,
                'thinking': self._get_decision_description(action_type),
                'status': 'completed'
            })
            
            # 通知前端：决策结果（包含完整 processSteps）
            get_topic_service()._publish_event(topic_id, 'agent_decision', {
                'agent_id': self.agent_id,
                'agent_name': self.info.get('name', 'Agent'),
                'agent_avatar': self.info.get('avatar'),
                'action': action_type,
                'in_reply_to': message_id,
                'timestamp': time.time(),
                'processSteps': decision_process_steps
            })
        
        # 如果决定不回答，保存一条决策记录消息（让用户知道为什么没有回答）
        if action == 'silent':
            get_topic_service().send_message(
                topic_id=topic_id,
                sender_id=self.agent_id,
                sender_type='agent',
                content=f"[{self.info.get('name', 'Agent')} 决定不参与回答]",
                role='system',  # 使用 system 角色表示这是决策记录
                sender_name=self.info.get('name'),
                sender_avatar=self.info.get('avatar'),
                ext={
                    'decision_type': 'silent',
                    'decision_reason': '经过分析，我认为这个问题不需要我来回答，或者已有其他更合适的 Agent 在处理。',
                    'processSteps': decision_process_steps,
                    'in_reply_to': message_id
                }
            )
            return
        
        # topic 已在前面获取
        print(f"[AgentActor:{self.agent_id}] Topic type: {session_type}, My ID: {self.agent_id}, Mentions: {mentions}")
        
        # 规则 4/6：自己发的不处理已在上方过滤；@ 了保证回答的逻辑在 _decide_action 内部完成
        if action == 'like':
            self._publish_reaction_like(topic_id, message_id, sender_id, sender_type)
            return
        if action == 'oppose':
            # 反对：简短引用并回应（作为一条 assistant 消息）
            self._send_oppose_reply(topic_id, msg_data)
            return
        if isinstance(action, str) and action.startswith('delegate:'):
            agent_id = action.split(':', 1)[1]
            self._delegate_to_agent(topic_id, msg_data, agent_id)
            return
        if action == 'ask_human':
            self._ask_human(topic_id, msg_data)
            return

        print(f"[AgentActor:{self.agent_id}] Decision: Replying to message in {topic_id} (action={action})")
        
        # 记录决定回答的步骤
        decision_process_steps.append({
            'type': 'agent_will_reply',
            'timestamp': int(time.time() * 1000),
            'thinking': f"{self.info.get('name', 'Agent')} 决定回答这个问题，正在准备回复...",
            'status': 'completed'
        })

        # 3. 检查工具使用权 (MCP 和 Workflow)
        requested_tools = []
        # 兼容多种前端 key（历史版本）
        mcp_servers = ext.get('mcp_servers') or ext.get('selectedMcpServerIds') or ext.get('selected_mcp_server_ids') or []
        workflows = ext.get('workflows') or ext.get('selectedWorkflowIds') or ext.get('selected_workflow_ids') or []
        if isinstance(mcp_servers, str):
            mcp_servers = [mcp_servers]
        if isinstance(workflows, str):
            workflows = [workflows]
        if isinstance(mcp_servers, list):
            requested_tools.extend([f"mcp:{s}" for s in mcp_servers])
        if isinstance(workflows, list):
            requested_tools.extend([f"workflow:{w}" for w in workflows])
            
        used_tools = []
        if session_type in ['topic_general', 'memory'] and requested_tools:
            for tool in requested_tools:
                lock_key = f"lock:topic:{topic_id}:msg:{message_id}:tool:{tool}"
                if self._redis_client.set(lock_key, self.agent_id, ex=60, nx=True):
                    used_tools.append(tool)
                    print(f"[AgentActor:{self.agent_id}] Acquired lock for {tool}")
                else:
                    tool_name = tool.split(':')[-1]
                    print(f"[AgentActor:{self.agent_id}] Tool {tool_name} already in use")
                    get_topic_service().send_message(
                        topic_id=topic_id,
                        sender_id=self.agent_id,
                        sender_type='agent',
                        content=f"我想用 {tool_name}，但是现在有其他agent在使用了，所以我停止获取。",
                        role='assistant',
                        sender_name=self.info.get('name'),
                        sender_avatar=self.info.get('avatar')
                    )
                    return

        # 4. 构建上下文并产生流式回答，传入决策过程步骤
        # 让 winning agent 明确感知用户选择的工具（并在回答里使用/提及）
        if used_tools:
            tool_hint = "、".join([t.split(':', 1)[1] for t in used_tools])
            content = f"[你已获得工具使用权：{tool_hint}]\\n{content}"
        self._generate_streaming_reply(topic_id, content, used_tools, message_id, decision_process_steps)

    def _delegate_to_agent(self, topic_id: str, msg_data: dict, agent_id: str):
        """允许在充分了解能力后 @ 对应 agent（带 mentions，保证对方会响应）"""
        topic_state = self._topic_state.get(topic_id, {})
        participants = topic_state.get('participants') or []
        target = next((p for p in participants if p.get('participant_type') == 'agent' and p.get('participant_id') == agent_id), None)
        if not target:
            return
        name = target.get('name') or agent_id
        user_text = (msg_data.get('content') or '').strip()
        content = f"@{name} 我认为这个问题更适合你处理，请你接手：{user_text}"
        get_topic_service().send_message(
            topic_id=topic_id,
            sender_id=self.agent_id,
            sender_type='agent',
            content=content,
            role='assistant',
            mentions=[agent_id],
            ext={'delegated_to': agent_id, 'delegated_to_name': name},
            sender_name=self.info.get('name'),
            sender_avatar=self.info.get('avatar')
        )

    def _ask_human(self, topic_id: str, msg_data: dict):
        """允许 @human 要求人类操作/确认"""
        user_text = (msg_data.get('content') or '').strip()
        content = f"@human 我需要你确认/执行以下事项后我才能继续：{user_text}"
        get_topic_service().send_message(
            topic_id=topic_id,
            sender_id=self.agent_id,
            sender_type='agent',
            content=content,
            role='assistant',
            ext={'needs_human': True},
            sender_name=self.info.get('name'),
            sender_avatar=self.info.get('avatar')
        )
    
    def _get_decision_description(self, action: str) -> str:
        """获取决策类型的描述文字"""
        descriptions = {
            'reply': '决定回答这个问题',
            'silent': '决定不参与回答（问题不在能力范围内或已有其他Agent处理）',
            'like': '决定表示赞同',
            'oppose': '决定表示反对',
            'delegate': '决定将问题转交给更合适的Agent',
            'ask_human': '决定请求人类协助'
        }
        return descriptions.get(action, f'做出了 {action} 决定')

    def _load_topic_context(self, topic_id: str):
        """规则 1/5：加载 topic 历史消息与参与者列表，初始化本地状态"""
        self._topic_state.setdefault(topic_id, {})
        self._load_topic_participants(topic_id)
        # 加载最近 N 条消息作为上下文（避免无限增长）
        try:
            msgs = get_message_service().get_messages(topic_id, limit=60, use_cache=True)
        except TypeError:
            # 兼容老签名
            msgs = get_message_service().get_messages(topic_id, limit=60)
        self._topic_state[topic_id]['history'] = msgs or []

    def _load_topic_participants(self, topic_id: str):
        """加载参与者并缓存到本地，用于收敛决策与能力感知"""
        topic = get_topic_service().get_topic(topic_id) or {}
        participants = topic.get('participants') or []
        self._topic_state.setdefault(topic_id, {})
        self._topic_state[topic_id]['participants'] = participants
        # 简单能力摘要：来自 system_prompt 的前 80 字（后续可替换为更结构化能力模型）
        ability = {}
        for p in participants:
            if p.get('participant_type') == 'agent':
                pid = p.get('participant_id')
                ability[pid] = (p.get('system_prompt') or '')[:80]
        self._topic_state[topic_id]['agent_ability'] = ability

    def _handle_participants_updated(self, topic_id: str, data: dict):
        participants = data.get('participants') or []
        self._topic_state.setdefault(topic_id, {})
        self._topic_state[topic_id]['participants'] = participants
        ability = {}
        for p in participants:
            if p.get('participant_type') == 'agent':
                pid = p.get('participant_id')
                ability[pid] = (p.get('system_prompt') or '')[:80]
        self._topic_state[topic_id]['agent_ability'] = ability

    def _append_topic_history(self, topic_id: str, msg_data: dict, max_len: int = 120):
        self._topic_state.setdefault(topic_id, {})
        history = self._topic_state[topic_id].setdefault('history', [])
        history.append(msg_data)
        if len(history) > max_len:
            self._topic_state[topic_id]['history'] = history[-max_len:]

    def _is_question(self, text: str) -> bool:
        t = (text or '').strip()
        if not t:
            return False
        if '？' in t or '?' in t:
            return True
        # 中文疑问词简单启发式
        keywords = ['为什么', '怎么', '如何', '能否', '是否', '吗', '么', '多少', '哪', '哪里', '哪个']
        return any(k in t for k in keywords)

    def _decide_action(self, topic_id: str, msg_data: dict, decision_steps: List[dict] = None) -> str:
        """
        会话收敛决策：
        - 被 @：保证回答
        - 私聊/积极模式：直接回答
        - user 的问题：更倾向回答
        - agent 的回答/陈述：默认沉默，必要时 like/oppose
        
        Args:
            topic_id: 话题 ID
            msg_data: 消息数据
            decision_steps: 决策步骤列表（可选），用于记录决策过程中的 LLM 调用
        """
        sender_type = msg_data.get('sender_type')
        content = msg_data.get('content', '') or ''
        mentions = msg_data.get('mentions', []) or []

        # 规则：被 @ 保证回答
        if self.agent_id in mentions:
            return 'reply'

        # 获取会话类型
        topic = get_topic_service().get_topic(topic_id) or {}
        session_type = topic.get('session_type')
        
        # 私聊/积极模式：只要不是自己发的就直接回复（跳过决策）
        # - private_chat: 旧版私聊
        # - agent: 新版 Agent 私聊，开启积极模式
        if session_type in ('private_chat', 'agent'):
            return 'reply'

        # 其他 agent 的消息：默认不抢话（收敛）
        if sender_type == 'agent':
            # 如果对方在问 @human，保持沉默避免回环
            if '@human' in content:
                return 'silent'
            # 简化：对 agent 陈述默认沉默（后续可用 LLM 判定 like/oppose）
            return 'silent'

        # user 的消息：只对"问题"更愿意回答；陈述默认沉默（更像圆桌）
        if self._is_question(content):
            # 问题：结合人设/参与者能力做意愿判定（可能委派给其他 agent 或 @human）
            return self._llm_intent_decision(topic_id, msg_data, default_action='reply', decision_steps=decision_steps)
        # 陈述：结合人设做 like/oppose/silent 判定
        return self._llm_intent_decision(topic_id, msg_data, default_action='silent', decision_steps=decision_steps)

    def _llm_intent_decision(self, topic_id: str, msg_data: dict, default_action: str = 'silent', decision_steps: List[dict] = None) -> str:
        """
        使用轻量 LLM 判定动作（收敛核心）：
        - reply: 我来回答（走流式回答）
        - like: 点赞（reaction 装饰）
        - oppose: 反对（引用+简短反驳）
        - delegate:<agent_id>: 委派给某个 agent（发一条@该agent的消息）
        - ask_human: @human 要求人类操作/确认
        - silent: 保持沉默
        
        Args:
            topic_id: 话题 ID
            msg_data: 消息数据
            default_action: 默认动作
            decision_steps: 决策步骤列表（可选），用于记录 LLM 调用过程
        """
        llm_call_start = int(time.time() * 1000)
        
        try:
            topic_state = self._topic_state.get(topic_id, {})
            participants = topic_state.get('participants') or []
            agents = [p for p in participants if p.get('participant_type') == 'agent']

            agent_lines = []
            for p in agents:
                aid = p.get('participant_id')
                name = p.get('name') or aid
                ability = (topic_state.get('agent_ability', {}) or {}).get(aid, '') or ''
                agent_lines.append(f"- {name} (id={aid}): {ability}")
            agents_desc = "\n".join(agent_lines) if agent_lines else "(无其他agent)"

            me_name = self.info.get('name', self.agent_id)
            persona = self.info.get('system_prompt', '') or '你是一个AI助手。'
            user_text = (msg_data.get('content') or '').strip()

            system = (
                "你是一个多智能体话题中的单个Agent。你需要决定是否要参与发言，以保持会话收敛。\n"
                "可选动作(action)：reply / like / oppose / silent / ask_human / delegate。\n"
                "规则：\n"
                "- 如果需要人类确认或执行操作，用 ask_human（回复内容中必须包含 @human）。\n"
                "- 如果需要其他Agent更合适处理，用 delegate，并选择一个 agent_id（必须来自候选列表）。\n"
                "- 点赞不是消息内容改变，只返回 like。\n"
                "- 反对要简短有证据，返回 oppose。\n"
                "- 如果不确定且无必要，选择 silent。\n"
                "输出必须是严格JSON："
                "{\"action\":\"reply|like|oppose|silent|ask_human|delegate\",\"agent_id\":\"(delegate时必填)\"}"
            )
            user = (
                f"我的名字：{me_name}\n"
                f"我的人设：{persona[:800]}\n"
                f"Topic中的其他Agent与能力概览：\n{agents_desc}\n\n"
                f"用户消息：{user_text}\n\n"
                f"默认倾向：{default_action}\n"
                "请基于人设与能力分工做出动作决策。"
            )

            llm_service = get_llm_service()
            cfg_id = self.info.get('llm_config_id')
            if not cfg_id:
                return default_action
            
            # 记录 LLM 调用开始（如果提供了 decision_steps）
            if decision_steps is not None:
                # 获取 LLM 配置信息
                llm_config = llm_service.get_config(cfg_id) if hasattr(llm_service, 'get_config') else {}
                provider = llm_config.get('provider', 'unknown') if llm_config else 'unknown'
                model = llm_config.get('model', 'unknown') if llm_config else 'unknown'
                
                decision_steps.append({
                    'type': 'thinking',
                    'timestamp': llm_call_start,
                    'thinking': f'正在使用 LLM ({provider}/{model}) 分析是否需要回答...',
                    'llm_provider': provider,
                    'llm_model': model,
                    'status': 'running'
                })

            resp = llm_service.chat_completion(
                config_id=cfg_id,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                stream=False,
            )
            raw = (resp.get('content') or '').strip()
            
            # 更新 LLM 调用步骤状态为完成
            if decision_steps is not None:
                for step in decision_steps:
                    if step.get('type') == 'thinking' and step.get('status') == 'running':
                        step['status'] = 'completed'
                        step['duration'] = int(time.time() * 1000) - llm_call_start
                        step['result'] = raw[:200] + ('...' if len(raw) > 200 else '')
                        break
            
            start = raw.find('{')
            end = raw.rfind('}')
            if start == -1 or end == -1 or end <= start:
                return default_action
            obj = json.loads(raw[start:end+1])
            action = obj.get('action') or default_action

            if action == 'delegate':
                agent_id = obj.get('agent_id')
                if agent_id and any(p.get('participant_id') == agent_id for p in agents):
                    return f"delegate:{agent_id}"
                return default_action

            if action in ('reply', 'like', 'oppose', 'silent', 'ask_human'):
                return action
            return default_action
        except Exception as e:
            print(f"[AgentActor:{self.agent_id}] intent decision error: {e}")
            # 记录错误
            if decision_steps is not None:
                for step in decision_steps:
                    if step.get('type') == 'thinking' and step.get('status') == 'running':
                        step['status'] = 'error'
                        step['duration'] = int(time.time() * 1000) - llm_call_start
                        step['error'] = str(e)
                        break
            return default_action

    def _publish_reaction_like(self, topic_id: str, message_id: str, target_sender_id: str, target_sender_type: str):
        """规则 6：点赞是装饰，不产生新 message，发布 reaction 事件给前端装饰"""
        if not message_id:
            return
        get_topic_service()._publish_event(topic_id, 'reaction', {
            'reaction': 'like',
            'message_id': message_id,
            'from_agent_id': self.agent_id,
            'from_agent_name': self.info.get('name', 'Agent'),
            'target_sender_id': target_sender_id,
            'target_sender_type': target_sender_type,
            'timestamp': time.time(),
        })

    def _send_oppose_reply(self, topic_id: str, msg_data: dict):
        """规则 6：反对时引用并简短反驳（作为消息发出）"""
        quoted = (msg_data.get('content') or '').strip().replace('\n', ' ')
        if len(quoted) > 120:
            quoted = quoted[:120] + '...'
        # 反对消息尽量简短；如需向用户确认，用 @human
        content = f"> 引用：{quoted}\n\n我不同意上述观点。我的理由是：……（请补充证据/约束）"
        content = content.replace('你', '@human')
        get_topic_service().send_message(
            topic_id=topic_id,
            sender_id=self.agent_id,
            sender_type='agent',
            content=content,
            role='assistant',
            ext={'quotedMessage': {'id': msg_data.get('message_id'), 'content': msg_data.get('content')}},
            sender_name=self.info.get('name'),
            sender_avatar=self.info.get('avatar')
        )

    def _generate_streaming_reply(self, topic_id: str, user_content: str, used_tools: List[str], in_reply_to: str = None, decision_steps: List[dict] = None):
        """
        流式产生回复并实时推送到 Topic
        
        Args:
            topic_id: 话题 ID
            user_content: 用户消息内容
            used_tools: 使用的工具列表
            in_reply_to: 回复的消息 ID
            decision_steps: 决策过程步骤列表（激活/决策/决定回答等），会合并到最终的 processSteps 中
        """
        try:
            # 生成回复消息 ID
            reply_message_id = f"msg_{uuid.uuid4().hex[:8]}"
            
            # 初始化执行轨迹列表 (processSteps)，包含前置的决策步骤
            process_steps = list(decision_steps) if decision_steps else []
            llm_start_time = time.time()
            
            # 获取 Agent 配置
            system_prompt = self.info.get('system_prompt', "你是一个AI助手。")
            
            # 加载并添加技能包提示
            skill_packs = self._load_agent_skill_packs()
            skill_pack_prompt = self._build_skill_pack_prompt(skill_packs)
            if skill_pack_prompt:
                system_prompt += skill_pack_prompt
            
            if used_tools:
                system_prompt += f"\n\n你已经获得了以下工具的使用权：{', '.join(used_tools)}。请在回答中使用它们。"

            config_id = self.info.get('llm_config_id')
            if not config_id:
                raise ValueError(f"Agent {self.agent_id} has no LLM config assigned")

            # 通知前端：Agent 开始生成回复（包含前置的决策步骤）
            get_topic_service()._publish_event(topic_id, 'agent_thinking', {
                'agent_id': self.agent_id,
                'agent_name': self.info.get('name', 'Agent'),
                'agent_avatar': self.info.get('avatar'),
                'status': 'generating',
                'message_id': reply_message_id,
                'processSteps': process_steps,  # 包含决策步骤
                'in_reply_to': in_reply_to
            })

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ]
            
            print(f"[AgentActor:{self.agent_id}] Starting streaming LLM call (config: {config_id})")
            
            # 获取 LLM 配置
            llm_service = get_llm_service()
            config = llm_service.get_config(config_id, include_api_key=True)
            if not config:
                raise ValueError(f"LLM config not found: {config_id}")
            
            provider = config.get('provider')
            api_key = config.get('api_key')
            api_url = config.get('api_url')
            model = config.get('model')
            
            # 记录 thinking 步骤（LLM调用开始）
            thinking_step_index = len(process_steps)  # 记录thinking步骤的索引
            process_steps.append({
                'type': 'llm_generating',
                'timestamp': int(llm_start_time * 1000),
                'thinking': f'正在使用 {provider}/{model} 生成回复...',
                'llm_provider': provider,
                'llm_model': model,
                'status': 'running'
            })
            
            # 流式调用 LLM 并逐 chunk 发送
            full_content = ""
            
            for chunk in self._stream_llm_call(provider, api_key, api_url, model, messages):
                full_content += chunk
                # 通过 Redis Pub/Sub 发送流式 chunk（包含完整的 processSteps）
                get_topic_service()._publish_event(topic_id, 'agent_stream_chunk', {
                    'agent_id': self.agent_id,
                    'agent_name': self.info.get('name', 'Agent'),
                    'agent_avatar': self.info.get('avatar'),
                    'message_id': reply_message_id,
                    'chunk': chunk,
                    'accumulated': full_content,
                    'processSteps': process_steps
                })
            
            # 更新 thinking 步骤为完成状态
            llm_end_time = time.time()
            process_steps[thinking_step_index]['status'] = 'completed'
            process_steps[thinking_step_index]['duration'] = int((llm_end_time - llm_start_time) * 1000)
            process_steps[thinking_step_index]['thinking'] = f'使用 {provider}/{model} 生成回复完成'
            
            print(f"[AgentActor:{self.agent_id}] Streaming complete, saving message: {full_content[:50]}...")
            
            # 构建扩展数据，包含执行轨迹
            ext_data = {
                'processSteps': process_steps,
                'llmInfo': {
                    'provider': provider,
                    'model': model,
                    'configId': config_id
                }
            }
            if used_tools:
                ext_data['usedTools'] = used_tools
            
            # 流式完成后，保存完整消息到数据库
            get_topic_service().send_message(
                topic_id=topic_id,
                sender_id=self.agent_id,
                sender_type='agent',
                content=full_content,
                role='assistant',
                message_id=reply_message_id,
                sender_name=self.info.get('name'),
                sender_avatar=self.info.get('avatar'),
                ext=ext_data
            )
            
            # 通知前端：流式完成（包含执行轨迹）
            get_topic_service()._publish_event(topic_id, 'agent_stream_done', {
                'agent_id': self.agent_id,
                'agent_name': self.info.get('name', 'Agent'),
                'agent_avatar': self.info.get('avatar'),
                'message_id': reply_message_id,
                'content': full_content,
                'processSteps': process_steps
            })
            
        except Exception as e:
            print(f"[AgentActor:{self.agent_id}] Error in streaming reply: {e}")
            traceback.print_exc()
            # 记录错误到执行轨迹
            error_step = {
                'type': 'thinking',
                'timestamp': int(time.time() * 1000),
                'thinking': f'生成回复失败: {str(e)}',
                'status': 'error',
                'error': str(e)
            }
            get_topic_service().send_message(
                topic_id=topic_id,
                sender_id=self.agent_id,
                sender_type='system',
                content=f"[错误] {self.info.get('name', 'Agent')} 无法产生回复: {str(e)}",
                role='system',
                sender_name=self.info.get('name'),
                sender_avatar=self.info.get('avatar'),
                ext={'processSteps': [error_step]}
            )

    def _stream_llm_call(self, provider: str, api_key: str, api_url: str, model: str, messages: List[dict]):
        """流式调用 LLM，返回 chunk 生成器"""
        
        if provider == 'openai':
            yield from self._stream_openai(api_key, api_url, model, messages)
        elif provider == 'ollama':
            yield from self._stream_ollama(api_url, model, messages)
        elif provider == 'anthropic':
            yield from self._stream_anthropic(api_key, api_url, model, messages)
        elif provider in ('google', 'gemini'):
            yield from self._stream_google(api_key, api_url, model, messages)
        else:
            # 不支持流式的 provider，回退到非流式
            llm_service = get_llm_service()
            response = llm_service.chat_completion(
                config_id=self.info.get('llm_config_id'),
                messages=messages,
                stream=False
            )
            yield response.get('content', '')

    def _stream_openai(self, api_key: str, api_url: str, model: str, messages: List[dict]):
        """OpenAI 流式调用"""
        default_url = 'https://api.openai.com/v1/chat/completions'
        if not api_url:
            url = default_url
        elif '/chat/completions' not in api_url:
            base = api_url.rstrip('/')
            url = f"{base}/v1/chat/completions" if not base.endswith('/v1') else f"{base}/chat/completions"
        else:
            url = api_url
        
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        }
        
        response = requests.post(url, headers=headers, json={
            'model': model,
            'messages': messages,
            'stream': True
        }, stream=True, timeout=120)
        
        if response.status_code != 200:
            raise RuntimeError(f"OpenAI API error: {response.text}")
        
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data = line[6:]
                    if data == '[DONE]':
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk.get('choices', [{}])[0].get('delta', {})
                        content = delta.get('content', '')
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue

    def _stream_ollama(self, api_url: str, model: str, messages: List[dict]):
        """Ollama 流式调用"""
        if not api_url:
            url = 'http://localhost:11434/api/chat'
        elif not api_url.endswith('/api/chat'):
            url = f"{api_url.rstrip('/')}/api/chat"
        else:
            url = api_url
        
        response = requests.post(url, json={
            'model': model,
            'messages': messages,
            'stream': True
        }, stream=True, timeout=120)
        
        if response.status_code != 200:
            raise RuntimeError(f"Ollama API error: {response.text}")
        
        for line in response.iter_lines():
            if line:
                try:
                    chunk = json.loads(line)
                    content = chunk.get('message', {}).get('content', '')
                    if content:
                        yield content
                except json.JSONDecodeError:
                    continue

    def _stream_anthropic(self, api_key: str, api_url: str, model: str, messages: List[dict]):
        """Anthropic Claude 流式调用"""
        url = api_url or 'https://api.anthropic.com/v1/messages'
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01'
        }
        
        system_msg = next((m['content'] for m in messages if m['role'] == 'system'), None)
        user_msgs = [m for m in messages if m['role'] != 'system']
        
        payload = {
            'model': model,
            'messages': user_msgs,
            'max_tokens': 4096,
            'stream': True
        }
        if system_msg:
            payload['system'] = system_msg
        
        response = requests.post(url, headers=headers, json=payload, stream=True, timeout=120)
        
        if response.status_code != 200:
            raise RuntimeError(f"Anthropic API error: {response.text}")
        
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data = line[6:]
                    try:
                        chunk = json.loads(data)
                        if chunk.get('type') == 'content_block_delta':
                            content = chunk.get('delta', {}).get('text', '')
                            if content:
                                yield content
                    except json.JSONDecodeError:
                        continue

    def _stream_google(self, api_key: str, api_url: str, model: str, messages: List[dict]):
        """Google Gemini 流式调用"""
        # Gemini 流式 URL
        url = api_url or f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={api_key}"
        if api_key and 'key=' not in url:
            url += f"?key={api_key}" if '?' not in url else f"&key={api_key}"
        
        # 转换消息格式
        contents = []
        system_instruction = None
        for m in messages:
            if m['role'] == 'system':
                system_instruction = {'parts': [{'text': m['content']}]}
            else:
                role = 'user' if m['role'] == 'user' else 'model'
                contents.append({'role': role, 'parts': [{'text': m['content']}]})
        
        payload = {'contents': contents}
        if system_instruction:
            payload['system_instruction'] = system_instruction
        
        response = requests.post(url, json=payload, stream=True, timeout=120)
        
        if response.status_code != 200:
            raise RuntimeError(f"Google API error: {response.text}")
        
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data = line[6:]
                    try:
                        chunk = json.loads(data)
                        candidates = chunk.get('candidates', [])
                        if candidates:
                            parts = candidates[0].get('content', {}).get('parts', [])
                            for part in parts:
                                text = part.get('text', '')
                                if text:
                                    yield text
                    except json.JSONDecodeError:
                        continue


class AgentActorManager:
    """管理所有活跃的 Agent Actor - 单例模式"""
    
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
        """获取或创建 Agent Actor"""
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
                    try:
                        self._pubsub.subscribe(channel)
                        print(f"[AgentActorManager] Subscribed to new channel: {channel}")
                    except Exception as e:
                        # pubsub 可能已经因网络/超时断开，重建监听器
                        print(f"[AgentActorManager] ⚠️ subscribe failed, restarting listener: {e}")
                        self._restart_global_listener_locked()
                else:
                    self._start_global_listener(channel)
            
            if actor.agent_id not in self._channel_to_agents[channel]:
                self._channel_to_agents[channel].append(actor.agent_id)
                print(f"[AgentActorManager] Agent {actor.agent_id} added to channel {channel}")

    def _start_global_listener(self, first_channel: str):
        """启动一个全局 Redis 监听线程"""
        if not self._redis_client:
            print("[AgentActorManager] Warning: Redis not available")
            return
        
        # ignore_subscribe_messages=True：避免 subscribe/unsubscribe 事件干扰处理逻辑
        self._pubsub = self._redis_client.pubsub(ignore_subscribe_messages=True)
        self._pubsub.subscribe(first_channel)
        
        def _listen():
            print(f"[AgentActorManager] Global Redis listener started on {first_channel}")
            # 使用 get_message(timeout=...) 的轮询模式，避免 pubsub.listen() 在 socket timeout 时退出线程
            while True:
                try:
                    message = self._pubsub.get_message(timeout=1.0)
                    if not message:
                        time.sleep(0.05)
                        continue
                    if message.get('type') != 'message':
                        continue

                    channel = message.get('channel')
                    if isinstance(channel, bytes):
                        channel = channel.decode('utf-8', errors='ignore')

                    raw = message.get('data')
                    if isinstance(raw, bytes):
                        raw = raw.decode('utf-8', errors='ignore')

                    try:
                        data = json.loads(raw)
                    except Exception:
                        # 非 JSON 事件直接忽略（避免监听器崩溃）
                        continue

                    event_type = data.get('type')
                    # 分发会影响 actor 状态的事件（会话收敛相关）
                    if event_type in (
                        'new_message',
                        'topic_updated',
                        'topic_participants_updated',
                        'agent_joined',
                        'participant_left',
                    ):
                        agents = self._channel_to_agents.get(channel, [])
                        if agents:
                            print(f"[AgentActorManager] Dispatching {event_type} on {channel} to {len(agents)} agents")
                        for agent_id in agents:
                            actor = self.actors.get(agent_id)
                            if actor:
                                topic_id = channel.split(':')[-1]
                                actor.on_event(topic_id, data)
                except Exception as e:
                    # redis-py 常见：Timeout reading from socket（socket 超时，不应终止线程）
                    msg = str(e)
                    if 'Timeout reading from socket' in msg:
                        continue
                    print(f"[AgentActorManager] Listener error: {e}")
                    # 尝试重连并重新订阅所有 channel
                    try:
                        with self._lock:
                            self._restart_global_listener_locked()
                    except Exception as e2:
                        print(f"[AgentActorManager] Listener restart failed: {e2}")
                        time.sleep(1.0)
        
        self._sub_thread = threading.Thread(target=_listen, name="AgentActorManager-RedisListener")
        self._sub_thread.daemon = True
        self._sub_thread.start()

    def _restart_global_listener_locked(self):
        """重建 pubsub 并重新订阅所有已注册 channel（需在持锁状态下调用）"""
        try:
            if self._pubsub:
                try:
                    self._pubsub.close()
                except Exception:
                    pass
        finally:
            self._pubsub = self._redis_client.pubsub(ignore_subscribe_messages=True)
            channels = list(self._channel_to_agents.keys())
            if channels:
                self._pubsub.subscribe(*channels)
                print(f"[AgentActorManager] ✅ Listener restarted, subscribed channels: {len(channels)}")


# ==================== 辅助函数 ====================

def activate_agent(agent_id: str, topic_id: str, trigger_message: dict = None) -> AgentActor:
    """
    激活 Agent 并让其加入某个 Topic
    
    Args:
        agent_id: Agent ID
        topic_id: Topic/会话 ID
        trigger_message: 触发激活的消息（如果提供，会立即处理该消息）
    """
    manager = AgentActorManager.get_instance()
    actor = manager.get_or_create_actor(agent_id)
    actor.subscribe_topic(topic_id)
    print(f"[activate_agent] Agent {agent_id} activated and subscribed to topic {topic_id}")
    
    # 如果提供了触发消息，直接放入 mailbox 立即处理
    if trigger_message:
        print(f"[activate_agent] Processing trigger message immediately: {trigger_message.get('message_id')}")
        actor.on_event(topic_id, {'type': 'new_message', 'data': trigger_message})
    
    return actor


def get_active_agents() -> Dict[str, AgentActor]:
    """获取所有活跃的 Agent Actor"""
    return AgentActorManager.get_instance().actors
