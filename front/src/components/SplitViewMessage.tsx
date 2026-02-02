/**
 * 分栏消息视图组件
 * 左边显示消息主要内容，右边显示AI思考过程、MCP调用和工作流执行过程
 */

import React, { useRef } from 'react';
import { 
  CheckSquare,
  Square,
  Edit2,
  RotateCw,
  Plug,
  Quote,
} from 'lucide-react';
import { SimpleLogViewer } from './ui/SimpleLogViewer';
import { ProcessStepsViewer } from './ui/ProcessStepsViewer';
import type { ExecutionLogEntry } from './ui/ExecutionLogViewer';
import { Button } from './ui/Button';
import type { ProcessMessage } from '../types/processMessage';
import { 
  MessageBubble, 
  MessageAvatar, 
  type MessageRole,
  type ToolType
} from './ui/MessageBubble';
import type { MCPDetail } from '../services/sessionApi';
import type { WorkflowNode, WorkflowConnection } from '../types';

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
  /** 执行日志（持久化） */
  executionLogs?: ExecutionLogEntry[];
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
  processMessages,
  executionLogs,
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
  // 保留变量引用用于未来扩展
  void hasThinking; void hasMCPDetail; void hasToolCalls;

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

  // AI 消息（assistant/tool）全宽显示，用户消息保持右对齐带头像
  const isAssistantMessage = role === 'assistant' || role === 'tool';

  return (
    <div 
      data-message-id={id}
      onClick={selectionMode ? onToggleSelection : undefined}
      className={`fade-in-up stagger-item ${
        isAssistantMessage 
          ? 'w-full' // AI 消息全宽
          : `flex items-start space-x-2 ${isUserMessage ? 'flex-row-reverse space-x-reverse' : ''}`
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

      {/* 头像 - 非用户消息保留原布局 */}
      {!isAssistantMessage && !isUserMessage && (
        <div className="flex-shrink-0 flex items-start">
          <MessageAvatar 
            role={role as MessageRole} 
            toolType={toolType as ToolType} 
            avatarUrl={avatarUrl}
            size="md"
          />
        </div>
      )}

      {/* 消息内容区域 */}
      <div className={`group relative ${isAssistantMessage ? 'w-full' : 'flex-1'}`}>
        {isAssistantMessage ? (
          /* AI 消息：堆叠布局：头像+按钮 -> 日志（折叠） -> 输出 */
          <div className="space-y-1.5">
            {/* AI 消息：头像行（头像 + 引用/思维链按钮） */}
            <div className="flex items-center gap-2">
              <MessageAvatar 
                role={role as MessageRole} 
                toolType={toolType as ToolType} 
                avatarUrl={avatarUrl}
                size="sm"
              />
              {/* 引用按钮 */}
              {onQuote && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onQuote}
                  aria-label="引用此消息"
                  title="引用此消息"
                  className="h-6 w-6 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  <Quote className="w-3 h-3" />
                </Button>
              )}
              {/* 思维链按钮（有执行日志或 processMessages 时显示） */}
              {/* 思维链按钮（有执行日志或 processMessages 时显示） */}
              {((executionLogs && executionLogs.length > 0) || (processMessages && processMessages.length > 0)) && (
                <ProcessStepsViewer
                  processMessages={processMessages}
                  executionLogs={executionLogs}
                  isThinking={isThinking}
                  isStreaming={isStreaming}
                  hideTitle
                  showTags={false}
                  defaultExpanded={false}
                />
              )}
            </div>
            
            {/* 执行日志（头像下方，朴素小灰字风格） */}
            {(executionLogs && executionLogs.length > 0) && (
              <div className="ml-0.5">
                <SimpleLogViewer
                  logs={executionLogs}
                  isActive={isThinking || isStreaming}
                  defaultCollapsed={!isThinking && !isStreaming && !!content?.trim()}
                  maxHeight={100}
                />
              </div>
            )}

            {/* 模型输出（消息气泡） */}
            <div ref={leftRef} className="min-w-0">
              <MessageBubble role={role as MessageRole} toolType={toolType as ToolType}>
                {renderContent(messageObj)}
              </MessageBubble>

              {/* Assistant消息的操作按钮（引用 + MCP 详情） - 显示在气泡上方 */}
              {!isLoading && mcpDetail && onViewMCPDetail && (
                <div className="absolute -top-7 right-0 flex items-center space-x-0.5 bg-muted/70 rounded-lg border border-border px-1 py-0.5">
                  <Button
                    onClick={onViewMCPDetail}
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-emerald-600 dark:text-emerald-400"
                    title="查看 MCP 详情"
                  >
                    <Plug className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}

              {/* Assistant错误消息的重试按钮 - 显示在气泡上方 */}
              {content?.includes('❌ 错误') && 
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
        ) : (
          /* 用户消息：头像一行，气泡下一行 */
          <div ref={leftRef} className="min-w-0 space-y-2">
            <div className="flex items-center justify-end gap-1.5">
              {!isLoading && (onEdit || onResend) && (
                <div className="flex items-center space-x-0.5 bg-muted/70 rounded-lg border border-border px-1 py-0.5">
                  {onEdit && (
                    <Button
                      onClick={onEdit}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-primary-600 dark:hover:text-primary-400"
                      title="编辑消息"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {onResend && (
                    <Button
                      onClick={onResend}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-green-600 dark:hover:text-green-400"
                      title="重新发送"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )}
              <MessageAvatar 
                role={role as MessageRole} 
                toolType={toolType as ToolType} 
                avatarUrl={avatarUrl}
                size="md"
              />
            </div>
            <MessageBubble role={role as MessageRole} toolType={toolType as ToolType}>
              {renderContent(messageObj)}
            </MessageBubble>
          </div>
        )}
      </div>
    </div>
  );
};

export default SplitViewMessage;

