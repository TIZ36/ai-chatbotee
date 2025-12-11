/**
 * 圆桌聊天组件
 * 顶部有历史会议列表，可以点击切换
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, ChevronRight, X, Trash2 } from 'lucide-react';
import { 
  getRoundTables, 
  createRoundTable, 
  getRoundTable,
  deleteRoundTable,
  RoundTable,
  RoundTableDetail
} from '../services/roundTableApi';
import RoundTablePanel from './RoundTablePanel';

interface RoundTableChatProps {
  roundTableId: string | null;
  onRoundTableChange: (roundTableId: string | null) => void;
}

const RoundTableChat: React.FC<RoundTableChatProps> = ({
  roundTableId,
  onRoundTableChange,
}) => {
  const [roundTables, setRoundTables] = useState<RoundTable[]>([]);
  const [activeRoundTable, setActiveRoundTable] = useState<RoundTableDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  // 加载圆桌会议列表
  const loadRoundTables = useCallback(async () => {
    try {
      setIsLoading(true);
      const tables = await getRoundTables();
      setRoundTables(tables || []);
      
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

  // 创建新圆桌会议
  const handleCreateRoundTable = async () => {
    try {
      const newTable = await createRoundTable();
      await loadRoundTables();
      const detail = await getRoundTable(newTable.round_table_id);
      setActiveRoundTable(detail);
      onRoundTableChange(newTable.round_table_id);
      setShowHistory(false);
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
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to select round table:', error);
    }
  };

  // 删除圆桌会议
  const handleDeleteRoundTable = async (tableId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('确定要删除这个圆桌会议吗？此操作不可恢复。')) {
      return;
    }
    
    try {
      await deleteRoundTable(tableId);
      
      // 如果删除的是当前激活的会议，清空激活状态
      if (activeRoundTable?.round_table_id === tableId) {
        setActiveRoundTable(null);
        onRoundTableChange(null);
      }
      
      // 重新加载会议列表
      await loadRoundTables();
    } catch (error) {
      console.error('Failed to delete round table:', error);
      alert('删除圆桌会议失败，请重试');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶部历史会议列表 */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2 flex-1 overflow-x-auto scrollbar-hide">
            {isLoading ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">加载中...</div>
            ) : roundTables.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">暂无圆桌会议</div>
            ) : (
              roundTables.map((table) => {
                const isActive = activeRoundTable?.round_table_id === table.round_table_id;
                return (
                  <div
                    key={table.round_table_id}
                    className="relative group flex items-center"
                  >
                    <button
                      onClick={() => handleSelectRoundTable(table.round_table_id)}
                      className={`
                        flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap
                        ${isActive
                          ? 'bg-primary-100 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }
                      `}
                    >
                      <Users className="w-4 h-4" />
                      <span>{table.name || `圆桌会议 ${table.round_table_id.substring(0, 8)}`}</span>
                      {table.status === 'active' && (
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      )}
                    </button>
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => handleDeleteRoundTable(table.round_table_id, e)}
                      className="ml-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded"
                      title="删除圆桌会议"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <button
            onClick={handleCreateRoundTable}
            className="ml-2 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-1 text-sm"
            title="新建圆桌会议"
          >
            <Plus className="w-4 h-4" />
            <span>新建</span>
          </button>
        </div>
      </div>

      {/* 圆桌会议面板 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeRoundTable ? (
          <RoundTablePanel
            roundTableId={activeRoundTable.round_table_id}
            onClose={() => {
              setActiveRoundTable(null);
              onRoundTableChange(null);
            }}
            onParticipantChange={loadRoundTables}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Users className="w-16 h-16 mx-auto mb-4 text-gray-400 dark:text-gray-500" />
              <p className="text-gray-500 dark:text-gray-400 mb-4">选择一个圆桌会议开始对话</p>
              <button
                onClick={handleCreateRoundTable}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
              >
                创建新圆桌会议
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RoundTableChat;

