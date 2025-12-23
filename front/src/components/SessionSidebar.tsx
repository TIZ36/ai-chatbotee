/**
 * 左侧会话列表组件
 * 会话（过程）与角色（资产）分层：
 * - 对话：历史会话/任务记录
 * - 角色库：可复用的角色（agent），支持版本与“从角色开始新会话”
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MessageCircle, Sparkles, Plus, Trash2, Search, History, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import { ScrollArea } from './ui/ScrollArea';
import { ConfirmDialog } from './ui/ConfirmDialog';
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
import { activateRoleVersion, applyRoleToSession, listRoleVersions, updateRoleProfile, type RoleVersion } from '../services/roleApi';
import { emitSessionsChanged, SESSIONS_CHANGED_EVENT } from '../utils/sessionEvents';
import { getDimensionOptions } from '../services/roleDimensionApi';

interface SessionSidebarProps {
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  isRoundTableMode?: boolean; // 是否为圆桌模式
  onAddToRoundTable?: (sessionId: string) => void; // 添加到圆桌会议的回调
  onConfigSession?: (sessionId: string) => void; // 配置会话的回调（打开配置对话框）
  onNewRole?: () => void; // 新增角色的回调（打开角色生成器）
}

const SessionSidebar: React.FC<SessionSidebarProps> = ({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  isRoundTableMode = false,
  onAddToRoundTable,
  onConfigSession,
  onNewRole,
}) => {
  const [agentSessions, setAgentSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [upgradeTarget, setUpgradeTarget] = useState<Session | null>(null);
  const [roleVersionsTarget, setRoleVersionsTarget] = useState<Session | null>(null);
  const [roleVersions, setRoleVersions] = useState<RoleVersion[]>([]);
  const [isLoadingRoleVersions, setIsLoadingRoleVersions] = useState(false);
  const [activatingVersionId, setActivatingVersionId] = useState<string | null>(null);
  const [rolesByProfession, setRolesByProfession] = useState<Record<string, Session[]>>({});
  const [expandedProfessions, setExpandedProfessions] = useState<Set<string>>(new Set());
  const [careerProfessions, setCareerProfessions] = useState<string[]>([]); // 功能职业列表（包括自定义）
  const [gameProfessions, setGameProfessions] = useState<string[]>([]); // 游戏职业列表（包括自定义）
  const createMenuRef = React.useRef<HTMLDivElement>(null);
  const missingNameLoggedRef = React.useRef<Set<string>>(new Set());
  const selectedSessionIdRef = React.useRef<string | null>(selectedSessionId);
  const temporarySessionId = 'temporary-session';
  const normalizeText = (text?: string | null) => (text || '').trim();
  
  // 默认功能职业列表
  const DEFAULT_CAREER_PROFESSIONS = [
    '产品经理', '工程师', '设计师', '作家', '分析师', '教师', '医生',
    '咨询师', '创业者', '研究员', '营销专家', '财务顾问'
  ];

  // 默认游戏职业列表
  const DEFAULT_GAME_PROFESSIONS = [
    '战士', '法师', '盗贼', '牧师', '游侠', '术士', '圣骑士', '德鲁伊', '野蛮人', '吟游诗人'
  ];
  
  // 从名称或人设中提取职业
  const extractProfession = (
    name: string | null | undefined, 
    systemPrompt: string | null | undefined,
    professionList: string[]
  ): string | null => {
    // 先从名称中提取
    if (name) {
      for (const keyword of professionList) {
        if (name.includes(keyword)) {
          return keyword;
        }
      }
    }
    // 再从人设中提取
    if (systemPrompt) {
      // 先尝试匹配 "职业：xxx" 格式
      const professionMatch = systemPrompt.match(/职业[：:]\s*([^\n,，。]+)/);
      if (professionMatch) {
        const matched = professionMatch[1].trim();
        if (professionList.includes(matched)) {
          return matched;
        }
      }
      // 再尝试关键词匹配
      for (const keyword of professionList) {
        if (systemPrompt.includes(keyword)) {
          return keyword;
        }
      }
    }
    return null;
  };
  
  // 判断职业类型（从名称或人设中判断）
  const detectProfessionType = (name: string | null | undefined, systemPrompt: string | null | undefined): 'career' | 'game' => {
    const allText = `${name || ''} ${systemPrompt || ''}`;
    // 如果包含游戏职业关键词，判断为游戏职业
    const allGameProfessions = [...DEFAULT_GAME_PROFESSIONS, ...gameProfessions];
    for (const keyword of allGameProfessions) {
      if (allText.includes(keyword)) {
        return 'game';
      }
    }
    // 默认是功能职业
    return 'career';
  };
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

  // 保留用于未来扩展
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

  // 加载职业列表（包括自定义职业）
  const loadProfessions = useCallback(async () => {
    try {
      const [careerOptions, gameOptions] = await Promise.all([
        getDimensionOptions('profession', 'career'),
        getDimensionOptions('profession', 'game'),
      ]);
      setCareerProfessions([...DEFAULT_CAREER_PROFESSIONS, ...careerOptions]);
      setGameProfessions([...DEFAULT_GAME_PROFESSIONS, ...gameOptions]);
    } catch (error) {
      console.error('[SessionSidebar] Failed to load professions:', error);
      // 使用默认职业列表
      setCareerProfessions(DEFAULT_CAREER_PROFESSIONS);
      setGameProfessions(DEFAULT_GAME_PROFESSIONS);
    }
  }, []);

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
      
      const agents = agentsList.filter((s: Session) => s.session_type === 'agent');

      setAgentSessions(agents);
      
      // 按职业分类（使用动态职业列表）
      const byProfession: Record<string, Session[]> = {};
      const other: Session[] = [];
      
      for (const agent of agents) {
        // 判断职业类型
        const professionType = detectProfessionType(agent.name, agent.system_prompt);
        // 根据职业类型选择对应的职业列表
        const professionList = professionType === 'career' ? careerProfessions : gameProfessions;
        
        // 提取职业
        const profession = extractProfession(agent.name, agent.system_prompt, professionList);
        
        if (profession) {
          // 添加职业类型前缀以便区分
          const professionKey = professionType === 'career' ? profession : `[游戏] ${profession}`;
          if (!byProfession[professionKey]) {
            byProfession[professionKey] = [];
          }
          byProfession[professionKey].push(agent);
        } else {
          other.push(agent);
        }
      }
      
      if (other.length > 0) {
        byProfession['其他'] = other;
      }
      
      // 对职业键进行排序：按英文首字母或中文拼音首字母排序
      // 使用 localeCompare 支持中文拼音排序，相同首字母的不分先后（稳定排序）
      const sortedProfessionKeys = Object.keys(byProfession).sort((a, b) => {
        // "其他" 始终排在最后
        if (a === '其他') return 1;
        if (b === '其他') return -1;
        // 使用 localeCompare 进行排序，支持中文拼音首字母排序
        return a.localeCompare(b, 'zh-CN', { sensitivity: 'base' });
      });
      
      // 创建排序后的职业对象
      const sortedByProfession: Record<string, Session[]> = {};
      for (const key of sortedProfessionKeys) {
        sortedByProfession[key] = byProfession[key];
      }
      
      setRolesByProfession(sortedByProfession);
      setExpandedProfessions(new Set(sortedProfessionKeys));
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setAgentSessions([]);
      setRolesByProfession({});
    } finally {
      setIsLoading(false);
    }
  }, [careerProfessions, gameProfessions]);

  // 加载职业列表
  useEffect(() => {
    loadProfessions();
  }, [loadProfessions]);

  // 加载数据（依赖职业列表，当职业列表更新时重新分组）
  useEffect(() => {
    if (careerProfessions.length > 0 || gameProfessions.length > 0) {
      loadAllSessions();
    }
  }, [loadAllSessions, careerProfessions.length, gameProfessions.length]);

  // 外部触发：会话/角色数据变更时刷新（例如从聊天配置弹窗"保存为角色"）
  useEffect(() => {
    const handler = () => {
      loadAllSessions();
    };
    window.addEventListener(SESSIONS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, handler);
  }, [loadAllSessions]);

  // 默认选中临时会话
  useEffect(() => {
    if (!selectedSessionId && !isLoading) {
      onSelectSession('temporary-session');
    }
  }, [selectedSessionId, isLoading, onSelectSession]);

  // 切换职业折叠状态
  const toggleProfession = (profession: string) => {
    setExpandedProfessions(prev => {
      const next = new Set(prev);
      if (next.has(profession)) {
        next.delete(profession);
      } else {
        next.add(profession);
      }
      return next;
    });
  };


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
    const target = agentSessions.find((s) => s.session_id === sessionId) || null;
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

  // 导出角色为 JSON
  const handleExportRole = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    
    // 从 system_prompt 中提取职业信息
    const extractProfession = (prompt: string): string | undefined => {
      const professionMatch = prompt.match(/职业[：:]\s*([^\n,，。]+)/);
      if (professionMatch) return professionMatch[1].trim();
      const roleMatch = prompt.match(/你是一[位个名]([^\n,，。]{1,10})/);
      if (roleMatch) return roleMatch[1].trim();
      return undefined;
    };
    
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      role: {
        name: session.name || getDisplayName(session),
        system_prompt: session.system_prompt || '',
        avatar: session.avatar || undefined,
        profession: extractProfession(session.system_prompt || ''),
        metadata: {
          llm_config_id: session.llm_config_id,
          media_output_path: session.media_output_path,
        },
      },
    };
    
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `role-${exportData.role.name}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({ title: '角色已导出', description: `已保存为 ${link.download}`, variant: 'success' });
  };

  // 升级为智能体（执行）- 保留用于未来扩展
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


  const isTemporarySelected = selectedSessionId === temporarySessionId;



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

  // 过滤角色（根据搜索），保持排序
  const filteredRolesByProfession = useMemo(() => {
    if (!searchQuery.trim()) {
      return rolesByProfession;
    }
    const query = searchQuery.toLowerCase();
    const filtered: Record<string, Session[]> = {};
    
    // 获取排序后的职业键（保持与 rolesByProfession 相同的排序）
    const sortedProfessionKeys = Object.keys(rolesByProfession).sort((a, b) => {
      // "其他" 始终排在最后
      if (a === '其他') return 1;
      if (b === '其他') return -1;
      // 使用 localeCompare 进行排序，支持中文拼音首字母排序
      return a.localeCompare(b, 'zh-CN', { sensitivity: 'base' });
    });
    
    // 按照排序后的顺序添加匹配的职业
    for (const profession of sortedProfessionKeys) {
      const roles = rolesByProfession[profession];
      const matching = roles.filter(session => {
        const name = getDisplayName(session).toLowerCase();
        return name.includes(query);
      });
      if (matching.length > 0) {
        filtered[profession] = matching;
      }
    }
    return filtered;
  }, [rolesByProfession, searchQuery]);

  return (
    <div className="w-full min-w-0 flex flex-col h-full">
      {/* 搜索框 */}
      <div className="p-2.5 border-b border-gray-200 dark:border-[#404040] bg-gray-50/50 dark:bg-[#363636]/30">
        <div className="flex gap-1.5">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-[#808080]" />
            <Input
              type="text"
              placeholder="搜索角色..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      {/* 列表内容 */}
      <div className="flex-1 flex flex-col min-h-0">
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-accent)]"></div>
            </div>
          ) : (
            <div className="p-1.5 pr-3 space-y-1.5">
              {/* 新增角色按钮 */}
              <Button
                onClick={() => onNewRole?.()}
                variant="outline"
                className="w-full border-2 border-dashed"
              >
                <Plus className="w-4 h-4 mr-2" />
                <span>新增角色</span>
              </Button>

              {/* 按职业分类的角色列表 */}
              {Object.keys(filteredRolesByProfession).length === 0 ? (
                <div className="p-4 text-center text-gray-500 dark:text-[#808080]">
                  <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">暂无角色</p>
                </div>
              ) : (
                Object.entries(filteredRolesByProfession).map(([profession, roles]) => {
                  const isExpanded = expandedProfessions.has(profession);
                  return (
                    <div key={profession} className="space-y-1">
                      {/* 职业标题 */}
                      <button
                        onClick={() => toggleProfession(profession)}
                        className="w-full px-2.5 py-1.5 flex items-center justify-between rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
                      >
                        <span className="text-xs font-medium text-gray-700 dark:text-[#e0e0e0]">
                          {profession} ({roles.length})
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-500 dark:text-[#808080]" />
                        ) : (
                          <ChevronUp className="w-4 h-4 text-gray-500 dark:text-[#808080]" />
                        )}
                      </button>
                      
                      {/* 角色列表 */}
                      {isExpanded && roles.map((session) => {
                        const isSelected = selectedSessionId === session.session_id;
                        const displayName = getDisplayName(session);
                        
                        return (
                          <div
                            key={session.session_id}
                            onClick={() => onSelectSession(session.session_id)}
                            className={`
                              group relative px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150
                              ${isSelected
                                ? 'bg-[var(--color-selected-bg)] border border-[var(--color-selected-border)]'
                                : 'hover:bg-[var(--color-hover-bg)]'
                              }
                            `}
                          >
                            <div className="grid grid-cols-[auto,1fr,auto] items-center gap-2.5">
                              {/* 头像 */}
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
                                  <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
                                </div>
                              )}
                              
                              {/* 内容 */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                  <div className="font-medium text-sm text-gray-900 dark:text-white truncate">
                                    {displayName}
                                  </div>
                                  <Sparkles className="w-3 h-3 text-[var(--color-accent)] flex-shrink-0" />
                                </div>
                              </div>

                            {/* 操作按钮 */}
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-self-end pointer-events-none group-hover:pointer-events-auto">
                              <IconButton
                                icon={Download}
                                onClick={(e) => handleExportRole(e, session)}
                                label="导出角色"
                                variant="ghost"
                                size="icon"
                              />
                              <IconButton
                                icon={History}
                                onClick={(e) => openRoleVersions(e, session)}
                                label="角色版本历史"
                                variant="ghost"
                                size="icon"
                              />
                              {isRoundTableMode && (
                                <IconButton
                                  icon={Plus}
                                  onClick={(e) => handleAddToRoundTable(e, session.session_id)}
                                  label="添加到圆桌会议"
                                  variant="ghost"
                                  size="icon"
                                />
                              )}
                              <IconButton
                                icon={Trash2}
                                onClick={(e) => handleDeleteSession(e, session.session_id)}
                                label="删除"
                                variant="ghost"
                                size="icon"
                                className="text-red-500 hover:bg-red-500/10"
                              />
                            </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </ScrollArea>

        {/* 临时会话 - 固定在底部 */}
        <div className="flex-shrink-0 border-t border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] p-1.5">
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
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除会话"
        description={`确定要删除「${deleteTarget ? getDisplayName(deleteTarget) : ''}」吗？此操作不可撤销。`}
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const id = deleteTarget.session_id;
          setDeleteTarget(null);
          await performDeleteSession(id);
        }}
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
/**
 * 左侧会话列表组件（简化版）
 *
 * 设计目标：
 * - 去除独立的 Agent/角色库列表视图
 * - 只保留一个“会话列表”（会话本身携带头像/人设/默认模型等）
 * - 人设/角色切换在对话界面通过“人设Tag”完成
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageCircle, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Input } from './ui/Input';
import { ScrollArea } from './ui/ScrollArea';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { toast } from './ui/use-toast';
import { createSession, deleteSession, getAgents, getSessions, type Session } from '../services/sessionApi';
import { emitSessionsChanged, SESSIONS_CHANGED_EVENT } from '../utils/sessionEvents';

interface SessionSidebarProps {
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  isRoundTableMode?: boolean;
  onAddToRoundTable?: (sessionId: string) => void;
  onConfigSession?: (sessionId: string) => void;
}

const TEMP_ID = 'temporary-session';

function normalizeText(text?: string | null) {
  return (text || '').trim();
}

function isPlaceholderTitle(title?: string | null) {
  const t = normalizeText(title);
  return !t || t === '新会话';
}

function truncate(text: string, maxLen: number) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen)}...`;
}

function getDisplayName(s: Session) {
  const name = normalizeText(s.name);
  if (name) return name;
  const title = normalizeText(s.title);
  if (title && !isPlaceholderTitle(title)) return title;
  const preview = normalizeText(s.preview_text);
  if (preview) return truncate(preview, 18);
  return `会话 ${s.session_id.slice(0, 8)}`;
}

const SessionSidebar: React.FC<SessionSidebarProps> = ({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  isRoundTableMode = false,
  onAddToRoundTable,
  onConfigSession,
}) => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);

  const loadAllSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const [sessionsData, agentsData] = await Promise.all([getSessions(), getAgents()]);

      const sessionsList = Array.isArray(sessionsData) ? sessionsData : ((sessionsData as any).sessions || []);
      const agentsList = Array.isArray(agentsData) ? agentsData : ((agentsData as any).agents || (agentsData as any).sessions || []);

      // 合并去重（外部只展示一个列表）
      const map = new Map<string, Session>();
      [...sessionsList, ...agentsList].forEach((s: Session) => {
        if (!s?.session_id) return;
        map.set(s.session_id, s);
      });

      // 按最近活跃排序
      const merged = Array.from(map.values()).sort((a, b) => {
        const ta = new Date(a.last_message_at || a.updated_at || a.created_at || 0).getTime();
        const tb = new Date(b.last_message_at || b.updated_at || b.created_at || 0).getTime();
        return tb - ta;
      });

      setSessions(merged);
    } catch (error) {
      console.error('[SessionSidebar] Failed to load sessions:', error);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllSessions();
  }, [loadAllSessions]);

  useEffect(() => {
    const onChanged = () => loadAllSessions();
    window.addEventListener(SESSIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, onChanged);
  }, [loadAllSessions]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const name = getDisplayName(s).toLowerCase();
      const prompt = (s.system_prompt || '').toLowerCase();
      return name.includes(q) || prompt.includes(q);
    });
  }, [sessions, searchQuery]);

  const isTemporarySelected = selectedSessionId === TEMP_ID || !selectedSessionId;

  return (
    <div className="w-full min-w-0 flex flex-col h-full">
      {/* 搜索框 */}
      <div className="p-2.5 border-b border-gray-200 dark:border-[#404040] bg-gray-50/50 dark:bg-[#363636]/30">
        <div className="flex gap-1.5">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-[#808080]" />
            <Input
              type="text"
              placeholder="搜索会话/人设..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-2 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        <ScrollArea className="flex-1">
          <div className="p-1.5 pr-3 space-y-1.5">
            <Button
              onClick={async () => {
                try {
                  const created = await createSession(undefined, undefined, 'memory');
                  onNewSession();
                  emitSessionsChanged();
                  onSelectSession(created.session_id);
                  toast({ title: '已创建新会话', variant: 'success' });
                } catch (error) {
                  toast({
                    title: '创建会话失败',
                    description: error instanceof Error ? error.message : String(error),
                    variant: 'destructive',
                  });
                }
              }}
              variant="primary"
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              <span>新建会话</span>
            </Button>

            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-accent)]" />
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-[#808080]">
                <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-xs">暂无会话</p>
              </div>
            ) : (
              filteredSessions.map((s) => {
                const isSelected = selectedSessionId === s.session_id;
                const displayName = getDisplayName(s);
                return (
                  <div
                    key={s.session_id}
                    onClick={() => onSelectSession(s.session_id)}
                    className={`
                      group relative px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150
                      ${isSelected
                        ? 'bg-[var(--color-selected-bg)] border border-[var(--color-selected-border)]'
                        : 'hover:bg-[var(--color-hover-bg)]'
                      }
                    `}
                  >
                    <div className="grid grid-cols-[auto,1fr,auto] items-center gap-2.5">
                      {s.avatar ? (
                        <img
                          src={s.avatar}
                          alt={displayName}
                          onClick={(e) => {
                            e.stopPropagation();
                            onConfigSession?.(s.session_id);
                          }}
                          className="w-7 h-7 rounded-lg flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-[var(--color-accent)]/50 transition-all object-cover"
                          title="点击配置"
                        />
                      ) : (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            onConfigSession?.(s.session_id);
                          }}
                          className="w-7 h-7 rounded-lg bg-[var(--color-accent-bg)] flex items-center justify-center flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-[var(--color-accent)]/50 transition-all"
                          title="点击配置"
                        >
                          <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900 dark:text-white truncate">
                          {displayName}
                        </div>
                        {s.system_prompt ? (
                          <div className="text-[10px] text-gray-500 dark:text-[#808080] truncate">
                            {truncate(s.system_prompt, 24)}
                          </div>
                        ) : (
                          <div className="text-[10px] text-gray-400 dark:text-[#707070] truncate">人设为空</div>
                        )}
                      </div>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-self-end pointer-events-none group-hover:pointer-events-auto">
                        {isRoundTableMode && (
                          <IconButton
                            icon={Plus}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddToRoundTable?.(s.session_id);
                            }}
                            label="添加到圆桌会议"
                            variant="ghost"
                            size="icon"
                          />
                        )}
                        <IconButton
                          icon={Trash2}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(s);
                          }}
                          label="删除"
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:bg-red-500/10"
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* 临时会话固定底部 */}
        <div className="flex-shrink-0 border-t border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] p-1.5">
          <div
            onClick={() => onSelectSession(TEMP_ID)}
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
                <div className="font-medium text-sm text-gray-900 dark:text-white truncate">临时会话</div>
                <div className="text-[10px] text-gray-500 dark:text-[#808080]">(不保存历史)</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除会话"
        description={`确定要删除「${deleteTarget ? getDisplayName(deleteTarget) : ''}」吗？此操作不可恢复。`}
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const id = deleteTarget.session_id;
          setDeleteTarget(null);
          try {
            await deleteSession(id);
            emitSessionsChanged();
            await loadAllSessions();
            if (selectedSessionId === id) onSelectSession(TEMP_ID);
            toast({ title: '会话已删除', variant: 'success' });
          } catch (error) {
            toast({
              title: '删除失败',
              description: error instanceof Error ? error.message : String(error),
              variant: 'destructive',
            });
          }
        }}
      />
    </div>
  );
};

export default SessionSidebar;

