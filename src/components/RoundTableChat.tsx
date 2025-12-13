/**
 * 圆桌聊天组件
 * 顶部采用浏览器tab样式显示会议列表，支持右键编辑主题
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Users, Plus, X, Trash2, Edit3, Check } from 'lucide-react';
import { 
  getRoundTables, 
  createRoundTable, 
  getRoundTable,
  deleteRoundTable,
  updateRoundTable,
  RoundTable,
  RoundTableDetail
} from '../services/roundTableApi';
import RoundTablePanel from './RoundTablePanel';
import { Button } from './ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { toast } from './ui/use-toast';

interface RoundTableChatProps {
  roundTableId: string | null;
  onRoundTableChange: (roundTableId: string | null) => void;
  refreshKey?: number; // 用于触发参与者列表刷新
}

// 右键菜单位置
interface ContextMenuPosition {
  x: number;
  y: number;
  tableId: string;
}

const RoundTableChat: React.FC<RoundTableChatProps> = ({
  roundTableId,
  onRoundTableChange,
  refreshKey = 0,
}) => {
  const [roundTables, setRoundTables] = useState<RoundTable[]>([]);
  const [activeRoundTable, setActiveRoundTable] = useState<RoundTableDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
  
  // 编辑状态
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // 加载圆桌会议列表
  const loadRoundTables = useCallback(async () => {
    try {
      setIsLoading(true);
      const tables = await getRoundTables();
      // 按创建时间排序（旧的在前，新的在后）
      const sortedTables = [...(tables || [])].sort((a, b) => {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        return timeA - timeB;
      });
      setRoundTables(sortedTables);
      
      // 如果有传入的roundTableId，自动选中
      if (roundTableId) {
        const table = tables?.find(t => t.round_table_id === roundTableId);
        if (table) {
          const detail = await getRoundTable(roundTableId);
          setActiveRoundTable(detail);
        }
      } else if (tables && tables.length > 0) {
        // 如果没有传入，选择最新的活跃会议
        const activeTable = tables.find(t => t.status === 'active') || tables[0];
        if (activeTable) {
          const detail = await getRoundTable(activeTable.round_table_id);
          setActiveRoundTable(detail);
          onRoundTableChange(activeTable.round_table_id);
        }
      }
    } catch (error) {
      console.error('Failed to load round tables:', error);
      setRoundTables([]);
    } finally {
      setIsLoading(false);
    }
  }, [roundTableId, onRoundTableChange]);

  useEffect(() => {
    loadRoundTables();
  }, [loadRoundTables]);

  // 当 refreshKey 变化时，重新加载数据
  useEffect(() => {
    if (refreshKey > 0) {
      loadRoundTables();
    }
  }, [refreshKey, loadRoundTables]);
  
  // 点击页面其他位置关闭右键菜单
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
    };
    
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);
  
  // 编辑输入框聚焦
  useEffect(() => {
    if (editingTableId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTableId]);

  // 创建新圆桌会议
  const handleCreateRoundTable = async () => {
    try {
      const newTable = await createRoundTable();
      await loadRoundTables();
      const detail = await getRoundTable(newTable.round_table_id);
      setActiveRoundTable(detail);
      onRoundTableChange(newTable.round_table_id);
    } catch (error) {
      console.error('Failed to create round table:', error);
    }
  };

  // 选择圆桌会议
  const handleSelectRoundTable = async (tableId: string) => {
    try {
      const detail = await getRoundTable(tableId);
      setActiveRoundTable(detail);
      onRoundTableChange(tableId);
    } catch (error) {
      console.error('Failed to select round table:', error);
    }
  };

  // 删除圆桌会议（执行）
  const performDeleteRoundTable = async (tableId: string) => {
    try {
      await deleteRoundTable(tableId);
      if (activeRoundTable?.round_table_id === tableId) {
        setActiveRoundTable(null);
        onRoundTableChange(null);
      }
      await loadRoundTables();
      toast({ title: '圆桌会议已删除', variant: 'success' });
    } catch (error) {
      console.error('Failed to delete round table:', error);
      toast({
        title: '删除圆桌会议失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 删除圆桌会议（确认）
  const handleDeleteRoundTable = (tableId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setContextMenu(null);
    const table = roundTables.find(t => t.round_table_id === tableId);
    setDeleteTarget({ id: tableId, name: table?.name || '未命名圆桌会议' });
  };
  
  // 右键菜单
  const handleContextMenu = (e: React.MouseEvent, tableId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tableId
    });
  };
  
  // 开始编辑
  const handleStartEdit = (tableId: string) => {
    const table = roundTables.find(t => t.round_table_id === tableId);
    if (table) {
      setEditingTableId(tableId);
      setEditingName(table.name || '');
      setContextMenu(null);
    }
  };
  
  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingTableId) return;
    
    try {
      await updateRoundTable(editingTableId, { name: editingName.trim() || undefined });
      await loadRoundTables();
      
      // 如果编辑的是当前激活的会议，更新详情
      if (activeRoundTable?.round_table_id === editingTableId) {
        const detail = await getRoundTable(editingTableId);
        setActiveRoundTable(detail);
      }
    } catch (error) {
      console.error('Failed to update round table name:', error);
      alert('保存失败，请重试');
    } finally {
      setEditingTableId(null);
      setEditingName('');
    }
  };
  
  // 取消编辑
  const handleCancelEdit = () => {
    setEditingTableId(null);
    setEditingName('');
  };
  
  // 编辑输入框键盘事件
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶部 Tab 栏 - 浏览器风格 */}
      <div className="flex-shrink-0 bg-gray-100 dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-[#404040]">
        <div className="flex items-center">
          {/* Tab 容器 */}
          <div className="flex-1 flex items-end overflow-x-auto scrollbar-hide px-2 pt-2 gap-0.5">
            {isLoading ? (
              <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">加载中...</div>
            ) : roundTables.length === 0 ? (
              <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">暂无圆桌会议</div>
            ) : (
              roundTables.map((table) => {
                const isActive = activeRoundTable?.round_table_id === table.round_table_id;
                const isEditing = editingTableId === table.round_table_id;
                
                return (
                  <div
                    key={table.round_table_id}
                    className={`
                      group relative flex items-center min-w-0 max-w-[200px]
                      ${isActive 
                        ? 'bg-white dark:bg-[#2d2d2d] border-t border-l border-r border-gray-200 dark:border-[#404040] rounded-t-lg -mb-px z-10' 
                        : 'bg-gray-50 dark:bg-[#252525] border border-transparent hover:bg-gray-100 dark:hover:bg-[#333333] rounded-t-lg'
                      }
                    `}
                    onClick={() => !isEditing && handleSelectRoundTable(table.round_table_id)}
                    onDoubleClick={() => handleStartEdit(table.round_table_id)}
                    onContextMenu={(e) => handleContextMenu(e, table.round_table_id)}
                  >
                    <div className={`
                      flex items-center gap-2 px-3 py-2 cursor-pointer w-full min-w-0
                      ${isActive ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}
                    `}>
                      {/* 状态指示器 */}
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        table.status === 'active' ? 'bg-green-500' : 'bg-gray-400'
                      }`}></span>
                      
                      {/* 名称或编辑输入框 */}
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={handleEditKeyDown}
                          onBlur={handleSaveEdit}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 px-1 py-0.5 text-sm bg-white dark:bg-[#363636] border border-primary-500 rounded outline-none text-gray-900 dark:text-white"
                          placeholder="输入会议主题"
                        />
                      ) : (
                        <span className="text-sm truncate flex-1 min-w-0">
                          {table.name || `圆桌会议 ${table.round_table_id.substring(0, 8)}`}
                        </span>
                      )}
                      
                      {/* 关闭按钮 - 仅在hover时显示 */}
                      {!isEditing && (
                        <button
                          onClick={(e) => handleDeleteRoundTable(table.round_table_id, e)}
                          className="flex-shrink-0 w-4 h-4 rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
                          title="关闭"
                        >
                          <X className="w-3 h-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            
            {/* 新建 Tab 按钮 */}
            <button
              onClick={handleCreateRoundTable}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#333333] rounded-lg transition-colors mb-1"
              title="新建圆桌会议"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 圆桌会议面板 */}
      <div className="flex-1 min-h-0 overflow-hidden bg-white dark:bg-[#2d2d2d]">
        {activeRoundTable ? (
          <RoundTablePanel
            roundTableId={activeRoundTable.round_table_id}
            onClose={() => {
              setActiveRoundTable(null);
              onRoundTableChange(null);
            }}
            onParticipantChange={loadRoundTables}
            refreshTrigger={refreshKey}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Users className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-500" />
              <p className="text-gray-500 dark:text-gray-400 mb-4">选择一个圆桌会议开始对话</p>
              <button
                onClick={handleCreateRoundTable}
                className="px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded-lg transition-colors"
              >
                创建新圆桌会议
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleStartEdit(contextMenu.tableId)}
            className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#363636] flex items-center gap-2"
          >
            <Edit3 className="w-4 h-4" />
            <span>编辑主题</span>
          </button>
          <div className="border-t border-gray-200 dark:border-[#404040] my-1"></div>
          <button
            onClick={() => handleDeleteRoundTable(contextMenu.tableId)}
            className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <span>删除会议</span>
          </button>
        </div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除圆桌会议</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.name}」吗？此操作不可恢复。
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
                const id = deleteTarget.id;
                setDeleteTarget(null);
                await performDeleteRoundTable(id);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RoundTableChat;
