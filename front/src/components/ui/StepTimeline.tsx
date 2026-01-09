/**
 * StepTimeline - 时间线展示组件
 * 轻量的实时步骤展示组件，支持紧凑/完整模式
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Wrench,
  Workflow as WorkflowIcon,
  Zap,
  Target,
  MessageSquare,
  FileText,
  CheckCircle,
  XCircle,
  Loader,
  Clock,
  Lightbulb,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { ProcessStep } from '../../services/core/shared/types';
import { truncateBase64Strings } from '../../utils/textUtils';

export interface StepTimelineProps {
  /** 步骤列表 */
  steps: ProcessStep[];
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 是否正在思考 */
  isThinking?: boolean;
  /** 紧凑模式（用于消息气泡内） */
  compact?: boolean;
  /** 最大高度（超出可滚动） */
  maxHeight?: number;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
  /** 隐藏标题，直接显示内容 */
  hideTitle?: boolean;
  /** 标题文字 */
  title?: string;
  /** 是否显示折叠/展开按钮 */
  showToggle?: boolean;
}

/**
 * 时间线展示组件
 */
export const StepTimeline: React.FC<StepTimelineProps> = ({
  steps,
  isStreaming = false,
  isThinking = false,
  compact = false,
  maxHeight,
  defaultExpanded = false,
  hideTitle = false,
  title = '执行轨迹',
  showToggle = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [visibleSteps, setVisibleSteps] = useState<ProcessStep[]>([]);
  const prevStepsRef = useRef<ProcessStep[]>([]);
  const stepRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 动画：新步骤淡入
  useEffect(() => {
    const newSteps = steps.filter(
      (step) =>
        !prevStepsRef.current.some(
          (prev) =>
            prev.type === step.type &&
            prev.timestamp === step.timestamp &&
            prev.toolName === step.toolName
        )
    );

    if (newSteps.length > 0) {
      setVisibleSteps(steps);
      // 触发淡入动画
      newSteps.forEach((step) => {
        const key = `${step.type}-${step.timestamp || ''}-${step.toolName || ''}`;
        const element = stepRefs.current.get(key);
        if (element) {
          element.classList.add('animate-fade-in');
        }
      });
    } else {
      setVisibleSteps(steps);
    }

    prevStepsRef.current = steps;
  }, [steps]);

  // 格式化时长
  const formatDuration = (ms?: number) => {
    if (ms == null) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  // 获取状态图标
  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-2.5 h-2.5 text-green-400/70" />;
      case 'error':
        return <XCircle className="w-2.5 h-2.5 text-red-400/70" />;
      case 'running':
        return <Loader className="w-2.5 h-2.5 text-blue-400/70 animate-spin" />;
      default:
        return <Clock className="w-2.5 h-2.5 text-gray-400/60" />;
    }
  };

  // 获取类型图标
  const getTypeIcon = (type: string, step?: ProcessStep) => {
    switch (type) {
      case 'thinking':
      case 'agent_thinking':
      case 'llm_generating':
      case 'llm_streaming':
        return <Lightbulb className="w-2.5 h-2.5 text-purple-400/70" />;
      case 'mcp_call':
        return <Wrench className="w-2.5 h-2.5 text-emerald-400/70" />;
      case 'workflow':
        return <WorkflowIcon className="w-2.5 h-2.5 text-indigo-400/70" />;
      case 'iteration':
        return <Zap className="w-2.5 h-2.5 text-yellow-400/70" />;
      case 'agent_deciding':
        return <Brain className="w-2.5 h-2.5 text-indigo-400/70 animate-pulse" />;
      case 'agent_decision':
        return <Target className="w-2.5 h-2.5 text-green-400/70" />;
      case 'agent_will_reply':
        return <MessageSquare className="w-2.5 h-2.5 text-blue-400/70" />;
      case 'media_extracting':
        return <FileText className="w-2.5 h-2.5 text-orange-400/70" />;
      default:
        return <FileText className="w-2.5 h-2.5 text-gray-400/60" />;
    }
  };

  // 获取类型标签
  const getTypeLabel = (type: string, step: ProcessStep): React.ReactNode => {
    switch (type) {
      case 'thinking':
      case 'agent_thinking':
        return '思考';
      case 'llm_generating':
      case 'llm_streaming': {
        const modelName = `${step.llm_provider || ''}/${step.llm_model || ''}`;
        const isThinkingModel = step.is_thinking_model;
        const status = step.status === 'completed'
          ? '生成完成'
          : isThinkingModel
          ? '思考中...'
          : '生成中...';
        return `使用模型: ${modelName}, ${status}`;
      }
      case 'mcp_call': {
        const serverName = step.mcpServerName || step.mcpServer || '未知服务';
        const toolName = step.toolName === 'auto' ? '自动选择工具' : (step.toolName || 'unknown');
        return (
          <>
            {serverName} → <strong className="font-semibold">{toolName}</strong>
          </>
        );
      }
      case 'workflow':
        return `工作流: ${step.workflowInfo?.name || 'Unknown'}`;
      case 'iteration': {
        const iter = step.iteration || 0;
        const maxIter = step.max_iterations || 0;
        const isFinal = step.is_final_iteration;
        return `第 ${iter} 轮处理${maxIter > 0 ? ` / ${maxIter}` : ''}${isFinal ? ' (最终)' : ''}`;
      }
      case 'agent_deciding':
        return `决策中: ${step.agent_name || 'Agent'}`;
      case 'agent_decision':
        return `决策结果: ${step.action || '未知'}`;
      case 'agent_will_reply':
        return '决定回答';
      case 'media_extracting':
        return '提取媒体内容';
      default:
        return type;
    }
  };

  // 判断是否为重要步骤
  const isImportantStep = (type: string) => {
    return ['mcp_call', 'workflow', 'agent_decision', 'agent_will_reply', 'iteration'].includes(type);
  };

  // MCP 结果摘要
  const getMcpResultSummary = (step: ProcessStep): string | null => {
    try {
      const r: any = step.result;
      if (!r) return null;
      const err = r?.error || r?.error_message || r?.message;
      if (typeof err === 'string' && err.trim()) {
        return `❌ ${err.trim().slice(0, 160)}${err.trim().length > 160 ? '…' : ''}`;
      }
      const summary = r?.summary || r?.result || r?.output || r?.tool_text;
      if (typeof summary === 'string' && summary.trim()) {
        return summary.trim().slice(0, 180) + (summary.trim().length > 180 ? '…' : '');
      }
      if (Array.isArray(r?.logs) && r.logs.length) {
        const tail = r.logs.slice(-1)[0];
        if (typeof tail === 'string' && tail.trim()) {
          return tail.trim().slice(0, 180) + (tail.trim().length > 180 ? '…' : '');
        }
      }
      return '（展开查看详情）';
    } catch {
      return '（结果解析失败）';
    }
  };

  // 渲染步骤内容
  const renderStepContent = (step: ProcessStep, idx: number) => {
    const important = isImportantStep(step.type);
    const iteration = step.iteration;
    const isFinal = step.is_final_iteration;
    const key = `${step.type}-${step.timestamp || idx}-${step.toolName || ''}`;

    return (
      <div
        key={key}
        ref={(el) => {
          if (el) stepRefs.current.set(key, el);
        }}
        className={`flex items-start gap-1.5 ${
          compact ? 'text-[9px]' : 'text-[10px]'
        } pl-1 py-0.5 transition-opacity duration-200 ${
          important
            ? 'border-l-2 border-primary-300/60 dark:border-primary-400/40 -ml-[2px]'
            : ''
        }`}
      >
        <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5 opacity-70">
          {getTypeIcon(step.type, step)}
          {getStatusIcon(step.status)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* 轮次标签 */}
            {iteration && (
              <span
                className={`px-1 py-0.5 rounded ${
                  compact ? 'text-[8px]' : 'text-[9px]'
                } ${
                  isFinal
                    ? 'bg-green-100/60 text-green-600/80 dark:bg-green-900/20 dark:text-green-400/70'
                    : 'bg-gray-100/60 text-gray-500/80 dark:bg-gray-800/40 dark:text-gray-400/70'
                }`}
              >
                轮次{iteration}{isFinal ? ' · 最终' : ''}
              </span>
            )}
            <span
              className={`${important ? 'font-medium' : 'font-normal'} text-gray-600/90 dark:text-[#b0b0b0]/80`}
            >
              {getTypeLabel(step.type, step)}
            </span>
            {step.duration != null && (
              <span className="text-gray-400/70 dark:text-[#606060]/80 text-[9px]">
                {formatDuration(step.duration)}
              </span>
            )}
          </div>
          {step.thinking && (
            <div
              className={`mt-0.5 whitespace-pre-wrap break-words ${
                compact ? 'text-[8px]' : 'text-[9px]'
              } ${
                step.status === 'error'
                  ? 'text-red-400/80 dark:text-red-400/70'
                  : 'text-gray-500/80 dark:text-[#909090]/70'
              }`}
            >
              {step.thinking.length > (compact ? 200 : 500) ? (
                <details>
                  <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
                    {step.thinking.slice(0, compact ? 100 : 200)}...
                  </summary>
                  <div className="mt-1">{step.thinking}</div>
                </details>
              ) : (
                step.thinking
              )}
            </div>
          )}
          {step.error && (
            <div
              className={`text-red-400/80 dark:text-red-400/70 mt-0.5 font-medium ${
                compact ? 'text-[8px]' : 'text-[9px]'
              }`}
            >
              ❌ 错误: {step.error}
            </div>
          )}
          {step.type === 'mcp_call' && step.arguments && !compact && (
            <details className="mt-0.5">
              <summary className="text-gray-400/70 cursor-pointer hover:text-gray-500 dark:hover:text-[#909090] text-[9px]">
                查看参数
              </summary>
              <pre className="mt-0.5 text-[8px] bg-white/50 dark:bg-[#252525]/50 p-1.5 rounded overflow-auto max-h-20 leading-snug border border-dashed border-gray-200/60 dark:border-[#404040]/50">
                {truncateBase64Strings(JSON.stringify(step.arguments, null, 2))}
              </pre>
            </details>
          )}
          {step.type === 'mcp_call' && step.result && !compact && (
            <div className="mt-0.5">
              <div className="text-[9px] text-gray-500/80 dark:text-[#808080]/70">
                结果：{getMcpResultSummary(step)}
              </div>
              <details className="mt-0.5">
                <summary className="text-gray-400/70 cursor-pointer hover:text-gray-500 dark:hover:text-[#909090] text-[9px]">
                  查看原始结果
                </summary>
                <pre className="mt-0.5 text-[8px] bg-white/50 dark:bg-[#252525]/50 p-1.5 rounded overflow-auto max-h-20 leading-snug border border-dashed border-gray-200/60 dark:border-[#404040]/50">
                  {truncateBase64Strings(JSON.stringify(step.result, null, 2))}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    );
  };

  // 渲染内容
  const renderContent = () => {
    const content = (
      <div
        className="space-y-1.5"
        style={maxHeight ? { maxHeight: `${maxHeight}px`, overflowY: 'auto' } : undefined}
      >
        {/* 正在思考的指示器 */}
        {(isThinking || isStreaming) &&
          visibleSteps.filter((s) => s.type === 'thinking' && s.status === 'running').length === 0 && (
            <div className={`flex items-center gap-1.5 ${compact ? 'text-[9px]' : 'text-[10px]'} py-0.5 pl-1`}>
              <Lightbulb className="w-3 h-3 text-purple-400/70" />
              <Loader className="w-3 h-3 text-purple-400/70 animate-spin" />
              <span className="text-purple-500/80 dark:text-purple-400/70">
                {isThinking ? '思考中...' : '生成中...'}
              </span>
            </div>
          )}

        {visibleSteps.map((step, idx) => renderStepContent(step, idx))}
      </div>
    );

    if (hideTitle) {
      return (
        <div
          className={`pl-2 pr-2 py-1.5 rounded-md bg-gray-50/80 dark:bg-[#1a1a1a]/60 border border-gray-100 dark:border-[#2a2a2a] ${
            compact ? 'text-[9px]' : ''
          }`}
        >
          {content}
        </div>
      );
    }

    return content;
  };

  // 如果没有步骤且不在思考中，不显示
  if (visibleSteps.length === 0 && !isThinking && !isStreaming) {
    return null;
  }

  const stepCount = visibleSteps.length;

  // 如果隐藏标题，直接返回内容
  if (hideTitle) {
    return renderContent();
  }

  // 完整模式：带标题和折叠/展开
  return (
    <div className="mt-2 pt-2">
      {showToggle && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-[#808080] hover:text-gray-700 dark:hover:text-[#a0a0a0] transition-colors"
        >
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          <span className="font-semibold">
            {title} ({stepCount} 步)
          </span>
          {(isThinking || isStreaming) && (
            <span className="flex items-center gap-1 ml-1">
              <div className="flex space-x-0.5">
                <div
                  className="w-1 h-1 bg-purple-500 rounded-full animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <div
                  className="w-1 h-1 bg-purple-500 rounded-full animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <div
                  className="w-1 h-1 bg-purple-500 rounded-full animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </span>
          )}
        </button>
      )}

      {(!showToggle || isExpanded) && (
        <div className="mt-2 pl-2 border-l-2 border-dashed border-gray-300 dark:border-[#505050]">
          {renderContent()}
        </div>
      )}
    </div>
  );
};

// 添加淡入动画样式（如果不存在）
if (typeof document !== 'undefined') {
  const styleId = 'step-timeline-animations';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes fade-in {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-fade-in {
        animation: fade-in 0.3s ease-out;
      }
    `;
    document.head.appendChild(style);
  }
}

