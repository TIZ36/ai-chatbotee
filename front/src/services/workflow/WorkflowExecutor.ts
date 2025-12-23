/**
 * WorkflowExecutor - 工作流 DAG 执行引擎
 */

import type {
  WorkflowDefinition,
  WorkflowExecution,
  NodeDefinition,
  NodeContext,
  NodeResult,
  NodeState,
  ExecutorConfig,
  ExecutionStatus,
  NodeStatus,
} from './types';
import { DEFAULT_EXECUTOR_CONFIG } from './types';
import { BaseNode, LLMNode, MCPNode, ConditionNode } from './nodes';
import { WorkflowError, WorkflowErrorCode } from '../core/shared/errors';
import { createLogger, generateId, sleep } from '../core/shared/utils';
import { eventBus } from '../core/shared/events';

const logger = createLogger('WorkflowExecutor');

// 节点类型映射
const NODE_TYPES: Record<string, new (def: NodeDefinition) => BaseNode> = {
  llm: LLMNode,
  mcp: MCPNode,
  condition: ConditionNode,
};

/**
 * 工作流执行器
 */
export class WorkflowExecutor {
  private config: ExecutorConfig;
  private executions: Map<string, WorkflowExecution> = new Map();

  constructor(config?: Partial<ExecutorConfig>) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  /**
   * 执行工作流
   */
  async execute(
    workflow: WorkflowDefinition,
    inputs: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<WorkflowExecution> {
    // 创建执行实例
    const execution: WorkflowExecution = {
      id: generateId('exec'),
      workflowId: workflow.id,
      status: 'running',
      variables: { ...workflow.variables, ...inputs },
      nodeStates: new Map(),
      startedAt: Date.now(),
    };

    this.executions.set(execution.id, execution);

    // 初始化节点状态
    for (const node of workflow.nodes) {
      execution.nodeStates.set(node.id, {
        nodeId: node.id,
        status: 'pending',
        retryCount: 0,
      });
    }

    eventBus.emit('workflow:start', {
      workflowId: workflow.id,
      name: workflow.name,
    });

    try {
      // 验证工作流
      this.validateWorkflow(workflow);

      // 执行 DAG
      await this.executeDAG(workflow, execution, signal);

      execution.status = 'completed';
      execution.completedAt = Date.now();

      eventBus.emit('workflow:end', {
        workflowId: workflow.id,
        duration: execution.completedAt - execution.startedAt,
      });
    } catch (error) {
      execution.status = 'failed';
      execution.error = error as Error;
      execution.completedAt = Date.now();

      eventBus.emit('workflow:error', {
        workflowId: workflow.id,
        error: error as Error,
      });

      throw error;
    }

    return execution;
  }

  /**
   * 取消执行
   */
  cancel(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'running') {
      return false;
    }

    execution.status = 'cancelled';
    execution.completedAt = Date.now();
    return true;
  }

  /**
   * 获取执行状态
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 验证工作流
   */
  private validateWorkflow(workflow: WorkflowDefinition): void {
    // 检查起始节点
    const startNodes = workflow.nodes.filter((n) => n.type === 'start');
    if (startNodes.length === 0 && workflow.nodes.length > 0) {
      // 如果没有 start 节点，使用没有输入的节点作为起点
      const noInputNodes = workflow.nodes.filter(
        (n) => !workflow.edges.some((e) => e.target === n.id)
      );
      if (noInputNodes.length === 0) {
        throw new WorkflowError('No start node found', {
          code: WorkflowErrorCode.INVALID_DEFINITION,
          workflowId: workflow.id,
        });
      }
    }

    // 检查循环
    if (this.hasCycle(workflow)) {
      throw new WorkflowError('Workflow contains cycle', {
        code: WorkflowErrorCode.CYCLE_DETECTED,
        workflowId: workflow.id,
      });
    }
  }

  /**
   * 检测循环
   */
  private hasCycle(workflow: WorkflowDefinition): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (recStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recStack.add(nodeId);

      const outEdges = workflow.edges.filter((e) => e.source === nodeId);
      for (const edge of outEdges) {
        if (dfs(edge.target)) return true;
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const node of workflow.nodes) {
      if (dfs(node.id)) return true;
    }

    return false;
  }

  /**
   * 执行 DAG
   */
  private async executeDAG(
    workflow: WorkflowDefinition,
    execution: WorkflowExecution,
    signal?: AbortSignal
  ): Promise<void> {
    // 构建依赖图
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of workflow.nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    for (const edge of workflow.edges) {
      const current = inDegree.get(edge.target) || 0;
      inDegree.set(edge.target, current + 1);
      adjacency.get(edge.source)?.push(edge.target);
    }

    // 找出入度为 0 的节点
    const readyQueue: string[] = [];
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) {
        readyQueue.push(nodeId);
      }
    });

    // 并发执行
    const running = new Set<Promise<void>>();

    while (readyQueue.length > 0 || running.size > 0) {
      // 检查取消
      if (signal?.aborted || execution.status === 'cancelled') {
        throw new WorkflowError('Workflow cancelled', {
          code: WorkflowErrorCode.CANCELLED,
          workflowId: workflow.id,
        });
      }

      // 启动新节点（在并发限制内）
      while (
        readyQueue.length > 0 &&
        running.size < this.config.maxConcurrentNodes
      ) {
        const nodeId = readyQueue.shift()!;
        const nodeDef = workflow.nodes.find((n) => n.id === nodeId);
        
        if (!nodeDef) continue;

        // 跳过 start/end 节点
        if (nodeDef.type === 'start' || nodeDef.type === 'end') {
          const state = execution.nodeStates.get(nodeId);
          if (state) {
            state.status = 'completed';
          }
          
          // 减少后继节点入度
          for (const nextId of adjacency.get(nodeId) || []) {
            const deg = (inDegree.get(nextId) || 1) - 1;
            inDegree.set(nextId, deg);
            if (deg === 0) {
              readyQueue.push(nextId);
            }
          }
          continue;
        }

        // 执行节点
        const promise = this.executeNode(
          nodeDef,
          execution,
          workflow,
          signal
        ).then(() => {
          // 减少后继节点入度
          for (const nextId of adjacency.get(nodeId) || []) {
            const deg = (inDegree.get(nextId) || 1) - 1;
            inDegree.set(nextId, deg);
            if (deg === 0) {
              readyQueue.push(nextId);
            }
          }
        });

        running.add(promise);
        promise.finally(() => running.delete(promise));
      }

      // 等待任一完成
      if (running.size > 0) {
        await Promise.race(running);
      }
    }
  }

  /**
   * 执行单个节点
   */
  private async executeNode(
    nodeDef: NodeDefinition,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    signal?: AbortSignal
  ): Promise<void> {
    const state = execution.nodeStates.get(nodeDef.id);
    if (!state) return;

    state.status = 'running';
    state.startedAt = Date.now();

    eventBus.emit('workflow:node_start', {
      workflowId: workflow.id,
      nodeId: nodeDef.id,
      nodeType: nodeDef.type,
    });

    // 创建节点实例
    const NodeClass = NODE_TYPES[nodeDef.type];
    if (!NodeClass) {
      state.status = 'failed';
      state.result = {
        success: false,
        outputs: {},
        error: new Error(`Unknown node type: ${nodeDef.type}`),
        duration: 0,
      };
      return;
    }

    const node = new NodeClass(nodeDef);

    // 收集输入
    const inputs: Record<string, unknown> = {};
    for (const edge of workflow.edges.filter((e) => e.target === nodeDef.id)) {
      const sourceState = execution.nodeStates.get(edge.source);
      if (sourceState?.result?.outputs) {
        Object.assign(inputs, sourceState.result.outputs);
      }
    }

    // 创建上下文
    const context: NodeContext = {
      workflowId: workflow.id,
      executionId: execution.id,
      nodeId: nodeDef.id,
      inputs,
      variables: execution.variables,
      signal,
    };

    // 执行（带重试）
    let result: NodeResult | undefined;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        result = await Promise.race([
          node.execute(context),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Node timeout')),
              this.config.nodeTimeout
            )
          ),
        ]);

        if (result.success) break;
        lastError = result.error;
      } catch (error) {
        lastError = error as Error;
      }

      if (attempt < this.config.maxRetries) {
        state.retryCount = attempt + 1;
        eventBus.emit('workflow:node_start', {
          workflowId: workflow.id,
          nodeId: nodeDef.id,
          nodeType: nodeDef.type,
        });
        await sleep(this.config.retryDelay * Math.pow(2, attempt));
      }
    }

    // 更新状态
    state.completedAt = Date.now();
    if (result?.success) {
      state.status = 'completed';
      state.result = result;

      // 更新全局变量
      Object.assign(execution.variables, result.outputs);
    } else {
      state.status = 'failed';
      state.result = result || {
        success: false,
        outputs: {},
        error: lastError,
        duration: Date.now() - (state.startedAt || Date.now()),
      };

      throw new WorkflowError(`Node ${nodeDef.name} failed`, {
        code: WorkflowErrorCode.NODE_FAILED,
        workflowId: workflow.id,
        nodeId: nodeDef.id,
        cause: lastError,
      });
    }

    eventBus.emit('workflow:node_end', {
      workflowId: workflow.id,
      nodeId: nodeDef.id,
      nodeType: nodeDef.type,
      duration: state.completedAt - (state.startedAt || state.completedAt),
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let executorInstance: WorkflowExecutor | null = null;

/**
 * 获取执行器单例
 */
export function getWorkflowExecutor(config?: Partial<ExecutorConfig>): WorkflowExecutor {
  if (!executorInstance) {
    executorInstance = new WorkflowExecutor(config);
  }
  return executorInstance;
}
