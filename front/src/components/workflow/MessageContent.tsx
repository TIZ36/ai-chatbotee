/**
 * MessageContent Component
 * 
 * Renders the content of a message in the workflow chat,
 * handling various message types including:
 * - Thinking/streaming placeholders
 * - Error messages
 * - Media content (images, video, audio)
 * - Tool messages (MCP, Workflow)
 * - Assistant messages with Markdown
 * - User messages
 */

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Loader,
  AlertCircle,
  CheckCircle,
  Workflow as WorkflowIcon,
  Play,
  ArrowRight,
  Trash2,
  XCircle,
  Wrench,
  Lightbulb,
  FileText,
} from 'lucide-react';
import { MediaGallery, MediaItem } from '../ui/MediaGallery';
import { MCPExecutionCard } from '../MCPExecutionCard';
import { truncateBase64Strings } from '../../utils/textUtils';
import { parseMCPContentBlocks, renderMCPBlocks, renderMCPMedia } from './mcpRender';
import type { WorkflowNode, WorkflowConnection } from '../../services/workflowApi';

/** Single process step (for recording multi-round thinking and MCP calls) */
export interface ProcessStep {
  /** Step type */
  type: 'thinking' | 'mcp_call' | 'workflow';
  /** Timestamp */
  timestamp?: number;
  /** Thinking content (when type === 'thinking') */
  thinking?: string;
  /** MCP server name (when type === 'mcp_call') */
  mcpServer?: string;
  /** Tool name (when type === 'mcp_call') */
  toolName?: string;
  /** Call arguments */
  arguments?: any;
  /** Call result */
  result?: any;
  /** Execution status */
  status?: 'pending' | 'running' | 'completed' | 'error';
  /** Execution duration (milliseconds) */
  duration?: number;
  /** Workflow info (when type === 'workflow') */
  workflowInfo?: {
    id?: string;
    name?: string;
    status?: 'pending' | 'running' | 'completed' | 'error';
    result?: string;
    config?: {
      nodes: WorkflowNode[];
      connections: WorkflowConnection[];
    };
  };
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string;
  toolCalls?: Array<{ name: string; arguments: any; result?: any }> | {
    isSystemPrompt?: boolean;
    batchName?: string;
    item?: any;
    canRetry?: boolean;
    errorType?: 'network' | 'timeout' | 'api' | 'unknown';
    [key: string]: any;
  };
  isStreaming?: boolean;
  isThinking?: boolean;
  currentStep?: string;
  toolType?: 'workflow' | 'mcp';
  workflowId?: string;
  workflowName?: string;
  workflowStatus?: 'pending' | 'running' | 'completed' | 'error';
  workflowResult?: string;
  workflowConfig?: { nodes: WorkflowNode[]; connections: WorkflowConnection[] };
  isSummary?: boolean;
  media?: Array<{
    type: 'image' | 'video' | 'audio';
    mimeType: string;
    data: string;
    url?: string;
  }>;
  thoughtSignature?: string;
  toolCallSignatures?: Record<string, string>;
  mcpdetail?: any;
  processSteps?: ProcessStep[];
}

export interface MessageContentProps {
  /** The message to render */
  message: Message;
  /** All messages (to find previous message for context) */
  messages: Message[];
  /** Abort controller for canceling generation */
  abortController: AbortController | null;
  /** Setter for abort controller */
  setAbortController: React.Dispatch<React.SetStateAction<AbortController | null>>;
  /** Setter for messages */
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Setter for loading state */
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  /** Set of collapsed thinking message IDs */
  collapsedThinking: Set<string>;
  /** Toggle thinking collapse for a message */
  toggleThinkingCollapse: (messageId: string) => void;
  /** Handler for executing workflow */
  handleExecuteWorkflow: (messageId: string) => void;
  /** Handler for deleting workflow message */
  handleDeleteWorkflowMessage: (messageId: string) => void;
  /** Find session media index */
  findSessionMediaIndex: (messageId: string, mediaIndex: number) => number;
  /** Open session media panel */
  openSessionMediaPanel: (index: number) => void;
}

/**
 * Parse MCP content to extract texts and media
 */
const parseMCPContent = (content: any): { 
  texts: string[]; 
  media: Array<{ type: 'image' | 'video' | 'audio'; mimeType: string; data: string }> 
} => {
  const texts: string[] = [];
  const media: Array<{ type: 'image' | 'video' | 'audio'; mimeType: string; data: string }> = [];
  
  try {
    let contentObj = content;
    if (typeof content === 'string') {
      try {
        contentObj = JSON.parse(content);
      } catch {
        return { texts: [content], media: [] };
      }
    }
    
    const contentArray = contentObj?.result?.content || contentObj?.content || (Array.isArray(contentObj) ? contentObj : null);
    
    if (Array.isArray(contentArray)) {
      for (const item of contentArray) {
        if (item.type === 'text' && item.text) {
          texts.push(item.text);
        } else if (item.type === 'image') {
          const mimeType = item.mimeType || item.mime_type;
          const data = item.data;
          if (!mimeType || !data) {
            console.warn('[MCP Debug] parseMCPContent image missing mimeType or data, skipping');
            continue;
          }
          media.push({ type: 'image', mimeType, data });
        } else if (item.type === 'video') {
          const mimeType = item.mimeType || item.mime_type;
          const data = item.data;
          if (!mimeType || !data) {
            console.warn('[MCP Debug] parseMCPContent video missing mimeType or data, skipping');
            continue;
          }
          media.push({ type: 'video', mimeType, data });
        }
      }
    } else if (contentObj && typeof contentObj === 'object') {
      texts.push(JSON.stringify(contentObj, null, 2));
    }
  } catch (e) {
    console.error('[MCP Debug] parseMCPContent parsing failed:', e);
    texts.push(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  
  return { texts, media };
};

/**
 * MessageContent component
 * Renders the content of a message based on its type and state
 */
export const MessageContent: React.FC<MessageContentProps> = ({
  message,
  messages,
  abortController,
  setAbortController,
  setMessages,
  setIsLoading,
  collapsedThinking,
  toggleThinkingCollapse,
  handleExecuteWorkflow,
  handleDeleteWorkflowMessage,
  findSessionMediaIndex,
  openSessionMediaPanel,
}) => {
  // Helper function to render MCP blocks for a message
  const renderMCPBlocksForMessage = (blocks: any[], messageId?: string) => {
    return renderMCPBlocks({
      blocks,
      messageId,
      findSessionMediaIndex,
      openSessionMediaPanel,
    });
  };

  // Helper function to render MCP media for a message
  const renderMCPMediaForMessage = (
    media: Array<{ type: 'image' | 'video' | 'audio'; mimeType: string; data: string }>,
    messageId?: string
  ) => {
    return renderMCPMedia({
      media,
      messageId,
      findSessionMediaIndex,
      openSessionMediaPanel,
    });
  };

  // Thinking/generating placeholder (when content is empty and processing)
  if (message.role === 'assistant' && (!message.content || message.content.length === 0) && (message.isThinking || message.isStreaming)) {
    const hasThinkingContent = message.thinking && message.thinking.trim().length > 0;
    
    // If there's thinking content, show streaming thinking process without animation
    if (hasThinkingContent) {
      return (
        <div className="w-full">
          <div className="mb-2">
            <div className="flex items-center space-x-1 text-[10px] text-gray-400 dark:text-[#808080] mb-1">
              <Lightbulb className="w-3 h-3" />
              <span>思考过程</span>
              {message.isThinking && (
                <>
                  <span>思考中...</span>
                  <span className="inline-block ml-1 w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse"></span>
                </>
              )}
            </div>
            <div className="text-[11px] text-gray-400 dark:text-[#808080] font-mono leading-relaxed whitespace-pre-wrap break-words bg-transparent">
              {message.thinking}
            </div>
          </div>
          {/* Abort button */}
          {abortController && (
            <button
              onClick={() => {
                abortController.abort();
                setAbortController(null);
                setMessages(prev => prev.filter(msg => msg.id !== message.id));
                setIsLoading(false);
              }}
              className="mt-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg transition-colors"
            >
              <XCircle className="w-3.5 h-3.5 inline mr-1" />
              中断生成
            </button>
          )}
        </div>
      );
    }
    
    // If no thinking content, show simple loading indicator
    return (
      <div className="flex flex-col items-center justify-center py-4 px-4">
        <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-[#b0b0b0]">
          <Loader className="w-4 h-4 animate-spin" />
          <span>思考中...</span>
        </div>
        {/* Abort button */}
        {abortController && (
          <button
            onClick={() => {
              abortController.abort();
              setAbortController(null);
              setMessages(prev => prev.filter(msg => msg.id !== message.id));
              setIsLoading(false);
            }}
            className="mt-3 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg transition-colors"
          >
            <XCircle className="w-3.5 h-3.5 inline mr-1" />
            中断生成
          </button>
        )}
      </div>
    );
  }
  
  // Error message (with special styling)
  if (message.role === 'assistant' && message.content?.includes('❌ 错误')) {
    return (
      <div className="w-full">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm text-red-900 dark:text-red-100 whitespace-pre-wrap">
                {message.content}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Media content display (images, video, audio) - using thumbnail gallery
  const renderMedia = () => {
    if (!message.media || message.media.length === 0) {
      return null;
    }
    
    // Convert to MediaGallery format
    const galleryMedia: MediaItem[] = message.media.map(m => ({
      type: m.type,
      mimeType: m.mimeType,
      data: m.data,
      url: m.url,
    }));
    
    return (
      <div className="mb-3">
        <MediaGallery 
          media={galleryMedia} 
          thumbnailSize="md"
          maxVisible={6}
          showDownload={true}
          onOpenSessionGallery={(index) => {
            const sessionIndex = findSessionMediaIndex(message.id, index);
            openSessionMediaPanel(sessionIndex);
          }}
        />
      </div>
    );
  };
  
  // Tool message (perception component)
  if (message.role === 'tool' && message.toolType) {
    // MCP message uses dedicated MCPExecutionCard component
    if (message.toolType === 'mcp') {
      const messageIndex = messages.findIndex(m => m.id === message.id);
      const prevMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;
      const inputText = prevMessage?.content || '';

      return (
        <MCPExecutionCard
          messageId={message.id}
          mcpServerName={message.workflowName || 'MCP 服务器'}
          mcpServerId={message.workflowId || ''}
          status={message.workflowStatus || 'pending'}
          content={message.content}
          inputText={inputText}
          onExecute={() => handleExecuteWorkflow(message.id)}
          onDelete={() => handleDeleteWorkflowMessage(message.id)}
        />
      );
    }

    // Workflow message continues using original card
    const workflowConfig = message.workflowConfig;
    const nodes = workflowConfig?.nodes || [];
    const connections = workflowConfig?.connections || [];
    
    // Get node type counts
    const nodeTypeCounts = nodes.reduce((acc, node) => {
      acc[node.type] = (acc[node.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return (
      <div className="w-full bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 rounded-xl p-5 border border-gray-200 dark:border-[#404040] shadow-lg">
        {/* Title bar and delete button */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-gray-900 dark:bg-gray-100">
              <WorkflowIcon className="w-5 h-5 text-white dark:text-[#1e1e1e]" />
            </div>
            <div>
              <div className="font-semibold text-base text-gray-900 dark:text-[#ffffff]">
                {message.workflowName || '工作流组件'}
              </div>
              <div className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-0.5">
                工作流组件
              </div>
            </div>
          </div>
          <button
            onClick={() => handleDeleteWorkflowMessage(message.id)}
            className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
            title="删除感知流程"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        
        {/* Workflow execution flow diagram - optimized design */}
        <div className="w-full bg-white dark:bg-[#2d2d2d] rounded-lg p-5 border-2 border-gray-200 dark:border-[#404040] mb-4 shadow-inner">
          <div className="flex items-center justify-between w-full">
            {/* Input node */}
            <div className="flex flex-col items-center flex-1">
              <div className="w-20 h-20 rounded-2xl bg-gray-900 dark:bg-gray-100 text-white dark:text-[#1e1e1e] flex items-center justify-center text-sm font-bold shadow-lg mb-3 transition-all">
                输入
              </div>
              <div className="text-xs text-gray-600 dark:text-[#b0b0b0] text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-[#2d2d2d] rounded">
                {(() => {
                  const messageIndex = messages.findIndex(m => m.id === message.id);
                  const prevMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;
                  return prevMessage?.content?.substring(0, 25) || '等待输入...';
                })()}
              </div>
            </div>
            
            {/* Arrow */}
            <ArrowRight className="w-10 h-10 text-gray-400 dark:text-[#b0b0b0] mx-3 flex-shrink-0" />
            
            {/* Workflow node */}
            <div className="flex flex-col items-center flex-1">
              <div className={`w-24 h-24 rounded-2xl ${
                message.workflowStatus === 'running' 
                  ? 'bg-gray-700 dark:bg-gray-300 animate-pulse shadow-xl' 
                  : message.workflowStatus === 'completed'
                  ? 'bg-gray-900 dark:bg-gray-100 shadow-xl'
                  : message.workflowStatus === 'error'
                  ? 'bg-gray-600 dark:bg-gray-500 shadow-lg'
                  : 'bg-gray-800 dark:bg-gray-200 shadow-lg'
              } text-white dark:text-[#1e1e1e] flex items-center justify-center text-xs font-bold text-center px-3 mb-3 transition-all`}>
                <div className="truncate">{message.workflowName || '工作流'}</div>
              </div>
              <div className={`text-xs font-medium px-2 py-1 rounded ${
                message.workflowStatus === 'pending' ? 'bg-gray-100 dark:bg-[#2d2d2d] text-gray-700 dark:text-[#ffffff]' :
                message.workflowStatus === 'running' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' :
                message.workflowStatus === 'completed' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
              }`}>
                {message.workflowStatus === 'pending' ? '待执行' :
                 message.workflowStatus === 'running' ? '执行中...' :
                 message.workflowStatus === 'completed' ? '已完成' :
                 message.workflowStatus === 'error' ? '执行失败' : '未知'}
              </div>
            </div>
            
            {/* Arrow */}
            <ArrowRight className="w-10 h-10 text-gray-400 dark:text-[#b0b0b0] mx-3 flex-shrink-0" />
            
            {/* Output node */}
            <div className="flex flex-col items-center flex-1">
              <div className={`w-20 h-20 rounded-2xl ${
                message.workflowStatus === 'completed' 
                  ? 'bg-gray-900 dark:bg-gray-100 shadow-xl' 
                  : message.workflowStatus === 'error'
                  ? 'bg-gray-600 dark:bg-gray-500 shadow-lg'
                  : 'bg-gray-300 dark:bg-[#363636] shadow-md'
              } text-white dark:text-[#1e1e1e] flex items-center justify-center text-sm font-bold mb-3 transition-all`}>
                输出
              </div>
              <div className="text-xs text-gray-600 dark:text-[#b0b0b0] text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-[#2d2d2d] rounded">
                {message.workflowStatus === 'completed' ? '已生成结果' :
                 message.workflowStatus === 'error' ? '执行失败' :
                 '等待输出...'}
              </div>
            </div>
          </div>
        </div>
        
        {/* Workflow internal details (node info) */}
        {message.toolType === 'workflow' && nodes.length > 0 && (
          <div className="w-full bg-gray-50 dark:bg-[#363636] rounded-lg p-3 border border-gray-200 dark:border-[#404040] mb-3">
            <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff] mb-2 uppercase tracking-wide">
              工作流内部结构
            </div>
            <div className="space-y-2">
              {/* Node type statistics */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(nodeTypeCounts).map(([type, count]) => (
                  <div
                    key={type}
                    className="px-2.5 py-1 bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#404040] rounded text-xs text-gray-700 dark:text-[#ffffff]"
                  >
                    <span className="font-medium">{type}:</span> {count}
                  </div>
                ))}
              </div>
              
              {/* Node list */}
              <div className="mt-3 space-y-1.5">
                <div className="text-xs font-medium text-gray-600 dark:text-[#b0b0b0] mb-1.5">
                  节点详情:
                </div>
                {nodes.map((node) => (
                  <div
                    key={node.id}
                    className="flex items-center space-x-2 px-2 py-1.5 bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] rounded text-xs"
                  >
                    <div className="w-2 h-2 rounded-full bg-gray-600 dark:bg-gray-400 flex-shrink-0"></div>
                    <span className="text-gray-700 dark:text-[#ffffff] font-medium">{node.type}</span>
                    {node.data.label && (
                      <span className="text-gray-500 dark:text-[#808080] truncate">- {node.data.label}</span>
                    )}
                  </div>
                ))}
              </div>
              
              {/* Connection info */}
              {connections.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium text-gray-600 dark:text-[#b0b0b0] mb-1.5">
                    连接关系: {connections.length} 条
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Execute button or execution result */}
        {message.workflowId ? (
          message.workflowStatus === 'pending' ? (
            <button
              onClick={() => handleExecuteWorkflow(message.id)}
              className="w-full bg-gray-900 dark:bg-gray-100 text-white dark:text-[#1e1e1e] hover:bg-gray-800 dark:hover:bg-gray-200 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm"
            >
              <Play className="w-4 h-4" />
              <span>开始执行</span>
            </button>
          ) : message.workflowStatus === 'running' ? (
            <div className="flex items-center justify-center space-x-2 text-gray-700 dark:text-[#ffffff] py-2.5">
              <Loader className="w-4 h-4 animate-spin" />
              <span className="text-sm font-medium">执行中...</span>
            </div>
          ) : message.workflowStatus === 'completed' || message.workflowStatus === 'error' ? (
            <div className="space-y-3">
              {/* Execution result */}
              <div className="bg-gray-50 dark:bg-[#363636] rounded-lg p-3 border border-gray-200 dark:border-[#404040]">
                <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff] mb-2 uppercase tracking-wide">
                  {message.workflowStatus === 'completed' ? '执行结果' : '执行失败'}
                </div>
                {(() => {
                  const content = message.content || '';
                  const logMatch = content.match(/执行日志:\s*\n(.*)/s);
                  const mainContent = logMatch ? content.substring(0, logMatch.index) : content;
                  const logs = logMatch ? logMatch[1].trim().split('\n') : [];
                  
                  return (
                    <div className="space-y-3">
                      {/* Main content */}
                      {mainContent && (
                        <div className="text-sm text-gray-900 dark:text-[#ffffff] whitespace-pre-wrap break-words">
                          {mainContent.trim()}
                        </div>
                      )}
                      
                      {/* Execution logs */}
                      {logs.length > 0 && (
                        <div className="border-t border-gray-200 dark:border-[#404040] pt-3 mt-3">
                          <div className="text-xs font-semibold text-gray-600 dark:text-[#b0b0b0] mb-2">
                            执行日志
                          </div>
                          <div className="bg-gray-900 dark:bg-gray-950 text-green-400 dark:text-green-300 font-mono text-xs p-3 rounded border border-gray-700 dark:border-[#404040] max-h-64 overflow-y-auto">
                            {logs.map((log, idx) => (
                              <div key={idx} className="mb-1">
                                {log}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              
              {/* Re-execute button */}
              <button
                onClick={() => handleExecuteWorkflow(message.id)}
                className="w-full bg-gray-800 dark:bg-gray-200 text-white dark:text-[#1e1e1e] hover:bg-gray-700 dark:hover:bg-gray-300 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm"
              >
                <Play className="w-4 h-4" />
                <span>重新执行</span>
              </button>
            </div>
          ) : null
        ) : (
          <div className="text-xs text-gray-500 dark:text-[#b0b0b0] text-center py-2">
            无法执行：缺少工作流信息
          </div>
        )}
      </div>
    );
  }
  
  // Tool message (not perception component) - check if content contains MCP media
  if (message.role === 'tool' && !message.toolType && message.content && !message.toolCalls) {
    const parsed = parseMCPContent(message.content);
    const hasMedia = parsed.media.length > 0;
    
    if (hasMedia) {
      return (
        <div>
          <div className="font-medium text-sm mb-2 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-green-500" />
            MCP 工具结果
          </div>
          {/* Render media content */}
          {renderMCPMediaForMessage(parsed.media, message.id)}
          {/* Render text content */}
          {parsed.texts.length > 0 && (
            <div className="mt-2 text-xs text-gray-600 dark:text-[#b0b0b0]">
              <pre className="bg-white dark:bg-[#2d2d2d] p-2 rounded border text-xs overflow-auto max-h-64">
                {parsed.texts.join('\n')}
              </pre>
            </div>
          )}
        </div>
      );
    }
  }
  
  // Regular tool call message (not perception component)
  if (message.role === 'tool' && message.toolCalls && !message.toolType) {
    return (
      <div>
        <div className="font-medium text-sm mb-2">工具调用:</div>
        {Array.isArray(message.toolCalls) && message.toolCalls.map((toolCall: any, idx: number) => {
          // Parse tool result as ordered blocks (supports multiple MCP returns)
          const blocks = toolCall.result ? parseMCPContentBlocks(toolCall.result) : [];
          
          return (
            <div key={idx} className="mb-3 p-3 bg-gray-50 dark:bg-[#363636] rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <Wrench className="w-4 h-4 text-primary-500" />
                <span className="font-medium text-sm">{toolCall.name}</span>
              </div>
              {toolCall.arguments && (
                <div className="text-xs text-gray-600 dark:text-[#b0b0b0] mb-2">
                  <span className="font-medium">参数:</span>
                  <pre className="mt-1 bg-white dark:bg-[#2d2d2d] p-2 rounded border text-xs overflow-auto max-h-32">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                </div>
              )}
              {toolCall.result && (
                <div className="text-xs text-gray-600 dark:text-[#b0b0b0]">
                  <span className="font-medium">结果:</span>
                  {blocks.length > 0 ? (
                    <div className="mt-1">{renderMCPBlocksForMessage(blocks, message.id)}</div>
                  ) : (
                    <pre className="mt-1 bg-white dark:bg-[#2d2d2d] p-2 rounded border text-xs overflow-auto max-h-64">
                      {truncateBase64Strings(JSON.stringify(toolCall.result, null, 2))}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const isThinkingCollapsed = collapsedThinking.has(message.id);
  const hasThinking = message.thinking && message.thinking.trim().length > 0;
  const isThinkingActive = message.isThinking && message.isStreaming;

  return (
    <div>
      {hasThinking && (
        <div className="mb-2">
          {isThinkingCollapsed ? (
            // Collapsed state: show small lightbulb button
            <button
              onClick={() => toggleThinkingCollapse(message.id)}
              className="flex items-center space-x-1 text-[10px] text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
              title="展开思考过程"
            >
              <Lightbulb className="w-3 h-3" />
              <span>思考过程</span>
            </button>
          ) : (
            // Expanded state: show thinking content
            <div className="mb-2">
              <button
                onClick={() => toggleThinkingCollapse(message.id)}
                className="flex items-center space-x-1 text-[10px] text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-gray-400 transition-colors mb-1"
                title="折叠思考过程"
              >
                <Lightbulb className="w-3 h-3" />
                <span>思考过程</span>
              </button>
              <div className="text-[11px] text-gray-400 dark:text-[#808080] font-mono leading-relaxed whitespace-pre-wrap break-words bg-transparent">
                {message.thinking}
                {isThinkingActive && (
                  <span className="inline-block ml-1 w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse"></span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {/* If thinking but no thinking content yet, show streaming thinking indicator */}
      {message.isThinking && !hasThinking && (
        <div className="mb-2 text-[10px] text-gray-400 dark:text-[#808080] flex items-center space-x-1">
          <Lightbulb className="w-3 h-3 animate-pulse" />
          <span>思考中...</span>
          <span className="inline-block w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse"></span>
        </div>
      )}
      {/* Multimodal content display */}
      {renderMedia()}
      
      {/* AI assistant messages use Markdown rendering */}
      {message.role === 'assistant' ? (
        <div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-[#ffffff] markdown-content text-xs">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Code block styling
              code: ({ node, inline, className, children, ...props }: any) => {
                const match = /language-(\w+)/.exec(className || '');
                const language = match ? match[1] : '';
                
                if (!inline && match) {
                  // Code block - use independent component to handle copy state
                  const codeText = String(children).replace(/\n$/, '');
                  const CodeBlock = () => {
                    const [copied, setCopied] = useState(false);
                    
                    return (
                      <div className="relative group my-3">
                        {/* Language label */}
                        {language && (
                          <div className="absolute top-2 left-2 text-xs text-gray-400 dark:text-[#808080] font-mono bg-gray-800/50 dark:bg-[#363636] px-2 py-0.5 rounded z-10">
                            {language}
                          </div>
                        )}
                        <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-4 pt-8 overflow-x-auto border border-gray-700 dark:border-[#404040]">
                          <code className={className} {...props}>
                            {children}
                          </code>
                        </pre>
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(codeText);
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            } catch (err) {
                              console.error('Failed to copy:', err);
                            }
                          }}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-xs flex items-center space-x-1 z-10"
                          title="复制代码"
                        >
                          {copied ? (
                            <>
                              <CheckCircle className="w-3 h-3" />
                              <span>已复制</span>
                            </>
                          ) : (
                            <>
                              <FileText className="w-3 h-3" />
                              <span>复制</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  };
                  
                  return <CodeBlock />;
                } else {
                  // Inline code
                  return (
                    <code className="bg-gray-100 dark:bg-[#2d2d2d] text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                      {children}
                    </code>
                  );
                }
              },
              // Paragraph styling
              p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
              // Heading styling
              h1: ({ children }: any) => <h1 className="text-2xl font-bold mt-4 mb-3 first:mt-0">{children}</h1>,
              h2: ({ children }: any) => <h2 className="text-xl font-bold mt-4 mb-3 first:mt-0">{children}</h2>,
              h3: ({ children }: any) => <h3 className="text-lg font-bold mt-3 mb-2 first:mt-0">{children}</h3>,
              // List styling
              ul: ({ children }: any) => <ul className="list-disc list-inside mb-3 space-y-1 ml-4">{children}</ul>,
              ol: ({ children }: any) => <ol className="list-decimal list-inside mb-3 space-y-1 ml-4">{children}</ol>,
              li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
              // Blockquote styling
              blockquote: ({ children }: any) => (
                <blockquote className="border-l-4 border-primary-500 dark:border-primary-400 pl-4 my-3 italic text-gray-700 dark:text-[#ffffff]">
                  {children}
                </blockquote>
              ),
              // Link styling
              a: ({ href, children }: any) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 dark:text-primary-400 hover:underline"
                >
                  {children}
                </a>
              ),
              // Table styling
              table: ({ children }: any) => (
                <div className="overflow-x-auto my-3">
                  <table className="min-w-full border-collapse border border-gray-300 dark:border-[#404040]">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }: any) => (
                <thead className="bg-gray-100 dark:bg-[#2d2d2d]">{children}</thead>
              ),
              tbody: ({ children }: any) => <tbody>{children}</tbody>,
              tr: ({ children }: any) => (
                <tr className="border-b border-gray-200 dark:border-[#404040]">{children}</tr>
              ),
              th: ({ children }: any) => (
                <th className="border border-gray-300 dark:border-[#404040] px-3 py-2 text-left font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }: any) => (
                <td className="border border-gray-300 dark:border-[#404040] px-3 py-2">
                  {children}
                </td>
              ),
              // Horizontal rule
              hr: () => <hr className="my-4 border-gray-300 dark:border-[#404040]" />,
              // Emphasis styling
              strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
              em: ({ children }: any) => <em className="italic">{children}</em>,
              // Image styling - use independent component to handle state
              img: ({ src, alt, ...props }: any) => {
                // If no src, don't render
                if (!src) return null;
                
                // Helper function: detect if it's base64 data
                const looksLikeBase64Payload = (s: string): boolean => {
                  if (!s) return false;
                  const trimmed = s.trim();
                  // Already a data URL
                  if (trimmed.startsWith('data:')) return true;
                  // Too short, avoid misjudging normal paths
                  if (trimmed.length < 256) return false;
                  // Base64 charset (allowing padding)
                  return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed);
                };
                
                // Helper function: infer image MIME type
                const inferImageMime = (payload: string): string => {
                  const base64 = payload.startsWith('data:') ? payload.slice(payload.indexOf(',') + 1) : payload.trim();
                  if (base64.startsWith('iVBORw')) return 'image/png';
                  if (base64.startsWith('/9j/') || base64.startsWith('9j/')) return 'image/jpeg';
                  if (base64.startsWith('R0lGOD')) return 'image/gif';
                  if (base64.startsWith('UklGR')) return 'image/webp';
                  return 'image/jpeg'; // Default JPEG
                };
                
                // Process image URL
                let imageSrc = src;
                
                // 1. Already a complete URL (http/https/data/blob/file), use directly
                if (/^(https?:|data:|blob:|file:)/i.test(src)) {
                  imageSrc = src;
                }
                // 2. Detect if it's base64 data (including JPEG base64 starting with /9j/)
                else if (looksLikeBase64Payload(src)) {
                  const mime = inferImageMime(src);
                  imageSrc = `data:${mime};base64,${src.trim()}`;
                }
                // 3. Backend relative path (starting with / but not //)
                else if (src.startsWith('/') && !src.startsWith('//')) {
                  const backendUrl = (window as any).__cachedBackendUrl || 'http://localhost:3002';
                  imageSrc = `${backendUrl}${src}`;
                }
                
                // Use independent component to manage state
                const MarkdownImage = () => {
                  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
                  
                  return (
                    <span className="block my-3">
                      {/* Loading state */}
                      {status === 'loading' && (
                        <div className="flex items-center justify-center bg-gray-100 dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040] p-4 text-gray-500 dark:text-gray-400 text-sm" style={{ minHeight: '100px' }}>
                          <div className="text-center">
                            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                            <div>加载中...</div>
                          </div>
                        </div>
                      )}
                      
                      {/* Load failed state */}
                      {status === 'error' && (
                        <div className="flex items-center justify-center bg-gray-100 dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040] p-4 text-gray-500 dark:text-gray-400 text-sm" style={{ minHeight: '100px' }}>
                          <div className="text-center">
                            <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <div className="mb-1">图片加载失败</div>
                            <div className="text-xs text-gray-400 mb-2">{alt || '未知图片'}</div>
                            <a 
                              href={imageSrc} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-xs text-primary-500 hover:underline"
                            >
                              查看原链接
                            </a>
                          </div>
                        </div>
                      )}
                      
                      {/* Image - hidden until loaded */}
                      <img
                        src={imageSrc}
                        alt={alt || '图片'}
                        loading="lazy"
                        className={`max-w-full h-auto rounded-lg border border-gray-200 dark:border-[#404040] cursor-pointer hover:opacity-90 transition-opacity ${status !== 'loaded' ? 'hidden' : ''}`}
                        style={{ maxHeight: '400px', objectFit: 'contain' }}
                        onLoad={() => setStatus('loaded')}
                        onError={() => setStatus('error')}
                        onClick={() => {
                          // Click image to preview in new window
                          const win = window.open('', '_blank');
                          if (win) {
                            win.document.write(`
                              <html>
                                <head><title>${alt || '图片预览'}</title></head>
                                <body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#000">
                                  <img src="${imageSrc}" style="max-width:100%;max-height:100vh;object-fit:contain;" alt="${alt || '图片'}" />
                                </body>
                              </html>
                            `);
                          }
                        }}
                        {...props}
                      />
                    </span>
                  );
                };
                
                return <MarkdownImage />;
              },
            }}
          >
            {truncateBase64Strings(message.content)}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words text-gray-900 dark:text-[#ffffff]">
          {truncateBase64Strings(message.content)}
        </div>
      )}
    </div>
  );
};

export default MessageContent;
