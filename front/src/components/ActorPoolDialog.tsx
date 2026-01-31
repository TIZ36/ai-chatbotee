/**
 * Actor 池监控弹窗
 * 显示正在工作的 Actor 列表：上下文大小、Persona、错误率、默认模型
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { getBackendUrl } from '../utils/backendUrl';
import { RefreshCw, Users } from 'lucide-react';

export interface ActorStatus {
  agent_id: string;
  topic_id: string;
  context_size: number;
  context_messages: number;
  persona: { name?: string; avatar?: string; system_prompt?: string };
  messages_processed: number;
  errors: number;
  error_rate: number;
  default_model: string;
  default_provider: string;
  is_running: boolean;
}

interface ActorPoolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ActorPoolDialog: React.FC<ActorPoolDialogProps> = ({ open, onOpenChange }) => {
  const [actors, setActors] = useState<ActorStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendUrl, setBackendUrl] = useState('');

  const fetchPool = useCallback(async () => {
    const base = getBackendUrl();
    setBackendUrl(base);
    if (!base) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${base}/api/actor-pool/status`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.actors)) {
        setActors(data.actors);
      } else {
        setError(data.error || '获取失败');
        setActors([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败');
      setActors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchPool();
  }, [open, fetchPool]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Actor 池
          </DialogTitle>
          <DialogDescription>
            当前正在工作的 Agent（已激活的 Actor）及其状态
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchPool}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>

        {loading && actors.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-red-500">{error}</div>
        ) : actors.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            暂无已激活的 Actor
          </div>
        ) : (
          <div className="overflow-auto flex-1 border border-borderToken rounded-md">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Agent / 会话</th>
                  <th className="px-3 py-2 font-medium">上下文</th>
                  <th className="px-3 py-2 font-medium">Persona</th>
                  <th className="px-3 py-2 font-medium">错误率</th>
                  <th className="px-3 py-2 font-medium">默认模型</th>
                </tr>
              </thead>
              <tbody>
                {actors.map((a) => (
                  <tr key={a.agent_id + a.topic_id} className="border-t border-borderToken">
                    <td className="px-3 py-2">
                      <div className="font-medium">{a.persona?.name || a.agent_id}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.topic_id || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span title={`${a.context_messages} 条消息`}>
                        {a.context_size.toLocaleString()} tokens
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {a.context_messages} 条
                      </div>
                    </td>
                    <td className="px-3 py-2 max-w-[180px]">
                      <div className="truncate text-xs" title={a.persona?.system_prompt}>
                        {a.persona?.system_prompt || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={a.error_rate > 0 ? 'text-amber-600' : ''}>
                        {(a.error_rate * 100).toFixed(2)}%
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {a.errors}/{a.messages_processed}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{a.default_model}</div>
                      <div className="text-xs text-muted-foreground">{a.default_provider}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ActorPoolDialog;
