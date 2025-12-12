/**
 * 左侧会话列表组件
 * 会话（过程）与角色（资产）分层：
 * - 对话：历史会话/任务记录
 * - 角色库：可复用的角色（agent），支持版本与“从角色开始新会话”
 */

import React, { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Sparkles, Plus, Trash2, Search, ArrowUp, Upload, History, ChevronLeft } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { ScrollArea } from './ui/ScrollArea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { toast } from './ui/use-toast';
import { 
  getSessions, 
  createSession, 
  deleteSession, 
  Session,
  getAgents,
  upgradeToAgent,
  importAgentFromFile,
  importAgent,
  getSessionMessages
} from '../services/sessionApi';
import { activateRoleVersion, applyRoleToSession, createSessionFromRole, listRoleVersions, updateRoleProfile, type RoleVersion } from '../services/roleApi';
import { emitSessionsChanged, SESSIONS_CHANGED_EVENT } from '../utils/sessionEvents';
import { RoleGeneratorDrawer } from './RoleGeneratorDrawer';

interface SessionSidebarProps {
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  isRoundTableMode?: boolean; // 是否为圆桌模式
  onAddToRoundTable?: (sessionId: string) => void; // 添加到圆桌会议的回调
  onConfigSession?: (sessionId: string) => void; // 配置会话的回调（打开配置对话框）
}

const SessionSidebar: React.FC<SessionSidebarProps> = ({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  isRoundTableMode = false,
  onAddToRoundTable,
  onConfigSession,
}) => {
  const [memorySessions, setMemorySessions] = useState<Session[]>([]);
  const [agentSessions, setAgentSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [upgradeTarget, setUpgradeTarget] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<'chats' | 'roles'>(() => (isRoundTableMode ? 'roles' : 'chats'));
  const [roleVersionsTarget, setRoleVersionsTarget] = useState<Session | null>(null);
  const [roleVersions, setRoleVersions] = useState<RoleVersion[]>([]);
  const [isLoadingRoleVersions, setIsLoadingRoleVersions] = useState(false);
  const [activatingVersionId, setActivatingVersionId] = useState<string | null>(null);
  const [roleGeneratorRoleId, setRoleGeneratorRoleId] = useState<string | null>(null);
  const [isRoleGeneratorOpen, setIsRoleGeneratorOpen] = useState(false);
  const [roleScope, setRoleScope] = useState<Session | null>(null);
  const [showAllChats, setShowAllChats] = useState(false);
  const createMenuRef = React.useRef<HTMLDivElement>(null);
  const missingNameLoggedRef = React.useRef<Set<string>>(new Set());
  const selectedSessionIdRef = React.useRef<string | null>(selectedSessionId);
  const temporarySessionId = 'temporary-session';
  const normalizeText = (text?: string | null) => (text || '').trim();
  const isPlaceholderTitle = (title?: string | null) => {
    const t = normalizeText(title);
    return !t || t === '新会话';
  };
  const truncatePreview = (text: string, maxLen: number = 30) => {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLen) return cleaned;
    return `${cleaned.slice(0, maxLen)}...`;
  };

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    if (activeTab === 'chats' && roleScope) {
      setRoleScope(null);
    }
  }, [activeTab, roleScope]);

  const fetchPreviewForSession = async (sessionId: string) => {
    const pageSize = 50;
    // 先拉取一条获取总数
    const firstRes = await getSessionMessages(sessionId, 1, 1);
    const total = firstRes.total || firstRes.messages?.length || 0;
    let candidates = firstRes.messages || [];

    // 拉取最早一页（因为接口按时间倒序，需要取最后一页才能拿到第一条消息）
    if (total > 1) {
      const lastPage = Math.max(1, Math.ceil(total / pageSize));
      const lastRes = await getSessionMessages(sessionId, lastPage, pageSize);
      candidates = [...(lastRes.messages || []), ...candidates];
    }

    // 将消息按时间正序，优先找第一条用户消息，其次任意非空消息
    const ordered = [...candidates].reverse();
    const firstUser = ordered.find(m => m?.role === 'user' && m?.content?.trim());
    const firstAny = ordered.find(m => m?.content?.trim());
    const msg = firstUser?.content || firstAny?.content || '';
    if (!msg) {
      console.warn('[SessionSidebar] 未找到可用内容生成预览', sessionId, 'total:', total, '候选数:', candidates.length);
    }
    return msg ? truncatePreview(msg) : undefined;
  };

  // 加载所有会话（包括记忆体和智能体）
  const loadAllSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const [sessionsData, agentsData] = await Promise.all([
        getSessions(),
        getAgents()
      ]);
      
      // 兼容后端返回结构：有的接口返回 { sessions: [] }，有的直接返回数组
      const sessionsList = Array.isArray(sessionsData) ? sessionsData : ((sessionsData as any).sessions || []);
      const agentsList = Array.isArray(agentsData) ? agentsData : ((agentsData as any).sessions || (agentsData as any).agents || []);
      
      // 记忆体/普通会话：仅展示有内容的，避免空会话占位
      const hasMessages = (s: Session) => (s.message_count || 0) > 0 || Boolean(s.last_message_at);
      const selectedId = selectedSessionIdRef.current;
      const memories = sessionsList.filter(s => {
        if (!(s.session_type === 'memory' || !s.session_type)) return false;
        if (hasMessages(s)) return true;
        // 允许展示当前选中的“空会话”（例如：从角色开始的新对话）
        return Boolean(selectedId) && s.session_id === selectedId;
      });
      const agents = agentsList.filter(s => s.session_type === 'agent');

      // 为缺少名称和预览的会话补充一段文本，方便识别
      const needPreview = memories.filter(
        s => {
          const titlePlaceholder = isPlaceholderTitle(s.title);
          const hasUsefulTitle = !titlePlaceholder;
          const hasName = Boolean(normalizeText(s.name));
          const hasPreview = Boolean(normalizeText(s.preview_text));
          return !(hasName || hasUsefulTitle || hasPreview) && (s.message_count || 0) > 0;
        }
      );
      const previewMap: Record<string, string> = {};
      const previewCandidates = needPreview.slice(0, 30); // 适当扩大补充范围
      if (previewCandidates.length > 0) {
        const results = await Promise.allSettled(
          previewCandidates.map(async (session) => {
            const preview = await fetchPreviewForSession(session.session_id);
            if (preview) {
              previewMap[session.session_id] = preview;
            }
          })
        );
        results.forEach((r, idx) => {
          if (r.status === 'rejected') {
            console.warn('[SessionSidebar] Failed to load preview', previewCandidates[idx]?.session_id, r.reason);
          }
        });
      }

      const sessionsWithPreview = memories.map(session => {
        const filledPreview = normalizeText(session.preview_text) || previewMap[session.session_id];
        const titleNormalized = normalizeText(session.title);
        return {
          ...session,
          title: isPlaceholderTitle(session.title) ? '' : titleNormalized,
          preview_text: filledPreview || undefined,
        };
      });
      
      // 打印仍缺少标题的会话，便于排查
      const stillMissing = sessionsWithPreview.filter(
        s => !(s.name || s.title || s.preview_text)
      );
      if (stillMissing.length > 0) {
        console.warn('[SessionSidebar] 仍有未补全标题的会话', stillMissing.map(s => ({
          id: s.session_id,
          message_count: s.message_count,
          last_message_at: s.last_message_at,
        })));
      }

      setMemorySessions(sessionsWithPreview);
      setAgentSessions(agents);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setMemorySessions([]);
      setAgentSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 加载数据
  useEffect(() => {
    loadAllSessions();
  }, [loadAllSessions]);

  // 外部触发：会话/角色数据变更时刷新（例如从聊天配置弹窗“保存为角色”）
  useEffect(() => {
    const handler = () => {
      loadAllSessions();
    };
    window.addEventListener(SESSIONS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, handler);
  }, [loadAllSessions]);

  useEffect(() => {
    if (isRoundTableMode) {
      setActiveTab('roles');
    }
  }, [isRoundTableMode]);

  // 默认选中临时会话（如果当前没有选中任何会话）
  useEffect(() => {
    if (!selectedSessionId && !isLoading) {
      onSelectSession('temporary-session');
    }
  }, [selectedSessionId, isLoading, onSelectSession]);

  // 创建新会话（记忆体）
  const handleCreateMemory = async () => {
    try {
      setShowCreateMenu(false);
      const newSession = await createSession(undefined, undefined, 'memory');
      selectedSessionIdRef.current = newSession.session_id;
      await loadAllSessions();
      onSelectSession(newSession.session_id);
      onNewSession();
    } catch (error) {
      console.error('Failed to create memory:', error);
    }
  };

  // 创建新智能体（默认，不包含头像人设等配置）
  const handleCreateAgent = async () => {
    try {
      setShowCreateMenu(false);
      const newSession = await createSession(undefined, undefined, 'agent');
      await loadAllSessions();
      setActiveTab('roles');
      if (onConfigSession) {
        onConfigSession(newSession.session_id);
      } else {
        onSelectSession(newSession.session_id);
        onNewSession();
      }
    } catch (error) {
      console.error('Failed to create agent:', error);
    }
  };

  // 创建新角色并打开“角色生成器”抽屉
  const handleCreateRoleWithGenerator = async () => {
    try {
      setShowCreateMenu(false);
      const newRole = await createSession(undefined, undefined, 'agent');
      await loadAllSessions();
      setActiveTab('roles');
      onSelectSession(newRole.session_id);
      setRoleGeneratorRoleId(newRole.session_id);
      setIsRoleGeneratorOpen(true);
    } catch (error) {
      console.error('Failed to create role:', error);
      toast({
        title: '创建角色失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 创建临时会话
  const handleCreateTemporary = () => {
    setShowCreateMenu(false);
    onSelectSession(temporarySessionId);
    onNewSession();
  };

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(event.target as Node)) {
        setShowCreateMenu(false);
      }
    };

    if (showCreateMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showCreateMenu]);

  // 删除会话（执行）
  const performDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      await loadAllSessions();
      if (selectedSessionId === sessionId) {
        onSelectSession('');
      }
      toast({ title: '会话已删除', variant: 'success' });
    } catch (error) {
      console.error('Failed to delete session:', error);
      toast({
        title: '删除会话失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 删除会话（确认）
  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const target =
      [...memorySessions, ...agentSessions].find((s) => s.session_id === sessionId) || null;
    setDeleteTarget(target);
  };

  // 添加到圆桌会议
  const handleAddToRoundTable = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (onAddToRoundTable) {
      onAddToRoundTable(sessionId);
    }
  };

  // 点击头像打开配置对话框
  const handleAvatarClick = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    if (onConfigSession) {
      onConfigSession(session.session_id);
    }
  };

  // 升级为智能体（执行）
  const performUpgradeToAgent = async (session: Session) => {
    try {
      const name = session.name || getDisplayName(session);
      const avatar = session.avatar || '';
      const systemPrompt = session.system_prompt || '';
      const llmConfigId = session.llm_config_id || '';

      if (!avatar || !systemPrompt || !llmConfigId) {
        toast({
          title: '需要完善角色信息',
          description: '请先设置头像、人设与默认LLM，然后再升级为角色。',
          variant: 'destructive',
        });
        onConfigSession?.(session.session_id);
        return;
      }

      await upgradeToAgent(session.session_id, name, avatar, systemPrompt, llmConfigId);
      await loadAllSessions();
      toast({ title: '升级成功', variant: 'success' });
    } catch (error) {
      console.error('Failed to upgrade to agent:', error);
      toast({
        title: '升级失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      });
    }
  };

  const performPromoteToSourceRole = async (session: Session) => {
    const roleId = session.role_id || null;
    if (!roleId) return;

    const systemPrompt = (session.system_prompt || '').trim();
    const llmConfigId = (session.llm_config_id || '').trim();

    if (!systemPrompt || !llmConfigId) {
      toast({
        title: '需要完善信息',
        description: '沉淀到角色需要：人设与默认LLM（可在配置里设置）。',
        variant: 'destructive',
      });
      onConfigSession?.(session.session_id);
      return;
    }

    try {
      const roleDisplay =
        agentSessions.find((a) => a.session_id === roleId)?.name ||
        agentSessions.find((a) => a.session_id === roleId)?.title ||
        `角色 ${roleId.slice(0, 8)}`;

      const updated = await updateRoleProfile(roleId, {
        system_prompt: systemPrompt,
        llm_config_id: llmConfigId,
        avatar: session.avatar || null,
        reason: 'promote_from_chat',
      });

      await applyRoleToSession({
        session_id: session.session_id,
        role_id: roleId,
        role_version_id: updated.current_role_version_id || undefined,
        keep_session_llm_config: false,
      });

      emitSessionsChanged();
      await loadAllSessions();
      toast({
        title: '已沉淀到角色版本',
        description: `已更新「${roleDisplay}」并生成新版本`,
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to promote to source role:', error);
      toast({
        title: '沉淀失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 升级为智能体（确认）
  const handleUpgradeToAgent = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    if (session.session_type === 'agent') {
      toast({ title: '该会话已经是智能体', variant: 'destructive' });
      return;
    }
    setUpgradeTarget(session);
  };

  // 获取显示名称
  const getDisplayName = (session: Session): string => {
    const name =
      normalizeText(session.name) ||
      (isPlaceholderTitle(session.title) ? '' : normalizeText(session.title)) ||
      normalizeText(session.preview_text) ||
      session.system_prompt ||
      `会话-${session.session_id?.slice(0, 8) || '新会话'}`;

    return logIfMissingDisplay(session, name);
  };
  const logIfMissingDisplay = (session: Session, displayName: string) => {
    if (displayName.startsWith('会话-') || displayName === '新会话') {
      const id = session.session_id;
      if (!missingNameLoggedRef.current.has(id)) {
        missingNameLoggedRef.current.add(id);
        console.warn('[SessionSidebar] 显示名回退为默认', {
          session_id: id,
          message_count: session.message_count,
          last_message_at: session.last_message_at,
          hasName: Boolean(session.name),
          hasTitle: Boolean(session.title),
          hasPreview: Boolean(session.preview_text),
          hasSystemPrompt: Boolean(session.system_prompt),
        });
      }
    }
    return displayName;
  };

  // 导入智能体配置
  const handleImportAgent = async () => {
    try {
      setIsImporting(true);
      // 从文件选择器获取配置数据
      const data = await importAgentFromFile();
      
      // 导入智能体
      const result = await importAgent(data, 'use_existing');
      
      // 刷新列表并选中新导入的智能体
      await loadAllSessions();
      setActiveTab('roles');
      if (onConfigSession) {
        onConfigSession(result.session_id);
      } else {
        onSelectSession(result.session_id);
      }
      
      alert(`智能体 "${result.name}" 导入成功！`);
    } catch (error) {
      console.error('Failed to import agent:', error);
      if (error instanceof Error && error.message !== 'No file selected') {
        alert('导入失败：' + error.message);
      }
    } finally {
      setIsImporting(false);
    }
  };

  // 获取显示列表（包含临时会话、记忆体、智能体）
  const getDisplayList = (): Session[] => {
    let list: Session[] = [];

    if (activeTab === 'roles') {
      if (roleScope) {
        list = memorySessions.filter(
          (s) => (s.session_type === 'memory' || !s.session_type) && s.role_id === roleScope.session_id,
        );
      } else {
        list = [...agentSessions];
      }
    } else {
      const selectedId = selectedSessionIdRef.current;
      list = memorySessions.filter((s) => {
        const isMemory = s.session_type === 'memory' || !s.session_type;
        if (!isMemory) return false;
        if (showAllChats) return true;
        if (!s.role_id) return true;
        return Boolean(selectedId) && s.session_id === selectedId;
      });
    }

    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter((session) => {
        const name = getDisplayName(session).toLowerCase();
        const title = (session.title || '').toLowerCase();
        const preview = (session.preview_text || '').toLowerCase();
        return name.includes(query) || title.includes(query) || preview.includes(query);
      });
    }

    return list;
  };

  const displayList = getDisplayList();
  const isTemporarySelected = selectedSessionId === temporarySessionId;

  const getConversationTitle = (session: Session) => {
    const title = normalizeText(session.title);
    if (title && !isPlaceholderTitle(title)) return title;
    const preview = normalizeText(session.preview_text);
    if (preview) return preview;
    return '新对话';
  };

  const handleStartChatFromRole = async (e: React.MouseEvent | null, role: Session) => {
    e?.stopPropagation();
    try {
      const session = await createSessionFromRole({
        role_id: role.session_id,
        role_version_id: role.current_role_version_id || undefined,
      });
      selectedSessionIdRef.current = session.session_id;
      emitSessionsChanged();
      await loadAllSessions();
      onSelectSession(session.session_id);
      onNewSession();
      setActiveTab('roles');
      setRoleScope(role);
      toast({ title: '已从角色创建会话', variant: 'success' });
    } catch (error) {
      toast({
        title: '创建会话失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const openRoleVersions = (e: React.MouseEvent, role: Session) => {
    e.stopPropagation();
    setRoleVersionsTarget(role);
  };

  useEffect(() => {
    const role = roleVersionsTarget;
    if (!role) return;
    let canceled = false;
    (async () => {
      try {
        setIsLoadingRoleVersions(true);
        const versions = await listRoleVersions(role.session_id);
        if (!canceled) setRoleVersions(versions);
      } catch (error) {
        console.error('Failed to load role versions:', error);
        if (!canceled) setRoleVersions([]);
      } finally {
        if (!canceled) setIsLoadingRoleVersions(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [roleVersionsTarget]);

  const handleActivateRoleVersion = async (versionId: string) => {
    const role = roleVersionsTarget;
    if (!role) return;
    try {
      setActivatingVersionId(versionId);
      await activateRoleVersion(role.session_id, versionId);
      await loadAllSessions();
      const versions = await listRoleVersions(role.session_id);
      setRoleVersions(versions);
      toast({ title: '已切换角色版本', variant: 'success' });
    } catch (error) {
      toast({
        title: '切换版本失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setActivatingVersionId(null);
    }
  };

  return (
    <div className="w-full min-w-0 flex flex-col h-full">
      {/* 搜索框和新建按钮 */}
      <div className="p-2.5 border-b border-gray-200 dark:border-[#404040] bg-gray-50/50 dark:bg-[#363636]/30">
        {/* tabs */}
        <div className="flex items-center gap-1.5 mb-2">
          <button
            className={`flex-1 h-8 rounded-lg text-xs font-medium border transition-colors ${
              activeTab === 'chats'
                ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                : 'bg-white dark:bg-[#363636] text-gray-700 dark:text-[#e0e0e0] border-gray-200 dark:border-[#404040] hover:bg-gray-100 dark:hover:bg-[#404040]'
            }`}
            onClick={() => setActiveTab('chats')}
          >
            对话
          </button>
          <button
            className={`flex-1 h-8 rounded-lg text-xs font-medium border transition-colors ${
              activeTab === 'roles'
                ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                : 'bg-white dark:bg-[#363636] text-gray-700 dark:text-[#e0e0e0] border-gray-200 dark:border-[#404040] hover:bg-gray-100 dark:hover:bg-[#404040]'
            }`}
            onClick={() => setActiveTab('roles')}
          >
            角色库
          </button>
        </div>

        {activeTab === 'roles' && roleScope && (
          <div className="flex items-center gap-2 mb-2">
            <button
              className="h-8 px-2 rounded-lg text-xs font-medium border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#363636] text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-1"
              onClick={() => setRoleScope(null)}
              title="返回角色库"
            >
              <ChevronLeft className="w-4 h-4" />
              返回
            </button>
            <div className="flex-1 min-w-0 text-xs text-gray-600 dark:text-[#b0b0b0] truncate">
              {getDisplayName(roleScope)}
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => handleStartChatFromRole(null, roleScope)}
              title="用该角色新建对话"
            >
              <MessageCircle className="w-4 h-4" />
              新对话
            </Button>
          </div>
        )}

        <div className="flex gap-1.5">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-[#808080]" />
            <Input
              type="text"
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-2 py-1.5 text-sm"
            />
          </div>
          {activeTab === 'chats' && (
            <button
              className={`h-9 px-2 rounded-md text-xs font-medium border transition-colors ${
                showAllChats
                  ? 'bg-[var(--color-accent-bg)] text-[var(--color-accent)] border-[var(--color-accent)]/30'
                  : 'bg-white dark:bg-[#363636] text-gray-700 dark:text-[#e0e0e0] border-gray-200 dark:border-[#404040] hover:bg-gray-100 dark:hover:bg-[#404040]'
              }`}
              onClick={() => setShowAllChats((v) => !v)}
              title={showAllChats ? '当前显示全部对话（含角色对话）' : '当前仅显示独立对话'}
            >
              {showAllChats ? '全部' : '独立'}
            </button>
          )}
          <div className="relative" ref={createMenuRef}>
            <Button
              onClick={() => setShowCreateMenu((v) => !v)}
              variant="primary"
              size="icon"
              title="新建"
            >
              <Plus className="w-4 h-4" />
            </Button>
            {showCreateMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-[#363636] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg dark:shadow-[0_4px_16px_rgba(0,0,0,0.3)] z-50 overflow-hidden">
                {activeTab === 'chats' ? (
                  <>
                    <button
                      onClick={handleCreateTemporary}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-2 transition-colors"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span>临时会话</span>
                    </button>
                    <button
                      onClick={handleCreateMemory}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-2 transition-colors border-t border-gray-100 dark:border-[#404040]"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>记忆体</span>
                    </button>
                  </>
                ) : (
                  <>
                    {roleScope ? (
                      <button
                        onClick={() => handleStartChatFromRole(null, roleScope)}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-2 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>新建对话</span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleCreateRoleWithGenerator}
                          className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-2 transition-colors"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>新建角色</span>
                        </button>
                        <button
                          onClick={handleCreateAgent}
                          className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-2 transition-colors border-t border-gray-100 dark:border-[#404040]"
                        >
                          <Plus className="w-4 h-4" />
                          <span>空白角色</span>
                        </button>
                        <button
                          onClick={handleImportAgent}
                          disabled={isImporting}
                          className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-2 transition-colors border-t border-gray-100 dark:border-[#404040] disabled:opacity-60"
                        >
                          {isImporting ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Upload className="w-4 h-4" />
                          )}
                          <span>{isImporting ? '导入中...' : '导入角色'}</span>
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 列表内容 */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-accent)]"></div>
          </div>
        ) : (
          <div className="p-1.5 pr-3 space-y-1.5">
            {/* 临时会话选项 - 仅对话tab显示 */}
            {activeTab === 'chats' && (
              <div
                onClick={() => onSelectSession(temporarySessionId)}
                className={`
                  group relative px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150
                  ${isTemporarySelected
                    ? "bg-[var(--color-selected-bg)] border border-[var(--color-selected-border)] before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-r before:bg-[var(--color-accent)]"
                    : 'hover:bg-[var(--color-hover-bg)]'
                  }
                `}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 dark:text-white truncate">
                      临时会话
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-[#808080]">
                      (不保存历史)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {displayList.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-[#808080]">
                <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-xs">
                  {activeTab === 'roles' ? (roleScope ? '暂无对话' : '暂无角色') : '暂无会话'}
                </p>
              </div>
            ) : (
              displayList.map((session) => {
                const isSelected = selectedSessionId === session.session_id;
                const isRoleRoot = activeTab === 'roles' && !roleScope;
                const isRoleConversationList = activeTab === 'roles' && Boolean(roleScope);
                const displayName = isRoleConversationList ? getConversationTitle(session) : getDisplayName(session);
                const onRowClick = () => {
                  if (isRoleRoot && session.session_type === 'agent') {
                    setRoleScope(session);
                    return;
                  }
                  onSelectSession(session.session_id);
                };

                return (
                  <div
                    key={session.session_id}
                    onClick={onRowClick}
                    className={`
                      group relative px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150
                      ${isSelected
                        ? 'bg-[var(--color-selected-bg)] border border-[var(--color-selected-border)]'
                        : 'hover:bg-[var(--color-hover-bg)]'
                      }
                    `}
                  >
                    <div className="grid grid-cols-[auto,1fr,auto] items-center gap-2.5">
                    {/* 头像 - 可点击打开配置 */}
                    {session.avatar ? (
                      <img
                        src={session.avatar}
                        alt={displayName}
                        onClick={(e) => handleAvatarClick(e, session)}
                        className="w-7 h-7 rounded-lg flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-[var(--color-accent)]/50 transition-all"
                        title="点击配置"
                      />
                    ) : (
                      <div 
                        onClick={(e) => handleAvatarClick(e, session)}
                        className="w-7 h-7 rounded-lg bg-[var(--color-accent-bg)] flex items-center justify-center flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-[var(--color-accent)]/50 transition-all"
                        title="点击配置"
                      >
                        <MessageCircle className="w-4 h-4 text-[var(--color-accent)]" />
                      </div>
                    )}
                    
                    {/* 内容 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <div className="font-medium text-sm text-gray-900 dark:text-white truncate">
                          {displayName}
                        </div>
                        {/* 智能体图标标记 */}
                        {activeTab === 'roles' && !roleScope && session.session_type === 'agent' && (
                          <Sparkles className="w-3 h-3 text-[var(--color-accent)] flex-shrink-0" title="智能体" />
                        )}
                      </div>
                      {isRoleConversationList && session.last_message_at && (
                        <div className="text-[11px] text-gray-500 dark:text-[#b0b0b0] truncate">
                          {new Date(session.last_message_at).toLocaleString()}
                        </div>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-self-end pointer-events-none group-hover:pointer-events-auto">
                      {activeTab === 'roles' && !roleScope && (
                        <button
                          onClick={(e) => handleStartChatFromRole(e, session)}
                          className="p-1 hover:bg-[var(--color-accent-bg)] rounded transition-colors"
                          title="从该角色开始新对话"
                        >
                          <MessageCircle className="w-4 h-4 text-[var(--color-accent)]" />
                        </button>
                      )}
                      {activeTab === 'roles' && !roleScope && (
                        <button
                          onClick={(e) => openRoleVersions(e, session)}
                          className="p-1 hover:bg-[var(--color-accent-bg)] rounded transition-colors"
                          title="角色版本历史"
                        >
                          <History className="w-4 h-4 text-[var(--color-accent)]" />
                        </button>
                      )}
                      {activeTab === 'roles' && roleScope && (
                        <button
                          onClick={(e) => handleUpgradeToAgent(e, session)}
                          className="p-1 hover:bg-[var(--color-accent-bg)] rounded transition-colors"
                          title="沉淀为该角色的新版本"
                        >
                          <History className="w-4 h-4 text-[var(--color-accent)]" />
                        </button>
                      )}
                      {isRoundTableMode && activeTab === 'roles' && session.session_type === 'agent' && (
                        <button
                          onClick={(e) => handleAddToRoundTable(e, session.session_id)}
                          className="p-1 hover:bg-[var(--color-accent-bg)] rounded transition-colors"
                          title="添加到圆桌会议"
                        >
                          <Plus className="w-4 h-4 text-[var(--color-accent)]" />
                        </button>
                      )}
                      {/* 升级为智能体按钮（仅记忆体显示） */}
                    {activeTab === 'chats' && session.session_type === 'memory' && (
                      <button
                        onClick={(e) => handleUpgradeToAgent(e, session)}
                        className="p-1 hover:bg-[var(--color-accent-bg)] rounded transition-colors"
                        title={session.role_id ? '沉淀为来源角色的新版本' : '升级为智能体'}
                      >
                        {session.role_id ? (
                          <History className="w-4 h-4 text-[var(--color-accent)]" />
                        ) : (
                          <ArrowUp className="w-4 h-4 text-[var(--color-accent)]" />
                        )}
                      </button>
                    )}
                      <button
                        onClick={(e) => handleDeleteSession(e, session.session_id)}
                        className="p-1 hover:bg-red-500/10 rounded transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </ScrollArea>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget ? getDisplayName(deleteTarget) : ''}」吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleteTarget) return;
                const id = deleteTarget.session_id;
                setDeleteTarget(null);
                await performDeleteSession(id);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RoleGeneratorDrawer
        open={isRoleGeneratorOpen}
        roleId={roleGeneratorRoleId}
        onOpenChange={(next) => {
          setIsRoleGeneratorOpen(next);
          if (!next) setRoleGeneratorRoleId(null);
        }}
        onOpenRoleConfig={(id) => onConfigSession?.(id)}
      />

      <Dialog
        open={upgradeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUpgradeTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{upgradeTarget?.role_id ? '沉淀为角色版本' : '升级为智能体'}</DialogTitle>
            <DialogDescription>
              {upgradeTarget?.role_id
                ? `将「${upgradeTarget ? getDisplayName(upgradeTarget) : ''}」的配置沉淀回来源角色（生成新版本，不会新建角色）。`
                : `将「${upgradeTarget ? getDisplayName(upgradeTarget) : ''}」升级为智能体后，将作为可复用的 Agent 出现在智能体列表中。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="secondary" onClick={() => setUpgradeTarget(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!upgradeTarget) return;
                const target = upgradeTarget;
                setUpgradeTarget(null);
                if (target.role_id) {
                  await performPromoteToSourceRole(target);
                } else {
                  await performUpgradeToAgent(target);
                }
              }}
            >
              {upgradeTarget?.role_id ? '沉淀' : '升级'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={roleVersionsTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRoleVersionsTarget(null);
            setRoleVersions([]);
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>角色版本</DialogTitle>
            <DialogDescription>
              {roleVersionsTarget ? `角色：${getDisplayName(roleVersionsTarget)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 max-h-[360px] overflow-auto space-y-2">
            {isLoadingRoleVersions ? (
              <div className="text-sm text-gray-500 dark:text-[#b0b0b0]">加载中...</div>
            ) : roleVersions.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-[#b0b0b0]">暂无版本</div>
            ) : (
              roleVersions.map((v) => (
                <div
                  key={v.version_id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-xs text-gray-700 dark:text-[#e0e0e0] truncate">{v.version_id}</div>
                      {v.is_current && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
                          当前
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-[#b0b0b0] truncate">
                      {v.created_at ? `创建：${v.created_at}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      disabled={v.is_current || activatingVersionId === v.version_id}
                      onClick={async () => {
                        await handleActivateRoleVersion(v.version_id);
                      }}
                    >
                      {activatingVersionId === v.version_id ? '切换中...' : '激活'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="secondary" onClick={() => setRoleVersionsTarget(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SessionSidebar;
