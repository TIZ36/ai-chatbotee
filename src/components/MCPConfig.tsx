/**
 * MCP 服务器配置组件
 * 允许用户添加、编辑、删除 MCP 服务器配置
 */

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Save, X, Server, AlertCircle, CheckCircle, Wrench, ExternalLink, Plug } from 'lucide-react';
import PageLayout, { Card, Section, Alert, EmptyState } from './ui/PageLayout';
import { MCPTool, MCPClient } from '../services/mcpClient';
import { 
  getMCPServers, 
  createMCPServer, 
  updateMCPServer, 
  deleteMCPServer, 
  MCPServerConfig,
  discoverMCPOAuth,
  authorizeMCPOAuth,
  registerNotionClient,
  getNotionRegistrations,
  NotionRegistration,
} from '../services/mcpApi';

// 获取后端URL的辅助函数
const getBackendUrl = (): string => {
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:3002';
};

interface MCPConfigProps {}

const MCPConfig: React.FC<MCPConfigProps> = () => {
  // MCP 服务器列表
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAddingNotion, setIsAddingNotion] = useState(false);
  const [newServer, setNewServer] = useState<Partial<MCPServerConfig>>({
    name: '',
    url: '',
    type: 'http-stream',
    enabled: true,
    description: '',
  });
  const [notionIntegrationSecret, setNotionIntegrationSecret] = useState('');
  const [notionAuthState, setNotionAuthState] = useState<'idle' | 'authenticating' | 'authenticated'>('idle');
  
  // Notion 工作空间选择和注册相关状态
  const [showWorkspaceSelection, setShowWorkspaceSelection] = useState(false);
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const [notionRegistrations, setNotionRegistrations] = useState<NotionRegistration[]>([]);
  const [registrationFormData, setRegistrationFormData] = useState({
    client_name: '',
    redirect_uri_base: 'http://localhost:3002',
  });
  const [isRegistering, setIsRegistering] = useState(false);

  // 测试连接状态
  const [testingServers, setTestingServers] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Map<string, { success: boolean; message: string; tools?: MCPTool[]; connected?: boolean }>>(new Map());

  // 已连接的客户端实例
  const [connectedClients, setConnectedClients] = useState<Map<string, MCPClient>>(new Map());

  // 清理连接的辅助函数
  const cleanupConnection = (serverId: string) => {
    const client = connectedClients.get(serverId);
    if (client) {
      client.disconnect().catch(err => console.error(`[MCP Config] Error disconnecting ${serverId}:`, err));
      setConnectedClients(prev => {
        const newMap = new Map(prev);
        newMap.delete(serverId);
        return newMap;
      });
    }
  };

  // 加载 MCP 服务器列表
  useEffect(() => {
    loadServers();
  }, []);

  // OAuth 回调现在由后端处理，不再需要前端处理

  const loadServers = async () => {
    try {
      const serverList = await getMCPServers();
      setServers(serverList);
    } catch (error) {
      console.error('Failed to load MCP servers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddServer = async () => {
    if (!newServer.name || !newServer.url) {
      alert('名称和URL都是必需的');
      return;
    }

    try {
      await createMCPServer(newServer);
      await loadServers(); // 重新加载列表
      setIsAdding(false);
      setNewServer({
        name: '',
        url: '',
        type: 'http-stream',
        enabled: true,
        description: '',
      });
    } catch (error) {
      console.error('Failed to create MCP server:', error);
      alert('创建服务器失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // 检测是否在Electron环境中
  const isElectron = () => {
    return typeof window !== 'undefined' && (window as any).electronAPI !== undefined;
  };

  // 加载 Notion 注册列表
  const loadNotionRegistrations = async (): Promise<NotionRegistration[]> => {
    try {
      const registrations = await getNotionRegistrations();
      setNotionRegistrations(registrations);
      return registrations;
    } catch (error) {
      console.error('[Notion] Failed to load registrations:', error);
      setNotionRegistrations([]);
      return [];
    }
  };

  // 使用已注册的工作空间进行 OAuth 授权
  const handleUseExistingWorkspace = async (registration: NotionRegistration) => {
    setShowWorkspaceSelection(false);
    
    // 检查是否已有对应的服务器配置
    const existingServer = servers.find(s => 
      s.ext?.server_type === 'notion' && 
      s.ext?.client_id === registration.client_id
    );
    
    if (existingServer) {
      // 如果服务器已存在，直接测试连接（后端会自动检查 token 并刷新）
      console.log('[Notion] Server exists, testing connection with existing token...');
      setNotionAuthState('authenticating');
      
      try {
        // 测试连接（后端会自动处理 token 检查和刷新）
        const response = await fetch(`${getBackendUrl()}/api/mcp/servers/${existingServer.id}/test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log('[Notion] ✅ Connection test successful:', result);
          setNotionAuthState('authenticated');
          await loadServers(); // 重新加载服务器列表
          alert('Notion MCP 服务器连接成功！');
          return;
        } else {
          const error = await response.json();
          console.log('[Notion] Connection test failed:', error);
          
          // 如果明确需要 OAuth（token 不存在或无效），走 OAuth 流程
          if (error.requires_oauth || response.status === 401) {
            console.log('[Notion] OAuth required, starting OAuth flow...');
            await performNotionOAuth(registration.client_id);
          } else {
            // 其他错误（如网络错误），提示用户
            alert('连接失败: ' + (error.error || '未知错误'));
            setNotionAuthState('idle');
          }
        }
      } catch (error) {
        console.error('[Notion] Connection test error:', error);
        // 如果测试失败，走 OAuth 流程
        await performNotionOAuth(registration.client_id);
      }
    } else {
      // 如果服务器不存在，走 OAuth 流程
      await performNotionOAuth(registration.client_id);
    }
  };

  // 处理 Notion OAuth 连接（入口函数）
  const handleNotionOAuthConnect = async () => {
    // 先加载已注册的工作空间列表
    const registrations = await loadNotionRegistrations();
    
    // 如果有已注册的工作空间，显示选择对话框
    if (registrations.length > 0) {
      setShowWorkspaceSelection(true);
      return;
    }
    
    // 如果没有已注册的工作空间，直接显示注册表单
    setShowRegistrationForm(true);
  };

  // 处理注册新工作空间
  const handleRegisterNotion = async () => {
    if (!registrationFormData.client_name.trim()) {
      alert('请输入客户端名称（Client Name）');
      return;
    }

    // 验证 client_name：只允许英文、数字、下划线、连字符
    const clientNamePattern = /^[a-zA-Z0-9_-]+$/;
    if (!clientNamePattern.test(registrationFormData.client_name)) {
      alert('客户端名称只能包含英文、数字、下划线和连字符');
      return;
    }

    setIsRegistering(true);
    try {
      const result = await registerNotionClient({
        client_name: registrationFormData.client_name.trim(),
        redirect_uri_base: registrationFormData.redirect_uri_base.trim() || 'http://localhost:3002',
      });

      console.log('[Notion] Registration successful:', result);
      
      // 重新加载注册列表
      await loadNotionRegistrations();
      
      // 关闭注册表单，使用新注册的 client_id 进行 OAuth 授权
      setShowRegistrationForm(false);
      setRegistrationFormData({ client_name: '', redirect_uri_base: 'http://localhost:3002' });
      
      // 使用新注册的 client_id 进行 OAuth 授权
      await performNotionOAuth(result.client_id);
    } catch (error) {
      console.error('[Notion] Registration failed:', error);
      alert('注册失败: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsRegistering(false);
    }
  };

  // 执行 Notion OAuth 授权（使用指定的 client_id）
  const performNotionOAuth = async (clientId: string) => {
    try {
      setNotionAuthState('authenticating');
      
      const mcpUrl = 'https://mcp.notion.com/mcp';  // MCP 服务器 URL
      
      // 1. 发现 OAuth 配置
      console.log('[Notion OAuth] Discovering OAuth configuration...');
      const discovery = await discoverMCPOAuth('https://mcp.notion.com');
      console.log('[Notion OAuth] OAuth discovery result:', discovery);
      
      console.log('[Notion OAuth] Using Client ID:', clientId);
      
      // 2. 生成授权 URL（配置会保存到 Redis，回调地址为后端端点）
      console.log('[Notion OAuth] Generating authorization URL...');
      const authorizeResult = await authorizeMCPOAuth({
        authorization_endpoint: discovery.authorization_server.authorization_endpoint,
        client_id: clientId,
        resource: discovery.resource,
        code_challenge_methods_supported: discovery.authorization_server.code_challenge_methods_supported,
        token_endpoint: discovery.authorization_server.token_endpoint,
        client_secret: '', // Notion MCP 不需要 client_secret
        token_endpoint_auth_methods_supported: discovery.authorization_server.token_endpoint_auth_methods_supported,
        mcp_url: mcpUrl,  // 传递 MCP URL，用于保存 token
      });
      
      console.log('[Notion OAuth] Got authorization URL');
      console.log('[Notion OAuth] Client ID:', authorizeResult.client_id);
      console.log('[Notion OAuth] State:', authorizeResult.state);
      console.log('[Notion OAuth] OAuth config saved to Redis by backend');
      console.log('[Notion OAuth] Callback will be handled by backend');
      console.log('[Notion OAuth] Callback URL:', `${getBackendUrl()}/mcp/oauth/callback`);
      
      // 3. 打开系统外部浏览器进行认证
      // 回调地址已设置为后端：/mcp/oauth/callback（固定地址，client_id从config.yaml读取）
      // 后端会自动处理 token 交换并保存到 Redis
      try {
        if (isElectron()) {
          console.log('[Notion OAuth] Opening external browser via Electron');
          const electronAPI = (window as any).electronAPI;
          await electronAPI.mcpOAuthOpenExternal({
            authorizationUrl: authorizeResult.authorization_url,
          });
          console.log('[Notion OAuth] ✅ External browser opened');
        } else {
          console.log('[Notion OAuth] Opening external browser via window.open');
          // 在浏览器环境中，使用 window.open 打开新窗口
          const authWindow = window.open(
            authorizeResult.authorization_url,
            'Notion Authorization',
            'width=600,height=700,scrollbars=yes,resizable=yes'
          );
          
          if (!authWindow) {
            throw new Error('无法打开新窗口，请检查浏览器弹窗设置');
          }
          
          console.log('[Notion OAuth] ✅ External browser window opened');
        }
        
        // 提示用户完成认证
        alert('请在浏览器中完成 Notion 授权。授权完成后，系统将自动保存配置。\n\n提示：授权完成后，您可以关闭浏览器窗口。');
        
        // 轮询检查后端是否已完成 token 交换
        // 由于回调会直接到后端，我们需要轮询检查 token 是否已保存
        console.log('[Notion OAuth] Polling for token completion...');
        const maxAttempts = 60; // 最多等待60秒
        const pollInterval = 1000; // 每秒检查一次
        
        let tokenExchangeCompleted = false;
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          
          // 检查后端是否已完成 token 交换
          // 通过尝试创建服务器配置来验证 token 是否已保存
          try {
            // 先检查是否已有相同URL的服务器配置
            const existingServers = await getMCPServers();
            const existingServer = existingServers.find(s => s.url === mcpUrl);
            
            if (existingServer) {
              // 如果服务器已存在，更新它（添加 client_id）
              console.log('[Notion OAuth] Server config already exists, updating...');
              await updateMCPServer(existingServer.id, {
                ext: {
                  ...existingServer.ext,
                  server_type: 'notion',
                  client_id: authorizeResult.client_id,
                  response_format: 'sse',  // Notion MCP 使用 SSE 格式响应
                },
              });
              await loadServers();
              console.log('[Notion OAuth] ✅ Server config updated');
            } else {
              // 创建新的服务器配置
              await createNotionServerFromRedis(mcpUrl, authorizeResult.client_id);
              console.log('[Notion OAuth] ✅ Server config created');
            }
            
            tokenExchangeCompleted = true;
            setNotionAuthState('authenticated');
            setShowWorkspaceSelection(false);
            alert('Notion MCP 服务器配置成功！Token 已保存到服务器。');
            return; // 成功，退出循环
            
          } catch (error: any) {
            // 如果错误是因为 token 不存在或服务器配置问题，继续等待
            const errorMessage = error.message || String(error);
            if (errorMessage.includes('token') || 
                errorMessage.includes('Token') ||
                errorMessage.includes('未找到') ||
                errorMessage.includes('not found')) {
              console.log(`[Notion OAuth] Waiting for token exchange... (attempt ${attempt + 1}/${maxAttempts})`);
              continue;
            }
            // 其他错误（如网络错误），也继续等待，可能是暂时的
            if (attempt < maxAttempts - 1) {
              console.log(`[Notion OAuth] Error (will retry):`, errorMessage);
              continue;
            }
            // 最后一次尝试失败，抛出错误
            throw error;
          }
        }
        
        // 超时
        if (!tokenExchangeCompleted) {
          throw new Error('授权超时，请检查是否已在浏览器中完成授权');
        }
        
      } catch (error) {
        console.error('[Notion OAuth] Authorization failed:', error);
        setNotionAuthState('idle');
        
        if (error instanceof Error && error.message === 'Authorization cancelled by user') {
          alert('授权已取消');
        } else {
          alert('Notion OAuth 授权失败: ' + (error instanceof Error ? error.message : String(error)));
        }
        return;
      }
      
    } catch (error) {
      console.error('[Notion OAuth] Error:', error);
      setNotionAuthState('idle');
      
      if (error instanceof Error && error.message === 'Authorization cancelled by user') {
        alert('授权已取消');
      } else {
        alert('启动 Notion OAuth 失败: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  };
  
  // 从 Redis 创建 Notion 服务器配置（token 已由后端保存到 Redis）
  const createNotionServerFromRedis = async (mcpUrl: string, clientId: string) => {
    try {
      console.log('[Notion OAuth] Creating server config (token already in Redis)...');
      console.log('[Notion OAuth] Client ID:', clientId);
      
      // 从注册信息中获取 client_name（用于显示）
      const registration = notionRegistrations.find(r => r.client_id === clientId);
      const displayName = registration?.client_name || 'Notion';
      
      // 创建 Notion MCP 服务器配置
      // Token 已保存在 Redis，MCP 代理会自动从 Redis 获取并刷新
      const notionServerConfig: Partial<MCPServerConfig> = {
        name: displayName,  // 使用 client_name 作为显示名称
        url: mcpUrl,
        type: 'http-stream',
        enabled: true,
        use_proxy: true,
        description: `Notion MCP Server - ${displayName}`,
        metadata: {
          headers: {
            // Authorization header 会由 MCP 代理从 Redis 自动获取
            'Notion-Version': '2022-06-28',
          },
        },
        ext: {
          server_type: 'notion',  // 标记为 notion 服务器，触发 token 自动刷新
          client_id: clientId,  // 保存 Client ID，用于关联 token
          client_name: displayName,  // 保存 client_name，用于显示
          response_format: 'sse',  // Notion MCP 使用 SSE 格式响应
        },
      };
      
      await createMCPServer(notionServerConfig);
      await loadServers();
      
      setNotionAuthState('authenticated');
      alert('Notion MCP 服务器配置成功！Token 已保存到服务器。');
      
    } catch (error) {
      console.error('[Notion OAuth] Error creating server config:', error);
      setNotionAuthState('idle');
      throw error;
    }
  };


  const handleAddNotionServer = async () => {
    if (!notionIntegrationSecret.trim()) {
      alert('请输入 Notion Internal Integration Secret');
      return;
    }

    try {
      const notionServerConfig: Partial<MCPServerConfig> = {
        name: 'Notion',
        url: 'https://mcp.notion.com/mcp',
        type: 'http-stream',
        enabled: true,
        use_proxy: true,
        description: 'Notion MCP Server - 通过 Internal Integration 访问 Notion 工作区',
        metadata: {
          headers: {
            'Authorization': `Bearer ${notionIntegrationSecret}`,
          },
        },
        ext: {
          integration_secret: notionIntegrationSecret,
          server_type: 'notion',
        },
      };

      await createMCPServer(notionServerConfig);
      await loadServers();
      setIsAddingNotion(false);
      setNotionIntegrationSecret('');
      alert('Notion MCP 服务器添加成功！');
    } catch (error) {
      console.error('Failed to create Notion MCP server:', error);
      alert('创建 Notion 服务器失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleEditServer = (serverId: string) => {
    const server = servers.find(s => s.id === serverId);
    if (server) {
      setNewServer({ ...server });
      setEditingId(serverId);
    }
  };

  const handleUpdateServer = async () => {
    if (!editingId || !newServer.name || !newServer.url) {
      alert('名称和URL都是必需的');
      return;
    }

    try {
      await updateMCPServer(editingId, newServer);
      await loadServers(); // 重新加载列表
      setEditingId(null);
      setNewServer({
        name: '',
        url: '',
        type: 'http-stream',
        enabled: true,
        description: '',
      });
    } catch (error) {
      console.error('Failed to update MCP server:', error);
      alert('更新服务器失败: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    if (confirm('确定要删除这个 MCP 服务器吗？')) {
      try {
        await deleteMCPServer(serverId);
        await loadServers(); // 重新加载列表
        setTestResults(prev => {
          const newResults = new Map(prev);
          newResults.delete(serverId);
          return newResults;
        });
      } catch (error) {
        console.error('Failed to delete MCP server:', error);
        alert('删除服务器失败: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  };

  const handleTestConnection = async (server: MCPServerConfig) => {
    setTestingServers(prev => new Set(prev).add(server.id));

    try {
      console.log(`[MCP Config] Testing connection to ${server.name} (${server.url})`);
      console.log(`[MCP Config] Server metadata:`, JSON.stringify(server.metadata, null, 2));
      
      // 检查metadata中的headers
      if (server.metadata?.headers) {
        const authHeader = server.metadata.headers.Authorization;
        if (authHeader) {
          console.log(`[MCP Config] Authorization header present:`, authHeader.substring(0, 30) + '...');
          console.log(`[MCP Config] Authorization header length:`, authHeader.length);
        } else {
          console.warn(`[MCP Config] ⚠️ No Authorization header in metadata.headers`);
        }
      } else {
        console.warn(`[MCP Config] ⚠️ No metadata.headers found`);
      }

      // 清理之前的连接（如果存在）
      cleanupConnection(server.id);

      // 创建 MCP 客户端实例
      const testClient = new MCPClient({
        server: {
          id: server.id,
          name: server.name,
          url: server.url,
          type: server.type,
          enabled: server.enabled,
          description: server.description,
          metadata: server.metadata,
          ext: server.ext, // 传递扩展配置（包括 response_format, server_type 等）
        },
      });

      // 建立连接并保持
      console.log(`[MCP Config] Starting MCP client connection test`);
      const connectStart = Date.now();
      await testClient.connect();
      const connectTime = Date.now() - connectStart;
      console.log(`[MCP Config] Connection completed in ${connectTime}ms, keeping connection alive`);

      // 保存连接的客户端实例
      setConnectedClients(prev => new Map(prev).set(server.id, testClient));

      setTestResults(prev => new Map(prev).set(server.id, {
        success: true,
        message: `连接成功 (${connectTime}ms)`,
        connected: true,
        tools: undefined, // 不自动获取工具
      }));

    } catch (error) {
      console.error(`[MCP Config] Test connection error:`, error);

      let errorMessage = `连接错误: ${error instanceof Error ? error.message : String(error)}`;

      // 特殊处理 MCP 协议错误
      if (error instanceof Error && (
        error.message.includes('CORS') ||
        error.message.includes('跨域') ||
        error.message.includes('Failed to fetch')
      )) {
        errorMessage = `跨域访问受限。如在浏览器中使用，请确保 MCP 服务器支持 CORS`;
      }

      setTestResults(prev => new Map(prev).set(server.id, {
        success: false,
        message: errorMessage,
        connected: false,
      }));
    } finally {
      setTestingServers(prev => {
        const newSet = new Set(prev);
        newSet.delete(server.id);
        return newSet;
      });
    }
  };

  const handleFetchTools = async (server: MCPServerConfig) => {
    const result = testResults.get(server.id);
    const connectedClient = connectedClients.get(server.id);

    if (!result?.connected || !connectedClient) {
      console.error(`[MCP Config] Cannot fetch tools: server ${server.id} is not connected`);
      alert('请先测试连接，确保服务器已成功连接');
      return;
    }

    setTestingServers(prev => new Set(prev).add(server.id));

    try {
      console.log(`[MCP Config] Fetching tools for ${server.name} (${server.url}) using existing connection`);
      console.log(`[MCP Config] Client state:`, {
        isInitialized: connectedClient.isInitialized,
        serverInfo: connectedClient.getServerInfo(),
      });

      // 确保客户端已完全初始化
      if (!connectedClient.isInitialized) {
        console.log(`[MCP Config] Client not fully initialized, attempting to reconnect...`);
        try {
          await connectedClient.connect();
          console.log(`[MCP Config] Client reconnected successfully`);
        } catch (reconnectError) {
          console.error(`[MCP Config] Failed to reconnect:`, reconnectError);
          throw new Error(`客户端未初始化且重连失败: ${reconnectError instanceof Error ? reconnectError.message : String(reconnectError)}`);
        }
      }

      // 额外等待确保服务器完全准备好
      // 根据 MCP Inspector 的流程，initialize 返回 202 Accepted（异步）
      // 响应通过 SSE 流返回，需要额外时间
      // 即使连接时已经等待，服务器可能还需要额外时间完成初始化
      console.log(`[MCP Config] Waiting for server to be ready before fetching tools...`);
      console.log(`[MCP Config] Note: Server may need additional time after initialize (202 Accepted) and notifications/initialized`);
      await new Promise(resolve => setTimeout(resolve, 3000)); // 增加到 3000ms

      // 使用已连接的客户端实例获取工具列表
      console.log(`[MCP Config] Fetching tools list from existing connection`);
      const toolsStart = Date.now();
      const tools = await connectedClient.listTools();
      const toolsTime = Date.now() - toolsStart;
      console.log(`[MCP Config] Tools fetched in ${toolsTime}ms`);

      const toolCount = tools.length;
      console.log(`[MCP Config] Retrieved ${toolCount} tools:`, tools);

      setTestResults(prev => new Map(prev).set(server.id, {
        ...result,
        tools: tools,
        message: `连接成功，发现 ${toolCount} 个工具`,
      }));

    } catch (error) {
      console.error(`[MCP Config] Fetch tools error:`, error);
      console.error(`[MCP Config] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');

      let errorMessage = `获取工具失败: ${error instanceof Error ? error.message : String(error)}`;

      // 特殊处理 MCP 协议错误
      if (error instanceof Error) {
        if (error.message.includes('invalid during session initialization')) {
          errorMessage = `MCP 协议错误: 服务器可能仍在初始化阶段，请稍后重试`;
        } else if (error.message.includes('not connected')) {
          errorMessage = `连接已断开，请重新测试连接`;
        } else if (error.message.includes('timeout')) {
          errorMessage = `请求超时，请检查网络连接或稍后重试`;
        }
      }

      setTestResults(prev => new Map(prev).set(server.id, {
        ...result,
        message: errorMessage,
      }));
    } finally {
      setTestingServers(prev => {
        const newSet = new Set(prev);
        newSet.delete(server.id);
        return newSet;
      });
    }
  };

  const cancelEdit = () => {
    setIsAdding(false);
    setEditingId(null);
    setIsAddingNotion(false);
    setNewServer({
      name: '',
      url: '',
      type: 'http-stream',
      enabled: true,
      description: '',
    });
    setNotionIntegrationSecret('');
  };

  return (
    <PageLayout
      title="MCP 服务器配置"
      description="选择公开的 MCP 服务器或添加自定义服务器"
      icon={Plug}
    >
      {/* 公开 MCP 服务器 */}
      <Section title="公开 MCP 服务器" description="一键连接热门 MCP 服务"  className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {/* Notion */}
          <div className="flex flex-col items-center justify-center p-4 bg-white dark:bg-[#363636] border-2 border-gray-200 dark:border-[#505050] rounded-lg hover:border-gray-400 dark:hover:border-[#606060] hover:shadow-md transition-all duration-200 group">
            <svg className="w-16 h-16 mb-3 transition-transform group-hover:scale-110" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" className="fill-white dark:fill-[#363636]"/>
              <path fillRule="evenodd" clipRule="evenodd" d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.724 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z" className="fill-black dark:fill-gray-100"/>
            </svg>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Notion</span>
            
            {notionAuthState === 'authenticating' ? (
              <div className="flex items-center space-x-2 text-xs text-gray-600 dark:text-gray-400">
                <div className="w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                <span>授权中...</span>
              </div>
            ) : (
              <button
                onClick={handleNotionOAuthConnect}
                disabled={isAdding || editingId !== null}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Connect
              </button>
            )}
          </div>

          {/* GitHub */}
          <button
            onClick={() => alert('GitHub MCP 服务器即将推出')}
            disabled={isAdding || editingId !== null || isAddingNotion}
            className="flex flex-col items-center justify-center p-6 bg-white dark:bg-[#363636] border-2 border-gray-200 dark:border-[#505050] rounded-lg hover:border-gray-400 dark:hover:border-[#606060] hover:shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <svg className="w-16 h-16 mb-3 transition-transform group-hover:scale-110" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" className="fill-[#181717] dark:fill-gray-100"/>
            </svg>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">GitHub</span>
          </button>

          {/* 更多服务器占位符 */}
          <div className="flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-[#363636] border-2 border-dashed border-gray-300 dark:border-[#505050] rounded-lg">
            <Server className="w-16 h-16 text-gray-400 dark:text-gray-500 mb-3" />
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">更多服务器</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 mt-1">即将推出</span>
          </div>
        </div>
      </Section>

      {/* Notion 专用添加表单 */}
      {isAddingNotion && (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold mb-3 flex items-center space-x-2">
            {/* Notion Logo */}
            <svg className="w-6 h-6" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" fill="#fff"/>
              <path fillRule="evenodd" clipRule="evenodd" d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.724 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z" fill="#000"/>
            </svg>
            <span>添加 Notion MCP 服务器</span>
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 左侧：输入表单 */}
            <div className="lg:col-span-2 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Internal Integration Secret *
                </label>
                <input
                  type="password"
                  value={notionIntegrationSecret}
                  onChange={(e) => setNotionIntegrationSecret(e.target.value)}
                  className="input-field font-mono text-sm"
                  placeholder="secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
                <p className="text-xs text-gray-500 mt-1">
                  用于访问 Notion 工作区的 API 密钥
                </p>
              </div>

              <div className="flex justify-end space-x-2 mt-4">
                <button
                  onClick={cancelEdit}
                  className="btn-secondary flex items-center space-x-2"
                >
                  <X className="w-4 h-4" />
                  <span>取消</span>
                </button>
        <button
                  onClick={handleAddNotionServer}
          className="btn-primary flex items-center space-x-2"
                  disabled={!notionIntegrationSecret.trim()}
        >
                  <Save className="w-4 h-4" />
                  <span>添加 Notion 服务器</span>
        </button>
      </div>
            </div>

            {/* 右侧：获取步骤指南 */}
            <div className="lg:col-span-1">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center">
                  <AlertCircle className="w-4 h-4 mr-1" />
                  如何获取 Integration Secret
                </h3>
                <ol className="text-xs text-blue-800 space-y-2">
                  <li className="flex items-start space-x-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center font-medium">1</span>
                    <div>
                      <p className="font-medium">访问 Notion Integrations</p>
                      <a 
                        href="https://www.notion.so/my-integrations" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-700 underline flex items-center mt-1"
                      >
                        打开页面
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    </div>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center font-medium">2</span>
                    <div>
                      <p className="font-medium">创建新的 Integration</p>
                      <p className="text-gray-600 dark:text-gray-400 mt-1">点击 "New integration" 按钮</p>
                    </div>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center font-medium">3</span>
                    <div>
                      <p className="font-medium">配置 Integration</p>
                      <p className="text-gray-600 dark:text-gray-400 mt-1">填写名称，选择工作区</p>
                    </div>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center font-medium">4</span>
                    <div>
                      <p className="font-medium">获取 Secret</p>
                      <p className="text-gray-600 dark:text-gray-400 mt-1">在 "Secrets" 标签页中复制 "Internal Integration Secret"</p>
                    </div>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="flex-shrink-0 w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center font-medium">5</span>
                    <div>
                      <p className="font-medium">授权页面访问</p>
                      <p className="text-gray-600 dark:text-gray-400 mt-1">在需要访问的 Notion 页面中，点击 "..." → "Add connections" → 选择你的 Integration</p>
                    </div>
                  </li>
                </ol>
                
                <div className="mt-4 pt-4 border-t border-blue-200">
                  <p className="text-xs text-blue-700">
                    <strong>提示：</strong>Integration 需要被授权访问特定的 Notion 页面才能使用
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 添加/编辑表单 */}
      {(isAdding || editingId) && (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold mb-3">
            {isAdding ? '添加 MCP 服务器' : '编辑 MCP 服务器'}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                服务器名称 *
              </label>
              <input
                type="text"
                value={newServer.name || ''}
                onChange={(e) => setNewServer(prev => ({ ...prev, name: e.target.value }))}
                className="input-field"
                placeholder="例如: 小红书 MCP"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                服务器 URL *
              </label>
              <input
                type="text"
                value={newServer.url || ''}
                onChange={(e) => setNewServer(prev => ({ ...prev, url: e.target.value }))}
                className="input-field"
                placeholder="例如: http://localhost:18060/mcp"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                服务器类型
              </label>
              <select
                value={newServer.type || 'http-stream'}
                onChange={(e) => setNewServer(prev => ({ ...prev, type: e.target.value as MCPServerConfig['type'] }))}
                className="input-field"
              >
                <option value="http-stream">HTTP Stream</option>
                <option value="http-post">HTTP POST</option>
                <option value="stdio">Stdio</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                状态
              </label>
              <select
                value={newServer.enabled ? 'enabled' : 'disabled'}
                onChange={(e) => setNewServer(prev => ({ ...prev, enabled: e.target.value === 'enabled' }))}
                className="input-field"
              >
                <option value="enabled">启用</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              描述
            </label>
            <textarea
              value={newServer.description || ''}
              onChange={(e) => setNewServer(prev => ({ ...prev, description: e.target.value }))}
              className="input-field"
              rows={3}
              placeholder="服务器功能的简要描述"
            />
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button
              onClick={cancelEdit}
              className="gnome-btn gnome-btn-secondary"
            >
              <X className="w-4 h-4" />
              <span>取消</span>
            </button>
            <button
              onClick={isAdding ? handleAddServer : handleUpdateServer}
              className="gnome-btn gnome-btn-primary"
            >
              <Save className="w-4 h-4" />
              <span>{isAdding ? '添加' : '保存'}</span>
            </button>
          </div>
        </Card>
      )}

      {/* 自定义 MCP 服务器 */}
      <Section 
        title="自定义 MCP 服务器" 
        description="添加和管理您自己的 MCP 服务器"
        className="mb-6"
        headerAction={
          <button
            onClick={() => setIsAdding(true)}
            className="gnome-btn gnome-btn-secondary text-sm"
            disabled={isAdding || editingId !== null || isAddingNotion}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加自定义服务器</span>
          </button>
        }
      >

      {/* 服务器列表 */}
        <div className="space-y-3">
        {loading ? (
            <div className="text-center py-8">
              <div className="w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-[#7c3aed] rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">加载中...</p>
          </div>
        ) : servers.length === 0 ? (
          <EmptyState
            icon={Server}
            title="还没有自定义 MCP 服务器"
            description="例如：xiaohongshu-mcp、custom-api 等"
            action={
              <button
                onClick={() => setIsAdding(true)}
                className="gnome-btn gnome-btn-primary"
              >
                <Plus className="w-4 h-4" />
                <span>添加第一个自定义服务器</span>
              </button>
            }
          />
        ) : (
          servers.map((server) => (
            <div key={server.id} className="bg-white dark:bg-[#363636] border border-gray-200 dark:border-[#505050] rounded-lg p-3 hover:border-gray-300 dark:hover:border-[#606060] hover:shadow-sm transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${server.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {(server as any).display_name || (server as any).client_name || server.name}
                      </h3>
                      {server.ext?.server_type && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                          {server.ext.server_type}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{server.url}</p>
                    {server.description && (
                      <p className="text-xs text-gray-400 mt-1 line-clamp-1">{server.description}</p>
                    )}
                    {/* 如果是 Notion 服务器，显示 client_name 作为额外标识 */}
                    {server.ext?.server_type === 'notion' && server.ext?.client_name && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                        工作空间: {server.ext.client_name}
                      </p>
                    )}
                    {server.ext?.integration_secret && (
                      <p className="text-xs text-gray-400 mt-1 font-mono">
                        Secret: {server.ext.integration_secret.substring(0, 10)}...{server.ext.integration_secret.substring(server.ext.integration_secret.length - 4)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-1 ml-3">
                  {/* 测试连接 */}
                  <button
                    onClick={() => handleTestConnection(server)}
                    disabled={testingServers.has(server.id)}
                    className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded transition-colors flex items-center space-x-1"
                  >
                    {testingServers.has(server.id) ? (
                      <>
                        <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                        <span>测试中</span>
                      </>
                    ) : (
                      <>
                        <Server className="w-3 h-3" />
                        <span>测试</span>
                      </>
                    )}
                  </button>

                  {/* 编辑 */}
                  <button
                    onClick={() => handleEditServer(server.id)}
                    disabled={isAdding || editingId !== null}
                    className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                    title="编辑"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>

                  {/* 删除 */}
                  <button
                    onClick={() => handleDeleteServer(server.id)}
                    className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* 测试结果 */}
              {testResults.has(server.id) && (
                <div className="mt-4 space-y-3">
                  {/* 连接测试结果 */}
                  <div className={`p-3 rounded-lg flex items-center space-x-2 border ${
                    testResults.get(server.id)?.success
                      ? 'ui-status-success'
                      : 'ui-status-error'
                  }`} style={{
                    backgroundColor: testResults.get(server.id)?.success 
                      ? 'var(--color-success-bg)' 
                      : 'var(--color-error-bg)'
                  }}>
                    {testResults.get(server.id)?.success ? (
                      <CheckCircle className="w-5 h-5" style={{ color: 'var(--color-success)' }} />
                    ) : (
                      <AlertCircle className="w-5 h-5" style={{ color: 'var(--color-error)' }} />
                    )}
                    <span className="text-sm" style={{
                      color: testResults.get(server.id)?.success 
                        ? 'var(--color-success)' 
                        : 'var(--color-error)'
                    }}>
                      {testResults.get(server.id)?.message}
                    </span>
                  </div>

                  {/* 获取工具按钮 */}
                  {testResults.get(server.id)?.success && testResults.get(server.id)?.connected && !testResults.get(server.id)?.tools && (
                    <div className="flex justify-center">
                      <button
                        onClick={() => handleFetchTools(server)}
                        disabled={testingServers.has(server.id)}
                        className="btn-primary text-sm flex items-center space-x-2"
                      >
                        {testingServers.has(server.id) ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>获取中...</span>
                          </>
                        ) : (
                          <>
                            <Wrench className="w-4 h-4" />
                            <span>获取工具列表</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* 工具列表 */}
                  {testResults.get(server.id)?.success && testResults.get(server.id)?.tools && testResults.get(server.id)!.tools!.length > 0 && (
                    <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                      <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2 flex items-center">
                        <Wrench className="w-4 h-4 mr-1" />
                        可用工具 ({testResults.get(server.id)?.tools?.length})
                      </h4>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {testResults.get(server.id)?.tools?.map((tool, index) => (
                          <div key={index} className="bg-white dark:bg-[#2d2d2d] rounded border border-gray-200 dark:border-[#404040] p-2">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h5 className="text-sm font-medium text-gray-900 dark:text-gray-100">{tool.name}</h5>
                                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{tool.description}</p>
                                {tool.inputSchema?.properties && (
                                  <div className="mt-2">
                                    <p className="text-xs text-gray-500 dark:text-gray-400">参数:</p>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {Object.keys(tool.inputSchema.properties).map((param) => (
                                        <span key={param} className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1 rounded">
                                          {param}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        </div>
      </Section>

      {/* 使用说明 */}
      <div className="mt-8 space-y-4">
        <Alert variant="info" title="使用说明">
          <ul className="space-y-1.5 text-sm">
            <li>• MCP (Model Context Protocol) 允许 LLM 模型调用外部工具和服务</li>
            <li>• 配置通过后端统一管理，支持 Electron 动态添加 MCP 服务器</li>
            <li>• 在 Electron 环境中自动使用后端代理，解决 CORS 跨域问题</li>
            <li>• 在浏览器环境中直接连接到 MCP 服务器（需要服务器支持 CORS）</li>
            <li>• 配置的服务器将在工作流页面中可用</li>
            <li>• 确保 MCP 服务器正在运行并可从此应用访问</li>
            <li>• 可以使用"测试连接"功能验证服务器是否正常工作</li>
          </ul>
        </Alert>

        <Alert variant="success" title="协议版本更新">
          <ul className="space-y-1.5 text-sm">
            <li>• 已升级到最新的 MCP 协议版本 2025-06-18（兼容 2025-03-26）</li>
            <li>• 修复了之前的协议版本错误（HTTP 400: Invalid MCP-Protocol-Version）</li>
            <li>• 所有 MCP 请求现在使用最新的协议标准</li>
          </ul>
        </Alert>
      </div>

      {/* Notion 工作空间选择对话框 */}
      {showWorkspaceSelection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  选择 Notion 工作空间
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  选择已有工作空间进行连接或重新授权
                </p>
              </div>
              <button
                onClick={() => setShowWorkspaceSelection(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
              {notionRegistrations.map((registration) => {
                // 检查是否已有对应的服务器配置
                const existingServer = servers.find(s => 
                  s.ext?.server_type === 'notion' && 
                  s.ext?.client_id === registration.client_id
                );
                
                return (
                  <div
                    key={registration.id}
                    className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <div className="font-medium text-gray-900 dark:text-gray-100">
                            {registration.client_name}
                          </div>
                          {existingServer && (
                            <span className="ui-session-active">已连接</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          注册时间: {registration.created_at ? new Date(registration.created_at).toLocaleString('zh-CN') : '未知'}
                        </div>
                        {existingServer && (
                          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                            点击可重新授权
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleUseExistingWorkspace(registration)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
                      >
                        {existingServer ? '重新授权' : '连接'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  setShowWorkspaceSelection(false);
                  setShowRegistrationForm(true);
                }}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded transition-colors"
              >
                注册新工作空间
              </button>
              <button
                onClick={() => setShowWorkspaceSelection(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium rounded transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notion 注册表单对话框 */}
      {showRegistrationForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                注册新的 Notion 工作空间
              </h3>
              <button
                onClick={() => {
                  setShowRegistrationForm(false);
                  setRegistrationFormData({ client_name: '', redirect_uri_base: 'http://localhost:3002' });
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Client Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={registrationFormData.client_name}
                  onChange={(e) => setRegistrationFormData({ ...registrationFormData, client_name: e.target.value })}
                  placeholder="例如: my-notion-workspace"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  只能包含英文、数字、下划线和连字符
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Redirect URI Base (可选)
                </label>
                <input
                  type="text"
                  value={registrationFormData.redirect_uri_base}
                  onChange={(e) => setRegistrationFormData({ ...registrationFormData, redirect_uri_base: e.target.value })}
                  placeholder="http://localhost:3002"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  回调地址基础部分，默认: http://localhost:3002
                </p>
              </div>
            </div>
            
            <div className="flex space-x-2 mt-6">
              <button
                onClick={handleRegisterNotion}
                disabled={isRegistering || !registrationFormData.client_name.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded transition-colors"
              >
                {isRegistering ? '注册中...' : '注册并连接'}
              </button>
              <button
                onClick={() => {
                  setShowRegistrationForm(false);
                  setRegistrationFormData({ client_name: '', redirect_uri_base: 'http://localhost:3002' });
                }}
                disabled={isRegistering}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-900 dark:text-gray-100 font-medium rounded transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
};

export default MCPConfig;
