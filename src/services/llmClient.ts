/**
 * LLM客户端服务
 * 支持多种LLM提供商，并与MCP工具集成
 */

import { llmConfigManager, LLMConfig } from './llmConfig';
import { mcpManager, MCPClient, MCPTool } from './mcpClient';
import { GoogleGenAI, Content, Part } from '@google/genai';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: LLMToolCall[];
  // 多模态内容支持
  parts?: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string; // base64 编码的数据
    };
    fileData?: {
      mimeType: string;
      fileUri: string;
    };
    thoughtSignature?: string; // 思维签名（在 part 级别）
  }>;
  // 思维签名（用于 Gemini，整个消息的签名）
  thoughtSignature?: string;
  // 工具调用中的思维签名（用于多步调用）
  // 格式：{ toolCallId: signature }
  toolCallSignatures?: Record<string, string>;
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
  thinking?: string; // 思考过程（用于 o1 等思考模型）
  tool_calls?: LLMToolCall[];
  finish_reason?: string;
  thoughtSignature?: string; // 思维签名（用于 Gemini）
  toolCallSignatures?: Record<string, string>; // 工具调用的思维签名映射
  // 多模态输出支持（图片生成等）
  media?: Array<{
    type: 'image' | 'video';
    mimeType: string;
    data: string; // base64 编码的数据
  }>;
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
   * @param messages 消息列表
   * @param tools 工具列表（可选）
   * @param stream 是否使用流式响应（可选，默认false）
   * @param onChunk 流式响应回调函数（可选，接收 content chunk）
   * @param onThinking 思考过程回调函数（可选，用于流式模式下传递 thinking）
   */
  async chat(
    messages: LLMMessage[], 
    tools?: any[], 
    stream: boolean = false,
    onChunk?: (chunk: string) => void,
    onThinking?: (thinking: string) => void
  ): Promise<LLMResponse> {
    switch (this.config.provider) {
      case 'openai':
        return stream 
          ? this.callOpenAIStream(messages, tools, onChunk, onThinking)
          : this.callOpenAI(messages, tools);
      case 'anthropic':
        return stream
          ? this.callAnthropicStream(messages, tools, onChunk, onThinking)
          : this.callAnthropic(messages, tools);
      case 'ollama':
        return stream
          ? this.callOllamaStream(messages, tools, onChunk, onThinking)
          : this.callOllama(messages, tools);
      case 'gemini':
        return stream
          ? this.callGeminiStream(messages, tools, onChunk, onThinking)
          : this.callGemini(messages, tools);
      case 'local':
        return this.callLocal(messages, tools);
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  /**
   * 调用OpenAI API（流式响应）
   */
  private async callOpenAIStream(
    messages: LLMMessage[], 
    tools?: any[], 
    onChunk?: (chunk: string) => void,
    onThinking?: (thinking: string) => void
  ): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const defaultUrl = 'https://api.openai.com/v1/chat/completions';
    const apiUrl = normalizeOpenAIUrl(this.config.apiUrl, defaultUrl);
    const model = this.config.model || 'gpt-4';

    console.log(`[LLM] Using OpenAI Stream API URL: ${apiUrl}`);

    const controller = new AbortController();
    // 流式响应需要更长的超时时间（10分钟），因为AI可能需要较长时间生成内容
    const timeoutDuration = 10 * 60 * 1000; // 10分钟
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
    
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
            if (msg.tool_call_id) message.tool_call_id = msg.tool_call_id;
            if (msg.name) message.name = msg.name;
            if (msg.tool_calls) message.tool_calls = msg.tool_calls;
            return message;
          }),
          tools: tools ? tools.map(convertMCPToolToLLMFunction) : undefined,
          tool_choice: tools ? 'auto' : undefined,
          stream: true,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
      }

      // 处理流式响应
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let fullThinking = ''; // 思考过程
      let toolCalls: LLMToolCall[] = [];
      let finishReason: string | undefined;
      let lastChunkTime = Date.now(); // 记录最后一次收到数据的时间

      if (!reader) {
        throw new Error('Failed to get response stream');
      }

      // 设置流式读取的超时保护（如果30秒内没有收到新数据，认为超时）
      const streamTimeoutDuration = 30 * 1000; // 30秒
      let streamTimeoutId: ReturnType<typeof setTimeout> | null = null;
      
      const resetStreamTimeout = () => {
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId);
        }
        streamTimeoutId = setTimeout(() => {
          reader.cancel();
          throw new Error(`Stream timeout: no data received for ${streamTimeoutDuration / 1000}s`);
        }, streamTimeoutDuration);
      };
      
      resetStreamTimeout();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // 重置流式读取超时
        resetStreamTimeout();

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              continue;
            }

            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta;
              const choice = json.choices?.[0];
              
              // 处理思考过程（o1 模型）
              // reasoning_content 可能在 delta 中流式返回，也可能在 message 中一次性返回
              if (delta?.reasoning_content) {
                fullThinking += delta.reasoning_content;
                // 实时传递思考过程
                onThinking?.(fullThinking);
              } else if (choice?.message?.reasoning_content) {
                // 如果 message 中有完整的 reasoning_content，直接使用
                fullThinking = choice.message.reasoning_content;
                onThinking?.(fullThinking);
              } else if (json.reasoning_content) {
                // 某些情况下可能在根级别
                fullThinking = json.reasoning_content;
                onThinking?.(fullThinking);
              }
              
              if (delta?.content) {
                fullContent += delta.content;
                onChunk?.(delta.content);
              }

              // 处理工具调用
              if (delta?.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  const index = toolCall.index;
                  if (!toolCalls[index]) {
                    toolCalls[index] = {
                      id: toolCall.id || '',
                      type: 'function',
                      function: {
                        name: '',
                        arguments: '',
                      },
                    };
                  }
                  if (toolCall.function?.name) {
                    toolCalls[index].function.name = toolCall.function.name;
                  }
                  if (toolCall.function?.arguments) {
                    toolCalls[index].function.arguments += toolCall.function.arguments;
                  }
                }
              }

              if (json.choices?.[0]?.finish_reason) {
                finishReason = json.choices[0].finish_reason;
              }
            } catch (e) {
              // 忽略JSON解析错误
              console.warn('[LLM] Failed to parse SSE chunk:', e);
            }
          }
        }
      }
      
      // 清理流式读取超时
      if (streamTimeoutId) {
        clearTimeout(streamTimeoutId);
      }

      return {
        content: fullContent,
        thinking: fullThinking || undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: finishReason,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`API request timeout (${timeoutDuration / 1000}s)`);
      }
      throw error;
    }
  }

  /**
   * 调用OpenAI API（非流式响应）
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

    // 创建带超时的 fetch
    // 流式响应需要更长的超时时间（10分钟），因为AI可能需要较长时间生成内容
    const controller = new AbortController();
    const timeoutDuration = 10 * 60 * 1000; // 10分钟
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
    
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
        thinking: choice.message.reasoning_content || undefined, // 思考过程（o1 模型）
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
        throw new Error(`API request timeout (${timeoutDuration / 1000}s)`);
      }
      throw error;
    }
  }

  /**
   * 调用Anthropic API（流式响应）
   */
  private async callAnthropicStream(
    messages: LLMMessage[], 
    tools?: any[], 
    onChunk?: (chunk: string) => void,
    onThinking?: (thinking: string) => void
  ): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const defaultUrl = 'https://api.anthropic.com/v1/messages';
    const apiUrl = normalizeOpenAIUrl(this.config.apiUrl, defaultUrl);
    const model = this.config.model || 'claude-3-5-sonnet-20241022';
    
    console.log(`[LLM] Using Anthropic Stream API URL: ${apiUrl}`);

    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const controller = new AbortController();
    // 流式响应需要更长的超时时间（10分钟）
    const timeoutDuration = 10 * 60 * 1000; // 10分钟
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
    
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
          stream: true,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        throw new Error(`Anthropic API error: ${error.error?.message || response.statusText}`);
      }

      // 处理流式响应
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let toolCalls: LLMToolCall[] = [];
      let finishReason: string | undefined;

      if (!reader) {
        throw new Error('Failed to get response stream');
      }

      // 设置流式读取的超时保护（如果30秒内没有收到新数据，认为超时）
      const streamTimeoutDuration = 30 * 1000; // 30秒
      let streamTimeoutId: ReturnType<typeof setTimeout> | null = null;
      
      const resetStreamTimeout = () => {
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId);
        }
        streamTimeoutId = setTimeout(() => {
          reader.cancel();
          throw new Error(`Stream timeout: no data received for ${streamTimeoutDuration / 1000}s`);
        }, streamTimeoutDuration);
      };
      
      resetStreamTimeout();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // 重置流式读取超时
        resetStreamTimeout();

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              continue;
            }

            try {
              const json = JSON.parse(data);
              
              if (json.type === 'content_block_delta' && json.delta?.text) {
                fullContent += json.delta.text;
                onChunk?.(json.delta.text);
              }

              if (json.type === 'content_block_stop') {
                finishReason = 'stop';
              }

              if (json.type === 'message_stop') {
                finishReason = json.stop_reason || 'stop';
              }

              // 处理工具调用
              if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
                const toolUse = json.content_block;
                toolCalls.push({
                  id: toolUse.id,
                  type: 'function',
                  function: {
                    name: toolUse.name,
                    arguments: JSON.stringify(toolUse.input || {}),
                  },
                });
              }
            } catch (e) {
              console.warn('[LLM] Failed to parse SSE chunk:', e);
            }
          }
        }
      }
      
      // 清理流式读取超时
      if (streamTimeoutId) {
        clearTimeout(streamTimeoutId);
      }

      return {
        content: fullContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: finishReason,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`API request timeout (${timeoutDuration / 1000}s)`);
      }
      throw error;
    }
  }

  /**
   * 调用Anthropic API（非流式响应）
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

    // 创建带超时的 fetch
    // 流式响应需要更长的超时时间（10分钟），因为AI可能需要较长时间生成内容
    const controller = new AbortController();
    const timeoutDuration = 10 * 60 * 1000; // 10分钟
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
    
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
        throw new Error(`API request timeout (${timeoutDuration / 1000}s)`);
      }
      throw error;
    }
  }

  /**
   * 调用Ollama API（流式响应）
   */
  private async callOllamaStream(
    messages: LLMMessage[], 
    tools?: any[], 
    onChunk?: (chunk: string) => void,
    onThinking?: (thinking: string) => void
  ): Promise<LLMResponse> {
    if (!this.config.apiUrl) {
      throw new Error('Ollama 服务器地址未配置');
    }

    let apiUrl: string;
    try {
      const userUrl = new URL(this.config.apiUrl);
      if (userUrl.pathname && userUrl.pathname !== '/' && !userUrl.pathname.includes('/api/chat')) {
        apiUrl = this.config.apiUrl;
      } else {
        userUrl.pathname = '/api/chat';
        apiUrl = userUrl.toString();
      }
    } catch {
      const baseUrl = this.config.apiUrl.replace(/\/+$/, '');
      apiUrl = `${baseUrl}/api/chat`;
    }

    const model = this.config.model || 'llama2';
    console.log(`[LLM] Using Ollama Stream API URL: ${apiUrl}`);

    const controller = new AbortController();
    // 流式响应需要更长的超时时间（10分钟）
    const timeoutDuration = 10 * 60 * 1000; // 10分钟
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    
    try {
      const requestBody: any = {
        model,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        stream: true,
      };

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

      // 处理流式响应
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let toolCalls: LLMToolCall[] = [];
      let finishReason: string | undefined;

      if (!reader) {
        throw new Error('Failed to get response stream');
      }

      // 设置流式读取的超时保护（如果30秒内没有收到新数据，认为超时）
      const streamTimeoutDuration = 30 * 1000; // 30秒
      let streamTimeoutId: ReturnType<typeof setTimeout> | null = null;
      
      const resetStreamTimeout = () => {
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId);
        }
        streamTimeoutId = setTimeout(() => {
          reader.cancel();
          throw new Error(`Stream timeout: no data received for ${streamTimeoutDuration / 1000}s`);
        }, streamTimeoutDuration);
      };
      
      resetStreamTimeout();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // 重置流式读取超时
        resetStreamTimeout();

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            
            if (json.message?.content) {
              fullContent += json.message.content;
              onChunk?.(json.message.content);
            }

            // 处理工具调用
            if (json.message?.tool_calls) {
              for (const tc of json.message.tool_calls) {
                toolCalls.push({
                  id: tc.id || `call_${Date.now()}_${Math.random()}`,
                  type: tc.type || 'function',
                  function: {
                    name: tc.function?.name || tc.name,
                    arguments: typeof tc.function?.arguments === 'string' 
                      ? tc.function.arguments 
                      : JSON.stringify(tc.function?.arguments || tc.arguments || {}),
                  },
                });
              }
            }

            if (json.done) {
              finishReason = json.done_reason || 'stop';
            }
          } catch (e) {
            // 忽略JSON解析错误
            console.warn('[LLM] Failed to parse Ollama chunk:', e);
          }
        }
      }
      
      // 清理流式读取超时
      if (streamTimeoutId) {
        clearTimeout(streamTimeoutId);
      }

      return {
        content: fullContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: finishReason,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`API request timeout (${timeoutDuration / 1000}s)`);
      }
      throw error;
    }
  }

  /**
   * 调用Ollama API（非流式响应）
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

    // 创建带超时的 fetch
    // 流式响应需要更长的超时时间（10分钟），因为AI可能需要较长时间生成内容
    const controller = new AbortController();
    const timeoutDuration = 10 * 60 * 1000; // 10分钟
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
    
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
        throw new Error(`API request timeout (${timeoutDuration / 1000}s)`);
      }
      throw error;
    }
  }

  /**
   * 调用Gemini API（流式响应）- 使用官方 @google/genai SDK
   */
  private async callGeminiStream(
    messages: LLMMessage[], 
    tools?: any[], 
    onChunk?: (chunk: string) => void,
    onThinking?: (thinking: string) => void
  ): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const model = this.config.model || 'gemini-2.5-flash';
    console.log(`[LLM] Using Gemini SDK with model: ${model}`);

    try {
      // 初始化 Gemini SDK
      const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
      
      // 转换消息格式为 Gemini 格式
      const contents = this.convertMessagesToGeminiContents(messages);
      
      // 调试日志：检查是否有多模态内容
      for (const content of contents) {
        if (content.parts) {
          for (const part of content.parts) {
            if ((part as any).inlineData) {
              const inlineData = (part as any).inlineData;
              console.log(`[LLM] Gemini 多模态内容: mimeType=${inlineData.mimeType}, data长度=${inlineData.data?.length || 0}`);
            }
          }
        }
      }
      
      // 提取 system 消息作为 systemInstruction
      const systemMessages = messages.filter(m => m.role === 'system');
      const systemInstruction = systemMessages.length > 0
        ? systemMessages.map(m => m.content).join('\n\n')
        : undefined;
      
      // 检查模型是否支持图片生成（如 gemini-2.0-flash-exp-image-generation 或包含 image 的模型）
      const supportsImageGeneration = model.toLowerCase().includes('image');
      
      // 如果是图片生成模式，需要重新转换消息，清理 thoughtSignature
      // 因为图片生成模式不支持 thinking，带有 thoughtSignature 的消息会导致 API 报错
      const finalContents = supportsImageGeneration 
        ? this.convertMessagesToGeminiContents(messages, true) // 清理 thoughtSignature
        : contents;
      
      // 构建配置
      const config: any = {
        systemInstruction: systemInstruction,
      };
      
      if (supportsImageGeneration) {
        // 图片生成模式：启用文本和图片输出，禁用 thinking（图片模型不支持）
        config.responseModalities = ['Text', 'Image'];
        console.log(`[LLM] Gemini 图片生成模式已启用 (responseModalities: ['Text', 'Image'])`);
      } else {
        // 非图片生成模式：配置 thinking
        // 默认禁用 thinking 模式，避免 thought_signature 问题
        // 如果需要 thinking，用户可以在 metadata 中设置 enableThinking: true
        config.thinkingConfig = this.config.metadata?.enableThinking 
          ? { thinkingBudget: this.config.metadata?.thinkingBudget || 1024 }
          : { thinkingBudget: 0 };
        console.log(`[LLM] Gemini thinking mode: ${this.config.metadata?.enableThinking ? 'enabled' : 'disabled'}`);
      }
      
      // 添加工具（如果提供）- 图片生成模型可能不支持工具，但仍然尝试添加
      if (tools && tools.length > 0 && !supportsImageGeneration) {
        config.tools = [{
          functionDeclarations: tools.map(tool => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          })),
        }];
      }
      
      console.log(`[LLM] Gemini 请求配置:`, JSON.stringify(config, null, 2));
      
      // 调用流式 API
      const streamingResult = await ai.models.generateContentStream({
        model: model,
        contents: finalContents,
        config: config,
      });
      
      let fullContent = '';
      let fullThinking = '';
      let toolCalls: LLMToolCall[] = [];
      let finishReason: string | undefined;
      let thoughtSignature: string | undefined;
      const toolCallSignatures: Record<string, string> = {};
      // 多模态输出（图片等）
      const media: Array<{ type: 'image' | 'video'; mimeType: string; data: string }> = [];
      
      // 处理流式响应
      let chunkIndex = 0;
      for await (const chunk of streamingResult) {
        chunkIndex++;
        console.log(`[LLM] Gemini chunk #${chunkIndex}:`, 
          `hasText=${!!chunk.text}`,
          `hasCandidates=${!!chunk.candidates}`,
          chunk.candidates ? `parts=${chunk.candidates[0]?.content?.parts?.length || 0}` : ''
        );
        
        // 处理文本内容
        if (chunk.text) {
          fullContent += chunk.text;
          onChunk?.(chunk.text);
        }
        
        // 处理函数调用和多模态输出
        if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
          const parts = chunk.candidates[0].content.parts;
          // 调试日志：显示 parts 的内容类型
          console.log(`[LLM] Gemini response parts count: ${parts.length}, types: ${parts.map(p => {
            if (p.text) return 'text';
            if (p.functionCall) return 'functionCall';
            if ((p as any).inlineData) return `inlineData(${(p as any).inlineData?.mimeType})`;
            return `unknown(${Object.keys(p).join(',')})`;
          }).join(', ')}`);
          
          for (const part of parts) {
            if (part.functionCall) {
              const toolCallId = part.functionCall.name || `call_${Date.now()}_${Math.random()}`;
              const existingIndex = toolCalls.findIndex(
                tc => tc.function.name === part.functionCall?.name
              );
              
              if (existingIndex < 0) {
                toolCalls.push({
                  id: toolCallId,
                  type: 'function',
                  function: {
                    name: part.functionCall.name || '',
                    arguments: JSON.stringify(part.functionCall.args || {}),
                  },
                });
              }
            }
            
            // 处理图片输出（inlineData）
            if ((part as any).inlineData) {
              const inlineData = (part as any).inlineData;
              if (inlineData.mimeType && inlineData.data) {
                const mediaType = inlineData.mimeType.startsWith('video/') ? 'video' : 'image';
                media.push({
                  type: mediaType,
                  mimeType: inlineData.mimeType,
                  data: inlineData.data,
                });
                console.log(`[LLM] Gemini 返回了 ${mediaType}: mimeType=${inlineData.mimeType}, 大小=${Math.round(inlineData.data.length / 1024)}KB`);
              }
            }
            
            // 处理思维签名（如果有）
            if ((part as any).thoughtSignature) {
              thoughtSignature = (part as any).thoughtSignature;
            }
          }
        }
        
        // 处理完成原因
        if (chunk.candidates && chunk.candidates[0]?.finishReason) {
          finishReason = chunk.candidates[0].finishReason;
        }
      }

      console.log(`[LLM] Gemini 流式响应完成: content长度=${fullContent.length}, media数量=${media.length}, toolCalls数量=${toolCalls.length}`);
      
      return {
        content: fullContent,
        thinking: fullThinking || undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: finishReason,
        thoughtSignature: thoughtSignature,
        toolCallSignatures: Object.keys(toolCallSignatures).length > 0 ? toolCallSignatures : undefined,
        media: media.length > 0 ? media : undefined,
      };
    } catch (error: any) {
      console.error('[LLM] Gemini API error:', error);
      throw new Error(`Gemini API error: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * 调用Gemini API（非流式响应）- 使用官方 @google/genai SDK
   */
  private async callGemini(messages: LLMMessage[], tools?: any[]): Promise<LLMResponse> {
    if (!this.config.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const model = this.config.model || 'gemini-2.5-flash';
    console.log(`[LLM] Using Gemini SDK with model: ${model}`);

    try {
      // 初始化 Gemini SDK
      const ai = new GoogleGenAI({ apiKey: this.config.apiKey });
      
      // 转换消息格式为 Gemini 格式
      const contents = this.convertMessagesToGeminiContents(messages);
      
      // 提取 system 消息作为 systemInstruction
      const systemMessages = messages.filter(m => m.role === 'system');
      const systemInstruction = systemMessages.length > 0
        ? systemMessages.map(m => m.content).join('\n\n')
        : undefined;
      
      // 检查模型是否支持图片生成（如 gemini-2.0-flash-exp-image-generation 或包含 image 的模型）
      const supportsImageGeneration = model.toLowerCase().includes('image');
      
      // 如果是图片生成模式，需要重新转换消息，清理 thoughtSignature
      const finalContents = supportsImageGeneration 
        ? this.convertMessagesToGeminiContents(messages, true) // 清理 thoughtSignature
        : contents;
      
      // 构建配置
      const config: any = {
        systemInstruction: systemInstruction,
      };
      
      if (supportsImageGeneration) {
        // 图片生成模式：启用文本和图片输出，禁用 thinking（图片模型不支持）
        config.responseModalities = ['Text', 'Image'];
        console.log(`[LLM] Gemini 图片生成模式已启用 (responseModalities: ['Text', 'Image'])`);
      } else {
        // 非图片生成模式：配置 thinking
        config.thinkingConfig = this.config.metadata?.enableThinking 
          ? { thinkingBudget: this.config.metadata?.thinkingBudget || 1024 }
          : { thinkingBudget: 0 };
      }
      
      // 添加工具（如果提供）- 图片生成模型可能不支持工具
      if (tools && tools.length > 0 && !supportsImageGeneration) {
        config.tools = [{
          functionDeclarations: tools.map(tool => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
          })),
        }];
      }
      
      // 调用非流式 API
      const response = await ai.models.generateContent({
        model: model,
        contents: finalContents,
        config: config,
      });
      
      let fullContent = '';
      let toolCalls: LLMToolCall[] = [];
      let thoughtSignature: string | undefined;
      const toolCallSignatures: Record<string, string> = {};
      // 多模态输出（图片等）
      const media: Array<{ type: 'image' | 'video'; mimeType: string; data: string }> = [];
      
      // 处理响应文本
      if (response.text) {
        fullContent = response.text;
      }
      
      // 处理函数调用、图片输出和其他内容
      if (response.candidates && response.candidates[0]?.content?.parts) {
        const parts = response.candidates[0].content.parts;
        // 调试日志：显示 parts 的内容类型
        console.log(`[LLM] Gemini response parts count: ${parts.length}, types: ${parts.map(p => {
          if (p.text) return 'text';
          if (p.functionCall) return 'functionCall';
          if ((p as any).inlineData) return 'inlineData';
          return 'unknown';
        }).join(', ')}`);
        
        for (const part of parts) {
          if (part.functionCall) {
            const toolCallId = part.functionCall.name || `call_${Date.now()}`;
            toolCalls.push({
              id: toolCallId,
              type: 'function',
              function: {
                name: part.functionCall.name || '',
                arguments: JSON.stringify(part.functionCall.args || {}),
              },
            });
          }
          
          // 处理图片输出（inlineData）
          if ((part as any).inlineData) {
            const inlineData = (part as any).inlineData;
            if (inlineData.mimeType && inlineData.data) {
              const mediaType = inlineData.mimeType.startsWith('video/') ? 'video' : 'image';
              media.push({
                type: mediaType,
                mimeType: inlineData.mimeType,
                data: inlineData.data,
              });
              console.log(`[LLM] Gemini 返回了 ${mediaType}: mimeType=${inlineData.mimeType}, 大小=${Math.round(inlineData.data.length / 1024)}KB`);
            }
          }
          
          // 处理思维签名（如果有）
          if ((part as any).thoughtSignature) {
            thoughtSignature = (part as any).thoughtSignature;
          }
        }
      }

      return {
        content: fullContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        finish_reason: response.candidates?.[0]?.finishReason,
        thoughtSignature: thoughtSignature,
        toolCallSignatures: Object.keys(toolCallSignatures).length > 0 ? toolCallSignatures : undefined,
        media: media.length > 0 ? media : undefined,
      };
    } catch (error: any) {
      console.error('[LLM] Gemini API error:', error);
      throw new Error(`Gemini API error: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * 将 LLMMessage 格式转换为 Gemini SDK 的 Content 格式
   * @param messages 消息列表
   * @param stripThoughtSignatures 是否清理 thoughtSignature（图片生成模式需要）
   */
  private convertMessagesToGeminiContents(messages: LLMMessage[], stripThoughtSignatures: boolean = false): Content[] {
    const contents: Content[] = [];
    let currentUserParts: Part[] = [];
    
    // 如果是图片生成模式，只保留最近的消息，避免 thought_signature 冲突
    // Gemini 图片生成模式不支持 thinking，如果历史消息中有 thinking 相关内容会导致 API 报错
    let processMessages = messages;
    if (stripThoughtSignatures) {
      // 找到最后一条用户消息的索引
      const lastUserIndex = messages.findLastIndex(m => m.role === 'user');
      if (lastUserIndex >= 0) {
        // 只保留 system 消息和最后一条用户消息
        processMessages = messages.filter((m, i) => m.role === 'system' || i === lastUserIndex);
        console.log(`[LLM] 图片生成模式: 简化历史消息，从 ${messages.length} 条减少到 ${processMessages.length} 条`);
      }
    }
    
    for (const msg of processMessages) {
      // 跳过 system 消息（它们会在调用 API 时作为 systemInstruction 处理）
      if (msg.role === 'system') {
        continue;
      }
      
      if (msg.role === 'user') {
        // 如果之前有累积的 user parts，先提交
        if (currentUserParts.length > 0) {
          contents.push({ role: 'user', parts: currentUserParts });
          currentUserParts = [];
        }
        
        // 处理多模态内容
        if (msg.parts && msg.parts.length > 0) {
          for (const part of msg.parts) {
            if (part.text && part.text.trim()) {
              currentUserParts.push({ text: part.text });
            }
            
            if (part.inlineData) {
              currentUserParts.push({
                inlineData: {
                  mimeType: part.inlineData.mimeType,
                  data: part.inlineData.data,
                },
              } as Part);
            }
          }
        } else if (msg.content && msg.content.trim()) {
          currentUserParts.push({ text: msg.content });
        }
      } else if (msg.role === 'assistant') {
        // 如果之前有累积的 user parts，先提交
        if (currentUserParts.length > 0) {
          contents.push({ role: 'user', parts: currentUserParts });
          currentUserParts = [];
        }
        
        const modelParts: Part[] = [];
        
        // 处理文本内容
        if (msg.content) {
          modelParts.push({ text: msg.content });
        }
        
        // 处理工具调用
        if (msg.tool_calls) {
          for (const toolCall of msg.tool_calls) {
            try {
              const args = JSON.parse(toolCall.function.arguments || '{}');
              modelParts.push({
                functionCall: {
                  name: toolCall.function.name,
                  args: args,
                },
              } as Part);
            } catch (e) {
              console.warn('[LLM] Failed to parse tool call arguments:', e);
            }
          }
        }
        
        if (modelParts.length > 0) {
          contents.push({ role: 'model', parts: modelParts });
        }
      } else if (msg.role === 'tool') {
        // 工具响应
        try {
          const response = JSON.parse(msg.content || '{}');
          currentUserParts.push({
            functionResponse: {
              name: msg.name || '',
              response: response,
            },
          } as Part);
        } catch (e) {
          console.warn('[LLM] Failed to parse tool response:', e);
          currentUserParts.push({
            functionResponse: {
              name: msg.name || '',
              response: { error: msg.content || 'Unknown error' },
            },
          } as Part);
        }
      }
    }
    
    // 处理剩余的 user parts
    if (currentUserParts.length > 0) {
      contents.push({ role: 'user', parts: currentUserParts });
    }
    
    return contents;
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
   * @param stream 是否使用流式响应（可选，默认false）
   * @param onChunk 流式响应回调函数（可选，接收 content 和 thinking）
   */
  async handleUserRequest(
    userInput: string, 
    systemPrompt?: string, 
    tools?: MCPTool[],
    stream: boolean = false,
    onChunk?: (chunk: string, thinking?: string) => void
  ): Promise<string> {
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
      
      // 注意：handleUserRequest 方法不支持 thinking，只返回 content
      // 如果需要 thinking，请使用 handleUserRequestWithThinking
      const response = await this.chat(
        messages, 
        allTools.length > 0 ? allTools : undefined,
        stream,
        stream ? (chunk: string) => {
          // 流式模式下，onChunk 只接收 content
          onChunk?.(chunk);
        } : undefined,
        undefined // handleUserRequest 不支持 thinking
      );

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
        // 注意：这里只返回 content，thinking 需要通过其他方式传递
        // 由于返回类型是 string，我们需要修改返回类型或使用其他方式
        return response.content;
      }
    }

    return '处理超时，请重试。';
  }

  /**
   * 处理用户请求（返回完整响应，包括思考过程）
   * 用于需要获取思考过程的场景
   */
  async handleUserRequestWithThinking(
    userInput: string, 
    systemPrompt?: string, 
    tools?: MCPTool[],
    stream: boolean = false,
    onChunk?: (content: string, thinking?: string) => void,
    messageHistory?: LLMMessage[], // 添加消息历史参数
    onStepChange?: (step: string) => void // 添加步骤变化回调
  ): Promise<{ content: string; thinking?: string; thoughtSignature?: string; toolCallSignatures?: Record<string, string>; media?: Array<{ type: 'image' | 'video'; mimeType: string; data: string }> }> {
    // 设置允许使用的工具列表
    const allTools: MCPTool[] = tools || [];
    this.setAllowedTools(allTools);

    // 构建消息数组：系统消息 + 历史消息 + 当前用户消息
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: systemPrompt || (allTools.length > 0 
          ? `你是一个智能助手，可以使用以下工具帮助用户：
${allTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

当用户需要执行操作时，使用相应的工具。`
          : '你是一个智能助手，可以帮助用户完成各种任务。'),
      },
    ];
    
    // 如果有历史消息，添加到消息数组中（排除系统消息）
    if (messageHistory && messageHistory.length > 0) {
      const historyMessages = messageHistory.filter(msg => msg.role !== 'system');
      messages.push(...historyMessages);
    }
    
    // 添加当前用户消息（支持多模态）
    // 注意：如果 messageHistory 中已经包含了用户消息（包含多模态内容），这里不需要重复添加
    // 检查最后一条消息是否是用户消息
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      // 如果没有用户消息，添加新的用户消息
    messages.push({
      role: 'user',
      content: userInput,
    });
    } else if (lastMessage.role === 'user' && !lastMessage.parts) {
      // 如果最后一条消息是用户消息但没有多模态内容，更新内容
      lastMessage.content = userInput;
    }
    // 如果最后一条消息已经是用户消息且包含多模态内容，则不需要添加（已在 messageHistory 中）

    let maxIterations = 10;
    let iteration = 0;
    const startTime = Date.now();
    const maxDuration = 5 * 60 * 1000;

    let accumulatedThinking = ''; // 移到循环外部，确保在多次迭代中保持
    
    while (iteration < maxIterations) {
      if (Date.now() - startTime > maxDuration) {
        console.warn(`[LLM] Request timeout after ${maxDuration}ms (${iteration} iterations)`);
        return { content: '处理超时，请重试。', thinking: accumulatedThinking || undefined };
      }
      
      // 创建一个包装的 onThinking，用于在流式模式下传递 thinking
      const wrappedOnThinking = stream ? (thinking: string) => {
        accumulatedThinking = thinking;
        // 思考过程流式更新时，立即通过 onChunk 传递（传递空 content，只更新 thinking）
        onChunk?.('', thinking);
      } : undefined;
      
      // 创建一个包装的 onChunk，用于在流式模式下传递 content 和 thinking
      const wrappedOnChunk = stream ? (chunk: string) => {
        // 在流式模式下，每次收到 content chunk 时，同时传递当前的 thinking
        onChunk?.(chunk, accumulatedThinking || undefined);
      } : undefined;
      
      const response = await this.chat(
        messages, 
        allTools.length > 0 ? allTools : undefined,
        stream,
        wrappedOnChunk,
        wrappedOnThinking
      );

      // 收集思考过程（优先使用 response 中的，否则使用流式过程中收集的）
      if (response.thinking) {
        accumulatedThinking = response.thinking;
        // 如果有新的 thinking，也通过 onChunk 通知（传递空 content chunk）
        if (stream && onChunk) {
          onChunk('', accumulatedThinking);
        }
      }

      if (response.tool_calls && response.tool_calls.length > 0) {
        // 构建 assistant 消息，包含思维签名
        const assistantMsg: LLMMessage = {
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        };
        
        // 添加思维签名
        if (response.thoughtSignature) {
          assistantMsg.thoughtSignature = response.thoughtSignature;
        }
        
        // 添加工具调用的思维签名
        if (response.toolCallSignatures) {
          assistantMsg.toolCallSignatures = response.toolCallSignatures;
        }
        
        messages.push(assistantMsg);

        const toolResults = await Promise.all(
          response.tool_calls.map(async (toolCall) => {
            try {
              // 更新步骤：正在调用工具
              onStepChange?.(`正在调用工具: ${toolCall.function.name}`);
              console.log(`[LLM] Executing tool: ${toolCall.function.name}`);
              const result = await this.executeToolCall(toolCall);
              console.log(`[LLM] Tool result:`, result);
              // 工具调用完成，清除步骤提示
              onStepChange?.('');
              
              // 构建工具响应消息，包含思维签名
              const toolMsg: LLMMessage = {
                tool_call_id: toolCall.id,
                role: 'tool' as const,
                name: toolCall.function.name,
                content: JSON.stringify(result),
              };
              
              // 如果有工具调用的思维签名，添加到工具消息中
              if (response.toolCallSignatures && response.toolCallSignatures[toolCall.id]) {
                toolMsg.thoughtSignature = response.toolCallSignatures[toolCall.id];
              }
              
              return toolMsg;
            } catch (error: any) {
              console.error(`[LLM] Tool execution error:`, error);
              // 工具调用失败，清除步骤提示
              onStepChange?.('');
              
              // 构建错误响应，也包含思维签名（如果有）
              const toolMsg: LLMMessage = {
                tool_call_id: toolCall.id,
                role: 'tool' as const,
                name: toolCall.function.name,
                content: JSON.stringify({ error: error.message }),
              };
              
              if (response.toolCallSignatures && response.toolCallSignatures[toolCall.id]) {
                toolMsg.thoughtSignature = response.toolCallSignatures[toolCall.id];
              }
              
              return toolMsg;
            }
          })
        );

        messages.push(...toolResults);
        iteration++;
      } else {
        return {
          content: response.content,
          thinking: accumulatedThinking || response.thinking,
          thoughtSignature: response.thoughtSignature, // 返回思维签名
          toolCallSignatures: response.toolCallSignatures, // 返回工具调用的思维签名
          media: response.media, // 返回多模态输出（图片等）
        };
      }
    }

    return { content: '处理超时，请重试。' };
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
