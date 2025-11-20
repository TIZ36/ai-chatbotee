/**
 * 工作流界面组件
 * 整合LLM模型和MCP工具，通过聊天完成任务
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader, Bot, User, Wrench, AlertCircle, CheckCircle, Brain, Plug, RefreshCw, Power, XCircle, ChevronDown, ChevronUp, MessageCircle, FileText, Plus, History, Sparkles, Workflow as WorkflowIcon, GripVertical, Play, ArrowRight, Trash2, X } from 'lucide-react';
import { LLMClient } from '../services/llmClient';
import { getLLMConfigs, getLLMConfig, getLLMConfigApiKey, LLMConfigFromDB } from '../services/llmApi';
import { mcpManager, MCPServer, MCPTool } from '../services/mcpClient';
import { getMCPServers, MCPServerConfig } from '../services/mcpApi';
import { getSessions, createSession, getSessionMessages, saveMessage, summarizeSession, getSessionSummaries, deleteSession, clearSummarizeCache, deleteMessage, executeMessageComponent, Session, Summary } from '../services/sessionApi';
import { estimate_messages_tokens, get_model_max_tokens, estimate_tokens } from '../services/tokenCounter';
import { getWorkflows, getWorkflow, Workflow as WorkflowType, WorkflowNode, WorkflowConnection } from '../services/workflowApi';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string; // 思考过程（用于 o1 等思考模型）
  toolCalls?: Array<{ name: string; arguments: any; result?: any }>;
  isStreaming?: boolean; // 是否正在流式输出
  isThinking?: boolean; // 是否正在思考
  toolType?: 'workflow' | 'mcp'; // 感知组件类型（当 role === 'tool' 时使用）
  workflowId?: string; // 工作流ID（如果是工作流消息）
  workflowName?: string; // 工作流名称
  workflowStatus?: 'pending' | 'running' | 'completed' | 'error'; // 工作流状态
  workflowResult?: string; // 工作流执行结果
  workflowConfig?: { nodes: WorkflowNode[]; connections: WorkflowConnection[] }; // 工作流配置（节点和连接）
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
  const [streamEnabled, setStreamEnabled] = useState(true); // 流式响应开关
  const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set()); // 已折叠的思考过程
  const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(new Set()); // 已展开的执行过程
  const [executionLogs, setExecutionLogs] = useState<Map<string, string[]>>(new Map()); // 执行日志（messageId -> logs[]）
  
  // @ 符号选择器状态
  const [showAtSelector, setShowAtSelector] = useState(false);
  const [atSelectorPosition, setAtSelectorPosition] = useState({ top: 0, left: 0 });
  const [atSelectorQuery, setAtSelectorQuery] = useState('');
  const [atSelectorIndex, setAtSelectorIndex] = useState(-1); // @ 符号在输入中的位置
  const [selectedComponentIndex, setSelectedComponentIndex] = useState(0); // 当前选中的组件索引（用于键盘导航）
  const [selectedComponents, setSelectedComponents] = useState<Array<{ type: 'mcp' | 'workflow'; id: string; name: string }>>([]); // 已选定的组件（tag）
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  // 会话管理
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [messagePage, setMessagePage] = useState(1);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isSummarizing, setIsSummarizing] = useState(false);
  
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
  
  // 工作流列表
  const [workflows, setWorkflows] = useState<WorkflowType[]>([]);
  
  // 拖拽状态
  const [draggingComponent, setDraggingComponent] = useState<{ type: 'mcp' | 'workflow'; id: string; name: string } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 加载会话列表
  const loadSessions = async () => {
    try {
      const sessionList = await getSessions();
      setSessions(sessionList);
    } catch (error) {
      console.error('[Workflow] Failed to load sessions:', error);
      // 如果加载失败，设置为空数组，避免后续错误
      setSessions([]);
    }
  };

  // 加载LLM配置和MCP服务器列表
  useEffect(() => {
    loadLLMConfigs();
    loadMCPServers();
    loadSessions();
    loadWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // 当选择会话时，加载历史消息
  useEffect(() => {
    if (currentSessionId) {
      loadSessionMessages(currentSessionId);
      loadSessionSummaries(currentSessionId);
    } else {
      // 新会话，清空消息（保留系统消息）
      setMessages([{
        id: '1',
        role: 'system',
        content: '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
      }]);
      setSummaries([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);
  
  // 加载会话消息
  const loadSessionMessages = async (session_id: string, page: number = 1) => {
    try {
      setIsLoadingMessages(true);
      const data = await getSessionMessages(session_id, page, 50);
      
      // 格式化消息，恢复工作流信息
      const formatMessage = async (msg: any): Promise<Message | null> => {
        const baseMessage: Message = {
          id: msg.message_id,
          role: msg.role,
          content: msg.content,
          thinking: msg.thinking,
          toolCalls: msg.tool_calls,
        };
        
        // 如果是工具消息（感知组件），尝试从 content 或 tool_calls 中恢复工作流信息
        if (msg.role === 'tool') {
          // 过滤掉没有执行输出的感知组件（pending状态且没有content）
          if (!msg.content || msg.content.trim() === '' || msg.content === '[]') {
            const toolCalls = msg.tool_calls && typeof msg.tool_calls === 'object' ? msg.tool_calls : null;
            const workflowStatus = toolCalls?.workflowStatus;
            if (workflowStatus === 'pending') {
              // 跳过这个无效的感知组件消息
              console.log('[Workflow] Skipping invalid tool message (pending without output):', msg.message_id);
              return null;
            }
          }
          
          // 尝试从 tool_calls 中恢复工作流信息（如果之前保存过）
          if (msg.tool_calls && typeof msg.tool_calls === 'object') {
            baseMessage.toolType = msg.tool_calls.toolType || msg.tool_calls.workflowType; // 兼容旧数据
            baseMessage.workflowId = msg.tool_calls.workflowId;
            baseMessage.workflowName = msg.tool_calls.workflowName;
            baseMessage.workflowStatus = msg.tool_calls.workflowStatus || 'completed';
            
            // 确保恢复的消息有完整的工作流信息，允许重新执行
            if (!baseMessage.workflowId || !baseMessage.toolType) {
              console.warn('[Workflow] Restored tool message missing workflowId or toolType:', msg.message_id);
            }
          } else {
            // 如果没有 tool_calls，尝试从 content 中解析（兼容旧数据）
            console.warn('[Workflow] Restored tool message missing tool_calls:', msg.message_id);
          }
          
          // 如果工作流ID存在，尝试加载工作流配置
          if (baseMessage.workflowId && baseMessage.toolType === 'workflow') {
            try {
              const workflowDetails = await getWorkflow(baseMessage.workflowId);
              baseMessage.workflowConfig = workflowDetails?.config;
            } catch (error) {
              console.error('[Workflow] Failed to load workflow details:', error);
              // 即使加载失败，也允许重新执行（使用已有的 workflowId）
            }
          }
        }
        
        return baseMessage;
      };
      
      if (page === 1) {
        // 第一页，替换所有消息
        const formattedMessages = await Promise.all(data.messages.map(formatMessage));
        // 过滤掉null值（无效的感知组件消息）
        setMessages(formattedMessages.filter((msg): msg is Message => msg !== null));
      } else {
        // 后续页，添加到前面
        const formattedMessages = await Promise.all(data.messages.map(formatMessage));
        // 过滤掉null值（无效的感知组件消息）
        setMessages(prev => [...formattedMessages.filter((msg): msg is Message => msg !== null), ...prev]);
      }
      
      setHasMoreMessages(data.page < data.total_pages);
      setMessagePage(page);
    } catch (error) {
      console.error('[Workflow] Failed to load messages:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  };
  
  // 加载会话总结
  const loadSessionSummaries = async (session_id: string) => {
    try {
      const summaryList = await getSessionSummaries(session_id);
      setSummaries(summaryList);
    } catch (error) {
      console.error('[Workflow] Failed to load summaries:', error);
    }
  };
  
  // 创建新会话
  const handleCreateNewSession = async () => {
    try {
      const newSession = await createSession(
        selectedLLMConfigId || undefined,
        '新会话'
      );
      setCurrentSessionId(newSession.session_id);
      await loadSessions();
    } catch (error) {
      console.error('[Workflow] Failed to create session:', error);
      alert('创建会话失败，请重试');
    }
  };
  
  // 选择会话
  const handleSelectSession = async (session_id: string) => {
    setCurrentSessionId(session_id);
    setMessagePage(1);
  };
  
  // 删除会话
  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止触发会话选择
    
    if (!confirm('确定要删除这个会话吗？此操作不可恢复。')) {
      return;
    }
    
    try {
      await deleteSession(sessionId);
      
      // 如果删除的是当前会话，切换到新会话
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([{
          id: '1',
          role: 'system',
          content: '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
        }]);
        setSummaries([]);
      }
      
      // 重新加载会话列表
      await loadSessions();
    } catch (error) {
      console.error('[Workflow] Failed to delete session:', error);
      alert('删除会话失败，请重试');
    }
  };
  
  // 手动触发总结
  const handleManualSummarize = async () => {
    if (!currentSessionId || !selectedLLMConfigId || !selectedLLMConfig) {
      alert('请先选择会话和LLM模型');
      return;
    }
    
    try {
      setIsSummarizing(true);
      
      // 获取当前会话的所有消息（用于总结）
      const allMessages = messages.filter(m => m.role !== 'system');
      const messagesToSummarize = allMessages.map(msg => ({
        message_id: msg.id,
        role: msg.role,
        content: msg.content,
        token_count: estimate_tokens(msg.content, selectedLLMConfig.model || 'gpt-4'),
      }));
      
      // 调用总结 API
      const summary = await summarizeSession(currentSessionId, {
        llm_config_id: selectedLLMConfigId,
        model: selectedLLMConfig.model || 'gpt-4',
        messages: messagesToSummarize,
      });
      
      // 重新加载总结列表
      await loadSessionSummaries(currentSessionId);
      
      alert(`总结完成！Token 从 ${summary.token_count_before} 减少到 ${summary.token_count_after}`);
    } catch (error) {
      console.error('[Workflow] Failed to summarize:', error);
      alert('总结失败，请重试');
    } finally {
      setIsSummarizing(false);
    }
  };

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
  
  // 加载工作流列表
  const loadWorkflows = async () => {
    try {
      console.log('[Workflow] Loading workflows...');
      const workflowList = await getWorkflows();
      console.log('[Workflow] Loaded workflows:', workflowList);
      setWorkflows(workflowList);
    } catch (error) {
      console.error('[Workflow] Failed to load workflows:', error);
      setWorkflows([]);
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

  // 注意：MCP现在通过@符号选择，不再使用选择框，此函数已移除

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

    // 检查是否有选定的组件（tag）
    // 处理工作流和MCP，都通过感知元件消息执行
    if (selectedComponents.length > 0) {
      // 使用第一个选定的组件
      const matchedComponent = selectedComponents[0];
      const userInput = input.trim();
      
      if (!userInput) {
        alert('请输入要执行的内容');
        return;
      }
      
      if (matchedComponent) {
        // 先保存用户输入消息
        let sessionId = currentSessionId;
        if (!sessionId) {
          try {
            const newSession = await createSession(selectedLLMConfigId, userInput.substring(0, 50));
            sessionId = newSession.session_id;
            setCurrentSessionId(sessionId);
            await loadSessions();
          } catch (error) {
            console.error('[Workflow] Failed to create session:', error);
          }
        }
        
        const userMessageId = `msg-${Date.now()}`;
        const userMessage: Message = {
          id: userMessageId,
          role: 'user',
          content: userInput,
        };
        
        setMessages(prev => [...prev, userMessage]);
        
        // 保存用户消息
        if (sessionId) {
          try {
            await saveMessage(sessionId, {
              message_id: userMessageId,
              role: 'user',
              content: userInput,
              model: selectedLLMConfig.model || 'gpt-4',
            });
          } catch (error) {
            console.error('[Workflow] Failed to save user message:', error);
          }
        }
        
        // 如果组件消息还不存在，添加感知组件消息
        // 检查是否已经有对应的感知组件消息
        const existingComponentMessage = messages.find(m => 
          m.role === 'tool' && 
          m.toolType === matchedComponent.type && 
          m.workflowId === matchedComponent.id &&
          m.workflowStatus === 'pending'
        );
        
        let componentMessageId: string;
        if (existingComponentMessage) {
          componentMessageId = existingComponentMessage.id;
        } else {
          // 添加感知组件消息
          await addWorkflowMessage(matchedComponent);
          
          // 等待消息添加到列表
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // 找到刚添加的感知组件消息
          const currentMessages = messages;
          const componentMessages = currentMessages.filter(m => 
            m.role === 'tool' && 
            m.toolType === matchedComponent.type && 
            m.workflowId === matchedComponent.id
          );
          let latestComponentMessage = componentMessages[componentMessages.length - 1];
          
          // 如果找不到，从最新的消息中查找
          if (!latestComponentMessage) {
            // 等待状态更新
            await new Promise(resolve => setTimeout(resolve, 200));
            const updatedMessages = messages;
            const updatedComponentMessages = updatedMessages.filter(m => 
              m.role === 'tool' && 
              m.toolType === matchedComponent.type && 
              m.workflowId === matchedComponent.id
            );
            latestComponentMessage = updatedComponentMessages[updatedComponentMessages.length - 1];
          }
          
          if (!latestComponentMessage) {
            console.error('[Workflow] Failed to find component message after adding');
            return;
          }
          
          componentMessageId = latestComponentMessage.id;
        }
        
        // 执行感知组件，传递用户输入
        await handleExecuteWorkflow(componentMessageId, userInput, sessionId);
        
        // 清空已选择的组件（执行后清空，方便下次使用）
        setSelectedComponents([]);
        
        setInput('');
        return;
      }
    }

    // 检查是否有待执行的工作流，如果有则回退到工作流消息之前
    const lastWorkflowMessage = messages.filter(m => m.role === 'tool' && m.workflowStatus === 'pending').pop();
    if (lastWorkflowMessage) {
      const workflowIndex = messages.findIndex(m => m.id === lastWorkflowMessage.id);
      if (workflowIndex >= 0) {
        // 回退到工作流消息之前（保留工作流消息之前的所有消息）
        const targetMessage = workflowIndex > 0 ? messages[workflowIndex - 1] : messages[0];
        await rollbackMessages(targetMessage.id);
      }
    }

    // 如果没有当前会话，创建新会话
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const newSession = await createSession(selectedLLMConfigId, input.trim().substring(0, 50));
        sessionId = newSession.session_id;
        setCurrentSessionId(sessionId);
        await loadSessions();
      } catch (error) {
        console.error('[Workflow] Failed to create session:', error);
        // 继续执行，即使创建会话失败
      }
    }

    // MCP 服务器是可选的，不需要强制选择

    const userMessageId = `msg-${Date.now()}`;
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content: input.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    
    // 保存用户消息到数据库
    if (sessionId) {
      try {
        await saveMessage(sessionId, {
          message_id: userMessageId,
          role: 'user',
          content: userMessage.content,
          model: selectedLLMConfig.model || 'gpt-4',
        });
      } catch (error) {
        console.error('[Workflow] Failed to save user message:', error);
      }
    }

    try {
      // 获取API密钥（Ollama 不需要 API key）
      const apiKey = await getLLMConfigApiKey(selectedLLMConfigId);
      if (selectedLLMConfig.provider !== 'ollama' && !apiKey) {
        throw new Error('API密钥未配置，请检查LLM配置');
      }

      // 收集所有可用的MCP工具
      // 注意：MCP现在通过@符号选择，不再使用selectedMcpServerIds
      // 如果通过@选择了MCP，会在selectedComponents中处理
      const allTools: MCPTool[] = [];
      
      // 如果通过@选择了MCP组件，收集其工具
      const mcpComponent = selectedComponents.find(c => c.type === 'mcp');
      if (mcpComponent) {
        const tools = mcpTools.get(mcpComponent.id) || [];
        allTools.push(...tools);
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
      
      // 添加历史总结（如果有）
      if (summaries.length > 0) {
        const summaryTexts = summaries.map(s => s.summary_content).join('\n\n');
        systemPrompt += `\n\n以下是之前对话的总结，请参考这些上下文：\n\n${summaryTexts}\n\n`;
      }
      
      if (allTools.length > 0) {
        systemPrompt += `\n\n你可以使用以下 MCP 工具来帮助用户完成任务：\n\n${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n当用户需要执行操作时，使用相应的工具。用中文回复用户，并清晰地说明你执行的操作和结果。`;
      } else {
        systemPrompt += '请根据用户的问题提供有用的回答和建议。用中文回复用户。';
      }

      // 构建消息历史（用于 token 计数和自动 summarize）
      const model = selectedLLMConfig.model || 'gpt-4';
      const maxTokens = get_model_max_tokens(model);
      const tokenThreshold = maxTokens - 1000; // 在限额-1000时触发 summarize
      
      // 获取当前会话的所有消息（不包括系统消息）
      const conversationMessages = messages
        .filter(m => m.role !== 'system')
        .map(msg => ({
          role: msg.role,
          content: msg.content,
          thinking: msg.thinking,
        }));
      
      // 估算当前 token 数量
      const currentTokens = estimate_messages_tokens(conversationMessages, model);
      
      // 检查是否需要自动 summarize
      let needsSummarize = false;
      if (currentTokens > tokenThreshold) {
        console.log(`[Workflow] Token count (${currentTokens}) exceeds threshold (${tokenThreshold}), triggering summarize`);
        needsSummarize = true;
      }
      
      // 如果需要 summarize，先执行总结
      if (needsSummarize && sessionId) {
        try {
          setIsSummarizing(true);
          const messagesToSummarize = conversationMessages.slice(0, -1); // 不包括当前用户消息
          const summary = await summarizeSession(sessionId, {
            llm_config_id: selectedLLMConfigId,
            model: model,
            messages: messagesToSummarize.map((msg, idx) => ({
              message_id: messages.find(m => m.content === msg.content)?.id || `msg-${idx}`,
              role: msg.role,
              content: msg.content,
            })),
          });
          
          // 重新加载总结列表
          await loadSessionSummaries(sessionId);
          
          // 更新系统提示词，包含新的总结
          const newSummaryText = summary.summary_content;
          systemPrompt = systemPrompt.replace(
            /以下是之前对话的总结[^]*?\n\n/,
            `以下是之前对话的总结，请参考这些上下文：\n\n${newSummaryText}\n\n`
          );
          
          console.log(`[Workflow] Auto-summarized: ${summary.token_count_before} -> ${summary.token_count_after} tokens`);
        } catch (error) {
          console.error('[Workflow] Auto-summarize failed:', error);
          // 继续执行，即使 summarize 失败
        } finally {
          setIsSummarizing(false);
        }
      }

      // 创建流式响应的消息
      const assistantMessageId = `msg-${Date.now() + 1}`;
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        thinking: '',
        isStreaming: true,
        isThinking: true, // 初始状态为思考中
      };
      setMessages(prev => [...prev, assistantMessage]);
      // 默认折叠思考过程
      setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));

      // 使用LLM客户端处理用户请求（自动调用MCP工具）
      let fullResponse = '';
      let fullThinking = '';
      let hasStartedContent = false; // 标记是否开始输出内容
      
      // 创建临时消息更新函数
      const updateMessage = (content: string, thinking?: string, isThinking?: boolean, isStreaming?: boolean) => {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { 
                ...msg, 
                content, 
                thinking: thinking !== undefined ? thinking : msg.thinking,
                isThinking: isThinking !== undefined ? isThinking : msg.isThinking,
                isStreaming: isStreaming !== undefined ? isStreaming : msg.isStreaming,
              }
            : msg
        ));
      };

      if (streamEnabled) {
        // 流式响应模式
        const response = await llmClient.handleUserRequestWithThinking(
          userMessage.content,
          systemPrompt,
          allTools.length > 0 ? allTools : undefined,
          true, // 启用流式响应
          (chunk: string, thinking?: string) => {
            // 流式更新消息内容
            if (chunk) {
              fullResponse += chunk;
              hasStartedContent = true;
              // 如果开始输出内容，切换到回答状态，但保持流式
              updateMessage(fullResponse, fullThinking, false, true);
            }
            if (thinking !== undefined && thinking.length > 0) {
              fullThinking = thinking; // 流式更新思考过程
              // 如果有思考内容但还没有开始输出内容，保持思考状态
              if (!hasStartedContent) {
                updateMessage(fullResponse, fullThinking, true, true);
              } else {
                // 如果已经开始输出内容，思考过程应该展开但标记为回答中
                updateMessage(fullResponse, fullThinking, false, true);
              }
            }
          }
        );

        // 确保最终内容已更新（包括思考过程）
        // 结果完成后，自动折叠思考并更新状态为完成
        const finalContent = response.content || fullResponse;
        const finalThinking = response.thinking || fullThinking;
        updateMessage(finalContent, finalThinking, false, false);
        // 自动折叠思考过程（如果有思考内容）
        if (finalThinking && finalThinking.trim().length > 0) {
          setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));
        }
        
        // 保存助手消息到数据库（流式响应模式）
        if (sessionId) {
          try {
            await saveMessage(sessionId, {
              message_id: assistantMessageId,
              role: 'assistant',
              content: finalContent, // 保存完整的回答内容
              thinking: finalThinking, // 保存思考过程
              model: selectedLLMConfig.model || 'gpt-4',
            });
            console.log('[Workflow] Saved assistant message to database:', assistantMessageId);
          } catch (error) {
            console.error('[Workflow] Failed to save assistant message:', error);
          }
        }
      } else {
        // 非流式响应模式
        const response = await llmClient.handleUserRequestWithThinking(
          userMessage.content,
          systemPrompt,
          allTools.length > 0 ? allTools : undefined,
          false // 禁用流式响应
        );
        updateMessage(response.content, response.thinking, false, false);
        // 自动折叠思考过程（如果有思考内容）
        if (response.thinking && response.thinking.trim().length > 0) {
          setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));
        }
        
        // 保存助手消息到数据库（非流式响应模式）
        if (sessionId) {
          try {
            await saveMessage(sessionId, {
              message_id: assistantMessageId,
              role: 'assistant',
              content: response.content, // 保存完整的回答内容
              thinking: response.thinking, // 保存思考过程
              model: selectedLLMConfig.model || 'gpt-4',
            });
            console.log('[Workflow] Saved assistant message to database:', assistantMessageId);
          } catch (error) {
            console.error('[Workflow] Failed to save assistant message:', error);
          }
        }
      }
      
      // 无论流式还是非流式，完成后都更新 isLoading 状态
      setIsLoading(false);
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

  const toggleThinkingCollapse = (messageId: string) => {
    setCollapsedThinking(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };
  
  // 处理输入框变化，检测 @ 符号
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    
    // 检测 @ 符号
    const cursorPosition = e.target.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    console.log('[Workflow] Input change:', {
      value,
      cursorPosition,
      textBeforeCursor,
      lastAtIndex,
      showAtSelector,
    });
    
    if (lastAtIndex !== -1) {
      // 检查 @ 后面是否有空格或换行（如果有，说明不是在选择组件）
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const hasSpaceOrNewline = textAfterAt.includes(' ') || textAfterAt.includes('\n');
      
      console.log('[Workflow] @ symbol detected:', {
        textAfterAt,
        hasSpaceOrNewline,
      });
      
      if (!hasSpaceOrNewline) {
        // 检查是否已经选择了感知组件
        if (selectedComponents.length > 0) {
          // 已经选择了组件，提示需要先删除
          console.log('[Workflow] Component already selected, need to remove first');
          setShowAtSelector(false);
          // 可以显示一个提示，但先不显示选择器
          return;
        }
        
        // 显示选择器
        const query = textAfterAt.toLowerCase();
        setAtSelectorIndex(lastAtIndex);
        setAtSelectorQuery(query);
        
        console.log('[Workflow] Showing selector with query:', query);
        
        // 计算选择器位置（精确跟随@符号位置）
        if (inputRef.current) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          
          // 使用更精确的方法：创建一个临时div来测量@符号的精确位置
          const tempDiv = document.createElement('div');
          const styles = window.getComputedStyle(textarea);
          
          // 复制textarea的所有相关样式
          tempDiv.style.position = 'absolute';
          tempDiv.style.visibility = 'hidden';
          tempDiv.style.whiteSpace = 'pre-wrap';
          tempDiv.style.wordWrap = 'break-word';
          tempDiv.style.overflowWrap = 'break-word';
          tempDiv.style.font = styles.font;
          tempDiv.style.fontSize = styles.fontSize;
          tempDiv.style.fontFamily = styles.fontFamily;
          tempDiv.style.fontWeight = styles.fontWeight;
          tempDiv.style.fontStyle = styles.fontStyle;
          tempDiv.style.letterSpacing = styles.letterSpacing;
          tempDiv.style.textTransform = styles.textTransform;
          tempDiv.style.padding = styles.padding;
          tempDiv.style.border = styles.border;
          tempDiv.style.width = `${textarea.offsetWidth}px`;
          tempDiv.style.boxSizing = styles.boxSizing;
          tempDiv.style.lineHeight = styles.lineHeight;
          tempDiv.style.wordSpacing = styles.wordSpacing;
          
          // 设置文本内容到@符号位置（包括换行）
          const textBeforeAt = value.substring(0, lastAtIndex);
          // 使用textContent来保持换行
          tempDiv.textContent = textBeforeAt;
          document.body.appendChild(tempDiv);
          
          // 创建一个span来测量@符号的位置
          const atSpan = document.createElement('span');
          atSpan.textContent = '@';
          tempDiv.appendChild(atSpan);
          
          // 获取@符号的位置
          const atRect = atSpan.getBoundingClientRect();
          
          // 清理临时元素
          document.body.removeChild(tempDiv);
          
          // 选择器尺寸
          const selectorHeight = 256; // max-h-64 = 256px
          const selectorWidth = 300; // maxWidth
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          
          // 计算选择器位置（在@符号下方，紧跟光标）
          let top = atRect.bottom + 5;
          let left = atRect.left;
          
          // 如果选择器会超出底部，则显示在@符号上方
          if (top + selectorHeight > viewportHeight - 10) {
            top = atRect.top - selectorHeight - 5;
            // 如果上方也不够，就显示在@符号下方（即使会超出）
            if (top < 10) {
              top = atRect.bottom + 5;
            }
          }
          
          // 确保选择器不会超出右侧边界
          if (left + selectorWidth > viewportWidth - 10) {
            left = viewportWidth - selectorWidth - 10;
          }
          
          // 确保不会超出左侧
          if (left < 10) {
            left = 10;
          }
          
          // 确保不会超出顶部
          if (top < 10) {
            top = atRect.bottom + 5;
          }
          
          console.log('[Workflow] Selector position calculated:', { 
            top, 
            left, 
            atRect,
            textareaRect,
            viewportHeight,
            viewportWidth,
            lastAtIndex,
            cursorPosition
          });
          
          setAtSelectorPosition({ top, left });
          setShowAtSelector(true);
          setSelectedComponentIndex(0); // 重置选中索引
        } else {
          console.warn('[Workflow] inputRef.current is null');
        }
      } else {
        console.log('[Workflow] Hiding selector: space or newline after @');
        setShowAtSelector(false);
      }
    } else {
      console.log('[Workflow] No @ symbol found, hiding selector');
      setShowAtSelector(false);
    }
  };
  
  // 获取可选择的组件列表（用于键盘导航）
  const getSelectableComponents = React.useCallback(() => {
    const mcpList = mcpServers
      .filter(s => 
        connectedMcpServerIds.has(s.id) &&
        s.name.toLowerCase().includes(atSelectorQuery)
      )
      .map(s => ({ type: 'mcp' as const, id: s.id, name: s.name }));
    
    const workflowList = workflows
      .filter(w => w.name.toLowerCase().includes(atSelectorQuery))
      .map(w => ({ type: 'workflow' as const, id: w.workflow_id, name: w.name }));
    
    return [...mcpList, ...workflowList];
  }, [mcpServers, connectedMcpServerIds, workflows, atSelectorQuery]);
  
  // 选择感知组件（添加为 tag）
  const handleSelectComponent = (component: { type: 'mcp' | 'workflow'; id: string; name: string }) => {
    if (atSelectorIndex === -1) return;
    
    // 检查是否已经选择了组件（限制只能选择一个）
    if (selectedComponents.length > 0) {
      console.log('[Workflow] Component already selected, cannot add another');
      // 显示提示信息
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '⚠️ 只能选择一个感知组件。请先删除已选择的组件，然后再选择新的组件。',
      };
      setMessages(prev => [...prev, errorMsg]);
      setShowAtSelector(false);
      setAtSelectorIndex(-1);
      setAtSelectorQuery('');
      return;
    }
    
    // 检查是否已经添加过该组件
    const isAlreadySelected = selectedComponents.some(
      c => c.id === component.id && c.type === component.type
    );
    
    if (!isAlreadySelected) {
      // 添加到已选定的组件列表
      setSelectedComponents(prev => [...prev, component]);
      
      // 如果是MCP服务器，检查是否已连接
      if (component.type === 'mcp') {
        if (!connectedMcpServerIds.has(component.id)) {
          console.warn('[Workflow] MCP server not connected:', component.name);
          alert(`MCP服务器 "${component.name}" 未连接，请先连接后再使用`);
          // 移除未连接的组件
          setSelectedComponents(prev => prev.filter(c => !(c.id === component.id && c.type === component.type)));
          return;
        }
      }
      
      // 注意：感知元件消息会在发送消息时添加，方便在聊天框中展示执行过程和重放
      console.log('[Workflow] Selected component:', component.name, component.type);
    }
    
    // 移除输入框中的 @ 符号及其后的内容
    const beforeAt = input.substring(0, atSelectorIndex);
    const afterAt = input.substring(atSelectorIndex + 1);
    const spaceIndex = afterAt.indexOf(' ');
    const newlineIndex = afterAt.indexOf('\n');
    const endIndex = spaceIndex !== -1 && newlineIndex !== -1 
      ? Math.min(spaceIndex, newlineIndex)
      : spaceIndex !== -1 
      ? spaceIndex 
      : newlineIndex !== -1 
      ? newlineIndex 
      : afterAt.length;
    
    // 移除 @ 符号和查询文本，保留后续内容
    const newInput = beforeAt + afterAt.substring(endIndex);
    setInput(newInput);
    setShowAtSelector(false);
    setAtSelectorIndex(-1);
    setAtSelectorQuery('');
    
    // 聚焦输入框
    if (inputRef.current) {
      inputRef.current.focus();
      const newCursorPos = atSelectorIndex;
      setTimeout(() => {
        inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };
  
  // 删除选定的组件（tag）
  const handleRemoveComponent = (index: number) => {
    const component = selectedComponents[index];
    if (component) {
      console.log('[Workflow] Removed component:', component.name, component.type);
    }
    setSelectedComponents(prev => prev.filter((_, i) => i !== index));
  };

  // 处理拖拽组件到对话框
  const handleDropComponent = async (component: { type: 'mcp' | 'workflow'; id: string; name: string }) => {
    if (!currentSessionId) {
      // 如果没有会话，先创建
      try {
        const newSession = await createSession(
          selectedLLMConfigId || undefined,
          `会话 - ${component.name}`
        );
        setCurrentSessionId(newSession.session_id);
        await loadSessions();
        // 创建会话后添加工作流消息
        addWorkflowMessage(component);
      } catch (error) {
        console.error('[Workflow] Failed to create session:', error);
        alert('创建会话失败，请重试');
      }
    } else {
      addWorkflowMessage(component);
    }
  };
  
  // 添加工作流消息（保存到数据库，以便后端API能够找到并执行）
  const addWorkflowMessage = async (component: { type: 'mcp' | 'workflow'; id: string; name: string }) => {
    const workflowMessageId = `workflow-${Date.now()}`;
    
    // 如果是工作流，获取详细信息（包括节点）
    let workflowDetails: WorkflowType | null = null;
    if (component.type === 'workflow') {
      try {
        workflowDetails = await getWorkflow(component.id);
        console.log('[Workflow] Loaded workflow details:', workflowDetails);
      } catch (error) {
        console.error('[Workflow] Failed to load workflow details:', error);
      }
    }
    
    const workflowMessage: Message = {
      id: workflowMessageId,
      role: 'tool',
      content: '',
      toolType: component.type, // 'workflow' 或 'mcp'
      workflowId: component.id,
      workflowName: component.name,
      workflowStatus: 'pending',
      workflowConfig: workflowDetails?.config, // 保存工作流配置（节点和连接）
    };
    
    setMessages(prev => [...prev, workflowMessage]);
    
    // 保存消息到数据库，tool_calls字段包含组件信息，以便后端API能够找到并执行
    if (currentSessionId) {
      try {
        await saveMessage(currentSessionId, {
          message_id: workflowMessageId,
          role: 'tool',
          content: '',
          tool_calls: {
            toolType: component.type,
            workflowId: component.id,
            workflowName: component.name,
            workflowStatus: 'pending',
            workflowConfig: workflowDetails?.config,
          },
        });
        console.log('[Workflow] Saved workflow message to database:', workflowMessageId);
      } catch (error) {
        console.error('[Workflow] Failed to save workflow message:', error);
      }
    }
  };
  
  // 执行工作流
  const handleExecuteWorkflow = async (messageId: string, providedInput?: string, sessionId?: string | null) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || !message.workflowId) {
      console.error('[Workflow] Cannot execute workflow: message not found or missing workflowId', { messageId, message });
      alert('无法执行工作流：缺少必要信息');
      return;
    }
    
    // 检查是否选择了LLM配置
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      alert('请先选择 LLM 模型');
      return;
    }
    
    // 优先使用提供的输入，否则从消息历史中查找
    let input = providedInput || '';
    
    if (!input) {
      // 获取上一条消息作为输入（跳过其他工作流消息，找到用户消息）
      const messageIndex = messages.findIndex(m => m.id === messageId);
      let previousUserMessage: Message | null = null;
      for (let i = messageIndex - 1; i >= 0; i--) {
        const msg = messages[i];
        // 优先找用户消息，如果没有再找助手消息
        if (msg.role === 'user') {
          previousUserMessage = msg;
          break;
        } else if (msg.role === 'assistant' && !previousUserMessage) {
          // 如果助手消息不是提示消息，也可以作为输入
          if (!msg.content.includes('收到感知组件指令')) {
            previousUserMessage = msg;
          }
        }
      }
      
      input = previousUserMessage?.content || '';
    }
    
    if (!input) {
      alert('缺少输入内容，无法执行感知组件');
      return;
    }
    
    // 清空之前的日志
    setExecutionLogs(prev => {
      const newMap = new Map(prev);
      newMap.set(messageId, []);
      return newMap;
    });
    
    // 自动展开执行过程
    setExpandedExecutions(prev => new Set(prev).add(messageId));
    
    // 更新消息状态为运行中
    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? { ...msg, workflowStatus: 'running' }
        : msg
    ));
    
    // 添加初始日志
    const addExecutionLog = (log: string) => {
      setExecutionLogs(prev => {
        const newMap = new Map(prev);
        const logs = newMap.get(messageId) || [];
        newMap.set(messageId, [...logs, `[${new Date().toLocaleTimeString()}] ${log}`]);
        return newMap;
      });
    };
    
    addExecutionLog('开始执行感知组件...');
    addExecutionLog(`组件类型: ${message.toolType === 'workflow' ? '工作流' : 'MCP服务器'}`);
    addExecutionLog(`组件名称: ${message.workflowName || message.workflowId}`);
    addExecutionLog(`使用LLM: ${selectedLLMConfig.name} (${selectedLLMConfig.model})`);
    addExecutionLog(`输入内容: ${input.substring(0, 100)}${input.length > 100 ? '...' : ''}`);
    
    try {
      // 使用新的 message_execution API 执行感知组件
      addExecutionLog('正在调用执行API...');
      const execution = await executeMessageComponent(
        messageId,
        selectedLLMConfigId,
        input
      );
      
      addExecutionLog(`执行状态: ${execution.status}`);
      
      // 获取完整结果
      const fullResult = execution.result || execution.error_message || '执行完成';
      const status = execution.status === 'completed' ? 'completed' : 'error';
      
      // 从结果中分离出纯结果内容和日志
      let resultContent = fullResult;
      let componentLogs: string[] = [];
      
      if (fullResult && typeof fullResult === 'string') {
        // 查找"执行日志:"分隔符
        const logMatch = fullResult.match(/执行日志:\s*\n(.*)/s);
        if (logMatch) {
          // 分离结果内容和日志
          resultContent = fullResult.substring(0, logMatch.index).trim();
          const logsText = logMatch[1].trim();
          componentLogs = logsText.split('\n').filter(log => log.trim());
          
          // 只添加组件相关的日志到执行日志中（过滤掉执行结果内容）
          componentLogs.forEach(log => {
            const trimmedLog = log.trim();
            // 过滤掉执行结果相关的内容，只保留组件执行过程的日志
            if (trimmedLog && 
                !trimmedLog.includes('MCP服务器') && 
                !trimmedLog.includes('执行完成') && 
                !trimmedLog.includes('输入:') &&
                !trimmedLog.includes('执行了') &&
                !trimmedLog.includes('工具:') &&
                !trimmedLog.includes('结果:') &&
                !trimmedLog.includes('错误:') &&
                trimmedLog.startsWith('[')) { // 只保留带时间戳的日志
              addExecutionLog(trimmedLog);
            }
          });
        } else {
          // 如果没有日志分隔符，尝试从结果中提取组件日志
          // 查找类似 "[时间] 消息" 格式的日志
          const logPattern = /\[\d{2}:\d{2}:\d{2}\]\s*(.+)/g;
          let match;
          while ((match = logPattern.exec(fullResult)) !== null) {
            const logMsg = match[1].trim();
            if (logMsg && !logMsg.includes('MCP服务器') && !logMsg.includes('执行完成')) {
              componentLogs.push(logMsg);
              addExecutionLog(logMsg);
            }
          }
        }
      }
      
      addExecutionLog(status === 'completed' ? '✅ 执行完成' : '❌ 执行失败');
      
      // 更新感知组件消息状态（不包含结果内容，只显示状态）
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { 
              ...msg, 
              workflowStatus: status,
            }
          : msg
      ));
      
      // 将执行结果作为独立的assistant消息输出（支持流式）
      if (resultContent && resultContent.trim()) {
        const assistantMessageId = `assistant-${Date.now()}`;
        const assistantMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          isStreaming: streamEnabled,
        };
        
        setMessages(prev => [...prev, assistantMessage]);
        
        if (streamEnabled) {
          // 流式输出结果
          let displayedContent = '';
          const words = resultContent.split('');
          
          for (let i = 0; i < words.length; i++) {
            displayedContent += words[i];
            setMessages(prev => prev.map(msg =>
              msg.id === assistantMessageId
                ? { ...msg, content: displayedContent, isStreaming: true }
                : msg
            ));
            
            // 控制流式输出速度
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          
          // 完成流式输出
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMessageId
              ? { ...msg, content: displayedContent, isStreaming: false }
              : msg
          ));
        } else {
          // 非流式输出，直接显示完整内容
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMessageId
              ? { ...msg, content: resultContent, isStreaming: false }
              : msg
          ));
        }
        
        // 保存assistant消息到数据库
        if (sessionId) {
          try {
            await saveMessage(sessionId, {
              message_id: assistantMessageId,
              role: 'assistant',
              content: resultContent,
              model: selectedLLMConfig.model || 'gpt-4',
            });
            console.log('[Workflow] Saved component execution result as assistant message:', assistantMessageId);
          } catch (error) {
            console.error('[Workflow] Failed to save assistant message:', error);
          }
        }
      }
      
      console.log('[Workflow] Execution completed:', execution);
      
    } catch (error) {
      console.error('[Workflow] Failed to execute workflow:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      addExecutionLog(`❌ 执行出错: ${errorMsg}`);
      
      // 更新感知组件消息状态
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { 
              ...msg, 
              workflowStatus: 'error',
            }
          : msg
      ));
      
      // 将错误信息作为独立的assistant消息输出
      const assistantMessageId = `assistant-error-${Date.now()}`;
      const errorMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: `❌ 执行失败: ${errorMsg}`,
        isStreaming: false,
      };
      
      setMessages(prev => [...prev, errorMessage]);
      
      // 保存错误消息到数据库
      if (sessionId) {
        try {
          await saveMessage(sessionId, {
            message_id: assistantMessageId,
            role: 'assistant',
            content: `❌ 执行失败: ${errorMsg}`,
            model: selectedLLMConfig.model || 'gpt-4',
          });
        } catch (saveError) {
          console.error('[Workflow] Failed to save error message:', saveError);
        }
      }
      
      console.error('[Workflow] Execution error:', errorMsg);
    }
  };

  // 删除工作流消息
  const handleDeleteWorkflowMessage = async (messageId: string) => {
    if (!confirm('确定要删除这个感知流程吗？')) {
      return;
    }
    
    // 从消息列表中删除
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
    
    // 从数据库删除（如果已保存）
    if (currentSessionId) {
      try {
        await deleteMessage(currentSessionId, messageId);
        console.log('[Workflow] Deleted workflow message:', messageId);
      } catch (error) {
        console.error('[Workflow] Failed to delete workflow message:', error);
        // 如果删除失败，恢复消息到列表中
        const message = messages.find(m => m.id === messageId);
        if (message) {
          setMessages(prev => [...prev, message]);
          alert('删除失败，请重试');
        }
      }
    }
  };
  
  // 回退消息到指定位置（用于重新触发）
  const rollbackMessages = async (targetMessageId: string) => {
    const targetIndex = messages.findIndex(m => m.id === targetMessageId);
    if (targetIndex === -1) {
      // 如果找不到目标消息，回退到第一条消息
      setMessages(prev => prev.slice(0, 1));
      return;
    }
    
    // 找到回退范围内的所有消息ID
    const messagesToDelete = messages.slice(targetIndex + 1).map(m => m.id);
    
    // 检查回退范围内是否有工作流消息或AI回复（可能触发过summarize）
    const rollbackMessagesList = messages.slice(targetIndex + 1);
    const hasWorkflowOrAssistant = rollbackMessagesList.some(msg => 
      msg.role === 'tool' || msg.role === 'assistant'
    );
    
    // 如果回退范围内有工作流或AI回复，且存在summaries，删除summary缓存
    if (hasWorkflowOrAssistant && summaries.length > 0 && currentSessionId) {
      try {
        await clearSummarizeCache(currentSessionId);
        // 重新加载summaries
        await loadSessionSummaries(currentSessionId);
        console.log('[Workflow] Cleared summarize cache due to rollback');
      } catch (error) {
        console.error('[Workflow] Failed to clear summarize cache:', error);
      }
    }
    
    // 回退消息列表
    setMessages(prev => prev.slice(0, targetIndex + 1));
    
    // 从数据库删除回退的消息（如果已保存）
    if (currentSessionId && messagesToDelete.length > 0) {
      try {
        // TODO: 批量删除消息的API
        console.log('[Workflow] Rolled back messages:', messagesToDelete);
      } catch (error) {
        console.error('[Workflow] Failed to rollback messages:', error);
      }
    }
  };

  const renderMessageContent = (message: Message) => {
    // 工具消息（感知组件）
    if (message.role === 'tool' && message.toolType) {
      const workflowConfig = message.workflowConfig;
      const nodes = workflowConfig?.nodes || [];
      const connections = workflowConfig?.connections || [];
      
      // 获取节点类型统计
      const nodeTypeCounts = nodes.reduce((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      return (
        <div className="w-full bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-lg">
          {/* 标题栏和删除按钮 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${
                message.toolType === 'workflow' 
                  ? 'bg-gray-900 dark:bg-gray-100' 
                  : 'bg-gray-800 dark:bg-gray-200'
              }`}>
                {message.toolType === 'workflow' ? (
                  <WorkflowIcon className="w-5 h-5 text-white dark:text-gray-900" />
                ) : (
                  <Plug className="w-5 h-5 text-white dark:text-gray-900" />
                )}
              </div>
              <div>
                <div className="font-semibold text-base text-gray-900 dark:text-gray-100">
                  {message.workflowName || '感知组件'}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {message.toolType === 'workflow' ? '工作流组件' : message.toolType === 'mcp' ? 'MCP服务器' : '感知组件'}
                </div>
              </div>
            </div>
            <button
              onClick={() => handleDeleteWorkflowMessage(message.id)}
              className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
              title="删除感知流程"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          
          {/* 工作流执行流程图 - 优化设计 */}
          <div className="w-full bg-white dark:bg-gray-900 rounded-lg p-5 border-2 border-gray-200 dark:border-gray-700 mb-4 shadow-inner">
            <div className="flex items-center justify-between w-full">
              {/* 输入节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className="w-20 h-20 rounded-2xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 flex items-center justify-center text-sm font-bold shadow-lg mb-3 transition-all">
                  输入
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded">
                  {(() => {
                    const messageIndex = messages.findIndex(m => m.id === message.id);
                    const prevMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;
                    return prevMessage?.content?.substring(0, 25) || '等待输入...';
                  })()}
                </div>
              </div>
              
              {/* 箭头 */}
              <ArrowRight className="w-10 h-10 text-gray-400 dark:text-gray-600 mx-3 flex-shrink-0" />
              
              {/* 工作流节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className={`w-24 h-24 rounded-2xl ${
                  message.workflowStatus === 'running' 
                    ? 'bg-gray-700 dark:bg-gray-300 animate-pulse shadow-xl' 
                    : message.workflowStatus === 'completed'
                    ? 'bg-gray-900 dark:bg-gray-100 shadow-xl'
                    : message.workflowStatus === 'error'
                    ? 'bg-gray-600 dark:bg-gray-500 shadow-lg'
                    : 'bg-gray-800 dark:bg-gray-200 shadow-lg'
                } text-white dark:text-gray-900 flex items-center justify-center text-xs font-bold text-center px-3 mb-3 transition-all`}>
                  <div className="truncate">{message.workflowName || '工作流'}</div>
                </div>
                <div className={`text-xs font-medium px-2 py-1 rounded ${
                  message.workflowStatus === 'pending' ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300' :
                  message.workflowStatus === 'running' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                  message.workflowStatus === 'completed' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                  'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                }`}>
                  {message.workflowStatus === 'pending' ? '待执行' :
                   message.workflowStatus === 'running' ? '执行中...' :
                   message.workflowStatus === 'completed' ? '已完成' :
                   message.workflowStatus === 'error' ? '执行失败' : '未知'}
                </div>
              </div>
              
              {/* 箭头 */}
              <ArrowRight className="w-10 h-10 text-gray-400 dark:text-gray-600 mx-3 flex-shrink-0" />
              
              {/* 输出节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className={`w-20 h-20 rounded-2xl ${
                  message.workflowStatus === 'completed' 
                    ? 'bg-gray-900 dark:bg-gray-100 shadow-xl' 
                    : message.workflowStatus === 'error'
                    ? 'bg-gray-600 dark:bg-gray-500 shadow-lg'
                    : 'bg-gray-300 dark:bg-gray-700 shadow-md'
                } text-white dark:text-gray-900 flex items-center justify-center text-sm font-bold mb-3 transition-all`}>
                  输出
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded">
                  {message.workflowStatus === 'completed' ? '已生成结果' :
                   message.workflowStatus === 'error' ? '执行失败' :
                   '等待输出...'}
                </div>
              </div>
            </div>
          </div>
          
          {/* 工作流内部细节（节点信息） */}
          {message.toolType === 'workflow' && nodes.length > 0 && (
            <div className="w-full bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700 mb-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
                工作流内部结构
              </div>
              <div className="space-y-2">
                {/* 节点类型统计 */}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(nodeTypeCounts).map(([type, count]) => (
                    <div
                      key={type}
                      className="px-2.5 py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs text-gray-700 dark:text-gray-300"
                    >
                      <span className="font-medium">{type}:</span> {count}
                    </div>
                  ))}
                </div>
                
                {/* 节点列表 */}
                <div className="mt-3 space-y-1.5">
                  <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    节点详情:
                  </div>
                  {nodes.map((node) => (
                    <div
                      key={node.id}
                      className="flex items-center space-x-2 px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs"
                    >
                      <div className="w-2 h-2 rounded-full bg-gray-600 dark:bg-gray-400 flex-shrink-0"></div>
                      <span className="text-gray-700 dark:text-gray-300 font-medium">{node.type}</span>
                      {node.data.label && (
                        <span className="text-gray-500 dark:text-gray-500 truncate">- {node.data.label}</span>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* 连接信息 */}
                {connections.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                      连接关系: {connections.length} 条
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* 执行过程区域（始终显示，可展开/折叠） */}
          <div className="mt-4 border-t-2 border-gray-300 dark:border-gray-600 pt-4">
            <button
              onClick={() => {
                setExpandedExecutions(prev => {
                  const newSet = new Set(prev);
                  if (newSet.has(message.id)) {
                    newSet.delete(message.id);
                  } else {
                    newSet.add(message.id);
                  }
                  return newSet;
                });
              }}
              className="w-full flex items-center justify-between text-sm font-semibold text-gray-800 dark:text-gray-200 hover:text-gray-900 dark:hover:text-gray-100 transition-colors py-2"
            >
              <div className="flex items-center space-x-2">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  message.workflowStatus === 'pending' ? 'bg-gray-400' :
                  message.workflowStatus === 'running' ? 'bg-blue-500 animate-pulse' :
                  message.workflowStatus === 'completed' ? 'bg-green-500' :
                  'bg-red-500'
                }`}></div>
                <span>执行过程</span>
                {message.workflowStatus === 'running' && (
                  <Loader className="w-3.5 h-3.5 animate-spin text-blue-500" />
                )}
              </div>
              <div className="flex items-center space-x-2">
                {(() => {
                  const logs = executionLogs.get(message.id) || [];
                  const content = message.content || '';
                  const logMatch = content.match(/执行日志:\s*\n(.*)/s);
                  const contentLogs = logMatch ? logMatch[1].trim().split('\n') : [];
                  const totalLogs = logs.length > 0 ? logs.length : contentLogs.length;
                  if (totalLogs > 0) {
                    return (
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">
                        {totalLogs} 条日志
                      </span>
                    );
                  }
                  return null;
                })()}
                {expandedExecutions.has(message.id) ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </div>
            </button>
            
            {expandedExecutions.has(message.id) && (
              <div className="mt-3 space-y-3">
                {/* 执行状态和操作按钮 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${
                      message.workflowStatus === 'pending' ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300' :
                      message.workflowStatus === 'running' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                      message.workflowStatus === 'completed' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                      'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    }`}>
                      {message.workflowStatus === 'pending' ? '待执行' :
                       message.workflowStatus === 'running' ? '执行中...' :
                       message.workflowStatus === 'completed' ? '已完成' :
                       message.workflowStatus === 'error' ? '执行失败' : '未知'}
                    </span>
                  </div>
                  
                  {/* 执行/重新执行按钮 */}
                  {message.workflowStatus === 'pending' ? (
                    <button
                      onClick={() => handleExecuteWorkflow(message.id, undefined, currentSessionId)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 rounded text-xs font-medium transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      <span>开始执行</span>
                    </button>
                  ) : message.workflowStatus === 'running' ? (
                    <div className="flex items-center space-x-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <Loader className="w-3 h-3 animate-spin" />
                      <span>执行中...</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleExecuteWorkflow(message.id, undefined, currentSessionId)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 rounded text-xs font-medium transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      <span>重新执行</span>
                    </button>
                  )}
                </div>
                
                {/* 执行日志（实时显示） */}
                <div className="bg-gray-900 dark:bg-gray-950 rounded-lg border border-gray-700 dark:border-gray-600 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-800 dark:bg-gray-900 border-b border-gray-700 dark:border-gray-600 flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-300 dark:text-gray-400">
                      执行日志
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      {(() => {
                        const logs = executionLogs.get(message.id) || [];
                        const content = message.content || '';
                        const logMatch = content.match(/执行日志:\s*\n(.*)/s);
                        const contentLogs = logMatch ? logMatch[1].trim().split('\n') : [];
                        return logs.length > 0 ? logs.length : contentLogs.length;
                      })()} 条
                    </div>
                  </div>
                  <div className="p-3 max-h-96 overflow-y-auto">
                    <div className="font-mono text-xs text-green-400 dark:text-green-300 space-y-1">
                      {(() => {
                        // 优先显示实时日志，如果没有则显示内容中的日志
                        const realtimeLogs = executionLogs.get(message.id) || [];
                        if (realtimeLogs.length > 0) {
                          return realtimeLogs.map((log, idx) => (
                            <div key={idx} className="mb-1">
                              {log}
                            </div>
                          ));
                        }
                        
                        // 从content中提取日志
                        const content = message.content || '';
                        const logMatch = content.match(/执行日志:\s*\n(.*)/s);
                        const logs = logMatch ? logMatch[1].trim().split('\n') : [];
                        
                        if (logs.length > 0) {
                          return logs.map((log, idx) => (
                            <div key={idx} className="mb-1">
                              {log}
                            </div>
                          ));
                        }
                        
                        // 如果没有日志，显示提示
                        return (
                          <div className="text-gray-500 dark:text-gray-500 italic">
                            {message.workflowStatus === 'pending' ? '等待执行...' :
                             message.workflowStatus === 'running' ? '执行中，日志将实时显示...' :
                             '暂无执行日志'}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                
                {/* 执行结果（仅在完成或失败时显示） */}
                {(message.workflowStatus === 'completed' || message.workflowStatus === 'error') && message.content && (
                  <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
                      {message.workflowStatus === 'completed' ? '执行结果' : '执行失败'}
                    </div>
                    {(() => {
                      const content = message.content || '';
                      const logMatch = content.match(/执行日志:\s*\n(.*)/s);
                      const mainContent = logMatch ? content.substring(0, logMatch.index) : content;
                      
                      return (
                        <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                          {mainContent.trim()}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }
    
    // 普通工具调用消息（不是感知组件）
    if (message.role === 'tool' && message.toolCalls && !message.toolType) {
      return (
        <div>
          <div className="font-medium text-sm mb-2">工具调用:</div>
          {message.toolCalls.map((toolCall, idx) => (
            <div key={idx} className="mb-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <Wrench className="w-4 h-4 text-blue-500" />
                <span className="font-medium text-sm">{toolCall.name}</span>
              </div>
              {toolCall.arguments && (
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                  <span className="font-medium">参数:</span>
                  <pre className="mt-1 bg-white dark:bg-gray-900 p-2 rounded border text-xs overflow-auto">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                </div>
              )}
              {toolCall.result && (
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  <span className="font-medium">结果:</span>
                  <pre className="mt-1 bg-white dark:bg-gray-900 p-2 rounded border text-xs overflow-auto">
                    {JSON.stringify(toolCall.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    const isThinkingCollapsed = collapsedThinking.has(message.id);
    const hasThinking = message.thinking && message.thinking.trim().length > 0;

    return (
      <div>
        {hasThinking && (
          <div className="mb-3 border-b border-gray-200 dark:border-gray-700 pb-3">
            <button
              onClick={() => toggleThinkingCollapse(message.id)}
              className="flex items-center space-x-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mb-2"
            >
              {isThinkingCollapsed ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
              <span className="font-medium">思考过程</span>
            </button>
            {!isThinkingCollapsed && (
              <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 font-mono leading-relaxed whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                {message.thinking}
                {message.isStreaming && message.isThinking && (
                  <span className="inline-block ml-2 w-1.5 h-1.5 bg-blue-500 dark:bg-blue-400 rounded-full animate-pulse"></span>
                )}
              </div>
            )}
          </div>
        )}
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
          {message.content}
        </div>
      </div>
    );
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
        <div className="flex items-center space-x-2">
          {/* Summarize 按钮 */}
          {currentSessionId && messages.filter(m => m.role !== 'system').length > 0 && (
            <button
              onClick={handleManualSummarize}
              disabled={isSummarizing}
              className="btn-primary flex items-center space-x-1.5 px-3 py-1.5 text-sm disabled:opacity-50"
              title="总结当前会话内容"
            >
              {isSummarizing ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>总结</span>
            </button>
          )}
        </div>
      </div>

      {/* 主要内容区域：左侧配置 + 右侧聊天 */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* 左侧配置面板 */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
          {/* LLM模型选择模块 */}
          <div className="card p-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
              <Brain className="w-4 h-4 inline mr-1" />
              LLM 模型 *
            </label>
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={streamEnabled}
                  onChange={(e) => setStreamEnabled(e.target.checked)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="text-xs text-gray-600">流式响应</span>
              </label>
            </div>
            <div className="relative">
            <select
              value={selectedLLMConfigId || ''}
              onChange={(e) => {
                console.log('[Workflow] Select onChange:', e.target.value);
                handleLLMConfigChange(e.target.value);
              }}
                className="input-field w-full text-sm appearance-none pr-8"
            >
              <option value="">请选择LLM模型...</option>
              {llmConfigs.map((config) => (
                <option key={config.config_id} value={config.config_id}>
                  {config.name} {config.model && `(${config.model})`} [{config.provider}]
                </option>
              ))}
            </select>
              {selectedLLMConfig && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  {(() => {
                    const provider = selectedLLMConfig.provider.toLowerCase();
                    switch (provider) {
                      case 'openai':
                        return <Brain className="w-4 h-4 text-[#10A37F]" />;
                      case 'anthropic':
                        return <Brain className="w-4 h-4 text-[#D4A574]" />;
                      case 'ollama':
                        return <Brain className="w-4 h-4 text-[#1D4ED8]" />;
                      default:
                        return <Brain className="w-4 h-4 text-gray-400" />;
                    }
                  })()}
                </div>
              )}
            </div>
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

          {/* 会话列表模块 */}
          <div className="card p-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                <History className="w-4 h-4 inline mr-1" />
                会话列表
            </label>
              <button
                onClick={handleCreateNewSession}
                className="flex items-center space-x-1 px-2 py-1 text-xs text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                title="创建新会话"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新建</span>
              </button>
            </div>
            {/* 会话列表容器：固定高度，显示5个会话项，其他需要滚动 */}
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {/* 新会话选项 */}
              <button
                onClick={() => {
                  setCurrentSessionId(null);
                  setMessagePage(1);
                }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  !currentSessionId
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-700'
                    : 'bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <MessageCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="font-medium truncate">新会话</span>
                </div>
              </button>
              
              {/* 历史会话列表 */}
              {sessions.length === 0 ? (
                <div className="text-center py-4 text-xs text-gray-500 dark:text-gray-400">
                  暂无历史会话
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.session_id}
                    className={`group relative w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${
                      currentSessionId === session.session_id
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-700'
                        : 'bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <button
                      onClick={() => handleSelectSession(session.session_id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start space-x-2">
                        <FileText className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {session.title || `会话 ${session.session_id.substring(0, 8)}`}
                          </div>
                          <div className="flex items-center space-x-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                            {session.message_count ? (
                              <span>{session.message_count} 条消息</span>
                            ) : null}
                            {session.last_message_at && (
                              <span className="truncate">
                                {new Date(session.last_message_at).toLocaleDateString('zh-CN', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => handleDeleteSession(session.session_id, e)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded"
                      title="删除会话"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 感知组件列表（MCP + 工作流） */}
          <div className="card p-3 flex-1 flex flex-col min-h-0">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <Brain className="w-4 h-4 inline mr-1" />
              感知组件
            </label>
            <div className="flex-1 overflow-y-auto space-y-2 border border-gray-200 dark:border-gray-700 rounded-lg p-2">
              {mcpServers.length === 0 && workflows.length === 0 ? (
                <div className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
                  暂无可用的感知组件，请先在配置页面添加
                </div>
              ) : (
                <>
                  {/* MCP 服务器分组 */}
                  {mcpServers.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-1.5 px-1.5 py-1">
                        <Plug className="w-3.5 h-3.5 text-blue-500" />
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                          MCP 服务器
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ({mcpServers.length})
                        </span>
                      </div>
                      {mcpServers.map((server) => {
                  const isConnected = connectedMcpServerIds.has(server.id);
                  const isConnecting = connectingServers.has(server.id);
                  const isExpanded = expandedServerIds.has(server.id);
                  const tools = mcpTools.get(server.id) || [];
                  
                  return (
                    <div
                      key={server.id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 flex items-center group"
                      draggable={isConnected}
                      onDragStart={(e) => {
                        if (isConnected) {
                          setDraggingComponent({ type: 'mcp', id: server.id, name: server.name });
                          e.dataTransfer.effectAllowed = 'move';
                        }
                      }}
                      onDragEnd={() => {
                        setDraggingComponent(null);
                      }}
                    >
                      {/* 服务器主要信息行 */}
                      <div className="flex items-center space-x-2 p-1.5 flex-1 min-w-0">
                        {/* 服务器连接控制 */}
                        <button
                          onClick={() => isConnected ? handleDisconnectServer(server.id) : handleConnectServer(server.id)}
                          disabled={isConnecting}
                          className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                            isConnected
                              ? 'text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/20'
                              : 'text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
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
                            <Plug className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {server.name}
                            </span>
                            {isConnected && (
                              <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                                已连接
                              </span>
                            )}
                            {isConnected && tools.length > 0 && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                ({tools.length} 工具)
                              </span>
                            )}
                          </div>
                          {server.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                              {server.description}
                            </div>
                          )}
                        </div>

                        {/* 展开/收起按钮（仅在已连接且有工具时显示） */}
                        {isConnected && tools.length > 0 && (
                          <button
                            onClick={() => handleToggleServerExpand(server.id)}
                            className="flex-shrink-0 p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                            title={isExpanded ? '收起工具' : '展开工具'}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        )}

                        {/* 注意：MCP现在通过@符号选择，不再使用选择框 */}
                      </div>
                      
                      {/* 拖动触点（仅在已连接时显示） */}
                      {isConnected && (
                        <div
                          className="flex-shrink-0 p-2 cursor-grab active:cursor-grabbing text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          title="拖动到对话框接入"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                      )}

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
                  })}
                    </div>
                  )}
                  
                  {/* 工作流分组 */}
                  {workflows.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-1.5 px-1.5 py-1">
                        <WorkflowIcon className="w-3.5 h-3.5 text-purple-500" />
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                          工作流
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ({workflows.length})
                        </span>
                      </div>
                      {workflows.map((workflow) => (
                    <div
                      key={workflow.workflow_id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 flex items-center group"
                      draggable={true}
                      onDragStart={(e) => {
                        setDraggingComponent({ type: 'workflow', id: workflow.workflow_id, name: workflow.name });
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDraggingComponent(null);
                      }}
                    >
                      <div className="flex items-center space-x-2 p-1.5 flex-1 min-w-0">
                        <WorkflowIcon className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {workflow.name}
                          </div>
                          {workflow.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                              {workflow.description}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* 拖动触点 */}
                      <div
                        className="flex-shrink-0 p-2 cursor-grab active:cursor-grabbing text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        title="拖动到对话框接入"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                    </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* 注意：MCP现在通过@符号选择，不再显示选择状态 */}
        </div>
      </div>

        {/* 右侧聊天界面 */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 card">
        {/* 状态栏 */}
          <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Bot className="w-5 h-5 text-blue-500" />
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI 工作流助手</span>
            </div>
            <div className="flex items-center space-x-2.5">
              {selectedLLMConfig ? (
                <div className="flex items-center space-x-1.5 text-green-600 dark:text-green-400 text-xs font-medium">
                  <CheckCircle className="w-4 h-4" />
                  <span>就绪</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 text-amber-600 dark:text-amber-400 text-xs font-medium">
                  <AlertCircle className="w-4 h-4" />
                  <span>未配置</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 消息列表 */}
          <div 
            className="flex-1 overflow-y-auto p-4 space-y-4 relative"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingComponent) {
                handleDropComponent(draggingComponent);
                setDraggingComponent(null);
              }
            }}
          >
          {/* 加载更多历史消息 */}
          {hasMoreMessages && (
            <div className="flex justify-center mb-4">
              <button
                onClick={() => loadSessionMessages(currentSessionId!, messagePage + 1)}
                disabled={isLoadingMessages}
                className="btn-primary flex items-center space-x-2 px-4 py-2 text-sm disabled:opacity-50"
              >
                {isLoadingMessages ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
                <span>加载更多历史消息</span>
              </button>
            </div>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex items-start space-x-3 ${
                message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
              }`}
            >
              <div className="flex-shrink-0 flex items-center space-x-2">
              <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shadow-sm ${
                  message.role === 'user'
                    ? 'bg-primary-500 text-white'
                    : message.role === 'assistant'
                    ? 'bg-blue-500 text-white'
                    : message.role === 'tool'
                      ? message.toolType === 'workflow'
                        ? 'bg-purple-500 text-white'
                        : message.toolType === 'mcp'
                    ? 'bg-green-500 text-white'
                        : 'bg-gray-500 text-white'
                    : 'bg-gray-400 text-white'
                }`}
              >
                {message.role === 'user' ? (
                    <User className="w-5 h-5" />
                ) : message.role === 'assistant' ? (
                    <Bot className="w-5 h-5" />
                ) : message.role === 'tool' ? (
                    message.toolType === 'workflow' ? (
                      <WorkflowIcon className="w-5 h-5" />
                    ) : message.toolType === 'mcp' ? (
                      <Plug className="w-5 h-5" />
                    ) : (
                      <Wrench className="w-5 h-5" />
                    )
                  ) : (
                    <Bot className="w-5 h-5" />
                  )}
                </div>
                {/* 思考/回答状态指示器 */}
                {message.role === 'assistant' && (
                  <div className="flex items-center space-x-1.5">
                    {message.isThinking && (!message.content || message.content.length === 0) ? (
                      // 思考中动画（只有思考，还没有内容）
                      <div className="flex items-center space-x-1.5">
                        <Loader className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">思考中</span>
                      </div>
                    ) : message.isStreaming ? (
                      // 回答中动画（正在流式输出内容）
                      <div className="flex items-center space-x-1.5">
                        <div className="flex space-x-0.5">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">回答中</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              <div
                className={`flex-1 rounded-xl p-4 shadow-sm ${
                  message.role === 'user'
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-gray-900 dark:text-gray-100'
                    : message.role === 'assistant'
                    ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'
                    : message.role === 'tool'
                    ? message.toolType === 'workflow'
                      ? 'bg-purple-50 dark:bg-purple-900/20 text-gray-900 dark:text-gray-100 border border-purple-200 dark:border-purple-700'
                      : message.toolType === 'mcp'
                      ? 'bg-green-50 dark:bg-green-900/20 text-gray-900 dark:text-gray-100 border border-green-200 dark:border-green-700'
                      : 'bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                    : 'bg-yellow-50 dark:bg-yellow-900/20 text-gray-700 dark:text-gray-300'
                }`}
              >
                {renderMessageContent(message)}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
          <div 
            className="border-t border-gray-200 p-3 flex-shrink-0 relative"
            onClick={(e) => {
              // 点击输入框区域外部时关闭选择器
              if (showAtSelector && !(e.target as HTMLElement).closest('.at-selector-container')) {
                setShowAtSelector(false);
              }
            }}
          >
          {/* 已选定的组件 tag */}
          {selectedComponents.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedComponents.map((component, index) => (
                <div
                  key={`${component.type}-${component.id}-${index}`}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md text-sm border border-gray-200 dark:border-gray-600"
                >
                  {component.type === 'workflow' ? (
                    <WorkflowIcon className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                  ) : (
                    <Plug className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  )}
                  <span className="font-medium">{component.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveComponent(index);
                    }}
                    className="ml-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
                    title="删除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex space-x-2">
            <div className="flex-1 relative at-selector-container">
            <textarea
                ref={inputRef}
              value={input}
                onChange={handleInputChange}
              onKeyPress={handleKeyPress}
                onKeyDown={(e) => {
                  // 如果选择器显示，处理上下箭头和回车
                  if (showAtSelector) {
                    const selectableComponentsList = getSelectableComponents();
                    
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedComponentIndex(prev => 
                        prev < selectableComponentsList.length - 1 ? prev + 1 : prev
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedComponentIndex(prev => prev > 0 ? prev - 1 : 0);
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (selectableComponentsList[selectedComponentIndex]) {
                        handleSelectComponent(selectableComponentsList[selectedComponentIndex]);
                      }
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      console.log('[Workflow] Closing selector via Escape');
                      setShowAtSelector(false);
                    }
                  }
                }}
                onBlur={(e) => {
                  // 延迟关闭，以便点击选择器时不会立即关闭
                  setTimeout(() => {
                    if (showAtSelector && !e.relatedTarget?.closest('.at-selector-container')) {
                      console.log('[Workflow] Closing selector via blur');
                      setShowAtSelector(false);
                    }
                  }, 200);
                }}
              placeholder={
                !selectedLLMConfig
                  ? '请先选择 LLM 模型...'
                  : selectedMcpServerIds.size > 0
                    ? `输入你的任务，我可以使用 ${totalTools} 个工具帮助你完成... (输入 @ 选择感知组件)`
                    : '输入你的问题，我会尽力帮助你... (输入 @ 选择感知组件)'
              }
                className="flex-1 input-field resize-none text-sm w-full"
              rows={3}
              disabled={isLoading || !selectedLLMConfig}
            />
              
              {/* @ 符号选择器 */}
              {showAtSelector && (
                <div
                  className="fixed z-[100] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-64 overflow-y-auto at-selector-container"
                  style={{
                    top: `${atSelectorPosition.top}px`,
                    left: `${atSelectorPosition.left}px`,
                    minWidth: '200px',
                    maxWidth: '300px',
                  }}
                  onMouseDown={(e) => e.preventDefault()} // 防止触发 blur
                >
                  <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      选择感知组件
                    </div>
                  </div>
                  
                  {/* MCP 服务器列表 */}
                  {mcpServers.filter(s => 
                    connectedMcpServerIds.has(s.id) &&
                    s.name.toLowerCase().includes(atSelectorQuery)
                  ).length > 0 && (
                    <div className="py-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 px-3 py-1.5">
                        MCP 服务器
                      </div>
                      {mcpServers
                        .filter(s => 
                          connectedMcpServerIds.has(s.id) &&
                          s.name.toLowerCase().includes(atSelectorQuery)
                        )
                        .map((server) => {
                          const component = { type: 'mcp' as const, id: server.id, name: server.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={server.id}
                              onClick={() => handleSelectComponent(component)}
                              className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                                isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : ''
                              }`}
                            >
                              <Plug className="w-4 h-4 text-blue-500 flex-shrink-0" />
                              <span className="text-sm text-gray-900 dark:text-gray-100">{server.name}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  
                  {/* 工作流列表 */}
                  {workflows.filter(w => 
                    w.name.toLowerCase().includes(atSelectorQuery)
                  ).length > 0 && (
                    <div className="py-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 px-3 py-1.5">
                        工作流
                      </div>
                      {workflows
                        .filter(w => w.name.toLowerCase().includes(atSelectorQuery))
                        .map((workflow) => {
                          const component = { type: 'workflow' as const, id: workflow.workflow_id, name: workflow.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={workflow.workflow_id}
                              onClick={() => handleSelectComponent(component)}
                              className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                                isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : ''
                              }`}
                            >
                              <WorkflowIcon className="w-4 h-4 text-purple-500 flex-shrink-0" />
                              <span className="text-sm text-gray-900 dark:text-gray-100">{workflow.name}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  
                  {/* 无匹配结果 */}
                  {mcpServers.filter(s => 
                    connectedMcpServerIds.has(s.id) &&
                    s.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 &&
                  workflows.filter(w => 
                    w.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                      未找到匹配的感知组件
                    </div>
                  )}
                </div>
              )}
            </div>
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
            ) : selectedComponents.length > 0 ? (
              <>已选择感知组件：<span className="font-medium">{selectedComponents[0].name}</span>。如需更换，请先删除当前组件，然后使用 @ 选择新的组件。</>
            ) : (
              <>提示：你可以直接与我对话，我会尽力帮助你。使用 @ 可以选择感知组件（MCP 服务器或工作流）。</>
            )}
          </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Workflow;

