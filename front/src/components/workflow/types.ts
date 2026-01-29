/**
 * Workflow 组件相关的类型定义
 */

import type { WorkflowNode, WorkflowConnection } from '../../services/workflowApi';

/** 多模态附件 */
export interface MultimodalAttachment {
  id: string;
  type: 'image' | 'audio' | 'video' | 'file';
  name: string;
  mimeType: string;
  /** base64 数据或 URL */
  data: string;
  size?: number;
}

/** 可执行组件 */
export interface ExecutableComponent {
  id: string;
  type: 'plugin' | 'workflow' | 'batch' | 'mcp_call';
  name: string;
  config: any;
  status?: 'idle' | 'running' | 'completed' | 'error';
  result?: any;
}

/** 消息内的 MCP 详情 */
export interface MCPDetail {
  mcpServer?: string;
  toolName?: string;
  arguments?: any;
  result?: any;
  status?: string;
  duration?: number;
}

/** 扩展的消息类型 */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  isThinking?: boolean;
  thinkingContent?: string;
  components?: ExecutableComponent[];
  isEditing?: boolean;
  editedContent?: string;
  isResending?: boolean;
  quotedMessage?: { id: string; content: string };
  status?: 'sending' | 'sent' | 'error';
  errorMessage?: string;
  /** 多模态附件 */
  multimodal?: MultimodalAttachment[];
  /** MCP 工具调用详情 */
  mcpDetails?: MCPDetail[];
}

/** Workflow 组件的 Props */
export interface WorkflowProps {
  sessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
}

/** 删除目标信息 */
export interface DeleteTarget {
  id: string;
  name: string;
}
