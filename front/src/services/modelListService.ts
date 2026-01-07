/**
 * 模型列表加载服务
 * 支持从各种 LLM Provider 的 API 端点自动加载模型列表
 */

export interface ModelInfo {
  id: string;
  name?: string;
  created?: number;
  owned_by?: string;
}

/**
 * 从 OpenAI 兼容的 API 加载模型列表（通过后端代理）
 * 支持端点：/v1/models
 */
export async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey?: string
): Promise<string[]> {
  if (!baseUrl) {
    throw new Error('API URL 不能为空');
  }

  try {
    // 使用后端代理，避免 CORS 问题
    const { getBackendUrl } = await import('../utils/backendUrl');
    const backendUrl = getBackendUrl();
    const proxyUrl = `${backendUrl}/api/llm/models`;
    
    // 构建查询参数
    const params = new URLSearchParams({
      api_url: baseUrl,
    });
    
    if (apiKey) {
      params.append('api_key', apiKey);
    }
    
    const fullUrl = `${proxyUrl}?${params.toString()}`;
    
    console.log(`[ModelList] 正在通过后端代理获取模型列表: ${baseUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时（包含后端处理时间）

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      const errorMessage = errorData.error || `获取模型列表失败: ${response.status} ${response.statusText}`;
      
      if (response.status === 401) {
        throw new Error('API Key 无效或未授权');
      }
      if (response.status === 404) {
        throw new Error(`无法找到模型列表端点。请检查 URL 是否正确。`);
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    // 后端返回格式：{ models: [...], total: ... }
    if (data.models && Array.isArray(data.models)) {
      console.log(`[ModelList] 成功获取 ${data.models.length} 个模型:`, data.models);
      return data.models;
    }

    throw new Error('服务器返回的数据格式不正确');
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时：无法在15秒内连接到服务器。请检查 URL 和网络连接。');
    }
    if (error.message) {
      throw error;
    }
    throw new Error(`获取模型列表失败: ${error.message || String(error)}`);
  }
}

/**
 * 从 Anthropic API 加载模型列表（通过后端代理）
 */
export async function fetchAnthropicModels(
  baseUrl: string,
  apiKey?: string
): Promise<string[]> {
  if (!baseUrl || !apiKey) {
    return [];
  }

  try {
    const { getBackendUrl } = await import('../utils/backendUrl');
    const backendUrl = getBackendUrl();
    const proxyUrl = `${backendUrl}/api/llm/models`;
    
    const params = new URLSearchParams({
      api_url: baseUrl,
      api_key: apiKey,
      provider: 'anthropic',
    });
    
    const fullUrl = `${proxyUrl}?${params.toString()}`;
    
    console.log(`[ModelList] 正在通过后端代理获取 Anthropic 模型列表: ${baseUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      const errorMessage = errorData.error || `获取模型列表失败: ${response.status} ${response.statusText}`;
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    if (data.models && Array.isArray(data.models)) {
      console.log(`[ModelList] 成功获取 ${data.models.length} 个 Anthropic 模型:`, data.models);
      return data.models;
    }

    throw new Error('服务器返回的数据格式不正确');
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时：无法在15秒内连接到服务器。请检查 URL 和网络连接。');
    }
    if (error.message) {
      throw error;
    }
    throw new Error(`获取模型列表失败: ${error.message || String(error)}`);
  }
}

/**
 * 从 Gemini API 加载模型列表（通过后端代理）
 */
export async function fetchGeminiModels(
  baseUrl: string,
  apiKey?: string
): Promise<string[]> {
  if (!baseUrl || !apiKey) {
    return [];
  }

  try {
    const { getBackendUrl } = await import('../utils/backendUrl');
    const backendUrl = getBackendUrl();
    const proxyUrl = `${backendUrl}/api/llm/models`;
    
    const params = new URLSearchParams({
      api_url: baseUrl,
      api_key: apiKey,
      provider: 'gemini',
    });
    
    const fullUrl = `${proxyUrl}?${params.toString()}`;
    
    console.log(`[ModelList] 正在通过后端代理获取 Gemini 模型列表: ${baseUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      const errorMessage = errorData.error || `获取模型列表失败: ${response.status} ${response.statusText}`;
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    if (data.models && Array.isArray(data.models)) {
      console.log(`[ModelList] 成功获取 ${data.models.length} 个 Gemini 模型:`, data.models);
      return data.models;
    }

    throw new Error('服务器返回的数据格式不正确');
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时：无法在15秒内连接到服务器。请检查 URL 和网络连接。');
    }
    if (error.message) {
      throw error;
    }
    throw new Error(`获取模型列表失败: ${error.message || String(error)}`);
  }
}

/**
 * 根据 Provider 类型加载模型列表
 */
export async function fetchModelsForProvider(
  provider: string,
  apiUrl?: string,
  apiKey?: string
): Promise<string[]> {
  if (!apiUrl) {
    return [];
  }

  switch (provider.toLowerCase()) {
    case 'openai':
    case 'deepseek':
    case 'custom':
      // OpenAI 兼容的 API（包括 NVIDIA）
      return fetchOpenAICompatibleModels(apiUrl, apiKey);
    
    case 'anthropic':
    case 'claude':
      // Anthropic 不提供模型列表 API
      return fetchAnthropicModels();
    
    case 'gemini':
    case 'google':
      // Gemini 模型列表
      return fetchGeminiModels(apiUrl, apiKey);
    
    case 'ollama':
    case 'local':
      // Ollama 使用单独的服务
      // 这里不处理，由 ollamaService 处理
      return [];
    
    default:
      // 默认尝试 OpenAI 兼容格式
      try {
        return await fetchOpenAICompatibleModels(apiUrl, apiKey);
      } catch {
        return [];
      }
  }
}
