/**
 * LLM客户端服务
 * 支持多种LLM提供商，并与MCP工具集成
 */

import { llmConfigManager, LLMConfig } from './llmConfig';
import { mcpManager, MCPClient, MCPTool } from './mcpClient';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMResponse {
  content: string;
  tool_calls?: LLMToolCall[];
  finish_reason?: string;
}

/**
 * 将MCP工具转换为LLM Function定义
 * 遵循 OpenAI Function Calling API 规范
 */
export function convertMCPToolToLLMFunction(tool: MCPTool): any {
  return {
    type: 'function', // OpenAI API 要求必须包含 type 字段
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

/**
 * 规范化 OpenAI 兼容的 API URL
 * 统一处理所有兼容OpenAI的模型URL拼接逻辑：
 * - 如果用户只提供了 host（如 https://api-inference.modelscope.cn），则拼接完整的默认 path
 * - 如果用户提供了部分 path（如 /v1），则拼接剩余部分（如 /chat/completions）
 * - 如果用户提供了完整的 path，则直接使用
 * 
 * @param userUrl 用户提供的 URL（可能只有 host 或部分 path）
 * @param defaultUrl 默认的完整 URL（包含完整 path，如 https://api.openai.com/v1/chat/completions）
 * @returns 规范化后的完整 URL
 */
function normalizeOpenAIUrl(userUrl: string | undefined, defaultUrl: string): string {
  if (!userUrl) {
    return defaultUrl;
  }

  try {
    const userUrlObj = new URL(userUrl);
    const defaultUrlObj = new URL(defaultUrl);

    // 获取默认URL的完整path（如 /v1/chat/completions）
    const defaultPath = defaultUrlObj.pathname;
    
    // 获取用户URL的path（可能为空、/、/v1、/v1/ 等）
    let userPath = userUrlObj.pathname || '/';
    // 规范化：移除尾部的斜杠以便比较（但保留用于拼接）
    const userPathNormalized = userPath.endsWith('/') && userPath !== '/' 
      ? userPath.slice(0, -1) 
      : userPath;
    
    // 如果用户path为空或只有根路径，使用默认的完整path
    if (!userPath || userPath === '/') {
      return `${userUrlObj.protocol}//${userUrlObj.host}${defaultPath}${userUrlObj.search}`;
    }
    
    // 如果用户path是默认path的前缀（如 /v1 是 /v1/chat/completions 的前缀），拼接剩余部分
    // 检查：defaultPath 是否以 userPathNormalized 开头（考虑斜杠）
    if (defaultPath === userPathNormalized) {
      // 完全匹配，直接使用（虽然这种情况应该很少见）
      return userUrl;
    }
    
    // 检查是否是前缀关系（考虑斜杠）
    const isPrefix = defaultPath.startsWith(userPathNormalized + '/') || 
                     defaultPath.startsWith(userPathNormalized);
    
    if (isPrefix && defaultPath !== userPathNormalized) {
      // 提取剩余部分（如 /chat/completions）
      const remainingPath = defaultPath.substring(userPathNormalized.length);
      // 确保拼接正确（避免双斜杠或缺少斜杠）
      let finalPath: string;
      if (userPath.endsWith('/')) {
        // 用户path以斜杠结尾，直接拼接剩余部分（去掉剩余部分开头的斜杠）
        finalPath = `${userPath}${remainingPath.startsWith('/') ? remainingPath.substring(1) : remainingPath}`;
      } else {
        // 用户path不以斜杠结尾，直接拼接剩余部分
        finalPath = `${userPath}${remainingPath}`;
      }
      return `${userUrlObj.protocol}//${userUrlObj.host}${finalPath}${userUrlObj.search}`;
    }
    
    // 如果用户path已经包含完整路径（如 /v1/chat/completions），直接使用
    // 或者用户path与默认path不同但完整，也直接使用（允许自定义路径）
    return userUrl;
  } catch (error) {
    // 如果 URL 解析失败，尝试简单处理
    try {
      const defaultUrlObj = new URL(defaultUrl);
      const defaultPath = defaultUrlObj.pathname;
      
      // 如果用户URL不包含 /v1/chat/completions 这样的完整路径，尝试拼接
      if (!userUrl.includes('/chat/completions') && !userUrl.includes('/messages')) {
        // 检查是否以 /v1 结尾，如果是则拼接剩余部分
        if (userUrl.endsWith('/v1') || userUrl.endsWith('/v1/')) {
          const remainingPath = defaultPath.replace('/v1', '');
          return `${userUrl}${remainingPath}`;
        }
        // 如果URL没有path或path不完整，添加默认path
        if (!userUrl.includes(defaultPath)) {
          return `${userUrl}${defaultPath}`;
        }
      }
    } catch (e) {
      // 如果都失败了，返回用户提供的URL（让fetch来处理错误）
    }
    
    return userUrl;
  }
}

/**
 * LLM客户端类
 */
export class LLMClient {
  private config: LLMConfig;
  private allowedTools: MCPTool[] = []; // 允许使用的工具列表
  private allowedToolNames: Set<string> = new Set(); // 允许使用的工具名称集合
  private onToolStream?: (toolName: string, chunk: any) => void; // 工具流式输出回调

  constructor(config: LLMConfig) {
    this.config = config;
  }
  
  /**
   * 设置允许使用的工具列表
   */
  setAllowedTools(tools: MCPTool[]) {
    this.allowedTools = tools;
    this.allowedToolNames = new Set(tools.map(t => t.name));
  }
  
  /**
   * 设置工具流式输出回调
   */
  setOnToolStream(callback: (toolName: string, chunk: any) => void) {
    this.onToolStream = callback;
  }

  /**
   * 调用LLM API
   */
  async chat(messages: LLMMessage[], tools?: any[]): Promise<LLMResponse> {
    switch (this.config.provider) {
      case 'openai':
        return this.callOpenAI(messages, tools);
      case 'anthropic':
        return this.callAnthropic(messages, tools);
      case 'ollama':
        return this.callOllama(messages, tools);
      case 'local':
        return this.callLocal(messages, tools);
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  /**
   * 调用OpenAI API
   */
  private async callOpenAI(messages: LLMMessage[], tools?: any[]): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const defaultUrl = 'https://api.openai.com/v1/chat/completions';
    // 规范化 URL：如果用户只提供了 host，保留默认的 path
    const apiUrl = normalizeOpenAIUrl(this.config.apiUrl, defaultUrl);
    const model = this.config.model || 'gpt-4';

    console.log(`[LLM] Using API URL: ${apiUrl} (original: ${this.config.apiUrl || 'default'})`);

    // 创建带超时的 fetch（120秒超时）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120秒超时
    
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map(msg => {
            const message: any = {
              role: msg.role,
              content: msg.content,
            };
            // 只在需要时添加可选字段
            if (msg.tool_call_id) message.tool_call_id = msg.tool_call_id;
            if (msg.name) message.name = msg.name;
            if (msg.tool_calls) message.tool_calls = msg.tool_calls;
            return message;
          }),
          tools: tools ? tools.map(convertMCPToolToLLMFunction) : undefined,
          tool_choice: tools ? 'auto' : undefined,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const choice = data.choices[0];

      return {
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls?.map((tc: any) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
        finish_reason: choice.finish_reason,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('API request timeout (120s)');
      }
      throw error;
    }
  }

  /**
   * 调用Anthropic API
   */
  private async callAnthropic(messages: LLMMessage[], tools?: any[]): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const defaultUrl = 'https://api.anthropic.com/v1/messages';
    // 规范化 URL：如果用户只提供了 host，保留默认的 path
    const apiUrl = normalizeOpenAIUrl(this.config.apiUrl, defaultUrl);
    const model = this.config.model || 'claude-3-5-sonnet-20241022';
    
    console.log(`[LLM] Using API URL: ${apiUrl} (original: ${this.config.apiUrl || 'default'})`);

    // 转换消息格式（Anthropic使用不同的格式）
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // 创建带超时的 fetch（120秒超时）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120秒超时
    
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: systemMessages.map(m => m.content).join('\n'),
          messages: conversationMessages.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content,
          })),
          tools: tools ? tools.map(convertMCPToolToLLMFunction) : undefined,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.content[0];

      return {
        content: content.text || '',
        tool_calls: content.tool_use ? [{
          id: content.id,
          type: 'function',
          function: {
            name: content.name,
            arguments: JSON.stringify(content.input),
          },
        }] : undefined,
        finish_reason: data.stop_reason,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('API request timeout (120s)');
      }
      throw error;
    }
  }

  /**
   * 调用Ollama API
   * 使用原生 /api/chat 端点
   */
  private async callOllama(messages: LLMMessage[], tools?: any[]): Promise<LLMResponse> {
    if (!this.config.apiUrl) {
      throw new Error('Ollama 服务器地址未配置');
    }

    // Ollama 使用原生 /api/chat 端点
    // 规范化 URL：如果用户只提供了 host（如 http://10.104.4.16:11434），自动拼接 /api/chat
    let apiUrl: string;
    try {
      const userUrl = new URL(this.config.apiUrl);
      // 如果 URL 已经包含路径，检查是否是 /api/chat 或 /v1/chat/completions
      if (userUrl.pathname && userUrl.pathname !== '/' && !userUrl.pathname.includes('/api/chat')) {
        // 如果用户提供了其他路径，直接使用
        apiUrl = this.config.apiUrl;
      } else {
        // 否则使用 /api/chat
        userUrl.pathname = '/api/chat';
        apiUrl = userUrl.toString();
      }
    } catch {
      // URL 解析失败，尝试简单拼接
      const baseUrl = this.config.apiUrl.replace(/\/+$/, '');
      apiUrl = `${baseUrl}/api/chat`;
    }

    const model = this.config.model || 'llama2';

    console.log(`[LLM] Using Ollama API URL: ${apiUrl} (original: ${this.config.apiUrl || 'default'})`);

    // 创建带超时的 fetch（120秒超时）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120秒超时
    
    // 构建请求头，API key 可选（Ollama 通常不需要）
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // 只在有 API key 时添加 Authorization header
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    
    try {
      // 构建请求体，适配 Ollama 的格式
      const requestBody: any = {
        model,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        stream: false, // 非流式响应
      };

      // Ollama 支持 tools，但需要 stream: false
      if (tools && tools.length > 0) {
        requestBody.tools = tools.map(convertMCPToolToLLMFunction);
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new Error(`Ollama API error: ${error.error?.message || response.statusText}`);
      }

      const data = await response.json();
      
      // Ollama 响应格式：{ message: { role, content, tool_calls? }, done, ... }
      // 而不是 OpenAI 的 { choices: [{ message }] }
      const ollamaMessage = data.message || {};
      
      return {
        content: ollamaMessage.content || '',
        tool_calls: ollamaMessage.tool_calls?.map((tc: any) => ({
          id: tc.id || `call_${Date.now()}_${Math.random()}`,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || tc.name,
            arguments: typeof tc.function?.arguments === 'string' 
              ? tc.function.arguments 
              : JSON.stringify(tc.function?.arguments || tc.arguments || {}),
          },
        })),
        finish_reason: data.done_reason || (data.done ? 'stop' : undefined),
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('API request timeout (120s)');
      }
      throw error;
    }
  }

  /**
   * 调用本地模型（需要用户自己实现）
   */
  private async callLocal(messages: LLMMessage[], tools?: any[]): Promise<LLMResponse> {
    // 本地模型需要用户自己实现API端点
    if (!this.config.apiUrl) {
      throw new Error('Local model API URL not configured');
    }

    const response = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        tools,
      }),
    });

    if (!response.ok) {
      throw new Error(`Local model API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  }

  /**
   * 执行工具调用
   * 
   * 优化：直接尝试调用工具，不先列出工具列表
   * 这样可以避免重复的 listTools 调用和 schema 验证问题
   */
  async executeToolCall(toolCall: LLMToolCall): Promise<any> {
    const { name, arguments: argsStr } = toolCall.function;
    const args = JSON.parse(argsStr);

    console.log(`[LLM] Executing tool call: ${name}`);
    console.log(`[LLM] Arguments:`, args);

    // 如果设置了允许的工具列表，检查工具是否在允许列表中
    if (this.allowedToolNames.size > 0 && !this.allowedToolNames.has(name)) {
      throw new Error(`Tool ${name} is not in the allowed tools list. Allowed tools: ${Array.from(this.allowedToolNames).join(', ')}`);
    }

    // 获取所有 MCP 客户端（包括并发连接）
    const clients = mcpManager.getAllClients();
    
    // 尝试在每个客户端上调用工具
    // 第一个成功的调用将被返回
    const errors: Error[] = [];
    
    for (const client of clients.values()) {
      try {
        // 如果设置了允许的工具列表，先检查该客户端是否有这个工具
        if (this.allowedToolNames.size > 0) {
          const clientTools = await client.listTools();
          const hasTool = clientTools.some(t => t.name === name);
          if (!hasTool) {
            console.log(`[LLM] Tool ${name} not found on ${client.getServerInfo().name}, skipping`);
            continue;
          }
        }
        
        console.log(`[LLM] Trying to call ${name} on ${client.getServerInfo().name}`);
        
        // 设置流式输出回调
        const streamCallback = this.onToolStream 
          ? (chunk: any) => {
              this.onToolStream!(name, chunk);
            }
          : undefined;
        
        const result = await client.callTool(name, args, streamCallback);
        console.log(`[LLM] Tool ${name} executed successfully`);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.warn(`[LLM] Failed to call ${name} on ${client.getServerInfo().name}: ${err.message}`);
        errors.push(err);
      }
    }

    // 如果所有客户端都失败了
    if (errors.length > 0) {
      throw new Error(`Tool ${name} failed on all MCP servers. Last error: ${errors[errors.length - 1].message}`);
    } else {
      throw new Error(`Tool ${name} not found in any MCP server (no clients available)`);
    }
  }

  /**
   * 处理用户请求（自动调用MCP工具）
   * @param userInput 用户输入
   * @param systemPrompt 系统提示词（可选）
   * @param tools MCP工具列表（可选，如果不提供则不使用MCP工具）
   */
  async handleUserRequest(userInput: string, systemPrompt?: string, tools?: MCPTool[]): Promise<string> {
    // 只有在明确传入工具列表时才使用MCP工具
    // 如果未传入工具列表，则不获取MCP客户端，避免不必要的连接
    const allTools: MCPTool[] = tools || [];
    
    // 设置允许使用的工具列表（用于限制executeToolCall只使用这些工具）
    this.setAllowedTools(allTools);

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: systemPrompt || (allTools.length > 0 
          ? `你是一个智能助手，可以使用以下工具帮助用户：
${allTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

当用户需要执行操作时，使用相应的工具。`
          : '你是一个智能助手，可以帮助用户完成各种任务。'),
      },
      {
        role: 'user',
        content: userInput,
      },
    ];

    // 增加迭代次数限制，并添加总时间限制（5分钟）
    let maxIterations = 10; // 从5次增加到10次
    let iteration = 0;
    const startTime = Date.now();
    const maxDuration = 5 * 60 * 1000; // 5分钟总超时

    while (iteration < maxIterations) {
      // 检查总时间是否超时
      if (Date.now() - startTime > maxDuration) {
        console.warn(`[LLM] Request timeout after ${maxDuration}ms (${iteration} iterations)`);
        return '处理超时，请重试。';
      }
      const response = await this.chat(messages, allTools.length > 0 ? allTools : undefined);

      if (response.tool_calls && response.tool_calls.length > 0) {
        // 添加 assistant 消息（包含 tool_calls）
        messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });

        // 执行工具调用
        const toolResults = await Promise.all(
          response.tool_calls.map(async (toolCall) => {
            try {
              console.log(`[LLM] Executing tool: ${toolCall.function.name}`);
              const result = await this.executeToolCall(toolCall);
              console.log(`[LLM] Tool result:`, result);
              return {
                tool_call_id: toolCall.id,
                role: 'tool' as const,
                name: toolCall.function.name,
                content: JSON.stringify(result),
              };
            } catch (error: any) {
              console.error(`[LLM] Tool execution error:`, error);
              return {
                tool_call_id: toolCall.id,
                role: 'tool' as const,
                name: toolCall.function.name,
                content: JSON.stringify({ error: error.message }),
              };
            }
          })
        );

        // 添加工具结果
        messages.push(...toolResults);

        iteration++;
      } else {
        // 没有工具调用，返回最终回复
        return response.content;
      }
    }

    return '处理超时，请重试。';
  }
}

/**
 * 获取当前LLM客户端
 */
export function getCurrentLLMClient(): LLMClient | null {
  const config = llmConfigManager.getCurrentConfig();
  if (!config || !config.enabled) {
    return null;
  }
  return new LLMClient(config);
}
