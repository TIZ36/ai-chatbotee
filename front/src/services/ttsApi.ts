/**
 * ElevenLabs Text-to-Speech API
 * Corresponds to backend /api/tts/*
 */

import { getBackendUrl } from '../utils/backendUrl';

const API_BASE = `${getBackendUrl()}/api/tts`;

export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  gender: string;
  accent: string;
  age: string;
  description: string;
  preview_url: string;
}

export interface TTSSettings {
  stability?: number;
  similarity_boost?: number;
  model_id?: string;
  output_format?: string;
  optimize_streaming_latency?: number;
}

export interface UserInfo {
  character_count: number;
  character_limit: number;
  can_use_professional_voice_consistency: boolean;
  subscription_tier: string;
}

export async function fetchVoices(): Promise<Voice[]> {
  const res = await fetch(`${API_BASE}/voices`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || 'Failed to fetch voices');
  }
  const data = await res.json();
  return data.voices || [];
}

export async function getVoiceDetails(voiceId: string): Promise<Voice> {
  const res = await fetch(`${API_BASE}/voices/${encodeURIComponent(voiceId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || 'Failed to fetch voice details');
  }
  return res.json();
}

export async function synthesizeText(
  text: string,
  voiceId: string,
  settings: TTSSettings = {}
): Promise<Blob> {
  const payload = {
    text,
    voice_id: voiceId,
    ...settings,
  };

  const res = await fetch(`${API_BASE}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || 'Failed to synthesize speech');
  }

  return res.blob();
}

export async function uploadCustomVoice(
  file: File,
  name: string,
  description?: string
): Promise<{ voice_id: string; name: string; message: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', name);
  if (description) {
    formData.append('description', description);
  }

  const res = await fetch(`${API_BASE}/upload-voice`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || 'Failed to upload voice');
  }

  return res.json();
}

export async function deleteCustomVoice(voiceId: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/delete-voice/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || 'Failed to delete voice');
  }

  return res.json();
}

export async function getUserInfo(): Promise<UserInfo> {
  const res = await fetch(`${API_BASE}/user-info`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || res.statusText || 'Failed to fetch user info');
  }
  return res.json();
}
