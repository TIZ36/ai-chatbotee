/**
 * WorkflowPool - 工作流池
 * 管理工作流定义和执行
 */

import type { WorkflowDefinition, WorkflowExecution, ExecutorConfig } from './types';
import { WorkflowExecutor } from './WorkflowExecutor';
import { createLogger, generateId } from '../core/shared/utils';

const logger = createLogger('WorkflowPool');

/**
 * 工作流池
 */
export class WorkflowPool {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executor: WorkflowExecutor;

  constructor(executorConfig?: Partial<ExecutorConfig>) {
    this.executor = new WorkflowExecutor(executorConfig);
  }

  // ============================================================================
  // Workflow Management
  // ============================================================================

  /**
   * 注册工作流
   */
  register(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
    logger.info('Workflow registered', { id: workflow.id, name: workflow.name });
  }

  /**
   * 取消注册
   */
  unregister(workflowId: string): boolean {
    const deleted = this.workflows.delete(workflowId);
    if (deleted) {
      logger.info('Workflow unregistered', { id: workflowId });
    }
    return deleted;
  }

  /**
   * 获取工作流
   */
  get(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * 获取所有工作流
   */
  getAll(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * 查找工作流
   */
  find(predicate: (wf: WorkflowDefinition) => boolean): WorkflowDefinition[] {
    return this.getAll().filter(predicate);
  }

  /**
   * 更新工作流
   */
  update(workflowId: string, updates: Partial<WorkflowDefinition>): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    const updated = {
      ...workflow,
      ...updates,
      id: workflow.id, // 保持 ID 不变
      version: workflow.version + 1,
      updatedAt: Date.now(),
    };

    this.workflows.set(workflowId, updated);
    logger.info('Workflow updated', { id: workflowId, version: updated.version });
    return true;
  }

  // ============================================================================
  // Execution
  // ============================================================================

  /**
   * 执行工作流
   */
  async execute(
    workflowId: string,
    inputs: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    return this.executor.execute(workflow, inputs, signal);
  }

  /**
   * 执行匿名工作流（不注册）
   */
  async executeAnonymous(
    workflow: WorkflowDefinition,
    inputs: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<WorkflowExecution> {
    return this.executor.execute(workflow, inputs, signal);
  }

  /**
   * 取消执行
   */
  cancelExecution(executionId: string): boolean {
    return this.executor.cancel(executionId);
  }

  /**
   * 获取执行状态
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executor.getExecution(executionId);
  }

  // ============================================================================
  // Import/Export
  // ============================================================================

  /**
   * 导出工作流
   */
  export(workflowId: string): string | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return null;
    return JSON.stringify(workflow, null, 2);
  }

  /**
   * 导入工作流
   */
  import(json: string, overwrite: boolean = false): WorkflowDefinition {
    const workflow: WorkflowDefinition = JSON.parse(json);

    // 如果不覆盖且已存在，生成新 ID
    if (!overwrite && this.workflows.has(workflow.id)) {
      workflow.id = generateId('wf');
    }

    this.register(workflow);
    return workflow;
  }

  /**
   * 导出所有工作流
   */
  exportAll(): string {
    const workflows = this.getAll();
    return JSON.stringify(workflows, null, 2);
  }

  /**
   * 导入多个工作流
   */
  importAll(json: string, overwrite: boolean = false): WorkflowDefinition[] {
    const workflows: WorkflowDefinition[] = JSON.parse(json);
    return workflows.map((wf) => {
      const wfJson = JSON.stringify(wf);
      return this.import(wfJson, overwrite);
    });
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * 获取统计信息
   */
  getStats(): {
    totalWorkflows: number;
    activeWorkflows: number;
    draftWorkflows: number;
  } {
    const all = this.getAll();
    return {
      totalWorkflows: all.length,
      activeWorkflows: all.filter((w) => w.status === 'active').length,
      draftWorkflows: all.filter((w) => w.status === 'draft').length,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let poolInstance: WorkflowPool | null = null;

/**
 * 获取工作流池单例
 */
export function getWorkflowPool(config?: Partial<ExecutorConfig>): WorkflowPool {
  if (!poolInstance) {
    poolInstance = new WorkflowPool(config);
  }
  return poolInstance;
}
