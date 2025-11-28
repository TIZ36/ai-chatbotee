/**
 * LLM配置API服务
 * 调用后端API管理LLM配置
 */

const API_BASE_URL = 'http://localhost:3002/api/llm';

export interface LLMConfigFromDB {
  config_id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'local' | 'custom' | 'ollama' | 'gemini';
  api_url?: string;
  model?: string;
  tags?: string[];
  enabled: boolean;
  description?: string;
  metadata?: Record<string, any>;
  max_tokens?: number; // 模型的最大 token 限制（从后端获取）
  created_at: string;
  updated_at: string;
}

export interface CreateLLMConfigRequest {
  config_id?: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'local' | 'custom' | 'ollama' | 'gemini';
  api_key?: string;
  api_url?: string;
  model?: string;
  tags?: string[];
  enabled?: boolean;
  description?: string;
  metadata?: Record<string, any>;
}

/**
 * 获取所有LLM配置
 */
export async function getLLMConfigs(): Promise<LLMConfigFromDB[]> {
  const response = await fetch(`${API_BASE_URL}/configs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch LLM configs: ${response.statusText}`);
  }
  const data = await response.json();
  return data.configs || [];
}

/**
 * 获取单个LLM配置
 */
export async function getLLMConfig(configId: string): Promise<LLMConfigFromDB> {
  const response = await fetch(`${API_BASE_URL}/configs/${configId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch LLM config: ${response.statusText}`);
  }
  return response.json();
}

/**
 * 创建LLM配置
 */
export async function createLLMConfig(config: CreateLLMConfigRequest): Promise<{ config_id: string; message: string }> {
  const response = await fetch(`${API_BASE_URL}/configs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    throw new Error(`Failed to create LLM config: ${error.error?.message || response.statusText}`);
  }
  return response.json();
}

/**
 * 更新LLM配置
 */
export async function updateLLMConfig(configId: string, updates: Partial<CreateLLMConfigRequest>): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/configs/${configId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    throw new Error(`Failed to update LLM config: ${error.error?.message || response.statusText}`);
  }
  return response.json();
}

/**
 * 删除LLM配置
 */
export async function deleteLLMConfig(configId: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/configs/${configId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    throw new Error(`Failed to delete LLM config: ${error.error?.message || response.statusText}`);
  }
  return response.json();
}

/**
 * 获取LLM配置的API密钥（用于调用）
 */
export async function getLLMConfigApiKey(configId: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/configs/${configId}/api-key`);
  if (!response.ok) {
    throw new Error(`Failed to get API key: ${response.statusText}`);
  }
  const data = await response.json();
  return data.api_key || '';
}

