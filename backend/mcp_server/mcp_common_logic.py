"""
MCP 服务器通用逻辑
封装初始化、通知、获取工具列表等通用功能
"""

import json
import time
import requests
from typing import Optional, Dict, Any
from database import get_mysql_connection, get_oauth_token, is_token_expired, refresh_oauth_token, get_oauth_config

# 连接池：为每个 MCP URL 维护一个 Session
_mcp_sessions: Dict[str, requests.Session] = {}

# 响应缓存：短期缓存 tools/list 和 initialize 响应
_response_cache: Dict[str, Dict[str, Any]] = {}
_cache_timestamps: Dict[str, float] = {}
CACHE_TTL = 30  # 缓存30秒

# 记录每个 MCP URL 最近一次协商得到的 mcp-session-id
_mcp_session_ids: Dict[str, str] = {}

def get_mcp_session(mcp_url: str) -> requests.Session:
    """
    获取或创建 MCP 服务器的 Session（连接池）
    
    Args:
        mcp_url: MCP 服务器 URL
        
    Returns:
        requests.Session 实例
    """
    normalized_url = mcp_url.rstrip('/')
    if normalized_url not in _mcp_sessions:
        session = requests.Session()
        # 设置默认超时（增加到120秒以支持慢速MCP服务器）
        session.timeout = 120
        _mcp_sessions[normalized_url] = session
        print(f"[MCP Common] Created new session for {normalized_url[:50]}...")
    return _mcp_sessions[normalized_url]

def get_cached_response(cache_key: str) -> Optional[Dict[str, Any]]:
    """
    获取缓存的响应
    
    Args:
        cache_key: 缓存键（如 "tools_list:url"）
        
    Returns:
        缓存的响应，如果不存在或已过期则返回 None
    """
    if cache_key not in _response_cache:
        return None
    
    # 检查是否过期
    timestamp = _cache_timestamps.get(cache_key, 0)
    if time.time() - timestamp > CACHE_TTL:
        # 缓存过期，删除
        del _response_cache[cache_key]
        del _cache_timestamps[cache_key]
        return None
    
    print(f"[MCP Common] ✅ Using cached response for {cache_key[:50]}...")
    return _response_cache[cache_key]

def set_cached_response(cache_key: str, response: Dict[str, Any]):
    """
    设置缓存的响应
    
    Args:
        cache_key: 缓存键
        response: 响应数据
    """
    _response_cache[cache_key] = response
    _cache_timestamps[cache_key] = time.time()
    print(f"[MCP Common] ✅ Cached response for {cache_key[:50]}...")


def prepare_mcp_headers(target_url: str, request_headers: Dict[str, str], base_headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """
    准备 MCP 请求头，包括 OAuth token 和服务器配置的 headers
    
    Args:
        target_url: MCP 服务器 URL
        request_headers: 客户端请求头
        base_headers: 基础请求头（可选，如果提供则使用，否则创建默认的）
        
    Returns:
        准备好的请求头字典
    """
    # 基础请求头
    if base_headers:
        headers = base_headers.copy()
    else:
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'mcp-protocol-version': request_headers.get('mcp-protocol-version', '2025-06-18'),
        }
        
        # 添加会话 ID（如果存在）
        session_id = request_headers.get('mcp-session-id')
        if session_id:
            headers['mcp-session-id'] = session_id

    # 如果调用方没带 session-id，但我们曾经协商过，优先复用最近一次的 session-id
    try:
        normalized_target_url = target_url.rstrip('/')
        if 'mcp-session-id' not in headers and normalized_target_url in _mcp_session_ids:
            headers['mcp-session-id'] = _mcp_session_ids[normalized_target_url]
            print(f"[MCP Common] Reusing cached mcp-session-id for {normalized_target_url[:40]}...")
    except Exception:
        pass
    
    # 从数据库查找 MCP 服务器配置
    try:
        conn = get_mysql_connection()
        if conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT metadata, ext FROM mcp_servers WHERE url = %s AND enabled = 1 LIMIT 1",
                (target_url,)
            )
            server_row = cursor.fetchone()
            
            if server_row:
                metadata = server_row[0]
                ext = server_row[1]
                
                if metadata:
                    if isinstance(metadata, str):
                        metadata = json.loads(metadata)
                    
                    # 检查是否需要 OAuth token
                    normalized_target_url = target_url.rstrip('/')
                    
                    if ext:
                        if isinstance(ext, str):
                            ext = json.loads(ext)
                        
                        server_type = ext.get('server_type')
                        if server_type in ['notion']:  # 可以扩展其他需要 OAuth 的服务器
                            print(f"[MCP Common] Checking OAuth token for {server_type} server...")
                            
                            # 获取 OAuth token
                            token_info = get_oauth_token_for_server(normalized_target_url, target_url)
                            
                            if token_info:
                                access_token = token_info.get('access_token')
                                if access_token:
                                    headers['Authorization'] = f"Bearer {access_token}"
                                    print(f"[MCP Common] Using OAuth token: {access_token[:20]}...")
                    
                    # 从 metadata.headers 中获取配置的请求头
                    if isinstance(metadata, dict) and 'headers' in metadata:
                        config_headers = metadata['headers']
                        if isinstance(config_headers, dict):
                            print(f"[MCP Common] Applying headers from server config")
                            for header_name, header_value in config_headers.items():
                                # Authorization header 优先使用 OAuth token（如果存在）
                                if header_name == 'Authorization' and 'Authorization' in headers:
                                    print(f"[MCP Common] Skipping DB Authorization header, using OAuth token")
                                    continue
                                
                                # 如果客户端没有发送该 header，使用数据库中的配置
                                if header_name not in request_headers or not request_headers.get(header_name):
                                    headers[header_name] = header_value
                                    print(f"[MCP Common] Added header from DB config: {header_name}")
                                else:
                                    print(f"[MCP Common] Client already sent {header_name}, using client value")
            
            cursor.close()
            conn.close()
    except Exception as db_error:
        print(f"[MCP Common] Warning: Failed to load server config from DB: {db_error}")
    
    # 转发客户端的 Authorization header（客户端优先）
    if 'Authorization' in request_headers:
        headers['Authorization'] = request_headers.get('Authorization')
        auth_preview = headers['Authorization'][:30] + '...' if len(headers['Authorization']) > 30 else headers['Authorization']
        print(f"[MCP Common] Using Authorization header from client: {auth_preview}")
    elif 'Authorization' in headers:
        auth_preview = headers['Authorization'][:30] + '...' if len(headers['Authorization']) > 30 else headers['Authorization']
        print(f"[MCP Common] Using Authorization header from DB config: {auth_preview}")
    
    # 转发 Notion-Version 等自定义 headers
    if 'Notion-Version' in request_headers:
        headers['Notion-Version'] = request_headers.get('Notion-Version')
        print(f"[MCP Common] Forwarding Notion-Version header from client")
    
    # 转发其他自定义 headers
    custom_header_prefixes = ['x-', 'X-']
    for header_name in request_headers.keys():
        if any(header_name.startswith(prefix) for prefix in custom_header_prefixes):
            headers[header_name] = request_headers.get(header_name)
            print(f"[MCP Common] Forwarding custom header: {header_name}")
    
    return headers


def get_oauth_token_for_server(normalized_url: str, original_url: str) -> Optional[Dict[str, Any]]:
    """
    获取 OAuth token，如果过期则自动刷新
    
    Args:
        normalized_url: 规范化的 URL（无末尾斜杠）
        original_url: 原始 URL
        
    Returns:
        Token 信息字典，如果不存在则返回 None
    """
    # 从 Redis 获取 token
    token_info = get_oauth_token(normalized_url)
    
    # 如果没找到，尝试带尾随斜杠的版本
    if not token_info and original_url != normalized_url:
        print(f"[MCP Common] Trying with trailing slash: {original_url}")
        token_info = get_oauth_token(original_url)
    
    if token_info:
        # 检查 token 是否过期
        if is_token_expired(token_info):
            print(f"[MCP Common] Token expired, attempting refresh...")
            
            # 尝试刷新 token
            oauth_config = get_oauth_config(f"refresh_{normalized_url}")
            
            if not oauth_config and original_url != normalized_url:
                oauth_config = get_oauth_config(f"refresh_{original_url}")
            
            if not oauth_config:
                print(f"[MCP Common] OAuth config not found for refresh, skipping refresh")
            else:
                new_token_info = refresh_oauth_token(normalized_url, token_info, oauth_config)
                if new_token_info:
                    token_info = new_token_info
                    print(f"[MCP Common] ✅ Token refreshed successfully")
                else:
                    print(f"[MCP Common] ⚠️ Token refresh failed, using expired token")
    
    return token_info


def initialize_mcp_session(target_url: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """
    初始化 MCP 会话
    
    Args:
        target_url: MCP 服务器 URL
        headers: 请求头
        
    Returns:
        初始化响应，如果失败则返回 None
    """
    try:
        init_request = {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'initialize',
            'params': {
                'protocolVersion': headers.get('mcp-protocol-version', '2025-06-18'),
                'capabilities': {},
                'clientInfo': {
                    'name': 'Workflow Manager',
                    'version': '1.0.0'
                }
            }
        }
        
        # 注意：initialize 不能只靠缓存，因为 mcp-session-id 往往是每次协商/会话相关的
        # 这里仍允许复用 _mcp_session_ids，但 initialize 本身不再直接用缓存短路。
        
        print(f"[MCP Common] Initializing session with {target_url}")
        print(f"[MCP Common]   Request headers: {headers}")
        print(f"[MCP Common]   Request body: {init_request}")
        # 使用连接池，较短的超时（初始化应该很快）
        session = get_mcp_session(target_url)
        response = session.post(target_url, json=init_request, headers=headers, timeout=10)
        print(f"[MCP Common]   Response status: {response.status_code}")
        
        if response.ok:
            # 续传 mcp-session-id（很多 streamable-http server 需要）
            sid = response.headers.get('mcp-session-id')
            if sid:
                headers['mcp-session-id'] = sid
                try:
                    _mcp_session_ids[target_url.rstrip('/')] = sid
                except Exception:
                    pass
                print(f"[MCP Common] ✅ Received mcp-session-id: {sid[:12]}...")

            # 兼容：initialize 可能返回 SSE
            content_type = (response.headers.get('Content-Type') or '').lower()
            if 'text/event-stream' in content_type:
                init_response = _parse_sse_text_to_jsonrpc(response.text)
            else:
                init_response = response.json()

            # 不缓存 initialize 响应（避免 session-id 丢失/复用错误）
            print(f"[MCP Common] ✅ Session initialized successfully")
            return init_response
        else:
            # 详细错误诊断
            print(f"[MCP Common] ❌ Failed to initialize session: {response.status_code}")
            print(f"[MCP Common]   Response headers: {dict(response.headers)}")
            print(f"[MCP Common]   Response body: {response.text[:500]}")
            print(f"[MCP Common]   Request headers sent: {headers}")
            return None
    except requests.exceptions.Timeout:
        print(f"[MCP Common] ❌ Initialize timeout: {target_url}")
        return None
    except requests.exceptions.ConnectionError as e:
        print(f"[MCP Common] ❌ Connection error: {e}")
        return None
    except Exception as e:
        print(f"[MCP Common] ❌ Error initializing session: {e}")
        return None


def send_mcp_notification(target_url: str, method: str, params: Dict[str, Any], headers: Dict[str, str]) -> bool:
    """
    发送 MCP 通知（不需要响应的请求）
    
    Args:
        target_url: MCP 服务器 URL
        method: 通知方法名
        params: 通知参数
        headers: 请求头
        
    Returns:
        是否发送成功
    """
    try:
        notification = {
            'jsonrpc': '2.0',
            'method': method,
            'params': params
        }
        
        print(f"[MCP Common] Sending notification: {method}")
        # 使用连接池，较短的超时（通知不需要响应）
        session = get_mcp_session(target_url)
        response = session.post(target_url, json=notification, headers=headers, timeout=5)
        
        if response.ok:
            print(f"[MCP Common] ✅ Notification sent successfully")
            return True
        else:
            print(f"[MCP Common] ❌ Failed to send notification: {response.status_code}")
            return False
    except Exception as e:
        print(f"[MCP Common] ❌ Error sending notification: {e}")
        return False


def get_mcp_tools_list(target_url: str, headers: Dict[str, str], use_cache: bool = True) -> Optional[Dict[str, Any]]:
    """
    获取 MCP 服务器工具列表（带缓存）
    
    Args:
        target_url: MCP 服务器 URL
        headers: 请求头
        use_cache: 是否使用缓存（默认 True）
        
    Returns:
        工具列表响应，如果失败则返回 None
    """
    try:
        # 检查缓存
        cache_key = f"tools_list:{target_url}"
        if use_cache:
            cached = get_cached_response(cache_key)
            if cached:
                return cached
        
        tools_request = {
            'jsonrpc': '2.0',
            'id': 2,
            'method': 'tools/list',
            'params': {}
        }
        
        print(f"[MCP Common] Getting tools list from {target_url}")
        # 使用连接池，中等超时（工具列表应该较快）
        session = get_mcp_session(target_url)
        response = session.post(target_url, json=tools_request, headers=headers, timeout=15)
        
        if response.ok:
            # 续传 mcp-session-id
            sid = response.headers.get('mcp-session-id')
            if sid:
                headers['mcp-session-id'] = sid
                try:
                    _mcp_session_ids[target_url.rstrip('/')] = sid
                except Exception:
                    pass
                print(f"[MCP Common] ✅ Updated mcp-session-id: {sid[:12]}...")

            # 兼容：tools/list 可能返回 SSE（proxy 会转换，但这里直接调用 server 时要自己解析）
            content_type = (response.headers.get('Content-Type') or '').lower()
            if 'text/event-stream' in content_type:
                tools_response = _parse_sse_text_to_jsonrpc(response.text)
            else:
                tools_response = response.json()

            # 缓存响应
            if use_cache:
                set_cached_response(cache_key, tools_response)
            print(f"[MCP Common] ✅ Tools list retrieved successfully")
            return tools_response
        else:
            # 详细错误诊断
            print(f"[MCP Common] ❌ Failed to get tools list: {response.status_code}")
            print(f"[MCP Common]   Response headers: {dict(response.headers)}")
            print(f"[MCP Common]   Response body: {response.text[:500]}")
            print(f"[MCP Common]   Request headers sent: {headers}")
            return None
    except requests.exceptions.Timeout:
        print(f"[MCP Common] ❌ Tools list timeout: {target_url}")
        return None
    except requests.exceptions.ConnectionError as e:
        print(f"[MCP Common] ❌ Connection error: {e}")
        return None
    except Exception as e:
        print(f"[MCP Common] ❌ Error getting tools list: {e}")
        return None


def parse_mcp_jsonrpc_response(data: str) -> Optional[Dict[str, Any]]:
    """
    解析标准 MCP JSON-RPC 响应（通用）
    
    Args:
        data: JSON-RPC 响应字符串
        
    Returns:
        解析后的响应字典，如果解析失败则返回 None
    """
    try:
        # 移除可能的 "data: " 前缀（SSE 格式）
        if data.startswith('data: '):
            json_str = data[6:]
        else:
            json_str = data
        
        # 解析 JSON
        response_data = json.loads(json_str)
        
        # 验证 JSON-RPC 格式
        if not isinstance(response_data, dict):
            print(f"[MCP Parse] Invalid response format: not a dict")
            return None
        
        if response_data.get('jsonrpc') != '2.0':
            print(f"[MCP Parse] Invalid JSON-RPC version: {response_data.get('jsonrpc')}")
            return None
        
        # 检查是否有错误
        if 'error' in response_data:
            error = response_data['error']
            print(f"[MCP Parse] Error in response: {error.get('code', 'unknown')} - {error.get('message', 'unknown error')}")
            return response_data
        
        # 检查是否有结果
        if 'result' not in response_data:
            print(f"[MCP Parse] No result in response")
            return None
        
        return response_data
        
    except json.JSONDecodeError as e:
        print(f"[MCP Parse] ❌ JSON decode error: {e}")
        print(f"[MCP Parse] Raw data: {data[:200]}...")
        return None
    except Exception as e:
        print(f"[MCP Parse] ❌ Error parsing response: {e}")
        return None


def call_mcp_tool(target_url: str, headers: Dict[str, str], tool_name: str, tool_args: Dict[str, Any], add_log=None, max_retries: int = 3) -> Dict[str, Any]:
    """
    调用 MCP 工具（带重试机制）
    
    Args:
        target_url: MCP 服务器 URL
        headers: 请求头（应已包含 mcp-session-id 等必要信息）
        tool_name: 工具名称
        tool_args: 工具参数
        add_log: 日志回调函数（可选）
        max_retries: 最大重试次数（默认3次）
        
    Returns:
        结构化结果：
        - 成功: {"success": True, "data": ..., "tool_name": ...}
        - 网络错误: {"success": False, "error_type": "network", "error": ..., "http_code": ...}
        - 业务错误: {"success": False, "error_type": "business", "error": ..., "error_code": ...}
    """
    # ANSI 颜色码
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
    
    print(f"{BLUE}{BOLD}[MCP TOOL] ========== call_mcp_tool 开始 =========={RESET}")
    print(f"{BLUE}[MCP TOOL] 工具: {tool_name}{RESET}")
    print(f"{BLUE}[MCP TOOL] URL: {target_url[:60]}...{RESET}")
    print(f"{BLUE}[MCP TOOL] 参数 keys: {list(tool_args.keys())}{RESET}")
    
    last_error = None
    
    # 保存已有的 mcp-session-id，防止被覆盖
    existing_session_id = headers.get('mcp-session-id')
    print(f"{BLUE}[MCP TOOL] Session ID: {existing_session_id[:16] if existing_session_id else 'None'}...{RESET}")
    
    for attempt in range(max_retries):
        print(f"{YELLOW}[MCP TOOL] 尝试 {attempt + 1}/{max_retries}{RESET}")
        try:
            # 准备请求头（包括OAuth token等）
            # 注意：传入 headers 的副本作为 base_headers，确保已有字段（如 session_id）不丢失
            prepared_headers = prepare_mcp_headers(target_url, headers, headers.copy())
            
            # 确保 session_id 被保留（防止 prepare_mcp_headers 覆盖）
            if existing_session_id and 'mcp-session-id' not in prepared_headers:
                prepared_headers['mcp-session-id'] = existing_session_id
                print(f"[MCP Common] Restored mcp-session-id: {existing_session_id[:12]}...")
            
            # 构建工具调用请求
            tool_request = {
                'jsonrpc': '2.0',
                'id': int(time.time() * 1000),
                'method': 'tools/call',
                'params': {
                    'name': tool_name,
                    'arguments': tool_args
                }
            }
            
            if add_log and attempt == 0:
                add_log(f"调用MCP工具: {tool_name}")
                # 详细日志：显示请求信息
                session_id_preview = prepared_headers.get('mcp-session-id', 'N/A')[:16] if prepared_headers.get('mcp-session-id') else 'N/A'
                add_log(f"  → 目标URL: {target_url[:60]}...")
                add_log(f"  → Session ID: {session_id_preview}...")
                add_log(f"  → 参数: {list(tool_args.keys())}")
            elif add_log and attempt > 0:
                add_log(f"重试调用MCP工具: {tool_name} (尝试 {attempt + 1}/{max_retries})")
            
            # 发送请求前打印调试信息
            print(f"{BLUE}[MCP TOOL] 发送 POST 请求...{RESET}")
            print(f"{BLUE}[MCP TOOL]   URL: {target_url}{RESET}")
            print(f"{BLUE}[MCP TOOL]   Session ID: {prepared_headers.get('mcp-session-id', 'N/A')[:20]}...{RESET}")
            
            # 发送请求（使用连接池）
            # 工具调用可能需要较长时间，特别是涉及浏览器操作时，使用较长的超时
            # 对于涉及页面加载的操作，需要等待页面完全加载，超时设置为 60 秒
            session = get_mcp_session(target_url)
            tool_timeout = 60  # 60秒超时，确保页面加载完成
            print(f"{YELLOW}[MCP TOOL]   → 发送中 (timeout={tool_timeout}s，等待页面加载)...{RESET}")
            response = session.post(target_url, json=tool_request, headers=prepared_headers, timeout=tool_timeout)
            
            # 打印响应状态
            status_color = GREEN if response.ok else RED
            print(f"{status_color}[MCP TOOL]   ← 响应: HTTP {response.status_code}{RESET}")
            print(f"{BLUE}[MCP TOOL]   Content-Type: {response.headers.get('Content-Type', 'N/A')}{RESET}")
            print(f"{BLUE}[MCP TOOL]   响应长度: {len(response.text)} 字符{RESET}")
            
            if not response.ok:
                # 判断是否可重试
                is_retryable = response.status_code >= 500 or response.status_code == 429
                error_msg = f"HTTP {response.status_code} - {response.text[:200]}"
                
                if is_retryable and attempt < max_retries - 1:
                    # 指数退避：等待时间 = 2^attempt 秒
                    wait_time = 2 ** attempt
                    if add_log:
                        add_log(f"⚠️ 可重试错误，{wait_time}秒后重试: {error_msg}")
                    time.sleep(wait_time)
                    last_error = error_msg
                    continue
                else:
                    if add_log:
                        add_log(f"❌ MCP工具调用失败: {error_msg}")
                    return {
                        "success": False,
                        "error_type": "network",
                        "error": error_msg,
                        "http_code": response.status_code,
                        "tool_name": tool_name,
                    }
            
            # 续传 mcp-session-id（如果 server 在 call 阶段才下发也要接住）
            sid = response.headers.get('mcp-session-id')
            if sid:
                headers['mcp-session-id'] = sid
                prepared_headers['mcp-session-id'] = sid
                try:
                    _mcp_session_ids[target_url.rstrip('/')] = sid
                except Exception:
                    pass
                if add_log:
                    add_log(f"✅ 更新 mcp-session-id: {sid[:12]}...")

            # 解析响应（兼容 SSE）
            content_type = (response.headers.get('Content-Type') or '').lower()
            if 'text/event-stream' in content_type:
                response_data = _parse_sse_text_to_jsonrpc(response.text) or {}
            else:
                response_data = response.json()
            
            if 'error' in response_data:
                error = response_data['error']
                error_code = error.get('code', 'unknown')
                error_msg = error.get('message', 'unknown error')
                error_data = error.get('data')  # 业务错误可能有额外数据
                
                # 判断是否可重试
                # -32000: Execution context was destroyed（浏览器上下文被销毁，可能是页面加载超时）
                # -32603: Internal error（服务器内部错误）
                # 对于 Execution context 错误，增加等待时间后重试
                is_execution_context_error = (
                    error_code == -32000 or 
                    'execution context' in error_msg.lower() or
                    'context was destroyed' in error_msg.lower()
                )
                is_retryable = (
                    error_code in [-32000, -32603] or 
                    'timeout' in error_msg.lower() or 
                    'network' in error_msg.lower() or
                    is_execution_context_error
                )
                
                # 如果是 Execution context 错误，增加等待时间（页面可能需要更多时间加载）
                if is_execution_context_error and attempt < max_retries - 1:
                    wait_time = min(5 + (2 ** attempt), 15)  # 至少等待5秒，最多15秒
                    if add_log:
                        add_log(f"⚠️ 检测到 Execution context 错误，等待 {wait_time} 秒后重试（页面可能需要更多时间加载）")
                    time.sleep(wait_time)
                    last_error = f"{error_code} - {error_msg}"
                    continue
                elif is_retryable and attempt < max_retries - 1:
                    # 其他可重试错误使用标准退避策略
                    wait_time = 2 ** attempt
                    if add_log:
                        add_log(f"⚠️ 可重试错误，{wait_time}秒后重试: {error_code} - {error_msg}")
                    time.sleep(wait_time)
                    last_error = f"{error_code} - {error_msg}"
                    continue
                else:
                    if add_log:
                        add_log(f"❌ MCP工具业务错误: {error_code} - {error_msg}")
                    return {
                        "success": False,
                        "error_type": "business",
                        "error": error_msg,
                        "error_code": error_code,
                        "error_data": error_data,
                        "tool_name": tool_name,
                    }
            
            if 'result' not in response_data:
                if add_log:
                    add_log(f"❌ MCP工具响应格式错误: 缺少result字段")
                return {
                    "success": False,
                    "error_type": "format",
                    "error": "响应缺少 result 字段",
                    "tool_name": tool_name,
                }
            
            result = response_data['result']
            
            # 提取内容（可能是content字段）
            extracted_data = result
            extracted_text = None
            if isinstance(result, dict) and 'content' in result:
                content = result['content']
                if isinstance(content, list) and len(content) > 0:
                    # 取第一个content项
                    first_content = content[0]
                    if isinstance(first_content, dict) and 'text' in first_content:
                        extracted_text = first_content['text']
                        extracted_data = first_content['text']
                    else:
                        extracted_data = first_content
                else:
                    extracted_data = content
            
            print(f"{GREEN}{BOLD}[MCP TOOL] ✅ 工具调用成功{RESET}")
            print(f"{GREEN}[MCP TOOL]   提取的文本长度: {len(extracted_text) if extracted_text else 0}{RESET}")
            print(f"{GREEN}[MCP TOOL] ========== call_mcp_tool 完成 =========={RESET}")
            return {
                "success": True,
                "data": extracted_data,
                "raw_result": result,
                "text": extracted_text,
                "tool_name": tool_name,
            }
                
        except requests.exceptions.Timeout as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt
                if add_log:
                    add_log(f"⚠️ 请求超时，{wait_time}秒后重试")
                time.sleep(wait_time)
                last_error = str(e)
                continue
            else:
                if add_log:
                    add_log(f"❌ MCP工具调用超时: {str(e)}")
                print(f"[MCP Common] ❌ Timeout calling tool {tool_name}: {e}")
                return {
                    "success": False,
                    "error_type": "network",
                    "error": f"请求超时: {str(e)}",
                    "tool_name": tool_name,
                }
                
        except requests.exceptions.ConnectionError as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt
                if add_log:
                    add_log(f"⚠️ 连接错误，{wait_time}秒后重试: {str(e)}")
                time.sleep(wait_time)
                last_error = str(e)
                continue
            else:
                if add_log:
                    add_log(f"❌ MCP工具连接错误: {str(e)}")
                print(f"[MCP Common] ❌ Connection error calling tool {tool_name}: {e}")
                return {
                    "success": False,
                    "error_type": "network",
                    "error": f"连接错误: {str(e)}",
                    "tool_name": tool_name,
                }
        
        except Exception as e:
            # 其他错误通常不可重试
            if add_log:
                add_log(f"❌ MCP工具调用异常: {str(e)}")
            print(f"[MCP Common] ❌ Error calling tool {tool_name}: {e}")
            import traceback
            traceback.print_exc()
            return {
                "success": False,
                "error_type": "unknown",
                "error": str(e),
                "tool_name": tool_name,
            }
    
    # 所有重试都失败
    if add_log and last_error:
        add_log(f"❌ MCP工具调用失败（已重试{max_retries}次）: {last_error}")
    return {
        "success": False,
        "error_type": "retry_exhausted",
        "error": f"重试{max_retries}次后仍失败: {last_error}",
        "tool_name": tool_name,
    }


def _parse_sse_text_to_jsonrpc(sse_text: str) -> Optional[Dict[str, Any]]:
    """将 text/event-stream 的 body 解析为最后一个有效 JSON-RPC 响应 dict。

    兼容格式：
    - data: {...}
    - event: message + data: {...}
    """
    try:
        if not sse_text:
            return None
        last_ok = None
        for line in sse_text.splitlines():
            line = line.strip()
            if not line.startswith('data:'):
                continue
            data = line[5:].strip()
            if not data:
                continue
            parsed = parse_mcp_jsonrpc_response(data)
            if isinstance(parsed, dict) and parsed.get('jsonrpc') == '2.0':
                last_ok = parsed
        return last_ok
    except Exception as e:
        print(f"[MCP Common] ⚠️ Failed to parse SSE as JSON-RPC: {e}")
        return None

def validate_tools_list_response(response_data: Dict[str, Any]) -> bool:
    """
    验证 tools/list 响应格式（通用）
    
    Args:
        response_data: 已解析的 JSON-RPC 响应
        
    Returns:
        是否为有效的 tools/list 响应
    """
    try:
        if not isinstance(response_data, dict):
            return False
        
        result = response_data.get('result')
        if not isinstance(result, dict):
            return False
        
        tools = result.get('tools')
        if not isinstance(tools, list):
            print(f"[MCP Parse] Warning: 'tools' is not a list: {type(tools)}")
            return False
        
        # 验证每个工具的基本结构
        for i, tool in enumerate(tools):
            if not isinstance(tool, dict):
                print(f"[MCP Parse] Warning: Tool {i} is not a dict")
                continue
            if 'name' not in tool:
                print(f"[MCP Parse] Warning: Tool {i} missing 'name' field")
        
        print(f"[MCP Parse] ✅ Valid tools/list response with {len(tools)} tools")
        return True
        
    except Exception as e:
        print(f"[MCP Parse] ❌ Error validating tools/list response: {e}")
        return False


def parse_sse_event(event_type: str, data: str) -> Optional[Dict[str, Any]]:
    """
    解析 SSE 事件（通用 MCP）
    
    Args:
        event_type: SSE 事件类型（如 "message"）
        data: SSE 事件数据
        
    Returns:
        解析后的事件数据字典，如果解析失败则返回 None
    """
    try:
        if event_type == 'message':
            response = parse_mcp_jsonrpc_response(data)
            if response and 'result' in response:
                # 尝试识别响应类型
                result = response['result']
                if isinstance(result, dict) and 'tools' in result:
                    # tools/list 响应
                    if validate_tools_list_response(response):
                        return response
                else:
                    # 其他类型的响应
                    return response
            return response
        else:
            print(f"[MCP Parse] Unknown event type: {event_type}")
            return None
    except Exception as e:
        print(f"[MCP Parse] ❌ Error parsing SSE event: {e}")
        return None

