/**
 * Provider 状态监控组件
 * 实时显示 LLM Provider 和 MCP 服务器的状态
 */

import React, { useEffect, useState, useCallback } from 'react';
import { 
  Plug, RefreshCw, CheckCircle, XCircle, 
  AlertTriangle, Settings, ExternalLink, Zap
} from 'lucide-react';
import { Button } from './ui/Button';
import { Card, Badge } from './ui/PageLayout';
import { getBackendUrl } from '../services/compat/electron';
import { getProviders, LLMProvider as LLMProviderType } from '../services/llmApi';

// ============================================================================
// 类型定义
// ============================================================================

interface LLMProvider {
  config_id: string;
  name: string;
  provider: string;
  model?: string;
  enabled: boolean;
  has_api_key: boolean;
  api_url?: string;
}

interface MCPServer {
  server_id: string;
  name: string;
  url: string;
  type: string;
  enabled: boolean;
  use_proxy: boolean;
}

interface MCPHealth {
  healthy: boolean;
  status_code?: number;
  latency_ms?: number;
  error?: string;
}

// ============================================================================
// LLM Provider 卡片
// ============================================================================

interface LLMProviderCardProps {
  provider: LLMProvider;
  onConfigure?: () => void;
}

const LLMProviderCard: React.FC<LLMProviderCardProps & { providers?: LLMProviderType[] }> = ({ provider, onConfigure, providers = [] }) => {
  const getStatusIcon = () => {
    if (!provider.enabled) {
      return <AlertTriangle className="w-4 h-4 text-gray-400" />;
    }
    if (!provider.has_api_key) {
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    }
    return <CheckCircle className="w-4 h-4 text-green-500" />;
  };

  const getStatusText = () => {
    if (!provider.enabled) return '已禁用';
    if (!provider.has_api_key) return '需要 API Key';
    return '就绪';
  };

  // 根据 provider.provider 匹配对应的供应商，获取 logo
  const matchedProvider = providers.find(p => 
    p.provider_type === provider.provider || 
    p.provider_id === provider.provider ||
    (provider as any).provider_id === p.provider_id
  );

  const getProviderIcon = () => {
    // 优先使用供应商的 logo（主题自适应）
    if (matchedProvider && (matchedProvider.logo_light || matchedProvider.logo_dark)) {
      return (
        <div className="w-6 h-6 rounded flex items-center justify-center overflow-hidden">
          {/* 浅色模式显示 */}
          {matchedProvider.logo_light && (
            <img 
              src={matchedProvider.logo_light} 
              alt={provider.provider} 
              className="w-full h-full object-cover dark:hidden"
            />
          )}
          {/* 深色模式显示 */}
          {matchedProvider.logo_dark && (
            <img 
              src={matchedProvider.logo_dark} 
              alt={provider.provider} 
              className="w-full h-full object-cover hidden dark:block"
            />
          )}
          {/* 如果只有一种logo，则都显示 */}
          {matchedProvider.logo_light && !matchedProvider.logo_dark && (
            <img 
              src={matchedProvider.logo_light} 
              alt={provider.provider} 
              className="w-full h-full object-cover hidden dark:block"
            />
          )}
          {!matchedProvider.logo_light && matchedProvider.logo_dark && (
            <img 
              src={matchedProvider.logo_dark} 
              alt={provider.provider} 
              className="w-full h-full object-cover dark:hidden"
            />
          )}
        </div>
      );
    }
    
    // 回退到 emoji 图标
    switch (provider.provider.toLowerCase()) {
      case 'openai':
        return <span className="text-xl">🤖</span>;
      case 'deepseek':
        return <span className="text-xl">🔮</span>;
      case 'anthropic':
        return <span className="text-xl">🧠</span>;
      case 'gemini':
        return <span className="text-xl">✨</span>;
      case 'ollama':
        return <span className="text-xl">🦙</span>;
      default:
        return <span className="text-xl">💬</span>;
    }
  };

  return (
    <div className="flex items-center justify-between p-3 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors">
      <div className="flex items-center gap-3">
        {getProviderIcon()}
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{provider.name}</span>
            {provider.model && (
              <span className="text-xs px-1.5 py-0.5 bg-[var(--color-bg-tertiary)] rounded text-[var(--color-text-tertiary)]">
                {provider.model}
              </span>
            )}
          </div>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {provider.provider}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-xs">
          {getStatusIcon()}
          <span className={
            !provider.enabled ? 'text-gray-400' :
            !provider.has_api_key ? 'text-yellow-500' :
            'text-green-500'
          }>
            {getStatusText()}
          </span>
        </div>
        {onConfigure && (
          <Button variant="ghost" size="icon" onClick={onConfigure}>
            <Settings className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// MCP Server 卡片
// ============================================================================

interface MCPServerCardProps {
  server: MCPServer;
  health?: MCPHealth;
  onTest?: () => void;
  onConfigure?: () => void;
}

const MCPServerCard: React.FC<MCPServerCardProps> = ({ server, health, onTest, onConfigure }) => {
  const getStatusIcon = () => {
    if (!server.enabled) {
      return <AlertTriangle className="w-4 h-4 text-gray-400" />;
    }
    if (!health) {
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    }
    if (health.healthy) {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    return <XCircle className="w-4 h-4 text-red-500" />;
  };

  const getStatusText = () => {
    if (!server.enabled) return '已禁用';
    if (!health) return '未检测';
    if (health.healthy) {
      return health.latency_ms ? `在线 (${health.latency_ms}ms)` : '在线';
    }
    return health.error || '离线';
  };

  return (
    <div className="flex items-center justify-between p-3 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors">
      <div className="flex items-center gap-3">
        <Plug className="w-5 h-5 text-[var(--color-text-secondary)]" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{server.name}</span>
            <span className="text-xs px-1.5 py-0.5 bg-[var(--color-bg-tertiary)] rounded text-[var(--color-text-tertiary)]">
              {server.type}
            </span>
          </div>
          <span className="text-xs text-[var(--color-text-tertiary)] font-mono truncate max-w-[200px] block">
            {server.url}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-xs">
          {getStatusIcon()}
          <span className={
            !server.enabled ? 'text-gray-400' :
            health?.healthy ? 'text-green-500' :
            'text-red-500'
          }>
            {getStatusText()}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onTest && (
            <Button variant="ghost" size="icon" onClick={onTest} title="测试连接">
              <Zap className="w-4 h-4" />
            </Button>
          )}
          {onConfigure && (
            <Button variant="ghost" size="icon" onClick={onConfigure} title="配置">
              <Settings className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 主组件
// ============================================================================

interface ProviderStatusProps {
  showTitle?: boolean;
  compact?: boolean;
  onNavigateToLLM?: () => void;
  onNavigateToMCP?: () => void;
}

const ProviderStatus: React.FC<ProviderStatusProps> = ({
  showTitle = true,
  compact = false,
  onNavigateToLLM,
  onNavigateToMCP,
}) => {
  const [llmProviders, setLlmProviders] = useState<LLMProvider[]>([]);
  const [providers, setProviders] = useState<LLMProviderType[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [mcpHealth, setMcpHealth] = useState<Record<string, MCPHealth>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [backendUrl, setBackendUrlState] = useState<string>('');

  // 获取后端 URL
  useEffect(() => {
    getBackendUrl().then(setBackendUrlState);
  }, []);

  // 获取数据
  const fetchData = useCallback(async () => {
    if (!backendUrl) return;
    
    setIsLoading(true);
    
    try {
      // 并行获取数据
      const [llmRes, providersRes, mcpRes, healthRes] = await Promise.all([
        fetch(`${backendUrl}/api/llm/configs`).catch(() => null),
        getProviders().catch(() => []), // 获取供应商列表
        fetch(`${backendUrl}/api/mcp/servers`).catch(() => null),
        fetch(`${backendUrl}/api/mcp/health`).catch(() => null),
      ]);

      if (llmRes?.ok) {
        const data = await llmRes.json();
        // 兼容两种返回格式：{ configs: [...] } 或直接 [...]
        setLlmProviders(Array.isArray(data) ? data : (data.configs || []));
      }
      
      if (Array.isArray(providersRes)) {
        setProviders(providersRes);
      }

      if (mcpRes?.ok) {
        const data = await mcpRes.json();
        // 兼容两种返回格式：{ servers: [...] } 或直接 [...]
        setMcpServers(Array.isArray(data) ? data : (data.servers || []));
      }

      if (healthRes?.ok) {
        const data = await healthRes.json();
        setMcpHealth(data);
      }
    } catch (error) {
      console.error('[ProviderStatus] Failed to fetch data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => {
    if (backendUrl) {
      fetchData();
    }
  }, [backendUrl, fetchData]);

  // 测试 MCP 连接
  const testMCPConnection = async (serverId: string) => {
    if (!backendUrl) return;
    
    try {
      const response = await fetch(`${backendUrl}/api/mcp/servers/${serverId}/health`);
      if (response.ok) {
        const data = await response.json();
        setMcpHealth(prev => ({
          ...prev,
          [serverId]: data,
        }));
      }
    } catch (error) {
      console.error('[ProviderStatus] Failed to test MCP connection:', error);
    }
  };

  // 统计
  const enabledLLM = llmProviders.filter(p => p.enabled).length;
  const readyLLM = llmProviders.filter(p => p.enabled && p.has_api_key).length;
  const enabledMCP = mcpServers.filter(s => s.enabled).length;
  const onlineMCP = mcpServers.filter(s => s.enabled && mcpHealth[s.server_id]?.healthy).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-text-tertiary)]" />
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {showTitle && (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-[var(--color-accent)]" />
            Provider 状态
          </h2>
          <Button variant="ghost" size="sm" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-1" />
            刷新
          </Button>
        </div>
      )}

      {/* LLM Providers */}
      <Card 
        title="LLM 提供者" 
        size={compact ? 'compact' : 'default'}
        headerAction={
          <div className="flex items-center gap-2">
            <Badge variant={readyLLM > 0 ? 'success' : 'warning'}>
              {readyLLM}/{enabledLLM} 就绪
            </Badge>
            {onNavigateToLLM && (
              <Button variant="ghost" size="icon" onClick={onNavigateToLLM}>
                <ExternalLink className="w-4 h-4" />
              </Button>
            )}
          </div>
        }
      >
        {llmProviders.length === 0 ? (
          <div className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">
            暂无配置的 LLM 提供者
            {onNavigateToLLM && (
              <Button variant="ghost" size="sm" onClick={onNavigateToLLM} className="ml-2">
                去配置
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {(compact ? llmProviders.slice(0, 3) : llmProviders).map((provider, index) => (
              <LLMProviderCard
                key={provider.config_id || `llm-${index}`}
                provider={provider}
                onConfigure={onNavigateToLLM}
                providers={providers}
              />
            ))}
            {compact && llmProviders.length > 3 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full" 
                onClick={onNavigateToLLM}
              >
                查看全部 {llmProviders.length} 个
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* MCP Servers */}
      <Card 
        title="MCP 服务器" 
        size={compact ? 'compact' : 'default'}
        headerAction={
          <div className="flex items-center gap-2">
            <Badge variant={onlineMCP > 0 ? 'success' : 'warning'}>
              {onlineMCP}/{enabledMCP} 在线
            </Badge>
            {onNavigateToMCP && (
              <Button variant="ghost" size="icon" onClick={onNavigateToMCP}>
                <ExternalLink className="w-4 h-4" />
              </Button>
            )}
          </div>
        }
      >
        {mcpServers.length === 0 ? (
          <div className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">
            暂无配置的 MCP 服务器
            {onNavigateToMCP && (
              <Button variant="ghost" size="sm" onClick={onNavigateToMCP} className="ml-2">
                去配置
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {(compact ? mcpServers.slice(0, 3) : mcpServers).map((server, index) => (
              <MCPServerCard
                key={server.server_id || `mcp-${index}`}
                server={server}
                health={mcpHealth[server.server_id]}
                onTest={() => testMCPConnection(server.server_id)}
                onConfigure={onNavigateToMCP}
              />
            ))}
            {compact && mcpServers.length > 3 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full" 
                onClick={onNavigateToMCP}
              >
                查看全部 {mcpServers.length} 个
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default ProviderStatus;
