/**
 * Workflow 组件相关的类型定义
 */

import type { WorkflowNode, WorkflowConnection } from '../../services/workflowApi';

/** 单个过程步骤（用于记录多轮思考和MCP调用） */
export interface ProcessStep {
  /** 步骤类型 */
  type: 'thinking' | 'mcp_call' | 'workflow';
  /** 时间戳 */
  timestamp?: number;
  /** 思考内容（当 type === 'thinking' 时） */
  thinking?: string;
  /** MCP 服务器名称（当 type === 'mcp_call' 时） */
  mcpServer?: string;
  /** 工具名称（当 type === 'mcp_call' 时） */
  toolName?: string;
  /** 调用参数 */
  arguments?: any;
  /** 调用结果 */
  result?: any;
  /** 执行状态 */
  status?: 'pending' | 'running' | 'completed' | 'error';
  /** 执行时长（毫秒） */
  duration?: number;
  /** 工作流信息（当 type === 'workflow' 时） */
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
  /** 多轮过程步骤（保存完整的思考和MCP调用历史） */
  processSteps?: ProcessStep[];
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
