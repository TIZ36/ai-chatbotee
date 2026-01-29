/**
 * 分栏消息视图组件
 * 左边显示消息主要内容，右边显示AI思考过程、MCP调用和工作流执行过程
 */

import React, { useRef, useEffect } from 'react';
import { 
  CheckSquare,
  Square,
  Quote,
  Edit2,
  RotateCw,
  Sparkles
} from 'lucide-react';
import { ProcessStepsViewer } from './ui/ProcessStepsViewer';
import type { ProcessMessage } from '../types/processMessage';
import { 
  MessageBubble, 
  MessageAvatar, 
  MessageStatusIndicator,
  getMessageBubbleClasses,
  type MessageRole,
  type ToolType
} from './ui/MessageBubble';
import type { MCPDetail } from '../services/sessionApi';
import type { WorkflowNode, WorkflowConnection } from '../services/workflowApi';

/** 多模态媒体内容类型 */
export interface MediaItem {
  type: 'image' | 'video' | 'audio';
  mimeType: string;
  data: string; // base64 编码的数据
  url?: string; // 如果是 URL
}

export interface SplitViewMessageProps {
  /** 消息ID */
  id: string;
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** 消息内容 */
  content: string;
  /** 思考过程 */
  thinking?: string;
  /** 是否正在思考 */
  isThinking?: boolean;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 当前执行步骤 */
  currentStep?: string;
  /** 工具类型 */
  toolType?: 'workflow' | 'mcp';
  /** 工作流ID */
  workflowId?: string;
  /** 工作流名称 */
  workflowName?: string;
  /** 工作流状态 */
  workflowStatus?: 'pending' | 'running' | 'completed' | 'error';
  /** 工作流结果 */
  workflowResult?: string;
  /** 工作流配置 */
  workflowConfig?: { nodes: WorkflowNode[]; connections: WorkflowConnection[] };
  /** 工具调用 */
  toolCalls?: Array<{ name: string; arguments: any; result?: any }>;
  /** MCP 执行详情 */
  mcpDetail?: MCPDetail;
  /** 思维签名 */
  thoughtSignature?: string;
  /** 多模态媒体内容（图片、视频、音频） */
  media?: MediaItem[];
  /** 头像URL */
  avatarUrl?: string;
  /** 是否被选中（技能包选择模式） */
  isSelected?: boolean;
  /** 是否在选择模式 */
  selectionMode?: boolean;
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 消息内容渲染器 */
  renderContent: (message: any) => React.ReactNode;
  /** 选择切换回调 */
  onToggleSelection?: () => void;
  /** 引用消息回调 */
  onQuote?: () => void;
  /** 编辑消息回调 */
  onEdit?: () => void;
  /** 重新发送回调 */
  onResend?: () => void;
  /** MCP详情查看回调 */
  onViewMCPDetail?: () => void;
  /** 重试回调 */
  onRetry?: () => void;
  /** LLM 提供商 */
  llmProvider?: string;
  /** 过程消息（新协议） */
  processMessages?: ProcessMessage[];
}

export const SplitViewMessage: React.FC<SplitViewMessageProps> = ({
  id,
  role,
  content,
  thinking,
  isThinking,
  isStreaming,
  currentStep,
  toolType,
  workflowId,
  workflowName,
  workflowStatus,
  workflowResult,
  workflowConfig,
  toolCalls,
  mcpDetail,
  thoughtSignature,
  media,
  avatarUrl,
  isSelected,
  selectionMode,
  isLoading,
  renderContent,
  onToggleSelection,
  onQuote,
  onEdit,
  onResend,
  onViewMCPDetail,
  onRetry,
  llmProvider,
  processMessages,
}) => {
  const leftRef = useRef<HTMLDivElement>(null);

  // 判断是否需要显示右侧面板（只有assistant消息且有额外内容时显示）
  const hasThinking = thinking && thinking.trim().length > 0;
  // MCPDetail 在本项目里可能是：
  // - 旧结构：tool_calls/tool_results
  // - 新结构：execution 记录（raw_result/logs/component_type/status）
  const hasMCPDetail = !!mcpDetail && (() => {
    const anyDetail = mcpDetail as any;
    if (Array.isArray(anyDetail?.tool_calls) && anyDetail.tool_calls.length > 0) return true;
    if (Array.isArray(anyDetail?.tool_results) && anyDetail.tool_results.length > 0) return true;
    if (anyDetail?.raw_result) return true;
    if (Array.isArray(anyDetail?.logs) && anyDetail.logs.length > 0) return true;
    // execution 记录本身存在也认为有过程可展示（至少有状态/错误）
    if (anyDetail?.status) return true;
    return false;
  })();
  const hasToolCalls = toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0;
  const hasWorkflow = role === 'tool' && (toolType === 'workflow' || toolType === 'mcp') && workflowStatus;
  const hasProcessSteps = processMessages && processMessages.length > 0;
  const hasContent = !!content && content.trim().length > 0;
  
  const shouldShowSidePanel = role === 'assistant' && (
    hasThinking || 
    hasMCPDetail || 
    hasToolCalls || 
    hasProcessSteps ||  // 支持非思考模型的 MCP/工作流过程显示
    isThinking || 
    currentStep ||
    thoughtSignature
  );


  // 用户消息不显示分栏
  const isUserMessage = role === 'user';

  // 构造消息对象传给 renderContent
  const messageObj = {
    id,
    role,
    content,
    thinking,
    isThinking,
    isStreaming,
    currentStep,
    toolType,
    workflowId,
    workflowName,
    workflowStatus,
    workflowResult,
    workflowConfig,
    toolCalls,
    mcpDetail,
    thoughtSignature,
    media, // 多模态媒体内容
  };

  return (
    <div 
      data-message-id={id}
      onClick={selectionMode ? onToggleSelection : undefined}
      className={`flex items-start space-x-2 fade-in-up stagger-item ${
        isUserMessage ? 'flex-row-reverse space-x-reverse' : ''
      } ${
        selectionMode 
          ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#404040] rounded-lg p-2 -m-2 transition-all duration-200' 
          : ''
      } ${
        isSelected && selectionMode
          ? 'bg-primary-50 dark:bg-primary-900/20 ring-2 ring-primary-300 dark:ring-primary-700 rounded-lg p-2 -m-2' 
          : ''
      }`}
    >
      {/* 选择复选框（仅在选择模式下显示） */}
      {selectionMode && (
        <div className={`flex-shrink-0 mt-0.5 ${isUserMessage ? 'ml-1.5' : 'mr-1.5'}`}>
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-primary-500" />
          ) : (
            <Square className="w-4 h-4 text-gray-400" />
          )}
        </div>
      )}

      {/* 头像 - 移除头像旁边的状态指示器，全部移入过程区域显示 */}
      <div className="flex-shrink-0">
        <MessageAvatar 
          role={role as MessageRole} 
          toolType={toolType as ToolType} 
          avatarUrl={avatarUrl}
          size="md"
        />
      </div>

      {/* 消息内容区域 */}
      <div className="flex-1 group relative">
        {/* 堆叠布局：上方过程（默认自动展开/折叠），下方模型输出 */}
        <div className="space-y-2">
          {/* 过程区域（思考链 + tags 同行显示） */}
          {shouldShowSidePanel && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Sparkles className="w-3 h-3 text-primary" />
                <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300">
                  思考链
                </span>
                {(isThinking || isStreaming) && (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/30">
                    <div className="flex space-x-0.5">
                      <div className="w-1 h-1 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1 h-1 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1 h-1 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap">
                      {isThinking ? (llmProvider === 'gemini' ? '深度思考中' : '思考中') : '生成中'}
                    </span>
                  </div>
                )}
              </div>
              <ProcessStepsViewer
                processMessages={processMessages}
                isThinking={isThinking}
                isStreaming={isStreaming}
                hideTitle
                defaultExpanded
              />
            </div>
          )}

          {/* 模型输出（消息气泡） */}
          <div ref={leftRef} className="min-w-0">
            <MessageBubble role={role as MessageRole} toolType={toolType as ToolType}>
              {renderContent(messageObj)}
            </MessageBubble>

            {/* 操作按钮 - 显示在气泡上方 */}
            {/* 用户消息的编辑、重新发送和引用按钮 */}
            {role === 'user' && !isLoading && (
              <div className="absolute -top-7 right-0 flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-[#2d2d2d] rounded-lg shadow-md border border-gray-200 dark:border-[#404040] px-1 py-0.5">
                {onQuote && (
                  <button
                    onClick={onQuote}
                    className="p-1.5 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-all"
                    title="引用此消息"
                  >
                    <Quote className="w-3.5 h-3.5" />
                  </button>
                )}
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="p-1.5 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-all"
                    title="编辑消息"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {onResend && (
                  <button
                    onClick={onResend}
                    className="p-1.5 text-gray-500 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-all"
                    title="重新发送"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Assistant消息的操作按钮（引用 + MCP 详情） - 显示在气泡上方 */}
            {role === 'assistant' && !isLoading && (onQuote || (mcpDetail && onViewMCPDetail)) && (
              <div className="absolute -top-7 right-0 flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-[#2d2d2d] rounded-lg shadow-md border border-gray-200 dark:border-[#404040] px-1 py-0.5">
                {onQuote && (
                  <button
                    onClick={onQuote}
                    className="p-1.5 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-all"
                    title="引用此消息"
                  >
                    <Quote className="w-3.5 h-3.5" />
                  </button>
                )}
                {mcpDetail && onViewMCPDetail && (
                  <button
                    onClick={onViewMCPDetail}
                    className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded transition-all flex items-center space-x-1"
                    title="查看 MCP 详情"
                  >
                    <Plug className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Assistant错误消息的重试按钮 - 显示在气泡上方 */}
            {role === 'assistant' && 
             content?.includes('❌ 错误') && 
             toolCalls && 
             typeof toolCalls === 'object' &&
             (toolCalls as any).canRetry === true && 
             onRetry && (
              <div className="absolute -top-8 right-0 flex items-center space-x-1">
                <button
                  onClick={onRetry}
                  disabled={isLoading}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-primary-500 hover:bg-primary-600 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg transition-all flex items-center space-x-1.5 shadow-md"
                  title="重试发送"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>重试</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SplitViewMessage;

