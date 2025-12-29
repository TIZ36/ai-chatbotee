import { getBackendUrl } from '@/utils/backendUrl';

export type MediaType = 'image' | 'video' | 'audio';

export interface MediaLibraryItem {
  type: MediaType;
  mimeType: string;
  data: string;
  url?: string;
  created_at?: string | null;
  created_at_ts?: number;
  message_id?: string;
  role?: 'user' | 'assistant' | 'tool' | 'system';
  session_id: string;
}

export async function getMediaLibraryItems(params: {
  sessionIds: string[];
  type?: MediaType;
  limit?: number;
  beforeTs?: number | null;
  order?: 'asc' | 'desc';
}): Promise<{ items: MediaLibraryItem[]; has_more: boolean; next_cursor: number | null }> {
  const { sessionIds, type = 'image', limit = 200, beforeTs, order = 'desc' } = params;
  const url = new URL(`${getBackendUrl()}/api/media-library/items`);
  url.searchParams.set('session_ids', sessionIds.join(','));
  url.searchParams.set('type', type);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('order', order);
  if (beforeTs != null) url.searchParams.set('before_ts', String(beforeTs));

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`Failed to fetch media library: ${resp.status} ${resp.statusText}`);
  }
  return await resp.json();
}


