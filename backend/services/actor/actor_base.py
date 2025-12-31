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
from .iteration_context import IterationContext, DecisionContext
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
        
        Args:
            topic_id: 话题 ID
            trigger_message: 触发消息（如果提供，激活后立即处理）
            history_limit: 历史消息加载数量限制
        """
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
        
        # 6. 如果有触发消息，立即处理
        if trigger_message:
            self.mailbox.put({
                'type': 'new_message',
                'topic_id': topic_id,
                'data': trigger_message,
            })
        
        logger.info(f"[ActorBase:{self.agent_id}] Activated on topic {topic_id}")
    
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
    
    def _handle_new_message(self, topic_id: str, msg_data: Dict[str, Any]):
        """处理新消息"""
        message_id = msg_data.get('message_id')
        sender_id = msg_data.get('sender_id')
        content = msg_data.get('content', '')
        
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
        
        # 6. 执行迭代处理
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
        
        # 添加处理步骤
        ctx.add_step(
            'mcp_call',
            thinking=f'调用 MCP {server_id}...',
            mcpServer=server_id,
            toolName=action.mcp_tool_name or 'auto',
        )
        
        # 发送实时更新
        self._sync_message('agent_thinking', '', ext={
            'message_id': ctx.reply_message_id,
            'processSteps': ctx.to_process_steps_dict(),
        })
        
        try:
            from services.mcp_execution_service import execute_mcp_with_llm
            
            llm_config_id = self._config.get('llm_config_id')
            input_text = ctx.original_message.get('content', '')
            
            result = execute_mcp_with_llm(
                mcp_server_id=server_id,
                input_text=input_text,
                llm_config_id=llm_config_id,
            )
            
            duration_ms = int((time.time() - start_time) * 1000)
            
            if result.get('error'):
                ctx.update_last_step(
                    status='error',
                    error=result.get('error'),
                )
                return ActionResult.error_result(
                    action_type='mcp',
                    error=result.get('error'),
                    duration_ms=duration_ms,
                    action=action,
                )
            
            # 提取结果文本
            tool_text = result.get('tool_text', '')
            summary = result.get('summary', '')
            
            ctx.update_last_step(
                status='completed',
                result={'summary': summary, 'tool_text': tool_text[:500] if tool_text else ''},
            )
            
            # 追加工具结果
            if tool_text:
                ctx.append_tool_result(f"MCP:{server_id}", tool_text)
            
            return ActionResult.success_result(
                action_type='mcp',
                data=result,
                text_result=tool_text,
                duration_ms=duration_ms,
                action=action,
            )
            
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            ctx.update_last_step(status='error', error=str(e))
            return ActionResult.error_result(
                action_type='mcp',
                error=str(e),
                duration_ms=duration_ms,
                action=action,
            )
    
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
        
        # 添加 LLM 生成步骤
        llm_config_id = self._config.get('llm_config_id')
        llm_service = get_llm_service()
        config = llm_service.get_config(llm_config_id, include_api_key=True) or {}
        
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
            for chunk in self._stream_llm_response(messages):
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
                'configId': llm_config_id,
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
    
    def _build_system_prompt(self, ctx: IterationContext) -> str:
        """构建 system prompt"""
        system_prompt = self._config.get('system_prompt', '你是一个AI助手。')
        
        # 添加能力描述
        cap_desc = self.capabilities.get_capability_description()
        if cap_desc:
            system_prompt += f"\n\n{cap_desc}"
        
        # 添加工具结果
        if ctx.tool_results_text:
            system_prompt += (
                "\n\n=== 工具执行结果（事实源，必须遵循）===\n"
                f"{ctx.tool_results_text}\n"
                "规则：以上述工具结果为准，不要编造或假设。"
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
        history_msgs = self.state.get_recent_history(
            max_messages=24,
            max_total_chars=18000,
            max_per_message_chars=2400,
            include_summary=False,  # 已经单独添加
        )
        messages.extend(history_msgs)
        
        # 添加当前消息
        user_content = ctx.original_message.get('content', '')
        user_msg = {"role": "user", "content": user_content}
        
        # 处理媒体
        ext = ctx.original_message.get('ext', {}) or {}
        media = ext.get('media')
        if media:
            user_msg['media'] = media
        elif self.state.should_attach_last_media(user_content):
            last_media = self.state.get_last_media()
            if last_media:
                user_msg['media'] = last_media
        
        messages.append(user_msg)
        
        return messages
    
    def _stream_llm_response(
        self,
        messages: List[Dict[str, Any]],
    ) -> Generator[str, None, None]:
        """流式调用 LLM"""
        from services.providers import create_provider, LLMMessage
        
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
        get_topic_service().send_message(
            topic_id=topic_id,
            sender_id=self.agent_id,
            sender_type='agent',
            content=f"[错误] {self.info.get('name', 'Agent')} 无法产生回复: {str(error)}",
            role='assistant',
            message_id=message_id,
            sender_name=self.info.get('name'),
            sender_avatar=self.info.get('avatar'),
            ext={'processSteps': ctx.to_process_steps_dict(), 'error': str(error)},
        )
    
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
            
            out.append(item)
        
        return out or None
