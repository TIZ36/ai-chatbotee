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
from typing import Any, Dict, List, Optional, Tuple

import requests

from database import get_mysql_connection
from mcp_server.mcp_common_logic import get_mcp_tools_list, call_mcp_tool, prepare_mcp_headers, initialize_mcp_session
import pymysql


# ==================== 参数生成辅助函数（两步法）====================

def extract_user_request_from_input(input_text: str) -> str:
    """从包含【可用工具】【对话历史】【当前请求】的输入中提取用户的实际请求"""
    if not input_text:
        return ""
    
    # 尝试提取【当前请求】部分
    match = re.search(r'【当前请求】\s*\n?(.*?)(?=\n\n|$)', input_text, re.DOTALL)
    if match:
        user_request = match.group(1).strip()
        if user_request:
            return user_request
    
    # 如果没有找到【当前请求】标记，尝试提取最后一部分（假设是用户请求）
    # 移除【可用工具】和【对话历史】部分
    cleaned = re.sub(r'【可用工具】.*?【对话历史】', '', input_text, flags=re.DOTALL)
    cleaned = re.sub(r'【对话历史】.*?【当前请求】', '', cleaned, flags=re.DOTALL)
    cleaned = cleaned.strip()
    
    # 如果清理后还有内容，返回清理后的内容
    if cleaned:
        return cleaned
    
    # 否则返回原始输入
    return input_text.strip()


def extract_title_from_text(text: str, max_length: int = 50) -> str:
    """从文本中提取标题"""
    if not text:
        return "未命名"
    
    # 先尝试提取用户请求（如果包含结构化标记）
    user_request = extract_user_request_from_input(text)
    if user_request and user_request != text:
        text = user_request
    
    # 尝试提取第一行
    first_line = text.split('\n')[0].strip()
    if first_line:
        # 移除 markdown 标记和特殊标记
        title = re.sub(r'^#+\s*', '', first_line)
        title = re.sub(r'^【.*?】\s*', '', title)  # 移除【标记】
        title = title.strip()
        if len(title) > max_length:
            title = title[:max_length] + "..."
        return title or "未命名"
    
    # 如果第一行为空，使用前 N 个字符
    cleaned = text.strip()
    if len(cleaned) > max_length:
        return cleaned[:max_length] + "..."
    return cleaned or "未命名"


def _extract_args_with_llm(
    tool_name: str,
    tool_info: Dict[str, Any],
    full_input_text: str,
    context: Dict[str, Any],
    llm_config: Dict[str, Any],
    add_log: Optional[callable] = None
) -> Optional[Dict[str, Any]]:
    """
    使用 LLM 从对话历史中提取工具参数
    
    Args:
        tool_name: 工具名称
        tool_info: 工具信息
        full_input_text: 完整的输入文本（包含对话历史）
        context: 上下文信息
        llm_config: LLM 配置
        add_log: 日志函数
    
    Returns:
        提取的参数字典，如果失败返回 None
    """
    props = tool_info.get('props', {})
    required = tool_info.get('required', [])
    
    # 构建参数描述
    param_descriptions = []
    for param_name, param_info in props.items():
        param_type = param_info.get('type', 'string')
        param_desc = param_info.get('description', '')
        is_required = param_name in required
        req_mark = "（必需）" if is_required else "（可选）"
        param_descriptions.append(f"- {param_name} ({param_type}){req_mark}: {param_desc}")
    
    # 构建系统提示词
    system_prompt = f"""你是一个参数提取助手。请仔细阅读对话历史，从中提取调用工具 "{tool_name}" 所需的所有参数。

工具名称：{tool_name}
工具描述：{tool_info.get('description', '')}

需要提取的参数：
{chr(10).join(param_descriptions)}

重要提示：
1. 仔细阅读整个对话历史，包括【对话历史】和【当前请求】部分
2. 从对话历史中找出所有相关的参数值，包括：
   - 标题（title）：从对话中提取的标题或主题
   - 内容（content）：用户想要发布或分享的内容
   - 标签（tags）：用户提到的标签或话题
   - 图片（images）：用户上传或提到的图片（如果有）
3. 如果对话历史中没有明确提到某个参数，请根据上下文合理推断
4. 对于可选参数，如果没有相关信息可以省略
5. 图片参数应该从上下文中提取（如果用户上传了图片）

返回格式必须是有效的 JSON 对象，只包含参数名和参数值。例如：
{{
  "title": "从对话中提取的标题",
  "content": "从对话中提取的完整内容",
  "tags": ["标签1", "标签2"]
}}

注意：只返回 JSON 对象，不要包含任何其他文字说明。"""
    
    # 调用 LLM
    if add_log:
        add_log(f"  使用 LLM 从对话历史中提取参数...")
    
    llm_response = call_llm_api(llm_config, system_prompt, full_input_text, add_log)
    if not llm_response:
        return None
    
    # 解析 JSON
    try:
        # 尝试提取 JSON（可能包含 markdown 代码块）
        json_match = re.search(r'\{[\s\S]*\}', llm_response)
        if json_match:
            args = json.loads(json_match.group())
            # 验证参数类型
            validated_args = {}
            for param_name, param_value in args.items():
                if param_name not in props:
                    continue  # 忽略未知参数
                param_info = props[param_name]
                param_type = param_info.get('type', 'string')
                
                # 类型验证和转换
                if param_type == 'array' and not isinstance(param_value, list):
                    if param_value:
                        validated_args[param_name] = [param_value]
                    else:
                        validated_args[param_name] = []
                elif param_type in ['number', 'integer']:
                    try:
                        validated_args[param_name] = int(param_value) if param_type == 'integer' else float(param_value)
                    except:
                        validated_args[param_name] = param_value
                elif param_type == 'boolean':
                    if isinstance(param_value, bool):
                        validated_args[param_name] = param_value
                    elif isinstance(param_value, str):
                        validated_args[param_name] = param_value.lower() in ('true', '1', 'yes', '是')
                    else:
                        validated_args[param_name] = bool(param_value)
                else:
                    validated_args[param_name] = param_value
            
            # 处理图片参数（从 context 中提取）
            for param_name in ['images', 'image', 'photos', 'pictures', 'files']:
                if param_name in props:
                    images = extract_images_from_context(context)
                    if images:
                        param_type = props[param_name].get('type', 'string')
                        if param_type == 'array':
                            validated_args[param_name] = images
                        elif images:
                            validated_args[param_name] = images[0]
            
            if add_log:
                add_log(f"  ✅ LLM 提取到 {len(validated_args)} 个参数")
            
            return validated_args
    except json.JSONDecodeError as e:
        if add_log:
            add_log(f"  ⚠️ LLM 返回的 JSON 解析失败: {e}")
        return None
    except Exception as e:
        if add_log:
            add_log(f"  ⚠️ LLM 参数提取出错: {e}")
        return None
    
    return None


def extract_images_from_context(context: dict) -> List[str]:
    """从上下文中提取图片路径"""
    images = []
    
    # 从原始消息的 ext.media 中提取
    original_message = context.get('original_message', {})
    if not original_message:
        return images
    
    # 处理 ext 字段（可能是字符串或字典）
    ext = original_message.get('ext', {}) or {}
    if isinstance(ext, str):
        try:
            import json
            ext = json.loads(ext)
        except Exception:
            ext = {}
    
    media_list = ext.get('media', [])
    if not isinstance(media_list, list):
        return images
    
    for m in media_list:
        if not isinstance(m, dict):
            continue
        
        if m.get('type') == 'image':
            # 优先使用 url（本地文件路径或 HTTP URL）
            img_path = m.get('url')
            if img_path:
                images.append(img_path)
            # 如果没有 url，检查是否有 data（base64），但需要转换为文件路径
            # 注意：base64 数据需要先保存为文件才能传递给 MCP 工具
            elif m.get('data'):
                # 这里可以添加 base64 转文件的逻辑，但暂时跳过
                # 因为 MCP 工具通常需要文件路径而不是 base64
                pass
    
    return images


def generate_tool_arguments(
    tool_name: str,
    tool_info: Dict[str, Any],
    user_input: str,
    context: Dict[str, Any],
    llm_config: Optional[Dict[str, Any]] = None,
    full_input_text: Optional[str] = None,
    add_log: Optional[callable] = None
) -> Dict[str, Any]:
    """
    根据工具 schema 和用户输入自动生成参数（两步法核心）
    优先使用 LLM 从对话历史中提取参数，如果 LLM 不可用则使用规则匹配
    
    Args:
        tool_name: 工具名称
        tool_info: 工具信息（包含 schema, props, required）
        user_input: 用户输入文本（已提取的实际请求）
        context: 上下文信息（包含 original_message 等）
        llm_config: LLM 配置（如果提供，将使用 LLM 提取参数）
        full_input_text: 完整的输入文本（包含对话历史）
        add_log: 日志函数
    
    Returns:
        生成的参数字典
    """
    schema = tool_info.get('schema', {})
    props = tool_info.get('props', {})
    required = tool_info.get('required', [])
    
    # 如果提供了 LLM 配置和完整输入文本，使用 LLM 提取参数
    if llm_config and full_input_text:
        try:
            llm_args = _extract_args_with_llm(
                tool_name=tool_name,
                tool_info=tool_info,
                full_input_text=full_input_text,
                context=context,
                llm_config=llm_config,
                add_log=add_log
            )
            if llm_args:
                return llm_args
        except Exception as e:
            if add_log:
                add_log(f"⚠️ LLM 参数提取失败，回退到规则匹配: {e}")
    
    # 回退到规则匹配
    args = {}
    
    # 1. 处理必需参数
    for param in required:
        if param not in props:
            # 如果 schema 中没有定义，使用默认规则
            args[param] = user_input
            continue
        
        param_info = props[param]
        param_type = param_info.get('type', 'string')
        param_desc = (param_info.get('description', '') or '').lower()
        
        # 根据参数名称和描述推断值
        param_lower = param.lower()
        
        # Content/Text 类参数：使用完整用户输入
        if param_lower in ['content', 'text', 'body', 'description', 'message']:
            args[param] = user_input
        
        # Title 类参数：提取标题
        elif param_lower in ['title', 'subject', 'heading', 'name']:
            args[param] = extract_title_from_text(user_input)
        
        # Images 类参数：从上下文提取
        elif param_lower in ['images', 'image', 'photos', 'pictures', 'files']:
            images = extract_images_from_context(context)
            args[param] = images if param_type == 'array' else (images[0] if images else None)
        
        # Tags 类参数：尝试从用户输入中提取标签（使用 # 标记或逗号分隔）
        elif param_lower in ['tags', 'tag', 'categories', 'category']:
            if param_type == 'array':
                # 尝试提取标签：查找 #标签 格式或逗号分隔的标签
                tags = []
                # 提取 #标签 格式
                hash_tags = re.findall(r'#([^\s#]+)', user_input)
                if hash_tags:
                    tags.extend(hash_tags)
                # 提取"标签："后的内容
                tag_match = re.search(r'标签[：:]\s*([^\n]+)', user_input)
                if tag_match:
                    tag_str = tag_match.group(1)
                    # 分割逗号或空格分隔的标签
                    comma_tags = [t.strip() for t in re.split(r'[,，、\s]+', tag_str) if t.strip()]
                    tags.extend(comma_tags)
                # 如果没找到标签，使用空数组（可选参数）
                args[param] = tags if tags else []
            else:
                args[param] = user_input
        
        # Query/Search 类参数：使用用户输入
        elif param_lower in ['query', 'keyword', 'search', 'q']:
            args[param] = user_input
        
        # Input 类参数：使用用户输入
        elif param_lower in ['input']:
            args[param] = user_input
        
        # ID 类参数：尝试从用户输入中提取数字或 ID
        elif 'id' in param_lower or param_type in ['number', 'integer']:
            # 尝试从用户输入中提取数字
            match = re.search(r'\d+', user_input)
            if match:
                args[param] = int(match.group()) if param_type in ['number', 'integer'] else match.group()
            else:
                args[param] = None
        
        # Boolean 类参数：使用默认值
        elif param_type == 'boolean':
            args[param] = param_info.get('default', True)
        
        # 其他：使用默认值或用户输入
        else:
            if 'default' in param_info:
                args[param] = param_info['default']
            elif param_type == 'string':
                args[param] = user_input
            else:
                args[param] = None
    
    # 2. 处理可选参数（仅使用有默认值的）
    for param, param_info in props.items():
        if param not in args and 'default' in param_info:
            args[param] = param_info['default']
    
    return args


# ==================== 原有函数 ====================

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
    调用LLM API - 使用 Provider SDK 统一调用
    """
    from services.providers.factory import create_provider
    from services.providers.base import LLMMessage
    
    provider = llm_config.get('provider', '')
    api_key = llm_config.get('api_key', '')
    api_url = llm_config.get('api_url', '')
    model = llm_config.get('model', '')
    
    api_key_preview = f"{api_key[:8]}...{api_key[-4:]}" if api_key and len(api_key) > 12 else ("已设置" if api_key else "❌ 未设置")
    print(f"[call_llm_api] 🔄 调用LLM API (使用 Provider SDK)")
    print(f"[call_llm_api]    Provider: {provider}")
    print(f"[call_llm_api]    Model: {model}")
    print(f"[call_llm_api]    API URL: {api_url or '默认'}")
    print(f"[call_llm_api]    API Key: {api_key_preview}")
    
    if add_log:
        add_log(f"🔄 调用LLM API: {provider} - {model}")
        add_log(f"系统提示词长度: {len(system_prompt)}, 用户输入长度: {len(user_input)}")
        add_log(f"LLM配置详情: provider={provider}, model={model}, api_url={api_url or '默认'}, api_key={api_key_preview}")

    # 检查必要参数
    if not provider:
        print(f"[call_llm_api] ❌ LLM配置中缺少provider字段")
        if add_log:
            add_log("❌ LLM配置中缺少provider字段")
        return None

    if not api_key:
        print(f"[call_llm_api] ❌ API密钥为空 (provider: {provider})")
        if add_log:
            add_log(f"❌ API密钥为空 (provider: {provider})")
        return None

    if not model:
        print(f"[call_llm_api] ❌ 模型名称为空 (provider: {provider})")
        if add_log:
            add_log(f"❌ 模型名称为空 (provider: {provider})")
        return None

    # 使用 Provider SDK 统一调用
    try:
        llm_provider = create_provider(
            provider_type=provider,
            api_key=api_key,
            api_url=api_url or None,
            model=model
        )
        
        messages = [
            LLMMessage(role='system', content=system_prompt),
            LLMMessage(role='user', content=user_input)
        ]
        
        print(f"[call_llm_api] 📤 调用 {provider.upper()} Provider SDK...")
        response = llm_provider.chat(messages, temperature=0.1, max_tokens=8192)
        
        content = response.content
        print(f"[call_llm_api] ✅ {provider.upper()} API调用成功，返回内容长度: {len(content or '')}")
        if add_log:
            add_log(f"✅ {provider.upper()} API调用成功，返回内容长度: {len(content or '')}")
        return content
        
    except ValueError as e:
        # Provider 不支持
        error_msg = str(e)
        print(f"[call_llm_api] ❌ Provider 错误: {error_msg}")
        if add_log:
            add_log(f"❌ Provider 错误: {error_msg}")
        return None
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"[call_llm_api] ❌ API调用失败: {error_msg}")
        if add_log:
            add_log(f"❌ {provider.upper()} API调用失败: {error_msg}")
        return None


def call_llm_with_tools(
    llm_config: dict, 
    messages: List[Dict[str, Any]], 
    tools: List[Dict[str, Any]], 
    add_log=None
) -> Optional[Dict[str, Any]]:
    """
    使用原生 Tool Calling 调用 LLM（高性能版本）
    
    与临时会话相同的调用方式，一次 API 请求即可完成工具选择
    
    Args:
        llm_config: LLM 配置
        messages: 消息列表（OpenAI 格式）
        tools: 工具列表（OpenAI function calling 格式）
        add_log: 日志函数
        
    Returns:
        {
            'content': str,  # 文本回复
            'tool_calls': List[Dict],  # 工具调用列表
            'finish_reason': str
        }
        或 None（失败时）
    """
    from services.providers.factory import create_provider
    from services.providers.base import LLMMessage
    
    provider = llm_config.get('provider', '')
    api_key = llm_config.get('api_key', '')
    api_url = llm_config.get('api_url', '')
    model = llm_config.get('model', '')
    
    api_key_preview = f"{api_key[:8]}...{api_key[-4:]}" if api_key and len(api_key) > 12 else ("已设置" if api_key else "❌ 未设置")
    print(f"[call_llm_with_tools] 🔄 原生 Tool Calling")
    print(f"[call_llm_with_tools]    Provider: {provider}, Model: {model}")
    print(f"[call_llm_with_tools]    Tools: {len(tools)} 个")
    print(f"[call_llm_with_tools]    Messages: {len(messages)} 条")
    
    if add_log:
        add_log(f"🔧 原生Tool Calling: {provider}/{model}, {len(tools)}个工具")

    # 检查必要参数
    if not provider or not api_key or not model:
        print(f"[call_llm_with_tools] ❌ 缺少必要参数")
        return None

    try:
        llm_provider = create_provider(
            provider_type=provider,
            api_key=api_key,
            api_url=api_url or None,
            model=model
        )
        
        # 转换消息格式
        llm_messages = []
        for msg in messages:
            llm_messages.append(LLMMessage(
                role=msg.get('role', 'user'),
                content=msg.get('content', ''),
                tool_calls=msg.get('tool_calls'),
                tool_call_id=msg.get('tool_call_id'),
                name=msg.get('name')
            ))
        
        # 调用 LLM（传递 tools 参数启用原生 function calling）
        print(f"[call_llm_with_tools] 📤 调用 {provider.upper()} SDK with tools...")
        response = llm_provider.chat(
            llm_messages, 
            tools=tools,
            tool_choice="auto",
            temperature=0.1,
            max_tokens=4096
        )
        
        result = {
            'content': response.content or '',
            'tool_calls': response.tool_calls or [],
            'finish_reason': response.finish_reason
        }
        
        tool_count = len(result['tool_calls']) if result['tool_calls'] else 0
        print(f"[call_llm_with_tools] ✅ 成功: {tool_count} 个工具调用, 内容长度: {len(result['content'])}")
        if add_log:
            add_log(f"✅ 原生Tool Calling成功: {tool_count}个工具调用")
        
        return result
        
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"[call_llm_with_tools] ❌ 失败: {error_msg}")
        if add_log:
            add_log(f"❌ Tool Calling失败: {error_msg}")
        return None


# ==================== 旧的原生 HTTP 实现（已弃用，保留备用） ====================
def _call_llm_api_legacy(llm_config: dict, system_prompt: str, user_input: str, add_log=None):
    """
    旧版 LLM API 调用（原生 HTTP 实现）
    已弃用，保留备用
    """
    import requests
    from requests.exceptions import RequestException, Timeout, ConnectionError as RequestsConnectionError
    
    provider = llm_config.get('provider', '')
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
            # 工具选择/结构化输出：尽量稳定
            'temperature': 0.1,
            'max_tokens': 8192,  # 增加 max_tokens 确保完整返回 JSON
        }

        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }

        try:
            response = requests.post(url, json=payload, headers=headers, timeout=60)
            if response.ok:
                data = response.json()
                content = data['choices'][0]['message']['content']
                if add_log:
                    add_log(f"✅ OpenAI API调用成功，返回内容长度: {len(content or '')}")
                return content
            else:
                if add_log:
                    error_text = response.text[:500] if response.text else "无响应内容"
                    add_log(f"❌ OpenAI API调用失败: HTTP {response.status_code} - {error_text}")
                return None
        except Timeout:
            if add_log:
                add_log(f"❌ OpenAI API调用超时 (60秒)")
            return None
        except RequestsConnectionError as e:
            if add_log:
                add_log(f"❌ OpenAI API连接失败: {str(e)}")
            return None
        except RequestException as e:
            if add_log:
                add_log(f"❌ OpenAI API请求异常: {type(e).__name__}: {str(e)}")
            return None
        except Exception as e:
            if add_log:
                add_log(f"❌ OpenAI API调用未知错误: {type(e).__name__}: {str(e)}")
            return None

    elif provider == 'deepseek':
        # DeepSeek 使用 OpenAI 兼容 API
        default_url = 'https://api.deepseek.com/v1/chat/completions'
        if not api_url:
            url = default_url
        elif '/chat/completions' not in api_url:
            # 如果只提供了 host，需要补全路径
            base_url = api_url.rstrip('/')
            if base_url.endswith('/v1'):
                url = f"{base_url}/chat/completions"
            else:
                url = f"{base_url}/v1/chat/completions"
        else:
            url = api_url
        
        # 调试日志（始终打印，不依赖 add_log）
        print(f"[DeepSeek MCP] 🔄 调用 DeepSeek API")
        print(f"[DeepSeek MCP]    原始 API URL: {api_url or '未设置'}")
        print(f"[DeepSeek MCP]    最终 URL: {url}")
        print(f"[DeepSeek MCP]    Model: {model}")
        print(f"[DeepSeek MCP]    API Key: {api_key[:8]}...{api_key[-4:] if len(api_key) > 12 else '***'}")

        payload = {
            'model': model,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_input}
            ],
            # 工具选择/结构化输出：尽量稳定
            'temperature': 0.1,
            'max_tokens': 8192,  # 增加 max_tokens 确保完整返回 JSON
        }

        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        }

        try:
            response = requests.post(url, json=payload, headers=headers, timeout=60)
            print(f"[DeepSeek MCP]    Response Status: {response.status_code}")
            if response.ok:
                data = response.json()
                content = data['choices'][0]['message']['content']
                print(f"[DeepSeek MCP] ✅ 成功，返回内容长度: {len(content or '')}")
                if add_log:
                    add_log(f"✅ DeepSeek API调用成功，返回内容长度: {len(content or '')}")
                return content
            else:
                error_text = response.text[:500] if response.text else "无响应内容"
                print(f"[DeepSeek MCP] ❌ 失败: HTTP {response.status_code} - {error_text}")
                if add_log:
                    add_log(f"❌ DeepSeek API调用失败: HTTP {response.status_code} - {error_text}")
                return None
        except Timeout:
            print(f"[DeepSeek MCP] ❌ 超时 (60秒)")
            if add_log:
                add_log(f"❌ DeepSeek API调用超时 (60秒)")
            return None
        except RequestsConnectionError as e:
            print(f"[DeepSeek MCP] ❌ 连接失败: {str(e)}")
            if add_log:
                add_log(f"❌ DeepSeek API连接失败: {str(e)}")
            return None
        except RequestException as e:
            print(f"[DeepSeek MCP] ❌ 请求异常: {type(e).__name__}: {str(e)}")
            if add_log:
                add_log(f"❌ DeepSeek API请求异常: {type(e).__name__}: {str(e)}")
            return None
        except Exception as e:
            print(f"[DeepSeek MCP] ❌ 未知错误: {type(e).__name__}: {str(e)}")
            if add_log:
                add_log(f"❌ DeepSeek API调用未知错误: {type(e).__name__}: {str(e)}")
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
        
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=60)
            if response.ok:
                data = response.json()
                content = data['content'][0]['text']
                if add_log:
                    add_log(f"✅ Anthropic API调用成功，返回内容长度: {len(content or '')}")
                return content
            else:
                if add_log:
                    error_text = response.text[:500] if response.text else "无响应内容"
                    add_log(f"❌ Anthropic API调用失败: HTTP {response.status_code} - {error_text}")
                return None
        except Timeout:
            if add_log:
                add_log(f"❌ Anthropic API调用超时 (60秒)")
            return None
        except RequestsConnectionError as e:
            if add_log:
                add_log(f"❌ Anthropic API连接失败: {str(e)}")
            return None
        except RequestException as e:
            if add_log:
                add_log(f"❌ Anthropic API请求异常: {type(e).__name__}: {str(e)}")
            return None
        except Exception as e:
            if add_log:
                add_log(f"❌ Anthropic API调用未知错误: {type(e).__name__}: {str(e)}")
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
                'maxOutputTokens': 8192,  # 增加 maxOutputTokens 确保完整返回 JSON
            },
        }
        
        # 只在metadata中明确指定thinking_level时才添加（某些模型不支持此字段）
        if llm_config.get('metadata') and llm_config['metadata'].get('thinking_level'):
            payload['generationConfig']['thinkingLevel'] = llm_config['metadata']['thinking_level']
        
        headers = {
            'x-goog-api-key': api_key,
            'Content-Type': 'application/json',
        }
        
        try:
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
                        error_msg = response.text[:500] if response.text else "无响应内容"
                    add_log(f"❌ Gemini API调用失败: HTTP {response.status_code} - {error_msg}")
                return None
        except Timeout:
            if add_log:
                add_log(f"❌ Gemini API调用超时 (60秒)")
            return None
        except RequestsConnectionError as e:
            if add_log:
                add_log(f"❌ Gemini API连接失败: {str(e)}")
            return None
        except RequestException as e:
            if add_log:
                add_log(f"❌ Gemini API请求异常: {type(e).__name__}: {str(e)}")
            return None
        except Exception as e:
            if add_log:
                add_log(f"❌ Gemini API调用未知错误: {type(e).__name__}: {str(e)}")
            return None
    else:
        print(f"[_call_llm_api_legacy] ❌ 不支持的LLM提供商: {provider}")
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
    original_message: Optional[Dict[str, Any]] = None,  # 原始消息（用于提取图片等上下文）
) -> Dict[str, Any]:
    """
    执行 MCP（两步法）：LLM 只选择工具，参数由系统自动生成
    
    Args:
        agent_system_prompt: Agent 的人设，会作为系统提示词的一部分
        original_message: 原始消息（用于提取图片等上下文信息）

    Returns:
      {
        "summary": str | None,
        "raw_result": dict | None,
        "logs": list[str],
        "error": str | None,
        "llm_response": str | None,
        "media": list[dict] | None,  # 提取的媒体数据
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

        # 使用 llm_service 获取 LLM 配置（确保格式正确且包含 API key）
        log(f"获取LLM配置: {llm_config_id}")
        try:
            from services.llm_service import get_llm_service
            llm_service = get_llm_service()
            llm_config = llm_service.get_config(llm_config_id, include_api_key=True)
            
            if not llm_config:
                log(f"❌ LLM配置不存在或已禁用: {llm_config_id}")
                return {"error": "LLM config not found or disabled", "logs": logs}
            
            # llm_service.get_config 返回的配置已经是正确格式，包含所有必要字段
            log(f"✅ LLM配置获取成功:")
            log(f"   配置ID: {llm_config.get('config_id', llm_config_id)}")
            log(f"   Provider: {llm_config.get('provider', '未知')}")
            log(f"   Model: {llm_config.get('model', '未知')}")
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
        except Exception as e:
            error_msg = f"获取LLM配置失败: {str(e)}"
            log(f"❌ {error_msg}")
            return {"error": error_msg, "logs": logs}

        # 获取 MCP 服务器配置（仍然需要数据库连接）
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
            
            # 3. 获取工具列表（带自动重连和重试机制）
            log("Step 2/3: tools/list")
            # Actor 场景优先不走缓存：避免 tools/list 的短期缓存掩盖 session-id/权限变更
            # auto_reconnect=True 会在失败时自动清理旧连接并重试
            max_retries = 0  # 最多重试2次（加上第一次共3次）
            tools_response = None
            last_error = None
            
            for retry_attempt in range(max_retries + 1):
                if retry_attempt > 0:
                    log(f"⚠️ 获取工具列表失败，第 {retry_attempt + 1} 次尝试...")
                    # 清理旧连接和 session-id，准备重新初始化
                    from mcp_server.mcp_common_logic import invalidate_mcp_connection
                    invalidate_mcp_connection(server_url)
                    if 'mcp-session-id' in headers:
                        del headers['mcp-session-id']
                    # 重新初始化会话
                    init_response = initialize_mcp_session(server_url, headers)
                    if init_response:
                        log(f"✅ 重新初始化 MCP 会话成功，session_id: {headers.get('mcp-session-id', 'N/A')[:16]}...")
                    else:
                        log("⚠️ 重新初始化 MCP 会话失败，但继续尝试获取工具列表")
                    # 等待一段时间再重试
                    import time
                    time.sleep(0.5 * retry_attempt)
                
                tools_response = get_mcp_tools_list(server_url, headers, use_cache=False, auto_reconnect=True)
                if tools_response and 'result' in tools_response:
                    # 成功获取工具列表
                    break
                else:
                    # 记录错误信息
                    if tools_response:
                        last_error = f"Invalid response: {str(tools_response)[:200]}"
                    else:
                        last_error = "No response from MCP server"
                    log(f"❌ 获取工具列表失败: {last_error}")
            
            if not tools_response or 'result' not in tools_response:
                # 导入健康状态函数
                from mcp_server.mcp_common_logic import get_mcp_health_status
                health_status = get_mcp_health_status(server_url)
                log(f"❌ 获取工具列表失败（已重试 {max_retries} 次）: {last_error}")
                return {
                    "error": "Failed to get MCP tools list",
                    "logs": logs,
                    "debug": {
                        "server_url": server_url,
                        "mcp_session_id": headers.get("mcp-session-id"),
                        "tools_response_preview": _truncate_deep(tools_response, max_str=1200),
                        "health_status": health_status,
                        "last_error": last_error,
                        "retry_attempts": max_retries + 1,
                        "hint": "MCP 服务可能已重启或不可用，系统已尝试自动重连和重试。请检查 MCP 服务状态。",
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
            
            # 2. 工具选择原则（两步法：只选择工具，不生成参数）
            system_prompt_parts.append("""## 工具选择能力

你是一个工具选择助手。根据用户需求，从可用工具中选择最合适的工具。

### ⚠️ 重要：返回格式要求

**你只需要选择工具名称，不要生成参数。参数会由系统自动生成。**

返回格式（严格 JSON，不要任何其他文字）：
```json
{
  "selected_tools": ["tool_name1", "tool_name2"],
  "intent": "用户意图简述（10字以内）"
}
```

如果不需要调用工具：
```json
{
  "selected_tools": [],
  "intent": "无需工具"
}
```

**规则：**
1. 只返回工具名称列表，不要包含参数
2. 工具名称必须完全匹配可用工具列表中的名称
3. 最多选择 3 个工具
4. 按执行顺序排列
5. intent 字段简短描述用户意图（10字以内）
6. 不要添加任何解释文字或markdown代码块""")
            
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
            # 两步法：移除了 _default_args_for_tool，使用 generate_tool_arguments 替代
            
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
                    # 构建参数（使用简单规则）
                    schema = best_candidate.get("inputSchema") or best_candidate.get("input_schema") or best_candidate.get("parameters") or {}
                    props = schema.get("properties") or {} if isinstance(schema, dict) else {}
                    
                    # 简单参数生成
                    if "input" in props:
                        args = {"input": user_input}
                    elif "query" in props:
                        args = {"query": user_input}
                    elif "text" in props:
                        args = {"text": user_input}
                    elif len(props) == 1:
                        k = next(iter(props.keys()))
                        args = {k: user_input}
                    else:
                        args = {"input": user_input}
                    
                    return {"name": tool_name, "arguments": args}
                
                return None

            all_tool_calls: List[Dict[str, Any]] = []
            results: List[Dict[str, Any]] = []
            executed_tool_names: set[str] = set()  # 记录已执行的工具名

            # ==================== 尝试原生 Tool Calling（高性能路径） ====================
            # 支持原生 function calling 的模型（OpenAI, DeepSeek 等）可以一次 API 调用完成工具选择
            provider_type = llm_config.get('provider', '').lower()
            use_native_tool_calling = provider_type in ('openai', 'deepseek', 'anthropic', 'claude')
            
            if use_native_tool_calling:
                log("Step 3/3: 工具选择与执行（原生 Tool Calling - 高性能）")
                print(f"{GREEN}[MCP EXEC] 🚀 使用原生 Tool Calling（{provider_type}）{RESET}")
                
                # 构建 OpenAI 格式的工具列表
                openai_tools = []
                for t in tools:
                    schema = t.get("inputSchema") or t.get("input_schema") or t.get("parameters") or {}
                    openai_tools.append({
                        "type": "function",
                        "function": {
                            "name": t.get("name", ""),
                            "description": t.get("description", ""),
                            "parameters": schema
                        }
                    })
                
                # 构建消息（简化版，不需要复杂的 JSON 指令）
                native_messages = []
                if agent_system_prompt:
                    native_messages.append({
                        "role": "system",
                        "content": agent_system_prompt + "\n\n你可以使用工具来帮助完成用户的请求。"
                    })
                else:
                    native_messages.append({
                        "role": "system", 
                        "content": "你是一个智能助手，可以使用工具来帮助完成用户的请求。"
                    })
                
                # 从 effective_input 提取用户请求
                actual_request = extract_user_request_from_input(effective_input)
                if not actual_request:
                    actual_request = effective_input
                
                native_messages.append({
                    "role": "user",
                    "content": actual_request
                })
                
                # 调用原生 Tool Calling
                native_result = call_llm_with_tools(llm_config, native_messages, openai_tools, log)
                
                if native_result and native_result.get('tool_calls'):
                    tool_calls_from_native = native_result['tool_calls']
                    log(f"✅ 原生 Tool Calling 返回 {len(tool_calls_from_native)} 个工具调用")
                    print(f"{GREEN}[MCP EXEC] ✅ 原生返回 {len(tool_calls_from_native)} 个工具调用{RESET}")
                    
                    # 执行工具调用
                    for tc in tool_calls_from_native[:5]:  # 最多5个
                        tool_name = tc.get('function', {}).get('name') or tc.get('name', '')
                        tool_args_str = tc.get('function', {}).get('arguments') or tc.get('arguments', '{}')
                        
                        # 解析参数
                        try:
                            if isinstance(tool_args_str, str):
                                tool_args = json.loads(tool_args_str) if tool_args_str else {}
                            else:
                                tool_args = tool_args_str if isinstance(tool_args_str, dict) else {}
                        except json.JSONDecodeError:
                            tool_args = {}
                        
                        log(f"  执行工具: {tool_name}")
                        print(f"{CYAN}[MCP EXEC] 执行工具: {tool_name}, 参数: {list(tool_args.keys())}{RESET}")
                        
                        # 调用 MCP 工具
                        try:
                            tool_result = call_mcp_tool(
                                target_url=server_url,
                                headers=headers,
                                tool_name=tool_name,
                                tool_args=tool_args,
                                add_log=log,
                            )
                            
                            # 提取结果（call_mcp_tool 返回格式：{success, data, text, raw_result, ...}）
                            if tool_result and tool_result.get('success'):
                                tool_text = tool_result.get('text') or str(tool_result.get('data', ''))
                                
                                results.append({
                                    "tool": tool_name,
                                    "arguments": tool_args,
                                    "tool_text": tool_text,
                                    "raw_result": tool_result.get('raw_result'),
                                    "success": True,
                                })
                                executed_tool_names.add(tool_name)
                                log(f"    ✅ {tool_name} 执行成功")
                            else:
                                error_msg = tool_result.get('error', '未知错误') if tool_result else '调用失败'
                                results.append({
                                    "tool": tool_name,
                                    "error": error_msg,
                                    "success": False,
                                })
                                log(f"    ❌ {tool_name} 执行失败: {error_msg}")
                        except Exception as e:
                            results.append({
                                "tool": tool_name,
                                "error": str(e),
                                "success": False,
                            })
                            log(f"    ❌ {tool_name} 异常: {e}")
                    
                    # 原生 Tool Calling 成功，跳过两步法
                    all_tool_calls = tool_calls_from_native
                    
                    # 构建返回结果
                    tool_text_outputs = []
                    for r in results:
                        if r.get('success') and r.get('tool_text'):
                            tool_text_outputs.append(f"【{r['tool']}】\n{r['tool_text']}")
                    
                    final_tool_text = '\n\n'.join(tool_text_outputs) if tool_text_outputs else ''
                    executed_names = [r.get('tool') for r in results if r.get('success')]
                    summary = f"✅ MCP \"{server_name}\" 执行完成（{len(executed_names)} 个工具调用：{', '.join(executed_names)}）"
                    
                    log(f"原生 Tool Calling 完成: {summary}")
                    
                    return {
                        "summary": summary,
                        "tool_text": final_tool_text,
                        "results": results,
                        "raw_result": results[0].get('raw_result') if results else None,
                        "raw_result_compact": _truncate_deep(results[0].get('raw_result'), max_str=1200) if results else None,
                        "logs": logs,
                        "media": [],  # TODO: 提取媒体
                        "mcp_session_id": headers.get('mcp-session-id'),
                        "native_tool_calling": True,
                    }
                else:
                    # 原生 Tool Calling 没有返回工具调用，可能是不需要工具或失败
                    if native_result and native_result.get('content'):
                        log(f"⚠️ 原生 Tool Calling 返回文本而非工具调用，回退到两步法")
                        print(f"{YELLOW}[MCP EXEC] ⚠️ 原生返回文本，回退两步法{RESET}")
                    else:
                        log(f"⚠️ 原生 Tool Calling 失败，回退到两步法")
                        print(f"{YELLOW}[MCP EXEC] ⚠️ 原生失败，回退两步法{RESET}")

            # ==================== 两步法（兼容旧模型） ====================
            log("Step 3/3: 工具选择与执行（两步法 - 兼容模式）")
            for it in range(max(1, int(max_iterations or 1))):
                # 两步法：首轮直接选择工具，后续轮次检查是否需要继续
                if it == 0:
                    # 首轮：简单提示
                    iter_system = system_prompt + "\n\n请分析用户需求，选择最合适的工具。只返回JSON格式。"
                    iter_user = user_input_for_llm
                else:
                    # 后续轮次：带上已执行的工具结果，让 LLM 决定是否需要更多工具
                    prior_texts = []
                    for r in results[-6:]:
                        if r.get("tool") and r.get("tool_text"):
                            prior_texts.append(f"【{r['tool']}】执行结果:\n{r['tool_text']}")
                    prior_block = ("\n\n".join(prior_texts)).strip()

                    # 构建已执行工具列表
                    executed_tools_str = ", ".join(executed_tool_names) if executed_tool_names else "无"
                    
                    iter_system = system_prompt + f"""

## 当前状态

- 已执行工具: {executed_tools_str}
- 这是第 {it+1} 轮决策

## 决策规则

1. **不要重复调用已执行过的工具**
2. 如果用户的需求已被满足，返回空的工具列表: {{"selected_tools": [], "intent": "已完成"}}
3. 只有在确实需要新信息时才选择新工具"""

                    # 构建用户消息：历史 + 请求 + 工具列表 + 已执行结果
                    iter_user = user_input_for_llm
                    if prior_block:
                        iter_user += f"\n\n=== 已执行工具的结果 ===\n{prior_block}\n\n请根据以上结果决定是否需要调用更多工具，或者任务已完成。"

                selected_tool_names: List[str] = []
                llm_text: str = ""
                intent: Optional[str] = None
                def _parse_llm_tool_selection(raw_text: str) -> Tuple[List[str], Optional[str], Optional[str]]:
                    """
                    从 LLM 输出中解析工具选择（两步法）
                    
                    期望格式：
                    {
                      "selected_tools": ["tool_name1", "tool_name2"],
                      "intent": "用户意图"
                    }
                    
                    Returns:
                        (工具名称列表, intent, 错误信息)
                    """
                    if not raw_text:
                        return [], None, "empty llm output"

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
                        """
                        提取 JSON 对象，正确处理字符串中的特殊字符
                        """
                        objs: List[str] = []
                        depth = 0
                        start = None
                        in_string = False
                        escape_next = False
                        
                        for i, ch in enumerate(s):
                            if escape_next:
                                escape_next = False
                                continue
                            
                            if ch == '\\':
                                escape_next = True
                                continue
                            
                            if ch == '"' and not escape_next:
                                in_string = not in_string
                                continue
                            
                            if not in_string:
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
                        return [], None, "no json object found in llm output"

                    last_err: Optional[str] = None
                    for cand in candidates:
                        try:
                            data = json.loads(cand)
                            if not isinstance(data, dict):
                                continue
                            
                            # 支持新格式：selected_tools
                            if "selected_tools" in data:
                                selected = data.get("selected_tools", [])
                                tool_names = selected if isinstance(selected, list) else []
                                intent = data.get("intent", "")
                                return tool_names, intent, None
                            
                            # 兼容旧格式：tool_calls（保持向后兼容）
                            elif "tool_calls" in data:
                                tc = data.get("tool_calls", [])
                                if isinstance(tc, list) and len(tc) > 0:
                                    # 从 tool_calls 中提取工具名称
                                    tool_names = [call.get("name") for call in tc if isinstance(call, dict) and call.get("name")]
                                    return tool_names, "兼容旧格式", None
                                else:
                                    # 空的 tool_calls，表示不需要工具
                                    return [], "无需工具", None
                        except Exception as e:
                            last_err = f"{type(e).__name__}: {str(e)}"
                            continue

                    # Fallback: 尝试更激进的JSON提取
                    # 查找包含 "selected_tools" 或 "tool_calls" 的JSON片段
                    fallback_candidates = []
                    patterns = [
                        re.compile(r'["\']selected_tools["\']\s*:\s*\[', re.IGNORECASE),
                        re.compile(r'["\']tool_calls["\']\s*:\s*\[', re.IGNORECASE)
                    ]
                    
                    for pattern in patterns:
                        for match in pattern.finditer(txt):
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
                                # 需要正确处理字符串中的特殊字符
                                depth = 0
                                in_string = False
                                escape_next = False
                                for i in range(json_start, len(txt)):
                                    if escape_next:
                                        escape_next = False
                                        continue
                                    
                                    if txt[i] == '\\':
                                        escape_next = True
                                        continue
                                    
                                    if txt[i] == '"' and not escape_next:
                                        in_string = not in_string
                                        continue
                                    
                                    if not in_string:
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
                            if isinstance(data, dict):
                                # 支持新格式：selected_tools
                                if "selected_tools" in data:
                                    selected = data.get("selected_tools", [])
                                    tool_names = selected if isinstance(selected, list) else []
                                    intent = data.get("intent", "")
                                    return tool_names, intent, None
                                # 兼容旧格式：tool_calls
                                elif "tool_calls" in data:
                                    tc = data.get("tool_calls", [])
                                    if isinstance(tc, list):
                                        tool_names = [call.get("name") for call in tc if isinstance(call, dict) and call.get("name")]
                                        return tool_names, "兼容旧格式", None
                        except Exception as e:
                            continue

                    return [], None, last_err or "json parse failed"

                def _decide_with_llm(system_text: str, user_text: str, round_label: str) -> Tuple[List[str], Optional[str], str, Optional[str]]:
                    """
                    使用 LLM 决策工具选择（两步法）
                    
                    Returns:
                        (工具名称列表, intent, LLM输出文本, 错误信息)
                    """
                    out_text = ""
                    tool_names: List[str] = []
                    intent: Optional[str] = None
                    parse_err: Optional[str] = None
                    try:
                        log(f"{round_label}：使用LLM选择工具")
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
                            tool_names, intent, parse_err = _parse_llm_tool_selection(out_text)

                    except Exception as e:
                        log(f"⚠️ {round_label} LLM 决策失败: {str(e)}")
                        parse_err = f"llm_call_failed: {type(e).__name__}: {str(e)}"
                        out_text = ""

                    # 关键调试信息：输出预览 + 解析错误
                    preview = (out_text or "").replace("\n", "\\n")[:600]
                    print(f"{MAGENTA}[MCP EXEC] {round_label} LLM输出预览: {preview}{RESET}")
                    print(f"{CYAN}[MCP EXEC] {round_label} LLM输出总长度: {len(out_text or '')} 字符{RESET}")
                    print(f"{CYAN}[MCP EXEC] {round_label} 选择的工具: {tool_names}{RESET}")
                    if intent:
                        print(f"{CYAN}[MCP EXEC] {round_label} 用户意图: {intent}{RESET}")
                    if parse_err:
                        print(f"{YELLOW}[MCP EXEC] {round_label} 错误: {parse_err}{RESET}")

                    return tool_names, intent, out_text, parse_err

                # 第一次决策：LLM 选择工具（只返回工具名称）
                selected_tool_names, intent, llm_text, parse_error = _decide_with_llm(
                    iter_system,
                    iter_user,
                    f"第 {it+1}/{max_iterations} 轮",
                )

                # 允许一次重试：如果 LLM 没给出工具选择
                if not selected_tool_names:
                    retry_system = (
                        system_prompt
                        + "\n\n⚠️ 错误：你上一次没有返回合法的JSON格式。"
                        + "\n\n请重新思考并只返回JSON格式，不要任何其他内容："
                        + "\n- 需要工具：{\"selected_tools\": [\"tool_name1\"], \"intent\": \"意图\"}"
                        + "\n- 不需要工具：{\"selected_tools\": [], \"intent\": \"无需工具\"}"
                        + "\n\n现在请重新回答，只输出JSON："
                    )
                    selected_tool_names, intent, retry_text, retry_parse_error = _decide_with_llm(
                        retry_system,
                        iter_user,
                        f"第 {it+1}/{max_iterations} 轮（重试1次）",
                    )
                    if retry_text:
                        llm_text = retry_text
                        parse_error = retry_parse_error

                if not selected_tool_names:
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
                        error_msg = "LLM未返回有效的工具选择 JSON 格式"
                        suggestion = "LLM可能没有理解JSON格式要求，或返回了普通文本。请检查LLM模型是否支持结构化输出。"

                    error_details = {
                        "error": error_msg,
                        "logs": logs,
                        "llm_response": llm_text,
                        "debug": {
                            "llm_parse_error": parse_error,
                            "llm_output_length": len(llm_text or ""),
                            "available_tools": [t.get('name', '') for t in tools[:5]],  # 只显示前5个工具避免日志过长
                            "iteration": it + 1,
                            # "suggestion": suggestion  # 已移除，避免触发自动分析
                        },
                    }

                    # 记录详细的错误信息到日志
                    log(f"❌ LLM 工具选择失败：{parse_error}")
                    log(f"LLM 输出长度: {len(llm_text or '')} 字符")
                    log(f"LLM 输出预览: {(llm_text or '')[:200]}...")
                    if len(llm_text or '') > 200:
                        log(f"... (省略 {len(llm_text or '') - 200} 字符)")

                    return error_details

                # 执行本轮工具调用（两步法：先生成参数，再调用）
                log(f"第 {it+1} 轮：选择了 {len(selected_tool_names)} 个工具")
                for i, tool_name in enumerate(selected_tool_names[:5]):  # 每轮最多 5 个，避免失控
                    if not tool_name:
                        continue
                    
                    # 【两步法】步骤2：生成工具参数
                    # 验证工具名称是否真实存在
                    tool_name_str = str(tool_name).strip()
                    tool_name_lower = tool_name_str.lower()
                    tool_info = tool_name_map.get(tool_name_lower)
                    
                    if not tool_info:
                        # 尝试模糊匹配
                        matched_tool_info = None
                        for actual_name, info in tool_name_map.items():
                            if tool_name_lower in actual_name or actual_name in tool_name_lower:
                                matched_tool_info = info
                                tool_name_str = info['name']  # 使用真实的工具名称
                                tool_info = info
                                log(f"工具名称修正: {tool_name_lower} -> {tool_name_str}")
                                break
                        
                        if not matched_tool_info:
                            error_msg = f"工具 '{tool_name_str}' 不存在。可用工具: {', '.join([t['name'] for t in tools[:10]])}"
                            log(f"❌ {error_msg}")
                            results.append({"tool": tool_name_str, "error": error_msg})
                            continue
                        
                        tool_info = matched_tool_info
                    
                    # 【两步法核心】自动生成工具参数（减少日志输出以加速）
                    # 从 effective_input 中提取用户的实际请求（去除工具描述和历史上下文）
                    actual_user_request = extract_user_request_from_input(effective_input)
                    if not actual_user_request:
                        actual_user_request = effective_input  # 如果提取失败，使用原始输入
                    
                    tool_args = generate_tool_arguments(
                        tool_name=tool_name_str,
                        tool_info=tool_info,
                        user_input=actual_user_request,
                        context={
                            'original_message': original_message or {'ext': {}},
                        },
                        llm_config=llm_config,  # 传递 LLM 配置
                        full_input_text=effective_input,  # 传递完整输入（包含对话历史）
                        add_log=None  # 不传递日志函数，减少输出
                    )
                    
                    # 只记录关键信息，不输出详细参数
                    log(f"准备调用工具: {tool_name_str}")
                    
                    # 验证必需参数是否都已生成
                    required_params = tool_info.get('required', [])
                    missing_required = [p for p in required_params if p not in tool_args or tool_args[p] is None]
                    if missing_required:
                        log(f"⚠️ 工具 {tool_name_str} 缺少必需参数: {missing_required}")
                        # 尝试使用默认值填充
                        props = tool_info.get('props', {})
                        for param in missing_required:
                            if param in props:
                                param_info = props[param]
                                default_val = param_info.get('default')
                                if default_val is not None:
                                    tool_args[param] = default_val
                                    log(f"  使用默认值填充 {param}: {default_val}")
                                else:
                                    # 如果没有默认值，使用空字符串（避免调用失败）
                                    tool_args[param] = ""
                                    log(f"  使用空值填充 {param}")
                    
                    # 移除值为 None 的参数
                    tool_args = {k: v for k, v in tool_args.items() if v is not None}

                    # 防止重复调用同一个工具（同一轮次内）
                    if tool_name_str.lower() in executed_tool_names:
                        log(f"⚠️ 跳过重复的工具调用: {tool_name_str}")
                        continue

                    # 通用安全拦截：破坏性工具必须用户明确要求
                    destructive_markers = ("delete", "clear", "remove", "logout", "reset", "wipe")
                    user_lower_for_policy = (effective_input or "").lower()
                    user_asked_destructive = any(k in user_lower_for_policy for k in ("删除", "清除", "移除", "登出", "退出登录", "delete", "clear", "remove", "logout", "reset", "wipe"))
                    if (not user_asked_destructive) and any(m in tool_name_str.lower() for m in destructive_markers):
                        msg = f"Blocked destructive tool call without explicit user request: {tool_name_str}"
                        log(f"❌ {msg}")
                        results.append({
                            "tool": tool_name_str,
                            "error": msg,
                            "error_type": "policy",
                        })
                        return {
                            "error": msg,
                            "logs": logs,
                            "results": results,
                        }

                    all_tool_calls.append({"name": tool_name_str, "arguments": tool_args, "auto_generated": True})
                    # 减少日志输出，只记录关键信息
                    log(f"执行工具: {tool_name_str}")
                    
                    try:
                        # 使用 mcp_common_logic 直接调用工具（不传递 log 以减少输出）
                        tool_result = call_mcp_tool(server_url, headers, tool_name_str, tool_args, None)
                        
                        # 处理新的结构化返回格式
                        if isinstance(tool_result, dict):
                            if tool_result.get('success'):
                                # 成功
                                result_data = tool_result.get('data')
                                result_text = tool_result.get('text')
                                raw_result = tool_result.get('raw_result')
                                
                                results.append({
                                    'tool': tool_name_str,
                                    'result': {
                                        'jsonrpc': '2.0',
                                        'result': raw_result or {'content': [{'type': 'text', 'text': str(result_data)}]}
                                    },
                                    'tool_text': result_text or str(result_data) if result_data else '',
                                })
                                # 成功：只记录简要信息
                                executed_tool_names.add(tool_name_str.lower())
                            else:
                                # 失败 - 区分错误类型（只记录错误，不记录详细信息）
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
                                
                                # 只记录错误，不输出详细信息
                                log(f"❌ {tool_name_str}: {error_display[:100]}")
                                results.append({
                                    "tool": tool_name_str,
                                    "error": error_display,
                                    "error_type": error_type,
                                    "error_code": error_code,
                                })
                        else:
                            # 兼容旧格式（直接返回结果）
                            if tool_result:
                                results.append({
                                    'tool': tool_name_str,
                                    'result': {
                                        'jsonrpc': '2.0',
                                        'result': {'content': [{'type': 'text', 'text': str(tool_result)}]}
                                    }
                                })
                                # 成功：只记录简要信息
                                executed_tool_names.add(tool_name_str.lower())
                            else:
                                results.append({"tool": tool_name_str, "error": "工具返回空结果"})
                                
                    except Exception as e:
                        import traceback
                        # 只记录简要错误信息
                        log(f"❌ {tool_name_str}: {str(e)[:100]}")
                        results.append({
                            "tool": tool_name_str,
                            "error": f"执行异常: {str(e)}",
                            "error_type": "exception",
                        })

                # 两步法：完成本轮后结束（不再需要 done_flag 判断）
                break

            # 抽取可读文本输出，给 LLM 作为“事实源”（优化：提取所有可用信息）
            tool_text_outputs: List[str] = []
            all_extracted_media: List[Dict[str, Any]] = []  # 收集所有提取的媒体数据
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
                    
                    # 提取 content 中的文本内容和图片数据
                    content = (tool_resp.get("result") or {}).get("content")
                    texts = []
                    tool_images = []  # 当前工具返回的图片
                    
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict):
                                item_type = item.get("type", "")
                                if item_type == "text" and item.get("text"):
                                    texts.append(str(item.get("text")))
                                elif item_type == "image" and item.get("data"):
                                    # 提取图片数据
                                    image_data = item.get("data")
                                    mime_type = item.get("mimeType") or item.get("mime_type") or "image/png"
                                    
                                    # 如果 data 是 data URL，提取 base64 部分
                                    if isinstance(image_data, str) and image_data.startswith("data:"):
                                        # 提取 base64 部分
                                        comma_idx = image_data.find(",")
                                        if comma_idx >= 0:
                                            # 从 data URL 中提取 mime type
                                            mime_part = image_data[5:comma_idx].split(";")[0]
                                            if mime_part:
                                                mime_type = mime_part
                                            image_data = image_data[comma_idx + 1:]
                                    
                                    if image_data:
                                        image_item = {
                                            "type": "image",
                                            "mimeType": mime_type,
                                            "data": image_data,
                                        }
                                        tool_images.append(image_item)
                                        all_extracted_media.append(image_item)
                                        texts.append(f"[图片数据已返回，大小: {len(str(image_data))} 字符]")
                                elif item_type:
                                    # 其他类型：尝试提取可读信息
                                    for key in ["text", "content", "message", "data"]:
                                        if item.get(key):
                                            texts.append(f"[{item_type}]: {str(item.get(key))[:500]}")
                                            break
                    
                    # 将提取的图片数据存储到结果中
                    if tool_images:
                        r["media"] = tool_images
                    
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
                "media": all_extracted_media if all_extracted_media else None,  # 提取的所有媒体数据
            }

        finally:
            if cursor:
                cursor.close()
            conn.close()

    except Exception as e:
        return {"error": str(e), "logs": logs}

