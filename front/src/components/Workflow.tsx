/**
 * 工作流界面组件
 * 整合LLM模型和MCP工具，通过聊天完成任务
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Loader, Bot, Wrench, AlertCircle, CheckCircle, Brain, Plug, XCircle, ChevronDown, ChevronUp, MessageCircle, FileText, Sparkles, Workflow as WorkflowIcon, Play, ArrowRight, Trash2, X, Edit2, RotateCw, Database, Paperclip, Music, HelpCircle, Package, CheckSquare, Square, Quote, Lightbulb } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LLMClient, LLMMessage } from '../services/llmClient';
import { getLLMConfigs, getLLMConfig, getLLMConfigApiKey, LLMConfigFromDB } from '../services/llmApi';
import { mcpManager, MCPServer, MCPTool } from '../services/mcpClient';
import { getMCPServers, MCPServerConfig } from '../services/mcpApi';
import { getSessions, getAgents, getSession, createSession, getSessionMessages, saveMessage, summarizeSession, getSessionSummaries, deleteSession, clearSummarizeCache, deleteMessage, executeMessageComponent, updateSessionAvatar, updateSessionName, updateSessionSystemPrompt, updateSessionMediaOutputPath, updateSessionLLMConfig, upgradeToAgent, Session, Summary, MessageExt } from '../services/sessionApi';
import { getUserAccess, createOrUpdateUserAccess, UserAccess } from '../services/userAccessApi';
import { createRole } from '../services/roleApi';
import { createSkillPack, saveSkillPack, optimizeSkillPackSummary, getSkillPacks, getSessionSkillPacks, SkillPack, SessionSkillPack, SkillPackCreationResult, SkillPackProcessInfo } from '../services/skillPackApi';
import { estimate_messages_tokens, get_model_max_tokens, estimate_tokens } from '../services/tokenCounter';
import { getWorkflows, getWorkflow, Workflow as WorkflowType, WorkflowNode, WorkflowConnection } from '../services/workflowApi';
import { workflowPool } from '../services/workflowPool';
import { getBatch } from '../services/crawlerApi';
import { getRoundTables, type RoundTable, deleteRoundTable, createRoundTable } from '../services/roundTableApi';
import CrawlerModuleSelector from './CrawlerModuleSelector';
import CrawlerBatchItemSelector from './CrawlerBatchItemSelector';
import ComponentThumbnails from './ComponentThumbnails';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { toast } from './ui/use-toast';
import { PluginExecutionPanel } from './PluginExecutionPanel';
import { MCPExecutionCard } from './MCPExecutionCard';
import { MCPDetailOverlay } from './MCPDetailOverlay';
import { emitSessionsChanged, SESSIONS_CHANGED_EVENT } from '../utils/sessionEvents';
import { getDimensionOptions } from '../services/roleDimensionApi';
import { SplitViewMessage } from './SplitViewMessage';
import { MediaGallery, MediaItem } from './ui/MediaGallery';
import { SessionMediaPanel, SessionMediaItem } from './ui/SessionMediaPanel';
import { truncateBase64Strings } from '../utils/textUtils';
import { useConversation } from '../conversation/useConversation';
import { createSessionConversationAdapter } from '../conversation/adapters/sessionConversation';
import { MessageAvatar, MessageBubbleContainer, MessageStatusIndicator } from './ui/MessageBubble';
import {
  applyProfessionToNameOrPrompt,
  detectProfessionType,
  extractProfession,
} from './workflow/profession';
import { useFloatingComposerPadding } from './workflow/useFloatingComposerPadding';
import { parseMCPContentBlocks, renderMCPBlocks, renderMCPMedia } from './workflow/mcpRender';
import {
  SessionTypeDialog,
  UpgradeToAgentDialog,
  AvatarConfigDialog,
  SkillPackDialog,
  NewMeetingDialog,
  NewResearchDialog,
  NicknameDialog,
  PersonaPanel,
  RoleGeneratorDialog,
  HeaderConfigDialog,
  AddProfessionDialog,
  DEFAULT_CAREER_PROFESSIONS,
  DEFAULT_GAME_PROFESSIONS,
  SystemPromptEditDialog,
} from './workflow/dialogs';

/** 单个过程步骤（用于记录多轮思考和MCP调用） */
interface ProcessStep {
  /** 步骤类型 */
  type: 'thinking' | 'mcp_call' | 'workflow';
  /** 时间戳 */
  timestamp?: number;
  /** 思考内容（当 type === 'thinking' 时） */
  thinking?: string;
  /** MCP 服务器名称（当 type === 'mcp_call' 时） */
  mcpServer?: string;
  /** 工具名称（当 type === 'mcp_call' 时） */
  toolName?: string;
  /** 调用参数 */
  arguments?: any;
  /** 调用结果 */
  result?: any;
  /** 执行状态 */
  status?: 'pending' | 'running' | 'completed' | 'error';
  /** 执行时长（毫秒） */
  duration?: number;
  /** 工作流信息（当 type === 'workflow' 时） */
  workflowInfo?: {
    id?: string;
    name?: string;
    status?: 'pending' | 'running' | 'completed' | 'error';
    result?: string;
    config?: {
      nodes: WorkflowNode[];
      connections: WorkflowConnection[];
    };
  };
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string; // 思考过程（用于 o1 等思考模型）
  toolCalls?: Array<{ name: string; arguments: any; result?: any }> | { 
    // 系统提示词消息的元数据
    isSystemPrompt?: boolean;
    batchName?: string;
    item?: any;
    // 错误消息的重试元数据
    canRetry?: boolean;
    errorType?: 'network' | 'timeout' | 'api' | 'unknown';
    // 工具调用的标准格式（兼容）
    [key: string]: any;
  };
  isStreaming?: boolean; // 是否正在流式输出
  isThinking?: boolean; // 是否正在思考
  currentStep?: string; // 当前执行步骤（灰色小字显示）
  toolType?: 'workflow' | 'mcp'; // 感知组件类型（当 role === 'tool' 时使用）
  workflowId?: string; // 工作流ID（如果是工作流消息）
  workflowName?: string; // 工作流名称
  workflowStatus?: 'pending' | 'running' | 'completed' | 'error'; // 工作流状态
  workflowResult?: string; // 工作流执行结果
  workflowConfig?: { nodes: WorkflowNode[]; connections: WorkflowConnection[] }; // 工作流配置（节点和连接）
  isSummary?: boolean; // 是否是总结消息（不显示，但用于标记总结点）
  // 多模态内容支持
  media?: Array<{
    type: 'image' | 'video' | 'audio';
    mimeType: string;
    data: string; // base64 编码的数据或 URL
    url?: string; // 如果是 URL
  }>;
  // 思维签名（用于 Gemini）
  thoughtSignature?: string;
  toolCallSignatures?: Record<string, string>; // 工具调用的思维签名映射
  // MCP 执行详情（当 role === 'assistant' 且触发了 MCP 时）
  mcpdetail?: import('../services/sessionApi').MCPDetail;
  // 多轮过程步骤（保存完整的思考和MCP调用历史）
  processSteps?: ProcessStep[];
}

interface WorkflowProps {
  sessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onSelectMeeting?: (roundTableId: string) => void;
  onSelectResearch?: (researchSessionId: string) => void;
}

const Workflow: React.FC<WorkflowProps> = ({
  sessionId: externalSessionId,
  onSelectSession,
  onSelectMeeting,
  onSelectResearch,
}) => {
  const temporarySessionId = 'temporary-session'; // 临时会话ID（固定）
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(temporarySessionId);
  const [isTemporarySession, setIsTemporarySession] = useState(true); // 当前是否为临时会话（默认是临时会话）

  const [tempMessages, setTempMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: '你好！我是你的 AI 工作流助手。这是临时会话，不会保存历史记录。',
    },
  ]);

  const sessionAdapter = useMemo(
    () => (currentSessionId && !isTemporarySession ? createSessionConversationAdapter(currentSessionId) : null),
    [currentSessionId, isTemporarySession]
  );
  const {
    messages: persistedMessages,
    setMessages: setPersistedMessages,
    hasMoreBefore: hasMorePersistedMessages,
    loadMoreBefore: loadMorePersistedMessages,
    isLoading: isLoadingPersistedMessages,
    loadInitial: loadPersistedInitial,
  } = useConversation(sessionAdapter, { pageSize: 10 });

  // 兼容现有代码：统一通过 messages/setMessages 操作当前“显示中的会话”
  const messages: Message[] = (isTemporarySession
    ? tempMessages
    : (persistedMessages as unknown as Message[]));
  const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = (isTemporarySession
    ? setTempMessages
    : (setPersistedMessages as unknown as React.Dispatch<React.SetStateAction<Message[]>>));

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // 多模态内容（图片、视频、音频）
  const [attachedMedia, setAttachedMedia] = useState<Array<{
    type: 'image' | 'video' | 'audio';
    mimeType: string;
    data: string; // base64 编码的数据
    preview?: string; // 预览 URL（用于显示）
  }>>([]);
  
  // 会话媒体面板状态
  const [sessionMediaPanelOpen, setSessionMediaPanelOpen] = useState(false);
  const [sessionMediaInitialIndex, setSessionMediaInitialIndex] = useState(0);
  
  // 收集整个会话的所有媒体
  const sessionMedia: SessionMediaItem[] = useMemo(() => {
    // NOTE: Debug log removed for UX smoothness
    const mediaList: SessionMediaItem[] = [];
    
    messages.forEach((msg) => {
      // 消息中的媒体
      if (msg.media && msg.media.length > 0) {
        // NOTE: Debug log removed for UX smoothness
        msg.media.forEach(m => {
          mediaList.push({
            type: m.type,
            mimeType: m.mimeType,
            data: m.data,
            url: m.url,
            messageId: msg.id,
            role: msg.role as 'user' | 'assistant' | 'tool',
          });
        });
      }
      
      // MCP 返回内容中的媒体
      if (msg.content) {
        // 解析 MCP 内容中的媒体
        const mcpMediaMatches = msg.content.matchAll(/\[MCP_(IMAGE|VIDEO|AUDIO)\|(.*?)\|(.*?)\]/g);
        let mcpMediaCount = 0;
        for (const match of mcpMediaMatches) {
          mcpMediaCount++;
          const typeMap: Record<string, 'image' | 'video' | 'audio'> = {
            'IMAGE': 'image',
            'VIDEO': 'video',
            'AUDIO': 'audio',
          };
          mediaList.push({
            type: typeMap[match[1]] || 'image',
            mimeType: match[2],
            data: match[3],
            messageId: msg.id,
            role: msg.role as 'user' | 'assistant' | 'tool',
          });
        }
        if (mcpMediaCount > 0) {
          // NOTE: Debug log removed for UX smoothness
        }
      }
    });
    
    // NOTE: Debug log removed for UX smoothness
    return mediaList;
  }, [messages]);
  
  // 打开会话媒体面板
  const openSessionMediaPanel = useCallback((index: number) => {
    setSessionMediaInitialIndex(index);
    setSessionMediaPanelOpen(true);
  }, []);
  
  // 根据当前消息的媒体找到在会话媒体中的索引
  const findSessionMediaIndex = useCallback((messageId: string, mediaIndex: number): number => {
    let count = 0;
    for (const msg of messages) {
      if (msg.id === messageId) {
        return count + mediaIndex;
      }
      if (msg.media) {
        count += msg.media.length;
      }
      // 也要计算 MCP 媒体
      if (msg.content) {
        const mcpMediaMatches = msg.content.match(/\[MCP_(IMAGE|VIDEO|AUDIO)\|/g);
        if (mcpMediaMatches) {
          count += mcpMediaMatches.length;
        }
      }
    }
    return 0;
  }, [messages]);
  const [streamEnabled, setStreamEnabled] = useState(true); // 流式响应开关
  const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set()); // 已折叠的思考过程
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null); // 正在编辑的消息ID
  const [quotedMessageId, setQuotedMessageId] = useState<string | null>(null); // 引用的消息ID
  const [isDraggingOver, setIsDraggingOver] = useState(false); // 是否正在拖拽文件
  const [isInputExpanded, setIsInputExpanded] = useState(false); // 输入框是否扩大
  const [isInputFocused, setIsInputFocused] = useState(false); // 输入框是否聚焦
  const [abortController, setAbortController] = useState<AbortController | null>(null); // 用于中断请求
  // MCP 详情遮罩层状态
  const [showMCPDetailOverlay, setShowMCPDetailOverlay] = useState(false);
  const [selectedMCPDetail, setSelectedMCPDetail] = useState<any>(null);
  
  // @ 符号选择器状态
  const [showAtSelector, setShowAtSelector] = useState(false);
  const [atSelectorPosition, setAtSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 256 });
  const [atSelectorQuery, setAtSelectorQuery] = useState('');
  const [atSelectorIndex, setAtSelectorIndex] = useState(-1); // @ 符号在输入中的位置
  const [selectedComponentIndex, setSelectedComponentIndex] = useState(0); // 当前选中的组件索引（用于键盘导航）
  const [selectedComponents, setSelectedComponents] = useState<Array<{ type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }>>([]); // 已选定的组件（tag）
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const editingMessageIdRef = useRef<string | null>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // /模块 选择器状态
  const [showModuleSelector, setShowModuleSelector] = useState(false);
  const [moduleSelectorPosition, setModuleSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 256 });
  const [moduleSelectorQuery, setModuleSelectorQuery] = useState('');
  const [moduleSelectorIndex, setModuleSelectorIndex] = useState(-1); // /模块 在输入中的位置
  
  // 批次数据项选择器状态
  const [showBatchItemSelector, setShowBatchItemSelector] = useState(false);
  const [batchItemSelectorPosition, setBatchItemSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 400 });
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  
  // 选定的批次数据项（作为系统提示词）
  const [selectedBatchItem, setSelectedBatchItem] = useState<{ item: any; batchName: string } | null>(null);
  
  // 批次数据项选择后的操作选择（临时状态）
  const [pendingBatchItem, setPendingBatchItem] = useState<{ item: any; batchName: string } | null>(null);
  
  // 会话管理
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionMeta, setCurrentSessionMeta] = useState<Session | null>(null);
  const [currentSessionAvatar, setCurrentSessionAvatar] = useState<string | null>(null); // 当前会话的头像
  const [currentSystemPrompt, setCurrentSystemPrompt] = useState<string | null>(null); // 当前会话的系统提示词（人设）
  const [showAvatarConfigDialog, setShowAvatarConfigDialog] = useState(false); // 是否显示头像配置对话框
  const [avatarConfigDraft, setAvatarConfigDraft] = useState<string | null>(null); // 头像配置草稿
  

  // 头部配置对话框状态（用于从聊天头部点击头像时打开）
  const [showHeaderConfigDialog, setShowHeaderConfigDialog] = useState(false);
  const [headerConfigEditName, setHeaderConfigEditName] = useState('');
  const [headerConfigEditAvatar, setHeaderConfigEditAvatar] = useState<string | null>(null);
  const [headerConfigEditSystemPrompt, setHeaderConfigEditSystemPrompt] = useState('');
  const [headerConfigEditMediaOutputPath, setHeaderConfigEditMediaOutputPath] = useState('');
  const [headerConfigEditLlmConfigId, setHeaderConfigEditLlmConfigId] = useState<string | null>(null);
  const [headerConfigEditProfession, setHeaderConfigEditProfession] = useState<string | null>(null); // 职业选择
  const [headerConfigEditProfessionType, setHeaderConfigEditProfessionType] = useState<'career' | 'game'>('career'); // 职业类型
  const [headerConfigCareerProfessions, setHeaderConfigCareerProfessions] = useState<string[]>(DEFAULT_CAREER_PROFESSIONS); // 功能职业列表
  const [headerConfigGameProfessions, setHeaderConfigGameProfessions] = useState<string[]>(DEFAULT_GAME_PROFESSIONS); // 游戏职业列表
  const [isLoadingHeaderProfessions, setIsLoadingHeaderProfessions] = useState(false); // 加载职业列表状态
  const [showHeaderAddProfessionDialog, setShowHeaderAddProfessionDialog] = useState(false); // 添加职业对话框
  const [headerNewProfessionValue, setHeaderNewProfessionValue] = useState(''); // 新职业名称
  const [headerConfigActiveTab, setHeaderConfigActiveTab] = useState<'basic' | 'skillpacks'>('basic');
  const [isSavingHeaderAsRole, setIsSavingHeaderAsRole] = useState(false);
  const [isEditingSystemPrompt, setIsEditingSystemPrompt] = useState(false); // 是否正在编辑人设
  const [systemPromptDraft, setSystemPromptDraft] = useState(''); // 人设编辑草稿
  const [showHelpTooltip, setShowHelpTooltip] = useState(false); // 是否显示帮助提示
  const [showSessionTypeDialog, setShowSessionTypeDialog] = useState(false); // 是否显示会话类型选择对话框
  const [showUpgradeToAgentDialog, setShowUpgradeToAgentDialog] = useState(false); // 是否显示升级为智能体对话框
  // 人设（会话）切换：通过对话界面顶部“人设Tag”完成
  const [showPersonaPanel, setShowPersonaPanel] = useState(false);
  const [personaSearch, setPersonaSearch] = useState('');
  const [showRoleGenerator, setShowRoleGenerator] = useState(false);
  const [personaAgents, setPersonaAgents] = useState<Session[]>([]);
  const [personaMeetings, setPersonaMeetings] = useState<RoundTable[]>([]);
  const [personaResearchSessions, setPersonaResearchSessions] = useState<Session[]>([]);
  const [isLoadingPersonaList, setIsLoadingPersonaList] = useState(false);
  // 新建 Meeting/Research 对话框
  const [showNewMeetingDialog, setShowNewMeetingDialog] = useState(false);
  const [newMeetingName, setNewMeetingName] = useState('');
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);
  const [showNewResearchDialog, setShowNewResearchDialog] = useState(false);
  const [newResearchName, setNewResearchName] = useState('');
  const [isCreatingResearch, setIsCreatingResearch] = useState(false);
  const [agentName, setAgentName] = useState(''); // 升级为智能体时的名称
  const [agentAvatar, setAgentAvatar] = useState<string | null>(null); // 升级为智能体时的头像
  const [agentSystemPrompt, setAgentSystemPrompt] = useState(''); // 升级为智能体时的人设
  const [agentLLMConfigId, setAgentLLMConfigId] = useState<string | null>(null); // 升级为智能体时关联的LLM模型
  const [isUpgrading, setIsUpgrading] = useState(false); // 是否正在升级
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [messagePage, setMessagePage] = useState(1);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showNewMessagePrompt, setShowNewMessagePrompt] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  // useConversation 的加载状态/是否可继续向上翻页，同步到旧状态字段（避免大面积改 UI）
  useEffect(() => {
    if (isTemporarySession) return;
    setIsLoadingMessages(isLoadingPersistedMessages);
    setHasMoreMessages(hasMorePersistedMessages);
  }, [hasMorePersistedMessages, isLoadingPersistedMessages, isTemporarySession]);
  
  // 首次访问弹窗相关状态
  const [showNicknameDialog, setShowNicknameDialog] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [isSubmittingNickname, setIsSubmittingNickname] = useState(false);
  const [userAccess, setUserAccess] = useState<UserAccess | null>(null);
  
  // 技能包相关状态
  const [isCreatingSkillPack, setIsCreatingSkillPack] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [skillPackSelectionMode, setSkillPackSelectionMode] = useState(false);
  const [showSkillPackDialog, setShowSkillPackDialog] = useState(false);
  const [skillPackResult, setSkillPackResult] = useState<SkillPackCreationResult | null>(null);
  const [skillPackProcessInfo, setSkillPackProcessInfo] = useState<SkillPackProcessInfo | null>(null);
  const [skillPackConversationText, setSkillPackConversationText] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationPrompt, setOptimizationPrompt] = useState('');
  const [selectedMCPForOptimization, setSelectedMCPForOptimization] = useState<string[]>([]); // 选中的MCP服务器ID列表
  const [currentSessionSkillPacks, setCurrentSessionSkillPacks] = useState<SessionSkillPack[]>([]);
  const [_pendingSkillPackUse, setPendingSkillPackUse] = useState<{ skillPack: SessionSkillPack; messageId: string } | null>(null);
  
  // LLM配置
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [selectedLLMConfigId, setSelectedLLMConfigId] = useState<string | null>(null);
  const [selectedLLMConfig, setSelectedLLMConfig] = useState<LLMConfigFromDB | null>(null);

  // 兜底：当 llmConfigs 迟到加载时，也要把当前 Agent 的偏好模型同步到选择框
  useEffect(() => {
    const s = currentSessionMeta;
    if (!s || s.session_type !== 'agent') return;
    const preferredId = s.llm_config_id;
    if (!preferredId) return;
    if (selectedLLMConfigId === preferredId) return;
    const enabledSet = new Set(llmConfigs.filter((c) => Boolean(c.enabled)).map((c) => c.config_id));
    if (!enabledSet.has(preferredId)) return;
    handleLLMConfigChange(preferredId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionMeta?.session_id, currentSessionMeta?.llm_config_id, currentSessionMeta?.session_type, llmConfigs.length]);
  
  // MCP配置
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [connectedMcpServerIds, setConnectedMcpServerIds] = useState<Set<string>>(new Set());
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<Set<string>>(new Set());
  const [mcpTools, setMcpTools] = useState<Map<string, MCPTool[]>>(new Map());
  const [connectingServers, setConnectingServers] = useState<Set<string>>(new Set());
  
  // 工作流列表
  const [workflows, setWorkflows] = useState<WorkflowType[]>([]);
  
  // 技能包列表
  const [allSkillPacks, setAllSkillPacks] = useState<SkillPack[]>([]);
  
  // 拖拽状态
  const [draggingComponent, setDraggingComponent] = useState<{ type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  // 浮岛输入区：动态计算消息列表底部 padding，避免被浮岛遮挡
  const { ref: floatingComposerRef, padding: floatingComposerPadding } = useFloatingComposerPadding();
  const wasAtBottomRef = useRef(true);
  const isInitialLoadRef = useRef(true);
  const shouldMaintainScrollRef = useRef(false);
  const isUserScrollingRef = useRef(false);
  const scrollPositionRef = useRef<{ anchorMessageId: string; anchorOffsetTop: number; scrollTop: number } | null>(null);
  
  // 消息缓存：按 session_id 缓存消息，Map<session_id, Map<message_id, Message>>
  const messageCacheRef = useRef<Map<string, Map<string, Message>>>(new Map());

  const isLoadingMoreRef = useRef(false);
  const lastMessageCountRef = useRef(0);
  
  // 保存最后一次请求信息，用于快速重试
  const lastRequestRef = useRef<{
    userMessage: string;
    systemPrompt: string;
    tools?: MCPTool[];
    messageHistory?: LLMMessage[];
    sessionId?: string;
    messageId?: string;
    model?: string;
  } | null>(null);

  // 检查是否应该自动滚动到底部
  const shouldAutoScroll = () => {
    if (!chatContainerRef.current) return false;
    const container = chatContainerRef.current;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    // 如果距离底部小于100px，认为用户在底部附近（最新消息位置）
    return scrollHeight - scrollTop - clientHeight < 100;
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (chatContainerRef.current) {
      const container = chatContainerRef.current;
      container.style.scrollBehavior = behavior;
      container.scrollTop = container.scrollHeight;
      wasAtBottomRef.current = true;
      return;
    }
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
      wasAtBottomRef.current = true;
    }
  };

  useEffect(() => {
    // 如果需要保持滚动位置（加载更多历史消息），不滚动
    if (shouldMaintainScrollRef.current) {
      shouldMaintainScrollRef.current = false;
      // lastMessageCountRef 已经在 setMessages 中更新了，这里不需要再更新
      return;
    }
    
    // 如果正在加载更多历史消息，不处理自动滚动
    if (isLoadingMoreRef.current) {
      return;
    }
    
    const wasAtBottom = wasAtBottomRef.current;

    // 如果是初始加载，直接跳到底部（最新消息位置），不使用动画
    if (isInitialLoadRef.current && messages.length > 0) {
      // 使用 setTimeout 确保 DOM 已完全渲染
      setTimeout(() => {
        scrollToBottom('auto');
        isInitialLoadRef.current = false;
        lastMessageCountRef.current = messages.length;
      }, 0);
      return;
    }
    
    // 检测是否有新消息（消息数量增加，且是追加到末尾的新消息，不是加载的历史消息）
    // 注意：如果消息数量减少或不变，说明可能是替换消息（如编辑、删除），不处理
    if (messages.length <= lastMessageCountRef.current) {
      // 消息数量没有增加：可能是替换/编辑/流式更新（content 变化但 length 不变）
      // 对于流式更新，如果用户原本在底部附近，则持续跟随到底部
      const hasStreamingMessage = messages.some(m => m.isStreaming);
      if (hasStreamingMessage && wasAtBottom && !isUserScrollingRef.current) {
        setTimeout(() => scrollToBottom('auto'), 0);
      }
      // 更新计数但不走“新消息”逻辑
      lastMessageCountRef.current = messages.length;
      return;
    }
    
    const prevCount = lastMessageCountRef.current;
    const hasNewMessages = messages.length > prevCount;
    const newMessageCount = hasNewMessages ? messages.length - prevCount : 0;
    
    if (hasNewMessages) {
      // 更新 lastMessageCountRef
      lastMessageCountRef.current = messages.length;
      
      // 新消息在底部，如果用户在底部附近，自动滚动到底部（不使用动画）
      if (wasAtBottom && !isUserScrollingRef.current) {
        setTimeout(() => {
          scrollToBottom('auto');
        }, 0);
        // 用户已经在底部，隐藏新消息提示
        setShowNewMessagePrompt(false);
        setUnreadMessageCount(0);
      } else {
        // 用户不在底部，显示新消息提示
        setShowNewMessagePrompt(true);
        setUnreadMessageCount(prev => prev + newMessageCount);
      }
    }
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

  // 从URL参数中获取会话ID（用于从智能体页面跳转过来）
  // 注意：必须使用 setSearchParams 来清理参数，避免 window.history.replaceState 导致 react-router 的 searchParams 不同步
  const [searchParams, setSearchParams] = useSearchParams();
  
  // 检查用户访问信息，首次访问时弹出昵称输入对话框
  const checkUserAccess = async () => {
    try {
      const access = await getUserAccess();
      setUserAccess(access);
      
      // 如果用户不在访问列表中或需要填写昵称，显示对话框
      if (access.needs_nickname || !access.is_enabled) {
        setShowNicknameDialog(true);
      }
    } catch (error) {
      console.error('[Workflow] Failed to check user access:', error);
      // 如果获取失败，也显示对话框（可能是首次访问）
      setShowNicknameDialog(true);
    }
  };
  
  // 提交昵称
  const handleSubmitNickname = async () => {
    if (!nicknameInput.trim()) {
      toast({
        title: '请输入昵称',
        variant: 'destructive',
      });
      return;
    }
    
    try {
      setIsSubmittingNickname(true);
      await createOrUpdateUserAccess(nicknameInput.trim());
      setShowNicknameDialog(false);
      setNicknameInput('');
      // 重新检查用户访问信息
      await checkUserAccess();
      toast({
        title: '欢迎！',
        description: `你好，${nicknameInput.trim()}！`,
        variant: 'success',
      });
    } catch (error: any) {
      console.error('[Workflow] Failed to submit nickname:', error);
      toast({
        title: '保存失败',
        description: error.message || '请稍后重试',
        variant: 'destructive',
      });
    } finally {
      setIsSubmittingNickname(false);
    }
  };
  
  // 加载LLM配置和MCP服务器列表
  useEffect(() => {
    loadLLMConfigs();
    loadMCPServers();
    loadSessions();
    loadWorkflows();
    loadSkillPacks();
    // 检查用户访问信息（首次访问弹窗）
    checkUserAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部触发：会话/角色数据变更时刷新（例如侧边栏新建/删除/应用角色）
  useEffect(() => {
    const handler = () => {
      void (async () => {
        try {
          const sessionList = await getSessions();
          setSessions(sessionList);
        } catch (error) {
          console.error('[Workflow] Failed to reload sessions (event):', error);
          setSessions([]);
        }
      })();
    };
    window.addEventListener(SESSIONS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, handler);
  }, []);

  // 监听外部传入的sessionId（从左侧会话列表选择）
  // 需要等待 sessions 加载完成，或者手动从后端获取会话
  useEffect(() => {
    if (externalSessionId && externalSessionId !== currentSessionId) {
      handleSelectSession(externalSessionId);
    } else if (externalSessionId === null || externalSessionId === 'temporary-session' || !externalSessionId) {
      // 如果外部sessionId为null、undefined或者是临时会话，切换到临时会话
      // 修复bug：确保默认访问临时会话，清除之前可能残留的agent消息
      if (currentSessionId !== temporarySessionId) {
      handleSelectSession(temporarySessionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSessionId, sessions.length]);

  // 从URL参数中加载会话
  useEffect(() => {
    const sessionIdFromUrl = searchParams.get('session');
    if (sessionIdFromUrl && sessions.length > 0) {
      const session = sessions.find(s => s.session_id === sessionIdFromUrl);
      if (!session) return;
      handleSelectSession(sessionIdFromUrl);
      // 清除URL参数（使用 react-router，避免 URL 已变更但 searchParams hook 不同步）
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('session');
        return next;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, sessions]);

  // 监听配置会话请求（通过URL参数）
  useEffect(() => {
    const configSessionId = searchParams.get('config');
    if (configSessionId && configSessionId === currentSessionId && currentSessionId) {
      // 延迟打开对话框，确保会话数据已加载
      const timer = window.setTimeout(() => {
        const currentSession =
          sessions.find(s => s.session_id === currentSessionId) ||
          (currentSessionMeta?.session_id === currentSessionId ? currentSessionMeta : null);
        if (currentSession) {
          setHeaderConfigEditName(currentSession.name || '');
          setHeaderConfigEditAvatar(currentSession.avatar || null);
          setHeaderConfigEditSystemPrompt(currentSession.system_prompt || '');
          setHeaderConfigEditMediaOutputPath(currentSession.media_output_path || '');
          setHeaderConfigEditLlmConfigId(currentSession.llm_config_id || null);
          // 判断职业类型并提取当前职业
          const professionType = detectProfessionType(currentSession.name, currentSession.system_prompt);
          setHeaderConfigEditProfessionType(professionType);
          // 加载职业列表
          (async () => {
            try {
              setIsLoadingHeaderProfessions(true);
              const [careerOptions, gameOptions] = await Promise.all([
                getDimensionOptions('profession', 'career'),
                getDimensionOptions('profession', 'game'),
              ]);
              setHeaderConfigCareerProfessions([...DEFAULT_CAREER_PROFESSIONS, ...careerOptions]);
              setHeaderConfigGameProfessions([...DEFAULT_GAME_PROFESSIONS, ...gameOptions]);
              // 提取当前职业
              const allProfessions = professionType === 'career' 
                ? [...DEFAULT_CAREER_PROFESSIONS, ...careerOptions]
                : [...DEFAULT_GAME_PROFESSIONS, ...gameOptions];
              const currentProfession = extractProfession(currentSession.name, currentSession.system_prompt, allProfessions);
              setHeaderConfigEditProfession(currentProfession);
            } catch (error) {
              console.error('[Workflow] Failed to load professions:', error);
              // 使用默认职业列表
              const allProfessions = professionType === 'career' ? DEFAULT_CAREER_PROFESSIONS : DEFAULT_GAME_PROFESSIONS;
              const currentProfession = extractProfession(currentSession.name, currentSession.system_prompt, allProfessions);
              setHeaderConfigEditProfession(currentProfession);
            } finally {
              setIsLoadingHeaderProfessions(false);
            }
          })();
          setHeaderConfigActiveTab('basic');
          setShowHeaderConfigDialog(true);
        }
        // 清除URL参数（使用 react-router，避免 URL 已变更但 searchParams hook 不同步）
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('config');
          return next;
        }, { replace: true });
      }, 100);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, searchParams]);

  // 监听新建角色请求（通过URL参数 ?newRole=true）
  useEffect(() => {
    const newRoleParam = searchParams.get('newRole');
    if (newRoleParam === 'true') {
      // 打开角色生成器
      setShowRoleGenerator(true);
      // 清除URL参数
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('newRole');
        return next;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // 当头部配置对话框打开时，加载职业列表
  useEffect(() => {
    if (showHeaderConfigDialog) {
      (async () => {
        try {
          setIsLoadingHeaderProfessions(true);
          const [careerOptions, gameOptions] = await Promise.all([
            getDimensionOptions('profession', 'career'),
            getDimensionOptions('profession', 'game'),
          ]);
          setHeaderConfigCareerProfessions([...DEFAULT_CAREER_PROFESSIONS, ...careerOptions]);
          setHeaderConfigGameProfessions([...DEFAULT_GAME_PROFESSIONS, ...gameOptions]);
        } catch (error) {
          console.error('[Workflow] Failed to load professions:', error);
        } finally {
          setIsLoadingHeaderProfessions(false);
        }
      })();
    }
  }, [showHeaderConfigDialog]);
  
  // 当选择会话时，加载历史消息、头像和人设
  useEffect(() => {
    if (currentSessionId) {
      if (isTemporarySession) {
        // 临时会话：不加载历史消息和总结
        // 修复bug：确保临时会话的消息被重置，清除之前可能残留的agent消息
        setMessages([
          {
            id: '1',
            role: 'system',
            content: '你好！我是你的 AI 工作流助手。这是临时会话，不会保存历史记录。',
          },
        ]);
        setSummaries([]);
        setCurrentSessionMeta(null);
        setCurrentSessionAvatar(null);
        setCurrentSystemPrompt(null);
        // 清除消息缓存中的临时会话相关数据（如果有）
        if (messageCacheRef.current.has(temporarySessionId)) {
          messageCacheRef.current.delete(temporarySessionId);
        }
      } else {
        // 记忆体或智能体：正常加载
        // 先获取会话信息，判断是否是agent会话
        const session = sessions.find(s => s.session_id === currentSessionId);
        // NOTE: 旧逻辑里区分 agent/memory 的分支已不再依赖该布尔值
        
        // 统一使用分页加载（懒加载），避免消息过多时性能问题
        loadSessionMessages(currentSessionId, 1);
      loadSessionSummaries(currentSessionId);
        
      // 加载会话头像和人设
      if (session) {
        setCurrentSessionMeta(session);
        setCurrentSessionAvatar(session.avatar || null);
        setCurrentSystemPrompt(session.system_prompt || null);
      } else {
        setCurrentSessionMeta(null);
        setCurrentSessionAvatar(null);
        setCurrentSystemPrompt(null);
      }
      // 如果列表里没有，主动拉取（例如"从角色开始新对话"后立即跳转）
      if (!session) {
        let canceled = false;
        (async () => {
          try {
            const fresh = await getSession(currentSessionId);
            if (canceled) return;
            setCurrentSessionMeta(fresh);
            setCurrentSessionAvatar(fresh.avatar || null);
            setCurrentSystemPrompt(fresh.system_prompt || null);
            
            // 如果是agent会话，重新加载消息（使用分页加载）
            const freshIsAgentSession = fresh.session_type === 'agent' || fresh.role_id;
            if (freshIsAgentSession) {
              loadSessionMessages(currentSessionId, 1);
            }
            
            if (fresh.llm_config_id) {
              const llmId = fresh.llm_config_id;
              const configExists = llmConfigs.some(c => c.config_id === llmId);
              if (configExists) setSelectedLLMConfigId(llmId);
            }
          } catch (error) {
            console.warn('[Workflow] Failed to fetch session detail in effect:', currentSessionId, error);
          }
        })();
        return () => {
          canceled = true;
        };
      }
      // 加载技能包
      getSessionSkillPacks(currentSessionId).then(packs => {
        setCurrentSessionSkillPacks(packs);
      }).catch(err => {
        console.error('[Workflow] Failed to load skill packs:', err);
      });
      }
    } else {
      // 新会话，清空消息（保留系统消息）
      setMessages([{
        id: '1',
        role: 'system',
        content: '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
      }]);
      setSummaries([]);
      setCurrentSessionMeta(null);
      setCurrentSessionAvatar(null);
      setCurrentSystemPrompt(null);
      // 清空系统提示词状态
      setSelectedBatchItem(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, sessions, isTemporarySession]);
  
  // 当弹框显示时，调整位置使底部对齐光标，并滚动到底部
  useEffect(() => {
    if (showAtSelector && selectorRef.current && inputRef.current) {
      // 使用 setTimeout 确保 DOM 已更新
      setTimeout(() => {
        if (selectorRef.current && inputRef.current) {
          const selector = selectorRef.current;
          const actualHeight = selector.offsetHeight;
          
          // 重新获取光标位置
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const cursorPosition = textarea.selectionStart || 0;
          const value = textarea.value;
          const textBeforeCursor = value.substring(0, cursorPosition);
          
          // 计算光标位置（简化版本，使用之前的逻辑）
          const styles = window.getComputedStyle(textarea);
          const lines = textBeforeCursor.split('\n');
          const lineIndex = lines.length - 1;
          
          // 计算行高和 padding
          const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
          const paddingTop = parseFloat(styles.paddingTop) || 0;
          
          const cursorY = textareaRect.top + paddingTop + (lineIndex * lineHeight) - textarea.scrollTop;
          
          // 调整弹框位置，使底部对齐光标
          const newTop = cursorY - actualHeight;
          
          // 如果调整后超出顶部，则限制在顶部
          if (newTop < 10) {
            selector.style.top = '10px';
          } else {
            selector.style.top = `${newTop}px`;
          }
          
          // 滚动到底部，使最新内容在底部显示
          selector.scrollTop = selector.scrollHeight;
        }
      }, 10); // 稍微延迟以确保内容已渲染
    }
  }, [showAtSelector, atSelectorQuery, mcpServers, workflows]);
  
  // 监听点击外部关闭模块选择器
  useEffect(() => {
    if (!showModuleSelector) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // 检查点击是否在选择器外部（不包括输入框和选择器本身）
      const isClickInsideSelector = target.closest('.at-selector-container');
      const isClickInsideInput = inputRef.current?.contains(target);
      
      if (!isClickInsideSelector && !isClickInsideInput) {
        console.log('[Workflow] 点击外部，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    };
    
    // 延迟添加监听器，避免立即触发
    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModuleSelector]);
  
  // 监听ESC键关闭模块选择器
  useEffect(() => {
    if (!showModuleSelector) return;
    
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        console.log('[Workflow] 按下ESC，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
        
        // 重新聚焦输入框
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }
    };
    
    document.addEventListener('keydown', handleEscKey);
    
    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [showModuleSelector]);
  
  // 加载会话消息
  const loadSessionMessages = async (session_id: string, page: number = 1) => {
    // 统一走 useConversation（仅非临时会话）
    if (!session_id || session_id === temporarySessionId || isTemporarySession) {
      return;
    }

    try {
      setIsLoadingMessages(true);

      if (page === 1) {
        setSelectedBatchItem(null);
        setShowNewMessagePrompt(false);
        setUnreadMessageCount(0);
        await loadPersistedInitial({ force: true });
        setMessagePage(1);
        return;
      }

      // 加载更多历史消息：保持滚动位置（复用原锚点逻辑）
      if (chatContainerRef.current && messages.length > 0) {
        isLoadingMoreRef.current = true;
        const container = chatContainerRef.current;
        const scrollTop = container.scrollTop;

        let anchorMessageId: string | null = null;
        let anchorOffsetTop = 0;
        const threshold = 200;

        for (const msg of messages) {
          const element = container.querySelector(`[data-message-id="${msg.id}"]`) as HTMLElement;
          if (element) {
            const elementTop = element.offsetTop;
            const relativeTop = elementTop - scrollTop;
            if (relativeTop >= -threshold && relativeTop <= threshold) {
              anchorMessageId = msg.id;
              anchorOffsetTop = elementTop;
              break;
            }
          }
        }

        if (!anchorMessageId && messages.length > 0) {
          const firstElement = container.querySelector(`[data-message-id="${messages[0].id}"]`) as HTMLElement;
          if (firstElement) {
            anchorMessageId = messages[0].id;
            anchorOffsetTop = firstElement.offsetTop;
          }
        }

        if (anchorMessageId) {
          scrollPositionRef.current = {
            anchorMessageId,
            anchorOffsetTop,
            scrollTop,
          };
          shouldMaintainScrollRef.current = true;
        }
      }

      await loadMorePersistedMessages();
      setMessagePage(page);

      // DOM 更新后恢复滚动锚点
      setTimeout(() => {
        const container = chatContainerRef.current;
        if (!container || !scrollPositionRef.current) {
          isLoadingMoreRef.current = false;
          return;
        }
        container.style.scrollBehavior = 'auto';
        const { anchorMessageId, anchorOffsetTop, scrollTop: oldScrollTop } = scrollPositionRef.current;
        const anchorElement = anchorMessageId
          ? (container.querySelector(`[data-message-id="${anchorMessageId}"]`) as HTMLElement)
          : null;
        if (anchorElement) {
          const newAnchorOffsetTop = anchorElement.offsetTop;
          const distanceFromTop = anchorOffsetTop - oldScrollTop;
          container.scrollTop = newAnchorOffsetTop - distanceFromTop;
        }
        scrollPositionRef.current = null;
        isLoadingMoreRef.current = false;
      }, 0);
    } finally {
      setIsLoadingMessages(false);
    }
    return;

    try {
      setIsLoadingMessages(true);
      
      // 第一页加载时，先清空系统提示词状态（只有在找到系统提示词消息时才设置）
      if (page === 1) {
        setSelectedBatchItem(null);
      }
      
      // 如果是加载更多历史消息（page > 1），记录当前滚动位置（顶部附近）
      const containerForAnchor = chatContainerRef.current;
      if (page > 1 && containerForAnchor && messages.length > 0) {
        isLoadingMoreRef.current = true;
        const container = containerForAnchor!;
        const scrollTop = container.scrollTop;
        
        // 找到容器顶部附近的第一条消息作为锚点（历史消息在上方）
        let anchorMessageId: string | null = null;
        let anchorOffsetTop = 0;
        const threshold = 200; // 距离顶部200px内的消息
        
        for (const msg of messages) {
          const element = container.querySelector(`[data-message-id="${msg.id}"]`) as HTMLElement;
          if (element) {
            const elementTop = element.offsetTop;
            const relativeTop = elementTop - scrollTop;
            
            // 找到最接近顶部且在阈值内的消息
            if (relativeTop >= -threshold && relativeTop <= threshold) {
              anchorMessageId = msg.id;
              anchorOffsetTop = elementTop;
              break;
            }
          }
        }
        
        // 如果没找到合适的锚点，使用第一条消息（历史消息在上方）
        if (!anchorMessageId && messages.length > 0) {
          const firstElement = container.querySelector(`[data-message-id="${messages[0].id}"]`) as HTMLElement;
          if (firstElement) {
            anchorMessageId = messages[0].id;
            anchorOffsetTop = firstElement.offsetTop;
          }
        }
        
        if (anchorMessageId !== null) {
          scrollPositionRef.current = {
            anchorMessageId: anchorMessageId!,
            anchorOffsetTop,
            scrollTop,
          };
          shouldMaintainScrollRef.current = true;
        }
      }
      
      // 统一使用分页加载（懒加载）
      // 第一页只加载 5 条消息，加快初始加载速度（特别是局域网访问时）
      // 后续页加载 20 条消息，平衡加载速度和用户体验
      const page_size = page === 1 ? 5 : 20;
      const data = await getSessionMessages(session_id, page, page_size);
      
      // 获取或创建该会话的缓存
      if (!messageCacheRef.current.has(session_id)) {
        messageCacheRef.current.set(session_id, new Map());
      }
      const sessionCache = messageCacheRef.current.get(session_id)!;
      
      // 先加载总结列表，用于关联总结消息和提示信息
      const summaryList = await getSessionSummaries(session_id);
      
      // 格式化消息，恢复工作流信息
      const formatMessage = async (msg: any): Promise<Message | null> => {
        // 确保 role 正确：如果是 'workflow'，转换为 'tool'
        let role = msg.role;
        if (role === 'workflow') {
          role = 'tool';
          console.warn('[Workflow] Fixed invalid role "workflow" to "tool" for message:', msg.message_id);
        }
        
        // 检查是否是总结消息（通过 content 前缀识别）
        const isSummaryMessage = role === 'system' && msg.content?.startsWith('__SUMMARY__');
        const actualContent = isSummaryMessage 
          ? msg.content.replace(/^__SUMMARY__/, '') // 移除前缀，保留实际内容
          : msg.content;
        
        // 检查是否是系统提示词消息（通过 tool_calls 中的 isSystemPrompt 标识）
        const toolCalls = msg.tool_calls && typeof msg.tool_calls === 'object' ? msg.tool_calls : null;
        const isSystemPromptMessage = role === 'system' && toolCalls && (toolCalls as any).isSystemPrompt === true;
        
        const baseMessage: Message = {
          id: msg.message_id,
          role: role as 'user' | 'assistant' | 'tool' | 'system',
          content: actualContent,
          thinking: msg.thinking,
          toolCalls: msg.tool_calls,
          isSummary: isSummaryMessage, // 标记为总结消息
          mcpdetail: msg.mcpdetail, // MCP 执行详情
        };
        
        // 恢复多模态内容（从 tool_calls 中读取）
        // 注意：tool_calls 可能是对象（包含 media）或数组（标准工具调用格式）
        if (toolCalls && typeof toolCalls === 'object' && !Array.isArray(toolCalls) && (toolCalls as any).media) {
          baseMessage.media = (toolCalls as any).media;
        }
        
        // 恢复思维签名（从 tool_calls 或 ext 中读取）
        if (toolCalls && typeof toolCalls === 'object') {
          if ((toolCalls as any).thoughtSignature) {
            baseMessage.thoughtSignature = (toolCalls as any).thoughtSignature;
          }
          if ((toolCalls as any).toolCallSignatures) {
            baseMessage.toolCallSignatures = (toolCalls as any).toolCallSignatures;
          }
        }
        
        // 从 ext 字段恢复扩展数据
        const ext = msg.ext && typeof msg.ext === 'object' ? msg.ext : null;
        if (ext) {
          // 恢复思维签名（优先从 ext 读取）
          if (ext.thoughtSignature) {
            baseMessage.thoughtSignature = ext.thoughtSignature;
          }
          if (ext.toolCallSignatures) {
            baseMessage.toolCallSignatures = ext.toolCallSignatures;
          }
          // 恢复媒体内容
          if (ext.media) {
            baseMessage.media = ext.media;
          }
          // 恢复过程步骤（思考和MCP调用历史）
          if (ext.processSteps && Array.isArray(ext.processSteps)) {
            baseMessage.processSteps = ext.processSteps;
            console.log(`[Workflow] Restored ${ext.processSteps.length} process steps for message:`, msg.message_id);
          }
        }
        
        // 如果是系统提示词消息，恢复 selectedBatchItem（只在第一页加载时处理，避免重复设置）
        // 注意：第一页加载时，系统提示词的恢复已经在消息处理完成后统一处理，这里只处理后续页加载的情况
        if (isSystemPromptMessage && toolCalls && page > 1) {
          const systemPromptData = toolCalls as any;
          if (systemPromptData.batchName && systemPromptData.item) {
            setSelectedBatchItem({
              batchName: systemPromptData.batchName,
              item: systemPromptData.item,
            });
            console.log('[Workflow] Restored system prompt from message (page > 1):', msg.message_id);
          }
        }
        
        // 如果是工具消息（感知组件），尝试从 content 或 tool_calls 中恢复工作流信息
        if (baseMessage.role === 'tool') {
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
      
      // 格式化消息，恢复工作流信息
      const formattedMessages = await Promise.all(data.messages.map(formatMessage));
      // 过滤掉null值（无效的感知组件消息）
      const validMessages = formattedMessages.filter((msg): msg is Message => msg !== null);
      
      // 将所有格式化后的消息存入缓存
      for (const msg of validMessages) {
        if (msg && msg.id) {
          sessionCache.set(msg.id, msg);
        }
      }
      
      // 在总结消息之后插入提示消息
      const messagesWithNotifications: Message[] = [];
      for (let i = 0; i < validMessages.length; i++) {
        const msg = validMessages[i];
        messagesWithNotifications.push(msg);
        
        // 如果是总结消息，查找对应的总结记录并添加提示消息
        if (msg.isSummary) {
          // 检查下一条消息是否已经是提示消息（避免重复添加）
          const nextMsg = validMessages[i + 1];
          const isAlreadyHasNotification = nextMsg && 
            nextMsg.role === 'system' && 
            (nextMsg.content.includes('已精简为') || nextMsg.content.includes('总结完成'));
          
          if (!isAlreadyHasNotification) {
            // 通过内容匹配找到对应的总结记录
            const matchingSummary = summaryList.find(s => 
              s.summary_content === msg.content || 
              msg.content.includes(s.summary_content) ||
              s.summary_content.includes(msg.content)
            );
            
            if (matchingSummary) {
              const tokenAfter = matchingSummary?.token_count_after ?? 0;
              const tokenBefore = matchingSummary?.token_count_before ?? 0;
              const notificationMessage: Message = {
                id: `notification-${msg.id}`,
                role: 'system',
                content: `您的对话内容已精简为 ${tokenAfter.toLocaleString()} token（原 ${tokenBefore.toLocaleString()} token）`,
              };
              messagesWithNotifications.push(notificationMessage);
            }
          }
        }
      }
      
      // 后端返回的消息已经是正序（最旧在前，最新在后），符合正常聊天显示顺序
      // 第一页加载时，只显示最新的消息（在底部），然后历史消息追加到上方
      if (page === 1) {
        // 统一使用懒加载：只取最后几条消息（最新的），直接显示在底部
        // 后端返回的是正序（最旧在前，最新在后），我们只取最后的部分
        // 优化：初始只加载最后 5 条消息，加快加载速度（特别是局域网访问时）
        const latestMessages = messagesWithNotifications.slice(-5); // 只取最后5条（最新的）
        setMessages(latestMessages);
        isInitialLoadRef.current = true; // 标记为初始加载，会直接跳到底部（最新消息位置）
        lastMessageCountRef.current = latestMessages.length;
        // 重置新消息提示
        setShowNewMessagePrompt(false);
        setUnreadMessageCount(0);
        
        // 检查是否有系统提示词消息，如果有则设置 selectedBatchItem
        // 注意：这里需要检查所有消息，不仅仅是 latestMessages，因为系统提示词可能在历史消息中
        let foundSystemPrompt = false;
        for (const msg of messagesWithNotifications) {
          if (msg.role === 'system' && 
              msg.toolCalls && 
              typeof msg.toolCalls === 'object' &&
              (msg.toolCalls as any).isSystemPrompt === true) {
            const systemPromptData = msg.toolCalls as any;
            if (systemPromptData.batchName && systemPromptData.item) {
              setSelectedBatchItem({
                batchName: systemPromptData.batchName,
                item: systemPromptData.item,
              });
              foundSystemPrompt = true;
              console.log('[Workflow] Restored system prompt from message:', msg.id);
              break;
            }
          }
        }
        // 如果没有找到系统提示词消息，确保 selectedBatchItem 为 null
        if (!foundSystemPrompt) {
          setSelectedBatchItem(null);
        }
      } else {
        // 后续页，加载历史消息，追加到数组前面（显示在上方）
        // 在设置消息之前，先设置标志阻止自动滚动，并预计算新消息数量
        shouldMaintainScrollRef.current = true;
        const oldMessageCount = messages.length;
        const newTotalCount = oldMessageCount + messagesWithNotifications.length;
        
        // 预先更新 lastMessageCountRef，这样 useEffect 就不会误判为新消息
        lastMessageCountRef.current = newTotalCount;
        
        setMessages(prev => {
          // 历史消息追加到数组前面（显示在上方）
          const newMessages = [...messagesWithNotifications, ...prev];
          
          // 恢复滚动位置（保持锚点消息的位置不变，类似微信的加载历史消息）
          if (scrollPositionRef.current && chatContainerRef.current) {
            // 使用 setTimeout 确保 DOM 完全更新，并禁用滚动动画
            setTimeout(() => {
              const container = chatContainerRef.current;
              if (container && scrollPositionRef.current) {
                container.style.scrollBehavior = 'auto';
                const { anchorMessageId, anchorOffsetTop, scrollTop: oldScrollTop } = scrollPositionRef.current;
                if (anchorMessageId) {
                  const anchorElement = container.querySelector(`[data-message-id="${anchorMessageId}"]`) as HTMLElement;
                  if (anchorElement) {
                    // 计算新位置：目标消息的新位置 - 之前目标消息距离顶部的距离
                    const newAnchorOffsetTop = anchorElement.offsetTop;
                    const distanceFromTop = anchorOffsetTop - oldScrollTop;
                    const newScrollTop = newAnchorOffsetTop - distanceFromTop;
                    container.scrollTop = newScrollTop;
                  }
                }
                scrollPositionRef.current = null;
                isLoadingMoreRef.current = false;
              }
            }, 0);
          } else {
            isLoadingMoreRef.current = false;
          }
          
          return newMessages;
        });
      }
      
      setMessagePage(page);
      setHasMoreMessages(data.page < data.total_pages);
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

  // 创建记忆体会话
  const handleCreateMemorySession = async () => {
    try {
      const newSession = await createSession(
        selectedLLMConfigId || undefined,
        '新会话',
        'memory'
      );
      setCurrentSessionId(newSession.session_id);
      setIsTemporarySession(false);
      setShowSessionTypeDialog(false);
      await loadSessions();
    } catch (error) {
      console.error('[Workflow] Failed to create memory session:', error);
      alert('创建记忆体失败，请重试');
    }
  };

  // 切换到临时会话
  const handleSwitchToTemporarySession = () => {
    setCurrentSessionId(temporarySessionId);
    setIsTemporarySession(true);
    setShowSessionTypeDialog(false);
    // 清空消息（临时会话不保存历史）
    setMessages([
      {
        id: '1',
        role: 'system',
        content: '你好！我是你的 AI 工作流助手。这是临时会话，不会保存历史记录。',
      },
    ]);
    setMessagePage(1);
    setSummaries([]);
  };
  
  // 选择会话
  const handleSelectSession = async (session_id: string) => {
    // 切换会话时，关闭升级对话框和配置对话框
    setShowUpgradeToAgentDialog(false);
    setShowHeaderConfigDialog(false);
    
    // 清除URL中的config参数，避免切换会话时自动弹出配置对话框
    const currentSearchParams = new URLSearchParams(window.location.search);
    if (currentSearchParams.has('config')) {
      currentSearchParams.delete('config');
      const newUrl = `${window.location.pathname}${currentSearchParams.toString() ? '?' + currentSearchParams.toString() : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
    
    if (session_id === temporarySessionId) {
      // 切换到临时会话
      setIsTemporarySession(true);
      setCurrentSessionId(temporarySessionId);
      setCurrentSessionMeta(null);
      // 修复bug：确保临时会话的消息被重置，清除之前可能残留的agent消息
      setMessages([
        {
          id: '1',
          role: 'system',
          content: '你好！我是你的 AI 工作流助手。这是临时会话，不会保存历史记录。',
        },
      ]);
      setMessagePage(1);
      setSummaries([]);
      setCurrentSystemPrompt(null);
      setCurrentSessionAvatar(null);
      // 清除消息缓存中的临时会话相关数据（如果有）
      if (messageCacheRef.current.has(temporarySessionId)) {
        messageCacheRef.current.delete(temporarySessionId);
      }
    } else {
      // 选择记忆体或智能体
      setIsTemporarySession(false);
    setCurrentSessionId(session_id);
    setMessagePage(1);
      // 加载会话信息
      let session = sessions.find(s => s.session_id === session_id);
      if (!session) {
        try {
          session = await getSession(session_id);
          await loadSessions();
        } catch (error) {
          console.warn('[Workflow] Failed to fetch session detail:', session_id, error);
        }
      }
      if (session) {
        setCurrentSessionMeta(session);
        setCurrentSessionAvatar(session.avatar || null);
        setCurrentSystemPrompt(session.system_prompt || null);

        // Agent 偏好模型：进入 Agent 会话时自动切换到其 llm_config_id（仅当在可用列表里）
        if (session.session_type === 'agent' && session.llm_config_id) {
          const preferredId = session.llm_config_id;
          const enabledSet = new Set(llmConfigs.filter((c) => Boolean(c.enabled)).map((c) => c.config_id));
          if (enabledSet.has(preferredId) && selectedLLMConfigId !== preferredId) {
            // 统一走 handleLLMConfigChange，保证 selectedLLMConfig 与下拉 label 完全一致
            await handleLLMConfigChange(preferredId);
          }
        }
      } else {
        setCurrentSessionMeta(null);
      }
    }
  };
  
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [deleteRoundTableTarget, setDeleteRoundTableTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [deleteResearchTarget, setDeleteResearchTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // 删除会话（执行）
  const performDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);

      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([
          {
            id: '1',
            role: 'system',
            content:
              '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
          },
        ]);
        setSummaries([]);
        setCurrentSessionAvatar(null);
      }

      await loadSessions();
      toast({ title: '会话已删除', variant: 'success' });
    } catch (error) {
      console.error('[Workflow] Failed to delete session:', error);
      toast({
        title: '删除会话失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 删除会议（执行）
  const performDeleteRoundTable = async (roundTableId: string) => {
    try {
      await deleteRoundTable(roundTableId);

      // 刷新会议列表
      const [agents, meetings, allSessions] = await Promise.all([
        getAgents(),
        getRoundTables(),
        getSessions(),
      ]);
      setPersonaAgents(agents || []);
      setPersonaMeetings(meetings || []);
      const researchSessions = (allSessions || []).filter((s) => s.session_type === 'research');
      setPersonaResearchSessions(researchSessions);

      toast({ title: '会议已删除', variant: 'success' });
    } catch (error) {
      console.error('[Workflow] Failed to delete round table:', error);
      toast({
        title: '删除会议失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 删除Research会话（执行）
  const performDeleteResearch = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);

      // 刷新列表
      const [agents, meetings, allSessions] = await Promise.all([
        getAgents(),
        getRoundTables(),
        getSessions(),
      ]);
      setPersonaAgents(agents || []);
      setPersonaMeetings(meetings || []);
      const researchSessions = (allSessions || []).filter((s) => s.session_type === 'research');
      setPersonaResearchSessions(researchSessions);

      toast({ title: 'Research会话已删除', variant: 'success' });
    } catch (error) {
      console.error('[Workflow] Failed to delete research session:', error);
      toast({
        title: '删除Research会话失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };
  
  // 处理总结的通用函数
  const processSummarize = async (
    sessionId: string,
    messagesToSummarize: Array<{ message_id?: string; role: string; content: string }>,
    isAuto: boolean = false
  ) => {
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      throw new Error('LLM配置未选择');
    }

    const model = selectedLLMConfig.model || 'gpt-4';
    
    // 调用总结 API
    const summary = await summarizeSession(sessionId, {
      llm_config_id: selectedLLMConfigId,
      model: model,
      messages: messagesToSummarize,
    });
    
    // 获取被总结的最后一条消息ID（用于确定插入位置）
    const lastSummarizedMessageId = messagesToSummarize
      .map(msg => msg.message_id)
      .filter((id): id is string => !!id)
      .pop();
    
    // 将总结内容作为 system 类型的消息保存（不显示，但用于标记总结点）
    // 使用特殊格式来标识这是总结消息：__SUMMARY__{summary_content}
    const summaryMessageId = `msg-${Date.now()}`;
    
    // 计算总结消息的累积 token：总结前的累积 token + 总结消息的 token
    const tokenCountBeforeAcc = (summary as any).token_count_before_acc || 0;
    const summaryMessageTokens = estimate_tokens(summary.summary_content, model);
    const summaryAccToken = tokenCountBeforeAcc + summaryMessageTokens;
    
    const summarySystemMessage = {
      message_id: summaryMessageId,
      role: 'system' as const,
      content: `__SUMMARY__${summary.summary_content}`, // 使用特殊前缀标识总结消息
      model: model,
      acc_token: summaryAccToken, // 设置总结消息的累积 token
    };
    
    await saveMessage(sessionId, summarySystemMessage);
    
    // 后端会自动重新计算总结后所有消息的 acc_token（在 saveMessage API 中处理）
    
    // 添加提示消息到消息列表（显示给用户）
    const tokenAfter = summary.token_count_after || 0;
    const tokenBefore = summary.token_count_before || 0;
    const notificationMessageId = `notification-${Date.now()}`;
    const notificationMessage: Message = {
      id: notificationMessageId,
      role: 'system',
      content: `${isAuto ? '' : '总结完成！'}您的对话内容已精简为 ${tokenAfter.toLocaleString()} token（原 ${tokenBefore.toLocaleString()} token）`,
    };
    
    // 在消息列表中添加总结消息（标记为不显示）和提示消息
    setMessages(prev => {
      const newMessages = [...prev];
      
      // 找到最后一条被总结消息的位置
      const lastSummarizedIndex = lastSummarizedMessageId 
        ? newMessages.findIndex(msg => msg.id === lastSummarizedMessageId)
        : -1;
      
      const insertIndex = lastSummarizedIndex >= 0 ? lastSummarizedIndex + 1 : newMessages.length;
      
      // 插入总结消息（system 类型，isSummary: true，不显示）
      const summaryMessage: Message = {
        id: summaryMessageId,
        role: 'system',
        content: summary.summary_content, // 保存实际内容，但标记为总结消息
        isSummary: true, // 标记为总结消息，不显示
      };
      
      // 插入提示消息（显示给用户）
      newMessages.splice(insertIndex, 0, summaryMessage, notificationMessage);
      
      return newMessages;
    });
    
    // 重新加载消息列表（确保与数据库同步）
    await loadSessionMessages(sessionId, 1);
    
    // 重新加载总结列表
    await loadSessionSummaries(sessionId);
    
    // 清除总结缓存
    await clearSummarizeCache(sessionId);
    
    console.log(`[Workflow] ${isAuto ? 'Auto-' : ''}Summarized: ${tokenBefore} -> ${tokenAfter} tokens`);
    
    return summary;
  };

  // 手动触发总结
  const handleManualSummarize = async () => {
    if (!currentSessionId || !selectedLLMConfigId || !selectedLLMConfig) {
      alert('请先选择会话和LLM模型');
      return;
    }
    if (isTemporarySession) {
      alert('临时会话不支持总结功能');
      return;
    }
    
    try {
      setIsSummarizing(true);
      
      // 获取当前会话的所有消息（用于总结）
      // 排除系统消息（包括系统提示词消息）和总结消息
      const allMessages = messages.filter(m => {
        if (m.role === 'system' || m.isSummary) {
          // 检查是否是系统提示词消息
          const isSystemPrompt = m.toolCalls && 
            typeof m.toolCalls === 'object' &&
            (m.toolCalls as any).isSystemPrompt === true;
          if (isSystemPrompt) {
            return false; // 排除系统提示词消息
          }
          // 排除其他系统消息和总结消息
          return false;
        }
        return true;
      });
      const messagesToSummarize = allMessages.map(msg => ({
        message_id: msg.id,
        role: msg.role,
        content: msg.content,
        token_count: estimate_tokens(msg.content, selectedLLMConfig.model || 'gpt-4'),
      }));
      
      if (messagesToSummarize.length === 0) {
        alert('没有可总结的消息');
        return;
      }
      
      const summary = await processSummarize(currentSessionId, messagesToSummarize, false);
      
      // 显示总结完成的提示消息
      const tokenAfter = summary.token_count_after || 0;
      const tokenBefore = summary.token_count_before || 0;
      const notificationMsg: Message = {
        id: `manual-summary-notification-${Date.now()}`,
        role: 'system',
        content: `总结完成！对话内容已精简为 ${tokenAfter.toLocaleString()} token（原 ${tokenBefore.toLocaleString()} token）`,
      };
      // 新消息追加到数组后面（显示在底部）
      setMessages(prev => [...prev, notificationMsg]);
    } catch (error) {
      console.error('[Workflow] Failed to summarize:', error);
      alert(`总结失败: ${error instanceof Error ? error.message : String(error)}`);
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
  
  // 加载技能包列表
  const loadSkillPacks = async () => {
    try {
      console.log('[Workflow] Loading skill packs...');
      const skillPacks = await getSkillPacks();
      console.log('[Workflow] Loaded skill packs:', skillPacks);
      setAllSkillPacks(skillPacks);
    } catch (error) {
      console.error('[Workflow] Failed to load skill packs:', error);
      setAllSkillPacks([]);
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
        name: server.display_name || server.client_name || server.name,
        url: server.url,
        type: server.type,
        enabled: server.enabled,
        description: server.description,
        metadata: server.metadata,
        ext: server.ext, // 传递扩展配置（包括 response_format, server_type 等）
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

  const handleSend = async () => {
    // 允许发送文本或图片（至少有一个）
    if ((!input.trim() && attachedMedia.length === 0) || isLoading) return;

    // 检查配置
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '❌ 请先选择一个 LLM 模型',
      };
      // 新消息追加到数组后面（显示在底部）
      setMessages(prev => [...prev, errorMsg]);
      return;
    }

    // 如果是编辑模式，先处理重新发送
    if (editingMessageIdRef.current) {
      await handleResendMessage(editingMessageIdRef.current, input.trim());
      return;
    }

    // 检查是否有选定的组件（tag）
    // 只处理工作流，MCP通过selectedMcpServerIds在正常对话中使用工具
    const workflowComponents = selectedComponents.filter(c => c.type === 'workflow');
    if (workflowComponents.length > 0) {
      // 使用第一个选定的工作流
      const matchedComponent = workflowComponents[0];
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
        
        // 新消息追加到数组后面（显示在底部）
        setMessages(prev => [...prev, userMessage]);
        
        // 保存用户消息（临时会话不保存）
        if (sessionId && !isTemporarySession) {
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
        
        // 添加感知组件消息
        await addWorkflowMessage(matchedComponent);
        
        // 等待消息添加到列表
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 找到刚添加的感知组件消息
        const currentMessages = messages;
        const workflowMessages = currentMessages.filter(m => m.role === 'tool' && m.workflowId === matchedComponent.id);
        let latestWorkflowMessage = workflowMessages[workflowMessages.length - 1];
        
        // 如果找不到，从最新的消息中查找
        if (!latestWorkflowMessage) {
          // 等待状态更新
          await new Promise(resolve => setTimeout(resolve, 200));
          const updatedMessages = messages;
          const updatedWorkflowMessages = updatedMessages.filter(m => m.role === 'tool' && m.workflowId === matchedComponent.id);
          latestWorkflowMessage = updatedWorkflowMessages[updatedWorkflowMessages.length - 1];
        }
        
        if (latestWorkflowMessage) {
          // 添加提示消息给大模型（显示动画）
          const instructionMessageId = `instruction-${Date.now()}`;
          const instructionMessage: Message = {
            id: instructionMessageId,
            role: 'assistant',
            content: '',
            isThinking: true,
          };
          // 新消息追加到数组后面（显示在底部）
          setMessages(prev => [...prev, instructionMessage]);
          
          // 更新提示消息内容（带动画效果）
          setTimeout(() => {
            setMessages(prev => prev.map(msg =>
              msg.id === instructionMessageId
                ? {
                    ...msg,
                    content: `📋 收到感知组件指令：${matchedComponent.name} (工作流)，正在执行该步骤...`,
                    isThinking: false,
                  }
                : msg
            ));
          }, 500);
          
          // 执行感知组件
          await handleExecuteWorkflow(latestWorkflowMessage.id);
        }
        
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

    // 临时会话：不需要创建新会话，使用固定的临时会话ID
    let sessionId = isTemporarySession ? temporarySessionId : currentSessionId;
    if (!sessionId && !isTemporarySession) {
      try {
        const newSession = await createSession(selectedLLMConfigId, input.trim().substring(0, 50), 'memory');
        sessionId = newSession.session_id;
        setCurrentSessionId(sessionId);
        setIsTemporarySession(false);
        await loadSessions();
      } catch (error) {
        console.error('[Workflow] Failed to create session:', error);
        // 继续执行，即使创建会话失败
      }
    }

    // MCP 服务器是可选的，不需要强制选择

    const userMessageId = `msg-${Date.now()}`;
    
    // 如果有引用消息，在内容前添加引用信息
    let messageContent = input.trim() || (attachedMedia.length > 0 ? '[包含媒体内容]' : '');
    if (quotedMessageId) {
      const quotedMsg = messages.find(m => m.id === quotedMessageId);
      if (quotedMsg) {
        const quotedContent = quotedMsg.content.length > 200 
          ? quotedMsg.content.substring(0, 200) + '...' 
          : quotedMsg.content;
        messageContent = `[引用消息]\n${quotedContent}\n\n---\n\n${messageContent}`;
      }
    }
    
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content: messageContent,
      // 添加多模态内容
      media: attachedMedia.length > 0 ? attachedMedia.map(m => ({
        type: m.type,
        mimeType: m.mimeType,
        data: m.data,
      })) : undefined,
    };

    // 记录发送的媒体信息
    if (attachedMedia.length > 0) {
      console.log('[Workflow] 发送消息包含媒体:', attachedMedia.map(m => ({
        type: m.type,
        mimeType: m.mimeType,
        dataSize: Math.round(m.data.length / 1024) + 'KB',
      })));
    }

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setAttachedMedia([]); // 清空已发送的媒体
    setQuotedMessageId(null); // 清空引用消息
    setIsLoading(true);
    
    // 保存用户消息到数据库（临时会话不保存）
    if (sessionId && !isTemporarySession) {
      try {
        // 保存时包含媒体信息（存储在 tool_calls 中作为临时方案）
        const messageData: any = {
          message_id: userMessageId,
          role: 'user',
          content: userMessage.content,
          model: selectedLLMConfig.model || 'gpt-4',
        };
        
        // 如果有媒体内容，保存到 tool_calls
        if (userMessage.media && userMessage.media.length > 0) {
          messageData.tool_calls = { media: userMessage.media };
        }
        
        await saveMessage(sessionId, messageData);
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

      // 收集所有可用的MCP工具（如果选择了MCP服务器）
      const allTools: MCPTool[] = [];
      if (selectedMcpServerIds.size > 0) {
        for (const serverId of selectedMcpServerIds) {
          const tools = mcpTools.get(serverId) || [];
          allTools.push(...tools);
        }
      }

      // 创建LLM客户端（传递 thinking 配置）
      // 使用模型配置中的 thinking 模式，而不是用户切换的状态
      const enableThinking = selectedLLMConfig.metadata?.enableThinking ?? false;
      const llmClient = new LLMClient({
        id: selectedLLMConfig.config_id,
        provider: selectedLLMConfig.provider,
        name: selectedLLMConfig.name,
        apiKey: apiKey,
        apiUrl: selectedLLMConfig.api_url,
        model: selectedLLMConfig.model,
        enabled: selectedLLMConfig.enabled,
        metadata: {
          ...selectedLLMConfig.metadata,
          enableThinking: enableThinking, // 使用模型配置中的 thinking 模式
        },
      });

      // 构建系统提示词
      // 优先使用会话属性中的人设，其次使用默认提示词
      let systemPrompt = currentSystemPrompt || '你是一个智能工作流助手，可以帮助用户完成各种任务。';
      
      if (currentSystemPrompt) {
        console.log('[Workflow] 使用会话人设:', currentSystemPrompt.slice(0, 50) + '...');
      }
      
      // 添加历史总结（如果有，临时会话不添加）
      if (summaries.length > 0 && !isTemporarySession) {
        const summaryTexts = summaries.map(s => s.summary_content).join('\n\n');
        systemPrompt += `\n\n以下是之前对话的总结，请参考这些上下文：\n\n${summaryTexts}\n\n`;
      }
      
      // 添加选定的批次数据项（如果有）
      if (selectedBatchItem) {
        const { item, batchName } = selectedBatchItem;
        systemPrompt += `\n\n【参考资料 - ${batchName}】\n`;
        if (item.title) {
          systemPrompt += `标题: ${item.title}\n`;
        }
        if (item.content) {
          systemPrompt += `内容:\n${item.content}\n`;
        }
        systemPrompt += '\n请基于以上参考资料回答用户的问题。';
        
        console.log('[Workflow] 添加批次数据项到系统提示词:', { item, batchName });
      }
      
      // 添加技能包信息（如果有）
      // 合并会话分配的技能包和通过@选择器选择的技能包
      const selectedSkillPacks = selectedComponents
        .filter(c => c.type === 'skillpack')
        .map(c => allSkillPacks.find(sp => sp.skill_pack_id === c.id))
        .filter((sp): sp is SkillPack => sp !== undefined);
      
      const allAvailableSkillPacks = [
        ...currentSessionSkillPacks,
        ...selectedSkillPacks.filter(sp => !currentSessionSkillPacks.some(csp => csp.skill_pack_id === sp.skill_pack_id))
      ];
      
      if (allAvailableSkillPacks.length > 0 && !isTemporarySession) {
        systemPrompt += `\n\n【可用技能包】\n以下是你可以参考使用的技能包。如果决定使用某个技能包，请在响应中明确说明："我将使用技能包：[技能包名称]"。\n\n`;
        allAvailableSkillPacks.forEach((pack, index) => {
          systemPrompt += `技能包 ${index + 1}: ${pack.name}\n${pack.summary}\n\n`;
        });
      }
      
      if (allTools.length > 0) {
        systemPrompt += `\n\n你可以使用以下 MCP 工具来帮助用户完成任务：\n\n${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n当用户需要执行操作时，使用相应的工具。用中文回复用户，并清晰地说明你执行的操作和结果。`;
      } else {
        systemPrompt += '请根据用户的问题提供有用的回答和建议。用中文回复用户。';
      }

      // 构建消息历史（用于 token 计数和自动 summarize）
      const model = selectedLLMConfig.model || 'gpt-4';
      // 使用从后端获取的 max_tokens，如果没有则使用前端函数作为后备
      const maxTokens = selectedLLMConfig.max_tokens || get_model_max_tokens(model);
      const tokenThreshold = maxTokens - 1000; // 在限额-1000时触发 summarize
      
      // 找到最近一条总结消息的位置，只计算实际会发送的消息
      let lastSummaryIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].isSummary) {
          lastSummaryIndex = i;
          break;
        }
      }
      
      // 如果找到总结消息，从总结消息开始计算（包含总结消息）；否则计算所有消息
      const messagesToCount = lastSummaryIndex >= 0 
        ? messages.slice(lastSummaryIndex)
        : messages;
      
      // 构建用于token计算的消息列表（排除不发送的系统消息）
      const conversationMessages = messagesToCount
        .filter(m => {
          // 排除系统消息（但包含总结消息和系统提示词消息，因为总结消息会作为user消息发送，系统提示词消息已包含在systemPrompt中）
          if (m.role === 'system' && !m.isSummary) {
            // 检查是否是系统提示词消息
            const isSystemPrompt = m.toolCalls && 
              typeof m.toolCalls === 'object' &&
              (m.toolCalls as any).isSystemPrompt === true;
            if (!isSystemPrompt) {
              return false; // 排除普通系统消息
            }
          }
          return true;
        })
        .map(msg => {
          // 如果是总结消息，作为user消息计算token
          if (msg.isSummary) {
            return {
              role: 'user' as const,
              content: msg.content,
              thinking: undefined,
            };
          }
          return {
            role: msg.role,
            content: msg.content,
            thinking: msg.thinking,
          };
        });
      
      // 估算当前 token 数量（包括新用户消息）
      const currentTokens = estimate_messages_tokens(conversationMessages, model);
      
      // 将消息历史转换为 LLMMessage 格式（用于传递给 LLMClient）
      // 临时会话也需要“本次会话内”的上下文记忆，只是不落库持久化
      const baseMessagesToSend = lastSummaryIndex >= 0 ? messages.slice(lastSummaryIndex) : messages;
      const tempSessionHistoryWindow = 24; // 仅用于临时会话，避免上下文无限膨胀
      const messagesToSend = isTemporarySession
        ? baseMessagesToSend.slice(-tempSessionHistoryWindow)
        : baseMessagesToSend;
      
      const messageHistory: LLMMessage[] = [];
      for (const msg of messagesToSend) {
        // 如果是总结消息，将其内容作为 user 消息发送
        if (msg.isSummary) {
          messageHistory.push({
            role: 'user',
            content: msg.content, // 总结内容作为 user 消息
          });
          continue;
        }
        
        // 排除其他系统消息（通知消息等），但保留系统提示词消息（它已包含在systemPrompt中，不需要重复发送）
        if (msg.role === 'system') {
          // 检查是否是系统提示词消息
          const isSystemPrompt = msg.toolCalls && 
            typeof msg.toolCalls === 'object' &&
            (msg.toolCalls as any).isSystemPrompt === true;
          if (!isSystemPrompt) {
            continue; // 排除普通系统消息
          }
          // 系统提示词消息也不发送（因为它已包含在systemPrompt中）
          continue;
        }
        
        // 如果是 workflow 类型的 tool 消息，转换为 tool 类型
        if (msg.role === 'tool' && msg.toolType === 'workflow') {
          const workflowOutput = msg.content || '执行完成';
          messageHistory.push({
            role: 'tool',
            name: msg.workflowName || 'workflow',
            content: `我自己执行了一些操作，有这样的输出：${workflowOutput}`,
          });
        }
        // 其他 tool 消息（如 MCP）排除
        else if (msg.role === 'tool') {
          continue;
        }
        // user 和 assistant 消息直接转换（支持多模态和思维签名）
        else if (msg.role === 'user' || msg.role === 'assistant') {
          const llmMsg: LLMMessage = {
            role: msg.role,
            content: msg.content,
          };
          
          // 添加多模态内容
          if (msg.media && msg.media.length > 0) {
            llmMsg.parts = [];
            
            // 添加文本部分
            if (msg.content) {
              llmMsg.parts.push({ text: msg.content });
            }
            
            // 添加媒体部分
            for (const media of msg.media) {
              llmMsg.parts.push({
                inlineData: {
                  mimeType: media.mimeType,
                  data: media.data,
                },
              });
            }
          }
          
          // 添加思维签名
          if (msg.thoughtSignature) {
            if (llmMsg.parts && llmMsg.parts.length > 0) {
              // 如果有 parts，将签名添加到第一个 part
              if (!llmMsg.parts[0].thoughtSignature) {
                llmMsg.parts[0].thoughtSignature = msg.thoughtSignature;
              }
            } else {
              // 如果没有 parts，使用消息级别的签名
              llmMsg.thoughtSignature = msg.thoughtSignature;
            }
          }
          
          // 添加工具调用的思维签名
          if (msg.toolCallSignatures) {
            llmMsg.toolCallSignatures = msg.toolCallSignatures;
          }
          
          // 添加工具调用（如果是 assistant 消息）
          if (msg.role === 'assistant' && msg.toolCalls && Array.isArray(msg.toolCalls)) {
            llmMsg.tool_calls = msg.toolCalls.map((tc: any) => ({
              id: tc.name || `call_${Date.now()}`,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments || {}),
              },
            }));
          }
          
          messageHistory.push(llmMsg);
        }
      }
      
      // 检查是否需要自动 summarize
      let needsSummarize = false;
      if (currentTokens > tokenThreshold) {
        console.log(`[Workflow] Token count (${currentTokens}) exceeds threshold (${tokenThreshold}), triggering summarize`);
        needsSummarize = true;
      }
      
      // 如果需要 summarize，先执行总结（临时会话不进行总结）
      if (needsSummarize && sessionId && !isTemporarySession) {
        try {
          setIsSummarizing(true);
          const messagesToSummarize = conversationMessages.slice(0, -1).map((msg, idx) => ({
            message_id: messages.find(m => m.content === msg.content && m.role === msg.role)?.id || `msg-${idx}`,
            role: msg.role,
            content: msg.content,
          }));
          
          if (messagesToSummarize.length > 0) {
            await processSummarize(sessionId, messagesToSummarize, true);
          }
        } catch (error) {
          console.error('[Workflow] Auto-summarize failed:', error);
          // 继续执行，即使 summarize 失败
        } finally {
          setIsSummarizing(false);
        }
      }

      // 创建流式响应的消息
      const assistantMessageId = `msg-${Date.now() + 1}`;
      // 只有当模型配置中启用了思考模式时，才显示"思考中"状态
      const enableThinkingMode = selectedLLMConfig.metadata?.enableThinking ?? false;
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        thinking: '',
        isStreaming: true,
        isThinking: enableThinkingMode, // 只有启用思考模式时才显示思考中
      };
      // 新消息追加到数组后面（显示在底部）
      setMessages(prev => [...prev, assistantMessage]);
      // 默认折叠思考过程
      setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));

      // 创建AbortController用于中断请求
      const controller = new AbortController();
      setAbortController(controller);
      
      // 使用LLM客户端处理用户请求（自动调用MCP工具）
      let fullResponse = '';
      let fullThinking = '';
      let hasStartedContent = false; // 标记是否开始输出内容
      let currentProcessSteps: ProcessStep[] = []; // 累积保存过程步骤
      let lastThinkingLength = 0; // 上一次的思考内容长度
      let currentMCPToolName = ''; // 当前正在执行的 MCP 工具名
      
      // 创建临时消息更新函数（包含过程步骤）
      const updateMessage = (content: string, thinking?: string, isThinking?: boolean, isStreaming?: boolean, currentStep?: string) => {
        // 检测思考内容变化，如果有新的思考内容，添加到过程步骤
        const thinkingContent = thinking !== undefined ? thinking : '';
        if (thinkingContent.length > lastThinkingLength && thinkingContent.trim()) {
          // 查找现有的思考步骤
          const existingThinkingStep = currentProcessSteps.find(s => s.type === 'thinking' && !s.mcpServer);
          if (existingThinkingStep) {
            // 更新现有思考步骤的内容
            existingThinkingStep.thinking = thinkingContent;
          } else {
            // 创建新的思考步骤
            currentProcessSteps.push({
              type: 'thinking',
              timestamp: Date.now(),
              thinking: thinkingContent,
            });
          }
          lastThinkingLength = thinkingContent.length;
        }
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { 
                ...msg, 
                content, 
                thinking: thinking !== undefined ? thinking : msg.thinking,
                isThinking: isThinking !== undefined ? isThinking : msg.isThinking,
                isStreaming: isStreaming !== undefined ? isStreaming : msg.isStreaming,
                currentStep: currentStep !== undefined ? currentStep : msg.currentStep,
                processSteps: [...currentProcessSteps],
              }
            : msg
        ));
      };
      
      // 步骤变化回调（捕获 MCP 调用状态变化）
      const handleStepChange = (step: string) => {
        // 检测是否是 MCP 工具调用开始
        const mcpCallMatch = step.match(/正在调用工具:\s*(.+)/);
        if (mcpCallMatch) {
          const toolName = mcpCallMatch[1].trim();
          currentMCPToolName = toolName;
          
          // 如果有之前的思考内容，先保存为一个思考步骤
          if (fullThinking && fullThinking.length > lastThinkingLength) {
            const existingThinkingStep = currentProcessSteps.find(s => s.type === 'thinking' && !s.mcpServer);
            if (existingThinkingStep) {
              existingThinkingStep.thinking = fullThinking;
            } else {
              currentProcessSteps.push({
                type: 'thinking',
                timestamp: Date.now(),
                thinking: fullThinking,
              });
            }
            lastThinkingLength = fullThinking.length;
          }
        } else if (step === '' && currentMCPToolName) {
          // 重置思考长度追踪，准备捕获新的思考内容
          lastThinkingLength = fullThinking.length;
          currentMCPToolName = '';
        }
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { 
                ...msg, 
                currentStep: step,
                processSteps: [...currentProcessSteps],
              }
            : msg
        ));
      };

      // MCP 调用回调（捕获完整的 MCP 调用信息）
      const handleMCPCall = (info: { 
        toolName: string; 
        arguments: any; 
        result?: any; 
        status: 'pending' | 'running' | 'completed' | 'error'; 
        duration?: number; 
        mcpServer?: string;
        error?: string;
      }) => {
        console.log(`[Workflow] MCP 调用:`, info.toolName, info.status);
        
        if (info.status === 'running') {
          // MCP 调用开始，添加新步骤
          currentProcessSteps.push({
            type: 'mcp_call',
            timestamp: Date.now(),
            toolName: info.toolName,
            mcpServer: info.mcpServer,
            arguments: info.arguments,
            status: 'running',
          });
        } else if (info.status === 'completed' || info.status === 'error') {
          // MCP 调用完成或失败，更新已有步骤
          const mcpStep = currentProcessSteps.find(
            s => s.type === 'mcp_call' && s.toolName === info.toolName && s.status === 'running'
          );
          if (mcpStep) {
            mcpStep.status = info.status;
            mcpStep.result = info.status === 'error' ? { error: info.error } : info.result;
            mcpStep.duration = info.duration;
          } else {
            // 如果没有找到正在运行的步骤，可能是非流式模式，直接添加完成的步骤
            currentProcessSteps.push({
              type: 'mcp_call',
              timestamp: Date.now(),
              toolName: info.toolName,
              mcpServer: info.mcpServer,
              arguments: info.arguments,
              result: info.status === 'error' ? { error: info.error } : info.result,
              status: info.status,
              duration: info.duration,
            });
          }
        }
        
        // 更新消息
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { 
                ...msg, 
                processSteps: [...currentProcessSteps],
              }
            : msg
        ));
      };

      // 保存请求信息用于重试
      const requestInfo = {
        userMessage: userMessage.content,
        systemPrompt,
        tools: allTools.length > 0 ? allTools : undefined,
        messageHistory,
        sessionId: sessionId || undefined, // 将 null 转换为 undefined
        messageId: assistantMessageId,
        model: selectedLLMConfig.model || 'gpt-4',
      };
      
      // 存储到 ref 中，用于快速重试
      lastRequestRef.current = requestInfo;

      try {
        if (streamEnabled) {
          // 构建包含多模态内容的 LLMMessage
          const userLLMMessage: LLMMessage = {
            role: 'user',
            content: userMessage.content,
          };
          
          // 如果有媒体内容，构建 parts
          if (userMessage.media && userMessage.media.length > 0) {
            userLLMMessage.parts = [];
            if (userMessage.content) {
              userLLMMessage.parts.push({ text: userMessage.content });
            }
            for (const media of userMessage.media) {
              userLLMMessage.parts.push({
                inlineData: {
                  mimeType: media.mimeType,
                  data: media.data,
                },
              });
            }
          }
          
          // 将用户消息添加到消息历史（包含多模态内容）
          const messageHistoryWithUser = [...messageHistory, userLLMMessage];
          
          // 流式响应模式（使用包含多模态内容的消息历史）
          const response = await llmClient.handleUserRequestWithThinking(
            userMessage.content || '', // 即使没有文本内容，也传递空字符串
            systemPrompt,
            allTools.length > 0 ? allTools : undefined,
            true, // 启用流式响应
            (chunk: string, thinking?: string) => {
              // 流式更新消息内容
              if (chunk) {
                fullResponse += chunk;
                hasStartedContent = true;
              }
              
              // 更新思考过程（即使 thinking 是空字符串也要更新，确保UI能正确显示）
              if (thinking !== undefined) {
                fullThinking = thinking; // 流式更新思考过程
              }
              
              // 根据是否有内容来决定状态
              if (hasStartedContent) {
                // 如果已经开始输出内容，思考过程应该展开但标记为回答中
                updateMessage(fullResponse, fullThinking, false, true);
              } else if (fullThinking && fullThinking.length > 0) {
                // 如果有思考内容但还没有开始输出内容，保持思考状态
                updateMessage(fullResponse, fullThinking, true, true);
              } else {
                // 既没有内容也没有思考，只有启用思考模式时才显示思考状态
                updateMessage(fullResponse, fullThinking, enableThinkingMode, true);
              }
            },
            messageHistoryWithUser, // 传递包含多模态内容的消息历史
            handleStepChange, // 传递步骤变化回调
            handleMCPCall // 传递 MCP 调用回调
          );

          // 确保最终内容已更新（包括思考过程）
          // 结果完成后，自动折叠思考并更新状态为完成
          const finalContent = response.content || fullResponse;
          const finalThinking = response.thinking || fullThinking;
          
          // 详细打印响应内容（用于调试 gemini-image 等问题）
          console.log(`[Workflow] 📥 LLM 响应完成:`, {
            hasContent: !!response.content,
            contentLength: response.content?.length || 0,
            hasThinking: !!response.thinking,
            thinkingLength: response.thinking?.length || 0,
            hasMedia: !!response.media,
            mediaCount: response.media?.length || 0,
            fullResponseLength: fullResponse?.length || 0,
          });
          
          // 如果响应为空，打印警告
          if (!response.content && !response.media?.length) {
            console.warn(`[Workflow] ⚠️ LLM 返回了空响应！`);
            console.warn(`[Workflow] ⚠️ 完整响应对象:`, JSON.stringify(response, (key, value) => {
              if (key === 'data' && typeof value === 'string' && value.length > 100) {
                return value.substring(0, 100) + `...(${value.length} chars)`;
              }
              return value;
            }, 2));
          }
          
          // 更新消息（包含思维签名和多模态输出）
          console.log(`[Workflow] 更新 assistant 消息: content长度=${finalContent?.length || 0}, media数量=${response.media?.length || 0}`);
          if (response.media && response.media.length > 0) {
            console.log(`[Workflow] 收到 Gemini 图片:`, response.media.map(m => `${m.type}(${m.mimeType}, ${Math.round(m.data?.length / 1024)}KB)`).join(', '));
          }
          
          // 确保最终的思考内容被保存到过程步骤
          if (finalThinking && finalThinking.trim()) {
            const existingThinkingStep = currentProcessSteps.find(s => s.type === 'thinking' && !s.mcpServer);
            if (existingThinkingStep) {
              existingThinkingStep.thinking = finalThinking;
            } else if (currentProcessSteps.length === 0 || currentProcessSteps.every(s => s.type !== 'thinking')) {
              currentProcessSteps.unshift({
                type: 'thinking',
                timestamp: Date.now(),
                thinking: finalThinking,
              });
            }
          }
          
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { 
                  ...msg, 
                  content: finalContent,
                  thinking: finalThinking,
                  isThinking: false,
                  isStreaming: false,
                  thoughtSignature: response.thoughtSignature, // 保存思维签名
                  toolCallSignatures: response.toolCallSignatures, // 保存工具调用的思维签名
                  media: response.media, // 保存多模态输出（图片等）
                  processSteps: currentProcessSteps.length > 0 ? [...currentProcessSteps] : undefined,
                }
              : msg
          ));
          
          // 自动折叠思考过程（如果有思考内容）
          if (finalThinking && finalThinking.trim().length > 0) {
            setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));
          }
          
          // 检测是否使用了技能包
          if (currentSessionSkillPacks.length > 0 && finalContent) {
            const skillPackUsePattern = /我将使用技能包[：:]\s*([^\n]+)/i;
            const match = finalContent.match(skillPackUsePattern);
            if (match) {
              const skillPackName = match[1].trim();
              const usedSkillPack = currentSessionSkillPacks.find(
                pack => pack.name === skillPackName || finalContent.includes(pack.name)
              );
              if (usedSkillPack) {
                setPendingSkillPackUse({
                  skillPack: usedSkillPack,
                  messageId: assistantMessageId,
                });
              }
            }
          }
          
          // 保存助手消息到数据库（流式响应模式，包含思维签名和媒体内容，临时会话不保存）
          if (sessionId && !isTemporarySession) {
            try {
              const messageData: any = {
                message_id: assistantMessageId,
                role: 'assistant',
                content: finalContent, // 保存完整的回答内容
                thinking: finalThinking, // 保存思考过程
                model: selectedLLMConfig.model || 'gpt-4',
              };
              
              // 保存扩展数据到 ext 字段
              const extData: MessageExt = {};
              if (response.thoughtSignature) {
                extData.thoughtSignature = response.thoughtSignature;
              }
              if (response.toolCallSignatures) {
                extData.toolCallSignatures = response.toolCallSignatures;
              }
              // 保存 AI 生成的图片（base64）
              if (response.media && response.media.length > 0) {
                extData.media = response.media;
                console.log(`[Workflow] 保存 ${response.media.length} 个 AI 生成的媒体文件到数据库`);
              }
              // 保存过程步骤（思考和MCP调用历史）
              if (currentProcessSteps.length > 0) {
                extData.processSteps = currentProcessSteps;
                console.log(`[Workflow] 保存 ${currentProcessSteps.length} 个过程步骤到数据库`);
              }
              
              if (Object.keys(extData).length > 0) {
                messageData.ext = extData;
              }
              
              await saveMessage(sessionId, messageData);
              console.log('[Workflow] Saved assistant message to database:', assistantMessageId);
            } catch (error) {
              console.error('[Workflow] Failed to save assistant message:', error);
            }
          }
        } else {
          // 构建包含多模态内容的 LLMMessage（非流式模式）
          const userLLMMessage: LLMMessage = {
            role: 'user',
            content: userMessage.content,
          };
          
          // 如果有媒体内容，构建 parts
          if (userMessage.media && userMessage.media.length > 0) {
            userLLMMessage.parts = [];
            if (userMessage.content) {
              userLLMMessage.parts.push({ text: userMessage.content });
            }
            for (const media of userMessage.media) {
              userLLMMessage.parts.push({
                inlineData: {
                  mimeType: media.mimeType,
                  data: media.data,
                },
              });
            }
          }
          
          // 将用户消息添加到消息历史（包含多模态内容）
          const messageHistoryWithUser = [...messageHistory, userLLMMessage];
          
          // 非流式响应模式（使用包含多模态内容的消息历史）
          const response = await llmClient.handleUserRequestWithThinking(
            userMessage.content || '', // 即使没有文本内容，也传递空字符串
            systemPrompt,
            allTools.length > 0 ? allTools : undefined,
            false, // 禁用流式响应
            undefined, // 非流式模式不需要 onChunk
            messageHistoryWithUser, // 传递包含多模态内容的消息历史
            handleStepChange, // 传递步骤变化回调
            handleMCPCall // 传递 MCP 调用回调
          );
          
          // 构建非流式响应的过程步骤
          // 首先添加思考过程（如果有且尚未添加）
          if (response.thinking && response.thinking.trim()) {
            const hasThinkingStep = currentProcessSteps.some(s => s.type === 'thinking');
            if (!hasThinkingStep) {
              currentProcessSteps.unshift({
                type: 'thinking',
                timestamp: Date.now(),
                thinking: response.thinking,
              });
            } else {
              // 更新现有的思考步骤
              const existingThinkingStep = currentProcessSteps.find(s => s.type === 'thinking');
              if (existingThinkingStep) {
                existingThinkingStep.thinking = response.thinking;
              }
            }
          }
          
          // 更新消息（包含思维签名和多模态输出）
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { 
                  ...msg, 
                  content: response.content,
                  thinking: response.thinking,
                  isThinking: false,
                  isStreaming: false,
                  thoughtSignature: response.thoughtSignature, // 保存思维签名
                  toolCallSignatures: response.toolCallSignatures, // 保存工具调用的思维签名
                  media: response.media, // 保存多模态输出（图片等）
                  processSteps: currentProcessSteps.length > 0 ? [...currentProcessSteps] : undefined,
                }
              : msg
          ));
          
          // 自动折叠思考过程（如果有思考内容）
          if (response.thinking && response.thinking.trim().length > 0) {
            setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));
          }
          
          // 保存助手消息到数据库（非流式响应模式，包含思维签名和媒体内容，临时会话不保存）
          if (sessionId && !isTemporarySession) {
            try {
              const messageData: any = {
                message_id: assistantMessageId,
                role: 'assistant',
                content: response.content, // 保存完整的回答内容
                thinking: response.thinking, // 保存思考过程
                model: selectedLLMConfig.model || 'gpt-4',
              };
              
              // 保存扩展数据到 ext 字段
              const extData: MessageExt = {};
              if (response.thoughtSignature) {
                extData.thoughtSignature = response.thoughtSignature;
              }
              if (response.toolCallSignatures) {
                extData.toolCallSignatures = response.toolCallSignatures;
              }
              // 保存 AI 生成的图片（base64）
              if (response.media && response.media.length > 0) {
                extData.media = response.media;
                console.log(`[Workflow] 保存 ${response.media.length} 个 AI 生成的媒体文件到数据库`);
              }
              // 保存过程步骤（思考和MCP调用历史）
              if (currentProcessSteps.length > 0) {
                extData.processSteps = currentProcessSteps;
                console.log(`[Workflow] 保存 ${currentProcessSteps.length} 个过程步骤到数据库`);
              }
              
              if (Object.keys(extData).length > 0) {
                messageData.ext = extData;
              }
              
              await saveMessage(sessionId, messageData);
              console.log('[Workflow] Saved assistant message to database:', assistantMessageId);
            } catch (error) {
              console.error('[Workflow] Failed to save assistant message:', error);
            }
          }
          
          // 检测是否使用了技能包（非流式模式）
          if (currentSessionSkillPacks.length > 0 && response.content) {
            const skillPackUsePattern = /我将使用技能包[：:]\s*([^\n]+)/i;
            const match = response.content.match(skillPackUsePattern);
            if (match) {
              const skillPackName = match[1].trim();
              const usedSkillPack = currentSessionSkillPacks.find(
                pack => pack.name === skillPackName || response.content.includes(pack.name)
              );
              if (usedSkillPack) {
                setPendingSkillPackUse({
                  skillPack: usedSkillPack,
                  messageId: assistantMessageId,
                });
              }
            }
          }
        }
        
        // 无论流式还是非流式，完成后都更新 isLoading 状态
        setIsLoading(false);
      } catch (error) {
        console.error('[Workflow] Error details:', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        // 判断错误类型
        const isNetworkError = errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('Failed to');
        const isTimeoutError = errorMsg.includes('timeout') || errorMsg.includes('AbortError');
        const isRetryable = isNetworkError || isTimeoutError;
        
        // 更新消息状态为错误
        updateMessage(
          `❌ 错误: ${errorMsg}\n\n🔍 排查步骤：\n1. 检查 LLM 模型配置是否正确\n2. 检查 MCP 服务器是否已连接\n3. 检查 API 密钥是否有效\n4. 查看浏览器控制台的详细错误信息`,
          undefined,
          false,
          false
        );
        
        // 添加错误消息（带重试按钮）
        const errorMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: `❌ 错误: ${errorMsg}

🔍 排查步骤：
1. 检查 LLM 模型配置是否正确
2. 检查 MCP 服务器是否已连接
3. 检查 API 密钥是否有效
4. 查看浏览器控制台的详细错误信息`,
          // 添加错误元数据，用于UI显示重试按钮
          toolCalls: isRetryable ? { 
            canRetry: true, 
            errorType: (isNetworkError ? 'network' : isTimeoutError ? 'timeout' : 'unknown') as 'network' | 'timeout' | 'api' | 'unknown'
          } : undefined,
        };
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId ? errorMessage : msg
        ));
      } finally {
        setIsLoading(false);
      }
    } catch (outerError) {
      // 外层错误处理（如果内层try-catch没有捕获到）
      console.error('[Workflow] Outer error:', outerError);
      setIsLoading(false);
    }
  };
  
  // 快速重试失败的消息
  const handleRetryMessage = async (messageId: string) => {
    if (!lastRequestRef.current) {
      console.error('[Workflow] No previous request to retry');
      return;
    }
    
    const request = lastRequestRef.current;
    
    // 找到错误消息
    const errorMessage = messages.find(m => m.id === messageId);
    if (!errorMessage || errorMessage.role !== 'assistant') {
      return;
    }
    
    // 检查是否可以重试
    const canRetry = errorMessage.toolCalls && 
      typeof errorMessage.toolCalls === 'object' &&
      (errorMessage.toolCalls as any).canRetry === true;
    
    if (!canRetry) {
      alert('此错误无法自动重试，请检查配置后手动重试');
      return;
    }
    
    try {
      setIsLoading(true);
      
      // 更新消息状态为"重试中"
      setMessages(prev => prev.map(msg => 
        msg.id === messageId
          ? {
              ...msg,
              content: '🔄 正在重试...',
              isStreaming: true,
            }
          : msg
      ));
      
      // 重新发送请求（传递 thinking 配置）
      // 使用模型配置中的 thinking 模式，而不是用户切换的状态
      const enableThinking = selectedLLMConfig!.metadata?.enableThinking ?? false;
      const llmClient = new LLMClient({
        id: selectedLLMConfig!.config_id,
        provider: selectedLLMConfig!.provider,
        name: selectedLLMConfig!.name,
        apiKey: await getLLMConfigApiKey(selectedLLMConfigId!),
        apiUrl: selectedLLMConfig!.api_url,
        model: selectedLLMConfig!.model,
        enabled: selectedLLMConfig!.enabled,
        metadata: {
          ...selectedLLMConfig!.metadata,
          enableThinking: enableThinking, // 使用模型配置中的 thinking 模式
        },
      });
      
      let fullResponse = '';
      let fullThinking = '';
      let hasStartedContent = false;
      
      const updateMessage = (content: string, thinking?: string, isThinking?: boolean, isStreaming?: boolean, currentStep?: string) => {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { 
                ...msg, 
                content, 
                thinking: thinking !== undefined ? thinking : msg.thinking,
                isThinking: isThinking !== undefined ? isThinking : msg.isThinking,
                isStreaming: isStreaming !== undefined ? isStreaming : msg.isStreaming,
                currentStep: currentStep !== undefined ? currentStep : msg.currentStep,
              }
            : msg
        ));
      };
      
      // 步骤变化回调（用于重试）
      const handleStepChange = (step: string) => {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { 
                ...msg, 
                currentStep: step,
              }
            : msg
        ));
      };
      
      if (streamEnabled) {
        const response = await llmClient.handleUserRequestWithThinking(
          request.userMessage,
          request.systemPrompt,
          request.tools,
          true,
          (chunk: string, thinking?: string) => {
            // 流式更新消息内容
            if (chunk) {
              fullResponse += chunk;
              hasStartedContent = true;
            }
            
            // 更新思考过程（即使 thinking 是空字符串也要更新，确保UI能正确显示）
            if (thinking !== undefined) {
              fullThinking = thinking; // 流式更新思考过程
            }
            
            // 根据是否有内容来决定状态
            if (hasStartedContent) {
              // 如果已经开始输出内容，思考过程应该展开但标记为回答中
              updateMessage(fullResponse, fullThinking, false, true);
            } else if (fullThinking && fullThinking.length > 0) {
              // 如果有思考内容但还没有开始输出内容，保持思考状态
              updateMessage(fullResponse, fullThinking, true, true);
            } else {
              // 既没有内容也没有思考，只有启用思考模式时才显示思考状态
              updateMessage(fullResponse, fullThinking, enableThinking, true);
            }
          },
          request.messageHistory,
          handleStepChange
        );
        
        const finalContent = response.content || fullResponse;
        const finalThinking = response.thinking || fullThinking;
        updateMessage(finalContent, finalThinking, false, false);
        
        // 如果有多模态输出（图片等），添加到消息
        if (response.media && response.media.length > 0) {
          setMessages(prev => prev.map(msg => 
            msg.id === messageId ? { ...msg, media: response.media } : msg
          ));
        }
        
        if (finalThinking && finalThinking.trim().length > 0) {
          setCollapsedThinking(prev => new Set(prev).add(messageId));
        }
        
        // 保存到数据库（临时会话不保存）
        if (request.sessionId && !isTemporarySession) {
          try {
            const messageData: any = {
              message_id: messageId,
              role: 'assistant',
              content: finalContent,
              thinking: finalThinking,
              model: request.model || 'gpt-4',
            };
            
            // 保存媒体内容到 tool_calls 中
            if (response.media && response.media.length > 0) {
              messageData.tool_calls = { media: response.media };
              console.log(`[Workflow] 保存 ${response.media.length} 个 AI 生成的媒体文件到数据库`);
            }
            
            await saveMessage(request.sessionId, messageData);
          } catch (error) {
            console.error('[Workflow] Failed to save retried message:', error);
          }
        }
      } else {
        const response = await llmClient.handleUserRequestWithThinking(
          request.userMessage,
          request.systemPrompt,
          request.tools,
          false,
          undefined,
          request.messageHistory,
          handleStepChange
        );
        updateMessage(response.content, response.thinking, false, false);
        
        // 如果有多模态输出（图片等），添加到消息
        if (response.media && response.media.length > 0) {
          setMessages(prev => prev.map(msg => 
            msg.id === messageId ? { ...msg, media: response.media } : msg
          ));
        }
        
        if (response.thinking && response.thinking.trim().length > 0) {
          setCollapsedThinking(prev => new Set(prev).add(messageId));
        }
        
        // 保存到数据库
        if (request.sessionId) {
          try {
            const messageData: any = {
              message_id: messageId,
              role: 'assistant',
              content: response.content,
              thinking: response.thinking,
              model: request.model || 'gpt-4',
            };
            
            // 保存媒体内容到 tool_calls 中
            if (response.media && response.media.length > 0) {
              messageData.tool_calls = { media: response.media };
              console.log(`[Workflow] 保存 ${response.media.length} 个 AI 生成的媒体文件到数据库`);
            }
            
            await saveMessage(request.sessionId, messageData);
          } catch (error) {
            console.error('[Workflow] Failed to save retried message:', error);
          }
        }
      }
    } catch (error) {
      console.error('[Workflow] Retry failed:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 更新错误消息
      setMessages(prev => prev.map(msg => 
        msg.id === messageId
          ? {
              ...msg,
              content: `❌ 重试失败: ${errorMsg}\n\n请检查网络连接或稍后重试。`,
              isStreaming: false,
            }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  // 创建技能包
  const handleCreateSkillPack = async () => {
    if (!currentSessionId || selectedMessageIds.size === 0) {
      alert('请先选择要创建技能包的消息');
      return;
    }
    
    if (!selectedLLMConfigId) {
      alert('请先选择LLM模型用于生成技能包总结');
      return;
    }
    
    try {
      setIsCreatingSkillPack(true);
      
      const result = await createSkillPack({
        session_id: currentSessionId,
        message_ids: Array.from(selectedMessageIds),
        llm_config_id: selectedLLMConfigId,
      });
      
      setSkillPackResult(result);
      setSkillPackProcessInfo(result.process_info);
      setSkillPackConversationText(result.conversation_text);
      setShowSkillPackDialog(true);
      setSkillPackSelectionMode(false);
      setSelectedMessageIds(new Set());
    } catch (error: any) {
      console.error('[Workflow] Failed to create skill pack:', error);
      alert(`创建技能包失败: ${error.message}`);
    } finally {
      setIsCreatingSkillPack(false);
    }
  };

  // 保存技能包
  const handleSaveSkillPack = async () => {
    if (!skillPackResult) return;
    
    try {
      const saved = await saveSkillPack({
        name: skillPackResult.name,
        summary: skillPackResult.summary,
        source_session_id: skillPackResult.source_session_id,
        source_messages: skillPackResult.source_messages,
      });
      
      setShowSkillPackDialog(false);
      setSkillPackResult(null);
      setSkillPackProcessInfo(null);
      setSkillPackConversationText('');
      setOptimizationPrompt('');
      alert(`技能包 "${saved.name}" 保存成功！`);
    } catch (error: any) {
      console.error('[Workflow] Failed to save skill pack:', error);
      alert(`保存技能包失败: ${error.message}`);
    }
  };

  // 优化技能包总结
  const handleOptimizeSkillPack = async () => {
    if (!skillPackResult || !selectedLLMConfigId) return;
    
    try {
      setIsOptimizing(true);
      
      const optimized = await optimizeSkillPackSummary({
        conversation_text: skillPackConversationText,
        current_summary: skillPackResult.summary,
        optimization_prompt: optimizationPrompt,
        llm_config_id: selectedLLMConfigId,
        mcp_server_ids: selectedMCPForOptimization,
      });
      
      setSkillPackResult({
        ...skillPackResult,
        name: optimized.name,
        summary: optimized.summary,
      });
      setOptimizationPrompt('');
    } catch (error: any) {
      console.error('[Workflow] Failed to optimize skill pack:', error);
      alert(`优化技能包失败: ${error.message}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  // 切换消息选择状态
  const toggleMessageSelection = (messageId: string) => {
    if (!skillPackSelectionMode) return;
    
    setSelectedMessageIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // IME composing should not trigger send.
    if (isComposingRef.current || (e.nativeEvent as any)?.isComposing) return;
    // If any selector is open, let it handle Enter.
    if (showBatchItemSelector || showModuleSelector || showAtSelector) return;
    // shift+Enter: newline
    if (e.shiftKey) return;
    // Enter / Ctrl+Enter / Cmd+Enter: send
        e.preventDefault();
        handleSend();
  };

  // 开始编辑消息
  const handleStartEdit = (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (message && message.role === 'user') {
      editingMessageIdRef.current = messageId;
      setEditingMessageId(messageId);
      setInput(message.content);
      inputRef.current?.focus();
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    editingMessageIdRef.current = null;
    setEditingMessageId(null);
    setInput('');
  };

  // 重新发送消息（编辑后或直接重新发送）
  const handleResendMessage = async (messageId: string, newContent?: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.role !== 'user') {
      return;
    }

    const contentToSend = newContent || message.content;
    
    // 找到该消息的索引
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      return;
    }

    // 删除该消息及其之后的所有消息（包括数据库中的）
    const messagesToDelete = messages.slice(messageIndex);
    
    if (currentSessionId) {
      try {
        // 删除数据库中的消息
        for (const msg of messagesToDelete) {
          if (msg.role !== 'system') {
            try {
              await deleteMessage(currentSessionId, msg.id);
            } catch (error) {
              // 404 is fine (already deleted / cache mismatch)
              const messageText = error instanceof Error ? error.message : String(error);
              if (messageText.includes('NOT FOUND') || messageText.includes('404')) {
                console.warn(`[Workflow] Message already deleted: ${msg.id}`);
              } else {
              console.error(`[Workflow] Failed to delete message ${msg.id}:`, error);
              }
            }
          }
        }
        
        // 清除总结缓存（因为删除了消息）
        try {
        await clearSummarizeCache(currentSessionId);
        } catch (error) {
          console.warn('[Workflow] Failed to clear summarize cache (non-fatal):', error);
        }
        try {
        await loadSessionSummaries(currentSessionId);
        } catch (error) {
          console.warn('[Workflow] Failed to reload summaries (non-fatal):', error);
        }
      } catch (error) {
        console.error('[Workflow] Failed to delete messages:', error);
      }
    }

    // 从消息列表中删除这些消息（保留到该消息之前的所有消息）
    setMessages(prev => prev.slice(0, messageIndex));
    
    // 取消编辑状态（useRef first to avoid re-entering resend via handleSend)
    editingMessageIdRef.current = null;
    setEditingMessageId(null);
    
    // 使用新内容发送消息
    setInput(contentToSend);
    // 等待状态更新后发送
    setTimeout(() => {
      handleSend();
    }, 100);
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
  
  // 处理输入框变化，检测 @ 符号和 /模块 命令
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    
    const cursorPosition = e.target.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPosition);
    
    // 检测 / 命令（优先于@符号）
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    if (lastSlashIndex !== -1) {
      // 检查 / 后面是否有空格或换行（如果有，说明不是在选择）
      const textAfterSlash = textBeforeCursor.substring(lastSlashIndex + 1);
      const hasSpaceOrNewline = textAfterSlash.includes(' ') || textAfterSlash.includes('\n');
      
      // 检查是否在行首（/ 前面是行首或空格）
      const textBeforeSlash = textBeforeCursor.substring(0, lastSlashIndex);
      const isAtLineStart = textBeforeSlash.length === 0 || textBeforeSlash.endsWith('\n') || textBeforeSlash.endsWith(' ');
      
      if (!hasSpaceOrNewline && isAtLineStart) {
        // 显示模块选择器
        const query = textAfterSlash.toLowerCase();
        setModuleSelectorIndex(lastSlashIndex);
        setModuleSelectorQuery(query);
        setShowAtSelector(false); // 隐藏@选择器
        
        // 计算选择器位置（参考@选择器的逻辑，从下往上展开）
        if (inputRef.current) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          
          // 使用更可靠的方法：创建一个完全镜像 textarea 的隐藏 div 元素
          const mirror = document.createElement('div');
          
          // 复制关键样式，确保与 textarea 完全一致
          mirror.style.position = 'absolute';
          mirror.style.visibility = 'hidden';
          mirror.style.whiteSpace = styles.whiteSpace || 'pre-wrap';
          mirror.style.wordWrap = styles.wordWrap || 'break-word';
          mirror.style.overflowWrap = styles.overflowWrap || 'break-word';
          mirror.style.font = styles.font;
          mirror.style.fontSize = styles.fontSize;
          mirror.style.fontFamily = styles.fontFamily;
          mirror.style.fontWeight = styles.fontWeight;
          mirror.style.fontStyle = styles.fontStyle;
          mirror.style.letterSpacing = styles.letterSpacing;
          mirror.style.padding = styles.padding;
          mirror.style.border = styles.border;
          mirror.style.width = `${textarea.offsetWidth}px`;
          mirror.style.boxSizing = styles.boxSizing;
          mirror.style.lineHeight = styles.lineHeight;
          mirror.style.wordSpacing = styles.wordSpacing;
          mirror.style.top = `${textareaRect.top}px`;
          mirror.style.left = `${textareaRect.left}px`;
          
          // 设置文本内容到光标位置
          mirror.textContent = textBeforeCursor;
          document.body.appendChild(mirror);
          
          // 使用 Range API 来获取文本末尾（光标位置）的精确坐标
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              // 设置 range 到文本末尾（光标位置）
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              
              // 使用 right 属性来获取光标右侧的位置（更可靠）
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
              
              // 如果 right 和 left 相同（width 为 0），说明光标在文本末尾
              if (rangeRect.width === 0 && textLength > 0) {
                // 创建一个临时元素来测量文本宽度
                const measureSpan = document.createElement('span');
                measureSpan.style.font = styles.font;
                measureSpan.style.fontSize = styles.fontSize;
                measureSpan.style.fontFamily = styles.fontFamily;
                measureSpan.style.fontWeight = styles.fontWeight;
                measureSpan.style.fontStyle = styles.fontStyle;
                measureSpan.style.letterSpacing = styles.letterSpacing;
                measureSpan.style.whiteSpace = 'pre';
                measureSpan.textContent = textBeforeCursor;
                measureSpan.style.position = 'absolute';
                measureSpan.style.visibility = 'hidden';
                document.body.appendChild(measureSpan);
                const textWidth = measureSpan.offsetWidth;
                document.body.removeChild(measureSpan);
                
                // 使用 mirror 的位置 + padding + 文本宽度
                const mirrorRect = mirror.getBoundingClientRect();
                const paddingLeft = parseFloat(styles.paddingLeft) || 0;
                cursorX = mirrorRect.left + paddingLeft + textWidth;
              }
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            // 如果 Range API 失败，使用备用方法
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            
            // 计算当前行的宽度
            const lineMeasure = document.createElement('span');
            lineMeasure.style.font = styles.font;
            lineMeasure.style.fontSize = styles.fontSize;
            lineMeasure.style.fontFamily = styles.fontFamily;
            lineMeasure.style.fontWeight = styles.fontWeight;
            lineMeasure.style.fontStyle = styles.fontStyle;
            lineMeasure.style.letterSpacing = styles.letterSpacing;
            lineMeasure.style.whiteSpace = 'pre';
            lineMeasure.textContent = lineText;
            lineMeasure.style.position = 'absolute';
            lineMeasure.style.visibility = 'hidden';
            document.body.appendChild(lineMeasure);
            const lineWidth = lineMeasure.offsetWidth;
            document.body.removeChild(lineMeasure);
            
            // 计算行高和 padding
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          // 清理临时元素
          document.body.removeChild(mirror);
          
          // 选择器尺寸
          const selectorMaxHeight = 256; // max-h-64 = 256px
          const selectorWidth = 320; // 与 CrawlerModuleSelector 的宽度一致
          const viewportWidth = window.innerWidth;
          
          // 计算选择器位置（以光标为锚点，从下往上展开）
          // 策略：弹框底部紧贴光标位置，向上扩展
          
          // 左侧位置：光标右侧，加间距
          let left = cursorX + 8;
          
          // 如果选择器会超出右侧边界，则显示在光标左侧
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8; // 显示在光标左侧
            // 如果左侧也不够，就显示在光标右侧（即使会超出）
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          
          // 确保不会超出左侧
          if (left < 10) {
            left = 10;
          }
          
          // 使用 bottom 定位：弹框底部紧贴光标，向上扩展
          // 计算 bottom 值：从窗口底部到光标位置的距离
          const bottom = window.innerHeight - cursorY + 5; // 5px 间距，让弹框稍微在光标上方
          
          // 计算可用的向上高度（从光标到屏幕顶部的空间）
          const availableHeightAbove = cursorY - 20; // 留20px顶部边距
          
          // 最大高度取较小值：配置的最大高度 或 可用空间
          const actualMaxHeight = Math.min(selectorMaxHeight, availableHeightAbove);
          
          console.log('[Workflow] Module selector position:', {
            cursorY,
            bottom,
            availableHeightAbove,
            actualMaxHeight,
            windowHeight: window.innerHeight
          });
          
          setModuleSelectorPosition({
            bottom, // 使用 bottom 定位，从下往上扩展
            left,
            maxHeight: actualMaxHeight
          } as any);
          setShowModuleSelector(true);
        }
        return;
      } else {
        // / 后面有空格或换行，或不在行首，关闭选择器
        console.log('[Workflow] / 字符条件不符合，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    } else {
      // 没有找到 / 字符，关闭选择器
      if (showModuleSelector) {
        console.log('[Workflow] 删除了 / 字符，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    }
    
    // 检测 @ 符号
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
        
        // 计算选择器位置（跟随光标位置，出现在右上方）
        if (inputRef.current) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          
          // 使用更可靠的方法：创建一个完全镜像 textarea 的隐藏 div 元素
          const mirror = document.createElement('div');
          
          // 复制关键样式，确保与 textarea 完全一致
          mirror.style.position = 'absolute';
          mirror.style.visibility = 'hidden';
          mirror.style.whiteSpace = styles.whiteSpace || 'pre-wrap';
          mirror.style.wordWrap = styles.wordWrap || 'break-word';
          mirror.style.overflowWrap = styles.overflowWrap || 'break-word';
          mirror.style.font = styles.font;
          mirror.style.fontSize = styles.fontSize;
          mirror.style.fontFamily = styles.fontFamily;
          mirror.style.fontWeight = styles.fontWeight;
          mirror.style.fontStyle = styles.fontStyle;
          mirror.style.letterSpacing = styles.letterSpacing;
          mirror.style.padding = styles.padding;
          mirror.style.border = styles.border;
          mirror.style.width = `${textarea.offsetWidth}px`;
          mirror.style.boxSizing = styles.boxSizing;
          mirror.style.lineHeight = styles.lineHeight;
          mirror.style.wordSpacing = styles.wordSpacing;
          mirror.style.top = `${textareaRect.top}px`;
          mirror.style.left = `${textareaRect.left}px`;
          
          // 设置文本内容到光标位置
          const textBeforeCursor = value.substring(0, cursorPosition);
          mirror.textContent = textBeforeCursor;
          
          document.body.appendChild(mirror);
          
          // 使用 Range API 来获取文本末尾（光标位置）的精确坐标
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              // 设置 range 到文本末尾（光标位置）
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              
              // 使用 right 属性来获取光标右侧的位置（更可靠）
              // 对于空 range（光标位置），right 会指向光标右侧
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
              
              // 如果 right 和 left 相同（width 为 0），说明光标在文本末尾
              // 这种情况下，我们需要测量文本的实际宽度
              if (rangeRect.width === 0 && textLength > 0) {
                // 创建一个临时元素来测量文本宽度
                const measureSpan = document.createElement('span');
                measureSpan.style.font = styles.font;
                measureSpan.style.fontSize = styles.fontSize;
                measureSpan.style.fontFamily = styles.fontFamily;
                measureSpan.style.fontWeight = styles.fontWeight;
                measureSpan.style.fontStyle = styles.fontStyle;
                measureSpan.style.letterSpacing = styles.letterSpacing;
                measureSpan.style.whiteSpace = 'pre';
                measureSpan.textContent = textBeforeCursor;
                measureSpan.style.position = 'absolute';
                measureSpan.style.visibility = 'hidden';
                document.body.appendChild(measureSpan);
                const textWidth = measureSpan.offsetWidth;
                document.body.removeChild(measureSpan);
                
                // 使用 mirror 的位置 + padding + 文本宽度
                const mirrorRect = mirror.getBoundingClientRect();
                const paddingLeft = parseFloat(styles.paddingLeft) || 0;
                cursorX = mirrorRect.left + paddingLeft + textWidth;
              }
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            // 如果 Range API 失败，使用备用方法
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            
            // 计算当前行的宽度
            const lineMeasure = document.createElement('span');
            lineMeasure.style.font = styles.font;
            lineMeasure.style.fontSize = styles.fontSize;
            lineMeasure.style.fontFamily = styles.fontFamily;
            lineMeasure.style.fontWeight = styles.fontWeight;
            lineMeasure.style.fontStyle = styles.fontStyle;
            lineMeasure.style.letterSpacing = styles.letterSpacing;
            lineMeasure.style.whiteSpace = 'pre';
            lineMeasure.textContent = lineText;
            lineMeasure.style.position = 'absolute';
            lineMeasure.style.visibility = 'hidden';
            document.body.appendChild(lineMeasure);
            const lineWidth = lineMeasure.offsetWidth;
            document.body.removeChild(lineMeasure);
            
            // 计算行高和 padding
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          // 清理临时元素
          document.body.removeChild(mirror);
          
          // 选择器尺寸
          const selectorMaxHeight = 256; // max-h-64 = 256px
          const selectorWidth = 300; // maxWidth
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          
          // 计算选择器位置（以光标为锚点，从下往上展开）
          // 策略：弹框底部对齐光标位置，向上展开
          // 先计算弹框的理想高度（最大不超过 selectorMaxHeight）
          const idealHeight = selectorMaxHeight;
          
          // 计算弹框顶部位置：光标位置 - 弹框高度
          // 这样弹框底部会对齐光标位置
          let top = cursorY - idealHeight;
          let left = cursorX + 8; // 光标右侧，加上间距
          
          // 如果弹框会超出顶部，调整位置
          // 确保至少留出 10px 的顶部边距
          if (top < 10) {
            // 如果上方空间不足，限制弹框高度，使其顶部对齐到 10px
            // 这样弹框会从顶部开始，但底部尽量靠近光标
            // 注意：实际高度会在 CSS 中通过 max-height 限制，位置会在 useEffect 中进一步调整
            top = 10;
          }
          
          // 如果选择器会超出右侧边界，则显示在光标左侧
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8; // 显示在光标左侧
            // 如果左侧也不够，就显示在光标右侧（即使会超出）
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          
          // 确保不会超出左侧
          if (left < 10) {
            left = 10;
          }
          
          // 计算实际可用的最大高度（从 top 到光标位置的距离）
          const maxAvailableHeight = cursorY - top - 8; // 减去一些间距
          
          // 如果可用高度小于最大高度，使用可用高度
          const actualMaxHeight = Math.min(selectorMaxHeight, maxAvailableHeight);
          
          console.log('[Workflow] Selector position calculated (cursor):', { 
            top, 
            left, 
            cursorX,
            cursorY,
            textareaRect,
            viewportHeight,
            viewportWidth,
            cursorPosition,
            actualMaxHeight,
            maxAvailableHeight
          });
          
          setAtSelectorPosition({ 
            top, 
            left,
            maxHeight: actualMaxHeight // 传递最大高度
          });
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
  
  // 获取可选择的组件列表（用于键盘导航）- 显示所有MCP，不仅仅是已连接的
  const getSelectableComponents = React.useCallback(() => {
    const mcpList = mcpServers
      .filter(s => s.name.toLowerCase().includes(atSelectorQuery))
      .map(s => ({ type: 'mcp' as const, id: s.id, name: s.name }));
    
    const workflowList = workflows
      .filter(w => w.name.toLowerCase().includes(atSelectorQuery))
      .map(w => ({ type: 'workflow' as const, id: w.workflow_id, name: w.name }));
    
    const skillPackList = allSkillPacks
      .filter(sp => sp.name.toLowerCase().includes(atSelectorQuery))
      .map(sp => ({ type: 'skillpack' as const, id: sp.skill_pack_id, name: sp.name }));
    
    return [...mcpList, ...workflowList, ...skillPackList];
  }, [mcpServers, workflows, allSkillPacks, atSelectorQuery]);
  
  // 处理模块选择（/模块命令）
  const handleModuleSelect = async (moduleId: string, batchId: string, batchName: string) => {
    try {
      // 获取批次数据
      const batch = await getBatch(moduleId, batchId);
      
      // 检查数据是否存在
      if (!batch || !batch.crawled_data) {
        alert('该批次没有数据');
        return;
      }
      
      // 优先使用 parsed_data（用户标记后生成的解析数据），如果没有则使用 crawled_data.normalized
      // parsed_data 现在是一个简单的数组，每个元素包含 title 和 content
      let normalizedData: any = null;
      
      if (batch.parsed_data && Array.isArray(batch.parsed_data)) {
        // parsed_data 是数组格式，转换为对象格式
        normalizedData = {
          items: batch.parsed_data.map((item, index) => ({
            id: `item_${index + 1}`,
            title: item.title || '',
            content: item.content || ''
          })),
          total_count: batch.parsed_data.length,
          format: 'list'
        };
      } else if (batch.parsed_data && typeof batch.parsed_data === 'object') {
        // parsed_data 是对象格式（兼容旧数据）
        normalizedData = batch.parsed_data;
      } else if (batch.crawled_data?.normalized) {
        // 使用 crawled_data.normalized
        normalizedData = batch.crawled_data.normalized;
      }
      
      if (!normalizedData || !normalizedData.items || normalizedData.items.length === 0) {
        alert('该批次没有解析数据，请先在爬虫配置页面标记并生成解析数据');
        return;
      }
      
      // 如果有多个数据项，显示选择器让用户选择
      if (normalizedData.items.length > 1) {
        setSelectedBatch(batch);
        setShowModuleSelector(false);
        
        // 计算批次数据项选择器的位置（使用相同的位置计算逻辑）
        if (inputRef.current && moduleSelectorIndex !== -1) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          const cursorPosition = moduleSelectorIndex + 1 + moduleSelectorQuery.length;
          const textBeforeCursor = input.substring(0, cursorPosition);
          
          // 使用与模块选择器相同的位置计算逻辑
          const mirror = document.createElement('div');
          mirror.style.position = 'absolute';
          mirror.style.visibility = 'hidden';
          mirror.style.whiteSpace = styles.whiteSpace || 'pre-wrap';
          mirror.style.wordWrap = styles.wordWrap || 'break-word';
          mirror.style.overflowWrap = styles.overflowWrap || 'break-word';
          mirror.style.font = styles.font;
          mirror.style.fontSize = styles.fontSize;
          mirror.style.fontFamily = styles.fontFamily;
          mirror.style.fontWeight = styles.fontWeight;
          mirror.style.fontStyle = styles.fontStyle;
          mirror.style.letterSpacing = styles.letterSpacing;
          mirror.style.padding = styles.padding;
          mirror.style.border = styles.border;
          mirror.style.width = `${textarea.offsetWidth}px`;
          mirror.style.boxSizing = styles.boxSizing;
          mirror.style.lineHeight = styles.lineHeight;
          mirror.style.wordSpacing = styles.wordSpacing;
          mirror.style.top = `${textareaRect.top}px`;
          mirror.style.left = `${textareaRect.left}px`;
          mirror.textContent = textBeforeCursor;
          document.body.appendChild(mirror);
          
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            const lineMeasure = document.createElement('span');
            lineMeasure.style.font = styles.font;
            lineMeasure.style.fontSize = styles.fontSize;
            lineMeasure.style.fontFamily = styles.fontFamily;
            lineMeasure.style.fontWeight = styles.fontWeight;
            lineMeasure.style.fontStyle = styles.fontStyle;
            lineMeasure.style.letterSpacing = styles.letterSpacing;
            lineMeasure.style.whiteSpace = 'pre';
            lineMeasure.textContent = lineText;
            lineMeasure.style.position = 'absolute';
            lineMeasure.style.visibility = 'hidden';
            document.body.appendChild(lineMeasure);
            const lineWidth = lineMeasure.offsetWidth;
            document.body.removeChild(lineMeasure);
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          document.body.removeChild(mirror);
          
          const selectorMaxHeight = 400;
          const selectorWidth = 500;
          const viewportWidth = window.innerWidth;
          const idealHeight = selectorMaxHeight;
          let top = cursorY - idealHeight;
          let left = cursorX + 8;
          
          if (top < 10) {
            top = 10;
          }
          
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8;
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          
          if (left < 10) {
            left = 10;
          }
          
          const maxAvailableHeight = cursorY - top - 8;
          const actualMaxHeight = Math.min(selectorMaxHeight, maxAvailableHeight);
          
          setBatchItemSelectorPosition({
            top,
            left,
            maxHeight: actualMaxHeight
          });
          setShowBatchItemSelector(true);
        }
      } else {
        // 只有一个数据项，直接插入
        const item = normalizedData.items[0];
        handleBatchItemSelect(item, batchName);
      }
    } catch (error: any) {
      console.error('[Workflow] Failed to select module:', error);
      alert(`获取模块数据失败: ${error.message || '未知错误'}`);
    }
  };
  
  // 处理批次数据项选择（显示操作选择界面）
  const handleBatchItemSelect = (item: any, batchName: string) => {
    console.log('[Workflow] 选定批次数据项，等待用户选择操作:', { item, batchName });
    
    // 保存待处理的批次数据项
    setPendingBatchItem({ item, batchName });
    
    // 关闭选择器
    setShowBatchItemSelector(false);
    setShowModuleSelector(false);
    setModuleSelectorIndex(-1);
    setModuleSelectorQuery('');
    setSelectedBatch(null);
    
    // 如果还在输入框中保留了 /模块 文本，清除它
    if (inputRef.current && moduleSelectorIndex !== -1) {
      const textBefore = input.substring(0, moduleSelectorIndex);
      const textAfter = input.substring(moduleSelectorIndex + 1 + moduleSelectorQuery.length);
      const newText = textBefore + textAfter;
      setInput(newText);
      
      // 设置光标位置
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(textBefore.length, textBefore.length);
          inputRef.current.focus();
        }
      }, 0);
    }
  };
  
  // 将批次数据项设置为系统提示词（人设）
  const handleSetAsSystemPrompt = async () => {
    if (!pendingBatchItem) return;
    
    const { item, batchName } = pendingBatchItem;
    console.log('[Workflow] 设置批次数据项为人设:', { item, batchName });
    
    // 构建人设内容
    let systemPromptContent = '';
    if (item.title) {
      systemPromptContent += `【${batchName}】${item.title}\n\n`;
    }
    if (item.content) {
      systemPromptContent += item.content;
    }
    
    // 保存选定的批次数据项（用于显示）
    setSelectedBatchItem({ item, batchName });
    setPendingBatchItem(null);
    
    // 更新会话的人设属性
    if (currentSessionId) {
      try {
        await updateSessionSystemPrompt(currentSessionId, systemPromptContent);
        setCurrentSystemPrompt(systemPromptContent);
        // 更新 sessions 列表
        setSessions(prev => prev.map(s => 
          s.session_id === currentSessionId ? { ...s, system_prompt: systemPromptContent } : s
        ));
        console.log('[Workflow] 人设已更新');
      } catch (error) {
        console.error('[Workflow] Failed to update system prompt:', error);
      }
    } else {
      // 没有会话时，只更新本地状态
      setCurrentSystemPrompt(systemPromptContent);
    }
  };
  
  // 将批次数据项作为对话内容插入
  const handleInsertAsMessage = () => {
    if (!pendingBatchItem) return;
    
    const { item, batchName } = pendingBatchItem;
    console.log('[Workflow] 将批次数据项插入为对话内容:', { item, batchName });
    
    // 构建插入的文本
    let insertText = `[引用: ${batchName}]\n`;
    if (item.title) {
      insertText += `标题: ${item.title}\n`;
    }
    if (item.content) {
      insertText += `内容: ${item.content}\n`;
    }
    insertText += '\n';
    
    // 插入到输入框
    if (inputRef.current) {
      const currentValue = input;
      const cursorPosition = inputRef.current.selectionStart || currentValue.length;
      const textBefore = currentValue.substring(0, cursorPosition);
      const textAfter = currentValue.substring(cursorPosition);
      const newText = textBefore + insertText + textAfter;
      
      setInput(newText);
      setPendingBatchItem(null);
      
      // 设置光标位置
      setTimeout(() => {
        if (inputRef.current) {
          const newCursorPos = textBefore.length + insertText.length;
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
          inputRef.current.focus();
        }
      }, 0);
    }
  };
  
  // 选择感知组件（添加为 tag）
  const handleSelectComponent = async (component: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => {
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
      // 新消息追加到数组后面（显示在底部）
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
      // 如果是workflow，自动初始化（使用池化管理）
      if (component.type === 'workflow') {
        try {
          console.log(`[Workflow] Auto-initializing workflow: ${component.name} (${component.id})`);
          const instance = await workflowPool.acquireWorkflow(component.id);
          console.log(`[Workflow] Workflow initialized with ${instance.mcpClients.size} MCP clients`);
        } catch (error) {
          console.error(`[Workflow] Failed to initialize workflow:`, error);
          // 即使初始化失败，也允许添加组件（可能后续会重试）
        }
      }
      
      // 添加到已选定的组件列表
      setSelectedComponents(prev => [...prev, component]);
      
      // 如果是MCP服务器，自动激活它（添加到selectedMcpServerIds）
      if (component.type === 'mcp') {
        // 如果MCP服务器未连接，先尝试连接
        if (!connectedMcpServerIds.has(component.id)) {
          console.log('[Workflow] MCP server not connected, attempting to connect:', component.name);
          try {
            await handleConnectServer(component.id);
          } catch (error) {
            console.error('[Workflow] Failed to connect MCP server:', error);
          }
        }
        // 连接后添加到选中列表
          setSelectedMcpServerIds(prev => {
            const newSet = new Set(prev);
            newSet.add(component.id);
            return newSet;
          });
          console.log('[Workflow] Auto-activated MCP server:', component.name);
      }
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
      // 如果是workflow，将实例放回池中
      if (component.type === 'workflow') {
        workflowPool.returnToPool(component.id);
        console.log(`[Workflow] Returned workflow instance to pool: ${component.name} (${component.id})`);
      }
      
      // 如果是MCP服务器，从selectedMcpServerIds中移除
      if (component.type === 'mcp') {
        setSelectedMcpServerIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(component.id);
          return newSet;
        });
        console.log('[Workflow] Deactivated MCP server:', component.name);
      }
    }
    setSelectedComponents(prev => prev.filter((_, i) => i !== index));
  };

  // 处理文件拖拽
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
      // 支持图片、视频、音频
      if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = event.target?.result as string;
          const base64Data = result.includes(',') ? result.split(',')[1] : result;
          const mimeType = file.type;
          const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'audio';
          
          setAttachedMedia(prev => [...prev, {
            type,
            mimeType,
            data: base64Data,
            preview: result,
          }]);
        };
        reader.readAsDataURL(file);
      }
    });
  };

  // 处理MCP和Workflow的选择（通过缩略图标）
  const handleSelectMCPFromThumbnail = (serverId: string) => {
    const server = mcpServers.find(s => s.id === serverId);
    if (server && connectedMcpServerIds.has(serverId)) {
      setSelectedMcpServerIds(prev => {
        const newSet = new Set(prev);
        newSet.add(serverId);
        return newSet;
      });
    }
  };

  const handleDeselectMCPFromThumbnail = (serverId: string) => {
    setSelectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
  };

  const handleSelectWorkflowFromThumbnail = (workflowId: string) => {
    const workflow = workflows.find(w => w.workflow_id === workflowId);
    if (workflow) {
      const component = { type: 'workflow' as const, id: workflowId, name: workflow.name };
      if (selectedComponents.length === 0) {
        setSelectedComponents([component]);
      }
    }
  };

  const handleDeselectWorkflowFromThumbnail = (workflowId: string) => {
    setSelectedComponents(prev => prev.filter(c => !(c.type === 'workflow' && c.id === workflowId)));
  };

  const handleSelectSkillPackFromThumbnail = (skillPackId: string) => {
    const skillPack = allSkillPacks.find(sp => sp.skill_pack_id === skillPackId);
    if (skillPack) {
      const component = { type: 'skillpack' as const, id: skillPackId, name: skillPack.name };
      if (!selectedComponents.some(c => c.type === 'skillpack' && c.id === skillPackId)) {
        setSelectedComponents(prev => [...prev, component]);
      }
    }
  };

  const handleDeselectSkillPackFromThumbnail = (skillPackId: string) => {
    setSelectedComponents(prev => prev.filter(c => !(c.type === 'skillpack' && c.id === skillPackId)));
  };

  // 处理附件上传
  const handleAttachFile = (files: FileList) => {
    const fileArray = Array.from(files);
    fileArray.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        // 移除 data URL 前缀，只保留 base64 数据
        const base64Data = result.includes(',') ? result.split(',')[1] : result;
        const mimeType = file.type;
        // 支持图片、视频、音频
        const type: 'image' | 'video' | 'audio' = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : 'audio';
        
        setAttachedMedia(prev => [...prev, {
          type,
          mimeType,
          data: base64Data,
          preview: result, // 用于预览
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  // 获取选中的workflow IDs
  const selectedWorkflowIds = new Set(
    selectedComponents.filter(c => c.type === 'workflow').map(c => c.id)
  );

  // 获取选中的skill pack IDs
  const selectedSkillPackIds = new Set(
    selectedComponents.filter(c => c.type === 'skillpack').map(c => c.id)
  );

  // 处理拖拽组件到对话框
  const handleDropComponent = async (component: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => {
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
  const addWorkflowMessage = async (component: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => {
    // 如果是技能包，不需要执行工作流，只需要在系统提示词中包含技能包内容
    if (component.type === 'skillpack') {
      // 技能包通过selectedComponents管理，在构建systemPrompt时包含
      // 这里只需要添加到selectedComponents中
      setSelectedComponents(prev => {
        const isAlreadySelected = prev.some(
          c => c.id === component.id && c.type === component.type
        );
        if (!isAlreadySelected) {
          return [...prev, component];
        }
        return prev;
      });
      return;
    }
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
    
    // 新消息追加到数组后面（显示在底部）
    setMessages(prev => [...prev, workflowMessage]);
    
    // 保存消息到数据库，tool_calls字段包含组件信息，以便后端API能够找到并执行（临时会话不保存）
    if (currentSessionId && !isTemporarySession) {
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
  const handleExecuteWorkflow = async (messageId: string) => {
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
    
    // 获取上一条消息作为输入（跳过其他工作流消息，找到用户或助手消息）
    const messageIndex = messages.findIndex(m => m.id === messageId);
    let previousMessage: Message | null = null;
    for (let i = messageIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      // 跳过工作流消息，找到用户或助手消息
      if (msg.role === 'user' || msg.role === 'assistant') {
        previousMessage = msg;
        break;
      }
    }
    
    const input = previousMessage?.content || '';
    
    if (!input) {
      alert('上一条消息为空，无法执行工作流');
      return;
    }
    
    // 更新消息状态为运行中
    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? { ...msg, workflowStatus: 'running' }
        : msg
    ));
    
    try {
      // 使用新的 message_execution API 执行感知组件
      const execution = await executeMessageComponent(
        messageId,
        selectedLLMConfigId,
        input
      );
      
      // 更新消息状态和结果
      const result = execution.result || execution.error_message || '执行完成';
      const status = execution.status === 'completed' ? 'completed' : 'error';
      
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { 
              ...msg, 
              workflowStatus: status,
              content: result,
            }
          : msg
      ));
      
      // 注意：不再直接保存消息到数据库，执行结果已通过 message_execution 表管理
      console.log('[Workflow] Execution completed:', execution);
      
    } catch (error) {
      console.error('[Workflow] Failed to execute workflow:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { 
              ...msg, 
              workflowStatus: 'error',
              content: `❌ 执行失败: ${errorMsg}`,
            }
          : msg
      ));
      
      // 注意：错误信息已通过 message_execution 表记录
      console.error('[Workflow] Execution error:', errorMsg);
    } finally {
      // 执行完成后，将workflow实例放回池中
      if (message?.workflowId) {
        workflowPool.returnToPool(message.workflowId);
        console.log(`[Workflow] Returned workflow instance to pool: ${message.workflowId}`);
      }
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
          // 新消息追加到数组后面（显示在底部）
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

  // 解析 MCP 内容格式，提取文本和媒体
  const parseMCPContent = (content: any): { texts: string[]; media: Array<{ type: 'image' | 'video' | 'audio'; mimeType: string; data: string }> } => {
    // NOTE: Debug log removed for UX smoothness
    const texts: string[] = [];
    const media: Array<{ type: 'image' | 'video' | 'audio'; mimeType: string; data: string }> = [];
    
    try {
      // 如果是字符串，尝试解析为 JSON
      let contentObj = content;
      if (typeof content === 'string') {
        try {
          contentObj = JSON.parse(content);
          // NOTE: Debug log removed for UX smoothness
        } catch {
          // 不是 JSON，返回原始字符串
          // NOTE: Debug log removed for UX smoothness
          return { texts: [content], media: [] };
        }
      }
      
      // 检查是否有 content 数组（MCP 响应格式）
      const contentArray = contentObj?.result?.content || contentObj?.content || (Array.isArray(contentObj) ? contentObj : null);
      // NOTE: Debug log removed for UX smoothness
      
      if (Array.isArray(contentArray)) {
        // NOTE: Debug log removed for UX smoothness
        for (const item of contentArray) {
          // NOTE: Debug log removed for UX smoothness
          if (item.type === 'text' && item.text) {
            texts.push(item.text);
          } else if (item.type === 'image') {
            const mimeType = item.mimeType || item.mime_type;
            const data = item.data;
            // NOTE: Debug log removed for UX smoothness
            if (!mimeType || !data) {
              console.warn('[MCP Debug] parseMCPContent 图片缺少 mimeType 或 data，跳过');
              continue;
            }
            media.push({
              type: 'image',
              mimeType,
              data,
            });
          } else if (item.type === 'video') {
            const mimeType = item.mimeType || item.mime_type;
            const data = item.data;
            // NOTE: Debug log removed for UX smoothness
            if (!mimeType || !data) {
              console.warn('[MCP Debug] parseMCPContent 视频缺少 mimeType 或 data，跳过');
              continue;
            }
            media.push({
              type: 'video',
              mimeType,
              data,
            });
          }
        }
      } else if (contentObj && typeof contentObj === 'object') {
        // 如果不是数组，返回 JSON 字符串
        // NOTE: Debug log removed for UX smoothness
        texts.push(JSON.stringify(contentObj, null, 2));
      }
    } catch (e) {
      console.error('[MCP Debug] parseMCPContent 解析失败:', e);
      texts.push(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    }
    
    // NOTE: Debug log removed for UX smoothness
    return { texts, media };
  };

  const renderMCPBlocksForMessage = (blocks: any[], messageId?: string) => {
    return renderMCPBlocks({
      blocks,
      messageId,
      findSessionMediaIndex,
      openSessionMediaPanel,
    });
  };

  const renderMCPMediaForMessage = (
    media: Array<{ type: 'image' | 'video' | 'audio'; mimeType: string; data: string }>,
    messageId?: string
  ) => {
    return renderMCPMedia({
      media,
      messageId,
      findSessionMediaIndex,
      openSessionMediaPanel,
    });
  };

  const renderMessageContent = (message: Message) => {
    // 思考/生成中的占位内容（当内容为空且正在处理时）
    if (message.role === 'assistant' && (!message.content || message.content.length === 0) && (message.isThinking || message.isStreaming)) {
      const hasThinkingContent = message.thinking && message.thinking.trim().length > 0;
      
      // 如果有思考内容，直接显示流式思考过程，不显示动画
      if (hasThinkingContent) {
        return (
          <div className="w-full">
            <div className="mb-2">
              <div className="flex items-center space-x-1 text-[10px] text-gray-400 dark:text-[#808080] mb-1">
                <Lightbulb className="w-3 h-3" />
                <span>思考过程</span>
                {message.isThinking && (
                  <>
                    <span>思考中...</span>
                    <span className="inline-block ml-1 w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse"></span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-[#808080] font-mono leading-relaxed whitespace-pre-wrap break-words bg-transparent">
                {message.thinking}
              </div>
            </div>
            {/* 中断按钮 */}
            {abortController && (
              <button
                onClick={() => {
                  abortController.abort();
                  setAbortController(null);
                  // 删除当前正在生成的消息
                  setMessages(prev => prev.filter(msg => msg.id !== message.id));
                  setIsLoading(false);
                }}
                className="mt-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg transition-colors"
              >
                <XCircle className="w-3.5 h-3.5 inline mr-1" />
                中断生成
              </button>
            )}
          </div>
        );
      }
      
      // 如果没有思考内容，显示简单的加载提示
      return (
        <div className="flex flex-col items-center justify-center py-4 px-4">
          <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-[#b0b0b0]">
            <Loader className="w-4 h-4 animate-spin" />
            <span>思考中...</span>
          </div>
          {/* 中断按钮 */}
          {abortController && (
            <button
              onClick={() => {
                abortController.abort();
                setAbortController(null);
                // 删除当前正在生成的消息
                setMessages(prev => prev.filter(msg => msg.id !== message.id));
                setIsLoading(false);
              }}
              className="mt-3 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg transition-colors"
            >
              <XCircle className="w-3.5 h-3.5 inline mr-1" />
              中断生成
            </button>
          )}
        </div>
      );
    }
    
    // 错误消息（带特殊样式）
    if (message.role === 'assistant' && message.content?.includes('❌ 错误')) {
      return (
        <div className="w-full">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm text-red-900 dark:text-red-100 whitespace-pre-wrap">
                  {message.content}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // 多模态内容显示（图片、视频、音频）- 使用缩略图画廊
    const renderMedia = () => {
      if (!message.media || message.media.length === 0) {
        return null;
      }
      
      // 转换为 MediaGallery 需要的格式
      const galleryMedia: MediaItem[] = message.media.map(m => ({
        type: m.type,
        mimeType: m.mimeType,
        data: m.data,
        url: m.url,
      }));
      
      return (
        <div className="mb-3">
          <MediaGallery 
            media={galleryMedia} 
            thumbnailSize="md"
            maxVisible={6}
            showDownload={true}
            onOpenSessionGallery={(index) => {
              // 找到在会话媒体中的索引
              const sessionIndex = findSessionMediaIndex(message.id, index);
              openSessionMediaPanel(sessionIndex);
            }}
          />
        </div>
      );
    };
    
    // 工具消息（感知组件）
    if (message.role === 'tool' && message.toolType) {
      // MCP 消息使用专门的 MCPExecutionCard 组件
      if (message.toolType === 'mcp') {
        // 获取输入文本（从上一条消息）
        const messageIndex = messages.findIndex(m => m.id === message.id);
        const prevMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;
        const inputText = prevMessage?.content || '';

        return (
          <MCPExecutionCard
            messageId={message.id}
            mcpServerName={message.workflowName || 'MCP 服务器'}
            mcpServerId={message.workflowId || ''}
            status={message.workflowStatus || 'pending'}
            content={message.content}
            inputText={inputText}
            onExecute={() => handleExecuteWorkflow(message.id)}
            onDelete={() => handleDeleteWorkflowMessage(message.id)}
          />
        );
      }

      // Workflow 消息继续使用原有的卡片
      const workflowConfig = message.workflowConfig;
      const nodes = workflowConfig?.nodes || [];
      const connections = workflowConfig?.connections || [];
      
      // 获取节点类型统计
      const nodeTypeCounts = nodes.reduce((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      return (
        <div className="w-full bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 rounded-xl p-5 border border-gray-200 dark:border-[#404040] shadow-lg">
          {/* 标题栏和删除按钮 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-gray-900 dark:bg-gray-100">
                <WorkflowIcon className="w-5 h-5 text-white dark:text-[#1e1e1e]" />
              </div>
              <div>
                <div className="font-semibold text-base text-gray-900 dark:text-[#ffffff]">
                  {message.workflowName || '工作流组件'}
                </div>
                <div className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-0.5">
                  工作流组件
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
          <div className="w-full bg-white dark:bg-[#2d2d2d] rounded-lg p-5 border-2 border-gray-200 dark:border-[#404040] mb-4 shadow-inner">
            <div className="flex items-center justify-between w-full">
              {/* 输入节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className="w-20 h-20 rounded-2xl bg-gray-900 dark:bg-gray-100 text-white dark:text-[#1e1e1e] flex items-center justify-center text-sm font-bold shadow-lg mb-3 transition-all">
                  输入
                </div>
                <div className="text-xs text-gray-600 dark:text-[#b0b0b0] text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-[#2d2d2d] rounded">
                  {(() => {
                    const messageIndex = messages.findIndex(m => m.id === message.id);
                    const prevMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;
                    return prevMessage?.content?.substring(0, 25) || '等待输入...';
                  })()}
                </div>
              </div>
              
              {/* 箭头 */}
              <ArrowRight className="w-10 h-10 text-gray-400 dark:text-[#b0b0b0] mx-3 flex-shrink-0" />
              
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
                } text-white dark:text-[#1e1e1e] flex items-center justify-center text-xs font-bold text-center px-3 mb-3 transition-all`}>
                  <div className="truncate">{message.workflowName || '工作流'}</div>
                </div>
                <div className={`text-xs font-medium px-2 py-1 rounded ${
                  message.workflowStatus === 'pending' ? 'bg-gray-100 dark:bg-[#2d2d2d] text-gray-700 dark:text-[#ffffff]' :
                  message.workflowStatus === 'running' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' :
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
              <ArrowRight className="w-10 h-10 text-gray-400 dark:text-[#b0b0b0] mx-3 flex-shrink-0" />
              
              {/* 输出节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className={`w-20 h-20 rounded-2xl ${
                  message.workflowStatus === 'completed' 
                    ? 'bg-gray-900 dark:bg-gray-100 shadow-xl' 
                    : message.workflowStatus === 'error'
                    ? 'bg-gray-600 dark:bg-gray-500 shadow-lg'
                    : 'bg-gray-300 dark:bg-[#363636] shadow-md'
                } text-white dark:text-[#1e1e1e] flex items-center justify-center text-sm font-bold mb-3 transition-all`}>
                  输出
                </div>
                <div className="text-xs text-gray-600 dark:text-[#b0b0b0] text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-[#2d2d2d] rounded">
                  {message.workflowStatus === 'completed' ? '已生成结果' :
                   message.workflowStatus === 'error' ? '执行失败' :
                   '等待输出...'}
                </div>
              </div>
            </div>
          </div>
          
          {/* 工作流内部细节（节点信息） */}
          {message.toolType === 'workflow' && nodes.length > 0 && (
            <div className="w-full bg-gray-50 dark:bg-[#363636] rounded-lg p-3 border border-gray-200 dark:border-[#404040] mb-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff] mb-2 uppercase tracking-wide">
                工作流内部结构
              </div>
              <div className="space-y-2">
                {/* 节点类型统计 */}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(nodeTypeCounts).map(([type, count]) => (
                    <div
                      key={type}
                      className="px-2.5 py-1 bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#404040] rounded text-xs text-gray-700 dark:text-[#ffffff]"
                    >
                      <span className="font-medium">{type}:</span> {count}
                    </div>
                  ))}
                </div>
                
                {/* 节点列表 */}
                <div className="mt-3 space-y-1.5">
                  <div className="text-xs font-medium text-gray-600 dark:text-[#b0b0b0] mb-1.5">
                    节点详情:
                  </div>
                  {nodes.map((node) => (
                    <div
                      key={node.id}
                      className="flex items-center space-x-2 px-2 py-1.5 bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] rounded text-xs"
                    >
                      <div className="w-2 h-2 rounded-full bg-gray-600 dark:bg-gray-400 flex-shrink-0"></div>
                      <span className="text-gray-700 dark:text-[#ffffff] font-medium">{node.type}</span>
                      {node.data.label && (
                        <span className="text-gray-500 dark:text-[#808080] truncate">- {node.data.label}</span>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* 连接信息 */}
                {connections.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-600 dark:text-[#b0b0b0] mb-1.5">
                      连接关系: {connections.length} 条
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* 执行按钮或执行结果 */}
          {message.workflowId ? (
            message.workflowStatus === 'pending' ? (
              <button
                onClick={() => handleExecuteWorkflow(message.id)}
                className="w-full bg-gray-900 dark:bg-gray-100 text-white dark:text-[#1e1e1e] hover:bg-gray-800 dark:hover:bg-gray-200 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm"
              >
                <Play className="w-4 h-4" />
                <span>开始执行</span>
              </button>
            ) : message.workflowStatus === 'running' ? (
              <div className="flex items-center justify-center space-x-2 text-gray-700 dark:text-[#ffffff] py-2.5">
                <Loader className="w-4 h-4 animate-spin" />
                <span className="text-sm font-medium">执行中...</span>
              </div>
            ) : message.workflowStatus === 'completed' || message.workflowStatus === 'error' ? (
              <div className="space-y-3">
                {/* 执行结果 */}
                <div className="bg-gray-50 dark:bg-[#363636] rounded-lg p-3 border border-gray-200 dark:border-[#404040]">
                  <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff] mb-2 uppercase tracking-wide">
                    {message.workflowStatus === 'completed' ? '执行结果' : '执行失败'}
                  </div>
                  {(() => {
                    const content = message.content || '';
                    const logMatch = content.match(/执行日志:\s*\n(.*)/s);
                    const mainContent = logMatch ? content.substring(0, logMatch.index) : content;
                    const logs = logMatch ? logMatch[1].trim().split('\n') : [];
                    
                    return (
                      <div className="space-y-3">
                        {/* 主要内容 */}
                        {mainContent && (
                          <div className="text-sm text-gray-900 dark:text-[#ffffff] whitespace-pre-wrap break-words">
                            {mainContent.trim()}
                          </div>
                        )}
                        
                        {/* 执行日志 */}
                        {logs.length > 0 && (
                          <div className="border-t border-gray-200 dark:border-[#404040] pt-3 mt-3">
                            <div className="text-xs font-semibold text-gray-600 dark:text-[#b0b0b0] mb-2">
                              执行日志
                            </div>
                            <div className="bg-gray-900 dark:bg-gray-950 text-green-400 dark:text-green-300 font-mono text-xs p-3 rounded border border-gray-700 dark:border-[#404040] max-h-64 overflow-y-auto">
                              {logs.map((log, idx) => (
                                <div key={idx} className="mb-1">
                                  {log}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                
                {/* 重新执行按钮 */}
                <button
                  onClick={() => handleExecuteWorkflow(message.id)}
                  className="w-full bg-gray-800 dark:bg-gray-200 text-white dark:text-[#1e1e1e] hover:bg-gray-700 dark:hover:bg-gray-300 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm"
                >
                  <Play className="w-4 h-4" />
                  <span>重新执行</span>
                </button>
              </div>
            ) : null
          ) : (
            <div className="text-xs text-gray-500 dark:text-[#b0b0b0] text-center py-2">
              无法执行：缺少工作流信息
            </div>
          )}
        </div>
      );
    }
    
    // 工具消息（不是感知组件）- 检查 content 是否包含 MCP 媒体
    if (message.role === 'tool' && !message.toolType && message.content && !message.toolCalls) {
      // 尝试解析 content，看是否包含 MCP 媒体格式
      const parsed = parseMCPContent(message.content);
      const hasMedia = parsed.media.length > 0;
      
      if (hasMedia) {
        return (
          <div>
            <div className="font-medium text-sm mb-2 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-green-500" />
              MCP 工具结果
            </div>
            {/* 渲染媒体内容 */}
            {renderMCPMediaForMessage(parsed.media, message.id)}
            {/* 渲染文本内容 */}
            {parsed.texts.length > 0 && (
              <div className="mt-2 text-xs text-gray-600 dark:text-[#b0b0b0]">
                <pre className="bg-white dark:bg-[#2d2d2d] p-2 rounded border text-xs overflow-auto max-h-64">
                  {parsed.texts.join('\n')}
                </pre>
              </div>
            )}
          </div>
        );
      }
    }
    
    // 普通工具调用消息（不是感知组件）
    if (message.role === 'tool' && message.toolCalls && !message.toolType) {
      return (
        <div>
          <div className="font-medium text-sm mb-2">工具调用:</div>
          {Array.isArray(message.toolCalls) && message.toolCalls.map((toolCall: any, idx: number) => {
            // 解析工具结果为有序块（支持多条 MCP 返回）
            const blocks = toolCall.result ? parseMCPContentBlocks(toolCall.result) : [];
            
            return (
              <div key={idx} className="mb-3 p-3 bg-gray-50 dark:bg-[#363636] rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <Wrench className="w-4 h-4 text-primary-500" />
                  <span className="font-medium text-sm">{toolCall.name}</span>
                </div>
                {toolCall.arguments && (
                  <div className="text-xs text-gray-600 dark:text-[#b0b0b0] mb-2">
                    <span className="font-medium">参数:</span>
                    <pre className="mt-1 bg-white dark:bg-[#2d2d2d] p-2 rounded border text-xs overflow-auto max-h-32">
                      {JSON.stringify(toolCall.arguments, null, 2)}
                    </pre>
                  </div>
                )}
                {toolCall.result && (
                  <div className="text-xs text-gray-600 dark:text-[#b0b0b0]">
                    <span className="font-medium">结果:</span>
                    {blocks.length > 0 ? (
                      <div className="mt-1">{renderMCPBlocksForMessage(blocks, message.id)}</div>
                    ) : (
                      <pre className="mt-1 bg-white dark:bg-[#2d2d2d] p-2 rounded border text-xs overflow-auto max-h-64">
                        {truncateBase64Strings(JSON.stringify(toolCall.result, null, 2))}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    const isThinkingCollapsed = collapsedThinking.has(message.id);
    const hasThinking = message.thinking && message.thinking.trim().length > 0;
    const isThinkingActive = message.isThinking && message.isStreaming; // 正在思考中

    return (
      <div>
        {hasThinking && (
          <div className="mb-2">
            {isThinkingCollapsed ? (
              // 折叠状态：显示小灯泡按钮
              <button
                onClick={() => toggleThinkingCollapse(message.id)}
                className="flex items-center space-x-1 text-[10px] text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
                title="展开思考过程"
              >
                <Lightbulb className="w-3 h-3" />
                <span>思考过程</span>
              </button>
            ) : (
              // 展开状态：显示思考内容
              <div className="mb-2">
                <button
                  onClick={() => toggleThinkingCollapse(message.id)}
                  className="flex items-center space-x-1 text-[10px] text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-gray-400 transition-colors mb-1"
                  title="折叠思考过程"
                >
                  <Lightbulb className="w-3 h-3" />
                  <span>思考过程</span>
                </button>
                <div className="text-[11px] text-gray-400 dark:text-[#808080] font-mono leading-relaxed whitespace-pre-wrap break-words bg-transparent">
                  {message.thinking}
                  {isThinkingActive && (
                    <span className="inline-block ml-1 w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse"></span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {/* 如果正在思考但还没有思考内容，显示流式思考提示 */}
        {message.isThinking && !hasThinking && (
          <div className="mb-2 text-[10px] text-gray-400 dark:text-[#808080] flex items-center space-x-1">
            <Lightbulb className="w-3 h-3 animate-pulse" />
            <span>思考中...</span>
            <span className="inline-block w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse"></span>
          </div>
        )}
        {/* 多模态内容显示 */}
        {renderMedia()}
        
        {/* AI 助手消息使用 Markdown 渲染 */}
        {message.role === 'assistant' ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-[#ffffff] markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // 代码块样式
                code: ({ node, inline, className, children, ...props }: any) => {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : '';
                  
                  if (!inline && match) {
                    // 代码块 - 使用独立的组件来处理复制状态
                    const codeText = String(children).replace(/\n$/, '');
                    const CodeBlock = () => {
                      const [copied, setCopied] = useState(false);
                      
                      return (
                        <div className="relative group my-3">
                          {/* 语言标签 */}
                          {language && (
                            <div className="absolute top-2 left-2 text-xs text-gray-400 dark:text-[#808080] font-mono bg-gray-800/50 dark:bg-[#363636] px-2 py-0.5 rounded z-10">
                              {language}
                            </div>
                          )}
                          <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-4 pt-8 overflow-x-auto border border-gray-700 dark:border-[#404040]">
                            <code className={className} {...props}>
                              {children}
                            </code>
                          </pre>
                          <button
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(codeText);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              } catch (err) {
                                console.error('Failed to copy:', err);
                              }
                            }}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-xs flex items-center space-x-1 z-10"
                            title="复制代码"
                          >
                            {copied ? (
                              <>
                                <CheckCircle className="w-3 h-3" />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <FileText className="w-3 h-3" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    };
                    
                    return <CodeBlock />;
                  } else {
                    // 行内代码
                    return (
                      <code className="bg-gray-100 dark:bg-[#2d2d2d] text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                        {children}
                      </code>
                    );
                  }
                },
                // 段落样式
                p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
                // 标题样式
                h1: ({ children }: any) => <h1 className="text-2xl font-bold mt-4 mb-3 first:mt-0">{children}</h1>,
                h2: ({ children }: any) => <h2 className="text-xl font-bold mt-4 mb-3 first:mt-0">{children}</h2>,
                h3: ({ children }: any) => <h3 className="text-lg font-bold mt-3 mb-2 first:mt-0">{children}</h3>,
                // 列表样式
                ul: ({ children }: any) => <ul className="list-disc list-inside mb-3 space-y-1 ml-4">{children}</ul>,
                ol: ({ children }: any) => <ol className="list-decimal list-inside mb-3 space-y-1 ml-4">{children}</ol>,
                li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
                // 引用样式
                blockquote: ({ children }: any) => (
                  <blockquote className="border-l-4 border-primary-500 dark:border-primary-400 pl-4 my-3 italic text-gray-700 dark:text-[#ffffff]">
                    {children}
                  </blockquote>
                ),
                // 链接样式
                a: ({ href, children }: any) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    {children}
                  </a>
                ),
                // 表格样式
                table: ({ children }: any) => (
                  <div className="overflow-x-auto my-3">
                    <table className="min-w-full border-collapse border border-gray-300 dark:border-[#404040]">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }: any) => (
                  <thead className="bg-gray-100 dark:bg-[#2d2d2d]">{children}</thead>
                ),
                tbody: ({ children }: any) => <tbody>{children}</tbody>,
                tr: ({ children }: any) => (
                  <tr className="border-b border-gray-200 dark:border-[#404040]">{children}</tr>
                ),
                th: ({ children }: any) => (
                  <th className="border border-gray-300 dark:border-[#404040] px-3 py-2 text-left font-semibold">
                    {children}
                  </th>
                ),
                td: ({ children }: any) => (
                  <td className="border border-gray-300 dark:border-[#404040] px-3 py-2">
                    {children}
                  </td>
                ),
                // 水平分割线
                hr: () => <hr className="my-4 border-gray-300 dark:border-[#404040]" />,
                // 强调样式
                strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }: any) => <em className="italic">{children}</em>,
                // 图片样式 - 使用独立组件处理状态
                img: ({ src, alt, ...props }: any) => {
                  // 如果没有 src，不渲染
                  if (!src) return null;
                  
                  // 辅助函数：检测是否为 base64 数据
                  const looksLikeBase64Payload = (s: string): boolean => {
                    if (!s) return false;
                    const trimmed = s.trim();
                    // 已经是 data URL
                    if (trimmed.startsWith('data:')) return true;
                    // 太短的不处理，避免误判普通路径
                    if (trimmed.length < 256) return false;
                    // base64 字符集（允许末尾 padding）
                    return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed);
                  };
                  
                  // 辅助函数：推断图片 MIME 类型
                  const inferImageMime = (payload: string): string => {
                    const base64 = payload.startsWith('data:') ? payload.slice(payload.indexOf(',') + 1) : payload.trim();
                    if (base64.startsWith('iVBORw')) return 'image/png';
                    if (base64.startsWith('/9j/') || base64.startsWith('9j/')) return 'image/jpeg';
                    if (base64.startsWith('R0lGOD')) return 'image/gif';
                    if (base64.startsWith('UklGR')) return 'image/webp';
                    return 'image/jpeg'; // 默认 JPEG
                  };
                  
                  // 处理图片 URL
                  let imageSrc = src;
                  
                  // 1. 已经是完整 URL（http/https/data/blob/file），直接使用
                  if (/^(https?:|data:|blob:|file:)/i.test(src)) {
                    imageSrc = src;
                  }
                  // 2. 检测是否为 base64 数据（包括以 /9j/ 开头的 JPEG base64）
                  else if (looksLikeBase64Payload(src)) {
                    const mime = inferImageMime(src);
                    imageSrc = `data:${mime};base64,${src.trim()}`;
                  }
                  // 3. 后端相对路径（以 / 开头但不是 //）
                  else if (src.startsWith('/') && !src.startsWith('//')) {
                    const backendUrl = (window as any).__cachedBackendUrl || 'http://localhost:3002';
                    imageSrc = `${backendUrl}${src}`;
                  }
                  
                  // 使用独立组件来管理状态
                  const MarkdownImage = () => {
                    const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
                    
                    return (
                      <span className="block my-3">
                        {/* 加载中状态 */}
                        {status === 'loading' && (
                          <div className="flex items-center justify-center bg-gray-100 dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040] p-4 text-gray-500 dark:text-gray-400 text-sm" style={{ minHeight: '100px' }}>
                            <div className="text-center">
                              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                              <div>加载中...</div>
                            </div>
                          </div>
                        )}
                        
                        {/* 加载失败状态 */}
                        {status === 'error' && (
                          <div className="flex items-center justify-center bg-gray-100 dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040] p-4 text-gray-500 dark:text-gray-400 text-sm" style={{ minHeight: '100px' }}>
                            <div className="text-center">
                              <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              <div className="mb-1">图片加载失败</div>
                              <div className="text-xs text-gray-400 mb-2">{alt || '未知图片'}</div>
                              <a 
                                href={imageSrc} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="text-xs text-primary-500 hover:underline"
                              >
                                查看原链接
                              </a>
                            </div>
                          </div>
                        )}
                        
                        {/* 图片 - 隐藏直到加载完成 */}
                        <img
                          src={imageSrc}
                          alt={alt || '图片'}
                          loading="lazy"
                          className={`max-w-full h-auto rounded-lg border border-gray-200 dark:border-[#404040] cursor-pointer hover:opacity-90 transition-opacity ${status !== 'loaded' ? 'hidden' : ''}`}
                          style={{ maxHeight: '400px', objectFit: 'contain' }}
                          onLoad={() => setStatus('loaded')}
                          onError={() => setStatus('error')}
                          onClick={() => {
                            // 点击图片在新窗口预览
                            const win = window.open('', '_blank');
                            if (win) {
                              win.document.write(`
                                <html>
                                  <head><title>${alt || '图片预览'}</title></head>
                                  <body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#000">
                                    <img src="${imageSrc}" style="max-width:100%;max-height:100vh;object-fit:contain;" alt="${alt || '图片'}" />
                                  </body>
                                </html>
                              `);
                            }
                          }}
                          {...props}
                        />
                      </span>
                    );
                  };
                  
                  return <MarkdownImage />;
                },
              }}
            >
              {truncateBase64Strings(message.content)}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words text-gray-900 dark:text-[#ffffff]">
            {truncateBase64Strings(message.content)}
          </div>
        )}
      </div>
    );
  };

  // 统计可用工具数量
  const totalTools = Array.from(mcpTools.values()).flat().length;

  const switchSessionFromPersona = (sessionId: string) => {
    setShowPersonaPanel(false);
    // 优先交给上层（保证 SessionSidebar 与 URL 状态一致），否则 fallback 到组件内切换
    if (onSelectSession) {
      onSelectSession(sessionId);
    } else {
      handleSelectSession(sessionId);
    }
  };

  const openMeetingFromPersona = (roundTableId: string) => {
    setShowPersonaPanel(false);
    onSelectMeeting?.(roundTableId);
  };

  const openResearchFromPersona = (researchSessionId: string) => {
    setShowPersonaPanel(false);
    onSelectResearch?.(researchSessionId);
  };

  useEffect(() => {
    if (!showPersonaPanel) return;
    let canceled = false;
    (async () => {
      try {
        setIsLoadingPersonaList(true);
        const [agents, meetings, allSessions] = await Promise.all([
          getAgents(),
          getRoundTables(),
          getSessions(),
        ]);
        if (canceled) return;
        setPersonaAgents(agents || []);
        setPersonaMeetings(meetings || []);
        const researchSessions = (allSessions || []).filter((s) => s.session_type === 'research');
        setPersonaResearchSessions(researchSessions);
      } catch (error) {
        console.error('[Workflow] Failed to load persona list:', error);
        if (canceled) return;
        setPersonaAgents([]);
        setPersonaMeetings([]);
        setPersonaResearchSessions([]);
      } finally {
        if (!canceled) setIsLoadingPersonaList(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [showPersonaPanel]);

  // 新建 Meeting
  const handleCreateNewMeeting = async () => {
    if (!newMeetingName.trim()) {
      toast({ title: '请输入会议名称', variant: 'destructive' });
      return;
    }
    setIsCreatingMeeting(true);
    try {
      const newMeeting = await createRoundTable(newMeetingName.trim());
      toast({ title: '会议已创建', variant: 'success' });
      setShowNewMeetingDialog(false);
      setNewMeetingName('');
      setShowPersonaPanel(false);
      // 切换到新创建的会议
      openMeetingFromPersona(newMeeting.round_table_id);
    } catch (error) {
      console.error('[Workflow] Failed to create meeting:', error);
      toast({ 
        title: '创建失败', 
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setIsCreatingMeeting(false);
    }
  };

  // 新建 Research
  const handleCreateNewResearch = async () => {
    if (!newResearchName.trim()) {
      toast({ title: '请输入研究任务名称', variant: 'destructive' });
      return;
    }
    setIsCreatingResearch(true);
    try {
      const newSession = await createSession(undefined, newResearchName.trim(), 'research');
      toast({ title: '研究任务已创建', variant: 'success' });
      setShowNewResearchDialog(false);
      setNewResearchName('');
      setShowPersonaPanel(false);
      // 切换到新创建的研究任务
      openResearchFromPersona(newSession.session_id);
    } catch (error) {
      console.error('[Workflow] Failed to create research:', error);
      toast({ 
        title: '创建失败', 
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive'
      });
    } finally {
      setIsCreatingResearch(false);
    }
  };

  return (
    <>
    <div className="h-full flex flex-col bg-gray-50 dark:bg-[#1a1a1a]">

      {/* 主要内容区域：聊天界面 - GNOME 风格布局 */}
      <div className="flex-1 flex min-h-0 p-2 gap-2">
        {/* 左侧配置面板 - 已隐藏，功能移至底部工具栏 */}
        {/* 聊天界面 - 全屏布局（主界面无外边框/无外边距） */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-white dark:bg-[#2d2d2d] overflow-hidden">
        {/* 状态栏 - 优化样式 */}
          <div className="border-b border-gray-200 dark:border-[#404040] px-3 py-1 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              {/* 头像 - 可点击配置 */}
              <div 
                className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary-400 hover:ring-offset-1 transition-all overflow-hidden"
                onClick={async () => {
                  if (currentSessionId && !isTemporarySession) {
                    // 从当前会话获取数据
                    let currentSession =
                      sessions.find(s => s.session_id === currentSessionId) ||
                      (currentSessionMeta?.session_id === currentSessionId ? currentSessionMeta : null);
                    if (!currentSession) {
                      try {
                        currentSession = await getSession(currentSessionId);
                        setCurrentSessionMeta(currentSession);
                      } catch (error) {
                        console.warn('[Workflow] Failed to load session for header config:', currentSessionId, error);
                      }
                    }
                    if (currentSession) {
                      setHeaderConfigEditName(currentSession.name || '');
                      setHeaderConfigEditAvatar(currentSession.avatar || null);
                      setHeaderConfigEditSystemPrompt(currentSession.system_prompt || '');
                      setHeaderConfigEditMediaOutputPath(currentSession.media_output_path || '');
                      setHeaderConfigEditLlmConfigId(currentSession.llm_config_id || null);
                      setHeaderConfigActiveTab('basic');
                      setShowHeaderConfigDialog(true);
                    }
                  }
                }}
                title={currentSessionId && !isTemporarySession ? "点击配置会话" : "请先选择或创建会话"}
              >
                {currentSessionAvatar ? (
                  <img src={currentSessionAvatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <Bot className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                )}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-gray-900 dark:text-[#ffffff] leading-tight truncate min-w-0">
                  {(() => {
                    const currentSession =
                      sessions.find(s => s.session_id === currentSessionId) ||
                      (currentSessionMeta?.session_id === currentSessionId ? currentSessionMeta : null);
                    if (isTemporarySession) return '临时会话';
                    if (currentSession?.name) return currentSession.name;
                    if (currentSession?.session_type === 'agent') return '智能体';
                    return 'AI 工作流助手';
                  })()}
                </span>
              </div>
              
            </div>
            <div className="flex items-center space-x-2">
              {/* 模型选择和流式开关 - 右对齐 */}
              <div className="flex items-center space-x-2">
                {/* 模型选择 = 当前模型展示（统一 label，避免不一致） */}
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-gray-200 dark:border-[#404040] bg-white/80 dark:bg-[#2d2d2d]/60">
                  {selectedLLMConfig ? (
                    <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  )}
                  <Brain className="w-3 h-3 text-gray-600 dark:text-[#b0b0b0]" />
                  <select
                    value={selectedLLMConfigId || ''}
                    onChange={(e) => {
                      console.log('[Workflow] Select onChange:', e.target.value);
                      handleLLMConfigChange(e.target.value);
                    }}
                    className="bg-transparent text-[10px] min-w-[160px] max-w-[220px] h-6 outline-none"
                    title={selectedLLMConfig ? `${selectedLLMConfig.name}${selectedLLMConfig.model ? ` (${selectedLLMConfig.model})` : ''}` : '未配置'}
                  >
                    <option value="">{'未配置'}</option>
                    {llmConfigs.map((config) => {
                      const label = `${config.name}${config.model ? ` (${config.model})` : ''}`;
                      return (
                        <option key={config.config_id} value={config.config_id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
                {/* 流式响应开关 */}
                <label className="flex items-center space-x-1 cursor-pointer group px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors">
                  <input
                    type="checkbox"
                    checked={streamEnabled}
                    onChange={(e) => setStreamEnabled(e.target.checked)}
                    className="w-3 h-3 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-[10px] text-gray-600 dark:text-[#b0b0b0]">流式</span>
                </label>
              </div>
              
              {/* 创建技能包按钮 */}
              {currentSessionId && messages.filter(m => m.role !== 'system').length > 0 && (
                <Button
                  onClick={() => {
                    setSkillPackSelectionMode(!skillPackSelectionMode);
                    if (skillPackSelectionMode) {
                      setSelectedMessageIds(new Set());
                    }
                  }}
                  variant={skillPackSelectionMode ? 'primary' : 'secondary'}
                  size="sm"
                  title="创建技能包"
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>{skillPackSelectionMode ? '取消' : '技能包'}</span>
                </Button>
              )}
              {/* Summarize 按钮 */}
              {currentSessionId && messages.filter(m => m.role !== 'system').length > 0 && (
                <Button
                  onClick={handleManualSummarize}
                  disabled={isSummarizing}
                  variant="primary"
                  size="sm"
                  title="总结当前会话内容"
                >
                  {isSummarizing ? (
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>总结</span>
                </Button>
              )}
                </div>
          </div>
        </div>

        {/* 消息列表 - 正常顺序显示（老消息在上，新消息在下） - 优化布局 */}
          <div 
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto hide-scrollbar px-3 py-2 space-y-6 relative bg-gray-50/50 dark:bg-gray-950/50"
            style={{ scrollBehavior: 'auto', paddingBottom: floatingComposerPadding }}
            onScroll={(e) => {
              const container = e.currentTarget;
              const scrollTop = container.scrollTop;
              const atBottom = shouldAutoScroll();
              wasAtBottomRef.current = atBottom;
              
              // 检测用户是否在滚动（排除程序控制的滚动）
              if (!isLoadingMoreRef.current) {
                isUserScrollingRef.current = true;
                // 500ms 后重置，认为用户停止滚动
                setTimeout(() => {
                  isUserScrollingRef.current = false;
                }, 500);
              }
              
              // 滚动到顶部附近时，自动加载更多历史消息（历史消息在上方）
              if (scrollTop < 150 && hasMoreMessages && !isLoadingMessages && !isLoadingMoreRef.current) {
                loadSessionMessages(currentSessionId!, messagePage + 1);
              }
              
              // 用户滚动到底部时，隐藏新消息提示（最新消息在底部）
              if (atBottom) {
                setShowNewMessagePrompt(false);
                setUnreadMessageCount(0);
              }
            }}
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
          {/* 加载更多历史消息提示（固定在顶部，历史消息在上方） */}
          {hasMoreMessages && (
            <div className="sticky top-0 z-10 flex justify-center mb-2 pointer-events-none">
              <div className="bg-white/95 dark:bg-[#2d2d2d]/95 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border border-gray-200 dark:border-[#404040] pointer-events-auto">
                {isLoadingMessages ? (
                  <div className="flex items-center space-x-2 text-xs text-gray-600 dark:text-[#b0b0b0]">
                    <Loader className="w-3 h-3 animate-spin" />
                    <span>加载历史消息...</span>
                  </div>
                ) : (
                  <button
                    onClick={() => loadSessionMessages(currentSessionId!, messagePage + 1)}
                    className="flex items-center space-x-2 text-xs text-gray-600 dark:text-[#b0b0b0] hover:text-gray-900 dark:hover:text-[#cccccc] transition-colors"
                  >
                    <ChevronUp className="w-3 h-3" />
                    <span>加载更多</span>
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* 新消息提示（固定在底部，最新消息在底部） */}
          {showNewMessagePrompt && unreadMessageCount > 0 && (
            <div className="sticky bottom-4 z-10 flex justify-center pointer-events-none">
              <button
                onClick={() => {
                  scrollToBottom('auto');
                  setShowNewMessagePrompt(false);
                  setUnreadMessageCount(0);
                }}
                className="bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center space-x-2 text-sm font-medium transition-all pointer-events-auto hover:scale-105"
              >
                <ChevronDown className="w-4 h-4" />
                <span>
                  {unreadMessageCount === 1 ? '1 条新消息' : `${unreadMessageCount} 条新消息`}
                </span>
              </button>
            </div>
          )}
          {messages.filter(msg => {
            // 过滤掉总结消息和系统提示词消息（系统提示词消息已在输入框上方显示）
            if (msg.isSummary) return false;
            if (msg.role === 'system' && 
                msg.toolCalls && 
                typeof msg.toolCalls === 'object' &&
                (msg.toolCalls as any).isSystemPrompt === true) {
              return false; // 不显示系统提示词消息
            }
            return true;
          }).map((message) => {
            // 如果是总结提示消息，使用特殊的居中显示样式
            const isSummaryNotification = message.role === 'system' && 
              (message.content.includes('总结完成') || message.content.includes('已精简为'));
            
            if (isSummaryNotification) {
              return (
                <div key={message.id} data-message-id={message.id} className="flex justify-center my-2">
                  <div className="text-xs text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5 bg-gray-100 dark:bg-[#2d2d2d] rounded-full">
                    {message.content}
                  </div>
                </div>
              );
            }
            
            const isSelected = selectedMessageIds.has(message.id);
            
            // 检查 assistant 消息是否有侧边面板内容（思考过程、MCP详情等）
            const hasThinkingContent = message.thinking && message.thinking.trim().length > 0;
            const hasMCPDetail = !!message.mcpdetail && (() => {
              const anyDetail = message.mcpdetail as any;
              if (Array.isArray(anyDetail?.tool_calls) && anyDetail.tool_calls.length > 0) return true;
              if (Array.isArray(anyDetail?.tool_results) && anyDetail.tool_results.length > 0) return true;
              if (anyDetail?.raw_result) return true;
              if (Array.isArray(anyDetail?.logs) && anyDetail.logs.length > 0) return true;
              if (anyDetail?.status) return true;
              return false;
            })();
            const hasToolCallsArray = message.toolCalls && Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
            const hasProcessSteps = message.processSteps && message.processSteps.length > 0;
            const shouldUseSplitView = message.role === 'assistant' && (
              hasThinkingContent || 
              hasMCPDetail || 
              hasToolCallsArray ||
              hasProcessSteps ||
              message.isThinking ||
              message.currentStep ||
              message.thoughtSignature
            );
            
            // 对于 assistant 消息且有侧边面板内容，使用 SplitViewMessage 组件
            if (shouldUseSplitView) {
              return (
                <SplitViewMessage
                  key={message.id}
                  id={message.id}
                  role={message.role}
                  content={message.content}
                  thinking={message.thinking}
                  isThinking={message.isThinking}
                  isStreaming={message.isStreaming}
                  currentStep={message.currentStep}
                  toolType={message.toolType}
                  workflowId={message.workflowId}
                  workflowName={message.workflowName}
                  workflowStatus={message.workflowStatus}
                  workflowResult={message.workflowResult}
                  workflowConfig={message.workflowConfig}
                  toolCalls={Array.isArray(message.toolCalls) ? message.toolCalls : undefined}
                  mcpDetail={message.mcpdetail}
                  thoughtSignature={message.thoughtSignature}
                  media={message.media}
                  avatarUrl={currentSessionAvatar || undefined}
                  isSelected={isSelected}
                  selectionMode={skillPackSelectionMode}
                  isLoading={isLoading}
                  llmProvider={selectedLLMConfig?.provider}
                  renderContent={renderMessageContent}
                  onToggleSelection={() => toggleMessageSelection(message.id)}
                  onViewMCPDetail={() => {
                    setSelectedMCPDetail(message.mcpdetail);
                    setShowMCPDetailOverlay(true);
                  }}
                  onRetry={() => handleRetryMessage(message.id)}
                  processSteps={message.processSteps}
                />
              );
            }
            
            // 其他消息类型使用统一消息组件渲染
            return (
            <div
              key={message.id}
              data-message-id={message.id}
              onClick={() => toggleMessageSelection(message.id)}
              className={`flex items-start space-x-2 fade-in-up stagger-item ${
                message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
              } ${
                skillPackSelectionMode 
                  ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#404040] rounded-lg p-2 -m-2 transition-all duration-200' 
                  : ''
              } ${
                isSelected && skillPackSelectionMode
                  ? 'bg-primary-50 dark:bg-primary-900/20 ring-2 ring-primary-300 dark:ring-primary-700 rounded-lg p-2 -m-2' 
                  : ''
              }`}
            >
              {/* 选择复选框（仅在选择模式下显示） */}
              {skillPackSelectionMode && (
                <div className={`flex-shrink-0 mt-0.5 ${message.role === 'user' ? 'ml-1.5' : 'mr-1.5'}`}>
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-primary-500" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-400" />
                  )}
                </div>
              )}
              <div className="flex-shrink-0 flex items-center space-x-1.5">
                {/* 统一头像组件 */}
                <MessageAvatar 
                  role={message.role}
                  avatarUrl={message.role === 'assistant' ? currentSessionAvatar || undefined : undefined}
                  toolType={message.toolType}
                />
                {/* 统一状态指示器组件 */}
                {message.role === 'assistant' && (
                  <MessageStatusIndicator
                    isThinking={message.isThinking}
                    isStreaming={message.isStreaming}
                    hasContent={!!message.content && message.content.length > 0}
                    currentStep={message.currentStep}
                    llmProvider={selectedLLMConfig?.provider}
                  />
                )}
              </div>
              <div className={`flex-1 group relative ${message.role === 'user' ? 'flex justify-end' : ''}`}>
                {/* 统一消息气泡容器 */}
                <MessageBubbleContainer
                  role={message.role}
                  toolType={message.toolType}
                  className="max-w-[85%]"
                >
                  {renderMessageContent(message)}
                </MessageBubbleContainer>
                {/* 会话扩展面板：展示 MCP/Workflow 等外部插件的执行过程与原始返回（含多媒体） */}
                {message.role === 'tool' && (message.toolType === 'mcp' || message.toolType === 'workflow') && (
                  <PluginExecutionPanel
                    messageId={message.id}
                    sessionId={currentSessionId}
                    toolType={message.toolType}
                  />
                )}
                {/* 用户消息的编辑、重新发送和引用按钮 - 显示在气泡上方 */}
                {message.role === 'user' && !isLoading && (
                  <div className="absolute -top-7 right-0 flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-[#2d2d2d] rounded-lg shadow-md border border-gray-200 dark:border-[#404040] px-1 py-0.5">
                    <button
                      onClick={() => setQuotedMessageId(message.id)}
                      className="p-1.5 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-all"
                      title="引用此消息"
                    >
                      <Quote className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleStartEdit(message.id)}
                      className="p-1.5 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-all"
                      title="编辑消息"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleResendMessage(message.id)}
                      className="p-1.5 text-gray-500 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-all"
                      title="重新发送"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                
                {/* Assistant消息的 MCP 详情按钮 - 显示在气泡上方 */}
                {message.role === 'assistant' && message.mcpdetail && (
                  <div className="absolute -top-7 right-0 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setSelectedMCPDetail(message.mcpdetail);
                        setShowMCPDetailOverlay(true);
                      }}
                      className="px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-white dark:bg-[#2d2d2d] hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-all flex items-center space-x-1.5 border border-gray-200 dark:border-[#404040] shadow-md"
                      title="查看 MCP 详情"
                    >
                      <Plug className="w-3.5 h-3.5" />
                      <span>MCP 详情</span>
                    </button>
                  </div>
                )}
                
                {/* Assistant错误消息的重试按钮 - 显示在气泡上方 */}
                {message.role === 'assistant' && 
                 message.content?.includes('❌ 错误') && 
                 message.toolCalls && 
                 typeof message.toolCalls === 'object' &&
                 (message.toolCalls as any).canRetry === true && (
                  <div className="absolute -top-8 right-0 flex items-center space-x-1">
                    <button
                      onClick={() => handleRetryMessage(message.id)}
                      disabled={isLoading}
                      className="px-2.5 py-1 text-xs font-medium text-white bg-primary-500 hover:bg-primary-600 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg transition-all flex items-center space-x-1.5 shadow-md"
                      title="重试发送"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>重试</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
            );
          })}
          <div ref={messagesEndRef} />
          
          {/* 技能包选择确认栏 */}
          {skillPackSelectionMode && (
            <div className="sticky bottom-0 bg-white dark:bg-[#2d2d2d] border-t border-gray-200 dark:border-[#404040] p-3 flex items-center justify-between shadow-lg">
              <div className="flex items-center space-x-2">
                <Package className="w-5 h-5 text-primary-500" />
                <span className="text-sm text-gray-700 dark:text-[#ffffff]">
                  已选择 {selectedMessageIds.size} 条消息
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    setSkillPackSelectionMode(false);
                    setSelectedMessageIds(new Set());
                  }}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-[#b0b0b0] hover:text-gray-900 dark:hover:text-[#cccccc]"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateSkillPack}
                  disabled={selectedMessageIds.size === 0 || isCreatingSkillPack || !selectedLLMConfigId}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center space-x-2"
                >
                  {isCreatingSkillPack ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      <span>创建中...</span>
                    </>
                  ) : (
                    <>
                      <Package className="w-4 h-4" />
                      <span>创建技能包</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 输入框（浮岛悬浮） */}
          <div className="absolute left-0 right-0 bottom-0 z-20 pointer-events-none">
          <div 
            ref={floatingComposerRef}
            className={`pointer-events-auto rounded-2xl bg-white/35 dark:bg-[#262626]/35 backdrop-blur-md shadow-xl p-0 relative transition-colors ${
              isDraggingOver ? 'ring-2 ring-primary-400/30' : ''
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={(e) => {
              // 点击输入框区域外部时关闭选择器（但不包括选择器本身）
              const target = e.target as HTMLElement;
              if ((showAtSelector || showModuleSelector) && !target.closest('.at-selector-container') && !target.closest('textarea')) {
                setShowAtSelector(false);
              }
            }}
          >
            {/* 拖拽提示 */}
            {isDraggingOver && (
              <div className="absolute inset-0 flex items-center justify-center bg-primary-100/50 dark:bg-primary-900/30 rounded-lg z-10 pointer-events-none">
                <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 font-medium">
                  <Paperclip className="w-5 h-5" />
                  <span>松开以添加媒体文件</span>
                </div>
              </div>
            )}
          {/* 已选定的组件 tag */}
          {selectedComponents.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedComponents.map((component, index) => (
                <div
                  key={`${component.type}-${component.id}-${index}`}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-[#ffffff] rounded-md text-sm border border-gray-200 dark:border-[#404040]"
                >
                  {component.type === 'workflow' ? (
                    <WorkflowIcon className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                  ) : component.type === 'skillpack' ? (
                    <Package className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  ) : (
                    <Plug className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                  )}
                  <span className="font-medium">{component.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveComponent(index);
                    }}
                    className="ml-1 text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-[#cccccc] transition-colors flex-shrink-0"
                    title="删除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* 显示待处理的批次数据项（选择操作） */}
          {pendingBatchItem && (
            <div className="mb-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <Database className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                      📋 已选择: {pendingBatchItem.batchName}
                    </span>
                  </div>
                  {pendingBatchItem.item.title && (
                    <div className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">
                      {pendingBatchItem.item.title}
                    </div>
                  )}
                  {pendingBatchItem.item.content && (
                    <div className="text-xs text-gray-600 dark:text-[#b0b0b0] line-clamp-2 mt-1">
                      {pendingBatchItem.item.content.length > 150 
                        ? pendingBatchItem.item.content.substring(0, 150) + '...' 
                        : pendingBatchItem.item.content}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setPendingBatchItem(null)}
                  className="ml-2 p-1 text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 transition-colors flex-shrink-0"
                  title="取消"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSetAsSystemPrompt}
                  className="flex-1 px-3 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center space-x-2"
                >
                  <Brain className="w-4 h-4" />
                  <span>🤖 设置为系统提示词</span>
                </button>
                <button
                  onClick={handleInsertAsMessage}
                  className="flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center space-x-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>💬 作为对话内容</span>
                </button>
              </div>
            </div>
          )}
          
          {/* 显示选定的批次数据项（系统提示词） */}
          {selectedBatchItem && (
            <div className="mb-2 p-3 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <Database className="w-4 h-4 text-primary-600 dark:text-primary-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-primary-900 dark:text-primary-100">
                      🤖 机器人人设: {selectedBatchItem.batchName}
                    </span>
                  </div>
                  {selectedBatchItem.item.title && (
                    <div className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">
                      {selectedBatchItem.item.title}
                    </div>
                  )}
                  {selectedBatchItem.item.content && (
                    <div className="text-xs text-gray-600 dark:text-[#b0b0b0] line-clamp-2 mt-1">
                      {selectedBatchItem.item.content.length > 150 
                        ? selectedBatchItem.item.content.substring(0, 150) + '...' 
                        : selectedBatchItem.item.content}
                    </div>
                  )}
                </div>
                <button
                  onClick={async () => {
                    // 清除选定的批次数据项
                    setSelectedBatchItem(null);
                    
                    // 如果有会话，删除系统提示词消息
                    if (currentSessionId) {
                      const systemPromptMessage = messages.find(m => 
                        m.role === 'system' && 
                        m.toolCalls && 
                        typeof m.toolCalls === 'object' &&
                        (m.toolCalls as any).isSystemPrompt === true
                      );
                      
                      if (systemPromptMessage) {
                        try {
                          await deleteMessage(currentSessionId, systemPromptMessage.id);
                          setMessages(prev => prev.filter(m => m.id !== systemPromptMessage.id));
                          console.log('[Workflow] Deleted system prompt message');
                        } catch (error) {
                          console.error('[Workflow] Failed to delete system prompt message:', error);
                        }
                      }
                    }
                  }}
                  className="ml-2 p-1 text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 transition-colors flex-shrink-0"
                  title="取消选择"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 text-xs text-primary-600 dark:text-primary-400">
                💡 此数据已保存为系统提示词，将作为机器人人设持续生效
              </div>
            </div>
          )}
          

          {/* 引用消息显示 */}
          {quotedMessageId && (() => {
            const quotedMsg = messages.find(m => m.id === quotedMessageId);
            if (!quotedMsg) return null;
            return (
              <div className="mb-2 p-2 bg-gray-50 dark:bg-[#2d2d2d] border-l-4 border-primary-500 rounded-r-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-500 dark:text-[#b0b0b0] mb-1">引用消息</div>
                    <div className="text-sm text-gray-700 dark:text-[#ffffff] line-clamp-2">
                      {quotedMsg.content.substring(0, 100)}{quotedMsg.content.length > 100 ? '...' : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => setQuotedMessageId(null)}
                    className="ml-2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })()}

          <div className="flex space-x-2">
            {/* 附件预览区域 - 缩略图画廊样式 */}
            {attachedMedia.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachedMedia.map((media, index) => (
                  <div key={index} className="relative group">
                    {media.type === 'image' ? (
                      <div className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-[#404040] hover:border-primary-500 dark:hover:border-primary-500 transition-all hover:scale-105">
                        <img
                          src={media.preview || `data:${media.mimeType};base64,${media.data}`}
                          alt={`附件 ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : media.type === 'video' ? (
                      <div className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-[#404040] hover:border-primary-500 dark:hover:border-primary-500 transition-all hover:scale-105 relative bg-gray-900">
                        <video
                          src={media.preview || `data:${media.mimeType};base64,${media.data}`}
                          className="w-full h-full object-cover"
                          muted
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <div className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center">
                            <Play className="w-3 h-3 text-gray-800 ml-0.5" />
                          </div>
                        </div>
                      </div>
                    ) : media.type === 'audio' ? (
                      <div className="w-16 h-16 flex items-center justify-center rounded-lg border border-gray-200 dark:border-[#404040] hover:border-primary-500 dark:hover:border-primary-500 transition-all hover:scale-105 bg-gradient-to-br from-primary-500 to-primary-700">
                        <Music className="w-6 h-6 text-white/80" />
                      </div>
                    ) : null}
                    <button
                      onClick={() => {
                        setAttachedMedia(prev => prev.filter((_, i) => i !== index));
                      }}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                      title="删除附件"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div
               className={`flex-1 relative at-selector-container rounded-xl bg-transparent transition-shadow ${
                isInputFocused ? 'shadow-lg ring-1 ring-[var(--color-accent)]/20' : 'shadow-sm'
              }`}
            >
              {/* 输入框扩大按钮 - 当输入框聚焦时显示 */}
              {isInputFocused && (
                <button
                  onMouseDown={(e) => {
                    // Prevent textarea blur so click still toggles expand.
                    e.preventDefault();
                  }}
                  onClick={() => setIsInputExpanded(!isInputExpanded)}
                  className="absolute -top-8 left-1/2 transform -translate-x-1/2 z-10 p-1.5 bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] rounded-lg shadow-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                  title={isInputExpanded ? "缩小输入框" : "扩大输入框"}
                >
                  <ChevronUp className={`w-4 h-4 text-gray-600 dark:text-[#b0b0b0] transition-transform ${isInputExpanded ? 'rotate-180' : ''}`} />
                </button>
              )}
              
              {/* 工具 Tag（上方摆放）：帮助 + MCP/Workflow/技能包/附件 + 人设 + Thinking */}
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white/45 dark:bg-[#262626]/45 backdrop-blur-md border-b border-black/5 dark:border-white/10 rounded-t-xl">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  {/* 帮助问号图标 */}
                  <div className="relative flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowHelpTooltip(!showHelpTooltip)}
                      className="w-5 h-5 rounded-full bg-gray-400 hover:bg-gray-500 dark:bg-gray-600 dark:hover:bg-gray-500 text-white flex items-center justify-center transition-colors"
                      title="查看帮助"
                    >
                      <HelpCircle className="w-3 h-3" />
                    </button>
                    {/* 帮助提示弹窗 */}
                    {showHelpTooltip && (
                      <>
                        {/* 点击外部区域关闭 */}
                        <div className="fixed inset-0 z-10" onClick={() => setShowHelpTooltip(false)} />
                        <div className="absolute bottom-full left-0 mb-2 w-80 p-3 bg-white dark:bg-[#2d2d2d] rounded-lg shadow-lg border border-gray-200 dark:border-[#404040] z-20">
                          <div className="text-xs text-gray-700 dark:text-[#ffffff] space-y-1">
                            {!selectedLLMConfig ? (
                              <p>请先选择 LLM 模型</p>
                            ) : selectedComponents.length > 0 ? (
                              <p>
                                已选择感知组件：<span className="font-medium">{selectedComponents[0].name}</span>。如需更换，请先删除当前组件，然后使用 @ 选择新的组件。
                              </p>
                            ) : selectedMcpServerIds.size > 0 ? (
                              <p>
                                提示：我可以使用 {totalTools} 个 MCP 工具帮助你完成任务，例如<span className="font-medium">"发布内容"</span>、<span className="font-medium">"查询信息"</span>等。使用 @ 可以选择感知组件。
                              </p>
                            ) : (
                              <p>提示：你可以直接与我对话，我会尽力帮助你。如果需要使用工具，请在 MCP 服务器中选择至少一个服务器，或使用 @ 选择感知组件。</p>
                            )}
                          </div>
                          <button
                            onClick={() => setShowHelpTooltip(false)}
                            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <ComponentThumbnails
                    mcpServers={mcpServers}
                    workflows={workflows}
                    skillPacks={allSkillPacks}
                    selectedMcpServerIds={selectedMcpServerIds}
                    selectedWorkflowIds={selectedWorkflowIds}
                    selectedSkillPackIds={selectedSkillPackIds}
                    connectedMcpServerIds={connectedMcpServerIds}
                    connectingMcpServerIds={connectingServers}
                    onSelectMCP={handleSelectMCPFromThumbnail}
                    onDeselectMCP={handleDeselectMCPFromThumbnail}
                    onConnectMCP={handleConnectServer}
                    onSelectWorkflow={handleSelectWorkflowFromThumbnail}
                    onDeselectWorkflow={handleDeselectWorkflowFromThumbnail}
                    onSelectSkillPack={handleSelectSkillPackFromThumbnail}
                    onDeselectSkillPack={handleDeselectSkillPackFromThumbnail}
                    onAttachFile={handleAttachFile}
                  />

                  {/* 人设按钮 */}
                  {currentSessionId && (
                    <button
                      onClick={() => {
                        setSystemPromptDraft(currentSystemPrompt || '');
                        setIsEditingSystemPrompt(true);
                      }}
                      className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] transition-all ${
                        currentSystemPrompt
                          ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium'
                          : 'text-gray-400 dark:text-[#808080] hover:text-gray-500 dark:hover:text-gray-400'
                      }`}
                      title={currentSystemPrompt ? `人设: ${currentSystemPrompt.length > 50 ? currentSystemPrompt.slice(0, 50) + '...' : currentSystemPrompt}` : '点击设置人设'}
                    >
                      <FileText className="w-3 h-3 flex-shrink-0" />
                      <span>人设</span>
                    </button>
                  )}

                  {/* Thinking 模式显示（仅显示，不允许切换） */}
                  {selectedLLMConfig && (() => {
                    const enableThinking = selectedLLMConfig.metadata?.enableThinking ?? false;
                    return (
                      <div
                        className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] transition-all ${
                          enableThinking
                            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium'
                            : 'text-gray-400 dark:text-[#808080]'
                        }`}
                        title={enableThinking ? '深度思考模式（在模型配置中启用）' : '普通模式（在模型配置中禁用）'}
                      >
                        <Brain className="w-3 h-3" />
                        <span>{enableThinking ? '深度思考' : '普通'}</span>
                        {enableThinking && <span className="w-1 h-1 bg-primary-500 rounded-full animate-pulse"></span>}
                      </div>
                    );
                  })()}
                </div>
              </div>

            <textarea
                ref={inputRef}
              value={input}
                onChange={handleInputChange}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              
              onFocus={() => {
                setIsInputFocused(true);
                // 保留原有的focus处理逻辑
                if (inputRef.current) {
                  const value = inputRef.current.value;
                  const cursorPosition = inputRef.current.selectionStart || 0;
                  const textBeforeCursor = value.substring(0, cursorPosition);
                  const lastAtIndex = textBeforeCursor.lastIndexOf('@');
                  
                  if (lastAtIndex !== -1) {
                    const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
                    const hasSpaceOrNewline = textAfterAt.includes(' ') || textAfterAt.includes('\n');
                    
                    if (!hasSpaceOrNewline && selectedComponents.length === 0) {
                      // 触发位置重新计算
                      handleInputChange({ target: inputRef.current } as React.ChangeEvent<HTMLTextAreaElement>);
                    }
                  }
                }
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
                      
                      console.log('[Workflow] 已粘贴图片:', mimeType, '大小:', Math.round(base64Data.length / 1024), 'KB');
                    };
                    reader.readAsDataURL(file);
                  });
                }
              }}
                onKeyDown={(e) => {
                  // Send/newline handling (runs before selector navigation).
                  handleKeyPress(e);
                  if (e.defaultPrevented) return;
                  // 如果批次数据项选择器显示，不处理键盘事件（由 CrawlerBatchItemSelector 处理）
                  if (showBatchItemSelector) {
                    return;
                  }
                  
                  // 如果模块选择器显示，不处理键盘事件（由 CrawlerModuleSelector 处理）
                  if (showModuleSelector) {
                    return;
                  }
                  
                  // 如果@选择器显示，处理上下箭头和回车
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
                  setIsInputFocused(false);
                  // 如果批次数据项选择器显示，不处理blur（由组件自己处理）
                  if (showBatchItemSelector) {
                    return;
                  }
                  
                  // 如果模块选择器显示，不处理blur（由组件自己处理）
                  if (showModuleSelector) {
                    return;
                  }
                  
                  // 如果选择器未显示，不需要处理
                  if (!showAtSelector) {
                    return;
                  }
                  
                  // 清除之前的定时器
                  if (blurTimeoutRef.current) {
                    clearTimeout(blurTimeoutRef.current);
                    blurTimeoutRef.current = null;
                  }
                  
                  // 延迟关闭，以便点击选择器时不会立即关闭
                  blurTimeoutRef.current = setTimeout(() => {
                    // 检查当前焦点是否在选择器或其子元素上
                    const activeElement = document.activeElement;
                    const isFocusInSelector = activeElement?.closest('.at-selector-container');
                    
                    // 检查选择器元素是否仍然存在且显示
                    const selectorElement = selectorRef.current;
                    const isSelectorVisible = selectorElement && 
                                             document.contains(selectorElement) && 
                                             showAtSelector;
                    
                    // 如果焦点不在选择器上，且选择器仍然显示，则关闭
                    if (isSelectorVisible && !isFocusInSelector) {
                      // 再次检查relatedTarget（可能为null）
                      const relatedTarget = e.relatedTarget as HTMLElement;
                      if (!relatedTarget || !relatedTarget.closest('.at-selector-container')) {
                        console.log('[Workflow] Closing selector via blur');
                        setShowAtSelector(false);
                      }
                    }
                    
                    blurTimeoutRef.current = null;
                  }, 300); // 增加延迟时间
                }}
              placeholder={
                editingMessageId
                  ? '编辑消息...'
                  : !selectedLLMConfig
                  ? '请先选择 LLM 模型...'
                  : selectedMcpServerIds.size > 0
                    ? `输入你的任务，我可以使用 ${totalTools} 个工具帮助你完成... (输入 @ 选择感知组件)`
                    : '输入你的问题，我会尽力帮助你... (输入 @ 选择感知组件，输入 / 引用爬虫数据)'
              }
                className={`flex-1 resize-none w-full transition-all duration-200 bg-transparent border-none focus:outline-none focus:ring-0 text-gray-900 dark:text-[#ffffff] placeholder-gray-400 dark:placeholder-[#808080] px-3 pt-3 ${
                  isInputExpanded 
                    ? 'min-h-[300px] max-h-[500px]' 
                    : 'min-h-[50px] max-h-[200px]'
                }`}
              style={{ fontSize: '15px', lineHeight: '1.6' }}
              rows={2}
              disabled={isLoading || !selectedLLMConfig}
            />
            {/* 编辑模式提示和取消按钮 */}
            {editingMessageId && (
              <div className="absolute top-2 right-2 flex items-center space-x-2">
                <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">编辑模式</span>
                <button
                  onClick={handleCancelEdit}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc] transition-colors"
                  title="取消编辑"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
              
          {/* /模块 选择器 */}
          {showModuleSelector && (
            <CrawlerModuleSelector
              query={moduleSelectorQuery}
              position={moduleSelectorPosition}
              onSelect={handleModuleSelect}
              onClose={() => {
                setShowModuleSelector(false);
                setModuleSelectorIndex(-1);
                setModuleSelectorQuery('');
              }}
            />
          )}
          
          {/* 批次数据项选择器 */}
          {showBatchItemSelector && selectedBatch && (
            <CrawlerBatchItemSelector
              batch={selectedBatch}
              position={batchItemSelectorPosition}
              onSelect={(item) => {
                const batchName = selectedBatch.batch_name;
                handleBatchItemSelect(item, batchName);
              }}
              onClose={() => {
                setShowBatchItemSelector(false);
                setSelectedBatch(null);
                // 重新显示模块选择器
                if (moduleSelectorIndex !== -1) {
                  setShowModuleSelector(true);
                }
              }}
            />
          )}
          
          {/* @ 符号选择器 */}
          {showAtSelector && (
            <div
              ref={selectorRef}
              className="fixed z-[100] bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#404040] rounded-lg shadow-lg overflow-y-auto at-selector-container"
                  style={{
                    top: `${atSelectorPosition.top}px`,
                    left: `${atSelectorPosition.left}px`,
                    minWidth: '200px',
                    maxWidth: '300px',
                    maxHeight: `${atSelectorPosition.maxHeight || 256}px`, // 使用动态计算的最大高度
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault(); // 防止触发 blur
                    e.stopPropagation(); // 阻止事件冒泡
                    // 清除blur定时器，防止选择器被关闭
                    if (blurTimeoutRef.current) {
                      clearTimeout(blurTimeoutRef.current);
                      blurTimeoutRef.current = null;
                    }
                  }}
                  onMouseUp={(e) => {
                    e.preventDefault(); // 防止触发 blur
                    e.stopPropagation(); // 阻止事件冒泡
                  }}
                >
                  <div className="p-2 border-b border-gray-200 dark:border-[#404040]">
                    <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff]">
                      选择感知组件
                    </div>
                  </div>
                  
                  {/* MCP 服务器列表 - 显示所有MCP，不仅仅是已连接的 */}
                  {mcpServers.filter(s => 
                    s.name.toLowerCase().includes(atSelectorQuery)
                  ).length > 0 && (
                    <div className="py-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5 flex items-center justify-between">
                        <span>MCP 服务器</span>
                        <span className="text-[10px]">
                          ({connectedMcpServerIds.size}/{mcpServers.length}已连接)
                        </span>
                      </div>
                      {mcpServers
                        .filter(s => s.name.toLowerCase().includes(atSelectorQuery))
                        .map((server) => {
                          const isConnected = connectedMcpServerIds.has(server.id);
                          const isConnecting = connectingServers.has(server.id);
                          const component = { type: 'mcp' as const, id: server.id, name: server.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={server.id}
                              onClick={async () => {
                                if (isConnecting) return;
                                if (!isConnected) {
                                  // 未连接则先连接
                                  await handleConnectServer(server.id);
                                  // 连接成功后自动选择
                                  const newComponent = { type: 'mcp' as const, id: server.id, name: server.name };
                                  handleSelectComponent(newComponent);
                                } else {
                                  handleSelectComponent(component);
                                }
                              }}
                              className={`px-3 py-2 cursor-pointer flex items-center space-x-2 ${
                                isConnecting
                                  ? 'opacity-70 cursor-wait'
                                  : isSelected 
                                    ? 'bg-primary-100 dark:bg-primary-900/30' 
                                    : !isConnected
                                      ? 'hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="relative">
                                {isConnecting ? (
                                  <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                  <>
                                    <Plug className={`w-4 h-4 flex-shrink-0 ${isConnected ? 'text-primary-500' : 'text-gray-400'}`} />
                                    {isConnected && (
                                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                    )}
                                  </>
                                )}
                              </div>
                              <span className={`text-sm ${isConnected ? 'text-gray-900 dark:text-[#ffffff]' : 'text-gray-600 dark:text-gray-400'}`}>
                                {server.display_name || server.client_name || server.name}
                              </span>
                              {isConnecting && (
                                <span className="text-[10px] text-primary-500 ml-auto">连接中...</span>
                              )}
                              {!isConnected && !isConnecting && (
                                <span className="text-[10px] text-yellow-600 dark:text-yellow-400 ml-auto">点击连接</span>
                              )}
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
                      <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5">
                        工作流
                      </div>
                      {workflows
                        .filter(w => w.name.toLowerCase().includes(atSelectorQuery))
                        .map((workflow) => {
                          const component = { type: 'workflow' as const, id: workflow.workflow_id, name: workflow.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={workflow.workflow_id}
                              onClick={() => handleSelectComponent(component)}
                              className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                                isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : ''
                              }`}
                            >
                              <WorkflowIcon className="w-4 h-4 text-primary-500 flex-shrink-0" />
                              <span className="text-sm text-gray-900 dark:text-[#ffffff]">{workflow.name}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  
                  {/* 技能包列表 */}
                  {allSkillPacks.filter(sp => 
                    sp.name.toLowerCase().includes(atSelectorQuery)
                  ).length > 0 && (
                    <div className="py-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5">
                        技能包
                      </div>
                      {allSkillPacks
                        .filter(sp => sp.name.toLowerCase().includes(atSelectorQuery))
                        .map((skillPack) => {
                          const component = { type: 'skillpack' as const, id: skillPack.skill_pack_id, name: skillPack.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={skillPack.skill_pack_id}
                              onClick={() => handleSelectComponent(component)}
                              className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                                isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : ''
                              }`}
                            >
                              <Package className="w-4 h-4 text-amber-500 flex-shrink-0" />
                              <span className="text-sm text-gray-900 dark:text-[#ffffff]">{skillPack.name}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  
                  {/* 无匹配结果 */}
                  {mcpServers.filter(s => 
                    s.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 &&
                  workflows.filter(w => 
                    w.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 &&
                  allSkillPacks.filter(sp => 
                    sp.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-500 dark:text-[#b0b0b0] text-center">
                      未找到匹配的感知组件
                    </div>
                  )}
                </div>
              )}
              
              {/* 输入框底部：Token 计数 + 发送按钮（左统计、右动作；小屏自动收敛） */}
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-white/45 dark:bg-[#262626]/45 backdrop-blur-md border-t border-black/5 dark:border-white/10 rounded-b-xl">
                <div className="min-w-0">
            {selectedLLMConfig && messages.filter(m => m.role !== 'system' && !m.isSummary).length > 0 ? (() => {
              const model = selectedLLMConfig.model || 'gpt-4';
              let lastSummaryIndex = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].isSummary) { lastSummaryIndex = i; break; }
              }
              const messagesToCount = lastSummaryIndex >= 0 ? messages.slice(lastSummaryIndex) : messages;
              const conversationMessages = messagesToCount
                .filter(m => !(m.role === 'system' && !m.isSummary))
                .map(msg => msg.isSummary 
                  ? { role: 'user' as const, content: msg.content, thinking: undefined }
                  : { role: msg.role, content: msg.content, thinking: msg.thinking }
                );
              const currentTokens = estimate_messages_tokens(conversationMessages, model);
              const maxTokens = selectedLLMConfig?.max_tokens || get_model_max_tokens(model);
              const ratio = maxTokens > 0 ? currentTokens / maxTokens : 0;
              const colorClass =
                ratio >= 0.9
                  ? 'text-red-500 dark:text-red-400'
                  : ratio >= 0.75
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-400 dark:text-[#808080]';
              return (
                      <span className={`text-[11px] truncate ${colorClass}`} title={`${currentTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens`}>
                        {currentTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
                      </span>
              );
                  })() : null}
                </div>

                {/* 右侧：发送按钮（固定） */}
                <Button
                  onClick={handleSend}
                  disabled={isLoading || (!input.trim() && attachedMedia.length === 0) || !selectedLLMConfig}
                  variant="primary"
                  size="default"
                  className="gap-1.5 px-3 py-1.5 flex-shrink-0"
                >
                  {isLoading ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span className="hidden sm:inline">{editingMessageId ? '重新发送' : '发送'}</span>
                </Button>
              </div>
            </div>
          </div>
          </div>
          
          {/* 人设编辑弹窗 */}
          <SystemPromptEditDialog
            open={isEditingSystemPrompt}
            onClose={() => setIsEditingSystemPrompt(false)}
            draft={systemPromptDraft}
            setDraft={setSystemPromptDraft}
            onSave={async () => {
              if (currentSessionId) {
                try {
                  await updateSessionSystemPrompt(currentSessionId, systemPromptDraft || null);
                  setCurrentSystemPrompt(systemPromptDraft || null);
                  setIsEditingSystemPrompt(false);
                  // 更新 sessions 列表中的数据
                  setSessions(prev => prev.map(s => 
                    s.session_id === currentSessionId ? { ...s, system_prompt: systemPromptDraft || undefined } : s
                  ));
                } catch (error) {
                  console.error('Failed to update system prompt:', error);
                }
              }
            }}
            onClear={async () => {
              if (currentSessionId) {
                try {
                  await updateSessionSystemPrompt(currentSessionId, null);
                  setCurrentSystemPrompt(null);
                  setIsEditingSystemPrompt(false);
                  // 更新 sessions 列表中的数据
                  setSessions(prev => prev.map(s => 
                    s.session_id === currentSessionId ? { ...s, system_prompt: undefined } : s
                  ));
                } catch (error) {
                  console.error('Failed to clear system prompt:', error);
                }
              }
            }}
          />
          
          {/* 会话类型选择对话框 */}
          <SessionTypeDialog
            open={showSessionTypeDialog}
            onClose={() => setShowSessionTypeDialog(false)}
            onSelectTemporary={handleSwitchToTemporarySession}
            onSelectMemory={handleCreateMemorySession}
          />

          {/* 升级为智能体对话框 */}
          <UpgradeToAgentDialog
            open={showUpgradeToAgentDialog}
            onClose={() => setShowUpgradeToAgentDialog(false)}
            agentName={agentName}
            setAgentName={setAgentName}
            agentAvatar={agentAvatar}
            setAgentAvatar={setAgentAvatar}
            agentSystemPrompt={agentSystemPrompt}
            setAgentSystemPrompt={setAgentSystemPrompt}
            agentLLMConfigId={agentLLMConfigId}
            setAgentLLMConfigId={setAgentLLMConfigId}
            llmConfigs={llmConfigs}
            isUpgrading={isUpgrading}
            onUpgrade={async () => {
              if (!currentSessionId) {
                alert('会话ID不存在');
                return;
              }
              setIsUpgrading(true);
              try {
                await upgradeToAgent(
                  currentSessionId,
                  agentName.trim(),
                  agentAvatar!,
                  agentSystemPrompt.trim(),
                  agentLLMConfigId!
                );
                setCurrentSystemPrompt(agentSystemPrompt.trim());
                setCurrentSessionAvatar(agentAvatar);
                await loadSessions();
                setShowUpgradeToAgentDialog(false);
                alert('升级为智能体成功！');
              } catch (error) {
                console.error('[Workflow] Failed to upgrade to agent:', error);
                alert(`升级失败: ${error instanceof Error ? error.message : String(error)}`);
              } finally {
                setIsUpgrading(false);
              }
            }}
          />

          {/* 头像配置对话框 */}
          <AvatarConfigDialog
            open={showAvatarConfigDialog && !!currentSessionId && !isTemporarySession}
            onClose={() => setShowAvatarConfigDialog(false)}
            avatarDraft={avatarConfigDraft}
            setAvatarDraft={setAvatarConfigDraft}
            onSave={async () => {
              if (!currentSessionId) return;
              try {
                await updateSessionAvatar(currentSessionId, avatarConfigDraft || '');
                setCurrentSessionAvatar(avatarConfigDraft);
                setSessions(prev => prev.map(s => 
                  s.session_id === currentSessionId 
                    ? { ...s, avatar: avatarConfigDraft || undefined }
                    : s
                ));
                setShowAvatarConfigDialog(false);
              } catch (error) {
                console.error('Failed to update avatar:', error);
                alert('保存头像失败，请重试');
              }
            }}
          />
          
          {/* 技能包制作过程对话框 */}
          <SkillPackDialog
            open={showSkillPackDialog && !!skillPackResult && !!skillPackProcessInfo}
            onClose={() => {
              setShowSkillPackDialog(false);
              setSkillPackResult(null);
              setSkillPackProcessInfo(null);
              setSkillPackConversationText('');
              setOptimizationPrompt('');
              setSelectedMCPForOptimization([]);
            }}
            skillPackResult={skillPackResult}
            setSkillPackResult={setSkillPackResult}
            skillPackProcessInfo={skillPackProcessInfo}
            optimizationPrompt={optimizationPrompt}
            setOptimizationPrompt={setOptimizationPrompt}
            selectedMCPForOptimization={selectedMCPForOptimization}
            setSelectedMCPForOptimization={setSelectedMCPForOptimization}
            mcpServers={mcpServers}
            isOptimizing={isOptimizing}
            isSavingSkillPack={isCreatingSkillPack}
            selectedLLMConfigId={selectedLLMConfigId}
            onOptimize={handleOptimizeSkillPack}
            onSave={handleSaveSkillPack}
          />
          </div>
        </div>
      </div>
    </div>

    {/* HeaderConfigDialog - 会话配置对话框 */}
    <HeaderConfigDialog
      open={showHeaderConfigDialog}
      onClose={() => setShowHeaderConfigDialog(false)}
      activeTab={headerConfigActiveTab}
      setActiveTab={setHeaderConfigActiveTab}
      editName={headerConfigEditName}
      setEditName={setHeaderConfigEditName}
      editAvatar={headerConfigEditAvatar}
      setEditAvatar={setHeaderConfigEditAvatar}
      editSystemPrompt={headerConfigEditSystemPrompt}
      setEditSystemPrompt={setHeaderConfigEditSystemPrompt}
      editMediaOutputPath={headerConfigEditMediaOutputPath}
      setEditMediaOutputPath={setHeaderConfigEditMediaOutputPath}
      editLlmConfigId={headerConfigEditLlmConfigId}
      setEditLlmConfigId={setHeaderConfigEditLlmConfigId}
      editProfession={headerConfigEditProfession}
      setEditProfession={setHeaderConfigEditProfession}
      editProfessionType={headerConfigEditProfessionType}
      setEditProfessionType={setHeaderConfigEditProfessionType}
      careerProfessions={headerConfigCareerProfessions}
      gameProfessions={headerConfigGameProfessions}
      isLoadingProfessions={isLoadingHeaderProfessions}
      sessions={sessions}
      currentSessionId={currentSessionId}
      isTemporarySession={isTemporarySession}
      llmConfigs={llmConfigs}
      isSavingAsRole={isSavingHeaderAsRole}
      onShowAddProfessionDialog={() => setShowHeaderAddProfessionDialog(true)}
      onSaveAsRole={async () => {
        const currentSession = sessions.find(s => s.session_id === currentSessionId);
        if (!currentSession || !currentSessionId) return;
        
        const name = headerConfigEditName.trim() || currentSession.name || currentSession.title || `角色 ${currentSession.session_id.slice(0, 8)}`;
        const avatar = (headerConfigEditAvatar || '').trim();
        const systemPrompt = headerConfigEditSystemPrompt.trim();
        const llmConfigId = headerConfigEditLlmConfigId;
        const mediaOutputPath = headerConfigEditMediaOutputPath.trim();

        if (!avatar || !systemPrompt || !llmConfigId) {
          toast({
            title: '还差一步',
            description: '保存为角色需要：头像、人设、默认LLM。',
            variant: 'destructive',
          });
          setHeaderConfigActiveTab('basic');
          return;
        }

        try {
          setIsSavingHeaderAsRole(true);
          const role = await createRole({
            name,
            avatar,
            system_prompt: systemPrompt,
            llm_config_id: llmConfigId,
            media_output_path: mediaOutputPath || undefined,
          });
          emitSessionsChanged();
          toast({
            title: '已保存为角色',
            description: `角色「${role.name || role.title || role.session_id}」已加入角色库`,
            variant: 'success',
          });
        } catch (error) {
          console.error('Failed to save as role (header config):', error);
          toast({
            title: '保存为角色失败',
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          });
        } finally {
          setIsSavingHeaderAsRole(false);
        }
      }}
      onSave={async () => {
        try {
          const promises: Promise<void>[] = [];
          const currentSession = sessions.find(s => s.session_id === currentSessionId);
          if (!currentSession || !currentSessionId) return;
          
          // 如果职业发生变化，应用职业到名称和人设
          let finalName = headerConfigEditName.trim();
          let finalSystemPrompt = headerConfigEditSystemPrompt.trim();
          
          const currentProfessionList = headerConfigEditProfessionType === 'career' 
            ? headerConfigCareerProfessions 
            : headerConfigGameProfessions;
          const currentProfession = extractProfession(currentSession.name, currentSession.system_prompt, currentProfessionList);
          if (headerConfigEditProfession !== currentProfession) {
            // 职业发生变化，应用职业更新
            const applied = applyProfessionToNameOrPrompt(
              headerConfigEditProfession,
              finalName,
              finalSystemPrompt,
              currentProfessionList
            );
            finalName = applied.name;
            finalSystemPrompt = applied.systemPrompt;
          }
          
          // 更新名称
          if (finalName !== (currentSession.name || '')) {
            promises.push(updateSessionName(currentSessionId, finalName));
          }
          
          // 更新头像
          if (headerConfigEditAvatar !== currentSession.avatar) {
            promises.push(updateSessionAvatar(currentSessionId, headerConfigEditAvatar || ''));
            setCurrentSessionAvatar(headerConfigEditAvatar);
          }
          
          // 更新人设
          if (finalSystemPrompt !== (currentSession.system_prompt || '')) {
            promises.push(updateSessionSystemPrompt(currentSessionId, finalSystemPrompt || null));
            setCurrentSystemPrompt(finalSystemPrompt || null);
          }
          
          // 更新多媒体保存路径
          if (headerConfigEditMediaOutputPath !== (currentSession.media_output_path || '')) {
            promises.push(updateSessionMediaOutputPath(currentSessionId, headerConfigEditMediaOutputPath.trim() || null));
          }
          
          // 更新默认模型
          if (headerConfigEditLlmConfigId !== (currentSession.llm_config_id || null)) {
            promises.push(updateSessionLLMConfig(currentSessionId, headerConfigEditLlmConfigId));
            // 如果设置了默认模型，自动切换当前模型
            if (headerConfigEditLlmConfigId) {
              setSelectedLLMConfigId(headerConfigEditLlmConfigId);
            }
          }
          
          await Promise.all(promises);
          
          // 刷新会话列表
          const allSessions = await getSessions();
          setSessions(allSessions);
          emitSessionsChanged();
          
          setShowHeaderConfigDialog(false);
        } catch (error) {
          console.error('Failed to save config:', error);
          alert('保存失败，请重试');
        }
      }}
    />

    {/* AddProfessionDialog - 添加自定义职业对话框 */}
    <AddProfessionDialog
      open={showHeaderAddProfessionDialog}
      onClose={() => setShowHeaderAddProfessionDialog(false)}
      professionType={headerConfigEditProfessionType}
      setProfessionType={setHeaderConfigEditProfessionType}
      newProfessionValue={headerNewProfessionValue}
      setNewProfessionValue={setHeaderNewProfessionValue}
      setCareerProfessions={setHeaderConfigCareerProfessions}
      setGameProfessions={setHeaderConfigGameProfessions}
      setEditProfession={setHeaderConfigEditProfession}
    />

    <ConfirmDialog
      open={deleteSessionTarget !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteSessionTarget(null);
      }}
      title="删除Agent"
      description={`确定要删除Agent「${deleteSessionTarget?.name}」吗？此操作不可恢复。`}
      variant="destructive"
      onConfirm={async () => {
        if (!deleteSessionTarget) return;
        const id = deleteSessionTarget.id;
        setDeleteSessionTarget(null);
        await performDeleteSession(id);
      }}
    />

    {/* MCP 详情遮罩层 */}
    {showMCPDetailOverlay && selectedMCPDetail && (
      <MCPDetailOverlay
        mcpDetail={selectedMCPDetail}
        onClose={() => {
          setShowMCPDetailOverlay(false);
          setSelectedMCPDetail(null);
        }}
      />
    )}

    <ConfirmDialog
      open={deleteRoundTableTarget !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteRoundTableTarget(null);
      }}
      title="删除会议"
      description={`确定要删除会议「${deleteRoundTableTarget?.name}」吗？此操作不可恢复。`}
      variant="destructive"
      onConfirm={async () => {
        if (!deleteRoundTableTarget) return;
        const id = deleteRoundTableTarget.id;
        setDeleteRoundTableTarget(null);
        await performDeleteRoundTable(id);
      }}
    />

    <ConfirmDialog
      open={deleteResearchTarget !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteResearchTarget(null);
      }}
      title="删除Research会话"
      description={`确定要删除Research会话「${deleteResearchTarget?.name}」吗？此操作不可恢复。`}
      variant="destructive"
      onConfirm={async () => {
        if (!deleteResearchTarget) return;
        const id = deleteResearchTarget.id;
        setDeleteResearchTarget(null);
        await performDeleteResearch(id);
      }}
    />

    {/* 角色生成器（从"人设Tag展开区"进入） */}
    <RoleGeneratorDialog
      open={showRoleGenerator}
      onOpenChange={(open) => {
        setShowRoleGenerator(open);
        if (!open) {
          emitSessionsChanged();
          loadSessions();
        }
      }}
      onClose={() => setShowRoleGenerator(false)}
    />

    {/* 人设选择弹窗（可滚动，按类型分组） */}
    <PersonaPanel
      open={showPersonaPanel}
      onOpenChange={setShowPersonaPanel}
      personaSearch={personaSearch}
      setPersonaSearch={setPersonaSearch}
      isLoadingPersonaList={isLoadingPersonaList}
      personaAgents={personaAgents}
      personaMeetings={personaMeetings}
      personaResearchSessions={personaResearchSessions}
      isTemporarySession={isTemporarySession}
      currentSessionId={currentSessionId}
      temporarySessionId={temporarySessionId}
      onSwitchSession={switchSessionFromPersona}
      onOpenMeeting={openMeetingFromPersona}
      onOpenResearch={openResearchFromPersona}
      onDeleteAgent={(id, name) => setDeleteSessionTarget({ id, name })}
      onDeleteMeeting={(id, name) => setDeleteRoundTableTarget({ id, name })}
      onDeleteResearch={(id, name) => setDeleteResearchTarget({ id, name })}
      onShowRoleGenerator={() => setShowRoleGenerator(true)}
      onShowNewMeetingDialog={() => setShowNewMeetingDialog(true)}
      onShowNewResearchDialog={() => setShowNewResearchDialog(true)}
    />

    {/* 新建 Meeting 对话框 */}
    <NewMeetingDialog
      open={showNewMeetingDialog}
      onOpenChange={setShowNewMeetingDialog}
      meetingName={newMeetingName}
      setMeetingName={setNewMeetingName}
      isCreating={isCreatingMeeting}
      onCreate={handleCreateNewMeeting}
    />

    {/* 新建 Research 对话框 */}
    <NewResearchDialog
      open={showNewResearchDialog}
      onOpenChange={setShowNewResearchDialog}
      researchName={newResearchName}
      setResearchName={setNewResearchName}
      isCreating={isCreatingResearch}
      onCreate={handleCreateNewResearch}
    />

    {/* MCP 详情遮罩层 */}
    {showMCPDetailOverlay && selectedMCPDetail && (
      <MCPDetailOverlay
        mcpDetail={selectedMCPDetail}
        onClose={() => {
          setShowMCPDetailOverlay(false);
          setSelectedMCPDetail(null);
        }}
      />
    )}

    {/* 首次访问昵称输入对话框 */}
    <NicknameDialog
      open={showNicknameDialog}
      onOpenChange={setShowNicknameDialog}
      nicknameInput={nicknameInput}
      setNicknameInput={setNicknameInput}
      isSubmitting={isSubmittingNickname}
      userAccess={userAccess}
      onSubmit={handleSubmitNickname}
    />
    
    {/* 会话媒体面板 */}
    <SessionMediaPanel
      open={sessionMediaPanelOpen}
      onClose={() => setSessionMediaPanelOpen(false)}
      media={sessionMedia}
      initialIndex={sessionMediaInitialIndex}
    />
    </>
  );
};

export default Workflow;
