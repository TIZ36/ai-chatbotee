/**
 * data URL / base64 归一化工具
 *
 * 目标：兼容历史数据中“纯 base64（无 data: 前缀）”的图片/媒体，统一转换为可直接用于 <img src> 的 data URL。
 */

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function inferImageMimeFromBase64Payload(payload: string): string | null {
  const base64 = payload.startsWith('data:') ? payload.slice(payload.indexOf(',') + 1) : payload.trim();
  if (base64.startsWith('iVBORw')) return 'image/png';
  if (base64.startsWith('/9j/') || base64.startsWith('9j/')) return 'image/jpeg';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return null;
}

export function looksLikeBase64Payload(value: string, minLen: number = 256): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('data:')) return true;
  // 太短的字符串不处理，避免误判普通路径/短 token
  if (trimmed.length < minLen) return false;
  return BASE64_RE.test(trimmed);
}

/**
 * 将可能是“纯 base64”的字符串转换为 data URL。
 *
 * - 已经是 http(s)/data/blob/file 等 URL：原样返回
 * - 纯 base64（无 data: 前缀）：补齐 `data:${mime};base64,`
 * - 其他：原样返回
 */
export function ensureDataUrlFromMaybeBase64(value: string, fallbackMime: string = 'image/jpeg'): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return trimmed;

  // 已是可用 URL
  if (/^(https?:|data:|blob:|file:)/i.test(trimmed)) return trimmed;

  // 纯 base64：补齐 data:
  if (!looksLikeBase64Payload(trimmed)) return trimmed;

  const inferred = inferImageMimeFromBase64Payload(trimmed);
  const mime = inferred || fallbackMime || 'application/octet-stream';
  return `data:${mime};base64,${trimmed}`;
}

export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const s = String(dataUrl ?? '').trim();
  if (!s.startsWith('data:')) return null;
  const commaIdx = s.indexOf(',');
  if (commaIdx < 0) return null;

  const meta = s.slice(5, commaIdx); // remove "data:"
  const body = s.slice(commaIdx + 1);
  const mimeType = meta.split(';')[0] || 'application/octet-stream';
  return { mimeType, base64: body };
}

export function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } | null {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const { mimeType, base64 } = parsed;
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return { blob: new Blob([byteArray], { type: mimeType }), mimeType };
}


