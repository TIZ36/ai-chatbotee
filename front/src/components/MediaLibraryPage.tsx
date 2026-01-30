import React, { useEffect, useMemo, useState } from 'react';
import { VirtuosoGrid, type GridItemProps } from 'react-virtuoso';
import { Image as ImageIcon, Loader2, RefreshCcw, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Checkbox } from '@/components/ui/Checkbox';
import { ScrollArea } from '@/components/ui/ScrollArea';
import PageLayout, { Card } from '@/components/ui/PageLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { Session } from '@/services/sessionApi';
import { getAgents, getMemories, getSessions, deleteSession } from '@/services/sessionApi';
import { resolveMediaSrc } from '@/utils/mediaSrc';
import { MediaPreviewDialog } from '@/components/ui/MediaPreviewDialog';
import type { SessionMediaItem } from '@/components/ui/SessionMediaPanel';
import { getMediaLibraryItems, type MediaLibraryItem } from '@/services/mediaLibraryApi';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { toast } from '@/components/ui/use-toast';

const STORAGE_KEY = 'chatee.mediaLibrary.projectIds.v1';

type ViewItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'item'; key: string; item: MediaLibraryItem };

function getSessionDisplayName(s: Session) {
  return (s.name || s.title || `会话 ${s.session_id.slice(0, 8)}`).trim();
}

function dayKeyFromTs(ts?: number | null) {
  if (!ts) return 'unknown';
  const d = new Date(ts * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export const MediaLibraryPage: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionQuery, setSessionQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [groupMode, setGroupMode] = useState<'none' | 'day' | 'session'>('day');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<SessionMediaItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // load sessions list
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const [s, a, t] = await Promise.all([getSessions(), getAgents(), getMemories()]);
        const merged = new Map<string, Session>();
        (s || []).forEach((x) => merged.set(x.session_id, x));
        (a || []).forEach((x) => merged.set(x.session_id, x));
        (t || []).forEach((x) => merged.set(x.session_id, x));
        if (!canceled) setSessions(Array.from(merged.values()));
      } catch {
        if (!canceled) setSessions([]);
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  // restore selected projects
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        setSelectedIds(new Set(arr.filter((x) => typeof x === 'string')));
      }
    } catch {
      // ignore
    }
  }, []);

  // persist selection
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedIds)));
    } catch {
      // ignore
    }
  }, [selectedIds]);

  const filteredSessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const name = getSessionDisplayName(s).toLowerCase();
      const prompt = (s.system_prompt || '').toLowerCase();
      return name.includes(q) || prompt.includes(q);
    });
  }, [sessions, sessionQuery]);

  const selectedSessionIds = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const reload = async () => {
    if (selectedSessionIds.length === 0) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const res = await getMediaLibraryItems({
        sessionIds: selectedSessionIds,
        type: 'image',
        limit: 500,
        order: sortOrder,
      });
      setItems(Array.isArray(res.items) ? res.items : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionIds.join('|'), sortOrder]);

  const sessionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    sessions.forEach((s) => map.set(s.session_id, getSessionDisplayName(s)));
    return map;
  }, [sessions]);

  const viewData: ViewItem[] = useMemo(() => {
    const out: ViewItem[] = [];
    let lastHeader: string | null = null;
    for (const it of items) {
      const ts = it.created_at_ts || 0;
      let headerKey = 'all';
      let headerLabel = '全部';
      if (groupMode === 'day') {
        headerKey = dayKeyFromTs(ts);
        headerLabel = headerKey === 'unknown' ? '未知日期' : headerKey;
      } else if (groupMode === 'session') {
        headerKey = it.session_id;
        headerLabel = sessionNameMap.get(it.session_id) || it.session_id;
      } else {
        headerKey = 'none';
        headerLabel = '';
      }
      if (groupMode !== 'none' && headerKey !== lastHeader) {
        out.push({ kind: 'header', key: `h:${headerKey}`, label: headerLabel });
        lastHeader = headerKey;
      }
      out.push({ kind: 'item', key: `m:${it.session_id}:${it.message_id || ''}:${ts}`, item: it });
    }
    return out;
  }, [groupMode, items, sessionNameMap]);

  const openPreview = (it: MediaLibraryItem) => {
    const one: SessionMediaItem = {
      type: it.type,
      mimeType: it.mimeType,
      data: it.data,
      url: it.url,
      role: (it.role as any) || 'assistant',
      messageId: it.message_id,
      timestamp: (it.created_at_ts || 0) * 1000,
    };
    setPreviewItem(one);
    setPreviewOpen(true);
  };

  const handleDeleteSession = async () => {
    if (!deleteTarget) return;
    
    setIsDeleting(true);
    try {
      await deleteSession(deleteTarget.session_id);
      
      // 从列表中移除
      setSessions(prev => prev.filter(s => s.session_id !== deleteTarget.session_id));
      
      // 从选中列表中移除
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(deleteTarget.session_id);
        return next;
      });
      
      toast({
        title: '删除成功',
        description: '会话已删除',
        variant: 'success',
      });
      
      setDeleteTarget(null);
    } catch (error: any) {
      toast({
        title: '删除失败',
        description: error.message || '删除会话时出现错误',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <PageLayout
      title="媒体库"
      description="选择需要加载的会话（项目），按时间顺序浏览图片。"
      headerActions={
        <Button
          variant="secondary"
          onClick={() => void reload()}
          disabled={loading || selectedSessionIds.length === 0}
        >
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
          刷新
        </Button>
      }
    >
      <div className="grid grid-cols-[320px,1fr] gap-3 min-h-0">
        <Card title="项目（会话）" description="勾选后会记住，下次进入自动加载" size="compact">
          <div className="space-y-2">
            <Input
              value={sessionQuery}
              onChange={(e) => setSessionQuery(e.target.value)}
              placeholder="搜索会话..."
            />

            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-500 dark:text-[#808080]">分组</div>
              <Select value={groupMode} onValueChange={(v) => setGroupMode(v as any)}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="分组方式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">按日期</SelectItem>
                  <SelectItem value="session">按会话</SelectItem>
                  <SelectItem value="none">不分组</SelectItem>
                </SelectContent>
              </Select>

              <div className="text-xs text-gray-500 dark:text-[#808080] ml-2">排序</div>
              <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as any)}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="排序" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">最新优先</SelectItem>
                  <SelectItem value="asc">最早优先</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="h-[62vh]">
              <div className="space-y-1 pr-2">
                {filteredSessions.map((s) => {
                  const checked = selectedIds.has(s.session_id);
                  const displayName = getSessionDisplayName(s);
                  return (
                    <div
                      key={s.session_id}
                      className={`group px-2 py-2 rounded-md border transition-colors ${
                        checked
                          ? 'border-primary-500/50 bg-primary-500/5'
                          : 'border-transparent hover:bg-gray-50 dark:hover:bg-[#2a2a2a]'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            const next = new Set(selectedIds);
                            if (v) next.add(s.session_id);
                            else next.delete(s.session_id);
                            setSelectedIds(next);
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {displayName}
                          </div>
                          <div className="text-[11px] text-gray-500 dark:text-[#808080] truncate">
                            {s.session_type || 'temporary'} · {s.session_id.slice(0, 8)}
                          </div>
                        </div>
                        <IconButton
                          icon={Trash2}
                          label="删除会话"
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(s);
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </Card>

        <Card
          title="图片陈列"
          description={selectedSessionIds.length === 0 ? '先在左侧选择项目（会话）' : `图片 ${items.length}`}
          size="compact"
        >
          {items.length === 0 ? (
            <div className="h-[70vh] flex items-center justify-center text-sm text-gray-500">
              {loading ? '加载中…' : '暂无图片'}
            </div>
          ) : (
            <div className="h-[70vh]">
              <VirtuosoGrid
                style={{ height: '100%' }}
                data={viewData}
                overscan={800}
                components={{
                  Item: (props: GridItemProps) => {
                    const v = viewData[props['data-index']];
                    const isHeader = (v as any)?.kind === 'header';
                    return (
                      <div
                        {...props}
                        style={{
                          ...props.style,
                          ...(isHeader ? { gridColumn: '1 / -1' } : null),
                        }}
                      />
                    );
                  },
                }}
                listClassName="p-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
                itemContent={(_index, v) => {
                  if (v.kind === 'header') {
                    return (
                      <div className="flex items-center gap-2 pt-3 pb-1">
                        <ImageIcon className="w-4 h-4 text-primary-500" />
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{v.label}</div>
                      </div>
                    );
                  }
                  const it = v.item;
                  const raw = it.url || it.data || '';
                  const src = resolveMediaSrc(raw, it.mimeType || 'image/png');
                  const sessionName = sessionNameMap.get(it.session_id) || it.session_id.slice(0, 8);
                  return (
                    <div className="group rounded-lg overflow-hidden border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#1e1e1e]">
                      <div
                        className="aspect-square bg-gray-50 dark:bg-[#111] cursor-pointer"
                        onClick={() => openPreview(it)}
                      >
                        <img
                          src={src}
                          alt={sessionName}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                        />
                      </div>
                      <div className="px-2 py-1.5">
                        <div className="text-[11px] text-gray-700 dark:text-[#d0d0d0] truncate" title={sessionName}>
                          {sessionName}
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          )}
        </Card>
      </div>

      <MediaPreviewDialog
        open={previewOpen}
        onOpenChange={(o) => {
          setPreviewOpen(o);
          if (!o) setPreviewItem(null);
        }}
        item={previewItem}
        title="图片预览"
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除会话"
        description={
          deleteTarget
            ? `确定要删除会话"${getSessionDisplayName(deleteTarget)}"吗？此操作不可撤销，将删除该会话的所有消息和媒体。`
            : ''
        }
        variant="destructive"
        confirmText="删除"
        cancelText="取消"
        isLoading={isDeleting}
        onConfirm={handleDeleteSession}
      />
    </PageLayout>
  );
};

export default MediaLibraryPage;


