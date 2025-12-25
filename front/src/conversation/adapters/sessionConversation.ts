import type { ConversationAdapter, ListMessagesParams, ListMessagesResult, UnifiedMedia, UnifiedMessage } from '../types';
import { deleteMessage, getSessionMessages, getSessionMessagesCursor, saveMessage, type Message } from '../../services/sessionApi';

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

  // Extract ext data
  const ext: any = (msg as any).ext;
  
  // Extract processSteps from ext (if saved there)
  const processSteps = ext?.processSteps;
  
  // Extract thoughtSignature from ext
  const thoughtSignature = ext?.thoughtSignature;
  
  // Extract mcpdetail from message or ext
  const mcpdetail = (msg as any).mcpdetail;
  
  // Debug: Log processSteps mapping for assistant messages with MCP calls
  if (msg.role === 'assistant' && (processSteps || mcpdetail)) {
    console.log(`[sessionConversation] 映射消息 ${msg.message_id}:`, {
      hasExt: !!ext,
      hasProcessSteps: !!processSteps,
      processStepsCount: processSteps?.length,
      processStepTypes: processSteps?.map((s: any) => ({ type: s.type, hasResult: s.result !== undefined })),
      hasMcpdetail: !!mcpdetail,
    });
  }

  return {
    id: msg.message_id,
    role: msg.role,
    content: actualContent || '',
    createdAt: msg.created_at || new Date().toISOString(),
    media: mapSessionMedia(msg),
    thinking: msg.thinking,
    toolCalls: msg.tool_calls,
    tokenCount: (msg as any).token_count,
    // Expose processSteps at top level for UI rendering
    processSteps,
    // Expose thoughtSignature at top level
    thoughtSignature,
    // Expose mcpdetail at top level
    mcpdetail,
    meta: {
      thinking: msg.thinking,
      tool_calls: msg.tool_calls,
      token_count: (msg as any).token_count,
      ext,
      mcpdetail,
      tool_type: (msg as any).tool_type,
      isSummary,
      isSystemPrompt,
      processSteps,
      thoughtSignature,
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
      
      // 使用游标分页（更高效）
      // cursor 是 message_id，表示获取此消息之前的消息
      const beforeId = params.cursor as string | null;
      
      const res = await getSessionMessagesCursor(sessionId, beforeId, pageSize, lightweight);
      const items = (res.messages || []).map(mapSessionMessage);
      
      return {
        items,
        hasMore: res.has_more,
        nextCursor: res.next_cursor,
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

