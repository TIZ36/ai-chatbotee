"""
MCP 服务工具函数

日志、截断、辅助函数等。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple


def create_logger(
    external_log: Optional[Callable[[str], None]] = None,
) -> Tuple[List[str], Callable[[str], None]]:
    """
    创建日志记录器
    
    Args:
        external_log: 外部日志函数
        
    Returns:
        (logs列表, add_log函数)
    """
    logs: List[str] = []
    
    def add_log(message: str) -> None:
        line = f"[{datetime.now().strftime('%H:%M:%S')}] {message}"
        logs.append(line)
        if external_log:
            try:
                external_log(line)
            except Exception:
                pass
    
    return logs, add_log


def truncate_deep(obj: Any, *, max_str: int = 2000) -> Any:
    """
    深度截断对象中的长字符串
    
    避免将超大结果（如 base64）塞进 processSteps/system prompt。
    
    Args:
        obj: 待截断的对象
        max_str: 最大字符串长度
        
    Returns:
        截断后的对象
    """
    if obj is None:
        return None
    
    if isinstance(obj, str):
        if len(obj) > max_str:
            return f"{obj[:max_str]}...[truncated:{len(obj)}]"
        return obj
    
    if isinstance(obj, (int, float, bool)):
        return obj
    
    if isinstance(obj, list):
        return [truncate_deep(x, max_str=max_str) for x in obj[:200]]
    
    if isinstance(obj, dict):
        result: Dict[str, Any] = {}
        for k, v in list(obj.items())[:200]:
            # 常见二进制字段，更严格截断
            if k in ('data', 'image', 'base64', 'payload') and isinstance(v, str) and len(v) > 512:
                result[k] = f"{v[:256]}...[truncated:{len(v)}]"
            else:
                result[k] = truncate_deep(v, max_str=max_str)
        return result
    
    return str(obj)


def format_tool_params(schema: Dict[str, Any]) -> str:
    """
    格式化工具参数为可读描述
    
    Args:
        schema: JSON Schema
        
    Returns:
        格式化的参数描述
    """
    props = schema.get('properties', {})
    required = schema.get('required', [])
    
    if not props:
        return "  参数: 无"
    
    lines = []
    for name, info in props.items():
        ptype = info.get('type', 'string')
        desc = info.get('description', '')
        req_mark = "*必需*" if name in required else "可选"
        lines.append(f"    - {name} ({ptype}, {req_mark}): {desc}")
    
    return "  参数:\n" + "\n".join(lines)


def build_tool_description(tools: List[Dict[str, Any]]) -> str:
    """
    构建工具列表描述
    
    Args:
        tools: MCP 工具列表
        
    Returns:
        格式化的工具描述
    """
    parts = []
    
    for t in tools:
        name = t.get('name', '')
        desc = t.get('description', '')
        schema = (
            t.get('inputSchema') or 
            t.get('input_schema') or 
            t.get('parameters') or 
            {}
        )
        params_desc = format_tool_params(schema)
        parts.append(f"【{name}】\n  描述: {desc}\n{params_desc}")
    
    return '\n\n'.join(parts)


def build_tool_name_map(tools: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    构建工具名称映射
    
    Args:
        tools: MCP 工具列表
        
    Returns:
        {tool_name.lower(): {name, description, schema, props, required}}
    """
    tool_map: Dict[str, Dict[str, Any]] = {}
    
    for t in tools:
        name = t.get('name', '').strip()
        if not name:
            continue
        
        schema = (
            t.get('inputSchema') or 
            t.get('input_schema') or 
            t.get('parameters') or 
            {}
        )
        
        props = schema.get('properties', {}) if isinstance(schema, dict) else {}
        required = schema.get('required', []) if isinstance(schema, dict) else []
        
        tool_map[name.lower()] = {
            'name': name,
            'description': t.get('description', '').strip(),
            'schema': schema,
            'props': props if isinstance(props, dict) else {},
            'required': required if isinstance(required, list) else [],
        }
    
    return tool_map


def convert_to_openai_tools(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    转换 MCP 工具为 OpenAI 格式
    
    Args:
        tools: MCP 工具列表
        
    Returns:
        OpenAI function calling 格式的工具列表
    """
    openai_tools = []
    
    for t in tools:
        schema = (
            t.get('inputSchema') or 
            t.get('input_schema') or 
            t.get('parameters') or 
            {}
        )
        
        openai_tools.append({
            'type': 'function',
            'function': {
                'name': t.get('name', ''),
                'description': t.get('description', ''),
                'parameters': schema,
            }
        })
    
    return openai_tools


# ANSI 颜色码（用于控制台输出）
class Colors:
    """ANSI 颜色码常量"""
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    MAGENTA = '\033[95m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
