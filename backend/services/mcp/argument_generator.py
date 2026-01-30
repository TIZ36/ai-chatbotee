"""
工具参数生成器

根据工具 schema 和用户输入自动生成参数。
支持 LLM 智能提取和规则匹配回退。
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Optional

from services.mcp.text_extractor import extract_images_from_context, extract_title


def validate_and_convert_param(
    param_name: str,
    param_value: Any,
    param_info: Dict[str, Any],
    param_type: str,
) -> Any:
    """
    验证和转换参数类型
    
    支持类型: string, number, integer, boolean, array, object, enum
    """
    # 枚举类型
    if 'enum' in param_info:
        enum_values = param_info['enum']
        if param_value in enum_values:
            return param_value
        # 大小写不敏感匹配
        if isinstance(param_value, str):
            for ev in enum_values:
                if isinstance(ev, str) and param_value.lower() == ev.lower():
                    return ev
        return enum_values[0] if enum_values else param_value
    
    # 数组类型
    if param_type == 'array':
        if isinstance(param_value, list):
            items_schema = param_info.get('items', {})
            if isinstance(items_schema, dict):
                item_type = items_schema.get('type', 'string')
                return [
                    validate_and_convert_param(f"{param_name}[i]", item, items_schema, item_type)
                    for item in param_value
                ]
            return param_value
        return [param_value] if param_value else []
    
    # 对象类型
    if param_type == 'object':
        if isinstance(param_value, dict):
            properties = param_info.get('properties', {})
            if properties:
                validated = {}
                for prop_name, prop_info in properties.items():
                    if prop_name in param_value:
                        prop_type = prop_info.get('type', 'string')
                        validated[prop_name] = validate_and_convert_param(
                            prop_name, param_value[prop_name], prop_info, prop_type
                        )
                return validated
            return param_value
        elif isinstance(param_value, str):
            try:
                parsed = json.loads(param_value)
                if isinstance(parsed, dict):
                    return validate_and_convert_param(param_name, parsed, param_info, 'object')
            except json.JSONDecodeError:
                pass
        return param_value
    
    # 数字类型
    if param_type in ('number', 'integer'):
        if isinstance(param_value, (int, float)):
            return int(param_value) if param_type == 'integer' else float(param_value)
        if isinstance(param_value, str):
            try:
                if '.' in param_value:
                    return float(param_value) if param_type == 'number' else int(float(param_value))
                return int(param_value) if param_type == 'integer' else float(param_value)
            except ValueError:
                return param_value
        return param_value
    
    # 布尔类型
    if param_type == 'boolean':
        if isinstance(param_value, bool):
            return param_value
        if isinstance(param_value, str):
            return param_value.lower() in ('true', '1', 'yes', '是', 'on')
        return bool(param_value)
    
    # 字符串类型（默认）
    if param_type == 'string':
        return str(param_value) if param_value is not None else ''
    
    return param_value


class ArgumentGenerator:
    """
    工具参数生成器
    
    优先使用 LLM 智能提取，回退到规则匹配。
    
    Example:
        generator = ArgumentGenerator(llm_config)
        args = generator.generate(tool_name, tool_info, user_input, context)
    """
    
    def __init__(
        self,
        llm_config: Optional[Dict[str, Any]] = None,
        log_func: Optional[Callable] = None,
    ):
        self._llm_config = llm_config
        self._log = log_func or (lambda x: None)
    
    def generate(
        self,
        tool_name: str,
        tool_info: Dict[str, Any],
        user_input: str,
        context: Dict[str, Any],
        full_input_text: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        生成工具参数
        
        Args:
            tool_name: 工具名称
            tool_info: 工具信息（包含 schema, props, required）
            user_input: 用户输入
            context: 上下文信息
            full_input_text: 完整输入文本（用于 LLM 提取）
            
        Returns:
            参数字典
        """
        props = tool_info.get('props', {})
        required = tool_info.get('required', [])
        
        # 调试日志（直接打印到控制台，因为 add_log 可能是 None）
        print(f"[ArgGen] tool={tool_name}, props_keys={list(props.keys())}, required={required}")
        
        # 【性能优化】简单参数场景直接使用规则匹配，跳过 LLM 调用
        # 情况1：无参数
        if not props:
            print(f"[ArgGen] ⚡ 无参数，直接返回空字典")
            return {}
        
        # 情况2：只有一个简单参数（如 input, query, text）
        simple_params = {'input', 'query', 'text', 'prompt', 'message', 'content', 'q', 'keyword', 'keywords'}
        if len(props) == 1:
            param_name = list(props.keys())[0]
            if param_name.lower() in simple_params:
                self._log(f"  ⚡ 快速参数生成: {param_name}={user_input[:30]}...")
                return {param_name: user_input}
        
        # 情况3：工具名暗示无需复杂参数（如 check_login_status, get_profile 等）
        no_arg_patterns = ('check_', 'get_status', 'get_profile', 'list_', 'show_')
        tool_lower = tool_name.lower()
        if any(tool_lower.startswith(p) for p in no_arg_patterns) and not required:
            # 无必需参数的查询类工具，直接用规则匹配
            self._log(f"  ⚡ 快速规则匹配: {tool_name}")
            return self._extract_with_rules(tool_name, tool_info, user_input, context)
        
        # 情况4：参数数量少（<=2）且都是简单类型（string, number, boolean）
        complex_types = {'object', 'array'}
        param_types = [p.get('type', 'string') for p in props.values()]
        if len(props) <= 2 and not any(t in complex_types for t in param_types):
            # 简单参数，优先使用规则匹配
            rule_args = self._extract_with_rules(tool_name, tool_info, user_input, context)
            # 检查必需参数是否都有值
            missing_required = [r for r in required if r not in rule_args or not rule_args.get(r)]
            if not missing_required:
                self._log(f"  ⚡ 规则匹配成功: {list(rule_args.keys())}")
                return rule_args
        
        # 【复杂场景】使用 LLM 提取
        if self._llm_config and full_input_text:
            try:
                self._log(f"  🤖 使用 LLM 提取复杂参数...")
                llm_args = self._extract_with_llm(
                    tool_name, tool_info, full_input_text, context
                )
                if llm_args:
                    return llm_args
            except Exception as e:
                self._log(f"⚠️ LLM 提取失败，回退规则匹配: {e}")
        
        # 回退：规则匹配
        return self._extract_with_rules(tool_name, tool_info, user_input, context)
    
    def _extract_with_llm(
        self,
        tool_name: str,
        tool_info: Dict[str, Any],
        full_input_text: str,
        context: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """使用 LLM 提取参数"""
        from services.mcp.llm_caller import call_llm_api
        
        props = tool_info.get('props', {})
        required = tool_info.get('required', [])
        
        # 构建参数描述
        param_lines = []
        for name, info in props.items():
            ptype = info.get('type', 'string')
            desc = info.get('description', '')
            req = "（必需）" if name in required else "（可选）"
            param_lines.append(f"- {name} ({ptype}){req}: {desc}")
        
        system_prompt = f"""你是参数提取助手。请从对话中提取调用工具 "{tool_name}" 所需的参数。

工具描述：{tool_info.get('description', '')}

参数列表：
{chr(10).join(param_lines)}

返回 JSON 对象（只包含参数名和值，无其他文字）：
{{"param1": "value1", "param2": 123}}"""
        
        self._log(f"  使用 LLM 提取参数...")
        response = call_llm_api(self._llm_config, system_prompt, full_input_text)
        
        if not response:
            return None
        
        # 解析 JSON
        json_match = re.search(r'\{[\s\S]*\}', response)
        if not json_match:
            return None
        
        try:
            args = json.loads(json_match.group())
            return self._validate_args(args, props, context)
        except json.JSONDecodeError:
            return None
    
    def _validate_args(
        self,
        args: Dict[str, Any],
        props: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """验证和转换参数"""
        validated = {}
        
        for name, value in args.items():
            if name not in props:
                continue
            
            info = props[name]
            ptype = info.get('type', 'string')
            
            try:
                validated[name] = validate_and_convert_param(name, value, info, ptype)
            except Exception:
                validated[name] = value
        
        # 处理图片参数
        for name in ('images', 'image', 'photos', 'pictures', 'files'):
            if name in props:
                images = extract_images_from_context(context)
                if images:
                    ptype = props[name].get('type', 'string')
                    validated[name] = images if ptype == 'array' else images[0]
        
        self._log(f"  ✅ 验证 {len(validated)} 个参数")
        return validated
    
    def _extract_with_rules(
        self,
        tool_name: str,
        tool_info: Dict[str, Any],
        user_input: str,
        context: Dict[str, Any],
    ) -> Dict[str, Any]:
        """使用规则匹配提取参数"""
        props = tool_info.get('props', {})
        required = tool_info.get('required', [])
        args: Dict[str, Any] = {}
        
        # 处理必需参数
        for param in required:
            if param not in props:
                args[param] = user_input
                continue
            
            info = props[param]
            ptype = info.get('type', 'string')
            param_lower = param.lower()
            
            # 内容类参数
            if param_lower in ('content', 'text', 'body', 'description', 'message'):
                args[param] = user_input
            
            # 标题类参数
            elif param_lower in ('title', 'subject', 'heading', 'name'):
                args[param] = extract_title(user_input)
            
            # 图片类参数
            elif param_lower in ('images', 'image', 'photos', 'pictures', 'files'):
                images = extract_images_from_context(context)
                args[param] = images if ptype == 'array' else (images[0] if images else None)
            
            # 标签类参数
            elif param_lower in ('tags', 'tag', 'categories', 'category'):
                args[param] = self._extract_tags(user_input, ptype)
            
            # 查询类参数
            elif param_lower in ('query', 'keyword', 'search', 'q', 'input'):
                args[param] = user_input
            
            # ID 类参数
            elif 'id' in param_lower or ptype in ('number', 'integer'):
                match = re.search(r'\d+', user_input)
                if match:
                    args[param] = int(match.group()) if ptype in ('number', 'integer') else match.group()
                else:
                    args[param] = None
            
            # 布尔类参数
            elif ptype == 'boolean':
                args[param] = info.get('default', True)
            
            # 其他
            else:
                args[param] = info.get('default', user_input if ptype == 'string' else None)
        
        # 处理可选参数（有默认值的）
        for param, info in props.items():
            if param not in args and 'default' in info:
                args[param] = info['default']
        
        return args
    
    def _extract_tags(self, text: str, param_type: str) -> Any:
        """提取标签"""
        if param_type != 'array':
            return text
        
        tags: List[str] = []
        
        # #标签 格式
        hash_tags = re.findall(r'#([^\s#]+)', text)
        tags.extend(hash_tags)
        
        # "标签：" 后的内容
        match = re.search(r'标签[：:]\s*([^\n]+)', text)
        if match:
            parts = re.split(r'[,，、\s]+', match.group(1))
            tags.extend(t.strip() for t in parts if t.strip())
        
        return tags


# ==================== 便捷函数 ====================

def generate_tool_arguments(
    tool_name: str,
    tool_info: Dict[str, Any],
    user_input: str,
    context: Dict[str, Any],
    llm_config: Optional[Dict[str, Any]] = None,
    full_input_text: Optional[str] = None,
    add_log: Optional[Callable] = None,
) -> Dict[str, Any]:
    """向后兼容接口"""
    generator = ArgumentGenerator(llm_config, add_log)
    return generator.generate(tool_name, tool_info, user_input, context, full_input_text)
