/**
 * ProcessStepsViewer - 统一的执行轨迹展示组件
 * 用于显示 Agent 的思考过程、MCP 调用、工作流执行等
 * 样式：虚线左边框 + 标题粗体 + 重要步骤加粗
 */

import React, { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
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
} from 'lucide-react';
import { truncateBase64Strings } from '../../utils/textUtils';

/** 单个过程步骤 */
export interface ProcessStep {
  type: string;
  timestamp?: number;
  thinking?: string;
  mcpServer?: string;
  mcpServerName?: string;  // MCP 服务器别名（优先显示）
  toolName?: string;
  arguments?: any;
  result?: any;
  status?: 'pending' | 'running' | 'completed' | 'error';
  duration?: number;
  error?: string;
  action?: string;
  agent_id?: string;
  agent_name?: string;
  llm_provider?: string;
  llm_model?: string;
  is_thinking_model?: boolean;  // 是否是思考模型
  iteration?: number;  // 处理轮次
  is_final_iteration?: boolean;  // 是否是最终轮次
  max_iterations?: number;  // 最大轮次
  workflowInfo?: {
    id?: string;
    name?: string;
    status?: 'pending' | 'running' | 'completed' | 'error';
    result?: string;
    config?: any;
  };
}

export interface ProcessStepsViewerProps {
  /** 过程步骤列表 */
  processSteps?: ProcessStep[];
  /** 扩展数据（可能包含 processSteps 和 llmInfo） */
  ext?: any;
  /** 旧版思考内容（兼容） */
  thinking?: string;
  /** 是否正在思考 */
  isThinking?: boolean;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** MCP 调用详情（兼容旧版） */
  mcpDetail?: any;
  /** 工具调用列表（兼容旧版） */
  toolCalls?: Array<{ name: string; arguments: any; result?: any; status?: string; duration?: number }>;
  /** 工作流信息（兼容旧版） */
  workflowInfo?: {
    id?: string;
    name?: string;
    status?: 'pending' | 'running' | 'completed' | 'error';
    result?: string;
    config?: any;
  };
  /** 标题文字（默认："执行轨迹"） */
  title?: string;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
  /** 隐藏标题，直接显示内容 */
  hideTitle?: boolean;
  /** 消息角色（用于判断是否显示LLM媒体签名） */
  role?: string;
}

/**
 * 统一的执行轨迹展示组件
 */
export const ProcessStepsViewer: React.FC<ProcessStepsViewerProps> = ({
  processSteps,
  ext,
  thinking,
  isThinking,
  isStreaming,
  mcpDetail,
  toolCalls,
  workflowInfo,
  title = '执行轨迹',
  defaultExpanded = false,
  hideTitle = false,
  role,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // MCP 结果核心摘要
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

  // 合并所有来源的步骤
  const steps = useMemo(() => {
    const result: ProcessStep[] = [];

    // 1. 来自 processSteps 参数
    if (Array.isArray(processSteps)) {
      result.push(...processSteps);
    }

    // 2. 来自 ext.processSteps
    if (ext?.processSteps && Array.isArray(ext.processSteps)) {
      for (const step of ext.processSteps) {
        if (!result.some(s => s.timestamp === step.timestamp && s.type === step.type)) {
          result.push(step);
        }
      }
    }

    // 3. 兼容旧版：thinking
    if (thinking && thinking.trim() && !result.some(s => s.type === 'thinking' && s.thinking === thinking)) {
      result.push({
        type: 'thinking',
        thinking: thinking,
        status: isThinking ? 'running' : 'completed',
      });
    }

    // 4. 兼容旧版：mcpDetail
    if (mcpDetail) {
      const legacyToolCalls = (mcpDetail as any)?.tool_calls;
      if (Array.isArray(legacyToolCalls) && legacyToolCalls.length > 0) {
        legacyToolCalls.forEach((call: any, index: number) => {
          const callResult = (mcpDetail as any)?.tool_results?.[index];
          const toolName = call?.function?.name || call?.name || 'unknown';
          if (!result.some(s => s.type === 'mcp_call' && s.toolName === toolName)) {
            result.push({
              type: 'mcp_call',
              toolName,
              arguments: call?.function?.arguments ?? call?.arguments,
              result: callResult?.content ?? callResult,
              status: 'completed',
            });
          }
        });
      } else if ((mcpDetail as any).component_type === 'mcp') {
        const raw = (mcpDetail as any).raw_result;
        const results = raw?.results;
        if (Array.isArray(results) && results.length > 0) {
          results.forEach((r: any) => {
            const toolName = r?.tool ? String(r.tool) : r?.name ? String(r.name) : 'unknown_tool';
            if (!result.some(s => s.type === 'mcp_call' && s.toolName === toolName)) {
              result.push({
                type: 'mcp_call',
                toolName,
                arguments: r?.arguments ?? r?.args ?? r?.input,
                result: r?.result ?? r,
                status: (mcpDetail as any).status || 'completed',
              });
            }
          });
        }
      }
    }

    // 5. 兼容旧版：toolCalls
    if (toolCalls && Array.isArray(toolCalls)) {
      toolCalls.forEach((tc) => {
        if (!result.some(s => s.type === 'mcp_call' && s.toolName === tc.name)) {
          result.push({
            type: 'mcp_call',
            toolName: tc.name,
            arguments: tc.arguments,
            result: tc.result,
            status: tc.result ? 'completed' : 'running',
            duration: tc.duration,
          });
        }
      });
    }

    // 6. 兼容旧版：workflowInfo
    if (workflowInfo && workflowInfo.status && !result.some(s => s.type === 'workflow')) {
      result.push({
        type: 'workflow',
        workflowInfo: workflowInfo,
        status: workflowInfo.status,
      });
    }

    // 7. 显示LLM输出消息的图片thoughtSignature状态（仅assistant消息）
    // 判断条件：有 llmInfo（说明是 LLM 回复）且有 media
    if (ext?.media && Array.isArray(ext.media) && ext?.llmInfo && role === 'assistant') {
      const mediaWithImages = ext.media.filter((m: any) => m?.type === 'image');
      if (mediaWithImages.length > 0) {
        const withSig = mediaWithImages.filter((m: any) => m?.thoughtSignature);
        const withoutSig = mediaWithImages.filter((m: any) => !m?.thoughtSignature);

        result.push({
          type: 'llm_media_signature',
          thinking: withSig.length > 0
            ? `✅ ${withSig.length} 张图片带 thoughtSignature`
            : `❌ ${withoutSig.length} 张图片缺少 thoughtSignature`,
          status: withSig.length === mediaWithImages.length ? 'completed' : 'error',
          // @ts-ignore
          mediaInfo: {
            total: mediaWithImages.length,
            withSignature: withSig.length,
            withoutSignature: withoutSig.length,
          },
        });
      }
    }

    // 8. 显示LLM响应元数据（usage、finish_reason等）
    if (ext?.llmResponse && ext?.llmInfo) {
      const llmResp = ext.llmResponse;
      let metadataText = '';

      // Token使用统计
      if (llmResp.usage) {
        const usage = llmResp.usage;
        const parts = [];
        if (usage.prompt_tokens !== undefined) parts.push(`${usage.prompt_tokens} 输入`);
        if (usage.completion_tokens !== undefined) parts.push(`${usage.completion_tokens} 输出`);
        if (usage.total_tokens !== undefined) parts.push(`${usage.total_tokens} 总计`);
        if (parts.length > 0) {
          metadataText += `Token: ${parts.join(' + ')}`;
        }
      }

      // 完成原因
      if (llmResp.finish_reason) {
        const reasonMap: Record<string, string> = {
          'stop': '正常结束',
          'length': '长度限制',
          'content_filter': '内容过滤',
          'function_call': '函数调用',
          'tool_calls': '工具调用'
        };
        const reasonText = reasonMap[llmResp.finish_reason] || llmResp.finish_reason;

        metadataText += (metadataText ? ' | ' : '') + `原因: ${reasonText}`;
      }

      if (metadataText) {
        result.push({
          type: 'llm_metadata',
          thinking: metadataText,
          status: 'completed',
        });
      }
    }

    // 按时间戳排序
    return result.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }, [processSteps, ext, thinking, isThinking, mcpDetail, toolCalls, workflowInfo, role]);

  // 如果没有步骤且不在思考中，不显示
  if (steps.length === 0 && !isThinking && !isStreaming) {
    return null;
  }

  const formatDuration = (ms?: number) => {
    if (ms == null) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

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

  const getTypeIcon = (type: string, step?: ProcessStep) => {
    switch (type) {
      case 'thinking':
      case 'llm_generating':
        return <Lightbulb className="w-2.5 h-2.5 text-purple-400/70" />;
      case 'mcp_call':
        return <Wrench className="w-2.5 h-2.5 text-emerald-400/70" />;
      case 'workflow':
        return <WorkflowIcon className="w-2.5 h-2.5 text-indigo-400/70" />;
      case 'agent_activated':
        return <Zap className="w-2.5 h-2.5 text-yellow-400/70" />;
      case 'agent_deciding':
        return <Brain className="w-2.5 h-2.5 text-indigo-400/70 animate-pulse" />;
      case 'agent_decision':
        return <Target className="w-2.5 h-2.5 text-green-400/70" />;
      case 'agent_will_reply':
        return <MessageSquare className="w-2.5 h-2.5 text-blue-400/70" />;
      case 'media_signature':
        // @ts-ignore
        const info = step?.mediaInfo;
        if (info?.withoutSignature > 0) {
          return <ShieldAlert className="w-2.5 h-2.5 text-orange-400/70" />;
        }
        return <ShieldCheck className="w-2.5 h-2.5 text-green-400/70" />;
      case 'llm_metadata':
        return <FileText className="w-2.5 h-2.5 text-blue-400/70" />;
      case 'llm_media_signature':
        // @ts-ignore
        const llmMediaInfo = step?.mediaInfo;
        if (llmMediaInfo?.withoutSignature > 0) {
          return <XCircle className="w-2.5 h-2.5 text-red-400/70" />;
        }
        return <ShieldCheck className="w-2.5 h-2.5 text-green-400/70" />;
      default:
        return <FileText className="w-2.5 h-2.5 text-gray-400/60" />;
    }
  };

  const getTypeLabel = (type: string, step: ProcessStep): React.ReactNode => {
    switch (type) {
      case 'thinking':
        return '思考';
      case 'llm_generating': {
        const modelName = `${step.llm_provider || ''}/${step.llm_model || ''}`;
        const isThinkingModel = step.is_thinking_model;
        const status = step.status === 'completed' 
          ? '生成完成' 
          : (isThinkingModel ? '思考中...' : '生成中...');
        return `使用模型: ${modelName}, ${status}`;
      }
      case 'mcp_call': {
        // 优先使用 mcpServerName（别名），其次使用 mcpServer（ID）
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
      case 'agent_activated': {
        const agentName = step.agent_name || step.agent_id || 'Agent';
        const maxIter = step.max_iterations;
        return `Agent激活: ${agentName}${maxIter ? ` (最多${maxIter}轮)` : ''}`;
      }
      case 'agent_deciding':
        return `决策中: ${step.agent_name || 'Agent'}`;
      case 'agent_decision':
        return `决策结果: ${step.action || '未知'}`;
      case 'agent_will_reply':
        return '决定回答';
      case 'media_signature':
        return 'Gemini 图片签名';
      case 'llm_metadata':
        return 'LLM 响应信息';
      case 'llm_media_signature':
        return 'LLM 图片签名';
      default:
        return type;
    }
  };

  // 判断是否为重要步骤
  const isImportantStep = (type: string) => {
    return ['mcp_call', 'workflow', 'agent_decision', 'agent_will_reply', 'llm_media_signature'].includes(type);
  };

  // 计算步骤数（如果还在思考中但没有步骤，显示为 0）
  const stepCount = steps.length;

  // 渲染内容（使用小字体和低饱和度颜色）
  const renderContent = () => (
    <div className="space-y-1.5">
      {/* 正在思考的指示器 */}
      {(isThinking || isStreaming) && steps.filter(s => s.type === 'thinking' && s.status === 'running').length === 0 && (
        <div className="flex items-center gap-1.5 text-[10px] py-0.5 pl-1">
          <Lightbulb className="w-3 h-3 text-purple-400/70" />
          <Loader className="w-3 h-3 text-purple-400/70 animate-spin" />
          <span className="text-purple-500/80 dark:text-purple-400/70">
            {isThinking ? '思考中...' : '生成中...'}
          </span>
        </div>
      )}

      {steps.map((step, idx) => {
        const important = isImportantStep(step.type);
        // 获取轮次信息
        const iteration = step.iteration;
        const isFinal = step.is_final_iteration;
        
        return (
          <div
            key={`${step.type}-${step.timestamp || idx}`}
            className={`flex items-start gap-1.5 text-[10px] pl-1 py-0.5 ${
              important ? 'border-l-2 border-primary-300/60 dark:border-primary-400/40 -ml-[2px]' : ''
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
                  <span className={`px-1 py-0.5 rounded text-[9px] ${
                    isFinal 
                      ? 'bg-green-100/60 text-green-600/80 dark:bg-green-900/20 dark:text-green-400/70' 
                      : 'bg-gray-100/60 text-gray-500/80 dark:bg-gray-800/40 dark:text-gray-400/70'
                  }`}>
                    轮次{iteration}{isFinal ? ' · 最终' : ''}
                  </span>
                )}
                <span className={`${important ? 'font-medium' : 'font-normal'} text-gray-600/90 dark:text-[#b0b0b0]/80`}>
                  {getTypeLabel(step.type, step)}
                </span>
                {step.duration != null && (
                  <span className="text-gray-400/70 dark:text-[#606060]/80 text-[9px]">
                    {formatDuration(step.duration)}
                  </span>
                )}
              </div>
              {step.thinking && (
                <div className={`mt-0.5 whitespace-pre-wrap break-words text-[9px] ${
                  step.status === 'error' ? 'text-red-400/80 dark:text-red-400/70' : 'text-gray-500/80 dark:text-[#909090]/70'
                }`}>
                  {step.thinking.length > 500 ? (
                    <details>
                      <summary className="cursor-pointer hover:text-gray-600 dark:hover:text-gray-300">
                        {step.thinking.slice(0, 200)}...
                      </summary>
                      <div className="mt-1">{step.thinking}</div>
                    </details>
                  ) : step.thinking}
                </div>
              )}
              {step.error && (
                <div className="text-red-400/80 dark:text-red-400/70 mt-0.5 font-medium text-[9px]">
                  ❌ 错误: {step.error}
                </div>
              )}
              {step.type === 'mcp_call' && step.arguments && (
                <details className="mt-0.5">
                  <summary className="text-gray-400/70 cursor-pointer hover:text-gray-500 dark:hover:text-[#909090] text-[9px]">
                    查看参数
                  </summary>
                  <pre className="mt-0.5 text-[8px] bg-white/50 dark:bg-[#252525]/50 p-1.5 rounded overflow-auto max-h-20 leading-snug border border-dashed border-gray-200/60 dark:border-[#404040]/50">
                    {truncateBase64Strings(JSON.stringify(step.arguments, null, 2))}
                  </pre>
                </details>
              )}
              {step.type === 'mcp_call' && step.result && (
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
              {step.type === 'workflow' && step.workflowInfo?.result && (
                <details className="mt-0.5">
                  <summary className="text-gray-400/70 cursor-pointer hover:text-gray-500 dark:hover:text-[#909090] text-[9px]">
                    查看工作流结果
                  </summary>
                  <pre className="mt-0.5 text-[8px] bg-white/50 dark:bg-[#252525]/50 p-1.5 rounded overflow-auto max-h-20 leading-snug border border-dashed border-gray-200/60 dark:border-[#404040]/50">
                    {step.workflowInfo.result.slice(0, 1000)}
                    {step.workflowInfo.result.length > 1000 && '...'}
                  </pre>
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // 如果隐藏标题，直接显示内容（使用浅色背景和小字体）
  if (hideTitle) {
    return (
      <div className="pl-2 pr-2 py-1.5 rounded-md bg-gray-50/80 dark:bg-[#1a1a1a]/60 border border-gray-100 dark:border-[#2a2a2a]">
        {renderContent()}
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-[#808080] hover:text-gray-700 dark:hover:text-[#a0a0a0] transition-colors"
      >
        {isExpanded ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
        <span className="font-semibold">{title} ({stepCount} 步)</span>
        {ext?.llmInfo && (
          <span className="text-gray-400 dark:text-[#606060]">
            · {ext.llmInfo.provider}/{ext.llmInfo.model}
          </span>
        )}
        {(isThinking || isStreaming) && (
          <span className="flex items-center gap-1 ml-1">
            <div className="flex space-x-0.5">
              <div className="w-1 h-1 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1 h-1 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1 h-1 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-2 pl-2 border-l-2 border-dashed border-gray-300 dark:border-[#505050]">
          {renderContent()}
        </div>
      )}
    </div>
  );
};

export default ProcessStepsViewer;
