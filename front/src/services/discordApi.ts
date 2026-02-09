/**
 * Discord Bot 管理 API
 * 对应后端 /api/discord/*
 */

import { getBackendUrl } from '../utils/backendUrl';

const API_BASE = `${getBackendUrl()}/api/discord`;

export interface DiscordStatus {
  online: boolean;
  username: string | null;
  guilds: number;
  bound_channels: number;
  running?: boolean;
  error?: string;
  /** 上次启动失败原因（如 Token 无效），由后端在状态接口返回 */
  last_error?: string;
}

export interface DiscordChannelBinding {
  channel_id: string;
  guild_id: string;
  guild_name: string;
  channel_name: string;
  session_id: string;
  enabled: boolean;
  trigger_mode: 'mention' | 'all';
  config_override?: {
    system_prompt?: string;
    llm_config_id?: string;
  } | null;
  created_at?: string | null;
  updated_at?: string | null;
  message_count?: number;
  last_message_at?: string | null;
}

export async function getDiscordStatus(): Promise<DiscordStatus> {
  const res = await fetch(API_BASE + '/status');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || '获取状态失败');
  }
  return res.json();
}

export async function getDiscordChannels(enabledOnly = false): Promise<DiscordChannelBinding[]> {
  const url = `${API_BASE}/channels?enabled_only=${enabledOnly}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || '获取频道列表失败');
  }
  const data = await res.json();
  return data.channels || [];
}

export async function startDiscordBot(botToken?: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await fetch(API_BASE + '/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(botToken ? { bot_token: botToken } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error || res.statusText };
  }
  return { ok: true, message: data?.message };
}

export async function stopDiscordBot(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(API_BASE + '/stop', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error || res.statusText };
  }
  return { ok: true };
}

export async function updateDiscordChannel(
  channelId: string,
  updates: {
    trigger_mode?: 'mention' | 'all';
    enabled?: boolean;
    config_override?: { system_prompt?: string; llm_config_id?: string } | null;
    channel_name?: string;
    guild_name?: string;
  }
): Promise<DiscordChannelBinding> {
  const res = await fetch(`${API_BASE}/channels/${encodeURIComponent(channelId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || '更新失败');
  }
  return res.json();
}

export async function unbindDiscordChannel(
  channelId: string,
  deleteSession = false
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/channels/${encodeURIComponent(channelId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete_session: deleteSession }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error || res.statusText };
  }
  return { ok: true };
}

export async function bindDiscordChannel(params: {
  channel_id: string;
  guild_id?: string;
  guild_name?: string;
  channel_name?: string;
  trigger_mode?: 'mention' | 'all';
  config_override?: { system_prompt?: string; llm_config_id?: string };
}): Promise<DiscordChannelBinding> {
  const res = await fetch(API_BASE + '/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || '绑定失败');
  }
  return res.json();
}

/** Discord 应用配置（表存储，前端录入默认模型等） */
export interface DiscordAppConfig {
  default_llm_config_id: string;
}

export async function getDiscordConfig(): Promise<DiscordAppConfig> {
  const res = await fetch(API_BASE + '/config');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || '获取配置失败');
  }
  return res.json();
}

export async function updateDiscordConfig(updates: Partial<DiscordAppConfig>): Promise<DiscordAppConfig> {
  const res = await fetch(API_BASE + '/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || '保存配置失败');
  }
  return res.json();
}
