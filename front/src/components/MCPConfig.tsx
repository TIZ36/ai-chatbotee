/**
 * MCP 服务器配置组件
 * 允许用户添加、编辑、删除 MCP 服务器配置
 */

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Save, X, Server, AlertCircle, CheckCircle, Wrench, ExternalLink, Plug, RefreshCcw, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import PageLayout, { Card, Section, Alert, EmptyState } from './ui/PageLayout';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { InputField, TextareaField, FormFieldGroup } from './ui/FormField';
import { toast } from './ui/use-toast';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from './ui/Select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { MCPTool, MCPClient } from '../services/mcpClient';
import { 
  getMCPServers, 
  createMCPServer, 
  updateMCPServer, 
  deleteMCPServer, 
  MCPServerConfig,
  getMCPMarketSources,
  syncMCPMarketSource,
  searchMCPMarket,
  installMCPMarketItem,
  MCPMarketSource,
  MCPMarketItemSummary,
  discoverMCPOAuth,
  authorizeMCPOAuth,
  registerNotionClient,
  getNotionRegistrations,
  deleteNotionRegistration,
  NotionRegistration,
} from '../services/mcpApi';
import { getBackendUrl } from '../utils/backendUrl';

interface MCPConfigProps {}

// Helper: 根据服务器类型渲染图标
const renderServerIcon = (server: MCPServerConfig, size: 'sm' | 'lg' = 'sm') => {
  const isNotion = (server as any).ext?.server_type === 'notion';
  
  if (isNotion) {
    // Notion 服务器显示 Notion 图标（使用完整的双层 path 实现主题适配）
    if (size === 'lg') {
      return (
        <div className="w-20 h-20 rounded-2xl bg-transparent flex items-center justify-center shadow-lg">
          <svg className="w-14 h-14" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" className="fill-white dark:fill-[#363636]"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.724 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z" className="fill-black dark:fill-gray-100"/>
          </svg>
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-lg bg-transparent flex items-center justify-center border border-gray-200 dark:border-gray-700">
        <svg className="w-6 h-6" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" className="fill-white dark:fill-[#363636]"/>
          <path fillRule="evenodd" clipRule="evenodd" d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.724 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z" className="fill-black dark:fill-gray-100"/>
        </svg>
      </div>
    );
  }
  
  // 其他服务器显示首字母
  if (size === 'lg') {
    return (
      <div className="w-20 h-20 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-4xl font-bold shadow-lg shadow-blue-500/20">
        {server.name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 font-bold text-lg border border-blue-100 dark:border-blue-800">
      {server.name.charAt(0).toUpperCase()}
    </div>
  );
};

const MCPConfig: React.FC<MCPConfigProps> = () => {
  // MCP 服务器列表
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MCPServerConfig | null>(null);
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
    workspace_alias: '',  // 新增：工作空间别名（全局唯一）
    redirect_uri_base: getBackendUrl(),
  });
  const [isRegistering, setIsRegistering] = useState(false);

  // 测试连接状态
  const [testingServers, setTestingServers] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Map<string, { success: boolean; message: string; tools?: MCPTool[]; connected?: boolean }>>(new Map());

  // 已连接的客户端实例
  const [connectedClients, setConnectedClients] = useState<Map<string, MCPClient>>(new Map());

  // 市场（Market）状态
  const [marketSources, setMarketSources] = useState<MCPMarketSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [marketQuery, setMarketQuery] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketSyncing, setMarketSyncing] = useState(false);
  const [marketItems, setMarketItems] = useState<MCPMarketItemSummary[]>([]);
  const [marketTotal, setMarketTotal] = useState(0);
  const [showMarketModal, setShowMarketModal] = useState(false);

  // 新增：UI 状态
  const [selectedServerForDetail, setSelectedServerForDetail] = useState<MCPServerConfig | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showToolsInDetail, setShowToolsInDetail] = useState(false);

  // MCP OAuth 二维码弹窗：授权 URL 生成后展示二维码，用户可扫码或在浏览器中打开
  const [oauthQrDialogOpen, setOauthQrDialogOpen] = useState(false);
  const [oauthQrDataUrl, setOauthQrDataUrl] = useState<string | null>(null);
  const [oauthAuthorizationUrl, setOauthAuthorizationUrl] = useState<string | null>(null);
  const [oauthAuthorizeResult, setOauthAuthorizeResult] = useState<{ authorization_url: string; client_id: string; state: string } | null>(null);

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

  // 加载市场源
  useEffect(() => {
    (async () => {
      try {
        const sources = await getMCPMarketSources();
        setMarketSources(sources);
        if (sources.length > 0) {
          setSelectedSourceId(sources[0].source_id);
        }
      } catch (e) {
        // 市场 API 不可用不影响主功能
        console.warn('[MCP Market] Failed to load sources:', e);
      }
    })();
  }, []);

  const handleMarketSync = async () => {
    if (!selectedSourceId) {
      toast({ title: '请先选择一个市场源', variant: 'destructive' });
      return;
    }
    setMarketSyncing(true);
    try {
      const res = await syncMCPMarketSource(selectedSourceId, true);
      toast({
        title: '同步完成',
        description: `新增 ${res.inserted || 0}，更新 ${res.updated || 0}，总计 ${res.count || 0}`,
        variant: 'success',
      });
      // 同步完成后自动触发搜索，显示更新后的内容
      void handleMarketSearch();
      // 重新加载市场源以更新最后同步时间
      const sources = await getMCPMarketSources();
      setMarketSources(sources);
    } catch (e: any) {
      toast({
        title: '同步失败',
        description: e?.message || String(e),
        variant: 'destructive',
      });
    } finally {
      setMarketSyncing(false);
    }
  };

  const handleMarketSearch = async () => {
    setMarketLoading(true);
    try {
      const res = await searchMCPMarket({
        q: marketQuery.trim(),
        source_id: selectedSourceId || undefined,
        runtime_type: 'local_stdio',
        limit: 50,
        offset: 0,
      });
      setMarketItems(res.items || []);
      setMarketTotal(res.total || 0);
    } catch (e: any) {
      toast({
        title: '搜索失败',
        description: e?.message || String(e),
        variant: 'destructive',
      });
    } finally {
      setMarketLoading(false);
    }
  };

  const handleMarketInstall = async (item: MCPMarketItemSummary) => {
    try {
      const res = await installMCPMarketItem(item.item_id, {
        name: item.name,
      });
      toast({
        title: '已安装',
        description: `已创建服务器：${res.server_id}`,
        variant: 'success',
      });
      await loadServers();
    } catch (e: any) {
      toast({
        title: '安装失败',
        description: e?.message || String(e),
        variant: 'destructive',
      });
    }
  };

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
      toast({ title: '名称和 URL 都是必需的', variant: 'destructive' });
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
      toast({ title: 'MCP 服务器已添加', variant: 'success' });
    } catch (error) {
      console.error('Failed to create MCP server:', error);
      toast({
        title: '创建服务器失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // Electron 已移除，stdio MCP 暂不支持

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

    if (!registrationFormData.workspace_alias.trim()) {
      alert('请输入工作空间别名（Workspace Alias）');
      return;
    }

    // 验证 client_name：只允许英文、数字、下划线、连字符
    const clientNamePattern = /^[a-zA-Z0-9_-]+$/;
    if (!clientNamePattern.test(registrationFormData.client_name)) {
      alert('客户端名称只能包含英文、数字、下划线和连字符');
      return;
    }

    // 验证 workspace_alias：只允许英文、数字、下划线、连字符
    const workspaceAliasPattern = /^[a-zA-Z0-9_-]+$/;
    if (!workspaceAliasPattern.test(registrationFormData.workspace_alias)) {
      alert('工作空间别名只能包含英文、数字、下划线和连字符');
      return;
    }

    setIsRegistering(true);
    try {
      const result = await registerNotionClient({
        client_name: registrationFormData.client_name.trim(),
        workspace_alias: registrationFormData.workspace_alias.trim(),
        redirect_uri_base: registrationFormData.redirect_uri_base.trim() || getBackendUrl(),
      });

      console.log('[Notion] Registration successful:', result);
      console.log('[Notion] Workspace Alias:', result.workspace_alias);
      console.log('[Notion] Short Hash:', result.short_hash);
      console.log('[Notion] Dynamic Redirect URI:', result.redirect_uri);
      
      // 重新加载注册列表
      await loadNotionRegistrations();
      
      // 关闭注册表单，使用新注册的 client_id 进行 OAuth 授权
      setShowRegistrationForm(false);
      setRegistrationFormData({ client_name: '', workspace_alias: '', redirect_uri_base: getBackendUrl() });
      
      // 使用新注册的 client_id 进行 OAuth 授权
      await performNotionOAuth(result.client_id);
    } catch (error) {
      console.error('[Notion] Registration failed:', error);
      alert('注册失败: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsRegistering(false);
    }
  };

  // 处理删除 Notion 工作空间注册
  const handleDeleteNotionRegistration = async (registration: NotionRegistration, event: React.MouseEvent) => {
    // 阻止事件冒泡，防止触发父级的点击事件（连接工作空间）
    event.stopPropagation();
    
    const confirmMessage = `确定要删除工作空间 "${registration.client_name}" 吗？\n\n这将删除注册信息和相关的访问令牌。`;
    
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      console.log(`[Notion] Deleting registration: ${registration.id}`);
      const result = await deleteNotionRegistration(registration.id);
      console.log('[Notion] Delete result:', result);
      
      toast({
        title: '删除成功',
        description: result.message || `工作空间 "${registration.client_name}" 已删除`,
        variant: 'success',
      });
      
      // 重新加载注册列表
      await loadNotionRegistrations();
    } catch (error) {
      console.error('[Notion] Delete failed:', error);
      toast({
        title: '删除失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
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
      console.log('[Notion OAuth] Callback URL:', `${getBackendUrl()}/mcp/oauth/callback`);

      // 3. 生成二维码并在前端弹窗中展示，用户可扫码或在浏览器中打开
      try {
        const qrDataUrl = await QRCode.toDataURL(authorizeResult.authorization_url, { width: 260, margin: 2 });
        setOauthQrDataUrl(qrDataUrl);
        setOauthAuthorizationUrl(authorizeResult.authorization_url);
        setOauthAuthorizeResult(authorizeResult);
        setOauthQrDialogOpen(true);
      } catch (qrErr) {
        console.warn('[Notion OAuth] QR code generation failed, falling back to browser only:', qrErr);
        setOauthAuthorizationUrl(authorizeResult.authorization_url);
        setOauthAuthorizeResult(authorizeResult);
        setOauthQrDialogOpen(true);
      }

      // 轮询检查后端是否已完成 token 交换
      try {
        console.log('[Notion OAuth] Polling for token completion...');
        const maxAttempts = 60; // 最多等待60秒
        const pollInterval = 1000; // 每秒检查一次
        let tokenExchangeCompleted = false;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          
          // 检查后端是否已完成 token 交换
          // 通过尝试创建服务器配置来验证 token 是否已保存
          try {
            // 先检查是否已有对应工作空间（按 client_id 匹配）的服务器配置
            const existingServers = await getMCPServers();
            const registration = notionRegistrations.find(r => r.client_id === authorizeResult.client_id);
            const workspaceName = registration?.client_name || 'Notion';

            const existingServer =
              existingServers.find(
                s => s.ext?.server_type === 'notion' && s.ext?.client_id === authorizeResult.client_id
              ) ||
              existingServers.find(
                s =>
                  s.url === mcpUrl &&
                  s.ext?.server_type === 'notion' &&
                  (!s.ext?.client_id || s.ext?.client_id === '')
              );
            
            if (existingServer) {
              // 如果服务器已存在，更新它（写回工作空间名 + client_id）
              console.log('[Notion OAuth] Server config already exists, updating...');
              await updateMCPServer(existingServer.id, {
                name: workspaceName,
                display_name: workspaceName,
                client_name: workspaceName,
                description: `Notion MCP Server - ${workspaceName}`,
                ext: {
                  ...existingServer.ext,
                  server_type: 'notion',
                  client_id: authorizeResult.client_id,
                  client_name: workspaceName,
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
            setOauthQrDialogOpen(false);
            setOauthQrDataUrl(null);
            setOauthAuthorizationUrl(null);
            setOauthAuthorizeResult(null);
            setNotionAuthState('authenticated');
            setShowWorkspaceSelection(false);
            setShowRegistrationForm(false);
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
        setOauthQrDialogOpen(false);
        setOauthQrDataUrl(null);
        setOauthAuthorizationUrl(null);
        setOauthAuthorizeResult(null);
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
      setOauthQrDialogOpen(false);
      setOauthQrDataUrl(null);
      setOauthAuthorizationUrl(null);
      setOauthAuthorizeResult(null);
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
        display_name: displayName,
        client_name: displayName,
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
      toast({
        title: '请输入 Notion Internal Integration Secret',
        variant: 'destructive',
      });
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
      toast({ title: 'Notion MCP 服务器添加成功', variant: 'success' });
    } catch (error) {
      console.error('Failed to create Notion MCP server:', error);
      toast({
        title: '创建 Notion 服务器失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
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
      toast({ title: '名称和 URL 都是必需的', variant: 'destructive' });
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
      toast({ title: 'MCP 服务器已保存', variant: 'success' });
    } catch (error) {
      console.error('Failed to update MCP server:', error);
      toast({
        title: '更新服务器失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    try {
      await deleteMCPServer(serverId);
      await loadServers(); // 重新加载列表
      setTestResults(prev => {
        const newResults = new Map(prev);
        newResults.delete(serverId);
        return newResults;
      });
      toast({ title: 'MCP 服务器已删除', variant: 'success' });
    } catch (error) {
      console.error('Failed to delete MCP server:', error);
      toast({
        title: '删除服务器失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleTestConnection = async (server: MCPServerConfig) => {
    setTestingServers(prev => new Set(prev).add(server.id));

    try {
      console.log(`[MCP Config] Testing connection to ${server.name} (${server.url})`);
      console.log(`[MCP Config] Server metadata:`, JSON.stringify(server.metadata, null, 2));

      // stdio MCP 不支持（需要 Electron 或后端实现）
      if (server.type === 'stdio') {
        throw new Error('stdio MCP 暂不支持，请使用 HTTP 方式的 MCP 服务器');
      }
      
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
      console.log(`[MCP Config] Server not connected, testing first...`);
      await handleTestConnection(server);
      // 测试完后重新获取状态
      const newResult = testResults.get(server.id);
      const newClient = connectedClients.get(server.id);
      if (!newResult?.connected || !newClient) {
        toast({ title: '连接失败，无法获取工具', variant: 'destructive' });
        return;
      }
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

  const handleViewDetail = (server: MCPServerConfig) => {
    setSelectedServerForDetail(server);
    setShowDetailModal(true);
    setShowToolsInDetail(false);
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
    <div className="flex flex-col h-full">
      {/* Admin 风格头部 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#2d2d2d]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Plug className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">MCP 管理</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowMarketModal(true)}
            className="flex items-center gap-2 border-gray-300 dark:border-gray-600"
          >
            <Plug className="w-4 h-4" />
            <span>市场</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              cancelEdit();
              setIsAdding(true);
            }}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>新增自定义</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          <div
            className="p-4 bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-gray-800 rounded-xl hover:border-blue-400 transition-all cursor-pointer flex items-center justify-between shadow-sm"
            onClick={() => {
              // 需求：始终可点，点击后先进入工作区注册/选择
              cancelEdit();
              handleNotionOAuthConnect();
            }}
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-transparent rounded-lg flex items-center justify-center">
                <svg className="w-8 h-8" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" className="fill-white dark:fill-[#363636]"/>
                  <path fillRule="evenodd" clipRule="evenodd" d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.724 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z" className="fill-black dark:fill-gray-100"/>
                </svg>
              </div>
              <div>
                <div className="font-bold text-gray-900 dark:text-gray-100">Notion</div>
                <div className="text-xs text-gray-500">官方推荐 · 录入 Notion 工作区</div>
              </div>
            </div>
            <div className="text-xs font-medium text-blue-600">点击录入</div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">服务器 ({servers.length})</h2>
          </div>
            
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-gray-500">加载中...</p>
              </div>
            ) : servers.length === 0 ? (
              <div className="text-center py-20 bg-gray-50 dark:bg-gray-800/30 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800">
                <Server className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">暂无服务器</p>
                <Button variant="link" onClick={() => setShowMarketModal(true)} className="mt-2">去市场看看</Button>
              </div>
            ) : (
              <div className="bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
                      <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">服务器</th>
                      <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">类型</th>
                      <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">状态</th>
                      <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {servers.map((server) => (
                      <tr 
                        key={server.id} 
                        className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors cursor-pointer group"
                        onClick={() => handleViewDetail(server)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {renderServerIcon(server, 'sm')}
                            <div>
                              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                {(server as any).display_name || (server as any).client_name || server.name}
                              </div>
                              <div className="text-xs text-gray-500 truncate max-w-[200px]">{server.url}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 uppercase">
                            {server.type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2 h-2 rounded-full ${server.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                            <span className="text-xs text-gray-600 dark:text-gray-400">{server.enabled ? '已启用' : '已禁用'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTestConnection(server);
                              }}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md"
                              title="测试连接"
                            >
                              <RefreshCcw className={`w-4 h-4 ${testingServers.has(server.id) ? 'animate-spin' : ''}`} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditServer(server.id);
                              }}
                              className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-md"
                              title="编辑"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(server);
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>

      {/* 新增/编辑自定义服务器弹框 */}
      <Dialog
        open={Boolean(isAdding || editingId)}
        onOpenChange={(open) => {
          if (!open) cancelEdit();
        }}
      >
        <DialogContent className="max-w-2xl bg-white dark:bg-[#1e1e1e] border-gray-200 dark:border-gray-800">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑服务器' : '新增服务器'}</DialogTitle>
            <DialogDescription>填写 MCP 服务器的名称、地址与类型</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <InputField
                label="名称"
                required
                inputProps={{
                  id: 'mcp-server-name',
                  value: newServer.name || '',
                  onChange: (e) => setNewServer(prev => ({ ...prev, name: e.target.value })),
                  placeholder: '例如: my-mcp-server',
                }}
              />
              <InputField
                label="URL"
                required
                inputProps={{
                  id: 'mcp-server-url',
                  value: newServer.url || '',
                  onChange: (e) => setNewServer(prev => ({ ...prev, url: e.target.value })),
                  placeholder: 'http://localhost:8080/mcp',
                }}
              />
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">类型</label>
                <Select
                  value={newServer.type || 'http-stream'}
                  onValueChange={(v) => setNewServer(prev => ({ ...prev, type: v as any }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http-stream">HTTP Stream</SelectItem>
                    <SelectItem value="http-post">HTTP POST</SelectItem>
                    <SelectItem value="stdio">Stdio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <TextareaField
                label="描述"
                textareaProps={{
                  id: 'mcp-server-description',
                  value: newServer.description || '',
                  onChange: (e) => setNewServer(prev => ({ ...prev, description: e.target.value })),
                  placeholder: '可选描述...',
                  rows: 3,
                }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={cancelEdit}>取消</Button>
            <Button variant="primary" onClick={editingId ? handleUpdateServer : handleAddServer}>
              {editingId ? '保存修改' : '立即创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 服务器详情弹窗 (明信片样式) */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-white dark:bg-[#1e1e1e] border-none shadow-2xl">
          {selectedServerForDetail && (
            <div className="flex h-[600px]">
              {/* 左侧：详情 (明信片正面) */}
              <div className="flex-1 p-8 flex flex-col border-r border-gray-100 dark:border-gray-800">
                <div className="flex items-start justify-between mb-8">
                  {renderServerIcon(selectedServerForDetail, 'lg')}
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Server ID</div>
                    <div className="text-xs font-mono text-gray-500">{selectedServerForDetail.id.substring(0, 8)}...</div>
                  </div>
                </div>

                <div className="flex-1">
                  <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                    {(selectedServerForDetail as any).display_name || (selectedServerForDetail as any).client_name || selectedServerForDetail.name}
                  </h2>
                  <div className="flex items-center gap-2 mb-6">
                    <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold rounded uppercase">
                      {selectedServerForDetail.type}
                    </span>
                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${selectedServerForDetail.enabled ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${selectedServerForDetail.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {selectedServerForDetail.enabled ? 'Active' : 'Disabled'}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Endpoint URL</h4>
                      <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800 font-mono text-xs break-all text-gray-600 dark:text-gray-400">
                        {selectedServerForDetail.url}
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Description</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                        {selectedServerForDetail.description || 'No description provided for this server.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-auto pt-8 flex items-center justify-between border-t border-gray-50 dark:border-gray-800">
                  <div className="flex gap-2">
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      onClick={() => handleTestConnection(selectedServerForDetail)}
                      disabled={testingServers.has(selectedServerForDetail.id)}
                    >
                      <RefreshCcw className={`w-4 h-4 mr-2 ${testingServers.has(selectedServerForDetail.id) ? 'animate-spin' : ''}`} />
                      测试连接
                    </Button>
                  </div>
                  <Button 
                    variant="primary" 
                    size="sm"
                    onClick={() => {
                      setShowToolsInDetail(true);
                      handleFetchTools(selectedServerForDetail);
                    }}
                  >
                    获取工具列表
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>

              {/* 右侧：工具列表 (明信片背面/详情页) */}
              <div className={`w-[380px] bg-gray-50 dark:bg-[#1a1a1a] transition-all duration-500 border-l border-gray-100 dark:border-gray-800 flex flex-col ${showToolsInDetail ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}>
                <div className="p-6 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-[#1e1e1e]">
                  <h3 className="font-bold flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-blue-600" />
                    可用工具
                  </h3>
                  <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full text-gray-500">
                    {testResults.get(selectedServerForDetail.id)?.tools?.length || 0}
                  </span>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {testingServers.has(selectedServerForDetail.id) ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-2" />
                      <span className="text-xs">正在获取工具...</span>
                    </div>
                  ) : testResults.get(selectedServerForDetail.id)?.tools ? (
                    testResults.get(selectedServerForDetail.id)!.tools!.map((tool, idx) => (
                      <div key={idx} className="p-4 bg-white dark:bg-[#2d2d2d] rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow">
                        <div className="font-bold text-sm text-gray-900 dark:text-gray-100 mb-1">{tool.name}</div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">{tool.description}</p>
                        
                        {tool.inputSchema?.properties && (
                          <div className="space-y-1.5">
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Parameters</div>
                            <div className="flex flex-wrap gap-1.5">
                              {Object.entries(tool.inputSchema.properties).map(([name, schema]: [string, any]) => (
                                <div key={name} className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-50 dark:bg-gray-800 rounded border border-gray-100 dark:border-gray-700">
                                  <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400">{name}</span>
                                  <span className="text-[9px] text-gray-400">({schema.type || 'any'})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 text-center px-8">
                      <Wrench className="w-12 h-12 mb-4 opacity-20" />
                      <p className="text-xs">点击左侧“获取工具列表”按钮来查看此服务器提供的功能</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 市场弹窗 (重新设计) */}
      <Dialog open={showMarketModal} onOpenChange={setShowMarketModal}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden bg-white dark:bg-[#1e1e1e] border-none shadow-2xl">
          <div className="flex flex-col h-[700px]">
            {/* 市场头部 */}
            <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white">
                    <Plug className="w-6 h-6" />
                  </div>
                  MCP 市场
                </h2>
                <p className="text-sm text-gray-500 mt-1">发现并安装官方及社区提供的 MCP 服务器</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <input
                    type="text"
                    value={marketQuery}
                    onChange={(e) => setMarketQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleMarketSearch()}
                    placeholder="搜索服务器..."
                    className="w-64 pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                  <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                  </svg>
                </div>
                <Button variant="primary" size="sm" onClick={handleMarketSearch} disabled={marketLoading}>
                  {marketLoading ? <RefreshCcw className="w-4 h-4 animate-spin" /> : '搜索'}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              {/* 搜索结果 */}
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
                  {marketQuery ? `搜索结果 (${marketItems.length})` : '全部服务器'}
                </h3>
                
                {marketLoading ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-gray-500">正在检索市场数据...</p>
                  </div>
                ) : marketItems.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {marketItems.map((item) => (
                      <div 
                        key={item.item_id} 
                        className="p-4 bg-white dark:bg-[#2d2d2d] border border-gray-100 dark:border-gray-800 rounded-2xl hover:border-blue-400 hover:shadow-xl hover:shadow-blue-500/5 transition-all group cursor-pointer"
                        onClick={() => handleMarketInstall(item)}
                      >
                        <div className="w-12 h-12 bg-gray-50 dark:bg-gray-800 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
                          <div className="text-xl font-bold text-gray-400 group-hover:text-blue-600">
                            {item.name.charAt(0).toUpperCase()}
                          </div>
                        </div>
                        <div className="font-bold text-sm text-gray-900 dark:text-gray-100 mb-1 truncate">{item.name}</div>
                        <p className="text-[10px] text-gray-500 line-clamp-2 h-7 mb-4">{item.description || 'No description'}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-400 uppercase">{item.runtime_type}</span>
                          <Plus className="w-4 h-4 text-gray-300 group-hover:text-blue-600 transition-colors" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-20">
                    <EmptyState icon={Plug} title="未找到服务器" description="尝试更换关键词搜索" />
                  </div>
                )}
              </div>
            </div>
            
            <div className="px-8 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50 dark:bg-gray-800/30">
              <div className="text-xs text-gray-400">
                数据源: {marketSources.find(s => s.source_id === selectedSourceId)?.display_name || '默认'}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setShowMarketModal(false)}>关闭</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Notion 工作区：选择/注册（Dialog） */}
      <Dialog
        open={showWorkspaceSelection || showRegistrationForm}
        onOpenChange={(open) => {
          if (open) return;
          if (isRegistering || notionAuthState === 'authenticating') return;
          setShowWorkspaceSelection(false);
          setShowRegistrationForm(false);
        }}
      >
        <DialogContent className="max-w-md bg-white dark:bg-[#1e1e1e] border-gray-100 dark:border-gray-800">
          {showWorkspaceSelection ? (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <DialogTitle>选择 Notion 工作空间</DialogTitle>
                    <DialogDescription>选择已有工作空间进行连接</DialogDescription>
                  </div>
                  <button
                    onClick={() => {
                      if (isRegistering || notionAuthState === 'authenticating') return;
                      setShowWorkspaceSelection(false);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                    disabled={isRegistering || notionAuthState === 'authenticating'}
                    aria-label="关闭"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </DialogHeader>

              <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                {notionRegistrations.map((registration) => (
                  <div
                    key={registration.id}
                    className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all cursor-pointer group flex items-center justify-between"
                    onClick={() => handleUseExistingWorkspace(registration)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-transparent rounded-lg flex items-center justify-center">
                        <svg className="w-6 h-6" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" className="fill-white dark:fill-[#363636]"/>
                          <path fillRule="evenodd" clipRule="evenodd" d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.724 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z" className="fill-black dark:fill-gray-100"/>
                        </svg>
                      </div>
                      <div>
                        <div className="font-bold text-sm">{registration.client_name}</div>
                        <div className="text-[10px] text-gray-400">ID: {registration.client_id.substring(0, 8)}...</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUseExistingWorkspace(registration);
                        }}
                      >
                        连接
                      </Button>
                      <button
                        onClick={(e) => handleDeleteNotionRegistration(registration, e)}
                        className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                        title="删除工作空间"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 mt-6">
                <Button
                  variant="primary"
                  onClick={() => {
                    setShowWorkspaceSelection(false);
                    setShowRegistrationForm(true);
                  }}
                >
                  注册新工作空间
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (isRegistering || notionAuthState === 'authenticating') return;
                    setShowWorkspaceSelection(false);
                  }}
                >
                  取消
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between gap-3">
                  <DialogTitle>注册 Notion 工作空间</DialogTitle>
                  <button
                    onClick={() => {
                      if (isRegistering || notionAuthState === 'authenticating') return;
                      setShowRegistrationForm(false);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                    disabled={isRegistering || notionAuthState === 'authenticating'}
                    aria-label="关闭"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </DialogHeader>

              <div className="space-y-5">
                <InputField
                  label="Client Name"
                  required
                  inputProps={{
                    id: 'notion-client-name',
                    value: registrationFormData.client_name,
                    onChange: (e) =>
                      setRegistrationFormData({ ...registrationFormData, client_name: e.target.value }),
                    placeholder: '例如: my-notion-workspace',
                  }}
                />
                <InputField
                  label="Workspace Alias (工作空间别名)"
                  required
                  description="全局唯一标识，用于区分不同的Notion工作空间。只能包含英文、数字、下划线和连字符。"
                  inputProps={{
                    id: 'notion-workspace-alias',
                    value: registrationFormData.workspace_alias,
                    onChange: (e) =>
                      setRegistrationFormData({ ...registrationFormData, workspace_alias: e.target.value }),
                    placeholder: '例如: workspace-1',
                  }}
                />
                <InputField
                  label="Redirect URI Base"
                  inputProps={{
                    id: 'notion-redirect-uri-base',
                    value: registrationFormData.redirect_uri_base,
                    onChange: (e) =>
                      setRegistrationFormData({ ...registrationFormData, redirect_uri_base: e.target.value }),
                    placeholder: getBackendUrl(),
                  }}
                />
              </div>

              <div className="flex flex-col gap-3 mt-8">
                <Button
                  variant="primary"
                  onClick={handleRegisterNotion}
                  disabled={isRegistering || !registrationFormData.client_name.trim() || !registrationFormData.workspace_alias.trim()}
                >
                  {isRegistering ? '正在注册...' : '注册并开始授权'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (isRegistering || notionAuthState === 'authenticating') return;
                    setShowRegistrationForm(false);
                  }}
                >
                  取消
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* MCP OAuth 二维码弹窗：展示授权二维码，用户可扫码或在浏览器中打开 */}
      <Dialog
        open={oauthQrDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setOauthQrDialogOpen(false);
            setOauthQrDataUrl(null);
            setOauthAuthorizationUrl(null);
            setOauthAuthorizeResult(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5" />
              MCP 授权
            </DialogTitle>
            <DialogDescription>
              使用手机扫描下方二维码完成授权，或点击「在浏览器中打开」在电脑上完成。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {oauthQrDataUrl ? (
              <div className="rounded-lg border border-gray-200 dark:border-[#404040] p-2 bg-white dark:bg-[#262626]">
                <img src={oauthQrDataUrl} alt="扫码授权" className="w-[260px] h-[260px]" />
              </div>
            ) : (
              <div className="w-[260px] h-[260px] rounded-lg border border-gray-200 dark:border-[#404040] flex items-center justify-center bg-gray-50 dark:bg-[#262626] text-sm text-gray-500">
                加载中…
              </div>
            )}
            {oauthAuthorizationUrl && (
              <Button
                variant="primary"
                className="w-full"
                onClick={() => {
                  if (typeof window === 'undefined') return;
                  const url = oauthAuthorizationUrl;
                  window.open(url, 'MCP Authorization', 'width=600,height=700,scrollbars=yes,resizable=yes');
                }}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                在浏览器中打开
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOauthQrDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="删除服务器"
        description={`确定要删除「${deleteTarget?.name}」吗？此操作不可撤销。`}
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const id = deleteTarget.id;
          setDeleteTarget(null);
          await handleDeleteServer(id);
        }}
      />
    </div>
  );
};

export default MCPConfig;
