import type { Session } from './sessionApi';
import { getBackendUrl } from '../utils/backendUrl';

const API_BASE = `${getBackendUrl()}/api`;

export interface RoleVersion {
  version_id: string;
  is_current: boolean;
  created_at?: string;
  updated_at?: string;
  metadata?: any;
}

export async function listRoleVersions(roleId: string): Promise<RoleVersion[]> {
  const resp = await fetch(`${API_BASE}/agents/${encodeURIComponent(roleId)}/versions`);
  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    throw new Error(payload?.error || `Failed to list role versions: ${resp.statusText}`);
  }
  const data = await resp.json();
  return data.versions || [];
}

export async function activateRoleVersion(roleId: string, versionId: string): Promise<{ success: boolean; current_role_version_id: string }> {
  const resp = await fetch(`${API_BASE}/agents/${encodeURIComponent(roleId)}/versions/${encodeURIComponent(versionId)}/activate`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    throw new Error(payload?.error || `Failed to activate role version: ${resp.statusText}`);
  }
  return await resp.json();
}

export async function createSessionFromRole(params: {
  role_id: string;
  role_version_id?: string;
  title?: string;
}): Promise<Session> {
  const resp = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: params.title,
      session_type: 'memory',
      source_role_id: params.role_id,
      source_role_version_id: params.role_version_id,
    }),
  });
  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    throw new Error(payload?.error || `Failed to create session from role: ${resp.statusText}`);
  }
  return await resp.json();
}

export async function createRole(params: {
  name: string;
  avatar: string;
  system_prompt: string;
  llm_config_id: string;
  media_output_path?: string;
  title?: string;
}): Promise<Session> {
  const resp = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: params.title,
      name: params.name,
      avatar: params.avatar,
      system_prompt: params.system_prompt,
      llm_config_id: params.llm_config_id,
      media_output_path: params.media_output_path,
      session_type: 'agent',
    }),
  });
  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    throw new Error(payload?.error || `Failed to create role: ${resp.statusText}`);
  }
  return await resp.json();
}

export async function applyRoleToSession(params: {
  session_id: string;
  role_id: string;
  role_version_id?: string;
  keep_session_llm_config?: boolean;
}): Promise<{ success: boolean; session_id: string; role_id: string; role_version_id: string; llm_config_id: string | null }> {
  const resp = await fetch(`${API_BASE}/sessions/${encodeURIComponent(params.session_id)}/apply-role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role_id: params.role_id,
      role_version_id: params.role_version_id,
      keep_session_llm_config: Boolean(params.keep_session_llm_config),
    }),
  });
  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    throw new Error(payload?.error || `Failed to apply role: ${resp.statusText}`);
  }
  return await resp.json();
}

export async function updateRoleProfile(
  roleId: string,
  updates: {
    name?: string | null;
    avatar?: string | null;
    system_prompt?: string | null;
    llm_config_id?: string | null;
    media_output_path?: string | null;
    title?: string | null;
    reason?: string;
  },
): Promise<{ success: boolean; role_id: string; current_role_version_id?: string; message?: string }> {
  const resp = await fetch(`${API_BASE}/agents/${encodeURIComponent(roleId)}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    throw new Error(payload?.error || `Failed to update role profile: ${resp.statusText}`);
  }
  return await resp.json();
}
