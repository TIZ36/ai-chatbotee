/**
 * 工作流界面组件
 * 整合LLM模型和MCP工具，通过聊天完成任务
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader, Bot, User, Wrench, AlertCircle, CheckCircle, Brain, Plug, RefreshCw, Power, XCircle, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';
import { LLMClient } from '../services/llmClient';
import { getLLMConfigs, getLLMConfig, getLLMConfigApiKey, LLMConfigFromDB } from '../services/llmApi';
import { mcpManager, MCPServer, MCPClient, MCPTool } from '../services/mcpClient';
import { getMCPServers, MCPServerConfig } from '../services/mcpApi';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: Array<{ name: string; arguments: any; result?: any }>;
}

const Workflow: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // LLM配置
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [selectedLLMConfigId, setSelectedLLMConfigId] = useState<string | null>(null);
  const [selectedLLMConfig, setSelectedLLMConfig] = useState<LLMConfigFromDB | null>(null);
  
  // MCP配置
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [connectedMcpServerIds, setConnectedMcpServerIds] = useState<Set<string>>(new Set());
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<Set<string>>(new Set());
  const [mcpTools, setMcpTools] = useState<Map<string, MCPTool[]>>(new Map());
  const [connectingServers, setConnectingServers] = useState<Set<string>>(new Set());
  const [expandedServerIds, setExpandedServerIds] = useState<Set<string>>(new Set());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 加载LLM配置和MCP服务器列表
  useEffect(() => {
    loadLLMConfigs();
    loadMCPServers();
  }, []);

  const loadLLMConfigs = async () => {
    try {
      console.log('[Workflow] Loading LLM configs...');
      const configs = await getLLMConfigs();
      console.log('[Workflow] Loaded LLM configs:', configs);
      
      // 过滤启用的配置（确保 enabled 是布尔值）
      const enabledConfigs = configs.filter(c => Boolean(c.enabled));
      console.log('[Workflow] Enabled LLM configs:', enabledConfigs);
      
      setLlmConfigs(enabledConfigs);
      
      // 默认选择第一个启用的配置
      if (enabledConfigs.length > 0 && !selectedLLMConfigId) {
        const firstConfig = enabledConfigs[0];
        console.log('[Workflow] Auto-selecting first LLM config:', firstConfig);
        setSelectedLLMConfigId(firstConfig.config_id);
        setSelectedLLMConfig(firstConfig);
        console.log('[Workflow] Auto-selected LLM config:', firstConfig.config_id, firstConfig);
      }
    } catch (error) {
      console.error('[Workflow] Failed to load LLM configs:', error);
      // 显示错误消息给用户
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `❌ 加载LLM配置失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  const loadMCPServers = async () => {
    try {
      console.log('[Workflow] Loading MCP servers...');
      const servers = await getMCPServers();
      console.log('[Workflow] Loaded MCP servers:', servers);
      setMcpServers(servers);
    } catch (error) {
      console.error('[Workflow] Failed to load MCP servers:', error);
    }
  };


  /**
   * 连接到 MCP 服务器
   */
  const handleConnectServer = async (serverId: string) => {
    const server = mcpServers.find(s => s.id === serverId);
    if (!server) return;

    setConnectingServers(prev => new Set(prev).add(serverId));

    try {
      console.log(`[Workflow] Connecting to ${server.name}...`);
      
      // 转换为 MCPServer 格式
      const mcpServer: MCPServer = {
        id: server.id,
        name: server.name,
        url: server.url,
        type: server.type,
        enabled: server.enabled,
        description: server.description,
        metadata: server.metadata,
      };

      const client = await mcpManager.addServer(mcpServer);

      // 加载工具列表
      const tools = await client.listTools();
      setMcpTools(prev => new Map(prev).set(serverId, tools));
      setConnectedMcpServerIds(prev => new Set(prev).add(serverId));
      console.log(`[Workflow] Connected to ${server.name}, loaded ${tools.length} tools`);

    } catch (error) {
      console.error(`[Workflow] Failed to connect to ${server.name}:`, error);
      alert(`连接失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setConnectingServers(prev => {
        const newSet = new Set(prev);
        newSet.delete(serverId);
        return newSet;
      });
    }
  };

  /**
   * 断开 MCP 服务器连接
   */
  const handleDisconnectServer = (serverId: string) => {
    mcpManager.removeServer(serverId);
    setConnectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
    setSelectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
    setMcpTools(prev => {
      const newMap = new Map(prev);
      newMap.delete(serverId);
      return newMap;
    });
    setExpandedServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
    console.log(`[Workflow] Disconnected from server: ${serverId}`);
  };

  /**
   * 切换服务器工具展开状态
   */
  const handleToggleServerExpand = (serverId: string) => {
    setExpandedServerIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        newSet.add(serverId);
      }
      return newSet;
    });
  };

  const handleLLMConfigChange = async (configId: string) => {
    console.log('[Workflow] LLM config changed:', configId);
    
    if (!configId) {
      setSelectedLLMConfigId(null);
      setSelectedLLMConfig(null);
      return;
    }
    
    setSelectedLLMConfigId(configId);
    
    // 先从已加载的配置列表中查找，避免额外的 API 调用
    const configFromList = llmConfigs.find(c => c.config_id === configId);
    if (configFromList) {
      console.log('[Workflow] Found config in list:', configFromList);
      setSelectedLLMConfig(configFromList);
      return;
    }
    
    // 如果列表中没有，尝试从 API 获取
    try {
      console.log('[Workflow] Loading config from API:', configId);
      const config = await getLLMConfig(configId);
      console.log('[Workflow] Loaded config from API:', config);
      setSelectedLLMConfig(config);
    } catch (error) {
      console.error('[Workflow] Failed to load LLM config:', error);
      setSelectedLLMConfig(null);
      // 显示错误消息
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `❌ 加载LLM配置失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  /**
   * 切换是否使用某个 MCP 服务器的工具
   */
  const handleToggleMcpServerUsage = (serverId: string) => {
    setSelectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        // 只有已连接的服务器才能被选择使用
        if (connectedMcpServerIds.has(serverId)) {
          newSet.add(serverId);
        }
      }
      return newSet;
    });
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    // 检查配置
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '❌ 请先选择一个 LLM 模型',
      };
      setMessages(prev => [...prev, errorMsg]);
      return;
    }

    // MCP 服务器是可选的，不需要强制选择

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // 获取API密钥（Ollama 不需要 API key）
      const apiKey = await getLLMConfigApiKey(selectedLLMConfigId);
      if (selectedLLMConfig.provider !== 'ollama' && !apiKey) {
        throw new Error('API密钥未配置，请检查LLM配置');
      }

      // 收集所有可用的MCP工具（如果选择了MCP服务器）
      const allTools: MCPTool[] = [];
      if (selectedMcpServerIds.size > 0) {
        for (const serverId of selectedMcpServerIds) {
          const tools = mcpTools.get(serverId) || [];
          allTools.push(...tools);
        }
      }

      // 创建LLM客户端
      const llmClient = new LLMClient({
        id: selectedLLMConfig.config_id,
        provider: selectedLLMConfig.provider,
        name: selectedLLMConfig.name,
        apiKey: apiKey,
        apiUrl: selectedLLMConfig.api_url,
        model: selectedLLMConfig.model,
        enabled: selectedLLMConfig.enabled,
        metadata: selectedLLMConfig.metadata,
      });

      // 构建系统提示词
      let systemPrompt = '你是一个智能工作流助手，可以帮助用户完成各种任务。';
      
      if (allTools.length > 0) {
        systemPrompt += `\n\n你可以使用以下 MCP 工具来帮助用户完成任务：\n\n${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n当用户需要执行操作时，使用相应的工具。用中文回复用户，并清晰地说明你执行的操作和结果。`;
      } else {
        systemPrompt += '请根据用户的问题提供有用的回答和建议。用中文回复用户。';
      }

      // 使用LLM客户端处理用户请求（自动调用MCP工具）
      const response = await llmClient.handleUserRequest(
        userMessage.content,
        systemPrompt
      );

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('[Workflow] Error details:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ 错误: ${errorMsg}

🔍 排查步骤：
1. 检查 LLM 模型配置是否正确
2. 检查 MCP 服务器是否已连接
3. 检查 API 密钥是否有效
4. 查看浏览器控制台的详细错误信息`,
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessageContent = (message: Message) => {
    if (message.role === 'tool' && message.toolCalls) {
      return (
        <div>
          <div className="font-medium text-sm mb-2">工具调用:</div>
          {message.toolCalls.map((toolCall, idx) => (
            <div key={idx} className="mb-3 p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <Wrench className="w-4 h-4 text-blue-500" />
                <span className="font-medium text-sm">{toolCall.name}</span>
              </div>
              {toolCall.arguments && (
                <div className="text-xs text-gray-600 mb-2">
                  <span className="font-medium">参数:</span>
                  <pre className="mt-1 bg-white p-2 rounded border text-xs overflow-auto">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                </div>
              )}
              {toolCall.result && (
                <div className="text-xs text-gray-600">
                  <span className="font-medium">结果:</span>
                  <pre className="mt-1 bg-white p-2 rounded border text-xs overflow-auto">
                    {JSON.stringify(toolCall.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    return <div className="whitespace-pre-wrap break-words">{message.content}</div>;
  };

  // 统计可用工具数量
  const totalTools = Array.from(mcpTools.values()).flat().length;

  return (
    <div className="h-full flex flex-col">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center space-x-2">
          <MessageCircle className="w-6 h-6 text-gray-600" />
          <h2 className="text-2xl font-semibold">智能聊天</h2>
        </div>
      </div>

      {/* 主要内容区域：左侧配置 + 右侧聊天 */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* 左侧配置面板 */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
          {/* LLM模型选择模块 */}
          <div className="card p-3 flex-shrink-0">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Brain className="w-4 h-4 inline mr-1" />
              LLM 模型 *
            </label>
            <select
              value={selectedLLMConfigId || ''}
              onChange={(e) => {
                console.log('[Workflow] Select onChange:', e.target.value);
                handleLLMConfigChange(e.target.value);
              }}
              className="input-field w-full"
            >
              <option value="">请选择LLM模型...</option>
              {llmConfigs.map((config) => (
                <option key={config.config_id} value={config.config_id}>
                  {config.name} {config.model && `(${config.model})`} [{config.provider}]
                </option>
              ))}
            </select>
            {selectedLLMConfig ? (
              <div className="mt-2 text-xs text-gray-600">
                <span className="font-medium">已选择:</span> {selectedLLMConfig.name}
                {selectedLLMConfig.model && ` - ${selectedLLMConfig.model}`}
              </div>
            ) : selectedLLMConfigId ? (
              <div className="mt-2 text-xs text-amber-600">
                <span className="font-medium">加载中...</span>
              </div>
            ) : null}
          </div>

          {/* MCP服务器选择模块 */}
          <div className="card p-3 flex-1 flex flex-col min-h-0">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Plug className="w-4 h-4 inline mr-1" />
              MCP 服务器 (可选)
            </label>
            <div className="flex-1 overflow-y-auto space-y-1.5 border border-gray-200 rounded-lg p-2">
              {mcpServers.length === 0 ? (
                <div className="text-xs text-gray-500 text-center py-2">
                  暂无可用的MCP服务器，请先在 MCP 配置页面添加
                </div>
              ) : (
                mcpServers.map((server) => {
                  const isConnected = connectedMcpServerIds.has(server.id);
                  const isSelected = selectedMcpServerIds.has(server.id);
                  const isConnecting = connectingServers.has(server.id);
                  const isExpanded = expandedServerIds.has(server.id);
                  const tools = mcpTools.get(server.id) || [];
                  
                  return (
                    <div
                      key={server.id}
                      className="border border-gray-200 rounded-lg bg-gray-50"
                    >
                      {/* 服务器主要信息行 */}
                      <div className="flex items-center space-x-2 p-1.5">
                        {/* 服务器连接控制 */}
                        <button
                          onClick={() => isConnected ? handleDisconnectServer(server.id) : handleConnectServer(server.id)}
                          disabled={isConnecting}
                          className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                            isConnected
                              ? 'text-green-600 hover:bg-green-100'
                              : 'text-gray-400 hover:bg-gray-200'
                          } ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title={isConnected ? '断开连接' : '连接'}
                        >
                          {isConnecting ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : isConnected ? (
                            <Power className="w-4 h-4" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                        </button>

                        {/* 服务器信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-gray-900 truncate">
                              {server.name}
                            </span>
                            {isConnected && (
                              <span className="text-xs text-green-600 font-medium">
                                已连接
                              </span>
                            )}
                            {isConnected && tools.length > 0 && (
                              <span className="text-xs text-gray-500">
                                ({tools.length} 工具)
                              </span>
                            )}
                          </div>
                          {server.description && (
                            <div className="text-xs text-gray-500 truncate mt-0.5">
                              {server.description}
                            </div>
                          )}
                        </div>

                        {/* 展开/收起按钮（仅在已连接且有工具时显示） */}
                        {isConnected && tools.length > 0 && (
                          <button
                            onClick={() => handleToggleServerExpand(server.id)}
                            className="flex-shrink-0 p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
                            title={isExpanded ? '收起工具' : '展开工具'}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        )}

                        {/* 使用开关（仅在已连接时可用） */}
                        {isConnected && (
                          <label className="flex items-center space-x-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleMcpServerUsage(server.id)}
                              className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
                            />
                            <span className="text-xs text-gray-600">使用</span>
                          </label>
                        )}
                      </div>

                      {/* 工具列表（展开时显示） */}
                      {isConnected && isExpanded && tools.length > 0 && (
                        <div className="border-t border-gray-200 bg-white p-2 space-y-1.5">
                          <div className="text-xs font-medium text-gray-700 mb-1.5">
                            可用工具:
                          </div>
                          {tools.map((tool, index) => (
                            <div
                              key={index}
                              className="bg-gray-50 border border-gray-200 rounded p-2 hover:bg-gray-100 transition-colors"
                            >
                              <div className="flex items-start space-x-2">
                                <Wrench className="w-3 h-3 text-blue-500 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-gray-900">
                                    {tool.name}
                                  </div>
                                  {tool.description && (
                                    <div className="text-xs text-gray-600 mt-1">
                                      {tool.description}
                                    </div>
                                  )}
                                  {tool.inputSchema?.properties && (
                                    <div className="mt-1.5">
                                      <div className="text-xs text-gray-500 mb-1">参数:</div>
                                      <div className="flex flex-wrap gap-1">
                                        {Object.keys(tool.inputSchema.properties).map((param) => (
                                          <span
                                            key={param}
                                            className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded"
                                          >
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
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {selectedMcpServerIds.size > 0 && (
              <div className="mt-2 text-xs text-gray-600 pt-2 border-t border-gray-200">
                <span className="font-medium">已选择:</span> {selectedMcpServerIds.size} 个服务器，
                共 {totalTools} 个工具可用
              </div>
            )}
          </div>
        </div>

        {/* 右侧聊天界面 */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 card">
          {/* 状态栏 */}
          <div className="border-b border-gray-200 px-3 py-1.5 bg-gray-50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Bot className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium">AI 工作流助手</span>
            </div>
            <div className="flex items-center space-x-2">
              {selectedLLMConfig ? (
                <div className="flex items-center space-x-1 text-green-600 text-xs">
                  <CheckCircle className="w-3 h-3" />
                  <span>
                    就绪
                    {selectedMcpServerIds.size > 0 && ` (${selectedMcpServerIds.size} 个MCP服务器, ${totalTools} 个工具)`}
                  </span>
                </div>
              ) : (
                <div className="flex items-center space-x-1 text-amber-600 text-xs">
                  <AlertCircle className="w-3 h-3" />
                  <span>未配置</span>
                </div>
              )}
            </div>
          </div>
          </div>

          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex items-start space-x-3 ${
                message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
              }`}
            >
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  message.role === 'user'
                    ? 'bg-primary-500 text-white'
                    : message.role === 'assistant'
                    ? 'bg-blue-500 text-white'
                    : message.role === 'tool'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-400 text-white'
                }`}
              >
                {message.role === 'user' ? (
                  <User className="w-4 h-4" />
                ) : message.role === 'assistant' ? (
                  <Bot className="w-4 h-4" />
                ) : message.role === 'tool' ? (
                  <Wrench className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
              </div>
              <div
                className={`flex-1 rounded-lg p-3 ${
                  message.role === 'user'
                    ? 'bg-primary-50 text-gray-900'
                    : message.role === 'assistant'
                    ? 'bg-gray-50 text-gray-900'
                    : message.role === 'tool'
                    ? 'bg-green-50 text-gray-900'
                    : 'bg-yellow-50 text-gray-700 text-sm'
                }`}
              >
                {renderMessageContent(message)}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center">
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex-1 rounded-lg p-3 bg-gray-50">
                <div className="flex items-center space-x-2">
                  <Loader className="w-4 h-4 animate-spin text-gray-400" />
                  <span className="text-sm text-gray-500">思考中...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
          </div>

          {/* 输入框 */}
          <div className="border-t border-gray-200 p-3 flex-shrink-0">
          <div className="flex space-x-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                !selectedLLMConfig
                  ? '请先选择 LLM 模型...'
                  : selectedMcpServerIds.size > 0
                  ? `输入你的任务，我可以使用 ${totalTools} 个工具帮助你完成...`
                  : '输入你的问题，我会尽力帮助你...'
              }
              className="flex-1 input-field resize-none"
              rows={3}
              disabled={isLoading || !selectedLLMConfig}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim() || !selectedLLMConfig}
              className="btn-primary flex items-center space-x-2 self-end disabled:opacity-50"
            >
              {isLoading ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>发送</span>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {!selectedLLMConfig ? (
              '请先选择 LLM 模型'
            ) : selectedMcpServerIds.size > 0 ? (
              <>提示：我可以使用 {totalTools} 个 MCP 工具帮助你完成任务，例如<span className="font-medium">"发布内容"</span>、<span className="font-medium">"查询信息"</span>等</>
            ) : (
              <>提示：你可以直接与我对话，我会尽力帮助你。如果需要使用工具，请在 MCP 服务器中选择至少一个服务器。</>
            )}
          </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Workflow;

