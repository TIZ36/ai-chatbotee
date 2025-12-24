/**
 * MCP API 服务
 * 提供 MCP 服务器配置管理
 * 通过后端API统一管理，支持Electron动态添加MCP服务器
 */

import { MCPServer } from './mcpClient';

export interface MCPServerConfig {
  id: string;
  /** 后端返回字段（与 id 等价，历史兼容） */
  server_id?: string;
  name: string;
  url: string;
  type: 'http-stream' | 'http-post' | 'stdio';
  enabled: boolean;
  use_proxy?: boolean;
  description?: string;
  metadata?: Record<string, any>;
  ext?: Record<string, any>; // 扩展配置（如Notion的Integration Secret等）
  display_name?: string; // 显示名称（用于 Notion 等，使用 client_name）
  client_name?: string; // Notion 注册的 client_name
}

import { getBackendUrl } from '../utils/backendUrl';

// 旧的默认服务器配置（用于迁移）
const LEGACY_DEFAULT_SERVERS: MCPServerConfig[] = [
  {
    id: 'xiaohongshu',
    name: '小红书 MCP',
    url: 'http://localhost:18060/mcp',
    type: 'http-stream',
    enabled: true,
    description: '小红书内容管理和发布功能',
  }
];

/**
 * 获取可用 MCP 服务器列表
 */
export async function getMCPServers(): Promise<MCPServerConfig[]> {
  try {
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/mcp/servers`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

    const data = await response.json();
    return data.servers || [];
  } catch (error) {
    console.error('Failed to fetch MCP servers from backend:', error);
    // 如果后端不可用，返回空数组
    return [];
  }
}

/**
 * 创建 MCP 服务器配置
 */
export async function createMCPServer(server: Partial<MCPServerConfig>): Promise<{ server_id: string; message: string }> {
  try {
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/mcp/servers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(server),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to create MCP server:', error);
    throw error;
  }
}

/**
 * 更新 MCP 服务器配置
 */
export async function updateMCPServer(serverId: string, updates: Partial<MCPServerConfig>): Promise<{ message: string }> {
  try {
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/mcp/servers/${serverId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to update MCP server:', error);
    throw error;
  }
}

/**
 * 删除 MCP 服务器配置
 */
export async function deleteMCPServer(serverId: string): Promise<{ message: string }> {
  try {
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/mcp/servers/${serverId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }

    return await response.json();
  } catch (error) {
    console.error('Failed to delete MCP server:', error);
    throw error;
  }
}

/**
 * 获取单个 MCP 服务器配置
 */
export async function getMCPServer(serverId: string): Promise<MCPServerConfig | null> {
  try {
    const servers = await getMCPServers();
  return servers.find(s => s.id === serverId) || null;
  } catch (error) {
    console.error('Failed to get MCP server:', error);
    return null;
  }
}

// ==================== 通用 OAuth MCP 服务器配置 API ====================

export interface OAuthProtectedResource {
  resource: string;
  resource_name?: string;
  resource_documentation?: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
}

export interface OAuthAuthorizationServer {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  response_types_supported: string[];
  response_modes_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

export interface OAuthDiscoveryResult {
  protected_resource: OAuthProtectedResource | null;
  authorization_server: OAuthAuthorizationServer;
  resource: string;
}

export interface OAuthAuthorizeResult {
  authorization_url: string;
  client_id: string;  // OAuth Client ID，用于标识此次授权会话
  state: string;
  // code_verifier 已保存到 Redis，不再返回给前端
}

export interface OAuthTokenResult {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * 发现 MCP 服务器的 OAuth 配置
 */
export async function discoverMCPOAuth(mcpUrl: string): Promise<OAuthDiscoveryResult> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/mcp/oauth/discover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mcp_url: mcpUrl }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 生成 OAuth 授权 URL
 * OAuth 配置会保存到 Redis，用于后续 token 交换
 * 回调地址会自动设置为后端端点
 */
export async function authorizeMCPOAuth(params: {
  authorization_endpoint: string;
  client_id: string;
  resource?: string;
  code_challenge_methods_supported?: string[];
  token_endpoint?: string;  // 用于保存到 Redis
  client_secret?: string;  // 用于保存到 Redis
  token_endpoint_auth_methods_supported?: string[];  // 用于保存到 Redis
  mcp_url?: string;  // MCP 服务器 URL，用于保存 token
}): Promise<OAuthAuthorizeResult> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/mcp/oauth/authorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 获取 Notion OAuth 配置（client_id等）
 */
export async function getNotionOAuthConfig(): Promise<{ client_id: string; has_client_secret: boolean }> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/mcp/oauth/notion/config`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 交换 OAuth 授权码获取 access token
 * OAuth 配置（code_verifier、token_endpoint 等）会从 Redis 自动读取
 */
export async function exchangeMCPOAuthToken(params: {
  code: string;
  state: string;
  // 其他参数（code_verifier、token_endpoint 等）会从 Redis 自动读取
}): Promise<OAuthTokenResult> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/mcp/oauth/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: params.code,
      state: params.state,
      // 只传递 code 和 state，其他配置从 Redis 读取
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || error.details?.error_description || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

// ==================== Notion 注册管理 API ====================

export interface NotionRegistration {
  id: number;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  redirect_uri_base?: string;
  client_uri?: string;
  registration_data?: any;
  created_at?: string;
  updated_at?: string;
}

/**
 * 注册新的 Notion OAuth 客户端
 */
export async function registerNotionClient(params: {
  client_name: string;
  redirect_uri_base?: string;
  client_uri?: string;
}): Promise<{
  success: boolean;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  registration_data: any;
}> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/notion/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 获取所有已注册的 Notion 工作空间列表
 */
export async function getNotionRegistrations(): Promise<NotionRegistration[]> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/notion/registrations`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.registrations || [];
}

/**
 * 获取特定的 Notion 注册信息
 */
export async function getNotionRegistration(client_id: string): Promise<NotionRegistration> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/notion/registrations/${client_id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}
