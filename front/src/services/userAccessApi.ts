/**
 * 用户访问管理 API 服务
 */

import { getBackendUrl } from '../utils/backendUrl';

const API_BASE = `${getBackendUrl()}/api`;

export interface UserAccess {
  ip_address: string;
  nickname: string | null;
  is_enabled: boolean;
  is_admin?: boolean;
  is_owner: boolean;
  needs_nickname: boolean;
  first_access_at: string | null;
  last_access_at: string | null;
}

export interface AgentAccess {
  ip_address: string;
  nickname: string | null;
  is_enabled: boolean;
  access_type: 'creator' | 'granted';
  granted_at: string | null;
}

/**
 * 获取当前用户的访问信息
 */
export async function getUserAccess(): Promise<UserAccess> {
  const response = await fetch(`${API_BASE}/user-access`);
  if (!response.ok) {
    throw new Error(`Failed to get user access: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 创建或更新用户访问信息（首次访问时填写昵称）
 */
export async function createOrUpdateUserAccess(nickname: string): Promise<{ ip_address: string; nickname: string; message: string }> {
  const response = await fetch(`${API_BASE}/user-access`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nickname }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create/update user access: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 获取所有用户访问列表（仅拥有者可用）
 */
export async function listUserAccess(): Promise<{ users: UserAccess[]; total: number }> {
  const response = await fetch(`${API_BASE}/user-access/list`);
  if (!response.ok) {
    throw new Error(`Failed to list user access: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 更新用户访问信息（仅拥有者可用）
 */
export async function updateUserAccess(ip_address: string, data: { nickname?: string; is_enabled?: boolean; is_admin?: boolean }): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/user-access/${ip_address}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to update user access: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 删除用户访问（仅拥有者可用）
 */
export async function deleteUserAccess(ip_address: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/user-access/${ip_address}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete user access: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 获取agent的访问权限列表（仅拥有者可用）
 */
export async function getAgentAccess(agent_session_id: string): Promise<{ accesses: AgentAccess[]; total: number }> {
  const response = await fetch(`${API_BASE}/agents/${agent_session_id}/access`);
  if (!response.ok) {
    throw new Error(`Failed to get agent access: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 授权用户访问agent（仅拥有者可用）
 */
export async function grantAgentAccess(agent_session_id: string, ip_address: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/agents/${agent_session_id}/access`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ip_address }),
  });
  if (!response.ok) {
    throw new Error(`Failed to grant agent access: ${response.statusText}`);
  }
  return await response.json();
}

/**
 * 取消用户访问agent的权限（仅拥有者可用）
 */
export async function revokeAgentAccess(agent_session_id: string, ip_address: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/agents/${agent_session_id}/access/${ip_address}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to revoke agent access: ${response.statusText}`);
  }
  return await response.json();
}

