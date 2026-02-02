"""
迭代上下文

管理消息处理的迭代状态：
- 当前迭代轮次
- 规划的行动列表
- 执行结果
- 处理步骤（供前端显示）
- 完成/中断状态
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from uuid import uuid4
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .actions import Action, ActionResult


class MessageType:
    """消息类型常量"""
    USER_NEW_MSG = 'user_new_msg'           # 用户新消息
    AGENT_MSG = 'agent_msg'                  # Agent 链式追加消息
    AGENT_TOOLCALL_MSG = 'agent_toolcall_msg'  # Agent 工具调用请求
    RESULT_MSG = 'result_msg'                # 工具调用结果消息


class ProcessPhase:
    """处理阶段常量"""
    LOAD_LLM_TOOL = 'load_llm_tool'
    PREPARE_CONTEXT = 'prepare_context'
    MSG_TYPE_CLASSIFY = 'msg_type_classify'
    MSG_PRE_DEAL = 'msg_pre_deal'
    MSG_DEAL = 'msg_deal'
    POST_MSG_DEAL = 'post_msg_deal'


class LLMDecision:
    """LLM 决策类型"""
    CONTINUE = 'continue'    # 继续处理（触发新消息处理）
    COMPLETE = 'complete'    # 处理完毕


@dataclass
class IterationContext:
    """迭代上下文"""

    # 迭代配置
    max_iterations: int = 10
    iteration: int = 0

    # 原始消息
    original_message: Optional[Dict[str, Any]] = None
    topic_id: Optional[str] = None
    reply_message_id: Optional[str] = None

    # 用户选择的模型信息（优先于session默认配置）
    user_selected_model: Optional[str] = None
    user_selected_llm_config_id: Optional[str] = None

    # 行动规划与执行
    planned_actions: List['Action'] = field(default_factory=list)
    executed_results: List['ActionResult'] = field(default_factory=list)

    # 处理步骤（供前端显示 processSteps）
    process_steps: List[Dict[str, Any]] = field(default_factory=list)

    # 状态标记
    is_complete: bool = False
    is_interrupted: bool = False

    # 最终输出
    final_content: str = ""
    final_media: Optional[List[Dict[str, Any]]] = None
    final_ext: Dict[str, Any] = field(default_factory=dict)

    # 累积的工具结果（用于构建 LLM 上下文）
    tool_results_text: str = ""

    # MCP 返回的媒体数据（图片等）
    mcp_media: Optional[List[Dict[str, Any]]] = None

    # 错误信息
    error: Optional[str] = None

    # ========== 新增：步骤变更回调 ==========

    # 步骤变更回调函数 (step_callback: (ctx, step) -> None)
    _step_callback: Optional[callable] = None

    # Agent ID（用于日志）
    _agent_id: Optional[str] = None

    # ========== 新增：执行日志收集 ==========
    
    # 执行日志列表（用于保存到消息的 ext.log 中）
    execution_logs: List[Dict[str, Any]] = field(default_factory=list)
    
    def add_execution_log(self, message: str, log_type: str = 'info', detail: str = None, duration: int = None):
        """
        添加执行日志
        
        Args:
            message: 日志消息
            log_type: 日志类型 (info, step, tool, llm, success, error, thinking)
            detail: 详细信息
            duration: 耗时（毫秒）
        """
        import time
        log_entry = {
            'id': f"log-{int(time.time() * 1000)}-{uuid4().hex[:8]}",
            'timestamp': int(time.time() * 1000),
            'type': log_type,
            'message': message,
        }
        if detail:
            log_entry['detail'] = detail
        if duration is not None:
            log_entry['duration'] = duration
        self.execution_logs.append(log_entry)

    def set_step_callback(self, callback: callable, agent_id: str = None):
        """
        设置步骤变更回调函数

        Args:
            callback: 回调函数，签名: (ctx: IterationContext, step: Dict[str, Any]) -> None
            agent_id: Agent ID，用于日志记录
        """
        self._step_callback = callback
        self._agent_id = agent_id
    
    # ========== 新增字段：支持消息处理流程 ==========
    
    # LLM 配置（从请求参数或session默认加载）
    llm_config: Optional[Dict[str, Any]] = None
    llm_config_id: Optional[str] = None
    
    # MCP 工具列表（从MCP池加载）
    mcp_tools: Optional[List[Dict[str, Any]]] = None
    mcp_server_ids: Optional[List[str]] = None
    
    # System prompt 和历史消息（准备好的上下文）
    system_prompt: Optional[str] = None
    history_messages: Optional[List[Dict[str, Any]]] = None
    
    # 消息类型分类结果
    msg_type: Optional[str] = None  # MessageType 中的值
    
    # 工具调用结果消息
    result_msg: Optional[Dict[str, Any]] = None
    
    # 事件状态（各阶段的状态）
    event_states: Dict[str, Any] = field(default_factory=dict)
    
    # 当前处理阶段
    current_phase: Optional[str] = None  # ProcessPhase 中的值
    
    # LLM 决策结果
    llm_decision: Optional[str] = None  # LLMDecision 中的值
    llm_decision_data: Optional[Dict[str, Any]] = None  # 决策附加数据
    
    # 是否需要继续处理（用于链式调用）
    should_continue: bool = False
    next_tool_call: Optional[Dict[str, Any]] = None  # 下一个工具调用参数
    
    # 链式执行计划（action_plan）
    action_plan: Optional[List[Dict[str, Any]]] = None  # 执行计划列表
    plan_index: int = 0  # 当前执行到计划的第几步
    plan_accumulated_content: str = ""  # 累积的 LLM 生成内容
    
    # ========== ActionChain 支持 ==========
    
    # ActionChain ID（如果从上游 agent 继承）
    action_chain_id: Optional[str] = None
    
    # 是否继承了 ActionChain（从 @回复中恢复）
    inherited_chain: bool = False
    
    # 当前 ActionChain 进度索引
    chain_step_index: int = 0
    
    def add_step(
        self,
        step_type: str,
        thinking: str = None,
        status: str = 'running',
        **kwargs
    ) -> Dict[str, Any]:
        """
        添加处理步骤

        Args:
            step_type: 步骤类型（thinking/mcp_call/llm_generating/agent_decision 等）
            thinking: 思考/说明文字
            status: 状态（running/completed/error）
            **kwargs: 其他字段

        Returns:
            添加的步骤对象
        """
        step = {
            'step_id': kwargs.pop('step_id', None) or uuid4().hex,
            'type': step_type,
            'timestamp': int(time.time() * 1000),
            'status': status,
            **kwargs,
        }
        if thinking:
            step['thinking'] = thinking

        self.process_steps.append(step)

        # 记录日志
        self._log_step_change(step, "添加")

        # 调用回调函数（通知前端）
        self._notify_step_change(step)

        return step
    
    def update_last_step(self, status: str = None, **kwargs):
        """
        更新最后一个步骤

        Args:
            status: 新状态
            **kwargs: 其他更新字段
        """
        if not self.process_steps:
            return

        step = self.process_steps[-1]
        old_status = step.get('status')

        if status:
            step['status'] = status

        # 计算耗时
        if status in ('completed', 'error') and 'timestamp' in step:
            step['duration'] = int(time.time() * 1000) - step['timestamp']

        step.update(kwargs)

        # 记录状态变更日志
        if status and status != old_status:
            self._log_step_change(step, f"状态变更: {old_status} -> {status}")

        # 调用回调函数（通知前端）
        self._notify_step_change(step)
    
    def get_step_by_type(self, step_type: str) -> Optional[Dict[str, Any]]:
        """
        获取指定类型的最后一个步骤
        
        Args:
            step_type: 步骤类型
            
        Returns:
            步骤对象或 None
        """
        for step in reversed(self.process_steps):
            if step.get('type') == step_type:
                return step
        return None
    
    def mark_complete(self, content: str = "", media: List[Dict[str, Any]] = None):
        """
        标记处理完成
        
        Args:
            content: 最终内容
            media: 媒体列表
        """
        self.is_complete = True
        self.final_content = content
        if media:
            self.final_media = media
    
    def mark_interrupted(self, reason: str = "用户中断"):
        """
        标记处理被中断
        
        Args:
            reason: 中断原因
        """
        self.is_interrupted = True
        self.add_step('interrupted', thinking=reason, status='completed')
    
    def mark_error(self, error: str):
        """
        标记处理错误
        
        Args:
            error: 错误信息
        """
        self.is_complete = True
        self.error = error
        self.add_step('error', thinking=f'处理失败: {error}', status='error', error=error)
    
    def append_tool_result(self, tool_name: str, result_text: str):
        """
        追加工具结果文本
        
        Args:
            tool_name: 工具名称
            result_text: 结果文本
        """
        if result_text:
            if self.tool_results_text:
                self.tool_results_text += "\n\n"
            self.tool_results_text += f"[{tool_name}]\n{result_text}"
    
    def get_executed_tool_names(self) -> List[str]:
        """获取已执行的工具名称列表"""
        names = []
        for result in self.executed_results:
            if hasattr(result, 'action_type') and result.action_type:
                if hasattr(result, 'tool_name') and result.tool_name:
                    names.append(f"{result.action_type}:{result.tool_name}")
                else:
                    names.append(result.action_type)
        return names
    
    def has_pending_actions(self) -> bool:
        """检查是否还有待执行的行动"""
        executed_count = len(self.executed_results)
        planned_count = len(self.planned_actions)
        return executed_count < planned_count
    
    def get_next_action(self) -> Optional['Action']:
        """获取下一个待执行的行动"""
        executed_count = len(self.executed_results)
        if executed_count < len(self.planned_actions):
            return self.planned_actions[executed_count]
        return None

    def _log_step_change(self, step: Dict[str, Any], action: str):
        """记录步骤变更到日志"""
        step_type = step.get('type', 'unknown')
        status = step.get('status', 'unknown')
        thinking = step.get('thinking', '')

        agent_prefix = f"[IterationContext:{self._agent_id}]" if self._agent_id else "[IterationContext]"

        if thinking:
            print(f"{agent_prefix} {action}步骤: {step_type} ({status}) - {thinking}")
        else:
            print(f"{agent_prefix} {action}步骤: {step_type} ({status})")

    def _notify_step_change(self, step: Dict[str, Any]):
        """通知前端步骤变更"""
        if self._step_callback:
            try:
                self._step_callback(self, step)
            except Exception as e:
                agent_prefix = f"[IterationContext:{self._agent_id}]" if self._agent_id else "[IterationContext]"
                print(f"{agent_prefix} 步骤回调失败: {e}")

    def to_process_steps_dict(self) -> List[Dict[str, Any]]:
        """转换为 processSteps 格式（供前端）"""
        return self.process_steps.copy()

    def _extract_media_images(self, result: Any) -> List[Dict[str, Any]]:
        """从 MCP result 中提取图片媒体（仅 image）"""
        images: List[Dict[str, Any]] = []
        if not result:
            return images
        content = None
        if isinstance(result, dict):
            if isinstance(result.get('result'), dict):
                content = result['result'].get('content')
            if content is None:
                content = result.get('content')
        if not isinstance(content, list):
            return images
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get('type') != 'image':
                continue
            mime_type = item.get('mimeType') or item.get('mime_type') or 'image/png'
            data = item.get('data')
            if isinstance(data, str) and data:
                images.append({'mimeType': mime_type, 'data': data})
        return images

    def to_process_messages(self) -> List[Dict[str, Any]]:
        """转换为 processMessages 格式（新协议）"""
        messages: List[Dict[str, Any]] = []
        for step in self.process_steps:
            if not isinstance(step, dict):
                continue
            step_type = step.get('type', 'unknown')
            title = (
                step.get('toolName')
                or (step.get('workflowInfo') or {}).get('name')
                or step.get('action')
                or step_type
            )
            images = self._extract_media_images(step.get('result'))
            if len(images) > 1:
                content_type = 'images'
                image = None
            elif len(images) == 1:
                content_type = 'image'
                image = images[0]
            else:
                content_type = 'text'
                image = None
            content = step.get('thinking') or step.get('error')
            messages.append({
                'type': step_type,
                'contentType': content_type,
                'timestamp': step.get('timestamp', int(time.time() * 1000)),
                'title': title,
                'content': content,
                'image': image,
                'images': images if len(images) > 1 else None,
                'meta': step,
            })
        return messages

    def _json_safe(self, obj: Any, max_depth: int = 8):
        """
        将任意对象递归转换为可 JSON 序列化结构，避免 bytes / Exception / 自定义对象导致持久化失败。
        - bytes/bytearray: 优先 UTF-8 解码，否则 base64
        - dict/list/tuple/set: 递归处理
        - Exception: 转为 str
        - 其他不可序列化对象: 转为 str
        """
        import base64
        import json

        def _inner(x: Any, depth: int):
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
                out: Dict[str, Any] = {}
                for k, v in x.items():
                    try:
                        kk = k if isinstance(k, str) else str(k)
                    except Exception:
                        kk = repr(k)
                    out[kk] = _inner(v, depth + 1)
                return out
            if isinstance(x, (list, tuple, set)):
                return [_inner(v, depth + 1) for v in list(x)]

            # 尝试直接序列化（有些对象本身就是 JSON 兼容的）
            try:
                json.dumps(x)
                return x
            except Exception:
                return str(x)

        return _inner(obj, 0)
    
    def set_llm_response_metadata(self, usage: Optional[Dict[str, int]] = None,
                                  finish_reason: Optional[str] = None,
                                  raw_response: Optional[Dict[str, Any]] = None):
        """
        设置LLM响应元数据

        Args:
            usage: Token使用统计
            finish_reason: 完成原因
            raw_response: 原始响应数据
        """
        if usage or finish_reason or raw_response:
            llm_metadata = {}
            if usage:
                llm_metadata['usage'] = self._json_safe(usage)
            if finish_reason:
                llm_metadata['finish_reason'] = self._json_safe(finish_reason)
            if raw_response:
                # raw 可能包含 bytes/复杂对象，必须清洗，否则会导致 ext 持久化失败
                llm_metadata['raw_response'] = self._json_safe(raw_response)
            self.final_ext['llmResponse'] = llm_metadata

    def build_ext_data(self) -> Dict[str, Any]:
        """
        构建扩展数据（用于消息存储）
        
        新的四大分类结构：
        - agent_log: 滚动日志，显示AI agent的处理过程
        - agent_mind: 思维链，关注关键时间点（思考、MCP选择、自迭代）
        - agent_ext_content: 外部内容（MCP返回信息、媒体资源等）
        - agent_output 的信息存储在 message.content 中
        
        同时保持向后兼容旧字段
        """
        # 合并所有媒体数据：final_media + mcp_media
        all_media = []
        if self.final_media:
            all_media.extend(self.final_media)
        if self.mcp_media:
            all_media.extend(self.mcp_media)
        
        # 构建 agent_mind（思维链）
        mind_nodes = self._build_mind_nodes()
        agent_mind = {
            'nodes': mind_nodes,
        }
        
        # 构建 agent_ext_content（外部内容）
        agent_ext_content = {}
        if all_media:
            agent_ext_content['media'] = all_media
        
        # 提取 MCP 结果
        mcp_results = self._extract_mcp_results()
        if mcp_results:
            agent_ext_content['mcpResults'] = mcp_results
        
        # 构建新的 ext 结构
        ext = {
            # 新的四大分类
            'agent_log': self.execution_logs if self.execution_logs else [],
            'agent_mind': agent_mind,
            'agent_ext_content': agent_ext_content if agent_ext_content else None,
            
            # 向后兼容旧字段
            'processMessages': self.to_process_messages(),
            'log': self.execution_logs if self.execution_logs else [],
            
            # 保留 final_ext 中的其他数据
            **self.final_ext,
        }
        
        # 向后兼容：media 也放在顶层
        if all_media:
            ext['media'] = all_media

        if self.error:
            ext['error'] = self.error
        
        return ext
    
    def _build_mind_nodes(self) -> List[Dict[str, Any]]:
        """
        从 process_steps 构建思维链节点
        
        思维链关注关键时间点：
        - thinking: 思考过程
        - mcp_selection: MCP工具选择
        - iteration: 自迭代选择
        - decision: 决策
        """
        nodes = []
        for step in self.process_steps:
            if not isinstance(step, dict):
                continue
            
            step_type = step.get('type', 'unknown')
            
            # 映射到思维节点类型
            mind_type = self._map_step_to_mind_type(step_type)
            
            node = {
                'id': step.get('step_id', f"node-{step.get('timestamp', int(time.time() * 1000))}"),
                'type': mind_type,
                'timestamp': step.get('timestamp', int(time.time() * 1000)),
                'status': step.get('status', 'completed'),
                'title': step.get('toolName') or step.get('action') or step_type,
                'content': step.get('thinking'),
                'duration': step.get('duration'),
            }
            
            # MCP 相关信息
            if step.get('mcpServer') or step.get('toolName'):
                node['mcp'] = {
                    'server': step.get('mcpServer'),
                    'serverName': step.get('mcpServerName'),
                    'toolName': step.get('toolName'),
                    'arguments': step.get('arguments'),
                    # 注意：不在思维链中包含完整result，避免数据冗余
                }
            
            # 迭代相关信息
            if step.get('iteration') is not None:
                node['iteration'] = {
                    'round': step.get('iteration'),
                    'maxRounds': step.get('max_iterations', self.max_iterations),
                    'isFinal': step.get('is_final_iteration', False),
                }
            
            # 决策相关信息
            if step.get('action'):
                node['decision'] = {
                    'action': step.get('action'),
                    'reason': step.get('thinking'),
                }
            
            # 错误信息
            if step.get('error'):
                node['error'] = step.get('error')
            
            nodes.append(node)
        
        return nodes
    
    def _map_step_to_mind_type(self, step_type: str) -> str:
        """映射处理步骤类型到思维节点类型"""
        mapping = {
            'thinking': 'thinking',
            'mcp_call': 'mcp_selection',
            'mcp_selection': 'mcp_selection',
            'tool_call': 'mcp_selection',
            'iteration': 'iteration',
            'agent_decision': 'decision',
            'planning': 'planning',
            'reflection': 'reflection',
            'llm_generating': 'thinking',
            'llm_call': 'thinking',
        }
        return mapping.get(step_type, step_type)
    
    def _extract_mcp_results(self) -> List[Dict[str, Any]]:
        """
        从 process_steps 中提取 MCP 调用结果
        用于填充 agent_ext_content.mcpResults
        """
        results = []
        for step in self.process_steps:
            if not isinstance(step, dict):
                continue
            
            step_type = step.get('type', '')
            if step_type not in ('mcp_call', 'mcp_selection', 'tool_call'):
                continue
            
            if not step.get('mcpServer') and not step.get('toolName'):
                continue
            
            result_data = step.get('result')
            
            mcp_result = {
                'serverId': step.get('mcpServer', ''),
                'serverName': step.get('mcpServerName', ''),
                'toolName': step.get('toolName', ''),
                'arguments': step.get('arguments'),
                'result': result_data,
                'status': step.get('status', 'completed'),
                'duration': step.get('duration'),
            }
            
            if step.get('error'):
                mcp_result['errorMessage'] = step.get('error')
            
            # 提取媒体
            extracted_media = self._extract_media_from_result(result_data)
            if extracted_media:
                mcp_result['extractedMedia'] = extracted_media
            
            results.append(mcp_result)
        
        return results
    
    def _extract_media_from_result(self, result: Any) -> List[Dict[str, Any]]:
        """从 MCP 结果中提取媒体资源"""
        media = []
        if not result:
            return media
        
        content = None
        if isinstance(result, dict):
            if isinstance(result.get('result'), dict):
                content = result['result'].get('content')
            if content is None:
                content = result.get('content')
        
        if not isinstance(content, list):
            return media
        
        for item in content:
            if not isinstance(item, dict):
                continue
            
            item_type = item.get('type')
            if item_type == 'image':
                mime_type = item.get('mimeType') or item.get('mime_type') or 'image/png'
                data = item.get('data')
                if isinstance(data, str) and data:
                    media.append({
                        'type': 'image',
                        'mimeType': mime_type,
                        'data': data,
                    })
            elif item_type in ('video', 'audio'):
                mime_type = item.get('mimeType') or item.get('mime_type')
                data = item.get('data') or item.get('url')
                if data:
                    media.append({
                        'type': item_type,
                        'mimeType': mime_type,
                        'data': data,
                    })
        
        return media
    
    # ========== 新增方法：支持消息处理流程 ==========
    
    def set_phase(self, phase: str, status: str = 'running', **data):
        """
        设置当前处理阶段
        
        Args:
            phase: 处理阶段（ProcessPhase 中的值）
            status: 状态（running/completed/error）
            **data: 阶段数据
        """
        self.current_phase = phase
        self.event_states[phase] = {
            'status': status,
            'timestamp': int(time.time() * 1000),
            **data
        }
    
    def update_phase(self, phase: str = None, status: str = None, **data):
        """
        更新处理阶段状态
        
        Args:
            phase: 处理阶段（可选，默认当前阶段）
            status: 状态
            **data: 更新数据
        """
        phase = phase or self.current_phase
        if not phase or phase not in self.event_states:
            return
        
        if status:
            self.event_states[phase]['status'] = status
        
        # 计算耗时
        if status in ('completed', 'error'):
            start_ts = self.event_states[phase].get('timestamp', 0)
            if start_ts:
                self.event_states[phase]['duration'] = int(time.time() * 1000) - start_ts
        
        self.event_states[phase].update(data)
    
    def get_phase_data(self, phase: str) -> Optional[Dict[str, Any]]:
        """获取阶段数据"""
        return self.event_states.get(phase)
    
    def set_llm_config(self, config: Dict[str, Any], config_id: str = None):
        """设置 LLM 配置"""
        self.llm_config = config
        self.llm_config_id = config_id
    
    def set_mcp_tools(self, tools: List[Dict[str, Any]], server_ids: List[str] = None):
        """设置 MCP 工具列表"""
        self.mcp_tools = tools
        self.mcp_server_ids = server_ids
    
    def set_context(self, system_prompt: str, history_messages: List[Dict[str, Any]]):
        """设置上下文（system prompt 和历史消息）"""
        self.system_prompt = system_prompt
        self.history_messages = history_messages
    
    def set_msg_type(self, msg_type: str):
        """设置消息类型"""
        self.msg_type = msg_type
    
    def set_result_msg(self, result_msg: Dict[str, Any]):
        """设置工具调用结果消息"""
        self.result_msg = result_msg
    
    def set_llm_decision(self, decision: str, data: Dict[str, Any] = None):
        """
        设置 LLM 决策结果
        
        Args:
            decision: 决策类型（LLMDecision 中的值）
            data: 决策附加数据（如工具调用参数）
        """
        self.llm_decision = decision
        self.llm_decision_data = data
        self.should_continue = (decision == LLMDecision.CONTINUE)
        
        if data and data.get('next_tool_call'):
            self.next_tool_call = data['next_tool_call']
    
    def to_event_data(self) -> Dict[str, Any]:
        """转换为事件数据（用于 Topic.Event.Process）"""
        return {
            'topic_id': self.topic_id,
            'message_id': self.original_message.get('message_id') if self.original_message else None,
            'reply_message_id': self.reply_message_id,
            'current_phase': self.current_phase,
            'msg_type': self.msg_type,
            'llm_decision': self.llm_decision,
            'event_states': self.event_states,
            'process_steps': self.process_steps,
            'is_complete': self.is_complete,
            'error': self.error,
        }


@dataclass
class DecisionContext:
    """决策上下文 - 用于 _should_respond 决策"""
    
    topic_id: str
    message_id: str
    sender_id: str
    sender_type: str  # 'user' | 'agent' | 'system'
    content: str
    mentions: List[str] = field(default_factory=list)
    
    # 会话类型
    session_type: Optional[str] = None  # 'agent' | 'topic_general' | 'memory' | 'private_chat'
    
    # Agent 配置
    response_mode: str = 'normal'  # 'normal' | 'persona'
    
    # 是否被 @ 提及
    is_mentioned: bool = False
    
    # 是否是问题
    is_question: bool = False
    
    def __post_init__(self):
        """初始化后处理"""
        # 检测是否是问题
        self.is_question = self._detect_question(self.content)
    
    def _detect_question(self, text: str) -> bool:
        """检测是否是问题"""
        if not text:
            return False
        
        t = text.strip()
        
        # 问号
        if '？' in t or '?' in t:
            return True
        
        # 疑问词
        keywords = ['为什么', '怎么', '如何', '能否', '是否', '吗', '么', '多少', '哪', '哪里', '哪个']
        return any(k in t for k in keywords)
