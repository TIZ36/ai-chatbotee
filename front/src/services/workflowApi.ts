/**
 * 工作流配置 API 服务
 */

import { getBackendUrl } from '../utils/backendUrl';

export interface WorkflowConfig {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

export interface WorkflowNode {
  id: string;
  type: 'llm' | 'input' | 'output' | 'workflow' | 'terminal' | 'visualization';
  position: { x: number; y: number };
  data: {
    llmConfigId?: string;
    mcpServerId?: string;  // MCP服务器配置在LLM节点中
    label?: string;
    inputValue?: string;  // 输入节点的内容
    workflowId?: string;  // 工作流节点的子工作流ID
    terminalType?: string;  // 命令行节点类型，如 'cursor-agent'
    visualizationType?: 'json-object' | 'json-array' | 'weblink'; // 可视化类型
  };
}

export interface WorkflowConnection {
  id: string;
  source: string;  // 源节点ID
  target: string;  // 目标节点ID
  sourceHandle?: string;
  targetHandle?: string;
}

export interface Workflow {
  id: string;
  workflow_id: string;
  name: string;
  description?: string;
  config: WorkflowConfig;
  created_at?: string;
  updated_at?: string;
}

/**
 * 获取所有工作流配置
 */
export async function getWorkflows(): Promise<Workflow[]> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/workflows`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.workflows || [];
}

/**
 * 创建工作流配置
 */
export async function createWorkflow(workflow: Partial<Workflow>): Promise<{ workflow_id: string }> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(workflow),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 获取单个工作流配置
 */
export async function getWorkflow(workflowId: string): Promise<Workflow> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/workflows/${workflowId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 更新工作流配置
 */
export async function updateWorkflow(workflowId: string, workflow: Partial<Workflow>): Promise<{ workflow_id: string }> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/workflows/${workflowId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(workflow),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 删除工作流配置
 */
export async function deleteWorkflow(workflowId: string): Promise<void> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/workflows/${workflowId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }
}

/**
 * 执行工作流
 */
export async function executeWorkflow(workflowId: string, input: string): Promise<any> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/workflows/${workflowId}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

