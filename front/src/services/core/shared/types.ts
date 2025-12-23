/**
 * Core Shared Types
 * 共享的基础类型定义
 */

// ============================================================================
// Result Types - 统一的结果类型
// ============================================================================

/**
 * 同步操作结果
 */
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * 异步操作结果
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

/**
 * 创建成功结果
 */
export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

/**
 * 创建失败结果
 */
export function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

// ============================================================================
// Provider Types - Provider 相关类型
// ============================================================================

/**
 * LLM Provider 类型
 */
export type LLMProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'google'
  | 'ollama'
  | 'deepseek'
  | 'local';

/**
 * MCP Server 类型
 */
export type MCPServerType = 'http-stream' | 'http-post' | 'stdio';

// ============================================================================
// Message Types - 消息相关类型
// ============================================================================

/**
 * 消息角色
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 媒体类型
 */
export type MediaType = 'image' | 'audio' | 'video' | 'text';

/**
 * 媒体项
 */
export interface MediaItem {
  type: MediaType;
  mimeType: string;
  data?: string; // base64 encoded
  url?: string;
}

// ============================================================================
// Callback Types - 回调类型
// ============================================================================

/**
 * 流式内容回调
 */
export type StreamContentCallback = (chunk: string) => void;

/**
 * 流式思考回调
 */
export type StreamThinkingCallback = (chunk: string) => void;

/**
 * 取消信号
 */
export type CancelSignal = AbortSignal;

// ============================================================================
// Status Types - 状态类型
// ============================================================================

/**
 * 连接状态
 */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/**
 * 健康状态
 */
export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// ============================================================================
// Config Types - 配置类型
// ============================================================================

/**
 * 重试配置
 */
export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier?: number;
  maxDelay?: number;
}

/**
 * 超时配置
 */
export interface TimeoutConfig {
  connectTimeout?: number;
  requestTimeout?: number;
  idleTimeout?: number;
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  backoffMultiplier: 2,
  maxDelay: 30000,
};

/**
 * 默认超时配置
 */
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  connectTimeout: 10000,
  requestTimeout: 60000,
  idleTimeout: 300000,
};

// ============================================================================
// Utility Types - 工具类型
// ============================================================================

/**
 * 深度部分类型
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * 可空类型
 */
export type Nullable<T> = T | null;

/**
 * 可选类型
 */
export type Optional<T> = T | undefined;

/**
 * 记录类型的值类型
 */
export type ValueOf<T> = T[keyof T];

/**
 * 异步函数类型
 */
export type AsyncFunction<T = void> = () => Promise<T>;

/**
 * 清理函数类型
 */
export type CleanupFunction = () => void | Promise<void>;

/**
 * 事件处理器类型
 */
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

/**
 * 订阅取消函数
 */
export type Unsubscribe = () => void;
