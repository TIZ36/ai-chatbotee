/**
 * 圆桌会议 API 服务
 */

import { getBackendUrl } from '../utils/backendUrl';

const API_BASE = `${getBackendUrl()}/api`;

// ==================== 类型定义 ====================

export interface RoundTable {
  round_table_id: string;
  name: string;
  status: 'active' | 'closed';
  participant_count: number;
  created_at: string;
  updated_at: string;
}

export interface RoundTableParticipant {
  session_id: string;
  name: string;
  avatar?: string;
  joined_at: string;
  llm_config_id?: string;
  system_prompt?: string;
  custom_llm_config_id?: string;
  custom_system_prompt?: string;
  media_output_path?: string;  // 媒体输出本地路径
}

export interface RoundTableMessage {
  message_id: string;
  sender_type: 'user' | 'agent' | 'system';
  sender_agent_id?: string;
  agent_name?: string;
  agent_avatar?: string;
  content: string;
  mentions: string[];
  is_raise_hand: boolean;
  created_at: string;
  responses: RoundTableResponse[];
  // 媒体内容（图片等）
  media?: Array<{ type: string; mimeType: string; data: string; preview?: string }>;
  // 引用消息ID
  reply_to_message_id?: string;
}

export interface RoundTableResponse {
  response_id: string;
  agent_id: string;
  agent_name: string;
  agent_avatar?: string;
  content: string;
  thinking?: string;
  tool_calls?: any;
  /** 多模态内容（图片等） */
  media?: Array<{ type: string; mimeType: string; data: string; preview?: string }>;
  is_selected: boolean;
  created_at: string;
}

export interface RoundTableDetail extends RoundTable {
  participants: RoundTableParticipant[];
}

// ==================== API 函数 ====================

/**
 * 获取圆桌会议列表
 */
export async function getRoundTables(): Promise<RoundTable[]> {
  try {
    const response = await fetch(`${API_BASE}/round-tables`);
    if (!response.ok) {
      console.warn(`Failed to fetch round tables: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    return data.round_tables || [];
  } catch (error) {
    console.warn('Error fetching round tables:', error);
    return [];
  }
}

/**
 * 创建圆桌会议
 */
export async function createRoundTable(name?: string): Promise<RoundTable> {
  const response = await fetch(`${API_BASE}/round-tables`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to create round table: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 获取圆桌会议详情
 */
export async function getRoundTable(roundTableId: string): Promise<RoundTableDetail> {
  const response = await fetch(`${API_BASE}/round-tables/${roundTableId}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to fetch round table: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 更新圆桌会议
 */
export async function updateRoundTable(
  roundTableId: string, 
  updates: { name?: string; status?: 'active' | 'closed' }
): Promise<void> {
  const response = await fetch(`${API_BASE}/round-tables/${roundTableId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to update round table: ${response.statusText}`);
  }
}

/**
 * 删除圆桌会议
 */
export async function deleteRoundTable(roundTableId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/round-tables/${roundTableId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to delete round table: ${response.statusText}`);
  }
}

/**
 * 添加智能体到圆桌会议
 */
export async function addParticipant(
  roundTableId: string,
  sessionId: string
): Promise<{ participant: RoundTableParticipant }> {
  const response = await fetch(`${API_BASE}/round-tables/${roundTableId}/participants`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to add participant: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 从圆桌会议移除智能体
 */
export async function removeParticipant(
  roundTableId: string,
  sessionId: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/round-tables/${roundTableId}/participants/${sessionId}`,
    { method: 'DELETE' }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to remove participant: ${response.statusText}`);
  }
}

/**
 * 更新参与者配置
 */
export async function updateParticipant(
  roundTableId: string,
  sessionId: string,
  updates: {
    custom_llm_config_id?: string | null;
    custom_system_prompt?: string | null;
    media_output_path?: string | null;
  }
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/round-tables/${roundTableId}/participants/${sessionId}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to update participant: ${response.statusText}`);
  }
}

/**
 * 保存媒体文件到本地
 */
export async function saveMediaToLocal(params: {
  media_data: string;  // base64 编码的媒体数据
  mime_type: string;
  output_path: string;
  filename?: string;
}): Promise<{ success: boolean; file_path: string; filename: string; size: number }> {
  const response = await fetch(`${API_BASE}/round-tables/save-media`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to save media: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * 获取圆桌会议消息
 */
export async function getRoundTableMessages(
  roundTableId: string,
  page: number = 1,
  pageSize: number = 50
): Promise<{
  messages: RoundTableMessage[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}> {
  try {
    const response = await fetch(
      `${API_BASE}/round-tables/${roundTableId}/messages?page=${page}&page_size=${pageSize}`
    );
    if (!response.ok) {
      console.warn(`Failed to fetch messages: ${response.statusText}`);
      return { messages: [], total: 0, page, page_size: pageSize, total_pages: 0 };
    }
    return await response.json();
  } catch (error) {
    console.warn('Error fetching messages:', error);
    return { messages: [], total: 0, page, page_size: pageSize, total_pages: 0 };
  }
}

/**
 * 发送圆桌会议消息
 */
export async function sendMessage(
  roundTableId: string,
  message: {
    content: string;
    sender_type?: 'user' | 'agent' | 'system';
    sender_agent_id?: string;
    mentions?: string[];
    is_raise_hand?: boolean;
    media?: Array<{ type: string; mimeType: string; data: string }>;  // 媒体内容
    reply_to_message_id?: string;  // 引用消息ID
  }
): Promise<RoundTableMessage> {
  const response = await fetch(`${API_BASE}/round-tables/${roundTableId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to send message: ${response.statusText}`);
  }
  const data = await response.json();
  return { ...data, responses: [] };
}

/**
 * 添加智能体响应
 */
export async function addResponse(
  roundTableId: string,
  messageId: string,
  responseData: {
    agent_id: string;
    content: string;
    thinking?: string;
    tool_calls?: any;
  }
): Promise<RoundTableResponse> {
  const response = await fetch(
    `${API_BASE}/round-tables/${roundTableId}/messages/${messageId}/responses`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(responseData),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to add response: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 选择响应
 */
export async function selectResponse(
  roundTableId: string,
  responseId: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/round-tables/${roundTableId}/responses/${responseId}/select`,
    { method: 'PUT' }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to select response: ${response.statusText}`);
  }
}

// ==================== 工具函数 ====================

/**
 * 解析消息中的 @ 提及
 * @param content 消息内容
 * @param participants 参与者列表
 * @returns 被提及的参与者 session_id 列表
 */
export function parseMentions(
  content: string,
  participants: RoundTableParticipant[]
): string[] {
  const mentions: string[] = [];
  
  // 匹配 @名称 模式（支持中文、英文、数字、下划线）
  const mentionPattern = /@([\w\u4e00-\u9fa5]+)/g;
  let match;
  
  while ((match = mentionPattern.exec(content)) !== null) {
    const mentionedName = match[1];
    
    // 查找匹配的参与者
    const participant = participants.find(p => 
      p.name === mentionedName || 
      p.session_id.startsWith(mentionedName) ||
      p.session_id === mentionedName
    );
    
    if (participant && !mentions.includes(participant.session_id)) {
      mentions.push(participant.session_id);
    }
  }
  
  return mentions;
}

/**
 * 检查消息是否包含举手标记
 */
export function hasRaiseHandMark(content: string): boolean {
  const raiseHandPatterns = [
    /^\s*\[举手\]/,
    /^\s*【举手】/,
    /^\s*\[RAISE HAND\]/i,
    /^\s*🙋/,
  ];
  
  return raiseHandPatterns.some(pattern => pattern.test(content));
}

/**
 * 移除举手标记
 */
export function removeRaiseHandMark(content: string): string {
  return content
    .replace(/^\s*\[举手\]\s*/, '')
    .replace(/^\s*【举手】\s*/, '')
    .replace(/^\s*\[RAISE HAND\]\s*/i, '')
    .replace(/^\s*🙋\s*/, '')
    .trim();
}
