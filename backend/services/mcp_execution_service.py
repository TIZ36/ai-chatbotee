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
        add_log(f"调用LLM API: {llm_config['provider']} - {llm_config['model']}")
    
    provider = llm_config['provider']
    api_key = llm_config.get('api_key', '')
    api_url = llm_config.get('api_url', '')
    model = llm_config.get('model', '')
    
    if provider == 'openai':
        default_url = 'https://api.openai.com/v1/chat/completions'
        url = api_url or default_url
        
        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_input}
            ],
            'temperature': 0.7,
        }
        
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }
        
        response = requests.post(url, json=payload, headers=headers, timeout=60)
        if response.ok:
            data = response.json()
            return data['choices'][0]['message']['content']
        else:
            if add_log:
                add_log(f"❌ LLM API调用失败: {response.status_code} - {response.text}")
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
            return data['content'][0]['text']
        else:
            if add_log:
                add_log(f"❌ LLM API调用失败: {response.status_code} - {response.text}")
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
                'temperature': 1.0,  # Gemini 推荐使用默认温度
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
                    return ''.join(text_parts)
            return None
        else:
            if add_log:
                error_data = response.json() if response.content else {}
                error_msg = error_data.get('error', {}).get('message', response.text)
                add_log(f"❌ LLM API调用失败: {response.status_code} - {error_msg}")
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
) -> Dict[str, Any]:
    """
    执行 MCP：由 LLM 决定 tool_calls，然后逐个调用 MCP tool。

    Returns:
      {
        "summary": str | None,
        "raw_result": dict | None,
        "logs": list[str],
        "error": str | None,
        "llm_response": str | None,
      }
    """
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
                return {"error": "LLM config not found or disabled", "logs": logs}
            
            # 解析 metadata（如果是 JSON 字符串）
            if llm_config.get('metadata') and isinstance(llm_config['metadata'], str):
                try:
                    llm_config['metadata'] = json.loads(llm_config['metadata'])
                except:
                    llm_config['metadata'] = {}
            
            log(f"LLM配置获取成功: {llm_config['provider']} - {llm_config['model']}")

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
                'Accept': 'application/json',
                'mcp-protocol-version': '2025-06-18',
            }
            headers = prepare_mcp_headers(server_url, base_headers, base_headers)
            
            # 2. 初始化 MCP 会话（如果需要）
            init_response = initialize_mcp_session(server_url, headers)
            if not init_response:
                log("⚠️ MCP initialize 失败，但继续尝试获取工具列表")
            
            # 3. 获取工具列表
            log("Step 2/3: tools/list")
            tools_response = get_mcp_tools_list(server_url, headers)
            if not tools_response or 'result' not in tools_response:
                return {"error": "Failed to get MCP tools list", "logs": logs}

            tools = tools_response['result'].get('tools', [])
            if not tools:
                return {
                    "error": "No tools available from MCP server",
                    "logs": logs,
                }

            log(f"获取到 {len(tools)} 个可用工具")

            # 构建工具描述（简化版，类似 ok-publish）
            tools_description = '\n'.join([
                f"- {t.get('name', '')}: {t.get('description', '')}"
                for t in tools
            ])
            
            # 构建工具名称映射（用于验证）
            tool_name_map: Dict[str, Dict[str, Any]] = {}
            for t in tools:
                tool_name = t.get('name', '').strip()
                if tool_name:
                    schema = t.get("inputSchema") or t.get("input_schema") or t.get("parameters") or {}
                    props = {}
                    if isinstance(schema, dict):
                        props = schema.get("properties") or {}
                    tool_name_map[tool_name.lower()] = {
                        'name': tool_name,
                        'description': t.get('description', '').strip(),
                        'schema': schema,
                        'props': props if isinstance(props, dict) else {},
                    }

            system_prompt = f"""你是一个智能助手，可以使用以下MCP工具帮助用户：
{tools_description}

请分析用户的输入，决定需要调用哪些工具，并返回JSON格式的工具调用信息。
格式：
{{
  "tool_calls": [
    {{
      "name": "工具名称",
      "arguments": {{"参数名": "参数值"}}
    }}
  ]
}}

只返回JSON，不要其他内容。"""

            # 让同一个 llm_config 决定 tool_calls（支持多轮“连续调用”）
            # 注意：不同模型对“严格输出 JSON”能力差异很大（尤其 Gemini/轻量模型）。
            # 因此这里必须提供稳定的 fallback：LLM 失败/JSON 解析失败时，仍能直接调用一个最可能的工具。
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

            def _pick_best_tool(text: str, tool_list: List[Dict[str, Any]]) -> Dict[str, Any]:
                q = (text or "").lower()
                tokens = [w for w in re.split(r"[^a-z0-9\u4e00-\u9fff]+", q) if w]
                best = tool_list[0]
                best_score = -1
                for t in tool_list:
                    hay = f"{t.get('name','')} {t.get('description','')}".lower()
                    score = 0
                    for w in tokens[:12]:
                        if w and w in hay:
                            score += 2
                    if "login" in q and "login" in hay:
                        score += 5
                    if score > best_score:
                        best_score = score
                        best = t
                return best

            all_tool_calls: List[Dict[str, Any]] = []
            results: List[Dict[str, Any]] = []
            seen_signatures: set[str] = set()

            log("Step 3/3: tools/call (iterative)")
            for it in range(max(1, int(max_iterations or 1))):
                # 构造迭代提示：附带已执行工具的“可读输出”，让模型决定是否继续调用
                prior_texts = []
                for r in results[-6:]:
                    if r.get("tool") and r.get("tool_text"):
                        prior_texts.append(f"[{r['tool']}]\n{r['tool_text']}")
                prior_block = ("\n\n".join(prior_texts)).strip()

                iter_system = (
                    system_prompt
                    + "\n\n你可以分多步调用工具直到满足用户需求。"
                    + "每轮你必须返回严格 JSON："
                    + "{\"tool_calls\":[{\"name\":\"...\",\"arguments\":{...}}],\"done\":true|false}"
                    + "\n- done=true 表示不需要再调用工具。"
                    + "\n- 如果需要继续，请给出下一步 tool_calls。"
                )
                iter_user = effective_input
                if prior_block:
                    iter_user += "\n\n=== 已执行工具输出（可继续基于此决策）===\n" + prior_block

                tool_calls: List[Dict[str, Any]] = []
                llm_text: str = ""
                done_flag = False
                try:
                    log(f"第 {it+1}/{max_iterations} 轮：使用LLM决定下一步工具调用: {llm_config_id}")
                    # 直接调用 LLM API（类似 ok-publish）
                    llm_text = call_llm_api(llm_config, iter_system, iter_user, log)
                    if llm_text:
                        json_match = re.search(r'\{.*\}', llm_text, re.DOTALL)
                        if json_match:
                            data = json.loads(json_match.group())
                            tc = data.get("tool_calls", [])
                            if isinstance(tc, list):
                                tool_calls = tc
                            done_flag = bool(data.get("done")) if "done" in data else False
                except Exception as e:
                    log(f"⚠️ 第 {it+1} 轮 LLM 决策失败: {str(e)}")

                if not tool_calls:
                    if it == 0 and not results:
                        # 首轮兜底：选一个最可能工具直接调用一次
                        picked = _pick_best_tool(effective_input, tools)
                        picked_name = picked.get("name") or ""
                        if not picked_name:
                            return {"error": "No valid tool name from MCP tools list", "logs": logs}
                        picked_args = _default_args_for_tool(picked, effective_input)
                        tool_calls = [{"name": picked_name, "arguments": picked_args}]
                        log(f"Fallback 选择工具: {picked_name}，参数键推断: {list(picked_args.keys())}")
                    else:
                        # 没有下一步：停止
                        break

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

                    all_tool_calls.append({"name": tool_name, "arguments": tool_args})
                    log(f"执行工具调用: {tool_name} (参数: {list(tool_args.keys())})")
                    try:
                        # 使用 mcp_common_logic 直接调用工具（类似 ok-publish）
                        tool_result = call_mcp_tool(server_url, headers, tool_name, tool_args, log)
                        if tool_result:
                            # call_mcp_tool 返回的是工具结果内容（可能是文本或字典）
                            # 需要包装成标准格式，与 ok-publish 一致
                            if isinstance(tool_result, dict):
                                # 如果已经是字典，直接使用
                                results.append({
                                    'tool': tool_name,
                                    'result': tool_result
                                })
                            else:
                                # 如果是文本，包装成标准格式
                                results.append({
                                    'tool': tool_name,
                                    'result': {
                                        'jsonrpc': '2.0',
                                        'result': {
                                            'content': [
                                                {'type': 'text', 'text': str(tool_result)}
                                            ]
                                        }
                                    }
                                })
                            log(f"✅ 工具 {tool_name} 执行成功")
                        else:
                            results.append({"tool": tool_name, "error": "工具返回空结果"})
                    except Exception as e:
                        import traceback
                        log(f"❌ 工具 {tool_name} 执行异常: {str(e)}\n{traceback.format_exc()}")
                        results.append({"tool": tool_name, "error": str(e)})

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

