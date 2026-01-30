"""
MCP 服务层
处理 MCP 服务器管理、代理请求、健康检查等
"""

from typing import List, Optional, Dict, Any
import uuid
import requests
import time

from models.mcp_server import MCPServer, MCPServerRepository


class MCPService:
    """MCP 服务"""
    
    def __init__(self, get_connection, config: dict = None):
        """
        Args:
            get_connection: 获取数据库连接的函数
            config: 应用配置
        """
        self.repository = MCPServerRepository(get_connection)
        self.config = config or {}
        self.proxy_timeout = self.config.get('mcp', {}).get('proxy_timeout', 90)
    
    # ==================== 服务器管理 ====================
    
    def get_all_servers(self, enabled_only: bool = False) -> List[dict]:
        """获取所有 MCP 服务器配置"""
        servers = self.repository.find_all(enabled_only=enabled_only)
        return [server.to_dict() for server in servers]
    
    def get_server(self, server_id: str) -> Optional[dict]:
        """获取单个服务器配置"""
        server = self.repository.find_by_id(server_id)
        if server:
            return server.to_dict()
        return None
    
    def get_server_by_url(self, url: str) -> Optional[dict]:
        """根据 URL 获取服务器配置"""
        server = self.repository.find_by_url(url)
        if server:
            return server.to_dict()
        return None
    
    def create_server(self, data: dict) -> dict:
        """创建 MCP 服务器配置"""
        if not data.get('name'):
            raise ValueError('Name is required')
        if not data.get('url'):
            raise ValueError('URL is required')
        
        server_id = data.get('server_id') or f"mcp_{uuid.uuid4().hex[:8]}"
        
        server = MCPServer(
            server_id=server_id,
            name=data['name'],
            url=data['url'],
            type=data.get('type', 'http-stream'),
            enabled=data.get('enabled', True),
            use_proxy=data.get('use_proxy', True),
            description=data.get('description'),
            metadata=data.get('metadata'),
            ext=data.get('ext'),
        )
        
        if self.repository.save(server):
            return server.to_dict()
        raise RuntimeError('Failed to save server')
    
    def update_server(self, server_id: str, data: dict) -> Optional[dict]:
        """更新 MCP 服务器配置"""
        existing = self.repository.find_by_id(server_id)
        if not existing:
            return None
        
        if 'name' in data:
            existing.name = data['name']
        if 'url' in data:
            existing.url = data['url']
        if 'type' in data:
            existing.type = data['type']
        if 'enabled' in data:
            existing.enabled = data['enabled']
        if 'use_proxy' in data:
            existing.use_proxy = data['use_proxy']
        if 'description' in data:
            existing.description = data['description']
        if 'metadata' in data:
            existing.metadata = data['metadata']
        if 'ext' in data:
            existing.ext = data['ext']
        
        if self.repository.save(existing):
            return existing.to_dict()
        return None
    
    def delete_server(self, server_id: str) -> bool:
        """删除 MCP 服务器配置"""
        return self.repository.delete(server_id)
    
    # ==================== MCP 代理 ====================
    
    def proxy_request(self, target_url: str, method: str, 
                      headers: dict, body: Any = None,
                      timeout: int = None) -> requests.Response:
        """
        代理 MCP 请求（解决 CORS 问题）
        
        Args:
            target_url: 目标 MCP 服务器 URL
            method: HTTP 方法
            headers: 请求头
            body: 请求体
            timeout: 超时时间（秒）
        
        Returns:
            requests.Response 对象
        """
        timeout = timeout or self.proxy_timeout
        
        # 过滤掉一些不需要转发的头
        filtered_headers = {
            k: v for k, v in headers.items()
            if k.lower() not in ['host', 'content-length', 'transfer-encoding']
        }
        
        # 发送请求（使用连接池，减少握手开销）
        from mcp_server.mcp_common_logic import get_mcp_session
        session = get_mcp_session(target_url)
        response = session.request(
            method=method,
            url=target_url,
            headers=filtered_headers,
            json=body if isinstance(body, dict) else None,
            data=body if isinstance(body, str) else None,
            timeout=timeout,
            stream=True,
        )
        
        return response
    
    def proxy_stream(self, target_url: str, method: str,
                     headers: dict, body: Any = None,
                     timeout: int = None):
        """
        代理 MCP 流式请求
        
        Args:
            target_url: 目标 URL
            method: HTTP 方法
            headers: 请求头
            body: 请求体
            timeout: 超时时间
        
        Yields:
            响应数据块
        """
        response = self.proxy_request(target_url, method, headers, body, timeout)
        
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                yield chunk
    
    # ==================== 健康检查 ====================
    
    def check_health(self, server_url: str, timeout: int = 10) -> dict:
        """
        检查 MCP 服务器健康状态
        
        Args:
            server_url: 服务器 URL
            timeout: 超时时间（秒）
        
        Returns:
            健康检查结果
        """
        start_time = time.time()
        
        try:
            # 尝试连接服务器
            response = requests.get(
                server_url,
                timeout=timeout,
                headers={'Accept': 'application/json'},
            )
            
            elapsed = (time.time() - start_time) * 1000  # 毫秒
            
            return {
                'healthy': response.ok,
                'status_code': response.status_code,
                'latency_ms': round(elapsed, 2),
                'error': None if response.ok else f'HTTP {response.status_code}',
            }
        except requests.exceptions.Timeout:
            return {
                'healthy': False,
                'status_code': None,
                'latency_ms': timeout * 1000,
                'error': 'Connection timeout',
            }
        except requests.exceptions.ConnectionError as e:
            return {
                'healthy': False,
                'status_code': None,
                'latency_ms': None,
                'error': f'Connection error: {str(e)}',
            }
        except Exception as e:
            return {
                'healthy': False,
                'status_code': None,
                'latency_ms': None,
                'error': str(e),
            }
    
    def check_all_health(self, timeout: int = 10) -> Dict[str, dict]:
        """
        检查所有启用的 MCP 服务器健康状态
        
        Args:
            timeout: 每个服务器的超时时间
        
        Returns:
            服务器 ID -> 健康状态 的映射
        """
        servers = self.repository.find_all(enabled_only=True)
        results = {}
        
        for server in servers:
            results[server.server_id] = self.check_health(server.url, timeout)
        
        return results


# 全局服务实例
mcp_service: Optional[MCPService] = None


def init_mcp_service(get_connection, config: dict = None):
    """初始化 MCP 服务"""
    global mcp_service
    mcp_service = MCPService(get_connection, config)
    return mcp_service


def get_mcp_service() -> MCPService:
    """获取 MCP 服务实例"""
    if mcp_service is None:
        raise RuntimeError('MCP service not initialized')
    return mcp_service
