"""
日志工具
统一日志格式和输出
"""

import json
import logging
from datetime import datetime
from typing import Optional, Any


def get_logger(name: str, level: int = logging.INFO) -> logging.Logger:
    """
    获取配置好的 Logger 实例
    
    Args:
        name: Logger 名称
        level: 日志级别
        
    Returns:
        配置好的 Logger 实例
    """
    logger = logging.getLogger(name)
    
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            '[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    
    logger.setLevel(level)
    return logger


def log_request(method: str, url: str, headers: dict = None, 
                data: Any = None, json_data: Any = None):
    """
    安全地打印 HTTP 请求信息（脱敏敏感信息）
    
    Args:
        method: HTTP 方法
        url: 请求 URL
        headers: 请求头
        data: 请求数据
        json_data: JSON 请求体
    """
    print(f"\n{'='*80}")
    print(f"[HTTP Request] {method} {url}")
    print(f"{'='*80}")
    
    if headers:
        print("[HTTP Request] Headers:")
        for key, value in headers.items():
            # 脱敏敏感信息
            if key.lower() in ['authorization', 'cookie', 'x-api-key']:
                if isinstance(value, str) and len(value) > 20:
                    masked_value = value[:20] + "..." + value[-4:] if len(value) > 24 else value[:20] + "..."
                    print(f"  {key}: {masked_value}")
                else:
                    print(f"  {key}: ***")
            else:
                print(f"  {key}: {value}")
    
    if json_data:
        print("[HTTP Request] JSON Body:")
        try:
            json_str = json.dumps(json_data, indent=2, ensure_ascii=False)
            if len(json_str) > 2000:
                print(json_str[:2000] + "\n  ... (truncated)")
            else:
                print(json_str)
        except Exception as e:
            print(f"  (Failed to serialize JSON: {e})")
    
    if data:
        print("[HTTP Request] Data:")
        if isinstance(data, str):
            print(f"  {data[:500]}..." if len(data) > 500 else f"  {data}")
        else:
            print(f"  {str(data)[:500]}")


def log_response(status_code: int, headers: dict = None, 
                 body: Any = None, elapsed_ms: float = None):
    """
    安全地打印 HTTP 响应信息
    
    Args:
        status_code: HTTP 状态码
        headers: 响应头
        body: 响应体
        elapsed_ms: 请求耗时（毫秒）
    """
    elapsed_str = f" ({elapsed_ms:.2f}ms)" if elapsed_ms else ""
    print(f"\n[HTTP Response] Status: {status_code}{elapsed_str}")
    
    if headers:
        print("[HTTP Response] Headers:")
        for key, value in headers.items():
            print(f"  {key}: {value}")
    
    if body:
        print("[HTTP Response] Body:")
        if isinstance(body, str):
            print(f"  {body[:1000]}..." if len(body) > 1000 else f"  {body}")
        elif isinstance(body, dict):
            try:
                json_str = json.dumps(body, indent=2, ensure_ascii=False)
                if len(json_str) > 1000:
                    print(json_str[:1000] + "\n  ... (truncated)")
                else:
                    print(json_str)
            except:
                print(f"  {str(body)[:1000]}")


class RequestTimer:
    """请求计时器上下文管理器"""
    
    def __init__(self, name: str = "Request"):
        self.name = name
        self.start_time: Optional[datetime] = None
        self.elapsed_ms: float = 0
    
    def __enter__(self):
        self.start_time = datetime.now()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.start_time:
            elapsed = datetime.now() - self.start_time
            self.elapsed_ms = elapsed.total_seconds() * 1000
            print(f"[{self.name}] Completed in {self.elapsed_ms:.2f}ms")
        return False
