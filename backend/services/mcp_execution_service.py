"""
MCP 执行服务（供 AgentActor/接口复用）

目标：
- 给定 mcp_server_id + 用户输入 + llm_config_id
- 先获取 MCP tools 列表
- 用 LLM 产出 tool_calls JSON
- 执行 tool_calls 并返回结构化结果 + logs

注意：这里不依赖 Flask app.py，避免循环导入。
使用 mcp_common_logic 模块直接调用 MCP（类似 ok-publish 分支）。

性能优化:
- 使用 LRU 缓存减少数据库查询
- 启用 tools/list 缓存（60秒 TTL）
- 减少不必要的重试和迭代

代码组织:
- 通用工具函数已迁移到 services.mcp.* 模块
- 本文件保留核心执行逻辑和向后兼容接口
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests
import pymysql

from database import get_mysql_connection
from mcp_server.mcp_common_logic import (
    get_mcp_tools_list, 
    call_mcp_tool, 
    prepare_mcp_headers, 
    initialize_mcp_session,
)
from services.cache import (
    get_llm_config_cached,
    get_mcp_server_cached,
    llm_config_cache,
    mcp_server_cache,
)

# 从新模块导入工具函数（逐步迁移）
from services.mcp.utils import (
    create_logger as _mk_logger_new,
    truncate_deep as _truncate_deep_new,
    build_tool_description,
    build_tool_name_map,
    convert_to_openai_tools,
    Colors,
)
from services.mcp.text_extractor import (
    extract_user_request as extract_user_request_from_input,
    extract_title as extract_title_from_text,
    extract_images_from_context,
    clean_tool_usage_marker,
)
from services.mcp.argument_generator import (
    validate_and_convert_param as _validate_and_convert_param,
    generate_tool_arguments,
)
from services.mcp.llm_caller import (
    call_llm_api,
    call_llm_with_tools,
)


# ==================== 参数生成辅助函数（两步法）====================

def _retry_with_error_analysis(
    tool_name: str,
    tool_info: Dict[str, Any],
    original_args: Dict[str, Any],
    error_message: str,
    user_request: str,
    full_context: str,
    llm_config: Dict[str, Any],
    original_message: Optional[Dict[str, Any]],
    add_log: Optional[callable] = None
) -> Optional[Dict[str, Any]]:
    """
    分析错误信息并使用 LLM 重新生成参数
    
    Args:
        tool_name: 工具名称
        tool_info: 工具信息
        original_args: 原始参数
        error_message: 错误信息
        user_request: 用户请求
        full_context: 完整上下文
        llm_config: LLM 配置
        original_message: 原始消息
        add_log: 日志函数
    
    Returns:
        重新生成的参数字典，如果失败返回 None
    """
    props = tool_info.get('props', {})
    required = tool_info.get('required', [])
    
    # 构建参数描述（包含错误信息）
    param_descriptions = []
    for param_name, param_info in props.items():
        param_type = param_info.get('type', 'string')
        param_desc = param_info.get('description', '')
        is_required = param_name in required
        req_mark = "（必需）" if is_required else "（可选）"
        param_descriptions.append(f"- {param_name} ({param_type}){req_mark}: {param_desc}")
    
    # 构建系统提示词（包含错误分析）
    system_prompt = f"""你是一个参数修复助手。之前的工具调用失败了，请分析错误信息并重新生成正确的参数。

工具名称：{tool_name}
工具描述：{tool_info.get('description', '')}

需要生成的参数：
{chr(10).join(param_descriptions)}

之前的调用参数：
{json.dumps(original_args, ensure_ascii=False, indent=2)}

错误信息：
{error_message}

重要提示：
1. 仔细分析错误信息，找出哪些参数有问题（缺失、类型错误、格式错误等）
2. 从对话历史和用户请求中提取正确的参数值
3. 确保所有必需参数都有值
4. 确保参数类型符合要求（string/number/integer/boolean/array/object）
5. 如果错误信息中提到了具体的参数要求，请严格按照要求填写

返回格式必须是有效的 JSON 对象，只包含参数名和参数值。例如：
{{
  "param1": "正确的值",
  "param2": 123,
  "param3": ["数组", "值"]
}}

注意：只返回 JSON 对象，不要包含任何其他文字说明。"""
    
    # 调用 LLM
    if add_log:
        add_log(f"  使用 LLM 分析错误并重新生成参数...")
    
    llm_response = call_llm_api(llm_config, system_prompt, full_context, add_log)
    if not llm_response:
        return None
    
    # 解析 JSON
    try:
        json_match = re.search(r'\{[\s\S]*\}', llm_response)
        if json_match:
            args = json.loads(json_match.group())
            # 验证参数类型
            validated_args = {}
            for param_name, param_value in args.items():
                if param_name not in props:
                    continue
                param_info = props[param_name]
                param_type = param_info.get('type', 'string')
                
                try:
                    validated_value = _validate_and_convert_param(
                        param_name, param_value, param_info, param_type
                    )
                    if validated_value is not None:
                        validated_args[param_name] = validated_value
                except Exception as e:
                    if add_log:
                        add_log(f"  ⚠️ 参数 {param_name} 类型转换失败: {e}，使用原值")
                    validated_args[param_name] = param_value
            
            # 处理图片参数（从 context 中提取）
            for param_name in ['images', 'image', 'photos', 'pictures', 'files']:
                if param_name in props:
                    images = extract_images_from_context({
                        'original_message': original_message or {'ext': {}}
                    })
                    if images:
                        param_type = props[param_name].get('type', 'string')
                        if param_type == 'array':
                            validated_args[param_name] = images
                        elif images:
                            validated_args[param_name] = images[0]
            
            # 确保所有必需参数都有值
            for param_name in required:
                if param_name not in validated_args or validated_args[param_name] is None:
                    # 如果缺失必需参数，尝试使用默认值
                    if param_name in props:
                        default_val = props[param_name].get('default')
                        if default_val is not None:
                            validated_args[param_name] = default_val
                        elif add_log:
                            add_log(f"  ⚠️ 必需参数 {param_name} 仍然缺失")
            
            if add_log:
                add_log(f"  ✅ 重新生成 {len(validated_args)} 个参数")
            
            return validated_args
    except json.JSONDecodeError as e:
        if add_log:
            add_log(f"  ⚠️ LLM 返回的 JSON 解析失败: {e}")
        return None
    except Exception as e:
        if add_log:
            add_log(f"  ⚠️ 参数重新生成出错: {e}")
        return None
    
    return None


def _validate_and_convert_param(
    param_name: str,
    param_value: Any,
    param_info: Dict[str, Any],
    param_type: str
) -> Any:
    """
    验证和转换参数类型（支持复杂类型）
    
    Args:
        param_name: 参数名称
        param_value: 参数值
        param_info: 参数信息（包含 type, enum, items, properties 等）
        param_type: 参数类型（string, number, integer, boolean, array, object）
    
    Returns:
        转换后的参数值
    """
    # 处理枚举类型
    if 'enum' in param_info:
        enum_values = param_info['enum']
        if param_value in enum_values:
            return param_value
        # 尝试大小写不敏感匹配
        if isinstance(param_value, str):
            for ev in enum_values:
                if isinstance(ev, str) and param_value.lower() == ev.lower():
                    return ev
        # 如果都不匹配，返回第一个枚举值或原值
        return enum_values[0] if enum_values else param_value
    
    # 处理数组类型
    if param_type == 'array':
        if isinstance(param_value, list):
            # 验证数组元素类型
            items_schema = param_info.get('items', {})
            if isinstance(items_schema, dict):
                item_type = items_schema.get('type', 'string')
                validated_list = []
                for item in param_value:
                    try:
                        validated_item = _validate_and_convert_param(
                            f"{param_name}[item]", item, items_schema, item_type
                        )
                        validated_list.append(validated_item)
                    except:
                        validated_list.append(item)
                return validated_list
            return param_value
        elif param_value:
            # 单个值转换为数组
            return [param_value]
        else:
            return []
    
    # 处理对象类型
    if param_type == 'object':
        if isinstance(param_value, dict):
            # 验证对象属性
            properties = param_info.get('properties', {})
            if properties:
                validated_obj = {}
                for prop_name, prop_info in properties.items():
                    if prop_name in param_value:
                        prop_type = prop_info.get('type', 'string')
                        try:
                            validated_obj[prop_name] = _validate_and_convert_param(
                                prop_name, param_value[prop_name], prop_info, prop_type
                            )
                        except:
                            validated_obj[prop_name] = param_value[prop_name]
                    elif prop_name in param_info.get('required', []):
                        # 必需属性缺失，使用默认值或 None
                        default_val = prop_info.get('default')
                        if default_val is not None:
                            validated_obj[prop_name] = default_val
                return validated_obj
            return param_value
        elif isinstance(param_value, str):
            # 尝试解析 JSON 字符串
            try:
                parsed = json.loads(param_value)
                if isinstance(parsed, dict):
                    return _validate_and_convert_param(param_name, parsed, param_info, 'object')
            except:
                pass
        # 无法转换，返回原值
        return param_value
    
    # 处理数字类型
    if param_type in ['number', 'integer']:
        if isinstance(param_value, (int, float)):
            return int(param_value) if param_type == 'integer' else float(param_value)
        elif isinstance(param_value, str):
            try:
                # 尝试转换字符串为数字
                if '.' in param_value:
                    return float(param_value) if param_type == 'number' else int(float(param_value))
                else:
                    return int(param_value) if param_type == 'integer' else float(param_value)
            except:
                return param_value
        else:
            return param_value
    
    # 处理布尔类型
    if param_type == 'boolean':
        if isinstance(param_value, bool):
            return param_value
        elif isinstance(param_value, str):
            return param_value.lower() in ('true', '1', 'yes', '是', 'on')
        elif isinstance(param_value, (int, float)):
            return bool(param_value)
        else:
            return bool(param_value)
    
    # 处理字符串类型（默认）
    if param_type == 'string':
        return str(param_value) if param_value is not None else ''
    
    # 未知类型，返回原值
    return param_value


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
            # 验证参数类型（支持复杂类型）
            validated_args = {}
            for param_name, param_value in args.items():
                if param_name not in props:
                    continue  # 忽略未知参数
                param_info = props[param_name]
                param_type = param_info.get('type', 'string')
                
                # 类型验证和转换
                try:
                    validated_value = _validate_and_convert_param(
                        param_name, param_value, param_info, param_type
                    )
                    if validated_value is not None:
                        validated_args[param_name] = validated_value
                except Exception as e:
                    if add_log:
                        add_log(f"  ⚠️ 参数 {param_name} 类型转换失败: {e}，使用原值")
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
    
    # 【性能优化】快速路径：简单参数场景跳过 LLM 调用
    print(f"[ArgGen] tool={tool_name}, props={list(props.keys())}, required={required}")
    
    # 情况1：无参数工具，直接返回空字典
    if not props and not required:
        print(f"[ArgGen] ⚡ 无参数工具，直接返回空字典")
        return {}
    
    # 情况2：工具名暗示无需复杂参数（check_*, get_status*, list_* 等）
    no_arg_patterns = ('check_', 'get_status', 'get_profile', 'get_login', 'list_', 'show_')
    tool_lower = tool_name.lower()
    if any(tool_lower.startswith(p) for p in no_arg_patterns) and not required:
        print(f"[ArgGen] ⚡ 查询类工具无必需参数，跳过 LLM")
        # 直接走规则匹配
        pass  # 继续往下走规则匹配逻辑
    
    # 情况3：只有简单参数且无必需参数
    elif not required and len(props) <= 2:
        simple_params = {'input', 'query', 'text', 'prompt', 'message', 'content', 'q', 'keyword'}
        if all(p.lower() in simple_params for p in props.keys()):
            print(f"[ArgGen] ⚡ 简单可选参数，跳过 LLM")
            # 填充简单参数
            args = {}
            for param in props.keys():
                args[param] = user_input
            return args
    
    # 情况4：有必需参数但都是简单类型
    else:
        # 如果提供了 LLM 配置和完整输入文本，使用 LLM 提取参数
        if llm_config and full_input_text:
            try:
                print(f"[ArgGen] 🤖 复杂参数，使用 LLM 提取...")
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


# ==================== 工具函数（使用新模块实现） ====================
# 这些函数已迁移到 services.mcp.* 模块
# 保留本地定义是为了向后兼容，实际调用新模块实现

def _mk_logger(external_log: Optional[Callable] = None) -> Tuple[List[str], Callable]:
    """创建日志记录器（使用新模块实现）"""
    return _mk_logger_new(external_log)


def _truncate_deep(obj: Any, *, max_str: int = 2000) -> Any:
    """深度截断对象（使用新模块实现）"""
    return _truncate_deep_new(obj, max_str=max_str)


# call_llm_api 和 call_llm_with_tools 已从 services.mcp.llm_caller 导入
# 无需在此重复定义


# ==================== 核心执行函数 ====================

def execute_mcp_with_llm(
    *,
    mcp_server_id: str,
    input_text: str,
    llm_config_id: str,
    add_log: Optional[Callable] = None,
    max_iterations: int = 1,  # 性能优化：默认只执行一轮（两步法不需要多轮）
    topic_id: Optional[str] = None,
    existing_session_id: Optional[str] = None,
    agent_system_prompt: Optional[str] = None,  # Agent 的人设/系统提示词
    original_message: Optional[Dict[str, Any]] = None,  # 原始消息（用于提取图片等上下文）
    forced_tool_name: Optional[str] = None,  # 指定工具名则跳过 LLM 选择
    forced_tool_args: Optional[Dict[str, Any]] = None,  # 指定工具参数
    enable_tool_calling: bool = True,  # 是否启用原生 Tool Calling
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
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
    
    import datetime
    def _ts():
        """返回当前时间戳字符串"""
        return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    
    # 发送执行日志到前端
    def _send_log(message: str, log_type: str = 'info', detail: str = None, duration: int = None):
        """发送执行日志到前端"""
        if not topic_id:
            return
        try:
            from services.topic_service import get_topic_service
            import time
            log_data = {
                'id': f"mcp-log-{int(time.time() * 1000)}-{id(message)}",
                'timestamp': int(time.time() * 1000),
                'log_type': log_type,
                'message': message,
            }
            if detail:
                log_data['detail'] = detail
            if duration is not None:
                log_data['duration'] = duration
            get_topic_service()._publish_event(topic_id, 'execution_log', log_data)
        except Exception as e:
            print(f"{YELLOW}[MCP EXEC] 发送执行日志失败: {e}{RESET}")
    
    print(f"{MAGENTA}{BOLD}[MCP EXEC] ========== execute_mcp_with_llm 开始 [{_ts()}] =========={RESET}")
    print(f"{MAGENTA}[MCP EXEC] Server: {mcp_server_id}, LLM: {llm_config_id}{RESET}")
    print(f"{MAGENTA}[MCP EXEC] Input 长度: {len(input_text) if input_text else 0} 字符{RESET}")
    
    _send_log("初始化 MCP 执行环境...", log_type='step')
    
    logs, log = _mk_logger(add_log)

    try:
        # 去掉 AgentActor 注入的“工具使用权提示”，避免污染 LLM 决策输入
        effective_input = re.sub(r"^\[你已获得工具使用权：.*?\]\s*", "", input_text or "").strip()
        if not effective_input:
            effective_input = input_text or ""

        # 使用缓存获取 LLM 配置（性能优化：减少数据库查询）
        log(f"获取LLM配置: {llm_config_id}")
        try:
            from services.llm_service import get_llm_service
            llm_service = get_llm_service()
            
            # 使用缓存版本（TTL 5分钟）
            llm_config = get_llm_config_cached(
                config_id=llm_config_id,
                get_config_func=llm_service.get_config,
                include_api_key=True,
            )
            
            if not llm_config:
                log(f"❌ LLM配置不存在或已禁用: {llm_config_id}")
                return {"error": "LLM config not found or disabled", "logs": logs}
            
            # 简化日志输出
            log(f"✅ LLM配置: {llm_config.get('provider')}/{llm_config.get('model')}")

            # 验证LLM配置的完整性
            missing_fields = [
                field for field in ('provider', 'model', 'api_key')
                if not llm_config.get(field)
            ]
            if missing_fields:
                error_msg = f"LLM配置不完整，缺少字段: {', '.join(missing_fields)}"
                log(f"❌ {error_msg}")
                return {"error": error_msg, "logs": logs}
        except Exception as e:
            error_msg = f"获取LLM配置失败: {str(e)}"
            log(f"❌ {error_msg}")
            return {"error": error_msg, "logs": logs}

        # 获取 MCP 服务器配置（使用缓存优化）
        def _fetch_mcp_server(server_id: str) -> Optional[Dict[str, Any]]:
            """从数据库获取 MCP 服务器配置"""
            conn = get_mysql_connection()
            if not conn:
                return None
            try:
                cursor = conn.cursor(pymysql.cursors.DictCursor)
                cursor.execute(
                    """
                    SELECT server_id, name, url, enabled
                    FROM mcp_servers
                    WHERE server_id = %s AND enabled = 1
                    """,
                    (server_id,),
                )
                return cursor.fetchone()
            finally:
                cursor.close()
                conn.close()
        
        log(f"获取MCP服务器配置: {mcp_server_id}")
        mcp_server = get_mcp_server_cached(mcp_server_id, _fetch_mcp_server)
        
        if not mcp_server:
            return {"error": "MCP server not found or disabled", "logs": logs}

        server_name = mcp_server.get("name") or mcp_server_id
        server_url = mcp_server.get("url")
        log(f"✅ MCP服务器: {server_name}")
        
        # 获取数据库连接（用于后续操作）
        conn = get_mysql_connection()
        if not conn:
            return {"error": "MySQL not available", "logs": logs}

        cursor = None
        try:

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
            print(f"{CYAN}[MCP EXEC] [{_ts()}] Step 1: Initialize session...{RESET}")
            _send_log("初始化 MCP 会话...", log_type='step')
            if 'mcp-session-id' not in headers:
                init_response = initialize_mcp_session(server_url, headers)
                if not init_response:
                    log("⚠️ MCP initialize 失败，但继续尝试获取工具列表")
                    _send_log("会话初始化失败，继续尝试", log_type='info')
                else:
                    log(f"MCP 会话初始化成功，session_id: {headers.get('mcp-session-id', 'N/A')[:16]}...")
                    _send_log("会话初始化成功", log_type='step')
            else:
                log(f"跳过 MCP 会话初始化，使用已有 session_id")
                _send_log("复用已有会话", log_type='step')
            print(f"{CYAN}[MCP EXEC] [{_ts()}] Step 1 完成{RESET}")
            
            # 3. 获取工具列表（性能优化：启用缓存，减少 MCP 调用）
            print(f"{CYAN}[MCP EXEC] [{_ts()}] Step 2: tools/list...{RESET}")
            log("Step 2/3: tools/list")
            _send_log("获取可用工具列表...", log_type='step')
            # 优化：启用 60 秒缓存，工具列表不常变化
            # auto_reconnect=True 会在失败时自动清理旧连接并重试
            tools_response = get_mcp_tools_list(
                server_url, 
                headers, 
                use_cache=True,  # 性能优化：启用缓存
                auto_reconnect=True,
            )
            print(f"{CYAN}[MCP EXEC] [{_ts()}] Step 2 完成{RESET}")
            
            if not tools_response or 'result' not in tools_response:
                # 获取失败时的调试信息
                from mcp_server.mcp_common_logic import get_mcp_health_status
                health_status = get_mcp_health_status(server_url)
                last_error = (
                    f"Invalid response: {str(tools_response)[:200]}" 
                    if tools_response else "No response from MCP server"
                )
                log(f"❌ 获取工具列表失败: {last_error}")
                return {
                    "error": "Failed to get MCP tools list",
                    "logs": logs,
                    "debug": {
                        "server_url": server_url,
                        "mcp_session_id": headers.get("mcp-session-id"),
                        "tools_response_preview": _truncate_deep(tools_response, max_str=1200),
                        "health_status": health_status,
                        "last_error": last_error,
                        "hint": "MCP 服务可能不可用，请检查 MCP 服务状态。",
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
            _send_log(f"获取到 {len(tools)} 个可用工具", log_type='step', detail=', '.join(all_tool_names[:5]) + ('...' if len(all_tool_names) > 5 else ''))
            
            # ==================== 【性能优化】简单意图直接映射（跳过 LLM 选择） ====================
            # 对于明确的用户意图，直接匹配工具，跳过 LLM 选择步骤（节省 ~1.6秒）
            def _try_fast_tool_match(user_text: str, available_tools: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
                """
                尝试快速匹配工具（基于关键词）
                
                Returns:
                    匹配的工具信息，如果没有匹配返回 None
                """
                if not user_text:
                    return None
                
                user_lower = user_text.lower()
                
                # 关键词 → 工具名映射（支持中英文）
                keyword_tool_map = {
                    # 登录相关
                    ('登录状态', '登陆状态', 'login status', 'check login'): 'check_login_status',
                    ('二维码', 'qrcode', 'qr code', '扫码登录'): 'get_login_qrcode',
                    ('退出登录', '登出', 'logout', '清除cookie', 'delete cookie'): 'delete_cookies',
                    # 用户相关
                    ('用户信息', '我的信息', '个人信息', 'user profile', 'my profile'): 'user_profile',
                    # 内容相关
                    ('笔记列表', '我的笔记', 'list feeds', 'my feeds'): 'list_feeds',
                    ('搜索', 'search'): 'search_feeds',
                }
                
                # 尝试匹配
                for keywords, tool_name in keyword_tool_map.items():
                    if any(kw in user_lower for kw in keywords):
                        # 检查工具是否存在
                        for tool in available_tools:
                            if tool.get('name', '').lower() == tool_name.lower():
                                schema = tool.get("inputSchema") or tool.get("input_schema") or tool.get("parameters") or {}
                                props = schema.get("properties", {}) if isinstance(schema, dict) else {}
                                required = schema.get("required", []) if isinstance(schema, dict) else []
                                
                                # 只对无参数或简单参数的工具使用快速匹配
                                if not required:
                                    return {
                                        'name': tool.get('name'),
                                        'description': tool.get('description', ''),
                                        'schema': schema,
                                        'props': props,
                                        'required': required,
                                    }
                return None
            
            # 尝试快速匹配
            fast_matched_tool = _try_fast_tool_match(effective_input, tools)
            if fast_matched_tool and not forced_tool_name:
                print(f"{GREEN}[MCP EXEC] ⚡ 快速匹配成功: {fast_matched_tool['name']}（跳过 LLM 选择）{RESET}")
                log(f"⚡ 快速匹配工具: {fast_matched_tool['name']}（跳过 LLM）")
                _send_log(f"⚡ 快速匹配: {fast_matched_tool['name']}", log_type='tool', detail='跳过 LLM 选择')
                
                # 直接调用匹配的工具
                print(f"{CYAN}[MCP EXEC] [{_ts()}] 快速路径 - MCP 工具调用开始: {fast_matched_tool['name']}{RESET}")
                _send_log(f"正在执行工具: {fast_matched_tool['name']}...", log_type='tool')
                fast_call_start = datetime.datetime.now()
                fast_result = call_mcp_tool(
                    target_url=server_url,
                    headers=headers,
                    tool_name=fast_matched_tool['name'],
                    tool_args={},  # 无参数工具
                    add_log=None,
                )
                fast_call_duration = int((datetime.datetime.now() - fast_call_start).total_seconds() * 1000)
                print(f"{CYAN}[MCP EXEC] [{_ts()}] 快速路径 - MCP 工具调用完成: {fast_matched_tool['name']}{RESET}")
                _send_log(f"工具执行完成: {fast_matched_tool['name']}", log_type='tool', duration=fast_call_duration)
                
                if fast_result.get("success"):
                    tool_text = fast_result.get("text") or str(fast_result.get("data", ""))
                    summary = f"✅ MCP \"{server_name}\" 执行完成（⚡快速匹配：{fast_matched_tool['name']}）"
                    results = [{
                        "tool": fast_matched_tool['name'],
                        "tool_text": tool_text,
                        "raw_result": fast_result.get("raw_result"),
                        "success": True,
                    }]
                    print(f"{GREEN}[MCP EXEC] [{_ts()}] ========== execute_mcp_with_llm 结束（快速路径） =========={RESET}")
                    return {
                        "summary": summary,
                        "tool_text": tool_text,
                        "results": results,
                        "raw_result": fast_result.get("raw_result"),
                        "raw_result_compact": _truncate_deep(fast_result.get("raw_result"), max_str=1200),
                        "logs": logs,
                        "media": [],
                        "mcp_session_id": headers.get('mcp-session-id'),
                        "fast_matched": True,
                    }
                else:
                    # 快速匹配失败，回退到正常流程
                    log(f"⚠️ 快速匹配工具调用失败，回退到 LLM 选择: {fast_result.get('error')}")
                    print(f"{YELLOW}[MCP EXEC] ⚠️ 快速匹配失败，回退 LLM 流程{RESET}")
            
            # ==================== 直接调用指定工具（跳过 LLM 选择） ====================
            if forced_tool_name:
                forced_name = str(forced_tool_name).strip()
                tool_map = build_tool_name_map(tools)
                tool_info = tool_map.get(forced_name.lower())
                if not tool_info:
                    return {
                        "error": f"指定工具不存在: {forced_name}",
                        "logs": logs,
                    }
                
                direct_args = forced_tool_args if isinstance(forced_tool_args, dict) else {}
                log(f"🔧 直接调用工具: {tool_info.get('name')}（跳过 LLM 选择）")
                
                direct_result = call_mcp_tool(
                    target_url=server_url,
                    headers=headers,
                    tool_name=tool_info.get('name'),
                    tool_args=direct_args,
                    add_log=None,
                )
                
                if direct_result.get("success"):
                    tool_text = direct_result.get("text") or str(direct_result.get("data", ""))
                    summary = f"✅ MCP \"{server_name}\" 执行完成（1 个工具调用：{tool_info.get('name')}）"
                    results = [{
                        "tool": tool_info.get("name"),
                        "tool_text": tool_text,
                        "raw_result": direct_result.get("raw_result"),
                        "success": True,
                    }]
                    return {
                        "summary": summary,
                        "tool_text": tool_text,
                        "results": results,
                        "raw_result": direct_result.get("raw_result"),
                        "raw_result_compact": _truncate_deep(direct_result.get("raw_result"), max_str=1200),
                        "logs": logs,
                        "media": [],
                        "mcp_session_id": headers.get('mcp-session-id'),
                        "native_tool_calling": False,
                        "forced_tool_calling": True,
                    }
                
                error_msg = direct_result.get("error") or "MCP tool call failed"
                return {
                    "error": error_msg,
                    "logs": logs,
                    "results": [{
                        "tool": tool_info.get("name"),
                        "error": error_msg,
                        "error_type": direct_result.get("error_type", "unknown"),
                        "success": False,
                    }],
                    "mcp_session_id": headers.get('mcp-session-id'),
                    "forced_tool_calling": True,
                }

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
            # 支持原生 function calling 的模型可以一次 API 调用完成工具选择
            # 优化：增加 Gemini 支持（使用 function_declarations）
            provider_type = llm_config.get('provider', '').lower()
            use_native_tool_calling = enable_tool_calling and provider_type in (
                'openai', 'deepseek', 'anthropic', 'claude', 'gemini', 'google'
            )
            
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
                    
                    # 解析工具调用
                    parsed_calls = []
                    for tc in tool_calls_from_native[:5]:  # 最多5个
                        tool_name = tc.get('function', {}).get('name') or tc.get('name', '')
                        tool_args_str = tc.get('function', {}).get('arguments') or tc.get('arguments', '{}')
                        
                        try:
                            if isinstance(tool_args_str, str):
                                tool_args = json.loads(tool_args_str) if tool_args_str else {}
                            else:
                                tool_args = tool_args_str if isinstance(tool_args_str, dict) else {}
                        except json.JSONDecodeError:
                            tool_args = {}
                        
                        parsed_calls.append((tool_name, tool_args))
                    
                    # 并行执行工具调用（性能优化）
                    from services.parallel import MCPToolCall, execute_mcp_tools_parallel
                    
                    mcp_tool_calls = [
                        MCPToolCall(tool_name=name, arguments=args)
                        for name, args in parsed_calls
                    ]
                    
                    def _call_mcp_wrapper(tool_name: str, tool_args: Dict[str, Any]) -> Dict[str, Any]:
                        """MCP 调用包装器"""
                        return call_mcp_tool(
                            target_url=server_url,
                            headers=headers,
                            tool_name=tool_name,
                            tool_args=tool_args,
                            add_log=None,  # 并行执行时不打印日志
                        )
                    
                    log(f"🚀 并行执行 {len(mcp_tool_calls)} 个工具调用...")
                    print(f"{CYAN}[MCP EXEC] 🚀 并行执行 {len(mcp_tool_calls)} 个工具{RESET}")
                    
                    parallel_results = execute_mcp_tools_parallel(
                        tool_calls=mcp_tool_calls,
                        call_func=_call_mcp_wrapper,
                        max_concurrent=3,  # 最多 3 个并发
                        timeout=60.0,
                    )
                    
                    # 转换结果格式
                    for pr in parallel_results:
                        if pr.success:
                            tool_text = ""
                            raw_result = pr.raw_result
                            
                            # 提取文本
                            if isinstance(pr.result, dict):
                                tool_text = pr.result.get('text') or str(pr.result.get('data', ''))
                            elif pr.result:
                                tool_text = str(pr.result)
                            
                            results.append({
                                "tool": pr.tool_name,
                                "tool_text": tool_text,
                                "raw_result": raw_result,
                                "success": True,
                                "duration_ms": pr.duration_ms,
                            })
                            executed_tool_names.add(pr.tool_name)
                            log(f"  ✅ {pr.tool_name} ({pr.duration_ms:.0f}ms)")
                        else:
                            results.append({
                                "tool": pr.tool_name,
                                "error": pr.error or "未知错误",
                                "success": False,
                                "duration_ms": pr.duration_ms,
                            })
                            log(f"  ❌ {pr.tool_name}: {pr.error}")
                    
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
                        print(f"{YELLOW}[MCP EXEC] [{_ts()}] LLM 调用开始: {round_label}{RESET}")
                        log(f"{round_label}：使用LLM选择工具")
                        log(f"   LLM配置ID: {llm_config_id}")
                        log(f"   LLM配置内容: provider={llm_config.get('provider')}, model={llm_config.get('model')}, has_api_key={bool(llm_config.get('api_key'))}")
                        _send_log(f"LLM 选择工具中...", log_type='llm', detail=f"{llm_config.get('provider')}/{llm_config.get('model')}")
                        llm_call_start = datetime.datetime.now()
                        api_result = call_llm_api(llm_config, system_text, user_text, log)
                        llm_call_duration = int((datetime.datetime.now() - llm_call_start).total_seconds() * 1000)
                        print(f"{YELLOW}[MCP EXEC] [{_ts()}] LLM 调用完成: {round_label}{RESET}")
                        _send_log(f"LLM 选择完成", log_type='llm', duration=llm_call_duration)

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
                    
                    print(f"{YELLOW}[MCP EXEC] [{_ts()}] 参数生成开始: {tool_name_str}{RESET}")
                    _send_log(f"生成工具参数: {tool_name_str}...", log_type='step')
                    arg_gen_start = datetime.datetime.now()
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
                    arg_gen_duration = int((datetime.datetime.now() - arg_gen_start).total_seconds() * 1000)
                    print(f"{YELLOW}[MCP EXEC] [{_ts()}] 参数生成完成: {tool_name_str}{RESET}")
                    _send_log(f"参数生成完成: {tool_name_str}", log_type='step', duration=arg_gen_duration)
                    
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
                        print(f"{BLUE}[MCP EXEC] [{_ts()}] MCP 工具调用开始: {tool_name_str}{RESET}")
                        _send_log(f"正在调用工具: {tool_name_str}...", log_type='tool')
                        mcp_call_start = datetime.datetime.now()
                        tool_result = call_mcp_tool(server_url, headers, tool_name_str, tool_args, None)
                        mcp_call_duration = int((datetime.datetime.now() - mcp_call_start).total_seconds() * 1000)
                        print(f"{BLUE}[MCP EXEC] [{_ts()}] MCP 工具调用完成: {tool_name_str}{RESET}")
                        _send_log(f"工具调用完成: {tool_name_str}", log_type='tool', duration=mcp_call_duration)
                        
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
                                # 失败 - 区分错误类型并尝试自修复
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
                                
                                # 尝试自修复：如果是参数错误，使用 LLM 重新生成参数
                                should_retry = False
                                retry_args = None
                                
                                # 检查是否是参数相关错误（业务错误通常包含参数要求）
                                if error_type == 'business' and error_msg:
                                    # 检查错误信息中是否包含参数提示
                                    param_error_keywords = [
                                        'required', 'missing', 'invalid', '参数', '必需', '缺少', '无效',
                                        'parameter', 'field', '字段', 'must', 'should'
                                    ]
                                    is_param_error = any(kw in error_msg.lower() for kw in param_error_keywords)
                                    
                                    if is_param_error:
                                        log(f"🔄 检测到参数错误，尝试自修复: {error_msg[:100]}")
                                        try:
                                            # 使用 LLM 分析错误并重新生成参数
                                            retry_args = _retry_with_error_analysis(
                                                tool_name_str,
                                                tool_info,
                                                tool_args,
                                                error_msg,
                                                actual_user_request,
                                                effective_input,
                                                llm_config,
                                                original_message,
                                                log
                                            )
                                            if retry_args and retry_args != tool_args:
                                                should_retry = True
                                                log(f"✅ 重新生成参数成功，准备重试")
                                        except Exception as retry_e:
                                            log(f"⚠️ 自修复失败: {retry_e}")
                                
                                # 如果自修复成功，重试调用
                                if should_retry and retry_args:
                                    log(f"🔄 重试工具调用: {tool_name_str}")
                                    try:
                                        retry_result = call_mcp_tool(server_url, headers, tool_name_str, retry_args, None)
                                        
                                        if isinstance(retry_result, dict) and retry_result.get('success'):
                                            # 重试成功
                                            result_data = retry_result.get('data')
                                            result_text = retry_result.get('text')
                                            raw_result = retry_result.get('raw_result')
                                            
                                            results.append({
                                                'tool': tool_name_str,
                                                'result': {
                                                    'jsonrpc': '2.0',
                                                    'result': raw_result or {'content': [{'type': 'text', 'text': str(result_data)}]}
                                                },
                                                'tool_text': result_text or str(result_data) if result_data else '',
                                                'retried': True,  # 标记为重试成功
                                            })
                                            executed_tool_names.add(tool_name_str.lower())
                                            log(f"✅ 重试成功: {tool_name_str}")
                                            continue  # 跳过错误记录
                                    except Exception as retry_e:
                                        log(f"⚠️ 重试调用失败: {retry_e}")
                                
                                # 记录错误（如果重试失败或未重试）
                                log(f"❌ {tool_name_str}: {error_display[:100]}")
                                results.append({
                                    "tool": tool_name_str,
                                    "error": error_display,
                                    "error_type": error_type,
                                    "error_code": error_code,
                                    "retried": should_retry,  # 标记是否尝试过重试
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

            print(f"{GREEN}[MCP EXEC] [{_ts()}] 结果处理完成，准备返回{RESET}")
            
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

            print(f"{GREEN}[MCP EXEC] [{_ts()}] ========== execute_mcp_with_llm 结束 =========={RESET}")
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

