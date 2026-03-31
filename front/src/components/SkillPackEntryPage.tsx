import React, { useCallback, useEffect, useState } from 'react';
import { Package, Loader, RefreshCw, Trash2, Pencil, BookOpen, Rows3, LayoutGrid } from 'lucide-react';
import {
  getSkillPacks,
  deleteSkillPack,
  updateSkillPack,
  type SkillPack,
} from '../services/skillPackApi';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { toast } from './ui/use-toast';
import { ConfirmDialog } from './ui/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';

/**
 * 技能录入：技能包列表与基础维护（新建仍主要在 Chaya 对话流中完成）
 */
const SkillPackEntryPage: React.FC = () => {
  const [list, setList] = useState<SkillPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SkillPack | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [selectedPack, setSelectedPack] = useState<SkillPack | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const packs = await getSkillPacks();
      setList(packs);
    } catch (e) {
      console.error(e);
      toast({ title: '加载失败', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditSummary('');
  };

  const saveEdit = async () => {
    if (!editingId || !selectedPack) return;
    try {
      await updateSkillPack(editingId, { name: editName.trim(), summary: editSummary.trim() });
      toast({ title: '已保存', variant: 'success' });
      await load();
      setSelectedPack({ ...selectedPack, name: editName.trim(), summary: editSummary.trim() });
      setEditingId(null);
    } catch (e) {
      toast({
        title: '保存失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSkillPack(deleteTarget.skill_pack_id);
      toast({ title: '已删除', variant: 'success' });
      if (selectedPack?.skill_pack_id === deleteTarget.skill_pack_id) {
        setDetailOpen(false);
        setSelectedPack(null);
      }
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast({
        title: '删除失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  };

  const openDetail = (pack: SkillPack, editable = false) => {
    setSelectedPack(pack);
    setDetailOpen(true);
    if (editable) {
      setEditingId(pack.skill_pack_id);
      setEditName(pack.name);
      setEditSummary(pack.summary || '');
    } else {
      cancelEdit();
    }
  };

  return (
    <div className="skill-pack-entry-page h-full flex flex-col bg-[var(--surface-primary)]">
      <div className="flex-1 overflow-y-auto no-scrollbar app-pane-pad">
        <div className="max-w-6xl mx-auto w-full space-y-3">
          <div className="app-card-item app-card-pad-sm flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="w-5 h-5 text-[var(--color-accent)] flex-shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">技能包</h2>
                <p className="text-xs text-[var(--text-muted)] truncate">
                  在 Chaya 对话中可从消息生成技能包；此处可改名、改摘要或删除
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="app-view-switch">
                <button
                  type="button"
                  className={`app-view-switch-btn ${viewMode === 'list' ? 'is-active' : ''}`}
                  onClick={() => setViewMode('list')}
                  title="列表布局"
                >
                  <Rows3 className="w-3.5 h-3.5" />
                  列表
                </button>
                <button
                  type="button"
                  className={`app-view-switch-btn ${viewMode === 'card' ? 'is-active' : ''}`}
                  onClick={() => setViewMode('card')}
                  title="卡片布局"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  卡片
                </button>
              </div>
              <Button variant="outline" size="sm" className="h-8" onClick={() => load()} disabled={loading}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            </div>
          </div>
          <div className="app-card-item app-card-pad-sm">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
                <Loader className="w-6 h-6 animate-spin mr-2" />
                加载中…
              </div>
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
                <BookOpen className="w-10 h-10 text-[var(--text-muted)] mb-3 opacity-60" />
                <p className="text-sm text-[var(--text-secondary)]">暂无技能包</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  在「Chaya 聊天」中勾选消息后，可生成并保存技能包
                </p>
              </div>
            ) : viewMode === 'list' ? (
              <ul className="app-list-layout">
                {list.map((p) => (
                  <li
                    key={p.skill_pack_id}
                    className="app-list-item app-card-pad-sm cursor-pointer"
                    onClick={() => openDetail(p)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-[var(--text-primary)]">{p.name}</div>
                        {p.summary ? (
                          <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                            {p.summary}
                          </p>
                        ) : null}
                        {p.updated_at || p.created_at ? (
                          <p className="text-[10px] text-[var(--text-muted)] mt-2">
                            {p.updated_at ? `更新 ${p.updated_at}` : `创建 ${p.created_at}`}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="编辑"
                          onClick={(e) => { e.stopPropagation(); openDetail(p, true); }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-[var(--color-secondary)]"
                          title="删除"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="app-card-grid">
                {list.map((p) => (
                  <div
                    key={p.skill_pack_id}
                    className="app-card-item app-card-pad-sm cursor-pointer"
                    onClick={() => openDetail(p)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--text-primary)] truncate">{p.name}</div>
                        {p.summary ? (
                          <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-4">
                            {p.summary}
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--text-muted)] mt-1">暂无摘要</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="编辑"
                          onClick={(e) => { e.stopPropagation(); openDetail(p, true); }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-[var(--color-secondary)]"
                          title="删除"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] mt-3">
                      {p.updated_at ? `更新 ${p.updated_at}` : `创建 ${p.created_at || '—'}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedPack(null);
            cancelEdit();
          }
        }}
      >
        <DialogContent className="max-w-2xl chatee-dialog-standard">
          {selectedPack && (
            <>
              <DialogHeader>
                <DialogTitle>{editingId === selectedPack.skill_pack_id ? '编辑技能包' : selectedPack.name}</DialogTitle>
                <DialogDescription>
                  {editingId === selectedPack.skill_pack_id ? '修改名称和摘要后保存' : '技能包详情'}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-auto no-scrollbar">
                {editingId === selectedPack.skill_pack_id ? (
                  <div className="space-y-3">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="名称"
                      className="h-9"
                    />
                    <textarea
                      value={editSummary}
                      onChange={(e) => setEditSummary(e.target.value)}
                      placeholder="摘要"
                      rows={8}
                      className="w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-[var(--text-primary)] resize-y min-h-[160px]"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-[var(--text-muted)] mb-1">名称</div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{selectedPack.name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--text-muted)] mb-1">摘要</div>
                      <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                        {selectedPack.summary || '暂无摘要'}
                      </div>
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {selectedPack.updated_at ? `更新 ${selectedPack.updated_at}` : `创建 ${selectedPack.created_at || '—'}`}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2">
                {editingId === selectedPack.skill_pack_id ? (
                  <>
                    <Button variant="outline" className="niho-close-pink" onClick={() => cancelEdit()}>
                      取消编辑
                    </Button>
                    <Button onClick={saveEdit}>保存</Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" className="niho-close-pink" onClick={() => setDetailOpen(false)}>
                      关闭
                    </Button>
                    <Button variant="outline" onClick={() => openDetail(selectedPack, true)}>
                      编辑
                    </Button>
                    <Button variant="destructive" onClick={() => setDeleteTarget(selectedPack)}>
                      删除
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除技能包"
        description={`确定删除「${deleteTarget?.name ?? ''}」吗？此操作不可恢复。`}
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
};

export default SkillPackEntryPage;
