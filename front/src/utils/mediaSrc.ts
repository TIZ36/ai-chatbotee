import { ensureDataUrlFromMaybeBase64, looksLikeBase64Payload } from './dataUrl';
import { getBackendUrl } from './backendUrl';

function toFileUrl(path: string): string {
  // UNC: \\server\share\path
  if (path.startsWith('\\\\')) {
    const normalized = path.replace(/\\/g, '/').replace(/^\/\//, '');
    return encodeURI(`file://${normalized}`);
  }
  // windows: C:\a\b.png or C:/a/b.png
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    const normalized = path.replace(/\\/g, '/');
    return encodeURI(`file:///${normalized}`);
  }
  // posix: /Users/... /home/... etc.
  return encodeURI(`file://${path}`);
}

function isProbablyLocalAbsolutePath(src: string): boolean {
  // UNC
  if (src.startsWith('\\\\')) return true;
  // windows
  if (/^[A-Za-z]:[\\/]/.test(src)) return true;
  // common posix absolute file paths
  if (
    src.startsWith('/Users/') ||
    src.startsWith('/home/') ||
    src.startsWith('/var/') ||
    src.startsWith('/private/var/') ||
    src.startsWith('/tmp/') ||
    src.startsWith('/Volumes/')
  )
    return true;
  return false;
}

/**
 * 将“可能是 base64 / 后端相对路径 / 本地路径”的媒体 src 归一化为浏览器可用的 URL。
 *
 * - http(s)/data/blob/file：原样返回
 * - 纯 base64：补齐 data URL
 * - 本地绝对路径：转 file://
 * - /uploads/... 或 uploads/...：补齐后端 base URL
 */
export function resolveMediaSrc(raw: string, mimeType?: string): string {
  const src = String(raw ?? '').trim();
  if (!src) return src;

  // already absolute urls
  if (/^(https?:|data:|blob:|file:)/i.test(src)) return src;

  // base64 payload (legacy)
  if (looksLikeBase64Payload(src)) {
    return ensureDataUrlFromMaybeBase64(src, mimeType || 'application/octet-stream');
  }

  // local absolute file path (浏览器环境)
  if (isProbablyLocalAbsolutePath(src)) return toFileUrl(src);

  // backend-relative (e.g. /uploads/xxx.png)
  if (src.startsWith('/') && !src.startsWith('//')) {
    return `${getBackendUrl()}${src}`;
  }

  // backend-relative without leading slash (e.g. uploads/xxx.png)
  if (src.startsWith('uploads/') || src.startsWith('static/')) {
    return `${getBackendUrl()}/${src}`;
  }

  return src;
}


