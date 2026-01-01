"""
MCP 执行服务（供 AgentActor/接口复用）

目标：
- 给定 mcp_server_id + 用户输入 + llm_config_id
- 先获取 MCP tools 列表
- 用 LLM 产出 tool_calls JSON
- 执行 tool_calls 并返回结构化结果 + logs

注意：这里不依赖 Flask app.py，避免循环导入。
使用 mcp_common_logic 模块直接调用 MCP（类似 ok-publish 分支）。
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

from database import get_mysql_connection
from mcp_server.mcp_common_logic import get_mcp_tools_list, call_mcp_tool, prepare_mcp_headers, initialize_mcp_session
import pymysql


def _mk_logger(external_log: Optional[callable] = None) -> tuple[list[str], callable]:
    logs: list[str] = []

    def add_log(message: str):
        line = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
        logs.append(line)
        if external_log:
            try:
                external_log(line)
            except Exception:
                pass

    return logs, add_log


def _truncate_deep(obj: Any, *, max_str: int = 2000) -> Any:
    """避免把超大结果（尤其 base64）塞进 processSteps/system prompt"""
    if obj is None:
        return None
    if isinstance(obj, str):
        s = obj
        if len(s) > max_str:
            return s[:max_str] + f"...[truncated:{len(s)}]"
        return s
    if isinstance(obj, (int, float, bool)):
        return obj
    if isinstance(obj, list):
        return [_truncate_deep(x, max_str=max_str) for x in obj[:200]]
    if isinstance(obj, dict):
        out: Dict[str, Any] = {}
        for k, v in list(obj.items())[:200]:
            # 常见字段：data/base64，单独更严格一点
            if k in ("data", "image", "base64", "payload") and isinstance(v, str) and len(v) > 512:
                out[k] = v[:256] + f"...[truncated:{len(v)}]"
            else:
                out[k] = _truncate_deep(v, max_str=max_str)
        return out
    return str(obj)


def call_llm_api(llm_config: dict, system_prompt: str, user_input: str, add_log=None):
    """
    调用LLM API（类似 ok-publish 分支的实现）
    直接调用 API，不通过 llm_service
    """
    if add_log:
        add_log(f"🔄 调用LLM API: {llm_config.get('provider', 'unknown')} - {llm_config.get('model', 'unknown')}")
        add_log(f"系统提示词长度: {len(system_prompt)}, 用户输入长度: {len(user_input)}")
        add_log(f"LLM配置详情: provider={llm_config.get('provider')}, model={llm_config.get('model')}, api_url={llm_config.get('api_url', '默认')}, has_api_key={bool(llm_config.get('api_key'))}")

    provider = llm_config.get('provider', '')
    api_key = llm_config.get('api_key', '')
    api_url = llm_config.get('api_url', '')
    model = llm_config.get('model', '')

    # 调试信息：检查必要参数
    if not provider:
        if add_log:
            add_log("❌ LLM配置中缺少provider字段")
        return None

    if not api_key:
        if add_log:
            add_log(f"❌ API密钥为空 (provider: {provider})")
        return None

    if not model:
        if add_log:
            add_log(f"❌ 模型名称为空 (provider: {provider})")
        return None
    
    if provider == 'openai':
        default_url = 'https://api.openai.com/v1/chat/completions'
        url = api_url or default_url
        
        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_input}
            ],
            # 工具选择/结构化输出：尽量稳定
            'temperature': 0.1,
        }
        
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.ok:
            data = response.json()
            content = data['choices'][0]['message']['content']
            if add_log:
                add_log(f"✅ OpenAI API调用成功，返回内容长度: {len(content or '')}")
            return content
        else:
            if add_log:
                add_log(f"❌ OpenAI API调用失败: {response.status_code} - {response.text[:200]}...")
            return None
            
    elif provider == 'anthropic':
        default_url = 'https://api.anthropic.com/v1/messages'
        url = api_url or default_url
        
        payload = {
            'model': model,
            'max_tokens': 4096,
            'messages': [
                {'role': 'user', 'content': f"{system_prompt}\n\n用户输入: {user_input}"}
            ],
        }
        
        headers = {
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.ok:
            data = response.json()
            content = data['content'][0]['text']
            if add_log:
                add_log(f"✅ Anthropic API调用成功，返回内容长度: {len(content or '')}")
            return content
        else:
            if add_log:
                add_log(f"❌ Anthropic API调用失败: {response.status_code} - {response.text[:200]}...")
            return None
            
    elif provider == 'gemini':
        default_url = 'https://generativelanguage.googleapis.com/v1beta'
        base_url = api_url or default_url
        model_name = model or 'gemini-2.5-flash'
        
        # 构建完整的 API URL
        if base_url.endswith('/'):
            url = f"{base_url}models/{model_name}:generateContent"
        else:
            url = f"{base_url}/models/{model_name}:generateContent"
        
        # 转换消息格式为 Gemini 格式
        contents = [
            {
                'role': 'user',
                'parts': [{'text': f"{system_prompt}\n\n用户输入: {user_input}"}]
            }
        ]
        
        payload = {
            'contents': contents,
            'generationConfig': {
                # 工具选择/结构化输出：尽量稳定
                'temperature': 0.1,
            },
        }
        
        # 只在metadata中明确指定thinking_level时才添加（某些模型不支持此字段）
        if llm_config.get('metadata') and llm_config['metadata'].get('thinking_level'):
            payload['generationConfig']['thinkingLevel'] = llm_config['metadata']['thinking_level']
        
        headers = {
            'x-goog-api-key': api_key,
            'Content-Type': 'application/json',
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.ok:
            data = response.json()
            if data.get('candidates') and len(data['candidates']) > 0:
                candidate = data['candidates'][0]
                if candidate.get('content') and candidate['content'].get('parts'):
                    # 提取所有文本内容
                    text_parts = [part.get('text', '') for part in candidate['content']['parts'] if part.get('text')]
                    content = ''.join(text_parts)
                    if add_log:
                        add_log(f"✅ Gemini API调用成功，返回内容长度: {len(content or '')}")
                    return content
            if add_log:
                add_log("❌ Gemini API返回数据格式错误")
            return None
        else:
            if add_log:
                try:
                    error_data = response.json() if response.content else {}
                    error_msg = error_data.get('error', {}).get('message', response.text)
                except:
                    error_msg = response.text[:200]
                add_log(f"❌ Gemini API调用失败: {response.status_code} - {error_msg}")
            return None
    else:
        if add_log:
            add_log(f"❌ 不支持的LLM提供商: {provider}")
        return None


def execute_mcp_with_llm(
    *,
    mcp_server_id: str,
    input_text: str,
    llm_config_id: str,
    add_log: Optional[callable] = None,
    max_iterations: int = 3,
    topic_id: Optional[str] = None,
    existing_session_id: Optional[str] = None,
    agent_system_prompt: Optional[str] = None,  # Agent 的人设/系统提示词
) -> Dict[str, Any]:
    """
    执行 MCP：由 LLM 决定 tool_calls，然后逐个调用 MCP tool。
    
    Args:
        agent_system_prompt: Agent 的人设，会作为系统提示词的一部分

    Returns:
      {
        "summary": str | None,
        "raw_result": dict | None,
        "logs": list[str],
        "error": str | None,
        "llm_response": str | None,
      }
    """
    # ANSI 颜色码
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    MAGENTA = '\033[95m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
    
    print(f"{MAGENTA}{BOLD}[MCP EXEC] ========== execute_mcp_with_llm 开始 =========={RESET}")
    print(f"{MAGENTA}[MCP EXEC] Server: {mcp_server_id}, LLM: {llm_config_id}{RESET}")
    print(f"{MAGENTA}[MCP EXEC] Input 长度: {len(input_text) if input_text else 0} 字符{RESET}")
    
    logs, log = _mk_logger(add_log)

    try:
        # 去掉 AgentActor 注入的“工具使用权提示”，避免污染 LLM 决策输入
        effective_input = re.sub(r"^\[你已获得工具使用权：.*?\]\s*", "", input_text or "").strip()
        if not effective_input:
            effective_input = input_text or ""

        conn = get_mysql_connection()
        if not conn:
            return {"error": "MySQL not available", "logs": logs}

        cursor = None
        try:
            import pymysql

            cursor = conn.cursor(pymysql.cursors.DictCursor)

            # 获取LLM配置（包括加密的API key）
            log(f"获取LLM配置: {llm_config_id}")
            cursor.execute(
                """
                SELECT config_id, provider, api_key, api_url, model, enabled, metadata
                FROM llm_configs
                WHERE config_id = %s AND enabled = 1
                """,
                (llm_config_id,),
            )
            llm_config = cursor.fetchone()

            if not llm_config:
                log(f"❌ LLM配置不存在或已禁用: {llm_config_id}")
                # 调试：检查数据库中是否有其他可用的配置
                cursor.execute("SELECT config_id, provider, model, enabled FROM llm_configs")
                all_configs = cursor.fetchall()
                log(f"数据库中的所有LLM配置: {[(c['config_id'], c['provider'], c['model'], c['enabled']) for c in all_configs]}")
                return {"error": "LLM config not found or disabled", "logs": logs}

            # 解析 metadata（如果是 JSON 字符串）
            if llm_config.get('metadata') and isinstance(llm_config['metadata'], str):
                try:
                    llm_config['metadata'] = json.loads(llm_config['metadata'])
                except Exception as e:
                    log(f"⚠️ LLM配置metadata解析失败: {e}")
                    llm_config['metadata'] = {}

            log(f"✅ LLM配置获取成功: {llm_config['provider']} - {llm_config['model']}")
            log(f"   配置ID: {llm_config['config_id']}")
            log(f"   API URL: {llm_config.get('api_url', '默认')}")
            log(f"   API Key: {'已设置' if llm_config.get('api_key') else '❌ 未设置'}")
            log(f"   Metadata: {llm_config.get('metadata', {})}")

            # 验证LLM配置的完整性
            missing_fields = []
            if not llm_config.get('provider'):
                missing_fields.append('provider')
            if not llm_config.get('model'):
                missing_fields.append('model')
            if not llm_config.get('api_key'):
                missing_fields.append('api_key')

            if missing_fields:
                error_msg = f"LLM配置不完整，缺少字段: {', '.join(missing_fields)}"
                log(f"❌ {error_msg}")
                return {"error": error_msg, "logs": logs}

            # MCP server
            log(f"获取MCP服务器配置: {mcp_server_id}")
            cursor.execute(
                """
                SELECT server_id, name, url, enabled
                FROM mcp_servers
                WHERE server_id = %s AND enabled = 1
                """,
                (mcp_server_id,),
            )
            mcp_server = cursor.fetchone()
            if not mcp_server:
                return {"error": "MCP server not found or disabled", "logs": logs}

            server_name = mcp_server.get("name") or mcp_server_id
            server_url = mcp_server.get("url")
            log(f"MCP服务器配置获取成功: {server_name} ({server_url})")

            # ==================== 使用 mcp_common_logic 直接调用 MCP（类似 ok-publish） ====================
            # 1. 准备请求头（包括 OAuth token 等）
            base_headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'mcp-protocol-version': '2025-06-18',
            }
            headers = prepare_mcp_headers(server_url, base_headers, base_headers)
            
            # 1.5 如果有 existing_session_id，复用已有会话（重要：某些 MCP 服务器要求保持会话连续性）
            if existing_session_id:
                headers['mcp-session-id'] = existing_session_id
                log(f"复用已有 MCP session: {existing_session_id[:16]}...")
            
            # 2. 初始化 MCP 会话（仅当没有 session_id 时）
            if 'mcp-session-id' not in headers:
                init_response = initialize_mcp_session(server_url, headers)
                if not init_response:
                    log("⚠️ MCP initialize 失败，但继续尝试获取工具列表")
                else:
                    log(f"MCP 会话初始化成功，session_id: {headers.get('mcp-session-id', 'N/A')[:16]}...")
            else:
                log(f"跳过 MCP 会话初始化，使用已有 session_id")
            
            # 3. 获取工具列表
            log("Step 2/3: tools/list")
            # Actor 场景优先不走缓存：避免 tools/list 的短期缓存掩盖 session-id/权限变更
            tools_response = get_mcp_tools_list(server_url, headers, use_cache=False)
            if not tools_response or 'result' not in tools_response:
                return {
                    "error": "Failed to get MCP tools list",
                    "logs": logs,
                    "debug": {
                        "server_url": server_url,
                        "mcp_session_id": headers.get("mcp-session-id"),
                        "tools_response_preview": _truncate_deep(tools_response, max_str=1200),
                    },
                }

            tools = tools_response['result'].get('tools', [])
            if not tools:
                return {
                    "error": "No tools available from MCP server",
                    "logs": logs,
                }

            log(f"获取到 {len(tools)} 个可用工具")
            print(f"{GREEN}[MCP EXEC] ✅ 获取到 {len(tools)} 个工具{RESET}")
            # 详细日志：显示所有工具列表
            all_tool_names = [t.get('name', 'unnamed') for t in tools]
            log(f"  可用工具: {', '.join(all_tool_names)}")
            print(f"{CYAN}[MCP EXEC] 所有工具: {', '.join(all_tool_names)}{RESET}")
            
            # 打印当前 session_id 状态（调试用）
            current_session_id = headers.get('mcp-session-id')
            if current_session_id:
                log(f"  当前 MCP Session ID: {current_session_id[:16]}...")
            else:
                log(f"  ⚠️ 警告：无 MCP Session ID（某些服务器可能要求）")

            # 构建工具描述（包含完整的参数 schema）
            def _format_tool_params(schema: Dict[str, Any]) -> str:
                """格式化工具参数为易读的描述"""
                if not schema or not isinstance(schema, dict):
                    return "  参数: 无"
                
                props = schema.get("properties", {})
                required = schema.get("required", [])
                
                if not props:
                    return "  参数: 无"
                
                lines = []
                for param_name, param_info in props.items():
                    param_type = param_info.get("type", "string")
                    param_desc = param_info.get("description", "")
                    is_required = param_name in required
                    req_mark = "*必需*" if is_required else "可选"
                    lines.append(f"    - {param_name} ({param_type}, {req_mark}): {param_desc}")
                
                return "  参数:\n" + "\n".join(lines)
            
            tools_description_parts = []
            for t in tools:
                name = t.get('name', '')
                desc = t.get('description', '')
                schema = t.get("inputSchema") or t.get("input_schema") or t.get("parameters") or {}
                params_desc = _format_tool_params(schema)
                tools_description_parts.append(f"【{name}】\n  描述: {desc}\n{params_desc}")
            
            tools_description = '\n\n'.join(tools_description_parts)
            
            # 构建工具名称映射（用于验证）
            tool_name_map: Dict[str, Dict[str, Any]] = {}
            for t in tools:
                tool_name = t.get('name', '').strip()
                if tool_name:
                    schema = t.get("inputSchema") or t.get("input_schema") or t.get("parameters") or {}
                    props = {}
                    required = []
                    if isinstance(schema, dict):
                        props = schema.get("properties") or {}
                        required = schema.get("required") or []
                    tool_name_map[tool_name.lower()] = {
                        'name': tool_name,
                        'description': t.get('description', '').strip(),
                        'schema': schema,
                        'props': props if isinstance(props, dict) else {},
                        'required': required if isinstance(required, list) else [],
                    }

            # 系统提示词：Agent 人设 + 工具调度原则
            system_prompt_parts = []
            
            # 1. Agent 的人设（如果有）
            if agent_system_prompt:
                system_prompt_parts.append(agent_system_prompt)
                system_prompt_parts.append("")  # 空行分隔
            
            # 2. 工具调度原则
            system_prompt_parts.append("""## 工具调度能力

你可以使用工具来完成用户的请求。根据用户需求，从可用工具中选择最合适的工具并调用。

### ⚠️ 重要：返回格式要求

**你必须严格按照以下JSON格式返回，不要包含任何其他文字、解释或markdown代码块。**

当需要调用工具时，只返回这个JSON格式：
```json
{
  "tool_calls": [
    {
      "name": "工具名称（必须完全匹配可用工具中的名称）",
      "arguments": {"参数名": "参数值", "必需参数2": "值2"}
    }
  ],
  "done": true
}
```

如果不需要调用工具，只返回：
```json
{
  "tool_calls": [],
  "done": true
}
```

**示例：**
- 调用 search_feeds 工具：`{"tool_calls": [{"name": "search_feeds", "arguments": {"query": "关键词"}}], "done": true}`
- 调用 get_feed_detail 工具：`{"tool_calls": [{"name": "get_feed_detail", "arguments": {"feed_id": "123"}}], "done": true}`

**注意：**
1. 只输出JSON，不要有任何前缀、后缀、解释文字
2. 工具名称必须完全匹配列表中的名称
3. arguments必须是有效的JSON对象
4. done字段表示是否完成任务""")
            
            system_prompt = "\n".join(system_prompt_parts)
            
            print(f"{CYAN}[MCP EXEC] 系统提示词长度: {len(system_prompt)} 字符{RESET}")
            
            # 用户消息：历史 + 当前请求 + 工具列表
            user_message_parts = []
            
            # 从 effective_input 中提取历史和当前请求
            # effective_input 格式可能是：【对话历史】...【当前请求】...
            user_message_parts.append(effective_input)
            
            # 添加完整的工具列表
            user_message_parts.append(f"\n\n## 可用工具列表（共 {len(tools)} 个）\n")
            user_message_parts.append(tools_description)
            user_message_parts.append("\n\n请根据上述请求选择最合适的工具并返回 JSON。")
            
            user_input_for_llm = "".join(user_message_parts)
            
            print(f"{CYAN}[MCP EXEC] 用户消息长度: {len(user_input_for_llm)} 字符{RESET}")

            # 让同一个 llm_config 决定 tool_calls（支持多轮“连续调用”）
            # 注意：不同模型对“严格输出 JSON”能力差异很大（尤其 Gemini/轻量模型）。
            # 这里不做“自动猜工具”的 fallback：必须由 LLM 决定 tool_calls；若失败则返回 error。
            def _schema_props(t: Dict[str, Any]) -> Dict[str, Any]:
                schema = t.get("inputSchema") or t.get("input_schema") or t.get("parameters") or {}
                if isinstance(schema, dict):
                    props = schema.get("properties") or {}
                    return props if isinstance(props, dict) else {}
                return {}

            def _default_args_for_tool(t: Dict[str, Any], text: str) -> Dict[str, Any]:
                props = _schema_props(t)
                if "input" in props:
                    return {"input": text}
                if "query" in props:
                    return {"query": text}
                if "text" in props:
                    return {"text": text}
                if len(props) == 1:
                    k = next(iter(props.keys()))
                    return {k: text}
                # 无 schema / schema 不明确：兜底用 input
                return {"input": text}

            def _infer_next_tool_from_context(
                user_input: str,
                prior_results: str,
                tool_list: List[Dict[str, Any]],
                executed_results: List[Dict[str, Any]],
                tool_map: Dict[str, Dict[str, Any]]
            ) -> Optional[Dict[str, Any]]:
                """
                根据已执行结果和用户输入推断下一步应该调用的工具
                
                策略：
                1. 如果之前的工具执行有错误，不再继续
                2. 如果之前的结果中有明确的"下一步"提示，尝试解析
                3. 如果用户输入包含多个意图，尝试找到尚未执行的工具
                """
                # 检查是否有执行失败的结果
                for r in executed_results:
                    if r.get('error'):
                        return None  # 有错误，不再继续
                
                # 提取已执行的工具名称
                executed_tool_names = set()
                for r in executed_results:
                    tool_name = r.get('tool')
                    if tool_name:
                        executed_tool_names.add(tool_name.lower())
                
                # 找到尚未执行的相关工具
                user_lower = user_input.lower()
                tokens = [w for w in re.split(r"[^a-z0-9\u4e00-\u9fff]+", user_lower) if w]
                
                best_candidate = None
                best_score = 0
                
                for t in tool_list:
                    tool_name = t.get('name', '').lower()
                    if tool_name in executed_tool_names:
                        continue  # 已执行过，跳过
                    
                    # 计算相关性得分
                    hay = f"{t.get('name','')} {t.get('description','')}".lower()
                    score = 0
                    for w in tokens[:12]:
                        if w and w in hay:
                            score += 1
                    
                    # 如果得分足够高（至少有2个关键词匹配），考虑作为候选
                    if score >= 2 and score > best_score:
                        best_score = score
                        best_candidate = t
                
                if best_candidate:
                    tool_name = best_candidate.get('name', '')
                    # 构建参数
                    args = _default_args_for_tool(best_candidate, user_input)
                    return {"name": tool_name, "arguments": args}
                
                return None

            all_tool_calls: List[Dict[str, Any]] = []
            results: List[Dict[str, Any]] = []
            seen_signatures: set[str] = set()
            executed_tool_names: set[str] = set()  # 记录已执行的工具名

            log("Step 3/3: tools/call (iterative)")
            for it in range(max(1, int(max_iterations or 1))):
                # 构造迭代提示：附带已执行工具的"可读输出"，让模型决定是否继续调用
                prior_texts = []
                for r in results[-6:]:
                    if r.get("tool") and r.get("tool_text"):
                        prior_texts.append(f"【{r['tool']}】执行结果:\n{r['tool_text']}")
                prior_block = ("\n\n".join(prior_texts)).strip()

                # 构建已执行工具列表
                executed_tools_str = ", ".join(executed_tool_names) if executed_tool_names else "无"

                if it == 0:
                    # 首轮：简单提示
                    iter_system = system_prompt + "\n\n请分析用户需求，选择最合适的工具。只返回JSON格式。"
                else:
                    # 后续轮次：强调不要重复调用
                    iter_system = system_prompt + f"""

## 当前状态

- 已执行工具: {executed_tools_str}
- 这是第 {it+1} 轮决策

## 决策规则

1. **不要重复调用已执行过的工具**（除非有明确的新参数）
2. 如果用户的需求已被满足，返回 {{"tool_calls": [], "done": true}}
3. 只有在确实需要新信息时才调用新工具"""

                # 构建用户消息：历史 + 请求 + 工具列表 + 已执行结果
                iter_user = user_input_for_llm
                if prior_block:
                    iter_user += f"\n\n=== 已执行工具的结果 ===\n{prior_block}\n\n请根据以上结果决定是否需要调用更多工具，或者任务已完成。"

                tool_calls: List[Dict[str, Any]] = []
                llm_text: str = ""
                done_flag = False
                def _parse_llm_tool_calls(raw_text: str) -> Tuple[List[Dict[str, Any]], bool, Optional[str]]:
                    """
                    尽量鲁棒地从 LLM 输出中解析出 JSON（支持 ```json 代码块、前后缀文本）。
                    只要能解析到包含 tool_calls 的 JSON 对象即可。
                    """
                    if not raw_text:
                        return [], False, "empty llm output"

                    txt = (raw_text or "").strip()

                    # 去掉 markdown code fence（常见：```json ... ```）
                    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", txt, re.IGNORECASE)
                    if fence_match:
                        txt = fence_match.group(1).strip()

                    # 兼容智能引号
                    txt = (
                        txt.replace("\u201c", "\"")
                        .replace("\u201d", "\"")
                        .replace("\u2018", "'")
                        .replace("\u2019", "'")
                    )

                    def _extract_json_objects(s: str) -> List[str]:
                        objs: List[str] = []
                        depth = 0
                        start = None
                        for i, ch in enumerate(s):
                            if ch == "{":
                                if depth == 0:
                                    start = i
                                depth += 1
                            elif ch == "}":
                                if depth > 0:
                                    depth -= 1
                                    if depth == 0 and start is not None:
                                        objs.append(s[start : i + 1])
                                        start = None
                        return objs

                    candidates = _extract_json_objects(txt)
                    if not candidates:
                        return [], False, "no json object found in llm output"

                    last_err: Optional[str] = None
                    for cand in candidates:
                        try:
                            data = json.loads(cand)
                            if not isinstance(data, dict):
                                continue
                            tc = data.get("tool_calls", [])
                            parsed_calls: List[Dict[str, Any]] = tc if isinstance(tc, list) else []
                            parsed_done = bool(data.get("done")) if "done" in data else False
                            # 必须至少包含 tool_calls 字段（允许空数组表示 done）
                            if "tool_calls" in data:
                                return parsed_calls, parsed_done, None
                        except Exception as e:
                            last_err = f"{type(e).__name__}: {str(e)}"
                            continue

                    # Fallback: 尝试更激进的JSON提取
                    # 查找包含 "tool_calls" 的JSON片段
                    fallback_candidates = []
                    tool_calls_pattern = re.compile(r'["\']tool_calls["\']\s*:\s*\[', re.IGNORECASE)
                    for match in tool_calls_pattern.finditer(txt):
                        start_pos = match.start()
                        # 从匹配位置向前查找JSON开始
                        brace_count = 0
                        json_start = -1
                        for i in range(start_pos, -1, -1):
                            if txt[i] == '{':
                                brace_count += 1
                                if brace_count == 1:
                                    json_start = i
                                    break
                            elif txt[i] == '}':
                                brace_count -= 1

                        if json_start >= 0:
                            # 从json_start开始提取完整的JSON对象
                            depth = 0
                            for i in range(json_start, len(txt)):
                                if txt[i] == '{':
                                    depth += 1
                                elif txt[i] == '}':
                                    depth -= 1
                                    if depth == 0:
                                        candidate = txt[json_start:i+1]
                                        fallback_candidates.append(candidate)
                                        break

                    # 尝试解析fallback候选
                    for cand in fallback_candidates:
                        try:
                            data = json.loads(cand)
                            if isinstance(data, dict) and "tool_calls" in data:
                                tc = data.get("tool_calls", [])
                                parsed_calls: List[Dict[str, Any]] = tc if isinstance(tc, list) else []
                                parsed_done = bool(data.get("done")) if "done" in data else False
                                return parsed_calls, parsed_done, None
                        except Exception as e:
                            continue

                    return [], False, last_err or "json parse failed"

                def _decide_with_llm(system_text: str, user_text: str, round_label: str) -> Tuple[List[Dict[str, Any]], bool, str, Optional[str]]:
                    out_text = ""
                    calls: List[Dict[str, Any]] = []
                    done: bool = False
                    parse_err: Optional[str] = None
                    try:
                        log(f"{round_label}：使用LLM决定下一步工具调用")
                        log(f"   LLM配置ID: {llm_config_id}")
                        log(f"   LLM配置内容: provider={llm_config.get('provider')}, model={llm_config.get('model')}, has_api_key={bool(llm_config.get('api_key'))}")
                        api_result = call_llm_api(llm_config, system_text, user_text, log)

                        if api_result is None:
                            # LLM API调用失败
                            parse_err = "llm_api_call_failed: API调用返回None，请检查LLM配置、网络连接或API密钥"
                            out_text = ""
                        elif api_result == "":
                            # LLM返回了空字符串
                            parse_err = "llm_returned_empty: LLM返回了空字符串"
                            out_text = ""
                        else:
                            # API调用成功，有返回内容
                            out_text = api_result
                            calls, done, parse_err = _parse_llm_tool_calls(out_text)

                    except Exception as e:
                        log(f"⚠️ {round_label} LLM 决策失败: {str(e)}")
                        parse_err = f"llm_call_failed: {type(e).__name__}: {str(e)}"
                        out_text = ""

                    # 关键调试信息：输出预览 + 解析错误
                    preview = (out_text or "").replace("\n", "\\n")[:600]
                    print(f"{MAGENTA}[MCP EXEC] {round_label} LLM输出预览: {preview}{RESET}")
                    if parse_err:
                        print(f"{YELLOW}[MCP EXEC] {round_label} 错误: {parse_err}{RESET}")

                    return calls, done, out_text, parse_err

                # 第一次决策：必须由 LLM 给出 tool_calls
                tool_calls, done_flag, llm_text, parse_error = _decide_with_llm(
                    iter_system,
                    iter_user,
                    f"第 {it+1}/{max_iterations} 轮",
                )

                # 允许一次重试：如果 LLM 没给出 tool_calls 且也没明确 done=true
                if (not tool_calls) and (not done_flag):
                    retry_system = (
                        system_prompt
                        + "\n\n⚠️ 错误：你上一次没有返回合法的JSON格式。"
                        + "\n\n请重新思考并只返回JSON格式，不要任何其他内容："
                        + "\n- 需要工具：{\"tool_calls\": [{\"name\": \"工具名\", \"arguments\": {...}}], \"done\": true}"
                        + "\n- 不需要工具：{\"tool_calls\": [], \"done\": true}"
                        + "\n\n现在请重新回答，只输出JSON："
                    )
                    tool_calls, done_flag, retry_text, retry_parse_error = _decide_with_llm(
                        retry_system,
                        iter_user,
                        f"第 {it+1}/{max_iterations} 轮（重试1次）",
                    )
                    if retry_text:
                        llm_text = retry_text
                        parse_error = retry_parse_error

                if not tool_calls:
                    if done_flag:
                        break

                    # 根据错误类型提供不同的错误信息
                    if parse_error and ("llm_api_call_failed" in parse_error or "llm_call_failed" in parse_error):
                        # API调用失败
                        error_msg = "LLM API调用失败"
                        suggestion = "请检查：1) LLM配置是否正确 2) API密钥是否有效 3) 网络连接是否正常 4) API额度是否充足"
                    elif parse_error and "llm_returned_empty" in parse_error:
                        # LLM返回空内容
                        error_msg = "LLM返回了空内容"
                        suggestion = "LLM可能不支持当前的任务，或遇到了内部错误。请尝试更换LLM模型或简化输入。"
                    else:
                        # JSON解析失败
                        error_msg = "LLM未返回有效的tool_calls JSON格式"
                        suggestion = "LLM可能没有理解JSON格式要求，或返回了普通文本。请检查LLM模型是否支持结构化输出，或调整系统提示词。"

                    error_details = {
                        "error": error_msg,
                        "logs": logs,
                        "llm_response": llm_text,
                        "debug": {
                            "llm_parse_error": parse_error,
                            "llm_output_length": len(llm_text or ""),
                            "available_tools": [t.get('name', '') for t in tools[:5]],  # 只显示前5个工具避免日志过长
                            "iteration": it + 1,
                            "suggestion": suggestion
                        },
                    }

                    # 记录详细的错误信息到日志
                    log(f"❌ LLM 工具调用失败：{parse_error}")
                    log(f"LLM 输出长度: {len(llm_text or '')} 字符")
                    log(f"LLM 输出预览: {(llm_text or '')[:200]}...")
                    if len(llm_text or '') > 200:
                        log(f"... (省略 {len(llm_text or '') - 200} 字符)")

                    return error_details

                # 执行本轮 tool_calls
                log(f"第 {it+1} 轮：执行 {len(tool_calls)} 个工具调用")
                for i, tc in enumerate(tool_calls[:5]):  # 每轮最多 5 个，避免失控
                    tool_name = (tc or {}).get("name")
                    tool_args = (tc or {}).get("arguments", {}) or {}
                    if not tool_name:
                        continue
                    
                    # 验证工具名称是否真实存在
                    tool_name_lower = tool_name.lower()
                    if tool_name_lower not in tool_name_map:
                        # 尝试模糊匹配
                        matched_tool = None
                        for actual_name, tool_info in tool_name_map.items():
                            if tool_name_lower in actual_name or actual_name in tool_name_lower:
                                matched_tool = tool_info
                                tool_name = tool_info['name']  # 使用真实的工具名称
                                log(f"工具名称修正: {tc.get('name')} -> {tool_name}")
                                break
                        
                        if not matched_tool:
                            error_msg = f"工具 '{tool_name}' 不存在。可用工具: {', '.join([t['name'] for t in tools[:10]])}"
                            log(f"❌ {error_msg}")
                            results.append({"tool": tool_name, "error": error_msg})
                            continue
                    
                    # 验证参数是否符合工具schema
                    tool_info = tool_name_map.get(tool_name_lower)
                    if tool_info:
                        props = tool_info.get('props', {})
                        schema = tool_info.get('schema', {})
                        required_params = schema.get('required', []) if isinstance(schema, dict) else []
                        
                        # 检查必需参数
                        missing_required = [p for p in required_params if p not in tool_args]
                        if missing_required:
                            log(f"⚠️ 工具 {tool_name} 缺少必需参数: {missing_required}")
                            # 尝试使用默认值填充
                            for param in missing_required:
                                if param in props:
                                    param_info = props[param]
                                    default_val = param_info.get('default')
                                    if default_val is not None:
                                        tool_args[param] = default_val
                                        log(f"  使用默认值填充 {param}: {default_val}")
                                    elif 'input' in props:
                                        tool_args[param] = effective_input
                                    else:
                                        tool_args[param] = ""
                        
                        # 移除不在schema中的参数
                        valid_params = set(props.keys())
                        invalid_params = set(tool_args.keys()) - valid_params
                        if invalid_params:
                            log(f"⚠️ 工具 {tool_name} 移除了无效参数: {invalid_params}")
                            tool_args = {k: v for k, v in tool_args.items() if k in valid_params}

                    sig = f"{tool_name}:{json.dumps(tool_args, ensure_ascii=False, sort_keys=True)[:400]}"
                    if sig in seen_signatures:
                        # 防循环
                        log(f"⚠️ 跳过重复的工具调用: {tool_name}")
                        continue
                    seen_signatures.add(sig)

                    # 通用安全拦截：破坏性工具必须用户明确要求
                    destructive_markers = ("delete", "clear", "remove", "logout", "reset", "wipe")
                    user_lower_for_policy = (effective_input or "").lower()
                    user_asked_destructive = any(k in user_lower_for_policy for k in ("删除", "清除", "移除", "登出", "退出登录", "delete", "clear", "remove", "logout", "reset", "wipe"))
                    if (not user_asked_destructive) and any(m in tool_name.lower() for m in destructive_markers):
                        msg = f"Blocked destructive tool call without explicit user request: {tool_name}"
                        log(f"❌ {msg}")
                        results.append({
                            "tool": tool_name,
                            "error": msg,
                            "error_type": "policy",
                        })
                        return {
                            "error": msg,
                            "logs": logs,
                            "results": results,
                        }

                    all_tool_calls.append({"name": tool_name, "arguments": tool_args})
                    log(f"执行工具调用: {tool_name}")
                    log(f"  参数: {json.dumps(tool_args, ensure_ascii=False)[:200]}")
                    
                    print(f"{YELLOW}[MCP EXEC] 🔧 调用工具: {tool_name}{RESET}")
                    print(f"{CYAN}[MCP EXEC]   参数: {json.dumps(tool_args, ensure_ascii=False)[:150]}{RESET}")
                    
                    try:
                        # 使用 mcp_common_logic 直接调用工具
                        print(f"{YELLOW}[MCP EXEC]   → 调用 call_mcp_tool...{RESET}")
                        tool_result = call_mcp_tool(server_url, headers, tool_name, tool_args, log)
                        print(f"{GREEN}[MCP EXEC]   ← call_mcp_tool 返回{RESET}")
                        print(f"{CYAN}[MCP EXEC]   结果类型: {type(tool_result).__name__}, keys: {list(tool_result.keys()) if isinstance(tool_result, dict) else 'N/A'}{RESET}")
                        
                        # 处理新的结构化返回格式
                        if isinstance(tool_result, dict):
                            if tool_result.get('success'):
                                # 成功
                                result_data = tool_result.get('data')
                                result_text = tool_result.get('text')
                                raw_result = tool_result.get('raw_result')
                                
                                results.append({
                                    'tool': tool_name,
                                    'result': {
                                        'jsonrpc': '2.0',
                                        'result': raw_result or {'content': [{'type': 'text', 'text': str(result_data)}]}
                                    },
                                    'tool_text': result_text or str(result_data) if result_data else '',
                                })
                                log(f"✅ 工具 {tool_name} 执行成功")
                                executed_tool_names.add(tool_name.lower())
                            else:
                                # 失败 - 区分错误类型
                                error_type = tool_result.get('error_type', 'unknown')
                                error_msg = tool_result.get('error', '未知错误')
                                error_code = tool_result.get('error_code')
                                http_code = tool_result.get('http_code')
                                
                                if error_type == 'network':
                                    error_display = f"[网络错误] HTTP {http_code}: {error_msg}" if http_code else f"[网络错误] {error_msg}"
                                elif error_type == 'business':
                                    error_display = f"[业务错误] 代码 {error_code}: {error_msg}" if error_code else f"[业务错误] {error_msg}"
                                else:
                                    error_display = f"[{error_type}] {error_msg}"
                                
                                log(f"❌ 工具 {tool_name} 失败: {error_display}")
                                results.append({
                                    "tool": tool_name,
                                    "error": error_display,
                                    "error_type": error_type,
                                    "error_code": error_code,
                                })
                        else:
                            # 兼容旧格式（直接返回结果）
                            if tool_result:
                                results.append({
                                    'tool': tool_name,
                                    'result': {
                                        'jsonrpc': '2.0',
                                        'result': {'content': [{'type': 'text', 'text': str(tool_result)}]}
                                    }
                                })
                                log(f"✅ 工具 {tool_name} 执行成功")
                                executed_tool_names.add(tool_name.lower())
                            else:
                                results.append({"tool": tool_name, "error": "工具返回空结果"})
                                
                    except Exception as e:
                        import traceback
                        log(f"❌ 工具 {tool_name} 执行异常: {str(e)}")
                        results.append({
                            "tool": tool_name,
                            "error": f"执行异常: {str(e)}",
                            "error_type": "exception",
                        })

                if done_flag:
                    break

            # 抽取可读文本输出，给 LLM 作为“事实源”（优化：提取所有可用信息）
            tool_text_outputs: List[str] = []
            try:
                for r in results:
                    tool_resp = r.get("result")
                    tool_name = r.get("tool") or "tool"
                    
                    # 处理错误情况
                    if r.get("error"):
                        error_msg = str(r.get("error", ""))
                        r["tool_text"] = f"错误: {error_msg}"
                        tool_text_outputs.append(f"[{tool_name}] ❌ {error_msg}")
                        continue
                    
                    if not isinstance(tool_resp, dict):
                        # 如果不是 dict，尝试直接转换为字符串
                        if tool_resp:
                            text_block = str(tool_resp).strip()
                            r["tool_text"] = text_block
                            tool_text_outputs.append(f"[{tool_name}]\n{text_block}")
                        continue
                    
                    # 提取 content 中的文本内容
                    content = (tool_resp.get("result") or {}).get("content")
                    texts = []
                    
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict):
                                item_type = item.get("type", "")
                                if item_type == "text" and item.get("text"):
                                    texts.append(str(item.get("text")))
                                elif item_type == "image" and item.get("data"):
                                    # 图片内容：记录为提示
                                    texts.append(f"[图片数据已返回，大小: {len(str(item.get('data', '')))} 字符]")
                                elif item_type:
                                    # 其他类型：尝试提取可读信息
                                    for key in ["text", "content", "message", "data"]:
                                        if item.get(key):
                                            texts.append(f"[{item_type}]: {str(item.get(key))[:500]}")
                                            break
                    
                    # 如果没有从 content 提取到文本，尝试其他字段
                    if not texts:
                        # 尝试直接提取 result 中的文本字段
                        for key in ["text", "message", "content", "output", "data"]:
                            if tool_resp.get("result", {}).get(key):
                                texts.append(str(tool_resp["result"][key]))
                                break
                        # 如果还是没有，尝试整个 result
                        if not texts and tool_resp.get("result"):
                            result_data = tool_resp.get("result")
                            if isinstance(result_data, str):
                                texts.append(result_data)
                            elif isinstance(result_data, dict):
                                # 尝试序列化为 JSON（但限制长度）
                                try:
                                    result_json = json.dumps(result_data, ensure_ascii=False)
                                    if len(result_json) < 2000:
                                        texts.append(result_json)
                                    else:
                                        texts.append(result_json[:2000] + "...[已截断]")
                                except:
                                    texts.append(str(result_data)[:1000])
                    
                    if texts:
                        text_block = ("\n".join(texts)).strip()
                        r["tool_text"] = text_block
                        tool_text_outputs.append(f"[{tool_name}]\n{text_block}")
                    else:
                        # 如果完全没有文本，至少记录工具已执行
                        r["tool_text"] = f"工具 {tool_name} 已执行，但未返回文本内容"
                        tool_text_outputs.append(f"[{tool_name}] 已执行（无文本返回）")
            except Exception as e:
                import traceback
                traceback.print_exc()
                # 即使提取失败，也不影响整体流程
                pass

            tool_names = [r.get("tool") for r in results if r.get("tool")]
            tool_names_text = ", ".join(tool_names[:8]) + ("..." if len(tool_names) > 8 else "")
            summary = f'✅ MCP "{server_name}" 执行完成（{len(results)} 个工具调用：{tool_names_text}）'

            raw_result = {
                "mcp_server_id": mcp_server_id,
                "mcp_server_name": server_name,
                "mcp_server_url": server_url,
                "input": effective_input,
                "tool_calls": all_tool_calls,
                "results": results,  # results[i].result 保留原始 MCP jsonrpc（含 base64 图片）
            }

            return {
                "summary": summary,
                "tool_text": "\n\n".join(tool_text_outputs).strip() if tool_text_outputs else None,
                "results": results,  # 顶层也暴露 results，便于错误处理
                "raw_result": raw_result,
                "raw_result_compact": _truncate_deep(raw_result),
                "logs": logs,
            }

        finally:
            if cursor:
                cursor.close()
            conn.close()

    except Exception as e:
        return {"error": str(e), "logs": logs}

