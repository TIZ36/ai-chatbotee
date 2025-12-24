/**
 * 分栏消息视图组件
 * 左边显示消息主要内容，右边显示AI思考过程、MCP调用和工作流执行过程
 */

import React, { useRef, useEffect, useState } from 'react';
import { 
  CheckSquare,
  Square,
  Quote,
  Edit2,
  RotateCw,
  ChevronDown,
  ChevronUp,
  Plug
} from 'lucide-react';
import { MessageSidePanel, ProcessStep } from './MessageSidePanel';
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
  /** 多轮过程步骤 */
  processSteps?: ProcessStep[];
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
  processSteps,
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
  const hasProcessSteps = processSteps && processSteps.length > 0;
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

  // 过程面板（堆叠在模型输出之上）
  // 默认规则：
  // - 模型还没有输出时：默认展开过程
  // - 模型输出后：默认折叠过程
  const userToggledRef = useRef(false);
  const [processExpanded, setProcessExpanded] = useState<boolean>(() => !hasContent);
  useEffect(() => {
    if (!shouldShowSidePanel) return;
    if (!hasContent) {
      // 没输出时强制展示过程（符合“默认展示过程”）
      userToggledRef.current = false;
      setProcessExpanded(true);
      return;
    }
    // 有输出后，如果用户没有手动展开过，则自动折叠
    if (!userToggledRef.current) {
      setProcessExpanded(false);
    }
  }, [hasContent, shouldShowSidePanel]);

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

      {/* 头像和状态指示器 - 使用统一组件 */}
      <div className="flex-shrink-0 flex items-center space-x-1.5">
        <MessageAvatar 
          role={role as MessageRole} 
          toolType={toolType as ToolType} 
          avatarUrl={avatarUrl}
          size="md"
        />
        {role === 'assistant' && (
          <MessageStatusIndicator
            isThinking={isThinking}
            isStreaming={isStreaming}
            hasContent={!!content && content.length > 0}
            currentStep={currentStep}
            llmProvider={llmProvider}
          />
        )}
      </div>

      {/* 消息内容区域 */}
      <div className="flex-1 group relative">
        {/* 堆叠布局：上方过程（默认自动展开/折叠），下方模型输出 */}
        <div className="space-y-2">
          {/* 过程区域（思考/工具/工作流） */}
          {shouldShowSidePanel && (
            <div className="rounded-lg border border-gray-200 dark:border-[#404040] bg-white/60 dark:bg-[#2d2d2d]/60 backdrop-blur-sm overflow-hidden">
              <button
                onClick={() => {
                  userToggledRef.current = true;
                  setProcessExpanded(v => !v);
                }}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50/80 dark:hover:bg-[#363636]/60 transition-colors"
                title={processExpanded ? '折叠过程' : '展开过程'}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Plug className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                    思考 / 工具 / Workflow 过程
                  </span>
                  {!hasContent && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-shrink-0">
                      （模型未输出，默认展示）
                    </span>
                  )}
                  {hasContent && !processExpanded && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-shrink-0">
                      （已输出，默认折叠）
                    </span>
                  )}
                </div>
                {processExpanded ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {processExpanded && (
                <div className="border-t border-gray-200/60 dark:border-[#404040]/60 p-2">
                  <MessageSidePanel
                    thinking={thinking}
                    isThinking={isThinking}
                    mcpDetail={mcpDetail}
                    toolCalls={hasToolCalls ? (toolCalls as Array<{ name: string; arguments: any; result?: any }>) : undefined}
                    workflowInfo={hasWorkflow ? {
                      id: workflowId,
                      name: workflowName,
                      status: workflowStatus,
                      result: workflowResult,
                      config: workflowConfig,
                    } : undefined}
                    currentStep={currentStep}
                    isStreaming={isStreaming}
                    thoughtSignature={thoughtSignature}
                    hasContent={hasContent}
                    processSteps={processSteps}
                  />
                </div>
              )}
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

            {/* Assistant消息的 MCP 详情按钮 - 显示在气泡上方 */}
            {role === 'assistant' && mcpDetail && onViewMCPDetail && (
              <div className="absolute -top-7 right-0 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={onViewMCPDetail}
                  className="px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-white dark:bg-[#2d2d2d] hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-all flex items-center space-x-1.5 border border-gray-200 dark:border-[#404040] shadow-md"
                  title="查看 MCP 详情"
                >
                  <Plug className="w-3.5 h-3.5" />
                  <span>MCP 详情</span>
                </button>
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

