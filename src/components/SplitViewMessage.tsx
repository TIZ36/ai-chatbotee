/**
 * 分栏消息视图组件
 * 左边显示消息主要内容，右边显示AI思考过程、MCP调用和工作流执行过程
 */

import React, { useRef, useEffect, useState } from 'react';
import { 
  User, 
  Bot, 
  Wrench, 
  Plug, 
  Workflow as WorkflowIcon,
  Brain,
  Sparkles,
  CheckSquare,
  Square,
  Quote,
  Edit2,
  RotateCw,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { MessageSidePanel, MessageSidePanelProps, ProcessStep } from './MessageSidePanel';
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
  const [leftHeight, setLeftHeight] = useState<number>(0);
  const [showSidePanel, setShowSidePanel] = useState(true);

  // 监听左侧消息高度变化
  useEffect(() => {
    if (!leftRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setLeftHeight(entry.contentRect.height);
      }
    });
    
    observer.observe(leftRef.current);
    return () => observer.disconnect();
  }, []);

  // 判断是否需要显示右侧面板（只有assistant消息且有额外内容时显示）
  const hasThinking = thinking && thinking.trim().length > 0;
  const hasMCPDetail = mcpDetail && (mcpDetail.tool_calls?.length > 0 || mcpDetail.tool_results?.length > 0);
  const hasToolCalls = toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0;
  const hasWorkflow = role === 'tool' && (toolType === 'workflow' || toolType === 'mcp') && workflowStatus;
  const hasProcessSteps = processSteps && processSteps.length > 0;
  
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

  // 获取头像组件
  const renderAvatar = () => {
    const avatarClasses = `w-7 h-7 rounded-full flex items-center justify-center shadow-sm overflow-hidden ${
      role === 'user'
        ? 'bg-primary-500 text-white'
        : role === 'assistant'
        ? 'bg-primary-500 text-white'
        : role === 'tool'
          ? toolType === 'workflow'
            ? 'bg-primary-500 text-white'
            : toolType === 'mcp'
            ? 'bg-green-500 text-white'
            : 'bg-gray-500 text-white'
        : 'bg-gray-400 text-white'
    }`;

    return (
      <div className={avatarClasses}>
        {role === 'user' ? (
          <User className="w-4 h-4" />
        ) : role === 'assistant' ? (
          avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <Bot className="w-4 h-4" />
          )
        ) : role === 'tool' ? (
          toolType === 'workflow' ? (
            <WorkflowIcon className="w-4 h-4" />
          ) : toolType === 'mcp' ? (
            <Plug className="w-4 h-4" />
          ) : (
            <Wrench className="w-4 h-4" />
          )
        ) : (
          <Bot className="w-4 h-4" />
        )}
      </div>
    );
  };

  // 获取状态指示器
  const renderStatusIndicator = () => {
    if (role !== 'assistant') return null;

    if (isThinking && (!content || content.length === 0)) {
      return (
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Brain className="w-4 h-4 text-primary-500 animate-pulse" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary-400 rounded-full animate-ping opacity-75" />
          </div>
          <div className="flex items-center space-x-1">
            <span className="text-xs text-primary-600 dark:text-primary-400 font-medium">
              {llmProvider === 'gemini' ? '深度思考中' : '思考中'}
            </span>
            <div className="flex space-x-0.5 ml-1">
              <div className="w-1 h-1 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }} />
              <div className="w-1 h-1 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }} />
              <div className="w-1 h-1 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }} />
            </div>
          </div>
        </div>
      );
    }

    if (isStreaming && (!content || content.length === 0)) {
      return (
        <div className="flex items-center space-x-2">
          <div className="relative">
            <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
          </div>
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            {llmProvider === 'gemini' ? '生成中，请稍候...' : '处理中...'}
          </span>
          <div className="flex space-x-0.5">
            <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
            <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '400ms' }} />
          </div>
        </div>
      );
    }

    if (isStreaming) {
      return (
        <div className="flex items-center space-x-1.5">
          <div className="flex space-x-0.5">
            <div className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-xs text-gray-500 dark:text-[#b0b0b0] font-medium">回答中</span>
        </div>
      );
    }

    return null;
  };

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

      {/* 头像和状态指示器 */}
      <div className="flex-shrink-0 flex items-center space-x-1.5">
        {renderAvatar()}
        {renderStatusIndicator()}
      </div>

      {/* 消息内容区域 */}
      <div className="flex-1 group relative">
        {/* 分栏布局：左边消息内容，右边侧面板（各占50%） */}
        <div className={`flex ${shouldShowSidePanel && showSidePanel ? 'gap-3' : ''}`}>
          {/* 左侧：消息内容 */}
          <div 
            ref={leftRef}
            className={`${shouldShowSidePanel && showSidePanel ? 'w-1/2 min-w-0' : 'w-full'}`}
          >
            <div
              className={`rounded-lg p-2.5 transition-all duration-300 ${
                role === 'user'
                  ? 'bg-primary-50 dark:bg-primary-900/20 text-gray-900 dark:text-[#ffffff] shadow-sm hover:shadow-md'
                  : role === 'assistant'
                  ? 'bg-white dark:bg-[#2d2d2d] text-gray-900 dark:text-[#ffffff] border border-gray-200 dark:border-[#404040] shadow-lg hover:shadow-xl'
                  : role === 'tool'
                  ? toolType === 'workflow'
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-gray-900 dark:text-[#ffffff] border border-primary-200 dark:border-primary-700 shadow-sm hover:shadow-md'
                    : toolType === 'mcp'
                    ? 'bg-green-50 dark:bg-green-900/20 text-gray-900 dark:text-[#ffffff] border border-green-200 dark:border-green-700 shadow-sm hover:shadow-md'
                    : 'bg-gray-50 dark:bg-[#2d2d2d] text-gray-900 dark:text-[#ffffff] shadow-sm hover:shadow-md'
                  : 'bg-yellow-50 dark:bg-yellow-900/20 text-gray-700 dark:text-[#ffffff] shadow-sm hover:shadow-md'
              }`}
              style={{
                fontSize: role === 'assistant' ? '13px' : '12px',
                lineHeight: role === 'assistant' ? '1.6' : '1.5',
              }}
            >
              {renderContent(messageObj)}
            </div>

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

          {/* 右侧：侧边面板（思考过程、MCP调用、工作流）- 占50%宽度 */}
          {shouldShowSidePanel && showSidePanel && (
            <div 
              className="w-1/2 flex-shrink-0 relative"
              style={{ minHeight: leftHeight > 0 ? leftHeight : 'auto' }}
            >
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
                messageHeight={leftHeight}
                processSteps={processSteps}
              />
            </div>
          )}
        </div>

        {/* 侧边面板切换按钮 */}
        {shouldShowSidePanel && (
          <button
            onClick={() => setShowSidePanel(!showSidePanel)}
            className="absolute -right-3 top-1/2 transform -translate-y-1/2 z-10 p-1 bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] rounded-full shadow-md hover:bg-gray-50 dark:hover:bg-[#363636] transition-all opacity-0 group-hover:opacity-100"
            title={showSidePanel ? '隐藏详情面板' : '显示详情面板'}
          >
            {showSidePanel ? (
              <ChevronRight className="w-3 h-3 text-gray-500" />
            ) : (
              <ChevronLeft className="w-3 h-3 text-gray-500" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default SplitViewMessage;

