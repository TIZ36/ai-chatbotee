/**
 * 圆桌聊天组件
 * 约束：去掉“多页签会议”模式，一次只展示一个会议会话视图。
 * 会议选择由全局“切换对话”弹窗完成（App Header）。
 */

import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { createRoundTable, getRoundTable, type RoundTableDetail } from '../services/roundTableApi';
import RoundTablePanel from './RoundTablePanel';
import { Button } from './ui/Button';

interface RoundTableChatProps {
  roundTableId: string | null;
  onRoundTableChange: (roundTableId: string | null) => void;
  refreshKey?: number; // 用于触发参与者列表刷新
}

const RoundTableChat: React.FC<RoundTableChatProps> = ({ roundTableId, onRoundTableChange, refreshKey = 0 }) => {
  const [activeRoundTable, setActiveRoundTable] = useState<RoundTableDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let canceled = false;
    (async () => {
      if (!roundTableId) {
        setActiveRoundTable(null);
        return;
      }
      try {
        setIsLoading(true);
        const detail = await getRoundTable(roundTableId);
        if (!canceled) setActiveRoundTable(detail);
      } catch {
        if (!canceled) setActiveRoundTable(null);
      } finally {
        if (!canceled) setIsLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [roundTableId, refreshKey]);

  const handleCreateRoundTable = async () => {
    const newTable = await createRoundTable();
    onRoundTableChange(newTable.round_table_id);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-hidden bg-white dark:bg-[#2d2d2d]">
        {activeRoundTable ? (
          <RoundTablePanel
            roundTableId={activeRoundTable.round_table_id}
            onClose={() => {
              setActiveRoundTable(null);
              onRoundTableChange(null);
            }}
            onParticipantChange={() => {
              // Meeting 仅展示单会话，不在此处维护“列表/页签”，刷新交给 RoundTablePanel 内部逻辑或上层 refreshKey
            }}
            refreshTrigger={refreshKey}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm px-6">
              <Users className="w-14 h-14 mx-auto mb-3 text-gray-400 dark:text-gray-500" />
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {isLoading ? '加载中…' : '请选择一个会议，或创建新会议开始对话'}
              </p>
              <Button variant="primary" onClick={handleCreateRoundTable} disabled={isLoading} className="gap-2">
                创建新会议
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RoundTableChat;
