"""
Actor 基类

定义 Agent Actor 的完整生命周期和核心方法：
- 生命周期：激活、启动、停止
- 记忆管理：预算检查、自动摘要
- 消息处理：迭代式处理（ReAct 模式）
- 能力调用：MCP、Skill、Tool
- 消息同步：统一出口

子类需要实现：
- _should_respond(): 决策是否响应
"""

from __future__ import annotations

import json
import logging
import queue
import re
import threading
import time
import traceback
import uuid
from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, Generator, List, Optional, TYPE_CHECKING

from database import get_mysql_connection, get_redis_client
from token_counter import estimate_messages_tokens, get_model_max_tokens

if TYPE_CHECKING:
    from services.llm_service import LLMService

from .actor_state import ActorState
from .iteration_context import IterationContext, DecisionContext, MessageType, ProcessPhase, LLMDecision
from .actions import Action, ActionResult, ResponseDecision
from .capability_registry import CapabilityRegistry

logger = logging.getLogger(__name__)


class ActorBase(ABC):
    """
    Actor 基类
    
    定义 Agent 的完整生命周期，子类可重写钩子方法实现差异化行为。
    """
    
    # ========== 类配置 ==========
    DEFAULT_HISTORY_LIMIT = 100
    DEFAULT_MAX_ITERATIONS = 10
    DEFAULT_MCP_TIMEOUT_MS = 60000
    MEMORY_BUDGET_THRESHOLD = 0.8
    
    def __init__(self, agent_id: str):
        """
        初始化 Actor
        
        Args:
            agent_id: Agent ID
        """
        self.agent_id = agent_id
        self.topic_id: Optional[str] = None
        
        # 状态管理
        self.state = ActorState()
        
        # 能力注册
        self.capabilities = CapabilityRegistry()
        
        # 消息邮箱
        self.mailbox: queue.Queue = queue.Queue()
        
        # 运行状态
        self.is_running = False
        self._thread: Optional[threading.Thread] = None
        self._active_channels: set = set()
        
        # Redis
        self._redis_client = get_redis_client()
        
        # Agent 配置（从 DB 加载）
        self._config: Dict[str, Any] = {}
        self.info: Dict[str, Any] = {}
        
        # 多模态后处理缓存
        self._pending_reply_media: Optional[List[Dict[str, Any]]] = None
        
        logger.info(f"[ActorBase:{agent_id}] Initialized")
    
    # ========== 生命周期 ==========
    
    def activate(
        self,
        topic_id: str,
        trigger_message: Dict[str, Any] = None,
        history_limit: int = None,
    ):
        """
        激活 Agent
        
        加载配置、历史消息、注册 Pub/Sub，启动工作线程。
        如果已激活，仅处理新消息，不重复初始化。
        
        Args:
            topic_id: 话题 ID
            trigger_message: 触发消息（如果提供，激活后立即处理）
            history_limit: 历史消息加载数量限制
        """
        # 检查是否已激活在同一 topic
        already_active = self.is_running and self.topic_id == topic_id
        
        if not already_active:
            self.topic_id = topic_id
            
            # 1. 加载配置
            self._load_config()
            
            # 2. 加载能力（MCP/Skill/Tool）
            self._load_capabilities()
            
            # 3. 加载历史消息
            limit = history_limit or self.DEFAULT_HISTORY_LIMIT
            self.state.load_history(topic_id, limit=limit)
            
            # 4. 订阅 Pub/Sub
            self._subscribe_pubsub(topic_id)
            
            # 5. 启动工作线程
            self._start_worker_thread()
            
            logger.info(f"[ActorBase:{self.agent_id}] Activated on topic {topic_id}, loaded {len(self.state.history)} history messages")
        else:
            # 已激活，只需刷新历史（获取最新消息）
            logger.debug(f"[ActorBase:{self.agent_id}] Already active on topic {topic_id}, refreshing history")
            limit = history_limit or self.DEFAULT_HISTORY_LIMIT
            self.state.load_history(topic_id, limit=limit)
        
        # 如果有触发消息，立即处理
        if trigger_message:
            self.mailbox.put({
                'type': 'new_message',
                'topic_id': topic_id,
                'data': trigger_message,
            })
    
    def _load_config(self):
        """加载 Agent 配置（从数据库）"""
        conn = get_mysql_connection()
        if not conn:
            logger.warning(f"[ActorBase:{self.agent_id}] No database connection")
            return
        
        try:
            import pymysql
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
                # 解析 ext 字段
                ext = row.get('ext')
                if ext and isinstance(ext, str):
                    try:
                        row['ext'] = json.loads(ext)
                    except Exception:
                        row['ext'] = {}
                elif not ext:
                    row['ext'] = {}
                
                self.info = row
                self._config = {
                    'model': row.get('config_model'),
                    'provider': row.get('provider'),
                    'api_url': row.get('api_url'),
                    'api_key': row.get('api_key'),
                    'llm_config_id': row.get('llm_config_id'),
                    'system_prompt': row.get('system_prompt'),
                    'name': row.get('name'),
                    'avatar': row.get('avatar'),
                    'ext': row.get('ext'),
                }
                logger.info(
                    f"[ActorBase:{self.agent_id}] Config loaded: {row.get('name')} "
                    f"(LLM: {row.get('llm_config_id')}, Provider: {row.get('provider')})"
                )
            else:
                logger.warning(f"[ActorBase:{self.agent_id}] No agent info found")
        except Exception as e:
            logger.error(f"[ActorBase:{self.agent_id}] Error loading config: {e}")
            if conn:
                conn.close()
    
    def _load_capabilities(self):
        """加载能力（MCP/Skill/Tool）"""
        # 从 Agent 配置加载
        ext = self._config.get('ext') or {}
        
        # 加载 MCP
        mcp_servers = ext.get('mcp_servers', [])
        if mcp_servers:
            self.capabilities.load_from_agent_config({'mcp_servers': mcp_servers})
        
        # 加载 Skill Packs
        self._load_skill_packs()
        
        # 注册内置工具
        self._register_builtin_tools()
    
    def _load_skill_packs(self):
        """加载 Agent 的技能包"""
        conn = get_mysql_connection()
        if not conn:
            return
        
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
            
            for sp in skill_packs:
                # 解析 process_steps
                steps = []
                try:
                    ps = sp.get('process_steps')
                    if isinstance(ps, str):
                        steps = json.loads(ps)
                    elif isinstance(ps, list):
                        steps = ps
                except Exception:
                    pass
                
                self.capabilities.register_skill(
                    skill_id=sp.get('skill_pack_id'),
                    name=sp.get('name', ''),
                    description=sp.get('summary', ''),
                    steps=steps,
                )
            
            if skill_packs:
                logger.info(f"[ActorBase:{self.agent_id}] Loaded {len(skill_packs)} skill packs")
        except Exception as e:
            logger.error(f"[ActorBase:{self.agent_id}] Error loading skill packs: {e}")
            if conn:
                conn.close()
    
    def _register_builtin_tools(self):
        """注册内置工具（子类可重写扩展）"""
        pass
    
    def _subscribe_pubsub(self, topic_id: str):
        """订阅 Topic 的 Redis Pub/Sub"""
        channel = f"topic:{topic_id}"
        if channel in self._active_channels:
            return
        
        self._active_channels.add(channel)
        
        # 通过 Manager 订阅
        from .actor_manager import ActorManager
        ActorManager.get_instance().subscribe_for_agent(self, channel)
        
        logger.info(f"[ActorBase:{self.agent_id}] Subscribed to {channel}")
    
    def _start_worker_thread(self):
        """启动工作线程"""
        if self.is_running:
            return
        
        self.is_running = True
        self._thread = threading.Thread(
            target=self._run,
            name=f"ActorBase-{self.agent_id}",
        )
        self._thread.daemon = True
        self._thread.start()
        logger.info(f"[ActorBase:{self.agent_id}] Worker thread started")
    
    def stop(self):
        """停止 Actor"""
        self.is_running = False
        logger.info(f"[ActorBase:{self.agent_id}] Stopped")
    
    def _run(self):
        """Actor 主循环 - 顺序处理 mailbox 中的消息"""
        while self.is_running:
            try:
                try:
                    event = self.mailbox.get(timeout=1.0)
                except queue.Empty:
                    continue
                
                event_type = event.get('type')
                topic_id = event.get('topic_id') or self.topic_id
                
                if event_type == 'new_message':
                    self._handle_new_message(topic_id, event.get('data', {}))
                elif event_type == 'messages_rolled_back':
                    self._handle_rollback_event(topic_id, event.get('data', {}))
                elif event_type == 'topic_participants_updated':
                    self._handle_participants_updated(topic_id, event.get('data', {}))
                
                self.mailbox.task_done()
            except Exception as e:
                logger.error(f"[ActorBase:{self.agent_id}] Loop error: {e}")
                traceback.print_exc()
    
    def on_event(self, topic_id: str, event: Dict[str, Any]):
        """接收来自 Topic 的事件，放入 mailbox 队列"""
        event['topic_id'] = topic_id
        self.mailbox.put(event)
    
    # ========== 记忆管理 ==========
    
    def _check_memory_budget(self) -> bool:
        """
        检查记忆是否超过模型上下文的阈值
        
        Returns:
            True 表示超过预算，需要摘要
        """
        model = self._config.get('model')
        if not model:
            return False
        
        return self.state.check_memory_budget(model, self.MEMORY_BUDGET_THRESHOLD)
    
    def _summarize_memory(self):
        """
        记忆总结
        
        当历史消息累计接近上下文阈值时，自动生成摘要并替换旧消息。
        """
        llm_config_id = self._config.get('llm_config_id')
        if not llm_config_id:
            return
        
        from services.llm_service import get_llm_service
        
        llm_service = get_llm_service()
        llm_cfg = llm_service.get_config(llm_config_id, include_api_key=False) or {}
        model = llm_cfg.get('model') or 'gpt-4'
        
        history = self.state.history
        if not isinstance(history, list) or len(history) < 20:
            return
        
        # 保留最后 24 条原文，其余进摘要
        keep_tail = 24
        older = history[:-keep_tail]
        if len(older) < 12:
            return
        
        # 构建摘要输入
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
                content = content[:1200] + '…'
            lines.append(f"{role}: {content}")
            last_id = m.get('message_id') or last_id
        
        if not lines:
            return
        
        system = (
            "你是一个对话摘要器。请把以下对话浓缩成可供后续继续对话的「记忆摘要」。\n"
            "要求：\n"
            "- 保留关键事实、用户偏好、已做决定、待办事项等。\n"
            "- 去掉寒暄与重复。\n"
            "- 输出中文，控制在 400~800 字。\n"
            "- 只输出摘要正文，不要标题。"
        )
        user = "\n".join(lines)
        
        try:
            resp = llm_service.chat_completion(
                config_id=llm_config_id,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                stream=False,
            )
            summary = (resp.get('content') or '').strip()
            if summary:
                self.state.summary = summary
                self.state.summary_until = last_id
                logger.info(f"[ActorBase:{self.agent_id}] Memory summarized ({len(summary)} chars)")
        except Exception as e:
            logger.error(f"[ActorBase:{self.agent_id}] Summarize failed: {e}")
    
    # ========== 消息处理（迭代器模式）==========
    
    # 是否启用新的处理流程（默认关闭，子类可覆盖）
    USE_NEW_PROCESS_FLOW = False
    
    def _handle_new_message(self, topic_id: str, msg_data: Dict[str, Any]):
        """
        处理新消息
        
        支持两种处理流程：
        1. 旧流程（默认）：迭代器模式，兼容现有逻辑
        2. 新流程：基于事件的处理流程，更细粒度的步骤控制
        
        通过 USE_NEW_PROCESS_FLOW 类属性或 ext.use_new_flow 控制
        """
        message_id = msg_data.get('message_id')
        sender_id = msg_data.get('sender_id')
        content = msg_data.get('content', '')
        ext = msg_data.get('ext', {}) or {}
        
        # 1. 去重检查
        if self.state.is_processed(message_id):
            logger.debug(f"[ActorBase:{self.agent_id}] Skipping duplicate: {message_id}")
            return
        
        # 2. 记录到历史
        self.state.append_history(msg_data)
        
        # 3. 自己的消息不处理
        if sender_id == self.agent_id:
            return
        
        logger.info(f"[ActorBase:{self.agent_id}] Received: {content[:50]}...")
        
        # 4. 检查记忆预算
        if self._check_memory_budget():
            self._summarize_memory()
        
        # 5. 决策是否响应
        decision = self._should_respond(topic_id, msg_data)
        
        if decision.action == 'silent':
            self._handle_silent_decision(topic_id, msg_data, decision)
            return
        
        if decision.action == 'delegate':
            self._handle_delegate_decision(topic_id, msg_data, decision)
            return
        
        # 6. 选择处理流程
        use_new_flow = ext.get('use_new_flow', self.USE_NEW_PROCESS_FLOW)
        
        if use_new_flow:
            # 使用新的处理流程
            self.process_message_v2(topic_id, msg_data, decision)
        else:
            # 使用旧的迭代器模式
            self.process_message(topic_id, msg_data, decision)
    
    def process_message(
        self,
        topic_id: str,
        msg_data: Dict[str, Any],
        decision: ResponseDecision = None,
    ):
        """
        消息处理主流程（迭代器模式）
        
        Args:
            topic_id: 话题 ID
            msg_data: 消息数据
            decision: 响应决策（可选）
        """
        message_id = msg_data.get('message_id')
        reply_message_id = f"msg_{uuid.uuid4().hex[:8]}"
        
        # 创建迭代上下文
        ctx = IterationContext(max_iterations=self.DEFAULT_MAX_ITERATIONS)
        ctx.original_message = msg_data
        ctx.topic_id = topic_id
        ctx.reply_message_id = reply_message_id

        # 获取话题类型，用于决定是否使用用户选择的模型
        from services.topic_service import get_topic_service
        topic = get_topic_service().get_topic(topic_id)
        session_type = topic.get('session_type') if topic else None
        
        # 提取用户选择的模型信息
        # 重要：仅在 agent 私聊模式下允许用户覆盖模型
        # topic_general 话题群中，每个Agent应使用自己的默认模型
        ext = msg_data.get('ext', {}) or {}
        
        if session_type == 'agent':
            # 私聊模式：允许用户选择模型覆盖Agent默认
            if ext.get('user_llm_config_id'):
                ctx.user_selected_llm_config_id = ext['user_llm_config_id']
                print(f"[ActorBase:{self.agent_id}] 私聊模式，用户选择了LLM配置ID: {ctx.user_selected_llm_config_id}")
            elif msg_data.get('model'):
                ctx.user_selected_model = msg_data['model']
                print(f"[ActorBase:{self.agent_id}] 私聊模式，用户选择了模型: {ctx.user_selected_model}")
        else:
            # topic_general 或其他模式：使用Agent自己的默认模型
            agent_default_model = self._config.get('llm_config_id')
            print(f"[ActorBase:{self.agent_id}] 话题群模式，使用Agent默认模型: {agent_default_model}")
        
        # 添加激活步骤
        ctx.add_step(
            'agent_activated',
            thinking='开始处理消息...',
            agent_id=self.agent_id,
            agent_name=self.info.get('name', 'Agent'),
        )
        ctx.update_last_step(status='completed')
        
        # 通知前端：开始处理
        self._sync_message('agent_thinking', '', ext={
            'message_id': reply_message_id,
            'processSteps': ctx.to_process_steps_dict(),
            'in_reply_to': message_id,
        })
        
        try:
            # 迭代处理
            while not ctx.is_complete and ctx.iteration < ctx.max_iterations:
                ctx.iteration += 1
                
                # 执行单轮迭代
                self._iterate(ctx)
                
                # 检查打断
                if self._check_interruption(ctx):
                    ctx.mark_interrupted()
                    break
            
            # 生成最终回复
            self._generate_final_response(ctx)
            
        except Exception as e:
            logger.error(f"[ActorBase:{self.agent_id}] Process error: {e}")
            traceback.print_exc()
            ctx.mark_error(str(e))
            self._handle_process_error(ctx, e)
    
    def _iterate(self, ctx: IterationContext):
        """
        单轮迭代 - 思考→规划→执行→观察
        
        Args:
            ctx: 迭代上下文
        """
        # 1. 规划下一步行动
        actions = self._plan_actions(ctx)
        ctx.planned_actions = actions
        
        if not actions:
            # 没有行动需要执行，直接生成回复
            ctx.mark_complete()
            return
        
        # 2. 发送阶段消息
        ctx.add_step(
            'thinking',
            thinking=f'规划了 {len(actions)} 个行动...',
        )
        ctx.update_last_step(status='completed')
        
        # 3. 执行第一个行动
        action = actions[0]
        result = self._execute_action(action, ctx)
        ctx.executed_results.append(result)
        
        # 4. 观察结果，决定是否继续
        ctx.is_complete = not self._should_continue(ctx)
    
    def process_message_v2(
        self,
        topic_id: str,
        msg_data: Dict[str, Any],
        decision: ResponseDecision = None,
    ):
        """
        消息处理主流程 V2（新版本）
        
        基于事件驱动的处理流程，更细粒度的步骤控制：
        1. loadLLMAndTool - 加载 LLM 配置和 MCP 工具
        2. prepareContextMessage - 准备上下文消息
        3. msgtypeclassify - 消息类型分类
        4. msg_pre_deal - 消息预处理
        5. msg_deal - 消息处理（LLM 调用）
        6. post_msg_deal - 消息后处理
        
        Args:
            topic_id: 话题 ID
            msg_data: 消息数据
            decision: 响应决策（可选）
        """
        message_id = msg_data.get('message_id')
        reply_message_id = f"msg_{uuid.uuid4().hex[:8]}"

        # 创建迭代上下文
        ctx = IterationContext(max_iterations=self.DEFAULT_MAX_ITERATIONS)
        ctx.original_message = msg_data
        ctx.topic_id = topic_id
        ctx.reply_message_id = reply_message_id

        # 设置步骤变更回调（自动通知前端并记录日志）
        ctx.set_step_callback(self._on_step_change, self.agent_id)

        # 获取话题类型，用于决定是否使用用户选择的模型
        from services.topic_service import get_topic_service
        topic = get_topic_service().get_topic(topic_id)
        session_type = topic.get('session_type') if topic else None
        
        # 提取用户选择的模型信息
        # 重要：仅在 agent 私聊模式下允许用户覆盖模型
        # topic_general 话题群中，每个Agent应使用自己的默认模型
        ext = msg_data.get('ext', {}) or {}
        
        if session_type == 'agent':
            # 私聊模式：允许用户选择模型覆盖Agent默认
            if ext.get('user_llm_config_id'):
                ctx.user_selected_llm_config_id = ext['user_llm_config_id']
                logger.info(f"[ActorBase:{self.agent_id}] 私聊模式(V2)，用户选择了LLM配置ID: {ctx.user_selected_llm_config_id}")
            elif msg_data.get('model'):
                ctx.user_selected_model = msg_data['model']
                logger.info(f"[ActorBase:{self.agent_id}] 私聊模式(V2)，用户选择了模型: {ctx.user_selected_model}")
        else:
            # topic_general 或其他模式：使用Agent自己的默认模型
            agent_default_model = self._config.get('llm_config_id')
            logger.info(f"[ActorBase:{self.agent_id}] 话题群模式(V2)，使用Agent默认模型: {agent_default_model}")
        
        # 添加激活步骤
        ctx.add_step(
            'agent_activated',
            thinking='开始处理消息（V2流程）...',
            agent_id=self.agent_id,
            agent_name=self.info.get('name', 'Agent'),
        )
        ctx.update_last_step(status='completed')
        
        # 通知前端：开始处理
        self._sync_message('agent_thinking', '', ext={
            'message_id': reply_message_id,
            'processSteps': ctx.to_process_steps_dict(),
            'in_reply_to': message_id,
            'process_version': 'v2',
        })
        
        try:
            # 步骤 1: 加载 LLM 配置和 MCP 工具
            ctx.add_step('load_llm_tool', thinking='加载 LLM 配置和工具...')
            if not self._load_llm_and_tools(ctx):
                ctx.update_last_step(status='error', error='加载配置失败')
                raise RuntimeError("Failed to load LLM and tools")
            ctx.update_last_step(status='completed')
            
            # 步骤 2: 准备上下文消息
            ctx.add_step('prepare_context', thinking='准备上下文消息...')
            if not self._prepare_context_message(ctx):
                ctx.update_last_step(status='error', error='准备上下文失败')
                raise RuntimeError("Failed to prepare context message")
            ctx.update_last_step(status='completed')
            
            # 步骤 3: 消息类型分类
            ctx.add_step('msg_classify', thinking='分析消息类型...')
            msg_type = self._classify_msg_type(ctx)
            ctx.update_last_step(status='completed', msg_type=msg_type)
            
            # 步骤 4: 消息预处理
            ctx.add_step('msg_pre_deal', thinking='消息预处理...')
            if not self._msg_pre_deal(ctx):
                # 如果返回 False，可能是跳过处理（如自己的 agent_msg）
                ctx.update_last_step(status='completed', action='skipped')
                logger.info(f"[ActorBase:{self.agent_id}] Message pre-deal returned False, skipping")
                return
            ctx.update_last_step(status='completed')
            
            # 步骤 5: 消息处理（LLM 调用）
            ctx.add_step('msg_deal', thinking='处理消息...')
            if not self._msg_deal(ctx):
                ctx.update_last_step(status='error', error='消息处理失败')
                raise RuntimeError("Failed to deal with message")
            ctx.update_last_step(status='completed', decision=ctx.llm_decision)
            
            # 步骤 6: 消息后处理
            ctx.add_step('post_msg_deal', thinking='后处理...')
            if not self._post_msg_deal(ctx):
                ctx.update_last_step(status='error', error='后处理失败')
                raise RuntimeError("Failed to post-deal message")
            ctx.update_last_step(status='completed')
            
            # 如果决策是继续（工具调用），且有下一个工具调用
            # 这里不需要递归，因为工具调用消息会通过 topic 再次触发 _handle_new_message
            if ctx.should_continue and ctx.next_tool_call:
                logger.info(f"[ActorBase:{self.agent_id}] Tool call triggered, waiting for next message")
            else:
                # 发送完成事件（包含 media，用于前端显示 thoughtSignature 状态）
                from services.topic_service import get_topic_service
                
                # 获取 media 数据（来自 ext_data）
                ext_data = ctx.build_ext_data()
                media_data = ext_data.get('media') if ext_data else None
                
                get_topic_service()._publish_event(topic_id, 'agent_stream_done', {
                    'agent_id': self.agent_id,
                    'agent_name': self.info.get('name', 'Agent'),
                    'agent_avatar': self.info.get('avatar'),
                    'message_id': reply_message_id,
                    'content': ctx.final_content,
                    'processSteps': ctx.to_process_steps_dict(),
                    'process_version': 'v2',
                    'media': media_data,  # 包含 thoughtSignature
                })
                
                # 追加到本地历史
                self.state.append_history({
                    'message_id': reply_message_id,
                    'role': 'assistant',
                    'content': ctx.final_content,
                    'created_at': time.time(),
                    'sender_id': self.agent_id,
                    'sender_type': 'agent',
                })
            
            logger.info(f"[ActorBase:{self.agent_id}] Message processed successfully (V2)")
            
        except Exception as e:
            logger.error(f"[ActorBase:{self.agent_id}] Process error (V2): {e}")
            traceback.print_exc()
            ctx.mark_error(str(e))
            self._handle_process_error(ctx, e)
    
    # ========== 可重写的钩子方法 ==========
    
    @abstractmethod
    def _should_respond(self, topic_id: str, msg_data: Dict[str, Any]) -> ResponseDecision:
        """
        决策是否响应 - 子类必须实现
        
        Args:
            topic_id: 话题 ID
            msg_data: 消息数据
            
        Returns:
            响应决策
        """
        pass
    
    def _plan_actions(self, ctx: IterationContext) -> List[Action]:
        """
        规划行动 - 默认用 LLM 决策，子类可重写
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            行动列表
        """
        # 默认实现：不规划额外行动，直接用 LLM 生成回复
        return []
    
    def _execute_action(self, action: Action, ctx: IterationContext) -> ActionResult:
        """
        执行行动 - 根据类型分发
        
        Args:
            action: 行动定义
            ctx: 迭代上下文
            
        Returns:
            行动结果
        """
        start_time = time.time()
        
        try:
            if action.type == 'mcp':
                return self._call_mcp(action, ctx)
            elif action.type == 'skill':
                return self._call_skill(action, ctx)
            elif action.type == 'tool':
                return self._call_tool(action, ctx)
            elif action.type == 'llm':
                return self._call_llm(action, ctx)
            else:
                return ActionResult.error_result(
                    action_type=action.type,
                    error=f"Unknown action type: {action.type}",
                    action=action,
                )
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            return ActionResult.error_result(
                action_type=action.type,
                error=str(e),
                duration_ms=duration_ms,
                action=action,
            )
    
    def _should_continue(self, ctx: IterationContext) -> bool:
        """
        是否继续迭代 - 默认实现
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            True 表示继续
        """
        # 默认：执行完所有规划的行动后结束
        if ctx.has_pending_actions():
            return True
        
        # 检查最后一个结果是否需要继续
        if ctx.executed_results:
            last_result = ctx.executed_results[-1]
            if not last_result.success:
                # 失败了，不继续
                return False
        
        return False

    def _find_llm_config_for_model(self, model_name: str, fallback_config_id: str) -> str:
        """
        根据模型名称找到对应的LLM配置ID

        Args:
            model_name: 模型名称（如"gpt-4", "claude-3"）
            fallback_config_id: 后备配置ID

        Returns:
            LLM配置ID
        """
        try:
            from database import get_mysql_connection
            conn = get_mysql_connection()
            if not conn:
                return fallback_config_id

            import pymysql
            cursor = conn.cursor(pymysql.cursors.DictCursor)

            # 查找匹配的LLM配置
            cursor.execute(
                "SELECT config_id FROM llm_configs WHERE model = %s AND enabled = 1 LIMIT 1",
                (model_name,)
            )
            result = cursor.fetchone()
            cursor.close()
            conn.close()

            if result:
                return result['config_id']
            else:
                print(f"{YELLOW}[MCP DEBUG] 未找到模型 '{model_name}' 对应的配置，使用后备配置{RESET}")
                return fallback_config_id

        except Exception as e:
            print(f"{RED}[MCP DEBUG] 查找模型配置失败: {e}，使用后备配置{RESET}")
            return fallback_config_id

    def _check_interruption(self, ctx: IterationContext) -> bool:
        """
        检查是否被打断
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            True 表示被打断
        """
        # 检查 mailbox 是否有新消息（打断信号）
        # 这里简单实现，子类可重写
        return False
    
    # ========== 消息处理流程（新增）==========
    
    def _load_llm_and_tools(self, ctx: IterationContext) -> bool:
        """
        加载 LLM 配置和 MCP 工具列表
        
        根据请求参数确定可用的模型配置，从MCP池中加载工具列表。
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            True 表示加载成功，False 表示失败
        """
        from services.topic_service import get_topic_service, ProcessEventPhase
        from services.llm_service import get_llm_service
        
        ctx.set_phase(ProcessPhase.LOAD_LLM_TOOL, 'running')
        
        # 发布处理事件
        self._publish_process_event(ctx, ProcessPhase.LOAD_LLM_TOOL, 'running')
        
        try:
            # 1. 确定 LLM 配置
            ext = ctx.original_message.get('ext', {}) or {}
            session_llm_config_id = self._config.get('llm_config_id')
            
            # 优先级：ext.user_llm_config_id > ctx.user_selected_model > session默认
            final_llm_config_id = None
            
            if ctx.user_selected_llm_config_id and ctx.user_selected_llm_config_id != session_llm_config_id:
                final_llm_config_id = ctx.user_selected_llm_config_id
                logger.info(f"[ActorBase:{self.agent_id}] 使用用户选择的LLM配置ID: {final_llm_config_id}")
            elif ctx.user_selected_model:
                final_llm_config_id = self._find_llm_config_for_model(ctx.user_selected_model, session_llm_config_id)
                logger.info(f"[ActorBase:{self.agent_id}] 根据模型名称找到配置: {final_llm_config_id}")
            else:
                final_llm_config_id = session_llm_config_id
                logger.info(f"[ActorBase:{self.agent_id}] 使用Agent默认配置: {final_llm_config_id}")
            
            if not final_llm_config_id:
                error_msg = f"Agent {self.agent_id} 未配置默认LLM模型，且用户未选择模型"
                ctx.update_phase(status='error', error=error_msg)
                self._publish_process_event(ctx, ProcessPhase.LOAD_LLM_TOOL, 'error', {'error': error_msg})
                return False
            
            # 加载 LLM 配置详情
            llm_service = get_llm_service()
            llm_config = llm_service.get_config(final_llm_config_id, include_api_key=True) or {}
            ctx.set_llm_config(llm_config, final_llm_config_id)
            
            # 2. 加载 MCP 工具列表
            mcp_server_ids = []
            mcp_tools = []
            
            # 从消息 ext 中提取 MCP 服务器 ID
            if ext.get('mcp_servers'):
                mcp_server_ids = ext['mcp_servers']
            elif ext.get('selectedMcpServerIds'):
                mcp_server_ids = ext['selectedMcpServerIds']
            elif ext.get('selected_mcp_server_ids'):
                mcp_server_ids = ext['selected_mcp_server_ids']
            
            # 从 Agent 配置中加载默认的 MCP 服务器
            agent_ext = self._config.get('ext', {}) or {}
            if not mcp_server_ids and agent_ext.get('mcp_servers'):
                mcp_server_ids = agent_ext['mcp_servers']
            
            # 加载每个 MCP 服务器的工具列表
            for server_id in mcp_server_ids[:3]:  # 最多支持3个
                tools = self._get_mcp_tools_for_server(server_id)
                if tools:
                    mcp_tools.extend(tools)
            
            ctx.set_mcp_tools(mcp_tools, mcp_server_ids)
            
            ctx.update_phase(status='completed', llm_config_id=final_llm_config_id, mcp_server_count=len(mcp_server_ids), tool_count=len(mcp_tools))
            self._publish_process_event(ctx, ProcessPhase.LOAD_LLM_TOOL, 'completed', {
                'llm_config_id': final_llm_config_id,
                'llm_provider': llm_config.get('provider'),
                'llm_model': llm_config.get('model'),
                'mcp_server_ids': mcp_server_ids,
                'tool_count': len(mcp_tools),
            })
            
            logger.info(f"[ActorBase:{self.agent_id}] Loaded LLM config: {final_llm_config_id}, MCP tools: {len(mcp_tools)}")
            return True
            
        except Exception as e:
            error_msg = str(e)
            ctx.update_phase(status='error', error=error_msg)
            self._publish_process_event(ctx, ProcessPhase.LOAD_LLM_TOOL, 'error', {'error': error_msg})
            logger.error(f"[ActorBase:{self.agent_id}] Failed to load LLM and tools: {e}")
            return False
    
    def _get_mcp_tools_for_server(self, server_id: str) -> List[Dict[str, Any]]:
        """
        获取 MCP 服务器的工具列表（结构化数据）
        
        Args:
            server_id: MCP 服务器 ID
            
        Returns:
            工具列表，每个工具包含 name, description, parameters
        """
        try:
            from mcp_server.mcp_common_logic import get_mcp_tools_list, prepare_mcp_headers
            import pymysql
            
            conn = get_mysql_connection()
            if not conn:
                return []
            
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute(
                "SELECT url FROM mcp_servers WHERE server_id = %s AND enabled = 1",
                (server_id,)
            )
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if not row or not row.get('url'):
                return []
            
            server_url = row['url']
            
            base_headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
            }
            headers = prepare_mcp_headers(server_url, base_headers, base_headers)
            
            tools_response = get_mcp_tools_list(server_url, headers, use_cache=True)
            if not tools_response or 'result' not in tools_response:
                return []
            
            tools = tools_response['result'].get('tools', [])
            
            # 给每个工具添加 server_id 标识
            for tool in tools:
                tool['server_id'] = server_id
            
            return tools
            
        except Exception as e:
            logger.warning(f"[ActorBase:{self.agent_id}] Failed to get MCP tools for {server_id}: {e}")
            return []
    
    def _prepare_context_message(self, ctx: IterationContext) -> bool:
        """
        准备上下文消息
        
        检查token是否达到上限，如果达到则触发summary但保留最近5条消息。
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            True 表示准备成功
        """
        ctx.set_phase(ProcessPhase.PREPARE_CONTEXT, 'running')
        self._publish_process_event(ctx, ProcessPhase.PREPARE_CONTEXT, 'running')
        
        try:
            # 1. 获取模型配置
            llm_config = ctx.llm_config or {}
            model = llm_config.get('model') or self._config.get('model') or 'gpt-4'
            
            # 2. 获取模型的 token 上限
            max_tokens = get_model_max_tokens(model)
            token_threshold = int(max_tokens * self.MEMORY_BUDGET_THRESHOLD)
            
            # 3. 构建 system prompt
            system_prompt = self._build_system_prompt(ctx)
            
            # 4. 检查历史消息的 token 使用量
            history = self.state.history
            history_msgs = []
            
            if history:
                # 计算 system prompt 的 token
                system_tokens = estimate_messages_tokens([{"role": "system", "content": system_prompt}], model)
                
                # 预留空间
                available_tokens = token_threshold - system_tokens - 1000  # 预留 1000 给回复
                
                # 如果需要 summary，保留最近 5 条消息
                keep_recent = 5
                
                if len(history) > keep_recent:
                    # 估算所有历史消息的 token
                    all_history_tokens = estimate_messages_tokens(history, model)
                    
                    if all_history_tokens > available_tokens:
                        # 需要 summary
                        logger.info(f"[ActorBase:{self.agent_id}] Token budget exceeded, triggering summary")
                        
                        # 调用 summary（保留最近 5 条）
                        self._summarize_memory_with_keep(keep_recent)
                        
                        # 使用 summary + 最近消息
                        if self.state.summary:
                            history_msgs.append({
                                "role": "system",
                                "content": f"【对话摘要】\n{self.state.summary}",
                            })
                        
                        # 添加最近的消息
                        recent_msgs = self.state.get_recent_history(
                            max_messages=keep_recent,
                            max_total_chars=8000,
                            max_per_message_chars=2400,
                            include_summary=False,
                        )
                        history_msgs.extend(recent_msgs)
                    else:
                        # 不需要 summary，直接使用历史
                        history_msgs = self.state.get_recent_history(
                            max_messages=10,
                            max_total_chars=8000,
                            max_per_message_chars=2400,
                            include_summary=True,
                        )
                else:
                    # 历史消息少，直接使用
                    history_msgs = list(history)
            
            ctx.set_context(system_prompt, history_msgs)
            
            ctx.update_phase(status='completed', history_count=len(history_msgs), has_summary=bool(self.state.summary))
            self._publish_process_event(ctx, ProcessPhase.PREPARE_CONTEXT, 'completed', {
                'history_count': len(history_msgs),
                'has_summary': bool(self.state.summary),
                'model': model,
            })
            
            logger.info(f"[ActorBase:{self.agent_id}] Prepared context: {len(history_msgs)} history messages")
            return True
            
        except Exception as e:
            error_msg = str(e)
            ctx.update_phase(status='error', error=error_msg)
            self._publish_process_event(ctx, ProcessPhase.PREPARE_CONTEXT, 'error', {'error': error_msg})
            logger.error(f"[ActorBase:{self.agent_id}] Failed to prepare context: {e}")
            return False
    
    def _summarize_memory_with_keep(self, keep_recent: int = 5):
        """
        记忆总结，保留最近 N 条消息
        
        Args:
            keep_recent: 保留的最近消息数量
        """
        llm_config_id = self._config.get('llm_config_id')
        if not llm_config_id:
            return
        
        from services.llm_service import get_llm_service
        
        llm_service = get_llm_service()
        llm_cfg = llm_service.get_config(llm_config_id, include_api_key=False) or {}
        model = llm_cfg.get('model') or 'gpt-4'
        
        history = self.state.history
        if not isinstance(history, list) or len(history) <= keep_recent:
            return
        
        # 保留最后 N 条原文，其余进摘要
        older = history[:-keep_recent]
        if len(older) < 5:  # 至少需要 5 条才进行摘要
            return
        
        # 构建摘要输入
        lines = []
        last_id = None
        for m in older[-80:]:  # 最多处理 80 条
            if not isinstance(m, dict):
                continue
            role = m.get('role')
            content = (m.get('content') or '').strip()
            if role not in ('user', 'assistant') or not content:
                continue
            if len(content) > 1200:
                content = content[:1200] + '…'
            lines.append(f"{role}: {content}")
            last_id = m.get('message_id') or last_id
        
        if not lines:
            return
        
        system = (
            "你是一个对话摘要器。请把以下对话浓缩成可供后续继续对话的「记忆摘要」。\n"
            "要求：\n"
            "- 保留关键事实、用户偏好、已做决定、待办事项等。\n"
            "- 去掉寒暄与重复。\n"
            "- 输出中文，控制在 400~800 字。\n"
            "- 只输出摘要正文，不要标题。"
        )
        user = "\n".join(lines)
        
        try:
            resp = llm_service.chat_completion(
                config_id=llm_config_id,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                stream=False,
            )
            summary = (resp.get('content') or '').strip()
            if summary:
                self.state.summary = summary
                self.state.summary_until = last_id
                logger.info(f"[ActorBase:{self.agent_id}] Memory summarized with keep_recent={keep_recent} ({len(summary)} chars)")
        except Exception as e:
            logger.error(f"[ActorBase:{self.agent_id}] Summarize with keep failed: {e}")
    
    def _classify_msg_type(self, ctx: IterationContext) -> str:
        """
        消息类型分类
        
        根据消息特征分类为：
        - agent_msg: Agent 链式追加消息
        - agent_toolcall_msg: Agent 工具调用请求
        - user_new_msg: 用户新消息
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            消息类型
        """
        ctx.set_phase(ProcessPhase.MSG_TYPE_CLASSIFY, 'running')
        self._publish_process_event(ctx, ProcessPhase.MSG_TYPE_CLASSIFY, 'running')
        
        msg_data = ctx.original_message or {}
        sender_type = msg_data.get('sender_type', '')
        ext = msg_data.get('ext', {}) or {}
        
        msg_type = MessageType.USER_NEW_MSG  # 默认
        
        # 1. 检查是否是 Agent 消息
        if sender_type == 'agent':
            # 检查是否是链式追加
            if ext.get('chain_append') or ext.get('auto_trigger'):
                msg_type = MessageType.AGENT_MSG
            # 检查是否是工具调用请求
            elif ext.get('tool_call'):
                tool_call = ext['tool_call']
                if isinstance(tool_call, dict) and tool_call.get('tool_name'):
                    msg_type = MessageType.AGENT_TOOLCALL_MSG
        
        # 2. 检查系统消息中的工具调用标记
        elif sender_type == 'system':
            if ext.get('mcp_error') and ext.get('auto_trigger'):
                msg_type = MessageType.AGENT_MSG  # 错误触发的自处理消息
        
        ctx.set_msg_type(msg_type)
        
        ctx.update_phase(status='completed', msg_type=msg_type)
        self._publish_process_event(ctx, ProcessPhase.MSG_TYPE_CLASSIFY, 'completed', {
            'msg_type': msg_type,
            'sender_type': sender_type,
        })
        
        logger.info(f"[ActorBase:{self.agent_id}] Message classified as: {msg_type}")
        return msg_type
    
    def _msg_pre_deal(self, ctx: IterationContext) -> bool:
        """
        消息预处理
        
        - agent_msg from self: 跳过
        - agent_toolcall_msg: 执行 MCP 调用，等待结果
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            True 表示继续处理，False 表示跳过
        """
        ctx.set_phase(ProcessPhase.MSG_PRE_DEAL, 'running')
        self._publish_process_event(ctx, ProcessPhase.MSG_PRE_DEAL, 'running')
        
        msg_data = ctx.original_message or {}
        sender_id = msg_data.get('sender_id', '')
        msg_type = ctx.msg_type
        
        try:
            # 1. agent_msg from self: 跳过
            if msg_type == MessageType.AGENT_MSG and sender_id == self.agent_id:
                ctx.update_phase(status='completed', action='skip', reason='self_message')
                self._publish_process_event(ctx, ProcessPhase.MSG_PRE_DEAL, 'completed', {
                    'action': 'skip',
                    'reason': 'self_message',
                })
                logger.debug(f"[ActorBase:{self.agent_id}] Skipping self agent message")
                return False
            
            # 2. agent_toolcall_msg: 执行 MCP 调用
            if msg_type == MessageType.AGENT_TOOLCALL_MSG:
                ext = msg_data.get('ext', {}) or {}
                tool_call = ext.get('tool_call', {})
                
                server_id = tool_call.get('server_id') or tool_call.get('mcp_server_id')
                tool_name = tool_call.get('tool_name')
                params = tool_call.get('params', {})
                
                if server_id and tool_name:
                    # 创建 MCP 调用 Action
                    action = Action.mcp(
                        server_id=server_id,
                        tool_name=tool_name,
                        params=params,
                    )
                    
                    # 执行 MCP 调用
                    result = self._call_mcp(action, ctx)
                    
                    # 将结果存储为 result_msg
                    result_msg = {
                        'role': 'tool',
                        'content': result.text_result or '',
                        'tool_name': tool_name,
                        'server_id': server_id,
                        'success': result.success,
                        'error': result.error,
                    }
                    ctx.set_result_msg(result_msg)
                    
                    # 更新消息类型为结果消息
                    ctx.set_msg_type(MessageType.RESULT_MSG)
                    
                    ctx.update_phase(status='completed', action='mcp_call', tool_name=tool_name, success=result.success)
                    self._publish_process_event(ctx, ProcessPhase.MSG_PRE_DEAL, 'completed', {
                        'action': 'mcp_call',
                        'tool_name': tool_name,
                        'server_id': server_id,
                        'success': result.success,
                    })
                    
                    logger.info(f"[ActorBase:{self.agent_id}] MCP call completed: {tool_name}, success={result.success}")
                else:
                    ctx.update_phase(status='error', error='Invalid tool_call parameters')
                    self._publish_process_event(ctx, ProcessPhase.MSG_PRE_DEAL, 'error', {
                        'error': 'Invalid tool_call parameters',
                    })
                    return False
            else:
                # 其他消息类型，正常继续
                ctx.update_phase(status='completed', action='pass')
                self._publish_process_event(ctx, ProcessPhase.MSG_PRE_DEAL, 'completed', {
                    'action': 'pass',
                })
            
            return True
            
        except Exception as e:
            error_msg = str(e)
            ctx.update_phase(status='error', error=error_msg)
            self._publish_process_event(ctx, ProcessPhase.MSG_PRE_DEAL, 'error', {'error': error_msg})
            logger.error(f"[ActorBase:{self.agent_id}] Message pre-deal failed: {e}")
            return False
    
    def _msg_deal(self, ctx: IterationContext) -> bool:
        """
        消息处理
        
        调用 LLM 处理消息，LLM 决策是继续处理还是处理完毕。
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            True 表示处理成功
        """
        ctx.set_phase(ProcessPhase.MSG_DEAL, 'running')
        self._publish_process_event(ctx, ProcessPhase.MSG_DEAL, 'running')
        
        try:
            # 1. 构建 LLM 输入
            llm_input = self._build_llm_input_for_msg_deal(ctx)
            
            # 2. 调用 LLM 处理
            from services.llm_service import get_llm_service
            
            llm_service = get_llm_service()
            llm_config_id = ctx.llm_config_id or self._config.get('llm_config_id')
            
            if not llm_config_id:
                error_msg = "No LLM config available"
                ctx.update_phase(status='error', error=error_msg)
                self._publish_process_event(ctx, ProcessPhase.MSG_DEAL, 'error', {'error': error_msg})
                return False
            
            # 非流式调用，获取决策
            resp = llm_service.chat_completion(
                config_id=llm_config_id,
                messages=llm_input,
                stream=False,
            )
            
            content = (resp.get('content') or '').strip()
            
            # 3. 解析 LLM 决策
            decision, decision_data = self._parse_llm_decision(content, ctx)
            ctx.set_llm_decision(decision, decision_data)
            
            ctx.update_phase(status='completed', decision=decision)
            self._publish_process_event(ctx, ProcessPhase.MSG_DEAL, 'completed', {
                'decision': decision,
                'has_tool_call': bool(ctx.next_tool_call),
            })
            
            logger.info(f"[ActorBase:{self.agent_id}] LLM decision: {decision}")
            return True
            
        except Exception as e:
            error_msg = str(e)
            ctx.update_phase(status='error', error=error_msg)
            self._publish_process_event(ctx, ProcessPhase.MSG_DEAL, 'error', {'error': error_msg})
            logger.error(f"[ActorBase:{self.agent_id}] Message deal failed: {e}")
            return False
    
    def _build_llm_input_for_msg_deal(self, ctx: IterationContext) -> List[Dict[str, Any]]:
        """
        构建 LLM 输入消息（用于 msg_deal）
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            LLM 消息列表
        """
        messages = []
        
        # 1. System prompt
        system_prompt = ctx.system_prompt or self._build_system_prompt(ctx)
        
        # 添加处理能力说明
        system_prompt += """

【消息处理说明】
你正在处理用户或系统的消息。根据消息类型，你需要决定：
1. 如果需要调用工具来完成任务，返回工具调用请求（JSON格式）
2. 如果可以直接回答，返回最终回复

【可处理的消息类型】
- user_new_msg: 用户新消息
- agent_msg: Agent 链式追加消息
- result_msg: 工具调用结果消息

【工具调用格式】
如果需要调用工具，请返回以下 JSON 格式：
```json
{
  "action": "tool_call",
  "tool": {
    "server_id": "mcp_server_id",
    "tool_name": "tool_name",
    "params": {}
  }
}
```

【直接回复格式】
如果可以直接回答，返回以下 JSON 格式：
```json
{
  "action": "complete",
  "content": "你的回复内容"
}
```
"""
        
        messages.append({"role": "system", "content": system_prompt})
        
        # 2. 历史消息
        if ctx.history_messages:
            messages.extend(ctx.history_messages)
        
        # 3. 工具结果（如果有）
        if ctx.tool_results_text:
            messages.append({
                "role": "assistant",
                "content": f"【工具执行结果】\n{ctx.tool_results_text}"
            })
        
        # 4. 当前消息
        msg_data = ctx.original_message or {}
        user_content = msg_data.get('content', '')
        msg_type = ctx.msg_type or MessageType.USER_NEW_MSG
        
        # 构建带消息类型标记的内容
        typed_content = f"【消息类型: {msg_type}】\n{user_content}"
        
        # 如果有结果消息，附加到内容
        if ctx.result_msg:
            result_content = ctx.result_msg.get('content', '')
            if result_content:
                typed_content += f"\n\n【工具返回结果】\n{result_content}"
        
        messages.append({"role": "user", "content": typed_content})
        
        return messages
    
    def _parse_llm_decision(self, content: str, ctx: IterationContext) -> tuple:
        """
        解析 LLM 决策
        
        Args:
            content: LLM 返回的内容
            ctx: 迭代上下文
            
        Returns:
            (decision, decision_data) 元组
        """
        decision = LLMDecision.COMPLETE
        decision_data = {'content': content}
        
        # 尝试解析 JSON
        try:
            # 查找 JSON 块
            json_match = re.search(r'```json\s*\n?(.*?)\n?```', content, re.DOTALL)
            if json_match:
                json_str = json_match.group(1).strip()
            else:
                # 尝试直接解析
                json_str = content.strip()
            
            data = json.loads(json_str)
            
            action = data.get('action', '').lower()
            
            if action == 'tool_call' and data.get('tool'):
                decision = LLMDecision.CONTINUE
                decision_data = {
                    'content': content,
                    'next_tool_call': data['tool'],
                }
            elif action == 'complete':
                decision = LLMDecision.COMPLETE
                decision_data = {
                    'content': data.get('content', content),
                }
            else:
                # 无法识别的格式，默认完成
                decision_data = {'content': content}
                
        except (json.JSONDecodeError, AttributeError):
            # 不是 JSON，使用原始内容作为回复
            decision_data = {'content': content}
        
        return decision, decision_data
    
    def _post_msg_deal(self, ctx: IterationContext) -> bool:
        """
        消息后处理
        
        解析消息和媒体，决定是否往 topic 中追加新消息。
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            True 表示处理成功
        """
        ctx.set_phase(ProcessPhase.POST_MSG_DEAL, 'running')
        self._publish_process_event(ctx, ProcessPhase.POST_MSG_DEAL, 'running')
        
        try:
            from services.topic_service import get_topic_service
            
            topic_id = ctx.topic_id or self.topic_id
            decision = ctx.llm_decision
            decision_data = ctx.llm_decision_data or {}
            
            # 1. 如果决策是继续（工具调用）
            if decision == LLMDecision.CONTINUE and ctx.next_tool_call:
                tool_call = ctx.next_tool_call
                
                # 发送工具调用消息到 topic
                get_topic_service().send_message(
                    topic_id=topic_id,
                    sender_id=self.agent_id,
                    sender_type='agent',
                    content=f"正在调用工具: {tool_call.get('tool_name', 'unknown')}",
                    role='assistant',
                    sender_name=self.info.get('name'),
                    sender_avatar=self.info.get('avatar'),
                    ext={
                        'tool_call': tool_call,
                        'auto_trigger': True,
                        'processSteps': ctx.to_process_steps_dict(),
                    }
                )
                
                ctx.update_phase(status='completed', action='tool_call_sent')
                self._publish_process_event(ctx, ProcessPhase.POST_MSG_DEAL, 'completed', {
                    'action': 'tool_call_sent',
                    'tool_name': tool_call.get('tool_name'),
                })
                
                logger.info(f"[ActorBase:{self.agent_id}] Tool call message sent")
            
            # 2. 如果决策是完成
            elif decision == LLMDecision.COMPLETE:
                content = decision_data.get('content', '')
                
                # 解析媒体
                media = []
                if ctx.mcp_media:
                    media.extend(ctx.mcp_media)
                if ctx.final_media:
                    media.extend(ctx.final_media)
                
                # 构建 ext
                ext_data = ctx.build_ext_data()
                if media:
                    ext_data['media'] = media
                
                # 发送最终回复
                get_topic_service().send_message(
                    topic_id=topic_id,
                    sender_id=self.agent_id,
                    sender_type='agent',
                    content=content,
                    role='assistant',
                    message_id=ctx.reply_message_id,
                    sender_name=self.info.get('name'),
                    sender_avatar=self.info.get('avatar'),
                    ext=ext_data,
                )
                
                ctx.mark_complete(content, media)
                
                ctx.update_phase(status='completed', action='reply_sent')
                self._publish_process_event(ctx, ProcessPhase.POST_MSG_DEAL, 'completed', {
                    'action': 'reply_sent',
                    'has_media': bool(media),
                })
                
                logger.info(f"[ActorBase:{self.agent_id}] Final reply sent")
            
            else:
                # 未知决策，标记完成
                ctx.update_phase(status='completed', action='unknown_decision')
                self._publish_process_event(ctx, ProcessPhase.POST_MSG_DEAL, 'completed', {
                    'action': 'unknown_decision',
                })
            
            return True
            
        except Exception as e:
            error_msg = str(e)
            ctx.update_phase(status='error', error=error_msg)
            self._publish_process_event(ctx, ProcessPhase.POST_MSG_DEAL, 'error', {'error': error_msg})
            logger.error(f"[ActorBase:{self.agent_id}] Post message deal failed: {e}")
            return False
    
    def _publish_process_event(
        self,
        ctx: IterationContext,
        phase: str,
        status: str,
        data: Dict[str, Any] = None,
    ):
        """
        发布处理流程事件
        
        Args:
            ctx: 迭代上下文
            phase: 处理阶段
            status: 状态
            data: 附加数据
        """
        try:
            from services.topic_service import get_topic_service
            
            topic_id = ctx.topic_id or self.topic_id
            if not topic_id:
                return
            
            get_topic_service().publish_process_event(
                topic_id=topic_id,
                phase=phase,
                agent_id=self.agent_id,
                status=status,
                data={
                    **(data or {}),
                    'event_data': ctx.to_event_data(),
                },
                agent_name=self.info.get('name'),
                agent_avatar=self.info.get('avatar'),
            )
        except Exception as e:
            logger.warning(f"[ActorBase:{self.agent_id}] Failed to publish process event: {e}")
    
    # ========== 能力调用 ==========
    
    def _call_mcp(self, action: Action, ctx: IterationContext) -> ActionResult:
        """
        调用 MCP
        
        Args:
            action: MCP 行动
            ctx: 迭代上下文
            
        Returns:
            行动结果
        """
        start_time = time.time()
        server_id = action.server_id
        
        # ANSI 颜色码
        CYAN = '\033[96m'
        GREEN = '\033[92m'
        YELLOW = '\033[93m'
        RED = '\033[91m'
        RESET = '\033[0m'
        BOLD = '\033[1m'
        
        print(f"{CYAN}{BOLD}[MCP DEBUG] ========== 开始 MCP 调用 =========={RESET}")
        print(f"{CYAN}[MCP DEBUG] Agent: {self.agent_id}, Server: {server_id}{RESET}")
        
        # 添加处理步骤（但不立即发送实时更新，以加速 MCP 过程）
        ctx.add_step(
            'mcp_call',
            thinking=f'调用 MCP {server_id}...',
            mcpServer=server_id,
            toolName=action.mcp_tool_name or 'auto',
        )
        
        # 不发送实时更新，等待 MCP 调用完成后再发送
        # 这样可以减少网络开销，加速 MCP 过程
        print(f"{GREEN}[MCP DEBUG] 开始 MCP 调用（已跳过实时更新以加速）{RESET}")
        
        try:
            from services.mcp_execution_service import execute_mcp_with_llm
            from mcp_server.mcp_common_logic import get_mcp_tools_list, prepare_mcp_headers
            
            # 优先使用用户选择的模型，其次使用session默认配置
            # 1. 优先使用 ext.user_llm_config_id（前端直接传递的配置ID）
            user_selected_llm_config_id = ctx.user_selected_llm_config_id
            # 2. 其次使用 user_selected_model（前端传递的模型名称，需要查找配置ID）
            user_selected_model = ctx.user_selected_model
            session_llm_config_id = self._config.get('llm_config_id')

            # 打印用户选择信息（只有当用户真正选择了时才显示）
            if user_selected_llm_config_id:
                print(f"{CYAN}[MCP DEBUG] 用户选择LLM配置ID: {user_selected_llm_config_id}{RESET}")
            if user_selected_model:
                print(f"{CYAN}[MCP DEBUG] 用户选择模型: {user_selected_model}{RESET}")
            
            print(f"{CYAN}[MCP DEBUG] Agent默认配置ID: {session_llm_config_id}{RESET}")
            
            # 查询并显示配置ID对应的模型信息
            if user_selected_llm_config_id or session_llm_config_id:
                config_id_to_check = user_selected_llm_config_id or session_llm_config_id
                try:
                    from database import get_mysql_connection
                    import pymysql
                    conn = get_mysql_connection()
                    if conn:
                        cursor = conn.cursor(pymysql.cursors.DictCursor)
                        cursor.execute("""
                            SELECT provider, model, name
                            FROM llm_configs
                            WHERE config_id = %s
                        """, (config_id_to_check,))
                        config_info = cursor.fetchone()
                        cursor.close()
                        conn.close()
                        if config_info:
                            print(f"{CYAN}[MCP DEBUG] 配置ID {config_id_to_check} 对应: Provider={config_info.get('provider')}, Model={config_info.get('model')}, Name={config_info.get('name')}{RESET}")
                        else:
                            print(f"{YELLOW}[MCP DEBUG] ⚠️ 配置ID {config_id_to_check} 在数据库中不存在{RESET}")
                except Exception as e:
                    print(f"{YELLOW}[MCP DEBUG] ⚠️ 查询配置信息失败: {e}{RESET}")

            # 确定最终使用的LLM配置
            # 优先级：用户选择的配置ID（且与默认不同） > 用户选择的模型 > Agent默认配置
            # 注意：如果 user_selected_llm_config_id 与 session_llm_config_id 相同，说明用户没有主动选择，使用默认配置
            if user_selected_llm_config_id and user_selected_llm_config_id != session_llm_config_id:
                # 用户直接选择了配置ID，且与默认配置不同，说明是主动选择
                final_llm_config_id = user_selected_llm_config_id
                print(f"{GREEN}[MCP DEBUG] ✅ 使用用户选择的LLM配置ID: {final_llm_config_id}{RESET}")
            elif user_selected_model:
                # 用户选择了特定模型，尝试找到对应的配置
                final_llm_config_id = self._find_llm_config_for_model(user_selected_model, session_llm_config_id)
                if final_llm_config_id != session_llm_config_id:
                    print(f"{GREEN}[MCP DEBUG] ✅ 找到用户选择模型的配置: {final_llm_config_id}{RESET}")
                else:
                    print(f"{YELLOW}[MCP DEBUG] ⚠️ 未找到用户选择模型的配置，使用Agent默认配置: {final_llm_config_id}{RESET}")
            else:
                # 用户没有选择模型，使用Agent的默认配置
                final_llm_config_id = session_llm_config_id
                if final_llm_config_id:
                    print(f"{CYAN}[MCP DEBUG] 使用Agent默认配置: {final_llm_config_id}{RESET}")
                else:
                    # Agent没有配置默认模型，返回错误
                    error_msg = f"Agent {self.agent_id} 未配置默认LLM模型，且用户未选择模型。请在Agent配置中设置默认LLM模型。"
                    print(f"{RED}[MCP DEBUG] ❌ {error_msg}{RESET}")
                    return ActionResult(
                        success=False,
                        error=error_msg,
                        thinking="无法执行MCP调用：缺少LLM配置",
                        process_steps=ctx.to_process_steps_dict(),
                    )

            user_content = ctx.original_message.get('content', '')

            print(f"{CYAN}[MCP DEBUG] User Content: {user_content[:100]}...{RESET}")
            
            # 1. 先获取 MCP 工具列表，构建工具描述
            print(f"{YELLOW}[MCP DEBUG] 获取工具列表...{RESET}")
            tools_desc = self._get_mcp_tools_description(server_id)
            print(f"{GREEN}[MCP DEBUG] 工具描述长度: {len(tools_desc) if tools_desc else 0} 字符{RESET}")
            
            # 2. 构建带历史上下文和工具描述的输入
            history_context = self._build_mcp_context(ctx)
            print(f"{CYAN}[MCP DEBUG] 历史上下文长度: {len(history_context) if history_context else 0} 字符{RESET}")
            
            input_parts = []
            if tools_desc:
                input_parts.append(f"【可用工具】\n{tools_desc}")
            if history_context:
                input_parts.append(f"【对话历史】\n{history_context}")
            input_parts.append(f"【当前请求】\n{user_content}")
            
            input_text = "\n\n".join(input_parts)
            
            print(f"{CYAN}[MCP DEBUG] 最终输入长度: {len(input_text)} 字符{RESET}")
            logger.info(f"[ActorBase:{self.agent_id}] MCP call with tools desc and context: {len(input_text)} chars")
            
            # 获取 Agent 的人设作为系统提示词
            agent_persona = self._config.get('system_prompt', '')
            print(f"{CYAN}[MCP DEBUG] Agent 人设长度: {len(agent_persona) if agent_persona else 0} 字符{RESET}")
            
            print(f"{YELLOW}[MCP DEBUG] 调用 execute_mcp_with_llm...{RESET}")
            result = execute_mcp_with_llm(
                mcp_server_id=server_id,
                input_text=input_text,
                llm_config_id=final_llm_config_id,
                agent_system_prompt=agent_persona,  # 传递 Agent 人设
                original_message=ctx.original_message,  # 传递原始消息（用于提取图片等上下文）
            )
            print(f"{GREEN}[MCP DEBUG] execute_mcp_with_llm 返回{RESET}")
            print(f"{CYAN}[MCP DEBUG] Result keys: {list(result.keys()) if result else 'None'}{RESET}")
            
            duration_ms = int((time.time() - start_time) * 1000)
            print(f"{CYAN}[MCP DEBUG] 耗时: {duration_ms}ms{RESET}")
            
            if result.get('error'):
                error_msg = result.get('error')
                print(f"{RED}[MCP DEBUG] ❌ 检测到错误: {error_msg}{RESET}")
                llm_resp = result.get("llm_response")
                if llm_resp:
                    preview = str(llm_resp).replace("\n", "\\n")[:600]
                    print(f"{YELLOW}[MCP DEBUG] LLM 原始输出预览: {preview}{RESET}")
                dbg = result.get("debug") or {}
                if isinstance(dbg, dict) and dbg.get("llm_parse_error"):
                    print(f"{YELLOW}[MCP DEBUG] JSON 解析失败原因: {dbg.get('llm_parse_error')}{RESET}")
                
                # 检查是否有详细的错误信息
                results_list = result.get('results', [])
                print(f"{YELLOW}[MCP DEBUG] Results 列表长度: {len(results_list)}{RESET}")
                
                error_details = []
                for r in results_list:
                    if r.get('error'):
                        error_type = r.get('error_type', 'unknown')
                        tool_name = r.get('tool', 'unknown')
                        print(f"{RED}[MCP DEBUG]   - 工具 {tool_name} 错误类型: {error_type}{RESET}")
                        if error_type == 'network':
                            error_details.append(f"[网络错误] {tool_name}: {r.get('error')}")
                        elif error_type == 'business':
                            error_details.append(f"[业务错误] {tool_name}: {r.get('error')}")
                        else:
                            error_details.append(f"[{error_type}] {tool_name}: {r.get('error')}")
                
                detailed_error = "\n".join(error_details) if error_details else error_msg
                print(f"{RED}[MCP DEBUG] 详细错误: {detailed_error}{RESET}")
                
                ctx.update_last_step(
                    status='error',
                    error=detailed_error,
                )
                
                # MCP 错误自动分析功能已禁用
                # 之前的逻辑：当 MCP 出错时，触发自处理：发送一个特殊的消息让 Agent 处理错误
                # 现在直接返回错误，不触发自动分析
                print(f"{YELLOW}[MCP DEBUG] ⚠️ MCP 调用失败，但未触发自动分析（功能已禁用）{RESET}")
                
                print(f"{RED}[MCP DEBUG] ========== MCP 调用失败 =========={RESET}")
                return ActionResult.error_result(
                    action_type='mcp',
                    error=detailed_error,
                    duration_ms=duration_ms,
                    action=action,
                )
            
            # 提取结果文本
            tool_text = result.get('tool_text', '')
            summary = result.get('summary', '')
            
            print(f"{GREEN}[MCP DEBUG] ✅ 无顶层错误{RESET}")
            print(f"{CYAN}[MCP DEBUG] Summary: {summary[:100] if summary else 'None'}...{RESET}")
            print(f"{CYAN}[MCP DEBUG] Tool text 长度: {len(tool_text) if tool_text else 0}{RESET}")
            
            # 检查是否有部分工具失败（但整体没报错）
            results_list = result.get('results', [])
            print(f"{CYAN}[MCP DEBUG] Results 数量: {len(results_list)}{RESET}")
            
            partial_errors = []
            for i, r in enumerate(results_list):
                tool_name = r.get('tool', 'unknown')
                if r.get('error'):
                    error_type = r.get('error_type', 'unknown')
                    partial_errors.append(f"{tool_name}({error_type}): {r.get('error')}")
                    print(f"{YELLOW}[MCP DEBUG]   [{i}] {tool_name}: ❌ 错误 - {r.get('error')[:50]}{RESET}")
                else:
                    print(f"{GREEN}[MCP DEBUG]   [{i}] {tool_name}: ✅ 成功{RESET}")
            
            if partial_errors:
                tool_text += f"\n\n⚠️ 部分工具执行失败:\n" + "\n".join(partial_errors)
                print(f"{YELLOW}[MCP DEBUG] 有 {len(partial_errors)} 个工具失败{RESET}")
            
            ctx.update_last_step(
                status='completed',
                result={'summary': summary, 'tool_text': tool_text[:500] if tool_text else ''},
            )
            
            # 提取 MCP 返回的媒体数据（图片等）
            mcp_media = result.get('media')
            if mcp_media and isinstance(mcp_media, list) and len(mcp_media) > 0:
                # 将 MCP 返回的媒体数据存储到 ctx 中，后续会合并到 ext.media
                if ctx.mcp_media is None:
                    ctx.mcp_media = []
                ctx.mcp_media.extend(mcp_media)
                print(f"{GREEN}[MCP DEBUG] ✅ 提取到 {len(mcp_media)} 个媒体文件{RESET}")
                for img in mcp_media:
                    img_type = img.get('type', 'unknown')
                    img_mime = img.get('mimeType', 'unknown')
                    img_size = len(str(img.get('data', '')))
                    print(f"{CYAN}[MCP DEBUG]   - {img_type} ({img_mime}), 大小: {img_size} 字符{RESET}")
            
            # 追加工具结果
            if tool_text:
                ctx.append_tool_result(f"MCP:{server_id}", tool_text)
            
            print(f"{GREEN}{BOLD}[MCP DEBUG] ========== MCP 调用成功 =========={RESET}")
            return ActionResult.success_result(
                action_type='mcp',
                data=result,
                text_result=tool_text,
                duration_ms=duration_ms,
                action=action,
            )
            
        except Exception as e:
            import traceback
            duration_ms = int((time.time() - start_time) * 1000)
            print(f"{RED}{BOLD}[MCP DEBUG] ❌❌❌ 异常: {str(e)}{RESET}")
            print(f"{RED}[MCP DEBUG] Traceback:{RESET}")
            traceback.print_exc()
            print(f"{RED}[MCP DEBUG] ========== MCP 调用异常 =========={RESET}")
            ctx.update_last_step(status='error', error=str(e))
            return ActionResult.error_result(
                action_type='mcp',
                error=str(e),
                duration_ms=duration_ms,
                action=action,
            )
    
    def _get_mcp_tools_description(self, server_id: str) -> str:
        """
        获取 MCP 服务器的工具列表描述
        
        Args:
            server_id: MCP 服务器 ID
            
        Returns:
            格式化的工具描述字符串
        """
        # ANSI 颜色码
        YELLOW = '\033[93m'
        GREEN = '\033[92m'
        CYAN = '\033[96m'
        RESET = '\033[0m'
        
        try:
            from mcp_server.mcp_common_logic import get_mcp_tools_list, prepare_mcp_headers
            from database import get_mysql_connection
            import pymysql
            
            # 获取 MCP 服务器 URL
            conn = get_mysql_connection()
            if not conn:
                return ""
            
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            cursor.execute(
                "SELECT url FROM mcp_servers WHERE server_id = %s AND enabled = 1",
                (server_id,)
            )
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if not row or not row.get('url'):
                return ""
            
            server_url = row['url']
            
            # 准备请求头
            base_headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
            }
            headers = prepare_mcp_headers(server_url, base_headers, base_headers)
            
            # 获取工具列表
            tools_response = get_mcp_tools_list(server_url, headers, use_cache=True)
            if not tools_response or 'result' not in tools_response:
                print(f"{YELLOW}[MCP DEBUG] ⚠️ 获取工具列表失败{RESET}")
                return ""
            
            tools = tools_response['result'].get('tools', [])
            if not tools:
                print(f"{YELLOW}[MCP DEBUG] ⚠️ 工具列表为空{RESET}")
                return ""
            
            print(f"{GREEN}[MCP DEBUG] 获取到 {len(tools)} 个工具{RESET}")
            
            # 格式化工具描述（包含完整信息）
            lines = []
            for i, t in enumerate(tools, 1):
                name = t.get('name', '')
                desc = t.get('description', '')
                if name:
                    # 打印每个工具
                    print(f"{CYAN}[MCP DEBUG]   {i}. {name}{RESET}")
                    lines.append(f"{i}. 【{name}】: {desc}" if desc else f"{i}. 【{name}】")
            
            return "\n".join(lines)
            
        except Exception as e:
            logger.warning(f"[ActorBase:{self.agent_id}] Failed to get MCP tools: {e}")
            return ""
    
    def _build_mcp_context(self, ctx: IterationContext, max_history: int = 8) -> str:
        """
        构建 MCP 调用的对话上下文
        
        让 MCP 执行服务能看到最近的对话历史，以便正确选择工具
        
        Args:
            ctx: 迭代上下文
            max_history: 最大历史消息数（默认8条）
            
        Returns:
            格式化的对话历史字符串
        """
        if not self.state.history:
            return ""
        
        # 取最近的历史消息（不包括当前消息）
        recent = self.state.history[-max_history:] if len(self.state.history) > max_history else self.state.history
        
        lines = []
        for msg in recent:
            role = msg.get('role', 'user')
            content = msg.get('content', '')
            if not content:
                continue
            
            # 截断过长的内容
            if len(content) > 500:
                content = content[:500] + '...'
            
            role_label = '用户' if role == 'user' else '助手'
            lines.append(f"{role_label}: {content}")
        
        if not lines:
            return ""
        
        return "\n".join(lines)
    
    def _call_skill(self, action: Action, ctx: IterationContext) -> ActionResult:
        """
        调用 Skill
        
        Args:
            action: Skill 行动
            ctx: 迭代上下文
            
        Returns:
            行动结果
        """
        start_time = time.time()
        skill_id = action.skill_id
        
        skill = self.capabilities.get_skill(skill_id)
        if not skill:
            return ActionResult.error_result(
                action_type='skill',
                error=f"Skill not found: {skill_id}",
                action=action,
            )
        
        ctx.add_step(
            'skill_call',
            thinking=f'执行 Skill {skill.name}...',
            skillId=skill_id,
        )
        
        try:
            # Skill 可能包含多个步骤
            if skill.execute_fn:
                result_data = skill.execute_fn(**action.params)
            else:
                # 如果没有执行函数，按步骤执行
                result_data = self._execute_skill_steps(skill, action, ctx)
            
            duration_ms = int((time.time() - start_time) * 1000)
            ctx.update_last_step(status='completed')
            
            return ActionResult.success_result(
                action_type='skill',
                data=result_data,
                duration_ms=duration_ms,
                action=action,
            )
            
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            ctx.update_last_step(status='error', error=str(e))
            return ActionResult.error_result(
                action_type='skill',
                error=str(e),
                duration_ms=duration_ms,
                action=action,
            )
    
    def _execute_skill_steps(
        self,
        skill,
        action: Action,
        ctx: IterationContext,
    ) -> Any:
        """执行 Skill 的步骤"""
        # 默认实现：顺序执行步骤
        results = []
        for step in skill.steps:
            step_type = step.get('type')
            if step_type == 'mcp_call':
                sub_action = Action.mcp(
                    server_id=step.get('mcpServer'),
                    tool_name=step.get('toolName'),
                    params=step.get('arguments', {}),
                )
                result = self._call_mcp(sub_action, ctx)
                results.append(result)
            # 可以扩展其他步骤类型
        return results
    
    def _call_tool(self, action: Action, ctx: IterationContext) -> ActionResult:
        """
        调用内置工具
        
        Args:
            action: Tool 行动
            ctx: 迭代上下文
            
        Returns:
            行动结果
        """
        start_time = time.time()
        tool_name = action.tool_name
        
        ctx.add_step(
            'tool_call',
            thinking=f'调用工具 {tool_name}...',
            toolName=tool_name,
        )
        
        try:
            result_data = self.capabilities.execute_tool(tool_name, **action.params)
            duration_ms = int((time.time() - start_time) * 1000)
            
            ctx.update_last_step(status='completed')
            
            # 转换为文本结果
            text_result = ''
            if isinstance(result_data, str):
                text_result = result_data
            elif isinstance(result_data, dict):
                text_result = json.dumps(result_data, ensure_ascii=False, indent=2)
            
            if text_result:
                ctx.append_tool_result(tool_name, text_result)
            
            return ActionResult.success_result(
                action_type='tool',
                data=result_data,
                text_result=text_result,
                duration_ms=duration_ms,
                action=action,
            )
            
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            ctx.update_last_step(status='error', error=str(e))
            return ActionResult.error_result(
                action_type='tool',
                error=str(e),
                duration_ms=duration_ms,
                action=action,
            )
    
    def _call_llm(self, action: Action, ctx: IterationContext) -> ActionResult:
        """
        调用 LLM
        
        Args:
            action: LLM 行动
            ctx: 迭代上下文
            
        Returns:
            行动结果
        """
        # LLM 调用通常在 _generate_final_response 中处理
        # 这里提供一个简单实现
        return ActionResult.success_result(
            action_type='llm',
            data={'pending': True},
            action=action,
        )

    # ========== 步骤变更处理 ==========

    def _on_step_change(self, ctx: IterationContext, step: Dict[str, Any]):
        """
        处理步骤变更事件

        Args:
            ctx: 迭代上下文
            step: 步骤信息
        """
        try:
            # 通知前端步骤变更
            self._sync_message('agent_thinking', '', ext={
                'message_id': ctx.reply_message_id,
                'processSteps': ctx.to_process_steps_dict(),
                'in_reply_to': ctx.original_message.get('message_id'),
                'process_version': 'v2',
                'step_update': step,  # 当前变更的步骤
            })
        except Exception as e:
            logger.warning(f"[ActorBase:{self.agent_id}] Failed to notify step change: {e}")

    # ========== 消息同步 ==========

    def _sync_message(
        self,
        msg_type: str,
        content: str,
        ext: Dict[str, Any] = None,
    ):
        """
        统一消息出口 - 规范化 + 发送到 Pub/Sub
        
        Args:
            msg_type: 消息类型
            content: 内容
            ext: 扩展数据
        """
        from services.topic_service import get_topic_service
        
        message = {
            'agent_id': self.agent_id,
            'agent_name': self.info.get('name', 'Agent'),
            'agent_avatar': self.info.get('avatar'),
            'status': msg_type,
            'timestamp': time.time(),
            **(ext or {}),
        }
        
        if content:
            message['content'] = content
        
        topic_id = ext.get('topic_id') or self.topic_id
        if topic_id:
            get_topic_service()._publish_event(topic_id, msg_type, message)
    
    def _generate_final_response(self, ctx: IterationContext):
        """
        生成最终回复
        
        Args:
            ctx: 迭代上下文
        """
        from services.llm_service import get_llm_service
        from services.topic_service import get_topic_service
        
        topic_id = ctx.topic_id or self.topic_id
        message_id = ctx.reply_message_id
        in_reply_to = ctx.original_message.get('message_id')
        
        # 构建 system prompt
        system_prompt = self._build_system_prompt(ctx)
        
        # 构建消息列表
        messages = self._build_llm_messages(ctx, system_prompt)
        
        logger.info(f"[ActorBase:{self.agent_id}] Final messages count: {len(messages)}, "
                    f"roles: {[m.get('role') for m in messages]}")
        
        # 确定使用的 LLM 配置（优先用户选择，其次 session 默认）
        session_llm_config_id = self._config.get('llm_config_id')
        
        # 优先使用用户选择的配置
        YELLOW = '\033[93m'
        GREEN = '\033[92m'
        CYAN = '\033[96m'
        RESET = '\033[0m'
        
        # 如果 user_selected_llm_config_id 与 session_llm_config_id 相同，说明用户没有主动选择，使用默认配置
        if ctx.user_selected_llm_config_id and ctx.user_selected_llm_config_id != session_llm_config_id:
            final_llm_config_id = ctx.user_selected_llm_config_id
            print(f"{GREEN}[ActorBase:{self.agent_id}] 生成回复：使用用户选择的LLM配置ID: {final_llm_config_id}{RESET}")
        elif ctx.user_selected_model:
            # 用户选择了模型名称，查找对应的配置ID
            final_llm_config_id = self._find_llm_config_for_model(ctx.user_selected_model, session_llm_config_id)
            if final_llm_config_id != session_llm_config_id:
                print(f"{GREEN}[ActorBase:{self.agent_id}] 生成回复：找到用户选择模型的配置: {final_llm_config_id}{RESET}")
            else:
                print(f"{YELLOW}[ActorBase:{self.agent_id}] 生成回复：未找到用户选择模型的配置，使用Session默认配置: {final_llm_config_id}{RESET}")
        else:
            # 用户没有选择模型，使用Agent的默认配置
            final_llm_config_id = session_llm_config_id
            if final_llm_config_id:
                print(f"{CYAN}[ActorBase:{self.agent_id}] 生成回复：使用Agent默认配置: {final_llm_config_id}{RESET}")
            else:
                # Agent没有配置默认模型，返回错误
                error_msg = f"Agent {self.agent_id} 未配置默认LLM模型，且用户未选择模型。请在Agent配置中设置默认LLM模型。"
                print(f"{RED}[ActorBase:{self.agent_id}] ❌ {error_msg}{RESET}")
                return ActionResult(
                    success=False,
                    error=error_msg,
                    thinking="无法生成回复：缺少LLM配置",
                    process_steps=ctx.to_process_steps_dict(),
                )
        
        # 添加 LLM 生成步骤
        llm_service = get_llm_service()
        config = llm_service.get_config(final_llm_config_id, include_api_key=True) or {}
        
        provider = config.get('provider', 'unknown')
        model = config.get('model', 'unknown')
        
        ctx.add_step(
            'llm_generating',
            thinking=f'使用 {provider}/{model} 生成回复...',
            llm_provider=provider,
            llm_model=model,
        )
        
        # 流式生成
        full_content = ""
        
        try:
            for chunk in self._stream_llm_response(messages, llm_config_id=final_llm_config_id, ctx=ctx):
                full_content += chunk

                # 发送流式 chunk
                get_topic_service()._publish_event(topic_id, 'agent_stream_chunk', {
                    'agent_id': self.agent_id,
                    'agent_name': self.info.get('name', 'Agent'),
                    'agent_avatar': self.info.get('avatar'),
                    'message_id': message_id,
                    'chunk': chunk,
                    'accumulated': full_content,
                    'processSteps': ctx.to_process_steps_dict(),
                })
            
            ctx.update_last_step(status='completed')
            ctx.final_content = full_content
            
            # 构建扩展数据
            ext_data = ctx.build_ext_data()
            ext_data['llmInfo'] = {
                'provider': provider,
                'model': model,
                'configId': final_llm_config_id,
            }
            
            # 处理多模态媒体
            if self._pending_reply_media:
                ext_data['media'] = self._normalize_media_for_ext(self._pending_reply_media)
                self._pending_reply_media = None
            
            # 保存消息
            get_topic_service().send_message(
                topic_id=topic_id,
                sender_id=self.agent_id,
                sender_type='agent',
                content=full_content,
                role='assistant',
                message_id=message_id,
                sender_name=self.info.get('name'),
                sender_avatar=self.info.get('avatar'),
                ext=ext_data,
            )
            
            # 追加到本地历史（确保 history 包含 LLM 输出）
            self.state.append_history({
                'message_id': message_id,
                'role': 'assistant',
                'content': full_content,
                'created_at': time.time(),
                'sender_id': self.agent_id,
                'sender_type': 'agent',
            })
            
            # 发送完成事件
            get_topic_service()._publish_event(topic_id, 'agent_stream_done', {
                'agent_id': self.agent_id,
                'agent_name': self.info.get('name', 'Agent'),
                'agent_avatar': self.info.get('avatar'),
                'message_id': message_id,
                'content': full_content,
                'processSteps': ctx.to_process_steps_dict(),
                'media': ext_data.get('media'),
            })
            
        except Exception as e:
            ctx.mark_error(str(e))
            raise
    
    def _get_topic_current_sop(self, topic_id: str) -> Optional[str]:
        """获取话题的当前SOP文本（仅对 topic_general 生效）"""
        try:
            from services.topic_service import get_topic_service
            topic = get_topic_service().get_topic(topic_id)
            if not topic or topic.get('session_type') != 'topic_general':
                return None
            
            ext = topic.get('ext', {}) or {}
            if isinstance(ext, str):
                try:
                    ext = json.loads(ext)
                except:
                    ext = {}
            
            sop_id = ext.get('currentSopSkillPackId')
            if not sop_id:
                return None
            
            # 从数据库获取SOP内容
            conn = get_mysql_connection()
            if not conn:
                return None
            
            try:
                import pymysql
                cursor = conn.cursor(pymysql.cursors.DictCursor)
                cursor.execute("""
                    SELECT name, summary FROM skill_packs WHERE skill_pack_id = %s
                """, (sop_id,))
                row = cursor.fetchone()
                cursor.close()
                conn.close()
                
                if row:
                    return f"【{row.get('name', 'SOP')}】\n{row.get('summary', '')}"
                return None
            except Exception as e:
                logger.error(f"[ActorBase:{self.agent_id}] Error loading SOP: {e}")
                if conn:
                    conn.close()
                return None
        except Exception as e:
            logger.error(f"[ActorBase:{self.agent_id}] Error getting topic SOP: {e}")
            return None

    def _build_system_prompt(self, ctx: IterationContext) -> str:
        """构建 system prompt"""
        system_prompt = self._config.get('system_prompt', '你是一个AI助手。')
        
        # 添加能力描述
        cap_desc = self.capabilities.get_capability_description()
        if cap_desc:
            system_prompt += f"\n\n{cap_desc}"
        
        # 注入话题级SOP（仅对 topic_general 生效）
        topic_id = ctx.topic_id or self.topic_id
        if topic_id:
            sop_text = self._get_topic_current_sop(topic_id)
            if sop_text:
                system_prompt += f"\n\n【当前话题SOP（标准作业流程）】\n请严格按照以下流程处理用户请求：\n{sop_text}"
                logger.info(f"[ActorBase:{self.agent_id}] Injected topic SOP into system prompt")
        
        # 添加历史消息利用提示
        history_count = len(self.state.history)
        if history_count > 0:
            system_prompt += f"\n\n[对话历史] 你与用户已有 {history_count} 条对话记录。请注意：\n"
            system_prompt += "1. 仔细阅读历史消息，理解对话的上下文和背景\n"
            system_prompt += "2. 用户可能引用之前的内容，请结合历史回答\n"
            system_prompt += "3. 历史中可能包含重要信息，请充分利用\n"
            system_prompt += "4. 保持对话的连贯性，避免重复已经提供过的信息"
        
        # 工具结果不再放入 system_prompt，而是作为对话消息注入
        # 只在 system_prompt 中添加简短提示
        if ctx.tool_results_text:
            system_prompt += (
                "\n\n【工具执行】工具已自动执行完毕，结果会在对话中提供。"
                "请仔细阅读工具执行结果，然后用自然语言直接回答用户。"
            )
        
        return system_prompt
    
    def _build_llm_messages(
        self,
        ctx: IterationContext,
        system_prompt: str,
    ) -> List[Dict[str, Any]]:
        """构建 LLM 消息列表"""
        messages = [{"role": "system", "content": system_prompt}]
        
        # 添加摘要
        if self.state.summary:
            messages.append({
                "role": "system",
                "content": "【对话摘要（自动生成）】\n" + self.state.summary,
            })
        
        # 添加历史
        logger.info(f"[ActorBase:{self.agent_id}] Building LLM messages, state.history has {len(self.state.history)} items")
        
        history_msgs = self.state.get_recent_history(
            max_messages=10,
            max_total_chars=8000,
            max_per_message_chars=2400,
            include_summary=False,  # 已经单独添加
        )
        
        logger.info(f"[ActorBase:{self.agent_id}] get_recent_history returned {len(history_msgs)} messages")
        
        # 处理历史消息中的媒体占位符（按需获取最近 N 条有媒体的消息）
        # 生图开关：用户可在前端选择是否“回灌历史生成图片（含 thoughtSignature）”
        # - 开启：用于图生图/基于上次修改继续（默认）
        # - 关闭：更适合“全新生图”，避免历史媒体干扰/触发 thoughtSignature 约束
        orig_ext = (ctx.original_message or {}).get('ext', {}) or {}
        use_thoughtsig = True
        try:
          use_thoughtsig = bool(((orig_ext.get('imageGen') or {}).get('useThoughtSignature', True)))
        except Exception:
          use_thoughtsig = True

        media_load_limit = 3 if use_thoughtsig else 0  # 最多为最近 3 条消息加载实际媒体；关闭则不加载
        media_loaded = 0
        if media_load_limit > 0:
            for msg in reversed(history_msgs):
                if msg.get('has_media') and msg.get('message_id') and media_loaded < media_load_limit:
                    media = self.state.get_media_by_message_id(msg['message_id'])
                    if media:
                        msg['media'] = media
                        media_loaded += 1
        
        messages.extend(history_msgs)
        
        # 如果有工具结果，作为助手消息注入（在用户消息之前）
        if ctx.tool_results_text:
            tool_result_msg = {
                "role": "assistant",
                "content": f"【工具执行结果】\n{ctx.tool_results_text}\n\n"
                           "我已经执行了上述工具调用。现在我将根据工具返回的结果来回答你的问题。",
            }
            messages.append(tool_result_msg)
        
        # 添加当前消息
        user_content = ctx.original_message.get('content', '')
        user_msg = {"role": "user", "content": user_content}
        
        # 处理媒体
        ext = ctx.original_message.get('ext', {}) or {}
        media = ext.get('media')
        if media:
            user_msg['media'] = media
        elif use_thoughtsig and self.state.should_attach_last_media(user_content):
            last_media = self.state.get_last_media()
            if last_media:
                user_msg['media'] = last_media
        
        messages.append(user_msg)
        
        return messages
    
    def _stream_llm_response(
        self,
        messages: List[Dict[str, Any]],
        llm_config_id: str = None,
        ctx: Optional['IterationContext'] = None,
    ) -> Generator[str, None, None]:
        """流式调用 LLM"""
        from services.providers import create_provider, LLMMessage
        from services.llm_service import get_llm_service

        # 如果指定了 llm_config_id，使用指定的配置；否则使用 session 默认配置
        if llm_config_id:
            llm_service = get_llm_service()
            config = llm_service.get_config(llm_config_id, include_api_key=True) or {}
            provider = config.get('provider')
            api_key = config.get('api_key')
            api_url = config.get('api_url')
            model = config.get('model')
        else:
            # 回退到 session 默认配置
            provider = self._config.get('provider')
            api_key = self._config.get('api_key')
            api_url = self._config.get('api_url')
            model = self._config.get('model')

        # 转换消息格式
        llm_messages = []
        for msg in messages:
            llm_messages.append(LLMMessage(
                role=msg.get('role', 'user'),
                content=msg.get('content', ''),
                media=msg.get('media'),
            ))

        # 创建 Provider
        llm_provider = create_provider(
            provider_type=provider,
            api_key=api_key,
            api_url=api_url,
            model=model,
        )

        # 流式调用
        stream = llm_provider.chat_stream(llm_messages)
        while True:
            try:
                chunk = next(stream)
                yield chunk
            except StopIteration as e:
                resp = getattr(e, "value", None)
                media = getattr(resp, "media", None) if resp else None
                if media:
                    self._pending_reply_media = media

                # 存储LLM响应元数据到上下文
                if ctx and resp:
                    ctx.set_llm_response_metadata(
                        usage=getattr(resp, "usage", None),
                        finish_reason=getattr(resp, "finish_reason", None),
                        raw_response=getattr(resp, "raw", None),
                    )
                break
    
    # ========== 消息操作 ==========
    
    def _handle_rollback(self, topic_id: str, target_message_id: str):
        """
        处理回退 - 真删除目标消息后的所有消息
        
        Args:
            topic_id: 话题 ID
            target_message_id: 目标消息 ID
        """
        from services.message_service import get_message_service
        
        self.state.clear_after(target_message_id)
        get_message_service().delete_after(topic_id, target_message_id)
        
        logger.info(f"[ActorBase:{self.agent_id}] Rolled back to {target_message_id}")
    
    def _handle_edit_resend(
        self,
        topic_id: str,
        target_message_id: str,
        new_content: str,
    ):
        """
        处理编辑重发
        
        Args:
            topic_id: 话题 ID
            target_message_id: 目标消息 ID
            new_content: 新内容
        """
        # 找到目标消息的前一条
        prev_id = None
        for i, m in enumerate(self.state.history):
            if m.get('message_id') == target_message_id and i > 0:
                prev_id = self.state.history[i - 1].get('message_id')
                break
        
        if prev_id:
            self._handle_rollback(topic_id, prev_id)
        
        # 处理新消息
        new_msg = {
            'message_id': f"msg_{uuid.uuid4().hex[:8]}",
            'content': new_content,
            'role': 'user',
            'created_at': int(time.time() * 1000),
        }
        self.process_message(topic_id, new_msg)
    
    def _handle_rollback_event(self, topic_id: str, data: Dict[str, Any]):
        """处理回退事件"""
        to_message_id = data.get('to_message_id') or data.get('message_id')
        if to_message_id:
            self.state.clear_after(to_message_id)
        
        # 如果摘要失效，清除
        if self.state.summary_until:
            history_ids = {m.get('message_id') for m in self.state.history}
            if self.state.summary_until not in history_ids:
                self.state.summary = None
                self.state.summary_until = None
    
    def _handle_participants_updated(self, topic_id: str, data: Dict[str, Any]):
        """处理参与者更新事件"""
        participants = data.get('participants', [])
        self.state.update_participants(participants)
    
    def _handle_silent_decision(
        self,
        topic_id: str,
        msg_data: Dict[str, Any],
        decision: ResponseDecision,
    ):
        """处理沉默决策"""
        from services.topic_service import get_topic_service
        
        get_topic_service()._publish_event(topic_id, 'agent_silent', {
            'agent_id': self.agent_id,
            'agent_name': self.info.get('name', 'Agent'),
            'agent_avatar': self.info.get('avatar'),
            'in_reply_to': msg_data.get('message_id'),
            'reason': decision.reason,
            'timestamp': time.time(),
        })
    
    def _handle_delegate_decision(
        self,
        topic_id: str,
        msg_data: Dict[str, Any],
        decision: ResponseDecision,
    ):
        """处理委托决策"""
        from services.topic_service import get_topic_service
        
        target_id = decision.delegate_to
        user_text = msg_data.get('content', '').strip()
        
        content = f"@{target_id} 我认为这个问题更适合你处理：{user_text}"
        
        get_topic_service().send_message(
            topic_id=topic_id,
            sender_id=self.agent_id,
            sender_type='agent',
            content=content,
            role='assistant',
            mentions=[target_id],
            ext={'delegated_to': target_id},
            sender_name=self.info.get('name'),
            sender_avatar=self.info.get('avatar'),
        )
        
        # 追加到本地历史
        self.state.append_history({
            'message_id': None,  # 委派消息没有预设 ID
            'role': 'assistant',
            'content': content,
            'created_at': time.time(),
            'sender_id': self.agent_id,
            'sender_type': 'agent',
        })
    
    def _handle_process_error(self, ctx: IterationContext, error: Exception):
        """处理处理错误"""
        from services.topic_service import get_topic_service
        
        topic_id = ctx.topic_id or self.topic_id
        message_id = ctx.reply_message_id
        
        # 发送错误事件
        get_topic_service()._publish_event(topic_id, 'agent_stream_done', {
            'agent_id': self.agent_id,
            'agent_name': self.info.get('name', 'Agent'),
            'agent_avatar': self.info.get('avatar'),
            'message_id': message_id,
            'content': '',
            'processSteps': ctx.to_process_steps_dict(),
            'error': str(error),
        })
        
        # 保存错误消息
        error_content = f"[错误] {self.info.get('name', 'Agent')} 无法产生回复: {str(error)}"
        get_topic_service().send_message(
            topic_id=topic_id,
            sender_id=self.agent_id,
            sender_type='agent',
            content=error_content,
            role='assistant',
            message_id=message_id,
            sender_name=self.info.get('name'),
            sender_avatar=self.info.get('avatar'),
            ext={'processSteps': ctx.to_process_steps_dict(), 'error': str(error)},
        )
        
        # 追加到本地历史
        self.state.append_history({
            'message_id': message_id,
            'role': 'assistant',
            'content': error_content,
            'created_at': time.time(),
            'sender_id': self.agent_id,
            'sender_type': 'agent',
        })
    
    def _normalize_media_for_ext(
        self,
        media: Any,
    ) -> Optional[List[Dict[str, Any]]]:
        """将媒体结构归一化为 ext.media 结构"""
        if not media or not isinstance(media, list):
            return None
        
        out = []
        for m in media:
            if not isinstance(m, dict):
                continue
            
            m_type = (m.get('type') or '').lower().strip()
            mime_type = (m.get('mimeType') or m.get('mime_type') or '').strip()
            data = m.get('data') or ''
            url = m.get('url')
            
            # 处理 data URL
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
            
            if not data and not url:
                continue
            
            # 推断类型
            if not m_type:
                if mime_type.startswith('image/'):
                    m_type = 'image'
                elif mime_type.startswith('video/'):
                    m_type = 'video'
                elif mime_type.startswith('audio/'):
                    m_type = 'audio'
            
            if m_type not in ('image', 'video', 'audio'):
                continue
            
            item = {
                'type': m_type,
                'mimeType': mime_type or 'application/octet-stream',
            }
            if url:
                item['url'] = url
            if data:
                item['data'] = data
            
            # 保留 Gemini 的 thoughtSignature（图片生成模型必须）
            thought_sig = m.get('thoughtSignature') or m.get('thought_signature')
            if thought_sig:
                item['thoughtSignature'] = thought_sig
            
            out.append(item)
        
        return out or None
