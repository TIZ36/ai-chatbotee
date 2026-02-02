"""
文本提取工具

从结构化输入中提取用户请求、标题、图片等信息。
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List


def extract_user_request(input_text: str) -> str:
    """
    从包含【可用工具】【对话历史】【当前请求】的输入中提取用户的实际请求
    
    Args:
        input_text: 包含结构化标记的输入文本
        
    Returns:
        提取的用户请求文本
    """
    if not input_text:
        return ""
    
    # 尝试提取【当前请求】部分
    match = re.search(r'【当前请求】\s*\n?(.*?)(?=\n\n|$)', input_text, re.DOTALL)
    if match:
        user_request = match.group(1).strip()
        if user_request:
            return user_request
    
    # 移除结构化标记
    cleaned = re.sub(r'【可用工具】.*?【对话历史】', '', input_text, flags=re.DOTALL)
    cleaned = re.sub(r'【对话历史】.*?【当前请求】', '', cleaned, flags=re.DOTALL)
    cleaned = cleaned.strip()
    
    return cleaned if cleaned else input_text.strip()


def extract_title(text: str, max_length: int = 50) -> str:
    """
    从文本中提取标题
    
    Args:
        text: 输入文本
        max_length: 最大标题长度
        
    Returns:
        提取的标题
    """
    if not text:
        return "未命名"
    
    # 先尝试提取用户请求
    user_request = extract_user_request(text)
    if user_request and user_request != text:
        text = user_request
    
    # 提取第一行
    first_line = text.split('\n')[0].strip()
    if first_line:
        # 移除 markdown 和特殊标记
        title = re.sub(r'^#+\s*', '', first_line)
        title = re.sub(r'^【.*?】\s*', '', title)
        title = title.strip()
        
        if len(title) > max_length:
            title = title[:max_length] + "..."
        return title or "未命名"
    
    # 使用前 N 个字符
    cleaned = text.strip()
    if len(cleaned) > max_length:
        return cleaned[:max_length] + "..."
    return cleaned or "未命名"


def extract_images_from_context(context: Dict[str, Any]) -> List[str]:
    """
    从上下文中提取图片路径
    
    Args:
        context: 上下文字典，包含 original_message 等
        
    Returns:
        图片路径列表
    """
    images: List[str] = []
    
    original_message = context.get('original_message', {})
    if not original_message:
        return images
    
    # 处理 ext 字段
    ext = original_message.get('ext', {}) or {}
    if isinstance(ext, str):
        try:
            ext = json.loads(ext)
        except (json.JSONDecodeError, TypeError):
            ext = {}
    
    media_list = ext.get('media', [])
    if not isinstance(media_list, list):
        return images
    
    for m in media_list:
        if not isinstance(m, dict):
            continue
        
        if m.get('type') == 'image':
            # 优先使用 url
            img_path = m.get('url')
            if img_path:
                images.append(img_path)
    
    return images


def clean_tool_usage_marker(text: str) -> str:
    """
    移除工具使用权提示标记
    
    Args:
        text: 输入文本
        
    Returns:
        清理后的文本
    """
    if not text:
        return ""
    return re.sub(r"^\[你已获得工具使用权：.*?\]\s*", "", text).strip()
