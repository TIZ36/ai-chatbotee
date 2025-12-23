/**
 * Workflow 池化管理器
 * 实现 @workflow 时的自动初始化，全局共享，使用完后放回池中
 * 
 * @deprecated 此文件将在未来版本中废弃
 * 请使用新的分层架构:
 * - import { WorkflowPool, WorkflowBuilder, WorkflowExecutor } from './services/workflow'
 * 
 * 新架构提供更强大的 DAG 执行引擎、条件分支和并行执行能力
 */

import { Workflow as WorkflowType } from './workflowApi';
import { getWorkflow } from './workflowApi';
import { mcpManager, MCPServer } from './mcpClient';
import { getMCPServers, MCPServerConfig } from './mcpApi';

export interface WorkflowInstance {
  workflowId: string;
  workflow: WorkflowType;
  mcpClients: Map<string, any>; // MCP客户端映射 (serverId -> MCPClient)
  initializedAt: number;
  lastUsedAt: number;
  inUse: boolean;
}

class WorkflowPool {
  private instances = new Map<string, WorkflowInstance>();
  private maxPoolSize = 10; // 最大池大小
  private maxIdleTime = 30 * 60 * 1000; // 最大空闲时间（30分钟）

  /**
   * 从池中获取或创建workflow实例
   * @param workflowId workflow ID
   * @returns workflow实例
   */
  async acquireWorkflow(workflowId: string): Promise<WorkflowInstance> {
    // 先检查池中是否有空闲实例
    const pooledInstance = this.getFromPool(workflowId);
    if (pooledInstance) {
      console.log(`[WorkflowPool] Using pooled instance for workflow: ${workflowId}`);
      pooledInstance.inUse = true;
      pooledInstance.lastUsedAt = Date.now();
      return pooledInstance;
    }

    // 池中没有，创建新实例
    console.log(`[WorkflowPool] Creating new instance for workflow: ${workflowId}`);
    const instance = await this.createInstance(workflowId);
    
    // 如果池已满，清理最旧的实例
    if (this.instances.size >= this.maxPoolSize) {
      this.cleanupOldest();
    }
    
    this.instances.set(workflowId, instance);
    return instance;
  }

  /**
   * 将workflow实例放回池中
   * @param workflowId workflow ID
   */
  returnToPool(workflowId: string): void {
    const instance = this.instances.get(workflowId);
    if (instance) {
      instance.inUse = false;
      instance.lastUsedAt = Date.now();
      console.log(`[WorkflowPool] Returned workflow instance to pool: ${workflowId}`);
    }
  }

  /**
   * 从池中获取空闲实例
   */
  private getFromPool(workflowId: string): WorkflowInstance | null {
    const instance = this.instances.get(workflowId);
    if (instance && !instance.inUse) {
      // 检查是否过期
      const idleTime = Date.now() - instance.lastUsedAt;
      if (idleTime > this.maxIdleTime) {
        console.log(`[WorkflowPool] Instance expired, removing: ${workflowId}`);
        this.removeInstance(workflowId);
        return null;
      }
      return instance;
    }
    return null;
  }

  /**
   * 创建新的workflow实例
   */
  private async createInstance(workflowId: string): Promise<WorkflowInstance> {
    // 获取workflow配置
    const workflow = await getWorkflow(workflowId);
    
    // 获取所有MCP服务器配置
    const mcpServers = await getMCPServers();
    
    // 初始化workflow中使用的MCP客户端
    const mcpClients = new Map<string, any>();
    
    // 查找workflow中使用的MCP服务器
    const nodes = workflow.config?.nodes || [];
    const usedMcpServerIds = new Set<string>();
    
    for (const node of nodes) {
      if (node.type === 'llm' && node.data?.mcpServerId) {
        usedMcpServerIds.add(node.data.mcpServerId);
      }
    }
    
    // 为每个使用的MCP服务器创建连接
    for (const serverId of usedMcpServerIds) {
      const serverConfig = mcpServers.find(s => s.id === serverId);
      if (serverConfig && serverConfig.enabled) {
        try {
          const mcpServer: MCPServer = {
            id: serverConfig.id,
            name: serverConfig.name,
            url: serverConfig.url,
            type: serverConfig.type as 'http-stream' | 'http-post' | 'stdio',
            enabled: serverConfig.enabled,
            description: serverConfig.description,
            metadata: serverConfig.metadata,
            ext: serverConfig.ext,
          };
          
          // 使用MCPManager获取连接（它已经有池化管理）
          const mcpClient = await mcpManager.acquireConnection(mcpServer);
          mcpClients.set(serverId, mcpClient);
          console.log(`[WorkflowPool] Initialized MCP client for server: ${serverConfig.name}`);
        } catch (error) {
          console.error(`[WorkflowPool] Failed to initialize MCP client for ${serverConfig.name}:`, error);
        }
      }
    }
    
    const instance: WorkflowInstance = {
      workflowId,
      workflow,
      mcpClients,
      initializedAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true,
    };
    
    console.log(`[WorkflowPool] Created workflow instance: ${workflowId} with ${mcpClients.size} MCP clients`);
    return instance;
  }

  /**
   * 清理最旧的实例
   */
  private cleanupOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    
    for (const [id, instance] of this.instances.entries()) {
      if (!instance.inUse && instance.lastUsedAt < oldestTime) {
        oldestTime = instance.lastUsedAt;
        oldestId = id;
      }
    }
    
    if (oldestId) {
      console.log(`[WorkflowPool] Cleaning up oldest instance: ${oldestId}`);
      this.removeInstance(oldestId);
    }
  }

  /**
   * 移除实例并清理资源
   */
  private removeInstance(workflowId: string): void {
    const instance = this.instances.get(workflowId);
    if (instance) {
      // 归还MCP客户端到池中
      for (const [serverId, mcpClient] of instance.mcpClients.entries()) {
        try {
          mcpManager.returnToPool(mcpClient, serverId);
        } catch (error) {
          console.error(`[WorkflowPool] Error returning MCP client:`, error);
        }
      }
      
      this.instances.delete(workflowId);
      console.log(`[WorkflowPool] Removed instance: ${workflowId}`);
    }
  }

  /**
   * 清理所有过期实例
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [id, instance] of this.instances.entries()) {
      if (!instance.inUse) {
        const idleTime = now - instance.lastUsedAt;
        if (idleTime > this.maxIdleTime) {
          console.log(`[WorkflowPool] Cleaning up expired instance: ${id}`);
          this.removeInstance(id);
        }
      }
    }
  }

  /**
   * 获取实例（不标记为使用中）
   */
  getInstance(workflowId: string): WorkflowInstance | undefined {
    return this.instances.get(workflowId);
  }

  /**
   * 清理所有实例
   */
  clear(): void {
    for (const id of this.instances.keys()) {
      this.removeInstance(id);
    }
  }
}

// 全局单例
export const workflowPool = new WorkflowPool();

// 定期清理过期实例
if (typeof window !== 'undefined') {
  setInterval(() => {
    workflowPool.cleanupExpired();
  }, 5 * 60 * 1000); // 每5分钟清理一次
}

