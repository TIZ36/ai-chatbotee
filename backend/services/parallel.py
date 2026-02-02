"""
并行执行框架

提供高性能的并发执行能力:
- WaitGroup: 等待一组任务完成
- Semaphore: 限制并发数
- ParallelExecutor: 并行执行器（带超时、错误处理）
- BatchExecutor: 批量执行器（带重试、回退）

设计原则:
1. 零依赖（仅使用标准库）
2. 类型安全
3. 优雅的错误处理
4. 支持超时控制
"""

from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor, Future, as_completed, TimeoutError
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import Enum
from typing import (
    Any, Callable, Dict, Generic, Iterable, List, 
    Optional, Tuple, TypeVar, Union
)

T = TypeVar('T')
R = TypeVar('R')


class TaskStatus(Enum):
    """任务状态"""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


@dataclass
class TaskResult(Generic[T]):
    """任务执行结果"""
    task_id: str
    status: TaskStatus
    result: Optional[T] = None
    error: Optional[Exception] = None
    duration_ms: float = 0.0
    
    @property
    def success(self) -> bool:
        return self.status == TaskStatus.SUCCESS


class WaitGroup:
    """
    等待一组任务完成（类似 Go 的 sync.WaitGroup）
    
    线程安全，支持动态添加任务
    
    Example:
        wg = WaitGroup()
        
        def worker(task_id):
            wg.add(1)
            try:
                do_work()
            finally:
                wg.done()
        
        # 启动多个 worker
        for i in range(10):
            threading.Thread(target=worker, args=(i,)).start()
        
        wg.wait()  # 等待所有完成
    """
    
    __slots__ = ('_counter', '_lock', '_event')
    
    def __init__(self):
        self._counter = 0
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._event.set()  # 初始状态：无任务，已完成
    
    def add(self, delta: int = 1) -> None:
        """增加等待计数"""
        with self._lock:
            self._counter += delta
            if self._counter > 0:
                self._event.clear()
            elif self._counter == 0:
                self._event.set()
            elif self._counter < 0:
                raise ValueError("WaitGroup counter cannot be negative")
    
    def done(self) -> None:
        """标记一个任务完成"""
        self.add(-1)
    
    def wait(self, timeout: Optional[float] = None) -> bool:
        """
        等待所有任务完成
        
        Args:
            timeout: 超时时间（秒），None 表示无限等待
            
        Returns:
            True 如果所有任务完成，False 如果超时
        """
        return self._event.wait(timeout)
    
    @property
    def count(self) -> int:
        """当前等待计数"""
        with self._lock:
            return self._counter


class Semaphore:
    """
    信号量（限制并发数）
    
    支持上下文管理器和装饰器用法
    
    Example:
        sem = Semaphore(5)  # 最多5个并发
        
        # 方式1：上下文管理器
        with sem:
            do_work()
        
        # 方式2：装饰器
        @sem.limit
        def worker():
            do_work()
    """
    
    __slots__ = ('_semaphore', '_max_permits')
    
    def __init__(self, max_permits: int):
        """
        Args:
            max_permits: 最大并发许可数
        """
        self._max_permits = max_permits
        self._semaphore = threading.Semaphore(max_permits)
    
    def acquire(self, timeout: Optional[float] = None) -> bool:
        """获取许可"""
        return self._semaphore.acquire(timeout=timeout)
    
    def release(self) -> None:
        """释放许可"""
        self._semaphore.release()
    
    def __enter__(self) -> 'Semaphore':
        self._semaphore.acquire()
        return self
    
    def __exit__(self, *args) -> None:
        self._semaphore.release()
    
    def limit(self, func: Callable[..., T]) -> Callable[..., T]:
        """装饰器：限制函数的并发执行"""
        def wrapper(*args, **kwargs) -> T:
            with self:
                return func(*args, **kwargs)
        return wrapper
    
    @property
    def available(self) -> int:
        """当前可用许可数（近似值）"""
        # threading.Semaphore 没有直接获取计数的方法
        # 这是一个估算
        return self._max_permits


class ParallelExecutor:
    """
    并行执行器
    
    支持:
    - 并发数限制
    - 超时控制
    - 错误隔离
    - 结果收集
    
    Example:
        executor = ParallelExecutor(max_workers=5, timeout=30)
        
        tasks = [
            ('task1', lambda: fetch_data('url1')),
            ('task2', lambda: fetch_data('url2')),
        ]
        
        results = executor.execute_all(tasks)
        for r in results:
            if r.success:
                print(f"{r.task_id}: {r.result}")
            else:
                print(f"{r.task_id} failed: {r.error}")
    """
    
    def __init__(
        self, 
        max_workers: int = 10,
        timeout: float = 60.0,
        fail_fast: bool = False,
    ):
        """
        Args:
            max_workers: 最大并发数
            timeout: 单任务超时时间（秒）
            fail_fast: 是否在首个失败后立即停止
        """
        self._max_workers = max_workers
        self._timeout = timeout
        self._fail_fast = fail_fast
    
    def execute_all(
        self,
        tasks: List[Tuple[str, Callable[[], T]]],
    ) -> List[TaskResult[T]]:
        """
        并行执行所有任务
        
        Args:
            tasks: 任务列表，每个元素为 (task_id, callable)
            
        Returns:
            结果列表（顺序与输入一致）
        """
        if not tasks:
            return []
        
        results: Dict[str, TaskResult[T]] = {}
        
        with ThreadPoolExecutor(max_workers=self._max_workers) as executor:
            # 提交所有任务
            future_to_task: Dict[Future, Tuple[str, float]] = {}
            
            for task_id, func in tasks:
                start_time = time.time()
                future = executor.submit(self._execute_single, func)
                future_to_task[future] = (task_id, start_time)
            
            # 收集结果
            for future in as_completed(future_to_task, timeout=self._timeout * 2):
                task_id, start_time = future_to_task[future]
                duration_ms = (time.time() - start_time) * 1000
                
                try:
                    result = future.result(timeout=self._timeout)
                    results[task_id] = TaskResult(
                        task_id=task_id,
                        status=TaskStatus.SUCCESS,
                        result=result,
                        duration_ms=duration_ms,
                    )
                except TimeoutError:
                    results[task_id] = TaskResult(
                        task_id=task_id,
                        status=TaskStatus.TIMEOUT,
                        error=TimeoutError(f"Task {task_id} timed out after {self._timeout}s"),
                        duration_ms=duration_ms,
                    )
                except Exception as e:
                    results[task_id] = TaskResult(
                        task_id=task_id,
                        status=TaskStatus.FAILED,
                        error=e,
                        duration_ms=duration_ms,
                    )
                    
                    if self._fail_fast:
                        # 取消剩余任务
                        for f in future_to_task:
                            f.cancel()
                        break
        
        # 按原始顺序返回结果
        return [results.get(task_id, TaskResult(
            task_id=task_id,
            status=TaskStatus.CANCELLED,
        )) for task_id, _ in tasks]
    
    def _execute_single(self, func: Callable[[], T]) -> T:
        """执行单个任务"""
        return func()
    
    def map(
        self,
        func: Callable[[T], R],
        items: Iterable[T],
        item_timeout: Optional[float] = None,
    ) -> List[TaskResult[R]]:
        """
        并行 map 操作
        
        Args:
            func: 映射函数
            items: 输入项
            item_timeout: 单项超时（可选，默认使用 executor 超时）
            
        Returns:
            结果列表
        """
        tasks = [
            (f"item_{i}", lambda item=item: func(item))
            for i, item in enumerate(items)
        ]
        return self.execute_all(tasks)


class BatchExecutor:
    """
    批量执行器（带智能重试和回退）
    
    适用于批量调用外部 API（如 MCP 工具）
    
    Example:
        executor = BatchExecutor(
            max_concurrent=3,
            retry_count=2,
            timeout=30,
        )
        
        def call_tool(tool_call):
            return mcp_client.call(tool_call['name'], tool_call['args'])
        
        results = executor.execute_batch(tool_calls, call_tool)
    """
    
    def __init__(
        self,
        max_concurrent: int = 5,
        retry_count: int = 1,
        timeout: float = 60.0,
        backoff_base: float = 1.0,
        backoff_max: float = 10.0,
    ):
        """
        Args:
            max_concurrent: 最大并发数
            retry_count: 重试次数
            timeout: 单任务超时
            backoff_base: 重试基础延迟（秒）
            backoff_max: 重试最大延迟（秒）
        """
        self._max_concurrent = max_concurrent
        self._retry_count = retry_count
        self._timeout = timeout
        self._backoff_base = backoff_base
        self._backoff_max = backoff_max
        self._semaphore = Semaphore(max_concurrent)
    
    def execute_batch(
        self,
        items: List[T],
        executor_func: Callable[[T], R],
        on_item_complete: Optional[Callable[[int, TaskResult[R]], None]] = None,
    ) -> List[TaskResult[R]]:
        """
        批量执行
        
        Args:
            items: 待处理项列表
            executor_func: 执行函数
            on_item_complete: 单项完成回调（可选）
            
        Returns:
            结果列表
        """
        results: List[TaskResult[R]] = [None] * len(items)  # type: ignore
        wg = WaitGroup()
        
        def execute_with_retry(index: int, item: T) -> None:
            wg.add(1)
            try:
                result = self._execute_with_retry(
                    task_id=f"batch_{index}",
                    func=lambda: executor_func(item),
                )
                results[index] = result
                
                if on_item_complete:
                    on_item_complete(index, result)
            finally:
                wg.done()
        
        # 使用线程池并行执行
        with ThreadPoolExecutor(max_workers=self._max_concurrent) as pool:
            for i, item in enumerate(items):
                pool.submit(execute_with_retry, i, item)
            
            wg.wait(timeout=self._timeout * len(items))
        
        # 填充未完成的结果
        for i, r in enumerate(results):
            if r is None:
                results[i] = TaskResult(
                    task_id=f"batch_{i}",
                    status=TaskStatus.TIMEOUT,
                    error=TimeoutError("Batch execution timed out"),
                )
        
        return results
    
    def _execute_with_retry(
        self,
        task_id: str,
        func: Callable[[], R],
    ) -> TaskResult[R]:
        """带重试的执行"""
        last_error: Optional[Exception] = None
        start_time = time.time()
        
        for attempt in range(self._retry_count + 1):
            try:
                with self._semaphore:
                    result = func()
                    
                return TaskResult(
                    task_id=task_id,
                    status=TaskStatus.SUCCESS,
                    result=result,
                    duration_ms=(time.time() - start_time) * 1000,
                )
            except Exception as e:
                last_error = e
                
                if attempt < self._retry_count:
                    # 指数退避
                    delay = min(
                        self._backoff_base * (2 ** attempt),
                        self._backoff_max,
                    )
                    time.sleep(delay)
        
        return TaskResult(
            task_id=task_id,
            status=TaskStatus.FAILED,
            error=last_error,
            duration_ms=(time.time() - start_time) * 1000,
        )


# ==================== MCP 工具并行执行 ====================

@dataclass
class MCPToolCall:
    """MCP 工具调用"""
    tool_name: str
    arguments: Dict[str, Any]
    tool_call_id: Optional[str] = None


@dataclass  
class MCPToolResult:
    """MCP 工具执行结果"""
    tool_name: str
    success: bool
    result: Optional[Any] = None
    error: Optional[str] = None
    duration_ms: float = 0.0
    raw_result: Optional[Dict[str, Any]] = None


def execute_mcp_tools_parallel(
    tool_calls: List[MCPToolCall],
    call_func: Callable[[str, Dict[str, Any]], Any],
    max_concurrent: int = 3,
    timeout: float = 60.0,
    on_progress: Optional[Callable[[int, int, MCPToolResult], None]] = None,
) -> List[MCPToolResult]:
    """
    并行执行多个 MCP 工具调用
    
    Args:
        tool_calls: 工具调用列表
        call_func: 调用函数 (tool_name, args) -> result
        max_concurrent: 最大并发数
        timeout: 单个调用超时
        on_progress: 进度回调 (completed, total, result)
        
    Returns:
        执行结果列表（顺序与输入一致）
    
    Example:
        results = execute_mcp_tools_parallel(
            tool_calls=[
                MCPToolCall('search', {'query': 'AI'}),
                MCPToolCall('translate', {'text': 'hello'}),
            ],
            call_func=lambda name, args: mcp_client.call_tool(name, args),
            max_concurrent=3,
        )
    """
    if not tool_calls:
        return []
    
    results: List[MCPToolResult] = [None] * len(tool_calls)  # type: ignore
    completed = 0
    lock = threading.Lock()
    
    def execute_single(index: int, tc: MCPToolCall) -> None:
        nonlocal completed
        start_time = time.time()
        
        try:
            result = call_func(tc.tool_name, tc.arguments)
            duration_ms = (time.time() - start_time) * 1000
            
            # 解析结果
            if isinstance(result, dict):
                success = result.get('success', True)
                error = result.get('error')
                data = result.get('data') or result.get('result') or result
                raw = result.get('raw_result') or result
            else:
                success = True
                error = None
                data = result
                raw = {'result': result}
            
            results[index] = MCPToolResult(
                tool_name=tc.tool_name,
                success=success and not error,
                result=data,
                error=error,
                duration_ms=duration_ms,
                raw_result=raw,
            )
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            results[index] = MCPToolResult(
                tool_name=tc.tool_name,
                success=False,
                error=str(e),
                duration_ms=duration_ms,
            )
        
        with lock:
            completed += 1
            if on_progress:
                on_progress(completed, len(tool_calls), results[index])
    
    # 使用信号量控制并发
    semaphore = Semaphore(max_concurrent)
    wg = WaitGroup()
    
    def worker(index: int, tc: MCPToolCall) -> None:
        wg.add(1)
        try:
            with semaphore:
                execute_single(index, tc)
        finally:
            wg.done()
    
    # 启动所有任务
    with ThreadPoolExecutor(max_workers=max_concurrent) as pool:
        for i, tc in enumerate(tool_calls):
            pool.submit(worker, i, tc)
        
        # 等待完成（带总超时）
        total_timeout = timeout * len(tool_calls) / max_concurrent + 10
        wg.wait(timeout=total_timeout)
    
    # 填充超时的结果
    for i, r in enumerate(results):
        if r is None:
            results[i] = MCPToolResult(
                tool_name=tool_calls[i].tool_name,
                success=False,
                error=f"Timeout after {timeout}s",
            )
    
    return results


# ==================== 异步版本（可选） ====================

async def execute_mcp_tools_async(
    tool_calls: List[MCPToolCall],
    call_func: Callable[[str, Dict[str, Any]], Any],
    max_concurrent: int = 3,
    timeout: float = 60.0,
) -> List[MCPToolResult]:
    """
    异步并行执行 MCP 工具调用
    
    适用于已有 asyncio 事件循环的场景
    """
    if not tool_calls:
        return []
    
    semaphore = asyncio.Semaphore(max_concurrent)
    
    async def execute_single(tc: MCPToolCall) -> MCPToolResult:
        start_time = time.time()
        
        async with semaphore:
            try:
                # 如果 call_func 是同步函数，在线程池中执行
                loop = asyncio.get_event_loop()
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, call_func, tc.tool_name, tc.arguments),
                    timeout=timeout,
                )
                
                duration_ms = (time.time() - start_time) * 1000
                
                if isinstance(result, dict):
                    return MCPToolResult(
                        tool_name=tc.tool_name,
                        success=result.get('success', True),
                        result=result.get('data') or result,
                        error=result.get('error'),
                        duration_ms=duration_ms,
                        raw_result=result,
                    )
                else:
                    return MCPToolResult(
                        tool_name=tc.tool_name,
                        success=True,
                        result=result,
                        duration_ms=duration_ms,
                    )
            except asyncio.TimeoutError:
                return MCPToolResult(
                    tool_name=tc.tool_name,
                    success=False,
                    error=f"Timeout after {timeout}s",
                    duration_ms=(time.time() - start_time) * 1000,
                )
            except Exception as e:
                return MCPToolResult(
                    tool_name=tc.tool_name,
                    success=False,
                    error=str(e),
                    duration_ms=(time.time() - start_time) * 1000,
                )
    
    # 并行执行所有任务
    tasks = [execute_single(tc) for tc in tool_calls]
    return await asyncio.gather(*tasks)
