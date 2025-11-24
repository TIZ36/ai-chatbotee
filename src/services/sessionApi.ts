/**
 * 会话和消息管理 API 服务
 */

export interface Session {
  session_id: string;
  title?: string;
  llm_config_id?: string;
  created_at?: string;
  updated_at?: string;
  last_message_at?: string;
  message_count?: number;
}

export interface Message {
  message_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string;
  tool_calls?: any;
  token_count?: number;
  created_at?: string;
  tool_type?: 'workflow' | 'mcp'; // 感知组件类型（当 role === 'tool' 时使用）
}

export interface Summary {
  summary_id: string;
  session_id: string;
  summary_content: string;
  last_message_id?: string;
  token_count_before?: number;
  token_count_after?: number;
  created_at?: string;
}

export interface MessageExecution {
  execution_id: string;
  message_id: string;
  component_type: 'mcp' | 'workflow';
  component_id: string;
  component_name?: string;
  llm_config_id?: string;
  input?: string;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  error_message?: string;
  created_at?: string;
  updated_at?: string;
}

const API_BASE = 'http://localhost:3002/api';

/**
 * 获取会话列表
 */
export async function getSessions(): Promise<Session[]> {
  try {
    const response = await fetch(`${API_BASE}/sessions`);
    if (!response.ok) {
      // 如果后端未运行或返回错误，返回空数组而不是抛出错误
      console.warn(`Failed to fetch sessions: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    return data.sessions || [];
  } catch (error) {
    // 网络错误或其他错误，返回空数组
    console.warn('Error fetching sessions:', error);
    return [];
  }
}

/**
 * 创建新会话
 */
export async function createSession(
  llm_config_id?: string,
  title?: string
): Promise<Session> {
  const response = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      llm_config_id,
      title,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.statusText}`);
  }
  const data = await response.json();
  return data;
}

/**
 * 获取会话详情
 */
export async function getSession(session_id: string): Promise<Session> {
  const response = await fetch(`${API_BASE}/sessions/${session_id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch session: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 获取会话消息（分页）
 */
export async function getSessionMessages(
  session_id: string,
  page: number = 1,
  page_size: number = 20  // 默认只加载20条，加快初始加载速度
): Promise<{
  messages: Message[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}> {
  try {
    const response = await fetch(
      `${API_BASE}/sessions/${session_id}/messages?page=${page}&page_size=${page_size}`
    );
    if (!response.ok) {
      console.warn(`Failed to fetch messages: ${response.statusText}`);
      return { messages: [], total: 0, page, page_size, total_pages: 0 };
    }
    return await response.json();
  } catch (error) {
    console.warn('Error fetching messages:', error);
    return { messages: [], total: 0, page, page_size, total_pages: 0 };
  }
}

/**
 * 保存消息到会话
 */
export async function saveMessage(
  session_id: string,
    message: {
      message_id?: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      thinking?: string;
      tool_calls?: any;
      model?: string;
      toolType?: 'workflow' | 'mcp'; // 感知组件类型（当 role === 'tool' 时使用）
      workflowId?: string;
      workflowName?: string;
      workflowStatus?: 'pending' | 'running' | 'completed' | 'error';
      acc_token?: number; // 可选：手动指定累积 token（用于总结消息等特殊情况）
    }
): Promise<{ message_id: string; token_count: number }> {
  // 如果是工具消息（感知组件），将工作流信息存储在 tool_calls 中
  if (message.role === 'tool' && (message.workflowId || message.toolType)) {
    message.tool_calls = {
      ...message.tool_calls,
      toolType: message.toolType, // 使用 toolType 而不是 workflowType
      workflowId: message.workflowId,
      workflowName: message.workflowName,
      workflowStatus: message.workflowStatus,
      // 兼容旧数据：同时保存 workflowType
      workflowType: message.toolType,
    };
  }
  const response = await fetch(`${API_BASE}/sessions/${session_id}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    throw new Error(`Failed to save message: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 总结会话内容
 */
export async function summarizeSession(
  session_id: string,
  params: {
    llm_config_id: string;
    model: string;
    messages: Array<{ message_id?: string; role: string; content: string; token_count?: number }>;
  }
): Promise<Summary> {
  const response = await fetch(`${API_BASE}/sessions/${session_id}/summarize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(`Failed to summarize session: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 获取会话的所有总结
 */
export async function getSessionSummaries(session_id: string): Promise<Summary[]> {
  try {
    const response = await fetch(`${API_BASE}/sessions/${session_id}/summaries`);
    if (!response.ok) {
      console.warn(`Failed to fetch summaries: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    return data.summaries || [];
  } catch (error) {
    console.warn('Error fetching summaries:', error);
    return [];
  }
}

/**
 * 删除会话
 */
export async function deleteSession(session_id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/sessions/${session_id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to delete session: ${response.statusText}`);
  }
}

/**
 * 清除会话的总结缓存
 */
export async function clearSummarizeCache(session_id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/sessions/${session_id}/summaries/cache`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to clear summarize cache: ${response.statusText}`);
  }
}

/**
 * 删除会话中的消息
 */
export async function deleteMessage(session_id: string, message_id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/sessions/${session_id}/messages/${message_id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to delete message: ${response.statusText}`);
  }
}

/**
 * 执行消息关联的感知组件
 */
export async function executeMessageComponent(
  message_id: string,
  llm_config_id: string,
  input: string
): Promise<MessageExecution> {
  const response = await fetch(`${API_BASE}/messages/${message_id}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      llm_config_id,
      input,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || error.message || `Failed to execute message component: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 获取消息的执行记录
 */
export async function getMessageExecution(message_id: string): Promise<MessageExecution | null> {
  const response = await fetch(`${API_BASE}/messages/${message_id}/execution`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const error = await response.json();
    throw new Error(error.error || error.message || `Failed to get message execution: ${response.statusText}`);
  }
  
  return await response.json();
}

