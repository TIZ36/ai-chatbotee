"""
MCP 执行服务（供 AgentActor/接口复用）

目标：
- 给定 mcp_server_id + 用户输入 + llm_config_id
- 先获取 MCP tools 列表
- 用 LLM 产出 tool_calls JSON
- 执行 tool_calls 并返回结构化结果 + logs

注意：这里不依赖 Flask app.py，避免循环导入。
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

from database import get_mysql_connection
from services.llm_service import get_llm_service


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

            # ==================== 复用现有 /mcp 代理（关键） ====================
            # 原因：
            # - app.py 的 /mcp 代理包含“tools/list/tools/call 返回 SSE 时转 JSON”的兼容逻辑
            # - 直接打到 MCP server（http://localhost:18060/mcp）时，tools/list 可能是 text/event-stream，json 解析会失败
            backend_url = os.environ.get("BACKEND_URL") or os.environ.get("BACKEND_BASE_URL") or "http://localhost:3002"
            proxy_url = f"{backend_url.rstrip('/')}/mcp"
            log(f"使用后端 /mcp 代理: {proxy_url}")

            def proxy_post(jsonrpc: Dict[str, Any], session_id: Optional[str] = None) -> tuple[Optional[Dict[str, Any]], Optional[str], Optional[str]]:
                """调用 /mcp?url=... 代理，返回 (json, mcp-session-id, error_text)"""
                params = {
                    "url": server_url,
                    "transportType": "streamable-http",
                }
                headers = {
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "mcp-protocol-version": "2025-06-18",
                }
                if session_id:
                    headers["mcp-session-id"] = session_id
                try:
                    r = requests.post(proxy_url, params=params, json=jsonrpc, headers=headers, timeout=60)
                    new_sid = r.headers.get("mcp-session-id") or session_id
                    if not r.ok:
                        return None, new_sid, f"HTTP {r.status_code}: {r.text[:800]}"
                    try:
                        return r.json(), new_sid, None
                    except Exception as e:
                        return None, new_sid, f"Invalid JSON from proxy: {e}"
                except Exception as e:
                    return None, session_id, str(e)

            # 1) initialize（让 proxy/服务端建立 session，并返回 mcp-session-id）
            # 优化：如果提供了 existing_session_id，尝试复用；否则从头开始
            session_id = existing_session_id
            if session_id:
                log(f"尝试复用已有 session: {session_id[:16]}...")
                # 尝试用已有 session 获取工具列表，验证 session 是否有效
                test_req = {"jsonrpc": "2.0", "id": 0, "method": "tools/list", "params": {}}
                test_resp, test_sid, test_err = proxy_post(test_req, session_id)
                if test_err or not test_resp:
                    log(f"已有 session 无效，重新初始化")
                    session_id = None
                else:
                    log(f"成功复用 session: {session_id[:16]}...")
            
            if not session_id:
                log("Step 1/3: initialize")
                init_req = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {},
                        "clientInfo": {"name": "AgentActor", "version": "1.0.0"},
                    },
                }
                init_resp, session_id, init_err = proxy_post(init_req, None)
                if init_err:
                    return {"error": f"Failed to initialize MCP session: {init_err}", "logs": logs, "initialize_response": _truncate_deep(init_resp, max_str=1200)}
                log("MCP initialize 完成")

            # 2) tools/list（通过 proxy，自动兼容 SSE→JSON）
            log("Step 2/3: tools/list")
            tools_req = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
            tools_response, session_id, tools_err = proxy_post(tools_req, session_id)
            if tools_err:
                return {"error": f"Failed to get MCP tools list: {tools_err}", "logs": logs, "tools_list_response": _truncate_deep(tools_response, max_str=1200)}

            tools = (tools_response or {}).get("result", {}).get("tools", []) if isinstance(tools_response, dict) else []
            if not tools:
                # 尽量带上可读诊断（截断），方便定位 server 实际返回结构/错误
                preview = None
                try:
                    preview = _truncate_deep(tools_response, max_str=1200)
                except Exception:
                    preview = str(tools_response)[:1200] if tools_response is not None else None
                return {
                    "error": "No tools available from MCP server",
                    "logs": logs,
                    "tools_list_response": preview,
                }

            log(f"获取到 {len(tools)} 个可用工具")

            # 构建详细的工具描述（包含名称、描述、参数schema）
            tools_description_parts = []
            tool_name_map: Dict[str, Dict[str, Any]] = {}  # 工具名称 -> 工具信息映射
            
            for t in tools:
                tool_name = t.get('name', '').strip()
                if not tool_name:
                    continue
                    
                tool_desc = t.get('description', '').strip()
                schema = t.get("inputSchema") or t.get("input_schema") or t.get("parameters") or {}
                props = {}
                if isinstance(schema, dict):
                    props = schema.get("properties") or {}
                
                # 构建参数描述
                param_descs = []
                if isinstance(props, dict):
                    for param_name, param_info in props.items():
                        if isinstance(param_info, dict):
                            param_type = param_info.get('type', 'string')
                            param_desc = param_info.get('description', '')
                            required = param_info.get('required', False)
                            req_mark = "（必需）" if required else "（可选）"
                            param_descs.append(f"  - {param_name} ({param_type}){req_mark}: {param_desc}")
                
                param_block = "\n".join(param_descs) if param_descs else "  - 无参数"
                
                tool_info = {
                    'name': tool_name,
                    'description': tool_desc,
                    'schema': schema,
                    'props': props,
                }
                tool_name_map[tool_name.lower()] = tool_info
                
                tools_description_parts.append(
                    f"- {tool_name}: {tool_desc}\n  参数:\n{param_block}"
                )
            
            tools_description = "\n\n".join(tools_description_parts)

            system_prompt = f"""你是一个智能助手，可以使用以下MCP工具帮助用户：

{tools_description}

**重要规则：**
1. 只能使用上述列出的工具名称，不要使用不存在的工具名称
2. 仔细阅读每个工具的描述和参数要求
3. 根据用户输入选择最合适的工具
4. 确保参数名称和类型与工具定义完全匹配

请分析用户的输入，决定需要调用哪些工具，并返回JSON格式的工具调用信息。
格式：
{{
  "tool_calls": [
    {{
      "name": "工具名称（必须与上述列表中的名称完全一致）",
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
                    llm_service = get_llm_service()
                    llm_resp = llm_service.chat_completion(
                        config_id=llm_config_id,
                        messages=[
                            {"role": "system", "content": iter_system},
                            {"role": "user", "content": iter_user},
                        ],
                        stream=False,
                    )
                    llm_text = (llm_resp.get("content") or "").strip()
                    if llm_text:
                        json_match = re.search(r"\{.*\}", llm_text, re.DOTALL)
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
                            return {"error": "No valid tool name from MCP tools list", "logs": logs, "tools_list_response": _truncate_deep(tools_response, max_str=1200)}
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
                        tool_req = {
                            "jsonrpc": "2.0",
                            "id": int(datetime.now().timestamp() * 1000),
                            "method": "tools/call",
                            "params": {"name": tool_name, "arguments": tool_args},
                        }
                        tool_resp, session_id, tool_err = proxy_post(tool_req, session_id)
                        if tool_err:
                            results.append({"tool": tool_name, "error": tool_err, "response": _truncate_deep(tool_resp, max_str=1200)})
                        else:
                            # 验证执行结果的有效性
                            is_valid = False
                            if isinstance(tool_resp, dict):
                                # 检查是否有错误
                                if "error" in tool_resp:
                                    error_info = tool_resp.get("error", {})
                                    error_msg = error_info.get("message", "") if isinstance(error_info, dict) else str(error_info)
                                    results.append({"tool": tool_name, "error": f"MCP错误: {error_msg}", "response": _truncate_deep(tool_resp, max_str=1200)})
                                elif "result" in tool_resp:
                                    result_data = tool_resp.get("result")
                                    # 检查result是否为空或无效
                                    if result_data is None:
                                        results.append({"tool": tool_name, "error": "工具返回空结果", "response": _truncate_deep(tool_resp, max_str=1200)})
                                    else:
                                        is_valid = True
                                        results.append({"tool": tool_name, "result": tool_resp})
                                else:
                                    # 没有result也没有error，可能是格式异常
                                    results.append({"tool": tool_name, "error": "工具返回格式异常", "response": _truncate_deep(tool_resp, max_str=1200)})
                            else:
                                results.append({"tool": tool_name, "error": f"工具返回非字典格式: {type(tool_resp)}", "response": _truncate_deep(tool_resp, max_str=1200)})
                            
                            if is_valid:
                                log(f"✅ 工具 {tool_name} 执行成功")
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
                "results": results,
                "session_id": session_id,  # 保存 session_id 供后续复用
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

