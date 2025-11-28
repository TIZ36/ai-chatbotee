"""
Notion MCP 服务器 OAuth 认证和 Token 管理
"""

import secrets
import hashlib
import base64
import json
import time
import requests
from typing import Optional, Dict, Any
from urllib.parse import urlencode

from database import save_oauth_token, get_oauth_token, is_token_expired, refresh_oauth_token, get_oauth_config, get_mysql_connection


def get_notion_registration_from_db(client_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    从数据库获取 Notion 注册信息
    
    Args:
        client_id: 可选的 client_id，如果不提供则返回第一个注册信息
        
    Returns:
        注册信息字典，如果不存在则返回 None
    """
    try:
        conn = get_mysql_connection()
        if not conn:
            return None
        
        cursor = conn.cursor()
        
        if client_id:
            cursor.execute("""
                SELECT client_id, client_name, redirect_uri, redirect_uri_base, 
                       client_uri, registration_data
                FROM notion_registrations
                WHERE client_id = %s
                LIMIT 1
            """, (client_id,))
        else:
            # 返回最新的注册信息
            cursor.execute("""
                SELECT client_id, client_name, redirect_uri, redirect_uri_base, 
                       client_uri, registration_data
                FROM notion_registrations
                ORDER BY created_at DESC
                LIMIT 1
            """)
        
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row:
            return None
        
        registration_data = row[5]  # registration_data JSON
        if isinstance(registration_data, str):
            try:
                registration_data = json.loads(registration_data)
            except:
                registration_data = {}
        
        return {
            'client_id': row[0],
            'client_name': row[1],
            'redirect_uri': row[2],
            'redirect_uri_base': row[3],
            'client_uri': row[4],
            'registration_data': registration_data,
        }
    except Exception as e:
        print(f"[Notion OAuth] Error getting registration from DB: {e}")
        return None


class NotionOAuthHandler:
    """Notion OAuth 处理器"""
    
    AUTHORIZATION_ENDPOINT = "https://mcp.notion.com/authorize"
    TOKEN_ENDPOINT = "https://mcp.notion.com/token"
    RESOURCE = "https://mcp.notion.com/"
    
    def __init__(self, config: Dict[str, Any], client_id: Optional[str] = None):
        """
        初始化 Notion OAuth 处理器
        
        Args:
            config: 应用配置字典（保留用于兼容性，但不再使用其中的 notion 配置）
            client_id: 可选的 client_id，用于从数据库查找特定注册信息
        """
        self.config = config
        self.client_id = client_id
        # 从数据库读取注册信息
        self.registration = get_notion_registration_from_db(client_id)
        
        # 兼容旧代码：如果没有数据库注册信息，尝试从 config.yaml 读取（向后兼容）
        if not self.registration:
        self.notion_config = config.get('notion', {})
            print(f"[Notion OAuth] ⚠️ No registration found in DB, falling back to config.yaml")
        else:
            self.notion_config = {}  # 不再使用 config.yaml
            print(f"[Notion OAuth] ✅ Using registration from DB: {self.registration.get('client_name')}")
    
    def get_client_id(self) -> Optional[str]:
        """获取 Notion Client ID（优先从数据库，否则从配置）"""
        if self.registration:
            return self.registration.get('client_id')
        return self.notion_config.get('client_id', '').strip() or None
    
    def get_client_secret(self) -> Optional[str]:
        """获取 Notion Client Secret（Notion MCP 不需要）"""
        return None  # Notion MCP 使用 token_endpoint_auth_method: 'none'
    
    def get_redirect_uri(self) -> str:
        """获取 Redirect URI（优先从数据库，否则从配置）"""
        if self.registration:
            return self.registration.get('redirect_uri')
        backend_url = self.config.get('server', {}).get('url', 'http://localhost:3001')
        return self.notion_config.get('redirect_uri', f"{backend_url}/mcp/oauth/callback/")
    
    def generate_authorization_url(self) -> Dict[str, str]:
        """
        生成 Notion OAuth 授权 URL
        
        Returns:
            包含 authorization_url, state, code_verifier 的字典
        """
        client_id = self.get_client_id()
        if not client_id:
            raise ValueError('Notion OAuth Client ID 未配置，请在 backend/config.yaml 中配置 notion.client_id')
        
        redirect_uri = self.get_redirect_uri()
        
        # 生成 state 用于 CSRF 防护
        state = f"notion_oauth_{secrets.token_urlsafe(32)}"
        
        # 生成 PKCE code_verifier 和 code_challenge
        code_verifier = secrets.token_urlsafe(64)[:128]
        code_challenge_bytes = hashlib.sha256(code_verifier.encode('utf-8')).digest()
        code_challenge = base64.urlsafe_b64encode(code_challenge_bytes).decode('utf-8').rstrip('=')
        
        print(f"[Notion OAuth] Generated PKCE:")
        print(f"[Notion OAuth]   code_verifier: {code_verifier[:30]}...")
        print(f"[Notion OAuth]   code_challenge: {code_challenge[:30]}...")
        
        # 构建授权 URL
        params = {
            'client_id': client_id,
            'response_type': 'code',
            'redirect_uri': redirect_uri,
            'state': state,
            'code_challenge': code_challenge,
            'code_challenge_method': 'S256',
            'resource': self.RESOURCE,
        }
        
        authorization_url = f"{self.AUTHORIZATION_ENDPOINT}?{urlencode(params)}"
        
        print(f"[Notion OAuth] Generated authorization URL")
        print(f"[Notion OAuth] client_id: {client_id[:10]}...")
        print(f"[Notion OAuth] Redirect URI: {redirect_uri}")
        print(f"[Notion OAuth] State: {state}")
        print(f"[Notion OAuth] Full URL: {authorization_url[:150]}...")
        
        return {
            'authorization_url': authorization_url,
            'state': state,
            'code_verifier': code_verifier,
        }
    
    def exchange_token(self, code: str, code_verifier: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        """
        交换授权码获取 access token
        
        Args:
            code: 授权码
            code_verifier: PKCE code_verifier
            redirect_uri: 重定向 URI（可选，默认使用配置中的值）
            
        Returns:
            Token 信息字典
        """
        client_id = self.get_client_id()
        if not client_id:
            raise ValueError('Notion OAuth Client ID 未配置')
        
        redirect_uri = redirect_uri or self.get_redirect_uri()
        
        print(f"[Notion OAuth] Exchanging code for access token")
        
        headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
        }
        
        payload = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': redirect_uri,
            'code_verifier': code_verifier,
            'client_id': client_id,
            'resource': self.RESOURCE,
        }
        
        print(f"[Notion OAuth] Sending token request to: {self.TOKEN_ENDPOINT}")
        print(f"[Notion OAuth] Payload:")
        for key, value in payload.items():
            if key == 'code_verifier':
                print(f"  {key}: {value[:50] + '...' if len(str(value)) > 50 else value}")
            else:
                print(f"  {key}: {value}")
        
        response = requests.post(self.TOKEN_ENDPOINT, data=payload, headers=headers, timeout=30)
        
        print(f"[Notion OAuth] Token response status: {response.status_code}")
        
        if not response.ok:
            error_data = response.json() if response.headers.get('content-type', '').startswith('application/json') else {}
            print(f"[Notion OAuth] ❌ Token exchange failed: {response.status_code}")
            print(f"[Notion OAuth] Error response: {error_data}")
            raise Exception(f"Token exchange failed: {error_data}")
        
        token_data = response.json()
        print(f"[Notion OAuth] ✅ Access token received successfully")
        print(f"[Notion OAuth] Workspace: {token_data.get('workspace_name', 'N/A')}")
        print(f"[Notion OAuth] Workspace ID: {token_data.get('workspace_id', 'N/A')}")
        print(f"[Notion OAuth] Bot ID: {token_data.get('bot_id', 'N/A')}")
        
        access_token = token_data.get('access_token')
        if not access_token:
            raise ValueError("响应中没有 access_token")
        
        return token_data
    
    def refresh_access_token(self, refresh_token: str, mcp_url: str) -> Optional[Dict[str, Any]]:
        """
        刷新 access token
        
        Args:
            refresh_token: Refresh token
            mcp_url: MCP 服务器 URL
            
        Returns:
            新的 token 信息，如果失败则返回 None
        """
        client_id = self.get_client_id()
        if not client_id:
            print(f"[Notion OAuth] No client_id configured")
            return None
        
        print(f"[Notion OAuth] Refreshing token for {mcp_url[:50]}...")
        
        headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
        }
        
        # Notion refresh token 请求不需要 resource 参数
        payload = {
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
            'client_id': client_id,
        }
        
        print(f"[Notion OAuth] Sending refresh token request")
        print(f"[Notion OAuth]   grant_type: refresh_token")
        print(f"[Notion OAuth]   refresh_token: {refresh_token[:40]}...")
        print(f"[Notion OAuth]   client_id: {client_id}")
        
        response = requests.post(self.TOKEN_ENDPOINT, data=payload, headers=headers, timeout=30)
        
        print(f"[Notion OAuth] Refresh response status: {response.status_code}")
        
        if not response.ok:
            error_text = response.text
            print(f"[Notion OAuth] ❌ Token refresh failed: {response.status_code}")
            print(f"[Notion OAuth] Error response: {error_text}")
            return None
        
        new_token_data = response.json()
        new_access_token = new_token_data.get('access_token')
        new_refresh_token = new_token_data.get('refresh_token', refresh_token)
        expires_in = new_token_data.get('expires_in')
        
        print(f"[Notion OAuth] ✅ Got new access_token: {new_access_token[:20]}..." if new_access_token else "[Notion OAuth] ❌ No access_token in response")
        print(f"[Notion OAuth] ✅ Got new refresh_token: {new_refresh_token[:20]}..." if new_refresh_token else "[Notion OAuth] ⚠️ No refresh_token in response")
        print(f"[Notion OAuth] Token expires_in: {expires_in} seconds" if expires_in else "[Notion OAuth] No expires_in")
        
        if not new_access_token:
            print(f"[Notion OAuth] ❌ No access_token in refresh response")
            return None
        
        # 构建 token_info
        token_info = {
            'client_id': client_id,
            'access_token': new_access_token,
            'refresh_token': new_refresh_token,
            'token_type': new_token_data.get('token_type', 'bearer'),
            'expires_in': expires_in,
            'expires_at': int(time.time()) + expires_in if expires_in else None,
            'scope': new_token_data.get('scope', ''),
            'mcp_url': mcp_url.rstrip('/') if mcp_url else None,
        }
        
        # 保存新 token
        normalized_mcp_url = mcp_url.rstrip('/') if mcp_url else None
        if normalized_mcp_url:
            save_oauth_token(normalized_mcp_url, token_info)
            save_oauth_token(f"client:{client_id}", token_info)
        
        print(f"[Notion OAuth] ✅ Token refreshed successfully")
        return token_info


# 便捷函数
def get_notion_oauth_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    获取 Notion OAuth 配置
    
    Args:
        config: 应用配置字典
        
    Returns:
        包含 client_id 和 has_client_secret 的字典
    """
    notion_config = config.get('notion', {})
    client_id = notion_config.get('client_id', '').strip()
    client_secret = notion_config.get('client_secret', '').strip()
    
    return {
        'client_id': client_id,
        'has_client_secret': bool(client_secret),
    }


def generate_notion_authorization_url(config: Dict[str, Any], client_id: Optional[str] = None) -> Dict[str, str]:
    """
    生成 Notion OAuth 授权 URL（便捷函数）
    
    Args:
        config: 应用配置字典
        client_id: 可选的 client_id，用于从数据库查找特定注册信息
        
    Returns:
        包含 authorization_url, state, code_verifier 的字典
    """
    handler = NotionOAuthHandler(config, client_id)
    return handler.generate_authorization_url()


def exchange_notion_token(config: Dict[str, Any], code: str, code_verifier: str, redirect_uri: Optional[str] = None, client_id: Optional[str] = None) -> Dict[str, Any]:
    """
    交换 Notion OAuth token（便捷函数）
    
    Args:
        config: 应用配置字典
        code: 授权码
        code_verifier: PKCE code_verifier
        redirect_uri: 重定向 URI（可选）
        client_id: 可选的 client_id，用于从数据库查找特定注册信息
        
    Returns:
        Token 信息字典
    """
    handler = NotionOAuthHandler(config, client_id)
    return handler.exchange_token(code, code_verifier, redirect_uri)


def refresh_notion_token(config: Dict[str, Any], refresh_token: str, mcp_url: str, client_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    刷新 Notion OAuth token（便捷函数）
    
    Args:
        config: 应用配置字典
        refresh_token: Refresh token
        mcp_url: MCP 服务器 URL
        client_id: 可选的 client_id，用于从数据库查找特定注册信息
        
    Returns:
        新的 token 信息，如果失败则返回 None
    """
    handler = NotionOAuthHandler(config, client_id)
    return handler.refresh_access_token(refresh_token, mcp_url)


def parse_notion_custom_response(response_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Notion MCP 服务器的自定义响应解析（如果需要特殊处理）
    
    Args:
        response_data: 已解析的 JSON-RPC 响应
        
    Returns:
        处理后的响应数据，如果不需要特殊处理则返回原数据
    """
    try:
        # Notion 特定的响应处理逻辑
        result = response_data.get('result')
        if isinstance(result, dict):
            # 处理 tools/list 响应
            if 'tools' in result:
                tools = result['tools']
                if isinstance(tools, list):
                    print(f"[Notion Custom] ✅ Tools list response with {len(tools)} tools")
                    
                    # 验证每个工具的结构
                    valid_tools = 0
                    for tool in tools:
                        if isinstance(tool, dict):
                            if 'name' in tool and 'inputSchema' in tool:
                                valid_tools += 1
                            else:
                                print(f"[Notion Custom] ⚠️ Tool missing required fields: {tool.get('name', 'unknown')}")
                    
                    print(f"[Notion Custom] Valid tools: {valid_tools}/{len(tools)}")
            
            # 处理 initialize 响应
            elif 'serverInfo' in result:
                server_info = result['serverInfo']
                print(f"[Notion Custom] Server: {server_info.get('name', 'unknown')} v{server_info.get('version', '?')}")
                if 'capabilities' in result:
                    capabilities = result['capabilities']
                    print(f"[Notion Custom] Capabilities: {', '.join(capabilities.keys())}")
            
            # 处理 token 响应（OAuth）
            elif 'workspace_id' in result:
                print(f"[Notion Custom] Workspace ID: {result.get('workspace_id')}")
                print(f"[Notion Custom] Workspace Name: {result.get('workspace_name', 'N/A')}")
            if 'bot_id' in result:
                print(f"[Notion Custom] Bot ID: {result.get('bot_id')}")
        
        return response_data
        
    except Exception as e:
        print(f"[Notion Custom] ❌ Error in custom parsing: {e}")
        import traceback
        traceback.print_exc()
        return response_data


def parse_notion_sse_event(event_type: str, data: str) -> Optional[Dict[str, Any]]:
    """
    解析 Notion MCP 服务器的 SSE 事件（使用通用解析 + 自定义处理）
    
    Args:
        event_type: SSE 事件类型（如 "message"）
        data: SSE 事件数据
        
    Returns:
        解析后的事件数据字典，如果解析失败则返回 None
    """
    try:
        # 使用通用 MCP 解析
        # 使用绝对导入，因为从 app.py 导入时路径不同
        import sys
        import os
        # 获取 backend 目录路径
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
        
        from mcp_server.mcp_common_logic import parse_sse_event as generic_parse_sse_event
        
        # 先用通用解析
        response = generic_parse_sse_event(event_type, data)
        
        # 如果解析成功，应用 Notion 特定的处理
        if response:
            return parse_notion_custom_response(response)
        
        return response
        
    except Exception as e:
        print(f"[Notion SSE] ❌ Error parsing SSE event: {e}")
        import traceback
        traceback.print_exc()
        return None

