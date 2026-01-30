/**
 * ExecutionLogViewer - 执行日志滚动区域
 * 紧跟 agent 头像，在输出气泡上方，无边框，纯文本，适配主题
 */

import React, { useEffect, useRef, useState } from 'react';

export interface ExecutionLogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'step' | 'tool' | 'llm' | 'success' | 'error' | 'thinking';
  message: string;
  detail?: string;
  duration?: number;
}

export interface ExecutionLogViewerProps {
  logs: ExecutionLogEntry[];
  isActive?: boolean;
  maxHeight?: number;
  collapsed?: boolean;
  className?: string;
}

const formatDuration = (ms?: number) => {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export const ExecutionLogViewer: React.FC<ExecutionLogViewerProps> = ({
  logs,
  isActive = false,
  maxHeight = 100,
  collapsed: defaultCollapsed = false,
  className = '',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (bottomRef.current && !isCollapsed) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [logs, isCollapsed]);

  // 当有新日志时自动展开
  useEffect(() => {
    if (logs.length > 0 && isActive) {
      setIsCollapsed(false);
    }
  }, [logs.length, isActive]);

  // 当 defaultCollapsed 变化时更新状态
  useEffect(() => {
    setIsCollapsed(defaultCollapsed);
  }, [defaultCollapsed]);

  if (!logs.length && !isActive) {
    return null;
  }

  const lastLog = logs[logs.length - 1];

  return (
    <div className={`execution-log-viewer text-[10px] leading-relaxed ${className}`}>
      {/* 折叠时只显示最后一条 */}
      {isCollapsed ? (
        <div 
          className="cursor-pointer text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors truncate italic"
          onClick={() => setIsCollapsed(false)}
        >
          {lastLog?.message || '执行中...'}
          {lastLog?.duration != null && (
            <span className="ml-1 opacity-60">({formatDuration(lastLog.duration)})</span>
          )}
        </div>
      ) : (
        <div
          className="overflow-y-auto overflow-x-hidden space-y-0.5 no-scrollbar cursor-pointer"
          style={{ maxHeight: `${maxHeight}px` }}
          onClick={() => setIsCollapsed(true)}
        >
          {logs.map((log, index) => (
            <div
              key={log.id || index}
              className="text-muted-foreground/50 italic"
            >
              {log.message}
              {log.duration != null && (
                <span className="ml-1 opacity-60">
                  ({formatDuration(log.duration)})
                </span>
              )}
              {log.detail && (
                <span className="ml-1 opacity-40 text-[9px]">
                  {log.detail}
                </span>
              )}
            </div>
          ))}
          
          {/* 活动状态时显示光标 */}
          {isActive && (
            <span className="inline-block w-1 h-3 bg-muted-foreground/30 animate-pulse" />
          )}
          
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
};

export default ExecutionLogViewer;
