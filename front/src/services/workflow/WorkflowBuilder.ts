/**
 * WorkflowBuilder - 工作流构建器
 * 提供流畅的 API 构建工作流定义
 */

import type {
  WorkflowDefinition,
  NodeDefinition,
  WorkflowEdge,
  NodeType,
} from './types';
import { generateId } from '../core/shared/utils';

/**
 * 工作流构建器
 */
export class WorkflowBuilder {
  private definition: WorkflowDefinition;
  private lastNodeId?: string;

  constructor(name: string, description?: string) {
    this.definition = {
      id: generateId('wf'),
      name,
      description,
      version: 1,
      status: 'draft',
      nodes: [],
      edges: [],
      variables: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * 设置变量
   */
  setVariables(variables: Record<string, unknown>): this {
    this.definition.variables = { ...this.definition.variables, ...variables };
    return this;
  }

  /**
   * 添加起始节点
   */
  start(name: string = 'Start'): this {
    return this.addNode('start', name, {});
  }

  /**
   * 添加结束节点
   */
  end(name: string = 'End'): this {
    return this.addNode('end', name, {});
  }

  /**
   * 添加 LLM 节点
   */
  llm(
    name: string,
    config: {
      provider: string;
      model: string;
      userPrompt: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): this {
    return this.addNode('llm', name, config);
  }

  /**
   * 添加 MCP 节点
   */
  mcp(
    name: string,
    config: {
      serverId: string;
      toolName: string;
      arguments: Record<string, unknown>;
      timeout?: number;
    }
  ): this {
    return this.addNode('mcp', name, config);
  }

  /**
   * 添加条件节点
   */
  condition(
    name: string,
    config: {
      expression: string;
      trueOutput?: string;
      falseOutput?: string;
    }
  ): this {
    return this.addNode('condition', name, config);
  }

  /**
   * 添加通用节点
   */
  addNode(
    type: NodeType,
    name: string,
    config: Record<string, unknown>,
    id?: string
  ): this {
    const nodeId = id || generateId('node');
    
    const node: NodeDefinition = {
      id: nodeId,
      type,
      name,
      config,
    };

    this.definition.nodes.push(node);

    // 自动连接到上一个节点
    if (this.lastNodeId) {
      this.connect(this.lastNodeId, nodeId);
    }

    this.lastNodeId = nodeId;
    return this;
  }

  /**
   * 连接两个节点
   */
  connect(sourceId: string, targetId: string, condition?: string): this {
    const edge: WorkflowEdge = {
      id: generateId('edge'),
      source: sourceId,
      target: targetId,
      condition,
    };

    this.definition.edges.push(edge);
    return this;
  }

  /**
   * 从指定节点继续
   */
  from(nodeId: string): this {
    this.lastNodeId = nodeId;
    return this;
  }

  /**
   * 连接到指定节点
   */
  to(nodeId: string, condition?: string): this {
    if (this.lastNodeId) {
      this.connect(this.lastNodeId, nodeId, condition);
    }
    return this;
  }

  /**
   * 分支（条件连接）
   */
  branch(
    branches: Array<{
      condition?: string;
      builder: (b: WorkflowBuilder) => void;
    }>
  ): this {
    const branchStartId = this.lastNodeId;
    if (!branchStartId) return this;

    for (const branch of branches) {
      this.lastNodeId = branchStartId;
      
      // 创建分支的子构建器
      const subBuilder = new WorkflowBuilder('sub', '');
      branch.builder(subBuilder);

      // 合并节点
      for (const node of subBuilder.definition.nodes) {
        this.definition.nodes.push(node);
      }

      // 合并边，并添加分支条件
      for (const edge of subBuilder.definition.edges) {
        this.definition.edges.push(edge);
      }

      // 连接分支起点
      const firstSubNode = subBuilder.definition.nodes[0];
      if (firstSubNode) {
        this.connect(branchStartId, firstSubNode.id, branch.condition);
      }
    }

    return this;
  }

  /**
   * 并行执行
   */
  parallel(
    nodes: Array<{
      name: string;
      type: NodeType;
      config: Record<string, unknown>;
    }>
  ): this {
    const parallelStartId = this.lastNodeId;
    const nodeIds: string[] = [];

    for (const nodeConfig of nodes) {
      const nodeId = generateId('node');
      nodeIds.push(nodeId);

      const node: NodeDefinition = {
        id: nodeId,
        type: nodeConfig.type,
        name: nodeConfig.name,
        config: nodeConfig.config,
      };

      this.definition.nodes.push(node);

      if (parallelStartId) {
        this.connect(parallelStartId, nodeId);
      }
    }

    // 创建汇聚点
    const joinId = generateId('node');
    const joinNode: NodeDefinition = {
      id: joinId,
      type: 'script',
      name: 'Join',
      config: { script: 'return inputs;' },
    };

    this.definition.nodes.push(joinNode);

    for (const nodeId of nodeIds) {
      this.connect(nodeId, joinId);
    }

    this.lastNodeId = joinId;
    return this;
  }

  /**
   * 构建工作流定义
   */
  build(): WorkflowDefinition {
    this.definition.updatedAt = Date.now();
    return { ...this.definition };
  }

  /**
   * 获取当前节点 ID
   */
  getCurrentNodeId(): string | undefined {
    return this.lastNodeId;
  }

  /**
   * 获取节点
   */
  getNode(nodeId: string): NodeDefinition | undefined {
    return this.definition.nodes.find((n) => n.id === nodeId);
  }
}

/**
 * 创建工作流构建器
 */
export function createWorkflow(name: string, description?: string): WorkflowBuilder {
  return new WorkflowBuilder(name, description);
}
