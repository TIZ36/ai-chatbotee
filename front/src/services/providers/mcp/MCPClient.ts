/**
 * MCPClient - MCP 单连接客户端
 * 管理与单个 MCP 服务器的连接
 */

import type {
  MCPServer,
  MCPServerStatus,
  MCPTool,
  ToolCallResult,
  MCPClientOptions,
} from './types';
import { DEFAULT_CLIENT_OPTIONS } from './types';
import { MCPError, MCPErrorCode } from '../../core/shared/errors';
import { createLogger, sleep } from '../../core/shared/utils';
import { eventBus } from '../../core/shared/events';

const logger = createLogger('MCPClient');

/**
 * MCP 客户端
 */
export class MCPClient {
  private server: MCPServer;
  private options: MCPClientOptions;
  private status: MCPServerStatus = 'disconnected';
  private client: any = null; // SDK Client
  private transport: any = null;
  private cachedTools: MCPTool[] | null = null;
  private toolsCacheTime: number = 0;
  private readonly TOOLS_CACHE_TTL = 5 * 60 * 1000; // 5 分钟
  private isInUse: boolean = false;
  public lastUsedTime: number = 0;
  private _isHealthy: boolean = true;
  private consecutiveErrors: number = 0;
  private reconnectAttempts: number = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(options: MCPClientOptions) {
    this.server = options.server;
    this.options = { ...DEFAULT_CLIENT_OPTIONS, ...options };
  }

  // ============================================================================
  // Getters
  // ============================================================================

  get serverId(): string {
    return this.server.id;
  }

  get serverName(): string {
    return this.server.name;
  }

  get connectionStatus(): MCPServerStatus {
    return this.status;
  }

  get isConnected(): boolean {
    return this.status === 'connected';
  }

  get isHealthy(): boolean {
    return this._isHealthy;
  }

  get inUse(): boolean {
    return this.isInUse;
  }

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * 连接到服务器
   */
  async connect(): Promise<void> {
    if (this.status === 'connected') {
      return;
    }

    this.status = 'connecting';
    logger.info('Connecting to MCP server', { id: this.serverId, name: this.serverName });

    try {
      // 动态导入 MCP SDK
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
      );

      // 创建 transport
      this.transport = new StreamableHTTPClientTransport(new URL(this.server.url));

      // 创建 client
      this.client = new Client(
        { name: 'chatee-client', version: '1.0.0' },
        { capabilities: {} }
      );

      // 连接
      await this.client.connect(this.transport);

      this.status = 'connected';
      this.consecutiveErrors = 0;
      this.reconnectAttempts = 0;
      this._isHealthy = true;

      // 预加载工具列表
      await this.listTools();

      eventBus.emit('mcp:connect', {
        serverId: this.serverId,
        serverName: this.serverName,
      });

      logger.info('Connected to MCP server', { id: this.serverId, toolCount: this.cachedTools?.length });
    } catch (error) {
      this.status = 'error';
      this.consecutiveErrors++;
      
      const mcpError = new MCPError(
        `Failed to connect to MCP server: ${(error as Error).message}`,
        this.serverId,
        {
          code: MCPErrorCode.CONNECTION_FAILED,
          serverName: this.serverName,
          cause: error as Error,
        }
      );

      eventBus.emit('mcp:error', {
        serverId: this.serverId,
        error: mcpError,
      });

      // 自动重连
      if (this.options.autoReconnect && this.reconnectAttempts < (this.options.maxReconnectAttempts || 5)) {
        this.scheduleReconnect();
      }

      throw mcpError;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.status === 'disconnected') {
      return;
    }

    logger.info('Disconnecting from MCP server', { id: this.serverId });

    try {
      if (this.client) {
        await this.client.close();
      }
    } catch (error) {
      logger.warn('Error during disconnect', { id: this.serverId, error });
    } finally {
      this.client = null;
      this.transport = null;
      this.status = 'disconnected';
      this.cachedTools = null;

      eventBus.emit('mcp:disconnect', {
        serverId: this.serverId,
        serverName: this.serverName,
        permanent: true,
      });
    }
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  // ============================================================================
  // Tool Operations
  // ============================================================================

  /**
   * 获取工具列表
   */
  async listTools(forceRefresh: boolean = false): Promise<MCPTool[]> {
    // 检查缓存
    if (
      !forceRefresh &&
      this.cachedTools &&
      Date.now() - this.toolsCacheTime < this.TOOLS_CACHE_TTL
    ) {
      return this.cachedTools;
    }

    if (!this.isConnected) {
      await this.connect();
    }

    try {
      const result = await this.client.listTools();
      
      this.cachedTools = (result.tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || { type: 'object' },
      }));
      
      this.toolsCacheTime = Date.now();
      this.recordSuccess();
      
      return this.cachedTools;
    } catch (error) {
      this.recordError(error as Error);
      throw new MCPError(
        `Failed to list tools: ${(error as Error).message}`,
        this.serverId,
        {
          code: MCPErrorCode.TOOL_NOT_FOUND,
          serverName: this.serverName,
          cause: error as Error,
        }
      );
    }
  }

  /**
   * 调用工具
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeout?: number
  ): Promise<ToolCallResult> {
    if (!this.isConnected) {
      await this.connect();
    }

    const startTime = Date.now();
    this.isInUse = true;

    eventBus.emit('mcp:tool_call', {
      serverId: this.serverId,
      toolName,
      arguments: args,
    });

    try {
      // 带超时的调用
      const timeoutMs = timeout || this.options.requestTimeout || 60000;
      const result = await Promise.race([
        this.client.callTool({ name: toolName, arguments: args }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tool call timeout')), timeoutMs)
        ),
      ]);

      const duration = Date.now() - startTime;
      this.recordSuccess();

      // 处理结果
      const content = result.content;
      let parsedContent: unknown = content;

      // 尝试解析 JSON
      if (Array.isArray(content)) {
        const textParts = content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text);
        const combined = textParts.join('\n');
        try {
          parsedContent = JSON.parse(combined);
        } catch {
          parsedContent = combined;
        }
      }

      eventBus.emit('mcp:tool_result', {
        serverId: this.serverId,
        toolName,
        result: parsedContent,
        duration,
      });

      return {
        success: !result.isError,
        content: parsedContent,
        isError: result.isError,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordError(error as Error);

      const mcpError = new MCPError(
        `Tool call failed: ${(error as Error).message}`,
        this.serverId,
        {
          code: MCPErrorCode.TOOL_EXECUTION_FAILED,
          serverName: this.serverName,
          toolName,
          cause: error as Error,
        }
      );

      eventBus.emit('mcp:error', {
        serverId: this.serverId,
        error: mcpError,
      });

      return {
        success: false,
        content: (error as Error).message,
        isError: true,
        duration,
      };
    } finally {
      this.isInUse = false;
      this.lastUsedTime = Date.now();
    }
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.isConnected) {
        return false;
      }

      // 简单的 ping（获取工具列表）
      await this.listTools(true);
      
      eventBus.emit('mcp:health_check', {
        serverId: this.serverId,
        healthy: true,
      });

      return true;
    } catch (error) {
      eventBus.emit('mcp:health_check', {
        serverId: this.serverId,
        healthy: false,
      });

      return false;
    }
  }

  /**
   * 标记使用中
   */
  acquire(): boolean {
    if (this.isInUse || !this.isConnected || !this._isHealthy) {
      return false;
    }
    this.isInUse = true;
    return true;
  }

  /**
   * 释放使用
   */
  release(): void {
    this.isInUse = false;
    this.lastUsedTime = Date.now();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 记录成功
   */
  private recordSuccess(): void {
    this.consecutiveErrors = 0;
    this._isHealthy = true;
  }

  /**
   * 记录错误
   */
  private recordError(error: Error): void {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= 3) {
      this._isHealthy = false;
    }
    logger.warn('MCP operation failed', {
      id: this.serverId,
      consecutiveErrors: this.consecutiveErrors,
      error: error.message,
    });
  }

  /**
   * 调度重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = (this.options.reconnectDelay || 1000) * Math.pow(2, this.reconnectAttempts - 1);

    eventBus.emit('mcp:reconnect', {
      serverId: this.serverId,
      serverName: this.serverName,
      attempt: this.reconnectAttempts,
    });

    logger.info('Scheduling reconnect', {
      id: this.serverId,
      attempt: this.reconnectAttempts,
      delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.connect();
      } catch (error) {
        // 连接失败会自动重新调度
      }
    }, delay);
  }
}
