import type { ConversationAdapter, ListMessagesParams, ListMessagesResult, UnifiedMedia, UnifiedMessage } from '../types';
import { deleteMessage, getSessionMessages, saveMessage, type Message } from '../../services/sessionApi';

function mapSessionMedia(msg: Message): UnifiedMedia[] | undefined {
  const media: UnifiedMedia[] = [];

  const toolCalls = msg.tool_calls as any;
  if (toolCalls && typeof toolCalls === 'object' && !Array.isArray(toolCalls) && Array.isArray(toolCalls.media)) {
    for (const m of toolCalls.media) {
      if (!m?.data) continue;
      media.push({
        type: m.type,
        mimeType: m.mimeType,
        url: m.data,
      });
    }
  }

  const ext: any = (msg as any).ext;
  if (ext && Array.isArray(ext.media)) {
    for (const m of ext.media) {
      if (!m?.data) continue;
      media.push({
        type: m.type,
        mimeType: m.mimeType,
        url: m.data,
      });
    }
  }

  return media.length ? media : undefined;
}

function mapSessionMessage(msg: Message): UnifiedMessage {
  const isSummary = msg.role === 'system' && typeof msg.content === 'string' && msg.content.startsWith('__SUMMARY__');
  const actualContent = isSummary ? msg.content.replace(/^__SUMMARY__/, '') : msg.content;
  const toolCalls = (msg.tool_calls as any) && typeof msg.tool_calls === 'object' ? (msg.tool_calls as any) : null;
  const isSystemPrompt = msg.role === 'system' && toolCalls && toolCalls.isSystemPrompt === true;

  return {
    id: msg.message_id,
    role: msg.role,
    content: actualContent || '',
    createdAt: msg.created_at || new Date().toISOString(),
    media: mapSessionMedia(msg),
    thinking: msg.thinking,
    toolCalls: msg.tool_calls,
    tokenCount: (msg as any).token_count,
    meta: {
      thinking: msg.thinking,
      tool_calls: msg.tool_calls,
      token_count: (msg as any).token_count,
      ext: (msg as any).ext,
      mcpdetail: (msg as any).mcpdetail,
      tool_type: (msg as any).tool_type,
      isSummary,
      isSystemPrompt,
    },
    ...(isSummary ? ({ isSummary: true } as any) : null),
  };
}

export function createSessionConversationAdapter(
  sessionId: string,
  opts?: {
    /** 轻量级模式：只拿 role/content/created_at，适用于 Research */
    lightweight?: boolean;
  }
): ConversationAdapter {
  const lightweight = opts?.lightweight ?? false;

  return {
    key: `session:${sessionId}`,

    async listMessages(params: ListMessagesParams): Promise<ListMessagesResult> {
      const pageSize = params.pageSize ?? 20;
      // 后端第一页会强制 immediate_limit=10；为避免分页错位，这里统一使用 <=10
      const requestPageSize = Math.min(pageSize, 10);
      const page = params.cursor ? Number(params.cursor) : 1;
      const res = await getSessionMessages(sessionId, page, requestPageSize, lightweight);
      const items = (res.messages || []).map(mapSessionMessage);
      const hasMore = res.page < res.total_pages;
      return {
        items,
        hasMore,
        nextCursor: hasMore ? String(page + 1) : null,
      };
    },

    async sendMessage(payload) {
      const role = payload.role ?? 'user';
      const res = await saveMessage(sessionId, {
        role,
        content: payload.content,
        ext: payload.meta?.ext,
        thinking: payload.meta?.thinking,
        tool_calls: payload.meta?.tool_calls,
      } as any);

      return {
        id: res.message_id,
        role,
        content: payload.content,
        createdAt: new Date().toISOString(),
        media: payload.media,
        thinking: payload.meta?.thinking,
        toolCalls: payload.meta?.tool_calls,
        tokenCount: payload.meta?.token_count,
        meta: payload.meta,
      };
    },

    async deleteMessage(messageId: string) {
      await deleteMessage(sessionId, messageId);
    },
  };
}

