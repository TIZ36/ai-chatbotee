/**
 * 统一的API客户端
 * 用于与Golang微服务后端通信
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface ApiResponse<T = any> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    
    const defaultHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // 健康检查
  async health(): Promise<ApiResponse> {
    return this.request('/api/health');
  }

  // 设置相关
  async getSettings(): Promise<{ settings: Record<string, string> }> {
    return this.request('/api/settings');
  }

  async updateSettings(settings: Record<string, string>): Promise<{ success: boolean; settings: Record<string, string> }> {
    return this.request('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ settings }),
    });
  }

  async validateDirectory(path: string): Promise<{ valid: boolean; message: string; suggested_path?: string }> {
    return this.request('/api/settings/validate-dir', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  // 下载任务相关
  async listDownloadTasks(params?: { status?: string; limit?: number; offset?: number }): Promise<{ tasks: any[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.append('status', params.status);
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());
    
    const queryString = query.toString();
    return this.request(`/api/download/tasks${queryString ? `?${queryString}` : ''}`);
  }

  async createDownloadTask(task: {
    videoId: string;
    videoUrl: string;
    quality?: string;
    format?: string;
  }): Promise<any> {
    return this.request('/api/download', {
      method: 'POST',
      body: JSON.stringify(task),
    });
  }

  async batchDownload(videos: Array<{
    videoId: string;
    videoUrl: string;
    quality?: string;
    format?: string;
  }>): Promise<{ success: boolean; task_ids: string[]; message: string }> {
    return this.request('/api/download/batch', {
      method: 'POST',
      body: JSON.stringify({ videos }),
    });
  }

  async getDownloadTask(taskId: string): Promise<any> {
    return this.request(`/api/download/tasks/${taskId}`);
  }

  async pauseDownloadTask(taskId: string): Promise<{ success: boolean }> {
    return this.request(`/api/download/tasks/${taskId}/pause`, {
      method: 'POST',
    });
  }

  async resumeDownloadTask(taskId: string): Promise<{ success: boolean }> {
    return this.request(`/api/download/tasks/${taskId}/resume`, {
      method: 'POST',
    });
  }

  async deleteDownloadTask(taskId: string): Promise<{ success: boolean }> {
    return this.request(`/api/download/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  // 项目相关
  async listProjects(params?: { limit?: number; offset?: number }): Promise<{ projects: any[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());
    
    const queryString = query.toString();
    return this.request(`/api/projects${queryString ? `?${queryString}` : ''}`);
  }

  async createProject(project: {
    name: string;
    searchQuery?: string;
    filters?: any;
  }): Promise<any> {
    return this.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(project),
    });
  }

  async getProject(projectId: string): Promise<any> {
    return this.request(`/api/projects/${projectId}`);
  }

  async updateProject(projectId: string, project: {
    name?: string;
    searchQuery?: string;
    filters?: any;
  }): Promise<any> {
    return this.request(`/api/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(project),
    });
  }

  async deleteProject(projectId: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  // 终端相关
  async createTerminal(params?: {
    cwd?: string;
    shell?: string;
    env?: Record<string, string>;
  }): Promise<{ terminal_id: string; pid: number; success: boolean; message: string }> {
    return this.request('/api/terminal/create', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  async writeToTerminal(terminalId: string, data: string): Promise<{ bytes_written: number; success: boolean; message: string }> {
    // 将字符串转换为字节数组
    const encoder = new TextEncoder();
    const bytes = Array.from(encoder.encode(data));
    
    return this.request(`/api/terminal/${terminalId}/write`, {
      method: 'POST',
      body: JSON.stringify({ data: bytes }),
    });
  }

  // 创建 SSE 流式读取终端的 EventSource
  createTerminalStream(terminalId: string): EventSource {
    return new EventSource(`${this.baseURL}/api/terminal/${terminalId}/stream`);
  }

  async resizeTerminal(terminalId: string, cols: number, rows: number): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/terminal/${terminalId}/resize`, {
      method: 'POST',
      body: JSON.stringify({ cols, rows }),
    });
  }

  // 分发相关
  async publishMedia(params: {
    platform: string;
    content: {
      type: string;
      file_path: string;
      title: string;
      description?: string;
      tags?: string[];
      thumbnail_path?: string;
    };
    options?: {
      is_public?: boolean;
      category?: string;
      language?: string;
      custom_options?: Record<string, string>;
    };
  }): Promise<{ task_id: string; success: boolean; message: string }> {
    return this.request('/api/distribution/publish', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async listPublishTasks(params?: {
    platform?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ tasks: any[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.platform) query.append('platform', params.platform);
    if (params?.status) query.append('status', params.status);
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());
    
    const queryString = query.toString();
    return this.request(`/api/distribution/tasks${queryString ? `?${queryString}` : ''}`);
  }

  // 文件系统相关
  async listFiles(path?: string, recursive?: boolean): Promise<{ files: FileInfo[] }> {
    const query = new URLSearchParams();
    if (path) query.append('path', path);
    if (recursive) query.append('recursive', 'true');
    
    const queryString = query.toString();
    return this.request(`/api/files${queryString ? `?${queryString}` : ''}`);
  }

  async getFileInfo(path: string): Promise<FileInfo> {
    return this.request(`/api/files/info?path=${encodeURIComponent(path)}`);
  }

  async createDirectory(path: string, recursive?: boolean): Promise<{ success: boolean; message: string }> {
    return this.request('/api/files/directory', {
      method: 'POST',
      body: JSON.stringify({ path, recursive }),
    });
  }

  async getDownloadDir(): Promise<{ path: string }> {
    return this.request('/api/files/download-dir');
  }

  async setDownloadDir(path: string): Promise<{ success: boolean; message: string }> {
    return this.request('/api/files/download-dir', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }
}

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_time: string;
  mode: string;
}

// 导出单例
export const apiClient = new ApiClient();

