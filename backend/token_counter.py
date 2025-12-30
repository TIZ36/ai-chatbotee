"""
Token 计数工具
支持多种模型的 Token 计数
"""

import logging
import sys

# 配置模块级别的 logger
logger = logging.getLogger(__name__)

# 如果没有配置过 handler，添加一个基本的控制台 handler
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    handler.setLevel(logging.INFO)  # handler 级别
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)  # logger 级别
    logger.propagate = False  # 不传播到父 logger，确保日志直接输出

def estimate_tokens(text: str, model: str = 'gpt-4') -> int:
    """
    估算文本的 Token 数量
    
    Args:
        text: 要计数的文本
        model: 模型名称（用于选择编码方式）
    
    Returns:
        估算的 Token 数量
    """
    if not text:
        return 0
    
    # 对于中文和英文混合文本，使用简化的估算方法
    # 一般规则：
    # - 英文：1 token ≈ 4 字符
    # - 中文：1 token ≈ 1.5 字符
    # - 代码/特殊字符：1 token ≈ 3 字符
    
    # 统计中文字符数
    chinese_chars = sum(1 for char in text if '\u4e00' <= char <= '\u9fff')
    # 统计其他字符数
    other_chars = len(text) - chinese_chars
    
    # 估算：中文按 1.5 字符/token，其他按 4 字符/token
    estimated_tokens = int(chinese_chars / 1.5 + other_chars / 4)
    
    # 至少返回 1（即使是空字符串，系统消息也会占用一些 token）
    return max(1, estimated_tokens)

def estimate_messages_tokens(messages: list, model: str = 'gpt-4') -> int:
    """
    估算消息列表的总 Token 数量
    
    Args:
        messages: 消息列表，每个消息包含 role 和 content
        model: 模型名称
    
    Returns:
        估算的总 Token 数量
    """
    total_tokens = 0
    
    # 每个消息的开销（role + 格式等）约 4 tokens
    message_overhead = 4
    
    for msg in messages:
        content = msg.get('content', '') or ''
        thinking = msg.get('thinking', '') or ''
        
        # 内容 token
        total_tokens += estimate_tokens(content, model)
        
        # 思考过程 token（如果有）
        if thinking:
            total_tokens += estimate_tokens(thinking, model)
        
        # 消息开销
        total_tokens += message_overhead
        
        # 工具调用（如果有）
        if msg.get('tool_calls'):
            # 每个工具调用约 50 tokens
            total_tokens += len(msg.get('tool_calls', [])) * 50
    
    # 系统提示词开销（如果有）
    # 通常系统提示词会在第一条消息中，这里不重复计算
    
    return total_tokens

def get_model_max_tokens(model: str) -> int:
    """
    获取模型的最大 Token 限制
    
    Args:
        model: 模型名称

    Returns:
        最大 Token 数量
    """

    logger.info(f"Getting max tokens for model: {model}")
    print(f"[token_counter] Getting max tokens for model: {model}")  # 备用输出
    # 常见模型的最大 token 限制
    model_limits = {
        # deepseek
        'deepseek-reasoner': 128000,
        'deepseek-chat': 128000,

        # OpenAI
        'gpt-4': 8192,
        'gpt-4-turbo': 128000,
        'gpt-4-turbo-preview': 128000,
        'gpt-4-32k': 32768,
        'gpt-3.5-turbo': 16385,
        'gpt-3.5-turbo-16k': 16385,
        'o1-preview': 200000,
        'o1-mini': 128000,
        # Anthropic
        'claude-3-5-sonnet-20241022': 200000,
        'claude-3-opus-20240229': 200000,
        'claude-3-sonnet-20240229': 200000,
        'claude-3-haiku-20240307': 200000,
        # Google Gemini
        'gemini-2.5-flash': 1048576,  # 1M tokens
        'gemini-2.5-pro': 1048576,  # 1M tokens
        'gemini-2.0-flash': 1048576,  # 1M tokens
        'gemini-2.0-flash-exp': 1048576,  # 1M tokens
        'gemini-1.5-pro': 2097152,  # 2M tokens
        'gemini-1.5-flash': 1048576,  # 1M tokens
        'gemini-3-pro': 1048576,  # 1M tokens (预览版，保守估计)
        'gemini-3-pro-preview': 1048576,  # 1M tokens
        'gemini-2.5-flash-image': 1048576,  # 1M tokens (图片生成模型)
        'gemini-2.0-flash-preview-image-generation': 1048576,  # 1M tokens (图片生成模型)
        'gemini-3-pro-image-preview': 1048576,  # 1M tokens (图片生成模型)
        # Ollama (通常较大，默认 32k)
        'llama2': 4096,
        'llama3': 8192,
    }
    
    # 检查是否匹配（支持部分匹配）
    for key, limit in model_limits.items():
        if key.lower() in model.lower():
            logger.info(f"Matched model '{key}' -> max_tokens: {limit}")
            print(f"[token_counter] Matched model '{key}' -> max_tokens: {limit}")  # 备用输出
            return limit
    
    # 默认值（保守估计）
    logger.warning(f"No matching model found for '{model}', using default max_tokens: 8192")
    print(f"[token_counter] WARNING: No matching model found for '{model}', using default max_tokens: 8192")  # 备用输出
    return 8192

