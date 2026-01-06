import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Image as ImageIcon, Loader2, RefreshCcw, X, Trash2 } from 'lucide-react';
import type { Session, Message } from '@/services/sessionApi';
import { getSessionMessagesCursor, deleteSession } from '@/services/sessionApi';
import type { SessionMediaItem } from '@/components/ui/SessionMediaPanel';
import { resolveMediaSrc } from '@/utils/mediaSrc';
import { VirtuosoGrid } from 'react-virtuoso';
import { MediaPreviewDialog } from '@/components/ui/MediaPreviewDialog';
import { toast } from '@/components/ui/use-toast';

type LibraryImage = SessionMediaItem & {
  session_id: string;
  session_name: string;
  message_id?: string;
};

const STORAGE_KEY = 'chatee.mediaLibrary.projectIds.v1';

function getSessionDisplayName(s: Session) {
  return (s.name || s.title || `会话 ${s.session_id.slice(0, 8)}`).trim();
}

function extractImagesFromMessages(session: Session, msgs: Message[]): LibraryImage[] {
  const out: LibraryImage[] = [];
  for (const m of msgs) {
    const ext: any = (m as any).ext || {};
    const media = Array.isArray(ext.media) ? ext.media : [];
    for (const item of media) {
      if (!item || item.type !== 'image') continue;
      out.push({
        type: 'image',
        mimeType: item.mimeType || item.mime_type || 'image/png',
        data: item.data || '',
        session_id: session.session_id,
        session_name: getSessionDisplayName(session),
        message_id: m.message_id,
        role: m.role as any,
      });
    }

    // 兼容旧标记： [MCP_IMAGE|mime|base64]
    if (typeof m.content === 'string' && m.content.includes('[MCP_IMAGE|')) {
      const matches = m.content.matchAll(/\[MCP_IMAGE\|(.*?)\|(.*?)\]/g);
      for (const match of matches) {
        out.push({
          type: 'image',
          mimeType: match[1] || 'image/png',
          data: match[2] || '',
          session_id: session.session_id,
          session_name: getSessionDisplayName(session),
          message_id: m.message_id,
          role: m.role as any,
        });
      }
    }
  }
  return out;
}

export interface MediaLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: Session[];
  onSessionsChange?: (sessions: Session[]) => void; // 会话列表变化回调
}

export const MediaLibraryDialog: React.FC<MediaLibraryDialogProps> = ({ 
  open, 
  onOpenChange, 
  sessions,
  onSessionsChange,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<SessionMediaItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadNonceRef = useRef(0);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedIds)));
    } catch {
      // ignore
    }
  }, [open, selectedIds]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const name = getSessionDisplayName(s).toLowerCase();
      const prompt = (s.system_prompt || '').toLowerCase();
      return name.includes(q) || prompt.includes(q);
    });
  }, [query, sessions]);

  const selectedSessions = useMemo(() => {
    const map = new Map(sessions.map((s) => [s.session_id, s]));
    return Array.from(selectedIds)
      .map((id) => map.get(id))
      .filter(Boolean) as Session[];
  }, [selectedIds, sessions]);

  const reload = async () => {
    if (!open) return;
    const nonce = ++loadNonceRef.current;
    setLoading(true);
    try {
      const all: LibraryImage[] = [];
      for (const s of selectedSessions) {
        let cursor: string | null = null;
        let loops = 0;
        // 最多拉取 1500 条消息，避免极端会话卡死
        while (loops < 15) {
          loops += 1;
          const page = await getSessionMessagesCursor(s.session_id, cursor, 100, false);
          if (nonce !== loadNonceRef.current) return;
          const pageImages = extractImagesFromMessages(s, page.messages || []);
          all.push(...pageImages);
          if (!page.has_more || !page.next_cursor) break;
          cursor = page.next_cursor;
          if (all.length > 3000) break;
        }
      }
      if (nonce !== loadNonceRef.current) return;
      setImages(all);
    } finally {
      if (nonce === loadNonceRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedSessions.map((s) => s.session_id).join('|')]);

  const openPreview = (img: LibraryImage) => {
    setPreviewItem(img);
    setPreviewOpen(true);
  };

  const handleDeleteSession = async () => {
    if (!deleteTarget) return;
    
    setIsDeleting(true);
    try {
      await deleteSession(deleteTarget.session_id);
      
      // 从列表中移除
      const updatedSessions = sessions.filter(s => s.session_id !== deleteTarget.session_id);
      onSessionsChange?.(updatedSessions);
      
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[96vw] w-[1200px] p-0 overflow-hidden">
          <div className="border-b border-gray-200 dark:border-[#404040] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <ImageIcon className="w-4 h-4 text-primary-500" />
              <DialogHeader className="min-w-0">
                <DialogTitle className="text-sm truncate">媒体库</DialogTitle>
                <DialogDescription className="text-xs truncate">
                  会话=项目 · 已选 {selectedIds.size} · 图片 {images.length}
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void reload()}
                disabled={loading || selectedIds.size === 0}
                className="h-8"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-1.5" />}
                刷新
              </Button>
              <IconButton icon={X} label="关闭" variant="ghost" onClick={() => onOpenChange(false)} />
            </div>
          </div>

          <div className="flex min-h-0 h-[78vh]">
            {/* 左侧：项目管理（会话列表） */}
            <div className="w-[340px] border-r border-gray-200 dark:border-[#404040] flex flex-col min-h-0">
              <div className="p-3 border-b border-gray-100 dark:border-[#333]">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索会话..."
                />
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
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
                              {s.session_type || 'memory'} · {s.session_id.slice(0, 8)}
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

            {/* 右侧：图片汇总（虚拟网格） */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="px-4 py-2 border-b border-gray-100 dark:border-[#333] text-xs text-gray-500 dark:text-[#808080] flex items-center justify-between">
                <span>点击缩略图预览 · hover 可复制（消息内缩略图也支持）</span>
                {loading && <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />加载中…</span>}
              </div>

              {images.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
                  {selectedIds.size === 0 ? '先在左侧选择项目（会话）' : (loading ? '加载中…' : '所选项目中暂无图片')}
                </div>
              ) : (
                <div className="flex-1 min-h-0">
                  <VirtuosoGrid
                    style={{ height: '100%' }}
                    data={images}
                    overscan={600}
                    listClassName="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
                    itemContent={(_index, img) => {
                      const raw = img.url || img.data || '';
                      const src = resolveMediaSrc(raw, img.mimeType || 'image/png');
                      return (
                        <div className="group rounded-lg overflow-hidden border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#1e1e1e]">
                          <div
                            className="aspect-square bg-gray-50 dark:bg-[#111] cursor-pointer"
                            onClick={() => openPreview(img)}
                          >
                            <img
                              src={src}
                              alt={img.session_name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                            />
                          </div>
                          <div className="px-2 py-1.5">
                            <div className="text-[11px] text-gray-700 dark:text-[#d0d0d0] truncate" title={img.session_name}>
                              {img.session_name}
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
    </>
  );
};


