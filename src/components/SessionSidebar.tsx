/**
 * 左侧会话列表组件
 * 包含会话、Agent、Mindstorm三个标签页
 */

import React, { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Sparkles, Plus, Trash2, Search, ArrowUp } from 'lucide-react';
import { 
  getSessions, 
  createSession, 
  deleteSession, 
  Session,
  getAgents,
  upgradeToAgent,
  getSessionMessages
} from '../services/sessionApi';

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
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const createMenuRef = React.useRef<HTMLDivElement>(null);
  const missingNameLoggedRef = React.useRef<Set<string>>(new Set());
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
      
      // 合并所有会话：记忆体和智能体
      const hasMessages = (s: Session) => (s.message_count || 0) > 0 || Boolean(s.last_message_at);
      const all = [
        // 仅展示有内容的记忆体/普通会话，避免空会话占位
        ...sessionsList.filter(s => (s.session_type === 'memory' || !s.session_type) && hasMessages(s)),
        // 智能体始终展示
        ...agentsList.filter(s => s.session_type === 'agent')
      ];

      // 为缺少名称和预览的会话补充一段文本，方便识别
      const needPreview = all.filter(
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

      const sessionsWithPreview = all.map(session => {
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

      setAllSessions(sessionsWithPreview);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setAllSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 加载数据
  useEffect(() => {
    loadAllSessions();
  }, [loadAllSessions]);

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
      onSelectSession(newSession.session_id);
      onNewSession();
    } catch (error) {
      console.error('Failed to create agent:', error);
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

  // 删除会话
  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirm('确定要删除此会话吗？')) {
      try {
        await deleteSession(sessionId);
        await loadAllSessions();
        if (selectedSessionId === sessionId) {
          onSelectSession('');
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }
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

  // 升级为智能体
  const handleUpgradeToAgent = async (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    if (session.session_type === 'agent') {
      alert('该会话已经是智能体');
      return;
    }
    if (!confirm(`确定要将"${getDisplayName(session)}"升级为智能体吗？`)) {
      return;
    }
    try {
      await upgradeToAgent(session.session_id, {
        name: session.name || getDisplayName(session),
        avatar: session.avatar || null,
        system_prompt: session.system_prompt || '',
        llm_config_id: session.llm_config_id || null,
      });
      await loadAllSessions();
      alert('升级成功！');
    } catch (error) {
      console.error('Failed to upgrade to agent:', error);
      alert('升级失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
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

  // 获取显示列表（包含临时会话、记忆体、智能体）
  const getDisplayList = (): (Session | { session_id: string; isTemporary: true })[] => {
    let list: (Session | { session_id: string; isTemporary: true })[] = [...allSessions];

    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(item => {
        if ('isTemporary' in item) {
          return '临时会话'.toLowerCase().includes(query);
        }
        const name = getDisplayName(item).toLowerCase();
        return name.includes(query);
      });
    }

    return list;
  };

  const displayList = getDisplayList();
  const temporarySessionId = 'temporary-session';
  const isTemporarySelected = selectedSessionId === temporarySessionId;

  return (
    <div className="w-[200px] flex flex-col h-full">
      {/* 搜索框和新建按钮 */}
      <div className="p-2.5 border-b border-gray-200 dark:border-[#404040] bg-gray-50/50 dark:bg-[#363636]/30">
        <div className="flex gap-1.5">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-[#808080]" />
            <input
              type="text"
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 text-sm bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50 focus:border-[var(--color-accent)] text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-all"
            />
          </div>
          <div className="relative" ref={createMenuRef}>
            <button
              onClick={handleCreateAgent}
              className="p-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded-lg transition-colors flex items-center"
              title="新建智能体"
            >
              <Plus className="w-4 h-4" />
            </button>
            {showCreateMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-[#363636] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg dark:shadow-[0_4px_16px_rgba(0,0,0,0.3)] z-50 overflow-hidden">
                <button
                  onClick={handleCreateTemporary}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-2 transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>临时会话</span>
                </button>
                <button
                  onClick={handleCreateMemory}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-2 transition-colors border-t border-gray-100 dark:border-[#404040]"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>记忆体</span>
                </button>
                <button
                  onClick={handleCreateAgent}
                  className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-100 dark:hover:bg-[#404040] flex items-center gap-2 transition-colors border-t border-gray-100 dark:border-[#404040]"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>智能体</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 列表内容 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--color-accent)]"></div>
          </div>
        ) : (
          <div className="p-1.5 space-y-0.5">
            {/* 临时会话选项 - 始终显示在顶部 */}
            <div
              onClick={() => onSelectSession(temporarySessionId)}
              className={`
                group relative px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150
                ${isTemporarySelected
                  ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50'
                  : 'hover:bg-gray-100 dark:hover:bg-[#363636]'
                }
              `}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
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

            {displayList.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-[#808080]">
                <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-xs">暂无会话</p>
              </div>
            ) : (
              displayList.map((item) => {
                // 处理临时会话类型
                if ('isTemporary' in item) {
                  return null; // 临时会话已经在上面单独显示了
                }
                
                const session = item as Session;
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
                  <div className="flex items-center gap-2.5">
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
                        <MessageCircle className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                      </div>
                    )}
                    
                    {/* 内容 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <div className="font-medium text-sm text-gray-900 dark:text-white truncate">
                          {displayName}
                        </div>
                        {/* 智能体图标标记 */}
                        {session.session_type === 'agent' && (
                          <Sparkles className="w-3 h-3 text-[var(--color-accent)] flex-shrink-0" title="智能体" />
                        )}
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isRoundTableMode && session.session_type === 'agent' && (
                        <button
                          onClick={(e) => handleAddToRoundTable(e, session.session_id)}
                          className="p-1 hover:bg-[var(--color-accent-bg)] rounded transition-colors"
                          title="添加到圆桌会议"
                        >
                          <Plus className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                        </button>
                      )}
                      {/* 升级为智能体按钮（仅记忆体显示） */}
                      {session.session_type === 'memory' && (
                        <button
                          onClick={(e) => handleUpgradeToAgent(e, session)}
                          className="p-1 hover:bg-[var(--color-accent-bg)] rounded transition-colors"
                          title="升级为智能体"
                        >
                          <ArrowUp className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDeleteSession(e, session.session_id)}
                        className="p-1 hover:bg-red-500/10 rounded transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionSidebar;
