"""
Chat Agent

默认的对话 Agent 实现：
- 私聊模式：直接回复
- 多人话题：智能决策是否响应
- 支持 MCP 工具调用
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional

from ..actor_base import ActorBase
from ..actions import Action, ActionResult, ResponseDecision
from ..action_chain import ActionStep, create_mcp_step
from ..iteration_context import IterationContext

logger = logging.getLogger(__name__)


class ChatAgent(ActorBase):
    """
    Chat Agent - 默认对话 Agent
    
    实现 _should_respond 决策逻辑，根据会话类型和消息内容决定是否响应。
    """
    # 使用旧流程 process_message（直接流式生成），新流程已停用

    def _should_respond(self, topic_id: str, msg_data: Dict[str, Any]) -> ResponseDecision:
        """
        决策是否响应
        
        决策逻辑：
        1. 被 @ 提及：必须回复
        2. 私聊模式：直接回复
        3. Agent 会话（普通模式）：直接回复
        4. Agent 会话（人格模式）：智能决策
        5. 多人话题：智能决策
        
        Args:
            topic_id: 话题 ID
            msg_data: 消息数据
            
        Returns:
            响应决策
        """
        sender_type = msg_data.get('sender_type')
        content = msg_data.get('content', '') or ''
        mentions = msg_data.get('mentions', []) or []
        ext = msg_data.get('ext', {}) or {}
        
        # 1. 被 @ 提及：必须回复
        if self.agent_id in mentions:
            return ResponseDecision.reply('被 @ 提及，必须回复')
        
        # 2. MCP 错误自动触发：功能已禁用
        # if ext.get('auto_trigger') and ext.get('mcp_error'):
        #     return ResponseDecision.reply('MCP 错误自动触发，需要处理')
        
        # 获取会话类型
        from services.topic_service import get_topic_service
        topic = get_topic_service().get_topic(topic_id) or {}
        session_type = topic.get('session_type')
        
        # 2. 私聊模式：直接回复
        if session_type == 'private_chat':
            return ResponseDecision.reply('私聊模式', needs_thinking=False)
        
        # 3. Agent 会话
        if session_type == 'agent':
            ext = self._config.get('ext') or {}
            persona = ext.get('persona') or {}
            response_mode = persona.get('responseMode', 'normal')
            
            # 普通模式：直接回复
            if response_mode == 'normal':
                return ResponseDecision.reply('Agent 普通模式', needs_thinking=False)
            
            # 人格模式：继续决策
        
        # 4. 其他 Agent 的消息：默认沉默
        if sender_type == 'agent':
            # 如果对方在问 @human，保持沉默
            if '@human' in content:
                return ResponseDecision.silent('对方在请求人类协助')
            return ResponseDecision.silent('其他 Agent 的消息')
        
        # 5. 用户消息：智能决策
        if self._is_question(content):
            # 问题：更倾向回复
            return self._llm_intent_decision(
                topic_id, msg_data, default_action='reply'
            )
        else:
            # 陈述：默认沉默
            return self._llm_intent_decision(
                topic_id, msg_data, default_action='silent'
            )
    
    def _is_question(self, text: str) -> bool:
        """判断是否是问题"""
        t = (text or '').strip()
        if not t:
            return False
        
        # 问号
        if '？' in t or '?' in t:
            return True
        
        # 疑问词
        keywords = ['为什么', '怎么', '如何', '能否', '是否', '吗', '么', '多少', '哪', '哪里', '哪个']
        return any(k in t for k in keywords)
    
    def _llm_intent_decision(
        self,
        topic_id: str,
        msg_data: Dict[str, Any],
        default_action: str = 'silent',
    ) -> ResponseDecision:
        """
        使用 LLM 判定动作
        
        可选动作：
        - reply: 我来回答
        - like: 点赞
        - oppose: 反对
        - delegate:<agent_id>: 委派给其他 Agent
        - ask_human: 请求人类协助
        - silent: 沉默
        
        Args:
            topic_id: 话题 ID
            msg_data: 消息数据
            default_action: 默认动作
            
        Returns:
            响应决策
        """
        try:
            # 构建参与者信息
            participants = self.state.participants
            agents = [p for p in participants if p.get('participant_type') == 'agent']
            
            agent_lines = []
            for p in agents:
                aid = p.get('participant_id')
                name = p.get('name') or aid
                ability = self.state.agent_abilities.get(aid, '')
                agent_lines.append(f"- {name} (id={aid}): {ability}")
            agents_desc = "\n".join(agent_lines) if agent_lines else "(无其他agent)"
            
            me_name = self.info.get('name', self.agent_id)
            persona = self._config.get('system_prompt', '') or '你是一个AI助手。'
            user_text = (msg_data.get('content') or '').strip()
            
            system = (
                "你是一个多智能体话题中的单个Agent。你需要决定是否要参与发言，以保持会话收敛。\n"
                "可选动作(action)：reply / like / oppose / silent / ask_human / delegate。\n"
                "规则：\n"
                "- 如果需要人类确认或执行操作，用 ask_human。\n"
                "- 如果需要其他Agent更合适处理，用 delegate，并选择一个 agent_id。\n"
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
            
            config_id = self._config.get('llm_config_id')
            if not config_id:
                return ResponseDecision(action=default_action)
            
            # 直接使用 Repository 获取配置
            from models.llm_config import LLMConfigRepository
            from database import get_mysql_connection
            from services.providers import create_provider
            from services.providers.base import LLMMessage
            
            repository = LLMConfigRepository(get_mysql_connection)
            config_obj = repository.find_by_id(config_id)
            if not config_obj:
                return ResponseDecision(action=default_action)
            
            # ANSI 颜色码（Actor 模式使用青色）
            CYAN = '\033[96m'
            RESET = '\033[0m'
            BOLD = '\033[1m'
            
            print(f"{CYAN}{BOLD}[Actor Mode] ========== ChatAgent 决策 LLM 调用 =========={RESET}")
            print(f"{CYAN}[Actor Mode] Agent: {self.agent_id}{RESET}")
            print(f"{CYAN}[Actor Mode] Provider: {config_obj.provider}, Model: {config_obj.model}{RESET}")
            print(f"{CYAN}[Actor Mode] Config ID: {config_id}{RESET}")
            
            # 打印提示词
            system_preview = system[:300] + '...' if len(system) > 300 else system
            user_preview = user[:500] + '...' if len(user) > 500 else user
            print(f"{CYAN}[Actor Mode] SYSTEM 提示词 ({len(system)} 字符): {system_preview}{RESET}")
            print(f"{CYAN}[Actor Mode] USER 提示词 ({len(user)} 字符): {user_preview}{RESET}")
            
            # 创建 Provider 并调用
            provider = create_provider(
                provider_type=config_obj.provider,
                api_key=config_obj.api_key,
                api_url=config_obj.api_url,
                model=config_obj.model,
            )
            
            llm_messages = [
                LLMMessage(role='system', content=system),
                LLMMessage(role='user', content=user),
            ]
            
            print(f"{CYAN}[Actor Mode] 调用 Provider SDK 进行决策...{RESET}")
            response = provider.chat(llm_messages)
            raw = (response.content or '').strip()
            
            print(f"{CYAN}[Actor Mode] ✅ 决策完成，返回内容长度: {len(raw)} 字符{RESET}")
            print(f"{CYAN}{BOLD}[Actor Mode] ========== ChatAgent 决策 LLM 调用完成 =========={RESET}\n")
            
            # 解析 JSON
            start = raw.find('{')
            end = raw.rfind('}')
            if start == -1 or end == -1 or end <= start:
                return ResponseDecision(action=default_action)
            
            obj = json.loads(raw[start:end+1])
            action = obj.get('action') or default_action
            
            if action == 'delegate':
                agent_id = obj.get('agent_id')
                if agent_id and any(p.get('participant_id') == agent_id for p in agents):
                    return ResponseDecision.delegate(agent_id, f'委派给 {agent_id}')
                return ResponseDecision(action=default_action)
            
            if action == 'reply':
                return ResponseDecision.reply('LLM 决策回复')
            if action == 'like':
                return ResponseDecision(action='like', reason='LLM 决策点赞')
            if action == 'oppose':
                return ResponseDecision(action='oppose', reason='LLM 决策反对')
            if action == 'ask_human':
                return ResponseDecision(action='ask_human', reason='LLM 决策请求人类')
            if action == 'silent':
                return ResponseDecision.silent('LLM 决策沉默')
            
            return ResponseDecision(action=default_action)
            
        except Exception as e:
            logger.error(f"[ChatAgent:{self.agent_id}] Intent decision error: {e}")
            return ResponseDecision(action=default_action)
    
    def _plan_actions(self, ctx: IterationContext) -> List[Action]:
        """
        规划行动

        ChatAgent 的实现：
        1. 读取 ext.skill_packs，按需激活 Skill，并记录到 ctx.active_skills
        2. 遍历已激活 Skill 的步骤，将其中的 mcp_call 步骤编排为 MCP 行动
        3. 在此基础上，再按原有策略做 MCP 自动/显式路由

        Args:
            ctx: 迭代上下文

        Returns:
            行动列表
        """
        ext = (ctx.original_message or {}).get("ext", {}) or {}
        content = (ctx.original_message or {}).get("content", "") or ""
        content = content.strip()

        actions: List[Action] = []
        mcp_servers: List[str] = []

        # ========== 1) 处理前端激活的 Skill ==========
        skill_ids = ext.get("skill_packs") or []
        if isinstance(skill_ids, str):
            skill_ids = [skill_ids]
        if not isinstance(skill_ids, list):
            skill_ids = []

        active_skills = []
        for sid in skill_ids:
            if not sid:
                continue
            skill = self.capabilities.get_skill(sid)
            if not skill:
                # 按需从 DB 加载
                try:
                    skill = self._load_single_skill(sid)
                except Exception as e:
                    logger.warning(
                        "[ChatAgent:%s] Failed to load skill %s: %s",
                        self.agent_id,
                        sid,
                        e,
                    )
                    skill = None
            if not skill:
                continue

            active_skills.append(skill)

            # Skill 可能声明 required_mcps，纳入 MCP 候选
            for mid in getattr(skill, "required_mcps", []) or []:
                if mid and mid not in mcp_servers:
                    mcp_servers.append(mid)

            # Skill 步骤中的 mcp_call 转化为 MCP 行动
            for step in getattr(skill, "steps", []) or []:
                if step.get("type") != "mcp_call":
                    continue

                server_id = (
                    step.get("mcpServer")
                    or step.get("mcp_server")
                    or step.get("server_id")
                )
                tool_name = step.get("toolName") or step.get("tool_name") or "auto"
                params = step.get("arguments") or step.get("params") or {}

                if not server_id:
                    continue

                if server_id not in mcp_servers:
                    mcp_servers.append(server_id)

                actions.append(
                    create_mcp_step(
                        mcp_server_id=server_id,
                        mcp_tool_name=tool_name,
                        params=params or {"input": content},
                    )
                )

        # 将激活的 Skill 写入上下文，供 system prompt 使用
        ctx.active_skills = active_skills

        # ========== 2) MCP 自动/显式路由补充 ==========
        auto_mcp_servers: List[str] = []
        try:
            from services.mcp_chat_router import resolve_mcp_server_ids_for_message

            auto_mcp_servers, mcp_reason = resolve_mcp_server_ids_for_message(
                content, ext
            )
            if auto_mcp_servers:
                logger.info(
                    "[ChatAgent:%s] MCP 路由: %s servers=%s",
                    self.agent_id,
                    mcp_reason,
                    auto_mcp_servers,
                )
        except Exception as e:
            logger.warning("[ChatAgent:%s] MCP 路由失败，回退仅显式: %s", self.agent_id, e)
            auto_mcp_servers = (
                ext.get("mcp_servers")
                or ext.get("selectedMcpServerIds")
                or ext.get("selected_mcp_server_ids")
                or []
            )
            if isinstance(auto_mcp_servers, str):
                auto_mcp_servers = [auto_mcp_servers]
            auto_mcp_servers = [x for x in auto_mcp_servers if x][:3]

        # 合并路由得到的 MCP 服务器，避免重复
        for sid in auto_mcp_servers:
            if sid and sid not in mcp_servers:
                mcp_servers.append(sid)

        # 为剩余 MCP 服务器规划默认 auto 工具调用（不重复已由 Skill 显式规划的）
        for server_id in mcp_servers:
            # 如果此 server 已经有基于 Skill 的行动，则允许重复（可能需要多次调用不同工具）
            actions.append(
                create_mcp_step(
                    mcp_server_id=server_id,
                    mcp_tool_name="auto",
                    params={"input": content},
                )
            )

        return actions
    
    def _should_continue(self, ctx: IterationContext) -> bool:
        """
        是否继续迭代
        
        ChatAgent 的实现：
        - 如果还有未执行的行动，继续
        - 否则结束
        
        Args:
            ctx: 迭代上下文
            
        Returns:
            True 表示继续
        """
        return ctx.has_pending_actions()
    
    def _handle_like(self, topic_id: str, msg_data: Dict[str, Any]):
        """处理点赞"""
        from services.topic_service import get_topic_service
        
        message_id = msg_data.get('message_id')
        sender_id = msg_data.get('sender_id')
        sender_type = msg_data.get('sender_type')
        
        if not message_id:
            return
        
        get_topic_service()._publish_event(topic_id, 'reaction', {
            'reaction': 'like',
            'message_id': message_id,
            'from_agent_id': self.agent_id,
            'from_agent_name': self.info.get('name', 'Agent'),
            'target_sender_id': sender_id,
            'target_sender_type': sender_type,
            'timestamp': time.time(),
        })
    
    def _handle_oppose(self, topic_id: str, msg_data: Dict[str, Any]):
        """处理反对"""
        from services.topic_service import get_topic_service
        
        quoted = (msg_data.get('content') or '').strip().replace('\n', ' ')
        if len(quoted) > 120:
            quoted = quoted[:120] + '...'
        
        content = f"> 引用：{quoted}\n\n我不同意上述观点。我的理由是：……"
        
        get_topic_service().send_message(
            topic_id=topic_id,
            sender_id=self.agent_id,
            sender_type='agent',
            content=content,
            role='assistant',
            ext={
                'quotedMessage': {
                    'id': msg_data.get('message_id'),
                    'content': msg_data.get('content'),
                }
            },
            sender_name=self.info.get('name'),
            sender_avatar=self.info.get('avatar'),
        )
        
        # 追加到本地历史
        self.state.append_history({
            'message_id': None,
            'role': 'assistant',
            'content': content,
            'created_at': time.time(),
            'sender_id': self.agent_id,
            'sender_type': 'agent',
        })
    
    def _handle_ask_human(self, topic_id: str, msg_data: Dict[str, Any]):
        """处理请求人类"""
        from services.topic_service import get_topic_service
        
        user_text = (msg_data.get('content') or '').strip()
        content = f"@human 我需要你确认/执行以下事项：{user_text}"
        
        get_topic_service().send_message(
            topic_id=topic_id,
            sender_id=self.agent_id,
            sender_type='agent',
            content=content,
            role='assistant',
            ext={'needs_human': True},
            sender_name=self.info.get('name'),
            sender_avatar=self.info.get('avatar'),
        )
        
        # 追加到本地历史
        self.state.append_history({
            'message_id': None,
            'role': 'assistant',
            'content': content,
            'created_at': time.time(),
            'sender_id': self.agent_id,
            'sender_type': 'agent',
        })
    
    def _handle_new_message(self, topic_id: str, msg_data: Dict[str, Any]):
        """
        处理新消息 - 重写以支持特殊动作
        
        Args:
            topic_id: 话题 ID
            msg_data: 消息数据
        """
        message_id = msg_data.get('message_id')
        sender_id = msg_data.get('sender_id')
        content = msg_data.get('content', '')
        
        # 1. 去重检查
        if self.state.is_processed(message_id):
            logger.debug(f"[ChatAgent:{self.agent_id}] Skipping duplicate: {message_id}")
            return
        
        # 2. 记录到历史
        self.state.append_history(msg_data)
        
        # 3. 自己的消息不处理（除非是自动触发的重试消息）
        ext = msg_data.get('ext', {}) or {}
        if sender_id == self.agent_id and not (ext.get('auto_trigger') and ext.get('retry')):
            return
        
        # ANSI 颜色码（蓝色加粗）
        CYAN = '\033[96m'
        BOLD = '\033[1m'
        RESET = '\033[0m'
        
        logger.info(f"[ChatAgent:{self.agent_id}] Received: {content[:50]}...")
        if ext.get('auto_trigger') and ext.get('retry'):
            print(f"{CYAN}{BOLD}[ChatAgent] 📥 收到重试消息，开始处理...{RESET}")
        else:
            print(f"{CYAN}{BOLD}[ChatAgent] 📥 收到新消息，开始处理...{RESET}")
        
        # 4. 检查记忆预算
        if self._check_memory_budget():
            self._summarize_memory()
        
        # 5. 决策是否响应
        decision = self._should_respond(topic_id, msg_data)
        
        # 6. 处理不同决策
        if decision.action == 'silent':
            self._handle_silent_decision(topic_id, msg_data, decision)
            return
        
        if decision.action == 'delegate':
            self._handle_delegate_decision(topic_id, msg_data, decision)
            return
        
        if decision.action == 'like':
            self._handle_like(topic_id, msg_data)
            return
        
        if decision.action == 'oppose':
            self._handle_oppose(topic_id, msg_data)
            return
        
        if decision.action == 'ask_human':
            self._handle_ask_human(topic_id, msg_data)
            return
        
        # 7. 回复：执行迭代处理
        self.process_message(topic_id, msg_data, decision)
