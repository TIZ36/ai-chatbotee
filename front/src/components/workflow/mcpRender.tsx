import React from 'react';
import type { MediaItem } from '@/components/ui/MediaGallery';
import { MediaGallery } from '@/components/ui/MediaGallery';
import { truncateBase64Strings } from '@/utils/textUtils';
import type { SessionMediaItem } from '@/components/ui/SessionMediaPanel';

export type MCPContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'video' | 'audio'; mimeType: string; data: string };

type RenderMCPMediaParams = {
  media: Array<{ type: 'image' | 'video' | 'audio'; mimeType: string; data: string }>;
  messageId?: string;
  openSingleMediaViewer: (item: SessionMediaItem) => void;
};

export function parseMCPContentBlocks(content: any): MCPContentBlock[] {
  const blocks: MCPContentBlock[] = [];

  try {
    let contentObj = content;
    if (typeof content === 'string') {
      try {
        contentObj = JSON.parse(content);
      } catch {
        return [{ kind: 'text', text: content }];
      }
    }

    const sources = Array.isArray(contentObj) ? contentObj : [contentObj];
    for (const src of sources) {
      // 兼容不同 MCP 响应结构
      const contentArray =
        src?.result?.content || src?.content || (src?.jsonrpc ? src?.result?.content : null);

      if (Array.isArray(contentArray)) {
        for (const item of contentArray) {
          if (item?.type === 'text' && typeof item.text === 'string') {
            blocks.push({ kind: 'text', text: item.text });
            continue;
          }
          if (item?.type === 'image' || item?.type === 'video' || item?.type === 'audio') {
            const mimeType = item.mimeType || item.mime_type;
            const data = item.data;
            // 放宽检查：只要 data 存在且是字符串，就尝试显示（即使可能不完整）
            if (typeof mimeType === 'string' && typeof data === 'string' && data.length > 0) {
              console.log(`[MCP Render] 发现媒体: type=${item.type}, mimeType=${mimeType}, dataLength=${data.length}, dataPreview=${data.substring(0, 50)}...`);
              blocks.push({ kind: item.type, mimeType, data });
            } else {
              console.warn(`[MCP Render] 媒体数据无效: type=${item.type}, mimeType=${typeof mimeType}, dataType=${typeof data}, dataLength=${data?.length || 0}, item=`, item);
            }
            continue;
          }
          if (item !== undefined) {
            blocks.push({ kind: 'text', text: JSON.stringify(item, null, 2) });
          }
        }
      } else if (src && typeof src === 'object') {
        blocks.push({ kind: 'text', text: JSON.stringify(src, null, 2) });
      } else if (typeof src === 'string' && src.trim()) {
        blocks.push({ kind: 'text', text: src });
      }
    }
  } catch (e) {
    blocks.push({
      kind: 'text',
      text: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    });
  }

  return blocks;
}

export function renderMCPMedia({
  media,
  messageId,
  openSingleMediaViewer,
}: RenderMCPMediaParams) {
  if (!media || media.length === 0) return null;

  const galleryMedia: MediaItem[] = media.map(m => ({
    type: m.type,
    mimeType: m.mimeType,
    data: m.data,
  }));

  return (
    <div className="mt-2">
      <MediaGallery
        media={galleryMedia}
        thumbnailSize="md"
        maxVisible={6}
        showDownload={true}
        onOpenSessionGallery={index => {
          const picked = galleryMedia[index];
          if (!picked) return;
          openSingleMediaViewer({
            type: picked.type,
            mimeType: picked.mimeType,
            data: picked.data,
            messageId,
            role: 'tool',
          });
        }}
      />
    </div>
  );
}

export function renderMCPBlocks(params: {
  blocks: MCPContentBlock[];
  messageId?: string;
  openSingleMediaViewer: (item: SessionMediaItem) => void;
}) {
  const { blocks, messageId, openSingleMediaViewer } = params;
  if (!blocks || blocks.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {blocks.map((b, idx) => {
        if (b.kind === 'text') {
          let displayText = b.text;
          try {
            const parsed = JSON.parse(b.text);
            displayText = JSON.stringify(parsed, null, 2);
          } catch {
            // ignore
          }
          displayText = truncateBase64Strings(displayText);
          return (
            <pre
              key={`mcp-text-${idx}`}
              className="bg-white dark:bg-[#2d2d2d] p-2 rounded border text-xs overflow-auto max-h-64 text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words"
            >
              {displayText}
            </pre>
          );
        }

        return (
          <div key={`mcp-media-${idx}`}>
            {renderMCPMedia({
              media: [{ type: b.kind, mimeType: b.mimeType, data: b.data }],
              messageId,
              openSingleMediaViewer,
            })}
          </div>
        );
      })}
    </div>
  );
}


