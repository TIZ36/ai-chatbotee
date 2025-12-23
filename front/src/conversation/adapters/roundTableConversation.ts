import type { ConversationAdapter, ListMessagesParams, ListMessagesResult, UnifiedMedia, UnifiedMessage } from '../types';
import { getRoundTableMessages, type RoundTableMessage } from '../../services/roundTableApi';

function mapRoundTableMedia(msg: RoundTableMessage): UnifiedMedia[] | undefined {
  const raw: any[] = (msg as any).media || [];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const media: UnifiedMedia[] = [];
  for (const m of raw) {
    if (!m?.data) continue;
    const url = m.preview || (m.mimeType ? `data:${m.mimeType};base64,${m.data}` : m.data);
    media.push({
      type: m.type,
      mimeType: m.mimeType,
      url,
    });
  }
  return media.length ? media : undefined;
}

function mapRoundTableMessage(msg: RoundTableMessage): UnifiedMessage {
  const senderType = (msg as any).sender_type as 'user' | 'agent' | 'system';
  const role = senderType === 'agent' ? 'assistant' : senderType;
  return {
    id: msg.message_id,
    role,
    content: msg.content || '',
    createdAt: (msg as any).created_at || new Date().toISOString(),
    media: mapRoundTableMedia(msg),
    meta: {
      sender_type: (msg as any).sender_type,
      sender_agent_id: (msg as any).sender_agent_id,
      agent_name: (msg as any).agent_name,
      agent_avatar: (msg as any).agent_avatar,
      mentions: (msg as any).mentions || [],
      is_raise_hand: (msg as any).is_raise_hand,
      reply_to_message_id: (msg as any).reply_to_message_id,
      responses: (msg as any).responses || [],
      selected_response_id: (msg as any).selected_response_id,
    },
  };
}

export function createRoundTableConversationAdapter(roundTableId: string): ConversationAdapter {
  return {
    key: `roundTable:${roundTableId}`,

    async listMessages(params: ListMessagesParams): Promise<ListMessagesResult> {
      const pageSize = params.pageSize ?? 50;

      // RoundTable 后端按 created_at ASC 且分页从最早开始：为了“先显示最新”，我们从最后一页开始倒着翻
      if (!params.cursor) {
        const first = await getRoundTableMessages(roundTableId, 1, pageSize);
        const totalPages = first.total_pages || 0;
        if (totalPages <= 1) {
          const items = (first.messages || []).map(mapRoundTableMessage);
          return { items, hasMore: false, nextCursor: null };
        }
        const last = await getRoundTableMessages(roundTableId, totalPages, pageSize);
        const items = (last.messages || []).map(mapRoundTableMessage);
        return {
          items,
          hasMore: totalPages > 1,
          nextCursor: String(totalPages - 1),
        };
      }

      const page = Number(params.cursor);
      if (!Number.isFinite(page) || page <= 0) {
        return { items: [], hasMore: false, nextCursor: null };
      }
      const res = await getRoundTableMessages(roundTableId, page, pageSize);
      const items = (res.messages || []).map(mapRoundTableMessage);
      const hasMore = page > 1;
      return {
        items,
        hasMore,
        nextCursor: hasMore ? String(page - 1) : null,
      };
    },
  };
}

