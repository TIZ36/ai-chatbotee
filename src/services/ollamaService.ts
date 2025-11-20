/**
 * Ollama 服务模块
 * 用于与 Ollama 服务器交互，获取模型列表等
 */

export interface OllamaModel {
  name: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: {
    format?: string;
    family?: string;
    families?: string[] | null;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaTagsResponse {
  models: OllamaModel[];
}

/**
 * 获取 Ollama 服务器上的可用模型列表
 * @param serverUrl Ollama 服务器地址（如 http://10.104.4.16:11434）
 * @returns 模型名称数组
 * @throws 如果服务器不可访问或请求失败
 */
export async function fetchOllamaModels(serverUrl: string): Promise<string[]> {
  if (!serverUrl) {
    throw new Error('Ollama 服务器地址不能为空');
  }

  // 规范化 URL：移除尾部斜杠，确保格式正确
  const normalizedUrl = serverUrl.trim().replace(/\/+$/, '');
  
  // 构建 API 端点
  const apiUrl = `${normalizedUrl}/api/tags`;

  try {
    console.log(`[Ollama] 正在获取模型列表: ${apiUrl}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`无法连接到 Ollama 服务器: ${normalizedUrl}。请检查服务器地址是否正确。`);
      }
      throw new Error(`获取模型列表失败: ${response.status} ${response.statusText}`);
    }

    const data: OllamaTagsResponse = await response.json();
    
    if (!data.models || !Array.isArray(data.models)) {
      throw new Error('服务器返回的数据格式不正确');
    }

    const modelNames = data.models.map(model => model.name);
    console.log(`[Ollama] 成功获取 ${modelNames.length} 个模型:`, modelNames);
    
    return modelNames;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('请求超时：无法在10秒内连接到 Ollama 服务器。请检查服务器地址和网络连接。');
    }
    
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      throw new Error(`无法连接到 Ollama 服务器: ${normalizedUrl}。请检查：\n1. 服务器是否正在运行\n2. 地址是否正确\n3. 网络是否可达\n4. 是否存在 CORS 限制（建议使用 Electron 环境）`);
    }
    
    // 重新抛出其他错误
    throw error;
  }
}

