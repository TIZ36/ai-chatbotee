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
