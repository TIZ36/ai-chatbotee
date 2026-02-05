/**
 * 工作流界面组件
 * 整合LLM模型和MCP工具，通过聊天完成任务
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Loader, Loader2, Bot, Wrench, AlertCircle, CheckCircle, Brain, Plug, XCircle, ChevronDown, ChevronUp, MessageCircle, FileText, Sparkles, Workflow as WorkflowIcon, Play, ArrowRight, Trash2, X, Edit2, RotateCw, Database, Paperclip, Music, HelpCircle, Package, CheckSquare, Square, Quote, Lightbulb, Eye, Volume2, Paintbrush, Image, Plus, CornerDownRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Virtuoso } from 'react-virtuoso';
import { LLMClient, LLMMessage } from '../services/llmClient';
import { getLLMConfigs, getLLMConfig, getLLMConfigApiKey, LLMConfigFromDB, getProviders, LLMProvider } from '../services/llmApi';
import { mcpManager, MCPServer, MCPTool } from '../services/mcpClient';
import { getMCPServers, MCPServerConfig } from '../services/mcpApi';
import { getSessions, getAgents, getSession, createSession, saveMessage, summarizeSession, getSessionSummaries, deleteSession, clearSummarizeCache, deleteMessage, updateSessionAvatar, updateSessionName, updateSessionSystemPrompt, updateSessionMediaOutputPath, updateSessionLLMConfig, upgradeToAgent, updateSessionType, Session, Summary, MessageExt } from '../services/sessionApi';
import { createRole, updateRoleProfile } from '../services/roleApi';
import type { PersonaPreset } from '../services/roleApi';
import { createSkillPack, saveSkillPack, optimizeSkillPackSummary, getSkillPacks, getSessionSkillPacks, createSopSkillPack, setCurrentSop, getCurrentSop, SkillPack, SessionSkillPack, SkillPackCreationResult, SkillPackProcessInfo } from '../services/skillPackApi';
import { getBackendUrl } from '../utils/backendUrl';
import { estimate_messages_tokens, get_model_max_tokens, estimate_tokens } from '../services/tokenCounter';
import { getBatch } from '../services/crawlerApi';
import CrawlerModuleSelector from './CrawlerModuleSelector';
import CrawlerBatchItemSelector from './CrawlerBatchItemSelector';
import AttachmentMenu from './AttachmentMenu';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { ConfirmDialog } from './ui/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Label } from './ui/Label';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { DataListItem } from './ui/DataListItem';
import { toast } from './ui/use-toast';
import { HistoryLoadTop } from './ui/HistoryLoadTop';
import { PluginExecutionPanel } from './PluginExecutionPanel';
import { MCPDetailOverlay } from './MCPDetailOverlay';
import { emitSessionsChanged, SESSIONS_CHANGED_EVENT } from '../utils/sessionEvents';
import { getDimensionOptions } from '../services/roleDimensionApi';
import { SplitViewMessage } from './SplitViewMessage';
import { MediaGallery, MediaItem } from './ui/MediaGallery';
import type { SessionMediaItem } from './ui/SessionMediaPanel';
import { IconButton } from './ui/IconButton';
import { MediaPreviewDialog } from './ui/MediaPreviewDialog';
import { ensureDataUrlFromMaybeBase64, normalizeBase64ForInlineData } from '../utils/dataUrl';
import { useConversation } from '../conversation/useConversation';
import { createSessionConversationAdapter } from '../conversation/adapters/sessionConversation';
import { MessageAvatar, MessageBubbleContainer, MessageStatusIndicator, type MessageRole as UIMessageRole } from './ui/MessageBubble';
import { messageApi } from '../services/api';
import {
  applyProfessionToNameOrPrompt,
  detectProfessionType,
  extractProfession,
} from './workflow/profession';
import { useFloatingComposerPadding } from './workflow/useFloatingComposerPadding';
import { parseMCPContentBlocks } from './workflow/mcpRender';
import { MessageContent } from './workflow/MessageContent';
import type { Message } from './workflow/types';
import type { ProcessMessage } from '../types/processMessage';
import type { ProcessStep } from '../types/processSteps';
import { ProcessStepsViewer } from './ui/ProcessStepsViewer';
import type { ExecutionLogEntry } from './ui/ExecutionLogViewer';
import { ExecutionLogViewer } from './ui/ExecutionLogViewer';
import { useChatInput } from './workflow/useChatInput';
import { TokenCounter } from './workflow/TokenCounter';
import { floatingComposerContainerClass, floatingComposerInnerClass } from './shared/floatingComposerStyles';
import {
  SessionTypeDialog,
  UpgradeToAgentDialog,
  AvatarConfigDialog,
  SkillPackDialog,
  PersonaPanel,
  PersonaSwitchDialog,
  RoleGeneratorDialog,
  HeaderConfigDialog,
  AddProfessionDialog,
  DEFAULT_CAREER_PROFESSIONS,
  DEFAULT_GAME_PROFESSIONS,
  SystemPromptEditDialog,
} from './workflow/dialogs';
import { TopicConfigDialog, TopicDisplayType } from './workflow/dialogs/TopicConfigDialog';
import { getParticipants, addParticipant as addSessionParticipant, removeParticipant as removeSessionParticipant, Participant, updateSession } from '../services/sessionApi';
import AgentPersonaDialog from './AgentPersonaDialog';
import { ProviderIcon } from './ui/ProviderIcon';
import { CapabilityIcons } from './ui/CapabilityIcons';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from './ui/Select';
import { defaultPersonaConfig } from './AgentPersonaConfig';

// 支持的厂商类型（用于 ProviderIcon，未支持时回退 emoji）
const PROVIDER_ICONS: Record<string, { icon: string; color: string }> = {
  openai: { icon: '🤖', color: '#10A37F' },
  anthropic: { icon: '🧠', color: '#D4A574' },
  gemini: { icon: '✨', color: '#4285F4' },
  google: { icon: '✨', color: '#4285F4' },
  deepseek: { icon: '🐋', color: '#4D6BFE' },
  ollama: { icon: '🦙', color: '#1D4ED8' },
  local: { icon: '💻', color: '#6B7280' },
  custom: { icon: '⚙️', color: '#8B5CF6' },
};

// 根据 LLM 配置获取提供商图标（统一用 ProviderIcon / emoji，不再使用自定义 logo 图片）
const getProviderIcon = (config: LLMConfigFromDB | null, _providers: LLMProvider[] = []): { icon: string; color: string } => {
  if (!config) return { icon: '🤖', color: '#6B7280' };
  const apiUrl = config.api_url?.toLowerCase() || '';
  if (apiUrl.includes('deepseek')) return PROVIDER_ICONS.deepseek;
  if (apiUrl.includes('anthropic')) return PROVIDER_ICONS.anthropic;
  if (apiUrl.includes('googleapis') || apiUrl.includes('gemini')) return PROVIDER_ICONS.gemini;
  if (apiUrl.includes('nvidia') || config.supplier?.toLowerCase() === 'nvidia') return PROVIDER_ICONS.openai;
  const providerType = config.provider?.toLowerCase() || 'openai';
  return PROVIDER_ICONS[providerType] || PROVIDER_ICONS.openai;
};

/** 单个过程步骤（用于记录多轮思考和MCP调用） */
interface WorkflowProps {
  sessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  enableToolCalling?: boolean;
  onToggleToolCalling?: (enabled: boolean) => void;
}

const Workflow: React.FC<WorkflowProps> = ({
  sessionId: externalSessionId,
  onSelectSession,
  enableToolCalling,
  onToggleToolCalling,
}) => {
  // 将工作流消息的 'error' role 规范化为 UI 组件可识别的 role（避免类型不匹配）
  const toUIRole = useCallback((role: 'user' | 'assistant' | 'system' | 'tool' | 'error'): UIMessageRole => {
    return role === 'error' ? 'assistant' : role;
  }, []);
  const toolCallingEnabled = enableToolCalling !== undefined ? enableToolCalling : false;
  // Gemini inlineData.data 只接受“标准 base64”；这里统一归一化，并对明显不合法的内容返回 null（避免整包请求 400）
  const toInlineBase64 = useCallback((maybeDataUrlOrBase64: string): string | null => {
    return normalizeBase64ForInlineData(maybeDataUrlOrBase64);
  }, []);
  // Virtuoso 使用 firstItemIndex 来稳定处理 prepend；该值不能小于 0。
  // 当总数未知时，建议使用一个足够大的基准值，然后每次 prepend 时递减。
  const VIRTUOSO_BASE_INDEX = 100000;

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(externalSessionId || null);

  const sessionAdapter = useMemo(
    () => (currentSessionId ? createSessionConversationAdapter(currentSessionId) : null),
    [currentSessionId]
  );
  const {
    messages: persistedMessages,
    setMessages: setPersistedMessages,
    hasMoreBefore: hasMorePersistedMessages,
    loadMoreBefore: loadMorePersistedMessages,
    isLoading: isLoadingPersistedMessages,
    loadInitial: loadPersistedInitial,
  } = useConversation(sessionAdapter, { pageSize: 10 });

  // 统一通过 messages/setMessages 操作当前会话
  const messages: Message[] = persistedMessages as unknown as Message[];
  const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = setPersistedMessages as unknown as React.Dispatch<React.SetStateAction<Message[]>>;

  const avatarCacheRef = useRef(new Map<string, string | null>());
  const avatarLoadingRef = useRef(new Set<string>());
  const [avatarCacheTick, setAvatarCacheTick] = useState(0);
  const resolveAgentAvatar = useCallback((senderId?: string, fallback?: string) => {
    if (!senderId) return fallback;
    if (avatarCacheRef.current.has(senderId)) {
      return avatarCacheRef.current.get(senderId) || undefined;
    }
    return fallback;
  }, []);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // 执行日志（Cursor 风格滚动区域）
  const [executionLogs, setExecutionLogs] = useState<ExecutionLogEntry[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  // 多模态内容（图片、视频、音频）
  const [attachedMedia, setAttachedMedia] = useState<Array<{
    type: 'image' | 'video' | 'audio';
    mimeType: string;
    data: string; // base64 编码的数据
    preview?: string; // 预览 URL（用于显示）
  }>>([]);

  // 生图：是否在上下文中回灌“模型生成图片的 thoughtSignature”（用于图生图/基于上次修改继续）
  // 关闭时：仍会发送当前用户上传图片，但不再自动携带历史生成图片进入上下文（更适合“全新生图”）。
  const [useThoughtSignature, setUseThoughtSignature] = useState(true);
  
  // 媒体预览（弹窗）
  const [mediaPreviewOpen, setMediaPreviewOpen] = useState(false);
  const [mediaPreviewItem, setMediaPreviewItem] = useState<SessionMediaItem | null>(null);

  const openSingleMediaViewer = useCallback((item: SessionMediaItem) => {
    setMediaPreviewItem(item);
    setMediaPreviewOpen(true);
  }, []);
  const [streamEnabled, setStreamEnabled] = useState(true); // 流式响应开关
  const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set()); // 已折叠的思考过程
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null); // 正在编辑的消息ID
  const [quotedMessageId, setQuotedMessageId] = useState<string | null>(null); // 引用的消息ID
  const [quotedMessageSnapshot, setQuotedMessageSnapshot] = useState<{
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    senderName: string;
    content: string;
    media?: Array<{ type: 'image' | 'video' | 'audio'; mimeType: string; data: string; url?: string }>;
  } | null>(null);
  const [quoteDetailOpen, setQuoteDetailOpen] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false); // 是否正在拖拽文件
  const [isInputExpanded, setIsInputExpanded] = useState(false); // 输入框是否扩大
  const [isInputFocused, setIsInputFocused] = useState(false); // 输入框是否聚焦
  const [abortController, setAbortController] = useState<AbortController | null>(null); // 用于中断请求
  // MCP 详情遮罩层状态
  const [showMCPDetailOverlay, setShowMCPDetailOverlay] = useState(false);
  const [selectedMCPDetail, setSelectedMCPDetail] = useState<any>(null);
  
  // @ 符号选择器状态
  const [showAtSelector, setShowAtSelector] = useState(false); // 是否显示 @ 选择器
  const [showModuleSelector, setShowModuleSelector] = useState(false); // 是否显示模块选择器（/ 命令）
  const [atSelectorQuery, setAtSelectorQuery] = useState(''); // @ 选择器的查询字符串
  const [selectedComponentIndex, setSelectedComponentIndex] = useState(0); // 当前选中的组件索引（用于键盘导航）
  const [selectedComponents, setSelectedComponents] = useState<Array<{ type: 'mcp' | 'skillpack' | 'agent'; id: string; name: string }>>([]); // 已选定的组件（tag）
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editingMessageIdRef = useRef<string | null>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
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

  const filterVisibleSessions = useCallback((list: Session[]) => {
    return (list || []).filter(s => s.session_type !== 'memory' && s.session_type !== 'research');
  }, []);
  
  // 当前会话类型 (派生状态)
  const currentSessionType = useMemo(() => {
    const session = sessions.find(s => s.session_id === currentSessionId) || currentSessionMeta;
    const type = session?.session_type;
    if (type === 'memory' || type === 'research') return 'temporary';
    return type || 'agent'; // 默认为 agent 类型
  }, [currentSessionId, sessions, currentSessionMeta]);

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
  
  // Topic 配置对话框状态（用于话题会话）
  const [showTopicConfigDialog, setShowTopicConfigDialog] = useState(false);
  const [topicConfigEditName, setTopicConfigEditName] = useState('');
  const [topicConfigEditAvatar, setTopicConfigEditAvatar] = useState<string | null>(null);
  const [topicConfigEditDisplayType, setTopicConfigEditDisplayType] = useState<TopicDisplayType>('chat');
  const [topicParticipants, setTopicParticipants] = useState<Participant[]>([]);
  
  // Agent Persona 配置对话框状态（用于从会话面板点击agent头像时打开）
  const [showAgentPersonaDialog, setShowAgentPersonaDialog] = useState(false);
  const [agentPersonaDialogAgent, setAgentPersonaDialogAgent] = useState<Session | null>(null);
  
  // Agent决策状态（用于显示Agent正在思考是否回答）
  // key: agent_id, value: { agentName, agentAvatar, status: 'deciding' | 'decided', action?, inReplyTo?, processSteps? }
  interface AgentDecidingState {
    agentName: string;
    agentAvatar?: string;
    status: 'deciding' | 'decided';
    action?: string;
    inReplyTo?: string;
    timestamp: number;
    processSteps?: any[];  // 决策过程步骤（旧协议）
    processMessages?: ProcessMessage[];  // 决策过程消息（新协议）
    executionLogs?: ExecutionLogEntry[];  // 执行日志
  }
  const [agentDecidingStates, setAgentDecidingStates] = useState<Map<string, AgentDecidingState>>(new Map());
  
  const [isEditingSystemPrompt, setIsEditingSystemPrompt] = useState(false); // 是否正在编辑人设
  const [systemPromptDraft, setSystemPromptDraft] = useState(''); // 人设编辑草稿
  const [showModelSelectDialog, setShowModelSelectDialog] = useState(false); // 是否显示模型选择对话框
  const [selectedProviderTab, setSelectedProviderTab] = useState<string | null>(null); // 当前选中的供应商 Tab
  const [showHelpTooltip, setShowHelpTooltip] = useState(false); // 是否显示帮助提示
  const [showSessionTypeDialog, setShowSessionTypeDialog] = useState(false); // 是否显示会话类型选择对话框
  const [showUpgradeToAgentDialog, setShowUpgradeToAgentDialog] = useState(false); // 是否显示升级为智能体对话框
  // 人设（会话）切换：通过对话界面顶部“人设Tag”完成
  const [showPersonaPanel, setShowPersonaPanel] = useState(false);
  const [showPersonaSwitchDialog, setShowPersonaSwitchDialog] = useState(false); // 人设切换弹框（点击人设打开）
  const [personaSwitchLoading, setPersonaSwitchLoading] = useState(false);
  const [personaSaveLoading, setPersonaSaveLoading] = useState(false);
  const [personaSearch, setPersonaSearch] = useState('');
  const [showRoleGenerator, setShowRoleGenerator] = useState(false);
  const [personaAgents, setPersonaAgents] = useState<Session[]>([]);
  const [personaTopics, setPersonaTopics] = useState<Session[]>([]);
  const [isLoadingPersonaList, setIsLoadingPersonaList] = useState(false);
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
  const [isNearTop, setIsNearTop] = useState(false); // 是否接近顶部（用于显示加载更多）
  const [showScrollToBottom, setShowScrollToBottom] = useState(false); // 是否显示跳转到最新消息按钮

  // useConversation 的加载状态/是否可继续向上翻页，同步到旧状态字段（避免大面积改 UI）
  useEffect(() => {
    setIsLoadingMessages(isLoadingPersistedMessages);
    setHasMoreMessages(hasMorePersistedMessages);
  }, [hasMorePersistedMessages, isLoadingPersistedMessages]);
  
  // 首次访问弹窗相关状态（已移除用户登录/访问模块）
  
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
  
  // SOP相关状态
  const [showAddSopDialog, setShowAddSopDialog] = useState(false);
  const [sopName, setSopName] = useState('');
  const [sopText, setSopText] = useState('');
  const [isCreatingSop, setIsCreatingSop] = useState(false);
  const [currentSopSkillPack, setCurrentSopSkillPack] = useState<SkillPack | null>(null);
  
  // LLM配置
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [selectedLLMConfigId, setSelectedLLMConfigId] = useState<string | null>(null);
  const [selectedLLMConfig, setSelectedLLMConfig] = useState<LLMConfigFromDB | null>(null);

  // 将 llm_config_id（可能是 UUID）转成可读名称：name (provider/model)
  const formatLLMConfigLabel = useCallback((configId: string): string => {
    const id = String(configId || '').trim();
    if (!id) return '';
    const cfg = llmConfigs.find((c) => c.config_id === id);
    if (!cfg) return id;
    const name = (cfg as any).name || '';
    const provider = (cfg as any).provider || 'unknown';
    const model = (cfg as any).model || 'unknown';
    if (name) return `${name} (${provider}/${model})`;
    return `${provider}/${model}`;
  }, [llmConfigs]);

  // 兼容历史数据：把 processSteps 里“使用用户选择的模型: <id>”替换为可读名称
  const normalizeIncomingProcessSteps = useCallback((steps?: any[]): any[] | undefined => {
    if (!Array.isArray(steps) || steps.length === 0) return steps;
    const normalized = steps.map((s) => {
      const thinking = s?.thinking;
      if (typeof thinking !== 'string') return s;
      const m = thinking.match(/^使用用户选择的模型:\s*(\S+)\s*$/);
      if (!m) return s;
      const id = m[1];
      const label = formatLLMConfigLabel(id);
      if (!label || label === id) return s;
      return { ...s, thinking: `使用用户选择的模型: ${label}` };
    });
    // 合并更新：优先使用 step_id（若存在），否则用 type+timestamp 兜底
    const map = new Map<string, any>();
    for (const s of normalized) {
      const key = s?.step_id ? `id:${s.step_id}` : `t:${s?.type ?? 'unknown'}:${s?.timestamp ?? ''}`;
      map.set(key, s);
    }
    return Array.from(map.values()).sort((a, b) => (a?.timestamp ?? 0) - (b?.timestamp ?? 0));
  }, [formatLLMConfigLabel]);

  const buildProcessMessages = useCallback((steps: ProcessStep[]): ProcessMessage[] => {
    return steps.map((step) => {
      const blocks = step.result ? parseMCPContentBlocks(step.result) : [];
      const mediaBlocks = blocks.filter((b): b is Extract<typeof b, { kind: 'image' | 'video' | 'audio' }> => 
        b.kind === 'image' || b.kind === 'video' || b.kind === 'audio'
      );
      let contentType: ProcessMessage['contentType'] = 'text';
      let images: ProcessMessage['images'];
      let image: ProcessMessage['image'];
      if (mediaBlocks.length > 1) {
        contentType = 'images';
        images = mediaBlocks.map(b => ({ mimeType: b.mimeType, data: b.data }));
      } else if (mediaBlocks.length === 1) {
        contentType = 'image';
        image = { mimeType: mediaBlocks[0].mimeType, data: mediaBlocks[0].data };
      }
      const content = step.thinking || step.error || (typeof step.result === 'string' ? step.result : undefined);
      return {
        type: step.type,
        contentType,
        timestamp: step.timestamp ?? Date.now(),
        title: step.toolName || step.workflowInfo?.name || step.action || step.type,
        content,
        image,
        images,
        meta: {
          ...step,
          blocks,
        },
      };
    });
  }, []);

  // 兜底：如果历史消息只有 processSteps，补齐 processMessages（保持一致协议）
  useEffect(() => {
    setMessages(prev => {
      let changed = false;
      const next = prev.map(msg => {
        const anyMsg = msg as any;
        if (!anyMsg.processMessages && Array.isArray(anyMsg.processSteps) && anyMsg.processSteps.length > 0) {
          changed = true;
          return { ...msg, processMessages: buildProcessMessages(anyMsg.processSteps) };
        }
        if (!anyMsg.processMessages && anyMsg.ext?.processMessages) {
          changed = true;
          return { ...msg, processMessages: anyMsg.ext.processMessages };
        }
        return msg;
      });
      return changed ? next : prev;
    });
  }, [buildProcessMessages, setMessages]);

  const normalizeIncomingProcessMessages = useCallback((messages?: any[], steps?: any[]) => {
    if (Array.isArray(messages) && messages.length > 0) return messages;
    const normalizedSteps = normalizeIncomingProcessSteps(steps) || [];
    return normalizedSteps.length > 0 ? buildProcessMessages(normalizedSteps) : undefined;
  }, [normalizeIncomingProcessSteps, buildProcessMessages]);

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
  
  // 技能包列表
  const [allSkillPacks, setAllSkillPacks] = useState<SkillPack[]>([]);
  
  // 拖拽状态
  const [draggingComponent, setDraggingComponent] = useState<{ type: 'mcp' | 'skillpack'; id: string; name: string } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const [chatScrollEl, setChatScrollEl] = useState<HTMLDivElement | null>(null);
  // 浮岛输入区：动态计算消息列表底部 padding，避免被浮岛遮挡
  const { ref: floatingComposerRef, padding: floatingComposerPadding } = useFloatingComposerPadding();
  const wasAtBottomRef = useRef(true);
  const isInitialLoadRef = useRef(true);
  const shouldMaintainScrollRef = useRef(false);
  const isUserScrollingRef = useRef(false);
  const historyCooldownUntilRef = useRef(0);
  const historyAutoFiredInNearTopRef = useRef(false);
  const historyTopStayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTopRef = useRef(0);
  const [virtuosoFirstItemIndex, setVirtuosoFirstItemIndex] = useState(VIRTUOSO_BASE_INDEX);
  
  // 消息缓存：按 session_id 缓存消息，Map<session_id, Map<message_id, Message>>
  const messageCacheRef = useRef<Map<string, Map<string, Message>>>(new Map());

  const isLoadingMoreRef = useRef(false);
  const lastMessageCountRef = useRef(0);
  
  // 消息引用，用于在回调中访问最新消息而不触发重渲染
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;

  const clearQuotedMessage = useCallback(() => {
    setQuotedMessageId(null);
    setQuotedMessageSnapshot(null);
  }, []);
  
  // 预计算“上一条消息内容”映射：避免每次渲染都在 messages 上 findIndex（可见项多时会明显拖慢）
  const prevMessageContentMap = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (let i = 0; i < messages.length; i++) {
      const cur = messages[i];
      const prev = i > 0 ? messages[i - 1] : undefined;
      map.set(cur.id, prev?.content);
    }
    return map;
  }, [messages]);
  
  // 获取消息的前一条消息内容（用于优化 MessageContent 渲染）
  const getPrevMessageContent = useCallback(
    (messageId: string): string | undefined => prevMessageContentMap.get(messageId),
    [prevMessageContentMap]
  );
  
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

  // 会话切换时重置“顶部加载”状态（避免跨会话继承 cooldown/autoFired）
  useEffect(() => {
    // 重置初始加载标记，确保切换会话后自动滚动到最新消息位置
    isInitialLoadRef.current = true;
    wasAtBottomRef.current = true;
    historyAutoFiredInNearTopRef.current = false;
    historyCooldownUntilRef.current = 0;
    if (historyTopStayTimerRef.current) {
      clearTimeout(historyTopStayTimerRef.current);
      historyTopStayTimerRef.current = null;
    }
    setVirtuosoFirstItemIndex(VIRTUOSO_BASE_INDEX);
  }, [currentSessionId]);

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
      // 但如果用户正在手动滚动查看历史消息，不要强制滚动到底部
      const hasStreamingMessage = messages.some(m => m.isStreaming);
      if (hasStreamingMessage && wasAtBottom && !isUserScrollingRef.current) {
        // 再次检查用户是否在底部（可能在滚动过程中离开了底部）
        const stillAtBottom = shouldAutoScroll();
        if (stillAtBottom) {
        setTimeout(() => scrollToBottom('auto'), 0);
        }
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
      setSessions(filterVisibleSessions(sessionList));
    } catch (error) {
      console.error('[Workflow] Failed to load sessions:', error);
      // 如果加载失败，设置为空数组，避免后续错误
      setSessions([]);
    }
  };

  // 从URL参数中获取会话ID（用于从智能体页面跳转过来）
  // 注意：必须使用 setSearchParams 来清理参数，避免 window.history.replaceState 导致 react-router 的 searchParams 不同步
  const [searchParams, setSearchParams] = useSearchParams();
  
  // 加载LLM配置和MCP服务器列表
  useEffect(() => {
    loadLLMConfigs();
    loadMCPServers();
    loadSessions();
    loadSkillPacks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部触发：会话/角色数据变更时刷新（例如侧边栏新建/删除/应用角色）
  useEffect(() => {
    const handler = () => {
      void (async () => {
        try {
          const sessionList = await getSessions();
          setSessions(filterVisibleSessions(sessionList));
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
    }
    // 不再处理切换到临时会话的逻辑，默认 Agent 由 App.tsx 控制
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSessionId, sessions.length]);

  // 从URL参数中加载会话
  useEffect(() => {
    const sessionIdFromUrl = searchParams.get('session');
    if (sessionIdFromUrl) {
      // 优化：不再等待 sessions 全量加载。
      // handleSelectSession 内部会处理 session 未在当前列表中的情况（会主动 fetch）
      handleSelectSession(sessionIdFromUrl);
      
      // 清除URL参数（使用 react-router，避免 URL 已变更但 searchParams hook 不同步）
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('session');
        return next;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]); // 仅在 searchParams 改变时运行

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
  
  // 话题/Agent 实时消息监听 (SSE) - 支持流式显示
  // topic_general 和 agent 类型的会话都使用 AgentActor 模型
  // - topic_general：多人话题，多个 Agent 协作
  // - agent：私聊，只有单个 Agent 响应
  useEffect(() => {
    // 重连状态
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000; // 1秒
    let reconnectTimeoutId: NodeJS.Timeout | null = null;
    let isComponentMounted = true;
    
    const setupTopicStream = (): EventSource | null => {
      if (!currentSessionId || (currentSessionType !== 'topic_general' && currentSessionType !== 'agent')) {
        return null;
      }

      console.log('[Workflow] Subscribing to topic stream:', currentSessionId, 'attempt:', reconnectAttempts);
      const url = `${getBackendUrl()}/api/topics/${currentSessionId}/stream`;
      const eventSource = new EventSource(url);
      
      // 用于追踪正在流式生成的消息
      const streamingMessages = new Map<string, { agentId: string; agentName: string; content: string }>();

      eventSource.onopen = () => {
        console.log('[Workflow] Topic stream connected');
        // 连接成功，重置重连计数
        reconnectAttempts = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          console.log('[Workflow] Topic event received:', payload.type);

          if (payload.type === 'new_message') {
            const msg = payload.data;
            // 避免在控制台打印 base64 头像（极大影响性能与可读性）
            const _avatarPreview = (() => {
              const a = (msg.sender_avatar || msg.ext?.sender_avatar) as string | undefined;
              if (!a) return 'none';
              if (typeof a !== 'string') return typeof a;
              if (a.startsWith('data:image/')) return `data:image/* (len=${a.length})`;
              return a.length > 120 ? `${a.slice(0, 60)}…(len=${a.length})` : a;
            })();
            console.log('[Workflow] new_message received:', msg.message_id, 'sender_avatar:', _avatarPreview);
            
            // 检查 ID 是否已存在（可能是流式消息的最终版本）
            const incomingProcessMessages = normalizeIncomingProcessMessages(msg.processMessages || msg.ext?.processMessages, msg.processSteps || msg.ext?.processSteps);
            setMessages((prev) => {
              const existingIndex = prev.findIndex((m) => m.id === msg.message_id || m.id === msg.id);
              if (existingIndex >= 0) {
                // 更新现有消息（流式消息完成后的最终内容）
                // 但保留 processMessages 等扩展信息
                const updated = [...prev];
                const existing = updated[existingIndex];
                const mergedSteps =
                  existing.ext?.processSteps ||
                  msg.ext?.processSteps;
                const normalizedMergedSteps = normalizeIncomingProcessSteps(mergedSteps);
                const mergedProcessMessages = incomingProcessMessages || existing.processMessages || (existing.ext as any)?.processMessages;
                updated[existingIndex] = {
                  ...existing,
                  content: msg.content,
                  isStreaming: false,
                  // 合并 ext，保留现有的 processMessages
                  ext: {
                    ...(existing.ext || {}),
                    ...(msg.ext || {}),
                    processSteps: normalizedMergedSteps || mergedSteps,
                    processMessages: mergedProcessMessages
                  },
                  // 保留已有的 processMessages
                  processMessages: mergedProcessMessages
                };
                return updated;
              }

              // 提取 sender 信息，优先从顶层获取，然后从 ext 中获取
              const sanitizeAvatar = (a?: string) => {
                if (!a) return undefined;
                if (typeof a !== 'string') return undefined;
                // 不在每条消息里携带 data URI（base64），改为依赖 topicParticipants 的 avatar
                if (a.startsWith('data:image/')) return undefined;
                // 过长的字段也直接丢弃，避免撑爆消息体
                if (a.length > 1024) return undefined;
                return a;
              };
              const senderAvatar = sanitizeAvatar(msg.sender_avatar || msg.ext?.sender_avatar);
              const senderName = msg.sender_name || msg.ext?.sender_name;
              
              const newMessage: Message = {
                id: msg.message_id || msg.id,
                role: msg.role as any,
                content: msg.content,
                thinking: msg.thinking,
                toolCalls: msg.tool_calls,
                sender_id: msg.sender_id,
                sender_type: msg.sender_type,
                sender_avatar: senderAvatar,
                sender_name: senderName,
                processMessages: incomingProcessMessages,
                ext: {
                  ...msg.ext,
                  processSteps: normalizeIncomingProcessSteps(msg.ext?.processSteps),
                  // 只保留“可传输”的 avatar；base64 头像不写入消息体
                  sender_avatar: senderAvatar,
                  sender_name: senderName,
                  processMessages: incomingProcessMessages
                }
              };
              
              // 如果是新的回复，停止加载状态并滚动到底部
              if (msg.role === 'assistant') {
                setIsLoading(false);
                wasAtBottomRef.current = true;
              }
              
              // 如果是用户消息，清空执行日志（准备接收新的 AI 响应日志）
              if (msg.role === 'user') {
                setExecutionLogs([]);
              }
              
              return [...prev, newMessage];
            });
            
          } else if (payload.type === 'topic_participants_updated') {
            const data = payload.data || {};
            const participants = data.participants || [];
            console.log('[Workflow] Topic participants updated:', participants.length);
            setTopicParticipants(participants);
          } else if (payload.type === 'reaction') {
            const data = payload.data || {};
            if (data.reaction === 'like' && data.message_id) {
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === data.message_id);
                if (idx < 0) return prev;
                const next = [...prev];
                const cur = next[idx];
                const ext = (cur.ext || {}) as any;
                const reactions = ext.reactions || {};
                const likes: any[] = Array.isArray(reactions.likes) ? reactions.likes : [];
                // 去重：同一 agent 对同一消息只点赞一次
                if (!likes.some((l) => l?.from_agent_id === data.from_agent_id)) {
                  likes.push({
                    from_agent_id: data.from_agent_id,
                    from_agent_name: data.from_agent_name,
                    ts: data.timestamp,
                  });
                }
                next[idx] = {
                  ...cur,
                  ext: {
                    ...ext,
                    reactions: {
                      ...reactions,
                      likes,
                    },
                  },
                };
                return next;
              });
            }
          } else if (payload.type === 'agent_deciding') {
            // Agent 开始决策是否回答
            const data = payload.data;
            const incomingProcessMessages = normalizeIncomingProcessMessages(data.processMessages, data.processSteps);
            console.log('[Workflow] Agent deciding:', data.agent_name, 'processMessages:', incomingProcessMessages?.length || 0);
            
            setAgentDecidingStates((prev) => {
              const next = new Map(prev);
              const current = next.get(data.agent_id);
              const existingSteps = current?.processSteps || [];
              const incomingSteps = normalizeIncomingProcessSteps(data.processSteps) || [];
              // 合并步骤：保留已有步骤，追加新步骤（去重）
              const mergedSteps = [...existingSteps];
              for (const step of incomingSteps) {
                if (!mergedSteps.some(s => s.timestamp === step.timestamp && s.type === step.type)) {
                  mergedSteps.push(step);
                }
              }
              // 合并 processMessages
              const existingMessages = current?.processMessages || [];
              const mergedMessages = [...existingMessages];
              for (const msg of (incomingProcessMessages || [])) {
                if (!mergedMessages.some(m => m.timestamp === msg.timestamp && m.type === msg.type)) {
                  mergedMessages.push(msg);
                }
              }
              next.set(data.agent_id, {
                agentName: data.agent_name,
                agentAvatar: data.agent_avatar,
                status: 'deciding',
                inReplyTo: data.in_reply_to,
                timestamp: data.timestamp || Date.now() / 1000,
                processSteps: mergedSteps,
                processMessages: mergedMessages.length > 0 ? mergedMessages : undefined
              });
              return next;
            });
            
          } else if (payload.type === 'agent_decision') {
            // Agent 决策完成
            const data = payload.data;
            const incomingProcessMessages = normalizeIncomingProcessMessages(data.processMessages, data.processSteps);
            console.log('[Workflow] Agent decision:', data.agent_name, data.action, 'processMessages:', incomingProcessMessages?.length || 0);
            
            setAgentDecidingStates((prev) => {
              const next = new Map(prev);
              const current = next.get(data.agent_id);
              if (current) {
                const existingSteps = current.processSteps || [];
                const incomingSteps = normalizeIncomingProcessSteps(data.processSteps) || [];
                // 合并步骤
                const mergedSteps = [...existingSteps];
                for (const step of incomingSteps) {
                  const existingIdx = mergedSteps.findIndex(s => s.timestamp === step.timestamp && s.type === step.type);
                  if (existingIdx >= 0) {
                    mergedSteps[existingIdx] = { ...mergedSteps[existingIdx], ...step };
                  } else {
                    mergedSteps.push(step);
                  }
                }
                // 合并 processMessages
                const existingMessages = current.processMessages || [];
                const mergedMessages = [...existingMessages];
                for (const msg of (incomingProcessMessages || [])) {
                  const existingIdx = mergedMessages.findIndex(m => m.timestamp === msg.timestamp && m.type === msg.type);
                  if (existingIdx >= 0) {
                    mergedMessages[existingIdx] = { ...mergedMessages[existingIdx], ...msg };
                  } else {
                    mergedMessages.push(msg);
                  }
                }
                next.set(data.agent_id, {
                  ...current,
                  status: 'decided',
                  action: data.action,
                  timestamp: data.timestamp || Date.now() / 1000,
                  processSteps: mergedSteps,
                  processMessages: mergedMessages.length > 0 ? mergedMessages : undefined
                });
              }
              // 决策完成后，延迟2秒移除状态（淡出效果）
              setTimeout(() => {
                setAgentDecidingStates((p) => {
                  const n = new Map(p);
                  n.delete(data.agent_id);
                  return n;
                });
              }, 2000);
              return next;
            });
            
          } else if (payload.type === 'execution_log') {
            // 后端发送的执行日志（实时滚动显示）
            const data = payload.data;
            // 兼容 type 和 log_type 字段
            const logType = (data.type || data.log_type || 'info') as ExecutionLogEntry['type'];
            const msgText = typeof data.message === 'string' ? data.message.trim() : '';
            
            // 不展示无意义/空的占位日志：后端应传递真实步骤文案
            if (!msgText) return;
            
            const logEntry: ExecutionLogEntry = {
              id: data.id || `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: data.timestamp || Date.now(),
              type: logType,
              message: msgText,
              detail: data.detail,
              duration: data.duration,
              agent_id: data.agent_id,
              agent_name: data.agent_name,
            };
            
            // 对于 thinking 类型的日志，特殊处理
            if (logType === 'thinking') {
              setExecutionLogs(prev => {
                if (msgText === '思考中...') {
                  // 流式更新：查找现有的"思考中..."日志并更新
                  const existingIdx = prev.findIndex(
                    log => log.type === 'thinking' && log.message === '思考中...'
                  );
                  if (existingIdx >= 0) {
                    // 更新现有日志的 detail
                    const updated = [...prev];
                    updated[existingIdx] = { ...updated[existingIdx], detail: data.detail, timestamp: Date.now() };
                    return updated;
                  }
                  // 没有现有日志，添加新的
                  return [...prev.slice(-99), logEntry];
                } else if (msgText === '思考完成') {
                  // 思考完成：替换"思考中..."为"思考完成"
                  const existingIdx = prev.findIndex(
                    log => log.type === 'thinking' && log.message === '思考中...'
                  );
                  if (existingIdx >= 0) {
                    // 替换现有日志
                    const updated = [...prev];
                    updated[existingIdx] = logEntry;
                    return updated;
                  }
                  // 没有现有的"思考中..."日志，直接添加
                  return [...prev.slice(-99), logEntry];
                }
                // 其他 thinking 类型的日志，直接添加
                return [...prev.slice(-99), logEntry];
              });
            } else {
              setExecutionLogs(prev => [...prev.slice(-99), logEntry]); // 保留最近100条
            }
            setIsExecuting(true);
            
          } else if (payload.type === 'agent_thinking') {
            // Agent 开始生成回复，创建占位消息（包含决策步骤）
            const data = payload.data;
            const incomingProcessMessages = normalizeIncomingProcessMessages(data.processMessages, data.processSteps);
            console.log('[Workflow] Agent thinking:', data.agent_name, 'processMessages:', incomingProcessMessages?.length || 0);
            
            // 不再清空日志，保留流式生成过程中的执行日志（包括思考内容）
            // 日志会在下一次新消息开始时自然被新日志替换
            setIsExecuting(true);
            
            // 移除决策状态（已开始回复）
            setAgentDecidingStates((prev) => {
              const next = new Map(prev);
              next.delete(data.agent_id);
              return next;
            });
            
            setMessages((prev) => {
              // 检查是否已有该消息
              const existingIndex = prev.findIndex(m => m.id === data.message_id);
              if (existingIndex >= 0) {
                // 消息已存在，更新 processMessages（实时步骤更新）
                const updated = [...prev];
                updated[existingIndex] = {
                  ...updated[existingIndex],
                  processMessages: incomingProcessMessages || updated[existingIndex].processMessages,
                  ext: {
                    ...(updated[existingIndex].ext || {}),
                    processSteps: normalizeIncomingProcessSteps(data.processSteps) || (updated[existingIndex].ext as any)?.processSteps,
                    processMessages: incomingProcessMessages || (updated[existingIndex].ext as any)?.processMessages,
                  }
                };
                return updated;
              }
              
              // 消息不存在，创建新消息
              const thinkingMessage: Message = {
                id: data.message_id,
                role: 'assistant',
                content: '',
                sender_id: data.agent_id,
                sender_type: 'agent',
                isStreaming: true,
                processMessages: incomingProcessMessages || [],
                ext: {
                  sender_name: data.agent_name,
                  // 不在消息体里携带 base64 头像；由 topicParticipants/Session Avatar 兜底
                  sender_avatar: (typeof data.agent_avatar === 'string' && data.agent_avatar.startsWith('data:image/')) ? undefined : data.agent_avatar,
                  processSteps: normalizeIncomingProcessSteps(data.processSteps) || [],
                  processMessages: incomingProcessMessages || [],
                  in_reply_to: data.in_reply_to
                }
              };
              wasAtBottomRef.current = true;
              return [...prev, thinkingMessage];
            });
            
          } else if (payload.type === 'agent_stream_chunk') {
            // 收到流式 chunk，更新消息内容（包含实时的 processMessages）
            const data = payload.data;
            const incomingProcessMessages = normalizeIncomingProcessMessages(data.processMessages, data.processSteps);
            
            // 调试：检查是否包含图片内容
            const contentPreview = (data.accumulated || data.chunk || '').substring(0, 200);
            const contentLength = (data.accumulated || data.chunk || '').length;
            const hasImage = contentPreview.includes('![') || contentPreview.includes('data:image');
            console.log(`[Workflow] agent_stream_chunk: msgId=${data.message_id}, contentLen=${contentLength}, hasImage=${hasImage}, processMessages=${incomingProcessMessages?.length || 0}`);
            
            setMessages((prev) => {
              const index = prev.findIndex(m => m.id === data.message_id);
              if (index < 0) {
                // 消息不存在，创建新消息
                const newMsg: Message = {
                  id: data.message_id,
                  role: 'assistant',
                  content: data.accumulated || data.chunk,
                  sender_id: data.agent_id,
                  sender_type: 'agent',
                  isStreaming: true,
                  processMessages: incomingProcessMessages || [],
                  ext: {
                    sender_name: data.agent_name,
                    sender_avatar: (typeof data.agent_avatar === 'string' && data.agent_avatar.startsWith('data:image/')) ? undefined : data.agent_avatar,
                    processSteps: normalizeIncomingProcessSteps(data.processSteps) || [],
                    processMessages: incomingProcessMessages || []
                  }
                };
                wasAtBottomRef.current = true;
                return [...prev, newMsg];
              }
              
              // 更新现有消息，合并 processMessages
              const updated = [...prev];
              updated[index] = {
                ...updated[index],
                content: data.accumulated || (updated[index].content + data.chunk),
                isStreaming: true,
                // 更新 processMessages
                processMessages: incomingProcessMessages || updated[index].processMessages || [],
                ext: {
                  ...updated[index].ext,
                  processSteps: normalizeIncomingProcessSteps(data.processSteps) || updated[index].ext?.processSteps || [],
                  processMessages: incomingProcessMessages || (updated[index].ext as any)?.processMessages || []
                }
              };
              wasAtBottomRef.current = true;
              return updated;
            });
            
          } else if (payload.type === 'agent_stream_done') {
            // 流式完成（可能包含错误）
            const data = payload.data;
            const incomingProcessMessages = normalizeIncomingProcessMessages(data.processMessages, data.processSteps);
            const contentLength = (data.content || '').length;
            const hasImage = (data.content || '').includes('![') || (data.content || '').includes('data:image');
            console.log('[Workflow] Agent stream done:', data.message_id, 'contentLen:', contentLength, 'hasImage:', hasImage, 'processMessages:', incomingProcessMessages?.length || 0, 'error:', data.error);
            
            // 使用后端返回的执行日志，如果没有则使用前端的日志
            const backendLogs = data.execution_logs || [];
            const finalLogs = backendLogs.length > 0 
              ? backendLogs 
              : [...executionLogs, {
              id: `done-${Date.now()}`,
              timestamp: Date.now(),
              type: data.error ? 'error' : 'success',
              message: data.error ? `执行失败: ${data.error}` : '执行完成',
            }];
            setExecutionLogs(finalLogs);
            
            // 延迟后清除执行状态（但保留日志，让它在消息中折叠显示）
            setTimeout(() => {
              setIsExecuting(false);
              // 不再清除日志，让它保留在消息的 ext.log 中
            }, 2000);
            
            setMessages((prev) => {
              const index = prev.findIndex(m => m.id === data.message_id);
              if (index < 0) return prev;
              
              const updated = [...prev];
              const existing = updated[index];
              const incomingMedia = Array.isArray(data.media) ? data.media : undefined;
              const normalizedSteps = normalizeIncomingProcessSteps(data.processSteps);
              
              // 如果有错误，更新内容为错误信息，但保留 processMessages
              const content = data.error 
                ? `[错误] ${data.agent_name || 'Agent'} 无法产生回复: ${data.error}`
                : (data.content || existing.content);
              
              updated[index] = {
                ...existing,
                content: content,
                isStreaming: false,
                // 如果后端返回了 media（例如 Gemini 图片生成），即时回显到消息气泡（MediaGallery）
                media: incomingMedia ?? existing.media,
                processMessages: incomingProcessMessages || existing.processMessages,
                // 保存执行日志到 ext.log（统一使用 log 字段）
                executionLogs: finalLogs,
                ext: {
                  ...existing.ext,
                  // 同步写入 ext.media，保证刷新/重进会话后也能回显
                  media: incomingMedia ?? existing.ext?.media,
                  processSteps: normalizedSteps || existing.ext?.processSteps,
                  processMessages: incomingProcessMessages || (existing.ext as any)?.processMessages,
                  log: finalLogs,  // 持久化执行日志到 ext.log
                  executionLogs: finalLogs,  // 向后兼容
                  error: data.error
                }
              };
              setIsLoading(false);
              return updated;
            });
          } else if (payload.type === 'agent_silent') {
            // Agent决定不回答，将信息添加到对应消息的 processMessages 中
            const data = payload.data;
            const incomingProcessMessages = normalizeIncomingProcessMessages(data.processMessages, data.processSteps);
            console.log('[Workflow] Agent silent:', data.agent_name, 'processMessages:', incomingProcessMessages?.length || 0);
            
            // 找到对应的用户消息，将决策信息添加到其 processMessages 中
            if (data.in_reply_to) {
              setMessages((prev) => {
                const index = prev.findIndex(m => m.id === data.in_reply_to);
                if (index < 0) return prev;
                
                const updated = [...prev];
                const existing = updated[index];
                
                // 如果用户消息还没有对应的assistant消息，创建一个占位消息来显示决策过程
                const nextIndex = index + 1;
                const hasReply = nextIndex < updated.length && updated[nextIndex].sender_id === data.agent_id;
                
                if (!hasReply) {
                  // 创建一个占位消息来显示决策过程
                  const decisionMessage: Message = {
                    id: `decision-${data.agent_id}-${data.in_reply_to}`,
                    role: 'assistant',
                    content: '',
                    sender_id: data.agent_id,
                    sender_type: 'agent',
                    processMessages: incomingProcessMessages,
                    ext: {
                      sender_name: data.agent_name,
                      sender_avatar: data.agent_avatar,
                      processSteps: normalizeIncomingProcessSteps(data.processSteps),
                      processMessages: incomingProcessMessages,
                      decision_type: 'silent'
                    }
                  };
                  updated.splice(nextIndex, 0, decisionMessage);
                } else {
                  // 如果已有回复消息，将决策步骤合并到其 ext.processSteps 中
                  updated[nextIndex] = {
                    ...updated[nextIndex],
                    ext: {
                      ...updated[nextIndex].ext,
                      processSteps: [
                        ...(updated[nextIndex].ext?.processSteps || []),
                        ...(normalizeIncomingProcessSteps(data.processSteps) || []),
                      ]
                    }
                  };
                }
                
                return updated;
              });
            }
          } else if (payload.type === 'mcp_call_start') {
            // ========= MCP 调用开始 - 实时显示调用进度 =========
            const data = payload.data;
            console.log('[Workflow] MCP call start:', data.agent_name, 'server:', data.mcp_server_id);

            // 更新决策状态，保留已有步骤并追加新步骤
            setAgentDecidingStates((prev) => {
              const next = new Map(prev);
              const current = next.get(data.agent_id);
              const existingSteps = current?.processSteps || [];
              const incomingSteps = normalizeIncomingProcessSteps(data.processSteps) || [];
              // 合并步骤：保留已有步骤，追加新步骤（去重）
              const mergedSteps = [...existingSteps];
              for (const step of incomingSteps) {
                if (!mergedSteps.some(s => s.timestamp === step.timestamp && s.type === step.type)) {
                  mergedSteps.push(step);
                }
              }
              next.set(data.agent_id, {
                agentName: data.agent_name,
                agentAvatar: data.agent_avatar,
                status: 'deciding',
                inReplyTo: data.in_reply_to,
                timestamp: data.timestamp || Date.now() / 1000,
                processSteps: mergedSteps
              });
              return next;
            });

          } else if (payload.type === 'mcp_call_done') {
            // ========= MCP 调用完成 - 更新调用结果 =========
            const data = payload.data;
            const stepStatus = data.step?.status || 'unknown';
            console.log('[Workflow] MCP call done:', data.agent_name, 'server:', data.mcp_server_id, 'status:', stepStatus);

            // 更新决策状态中的 processSteps（合并而非覆盖）
            setAgentDecidingStates((prev) => {
              const next = new Map(prev);
              const current = next.get(data.agent_id);
              if (current) {
                const existingSteps = current.processSteps || [];
                const incomingSteps = normalizeIncomingProcessSteps(data.processSteps) || [];
                // 合并步骤：保留已有，更新同类型同时间戳的步骤状态
                const mergedSteps = [...existingSteps];
                for (const step of incomingSteps) {
                  const existingIdx = mergedSteps.findIndex(s => s.timestamp === step.timestamp && s.type === step.type);
                  if (existingIdx >= 0) {
                    // 更新已有步骤（可能状态变化）
                    mergedSteps[existingIdx] = { ...mergedSteps[existingIdx], ...step };
                  } else {
                    mergedSteps.push(step);
                  }
                }
                next.set(data.agent_id, {
                  ...current,
                  timestamp: data.timestamp || Date.now() / 1000,
                  processSteps: mergedSteps
                });
              }
              return next;
            });

          } else if (payload.type === 'agent_tool_unavailable') {
            // 工具不可用，将信息添加到对应消息的 processSteps 中
            const data = payload.data;
            console.log('[Workflow] Agent tool unavailable:', data.agent_name, data.tool_name);
            
            if (data.in_reply_to) {
              setMessages((prev) => {
                const index = prev.findIndex(m => m.id === data.in_reply_to);
                if (index < 0) return prev;
                
                const updated = [...prev];
                // 找到或创建对应的agent回复消息，添加processSteps
                const agentMessageIndex = updated.findIndex((m, idx) => 
                  idx > index && m.sender_id === data.agent_id && m.role === 'assistant'
                );
                
                if (agentMessageIndex >= 0) {
                  updated[agentMessageIndex] = {
                    ...updated[agentMessageIndex],
                    ext: {
                      ...updated[agentMessageIndex].ext,
                      processSteps: [...(updated[agentMessageIndex].ext?.processSteps || []), ...(data.processSteps || [])]
                    }
                  };
                }
                
                return updated;
              });
            }
          }
        } catch (error) {
          console.error('[Workflow] Failed to parse topic event:', error, event.data);
        }
      };

      eventSource.onerror = (err) => {
        // EventSource 错误可能是暂时的（如网络波动），也可能是持续的
        // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
        const readyState = eventSource.readyState;
        console.error('[Workflow] Topic stream error:', {
          readyState,
          readyStateText: readyState === 0 ? 'CONNECTING' : readyState === 1 ? 'OPEN' : 'CLOSED',
          type: (err as any)?.type,
        });
        
        // 关闭当前连接
        eventSource.close();
        
        // 如果组件已卸载，不重连
        if (!isComponentMounted) {
          return;
        }
        
        // 检查是否超过最大重连次数
        if (reconnectAttempts >= maxReconnectAttempts) {
          console.error('[Workflow] Max reconnect attempts reached, giving up');
          return;
        }
        
        // 指数退避重连：1s, 2s, 4s, 8s, 16s, 最大 30s
        const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        
        console.log(`[Workflow] Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
        
        reconnectTimeoutId = setTimeout(() => {
          if (isComponentMounted && currentSessionId && (currentSessionType === 'topic_general' || currentSessionType === 'agent')) {
            console.log('[Workflow] Attempting to reconnect to topic stream...');
            setupTopicStream();
          }
        }, delay);
      };

      return eventSource;
    };

    const es = setupTopicStream();

    return () => {
      isComponentMounted = false;
      if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
      }
      if (es) {
        console.log('[Workflow] Unsubscribing from topic stream:', currentSessionId);
        es.close();
      }
    };
  }, [currentSessionId, currentSessionType]);

  // 当选择会话时，加载历史消息、头像和人设
  useEffect(() => {
    if (currentSessionId) {
      // 正常加载会话
      const session = sessions.find(s => s.session_id === currentSessionId);
        // NOTE: 旧逻辑里区分 agent/temporary 的分支已不再依赖该布尔值
        
        // 统一使用分页加载（懒加载），避免消息过多时性能问题
        loadSessionMessages(currentSessionId, 1);
        loadSessionSummaries(currentSessionId);
        
        // 加载会话头像和人设
        if (session) {
          setCurrentSessionMeta(session);
          setCurrentSessionAvatar(session.avatar || null);
          setCurrentSystemPrompt(session.system_prompt || null);
        } else if (!currentSessionMeta || currentSessionMeta.session_id !== currentSessionId) {
          // 仅当会话 ID 确实变更且本地无缓存时才重置，避免加载过程中的闪烁
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

              // 拉取参与者（如果是话题模式）
              const freshIsTopic = fresh.session_type === 'topic_general';
              if (freshIsTopic) {
                const participants = await getParticipants(currentSessionId);
                setTopicParticipants(participants);
              }
            } catch (error) {
              console.warn('[Workflow] Failed to fetch session detail in effect:', currentSessionId, error);
              // 如果会话不存在且不是默认 agent，通知父组件切换到默认 agent
              if (error && (error as any).status === 404 && currentSessionId !== 'agent_chaya') {
                console.log('[Workflow] Session not found, switching to default agent');
                if (onSelectSession) {
                  onSelectSession('agent_chaya');
                }
              }
            }
          })();
          return () => {
            canceled = true;
          };
        } else {
          // 如果列表里已有，根据类型决定是否拉取参与者
          const isTopic = session.session_type === 'topic_general';
          if (isTopic) {
            getParticipants(currentSessionId).then(participants => {
              setTopicParticipants(participants);
            }).catch(err => {
              console.warn('[Workflow] Failed to load participants in effect:', err);
            });
          } else {
            setTopicParticipants([]);
          }
        }
        // 加载技能包
        getSessionSkillPacks(currentSessionId).then(packs => {
          setCurrentSessionSkillPacks(packs);
        }).catch(err => {
          console.error('[Workflow] Failed to load skill packs:', err);
        });
        
        // 加载当前SOP（话题群专用）
        if (session?.session_type === 'topic_general') {
          getCurrentSop(currentSessionId).then(sop => {
            setCurrentSopSkillPack(sop);
          }).catch(err => {
            console.error('[Workflow] Failed to load current SOP:', err);
            setCurrentSopSkillPack(null);
          });
      } else {
        setCurrentSopSkillPack(null);
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
  }, [currentSessionId, sessions]);
  
  // 当弹框显示时：只滚动到底部（位置由 useChatInput 计算的 bottom/left 决定）
  // NOTE: 之前这里会直接写 selector.style.top，与渲染层使用 bottom/left 存在冲突，
  // 在某些布局/分辨率下会导致弹框“看不到”（跑飞/被挤出视口）。
  useEffect(() => {
    if (showAtSelector && selectorRef.current && inputRef.current) {
      // 使用 setTimeout 确保 DOM 已更新
      setTimeout(() => {
        if (selectorRef.current && inputRef.current) {
          const selector = selectorRef.current;
          // 滚动到底部，使最新内容在底部显示
          selector.scrollTop = selector.scrollHeight;
        }
      }, 10); // 稍微延迟以确保内容已渲染
    }
  }, [showAtSelector, atSelectorQuery, mcpServers]);
  
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
    // 统一走 useConversation
    if (!session_id) {
      return;
    }

    try {
      setIsLoadingMessages(true);

      if (page === 1) {
        setSelectedBatchItem(null);
        setShowNewMessagePrompt(false);
        setUnreadMessageCount(0);
        await loadPersistedInitial({ force: true });
        setVirtuosoFirstItemIndex(VIRTUOSO_BASE_INDEX);
        historyAutoFiredInNearTopRef.current = false;
        historyCooldownUntilRef.current = 0;
        setMessagePage(1);
        return;
      }

      // 加载更多历史消息：Virtuoso 使用 firstItemIndex 做 prepend 锚定，避免 DOM offsetTop 的脆弱方案
      const prevCount = messagesRef.current.length;
      isLoadingMoreRef.current = true;
      shouldMaintainScrollRef.current = true;

      const added = await loadMorePersistedMessages();
      setMessagePage(page);
      if (added > 0) {
        setVirtuosoFirstItemIndex((prev) => Math.max(0, prev - added));
        lastMessageCountRef.current = prevCount + added;
      } else {
        lastMessageCountRef.current = prevCount;
      }
      isLoadingMoreRef.current = false;
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const triggerLoadMoreHistory = useCallback(
    async (source: 'manual' | 'auto') => {
      if (!currentSessionId) return;
      if (!hasMoreMessages) return;
      if (isLoadingMessages) return;
      if (isLoadingMoreRef.current) return;

      const now = Date.now();
      if (now < historyCooldownUntilRef.current) return;
      if (source === 'auto' && historyAutoFiredInNearTopRef.current) return;

      // 触发一次后，在离开顶部前不再自动触发（防止“加载完仍在顶部 → 连环加载”）
      historyAutoFiredInNearTopRef.current = true;

      // 取消“顶部停留”计时器
      if (historyTopStayTimerRef.current) {
        clearTimeout(historyTopStayTimerRef.current);
        historyTopStayTimerRef.current = null;
      }

      const prevCount = messages.length;
      setIsLoadingMessages(true);
      isLoadingMoreRef.current = true;
      shouldMaintainScrollRef.current = true;
      try {
        const added = await loadMorePersistedMessages();
        setMessagePage((p) => p + 1);
        if (added > 0) {
          setVirtuosoFirstItemIndex((prev) => Math.max(0, prev - added));
          lastMessageCountRef.current = prevCount + added;
        } else {
          lastMessageCountRef.current = prevCount;
        }
      } finally {
        isLoadingMoreRef.current = false;
        setIsLoadingMessages(false);
        historyCooldownUntilRef.current = Date.now() + 900;
      }
    },
    [currentSessionId, hasMoreMessages, isLoadingMessages, loadMorePersistedMessages]
  );

  // 顶部停留触发（hybrid）：接近顶部后停留一段时间，只自动触发一次
  useEffect(() => {
    if (!isNearTop || !hasMoreMessages) return;
    if (historyAutoFiredInNearTopRef.current) return;

    if (historyTopStayTimerRef.current) {
      clearTimeout(historyTopStayTimerRef.current);
    }

    historyTopStayTimerRef.current = setTimeout(() => {
      if (!isNearTop) return;
      if (scrollTopRef.current > 20) return;
      void triggerLoadMoreHistory('auto');
    }, 800);

    return () => {
      if (historyTopStayTimerRef.current) {
        clearTimeout(historyTopStayTimerRef.current);
        historyTopStayTimerRef.current = null;
      }
    };
  }, [hasMoreMessages, isNearTop, triggerLoadMoreHistory]);
  
  // 加载会话总结
  const loadSessionSummaries = async (session_id: string) => {
    try {
      const summaryList = await getSessionSummaries(session_id);
      setSummaries(summaryList);
    } catch (error) {
      console.error('[Workflow] Failed to load summaries:', error);
    }
  };

  // 选择会话
  const handleSelectSession = async (session_id: string) => {
    // 如果已经是当前选中的会话且元数据已存在，则跳过（避免闪烁）
    if (session_id === currentSessionId && currentSessionMeta) {
      return;
    }

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
    
    // 切换会话时，清除 Agent 决策状态（避免在非 topic 会话中显示）
    setAgentDecidingStates(new Map());
    
    // 选择会话
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
    } else if (currentSessionId !== session_id) {
      // 只有在 ID 确实变了且找不到新详情时才重置
      setCurrentSessionMeta(null);
      setCurrentSessionAvatar(null);
      setCurrentSystemPrompt(null);
    }
  };
  
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<{
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
      const [configs, providersData] = await Promise.all([
        getLLMConfigs(),
        getProviders().catch(() => []) // 如果获取失败，使用空数组
      ]);
      console.log('[Workflow] Loaded LLM configs:', configs);
      console.log('[Workflow] Loaded providers:', providersData);
      
      setProviders(providersData);
      
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

  const handleSend = async (overrideInput?: string) => {
    const effectiveInput = overrideInput ?? input;
    // 允许发送文本或图片（至少有一个）
    if ((!effectiveInput.trim() && attachedMedia.length === 0) || isLoading) return;

    // 检查会话类型，确定是否使用 AgentActor 模型
    // - topic_general：多人话题，使用 AgentActor，需要检查是否有 Agent 参与者
    // - agent：私聊，使用 AgentActor，Agent 就是会话本身
    // - temporary：临时会话，前端直接调用 LLM
    const session = sessions.find(s => s.session_id === currentSessionId) || currentSessionMeta;
    const isAgentActorMode = session?.session_type === 'topic_general' || session?.session_type === 'agent';
    
    // 在 topic_general 中检查是否有 Agent 参与者
    if (session?.session_type === 'topic_general') {
      const agents = topicParticipants.filter(p => p.participant_type === 'agent');
      if (agents.length === 0) {
        const errorMsg: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: '❌ 该话题中没有智能体，无法发送问题。请先点击左上角头像配置话题并添加参与者。',
        };
        setMessages(prev => [...prev, errorMsg]);
        return;
      }
    }

    // 检查配置（非 AgentActor 模式下必须选择模型）
    if (!isAgentActorMode && (!selectedLLMConfigId || !selectedLLMConfig)) {
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
      await handleResendMessage(editingMessageIdRef.current, effectiveInput.trim());
      return;
    }

    // 检查是否有选定的组件（tag）
    // MCP通过selectedMcpServerIds在正常对话中使用工具
    // 工作流功能已移除

    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const newSession = await createSession(selectedLLMConfigId || undefined, effectiveInput.trim().substring(0, 50), 'agent');
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
    
    // 如果有引用消息，在内容前添加引用信息
    let messageContent = effectiveInput.trim() || (attachedMedia.length > 0 ? '[包含媒体内容]' : '');
    if (quotedMessageId) {
      const quotedMsg =
        quotedMessageSnapshot ||
        messages.find(m => m.id === quotedMessageId);
      if (quotedMsg) {
        const content = quotedMsg.content || '';
        const quotedContent = content.length > 200 
          ? content.substring(0, 200) + '...' 
          : content;
        // 如果是 Agent 消息，添加发送者信息
        const msgExt = ('ext' in quotedMsg ? (quotedMsg.ext || {}) : {}) as Record<string, any>;
        const senderName = quotedMsg.role === 'assistant'
          ? (quotedMessageSnapshot?.senderName || msgExt.sender_name || (quotedMsg as any).sender_name || 'Agent')
          : '用户';
        const quoteHeader = quotedMsg.role === 'assistant' 
          ? `[引用 ${senderName} 的消息]`
          : '[引用消息]';
        messageContent = `${quoteHeader}\n${quotedContent}\n\n---\n\n${messageContent}`;
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

    // 提取提及的智能体 (Mentions)
    const mentions: string[] = [];
    if (topicParticipants.length > 0) {
      const mentionRegex = /@([^\s@]+)/g;
      let match;
      while ((match = mentionRegex.exec(messageContent)) !== null) {
        const name = match[1];
        const participant = topicParticipants.find(p => p.name === name);
        if (participant && participant.participant_id) {
          mentions.push(participant.participant_id);
        }
      }
    }

    // 记录发送的媒体信息
    if (attachedMedia.length > 0) {
      console.log('[Workflow] 发送消息包含媒体:', attachedMedia.map(m => ({
        type: m.type,
        mimeType: m.mimeType,
        dataSize: Math.round(m.data.length / 1024) + 'KB',
      })));
    }

    // 发送消息时，强制跳转到最后一条消息
    wasAtBottomRef.current = true;
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setAttachedMedia([]); // 清空已发送的媒体
    clearQuotedMessage(); // 清空引用消息
    setIsLoading(true);
    
    // 保存用户消息到数据库
    if (sessionId) {
      try {
        if (!selectedLLMConfig) {
          toast({ title: '请先选择 LLM 模型', variant: 'destructive' });
          return;
        }
        // 保存时包含媒体信息：必须放到 ext 中（后端 /api/sessions/<id>/messages 会忽略 tool_calls）
        const messageData: any = {
          message_id: userMessageId,
          role: 'user',
          content: userMessage.content,
          model: selectedLLMConfig.model || 'gpt-4',
          mentions: mentions.length > 0 ? mentions : undefined,
        };
        
        // 如果有媒体内容，保存到 ext.media（用于刷新/重进会话后的回显）
        if (userMessage.media && userMessage.media.length > 0) {
          messageData.ext = {
            ...(messageData.ext || {}),
            media: userMessage.media,
          };
        }

        // 生图开关：写入 ext，供后端 AgentActor 决定是否回灌历史媒体（thoughtSignature）
        const isImageGenModel = (selectedLLMConfig?.model || '').toLowerCase().includes('image');
        if (isImageGenModel) {
          messageData.ext = {
            ...(messageData.ext || {}),
            imageGen: {
              useThoughtSignature,
            },
          };
        }

        // 如果在 AgentActor 模式（topic_general 或 agent）中，且选择了工具，将工具 ID 放入 ext 中以便 AgentActor 识别
        const sessionForActor = sessions.find(s => s.session_id === currentSessionId) || currentSessionMeta;
        const isActorSession = sessionForActor?.session_type === 'topic_general' || sessionForActor?.session_type === 'agent';
        if (isActorSession) {
          const mcp_servers = Array.from(selectedMcpServerIds);
          const skill_pack_ids = selectedComponents
            .filter(c => c.type === 'skillpack')
            .map(c => c.id);
          
          messageData.ext = {
            ...(messageData.ext || {}),
          };
          
          if (mcp_servers.length > 0 || skill_pack_ids.length > 0) {
            messageData.ext.mcp_servers = mcp_servers;
            messageData.ext.skill_packs = skill_pack_ids;
          }
          messageData.ext.use_tool_calling = toolCallingEnabled;
          if (attachedMedia.length > 0) {
            messageData.ext.attachments = attachedMedia.map(item => ({
              type: item.type,
              mimeType: item.mimeType,
            }));
          }
          
          // 私聊模式（agent类型）：传递用户选择的模型配置ID
          if (sessionForActor?.session_type === 'agent' && selectedLLMConfigId) {
            messageData.ext.user_llm_config_id = selectedLLMConfigId;
          }
        }
        
        await saveMessage(sessionId, messageData);

        // 如果是 AgentActor 模式（topic_general 或 agent），保存后直接结束，不由前端发起 LLM 调用，而是等待 AgentActor 响应
        if (isActorSession) {
          setIsLoading(false);
          setInput('');
          setAttachedMedia([]);
          clearQuotedMessage();
          return;
        }
      } catch (error) {
        console.error('[Workflow] Failed to save user message:', error);
      }
    }

    try {
      if (!selectedLLMConfigId || !selectedLLMConfig) {
        toast({ title: '请先选择 LLM 模型', variant: 'destructive' });
        return;
      }
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
      const toolsForRequest = toolCallingEnabled && allTools.length > 0 ? allTools : [];

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
      if (summaries.length > 0 ) {
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
      
      if (allAvailableSkillPacks.length > 0 ) {
        systemPrompt += `\n\n【可用技能包】\n以下是你可以参考使用的技能包。如果决定使用某个技能包，请在响应中明确说明："我将使用技能包：[技能包名称]"。\n\n`;
        allAvailableSkillPacks.forEach((pack, index) => {
          systemPrompt += `技能包 ${index + 1}: ${pack.name}\n${pack.summary}\n\n`;
        });
      }
      
      if (toolCallingEnabled && allTools.length > 0) {
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
      const baseMessagesToSend = lastSummaryIndex >= 0 ? messages.slice(lastSummaryIndex) : messages;
      const messagesToSend = baseMessagesToSend;
      
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
        
        // tool 消息（如 MCP）排除
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
            const raw = (media as any).data ?? (media as any).url ?? '';
            const b64 = toInlineBase64(raw);
            if (!b64) continue; // 跳过坏图，避免整轮对话被 Gemini 400
            llmMsg.parts.push({
              inlineData: {
                mimeType: media.mimeType,
                data: b64,
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
      if (needsSummarize && sessionId ) {
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
      
      // 流式更新节流：缓冲最新状态，每 33ms（~30fps）最多刷新一次
      let pendingUpdate: {
        content: string;
        thinking?: string;
        isThinking?: boolean;
        isStreaming?: boolean;
        currentStep?: string;
      } | null = null;
      let rafId: number | null = null;
      
      const buildProcessMessagesSafe = () => buildProcessMessages(currentProcessSteps);

      const flushPendingUpdate = () => {
        if (!pendingUpdate) return;
        const { content, thinking, isThinking, isStreaming, currentStep } = pendingUpdate;
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
                processMessages: buildProcessMessagesSafe(),
              }
            : msg
        ));
        pendingUpdate = null;
        rafId = null;
      };
      
      // 创建临时消息更新函数（包含过程步骤）- 带节流
      const updateMessage = (content: string, thinking?: string, isThinking?: boolean, isStreaming?: boolean, currentStep?: string) => {
        // 检测思考内容变化，如果有新的思考内容，添加到过程步骤
        const thinkingContent = thinking !== undefined ? thinking : '';
        if (thinkingContent.length > lastThinkingLength && thinkingContent.trim()) {
          console.log(`[Workflow] 检测到思考内容变化:`, thinkingContent.length, '字符 (之前:', lastThinkingLength, ')');
          // 查找现有的思考步骤
          const existingThinkingStep = currentProcessSteps.find(s => s.type === 'thinking' && !s.mcpServer);
          if (existingThinkingStep) {
            // 更新现有思考步骤的内容
            console.log(`[Workflow] 更新现有思考步骤`);
            existingThinkingStep.thinking = thinkingContent;
            if (!existingThinkingStep.status) existingThinkingStep.status = 'running';
          } else {
            // 创建新的思考步骤
            console.log(`[Workflow] 创建新的思考步骤`);
            currentProcessSteps.push({
              type: 'thinking',
              timestamp: Date.now(),
              thinking: thinkingContent,
              status: 'running',
            });
          }
          lastThinkingLength = thinkingContent.length;
        }
        
        // 如果 isStreaming=false，立即刷新（最终状态）
        if (isStreaming === false) {
          // 结束生成：将思考步骤标记为完成
          currentProcessSteps.forEach((s) => {
            if (s.type === 'thinking' && s.status === 'running') {
              s.status = 'completed';
              if (s.timestamp) {
                s.duration = Date.now() - s.timestamp;
              }
            }
          });
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          pendingUpdate = { content, thinking, isThinking, isStreaming, currentStep };
          flushPendingUpdate();
          return;
        }
        
        // 缓冲更新，等待下一帧刷新
        pendingUpdate = { content, thinking, isThinking, isStreaming, currentStep };
        if (!rafId) {
          rafId = requestAnimationFrame(flushPendingUpdate);
        }
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
        
        // 使用节流更新，避免频繁 setMessages 导致输入卡顿
        // 将 currentStep 合并到 pendingUpdate 中，在下一帧统一刷新
        if (pendingUpdate) {
          pendingUpdate = { ...pendingUpdate, currentStep: step };
        } else {
          pendingUpdate = { content: fullResponse, thinking: fullThinking, isThinking: undefined, isStreaming: true, currentStep: step };
        }
        if (!rafId) {
          rafId = requestAnimationFrame(flushPendingUpdate);
        }
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
        console.log(`[Workflow] MCP 调用:`, info.toolName, info.status, '结果:', info.result ? '有结果' : '无结果', typeof info.result);
        
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
        tools: toolsForRequest.length > 0 ? toolsForRequest : undefined,
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
              const b64 = toInlineBase64(media.data);
              if (!b64) continue;
              userLLMMessage.parts.push({
                inlineData: {
                  mimeType: media.mimeType,
                  data: b64,
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
            toolsForRequest.length > 0 ? toolsForRequest : undefined,
            true, // 启用流式响应
            (chunk: string, thinking?: string) => {
              // 流式更新消息内容
              if (chunk) {
                fullResponse += chunk;
                hasStartedContent = true;
              }
              
              // 更新思考过程（即使 thinking 是空字符串也要更新，确保UI能正确显示）
              if (thinking !== undefined) {
                console.log(`[Workflow] 收到思考内容更新:`, thinking.length, '字符', thinking.substring(0, 100));
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
          if (sessionId ) {
            try {
              const messageData: any = {
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
              } else {
                console.log(`[Workflow] 响应中没有媒体内容: response.media =`, response.media);
              }
              // 保存过程步骤（思考和MCP调用历史）
              if (currentProcessSteps.length > 0) {
                extData.processMessages = buildProcessMessages(currentProcessSteps);
                console.log(`[Workflow] 保存 ${currentProcessSteps.length} 个过程步骤到数据库:`, currentProcessSteps.map(s => ({
                  type: s.type,
                  toolName: s.toolName,
                  hasResult: s.result !== undefined,
                  resultPreview: typeof s.result === 'object' ? JSON.stringify(s.result).substring(0, 100) : String(s.result).substring(0, 100),
                  status: s.status
                })));
              }

              console.log(`[Workflow] extData keys:`, Object.keys(extData));
              // 如果有媒体内容，强制创建 ext 字段
              if (Object.keys(extData).length > 0 || (response.media && response.media.length > 0)) {
                // 确保媒体内容被包含在 extData 中
                if (response.media && response.media.length > 0 && !extData.media) {
                  extData.media = response.media;
                  console.log(`[Workflow] 强制添加媒体内容到 extData`);
                }
                messageData.ext = extData;
                console.log(`[Workflow] 设置 messageData.ext:`, extData);
              } else {
                console.log(`[Workflow] extData 为空，不设置 messageData.ext`);
              }
              
              console.log('[Workflow] 保存消息数据到数据库:', {
                hasExt: !!messageData.ext,
                extKeys: messageData.ext ? Object.keys(messageData.ext) : [],
                mediaCount: messageData.ext?.media?.length || 0,
                messageData: JSON.stringify(messageData).substring(0, 200) + '...'
              });
              const saveResult = await saveMessage(sessionId, messageData);
              console.log('[Workflow] Saved assistant message to database:', saveResult.message_id);

              // 更新消息的实际 message_id（后端生成）
              setMessages(prev => prev.map(msg =>
                msg.id === assistantMessageId
                  ? { ...msg, message_id: saveResult.message_id }
                  : msg
              ));
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
              const b64 = toInlineBase64(media.data);
              if (!b64) continue;
              userLLMMessage.parts.push({
                inlineData: {
                  mimeType: media.mimeType,
                  data: b64,
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
            toolsForRequest.length > 0 ? toolsForRequest : undefined,
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
          if (sessionId ) {
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
              } else {
                console.log(`[Workflow] 响应中没有媒体内容: response.media =`, response.media);
              }
              // 保存过程步骤（思考和MCP调用历史）
              if (currentProcessSteps.length > 0) {
                extData.processMessages = buildProcessMessages(currentProcessSteps);
                console.log(`[Workflow] 保存 ${currentProcessSteps.length} 个过程步骤到数据库:`, currentProcessSteps.map(s => ({
                  type: s.type,
                  toolName: s.toolName,
                  hasResult: s.result !== undefined,
                  resultPreview: typeof s.result === 'object' ? JSON.stringify(s.result).substring(0, 100) : String(s.result).substring(0, 100),
                  status: s.status
                })));
              }

              console.log(`[Workflow] extData keys:`, Object.keys(extData));
              // 如果有媒体内容，强制创建 ext 字段
              if (Object.keys(extData).length > 0 || (response.media && response.media.length > 0)) {
                // 确保媒体内容被包含在 extData 中
                if (response.media && response.media.length > 0 && !extData.media) {
                  extData.media = response.media;
                  console.log(`[Workflow] 强制添加媒体内容到 extData`);
                }
                messageData.ext = extData;
                console.log(`[Workflow] 设置 messageData.ext:`, extData);
              } else {
                console.log(`[Workflow] extData 为空，不设置 messageData.ext`);
              }
              
              console.log('[Workflow] 保存消息数据到数据库:', {
                hasExt: !!messageData.ext,
                extKeys: messageData.ext ? Object.keys(messageData.ext) : [],
                mediaCount: messageData.ext?.media?.length || 0,
                messageData: JSON.stringify(messageData).substring(0, 200) + '...'
              });
              const saveResult = await saveMessage(sessionId, messageData);
              console.log('[Workflow] Saved assistant message to database:', saveResult.message_id);

              // 更新消息的实际 message_id（后端生成）
              setMessages(prev => prev.map(msg =>
                msg.id === assistantMessageId
                  ? { ...msg, message_id: saveResult.message_id }
                  : msg
              ));
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
      
      // 流式更新节流：缓冲最新状态，每帧最多刷新一次
      let retryPendingUpdate: {
        content: string;
        thinking?: string;
        isThinking?: boolean;
        isStreaming?: boolean;
        currentStep?: string;
      } | null = null;
      let retryRafId: number | null = null;
      
      const flushRetryPendingUpdate = () => {
        if (!retryPendingUpdate) return;
        const { content, thinking, isThinking, isStreaming, currentStep } = retryPendingUpdate;
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
        retryPendingUpdate = null;
        retryRafId = null;
      };
      
      const updateMessage = (content: string, thinking?: string, isThinking?: boolean, isStreaming?: boolean, currentStep?: string) => {
        // 如果 isStreaming=false，立即刷新（最终状态）
        if (isStreaming === false) {
          if (retryRafId) {
            cancelAnimationFrame(retryRafId);
            retryRafId = null;
          }
          retryPendingUpdate = { content, thinking, isThinking, isStreaming, currentStep };
          flushRetryPendingUpdate();
          return;
        }
        
        // 缓冲更新，等待下一帧刷新
        retryPendingUpdate = { content, thinking, isThinking, isStreaming, currentStep };
        if (!retryRafId) {
          retryRafId = requestAnimationFrame(flushRetryPendingUpdate);
        }
      };
      
      // 步骤变化回调（用于重试）- 也使用节流
      let retryStepPending: string | null = null;
      let retryStepRafId: number | null = null;
      
      const flushRetryStepUpdate = () => {
        if (retryStepPending === null) return;
        const step = retryStepPending;
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { 
                ...msg, 
                currentStep: step,
              }
            : msg
        ));
        retryStepPending = null;
        retryStepRafId = null;
      };
      
      const handleStepChange = (step: string) => {
        retryStepPending = step;
        if (!retryStepRafId) {
          retryStepRafId = requestAnimationFrame(flushRetryStepUpdate);
        }
      };
      
      // 保留原有的 handleStepChange 设置逻辑，但不再直接调用 setMessages
      const _legacyHandleStepChange = (step: string) => {
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
          console.log(`[Workflow] 非流式模式设置媒体到消息状态:`, response.media.map(m => `${m.type}(${m.mimeType}, ${Math.round(m.data?.length / 1024)}KB)`).join(', '));
          setMessages(prev => prev.map(msg =>
            msg.id === messageId ? { ...msg, media: response.media } : msg
          ));
        } else {
          console.log(`[Workflow] 非流式响应中没有媒体: response.media =`, response.media);
        }

        if (finalThinking && finalThinking.trim().length > 0) {
          setCollapsedThinking(prev => new Set(prev).add(messageId));
        }
        
        // 保存到数据库（临时会话不保存）
        if (request.sessionId ) {
          try {
            const messageData: any = {
              message_id: messageId,
              role: 'assistant',
              content: finalContent,
              thinking: finalThinking,
              model: request.model || 'gpt-4',
            };
            
            // 保存媒体内容到 ext 中（后端 /api/sessions/<id>/messages 会忽略 tool_calls）
            if (response.media && response.media.length > 0) {
              messageData.ext = {
                ...(messageData.ext || {}),
                media: response.media,
              };
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
            
            // 保存媒体内容到 ext 中（后端 /api/sessions/<id>/messages 会忽略 tool_calls）
            if (response.media && response.media.length > 0) {
              messageData.ext = {
                ...(messageData.ext || {}),
                media: response.media,
              };
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
    
    // 获取可用的LLM配置ID - 优先使用已选择的，否则用第一个可用的
    let llmConfigIdToUse = selectedLLMConfigId;
    if (!llmConfigIdToUse) {
      const enabledConfigs = llmConfigs.filter(c => Boolean(c.enabled));
      if (enabledConfigs.length > 0) {
        llmConfigIdToUse = enabledConfigs[0].config_id;
      }
    }
    
    if (!llmConfigIdToUse) {
      alert('请先配置一个可用的LLM模型用于生成技能包总结');
      return;
    }
    
    try {
      setIsCreatingSkillPack(true);
      
      const result = await createSkillPack({
        session_id: currentSessionId,
        message_ids: Array.from(selectedMessageIds),
        llm_config_id: llmConfigIdToUse,
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

  // 创建SOP技能包
  const handleCreateSop = async () => {
    if (!sopName.trim() || !sopText.trim()) {
      toast({ title: 'SOP名称和内容不能为空', variant: 'destructive' });
      return;
    }
    
    setIsCreatingSop(true);
    try {
      const result = await createSopSkillPack({
        name: sopName.trim(),
        sop_text: sopText.trim(),
        assign_to_session_id: currentSessionId && currentSessionType === 'topic_general' ? currentSessionId : undefined,
        set_as_current: currentSessionId && currentSessionType === 'topic_general' ? true : undefined,
      });
      
      toast({ title: `SOP "${result.name}" 创建成功`, variant: 'success' });
      setShowAddSopDialog(false);
      setSopName('');
      setSopText('');
      
      // 刷新技能包列表和当前SOP
      loadSkillPacks();
      if (currentSessionId) {
        getSessionSkillPacks(currentSessionId).then(packs => {
          setCurrentSessionSkillPacks(packs);
        });
        if (currentSessionType === 'topic_general') {
          getCurrentSop(currentSessionId).then(sop => {
            setCurrentSopSkillPack(sop);
          });
        }
      }
    } catch (error: any) {
      console.error('[Workflow] Failed to create SOP:', error);
      toast({ title: `创建SOP失败: ${error.message}`, variant: 'destructive' });
    } finally {
      setIsCreatingSop(false);
    }
  };

  // 设置当前SOP
  const handleSetCurrentSop = async (skillPackId: string) => {
    if (!currentSessionId) return;
    
    try {
      await setCurrentSop(currentSessionId, skillPackId);
      const sop = await getCurrentSop(currentSessionId);
      setCurrentSopSkillPack(sop);
      toast({ title: `已设置当前SOP: ${sop?.name || skillPackId}`, variant: 'success' });
    } catch (error: any) {
      console.error('[Workflow] Failed to set current SOP:', error);
      toast({ title: `设置SOP失败: ${error.message}`, variant: 'destructive' });
    }
  };

  // 取消当前SOP
  const handleClearCurrentSop = async () => {
    if (!currentSessionId) return;
    
    try {
      await setCurrentSop(currentSessionId, null);
      setCurrentSopSkillPack(null);
      toast({ title: '已取消当前SOP', variant: 'success' });
    } catch (error: any) {
      console.error('[Workflow] Failed to clear current SOP:', error);
      toast({ title: `取消SOP失败: ${error.message}`, variant: 'destructive' });
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

  // 开始编辑消息
  const handleStartEdit = (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (message && message.role === 'user') {
      editingMessageIdRef.current = messageId;
      setEditingMessageId(messageId);
      setInput(message.content);
      // 恢复该条消息的媒体附件（用于"编辑/重发"时保留图片等）
      if (message.media && message.media.length > 0) {
        setAttachedMedia(
          message.media.map(m => {
            // UnifiedMedia 使用 url 字段存储数据，兼容可能存在的 data 字段
            const rawData = (m as any).data || m.url || '';
            return {
              type: m.type,
              mimeType: m.mimeType || 'image/jpeg',
              data: rawData,
              // 统一用 base64/dataURL 渲染
              preview: ensureDataUrlFromMaybeBase64(rawData, m.mimeType || 'image/jpeg'),
            };
          })
        );
      } else {
        setAttachedMedia([]);
      }
      inputRef.current?.focus();
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    editingMessageIdRef.current = null;
    setEditingMessageId(null);
    setInput('');
    setAttachedMedia([]);
  };

  // 引用消息（支持引用用户消息和 Agent 消息，会同步恢复该消息的媒体附件）
  const handleQuoteMessage = async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    // 支持引用 user 和 assistant (agent) 消息
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) return;

    setQuotedMessageId(messageId);
    const msgExt = (message.ext || {}) as Record<string, any>;
    const senderName = message.role === 'assistant'
      ? (msgExt.sender_name || (message as any).sender_name || 'Agent')
      : '用户';
    setQuotedMessageSnapshot({
      id: message.id,
      role: message.role,
      senderName,
      content: message.content || '',
      media: message.media || [],
    });

    // 将被引用消息的媒体附件合并到当前附件里（去重）
    if (message.media && message.media.length > 0) {
      setAttachedMedia(prev => {
        const next = [...prev];
        for (const m of message.media || []) {
          // UnifiedMedia 使用 url 字段存储数据，兼容可能存在的 data 字段
          const rawData = (m as any).data || m.url || '';
          const key = `${m.type}:${m.mimeType}:${rawData.slice(0, 128)}`;
          const exists = next.some(x => `${x.type}:${x.mimeType}:${(x.data || '').slice(0, 128)}` === key);
          if (!exists && rawData) {
            next.push({
              type: m.type,
              mimeType: m.mimeType || 'image/jpeg',
              data: rawData,
              preview: ensureDataUrlFromMaybeBase64(rawData, m.mimeType || 'image/jpeg'),
            });
          }
        }
        return next;
      });
    }

    // 聚焦输入框，方便继续输入
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleRollbackToMessage = async (messageId: string) => {
    if (!confirm('确定要回滚到这条消息吗？这条消息之后的所有对话都会被删除。')) return;

    try {
      // 停止当前生成（如果有）
      if (abortController) {
        abortController.abort();
        setAbortController(null);
      }
      setIsLoading(false);
      // 退出编辑/引用状态
      editingMessageIdRef.current = null;
      setEditingMessageId(null);
      clearQuotedMessage();
      // 触发回滚
      await rollbackMessages(messageId);
    } catch (e) {
      console.error('[Workflow] rollback failed:', e);
    }
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
    
    // 使用新内容发送消息（直接走统一发送逻辑，避免移动端状态延迟）
    setInput(contentToSend);
    await handleSend(contentToSend);
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
  const getSelectableComponents = React.useCallback(() => {
    const mcpList = mcpServers
      .filter(s => s.name.toLowerCase().includes(atSelectorQuery.toLowerCase()))
      .map(s => ({ type: 'mcp' as const, id: s.id, name: s.name, displayName: s.display_name || s.name }));
    
    // 话题参与者（Agent）
    const agentList = topicParticipants
      .filter(p => p.participant_type === 'agent' && (p.name || '').toLowerCase().includes(atSelectorQuery.toLowerCase()))
      .map(p => ({ type: 'agent' as const, id: p.participant_id, name: p.name || p.participant_id, displayName: p.name || p.participant_id, avatar: p.avatar }));
    
    return [...agentList, ...mcpList];
  }, [mcpServers, atSelectorQuery, topicParticipants]);
  
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
  const handleSelectComponent = async (component: { type: 'mcp' | 'skillpack' | 'agent'; id: string; name: string }) => {
    if (atSelectorIndex === -1) return;
    
    // 如果是智能体，直接在文本中插入 @名字
    if (component.type === 'agent') {
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
      
      const insertText = `@${component.name} `;
      const newInput = beforeAt + insertText + afterAt.substring(endIndex);
      setInput(newInput);
      setShowAtSelector(false);
      setAtSelectorIndex(-1);
      setAtSelectorQuery('');
      
      if (inputRef.current) {
        inputRef.current.focus();
        const newCursorPos = atSelectorIndex + insertText.length;
        setTimeout(() => {
          inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
        }, 0);
      }
      return;
    }
    
    // 检查是否已经添加过该组件
    const isAlreadySelected = selectedComponents.some(
      c => c.id === component.id && c.type === component.type
    );
    
    if (!isAlreadySelected) {
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


  // 获取选中的skill pack IDs
  const selectedSkillPackIds = new Set(
    selectedComponents.filter(c => c.type === 'skillpack').map(c => c.id)
  );

  // 处理拖拽组件到对话框
  const handleDropComponent = async (component: { type: 'mcp' | 'skillpack'; id: string; name: string }) => {
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
  
  // 添加组件消息（仅支持 MCP 和技能包）
  const addWorkflowMessage = async (component: { type: 'mcp' | 'skillpack'; id: string; name: string }) => {
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
    
    // MCP 服务器通过 selectedMcpServerIds 管理，不需要添加消息
    if (component.type === 'mcp') {
      return;
    }
  };
  
  // 执行工作流（已移除，不再支持工作流功能）
  const handleExecuteWorkflow = async (messageId: string) => {
    console.warn('[Workflow] Workflow execution is no longer supported');
  };

  // 删除工作流消息（已移除，不再支持工作流功能）
  const handleDeleteWorkflowMessage = async (messageId: string) => {
    console.warn('[Workflow] Workflow message deletion is no longer supported');
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
    
    // 从数据库回退（真正删除目标消息之后的所有消息）
    if (currentSessionId ) {
      try {
        await messageApi.rollbackToMessage(currentSessionId, targetMessageId);
        // 回退会自动刷新缓存，这里只给一个轻量提示
        console.log('[Workflow] Rolled back messages to:', targetMessageId);
      } catch (error) {
        console.error('[Workflow] Failed to rollback messages via API:', error);
        toast({
          title: '回滚失败',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      }
    }
  };

  const renderMessageContent = useCallback((message: Message) => {
    return (
      <MessageContent
        message={message}
        prevMessageContent={getPrevMessageContent(message.id)}
        abortController={abortController}
        setAbortController={setAbortController}
        setMessages={setMessages}
        setIsLoading={setIsLoading}
        collapsedThinking={collapsedThinking}
        toggleThinkingCollapse={toggleThinkingCollapse}
        handleExecuteWorkflow={handleExecuteWorkflow}
        handleDeleteWorkflowMessage={handleDeleteWorkflowMessage}
        openSingleMediaViewer={openSingleMediaViewer}
      />
    );
  }, [
    abortController,
    collapsedThinking,
    getPrevMessageContent,
    handleDeleteWorkflowMessage,
    handleExecuteWorkflow,
    openSingleMediaViewer,
    setAbortController,
    setIsLoading,
    setMessages,
    toggleThinkingCollapse,
  ]);

  // 统计可用工具数量
  const totalTools = Array.from(mcpTools.values()).flat().length;

  // 不渲染（高度为 0）但保留在 data 中：配合 Virtuoso firstItemIndex 的 prepend 锚定
  const shouldHideMessage = useCallback((msg: Message) => {
    if ((msg as any).isSummary) return true;
    if (
      msg.role === 'system' &&
      msg.toolCalls &&
      typeof msg.toolCalls === 'object' &&
      (msg.toolCalls as any).isSystemPrompt === true
    ) {
      return true;
    }
    return false;
  }, []);

  // 稳定的 Virtuoso computeItemKey 回调
  const computeMessageKey = useCallback((_: number, m: Message) => m.id, []);

  const renderChatMessage = useCallback(
    (message: Message) => {
      // 如果是总结提示消息，使用特殊的居中显示样式
      const isSummaryNotification =
        message.role === 'system' &&
        (message.content.includes('总结完成') || message.content.includes('已精简为'));

      if (isSummaryNotification) {
        return (
          <div data-message-id={message.id} className="flex justify-center my-2">
            <div className="text-xs text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5 bg-gray-100 dark:bg-[#2d2d2d] rounded-full">
              {message.content}
            </div>
          </div>
        );
      }

      const isSelected = selectedMessageIds.has(message.id);

      // 检查 assistant 消息是否有侧边面板内容（思考过程、MCP详情等）
      const hasThinkingContent = message.thinking && message.thinking.trim().length > 0;
      const hasMCPDetail =
        !!message.mcpdetail &&
        (() => {
          const anyDetail = message.mcpdetail as any;
          if (Array.isArray(anyDetail?.tool_calls) && anyDetail.tool_calls.length > 0) return true;
          if (Array.isArray(anyDetail?.tool_results) && anyDetail.tool_results.length > 0) return true;
          if (anyDetail?.raw_result) return true;
          if (Array.isArray(anyDetail?.logs) && anyDetail.logs.length > 0) return true;
          if (anyDetail?.status) return true;
          return false;
        })();
      const hasToolCallsArray =
        message.toolCalls && Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
      const hasProcessMessages = message.processMessages && message.processMessages.length > 0;
      const shouldUseSplitView =
        message.role === 'assistant' &&
        (hasThinkingContent ||
          hasMCPDetail ||
          hasToolCallsArray ||
          hasProcessMessages ||
          // 流式/生成中也必须走 SplitView，才能在“思维链图标右侧同一行”展示滚动日志
          message.isStreaming ||
          message.isThinking ||
          message.currentStep ||
          message.thoughtSignature);

      if (shouldUseSplitView) {
        const senderType = (message as any).sender_type as string | undefined;
        const senderId = (message as any).sender_id as string | undefined;
        // topic_general、agent 私聊会显示 Agent 头像
        const needAgentInfo = currentSessionType === 'topic_general' || currentSessionType === 'agent';
        // 优先使用消息中的 sender_avatar/sender_name，降级查找 topicParticipants
        const msgExt = (message.ext || {}) as Record<string, any>;
        const msgSenderAvatar = msgExt.sender_avatar || (message as any).sender_avatar;
        const agentP = needAgentInfo && senderType === 'agent' && senderId && !msgSenderAvatar
          ? topicParticipants.find(p => p.participant_type === 'agent' && p.participant_id === senderId)
          : undefined;
        // 对于 agent 私聊，使用 currentSessionAvatar 作为默认头像
        const messageAvatarFallback = currentSessionType === 'topic_general' ? msgSenderAvatar : undefined;
        const assistantAvatarUrl = resolveAgentAvatar(
          senderId,
          messageAvatarFallback || agentP?.avatar || currentSessionAvatar || undefined,
        );
        return (
          <SplitViewMessage
            id={message.id}
            role={toUIRole(message.role)}
            content={message.content}
            thinking={message.thinking}
            isThinking={message.isThinking}
            isStreaming={message.isStreaming}
            currentStep={message.currentStep}
            toolType={message.toolType}
            toolCalls={Array.isArray(message.toolCalls) ? message.toolCalls : undefined}
            mcpDetail={message.mcpdetail}
            thoughtSignature={message.thoughtSignature}
            media={message.media}
            avatarUrl={assistantAvatarUrl}
            isSelected={isSelected}
            selectionMode={skillPackSelectionMode}
            isLoading={isLoading}
            llmProvider={selectedLLMConfig?.provider}
            renderContent={renderMessageContent}
            onToggleSelection={() => toggleMessageSelection(message.id)}
            onQuote={() => handleQuoteMessage(message.id)}
            onViewMCPDetail={() => {
              setSelectedMCPDetail(message.mcpdetail);
              setShowMCPDetailOverlay(true);
            }}
            onRetry={() => handleRetryMessage(message.id)}
            processMessages={message.processMessages}
            executionLogs={
              (() => {
                // 从消息中提取执行日志（优先级：agent_log > log > executionLogs）
                const getLogsFromMessage = (msg: typeof message) => {
                  const ext = (msg.ext || {}) as any;
                  return ext.agent_log || ext.log || msg.executionLogs || ext.executionLogs;
                };
                
                // 将全局 executionLogs 绑定到"当前正在生成/思考的那条消息"
                // 旧逻辑用 find() 取第一条 streaming 消息，若存在残留 isStreaming=true 的旧消息会绑定错，导致右侧日志不显示
                if (message.isStreaming || message.isThinking) {
                  return getLogsFromMessage(message) ?? executionLogs;
                }
                // 历史消息：从持久化的 ext 中读取
                return getLogsFromMessage(message);
              })()
            }
          />
        );
      }

      return (
        <div
          data-message-id={message.id}
          onClick={() => toggleMessageSelection(message.id)}
          className={`flex items-start gap-2 fade-in-up stagger-item w-full ${
            message.role === 'user'
              ? 'flex-row'
              : message.role === 'assistant' || message.role === 'tool'
                ? 'flex-row'
                : 'flex-row'
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
            <div className={`flex-shrink-0 mt-0.5 ${message.role === 'user' ? 'order-last ml-1.5' : 'mr-1.5'}`}>
              {isSelected ? (
                <CheckSquare className="w-4 h-4 text-primary-500" />
              ) : (
                <Square className="w-4 h-4 text-gray-400" />
              )}
            </div>
          )}

          {(message.role === 'assistant' || message.role === 'tool' || message.role === 'error') ? (
            <div className="w-full min-w-0">
              {/* 第一行：头像 + 名称 + 状态（不占气泡空间） */}
              <div className="flex flex-row items-center gap-1.5 w-full min-w-0">
                {(() => {
                  const senderType = (message as any).sender_type as string | undefined;
                  const senderId = (message as any).sender_id as string | undefined;
                  const needAgentInfo = currentSessionType === 'topic_general' || currentSessionType === 'agent';
                  const msgExt = (message.ext || {}) as Record<string, any>;
                  const msgSenderAvatar = msgExt.sender_avatar || (message as any).sender_avatar;
                  const msgSenderName = msgExt.sender_name || (message as any).sender_name;
                  const agentP = needAgentInfo && senderType === 'agent' && senderId && !msgSenderAvatar
                    ? topicParticipants.find(p => p.participant_type === 'agent' && p.participant_id === senderId)
                    : undefined;
                  const messageAvatarFallback = currentSessionType === 'topic_general' ? msgSenderAvatar : undefined;
                  const assistantAvatarUrl = message.role === 'assistant'
                    ? resolveAgentAvatar(senderId, messageAvatarFallback || agentP?.avatar || currentSessionAvatar || undefined)
                    : undefined;
                  const assistantName = msgSenderName || agentP?.name || '';
                  return (
                    <>
                      <MessageAvatar role={toUIRole(message.role)} avatarUrl={assistantAvatarUrl} toolType={message.toolType} size="sm" />
                      {needAgentInfo && message.role === 'assistant' && senderType === 'agent' && assistantName && (
                        <span className="text-xs text-gray-700 dark:text-[#d0d0d0] font-medium truncate max-w-[80px]" title={assistantName}>
                          {assistantName}
                        </span>
                      )}
                      {message.role === 'assistant' && (
                        <MessageStatusIndicator
                          isThinking={message.isThinking}
                          isStreaming={message.isStreaming}
                          hasContent={!!message.content && message.content.length > 0}
                          currentStep={message.currentStep}
                          llmProvider={selectedLLMConfig?.provider}
                        />
                      )}
                    </>
                  );
                })()}
              </div>
              {/* 第二行：气泡换行顶格贴左（抵消列表 px-3），不空头像位 */}
              <div className="w-full min-w-0 group relative mt-1 -ml-3">
                <MessageBubbleContainer role={toUIRole(message.role)} toolType={message.toolType} className="w-full">
                  <MessageContent
                    message={message}
                    prevMessageContent={getPrevMessageContent(message.id)}
                    abortController={abortController}
                    setAbortController={setAbortController}
                    setMessages={setMessages}
                    setIsLoading={setIsLoading}
                    collapsedThinking={collapsedThinking}
                    toggleThinkingCollapse={toggleThinkingCollapse}
                    handleExecuteWorkflow={handleExecuteWorkflow}
                    handleDeleteWorkflowMessage={handleDeleteWorkflowMessage}
                    openSingleMediaViewer={openSingleMediaViewer}
                  />
                </MessageBubbleContainer>
              </div>
              {message.role === 'tool' && message.toolType === 'mcp' && (
                <PluginExecutionPanel messageId={message.id} sessionId={currentSessionId} toolType={message.toolType} />
              )}
            </div>
          ) : (
            /* 用户消息：头像一行，气泡下一行（右对齐） */
            <div className="w-full min-w-0 flex flex-col items-end gap-2">
              <div className="flex items-center justify-end gap-1.5">
                {message.role === 'user' && !skillPackSelectionMode && (
                  <div className="flex items-center gap-1 bg-muted/50 rounded-md px-1 py-0.5">
                    <IconButton
                      icon={Quote}
                      label="引用此消息"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleQuoteMessage(message.id);
                      }}
                      className="h-6 w-6 text-muted-foreground hover:text-primary-600 dark:hover:text-primary-400"
                      iconClassName="w-3 h-3"
                    />
                    <IconButton
                      icon={Edit2}
                      label="编辑此消息"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(message.id);
                      }}
                      className="h-6 w-6 text-muted-foreground hover:text-primary-600 dark:hover:text-primary-400"
                      iconClassName="w-3 h-3"
                    />
                    <IconButton
                      icon={RotateCw}
                      label="回滚到此消息"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRollbackToMessage(message.id);
                      }}
                      className="h-6 w-6 text-muted-foreground hover:text-green-600 dark:hover:text-green-400"
                      iconClassName="w-3 h-3"
                    />
                  </div>
                )}
                <MessageAvatar role={toUIRole(message.role)} toolType={message.toolType} size="md" />
              </div>
              <div className="w-full min-w-0 flex justify-end">
                <MessageBubbleContainer role={toUIRole(message.role)} toolType={message.toolType} className="max-w-[85%] w-max">
                  <MessageContent
                    message={message}
                    prevMessageContent={getPrevMessageContent(message.id)}
                    abortController={abortController}
                    setAbortController={setAbortController}
                    setMessages={setMessages}
                    setIsLoading={setIsLoading}
                    collapsedThinking={collapsedThinking}
                    toggleThinkingCollapse={toggleThinkingCollapse}
                    handleExecuteWorkflow={handleExecuteWorkflow}
                    handleDeleteWorkflowMessage={handleDeleteWorkflowMessage}
                    openSingleMediaViewer={openSingleMediaViewer}
                  />
                </MessageBubbleContainer>
              </div>
            </div>
          )}
        </div>
      );
    },
    [
      abortController,
      collapsedThinking,
      currentSessionAvatar,
      currentSessionId,
      executionLogs,
      getPrevMessageContent,
      handleExecuteWorkflow,
      handleRetryMessage,
      handleDeleteWorkflowMessage,
      isLoading,
      messages,
      openSingleMediaViewer,
      renderMessageContent,
      selectedLLMConfig?.provider,
      selectedMessageIds,
      setAbortController,
      setIsLoading,
      setMessages,
      skillPackSelectionMode,
      toggleMessageSelection,
    ]
  );

  // 稳定的 Virtuoso itemContent 回调，避免每次渲染都创建新函数
  // 注意：react-virtuoso 要求所有项都有非零尺寸，使用 display:none 会触发警告
  // 因此隐藏消息使用极小高度而非 display:none
  const renderVirtuosoItem = useCallback(
    (_index: number, message: Message) => {
      if (shouldHideMessage(message)) {
        // 使用 1px 高度而非 display:none，避免 react-virtuoso "Zero-sized element" 警告
        return (
          <div
            data-message-id={message.id}
            style={{ height: '1px', overflow: 'hidden', visibility: 'hidden' }}
            aria-hidden="true"
          />
        );
      }
      return (
        <div className="py-1" data-message-id={message.id}>
          {renderChatMessage(message)}
        </div>
      );
    },
    [renderChatMessage, shouldHideMessage]
  );

  const switchSessionFromPersona = (sessionId: string) => {
    setShowPersonaPanel(false);
    // 优先交给上层（保证会话 ID 与 URL/全局状态一致），否则 fallback 到组件内切换
    if (onSelectSession) {
      onSelectSession(sessionId);
    } else {
      handleSelectSession(sessionId);
    }
  };


  useEffect(() => {
    if (!showPersonaPanel) return;
    let canceled = false;
    (async () => {
      try {
        setIsLoadingPersonaList(true);
        const [agents, sessions] = await Promise.all([
          getAgents(),
          getSessions(),
        ]);
        if (canceled) return;
        setPersonaAgents(agents || []);
        const topics = (sessions || []).filter(s => s.session_type === 'topic_general');
        setPersonaTopics(topics);
      } catch (error) {
        console.error('[Workflow] Failed to load persona list:', error);
        if (canceled) return;
        setPersonaAgents([]);
        setPersonaTopics([]);
      } finally {
        if (!canceled) setIsLoadingPersonaList(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [showPersonaPanel]);

  useEffect(() => {
    let canceled = false;
    const agentIds = new Set<string>();
    messages.forEach(msg => {
      if (msg.sender_type === 'agent' && msg.sender_id) {
        agentIds.add(msg.sender_id);
      }
    });
    agentIds.forEach(async (agentId) => {
      if (avatarCacheRef.current.has(agentId) || avatarLoadingRef.current.has(agentId)) return;
      avatarLoadingRef.current.add(agentId);
      try {
        const session = await getSession(agentId);
        if (canceled) return;
        avatarCacheRef.current.set(agentId, session.avatar || null);
        setAvatarCacheTick(v => v + 1);
      } catch (error) {
        if (!canceled) {
          avatarCacheRef.current.set(agentId, null);
          setAvatarCacheTick(v => v + 1);
        }
      } finally {
        avatarLoadingRef.current.delete(agentId);
      }
    });
    return () => {
      canceled = true;
    };
  }, [messages, avatarCacheTick]);



  const {
    moduleSelectorIndex,
    setModuleSelectorIndex,
    moduleSelectorQuery,
    setModuleSelectorQuery,
    moduleSelectorPosition,
    atSelectorIndex,
    setAtSelectorIndex,
    atSelectorPosition,
    isComposingRef,
    handleInputChange,
    handleInputSelect,
    handleInputClick,
    handleInputMouseUp,
    handleInputKeyUp,
    handleInputScroll,
    handleKeyPress,
    handleKeyDown,
  } = useChatInput({
    input,
    setInput,
    inputRef,
    handleSend,
    showBatchItemSelector,
    showModuleSelector,
    setShowModuleSelector,
    showAtSelector,
    setShowAtSelector,
    atSelectorQuery,
    setAtSelectorQuery,
    handleSelectComponent,
    getSelectableComponents,
    selectedComponentIndex,
    setSelectedComponentIndex,
  });

  return (
    <>
    <div className="workflow-chat-outer h-full flex flex-col bg-gray-50 dark:bg-[#1a1a1a]">
      <div className="flex-1 flex min-h-0 p-2 gap-2">
        <div className="workflow-chat-panel flex-1 flex flex-col min-w-0 min-h-0 bg-white dark:bg-[#2d2d2d] overflow-hidden">
          <div className="workflow-chat-header border-b border-gray-200 dark:border-[#404040] px-3 py-0.5 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary-400 hover:ring-offset-1 transition-all overflow-hidden" onClick={async () => {
                  if (currentSessionId ) {
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
                      // 根据会话类型显示不同的配置对话框
                      const sessionType = currentSession.session_type;
                      if (sessionType === 'topic_general') {
                        // Topic 会话 - 显示 TopicConfigDialog
                        setTopicConfigEditName(currentSession.name || currentSession.title || '');
                        setTopicConfigEditAvatar(currentSession.avatar || null);
                        // 从 ext 中读取 displayType
                        const ext = currentSession.ext || {};
                        const displayType = ext.displayType === 'research' ? 'chat' : ext.displayType;
                        setTopicConfigEditDisplayType((displayType as TopicDisplayType) || 'chat');
                        // 加载参与者
                        try {
                          const participants = await getParticipants(currentSessionId);
                          setTopicParticipants(participants);
                        } catch (error) {
                          console.warn('[Workflow] Failed to load topic participants:', error);
                          setTopicParticipants([]);
                        }
                        setShowTopicConfigDialog(true);
                      } else if (sessionType === 'agent') {
                        // Agent 会话 - 显示 AgentPersonaDialog（支持完整配置）
                        setAgentPersonaDialogAgent(currentSession);
                        setShowAgentPersonaDialog(true);
                      } else {
                        // 普通会话 - 显示 HeaderConfigDialog
                        setHeaderConfigEditName(currentSession.name || '');
                        setHeaderConfigEditAvatar(currentSession.avatar || null);
                        setHeaderConfigEditSystemPrompt(currentSession.system_prompt || '');
                        setHeaderConfigEditMediaOutputPath(currentSession.media_output_path || '');
                        setHeaderConfigEditLlmConfigId(currentSession.llm_config_id || null);
                        setHeaderConfigActiveTab('basic');
                        setShowHeaderConfigDialog(true);
                      }
                    }
                  }
                }}
                title={currentSessionId  ? "点击配置会话" : "请先选择或创建会话"}
              >
                {currentSessionAvatar ? (
                  <img src={currentSessionAvatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <Bot className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                )}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span 
                  className="text-xs font-semibold text-gray-900 dark:text-[#ffffff] leading-tight truncate min-w-0 flex items-center gap-1.5"
                >
                  {(() => {
                    const currentSession =
                      sessions.find(s => s.session_id === currentSessionId) ||
                      (currentSessionMeta?.session_id === currentSessionId ? currentSessionMeta : null);
                    if (currentSession?.name) return currentSession.name;
                    if (currentSession?.session_type === 'agent') return 'AI 工作流助手';
                    return 'AI 工作流助手';
                  })()}
                </span>
                {currentSessionType !== 'agent' && (
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-[#9a9a9a] truncate">
                    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 border border-border/60 bg-muted/60">
                      {currentSessionType === 'topic_general' ? '话题' : '临时会话'}
                    </span>
                    {(selectedLLMConfig?.shortname || selectedLLMConfig?.name) && (
                      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 border border-border/60 bg-muted/50">
                        {selectedLLMConfig.shortname || selectedLLMConfig.name}
                      </span>
                    )}
                  </div>
                )}

                {/* 话题参与者头像列表 */}
                {currentSessionType === 'topic_general' && topicParticipants.length > 0 && (
                  <div className="flex -space-x-1.5 overflow-hidden ml-1 flex-shrink-0">
                    {topicParticipants
                      .filter(p => p.participant_type === 'agent')
                      .map(p => (
                        <div 
                          key={p.participant_id}
                          className="inline-block h-5 w-5 rounded-full ring-2 ring-white dark:ring-[#2d2d2d] bg-gray-100 dark:bg-gray-800 overflow-hidden shadow-sm cursor-pointer hover:ring-primary-400 transition-all"
                          title={`${p.name} - 点击配置`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              // 获取agent的完整会话信息
                              const agentSession = await getSession(p.participant_id);
                              setAgentPersonaDialogAgent(agentSession);
                              setShowAgentPersonaDialog(true);
                            } catch (error) {
                              console.error('[Workflow] Failed to load agent session:', error);
                              toast({
                                title: '加载失败',
                                description: error instanceof Error ? error.message : '无法加载智能体配置',
                                variant: 'destructive',
                              });
                            }
                          }}
                        >
                          {p.avatar ? (
                            <img src={p.avatar} alt={p.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex items-center justify-center h-full w-full">
                              <Bot className="h-3 w-3 text-gray-400" />
                            </div>
                          )}
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
              
            </div>
            <div className="flex items-center space-x-2">
              {/* 当前SOP状态显示（话题群专用） */}
              {currentSessionType === 'topic_general' && currentSopSkillPack && (
                <div className="flex items-center gap-1 px-2 py-1 text-xs bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 rounded">
                  <Package className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">SOP: {currentSopSkillPack.name}</span>
                  <button
                    onClick={handleClearCurrentSop}
                    className="ml-1 hover:text-red-500 transition-colors"
                    title="取消当前SOP"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              
              {/* 添加SOP按钮（非单Agent） */}
              {currentSessionType !== 'agent' && (
                <button
                  onClick={() => setShowAddSopDialog(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-[#a0a0a0] hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-[#363636] rounded transition-colors"
                  title="添加SOP技能包"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">添加SOP</span>
                </button>
              )}
              
              {/* 制作技能包按钮 - 在有消息时显示 */}
              {currentSessionId  && messages.filter(m => m.role !== 'system').length > 0 && !skillPackSelectionMode && (
                <button
                  onClick={() => {
                    if (currentSessionType === 'agent') {
                      setShowAddSopDialog(true);
                      return;
                    }
                    setSkillPackSelectionMode(true);
                    setSelectedMessageIds(new Set());
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-[#a0a0a0] hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-[#363636] rounded transition-colors"
                  title={currentSessionType === 'agent' ? '设置SOP' : '选择消息范围，创建技能包'}
                >
                  <Package className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">
                    {currentSessionType === 'agent' ? '设置SOP' : '制作技能包'}
                  </span>
                </button>
              )}
              {/* 流式响应开关已移至输入框上方 */}
            </div>
          </div>
        </div>

        {/* 消息列表 - 正常顺序显示（老消息在上，新消息在下） - 优化布局 */}
          <div 
            ref={(el) => {
              chatContainerRef.current = el;
              setChatScrollEl(el);
            }}
            className="workflow-chat-messages flex-1 overflow-y-auto hide-scrollbar px-3 py-2 space-y-2 relative bg-gray-50/50 dark:bg-gray-950/50"
            style={{ scrollBehavior: 'auto' }}
            onWheel={(e) => {
              // hybrid 自动触发：接近顶部时继续上拉（滚轮向上）只触发一次
              if (e.deltaY < 0 && isNearTop && scrollTopRef.current < 80) {
                void triggerLoadMoreHistory('auto');
              }
            }}
            onScroll={() => {
              const container = chatContainerRef.current;
              if (!container) return;
              
              const scrollTop = container.scrollTop;
              const scrollHeight = container.scrollHeight;
              const clientHeight = container.clientHeight;
              scrollTopRef.current = scrollTop;
              
              const atBottom = shouldAutoScroll();
              wasAtBottomRef.current = atBottom;
              
              // 检测用户是否在滚动（排除程序控制的滚动）
              if (!isLoadingMoreRef.current) {
                // 如果用户手动滚动离开底部，标记为用户正在查看历史消息
                const atBottom = shouldAutoScroll();
                if (!atBottom) {
                isUserScrollingRef.current = true;
                  // 用户手动滚动后，只有在用户主动滚动回底部时才重置
                  // 不设置自动重置，让用户完全控制滚动行为
                } else {
                  // 用户滚动回底部，允许自动跟随
                  isUserScrollingRef.current = false;
                }
              }
              
              // 检测是否接近顶部（距离顶部小于150px）- 用于显示和自动加载更多历史消息
              const nearTop = scrollTop < 150;
              setIsNearTop(nearTop);
              if (!nearTop) {
                // 离开顶部区域后，允许下一次自动触发
                historyAutoFiredInNearTopRef.current = false;
                if (historyTopStayTimerRef.current) {
                  clearTimeout(historyTopStayTimerRef.current);
                  historyTopStayTimerRef.current = null;
                }
              }
              
              // 检测是否应该显示"跳转到最新消息"按钮
              // 当距离底部超过300px（约5条消息的高度）时显示
              const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
              setShowScrollToBottom(distanceFromBottom > 300);
              
              // 用户滚动到底部时，隐藏新消息提示（最新消息在底部）
              if (atBottom) {
                setShowNewMessagePrompt(false);
                setUnreadMessageCount(0);
                setShowScrollToBottom(false);
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
          {/* 加载更多历史消息提示（固定在顶部，带迷雾效果）- 只有接近顶部且有更多消息时才显示 */}
          <HistoryLoadTop
            visible={isNearTop}
            hasMore={hasMoreMessages}
            isLoading={isLoadingMessages}
            hintMode="hybrid"
            onLoadMore={() => {
              void triggerLoadMoreHistory('manual');
            }}
          />
          
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
          
          {/* 到最新消息：改为发送框右侧常驻按钮（见下方输入区） */}
          
          <Virtuoso
            customScrollParent={chatScrollEl || undefined}
            data={messages}
            firstItemIndex={virtuosoFirstItemIndex}
            computeItemKey={computeMessageKey}
            increaseViewportBy={{ top: 600, bottom: 800 }}
            itemContent={renderVirtuosoItem}
          />
          
          {/* Agent决策状态提示 - 在 AgentActor 模式（topic_general 或 agent）中显示 */}
          {/* 使用思维模块风格：虚线框 + 重要步骤加粗 */}
          {agentDecidingStates.size > 0 && (currentSessionType === 'topic_general' || currentSessionType === 'agent') && (
            <div className="px-4 py-2 space-y-2">
              {Array.from(agentDecidingStates.entries()).map(([agentId, state]) => {
                // 判断是否有 MCP 调用步骤（重要步骤）
                const hasMcpStep = state.processMessages?.some(m => m.type === 'mcp_call' || m.type === 'ag_use_mcp') || state.processSteps?.some(s => s.type === 'mcp_call');
                // 判断是否立即回答（无决策过程或决策步骤很少）
                const isImmediateReply = state.action === 'reply' && (
                  (!state.processMessages || state.processMessages.length <= 1) &&
                  (!state.processSteps || state.processSteps.length <= 1)
                );
                
                return (
                  <div 
                    key={agentId}
                    className="transition-all duration-500"
                  >
                    {/* Agent 头像和名称行 */}
                    <div className="flex items-center gap-2 mb-1">
                      {state.agentAvatar ? (
                        <img 
                          src={state.agentAvatar} 
                          alt={state.agentName} 
                          className="w-6 h-6 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-800 flex items-center justify-center">
                          <Bot className="w-3 h-3 text-primary-600 dark:text-primary-300" />
                        </div>
                      )}
                      <span className="text-xs font-medium text-gray-700 dark:text-[#d0d0d0]">
                        {state.agentName}
                      </span>
                      {/* 状态标签 */}
                      {isImmediateReply ? (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                          普通模式，立即回答
                        </span>
                      ) : state.status === 'deciding' ? (
                        <span className="text-xs text-primary-500 dark:text-primary-400 flex items-center">
                          <Loader className="w-3 h-3 mr-1 animate-spin" />
                          处理中...
                        </span>
                      ) : state.action === 'reply' ? (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          准备回答
                        </span>
                      ) : state.action === 'silent' ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          决定不参与
                        </span>
                      ) : state.action === 'like' ? (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          👍 点赞
                        </span>
                      ) : null}
                    </div>
                    
                    {/* 执行轨迹（使用统一的 ProcessStepsViewer 组件） */}
                    {(state.status === 'deciding' || (state.processMessages && state.processMessages.length > 0)) && !isImmediateReply && (
                      <div className="ml-3">
                        <ProcessStepsViewer 
                          processMessages={state.processMessages || []} 
                          executionLogs={state.executionLogs || []}
                          isThinking={state.status === 'deciding'}
                          isStreaming={false}
                          hideTitle
                          defaultExpanded
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          
          {/* 执行日志已移至思维链图标右侧，不再在此处显示 */}
          
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
                  disabled={selectedMessageIds.size === 0 || isCreatingSkillPack || (llmConfigs.filter(c => Boolean(c.enabled)).length === 0 && !selectedLLMConfigId)}
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

        {/* 计算当前流式消息的状态（用于在输入框中显示思考/MCP过程） */}
        {(() => {
          // 找到当前正在流式的消息
          const streamingMessage = messages.find(m => m.isStreaming || m.isThinking);
          const currentThinkingStep = streamingMessage?.currentStep || '';
          const isThinkingPhase = streamingMessage?.isThinking;
          
          // 生成状态文本和工具信息
          let statusText = '';
          let activeToolName = '';
          let activeToolType: 'mcp' | 'thinking' | '' = '';
          
          if (isLoading && streamingMessage) {
            if (currentThinkingStep) {
              statusText = currentThinkingStep;
              // 解析工具名称：格式为 "正在调用工具: server_name/tool_name"
              const toolMatch = currentThinkingStep.match(/正在调用工具:\s*(.+)/);
              if (toolMatch) {
                const fullToolName = toolMatch[1].trim();
                // 提取服务器名（斜杠前的部分）
                const serverName = fullToolName.split('/')[0];
                activeToolName = serverName;
                activeToolType = 'mcp';
              }
            } else if (isThinkingPhase) {
              statusText = '正在思考...';
              activeToolType = 'thinking';
            } else if (streamingMessage.isStreaming) {
              statusText = '正在生成回复...';
            }
          }
          
          // 将状态存储到 window 对象以便在输入框中使用
          (window as any).__chatStreamingStatus = statusText;
          (window as any).__chatActiveToolName = activeToolName;
          (window as any).__chatActiveToolType = activeToolType;
          return null;
        })()}

        {/* 输入框（固定在底部，不再浮动） */}
          <div className="flex-shrink-0 px-2 sm:px-4 pb-3 pt-2 bg-white dark:bg-[#2d2d2d] border-t border-gray-200 dark:border-[#404040] workflow-chat-input-area">
          <div 
            ref={floatingComposerRef}
            className={`${floatingComposerInnerClass.replace('absolute left-2 right-2 sm:left-4 sm:right-4 bottom-3', '')} relative transition-colors ${
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
          {/* 已选定的组件 tag - 已移除，组件选择通过工具tag直接显示 */}
          
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
            const quotedMsg = quotedMessageSnapshot || messages.find(m => m.id === quotedMessageId);
            if (!quotedMsg) return null;
            // 获取发送者信息（用于显示 Agent 名称）
            const msgExt = ('ext' in quotedMsg ? (quotedMsg.ext || {}) : {}) as Record<string, any>;
            const senderName = quotedMsg.role === 'assistant' 
              ? (quotedMessageSnapshot?.senderName || msgExt.sender_name || (quotedMsg as any).sender_name || 'Agent')
              : '用户';
            const isAgentMessage = quotedMsg.role === 'assistant';
            return (
              <div
                className="mb-3 flex items-start gap-2 p-2 bg-muted/60 rounded-md border border-border/60 cursor-pointer"
                role="button"
                tabIndex={0}
                onClick={() => setQuoteDetailOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setQuoteDetailOpen(true);
                  }
                }}
                title="点击查看引用详情"
              >
                <CornerDownRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
                    <span>引用</span>
                    {isAgentMessage ? (
                      <span className="font-medium text-gray-700 dark:text-gray-300">{senderName}</span>
                    ) : (
                      <span>消息</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                    {(quotedMsg.content || '').substring(0, 100)}{(quotedMsg.content || '').length > 100 ? '...' : ''}
                  </p>
                  {/* 引用媒体缩略图已移至下方附件预览区统一展示，此处不再重复显示 */}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearQuotedMessage();
                  }}
                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                  title="取消引用"
                >
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              </div>
            );
          })()}

          <Dialog open={quoteDetailOpen} onOpenChange={setQuoteDetailOpen}>
            <DialogContent className="quote-detail-dialog">
              <DialogHeader>
                <DialogTitle>引用详情</DialogTitle>
              </DialogHeader>
              <div className="quote-detail-body no-scrollbar mt-2">
                {quotedMessageId && (() => {
                  const quotedMsg = quotedMessageSnapshot || messages.find(m => m.id === quotedMessageId);
                  if (!quotedMsg) return null;
                  const msgExt = ('ext' in quotedMsg ? (quotedMsg.ext || {}) : {}) as Record<string, any>;
                  const senderName = quotedMsg.role === 'assistant'
                    ? (quotedMessageSnapshot?.senderName || msgExt.sender_name || (quotedMsg as any).sender_name || 'Agent')
                    : '用户';
                  const quotedMedia: MediaItem[] = ((quotedMsg.media || []) as Array<{ type: 'image' | 'video' | 'audio'; mimeType: string; data: string; url?: string }>).map(item => ({
                    type: item.type,
                    mimeType: item.mimeType,
                    data: item.data,
                    url: item.url,
                  }));
                  return (
                    <div className="quote-detail-content">
                      <div className="text-xs text-muted-foreground mb-2">
                        引用自：{senderName}
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words">
                        {quotedMsg.content || '[空内容]'}
                      </div>
                      {quotedMedia.length > 0 && (
                        <div className="mt-3">
                          <MediaGallery
                            media={quotedMedia}
                            thumbnailSize="sm"
                            maxVisible={6}
                            showDownload
                            onOpenSessionGallery={(index) => {
                              const item = quotedMedia[index];
                              if (!item) return;
                              openSingleMediaViewer({
                                type: item.type,
                                mimeType: item.mimeType,
                                data: item.data,
                                url: item.url,
                                messageId: quotedMsg.id,
                                role: quotedMsg.role === 'system'
                                  ? 'user'
                                  : (quotedMsg.role === 'error' ? 'assistant' : quotedMsg.role),
                              });
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <DialogFooter className="justify-end">
                <Button
                  variant="outline"
                  onClick={() => setQuoteDetailOpen(false)}
                  className="niho-close-pink"
                >
                  关闭
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* 工具 Tag 栏 - 常驻显示，左侧工具tag，右侧模型选择 */}
          <div className="flex items-center justify-between px-2.5 pt-2.5 pb-3">
            {/* 左侧：插件入口（合并 MCP / 技能包 / 媒体） */}
            <div className="flex items-center gap-1 flex-nowrap flex-1 min-w-0 overflow-hidden">
              <AttachmentMenu
                mcpServers={mcpServers}
                skillPacks={allSkillPacks}
                selectedMcpServerIds={selectedMcpServerIds}
                selectedSkillPackIds={selectedSkillPackIds}
                connectedMcpServerIds={connectedMcpServerIds}
                connectingMcpServerIds={connectingServers}
                onSelectMCP={handleSelectMCPFromThumbnail}
                onDeselectMCP={handleDeselectMCPFromThumbnail}
                onConnectMCP={handleConnectServer}
                onSelectSkillPack={handleSelectSkillPackFromThumbnail}
                onDeselectSkillPack={handleDeselectSkillPackFromThumbnail}
                onAttachFile={handleAttachFile}
                attachedCount={attachedMedia.length}
                toolCallingEnabled={toolCallingEnabled}
                onToggleToolCalling={onToggleToolCalling}
              />

              {/* 人设 - 点击后弹框切换（Chaya）或编辑人设（其他 Agent/话题） */}
              {currentSessionType !== 'topic_general' && currentSessionId && (
                <button
                  onClick={() => {
                    if (currentSessionId === 'agent_chaya') {
                      setShowPersonaSwitchDialog(true);
                    } else {
                      setSystemPromptDraft(currentSystemPrompt || '');
                      setIsEditingSystemPrompt(true);
                    }
                  }}
                  className={`niho-persona-btn ring-0 flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] transition-all whitespace-nowrap ${
                    currentSystemPrompt
                      ? 'niho-persona-btn--active font-medium'
                      : 'niho-persona-btn--inactive'
                  }`}
                  title={currentSystemPrompt ? `人设: ${currentSystemPrompt.length > 50 ? currentSystemPrompt.slice(0, 50) + '...' : currentSystemPrompt}` : '点击设置人设'}
                >
                  <FileText className="w-3 h-3 flex-shrink-0" />
                  <span>人设</span>
                </button>
              )}
            </div>

            {/* 右侧：模型选择（非话题模式时显示） */}
            {currentSessionType !== 'topic_general' && !isLoading && (
              <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                {/* 流式响应开关 */}
                <label className="flex items-center space-x-1 cursor-pointer group px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-[#1a1a1a] transition-colors">
                  <input
                    type="checkbox"
                    checked={streamEnabled}
                    onChange={(e) => setStreamEnabled(e.target.checked)}
                    className="w-2.5 h-2.5 text-neon-500 border-gray-300 dark:border-[#444] rounded focus:ring-neon-500 accent-neon-500"
                  />
                  <span className="text-[9px] font-medium text-gray-500 dark:text-[#666] group-hover:text-neon-600 dark:group-hover:text-neon-400">流式</span>
                </label>

                {/* 模型选择按钮 */}
                <button
                  onClick={() => setShowModelSelectDialog(true)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-all ${
                    selectedLLMConfig
                      ? 'bg-emerald-50 dark:bg-[rgba(0,212,170,0.08)] text-emerald-600 dark:text-[#00d4aa] font-medium ring-1 ring-emerald-200 dark:ring-[rgba(0,212,170,0.25)]'
                      : 'text-gray-400 dark:text-[#555] hover:text-gray-600 dark:hover:text-[#888]'
                  }`}
                  title={selectedLLMConfig ? `${selectedLLMConfig.name}${selectedLLMConfig.model ? ` (${selectedLLMConfig.model})` : ''}` : '选择模型'}
                >
                  {selectedLLMConfig ? (
                    <>
                      {(() => {
                        const providerInfo = getProviderIcon(selectedLLMConfig, providers);
                        const providerType = (selectedLLMConfig.supplier || selectedLLMConfig.provider || 'openai').toLowerCase();
                        if (['openai', 'anthropic', 'google', 'gemini', 'deepseek', 'ollama'].includes(providerType)) {
                          return <ProviderIcon provider={providerType} size={14} className="flex-shrink-0" />;
                        }
                        return <span className="text-xs">{providerInfo.icon}</span>;
                      })()}
                      <span className="font-medium truncate max-w-[80px]">
                        {selectedLLMConfig.shortname || selectedLLMConfig.name}
                      </span>
                      {/* 模型能力图标 */}
                      {(() => {
                        const enableThinking = selectedLLMConfig.metadata?.enableThinking ?? false;
                        const supportedInputs: string[] = selectedLLMConfig.metadata?.supportedInputs ?? [];
                        const supportedOutputs: string[] = selectedLLMConfig.metadata?.supportedOutputs ?? [];
                        const caps = [];
                        if (enableThinking) caps.push(<Brain key="t" className="w-2.5 h-2.5 text-purple-400" />);
                        if (supportedInputs.includes('image')) caps.push(<Eye key="v" className="w-2.5 h-2.5 text-yellow-400" />);
                        if (supportedInputs.includes('audio')) caps.push(<Volume2 key="a" className="w-2.5 h-2.5 text-neon-400" />);
                        if (supportedOutputs.includes('image')) caps.push(<Paintbrush key="i" className="w-2.5 h-2.5 text-red-400" />);
                        return caps.length > 0 ? <div className="flex items-center gap-0.5">{caps}</div> : null;
                      })()}
                    </>
                  ) : (
                    <>
                      <Brain className="w-3 h-3" />
                      <span>选择模型</span>
                    </>
                  )}
                </button>

                {/* 签名回灌开关（生图模型时显示） */}
                {(() => {
                  const isImageGenModel = (selectedLLMConfig?.model || '').toLowerCase().includes('image');
                  if (!isImageGenModel) return null;
                  return (
                    <Button
                      onClick={() => setUseThoughtSignature(v => !v)}
                      variant={useThoughtSignature ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      title={useThoughtSignature ? '已开启签名回灌' : '已关闭签名回灌'}
                    >
                      {useThoughtSignature ? '签名:开' : '签名:关'}
                    </Button>
                  );
                })()}

              </div>
            )}
          </div>

          <div className="flex space-x-1.5 px-2 pb-1.5">
            {/* 媒体预览区域 - 缩略图画廊样式 */}
            {attachedMedia.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-1.5">
                {attachedMedia.map((media, index) => (
                  <div key={index} className="relative group">
                    {media.type === 'image' ? (
                      <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200/60 dark:border-[#404040]/60 hover:border-primary-500 dark:hover:border-primary-500 transition-all hover:scale-105">
                        <img
                          src={media.preview || ensureDataUrlFromMaybeBase64(media.data, media.mimeType)}
                          alt={`媒体 ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : media.type === 'video' ? (
                      <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200/60 dark:border-[#404040]/60 hover:border-primary-500 dark:hover:border-primary-500 transition-all hover:scale-105 relative bg-gray-900">
                        <video
                          src={media.preview || ensureDataUrlFromMaybeBase64(media.data, media.mimeType)}
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
                      <div className="w-12 h-12 flex items-center justify-center rounded-lg border border-gray-200/60 dark:border-[#404040]/60 hover:border-primary-500 dark:hover:border-primary-500 transition-all hover:scale-105 bg-gradient-to-br from-primary-500 to-primary-700">
                        <Music className="w-5 h-5 text-white/80" />
                      </div>
                    ) : null}
                    <button
                      onClick={() => {
                        setAttachedMedia(prev => prev.filter((_, i) => i !== index));
                      }}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                      title="删除媒体"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex-1 relative at-selector-container">
              {/* 输入框和右侧按钮容器 */}
              <div className="flex items-end gap-1.5">
                {/* 加载时显示状态文本 + 左侧高亮工具，否则显示输入框 */}
                {isLoading ? (
                  <div 
                    className="flex-1 px-2.5 py-2 min-h-[40px] max-h-[40px] bg-transparent text-gray-500 dark:text-[#666] text-[12px] flex items-center overflow-hidden"
                  >
                    <div className="flex items-center gap-2 w-full overflow-hidden">
                      {/* 左侧：正在使用的工具高亮显示 */}
                      {(() => {
                        const activeToolName = (window as any).__chatActiveToolName || '';
                        const activeToolType = (window as any).__chatActiveToolType || '';
                        
                        if (activeToolType === 'mcp' && activeToolName) {
                          // 查找对应的 MCP 服务器
                          const activeMcp = mcpServers.find(s => s.name === activeToolName);
                          return (
                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/30 border border-primary-300 dark:border-primary-700 flex-shrink-0 animate-pulse">
                              <Plug className="w-3 h-3 text-primary-600 dark:text-primary-400" />
                              <span className="text-[11px] font-medium text-primary-700 dark:text-primary-300 max-w-[80px] truncate">
                                {activeMcp?.display_name || activeToolName}
                              </span>
                            </div>
                          );
                        } else if (activeToolType === 'thinking') {
                          return (
                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 flex-shrink-0 animate-pulse">
                              <Brain className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                              <span className="text-[11px] font-medium text-purple-700 dark:text-purple-300">思考</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                      
                      {/* 状态文本 */}
                      <div className="flex items-center gap-1.5 flex-1 overflow-hidden">
                        <Loader className="w-3.5 h-3.5 animate-spin flex-shrink-0 text-primary-500" />
                        <span className="truncate text-[12px]">
                          {(window as any).__chatStreamingStatus || '处理中...'}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                <textarea
                ref={inputRef}
              value={input}
                onChange={handleInputChange}
              onSelect={handleInputSelect}
              onClick={handleInputClick}
              onMouseUp={handleInputMouseUp}
              onKeyUp={handleInputKeyUp}
              onScroll={handleInputScroll}
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
                onKeyDown={handleKeyDown}
                onBlur={(e) => {
                  // 检查焦点是否移到了浮岛容器内的其他元素
                  const relatedTarget = e.relatedTarget as HTMLElement;
                  const floatingComposer = floatingComposerRef.current;
                  
                  // 如果焦点仍在浮岛容器内，不关闭浮岛
                  if (relatedTarget && floatingComposer && floatingComposer.contains(relatedTarget)) {
                    // 焦点移到了浮岛内的其他元素（如工具按钮、上传按钮等），保持浮岛打开
                    return;
                  }
                  
                  // 检查是否点击了文件上传 input（relatedTarget 为 null 但点击的是 input[type=file]）
                  // 文件上传按钮是 label，点击后会触发隐藏的 input，此时 relatedTarget 可能为 null
                  if (!relatedTarget) {
                    // 延迟检查，看焦点是否回到浮岛或正在进行文件选择
                    setTimeout(() => {
                      const activeElement = document.activeElement;
                      // 如果焦点回到浮岛内，不关闭
                      if (floatingComposer && floatingComposer.contains(activeElement)) {
                        return;
                      }
                      // 如果正在输入框中，不关闭（可能是点击后又点回来了）
                      if (activeElement === inputRef.current) {
                        return;
                      }
                      // 否则关闭浮岛
                      setIsInputFocused(false);
                    }, 100);
                    return;
                  }
                  
                  // relatedTarget 存在但不在浮岛内，关闭浮岛
                  setIsInputFocused(false);
                  
                  // 如果批次数据项选择器显示，不处理blur（由组件自己处理）
                  if (showBatchItemSelector) {
                    return;
                  }
                  
                  // 如果模块选择器显示，不处理blur（由组件自己处理）
                  if (showModuleSelector) {
                    return;
                  }
                  
                  // 如果 @ 选择器显示，检查是否点击了选择器
                  if (showAtSelector) {
                    // 检查 relatedTarget 是否在选择器内
                    if (relatedTarget && relatedTarget.closest('.at-selector-container')) {
                      // 焦点移到了选择器，不关闭
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
                    }, 500); // 增加延迟时间到 500ms，给用户更多时间点击
                    return;
                  }
                }}
              placeholder={
                editingMessageId
                  ? '编辑消息...'
                  : !selectedLLMConfig
                  ? '请先选择 LLM 模型...'
                  : !isInputFocused
                  ? '输入你的问题...'
                  : selectedMcpServerIds.size > 0
                    ? `输入你的任务，我可以使用 ${totalTools} 个工具帮助你完成...`
                    : '输入你的问题，我会尽力帮助你...'
              }
                  className={`flex-1 resize-none no-scrollbar overflow-y-auto transition-all duration-200 bg-transparent border-none focus:outline-none focus:ring-0 text-gray-900 dark:text-[#ffffff] placeholder-gray-400 dark:placeholder-[#606060] ${
                    isInputFocused ? 'px-2.5 py-2' : 'px-2.5 py-1.5 overflow-hidden'
                  } ${
                    isInputExpanded 
                      ? 'min-h-[180px] max-h-[360px]' 
                      : isInputFocused ? 'min-h-[52px] max-h-[140px]' : 'min-h-[40px] max-h-[40px]'
                  }`}
                  style={{ fontSize: isInputFocused ? '13px' : '12px', lineHeight: '1.5' }}
                  rows={1}
                  disabled={isLoading || !selectedLLMConfig}
                />
                )}
                
                {/* 右侧：发送/中断按钮 */}
                <div className="flex flex-col items-end gap-0.5 flex-shrink-0 pb-0.5">
                  <div className="flex items-center gap-1">
                  {isLoading ? (
                    // 加载时：显示中断按钮
                    <Button
                      onClick={() => {
                        if (abortController) {
                          abortController.abort();
                          setAbortController(null);
                          setMessages(prev => prev.filter(msg => !msg.isStreaming && !msg.isThinking));
                          setIsLoading(false);
                        }
                      }}
                      variant="destructive"
                      size="sm"
                      className="gap-1 px-2 py-1 h-7 text-xs"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">中断</span>
                    </Button>
                  ) : (
                    <>
                      {/* 发送按钮 - 萤绿色 */}
                      <Button
                        onClick={(e) => {
                          e.preventDefault();
                          handleSend();
                        }}
                        disabled={(!input.trim() && attachedMedia.length === 0) || !selectedLLMConfig}
                        variant="primary"
                        size="sm"
                        className="gap-1 px-3 py-1 h-7 text-xs font-medium dark:bg-neon-500 dark:hover:bg-neon-400 dark:text-black dark:shadow-glow-neon/50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{editingMessageId ? '重发' : '发送'}</span>
                      </Button>
                    </>
                  )}
                  </div>
                  {/* Context 用量 */}
                  {selectedLLMConfig && (
                    <TokenCounter selectedLLMConfig={selectedLLMConfig} messages={messages} />
                  )}
                </div>
              </div>
            {/* 编辑模式提示和取消按钮 */}
            {editingMessageId && (
              <div className="absolute top-2 right-2 flex items-center space-x-2">
                <button
                  onClick={handleCancelEdit}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc] transition-colors"
                  title="取消编辑"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
              
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
          
          {/* @ 符号选择器 - 相对于输入框容器定位 */}
          {showAtSelector && (
            <div
              ref={selectorRef}
              className="absolute bottom-full left-0 mb-1 z-[200] bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#404040] rounded-lg shadow-lg overflow-y-auto at-selector-container"
              style={{
                minWidth: '200px',
                maxWidth: '300px',
                maxHeight: '256px',
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (blurTimeoutRef.current) {
                  clearTimeout(blurTimeoutRef.current);
                  blurTimeoutRef.current = null;
                }
              }}
              onMouseUp={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <div className="p-2 border-b border-gray-200 dark:border-[#404040]">
                <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff]">
                  选择提及或感知组件
                </div>
              </div>

              {/* 话题智能体列表 */}
              {topicParticipants.filter(p => p.participant_type === 'agent' && (p.name || '').toLowerCase().includes(atSelectorQuery.toLowerCase())).length > 0 && (
                <div className="py-1 border-b border-gray-100 dark:border-[#363636]">
                  <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5 flex items-center justify-between">
                    <span>话题参与者</span>
                  </div>
                  {topicParticipants
                    .filter(p => p.participant_type === 'agent' && (p.name || '').toLowerCase().includes(atSelectorQuery.toLowerCase()))
                    .map((agent) => {
                      const component = { type: 'agent' as const, id: agent.participant_id, name: agent.name || agent.participant_id };
                      const selectableComponents = getSelectableComponents();
                      const componentIndex = selectableComponents.findIndex(
                        (c: any) => c.id === component.id && c.type === component.type
                      );
                      const isSelected = componentIndex === selectedComponentIndex;

                      return (
                        <div
                          key={agent.participant_id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleSelectComponent(component);
                          }}
                          className={`px-3 py-2 cursor-pointer flex items-center space-x-2 ${
                            isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          <div className="w-5 h-5 rounded-full overflow-hidden bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
                            {agent.avatar ? (
                              <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                            ) : (
                              <Bot className="w-3 h-3 text-primary-600 dark:text-primary-400" />
                            )}
                          </div>
                          <span className="text-sm text-gray-900 dark:text-[#ffffff] truncate">
                            {agent.name}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* MCP 服务器列表 */}
              {mcpServers.filter(s => s.name.toLowerCase().includes(atSelectorQuery)).length > 0 && (
                <div className="py-1">
                  <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5 flex items-center justify-between">
                    <span>MCP 服务器</span>
                    <span className="text-[10px]">
                      ({connectedMcpServerIds.size} / {mcpServers.length} 已连接)
                    </span>
                  </div>
                  {mcpServers
                    .filter(s => s.name.toLowerCase().includes(atSelectorQuery))
                    .map((server) => {
                      const isConnected = connectedMcpServerIds.has(server.id);
                      const isConnecting = connectingServers.has(server.id);
                      const component = { type: 'mcp' as const, id: server.id, name: server.name };
                      const selectableComponents = getSelectableComponents();
                      const componentIndex = selectableComponents.findIndex(
                        (c) =>
                          c.id === component.id && c.type === component.type
                      );
                      const isSelected = componentIndex === selectedComponentIndex;

                      return (
                        <div
                          key={server.id}
                          onMouseDown={(e) => {
                            e.preventDefault(); // 防止触发输入框的 blur
                          }}
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (blurTimeoutRef.current) {
                              clearTimeout(blurTimeoutRef.current);
                              blurTimeoutRef.current = null;
                            }
                            if (isConnecting) return;
                            if (!isConnected) {
                              await handleConnectServer(server.id);
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

              {/* 无匹配结果 */}
              {mcpServers.filter(s => s.name.toLowerCase().includes(atSelectorQuery.toLowerCase())).length === 0 &&
                topicParticipants.filter(p => p.participant_type === 'agent' && (p.name || '').toLowerCase().includes(atSelectorQuery.toLowerCase())).length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-500 dark:text-[#b0b0b0] text-center">
                    未找到匹配的组件或智能体
                  </div>
                )}
            </div>
          )}
          
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
          
          {/* 会话类型选择对话框 - 已移除临时会话功能 */}

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

          {/* 模型选择对话框 */}
          <Dialog open={showModelSelectDialog} onOpenChange={(open) => {
            setShowModelSelectDialog(open);
            if (!open) {
              // 关闭对话框时重置 Tab 选择
              setSelectedProviderTab(null);
            }
          }}>
            <DialogContent className="max-w-md [data-skin='niho']:bg-[rgba(0,0,0,0.92)] [data-skin='niho']:border-[var(--niho-text-border)]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary-600 dark:text-primary-400 [data-skin='niho']:text-[var(--color-accent)]" />
                  选择模型
                </DialogTitle>
                <DialogDescription>
                  选择一个 LLM 模型用于对话
                </DialogDescription>
              </DialogHeader>
              {/* Tab 页签和模型列表 */}
              {(() => {
                // 按 supplier 分组（token/计费归属）。supplier = supplier ?? provider
                const groupedBySupplier = new Map<string, LLMConfigFromDB[]>();
                llmConfigs.forEach(config => {
                  const supplier = config.supplier || config.provider || 'other';
                  if (!groupedBySupplier.has(supplier)) {
                    groupedBySupplier.set(supplier, []);
                  }
                  groupedBySupplier.get(supplier)!.push(config);
                });
                
                const supplierEntries = Array.from(groupedBySupplier.entries());
                
                // 如果没有选中的 Tab，默认选中第一个
                const currentTab = selectedProviderTab || (supplierEntries.length > 0 ? supplierEntries[0][0] : null);
                
                // 获取 supplier 信息（优先用 providers 表的 name）
                const getSupplierName = (supplier: string): string => {
                  const providerObj = providers.find(p => p.provider_type === supplier || p.provider_id === supplier);
                  if (providerObj) return providerObj.name;
                  // 默认供应商名称映射（系统 supplier）
                  const supplierNames: Record<string, string> = {
                    openai: 'OpenAI',
                    anthropic: 'Anthropic',
                    gemini: 'Google Gemini',
                    deepseek: 'DeepSeek',
                    ollama: 'Ollama',
                    local: 'Local',
                    custom: 'Custom',
                  };
                  return supplierNames[supplier] || supplier;
                };
                
                // 获取 supplier 图标
                const getSupplierIconElement = (supplier: string, configs: LLMConfigFromDB[]): React.ReactNode => {
                  const iconInfo = getProviderIcon(configs[0], providers);
                  const pt = supplier.toLowerCase();
                  if (['openai', 'anthropic', 'google', 'gemini', 'deepseek', 'ollama'].includes(pt)) {
                    return <ProviderIcon provider={supplier} size={16} className="w-4 h-4 flex-shrink-0" />;
                  }
                  return (
                    <span className="text-sm" style={{ filter: 'saturate(1.2)' }}>
                      {iconInfo.icon}
                    </span>
                  );
                };
                
                return (
                  <div className="flex flex-col h-full">
                    {/* Tab 页签 */}
                    <div className="flex border-b border-gray-200 dark:border-[#404040] overflow-x-auto no-scrollbar [data-skin='niho']:border-[var(--niho-text-border)]">
                      {supplierEntries.map(([supplier, configs]) => {
                        const supplierName = getSupplierName(supplier);
                        const isActive = currentTab === supplier;
                        const supplierIcon = getSupplierIconElement(supplier, configs);
                        
                        return (
                          <button
                            key={supplier}
                            onClick={() => setSelectedProviderTab(supplier)}
                            className={`
                              flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap
                              border-b-2
                              ${isActive
                                ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                              }
                              [data-skin='niho']:bg-[rgba(0,0,0,0.15)]
                              [data-skin='niho']:text-[var(--niho-skyblue-gray)]
                              [data-skin='niho']:hover:text-[var(--niho-mist-pink)]
                              [data-skin='niho']:hover:border-[rgba(255,159,196,0.35)]
                              ${isActive ? "[data-skin='niho']:!bg-[rgba(42,15,63,0.35)] [data-skin='niho']:!border-[var(--color-accent)] [data-skin='niho']:!text-[var(--color-accent)] [data-skin='niho']:shadow-[0_0_16px_rgba(0,255,136,0.08)]" : ''}
                            `}
                          >
                            {supplierIcon && (
                              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                                {supplierIcon}
                              </div>
                            )}
                            <span>{supplierName}</span>
                            <span className={`
                              text-xs px-1.5 py-0.5 rounded-full
                              ${isActive
                                ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                              }
                              [data-skin='niho']:border [data-skin='niho']:border-[var(--niho-text-border)]
                              [data-skin='niho']:bg-[rgba(0,0,0,0.55)]
                              [data-skin='niho']:text-[var(--niho-skyblue-gray)]
                              ${isActive ? "[data-skin='niho']:!bg-[var(--niho-black-gold)] [data-skin='niho']:!border-[rgba(255,215,0,0.28)] [data-skin='niho']:!text-[var(--color-highlight)]" : ''}
                            `}>
                              {configs.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    
                    {/* 当前 Tab 的模型列表 */}
                    <div 
                      className="flex-1 overflow-y-auto pr-2"
                style={{ 
                        maxHeight: '50vh',
                }}
              >
                      {currentTab && groupedBySupplier.has(currentTab) && (
                <div className="space-y-1 py-2">
                          {groupedBySupplier.get(currentTab)!.map((config) => {
                    const isSelected = selectedLLMConfigId === config.config_id;
                    const isCallable = config.metadata?.is_callable !== false;
                    const providerInfo = getProviderIcon(config, providers);
                    const pt = (config.supplier || config.provider || 'openai').toLowerCase();
                    let avatarContent: React.ReactNode;
                    if (['openai', 'anthropic', 'google', 'gemini', 'deepseek', 'ollama'].includes(pt)) {
                      avatarContent = <ProviderIcon provider={pt} size={24} className="w-6 h-6 flex-shrink-0" />;
                    } else {
                      avatarContent = (
                        <span className="text-lg" style={{ filter: 'saturate(1.2)' }}>
                          {providerInfo.icon}
                        </span>
                      );
                    }
                    
                    return (
                      <div key={config.config_id} title={!isCallable ? '该模型不支持对话（仅支持生图等），不可用于聊天' : undefined}>
                        <DataListItem
                          id={config.config_id}
                          title={config.shortname || config.name}
                          description={
                            config.supplier && config.supplier !== config.provider
                              ? `${config.model || config.description || ''} · 兼容: ${config.provider}`
                              : (config.model || config.description || undefined)
                          }
                          avatar={avatarContent}
                          badge={
                            <CapabilityIcons
                              capabilities={config.metadata?.capabilities}
                              modelName={config.model}
                              className="w-3.5 h-3.5"
                            />
                          }
                          isSelected={isSelected}
                          disabled={!isCallable}
                          className={`
                            [data-skin='niho']:border [data-skin='niho']:border-[var(--niho-text-border)]
                            [data-skin='niho']:bg-[rgba(0,0,0,0.35)]
                            [data-skin='niho']:hover:bg-[rgba(143,183,201,0.06)]
                            [data-skin='niho']:hover:border-[rgba(143,183,201,0.25)]
                            ${isSelected ? "[data-skin='niho']:!bg-[rgba(42,15,63,0.55)] [data-skin='niho']:!border-[rgba(0,255,136,0.35)] [data-skin='niho']:shadow-[0_0_14px_rgba(0,255,136,0.10)]" : ''}
                          `}
                          onClick={() => {
                            handleLLMConfigChange(config.config_id);
                            setShowModelSelectDialog(false);
                            setIsInputFocused(true);
                            setTimeout(() => {
                              inputRef.current?.focus();
                            }, 50);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                      )}
              </div>
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>

          {/* 头像配置对话框 */}
          <AvatarConfigDialog
            open={showAvatarConfigDialog && !!currentSessionId }
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
          
          {/* 添加SOP对话框 */}
          <Dialog open={showAddSopDialog} onOpenChange={setShowAddSopDialog}>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>添加 SOP 技能包</DialogTitle>
                <DialogDescription>
                  创建一个纯文本的 SOP（标准作业流程）技能包，可用于指导话题群中的所有 Agent。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="sop-name">SOP 名称</Label>
                  <Input
                    id="sop-name"
                    value={sopName}
                    onChange={(e) => setSopName(e.target.value)}
                    placeholder="例如：客服回复流程"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="sop-text">SOP 内容</Label>
                  <Textarea
                    id="sop-text"
                    value={sopText}
                    onChange={(e) => setSopText(e.target.value)}
                    placeholder="请输入详细的 SOP 流程说明..."
                    rows={12}
                    className="mt-1 font-mono text-sm"
                  />
                </div>
                {currentSessionType === 'topic_general' && currentSessionId && (
                  <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                    创建后将自动分配到当前话题群并设为当前 SOP。
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowAddSopDialog(false);
                    setSopName('');
                    setSopText('');
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCreateSop}
                  disabled={isCreatingSop || !sopName.trim() || !sopText.trim()}
                >
                  {isCreatingSop ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      创建中...
                    </>
                  ) : (
                    '创建 SOP'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
          setSessions(filterVisibleSessions(allSessions));
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

    {/* TopicConfigDialog - 话题配置对话框 */}
    <TopicConfigDialog
      open={showTopicConfigDialog}
      onClose={() => setShowTopicConfigDialog(false)}
      topicId={currentSessionId || ''}
      topicName={topicConfigEditName}
      topicAvatar={topicConfigEditAvatar}
      topicDisplayType={topicConfigEditDisplayType}
      sessionType={(sessions.find(s => s.session_id === currentSessionId) || currentSessionMeta)?.session_type}
      participants={topicParticipants}
      editName={topicConfigEditName}
      setEditName={setTopicConfigEditName}
      editAvatar={topicConfigEditAvatar}
      setEditAvatar={setTopicConfigEditAvatar}
      editDisplayType={topicConfigEditDisplayType}
      setEditDisplayType={setTopicConfigEditDisplayType}
      onUpdateSessionType={async (newSessionType: 'topic_general' | 'agent') => {
        if (!currentSessionId) return;
        try {
          await updateSessionType(currentSessionId, newSessionType);
          // 刷新会话列表和当前会话
          const allSessions = await getSessions();
          setSessions(filterVisibleSessions(allSessions));
          const updatedSession = await getSession(currentSessionId);
          setCurrentSessionMeta(updatedSession);
          emitSessionsChanged();
          toast({
            title: '模式已切换',
            description: newSessionType === 'agent' ? '已开启积极模式' : '已关闭积极模式',
            variant: 'success',
          });
        } catch (error) {
          console.error('Failed to update session type:', error);
          toast({
            title: '更新失败',
            description: error instanceof Error ? error.message : '请重试',
            variant: 'destructive',
          });
        }
      }}
      onSave={async () => {
        if (!currentSessionId) return;
        try {
          const promises: Promise<unknown>[] = [];
          
          // 更新名称
          const currentSession = sessions.find(s => s.session_id === currentSessionId) || currentSessionMeta;
          if (topicConfigEditName !== (currentSession?.name || currentSession?.title || '')) {
            promises.push(updateSessionName(currentSessionId, topicConfigEditName));
          }
          
          // 更新头像
          if (topicConfigEditAvatar !== (currentSession?.avatar || null)) {
            promises.push(updateSessionAvatar(currentSessionId, topicConfigEditAvatar || ''));
            setCurrentSessionAvatar(topicConfigEditAvatar);
          }
          
          // 更新展示类型 (存储在 ext 字段)
          const currentExt = currentSession?.ext || {};
          if (topicConfigEditDisplayType !== (currentExt.displayType || 'chat')) {
            promises.push(updateSession(currentSessionId, {
              ext: { ...currentExt, displayType: topicConfigEditDisplayType }
            }));
          }
          
          await Promise.all(promises);
          
          // 刷新会话列表
          const allSessions = await getSessions();
          setSessions(filterVisibleSessions(allSessions));
          emitSessionsChanged();
          
          setShowTopicConfigDialog(false);
        } catch (error) {
          console.error('Failed to save topic config:', error);
          alert('保存失败，请重试');
        }
      }}
      onAddParticipant={async (agentId: string) => {
        if (!currentSessionId) return;
        try {
          await addSessionParticipant(currentSessionId, agentId, 'agent');
          // 重新加载参与者
          const participants = await getParticipants(currentSessionId);
          setTopicParticipants(participants);
        } catch (error) {
          console.error('Failed to add participant:', error);
          alert('添加参与者失败');
        }
      }}
      onRemoveParticipant={async (participantId: string) => {
        if (!currentSessionId) return;
        try {
          await removeSessionParticipant(currentSessionId, participantId);
          // 重新加载参与者
          const participants = await getParticipants(currentSessionId);
          setTopicParticipants(participants);
        } catch (error) {
          console.error('Failed to remove participant:', error);
          alert('移除参与者失败');
        }
      }}
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
      personaTopics={personaTopics}
      currentSessionId={currentSessionId}
      onSwitchSession={switchSessionFromPersona}
      onDeleteAgent={(id, name) => setDeleteSessionTarget({ id, name })}
      onShowRoleGenerator={() => setShowRoleGenerator(true)}
    />

    {/* 人设切换弹框（点击输入框上「人设」打开，仅 Chaya） */}
    {currentSessionId === 'agent_chaya' && (() => {
      const chayaSession = sessions.find(s => s.session_id === 'agent_chaya') || (currentSessionMeta?.session_id === 'agent_chaya' ? currentSessionMeta : null);
      const personaPresets: PersonaPreset[] = (chayaSession?.ext as any)?.personaPresets ?? [];
      const currentPersonaId = (chayaSession?.ext as any)?.currentPersonaId as string | undefined;
      return (
        <PersonaSwitchDialog
          open={showPersonaSwitchDialog}
          onOpenChange={setShowPersonaSwitchDialog}
          personaPresets={personaPresets}
          currentPersonaId={currentPersonaId}
          personaSwitchLoading={personaSwitchLoading}
          personaSaveLoading={personaSaveLoading}
          onSwitchPersona={async (presetId) => {
            const preset = personaPresets.find(p => p.id === presetId);
            if (!preset || !chayaSession) return;
            setPersonaSwitchLoading(true);
            try {
              const ext = { ...(chayaSession.ext || {}), currentPersonaId: preset.id };
              await updateRoleProfile('agent_chaya', { system_prompt: preset.system_prompt, ext });
              setCurrentSystemPrompt(preset.system_prompt);
              const fresh = await getSession('agent_chaya');
              setCurrentSessionMeta(fresh);
              emitSessionsChanged();
            } catch (e) {
              console.warn('[Workflow] Switch persona preset failed:', e);
              toast({ title: '切换人设失败', variant: 'destructive' });
            } finally {
              setPersonaSwitchLoading(false);
            }
          }}
          onSavePersona={async (preset) => {
            if (!chayaSession) return;
            setPersonaSaveLoading(true);
            try {
              const nextPresets = personaPresets.map((p) => (p.id === preset.id ? preset : p));
              const ext = { ...(chayaSession.ext || {}), personaPresets: nextPresets };
              const isCurrent = currentPersonaId === preset.id;
              await updateRoleProfile('agent_chaya', {
                ext,
                ...(isCurrent ? { system_prompt: preset.system_prompt } : {}),
                reason: 'persona_edit_in_dialog',
              });
              if (isCurrent) setCurrentSystemPrompt(preset.system_prompt);
              const fresh = await getSession('agent_chaya');
              setCurrentSessionMeta(fresh);
              emitSessionsChanged();
              toast({ title: '人设已保存，Chaya 已更新', variant: 'success' });
            } catch (e) {
              console.warn('[Workflow] Save persona in dialog failed:', e);
              toast({ title: '保存失败', variant: 'destructive' });
            } finally {
              setPersonaSaveLoading(false);
            }
          }}
        />
      );
    })()}

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

    {/* Agent Persona 配置对话框 */}
    <AgentPersonaDialog
      agent={agentPersonaDialogAgent}
      open={showAgentPersonaDialog}
      onOpenChange={setShowAgentPersonaDialog}
      initialTab="persona"
      onSaved={async () => {
        // 刷新会话和参与者信息
        if (currentSessionId) {
          await loadSessions();
          // 刷新当前会话元数据
          try {
            const updatedSession = await getSession(currentSessionId);
            setCurrentSessionMeta(updatedSession);
          } catch (error) {
            console.error('[Workflow] Failed to refresh session:', error);
          }
          // 如果是 topic，刷新参与者信息
          if (currentSessionType === 'topic_general') {
            try {
              const participants = await getParticipants(currentSessionId);
              setTopicParticipants(participants);
            } catch (error) {
              console.error('[Workflow] Failed to refresh participants:', error);
            }
          }
        }
        // 触发会话变更事件
        emitSessionsChanged();
      }}
    />

    {/* 会话内：媒体预览（弹窗样式） */}
    <MediaPreviewDialog
      open={mediaPreviewOpen}
      onOpenChange={(open) => {
        setMediaPreviewOpen(open);
        if (!open) setMediaPreviewItem(null);
      }}
      item={mediaPreviewItem}
      title="图片/媒体预览"
    />
      </div>
        </div>
      </div>
    </>
  );
};

// Workflow component export
export default Workflow;
