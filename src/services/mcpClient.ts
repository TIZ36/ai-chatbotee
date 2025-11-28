/**
 * MCP (Model Context Protocol) 客户端实现
 * 使用官方 @modelcontextprotocol/sdk
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  type: 'http-stream' | 'http-post' | 'stdio';
  enabled: boolean;
  description?: string;
  metadata?: Record<string, any>;
  ext?: Record<string, any>; // 扩展配置（如 response_format, server_type 等）
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

export interface MCPClientOptions {
  server: MCPServer;
}

export class MCPClient {
  private server: MCPServer;
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private isConnected: boolean = false;
  private cachedTools: MCPTool[] | null = null; // 缓存工具列表
  private toolsCacheTime: number = 0; // 工具列表缓存时间
  private readonly TOOLS_CACHE_TTL = 5 * 60 * 1000; // 工具列表缓存5分钟
  private isInUse: boolean = false; // 连接是否正在使用中（连接池管理）
  private lastUsedTime: number = 0; // 最后使用时间

  constructor(options: MCPClientOptions) {
    this.server = options.server;
  }

  /**
   * 标记连接为使用中
   */
  markAsInUse(): void {
    this.isInUse = true;
    this.lastUsedTime = Date.now();
  }

  /**
   * 标记连接为空闲
   */
  markAsIdle(): void {
    this.isInUse = false;
    this.lastUsedTime = Date.now();
  }

  /**
   * 检查连接是否空闲
   */
  isIdle(): boolean {
    return !this.isInUse && this.isInitialized;
  }

  /**
   * 获取 session ID
   */
  getSessionId(): string | undefined {
    return this.transport ? (this.transport as any).sessionId : undefined;
  }

  /**
   * 检测是否在 Electron 环境中
   */
  private isElectron(): boolean {
    return typeof window !== 'undefined' && (window as any).electronAPI !== undefined;
  }

  /**
   * 获取后端 API 地址
   */
  private getBackendUrl(): string {
    // 统一使用 3002 端口（后端 Flask 服务器）
    if (this.isElectron()) {
      return 'http://localhost:3002';
    }
    return import.meta.env.VITE_BACKEND_URL || 'http://localhost:3002';
  }

  /**
   * 构建代理 URL（所有环境都使用代理，解决 CORS 问题）
   * 使用后端 API 地址，通过后端代理转发
   */
  private buildProxyUrl(serverUrl: string): string {
    // 所有环境都使用后端代理，避免 CORS 问题
    // 格式：http://localhost:3002/mcp?url=...&transportType=streamable-http
    // 后端会转发请求到目标 MCP 服务器
    const backendUrl = this.getBackendUrl();
    const encodedUrl = encodeURIComponent(serverUrl);
    const proxyUrl = `${backendUrl}/mcp?url=${encodedUrl}&transportType=streamable-http`;
    console.log(`[MCP] Built proxy URL: ${proxyUrl}`);
    return proxyUrl;
  }

  /**
   * 连接到 MCP 服务器
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log(`[MCP] Already connected to ${this.server.name}`);
      return;
    }

    try {
      // 所有环境都使用代理模式，解决 CORS 问题
      const targetUrl = this.buildProxyUrl(this.server.url);
      
      console.log(`[MCP] Connecting to ${this.server.name}`);
      console.log(`[MCP] Using proxy to avoid CORS issues`);
      console.log(`[MCP] Target URL: ${targetUrl}`);

      // 创建 StreamableHTTP 传输层（流式 HTTP 传输）
      // 使用最新的 MCP 协议版本 2025-06-18（兼容 2025-03-26）
      console.log(`[MCP] Creating StreamableHTTPClientTransport`);
      
      // 构建请求头，合并默认头和自定义头（如Authorization）
      const defaultHeaders: Record<string, string> = {
        'mcp-protocol-version': '2025-06-18',
        'Accept': 'application/json, text/event-stream',
      };
      
      // 从metadata中获取自定义headers（如Notion的Authorization）
      const customHeaders = this.server.metadata?.headers || {};
      const headers = { ...defaultHeaders, ...customHeaders };
      
      console.log(`[MCP] Server metadata:`, JSON.stringify(this.server.metadata, null, 2));
      console.log(`[MCP] Custom headers from metadata:`, Object.keys(customHeaders));
      console.log(`[MCP] Request headers:`, Object.keys(headers).map(k => 
        k === 'Authorization' ? `${k}: Bearer ***` : `${k}: ${headers[k]}`
      ).join(', '));
      
      // 检查Authorization header
      if (headers['Authorization']) {
        const authValue = headers['Authorization'];
        console.log(`[MCP] Authorization header present, length: ${authValue.length}`);
        console.log(`[MCP] Authorization header format: ${authValue.substring(0, 20)}...`);
      } else {
        console.warn(`[MCP] ⚠️ No Authorization header found in headers!`);
      }
      
      this.transport = new StreamableHTTPClientTransport(new URL(targetUrl), {
        requestInit: {
          headers,
        },
      });
      console.log(`[MCP] StreamableHTTPClientTransport created, will use POST for requests and SSE for responses`);

      // 创建 MCP 客户端
      // 显式提供 JSON Schema 验证器以避免 "resultSchema.parse is not a function" 错误
      this.client = new Client(
        {
          name: 'youtube-manager',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
          },
          jsonSchemaValidator: new AjvJsonSchemaValidator(),
        }
      );

      // 严格遵循 MCP 协议初始化流程：
      // 1. Client.connect() 会自动：
      //    - 启动传输层（建立 SSE 连接）
      //    - 发送 initialize 请求
      //    - 等待 initialize 成功响应（确认初始化完成）
      //    - 发送 notifications/initialized 通知
      // 2. 等待服务器完成内部初始化

      console.log(`[MCP] Step 1: Connecting client (will automatically:`);
      console.log(`[MCP]   - Start transport layer (SSE connection)`);
      console.log(`[MCP]   - Send initialize request`);
      console.log(`[MCP]   - Wait for initialize response`);
      console.log(`[MCP]   - Send notifications/initialized notification)`);
      
      try {
        await this.client.connect(this.transport);
        console.log(`[MCP] Step 2: Client connected successfully (initialize completed)`);
      } catch (error) {
        // 检查是否是405错误（METHOD NOT ALLOWED）
        // 这可能是SDK内部的预检请求失败，但不影响实际连接
        const errorMessage = error instanceof Error ? error.message : String(error);
        const is405Error = errorMessage.includes('405') || errorMessage.includes('METHOD NOT ALLOWED');
        
        if (is405Error) {
          console.warn(`[MCP] ⚠️ Received 405 error during connection (likely SDK preflight request):`, errorMessage);
          console.warn(`[MCP] This error is usually harmless. Attempting to continue...`);
          // 405错误通常是SDK内部的预检请求失败，但实际的SSE连接可能已经建立
          // 我们尝试继续，如果连接真的失败了，后续操作会失败
          // 设置一个标志，表示连接可能有问题，但允许继续尝试
          console.warn(`[MCP] Connection may still be functional. Will verify with subsequent operations.`);
        } else {
          console.error(`[MCP] Client connection failed:`, error);
          throw new Error(`Failed to initialize MCP session: ${errorMessage}`);
        }
      }

      // 获取会话 ID（如果服务器分配了）
      const sessionId = this.transport.sessionId;
      if (sessionId) {
        console.log(`[MCP] Session ID: ${sessionId}`);
      }

      // Step 3: 等待服务器完成内部初始化
      // Client.connect() 已经完成了 initialize 和 notifications/initialized
      // 根据 MCP Inspector 的流程：
      // - initialize 返回 202 Accepted（异步处理）
      // - 响应通过 SSE 流返回
      // - 服务器需要时间完成内部状态转换
      // 某些服务器（如 xiaohongshu-mcp）可能需要额外时间
      // 优化：减少等待时间，通过实际测试工具列表来验证连接是否就绪
      console.log(`[MCP] Step 3: Waiting for server to complete internal initialization...`);
      console.log(`[MCP] Note: initialize may return 202 Accepted (async), response comes via SSE stream`);
      console.log(`[MCP] Reduced wait time, will verify readiness by testing tools/list...`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // 减少到 1000ms，通过实际请求验证就绪状态

      this.isConnected = true;
      console.log(`[MCP] Successfully connected and initialized ${this.server.name}${sessionId ? ` (session: ${sessionId})` : ''}`);

    } catch (error) {
      console.error(`[MCP] Failed to connect to ${this.server.name}:`, error);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.client && this.transport) {
      try {
        await this.transport.close();
        this.client = null;
        this.transport = null;
        this.isConnected = false;
        // 清除缓存
        this.cachedTools = null;
        this.toolsCacheTime = 0;
        console.log(`[MCP] Disconnected from ${this.server.name}`);
      } catch (error) {
        console.error(`[MCP] Error disconnecting from ${this.server.name}:`, error);
      }
    }
  }
  
  /**
   * 清除工具列表缓存
   */
  clearToolsCache(): void {
    this.cachedTools = null;
    this.toolsCacheTime = 0;
    console.log(`[MCP] Cleared tools cache for ${this.server.name}`);
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(): MCPServer {
    return this.server;
  }

  /**
   * 获取连接状态
   */
  get isInitialized(): boolean {
    return this.isConnected;
  }

  /**
   * 获取可用工具列表
   * 
   * 注意：由于 SDK 的 schema 验证问题，我们直接发送原始 HTTP 请求
   * 优化：使用缓存避免重复请求
   */
  async listTools(forceRefresh: boolean = false): Promise<MCPTool[]> {
    if (!this.transport) {
      throw new Error('MCP transport not connected');
    }

    // 检查缓存
    const now = Date.now();
    if (!forceRefresh && this.cachedTools && (now - this.toolsCacheTime) < this.TOOLS_CACHE_TTL) {
      console.log(`[MCP] Using cached tools list for ${this.server.name} (${this.cachedTools.length} tools)`);
      return this.cachedTools;
    }

    const maxRetries = 2; // 减少重试次数
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[MCP] Attempting to get tools list from ${this.server.name} (attempt ${attempt}/${maxRetries})`);
        console.log(`[MCP] Sending direct HTTP POST to bypass SDK validation`);

        // 使用代理发送 HTTP POST 请求，解决 CORS 问题
        const targetUrl = this.buildProxyUrl(this.server.url);

        const requestBody = {
          jsonrpc: '2.0',
          id: attempt,
          method: 'tools/list',
          params: {
            _meta: {
              progressToken: attempt
            }
          }
        };

        console.log(`[MCP] Sending request to ${targetUrl}`);
        console.log(`[MCP] Request body:`, JSON.stringify(requestBody));

        // 检查服务器是否使用 SSE 格式（Notion MCP 使用 SSE）
        const isSSE = (this.server as any).ext?.response_format === 'sse' || 
                      (this.server as any).ext?.server_type === 'notion';

        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': isSSE ? 'text/event-stream' : 'application/json',
            'mcp-protocol-version': '2025-06-18',
            'mcp-session-id': (this.transport as any).sessionId || '',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // 检查响应类型：SSE流式响应还是普通JSON响应
        const contentType = response.headers.get('content-type') || '';
        const isStreaming = contentType.includes('text/event-stream') || isSSE;

        let jsonResponse: any;

        if (isStreaming) {
          // 处理 SSE 格式响应
          console.log(`[MCP] Detected SSE response for tools/list, parsing...`);
          const responseText = await response.text();
          console.log(`[MCP] SSE response preview:`, responseText.substring(0, 200));
          
          // 解析 SSE 格式
          const lines = responseText.split('\n');
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
              const jsonStr = trimmedLine.substring(6);
              if (jsonStr.trim()) {
                try {
                  jsonResponse = JSON.parse(jsonStr);
                  console.log(`[MCP] Parsed SSE response:`, jsonResponse);
                  break;
                } catch (parseError) {
                  console.warn(`[MCP] Failed to parse SSE data line:`, parseError);
                }
              }
            } else if (trimmedLine.startsWith('{')) {
              // 直接是JSON对象（没有 "data: " 前缀）
              try {
                jsonResponse = JSON.parse(trimmedLine);
                console.log(`[MCP] Parsed JSON response:`, jsonResponse);
                break;
              } catch (parseError) {
                console.warn(`[MCP] Failed to parse JSON line:`, parseError);
              }
            }
          }
          
          if (!jsonResponse) {
            throw new Error('Failed to parse SSE response for tools/list');
          }
        } else {
          // 普通 JSON 响应
          jsonResponse = await response.json();
          console.log(`[MCP] Received JSON response:`, jsonResponse);
        }

        if (jsonResponse.error) {
          throw new Error(`MCP Error: ${jsonResponse.error.message}`);
        }

        const tools = jsonResponse.result?.tools || [];
        console.log(`[MCP] Retrieved ${tools.length} tools from ${this.server.name}`);
        
        // 缓存工具列表
        this.cachedTools = tools;
        this.toolsCacheTime = Date.now();
        
        return tools;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (lastError.message.includes('invalid during session initialization') && attempt < maxRetries) {
          const waitTime = 1000 * attempt; // 减少等待时间：1s, 2s
          console.log(`[MCP] Server still initializing, waiting ${waitTime}ms before retry (attempt ${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        console.error(`[MCP] Failed to get tools list from ${this.server.name}:`, error);
        console.error(`[MCP] Error details:`, lastError.message);
        throw lastError;
      }
    }

    throw lastError || new Error('Failed to get tools list after retries');
  }

  /**
   * 调用工具
   * 
   * 注意：由于 SDK 的 schema 验证问题，我们直接发送原始 HTTP 请求
   * 支持SSE流式响应和普通JSON响应
   */
  async callTool(name: string, args: any, onStream?: (chunk: any) => void): Promise<any> {
    if (!this.transport) {
      throw new Error('MCP transport not connected');
    }

    try {
      console.log(`[MCP] Calling tool ${name} on ${this.server.name}`);
      console.log(`[MCP] Tool arguments:`, args);

      // 直接发送 HTTP POST 请求到 MCP 服务器
      const targetUrl = this.isElectron() 
        ? this.buildProxyUrl(this.server.url)
        : this.server.url;

      const requestBody = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        }
      };

      console.log(`[MCP] Sending request to ${targetUrl}`);

      // 创建带超时的 fetch（90秒超时，MCP工具调用通常需要更长时间）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90秒超时
      
      let response: Response;
      try {
        response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-06-18',
            'mcp-session-id': (this.transport as any).sessionId || '',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error('MCP tool call timeout (90s)');
        }
        throw error;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 检查响应类型：SSE流式响应还是普通JSON响应
      const contentType = response.headers.get('content-type') || '';
      const isStreaming = contentType.includes('text/event-stream');
      
      if (isStreaming) {
        // 明确的SSE流式响应（按照文档要求）
        console.log(`[MCP] Detected streaming response (SSE format from Content-Type: text/event-stream)`);
        return await this.handleStreamingResponse(response, onStream);
      }
      
      // 尝试读取响应文本，判断是否是SSE格式（即使Content-Type不是text/event-stream）
      // 使用clone()避免消费原始响应
      const responseClone = response.clone();
      let responseText: string;
      try {
        responseText = await responseClone.text();
      } catch (e) {
        // 如果无法读取文本，尝试直接作为流处理
        console.log(`[MCP] Cannot read response text, trying as stream`);
        return await this.handleStreamingResponse(response, onStream);
      }
      
      // 检查响应内容是否像SSE格式（按照文档：data: {"jsonrpc":"2.0",...}）
      const looksLikeSSE = responseText.includes('data: {') || 
                           (responseText.trim().startsWith('data: ') && responseText.includes('jsonrpc'));

      if (looksLikeSSE) {
        console.log(`[MCP] Detected streaming response (SSE format from content: data: {...})`);
        // 使用原始响应作为流处理
        return await this.handleStreamingResponse(response, onStream);
      }
      
      // 普通JSON响应
      try {
        const jsonResponse = JSON.parse(responseText);
        console.log(`[MCP] Received JSON response:`, jsonResponse);

        // 检查错误（按照文档要求）
        if (jsonResponse.error) {
          throw new Error(`MCP Error: ${jsonResponse.error.message || JSON.stringify(jsonResponse.error)}`);
        }

        console.log(`[MCP] Tool ${name} executed successfully on ${this.server.name}`);
        return jsonResponse.result;
      } catch (parseError) {
        // JSON解析失败，可能是SSE格式但格式不标准（例如：data: {"js"... 被截断）
        if (parseError instanceof SyntaxError && parseError.message.includes('JSON')) {
          console.log(`[MCP] JSON parse failed (${parseError.message}), trying to handle as SSE stream`);
          // 使用原始响应作为流处理
          return await this.handleStreamingResponse(response, onStream);
        }
        throw parseError;
      }

    } catch (error) {
      console.error(`[MCP] Failed to call tool ${name} on ${this.server.name}:`, error);
      throw error;
    }
  }

  /**
   * 处理SSE流式响应
   */
  private async handleStreamingResponse(response: Response, onStream?: (chunk: any) => void): Promise<any> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullResult: any = null;
    const chunks: any[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        // 解码数据块
        buffer += decoder.decode(value, { stream: true });
        
        // 处理SSE格式：按行分割，查找 "data: " 开头的行
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留最后不完整的行

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // SSE格式：data: {"jsonrpc":"2.0","id":2,"result":{...}}
          if (trimmedLine.startsWith('data: ')) {
            const jsonStr = trimmedLine.substring(6); // 移除 "data: " 前缀
            
            if (!jsonStr.trim()) {
              continue; // 跳过空行
            }
            
            try {
              // 解析JSON-RPC响应
              const jsonRpcResponse = JSON.parse(jsonStr);
              
              // 检查错误（文档要求）
              if (jsonRpcResponse.error) {
                throw new Error(`MCP Error: ${jsonRpcResponse.error.message || JSON.stringify(jsonRpcResponse.error)}`);
              }
              
              // 收集所有数据块
              chunks.push(jsonRpcResponse);
              
              // 如果包含完整结果，保存它（文档说明：result.content[0].text）
              if (jsonRpcResponse.result !== undefined) {
                fullResult = jsonRpcResponse.result;
                
                // 流式输出：提取content并调用回调
                if (onStream && jsonRpcResponse.result.content) {
                  // 处理content数组
                  if (Array.isArray(jsonRpcResponse.result.content)) {
                    for (const contentItem of jsonRpcResponse.result.content) {
                      if (contentItem.type === 'text' && contentItem.text) {
                        // 尝试解析内层JSON（文档说明：text字段可能是JSON字符串）
                        try {
                          const innerData = JSON.parse(contentItem.text);
                          onStream({ content: innerData, type: 'parsed' });
                        } catch {
                          // 如果不是JSON，直接输出文本
                          onStream({ content: contentItem.text, type: 'text' });
                        }
                      } else {
                        onStream({ content: contentItem, type: contentItem.type || 'unknown' });
                      }
                    }
                  } else if (jsonRpcResponse.result.content) {
                    onStream({ content: jsonRpcResponse.result.content, type: 'content' });
                  }
                }
              }
            } catch (parseError) {
              // JSON解析失败
              console.warn(`[MCP] Failed to parse SSE data line: ${jsonStr.substring(0, 100)}`, parseError);
              if (onStream) {
                onStream({ content: jsonStr, raw: true, error: parseError instanceof Error ? parseError.message : String(parseError) });
              }
            }
          } else if (trimmedLine.startsWith('{')) {
            // 直接是JSON对象（没有 "data: " 前缀）
            try {
              const jsonData = JSON.parse(trimmedLine);
              chunks.push(jsonData);
              
              if (jsonData.result !== undefined) {
                fullResult = jsonData.result;
              }
              
              if (onStream) {
                onStream(jsonData);
              }
            } catch (parseError) {
              console.warn(`[MCP] Failed to parse JSON line: ${trimmedLine.substring(0, 100)}`);
            }
          }
        }
      }

      // 处理剩余的buffer
      if (buffer.trim()) {
        if (buffer.trim().startsWith('data: ')) {
          const jsonStr = buffer.trim().substring(6);
          try {
            const jsonData = JSON.parse(jsonStr);
            chunks.push(jsonData);
            if (jsonData.result !== undefined) {
              fullResult = jsonData.result;
            }
            if (onStream) {
              onStream(jsonData);
            }
          } catch (e) {
            // 忽略解析错误
          }
        } else if (buffer.trim().startsWith('{')) {
          try {
            const jsonData = JSON.parse(buffer.trim());
            chunks.push(jsonData);
            if (jsonData.result !== undefined) {
              fullResult = jsonData.result;
            }
            if (onStream) {
              onStream(jsonData);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }

      // 返回最终结果（按照文档要求：从result.content[0].text提取数据）
      if (fullResult !== null) {
        // 如果result包含content数组，尝试提取text字段并二次解析
        if (Array.isArray(fullResult.content) && fullResult.content.length > 0) {
          const firstContent = fullResult.content[0];
          if (firstContent.type === 'text' && firstContent.text) {
            try {
              // 尝试二次JSON解析（文档说明：text字段可能是JSON字符串）
              const parsedText = JSON.parse(firstContent.text);
              return {
                ...fullResult,
                parsedData: parsedText, // 添加解析后的数据
                originalText: firstContent.text, // 保留原始文本
              };
            } catch {
              // 如果不是JSON，直接返回text
              return {
                ...fullResult,
                text: firstContent.text,
              };
            }
          }
        }
        return fullResult;
      } else if (chunks.length > 0) {
        // 从最后一个chunk中提取result
        const lastChunk = chunks[chunks.length - 1];
        if (lastChunk.result) {
          return lastChunk.result;
        }
        // 如果没有明确的result字段，返回所有收集的数据
        return { chunks, message: 'Multiple chunks received' };
      } else {
        return { content: [], message: 'No data received' };
      }

    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * MCP 连接池项
 */
interface MCPPoolItem {
  client: MCPClient;
  serverId: string;
  createdAt: number;
}

/**
 * MCP 管理器（带连接池）
 */
export class MCPManager {
  private clients = new Map<string, MCPClient>(); // 共享连接（向后兼容）
  private connectionPool = new Map<string, MCPPoolItem[]>(); // 连接池：serverId -> MCPClient[]
  private readonly MAX_POOL_SIZE = 10; // 每个服务器的最大连接池大小
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 空闲连接超时时间（5分钟）

  /**
   * 从连接池获取一个空闲的连接
   * @param serverId 服务器ID
   * @returns 空闲的MCP客户端，如果没有则返回null
   */
  private getFromPool(serverId: string): MCPClient | null {
    const pool = this.connectionPool.get(serverId);
    if (!pool || pool.length === 0) {
      return null;
    }

    // 查找空闲连接，同时清理无效连接
    for (let i = pool.length - 1; i >= 0; i--) {
      const item = pool[i];
      
      // 首先检查连接是否仍然有效
      if (!item.client.isInitialized) {
        // 连接已失效，从池中移除
        console.log(`[MCP Pool] Removing invalid connection from pool for ${serverId}`);
        item.client.disconnect().catch(err => {
          console.error(`[MCP Pool] Error disconnecting invalid client:`, err);
        });
        pool.splice(i, 1);
        continue;
      }
      
      // 检查是否空闲
      if (item.client.isIdle()) {
        // 检查是否超时
        const idleTime = Date.now() - item.client.lastUsedTime;
        if (idleTime > this.IDLE_TIMEOUT) {
          // 连接已超时，关闭并从池中移除
          console.log(`[MCP Pool] Connection for ${serverId} idle timeout (${idleTime}ms), removing from pool`);
          item.client.disconnect().catch(err => {
            console.error(`[MCP Pool] Error disconnecting timeout client:`, err);
          });
          pool.splice(i, 1);
          continue;
        }
        // 找到有效的空闲连接，标记为使用中并返回
        item.client.markAsInUse();
        console.log(`[MCP Pool] Reusing connection from pool for ${serverId} (session: ${item.client.getSessionId()})`);
        return item.client;
      }
    }

    return null;
  }

  /**
   * 将连接归还到连接池
   * @param client MCP客户端
   * @param serverId 服务器ID
   */
  returnToPool(client: MCPClient, serverId: string): void {
    // 只有已初始化的连接才能放入池中
    if (!client.isInitialized) {
      console.log(`[MCP Pool] Connection for ${serverId} is not initialized, not returning to pool`);
      // 尝试断开连接以清理资源
      client.disconnect().catch(err => {
        console.error(`[MCP Pool] Error disconnecting invalid client:`, err);
      });
      return;
    }

    // 标记为空闲
    client.markAsIdle();

    // 检查是否已在池中
    const pool = this.connectionPool.get(serverId) || [];
    const existsInPool = pool.some(item => item.client === client);
    
    if (!existsInPool) {
      // 如果池未满，添加到池中
      if (pool.length < this.MAX_POOL_SIZE) {
        pool.push({
          client,
          serverId,
          createdAt: Date.now(),
        });
        this.connectionPool.set(serverId, pool);
        console.log(`[MCP Pool] Connection returned to pool for ${serverId} (pool size: ${pool.length}, session: ${client.getSessionId()})`);
      } else {
        // 池已满，关闭连接
        console.log(`[MCP Pool] Pool full for ${serverId}, closing connection`);
        client.disconnect();
      }
    } else {
      console.log(`[MCP Pool] Connection already in pool for ${serverId}`);
    }
  }

  /**
   * 从连接池获取或创建新的MCP连接
   * @param server MCP服务器配置
   * @returns MCP客户端
   * @throws 如果服务器未启用或连接失败
   */
  async acquireConnection(server: MCPServer): Promise<MCPClient> {
    // 检查服务器是否启用
    if (!server.enabled) {
      throw new Error(`MCP服务器 ${server.name} 未启用`);
    }

    // 先从连接池获取空闲连接
    const pooledClient = this.getFromPool(server.id);
    if (pooledClient) {
      // 验证连接是否仍然有效
      if (pooledClient.isInitialized) {
        return pooledClient;
      } else {
        // 连接已失效，从池中移除
        console.log(`[MCP Pool] Pooled connection for ${server.name} is invalid, removing from pool`);
        const pool = this.connectionPool.get(server.id);
        if (pool) {
          const index = pool.findIndex(item => item.client === pooledClient);
          if (index !== -1) {
            pool.splice(index, 1);
          }
        }
        // 继续创建新连接
      }
    }

    // 池中没有空闲连接，创建新连接
    console.log(`[MCP Pool] No idle connection in pool for ${server.name}, creating new connection`);
    const newClient = new MCPClient({ server });
    
    try {
      // 尝试连接
      await newClient.connect();
      
      // 验证连接是否成功
      if (!newClient.isInitialized) {
        throw new Error(`连接失败：客户端未初始化`);
      }
    } catch (error) {
      // 连接失败，清理客户端
      try {
        await newClient.disconnect();
      } catch (disconnectError) {
        // 忽略断开连接时的错误
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`无法连接到MCP服务器 ${server.name}: ${errorMessage}`);
    }

    // 标记为使用中
    newClient.markAsInUse();
    
    console.log(`[MCP Pool] New connection created for ${server.name} (session: ${newClient.getSessionId()})`);
    return newClient;
  }

  /**
   * 添加服务器（向后兼容方法）
   * 优化：如果客户端已存在且已连接，直接返回，避免重复连接
   * @param server MCP服务器配置
   * @param createNewConnection 是否创建新连接（已废弃，使用 acquireConnection 代替）
   * @deprecated 使用 acquireConnection 代替
   */
  async addServer(server: MCPServer, createNewConnection: boolean = false): Promise<MCPClient> {
    // 如果要求创建新连接，使用连接池机制
    if (createNewConnection) {
      return await this.acquireConnection(server);
    }
    
    // 原有逻辑：共享连接（向后兼容）
    let client = this.clients.get(server.id);
    if (client) {
      console.log(`[MCP Manager] Server ${server.name} already added.`);
      // 如果客户端已存在且已连接，直接返回（避免重复连接）
      if (client.isInitialized) {
        console.log(`[MCP Manager] Server ${server.name} already connected, reusing connection.`);
        return client;
      }
      // 如果客户端已存在但未连接，尝试重新连接
      if (!client.isInitialized) {
        console.log(`[MCP Manager] Server ${server.name} not connected, reconnecting...`);
        await client.connect();
      }
      return client;
    }

    client = new MCPClient({ server });
    this.clients.set(server.id, client);

    if (server.enabled) {
      await client.connect(); // 连接并初始化客户端
    }

    return client;
  }

  /**
   * 获取客户端
   */
  getClient(serverId: string): MCPClient | undefined {
    return this.clients.get(serverId);
  }

  /**
   * 获取所有客户端（包括连接池中的连接）
   */
  getAllClients(): MCPClient[] {
    const allClients: MCPClient[] = [];
    // 添加共享连接
    allClients.push(...Array.from(this.clients.values()));
    // 添加连接池中的连接
    for (const pool of this.connectionPool.values()) {
      for (const item of pool) {
        if (item.client.isInitialized) {
          allClients.push(item.client);
        }
      }
    }
    return allClients;
  }

  /**
   * 移除服务器
   */
  removeServer(serverId: string): void {
    const client = this.clients.get(serverId);
    if (client) {
      client.disconnect(); // 断开连接
      this.clients.delete(serverId);
      console.log(`[MCP Manager] Server ${serverId} removed.`);
    }
  }
}

// 全局 MCP 管理器实例
export const mcpManager = new MCPManager();