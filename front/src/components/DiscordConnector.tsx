/**
 * Discord 连接器 — 右上角图标按钮，点击弹出完整面板对话框
 * - 在线时图标本体光谱闪动 + 状态指示灯
 * - 点击打开 Dialog，内部控制启停
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import DiscordPanel, { DiscordIcon } from './DiscordPanel';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/Dialog';
import { getDiscordStatus, type DiscordStatus } from '../services/discordApi';

const DiscordConnector: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const isOnline = status?.running === true;

  const fetchStatus = useCallback(async () => {
    try {
      const s = await getDiscordStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 12_000);
    return () => clearInterval(pollRef.current);
  }, [fetchStatus]);

  useEffect(() => {
    if (open) fetchStatus();
  }, [open, fetchStatus]);

  return (
    <>
      {/* 右上角图标按钮 */}
      <button
        type="button"
        className={`dc-btn app-no-drag ${isOnline ? 'dc-btn--online' : ''}`}
        onClick={() => setOpen(true)}
        title="Discord 外部通道"
      >
        <DiscordIcon className="dc-btn-icon" />
        <span className={`dc-btn-dot ${isOnline ? 'dc-btn-dot--on' : ''}`} />
      </button>

      {/* 弹窗面板 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="chatee-dialog-standard max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DiscordIcon className="w-5 h-5 text-[#5865F2]" />
              Discord 外部通道
            </DialogTitle>
            <DialogDescription>
              管理 Discord Bot 连接、频道绑定和人设配置
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto no-scrollbar -mx-1 px-1">
            <DiscordPanel embedded />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DiscordConnector;
