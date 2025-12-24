/**
 * 圆桌会议面板组件
 * 支持多智能体并行对话、@提及、响应选择、举手机制
 */

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { 
  Bot, X, Check, Hand, Users, MessageCircle,
  ChevronDown, ChevronUp, Loader, Plus, RotateCw,
  Download, ZoomIn, ExternalLink,
  Reply, CornerDownRight
} from 'lucide-react';
import {
  RoundTableDetail,
  RoundTableParticipant,
  RoundTableMessage,
  RoundTableResponse,
  getRoundTable,
  sendMessage,
  addResponse,
  selectResponse,
  addParticipant,
  removeParticipant,
  updateParticipant,
  parseMentions,
  hasRaiseHandMark,
  removeRaiseHandMark,
  saveMediaToLocal,
} from '../services/roundTableApi';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { toast } from './ui/use-toast';
import { floatingComposerContainerClass, floatingComposerInnerClass } from './shared/floatingComposerStyles';

// 检测是否为沉默响应
const isSilentResponse = (content: string): boolean => {
  const trimmed = content.trim();
  return trimmed === '[沉默]' || 
         trimmed === '【沉默】' || 
         trimmed.startsWith('[沉默]') ||
         trimmed.startsWith('【沉默】') ||
         trimmed.toLowerCase() === '[silent]' ||
         trimmed.toLowerCase() === '[silence]';
};
import { getLLMConfigs, getLLMConfigApiKey, LLMConfigFromDB } from '../services/llmApi';
import { LLMClient, LLMMessage } from '../services/llmClient';
import { getMCPServers, MCPServerConfig } from '../services/mcpApi';
import { mcpManager, MCPTool, MCPServer } from '../services/mcpClient';
import { getWorkflows, Workflow as WorkflowType } from '../services/workflowApi';
import { estimate_messages_tokens, get_model_max_tokens } from '../services/tokenCounter';
import { getAgents, type Session as AgentSession, updateSessionMediaOutputPath } from '../services/sessionApi';
import InputToolTags from './ui/InputToolTags';
import { MessageRenderer } from './conversation/MessageRenderer';
import { useConversation } from '../conversation/useConversation';
import { createRoundTableConversationAdapter } from '../conversation/adapters/roundTableConversation';
import type { UnifiedMessage } from '../conversation/types';
import { 
  MessageBubble, 
  MessageAvatar, 
  SystemNotification,
  StreamingResponse,
} from './ui/MessageBubble';

export interface RoundTablePanelRef {
  refresh: () => Promise<void>;
}

interface RoundTablePanelProps {
  roundTableId: string;
  onClose?: () => void;
  onParticipantChange?: () => void;
  refreshTrigger?: number; // 增加一个刷新触发器
}

const RoundTablePanel = forwardRef<RoundTablePanelRef, RoundTablePanelProps>(({
  roundTableId,
  onClose,
  onParticipantChange,
  refreshTrigger,
}, ref) => {
  // 状态
  const [roundTable, setRoundTable] = useState<RoundTableDetail | null>(null);
  const roundTableAdapter = useMemo(() => createRoundTableConversationAdapter(roundTableId), [roundTableId]);
  const {
    messages,
    setMessages,
    appendMessage,
    loadInitial: loadConversationInitial,
  } = useConversation(roundTableAdapter, { pageSize: 50 });
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<RoundTableParticipant | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [editingParticipant, setEditingParticipant] = useState<RoundTableParticipant | null>(null);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [pendingResponses, setPendingResponses] = useState<Set<string>>(new Set());
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [allAgents, setAllAgents] = useState<AgentSession[]>([]);
  const addParticipantDetailsRef = useRef<HTMLDetailsElement | null>(null);
  
  // MCP 和工作流
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [mcpTools, setMcpTools] = useState<Map<string, MCPTool[]>>(new Map()); // serverId -> tools
  const [connectedMcpServerIds, setConnectedMcpServerIds] = useState<Set<string>>(new Set()); // 已连接的服务器
  const [connectingMcpServerIds, setConnectingMcpServerIds] = useState<Set<string>>(new Set()); // 正在连接的服务器
  const [workflows, setWorkflows] = useState<WorkflowType[]>([]);
  const [enableMCP, setEnableMCP] = useState(true); // 是否启用 MCP
  const [enableWorkflow, setEnableWorkflow] = useState(true); // 是否启用工作流
  // 工具箱已集成在发送框工具 Tag 中，右侧工具边栏不再展示
  
  // 上下文和总结
  const [roundTableSummary, setRoundTableSummary] = useState<string | null>(null); // 圆桌会议总结
  
  // 图片预览
  const [previewImage, setPreviewImage] = useState<{ url: string; mimeType: string } | null>(null);
  
  // 消息引用
  const [replyingTo, setReplyingTo] = useState<UnifiedMessage | null>(null);
  const [summarizingAgents, setSummarizingAgents] = useState<Set<string>>(new Set()); // 正在总结的agent
  
  // 输入框状态
  const [isInputFocused, setIsInputFocused] = useState(false);

  // 浮岛输入区：动态计算消息列表底部 padding，避免被浮岛遮挡
  const floatingComposerRef = useRef<HTMLDivElement>(null);
  const [floatingComposerPadding, setFloatingComposerPadding] = useState(180);
  useEffect(() => {
    const el = floatingComposerRef.current;
    if (!el) return;
    const update = () => {
      const h = el.getBoundingClientRect().height || 0;
      setFloatingComposerPadding(Math.max(140, Math.ceil(h + 24)));
    };
    update();
    const RO = (window as any).ResizeObserver as any;
    if (!RO) return;
    const ro = new RO(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  
  // 多模态内容（图片）
  const [attachedMedia, setAttachedMedia] = useState<Array<{
    type: 'image';
    mimeType: string;
    data: string; // base64 编码的数据
    preview: string; // 预览 URL
  }>>([]);
  
  // 收敛控制
  // 目标式发言：当前不提供显式开关，使用输入前缀触发（🎯...）
  const isTargetMode = useMemo(() => inputValue.trim().startsWith('🎯'), [inputValue]); // 是否为目标式发言
  const [agentResponseCounts, setAgentResponseCounts] = useState<Map<string, number>>(new Map()); // 每个 agent 的发言次数
  const agentResponseCountsRef = useRef<Map<string, number>>(new Map());
  
  // 发言次数限制
  const MAX_RESPONSES_NON_TARGET = 3; // 非目标式：每个 agent 最多发言 3 次
  const MAX_RESPONSES_TARGET = 10; // 目标式：每个 agent 最多发言 10 次
  
  // 同步发言计数 ref
  useEffect(() => {
    agentResponseCountsRef.current = agentResponseCounts;
  }, [agentResponseCounts]);
  
  // 消息队列（语音信箱）- 每个 agent 有独立的消息队列
  interface QueuedMessage {
    messageId: string;
    content: string;
    senderType: 'user' | 'agent';
    senderAgentName?: string;
    timestamp: number;
    isTargetMode?: boolean; // 是否为目标式消息
    media?: Array<{ type: 'image'; mimeType: string; data: string; preview: string }>; // 附带的媒体
  }
  const [agentMessageQueues, setAgentMessageQueues] = useState<Map<string, QueuedMessage[]>>(new Map());
  const [processingAgents, setProcessingAgents] = useState<Set<string>>(new Set()); // 正在处理队列的 agent
  
  // 使用 ref 存储最新的队列状态，避免闭包问题
  const agentMessageQueuesRef = useRef<Map<string, QueuedMessage[]>>(new Map());
  const processingAgentsRef = useRef<Set<string>>(new Set());
  const pendingResponsesRef = useRef<Set<string>>(new Set());
  
  // 同步 ref 和 state
  useEffect(() => {
    agentMessageQueuesRef.current = agentMessageQueues;
  }, [agentMessageQueues]);
  
  useEffect(() => {
    processingAgentsRef.current = processingAgents;
  }, [processingAgents]);
  
  useEffect(() => {
    pendingResponsesRef.current = pendingResponses;
  }, [pendingResponses]);
  
  // 流式响应状态
  const [streamingResponses, setStreamingResponses] = useState<Map<string, string>>(new Map()); // agent_id -> content
  const [streamingThinking, setStreamingThinking] = useState<Map<string, string>>(new Map()); // agent_id -> thinking
  
  // 取消控制器
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const toUnifiedRoundTableMessage = useCallback(
    (m: RoundTableMessage): UnifiedMessage => ({
      id: m.message_id,
      role: m.sender_type === 'agent' ? 'assistant' : m.sender_type,
      content: m.content || '',
      createdAt: m.created_at || new Date().toISOString(),
      media: (m.media || []).map(x => {
        const rawType = (x.type || '').toLowerCase();
        const inferredType =
          rawType === 'image' || rawType === 'video' || rawType === 'audio' || rawType === 'file'
            ? rawType
            : (x.mimeType || '').startsWith('image/')
              ? 'image'
              : (x.mimeType || '').startsWith('video/')
                ? 'video'
                : (x.mimeType || '').startsWith('audio/')
                  ? 'audio'
                  : 'file';
        return {
          type: inferredType as any,
          mimeType: x.mimeType,
          url: x.preview || (x.mimeType ? `data:${x.mimeType};base64,${x.data}` : x.data),
        };
      }),
      meta: {
        sender_type: m.sender_type,
        sender_agent_id: m.sender_agent_id,
        agent_name: m.agent_name,
        agent_avatar: m.agent_avatar,
        mentions: m.mentions || [],
        is_raise_hand: m.is_raise_hand,
        reply_to_message_id: m.reply_to_message_id,
        responses: m.responses || [],
      },
    }),
    []
  );
  
  // 加载圆桌会议数据
  const loadRoundTable = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setIsLoading(true);
      const [rtData, configsData, serversData, workflowsData, agentsData] = await Promise.all([
        getRoundTable(roundTableId),
        getLLMConfigs(),
        getMCPServers(),
        getWorkflows(),
        getAgents(),
      ]);
      
      setRoundTable(rtData);
      setLlmConfigs(configsData);
      setMcpServers(serversData);
      setWorkflows(workflowsData);
      setAllAgents((agentsData || []).filter(a => a.session_type === 'agent'));

      await loadConversationInitial({ force: true });
      
      // 只列出已启用的 MCP 服务器，不立即连接
      const enabledServers = serversData.filter(s => s.enabled);
      console.log(`[RoundTable] Found ${enabledServers.length} enabled MCP servers (lazy loading)`);
      console.log(`[RoundTable] Total workflows available: ${workflowsData.length}`);
    } catch (error) {
      console.error('[RoundTable] Failed to load data:', error);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [loadConversationInitial, roundTableId]);
  
  // 按需连接 MCP 服务器并获取工具
  const connectMcpServerOnDemand = useCallback(async (serverId: string): Promise<MCPTool[]> => {
    // 如果已经连接，直接返回缓存的工具
    if (connectedMcpServerIds.has(serverId)) {
      return mcpTools.get(serverId) || [];
    }
    
    // 如果正在连接，等待
    if (connectingMcpServerIds.has(serverId)) {
      // 等待连接完成（简单轮询）
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (connectedMcpServerIds.has(serverId)) {
          return mcpTools.get(serverId) || [];
        }
      }
      return [];
    }
    
    const server = mcpServers.find(s => s.server_id === serverId || s.id === serverId);
    if (!server || !server.enabled) {
      console.warn(`[RoundTable] MCP server ${serverId} not found or disabled`);
      return [];
    }
    
    // 标记正在连接
    setConnectingMcpServerIds(prev => new Set(prev).add(serverId));
    
    try {
      console.log(`[RoundTable] Connecting to MCP server ${server.name} on-demand...`);
      
      // 转换为 MCPServer 格式
      const mcpServer: MCPServer = {
        id: server.server_id || server.id,
        name: server.display_name || server.client_name || server.name,
        url: server.url,
        type: server.type,
        enabled: server.enabled,
        description: server.description,
        metadata: server.metadata,
        ext: server.ext,
      };
      
      const client = await mcpManager.addServer(mcpServer);
      const tools = await client.listTools();
      
      // 缓存工具
      setMcpTools(prev => new Map(prev).set(serverId, tools));
      setConnectedMcpServerIds(prev => new Set(prev).add(serverId));
      
      console.log(`[RoundTable] Connected to ${server.name}, loaded ${tools.length} tools`);
      return tools;
    } catch (error) {
      console.error(`[RoundTable] Failed to connect to ${server.name}:`, error);
      return [];
    } finally {
      setConnectingMcpServerIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(serverId);
        return newSet;
      });
    }
  }, [mcpServers, connectedMcpServerIds, connectingMcpServerIds, mcpTools]);
  
  // 暴露刷新方法给父组件
  useImperativeHandle(ref, () => ({
    refresh: () => loadRoundTable(false),
  }));
  
  useEffect(() => {
    loadRoundTable();
  }, [loadRoundTable]);
  
  // 监听 refreshTrigger 变化来刷新
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      loadRoundTable(false);
    }
  }, [refreshTrigger, loadRoundTable]);
  
  // 自动滚动到底部
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);
  
  type AtSuggestionKind = 'agent' | 'mcp_server' | 'mcp_tool' | 'workflow';
  type AtSuggestionItem = {
    id: string;
    kind: AtSuggestionKind;
    label: string;
    insertText: string; // 不含尾随空格
    description?: string;
    searchText: string; // 用于过滤
  };
  
  const getAtTriggerContext = (text: string, caret: number): { start: number; query: string } | null => {
    const safeCaret = Math.max(0, Math.min(caret, text.length));
    const left = text.slice(0, safeCaret);
    const at = left.lastIndexOf('@');
    if (at < 0) return null;
    // 必须处于同一个 token 内：@ 与光标之间不能出现空白字符
    const query = left.slice(at + 1);
    if (/[ \t\r\n]/.test(query)) return null;
    // 避免把邮箱/英文 token 当成 mention（如 email@domain.com）
    // 仅在 @ 前一个字符是“典型英文单词字符”时禁止触发；中文等场景允许直接“你好@”
    const prev = at === 0 ? '' : text[at - 1];
    if (prev && /[A-Za-z0-9._%+\-]/.test(prev)) return null;
    return { start: at, query };
  };
  
  const replaceTextRange = (text: string, start: number, end: number, replacement: string) => {
    return text.slice(0, start) + replacement + text.slice(end);
  };
  
  const atSuggestions = useMemo<AtSuggestionItem[]>(() => {
    const items: AtSuggestionItem[] = [];
    
    // Agents
    const participants = roundTable?.participants || [];
    for (const p of participants) {
      const name = p.name || p.session_id;
      items.push({
        id: `agent:${p.session_id}`,
        kind: 'agent',
        label: name,
        insertText: `@${name}`,
        description: '智能体',
        searchText: name.toLowerCase(),
      });
    }
    
    // MCP Servers / Tools（按启用与连接状态）
    if (enableMCP) {
      const enabledServers = (mcpServers || []).filter(s => s.enabled);
      for (const s of enabledServers) {
        const display = s.display_name || s.name || s.id;
        items.push({
          id: `mcp_server:${s.server_id || s.id}`,
          kind: 'mcp_server',
          label: `mcp:${display}`,
          insertText: `@mcp:${display}`,
          description: s.description || 'MCP 服务',
          searchText: `mcp ${display}`.toLowerCase(),
        });
      }
      
      // 已连接服务器的工具（可选：帮助用户快速引用工具名）
      for (const serverId of connectedMcpServerIds) {
        const tools = mcpTools.get(serverId) || [];
        if (tools.length === 0) continue;
        const server = (mcpServers || []).find(s => (s.server_id || s.id) === serverId);
        const serverDisplay = server?.display_name || server?.name || serverId;
        for (const t of tools) {
          const label = `mcp:${serverDisplay}/${t.name}`;
          items.push({
            id: `mcp_tool:${serverId}:${t.name}`,
            kind: 'mcp_tool',
            label,
            insertText: `@mcp:${serverDisplay}/${t.name}`,
            description: t.description || 'MCP 工具',
            searchText: `mcp ${serverDisplay} ${t.name} ${t.description || ''}`.toLowerCase(),
          });
        }
      }
    }
    
    // Workflows
    if (enableWorkflow) {
      for (const w of workflows || []) {
        const name = w.name || w.workflow_id || w.id;
        items.push({
          id: `workflow:${w.workflow_id || w.id}`,
          kind: 'workflow',
          label: `workflow:${name}`,
          insertText: `@workflow:${name}`,
          description: w.description || '工作流',
          searchText: `workflow ${name} ${w.description || ''}`.toLowerCase(),
        });
      }
    }
    
    return items;
  }, [roundTable?.participants, enableMCP, enableWorkflow, mcpServers, mcpTools, connectedMcpServerIds, workflows]);
  
  const filteredAtSuggestions = useMemo(() => {
    const q = (mentionFilter || '').trim().toLowerCase();
    if (!q) return atSuggestions;
    return atSuggestions.filter(it => it.searchText.includes(q) || it.label.toLowerCase().includes(q));
  }, [atSuggestions, mentionFilter]);
  
  // 当过滤结果改变时，确保选中索引有效
  useEffect(() => {
    if (mentionSelectedIndex >= filteredAtSuggestions.length) {
      setMentionSelectedIndex(Math.max(0, filteredAtSuggestions.length - 1));
    }
  }, [filteredAtSuggestions.length, mentionSelectedIndex]);
  
  // 统一更新 @ 下拉（从 ref 读取真实 caret，避免 onChange 瞬时 selectionStart 抖动导致“闪一下就消失”）
  const rafUpdateRef = useRef<number | null>(null);
  const scheduleUpdateAtDropdown = useCallback(() => {
    if (rafUpdateRef.current) {
      cancelAnimationFrame(rafUpdateRef.current);
    }
    rafUpdateRef.current = requestAnimationFrame(() => {
      rafUpdateRef.current = null;
      const el = inputRef.current;
      if (!el) return;
      const text = el.value ?? '';
      const caret = el.selectionStart ?? text.length;
      const ctx = getAtTriggerContext(text, caret);
      if (!ctx) {
        setShowMentionDropdown(false);
        setMentionFilter('');
        return;
      }
      setShowMentionDropdown(true);
      setMentionFilter(ctx.query);
      setMentionSelectedIndex(0);
    });
  }, []);
  
  useEffect(() => {
    return () => {
      if (rafUpdateRef.current) cancelAnimationFrame(rafUpdateRef.current);
    };
  }, []);
  
  // 处理 @ 触发
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    scheduleUpdateAtDropdown();
  };
  
  const pickAtSuggestion = (item: AtSuggestionItem) => {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? inputValue.length;
    const ctx = getAtTriggerContext(inputValue, caret);
    if (!ctx) {
      setShowMentionDropdown(false);
      return;
    }
    
    const replacement = item.insertText + ' ';
    const next = replaceTextRange(inputValue, ctx.start, caret, replacement);
    setInputValue(next);
    setShowMentionDropdown(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = ctx.start + replacement.length;
      el.setSelectionRange(pos, pos);
    });
  };
  
  // 取消智能体响应
  const cancelAgentResponse = (agentId: string) => {
    const controller = abortControllersRef.current.get(agentId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(agentId);
    }
    // 清除流式状态
    setStreamingResponses(prev => {
      const newMap = new Map(prev);
      newMap.delete(agentId);
      return newMap;
    });
    setStreamingThinking(prev => {
      const newMap = new Map(prev);
      newMap.delete(agentId);
      return newMap;
    });
    // 从待响应中移除
    setPendingResponses(prev => {
      const newSet = new Set(prev);
      newSet.delete(agentId);
      return newSet;
    });
  };

  // 总结圆桌会议对话（使用指定 agent 的模型）
  const summarizeRoundTableWithAgent = async (
    agentId: string,
    llmConfig: LLMConfigFromDB,
    apiKey: string
  ): Promise<string | null> => {
    if (summarizingAgents.has(agentId) || messages.length < 5) return null;
    
    try {
      // 标记该 agent 正在总结
      setSummarizingAgents(prev => new Set(prev).add(agentId));
      
      const fullConfig = {
        id: llmConfig.config_id,
        provider: llmConfig.provider,
        name: llmConfig.name,
        apiKey: apiKey,
        apiUrl: llmConfig.api_url,
        model: llmConfig.model,
        enabled: llmConfig.enabled,
        metadata: llmConfig.metadata,
      };
      
      const llmClient = new LLMClient(fullConfig);
      
      // 构建要总结的对话内容（取前面的消息，保留最近几条不总结）
      const messagesToSummarize = messages.slice(0, -3); // 保留最近3条不进入总结
      const conversationText = messagesToSummarize.map(m => {
        const senderType = (m.meta?.sender_type as any) as 'user' | 'agent' | 'system' | undefined;
        const speaker = senderType === 'user' ? '用户' : ((m.meta?.agent_name as string) || '智能体');
        return `${speaker}: ${m.content}`;
      }).join('\n\n');
      
      const summaryPrompt = `请对以下圆桌会议对话进行简洁总结，保留关键信息、决策、任务分配和重要观点：

【会议名称】${roundTable?.name}
【参会者】${roundTable?.participants.map(p => p.name).join('、')}

【对话内容】
${conversationText}

请用简洁的要点形式总结（200字以内），包括：
1. 主要讨论话题
2. 关键决策或结论
3. 各方观点要点
4. 待办事项（如有）`;

      const participant = roundTable?.participants.find(p => p.session_id === agentId);
      console.log(`[RoundTable] Agent ${participant?.name} is summarizing conversation...`);
      
      const response = await llmClient.handleUserRequestWithThinking(
        summaryPrompt,
        '你是一个专业的会议记录员，擅长总结会议内容。请简洁总结，不要超过200字。',
        [],
        false
      );
      
      if (response.content) {
        setRoundTableSummary(response.content);
        console.log(`[RoundTable] Summary generated by ${participant?.name}:`, response.content.substring(0, 100));
        return response.content;
      }
      return null;
    } catch (error) {
      console.error('[RoundTable] Failed to summarize:', error);
      return null;
    } finally {
      // 移除总结状态
      setSummarizingAgents(prev => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        return newSet;
      });
    }
  };

  // 调用智能体 LLM（流式）
  const callAgentLLM = async (
    participant: RoundTableParticipant,
    userMessage: string,
    messageId: string,
    senderType: 'user' | 'agent' = 'user',
    senderAgentName?: string,
    media?: Array<{ type: 'image'; mimeType: string; data: string; preview: string }>
  ): Promise<RoundTableResponse | null> => {
    const agentId = participant.session_id;
    
    // 创建取消控制器
    const abortController = new AbortController();
    abortControllersRef.current.set(agentId, abortController);
    
    try {
      const llmConfigId = participant.custom_llm_config_id || participant.llm_config_id;
      const systemPrompt = participant.custom_system_prompt || participant.system_prompt;
      
      if (!llmConfigId) {
        console.warn(`[RoundTable] Agent ${participant.name} has no LLM config`);
        return null;
      }
      
      const llmConfig = llmConfigs.find(c => c.config_id === llmConfigId);
      if (!llmConfig) {
        console.warn(`[RoundTable] LLM config ${llmConfigId} not found`);
        return null;
      }
      
      // 获取 API 密钥
      const apiKey = await getLLMConfigApiKey(llmConfigId);
      if (llmConfig.provider !== 'ollama' && !apiKey) {
        console.warn(`[RoundTable] Agent ${participant.name} has no API key configured`);
        return null;
      }
      
      // 获取 MCP 服务器配置
      const mcpServers = await getMCPServers();
      
      // 创建 LLM 客户端（包含 API 密钥）
      const fullLLMConfig = {
        id: llmConfig.config_id,
        provider: llmConfig.provider,
        name: llmConfig.name,
        apiKey: apiKey,
        apiUrl: llmConfig.api_url,
        model: llmConfig.model,
        enabled: llmConfig.enabled,
        metadata: llmConfig.metadata,
      };
      const llmClient = new LLMClient(fullLLMConfig);
      
      // 获取已启用的 MCP 服务器列表（不立即连接）
      const enabledMcpServers = mcpServers.filter(s => s.enabled);
      
      // 构建 MCP 服务器描述（仅列出服务器，不加载工具）
      const mcpServersDescription = enableMCP && enabledMcpServers.length > 0
        ? `\n【可用的外部服务（MCP）】
当你需要与现实世界交互、获取外部信息、操作外部系统时，可以请求启动以下服务：
${enabledMcpServers.map(s => `- ${s.display_name || s.name}: ${s.description || '外部服务'}`).join('\n')}

📌 使用方式：如果你判断需要使用某个服务，请在回复中明确说明 [需要工具:服务名称]，例如 [需要工具:飞书] 或 [需要工具:Notion]
系统会自动连接该服务并告诉你可用的具体功能，然后你可以调用它们。
`
        : '';
      
      const workflowsDescription = enableWorkflow && workflows.length > 0
        ? `\n【可用的工作流】\n你可以建议执行以下工作流（在回复中说明要执行哪个工作流及其参数）：\n${workflows.map(w => `- ${w.name}: ${w.description || '无描述'}`).join('\n')}\n`
        : '';
      
      // 构建参会者详情（包含角色说明）
      const participantsInfo = roundTable?.participants.map(p => {
        const role = p.custom_system_prompt || p.system_prompt || '';
        // 提取角色描述的第一行或前50个字符作为简介
        const roleShort = role.split('\n')[0]?.substring(0, 50) || '智能助手';
        return `- ${p.name}${p.session_id === agentId ? '（你）' : ''}: ${roleShort}${roleShort.length === 50 ? '...' : ''}`;
      }).join('\n') || '';
      
      // 构建圆桌会议上下文
      const roundTableContext = `
你正在参与一个名为"${roundTable?.name}"的圆桌会议。
你的名字是"${participant.name}"。

【当前参会成员】
${participantsInfo}

【智能响应判断 - 收到消息时必须先思考】
在回复任何消息之前，你必须先分析：
1. 🎯 这条消息是否与我的角色/专长直接相关？
2. 👤 消息是否明确指向我（@我、提到我的名字、或问我擅长的领域）？
3. 🤝 是否有其他更合适的参会成员来处理这个问题？
4. 📜 结合上下文，我是否已经在这个话题上发过言？是否需要补充？

【响应决策】
✅ 应该回复的情况：
- 被明确 @提及
- 消息内容与我的专业领域高度相关
- 其他成员都不适合处理，而我可以帮忙
- 需要补充重要信息或纠正错误

❌ 应该回复 [沉默] 的情况：
- 消息明确指定其他成员处理（如"让XX来做"、"@XX 请处理"）
- 话题与我的专长无关，有更合适的成员
- 我已经详细回答过类似问题
- 只是简单的确认、感谢或闲聊
- 不确定是否需要我参与时，优先选择沉默

【发言格式】
1. 如果决定沉默，直接回复：[沉默]
2. 如果有重要想法主动发言，在开头加：[举手]
3. 如果需要特定成员回应，使用：@名称
4. 🔄 避免循环对话：如果已经回答清楚，可以简短结束，如"好的"、"明白了"

【重要原则】
- 宁可沉默，也不要发表无关或重复的内容
- 让专业的人做专业的事
- 保持会议高效，避免无意义的发言
${mcpServersDescription}${workflowsDescription}${senderType === 'agent' ? `\n【来自其他成员的消息】\n发送者：${senderAgentName}\n如果这个话题与你无关，请回复 [沉默]。如果对方只是简单确认或结束对话，你无需再回复。` : ''}
`;
      
      const fullSystemPrompt = systemPrompt 
        ? `${systemPrompt}\n\n${roundTableContext}`
        : roundTableContext;
      
      // 获取模型的 token 限制
      const model = llmConfig.model || 'gpt-4';
      const maxTokens = llmConfig.max_tokens || get_model_max_tokens(model);
      const tokenThreshold = Math.floor(maxTokens * 0.7); // 使用 70% 作为上下文阈值，留 30% 给回复
      
      // 构建完整的消息历史（从新到旧）
      const allMessages: LLMMessage[] = [];
      
      // 如果有总结，先添加总结作为上下文
      if (roundTableSummary) {
        allMessages.push({
          role: 'user',
          content: `【会议历史总结】\n${roundTableSummary}\n\n---\n以下是最近的对话：`,
        });
      }
      
      // 从最新消息开始，逐条添加直到达到 token 限制
      const recentMessages = [...messages].reverse();
      const messagesToInclude: LLMMessage[] = [];
      let estimatedTokens = estimate_messages_tokens(allMessages, model);
      
      for (const m of recentMessages) {
        const senderType = (m.meta?.sender_type as any) as 'user' | 'agent' | 'system' | undefined;
        const msgContent = senderType === 'agent' 
          ? `[${(m.meta?.agent_name as string) || '智能体'}]: ${m.content}`
          : m.content;
        
        const newMsg: LLMMessage = {
          role: senderType === 'user' ? 'user' : 'assistant',
          content: msgContent,
        };
        
        // 估算添加这条消息后的 token 数
        const msgTokens = estimate_messages_tokens([newMsg], model);
        
        if (estimatedTokens + msgTokens > tokenThreshold) {
          console.log(`[RoundTable] Token limit reached: ${estimatedTokens}/${tokenThreshold}, stopping at ${messagesToInclude.length} messages`);
          break;
        }
        
        messagesToInclude.unshift(newMsg); // 插入到开头以保持时间顺序
        estimatedTokens += msgTokens;
      }
      
      // 合并消息历史
      const messageHistory = [...allMessages, ...messagesToInclude];
      
      // 检查是否需要触发总结（当消息数量很多且接近限制时）
      if (messages.length > 10 && estimatedTokens > tokenThreshold * 0.85 && !roundTableSummary && !summarizingAgents.has(agentId)) {
        console.log(`[RoundTable] Context getting full (${estimatedTokens} tokens, ${messages.length} messages), agent ${participant.name} will summarize first...`);
        // 先进行总结，然后再继续
        await summarizeRoundTableWithAgent(agentId, llmConfig, apiKey);
        
        // 总结后重新构建消息历史（使用总结）
        // 此时 roundTableSummary 应该已更新
      }
      
      console.log(`[RoundTable] Built message history: ${messageHistory.length} messages, ~${estimatedTokens} tokens (limit: ${tokenThreshold})`);
      
      // 初始化流式状态
      setStreamingResponses(prev => new Map(prev).set(agentId, ''));
      setStreamingThinking(prev => new Map(prev).set(agentId, ''));
      
      // 流式回调
      let accumulatedContent = '';
      
      const onChunk = (content: string, thinking?: string) => {
        // 检查是否已取消
        if (abortController.signal.aborted) {
          throw new Error('Aborted');
        }
        
        if (content) {
          accumulatedContent += content;
          setStreamingResponses(prev => new Map(prev).set(agentId, accumulatedContent));
        }
        if (thinking) {
          setStreamingThinking(prev => new Map(prev).set(agentId, thinking));
        }
      };
      
      // 检查模型是否支持多模态（图片）
      const supportsVision = llmConfig.provider === 'gemini' || 
                             llmConfig.provider === 'openai' ||
                             llmConfig.provider === 'anthropic' ||
                             (llmConfig.model?.includes('vision') || 
                              llmConfig.model?.includes('gpt-4') ||
                              llmConfig.model?.includes('gemini') ||
                              llmConfig.model?.includes('claude'));
      
      // 构建用户消息（可能包含图片）
      let userMsgToSend = userMessage;
      let messageHistoryWithMedia = messageHistory;
      
      if (media && media.length > 0) {
        if (supportsVision) {
          // 模型支持图片，构建包含图片的用户消息
          const userMsgWithMedia: LLMMessage = {
            role: 'user',
            content: userMessage,
            parts: [
              { text: userMessage },
              ...media.map(m => ({
                inlineData: {
                  mimeType: m.mimeType,
                  data: m.data,
                }
              }))
            ]
          };
          messageHistoryWithMedia = [...messageHistory, userMsgWithMedia];
          userMsgToSend = ''; // 因为消息已经在 history 中了
          console.log(`[RoundTable] Sending ${media.length} images to ${participant.name}`);
        } else {
          // 模型不支持图片，提示用户
          userMsgToSend = `${userMessage}\n\n[注意：消息中包含${media.length}张图片，但我当前使用的模型(${llmConfig.model})不支持阅读图片内容。如果问题需要理解图片才能回答，请告知用户。]`;
          console.log(`[RoundTable] Model ${llmConfig.model} does not support vision, skipping images`);
        }
      }
      
      // === 智能 MCP 触发机制 ===
      // 第一阶段：先不带工具调用，看 Agent 是否需要外部服务
      console.log(`[RoundTable] Phase 1: Calling LLM for agent ${participant.name} without tools`);
      let response = await llmClient.handleUserRequestWithThinking(
        userMsgToSend,
        fullSystemPrompt,
        [], // 第一阶段不传工具
        true, // 使用流式
        onChunk, // 流式回调
        messageHistoryWithMedia // 消息历史
      );
      
      // 检查是否已取消
      if (abortController.signal.aborted) {
        return null;
      }
      
      // 第二阶段：检查是否请求了 MCP 服务
      const toolRequestPattern = /\[需要工具[：:]\s*([^\]]+)\]/g;
      const toolRequests: string[] = [];
      let match;
      while ((match = toolRequestPattern.exec(response.content || '')) !== null) {
        toolRequests.push(match[1].trim());
      }
      
      if (enableMCP && toolRequests.length > 0) {
        console.log(`[RoundTable] Agent ${participant.name} requested tools:`, toolRequests);
        
        // 连接请求的 MCP 服务器并获取工具
        const requestedTools: MCPTool[] = [];
        const connectedServerNames: string[] = [];
        
        for (const requestedName of toolRequests) {
          // 查找匹配的服务器（模糊匹配）
          const matchedServer = enabledMcpServers.find(s => {
            const serverName = s.display_name || s.name;
            return serverName.toLowerCase().includes(requestedName.toLowerCase()) ||
                   requestedName.toLowerCase().includes(serverName.toLowerCase());
          });
          
          if (matchedServer) {
            const serverId = matchedServer.server_id || matchedServer.id;
            console.log(`[RoundTable] Connecting to MCP server "${matchedServer.name}" for agent ${participant.name}...`);
            
            try {
              const tools = await connectMcpServerOnDemand(serverId);
              requestedTools.push(...tools);
              connectedServerNames.push(matchedServer.display_name || matchedServer.name);
              console.log(`[RoundTable] Loaded ${tools.length} tools from ${matchedServer.name}`);
            } catch (error) {
              console.warn(`[RoundTable] Failed to connect to ${matchedServer.name}:`, error);
            }
          } else {
            console.warn(`[RoundTable] No MCP server found matching "${requestedName}"`);
          }
        }
        
        // 如果成功获取了工具，重新调用 LLM
        if (requestedTools.length > 0) {
          // 清除之前的流式状态，准备第二次调用
          setStreamingResponses(prev => new Map(prev).set(agentId, ''));
          setStreamingThinking(prev => new Map(prev).set(agentId, ''));
          accumulatedContent = '';
          
          // 构建工具描述
          const toolsListDescription = requestedTools.map(t => `- ${t.name}: ${t.description || '无描述'}`).join('\n');
          
          // 在消息历史中添加系统通知
          const toolsAvailableMsg: LLMMessage = {
            role: 'user',
            content: `【系统通知】已为你连接 ${connectedServerNames.join('、')} 服务，以下工具现已可用：\n${toolsListDescription}\n\n请直接使用这些工具完成任务，不需要再次说明你需要工具。`,
          };
          
          const historyWithToolNotice = [...messageHistoryWithMedia, toolsAvailableMsg];
          
          console.log(`[RoundTable] Phase 2: Re-calling LLM with ${requestedTools.length} tools for agent ${participant.name}`);
          response = await llmClient.handleUserRequestWithThinking(
            '', // 消息已在历史中
            fullSystemPrompt,
            requestedTools, // 传入获取的工具
            true,
            onChunk,
            historyWithToolNotice
          );
          
          // 检查是否已取消
          if (abortController.signal.aborted) {
            return null;
          }
        }
      }
      
      console.log(`[RoundTable] Got response from agent ${participant.name}:`, {
        content: response.content?.substring(0, 100),
        hasMedia: !!response.media,
        mediaCount: response.media?.length || 0,
        mediaKeys: response.media?.[0] ? Object.keys(response.media[0]) : [],
      });
      
      // 清除流式状态
      setStreamingResponses(prev => {
        const newMap = new Map(prev);
        newMap.delete(agentId);
        return newMap;
      });
      setStreamingThinking(prev => {
        const newMap = new Map(prev);
        newMap.delete(agentId);
        return newMap;
      });
      
      // 检查是否有举手标记
      const isRaiseHand = hasRaiseHandMark(response.content || '');
      const cleanContent = isRaiseHand ? removeRaiseHandMark(response.content || '') : (response.content || '');
      
      // 保存响应到数据库
      const savedResponse = await addResponse(roundTableId, messageId, {
        agent_id: agentId,
        content: cleanContent || (response.media ? '[生成了图片]' : ''),
        thinking: response.thinking,
      });
      
      // 如果是举手消息，发送一条智能体消息（包含媒体）
      if (isRaiseHand) {
        // 处理 AI 返回的媒体（图片等）
        const raiseHandMedia = response.media?.map(m => ({
          type: m.type || 'image',
          mimeType: m.mimeType,
          data: m.data,
          preview: `data:${m.mimeType};base64,${m.data}`,
        }));
        
        await sendMessage(roundTableId, {
          content: cleanContent || (raiseHandMedia && raiseHandMedia.length > 0 ? '[生成了图片]' : ''),
          sender_type: 'agent',
          sender_agent_id: agentId,
          is_raise_hand: true,
          media: raiseHandMedia,
        });
      }
      
      // 清除取消控制器
      abortControllersRef.current.delete(agentId);
      
      // 返回保存的响应，并附加 LLM 返回的媒体
      return {
        ...savedResponse,
        content: cleanContent || (response.media ? '[生成了图片]' : ''),
        media: response.media,  // 传递 LLM 返回的媒体
      };
    } catch (error: any) {
      if (error?.message === 'Aborted' || abortController.signal.aborted) {
        console.log(`[RoundTable] Agent ${participant.name} response cancelled`);
        return null;
      }
      console.error(`[RoundTable] Failed to call agent ${participant.name}:`, error);
      // 清除流式状态
      setStreamingResponses(prev => {
        const newMap = new Map(prev);
        newMap.delete(agentId);
        return newMap;
      });
      setStreamingThinking(prev => {
        const newMap = new Map(prev);
        newMap.delete(agentId);
        return newMap;
      });
      abortControllersRef.current.delete(agentId);
      return null;
    }
  };
  
  // 检查 agent 是否还能发言
  const canAgentRespond = (agentId: string, targetMode: boolean): boolean => {
    const count = agentResponseCountsRef.current.get(agentId) || 0;
    const maxResponses = targetMode ? MAX_RESPONSES_TARGET : MAX_RESPONSES_NON_TARGET;
    return count < maxResponses;
  };
  
  // 增加 agent 发言计数
  const incrementAgentResponseCount = (agentId: string) => {
    setAgentResponseCounts(prev => {
      const newMap = new Map(prev);
      const count = newMap.get(agentId) || 0;
      newMap.set(agentId, count + 1);
      agentResponseCountsRef.current = newMap;
      return newMap;
    });
  };
  
  // 重置所有 agent 发言计数（用户发送新消息时）
  const resetAgentResponseCounts = () => {
    setAgentResponseCounts(new Map());
    agentResponseCountsRef.current = new Map();
  };
  
  // 将消息加入智能体的消息队列
  const enqueueMessage = (
    agentId: string,
    messageId: string,
    content: string,
    senderType: 'user' | 'agent',
    senderAgentName?: string,
    targetMode: boolean = false,
    media?: Array<{ type: 'image'; mimeType: string; data: string; preview: string }>
  ) => {
    // 检查是否还能发言
    if (!canAgentRespond(agentId, targetMode)) {
      const participant = roundTable?.participants.find(p => p.session_id === agentId);
      console.log(`[RoundTable] Agent ${participant?.name || agentId} has reached response limit (${targetMode ? MAX_RESPONSES_TARGET : MAX_RESPONSES_NON_TARGET}), skipping`);
      return;
    }
    
    const queuedMessage: QueuedMessage = {
      messageId,
      content,
      senderType,
      senderAgentName,
      timestamp: Date.now(),
      isTargetMode: targetMode,
      media,
    };
    
    console.log(`[RoundTable] Enqueue message for agent ${agentId}:`, content.substring(0, 50), media ? `(with ${media.length} images)` : '');
    
    setAgentMessageQueues(prev => {
      const newMap = new Map(prev);
      const queue = newMap.get(agentId) || [];
      const newQueue = [...queue, queuedMessage];
      newMap.set(agentId, newQueue);
      // 同时更新 ref
      agentMessageQueuesRef.current = newMap;
      return newMap;
    });
  };
  
  // 监听队列变化，触发处理
  useEffect(() => {
    if (!roundTable) return;
    
    // 检查每个 agent 的队列
    for (const [agentId, queue] of agentMessageQueues.entries()) {
      if (queue.length > 0 && 
          !processingAgentsRef.current.has(agentId) && 
          !pendingResponsesRef.current.has(agentId)) {
        console.log(`[RoundTable] Queue changed, triggering process for agent ${agentId}, queue length: ${queue.length}`);
        processAgentQueue(agentId);
      }
    }
  }, [agentMessageQueues, roundTable]);
  
  // 处理智能体的消息队列
  const processAgentQueue = async (agentId: string) => {
    // 使用 ref 检查状态，避免闭包问题
    if (processingAgentsRef.current.has(agentId) || pendingResponsesRef.current.has(agentId)) {
      console.log(`[RoundTable] Agent ${agentId} is already processing, skip`);
      return;
    }
    
    const queue = agentMessageQueuesRef.current.get(agentId);
    if (!queue || queue.length === 0) {
      console.log(`[RoundTable] Agent ${agentId} queue is empty`);
      return;
    }
    
    const participant = roundTable?.participants.find(p => p.session_id === agentId);
    if (!participant) {
      console.log(`[RoundTable] Agent ${agentId} not found in participants`);
      return;
    }
    
    console.log(`[RoundTable] Start processing queue for agent ${participant.name}, queue length: ${queue.length}`);
    
    // 标记为正在处理
    setProcessingAgents(prev => {
      const newSet = new Set(prev).add(agentId);
      processingAgentsRef.current = newSet;
      return newSet;
    });
    
    // 取出队列中的第一条消息
    const message = queue[0];
    
    // 从队列中移除
    setAgentMessageQueues(prev => {
      const newMap = new Map(prev);
      const currentQueue = newMap.get(agentId) || [];
      newMap.set(agentId, currentQueue.slice(1));
      agentMessageQueuesRef.current = newMap;
      return newMap;
    });
    
    // 标记正在响应
    setPendingResponses(prev => {
      const newSet = new Set(prev).add(agentId);
      pendingResponsesRef.current = newSet;
      return newSet;
    });
    
    try {
      // 调用 LLM（传入媒体）
      const response = await callAgentLLM(
        participant,
        message.content,
        message.messageId,
        message.senderType,
        message.senderAgentName,
        message.media
      );
      
      if (response) {
        // 检查是否为沉默响应
        if (isSilentResponse(response.content)) {
          console.log(`[RoundTable] Agent ${participant.name} chose to remain silent`);
          // 沉默不计入发言次数，也不发送到群聊
          // 但仍然需要清除处理状态（在 finally 中处理）
          return;
        }
        
        // 增加发言计数
        incrementAgentResponseCount(agentId);
        const currentCount = (agentResponseCountsRef.current.get(agentId) || 0) + 1;
        const maxCount = message.isTargetMode ? MAX_RESPONSES_TARGET : MAX_RESPONSES_NON_TARGET;
        
        console.log(`[RoundTable] Agent ${participant.name} responded (${currentCount}/${maxCount}):`, response.content.substring(0, 100));
        
        // 检查是否举手或 @ 其他人
        const responseContent = response.content || '';
        const isRaiseHand = hasRaiseHandMark(responseContent);
        const allMentions = parseMentions(responseContent, roundTable?.participants || []);
        
        // 过滤掉自己（agent 不能 @ 自己，避免无限循环）
        const mentions = allMentions.filter(m => m !== agentId);
        
        // 处理 AI 返回的媒体（图片等）
        let responseMedia = response.media?.map(m => ({
          type: m.type || 'image',
          mimeType: m.mimeType,
          data: m.data,
          preview: `data:${m.mimeType};base64,${m.data}`,
          localPath: undefined as string | undefined,
        }));
        
        // 如果有媒体且配置了本地保存路径，自动保存到本地
        let savedPaths: string[] = [];
        console.log(`[RoundTable] 检查媒体保存条件:`, {
          hasMedia: !!responseMedia,
          mediaCount: responseMedia?.length || 0,
          mediaOutputPath: participant.media_output_path || '(未配置)',
          participantName: participant.name,
        });
        
        if (responseMedia && responseMedia.length > 0 && participant.media_output_path) {
          console.log(`[RoundTable] ✓ 开始保存媒体: Agent=${participant.name}, 数量=${responseMedia.length}, 路径=${participant.media_output_path}`);
          
          for (let i = 0; i < responseMedia.length; i++) {
            const media = responseMedia[i];
            console.log(`[RoundTable] 保存媒体 ${i + 1}/${responseMedia.length}:`, {
              type: media.type,
              mimeType: media.mimeType,
              dataLength: media.data?.length || 0,
              hasData: !!media.data,
            });
            
            try {
              const result = await saveMediaToLocal({
                media_data: media.data,
                mime_type: media.mimeType,
                output_path: participant.media_output_path,
              });
              console.log(`[RoundTable] ✅ 媒体 ${i + 1} 保存成功: ${result.file_path} (${result.size} bytes)`);
              savedPaths.push(result.file_path);
              // 将本地路径添加到媒体对象
              responseMedia[i] = { ...media, localPath: result.file_path };
            } catch (error: any) {
              console.error(`[RoundTable] ❌ 媒体 ${i + 1} 保存失败:`, error?.message || error);
              // 显示错误给用户（可选：可以在聊天中显示保存失败的提示）
            }
          }
          console.log(`[RoundTable] 媒体保存完成: 成功=${savedPaths.length}, 失败=${responseMedia.length - savedPaths.length}`);
        } else if (responseMedia && responseMedia.length > 0) {
          console.log(`[RoundTable] ⚠️ 有媒体但未配置保存路径: Agent=${participant.name}, 数量=${responseMedia.length}, 首个大小=${Math.round((responseMedia[0].data?.length || 0) / 1024)}KB`);
          console.log(`[RoundTable] 💡 提示: 请在参与者设置中配置"媒体输出路径"以自动保存生成的图片`);
        } else if (!responseMedia || responseMedia.length === 0) {
          console.log(`[RoundTable] Agent ${participant.name} 未生成媒体内容`);
        }
        
        // 构建消息内容：如果有保存的本地路径，附加到消息中
        let finalContent = responseContent || '';
        if (savedPaths.length > 0) {
          const pathsInfo = savedPaths.map(p => `📁 ${p}`).join('\n');
          finalContent = finalContent 
            ? `${finalContent}\n\n【已保存到本地】\n${pathsInfo}`
            : `[生成了图片]\n\n【已保存到本地】\n${pathsInfo}`;
        } else if (!finalContent && responseMedia && responseMedia.length > 0) {
          finalContent = '[生成了图片]';
        }
        
        // 所有响应都发送到群聊（让其他人看到）
        const agentMessage = await sendMessage(roundTableId, {
          content: finalContent,
          sender_type: 'agent',
          sender_agent_id: agentId,
          mentions, // 已过滤掉自己
          is_raise_hand: isRaiseHand,
          media: responseMedia,
        });
        
        // 确保消息包含正确的 agent 信息和媒体（后端可能已返回，这里做个保险）
        const messageWithAgentInfo = {
          ...agentMessage,
          agent_name: agentMessage.agent_name || participant.name,
          agent_avatar: agentMessage.agent_avatar || participant.avatar,
          responses: agentMessage.responses || [],
          media: agentMessage.media || responseMedia,  // 确保媒体被包含
        };
        
        // 更新消息列表
        appendMessage(toUnifiedRoundTableMessage(messageWithAgentInfo));
        
        // 如果有 @ 其他人（不包括自己），将消息加入他们的队列
        // 注意：继承当前消息的目标模式，并传递媒体信息
        if (mentions.length > 0) {
          const targetAgents = roundTable?.participants.filter(p => 
            mentions.includes(p.session_id)
          ) || [];
          
          console.log(`[RoundTable] Agent ${participant.name} mentioned ${targetAgents.length} other agents (excluded self), targetMode: ${message.isTargetMode}, hasMedia: ${!!responseMedia}`);
          
          const responseMediaForMention = responseMedia
            ?.filter(m => (m.mimeType || '').startsWith('image/'))
            .map(m => ({
              type: 'image' as const,
              mimeType: m.mimeType,
              data: m.data,
              preview: m.preview,
            }));

          for (const targetAgent of targetAgents) {
            enqueueMessage(
              targetAgent.session_id,
              agentMessage.message_id,
              response.content,
              'agent',
              participant.name,
              message.isTargetMode, // 继承目标模式
              responseMediaForMention // 仅传递图片，满足 callAgentLLM 的多模态约束
            );
          }
        }
      }
    } catch (error) {
      console.error(`[RoundTable] Failed to process queue for agent ${participant.name}:`, error);
    } finally {
      console.log(`[RoundTable] Finished processing for agent ${participant.name}`);
      
      // 清除处理状态
      setProcessingAgents(prev => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        processingAgentsRef.current = newSet;
        return newSet;
      });
      setPendingResponses(prev => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        pendingResponsesRef.current = newSet;
        return newSet;
      });
      
      // 继续处理队列中的下一条消息（延迟让状态更新生效）
      setTimeout(() => {
        const remainingQueue = agentMessageQueuesRef.current.get(agentId);
        if (remainingQueue && remainingQueue.length > 0) {
          console.log(`[RoundTable] Continue processing queue for agent ${agentId}, remaining: ${remainingQueue.length}`);
          processAgentQueue(agentId);
        }
      }, 200);
    }
  };
  
  // 广播消息给所有智能体（加入队列）
  const broadcastMessageToAgents = (
    messageId: string,
    content: string,
    senderType: 'user' | 'agent',
    senderAgentId?: string,
    senderAgentName?: string,
    targetAgentIds?: string[],
    targetMode: boolean = false,
    media?: Array<{ type: 'image'; mimeType: string; data: string; preview: string }>
  ) => {
    if (!roundTable) {
      console.log('[RoundTable] broadcastMessageToAgents: roundTable is null');
      return;
    }
    
    const targets = targetAgentIds 
      ? roundTable.participants.filter(p => targetAgentIds.includes(p.session_id))
      : roundTable.participants;
    
    console.log(`[RoundTable] Broadcasting message to ${targets.length} agents, targetIds:`, targetAgentIds, 'targetMode:', targetMode, 'media:', media?.length || 0);
    
    for (const agent of targets) {
      // 不给自己发消息
      if (agent.session_id === senderAgentId) continue;
      
      console.log(`[RoundTable] Enqueuing message for agent ${agent.name} (${agent.session_id})`);
      enqueueMessage(
        agent.session_id,
        messageId,
        content,
        senderType,
        senderAgentName,
        targetMode,
        media
      );
    }
  };
  
  // 发送消息（使用消息队列系统）
  const handleSendMessage = async () => {
    // 允许发送文本或图片（至少有一个）
    if ((!inputValue.trim() && attachedMedia.length === 0) || isSending || !roundTable) return;
    
    const content = inputValue.trim() || (attachedMedia.length > 0 ? '[包含图片]' : '');
    const currentMedia = [...attachedMedia]; // 保存当前媒体
    const currentTargetMode = isTargetMode; // 保存当前的目标模式
    setInputValue('');
    setAttachedMedia([]); // 清空媒体
    setIsSending(true);
    
    // 用户发送新消息时，重置所有 agent 的发言计数
    resetAgentResponseCounts();
    
    console.log(`[RoundTable] User sending message, targetMode: ${currentTargetMode}, media: ${currentMedia.length}, maxResponses: ${currentTargetMode ? MAX_RESPONSES_TARGET : MAX_RESPONSES_NON_TARGET}`);
    
    try {
      // 解析 @ 提及
      const mentions = parseMentions(content, roundTable.participants);
      
      // 发送用户消息（包含媒体）
      const userMessage = await sendMessage(roundTableId, {
        content,
        sender_type: 'user',
        mentions,
        media: currentMedia.length > 0 ? currentMedia : undefined,
        reply_to_message_id: replyingTo?.id, // 引用消息ID
      });
      
      // 清除引用状态
      setReplyingTo(null);
      
      // 更新消息列表
      appendMessage(toUnifiedRoundTableMessage(userMessage));
      
      // 确定需要响应的智能体
      const targetAgentIds = mentions.length > 0
        ? mentions
        : roundTable.participants.map(p => p.session_id);
      
      if (targetAgentIds.length === 0) {
        setIsSending(false);
        return;
      }
      
      // 将消息加入所有目标智能体的队列（传入目标模式和媒体）
      broadcastMessageToAgents(
        userMessage.message_id,
        content,
        'user',
        undefined,
        '用户',
        targetAgentIds,
        currentTargetMode,
        currentMedia
      );
      
    } catch (error) {
      console.error('[RoundTable] Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };
  
  // 选择响应并可选广播
  const handleSelectResponseAndBroadcast = async (messageId: string, responseId: string, agentId: string, content: string) => {
    await handleSelectResponse(messageId, responseId);
    
    // 找到发送响应的智能体
    const senderAgent = roundTable?.participants.find(p => p.session_id === agentId);
    if (senderAgent) {
      // 检查是否有 @ 其他智能体（排除自己）
      const allMentions = parseMentions(content, roundTable?.participants || []);
      const mentions = allMentions.filter(m => m !== agentId);
      
      if (mentions.length > 0) {
        // 发送到群聊
        const agentMessage = await sendMessage(roundTableId, {
          content,
          sender_type: 'agent',
          sender_agent_id: agentId,
          mentions,
        });
        
        // 确保消息包含正确的 agent 信息
        const messageWithAgentInfo = {
          ...agentMessage,
          agent_name: agentMessage.agent_name || senderAgent.name,
          agent_avatar: agentMessage.agent_avatar || senderAgent.avatar,
          responses: agentMessage.responses || [],
        };
        
        // 更新消息列表
        appendMessage(toUnifiedRoundTableMessage(messageWithAgentInfo));
        
        // 将消息加入被 @ 智能体的队列
        broadcastMessageToAgents(
          agentMessage.message_id,
          content,
          'agent',
          agentId,
          senderAgent.name,
          mentions
        );
      }
    }
  };
  
  // 选择响应
  const handleSelectResponse = async (messageId: string, responseId: string) => {
    try {
      await selectResponse(roundTableId, responseId);
      
      setMessages(prev =>
        prev.map(m => {
          if (m.id !== messageId) return m;
          const prevResponses = ((m.meta?.responses || []) as any[]).slice();
          return {
            ...m,
            meta: {
              ...(m.meta || {}),
              responses: prevResponses.map(r => ({
                ...r,
                is_selected: r.response_id === responseId,
              })),
            },
          };
        })
      );
    } catch (error) {
      console.error('[RoundTable] Failed to select response:', error);
    }
  };
  
  // 移除参与者（执行）
  const performRemoveParticipant = async (participant: RoundTableParticipant) => {
    try {
      await removeParticipant(roundTableId, participant.session_id);
      await loadRoundTable(false);
      onParticipantChange?.();

      await sendMessage(roundTableId, {
        content: `${participant.name} 已离开圆桌会议`,
        sender_type: 'system',
      });
      await loadConversationInitial({ force: true });
      toast({ title: '已移出圆桌会议', variant: 'success' });
    } catch (error) {
      console.error('[RoundTable] Failed to remove participant:', error);
      toast({
        title: '移除参与者失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 移除参与者（确认）
  const handleRemoveParticipant = (sessionId: string) => {
    const participant =
      roundTable?.participants.find(p => p.session_id === sessionId) || null;
    setRemoveTarget(participant);
  };

  const availableAgentsForPicker = useMemo(() => {
    const existing = new Set((roundTable?.participants || []).map(p => p.session_id));
    return allAgents.filter(a => !existing.has(a.session_id));
  }, [allAgents, roundTable?.participants]);

  const performAddParticipant = async (agent: AgentSession) => {
    try {
      await addParticipant(roundTableId, agent.session_id);
      await loadRoundTable(false);
      onParticipantChange?.();

      await sendMessage(roundTableId, {
        content: `${agent.name || agent.title || '智能体'} 已加入圆桌会议`,
        sender_type: 'system',
      });
      await loadConversationInitial({ force: true });

      // 关闭下拉
      if (addParticipantDetailsRef.current) {
        addParticipantDetailsRef.current.open = false;
      }
      toast({ title: '已添加参会人', variant: 'success' });
    } catch (error) {
      console.error('[RoundTable] Failed to add participant:', error);
      toast({
        title: '添加参会人失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };
  
  // 更新参与者配置
  const handleUpdateParticipant = async (
    sessionId: string,
    updates: { custom_llm_config_id?: string | null; custom_system_prompt?: string | null; media_output_path?: string | null }
  ) => {
    try {
      // 媒体路径保存到 sessions 表（agent 级别，永久保存）
      if ('media_output_path' in updates) {
        await updateSessionMediaOutputPath(sessionId, updates.media_output_path || null);
        console.log(`[RoundTable] Updated media_output_path for agent ${sessionId}: ${updates.media_output_path}`);
      }
      
      // 其他配置保存到 round_table_participants 表（会议特定的临时配置）
      const participantUpdates: { custom_llm_config_id?: string | null; custom_system_prompt?: string | null } = {};
      if ('custom_llm_config_id' in updates) {
        participantUpdates.custom_llm_config_id = updates.custom_llm_config_id;
      }
      if ('custom_system_prompt' in updates) {
        participantUpdates.custom_system_prompt = updates.custom_system_prompt;
      }
      
      if (Object.keys(participantUpdates).length > 0) {
        await updateParticipant(roundTableId, sessionId, participantUpdates);
      }
      
      await loadRoundTable(false);
      setShowConfigModal(false);
      setEditingParticipant(null);
    } catch (error) {
      console.error('[RoundTable] Failed to update participant:', error);
    }
  };
  
  // 按键处理
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 如果正在显示 @ 提及下拉菜单
    if (showMentionDropdown) {
      const list = filteredAtSuggestions;
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelectedIndex(prev => 
          prev < list.length - 1 ? prev + 1 : 0
        );
        return;
      }
      
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIndex(prev => 
          prev > 0 ? prev - 1 : list.length - 1
        );
        return;
      }
      
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (list.length > 0) {
          pickAtSuggestion(list[mentionSelectedIndex]);
        }
        return;
      }
      
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionDropdown(false);
        return;
      }
    }
    
    // 普通回车发送消息
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader className="w-6 h-6 animate-spin text-primary-500" />
        <span className="ml-2 text-gray-500">加载中...</span>
      </div>
    );
  }
  
  if (!roundTable) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        圆桌会议不存在
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#2d2d2d] overflow-hidden">
      {/* 顶部：标题栏 */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-[#404040]">
        {/* 标题栏 */}
        <div className="px-3 py-2 flex items-center justify-between border-b border-gray-100 dark:border-[#404040]">
          <div className="flex items-center space-x-2">
            <MessageCircle className="w-4 h-4 text-primary-500" />
            <span className="font-medium text-gray-900 dark:text-white text-sm">
              {roundTable.name}
            </span>
          </div>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => loadRoundTable(false)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              title="刷新"
            >
              <RotateCw className="w-3 h-3 text-gray-500" />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* 主内容区：对话 + 工具边栏 */}
      <div className="flex-1 flex min-w-0 overflow-hidden relative">
        {/* 对话区 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto hide-scrollbar px-3 py-2 space-y-4" style={{ paddingBottom: floatingComposerPadding }}>
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-8">
                开始圆桌会议对话...
              </div>
            ) : (
              messages.map((message, idx) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  onSelectResponse={(responseId, agentId, content) => handleSelectResponseAndBroadcast(message.id, responseId, agentId, content)}
                  streamingResponses={idx === messages.length - 1 ? streamingResponses : undefined}
                  streamingThinking={idx === messages.length - 1 ? streamingThinking : undefined}
                  pendingAgents={idx === messages.length - 1 ? pendingResponses : undefined}
                  onCancelAgent={cancelAgentResponse}
                  participants={roundTable.participants}
                  onPreviewImage={(url, mimeType) => setPreviewImage({ url, mimeType })}
                  onReply={(msg) => setReplyingTo(msg)}
                  allMessages={messages}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
          
          {/* 输入区（浮岛悬浮） */}
          <div className={floatingComposerContainerClass}>
            <div
              ref={floatingComposerRef}
              className={floatingComposerInnerClass}
            >
            {/* 引用消息预览 */}
            {replyingTo && (
              <div className="mb-3 flex items-start gap-2 p-2 bg-gray-100 dark:bg-[#363636] rounded-lg border-l-2 border-[var(--color-accent)]">
                <CornerDownRight className="w-4 h-4 text-[var(--color-accent)] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
                    <span>回复</span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {(replyingTo.meta?.sender_type as any) === 'user'
                        ? '用户'
                        : (replyingTo.meta?.agent_name as string) || '智能体'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 truncate">
                    {replyingTo.content?.substring(0, 100) || '[媒体消息]'}
                  </p>
                </div>
                <button
                  onClick={() => setReplyingTo(null)}
                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                  title="取消引用"
                >
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              </div>
            )}
            
            {/* 图片预览区域 */}
            {attachedMedia.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {attachedMedia.map((media, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={media.preview}
                      alt={`附件 ${index + 1}`}
                      className="h-16 w-auto rounded-lg border border-gray-200 dark:border-[#404040] object-cover"
                    />
                    <button
                      onClick={() => setAttachedMedia(prev => prev.filter((_, i) => i !== index))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* 输入区（浮岛样式：上方工具Tag，下方输入框；聚焦时阴影变化） */}
            <div
              className={`relative rounded-xl bg-transparent transition-shadow ${
                isInputFocused ? 'shadow-lg ring-1 ring-[var(--color-accent)]/20' : 'shadow-sm'
              }`}
            >
              {/* 顶部：参会人栏 */}
              <div className="px-3 py-2 bg-white/45 dark:bg-[#262626]/45 backdrop-blur-md border-b border-black/5 dark:border-white/10 rounded-t-xl flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#7c3aed]/10 text-[#7c3aed] text-[10px] font-medium flex-shrink-0">
                    <Users className="w-3 h-3" />
                    <span>{roundTable.participants.length}</span>
                  </div>

                  {/* 参会人头像（点击移除） */}
                  <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide min-w-0">
                    {roundTable.participants.map((p) => (
                      <button
                        key={p.session_id}
                        onClick={() => handleRemoveParticipant(p.session_id)}
                        className="group relative w-5 h-5 rounded-full overflow-hidden bg-gray-100 dark:bg-[#363636] flex-shrink-0"
                        title={`移除：${p.name || p.session_id}`}
                      >
                        {p.avatar ? (
                          <img src={p.avatar} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[8px] text-gray-600 dark:text-[#b0b0b0] w-full h-full flex items-center justify-center">A</span>
                        )}
                        <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[8px]">
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 添加参会人 */}
                <div className="relative flex-shrink-0">
                  <details className="group" ref={addParticipantDetailsRef}>
                    <summary
                      className="list-none cursor-pointer p-1 rounded hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-500 dark:text-[#808080]"
                      title="添加参会人"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </summary>
                    <div className="absolute right-0 bottom-full mb-1 w-56 max-h-52 overflow-auto rounded-lg bg-white dark:bg-[#2d2d2d] shadow-xl z-50">
                      <div className="px-2 py-1.5 text-[10px] text-gray-500 dark:text-[#909090] border-b border-gray-100 dark:border-[#363636]">
                        点击添加参会人
                      </div>
                      {availableAgentsForPicker.length === 0 ? (
                        <div className="px-2 py-2 text-xs text-gray-500 dark:text-[#909090]">无更多</div>
                      ) : (
                        availableAgentsForPicker.map(a => (
                          <button
                            key={a.session_id}
                            onClick={() => performAddParticipant(a)}
                            className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#363636] text-left"
                          >
                            <div className="w-5 h-5 rounded-full overflow-hidden bg-gray-100 dark:bg-[#363636] flex items-center justify-center flex-shrink-0">
                              {a.avatar ? (
                                <img src={a.avatar} alt={a.name || a.session_id} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-[8px] text-gray-600 dark:text-[#b0b0b0]">A</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-700 dark:text-[#d0d0d0] truncate">{a.name || a.title || a.session_id}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </details>
                </div>
              </div>

              {/* 顶部：工具 Tag（上方摆放） */}
              <div className="px-3 py-1.5 border-b border-gray-100 dark:border-[#363636]">
                <InputToolTags
                  mcpServers={mcpServers.filter(s => s.enabled).map(s => ({
                    id: s.server_id || s.id,
                    name: s.name,
                    display_name: s.display_name,
                  }))}
                  workflows={workflows.map(w => ({
                    workflow_id: w.workflow_id,
                    name: w.name,
                    description: w.description,
                  }))}
                  enableMCP={enableMCP}
                  onToggleMCP={setEnableMCP}
                  enableWorkflow={enableWorkflow}
                  onToggleWorkflow={setEnableWorkflow}
                  mcpMode="toggle"
                  workflowMode="toggle"
                  showSkillPack={false}
                  showSources={false}
                  onAttachFile={(files) => {
                    Array.from(files).forEach(file => {
                      if (!file.type.startsWith('image/')) return;
                      const reader = new FileReader();
                      reader.onload = (e) => {
                        const result = e.target?.result as string;
                        const base64Data = result.includes(',') ? result.split(',')[1] : result;
                        setAttachedMedia(prev => [...prev, {
                          type: 'image',
                          mimeType: file.type,
                          data: base64Data,
                          preview: result,
                        }]);
                      };
                      reader.readAsDataURL(file);
                    });
                  }}
                  attachedMediaCount={attachedMedia.length}
                />
              </div>

              {/* 输入框 + 发送按钮 */}
              <div className="relative flex items-end gap-2 p-2 bg-white/45 dark:bg-[#262626]/45 backdrop-blur-md rounded-b-xl">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onKeyUp={() => scheduleUpdateAtDropdown()}
                  onClick={() => scheduleUpdateAtDropdown()}
                  onSelect={() => scheduleUpdateAtDropdown()}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => {
                    setIsInputFocused(false);
                    setShowMentionDropdown(false);
                  }}
                  onPaste={(e) => {
                  // 检查粘贴板中是否有图片
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  
                  const imageItems: DataTransferItem[] = [];
                  for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item.type.startsWith('image/')) {
                      imageItems.push(item);
                    }
                  }
                  
                  // 如果有图片，处理图片粘贴
                  if (imageItems.length > 0) {
                    e.preventDefault(); // 阻止默认的文本粘贴行为
                    
                    imageItems.forEach(item => {
                      const file = item.getAsFile();
                      if (!file) return;
                      
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        const result = event.target?.result as string;
                        // 移除 data URL 前缀，只保留 base64 数据
                        const base64Data = result.includes(',') ? result.split(',')[1] : result;
                        const mimeType = file.type || 'image/png';
                        
                        setAttachedMedia(prev => [...prev, {
                          type: 'image',
                          mimeType,
                          data: base64Data,
                          preview: result, // 用于预览
                        }]);
                        
                        console.log('[RoundTable] 已粘贴图片:', mimeType, '大小:', Math.round(base64Data.length / 1024), 'KB');
                      };
                      reader.readAsDataURL(file);
                    });
                  }
                }}
                  placeholder={isTargetMode ? "🎯 目标式发言：描述你的目标，AI会协作完成..." : "输入消息，使用 @ 提及特定智能体，粘贴图片..."}
                  className="flex-1 min-h-[44px] max-h-[150px] resize-y px-3 py-2 text-sm bg-transparent text-gray-800 dark:text-[#e0e0e0] placeholder-gray-400 dark:placeholder-[#606060] focus:outline-none"
                  disabled={isSending}
                />
              
              {/* @ 提及下拉菜单 */}
              {showMentionDropdown && (
                <div className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg max-h-48 overflow-y-auto z-20">
                  {filteredAtSuggestions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      无匹配项（支持：智能体 / MCP / Workflow）
                    </div>
                  ) : (
                    filteredAtSuggestions.map((item, index) => (
                      <Button
                        key={item.id}
                        variant="ghost"
                        size="sm"
                        onMouseDown={(e) => {
                          // 保持 textarea 焦点与 caret，避免点击候选导致下拉闪烁/消失
                          e.preventDefault();
                        }}
                        onClick={() => pickAtSuggestion(item)}
                        className={[
                          'w-full h-auto px-3 py-2 rounded-none justify-start items-start',
                          'text-left flex gap-2',
                          index === mentionSelectedIndex
                            ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                            : 'hover:bg-gray-100 dark:hover:bg-[#363636]',
                        ].join(' ')}
                      >
                        <div className="w-6 h-6 rounded-full overflow-hidden border border-gray-200 dark:border-[#404040] flex items-center justify-center bg-purple-100 dark:bg-purple-900/30 flex-shrink-0 mt-0.5">
                          <Bot className="w-3 h-3 text-purple-500" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900 dark:text-white truncate">{item.label}</div>
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                            {item.description || (item.kind === 'agent' ? '智能体' : item.kind === 'workflow' ? '工作流' : 'MCP')}
                          </div>
                        </div>
                      </Button>
                    ))
                  )}
                </div>
              )}
              
                {/* 右侧：发送按钮 */}
                <Button
                  onClick={handleSendMessage}
                  disabled={(!inputValue.trim() && attachedMedia.length === 0) || isSending}
                  variant="primary"
                  className="px-4"
                  title="发送"
                >
                  {isSending ? '…' : '发送'}
                </Button>
              </div>
            </div>
            
            {/* 发言计数 */}
            {agentResponseCounts.size > 0 && (
              <div className="flex items-center flex-wrap gap-1 mt-2 text-[10px] text-gray-400">
                <span>发言:</span>
                {Array.from(agentResponseCounts.entries()).map(([agentId, count]) => {
                  const agent = roundTable.participants.find(p => p.session_id === agentId);
                  const maxCount = isTargetMode ? MAX_RESPONSES_TARGET : MAX_RESPONSES_NON_TARGET;
                  const isAtLimit = count >= maxCount;
                  return (
                    <span 
                      key={agentId} 
                      className={`px-1.5 py-0.5 rounded ${isAtLimit ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-gray-700'}`}
                    >
                      {agent?.name?.substring(0, 4) || '?'}: {count}/{maxCount}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          </div>
      </div>
      
      {/* 右侧工具箱已移除（工具已在发送框工具 Tag 处集成） */}
      </div>
      
      {/* 配置弹框 */}
      {showConfigModal && editingParticipant && (
        <ParticipantConfigModal
          participant={editingParticipant}
          llmConfigs={llmConfigs}
          onSave={(updates) => handleUpdateParticipant(editingParticipant.session_id, updates)}
          onClose={() => {
            setShowConfigModal(false);
            setEditingParticipant(null);
          }}
        />
      )}
      
      {/* 图片预览弹框 */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            {/* 关闭按钮 */}
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white transition-colors"
              title="关闭"
            >
              <X className="w-6 h-6" />
            </button>
            
            {/* 图片 */}
            <img
              src={previewImage.url}
              alt="预览"
              className="max-w-full max-h-[85vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            
            {/* 底部操作栏 */}
            <div 
              className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-4 p-4 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = previewImage.url;
                  link.download = `roundtable-image-${Date.now()}.${previewImage.mimeType.split('/')[1] || 'png'}`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>下载</span>
              </button>
              <button
                onClick={() => window.open(previewImage.url, '_blank')}
                className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span>新窗口打开</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移出圆桌会议</DialogTitle>
            <DialogDescription>
              确定要将「{removeTarget?.name || removeTarget?.session_id}」移出当前圆桌会议吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!removeTarget) return;
                const target = removeTarget;
                setRemoveTarget(null);
                await performRemoveParticipant(target);
              }}
            >
              移出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

RoundTablePanel.displayName = 'RoundTablePanel';

// ==================== 子组件 ====================

// 消息项组件
interface MessageItemProps {
  message: UnifiedMessage;
  onSelectResponse: (responseId: string, agentId: string, content: string) => void;
  streamingResponses?: Map<string, string>;
  streamingThinking?: Map<string, string>;
  pendingAgents?: Set<string>;
  onCancelAgent?: (agentId: string) => void;
  participants?: RoundTableParticipant[];
  onPreviewImage?: (url: string, mimeType: string) => void;
  onReply?: (message: UnifiedMessage) => void;
  allMessages?: UnifiedMessage[]; // 用于查找引用的消息
}

const MessageItem: React.FC<MessageItemProps> = ({ 
  message, 
  onSelectResponse,
  streamingResponses,
  streamingThinking,
  pendingAgents,
  onCancelAgent,
  participants,
  onPreviewImage,
  onReply,
  allMessages,
}) => {
  const [showAllResponses, setShowAllResponses] = useState(false);
  
  const senderType = (message.meta?.sender_type as any) as 'user' | 'agent' | 'system' | undefined;
  const isUserMessage = senderType === 'user';
  const isSystemMessage = senderType === 'system';
  const responses = ((message.meta?.responses || []) as any[]) as RoundTableResponse[];
  const mentions = ((message.meta?.mentions || []) as any[]) as string[];
  const hasMultipleResponses = responses.length > 1;
  const selectedResponse = responses.find(r => r.is_selected);
  
  if (isSystemMessage) {
    return <SystemNotification content={message.content} />;
  }
  
  // 所有消息都用左右布局：用户右边，AI左边
  return (
    <div className={`flex ${isUserMessage ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%]`}>
        {/* 发送者信息（AI消息显示在左侧） - 使用统一头像组件 */}
        {!isUserMessage && (
          <div className="flex items-center space-x-2 mb-1">
            <MessageAvatar 
              role="assistant" 
              avatarUrl={message.meta?.agent_avatar as string | undefined}
              size="sm"
            />
            <span className="text-xs text-gray-500">{(message.meta?.agent_name as string) || '智能体'}</span>
            {message.meta?.is_raise_hand && (
              <span className="text-xs text-yellow-500 flex items-center">
                <Hand className="w-3 h-3 mr-0.5" />
                举手
              </span>
            )}
          </div>
        )}
        
        {/* 用户信息（显示在右侧） - 使用统一头像组件 */}
        {isUserMessage && (
          <div className="flex items-center justify-end space-x-2 mb-1">
            <span className="text-xs text-gray-500">我</span>
            <MessageAvatar role="user" size="sm" />
          </div>
        )}
        
        {/* 消息内容 - 使用统一消息气泡样式 */}
        <MessageBubble
          role={isUserMessage ? 'user' : 'assistant'}
          className="group/msg relative"
          styleConfig={{ 
            compact: true,
            cornerDirection: isUserMessage ? 'tr' : 'tl'
          }}
        >
          {/* 引用消息显示 */}
          {message.meta?.reply_to_message_id && (() => {
            const repliedId = message.meta?.reply_to_message_id as string;
            const repliedMessage = allMessages?.find(m => m.id === repliedId);
            if (!repliedMessage) return null;
            const repliedSenderType = (repliedMessage.meta?.sender_type as any) as 'user' | 'agent' | 'system' | undefined;
            return (
              <div className={`mb-2 p-1.5 rounded text-xs border-l-2 ${
                isUserMessage 
                  ? 'bg-white/10 border-white/50' 
                  : 'bg-gray-200 dark:bg-gray-700 border-primary-400'
              }`}>
                <div className="flex items-center gap-1 mb-0.5">
                  <CornerDownRight className="w-3 h-3 opacity-70" />
                  <span className="opacity-70">回复</span>
                  <span className="font-medium">
                    {repliedSenderType === 'user' ? '用户' : ((repliedMessage.meta?.agent_name as string) || '智能体')}
                  </span>
                </div>
                <p className="truncate opacity-80">
                  {repliedMessage.content?.substring(0, 60) || '[媒体消息]'}
                  {repliedMessage.content && repliedMessage.content.length > 60 ? '...' : ''}
                </p>
              </div>
            );
          })()}
          
          {/* 回复按钮（悬停显示） - 用户消息在左上角，AI消息在右上角 */}
          <button
            onClick={() => onReply?.(message)}
            className={`absolute top-1 p-1 rounded opacity-0 group-hover/msg:opacity-100 transition-opacity ${
              isUserMessage
                ? 'left-1 bg-white/20 hover:bg-white/30 text-white'
                : 'right-1 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-600 dark:text-gray-300'
            }`}
            title="回复此消息"
          >
            <Reply className="w-3 h-3" />
          </button>
          
          {/* 图片显示 */}
          {message.media && message.media.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.media
                .filter(m => m.type === 'image')
                .map((m, idx) => {
                const imageUrl = m.url || null;
                if (!imageUrl) return null;
                
                const handleDownload = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  // 创建下载链接
                  const link = document.createElement('a');
                  link.href = imageUrl;
                  link.download = `roundtable-image-${Date.now()}-${idx + 1}.${m.mimeType?.split('/')[1] || 'png'}`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                };
                
                const handlePreview = () => {
                  onPreviewImage?.(imageUrl, m.mimeType || 'image/png');
                };
                
                return (
                  <div key={idx} className="relative group">
                    <img
                      src={imageUrl}
                      alt={`图片 ${idx + 1}`}
                      className="max-h-48 max-w-xs rounded border border-white/20 cursor-pointer hover:opacity-90 object-contain transition-opacity"
                      onClick={handlePreview}
                    />
                    {/* 悬停操作按钮 */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center gap-2">
                      <button
                        onClick={handlePreview}
                        className="p-2 bg-white/90 rounded-full hover:bg-white transition-colors"
                        title="预览"
                      >
                        <ZoomIn className="w-4 h-4 text-gray-700" />
                      </button>
                      <button
                        onClick={handleDownload}
                        className="p-2 bg-white/90 rounded-full hover:bg-white transition-colors"
                        title="下载"
                      >
                        <Download className="w-4 h-4 text-gray-700" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); window.open(imageUrl, '_blank'); }}
                        className="p-2 bg-white/90 rounded-full hover:bg-white transition-colors"
                        title="新窗口打开"
                      >
                        <ExternalLink className="w-4 h-4 text-gray-700" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {isUserMessage ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <MessageRenderer content={message.content} variant="compact" />
          )}
          
          {/* 提及标签 */}
          {mentions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {mentions.map((mention, idx) => (
                <span 
                  key={idx}
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    isUserMessage ? 'bg-white/20' : 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                  }`}
                >
                  @{participants?.find(p => p.session_id === mention)?.name || mention.substring(0, 8)}
                </span>
              ))}
            </div>
          )}
        </MessageBubble>
        
        {/* 流式响应区域（正在生成的响应） - 使用统一组件 */}
        {isUserMessage && pendingAgents && pendingAgents.size > 0 && (
          <div className="mt-2 space-y-2">
            {Array.from(pendingAgents).map(agentId => {
              const streamContent = streamingResponses?.get(agentId) || '';
              const streamThinking = streamingThinking?.get(agentId) || '';
              const agent = participants?.find(p => p.session_id === agentId);
              
              return (
                <StreamingResponse
                  key={agentId}
                  agentId={agentId}
                  agentName={agent?.name}
                  agentAvatar={agent?.avatar}
                  streamContent={streamContent}
                  streamThinking={streamThinking}
                  onCancel={() => onCancelAgent?.(agentId)}
                  renderContent={(content) => <MessageRenderer content={content} variant="compact" />}
                />
              );
            })}
          </div>
        )}
        
        {/* 已完成的响应区域 */}
        {isUserMessage && responses.length > 0 && (
          <div className="mt-2 space-y-2">
            {/* 已选中的响应 */}
            {selectedResponse && (
              <ResponseCard 
                response={selectedResponse} 
                isSelected={true}
                onSelect={() => {}}
              />
            )}
            
            {/* 多响应选择器 */}
            {hasMultipleResponses && (
              <div>
                <button
                  onClick={() => setShowAllResponses(!showAllResponses)}
                  className="text-xs text-primary-500 hover:text-primary-600 flex items-center"
                >
                  {showAllResponses ? (
                    <>
                      <ChevronUp className="w-3 h-3 mr-1" />
                      收起其他响应
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3 h-3 mr-1" />
                      查看其他 {responses.length - (selectedResponse ? 1 : 0)} 个响应
                    </>
                  )}
                </button>
                
                {showAllResponses && (
                  <div className="mt-2 space-y-2">
                    {responses
                      .filter(r => !r.is_selected)
                      .map(response => (
                        <ResponseCard
                          key={response.response_id}
                          response={response}
                          isSelected={false}
                          onSelect={() => onSelectResponse(response.response_id, response.agent_id, response.content)}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
            
            {/* 单响应未选中 */}
            {!hasMultipleResponses && !selectedResponse && responses.length === 1 && (
              <ResponseCard 
                response={responses[0]} 
                isSelected={false}
                onSelect={() => onSelectResponse(responses[0].response_id, responses[0].agent_id, responses[0].content)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// 响应卡片组件
interface ResponseCardProps {
  response: RoundTableResponse;
  isSelected: boolean;
  onSelect: () => void;
}

const ResponseCard: React.FC<ResponseCardProps> = ({ response, isSelected, onSelect }) => {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div 
      className={`p-3 rounded-lg border ${
        isSelected 
          ? 'border-green-500 bg-green-50 dark:bg-green-900/20' 
          : 'border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d]'
      }`}
    >
      {/* 头部 - 使用统一头像组件 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <MessageAvatar 
            role="assistant" 
            avatarUrl={response.agent_avatar}
            size="sm"
          />
          <span className="text-xs font-medium text-gray-900 dark:text-white">
            {response.agent_name}
          </span>
          {isSelected && (
            <span className="text-xs text-green-500 flex items-center">
              <Check className="w-3 h-3 mr-0.5" />
              已采纳
            </span>
          )}
        </div>
        
        {!isSelected && (
          <button
            onClick={onSelect}
            className="text-xs px-2 py-1 bg-primary-500 text-white rounded hover:bg-primary-600"
          >
            采纳
          </button>
        )}
      </div>
      
      {/* 内容 */}
      <div className={`text-gray-700 dark:text-gray-300 ${!expanded && 'max-h-24 overflow-hidden'}`}>
        <MessageRenderer content={response.content} variant="compact" />
      </div>
      
      {response.content.length > 200 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary-500 mt-1"
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
      
      {/* 思考过程 */}
      {response.thinking && (
        <details className="mt-2">
          <summary className="text-xs text-gray-500 cursor-pointer">
            查看思考过程
          </summary>
          <div className="mt-1 p-2 bg-gray-50 dark:bg-[#2d2d2d] rounded text-xs text-gray-600 dark:text-gray-400">
            {response.thinking}
          </div>
        </details>
      )}
    </div>
  );
};

// 参与者配置弹框
interface ParticipantConfigModalProps {
  participant: RoundTableParticipant;
  llmConfigs: LLMConfigFromDB[];
  onSave: (updates: { custom_llm_config_id?: string | null; custom_system_prompt?: string | null; media_output_path?: string | null }) => void;
  onClose: () => void;
}

const ParticipantConfigModal: React.FC<ParticipantConfigModalProps> = ({
  participant,
  llmConfigs,
  onSave,
  onClose,
}) => {
  const [llmConfigId, setLlmConfigId] = useState(
    participant.custom_llm_config_id || participant.llm_config_id || ''
  );
  const [systemPrompt, setSystemPrompt] = useState(
    participant.custom_system_prompt || participant.system_prompt || ''
  );
  const [mediaOutputPath, setMediaOutputPath] = useState(
    participant.media_output_path || ''
  );
  
  // 当 participant 变化时，同步更新状态（确保配置被正确加载）
  useEffect(() => {
    setLlmConfigId(participant.custom_llm_config_id || participant.llm_config_id || '');
    setSystemPrompt(participant.custom_system_prompt || participant.system_prompt || '');
    setMediaOutputPath(participant.media_output_path || '');
  }, [participant.session_id, participant.custom_llm_config_id, participant.llm_config_id, 
      participant.custom_system_prompt, participant.system_prompt, participant.media_output_path]);
  
  const handleSave = () => {
    onSave({
      custom_llm_config_id: llmConfigId || null,
      custom_system_prompt: systemPrompt || null,
      media_output_path: mediaOutputPath || null,
    });
  };
  
  const handleReset = () => {
    // 重置为智能体的原始默认值（不是自定义值）
    setLlmConfigId(participant.llm_config_id || '');
    setSystemPrompt(participant.system_prompt || '');
    // 媒体路径重置时保留已配置的路径，因为这是用户设置的
    setMediaOutputPath(participant.media_output_path || '');
  };
  
  // 点击背景关闭
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };
  
  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white dark:bg-[#2d2d2d] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-[#404040]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-purple-200 dark:border-purple-800 flex items-center justify-center bg-purple-100 dark:bg-purple-900/30">
              {participant.avatar ? (
                <img 
                  src={participant.avatar} 
                  alt={participant.name} 
                  className="w-full h-full object-cover" 
                />
              ) : (
                <Bot className="w-5 h-5 text-purple-500" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                配置 {participant.name}
              </h3>
              <p className="text-xs text-gray-500">自定义此智能体在圆桌会议中的设置</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        
        {/* 内容 */}
        <div className="px-5 py-4 space-y-4">
          {/* 当前生效模型显示 */}
          <div className="p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-200 dark:border-primary-800">
            <div className="text-xs text-primary-600 dark:text-primary-400 mb-1">当前生效模型</div>
            <div className="font-medium text-primary-700 dark:text-primary-300">
              {llmConfigs.find(c => c.config_id === (llmConfigId || participant.llm_config_id))?.name || '未设置'}
            </div>
          </div>
          
          {/* 模型选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              切换模型
            </label>
            <select
              value={llmConfigId}
              onChange={(e) => setLlmConfigId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">使用智能体默认模型</option>
              {llmConfigs.filter(c => c.enabled).map(config => {
                const isCurrentDefault = config.config_id === participant.llm_config_id;
                const isSelected = config.config_id === llmConfigId;
                return (
                  <option 
                    key={config.config_id} 
                    value={config.config_id}
                  >
                    {config.name}{isCurrentDefault ? ' (默认)' : ''}{isSelected ? ' ✓' : ''}
                  </option>
                );
              })}
            </select>
            {participant.llm_config_id && (
              <p className="mt-1 text-xs text-gray-500">
                智能体默认模型：{llmConfigs.find(c => c.config_id === participant.llm_config_id)?.name || '未知'}
              </p>
            )}
          </div>
          
          {/* 系统提示词 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              人设（系统提示词）
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-white resize-none"
              rows={6}
              placeholder="输入自定义人设..."
            />
            {participant.system_prompt && (
              <p className="mt-1 text-xs text-gray-500 line-clamp-2">
                默认人设：{participant.system_prompt.substring(0, 100)}...
              </p>
            )}
          </div>
          
          {/* 媒体输出路径（适用于支持生成图片/视频/音频的模型） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              媒体输出路径
              <span className="ml-1 text-xs font-normal text-gray-500">（可选）</span>
            </label>
            <input
              type="text"
              value={mediaOutputPath}
              onChange={(e) => setMediaOutputPath(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-white"
              placeholder="/path/to/save/media"
            />
            <p className="mt-1 text-xs text-gray-500">
              支持生成图片/视频/音频的模型会将生成内容自动保存到此路径
            </p>
          </div>
        </div>
        
        {/* 操作按钮 */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#2d2d2d]/50">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            重置为默认
          </button>
          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoundTablePanel;
