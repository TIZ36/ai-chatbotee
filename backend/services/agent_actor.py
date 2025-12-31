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
import re
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
            import json
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute("""
                SELECT s.session_id, s.name, s.avatar, s.system_prompt, s.llm_config_id, s.ext,
                       lc.provider, lc.model as config_model, lc.api_url, lc.api_key
                FROM sessions s
                LEFT JOIN llm_configs lc ON s.llm_config_id = lc.config_id
                WHERE s.session_id = %s AND s.session_type = 'agent'
            """, (self.agent_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            if row:
                # 解析 ext 字段（JSON）
                if row.get('ext') and isinstance(row.get('ext'), str):
                    try:
                        row['ext'] = json.loads(row['ext'])
                    except:
                        row['ext'] = {}
                elif not row.get('ext'):
                    row['ext'] = {}
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
                elif event_type == 'messages_rolled_back':
                    # 回滚/真删除：本地历史必须同步截断或重载
                    self._handle_messages_rolled_back(event['topic_id'], event.get('data') or {})
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
        
        # 规则 1：维护本地历史（包含 user/assistant/system），用于后续决策与上下文
        # 注意：必须把“自己发出的 assistant 消息”也写入历史，否则下一轮模型只看到用户消息，会表现为“没有记忆/顺序错乱”。
        self._append_topic_history(topic_id, msg_data)

        # 1. 自己的消息：只记录进 history，不需要再次触发回应
        if sender_id == self.agent_id:
            return

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
        
        # 如果决定不回答，不发送独立消息，而是将决策信息添加到 processSteps 中
        # 前端会在思考组件中显示这些信息
        if action == 'silent':
            # 添加决策说明步骤
            decision_process_steps.append({
                'type': 'thinking',
                'timestamp': int(time.time() * 1000),
                'thinking': f'经过分析，我认为这个问题不需要我来回答，或者已有其他更合适的 Agent 在处理。',
                'status': 'completed'
            })
            # 通过事件通知前端（包含完整的 processSteps），但不保存为独立消息
            get_topic_service()._publish_event(topic_id, 'agent_silent', {
                'agent_id': self.agent_id,
                'agent_name': self.info.get('name', 'Agent'),
                'agent_avatar': self.info.get('avatar'),
                'in_reply_to': message_id,
                'timestamp': time.time(),
                'processSteps': decision_process_steps
            })
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
        if requested_tools:
            if session_type in ['topic_general', 'memory']:
                # 多人话题：用锁避免多个 agent 同时抢占同一工具
                for tool in requested_tools:
                    lock_key = f"lock:topic:{topic_id}:msg:{message_id}:tool:{tool}"
                    if self._redis_client.set(lock_key, self.agent_id, ex=60, nx=True):
                        used_tools.append(tool)
                        print(f"[AgentActor:{self.agent_id}] Acquired lock for {tool}")
                    else:
                        tool_name = tool.split(':')[-1]
                        print(f"[AgentActor:{self.agent_id}] Tool {tool_name} already in use")
                        # 将工具被占用信息添加到 processSteps，而不是发送独立消息
                        decision_process_steps.append({
                            'type': 'thinking',
                            'timestamp': int(time.time() * 1000),
                            'thinking': f'我想用 {tool_name}，但是现在有其他agent在使用了，所以我停止获取。',
                            'status': 'completed'
                        })
                        # 通过事件通知前端，但不保存为独立消息
                        get_topic_service()._publish_event(topic_id, 'agent_tool_unavailable', {
                            'agent_id': self.agent_id,
                            'agent_name': self.info.get('name', 'Agent'),
                            'agent_avatar': self.info.get('avatar'),
                            'tool_name': tool_name,
                            'in_reply_to': message_id,
                            'timestamp': time.time(),
                            'processSteps': decision_process_steps
                        })
                        return
            else:
                # 私聊/积极模式：不做锁，直接允许使用用户选中的工具
                used_tools = list(requested_tools)

        # 4. 获取用户选择的 LLM 配置（私聊模式下使用）
        user_selected_llm_config_id = ext.get('llm_config_id') or ext.get('user_llm_config_id')
        
        # 5. 构建上下文并产生流式回答，传入决策过程步骤和用户选择的模型
        # 让 winning agent 明确感知用户选择的工具（并在回答里使用/提及）
        # 注意：不要把“工具使用权提示”写进用户消息正文，否则会污染消息历史，且容易导致模型在工具失败时仍“误以为已调用成功”。
        self._generate_streaming_reply(topic_id, content, used_tools, message_id, decision_process_steps, user_selected_llm_config_id, ext)

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
        # 加载会话中的所有历史消息（用户要求：history 包含会话中的所有消息）
        msgs = self._load_all_topic_messages(topic_id)

        # 仅保留 Actor 需要的关键字段：
        # - history 需要“全量消息序列”用于回顾/摘要/顺序一致性
        # - 但不要把 ext/mcpdetail/base64 塞进 history（避免爆内存/爆上下文）
        slim: List[dict] = []
        last_media = None
        for m in (msgs or []):
            if not isinstance(m, dict):
                continue
            try:
                ext = m.get('ext') or {}
                media = ext.get('media')
                if isinstance(media, list) and media:
                    # 只缓存最近一次“可用媒体”，供下一轮引用“上图/这张图”
                    last_media = media
            except Exception:
                pass
            slim.append({
                'message_id': m.get('message_id'),
                'role': m.get('role'),
                'content': m.get('content'),
                'created_at': m.get('created_at'),
            })

        self._topic_state[topic_id]['history'] = slim
        if last_media:
            self._topic_state[topic_id]['last_media'] = last_media
        # 摘要状态（用于超阈值自动摘要）
        self._topic_state[topic_id].setdefault('history_summary', None)
        self._topic_state[topic_id].setdefault('history_summary_until', None)

    def _load_all_topic_messages(self, topic_id: str) -> List[dict]:
        """从 DB 全量加载会话消息，返回按时间升序排列的消息 dict 列表。"""
        svc = get_message_service()

        # 优先使用分页接口（可避免一次性巨大查询）
        all_msgs: List[dict] = []
        before_id: Optional[str] = None
        page_size = 200

        while True:
            try:
                batch, has_more, _latest_id = svc.get_messages_paginated(
                    topic_id,
                    limit=page_size,
                    before_id=before_id,
                    use_cache=False,  # 全量加载走 DB，避免缓存只覆盖部分窗口
                )
            except TypeError:
                # 兼容老版本：退回到 get_messages（可能只能拿到一段）
                try:
                    return svc.get_messages(topic_id, limit=page_size, before=before_id, use_cache=False)
                except Exception:
                    return svc.get_messages(topic_id, limit=page_size)

            if not batch:
                break

            # get_messages_paginated 返回的 batch 内部是“从早到晚”
            if before_id is None:
                all_msgs = batch
            else:
                all_msgs = batch + all_msgs

            if not has_more:
                break

            # 下一页：以当前 batch 最早的那条作为 before 游标
            before_id = (batch[0] or {}).get('message_id')
            if not before_id:
                break

        return all_msgs

    def _handle_messages_rolled_back(self, topic_id: str, data: dict):
        """处理回滚/删除事件：重载历史并清理可能失效的摘要。"""
        to_message_id = data.get('to_message_id') or data.get('message_id')
        print(f"[AgentActor:{self.agent_id}] Rollback detected on {topic_id}, to={to_message_id}")
        try:
            self._load_topic_context(topic_id)
        except Exception as e:
            print(f"[AgentActor:{self.agent_id}] ⚠️ Failed to reload topic context after rollback: {e}")
            return

        # 如果摘要覆盖范围已经不在历史里，清掉摘要（避免“幽灵记忆”）
        summary_until = (self._topic_state.get(topic_id, {}) or {}).get('history_summary_until')
        if summary_until:
            history_ids = {m.get('message_id') for m in (self._topic_state.get(topic_id, {}) or {}).get('history') or []}
            if summary_until not in history_ids:
                self._topic_state[topic_id]['history_summary'] = None
                self._topic_state[topic_id]['history_summary_until'] = None

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

    def _append_topic_history(self, topic_id: str, msg_data: dict, max_len: Optional[int] = None):
        self._topic_state.setdefault(topic_id, {})
        history = self._topic_state[topic_id].setdefault('history', [])
        # 写入轻量结构，避免把 ext/media/mcpdetail 等大对象带入上下文
        if isinstance(msg_data, dict):
            # 维护“最近一次媒体”（用于下一轮用户说“看上图/这张图”时补齐多模态输入）
            try:
                ext = msg_data.get('ext') or {}
                media = ext.get('media')
                if isinstance(media, list) and media:
                    self._topic_state[topic_id]['last_media'] = media
            except Exception:
                pass
            history.append({
                'message_id': msg_data.get('message_id'),
                'role': msg_data.get('role'),
                'content': msg_data.get('content'),
                'created_at': msg_data.get('created_at') or msg_data.get('timestamp'),
            })
        else:
            history.append(msg_data)
        # 用户要求：history 包含会话中的所有消息。只有在明确传入 max_len 时才裁剪。
        if max_len is not None and max_len > 0 and len(history) > max_len:
            self._topic_state[topic_id]['history'] = history[-max_len:]

    def _should_attach_last_media(self, text: str) -> bool:
        """判断用户是否在引用上一张图/这张图（无需精确 NLP，启发式即可）。"""
        t = (text or '').lower()
        if not t:
            return False
        keywords = [
            '上图', '这张图', '那张图', '图里', '图中', '看图', '描述一下图', '识别图片', '图片', 'photo', 'image', 'screenshot',
            '根据图片', '根据上面的图', '根据刚才的图', '帮我看下图',
        ]
        return any(k in t for k in keywords)

    def _get_last_media(self, topic_id: str) -> Optional[list]:
        media = (self._topic_state.get(topic_id, {}) or {}).get('last_media')
        if isinstance(media, list) and media:
            return media
        return None

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
        
        # private_chat: 旧版私聊，始终直接回复
        if session_type == 'private_chat':
            return 'reply'
        
        # agent: 新版 Agent 私聊，根据 responseMode 配置决定
        if session_type == 'agent':
            # 检查 agent 的响应模式配置
            ext = self.info.get('ext') or {}
            persona = ext.get('persona') or {}
            response_mode = persona.get('responseMode', 'normal')  # 默认为普通聊天模式
            
            # 普通聊天模式：直接回复（跳过决策）
            if response_mode == 'normal':
                return 'reply'
            # 人格模式：继续执行决策逻辑（思考是否要响应）
            # 这里不返回，继续下面的决策流程

        # 其他 agent 的消息：默认不抢话（收敛）
        if sender_type == 'agent':
            # 如果对方在问 @human，保持沉默避免回环
            if '@human' in content:
                return 'silent'
            # 简化：对 agent 陈述默认沉默（后续可用 LLM 判定 like/oppose）
            return 'silent'

        # ========= 优化：减少 LLM 调用次数 =========
        # 判断是否为单 Agent 场景（私聊或只有一个 Agent 的 topic）
        topic_state = self._topic_state.get(topic_id, {})
        participants = topic_state.get('participants') or []
        agent_count = sum(1 for p in participants if p.get('participant_type') == 'agent')
        
        # 单 Agent 场景：直接回答用户问题，不需要 LLM 决策
        if agent_count <= 1:
            if self._is_question(content):
                return 'reply'
            # 用户的陈述也直接回复（单Agent模式下更友好）
            return 'reply'
        
        # 多 Agent 场景：只有对问题进行决策，陈述默认沉默
        if self._is_question(content):
            # 问题：结合人设/参与者能力做意愿判定（可能委派给其他 agent 或 @human）
            return self._llm_intent_decision(topic_id, msg_data, default_action='reply', decision_steps=decision_steps)
        # 陈述：默认沉默（避免不必要的 LLM 调用）
        return 'silent'

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

    def _generate_streaming_reply(self, topic_id: str, user_content: str, used_tools: List[str], in_reply_to: str = None, decision_steps: List[dict] = None, user_selected_llm_config_id: str = None, user_message_ext: dict = None):
        """
        流式产生回复并实时推送到 Topic
        
        Args:
            topic_id: 话题 ID
            user_content: 用户消息内容
            used_tools: 使用的工具列表
            in_reply_to: 回复的消息 ID
            decision_steps: 决策过程步骤列表（激活/决策/决定回答等），会合并到最终的 processSteps 中
            user_selected_llm_config_id: 用户选择的 LLM 配置 ID（私聊模式下使用，多人topic中忽略）
            user_message_ext: 用户消息的扩展数据（包含媒体内容等）
        """
        try:
            # 生成回复消息 ID
            reply_message_id = f"msg_{uuid.uuid4().hex[:8]}"

            # ============ 多模态后处理缓存（本轮回复） ============
            # 说明：Gemini/Google 的图片生成可能以“provider 返回值(LLMResponse.media)”或“legacy data URL”形式出现。
            # 为了让前端 MediaGallery 和媒体库都稳定工作，我们统一把图片写入 ext.media。
            self._pending_reply_media = None
            
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
                # 重要：模型只能在“确实获得工具执行结果”后，才可以在回答里声称已调用工具。
                # 否则（例如 MCP 执行失败），必须明确说明失败原因，并继续用已有信息回答/给出下一步建议。
                system_prompt += (
                    "\n\n你可以使用以下工具（按需）："
                    f"{', '.join(used_tools)}。"
                    "只有在你确实看到了工具执行结果后，才能在回答中引用工具输出；"
                    "如果工具执行失败，请直接说明失败原因，不要编造工具结果。"
                    "严禁提及或假装使用未在以上列表中的任何工具/MCP/Workflow/技能。"
                    "\n【输出禁令】严禁输出以下无意义内容："
                    "1) 禁止输出「好的，我来为您...」「让我帮你...」等过渡废话后接假代码块；"
                    "2) 禁止输出 tool_code / print(mcp.xxx) / {\"tool_code\":...} 等伪工具调用；"
                    "3) 工具已在后台自动执行，你只需基于【事实源】直接回答问题，不要复述工具调用过程。"
                )
            else:
                # 没有工具授权：严禁模型编造“我调用了工具”
                system_prompt += (
                    "\n\n工具使用规则：你当前没有任何可用工具授权（包括 MCP/Workflow/技能）。"
                    "严禁声称你调用了工具，严禁输出伪代码/伪调用（例如 tool_code / print(mcp.xxx) / {\"tool_code\":...}）。"
                    "严禁输出「好的，我来为您检查...」等过渡废话后接代码块——这对用户毫无意义。"
                    "如需工具，请提示用户通过 @ 选择/授权对应 MCP 或 Workflow。"
                )

            # 确定使用的 LLM 配置
            # 1. 私聊模式（agent类型topic）：使用用户选择的模型（如果提供）
            # 2. 多人topic：使用agent配置的模型
            topic = get_topic_service().get_topic(topic_id) or {}
            session_type = topic.get('session_type')
            
            if session_type == 'agent' and user_selected_llm_config_id:
                # 私聊模式：使用用户选择的模型
                config_id = user_selected_llm_config_id
                # 用可读信息替代 config_id（UUID）
                display = user_selected_llm_config_id
                try:
                    llm_cfg = get_llm_service().get_config(user_selected_llm_config_id, include_api_key=False) or {}
                    cfg_name = llm_cfg.get('name')
                    cfg_provider = llm_cfg.get('provider')
                    cfg_model = llm_cfg.get('model')
                    parts = []
                    if cfg_name:
                        parts.append(str(cfg_name))
                    if cfg_provider or cfg_model:
                        parts.append(f"({cfg_provider or 'unknown'}/{cfg_model or 'unknown'})")
                    if parts:
                        display = " ".join(parts)
                except Exception:
                    pass
                process_steps.append({
                    'type': 'thinking',
                    'timestamp': int(time.time() * 1000),
                    'thinking': f'使用用户选择的模型: {display}',
                    'status': 'completed'
                })
            else:
                # 多人topic或未提供用户选择：使用agent配置的模型
                config_id = self.info.get('llm_config_id')
            
            if not config_id:
                raise ValueError(f"Agent {self.agent_id} has no LLM config assigned")

            # ============ Actor 模式：自动执行 MCP（如果用户选中）===========
            # 说明：前端在 Actor 会话中只负责写入消息与 ext.mcp_servers，不再负责真正调用工具。
            # 因此这里需要后端补齐“自动调用 MCP 工具”的能力，恢复之前的体验。
            try:
                mcp_server_ids = [t.split(':', 1)[1] for t in (used_tools or []) if isinstance(t, str) and t.startswith('mcp:')]
                if mcp_server_ids:
                    from services.mcp_execution_service import execute_mcp_with_llm

                    # 本轮“高优先级事实源”：同一工具如果多次调用，后一次覆盖前一次
                    mcp_facts_by_key: Dict[str, str] = {}

                    # 预先获取所有 MCP 服务器的名称映射
                    mcp_server_names: Dict[str, str] = {}
                    try:
                        from models.mcp_server import MCPServerRepository
                        mcp_repo = MCPServerRepository(get_mysql_connection)
                        for s_id in mcp_server_ids[:3]:
                            server = mcp_repo.find_by_id(s_id)
                            if server:
                                mcp_server_names[s_id] = server.name
                            else:
                                mcp_server_names[s_id] = s_id  # fallback
                    except Exception as e:
                        print(f"[AgentActor] Warning: Failed to get MCP server names: {e}")

                    for sid in mcp_server_ids[:3]:  # 避免一次触发太多服务器
                        step_start = time.time()
                        mcp_server_name = mcp_server_names.get(sid, sid)
                        step: Dict[str, Any] = {
                            'type': 'mcp_call',
                            'timestamp': int(step_start * 1000),
                            'mcpServer': mcp_server_name,  # 使用名称而非 ID
                            'mcpServerId': sid,  # 保留 ID 以备后用
                            'toolName': 'auto',
                            'arguments': {'input': user_content},
                            'status': 'running',
                        }
                        process_steps.append(step)

                        # ========= 优化：立即通知前端 MCP 调用开始 =========
                        get_topic_service()._publish_event(topic_id, 'mcp_call_start', {
                            'agent_id': self.agent_id,
                            'agent_name': self.info.get('name', 'Agent'),
                            'agent_avatar': self.info.get('avatar'),
                            'mcp_server_id': sid,
                            'mcp_server_name': mcp_server_name,
                            'step': step,
                            'processSteps': process_steps,
                            'in_reply_to': in_reply_to,
                            'timestamp': time.time(),
                        })

                        result = execute_mcp_with_llm(
                            mcp_server_id=sid,
                            input_text=user_content,
                            llm_config_id=config_id,
                        )
                        step['duration'] = int((time.time() - step_start) * 1000)
                        if result.get('error'):
                            step['status'] = 'error'
                            step['error'] = result.get('error')
                            # 保留更多诊断（如 tools_list_response/initialize_response），便于排查
                            step['result'] = result
                        else:
                            step['status'] = 'completed'
                            # 存 compact 版本，避免 processSteps 过大
                            tool_text = result.get('tool_text')
                            step['result'] = {
                                'summary': result.get('summary'),
                                'tool_text': tool_text,
                                'raw_result_compact': result.get('raw_result_compact'),
                            }

                            # 聚合“事实源”：按工具名覆盖（同轮后一次结果优先）
                            # 同时更新 step 中的 toolName 为实际调用的工具名称
                            raw = result.get('raw_result') or {}
                            tcalls = raw.get('tool_calls') if isinstance(raw, dict) else None
                            actual_tool_name = None
                            if isinstance(tcalls, list) and tcalls:
                                name0 = (tcalls[0] or {}).get('name')
                                if name0:
                                    actual_tool_name = name0
                                    step['toolName'] = name0  # 更新为实际工具名称
                            
                            if tool_text:
                                # 如果能取到工具名，用工具名做 key；否则用 server 做 key
                                key = f"{sid}:{actual_tool_name}" if actual_tool_name else f"{sid}:tool"
                                mcp_facts_by_key[key] = tool_text


                        # ========= 优化：通知前端 MCP 调用完成 =========
                        get_topic_service()._publish_event(topic_id, 'mcp_call_done', {
                            'agent_id': self.agent_id,
                            'agent_name': self.info.get('name', 'Agent'),
                            'agent_avatar': self.info.get('avatar'),
                            'mcp_server_id': sid,
                            'mcp_server_name': mcp_server_name,
                            'step': step,
                            'processSteps': process_steps,
                            'in_reply_to': in_reply_to,
                            'timestamp': time.time(),
                        })

                        # 把 MCP 结果摘要注入 system_prompt，让后续回答“确实使用了工具结果”
                        summary = result.get('summary')
                        compact = result.get('raw_result_compact')
                        if summary or compact:
                            system_prompt += "\n\n=== MCP 工具执行结果 ===\n"
                            if summary:
                                system_prompt += f"{summary}\n"
                            if compact:
                                try:
                                    system_prompt += json.dumps(compact, ensure_ascii=False)
                                except Exception:
                                    system_prompt += str(compact)

                    # 单独追加一份“事实源（本轮最新）”，避免 system_prompt 多次追加导致前后冲突
                    if mcp_facts_by_key:
                        # 保持稳定顺序输出
                        facts_text = "\n\n".join([mcp_facts_by_key[k] for k in sorted(mcp_facts_by_key.keys()) if mcp_facts_by_key.get(k)])
                        if facts_text.strip():
                            system_prompt += (
                                "\n\n"
                                "【重要：工具已自动执行完毕，以下是执行结果】\n"
                                "=== 工具执行结果（事实源，本轮最新）===\n"
                                f"{facts_text.strip()}\n"
                                "\n"
                                "【你的任务】：\n"
                                "基于上述工具执行结果，直接用自然语言回答用户的问题。\n"
                                "\n"
                                "【严格禁止】：\n"
                                "- 禁止输出任何代码块（JSON、tool_code、mcp.xxx 等）\n"
                                "- 禁止说「我来为您调用/检查...」——工具已经执行完了\n"
                                "- 禁止重复调用工具——直接使用上面的结果\n"
                                "\n"
                                "【正确做法】：\n"
                                "直接告诉用户结果，例如：「根据查询结果，您的小红书已登录，账号是xxx」"
                            )
            except Exception as e:
                # 不阻断正常回复
                process_steps.append({
                    'type': 'thinking',
                    'timestamp': int(time.time() * 1000),
                    'thinking': f'⚠️ MCP 自动执行失败: {str(e)}',
                    'status': 'error',
                    'error': str(e),
                })

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

            # 构建用户消息，包含媒体内容（如果存在）
            user_message = {"role": "user", "content": user_content}
            
            # 从 ext 中提取媒体内容
            if user_message_ext:
                media_list = user_message_ext.get('media', [])
                if media_list and isinstance(media_list, list):
                    # 将媒体内容添加到消息中（用于多模态支持）
                    user_message['media'] = media_list
            # 如果本轮用户没有带 media，但内容在引用“上图/这张图”，则自动附加最近一次媒体
            if not user_message.get('media') and self._should_attach_last_media(user_content):
                last_media = self._get_last_media(topic_id)
                if last_media:
                    user_message['media'] = last_media
                    process_steps.append({
                        'type': 'thinking',
                        'timestamp': int(time.time() * 1000),
                        'thinking': '检测到用户在引用图片，已自动附加最近一次图片到本轮上下文（来自 ext.media）',
                        'status': 'completed',
                    })
            
            # ============ “memory 属性”：拼接最近历史上下文 ============
            # ActorAgent 本地维护了 topic 历史（_topic_state[topic_id]['history']），但旧实现只发 system+当前消息给 LLM。
            # 这里把最近若干轮 user/assistant 消息一起发送，作为“带记忆的对话上下文”。
            # 注意：摘要生成移至后台异步执行，不阻塞当前回复
            import threading
            def _async_summarize():
                try:
                    self._maybe_summarize_topic_history(topic_id=topic_id, llm_config_id=config_id)
                except Exception as _sum_err:
                    print(f"[AgentActor:{self.agent_id}] ⚠️ async summarize failed: {_sum_err}")
            threading.Thread(target=_async_summarize, daemon=True).start()
            messages = self._build_llm_messages_with_history(
                topic_id=topic_id,
                system_prompt=system_prompt,
                user_message=user_message,
                in_reply_to=in_reply_to,
                max_history_messages=24,
                max_total_chars=18000,
                max_per_message_chars=2400,
            )
            
            print(f"[AgentActor:{self.agent_id}] Starting streaming LLM call (config: {config_id})")
            if user_message.get('media'):
                print(f"[AgentActor:{self.agent_id}] Message contains {len(user_message['media'])} media items")
            
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

            # ============ 后处理：把图片等媒体写入 ext.media ============
            try:
                normalized_media = self._normalize_media_for_ext(getattr(self, "_pending_reply_media", None))
                if normalized_media:
                    ext_data['media'] = normalized_media
                    # 既然 ext.media 会以缩略图方式展示，这里去掉 Markdown 里嵌入的 dataURL 图片，避免重复渲染与超大文本
                    full_content = self._strip_markdown_data_images(full_content)
            except Exception as _media_err:
                print(f"[AgentActor:{self.agent_id}] ⚠️ normalize media failed: {_media_err}")
            
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
                'processSteps': process_steps,
                # 额外字段：让前端无需刷新即可展示媒体（兼容旧前端：无此字段也不影响）
                'media': ext_data.get('media')
            })
            
        except Exception as e:
            print(f"[AgentActor:{self.agent_id}] Error in streaming reply: {e}")
            traceback.print_exc()
            
            # 记录错误到执行轨迹，添加到已有的 process_steps 中
            error_step = {
                'type': 'thinking',
                'timestamp': int(time.time() * 1000),
                'thinking': f'生成回复失败: {str(e)}',
                'status': 'error',
                'error': str(e)
            }
            
            # 将错误步骤添加到已有的 process_steps 中
            if 'process_steps' in locals():
                process_steps.append(error_step)
            else:
                process_steps = [error_step]
            
            # 如果已经创建了 reply_message_id，更新该消息的 processSteps
            if 'reply_message_id' in locals():
                # 通知前端：流式完成（包含错误信息）
                get_topic_service()._publish_event(topic_id, 'agent_stream_done', {
                    'agent_id': self.agent_id,
                    'agent_name': self.info.get('name', 'Agent'),
                    'agent_avatar': self.info.get('avatar'),
                    'message_id': reply_message_id,
                    'content': '',  # 错误时内容为空
                    'processSteps': process_steps,
                    'error': str(e)  # 添加错误信息
                })
                
                # 保存错误消息到数据库（包含 processSteps）
                get_topic_service().send_message(
                    topic_id=topic_id,
                    sender_id=self.agent_id,
                    sender_type='agent',
                    content=f"[错误] {self.info.get('name', 'Agent')} 无法产生回复: {str(e)}",
                    role='assistant',  # 改为 assistant，这样会显示在思考组件中
                    message_id=reply_message_id,
                    sender_name=self.info.get('name'),
                    sender_avatar=self.info.get('avatar'),
                    ext={'processSteps': process_steps, 'error': str(e)}
                )
            else:
                # 如果还没有创建 reply_message_id，说明在初始化阶段就失败了
                # 这种情况下发送 system 消息
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
        """流式调用 LLM，返回 chunk 生成器
        
        优先使用统一的 Provider 架构（带 SDK 支持），回退到旧的 REST API 实现
        """
        # 尝试使用新的 Provider 架构
        try:
            yield from self._stream_llm_with_provider(provider, api_key, api_url, model, messages)
            return
        except ImportError:
            # Provider 模块未导入，使用旧实现
            print(f"[AgentActor] Provider module not available, using legacy implementation")
        except Exception as e:
            # Provider 调用失败，尝试旧实现
            print(f"[AgentActor] Provider call failed: {e}, trying legacy implementation")
        
        # 旧的实现作为回退
        if provider == 'openai':
            yield from self._stream_openai(api_key, api_url, model, messages)
        elif provider == 'deepseek':
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
    
    def _stream_llm_with_provider(self, provider: str, api_key: str, api_url: str, model: str, messages: List[dict]):
        """使用统一的 Provider 架构进行流式调用"""
        from services.providers import create_provider, LLMMessage
        
        # 转换消息格式
        llm_messages = []
        for msg in messages:
            llm_messages.append(LLMMessage(
                role=msg.get('role', 'user'),
                content=msg.get('content', ''),
                media=msg.get('media'),
                tool_calls=msg.get('tool_calls'),
                tool_call_id=msg.get('tool_call_id'),
                name=msg.get('name')
            ))
        
        # 创建 Provider
        llm_provider = create_provider(
            provider_type=provider,
            api_key=api_key,
            api_url=api_url,
            model=model
        )
        
        print(f"[AgentActor] Using Provider: {llm_provider.provider_type}, SDK: {llm_provider.sdk_available}")
        
        # 流式调用
        #
        # 注意：对于 Gemini 图片生成，provider.chat_stream 实际是“非流式+yield一次”，并通过 generator return 返回 LLMResponse（含 media）。
        # 这里手动捕获 StopIteration.value，作为后处理写入 ext.media 的来源，不影响原有 API 调用与解析逻辑。
        stream = llm_provider.chat_stream(llm_messages)
        while True:
            try:
                chunk = next(stream)
            except StopIteration as e:
                resp = getattr(e, "value", None)
                media = getattr(resp, "media", None) if resp is not None else None
                if media:
                    self._pending_reply_media = media
                break
            yield chunk

    def _build_llm_messages_with_history(
        self,
        *,
        topic_id: str,
        system_prompt: str,
        user_message: dict,
        in_reply_to: Optional[str],
        max_history_messages: int = 24,
        max_total_chars: int = 18000,
        max_per_message_chars: int = 2400,
    ) -> List[dict]:
        """把 topic 的最近历史拼进 messages（即“memory 属性”）。

        - 仅拼 user/assistant（跳过 tool/system，避免噪音与爆长）
        - 做长度上限，避免超大上下文导致 API 失败
        """
        def _clean_text(s: str) -> str:
            if not isinstance(s, str):
                return ''
            t = s.strip()
            # 去掉工具提示前缀，避免污染上下文
            t = re.sub(r"^\[你已获得工具使用权：.*?\]\s*", "", t).strip()
            # 去掉可能残留的 data:image markdown（即便前面已经做了清理，这里再兜底）
            t = re.sub(r"!\[[^\]]*\]\(data:image\/[^)]+\)", "", t)
            return t.strip()

        # 1) system
        out: List[dict] = [{"role": "system", "content": system_prompt}]

        # 1.5) 如果有历史摘要，作为更高优先级的“已压缩记忆”注入
        topic_state = (self._topic_state.get(topic_id, {}) or {})
        summary = topic_state.get('history_summary')
        if isinstance(summary, str) and summary.strip():
            out.append({
                "role": "system",
                "content": "【对话摘要（自动生成，用于补充记忆）】\n" + summary.strip()
            })

        # 2) history（从旧到新）
        history = topic_state.get("history") or []
        if not isinstance(history, list):
            history = []

        # 如果本地 history 为空/过短，说明启动加载或事件增量更新没跟上：这里兜底从 DB 重新拉一次
        if len(history) < 2:
            try:
                self._load_topic_context(topic_id)
                topic_state = (self._topic_state.get(topic_id, {}) or {})
                history = topic_state.get("history") or []
            except Exception:
                pass

        # 保证顺序：按 created_at / timestamp 排序（历史很短，排序开销可忽略）
        def _sort_key(m: dict) -> float:
            try:
                v = (m or {}).get('created_at')
                if isinstance(v, (int, float)):
                    return float(v)
                if isinstance(v, str) and v:
                    try:
                        # isoformat
                        from datetime import datetime
                        return datetime.fromisoformat(v.replace('Z', '+00:00')).timestamp()
                    except Exception:
                        return 0.0
                return 0.0
            except Exception:
                return 0.0

        try:
            history = sorted([m for m in history if isinstance(m, dict)], key=_sort_key)
        except Exception:
            pass

        # 只取最近 N 条，但保持顺序
        tail = history[-max_history_messages:] if max_history_messages > 0 else []
        hist_msgs: List[dict] = []
        for m in tail:
            if not isinstance(m, dict):
                continue
            mid = m.get("message_id")
            if in_reply_to and mid == in_reply_to:
                # 最后会 append user_message，避免重复
                continue
            role = (m.get("role") or "").strip()
            if role not in ("user", "assistant"):
                continue
            content = _clean_text(m.get("content") or "")
            if not content:
                continue
            if len(content) > max_per_message_chars:
                content = content[:max_per_message_chars] + "…"
            hist_msgs.append({"role": role, "content": content})

        # 3) current user
        current = {"role": "user", "content": _clean_text(user_message.get("content") or "")}
        if user_message.get("media"):
            # 多模态：仍传给 provider，让 Gemini/Claude 等能接收图片输入
            current["media"] = user_message.get("media")
        if current["content"] or current.get("media"):
            hist_msgs.append(current)

        # 4) total budget（简单按字符）
        total = sum(len(x.get("content") or "") for x in hist_msgs)
        if total > max_total_chars and max_total_chars > 0:
            # 从最旧开始丢，保留最新
            trimmed: List[dict] = []
            running = 0
            for x in reversed(hist_msgs):
                c = x.get("content") or ""
                if running + len(c) > max_total_chars and trimmed:
                    continue
                running += len(c)
                trimmed.append(x)
            hist_msgs = list(reversed(trimmed))

        out.extend(hist_msgs)
        return out

    def _maybe_summarize_topic_history(self, *, topic_id: str, llm_config_id: str):
        """当历史累计接近上下文阈值时，自动生成摘要并写入 topic_state。

        成熟策略（后端简化版）：
        - 估算 token，超过阈值触发摘要
        - 摘要覆盖“较老的一段”，保留最近窗口
        - 若后续 rollback 使摘要失效，在 _handle_messages_rolled_back 中清理
        """
        try:
            from token_counter import estimate_messages_tokens, get_model_max_tokens
        except Exception:
            return

        topic_state = self._topic_state.get(topic_id, {}) or {}
        history = topic_state.get('history') or []
        if not isinstance(history, list) or len(history) < 20:
            return

        # 获取当前会用于生成回复的模型名（用于 token 阈值估算）
        llm_cfg = get_llm_service().get_config(llm_config_id, include_api_key=False) or {}
        model = llm_cfg.get('model') or 'gpt-4'
        max_tokens = get_model_max_tokens(model)

        # 触发阈值：取 min(模型上限的 35%, 24000)；同时给一个最小触发线 6000
        trigger = max(6000, min(int(max_tokens * 0.35), 24000))

        # 只估算 user/assistant 内容（system 另算）
        msgs_for_est = []
        for m in history:
            if not isinstance(m, dict):
                continue
            role = (m.get('role') or '').strip()
            if role not in ('user', 'assistant'):
                continue
            msgs_for_est.append({'role': role, 'content': m.get('content') or ''})

        total = estimate_messages_tokens(msgs_for_est, model=model)
        if total < trigger:
            return

        # 已经有摘要且覆盖范围较新：避免频繁摘要
        summary_until = topic_state.get('history_summary_until')
        if summary_until:
            # 简单节流：如果摘要已存在且历史还没新增太多，就先不做
            if len(history) < 80:
                return

        # 摘要覆盖：保留最后 keep_tail 条原文，其余进摘要
        keep_tail = 24
        older = history[:-keep_tail]
        if len(older) < 12:
            return

        # 构建摘要输入（截断防爆）
        lines = []
        last_id = None
        for m in older[-80:]:
            if not isinstance(m, dict):
                continue
            role = m.get('role')
            content = (m.get('content') or '').strip()
            if role not in ('user', 'assistant') or not content:
                continue
            if len(content) > 1200:
                content = content[:1200] + "…"
            lines.append(f"{role}: {content}")
            last_id = m.get('message_id') or last_id

        if not lines:
            return

        system = (
            "你是一个对话摘要器。请把以下对话浓缩成可供后续继续对话的“记忆摘要”。\n"
            "要求：\n"
            "- 保留关键事实、用户偏好、已做决定、待办事项、账号/登录状态等。\n"
            "- 去掉寒暄与重复。\n"
            "- 输出中文，控制在 400~800 字。\n"
            "- 只输出摘要正文，不要标题。"
        )
        user = "\n".join(lines)

        resp = get_llm_service().chat_completion(
            config_id=llm_config_id,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            stream=False,
        )
        summary = (resp.get('content') or '').strip()
        if not summary:
            return

        topic_state['history_summary'] = summary
        topic_state['history_summary_until'] = last_id
        self._topic_state[topic_id] = topic_state

    def _normalize_media_for_ext(self, media: Any) -> Optional[List[Dict[str, Any]]]:
        """将 provider/legacy 的媒体结构归一化为 ext.media 结构（仅做后处理，不影响 API 调用与解析）"""
        if not media:
            return None
        if not isinstance(media, list):
            return None

        out: List[Dict[str, Any]] = []
        for m in media:
            if not isinstance(m, dict):
                continue

            m_type = (m.get('type') or '').lower().strip()
            mime_type = (m.get('mimeType') or m.get('mime_type') or '').strip()
            data = m.get('data') or ''
            url = m.get('url')

            # 兼容：provider/legacy 可能把 data 写成 data:xxx;base64,....
            if isinstance(data, str) and data.startswith('data:') and ';base64,' in data:
                try:
                    header, b64 = data.split(';base64,', 1)
                    if not mime_type and header.startswith('data:'):
                        mime_type = header.split(':', 1)[1].strip()
                    data = b64
                except Exception:
                    pass

            if isinstance(data, str):
                data = data.strip().replace('\n', '').replace('\r', '').replace(' ', '')

            # 只保存我们能消费的最小字段集
            if not data and not url:
                continue

            # 补齐 type（如果 provider 没给）
            if not m_type:
                if mime_type.startswith('image/'):
                    m_type = 'image'
                elif mime_type.startswith('video/'):
                    m_type = 'video'
                elif mime_type.startswith('audio/'):
                    m_type = 'audio'

            if m_type not in ('image', 'video', 'audio'):
                continue

            item: Dict[str, Any] = {
                'type': m_type,
                'mimeType': mime_type or 'application/octet-stream',
            }
            if url:
                item['url'] = url
            if data:
                item['data'] = data

            out.append(item)

        return out or None

    def _strip_markdown_data_images(self, text: str) -> str:
        """移除 Markdown 中的 data:image/...;base64,... 图片（用于避免重复展示）"""
        if not isinstance(text, str) or not text:
            return text
        # 匹配 ![alt](data:image/xxx;base64,....)
        cleaned = re.sub(r"!\[[^\]]*\]\(data:image\/[^)]+\)", "", text)
        # 连续空行收敛
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
        return cleaned

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

    def _convert_messages_to_gemini_contents(self, messages: List[dict]) -> tuple:
        """转换消息格式为 Gemini 格式（支持多模态）"""
        contents = []
        system_instruction = None
        
        for m in messages:
            if m['role'] == 'system':
                system_instruction = {'parts': [{'text': m['content']}]}
            else:
                role = 'user' if m['role'] == 'user' else 'model'
                parts = []
                
                # 添加文本部分（如果有内容）
                if m.get('content'):
                    parts.append({'text': m['content']})
                
                # 添加媒体部分（如果存在）
                media_list = m.get('media', [])
                if media_list and isinstance(media_list, list):
                    for media_item in media_list:
                        if not isinstance(media_item, dict):
                            continue
                        
                        # 获取媒体数据
                        media_data = media_item.get('data') or media_item.get('url', '')
                        mime_type = media_item.get('mimeType') or media_item.get('mime_type', 'image/jpeg')
                        
                        # 处理 base64 数据
                        if isinstance(media_data, str):
                            if media_data.startswith('data:'):
                                # 移除 data:image/jpeg;base64, 前缀
                                if ';base64,' in media_data:
                                    media_data = media_data.split(';base64,', 1)[1]
                                elif ',' in media_data:
                                    media_data = media_data.split(',', 1)[1]
                            # 移除可能的换行符和空格
                            media_data = media_data.strip().replace('\n', '').replace('\r', '').replace(' ', '')
                        
                        if media_data and mime_type:
                            parts.append({
                                'inlineData': {
                                    'mimeType': mime_type,
                                    'data': media_data
                                }
                            })
                
                if parts:
                    contents.append({'role': role, 'parts': parts})
        
        return contents, system_instruction

    def _call_google_non_streaming(self, api_key: str, api_url: str, model: str, messages: List[dict], supports_image_generation: bool) -> str:
        """Google Gemini 非流式调用（使用官方 SDK，支持多模态和图片生成）"""
        try:
            from google import genai
            from google.genai import types
        except ImportError:
            print("[AgentActor] google-genai SDK not installed, falling back to REST API")
            return self._call_google_non_streaming_rest(api_key, api_url, model, messages, supports_image_generation)
        
        print(f"[AgentActor] Using google-genai SDK for model: {model}")
        
        try:
            # 初始化客户端
            client = genai.Client(api_key=api_key)
            
            # 转换消息格式为 SDK 格式
            contents = []
            system_instruction = None
            
            for m in messages:
                if m['role'] == 'system':
                    system_instruction = m.get('content', '')
                else:
                    role = 'user' if m['role'] == 'user' else 'model'
                    parts = []
                    
                    # 添加文本
                    if m.get('content'):
                        parts.append(types.Part.from_text(text=m['content']))
                    
                    # 添加媒体（图片等）
                    media_list = m.get('media', [])
                    if media_list and isinstance(media_list, list):
                        for media_item in media_list:
                            if not isinstance(media_item, dict):
                                continue
                            
                            media_data = media_item.get('data') or media_item.get('url', '')
                            mime_type = media_item.get('mimeType') or media_item.get('mime_type', 'image/jpeg')
                            
                            # 处理 base64 数据
                            if isinstance(media_data, str):
                                if media_data.startswith('data:'):
                                    if ';base64,' in media_data:
                                        media_data = media_data.split(';base64,', 1)[1]
                                    elif ',' in media_data:
                                        media_data = media_data.split(',', 1)[1]
                                media_data = media_data.strip().replace('\n', '').replace('\r', '').replace(' ', '')
                            
                            if media_data and mime_type:
                                import base64
                                try:
                                    image_bytes = base64.b64decode(media_data)
                                    parts.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
                                    print(f"[AgentActor] Added image part: {mime_type}, {len(image_bytes)} bytes")
                                except Exception as e:
                                    print(f"[AgentActor] Failed to decode image: {e}")
                    
                    if parts:
                        contents.append(types.Content(role=role, parts=parts))
            
            # 构建配置
            config = {}
            if system_instruction:
                config['system_instruction'] = system_instruction
            
            # 图片生成模型配置
            if supports_image_generation:
                config['response_modalities'] = ['TEXT', 'IMAGE']
                print(f"[AgentActor] Enabled response_modalities: ['TEXT', 'IMAGE']")
            
            print(f"[AgentActor] Calling Gemini SDK:")
            print(f"  Model: {model}")
            print(f"  Contents count: {len(contents)}")
            print(f"  Has system_instruction: {system_instruction is not None}")
            print(f"  Supports image generation: {supports_image_generation}")
            
            # 调用 API
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(**config) if config else None
            )
            
            # 解析响应
            result_text = ""
            media_items: List[Dict[str, Any]] = []
            if response.candidates:
                for candidate in response.candidates:
                    if candidate.content and candidate.content.parts:
                        for part in candidate.content.parts:
                            if hasattr(part, 'text') and part.text:
                                result_text += part.text
                            elif hasattr(part, 'inline_data') and part.inline_data:
                                mime_type = part.inline_data.mime_type or 'image/png'
                                print(f"[AgentActor] Received image in response: {mime_type}")
                                
                                # 将图片保存到媒体列表（用于 ext.media）
                                try:
                                    image_data = part.inline_data.data
                                    if isinstance(image_data, bytes):
                                        import base64
                                        image_base64 = base64.b64encode(image_data).decode('utf-8')
                                    else:
                                        image_base64 = image_data
                                    
                                    # 同步写入媒体列表（用于 ext.media，供媒体库/前端稳定渲染）
                                    media_items.append({
                                        'type': 'image',
                                        'mimeType': mime_type,
                                        'data': image_base64
                                    })
                                    print(f"[AgentActor] Image captured for ext.media ({len(image_base64)} chars)")
                                except Exception as img_err:
                                    print(f"[AgentActor] Failed to encode image: {img_err}")
                                    result_text += f"\n[图片生成失败: {str(img_err)}]"
            
            # 记录到本轮回复的 pending media（后处理写入 ext.media）
            if media_items:
                try:
                    existing = getattr(self, "_pending_reply_media", None)
                    if isinstance(existing, list) and existing:
                        self._pending_reply_media = existing + media_items
                    else:
                        self._pending_reply_media = media_items
                except Exception:
                    self._pending_reply_media = media_items

            print(f"[AgentActor] Gemini SDK response length: {len(result_text)}")
            return result_text
            
        except Exception as e:
            print(f"[AgentActor] Gemini SDK error: {e}")
            import traceback
            traceback.print_exc()
            raise RuntimeError(f"Google API error: {str(e)}")
    
    def _call_google_non_streaming_rest(self, api_key: str, api_url: str, model: str, messages: List[dict], supports_image_generation: bool) -> str:
        """Google Gemini 非流式调用（REST API 回退方案）"""
        # 构建非流式 URL
        url = api_url or f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        if api_key and 'key=' not in url:
            url += f"?key={api_key}" if '?' not in url else f"&key={api_key}"
        
        # 转换消息格式
        contents, system_instruction = self._convert_messages_to_gemini_contents(messages)
        
        # 构建请求负载
        payload = {'contents': contents}
        if system_instruction:
            payload['system_instruction'] = system_instruction
        
        # 图片生成模型配置
        if supports_image_generation:
            payload['generationConfig'] = {
                'responseModalities': ['TEXT', 'IMAGE']
            }
        
        print(f"[AgentActor] Calling Gemini REST API: {url.split('?')[0]}...")
        
        response = requests.post(url, json=payload, timeout=120)
        
        if response.status_code != 200:
            error_text = ""
            try:
                error_data = response.json()
                error_text = error_data.get('error', {}).get('message', '') or response.text
            except:
                error_text = response.text or f"HTTP {response.status_code}"
            raise RuntimeError(f"Google API error: {error_text}")
        
        # 解析响应
        data = response.json()
        candidates = data.get('candidates', [])
        if not candidates:
            return ""
        
        result_text = ""
        media_items: List[Dict[str, Any]] = []
        for candidate in candidates:
            parts = candidate.get('content', {}).get('parts', [])
            for part in parts:
                if 'text' in part:
                    result_text += part['text']
                elif 'inlineData' in part:
                    mime_type = part['inlineData'].get('mimeType', 'image/png')
                    image_base64 = part['inlineData'].get('data', '')
                    
                    if image_base64:
                        media_items.append({
                            'type': 'image',
                            'mimeType': mime_type,
                            'data': image_base64
                        })
                        print(f"[AgentActor] REST API: Image captured for ext.media ({len(image_base64)} chars)")
                    else:
                        result_text += f"\n[图片生成失败: 数据为空]"
        
        # 记录到本轮回复的 pending media（后处理写入 ext.media）
        if media_items:
            try:
                existing = getattr(self, "_pending_reply_media", None)
                if isinstance(existing, list) and existing:
                    self._pending_reply_media = existing + media_items
                else:
                    self._pending_reply_media = media_items
            except Exception:
                self._pending_reply_media = media_items
        
        return result_text

    def _stream_google(self, api_key: str, api_url: str, model: str, messages: List[dict]):
        """Google Gemini 流式调用"""
        # 检查是否是图片生成模型
        supports_image_generation = 'image' in model.lower()
        
        # 图片生成模型不支持流式 API，使用非流式
        if supports_image_generation:
            print(f"[AgentActor] Image generation model {model} requires non-streaming API")
            content = self._call_google_non_streaming(api_key, api_url, model, messages, supports_image_generation)
            if content:
                yield content
            return
        
        # Gemini 流式 URL
        url = api_url or f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse&key={api_key}"
        if api_key and 'key=' not in url:
            url += f"?key={api_key}" if '?' not in url else f"&key={api_key}"
        
        # 转换消息格式（支持多模态）
        contents, system_instruction = self._convert_messages_to_gemini_contents(messages)
        
        payload = {'contents': contents}
        if system_instruction:
            payload['system_instruction'] = system_instruction
        
        response = requests.post(url, json=payload, stream=True, timeout=120)
        
        if response.status_code != 200:
            # 尝试获取错误信息
            error_text = ""
            error_details = {}
            try:
                # 对于流式响应，需要从流中读取内容
                # 先尝试读取前几行来获取错误信息
                error_lines = []
                for i, line in enumerate(response.iter_lines()):
                    if i >= 10:  # 只读取前10行
                        break
                    if line:
                        try:
                            decoded_line = line.decode('utf-8')
                            error_lines.append(decoded_line)
                            # 如果是 JSON 格式的错误
                            if decoded_line.startswith('data: '):
                                data_str = decoded_line[6:]
                                try:
                                    error_data = json.loads(data_str)
                                    if 'error' in error_data:
                                        error_details = error_data.get('error', {})
                                        error_text = error_details.get('message', '') or str(error_data)
                                        break
                                except json.JSONDecodeError:
                                    pass
                        except:
                            pass
                
                # 如果还没找到错误信息，尝试直接读取响应文本
                if not error_text:
                    try:
                        # 对于非流式错误响应，可以直接读取
                        response.raw.decode_content = True
                        error_text = response.text
                        if error_text:
                            try:
                                error_data = json.loads(error_text)
                                error_details = error_data.get('error', {})
                                error_text = error_details.get('message', '') or error_text
                            except:
                                pass
                    except Exception as e:
                        # 如果读取失败，使用收集到的行
                        if error_lines:
                            error_text = '\n'.join(error_lines)
            except Exception as e:
                print(f"[AgentActor] Failed to read error response: {e}")
            
            # 构建详细的错误信息
            error_msg = f"HTTP {response.status_code}"
            if error_text:
                error_msg += f": {error_text}"
            else:
                error_msg += f" ({response.reason or 'Unknown error'})"
            
            # 添加请求上下文信息
            print(f"[AgentActor] Google API error response:")
            print(f"  Status: {response.status_code} {response.reason}")
            print(f"  URL: {url.split('?')[0]}...")  # 隐藏 API key
            print(f"  Model: {model}")
            print(f"  Error: {error_text or 'No error message'}")
            if error_details:
                print(f"  Error details: {json.dumps(error_details, indent=2)}")
            
            raise RuntimeError(f"Google API error: {error_msg}")
        
        # 处理流式响应
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data = line[6:]
                    try:
                        chunk = json.loads(data)
                        
                        # 检查是否有错误
                        if 'error' in chunk:
                            error_info = chunk.get('error', {})
                            error_msg = error_info.get('message', '') or str(error_info)
                            print(f"[AgentActor] Google API error in stream: {error_msg}")
                            raise RuntimeError(f"Google API error in stream: {error_msg}")
                        
                        candidates = chunk.get('candidates', [])
                        if candidates:
                            # 检查候选是否有错误
                            candidate = candidates[0]
                            if 'finishReason' in candidate:
                                finish_reason = candidate.get('finishReason')
                                # 某些 finishReason 表示错误
                                if finish_reason in ['SAFETY', 'RECITATION', 'OTHER']:
                                    safety_ratings = candidate.get('safetyRatings', [])
                                    if safety_ratings:
                                        blocked = [r for r in safety_ratings if r.get('blocked', False)]
                                        if blocked:
                                            error_msg = f"Content blocked by safety filters: {finish_reason}"
                                            print(f"[AgentActor] {error_msg}")
                                            raise RuntimeError(f"Google API error: {error_msg}")
                            
                            parts = candidate.get('content', {}).get('parts', [])
                            for part in parts:
                                text = part.get('text', '')
                                if text:
                                    yield text
                    except json.JSONDecodeError:
                        continue
                    except RuntimeError:
                        # 重新抛出 RuntimeError（API 错误）
                        raise
                    except Exception as e:
                        # 其他错误，记录但继续处理
                        print(f"[AgentActor] Error processing stream chunk: {e}")
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
                        'messages_rolled_back',
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
