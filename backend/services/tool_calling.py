"""
统一的 Tool Calling 服务

提供跨模型的工具调用能力:
- 原生支持: OpenAI, DeepSeek, Anthropic, Claude
- Gemini Function Calling
- 模拟实现: 通过结构化输出（兼容所有模型）

设计原则:
1. 统一接口，屏蔽模型差异
2. 自动选择最优策略
3. 并行执行工具调用
4. 智能错误处理和重试
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from services.providers import create_provider
from services.providers.base import LLMMessage, LLMResponse
from services.parallel import (
    MCPToolCall,
    MCPToolResult,
    execute_mcp_tools_parallel,
    Semaphore,
)


class ToolCallingStrategy(Enum):
    """工具调用策略"""
    NATIVE = "native"           # 原生 Function Calling（OpenAI/DeepSeek/Anthropic）
    GEMINI = "gemini"           # Gemini Function Calling
    STRUCTURED = "structured"   # 结构化输出模拟（兼容所有模型）
    AUTO = "auto"               # 自动选择最优策略


@dataclass
class ToolDefinition:
    """工具定义"""
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema 格式
    
    def to_openai_format(self) -> Dict[str, Any]:
        """转换为 OpenAI 格式"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            }
        }
    
    def to_gemini_format(self) -> Dict[str, Any]:
        """转换为 Gemini 格式"""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        }


@dataclass
class ToolCallRequest:
    """工具调用请求"""
    tool_name: str
    arguments: Dict[str, Any]
    call_id: Optional[str] = None


@dataclass
class ToolCallResponse:
    """工具调用响应"""
    requests: List[ToolCallRequest]
    content: str = ""  # LLM 的附加文本回复
    strategy_used: ToolCallingStrategy = ToolCallingStrategy.AUTO
    raw_response: Optional[LLMResponse] = None


class UnifiedToolCalling:
    """
    统一的 Tool Calling 服务
    
    自动选择最优策略，支持所有主流 LLM
    
    Example:
        service = UnifiedToolCalling(llm_config)
        
        # 获取工具调用请求
        response = service.get_tool_calls(
            messages=[LLMMessage(role='user', content='搜索最新的AI新闻')],
            tools=[ToolDefinition('search', '搜索', {...})],
        )
        
        # 执行工具调用
        results = service.execute_tool_calls(
            response.requests,
            executor=lambda name, args: mcp_client.call(name, args),
        )
    """
    
    # 支持原生 Tool Calling 的 Provider
    NATIVE_PROVIDERS = {'openai', 'deepseek', 'anthropic', 'claude'}
    
    # 支持 Function Calling 的 Provider
    GEMINI_PROVIDERS = {'gemini', 'google'}
    
    def __init__(
        self,
        llm_config: Dict[str, Any],
        strategy: ToolCallingStrategy = ToolCallingStrategy.AUTO,
        max_tools: int = 5,
    ):
        """
        Args:
            llm_config: LLM 配置（包含 provider, api_key, model 等）
            strategy: 工具调用策略
            max_tools: 最大工具调用数
        """
        self._config = llm_config
        self._strategy = strategy
        self._max_tools = max_tools
        
        self._provider_type = llm_config.get('provider', '').lower()
        self._effective_strategy = self._determine_strategy()
    
    def _determine_strategy(self) -> ToolCallingStrategy:
        """确定实际使用的策略"""
        if self._strategy != ToolCallingStrategy.AUTO:
            return self._strategy
        
        # 自动选择
        if self._provider_type in self.NATIVE_PROVIDERS:
            return ToolCallingStrategy.NATIVE
        elif self._provider_type in self.GEMINI_PROVIDERS:
            return ToolCallingStrategy.GEMINI
        else:
            return ToolCallingStrategy.STRUCTURED
    
    def get_tool_calls(
        self,
        messages: List[LLMMessage],
        tools: List[ToolDefinition],
        system_prompt: Optional[str] = None,
    ) -> ToolCallResponse:
        """
        获取工具调用请求
        
        Args:
            messages: 对话消息
            tools: 可用工具列表
            system_prompt: 系统提示词（可选）
            
        Returns:
            ToolCallResponse 包含工具调用请求列表
        """
        if not tools:
            return ToolCallResponse(requests=[], content="", strategy_used=self._effective_strategy)
        
        strategy = self._effective_strategy
        
        if strategy == ToolCallingStrategy.NATIVE:
            return self._call_native(messages, tools, system_prompt)
        elif strategy == ToolCallingStrategy.GEMINI:
            return self._call_gemini(messages, tools, system_prompt)
        else:
            return self._call_structured(messages, tools, system_prompt)
    
    def _call_native(
        self,
        messages: List[LLMMessage],
        tools: List[ToolDefinition],
        system_prompt: Optional[str],
    ) -> ToolCallResponse:
        """使用原生 Function Calling"""
        try:
            provider = create_provider(
                provider_type=self._provider_type,
                api_key=self._config.get('api_key', ''),
                api_url=self._config.get('api_url'),
                model=self._config.get('model'),
            )
            
            # 准备消息
            llm_messages = list(messages)
            if system_prompt:
                llm_messages.insert(0, LLMMessage(role='system', content=system_prompt))
            
            # 转换工具格式
            openai_tools = [t.to_openai_format() for t in tools]
            
            # 调用 LLM
            response = provider.chat(
                llm_messages,
                tools=openai_tools,
                tool_choice="auto",
                temperature=0.1,
            )
            
            # 解析工具调用
            requests = []
            if response.tool_calls:
                for tc in response.tool_calls[:self._max_tools]:
                    func = tc.get('function', {})
                    args_str = func.get('arguments', '{}')
                    
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else args_str
                    except json.JSONDecodeError:
                        args = {}
                    
                    requests.append(ToolCallRequest(
                        tool_name=func.get('name', ''),
                        arguments=args,
                        call_id=tc.get('id'),
                    ))
            
            return ToolCallResponse(
                requests=requests,
                content=response.content or "",
                strategy_used=ToolCallingStrategy.NATIVE,
                raw_response=response,
            )
            
        except Exception as e:
            print(f"[ToolCalling] Native call failed: {e}, falling back to structured")
            return self._call_structured(messages, tools, system_prompt)
    
    def _call_gemini(
        self,
        messages: List[LLMMessage],
        tools: List[ToolDefinition],
        system_prompt: Optional[str],
    ) -> ToolCallResponse:
        """使用 Gemini Function Calling"""
        try:
            provider = create_provider(
                provider_type=self._provider_type,
                api_key=self._config.get('api_key', ''),
                api_url=self._config.get('api_url'),
                model=self._config.get('model'),
            )
            
            # 准备消息
            llm_messages = list(messages)
            if system_prompt:
                llm_messages.insert(0, LLMMessage(role='system', content=system_prompt))
            
            # Gemini 的 tools 格式
            gemini_tools = [{
                "function_declarations": [t.to_gemini_format() for t in tools]
            }]
            
            # 调用 LLM
            response = provider.chat(
                llm_messages,
                tools=gemini_tools,
            )
            
            # 解析 Gemini 的 function call 响应
            requests = []
            if response.tool_calls:
                for tc in response.tool_calls[:self._max_tools]:
                    # Gemini 格式: {name, args}
                    requests.append(ToolCallRequest(
                        tool_name=tc.get('name', ''),
                        arguments=tc.get('args', {}),
                    ))
            
            return ToolCallResponse(
                requests=requests,
                content=response.content or "",
                strategy_used=ToolCallingStrategy.GEMINI,
                raw_response=response,
            )
            
        except Exception as e:
            print(f"[ToolCalling] Gemini call failed: {e}, falling back to structured")
            return self._call_structured(messages, tools, system_prompt)
    
    def _call_structured(
        self,
        messages: List[LLMMessage],
        tools: List[ToolDefinition],
        system_prompt: Optional[str],
    ) -> ToolCallResponse:
        """使用结构化输出模拟 Tool Calling（兼容所有模型）"""
        try:
            provider = create_provider(
                provider_type=self._provider_type,
                api_key=self._config.get('api_key', ''),
                api_url=self._config.get('api_url'),
                model=self._config.get('model'),
            )
            
            # 构建工具描述
            tools_desc = self._build_tools_description(tools)
            
            # 构建系统提示词
            structured_system = self._build_structured_prompt(tools_desc, system_prompt)
            
            # 提取用户消息
            user_content = "\n".join(
                m.content for m in messages 
                if m.role == 'user' and m.content
            )
            
            llm_messages = [
                LLMMessage(role='system', content=structured_system),
                LLMMessage(role='user', content=user_content),
            ]
            
            # 调用 LLM
            response = provider.chat(llm_messages, temperature=0.1)
            
            # 解析结构化输出
            requests = self._parse_structured_response(response.content, tools)
            
            return ToolCallResponse(
                requests=requests,
                content=response.content or "",
                strategy_used=ToolCallingStrategy.STRUCTURED,
                raw_response=response,
            )
            
        except Exception as e:
            print(f"[ToolCalling] Structured call failed: {e}")
            return ToolCallResponse(
                requests=[],
                content=f"Error: {e}",
                strategy_used=ToolCallingStrategy.STRUCTURED,
            )
    
    def _build_tools_description(self, tools: List[ToolDefinition]) -> str:
        """构建工具描述"""
        parts = []
        for t in tools:
            params_desc = self._format_params(t.parameters)
            parts.append(f"【{t.name}】\n  描述: {t.description}\n{params_desc}")
        return "\n\n".join(parts)
    
    def _format_params(self, schema: Dict[str, Any]) -> str:
        """格式化参数描述"""
        props = schema.get("properties", {})
        required = schema.get("required", [])
        
        if not props:
            return "  参数: 无"
        
        lines = []
        for name, info in props.items():
            ptype = info.get("type", "string")
            desc = info.get("description", "")
            req = "*必需*" if name in required else "可选"
            lines.append(f"    - {name} ({ptype}, {req}): {desc}")
        
        return "  参数:\n" + "\n".join(lines)
    
    def _build_structured_prompt(self, tools_desc: str, custom_prompt: Optional[str]) -> str:
        """构建结构化输出的系统提示词"""
        parts = []
        
        if custom_prompt:
            parts.append(custom_prompt)
            parts.append("")
        
        parts.append("""## 工具选择指令

你是一个工具选择助手。根据用户需求选择最合适的工具。

### 返回格式（严格 JSON）

```json
{
  "tool_calls": [
    {"name": "工具名", "arguments": {"参数名": "参数值"}}
  ],
  "intent": "用户意图（10字以内）"
}
```

如果不需要工具：
```json
{"tool_calls": [], "intent": "无需工具"}
```

### 规则
1. 工具名必须完全匹配
2. 必需参数不可省略
3. 最多选择 3 个工具
4. 只返回 JSON，无其他文字

### 可用工具
""")
        parts.append(tools_desc)
        
        return "\n".join(parts)
    
    def _parse_structured_response(
        self,
        content: str,
        tools: List[ToolDefinition],
    ) -> List[ToolCallRequest]:
        """解析结构化输出"""
        if not content:
            return []
        
        # 尝试提取 JSON
        json_match = re.search(r'\{[\s\S]*\}', content)
        if not json_match:
            return []
        
        try:
            data = json.loads(json_match.group())
            tool_calls = data.get('tool_calls', [])
            
            # 验证工具名
            valid_names = {t.name.lower() for t in tools}
            requests = []
            
            for tc in tool_calls[:self._max_tools]:
                name = tc.get('name', '')
                if name.lower() in valid_names:
                    requests.append(ToolCallRequest(
                        tool_name=name,
                        arguments=tc.get('arguments', {}),
                    ))
            
            return requests
            
        except json.JSONDecodeError:
            return []
    
    def execute_tool_calls(
        self,
        requests: List[ToolCallRequest],
        executor: Callable[[str, Dict[str, Any]], Any],
        max_concurrent: int = 3,
        timeout: float = 60.0,
        on_progress: Optional[Callable[[int, int, MCPToolResult], None]] = None,
    ) -> List[MCPToolResult]:
        """
        执行工具调用（并行）
        
        Args:
            requests: 工具调用请求列表
            executor: 执行函数 (tool_name, args) -> result
            max_concurrent: 最大并发数
            timeout: 单个调用超时
            on_progress: 进度回调
            
        Returns:
            执行结果列表
        """
        if not requests:
            return []
        
        # 转换为 MCPToolCall
        tool_calls = [
            MCPToolCall(
                tool_name=r.tool_name,
                arguments=r.arguments,
                tool_call_id=r.call_id,
            )
            for r in requests
        ]
        
        # 并行执行
        return execute_mcp_tools_parallel(
            tool_calls=tool_calls,
            call_func=executor,
            max_concurrent=max_concurrent,
            timeout=timeout,
            on_progress=on_progress,
        )


# ==================== 便捷函数 ====================

def get_tool_calls_unified(
    llm_config: Dict[str, Any],
    user_message: str,
    tools: List[Dict[str, Any]],
    system_prompt: Optional[str] = None,
) -> Tuple[List[ToolCallRequest], str]:
    """
    便捷函数：获取工具调用请求
    
    Args:
        llm_config: LLM 配置
        user_message: 用户消息
        tools: 工具列表（MCP 格式）
        system_prompt: 系统提示词
        
    Returns:
        (工具调用请求列表, 策略)
    """
    # 转换工具格式
    tool_defs = [
        ToolDefinition(
            name=t.get('name', ''),
            description=t.get('description', ''),
            parameters=t.get('inputSchema') or t.get('input_schema') or t.get('parameters') or {},
        )
        for t in tools
    ]
    
    service = UnifiedToolCalling(llm_config)
    
    response = service.get_tool_calls(
        messages=[LLMMessage(role='user', content=user_message)],
        tools=tool_defs,
        system_prompt=system_prompt,
    )
    
    return response.requests, response.strategy_used.value


def execute_and_get_results(
    llm_config: Dict[str, Any],
    user_message: str,
    tools: List[Dict[str, Any]],
    executor: Callable[[str, Dict[str, Any]], Any],
    system_prompt: Optional[str] = None,
    max_concurrent: int = 3,
) -> Tuple[List[MCPToolResult], str]:
    """
    便捷函数：获取工具调用并执行
    
    Returns:
        (执行结果列表, 使用的策略)
    """
    # 转换工具格式
    tool_defs = [
        ToolDefinition(
            name=t.get('name', ''),
            description=t.get('description', ''),
            parameters=t.get('inputSchema') or t.get('input_schema') or t.get('parameters') or {},
        )
        for t in tools
    ]
    
    service = UnifiedToolCalling(llm_config)
    
    # 获取工具调用
    response = service.get_tool_calls(
        messages=[LLMMessage(role='user', content=user_message)],
        tools=tool_defs,
        system_prompt=system_prompt,
    )
    
    if not response.requests:
        return [], response.strategy_used.value
    
    # 执行工具调用
    results = service.execute_tool_calls(
        requests=response.requests,
        executor=executor,
        max_concurrent=max_concurrent,
    )
    
    return results, response.strategy_used.value
