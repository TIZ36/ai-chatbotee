/**
 * 系统状态监控面板
 * 显示后端服务、LLM Provider、MCP 服务器的实时状态
 */

import React, { useEffect, useState, useCallback } from 'react';
import { 
  Activity, Server, Brain, Plug, Database, 
  RefreshCw, Cpu
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card, Badge } from './ui/PageLayout';
import { getBackendUrl } from '../utils/backendUrl';

// ============================================================================
// 类型定义
// ============================================================================

interface ServiceStatus {
  name: string;
  status: 'online' | 'offline' | 'checking' | 'warning';
  latency?: number;
  message?: string;
  lastCheck?: Date;
}

interface LLMProviderStatus {
  config_id: string;
  name: string;
  provider: string;
  enabled: boolean;
  has_api_key: boolean;
  status: 'ready' | 'no_key' | 'disabled';
}

interface MCPServerStatus {
  server_id: string;
  name: string;
  url: string;
  enabled: boolean;
  healthy: boolean;
  latency_ms?: number;
  error?: string;
}

// ============================================================================
// 状态指示器组件
// ============================================================================

const StatusIndicator: React.FC<{ status: string }> = ({ status }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'online':
      case 'ready':
      case 'healthy':
        return 'bg-green-500';
      case 'offline':
      case 'error':
        return 'bg-red-500';
      case 'checking':
        return 'bg-yellow-500 animate-pulse';
      case 'warning':
      case 'no_key':
        return 'bg-yellow-500';
      case 'disabled':
        return 'bg-gray-400';
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <span className={`inline-block w-2 h-2 rounded-full ${getStatusColor()}`} />
  );
};

// ============================================================================
// 服务卡片组件
// ============================================================================

interface ServiceCardProps {
  icon: React.ReactNode;
  title: string;
  status: ServiceStatus;
  onRefresh?: () => void;
}

const ServiceCard: React.FC<ServiceCardProps> = ({ icon, title, status, onRefresh }) => {
  return (
    <div className="flex items-center justify-between p-3 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)]">
      <div className="flex items-center gap-3">
        <div className="text-[var(--color-text-secondary)]">
          {icon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{title}</span>
            <StatusIndicator status={status.status} />
          </div>
          {status.latency !== undefined && status.status === 'online' && (
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {status.latency}ms
            </span>
          )}
          {status.message && (
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {status.message}
            </span>
          )}
        </div>
      </div>
      {onRefresh && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={status.status === 'checking'}
        >
          <RefreshCw className={`w-4 h-4 ${status.status === 'checking' ? 'animate-spin' : ''}`} />
        </Button>
      )}
    </div>
  );
};

// ============================================================================
// 主组件
// ============================================================================

const SystemStatusPanel: React.FC = () => {
  const [backendStatus, setBackendStatus] = useState<ServiceStatus>({
    name: 'Backend',
    status: 'checking',
  });
  const [mysqlStatus, setMysqlStatus] = useState<ServiceStatus>({
    name: 'MySQL',
    status: 'checking',
  });
  const [redisStatus, setRedisStatus] = useState<ServiceStatus>({
    name: 'Redis',
    status: 'checking',
  });
  const [llmProviders, setLlmProviders] = useState<LLMProviderStatus[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServerStatus[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [backendUrl, setBackendUrlState] = useState<string>('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // 获取后端 URL
  useEffect(() => {
    getBackendUrl().then(setBackendUrlState);
  }, []);

  // 检查后端状态
  const checkBackendStatus = useCallback(async () => {
    if (!backendUrl) return;
    
    setBackendStatus(prev => ({ ...prev, status: 'checking' }));
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${backendUrl}/api/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      
      const latency = Date.now() - startTime;
      
      if (response.ok) {
        const data = await response.json();
        setBackendStatus({
          name: 'Backend',
          status: 'online',
          latency,
          lastCheck: new Date(),
        });
        
        // 更新数据库状态
        setMysqlStatus({
          name: 'MySQL',
          status: data.mysql ? 'online' : 'offline',
          message: data.mysql ? '已连接' : '未连接',
        });
        setRedisStatus({
          name: 'Redis',
          status: data.redis ? 'online' : 'offline',
          message: data.redis ? '已连接' : '未连接',
        });
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error: any) {
      setBackendStatus({
        name: 'Backend',
        status: 'offline',
        message: error.message,
        lastCheck: new Date(),
      });
      setMysqlStatus({ name: 'MySQL', status: 'offline', message: '后端离线' });
      setRedisStatus({ name: 'Redis', status: 'offline', message: '后端离线' });
    }
  }, [backendUrl]);

  // 获取 LLM Provider 列表
  const fetchLLMProviders = useCallback(async () => {
    if (!backendUrl) return;
    
    try {
      const response = await fetch(`${backendUrl}/api/llm/configs`);
      if (response.ok) {
        const data = await response.json();
        // 兼容两种返回格式：{ configs: [...] } 或直接 [...]
        const configs = Array.isArray(data) ? data : (data.configs || []);
        setLlmProviders(configs.map((config: any) => ({
          config_id: config.config_id,
          name: config.name,
          provider: config.provider,
          enabled: config.enabled,
          has_api_key: config.has_api_key,
          status: !config.enabled ? 'disabled' : config.has_api_key ? 'ready' : 'no_key',
        })));
      }
    } catch (error) {
      console.error('[SystemStatus] Failed to fetch LLM providers:', error);
    }
  }, [backendUrl]);

  // 获取 MCP 服务器状态
  const fetchMCPServers = useCallback(async () => {
    if (!backendUrl) return;
    
    try {
      // 获取服务器列表
      const serversResponse = await fetch(`${backendUrl}/api/mcp/servers`);
      if (!serversResponse.ok) return;
      
      const serversData = await serversResponse.json();
      // 兼容两种返回格式：{ servers: [...] } 或直接 [...]
      const servers = Array.isArray(serversData) ? serversData : (serversData.servers || []);
      
      // 获取健康状态
      const healthResponse = await fetch(`${backendUrl}/api/mcp/health`);
      const healthData = healthResponse.ok ? await healthResponse.json() : {};
      
      setMcpServers(servers.map((server: any) => {
        const health = healthData[server.server_id] || {};
        return {
          server_id: server.server_id,
          name: server.name,
          url: server.url,
          enabled: server.enabled,
          healthy: server.enabled ? health.healthy === true : false,
          latency_ms: health.latency_ms,
          error: health.error,
        };
      }));
    } catch (error) {
      console.error('[SystemStatus] Failed to fetch MCP servers:', error);
    }
  }, [backendUrl]);

  // 刷新所有状态
  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      checkBackendStatus(),
      fetchLLMProviders(),
      fetchMCPServers(),
    ]);
    setLastRefresh(new Date());
    setIsRefreshing(false);
  }, [checkBackendStatus, fetchLLMProviders, fetchMCPServers]);

  // 初始加载
  useEffect(() => {
    if (backendUrl) {
      refreshAll();
    }
  }, [backendUrl, refreshAll]);

  // 自动刷新（每 30 秒）
  useEffect(() => {
    const interval = setInterval(() => {
      if (backendUrl) {
        refreshAll();
      }
    }, 30000);
    
    return () => clearInterval(interval);
  }, [backendUrl, refreshAll]);

  return (
    <div className="h-full overflow-auto p-6 bg-[var(--color-bg-primary)]">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-[var(--color-accent)]" />
          <h1 className="text-xl font-semibold">系统状态</h1>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-[var(--color-text-tertiary)]">
              最后更新: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      {/* 环境信息 */}
      <Card title="运行环境" size="compact" className="mb-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[var(--color-text-secondary)]" />
            <span className="text-[var(--color-text-secondary)]">运行模式:</span>
            <Badge variant="default">
              浏览器
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[var(--color-text-secondary)]" />
            <span className="text-[var(--color-text-secondary)]">后端地址:</span>
            <span className="font-mono text-xs">{backendUrl || '未配置'}</span>
          </div>
        </div>
      </Card>

      {/* 核心服务状态 */}
      <Card title="核心服务" size="compact" className="mb-4">
        <div className="space-y-2">
          <ServiceCard
            icon={<Server className="w-5 h-5" />}
            title="后端服务"
            status={backendStatus}
            onRefresh={checkBackendStatus}
          />
          <ServiceCard
            icon={<Database className="w-5 h-5" />}
            title="MySQL 数据库"
            status={mysqlStatus}
          />
          <ServiceCard
            icon={<Database className="w-5 h-5" />}
            title="Redis 缓存"
            status={redisStatus}
          />
        </div>
      </Card>

      {/* LLM Provider 状态 */}
      <Card 
        title="LLM 提供者" 
        size="compact" 
        className="mb-4"
        headerAction={
          <Badge variant="default">{llmProviders.length} 个</Badge>
        }
      >
        {llmProviders.length === 0 ? (
          <div className="text-sm text-[var(--color-text-tertiary)] py-2">
            暂无配置的 LLM 提供者
          </div>
        ) : (
          <div className="space-y-2">
            {llmProviders.map((provider, index) => (
              <div 
                key={provider.config_id || `llm-${index}`}
                className="flex items-center justify-between p-2 bg-[var(--color-bg-tertiary)] rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-[var(--color-text-secondary)]" />
                  <span className="text-sm font-medium">{provider.name}</span>
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    ({provider.provider})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {provider.status === 'ready' && (
                    <Badge variant="success">就绪</Badge>
                  )}
                  {provider.status === 'no_key' && (
                    <Badge variant="warning">缺少 Key</Badge>
                  )}
                  {provider.status === 'disabled' && (
                    <Badge variant="default">已禁用</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* MCP 服务器状态 */}
      <Card 
        title="MCP 服务器" 
        size="compact"
        headerAction={
          <Badge variant="default">{mcpServers.length} 个</Badge>
        }
      >
        {mcpServers.length === 0 ? (
          <div className="text-sm text-[var(--color-text-tertiary)] py-2">
            暂无配置的 MCP 服务器
          </div>
        ) : (
          <div className="space-y-2">
            {mcpServers.map((server, index) => (
              <div 
                key={server.server_id || `mcp-${index}`}
                className="flex items-center justify-between p-2 bg-[var(--color-bg-tertiary)] rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <Plug className="w-4 h-4 text-[var(--color-text-secondary)]" />
                  <span className="text-sm font-medium">{server.name}</span>
                  {server.latency_ms !== undefined && server.healthy && (
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      {server.latency_ms}ms
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!server.enabled ? (
                    <Badge variant="default">已禁用</Badge>
                  ) : server.healthy ? (
                    <Badge variant="success">在线</Badge>
                  ) : (
                    <Badge variant="error">离线</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default SystemStatusPanel;
