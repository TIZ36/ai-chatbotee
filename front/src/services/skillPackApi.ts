/**
 * 技能包 API 服务
 */

export interface SkillPack {
  skill_pack_id: string;
  name: string;
  summary: string;
  source_session_id?: string;
  source_messages?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface SkillPackProcessInfo {
  messages_count: number;
  thinking_count: number;
  tool_calls_count: number;
  media_count: number;
  media_types: string[];
  conversation_length: number;
  prompt_length: number;
}

export interface SkillPackCreationResult {
  name: string;
  summary: string;
  source_session_id?: string;
  source_messages?: string[];
  process_info: SkillPackProcessInfo;
  conversation_text: string;
}

export interface SkillPackAssignment {
  assignment_id: string;
  skill_pack_id: string;
  target_type: 'memory' | 'agent';
  target_session_id: string;
  created_at?: string;
}

export interface SessionSkillPack extends SkillPack {
  assignment_id: string;
  target_type: 'memory' | 'agent';
  assigned_at?: string;
}

const API_BASE = 'http://localhost:3002/api';

/**
 * 获取所有技能包列表
 */
export async function getSkillPacks(): Promise<SkillPack[]> {
  try {
    const response = await fetch(`${API_BASE}/skill-packs`);
    if (!response.ok) {
      console.warn(`Failed to fetch skill packs: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    return data.skill_packs || [];
  } catch (error) {
    console.warn('Error fetching skill packs:', error);
    return [];
  }
}

/**
 * 创建技能包（生成总结，不直接保存）
 */
export async function createSkillPack(params: {
  session_id: string;
  message_ids: string[];
  llm_config_id: string;
}): Promise<SkillPackCreationResult> {
  const response = await fetch(`${API_BASE}/skill-packs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to create skill pack: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 保存技能包（用户确认后）
 */
export async function saveSkillPack(params: {
  name: string;
  summary: string;
  source_session_id?: string;
  source_messages?: string[];
}): Promise<SkillPack> {
  const response = await fetch(`${API_BASE}/skill-packs/save`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to save skill pack: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 优化技能包总结
 */
export async function optimizeSkillPackSummary(params: {
  conversation_text: string;
  current_summary: string;
  optimization_prompt?: string;
  llm_config_id: string;
  mcp_server_ids?: string[]; // 可选的MCP服务器ID列表
}): Promise<{ name: string; summary: string }> {
  const response = await fetch(`${API_BASE}/skill-packs/optimize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to optimize skill pack: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 获取技能包详情
 */
export async function getSkillPack(skillPackId: string): Promise<SkillPack> {
  const response = await fetch(`${API_BASE}/skill-packs/${skillPackId}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to fetch skill pack: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 更新技能包
 */
export async function updateSkillPack(
  skillPackId: string,
  params: { name?: string; summary?: string }
): Promise<void> {
  const response = await fetch(`${API_BASE}/skill-packs/${skillPackId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to update skill pack: ${response.statusText}`);
  }
}

/**
 * 删除技能包
 */
export async function deleteSkillPack(skillPackId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/skill-packs/${skillPackId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to delete skill pack: ${response.statusText}`);
  }
}

/**
 * 分配技能包到记忆体/智能体
 */
export async function assignSkillPack(
  skillPackId: string,
  targetSessionId: string,
  targetType?: 'memory' | 'agent'
): Promise<SkillPackAssignment> {
  const response = await fetch(`${API_BASE}/skill-packs/${skillPackId}/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      target_session_id: targetSessionId,
      target_type: targetType,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to assign skill pack: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 取消技能包分配
 */
export async function unassignSkillPack(
  skillPackId: string,
  targetSessionId: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/skill-packs/${skillPackId}/unassign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      target_session_id: targetSessionId,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Failed to unassign skill pack: ${response.statusText}`);
  }
}

/**
 * 获取某会话已分配的技能包列表
 */
export async function getSessionSkillPacks(sessionId: string): Promise<SessionSkillPack[]> {
  try {
    const response = await fetch(`${API_BASE}/sessions/${sessionId}/skill-packs`);
    if (!response.ok) {
      console.warn(`Failed to fetch session skill packs: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    return data.skill_packs || [];
  } catch (error) {
    console.warn('Error fetching session skill packs:', error);
    return [];
  }
}

