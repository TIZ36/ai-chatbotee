"""
高性能缓存服务

提供多层次缓存支持:
- 内存缓存 (LRU + TTL)
- 并发安全
- 自动过期清理

设计原则:
1. 简单接口，复杂内部
2. 线程安全
3. 零依赖（仅使用标准库）
"""

from __future__ import annotations

import time
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generic, List, Optional, TypeVar
from functools import wraps

T = TypeVar('T')


@dataclass(frozen=True)
class CacheEntry(Generic[T]):
    """缓存条目（不可变）"""
    value: T
    created_at: float = field(default_factory=time.time)
    ttl: float = 300.0  # 默认5分钟
    
    @property
    def is_expired(self) -> bool:
        return time.time() - self.created_at > self.ttl


class LRUCache(Generic[T]):
    """
    线程安全的 LRU 缓存，支持 TTL
    
    特性:
    - O(1) 读写操作
    - 自动淘汰最久未使用的条目
    - 支持过期时间
    - 并发安全
    
    Example:
        cache = LRUCache[dict](maxsize=100, ttl=60)
        cache.set('key', {'data': 'value'})
        result = cache.get('key')  # {'data': 'value'}
    """
    
    __slots__ = ('_maxsize', '_ttl', '_cache', '_lock')
    
    def __init__(self, maxsize: int = 128, ttl: float = 300.0):
        """
        Args:
            maxsize: 最大缓存条目数
            ttl: 默认过期时间（秒）
        """
        self._maxsize = maxsize
        self._ttl = ttl
        self._cache: OrderedDict[str, CacheEntry[T]] = OrderedDict()
        self._lock = threading.RLock()
    
    def get(self, key: str, default: Optional[T] = None) -> Optional[T]:
        """
        获取缓存值
        
        Args:
            key: 缓存键
            default: 默认值
            
        Returns:
            缓存值或默认值
        """
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return default
            
            if entry.is_expired:
                del self._cache[key]
                return default
            
            # 移动到末尾（最近使用）
            self._cache.move_to_end(key)
            return entry.value
    
    def set(self, key: str, value: T, ttl: Optional[float] = None) -> None:
        """
        设置缓存值
        
        Args:
            key: 缓存键
            value: 缓存值
            ttl: 过期时间（可选，使用默认值）
        """
        effective_ttl = ttl if ttl is not None else self._ttl
        entry = CacheEntry(value=value, ttl=effective_ttl)
        
        with self._lock:
            # 如果键已存在，先删除
            if key in self._cache:
                del self._cache[key]
            
            # 检查容量，淘汰最旧的
            while len(self._cache) >= self._maxsize:
                self._cache.popitem(last=False)
            
            self._cache[key] = entry
    
    def delete(self, key: str) -> bool:
        """删除缓存条目"""
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False
    
    def clear(self) -> None:
        """清空缓存"""
        with self._lock:
            self._cache.clear()
    
    def cleanup_expired(self) -> int:
        """清理过期条目，返回清理数量"""
        with self._lock:
            expired_keys = [
                k for k, v in self._cache.items() 
                if v.is_expired
            ]
            for key in expired_keys:
                del self._cache[key]
            return len(expired_keys)
    
    @property
    def size(self) -> int:
        """当前缓存大小"""
        return len(self._cache)
    
    def stats(self) -> Dict[str, Any]:
        """获取缓存统计信息"""
        with self._lock:
            expired_count = sum(1 for v in self._cache.values() if v.is_expired)
            return {
                'size': len(self._cache),
                'maxsize': self._maxsize,
                'ttl': self._ttl,
                'expired_count': expired_count,
            }


def cached(
    cache: LRUCache,
    key_func: Optional[Callable[..., str]] = None,
    ttl: Optional[float] = None,
):
    """
    缓存装饰器
    
    Args:
        cache: LRUCache 实例
        key_func: 自定义键生成函数，默认使用参数组合
        ttl: 缓存过期时间
    
    Example:
        @cached(my_cache, key_func=lambda x: f"config:{x}")
        def get_config(config_id: str) -> dict:
            # 耗时操作
            return fetch_from_db(config_id)
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        def wrapper(*args, **kwargs) -> T:
            # 生成缓存键
            if key_func:
                cache_key = key_func(*args, **kwargs)
            else:
                # 默认键：函数名 + 参数
                key_parts = [func.__name__]
                key_parts.extend(str(a) for a in args)
                key_parts.extend(f"{k}={v}" for k, v in sorted(kwargs.items()))
                cache_key = ':'.join(key_parts)
            
            # 尝试从缓存获取
            result = cache.get(cache_key)
            if result is not None:
                return result
            
            # 执行函数
            result = func(*args, **kwargs)
            
            # 存入缓存
            if result is not None:
                cache.set(cache_key, result, ttl)
            
            return result
        
        # 暴露缓存操作方法
        wrapper.cache = cache
        wrapper.cache_key_func = key_func or (lambda *a, **kw: ':'.join([func.__name__] + [str(x) for x in a]))
        wrapper.invalidate = lambda *args, **kwargs: cache.delete(
            key_func(*args, **kwargs) if key_func else ':'.join([func.__name__] + [str(x) for x in args])
        )
        
        return wrapper
    return decorator


# ==================== 全局缓存实例 ====================

# LLM 配置缓存（配置不常变化，缓存5分钟）
llm_config_cache: LRUCache[dict] = LRUCache(maxsize=100, ttl=300)

# MCP 服务器配置缓存（缓存2分钟）
mcp_server_cache: LRUCache[dict] = LRUCache(maxsize=50, ttl=120)

# 工具列表缓存（缓存60秒，平衡实时性和性能）
tools_list_cache: LRUCache[dict] = LRUCache(maxsize=50, ttl=60)


def get_llm_config_cached(
    config_id: str,
    get_config_func: Callable[[str, bool], Optional[dict]],
    include_api_key: bool = True,
) -> Optional[dict]:
    """
    获取 LLM 配置（带缓存）
    
    Args:
        config_id: 配置 ID
        get_config_func: 获取配置的函数
        include_api_key: 是否包含 API Key
    
    Returns:
        配置字典或 None
    """
    cache_key = f"llm:{config_id}:{include_api_key}"
    
    # 尝试从缓存获取
    cached = llm_config_cache.get(cache_key)
    if cached is not None:
        return cached
    
    # 从数据库获取
    config = get_config_func(config_id, include_api_key)
    
    # 存入缓存
    if config:
        llm_config_cache.set(cache_key, config)
    
    return config


def get_mcp_server_cached(
    server_id: str,
    get_server_func: Callable[[str], Optional[dict]],
) -> Optional[dict]:
    """
    获取 MCP 服务器配置（带缓存）
    
    Args:
        server_id: 服务器 ID
        get_server_func: 获取配置的函数
    
    Returns:
        服务器配置字典或 None
    """
    cache_key = f"mcp:{server_id}"
    
    # 尝试从缓存获取
    cached = mcp_server_cache.get(cache_key)
    if cached is not None:
        return cached
    
    # 从数据库获取
    server = get_server_func(server_id)
    
    # 存入缓存
    if server:
        mcp_server_cache.set(cache_key, server)
    
    return server


def invalidate_llm_config(config_id: str) -> None:
    """使 LLM 配置缓存失效"""
    llm_config_cache.delete(f"llm:{config_id}:True")
    llm_config_cache.delete(f"llm:{config_id}:False")


def invalidate_mcp_server(server_id: str) -> None:
    """使 MCP 服务器配置缓存失效"""
    mcp_server_cache.delete(f"mcp:{server_id}")


def get_cache_stats() -> Dict[str, Any]:
    """获取所有缓存的统计信息"""
    return {
        'llm_config': llm_config_cache.stats(),
        'mcp_server': mcp_server_cache.stats(),
        'tools_list': tools_list_cache.stats(),
    }


# ==================== 缓存预热 ====================

class CacheWarmer:
    """
    缓存预热器
    
    在系统启动或空闲时预加载常用数据
    
    Example:
        warmer = CacheWarmer()
        warmer.warm_llm_configs(get_all_configs)
        warmer.warm_mcp_servers(get_all_servers)
    """
    
    def __init__(self):
        self._warmed = False
        self._warm_time: Optional[float] = None
    
    def warm_llm_configs(
        self,
        get_all_func: Callable[[], List[dict]],
        include_api_key: bool = True,
    ) -> int:
        """
        预热 LLM 配置缓存
        
        Args:
            get_all_func: 获取所有配置的函数
            include_api_key: 是否包含 API Key
            
        Returns:
            预热的配置数量
        """
        import time
        start = time.time()
        
        configs = get_all_func()
        count = 0
        
        for config in configs:
            config_id = config.get('config_id')
            if config_id:
                cache_key = f"llm:{config_id}:{include_api_key}"
                llm_config_cache.set(cache_key, config)
                count += 1
        
        self._warmed = True
        self._warm_time = time.time() - start
        
        print(f"[CacheWarmer] Warmed {count} LLM configs in {self._warm_time:.2f}s")
        return count
    
    def warm_mcp_servers(
        self,
        get_all_func: Callable[[], List[dict]],
    ) -> int:
        """
        预热 MCP 服务器配置缓存
        
        Args:
            get_all_func: 获取所有服务器的函数
            
        Returns:
            预热的服务器数量
        """
        import time
        start = time.time()
        
        servers = get_all_func()
        count = 0
        
        for server in servers:
            server_id = server.get('server_id')
            if server_id:
                cache_key = f"mcp:{server_id}"
                mcp_server_cache.set(cache_key, server)
                count += 1
        
        duration = time.time() - start
        print(f"[CacheWarmer] Warmed {count} MCP servers in {duration:.2f}s")
        return count
    
    @property
    def is_warmed(self) -> bool:
        return self._warmed


# 全局预热器实例
cache_warmer = CacheWarmer()


# ==================== 智能缓存失效 ====================

class CacheInvalidator:
    """
    智能缓存失效器
    
    支持:
    - 单条失效
    - 批量失效
    - 模式匹配失效
    - 级联失效（失效相关联的缓存）
    """
    
    @staticmethod
    def invalidate_llm_config(config_id: str) -> None:
        """失效 LLM 配置缓存"""
        llm_config_cache.delete(f"llm:{config_id}:True")
        llm_config_cache.delete(f"llm:{config_id}:False")
    
    @staticmethod
    def invalidate_mcp_server(server_id: str) -> None:
        """失效 MCP 服务器配置缓存"""
        mcp_server_cache.delete(f"mcp:{server_id}")
    
    @staticmethod
    def invalidate_tools_list(server_url: str) -> None:
        """失效工具列表缓存"""
        cache_key = f"tools_list:{server_url}"
        tools_list_cache.delete(cache_key)
    
    @staticmethod
    def invalidate_all_llm_configs() -> int:
        """失效所有 LLM 配置缓存"""
        count = llm_config_cache.size
        llm_config_cache.clear()
        return count
    
    @staticmethod
    def invalidate_all_mcp_servers() -> int:
        """失效所有 MCP 服务器配置缓存"""
        count = mcp_server_cache.size
        mcp_server_cache.clear()
        return count
    
    @staticmethod
    def invalidate_all_tools_lists() -> int:
        """失效所有工具列表缓存"""
        count = tools_list_cache.size
        tools_list_cache.clear()
        return count
    
    @staticmethod
    def invalidate_all() -> Dict[str, int]:
        """失效所有缓存"""
        return {
            'llm_config': CacheInvalidator.invalidate_all_llm_configs(),
            'mcp_server': CacheInvalidator.invalidate_all_mcp_servers(),
            'tools_list': CacheInvalidator.invalidate_all_tools_lists(),
        }


# 导出便捷实例
cache_invalidator = CacheInvalidator()
