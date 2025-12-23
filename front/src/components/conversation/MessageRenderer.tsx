import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { CheckCircle, Copy, FileText } from 'lucide-react';
import { truncateBase64Strings } from '../../utils/textUtils';
import { getBackendUrl } from '../../utils/backendUrl';
import { Button } from '@/components/ui/Button';

type Variant = 'default' | 'compact';

export interface MessageRendererProps {
  content: string;
  variant?: Variant;
  className?: string;
  markdown?: boolean;
  components?: Components;
}

const CodeBlock: React.FC<{ language?: string; codeText: string; children: React.ReactNode; variant: Variant }> = ({
  language,
  codeText,
  children,
  variant,
}) => {
  const [copied, setCopied] = useState(false);

  const preClassName =
    variant === 'compact'
      ? 'bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-3 pt-6 overflow-x-auto border border-gray-700 text-xs'
      : 'bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-4 pt-8 overflow-x-auto border border-gray-700 dark:border-[#404040]';

  return (
    <div className={variant === 'compact' ? 'relative group my-2' : 'relative group my-3'}>
      {language && (
        <div
          className={
            variant === 'compact'
              ? 'absolute top-1 left-2 text-[10px] text-gray-400 font-mono bg-gray-800/50 px-1.5 py-0.5 rounded z-10'
              : 'absolute top-2 left-2 text-xs text-gray-400 dark:text-[#808080] font-mono bg-gray-800/50 dark:bg-[#363636] px-2 py-0.5 rounded z-10'
          }
        >
          {language}
        </div>
      )}
      <pre className={preClassName}>
        <code>{children}</code>
      </pre>
      <Button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(codeText);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch (err) {
            console.error('Failed to copy:', err);
          }
        }}
        className={
          variant === 'compact'
            ? 'absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 text-[10px]'
            : 'absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 text-xs'
        }
        title="复制代码"
        variant="ghost"
        size="sm"
      >
        {copied ? (
          <>
            <CheckCircle className="w-3 h-3" />
            <span>已复制</span>
          </>
        ) : variant === 'compact' ? (
          <>
            <Copy className="w-3 h-3" />
            <span>复制</span>
          </>
        ) : (
          <>
            <FileText className="w-3 h-3" />
            <span>复制</span>
          </>
        )}
      </Button>
    </div>
  );
};

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

function inferImageMimeFromBase64Payload(payload: string): string | null {
  const s = payload.startsWith('data:') ? payload : payload.trim();
  // payload 可能是 "/9j/..." 或 "iVBORw..."，也可能包含前缀 "data:...;base64,"
  const base64 = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
  if (base64.startsWith('iVBORw')) return 'image/png';
  if (base64.startsWith('/9j/') || base64.startsWith('9j/')) return 'image/jpeg';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return null;
}

function looksLikeBase64Payload(s: string): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (trimmed.startsWith('data:')) return true;
  // 太短的不处理，避免误判普通路径
  if (trimmed.length < 256) return false;
  // base64 字符集（允许末尾 padding）
  return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed);
}

function ensureDataUrlFromMaybeBase64(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:')) return trimmed;
  if (!looksLikeBase64Payload(trimmed)) return trimmed;
  const mime = inferImageMimeFromBase64Payload(trimmed) || 'image/jpeg';
  return `data:${mime};base64,${trimmed}`;
}

function isProbablyLocalAbsolutePath(src: string): boolean {
  // file url
  if (src.startsWith('file://')) return true;
  // UNC
  if (src.startsWith('\\\\')) return true;
  // windows path handled separately
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

function resolveImageSrc(src: string): string {
  // already absolute urls
  if (/^(https?:|data:|blob:|file:)/i.test(src)) return src;

  // raw base64 payload (legacy)
  if (looksLikeBase64Payload(src)) return ensureDataUrlFromMaybeBase64(src);

  // local absolute file path (Electron needs file://)
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

const MarkdownImage: React.FC<{ src?: string; alt?: string }> = ({ src, alt }) => {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  if (!src) return null;

  const [imageSrc, setImageSrc] = useState<string>(() => resolveImageSrc(src));

  useEffect(() => {
    setStatus('loading');
    let cancelled = false;

    const electronAPI = (window as any)?.electronAPI as any;
    const canReadAsDataUrl = electronAPI && typeof electronAPI.readFileAsDataUrl === 'function';

    const tryReadLocalAsDataUrl = async (filePath: string) => {
      try {
        const dataUrl = await electronAPI.readFileAsDataUrl(filePath);
        const normalized = ensureDataUrlFromMaybeBase64(String(dataUrl));
        if (!cancelled) setImageSrc(normalized);
      } catch (e) {
        // 兜底：尝试 file://（在生产 file:// 页面下通常可用）
        if (!cancelled) setImageSrc(toFileUrl(filePath));
      }
    };

    // Electron + 本地路径：优先转 data: URL，避免 webSecurity=true 时 file:// 被拦截
    if (canReadAsDataUrl && isProbablyLocalAbsolutePath(src)) {
      (async () => {
        // src 可能是 file:// URL，需要还原成真实路径
        if (src.startsWith('file://')) {
          try {
            const u = new URL(src);
            // URL.pathname 在 mac/linux 下是 /Users/...；在 windows 下可能是 /C:/...
            const pathname = decodeURI(u.pathname);
            const filePath = pathname.startsWith('/') && /^[A-Za-z]:\//.test(pathname.slice(1)) ? pathname.slice(1) : pathname;
            await tryReadLocalAsDataUrl(filePath);
            return;
          } catch {
            // ignore
          }
        }

        await tryReadLocalAsDataUrl(src);
      })();
    } else {
      // 非 Electron 本地路径、或无 API：保持原逻辑（含 raw base64 → data url）
      setImageSrc(resolveImageSrc(src));
    }

    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <span className="block my-3">
      {status === 'loading' && (
        <div
          className="flex items-center justify-center bg-gray-100 dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040] p-4 text-gray-500 dark:text-gray-400 text-sm"
          style={{ minHeight: '100px' }}
        >
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <div>加载中...</div>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div
          className="flex items-center justify-center bg-gray-100 dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040] p-4 text-gray-500 dark:text-gray-400 text-sm"
          style={{ minHeight: '100px' }}
        >
          <div className="text-center">
            <div className="mb-1">图片加载失败</div>
            <div className="text-xs text-gray-400 mb-2">{alt || '未知图片'}</div>
            <a href={imageSrc} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-500 hover:underline">
              查看原链接
            </a>
          </div>
        </div>
      )}
      <img
        src={imageSrc}
        alt={alt || '图片'}
        loading="lazy"
        className={`max-w-full h-auto rounded-lg border border-gray-200 dark:border-[#404040] cursor-pointer hover:opacity-90 transition-opacity ${status !== 'loaded' ? 'hidden' : ''}`}
        style={{ maxHeight: '400px', objectFit: 'contain' }}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        onClick={() => {
          const win = window.open('', '_blank');
          if (!win) return;
          win.document.write(`
            <html>
              <head><title>${alt || '图片预览'}</title></head>
              <body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#000">
                <img src="${imageSrc}" style="max-width:100%;max-height:100vh;object-fit:contain;" alt="${alt || '图片'}" />
              </body>
            </html>
          `);
        }}
      />
    </span>
  );
};

export const MessageRenderer: React.FC<MessageRendererProps> = ({
  content,
  variant = 'default',
  className,
  markdown = true,
  components,
}) => {
  // Markdown 渲染时不 truncate base64，否则会破坏 data URL 图片
  // 只在纯文本显示（markdown=false）时才 truncate
  const renderedContent = useMemo(
    () => (markdown ? (content || '') : truncateBase64Strings(content || '')),
    [content, markdown]
  );

  const defaultComponents: Components = {
    code: ({ inline, className: codeClassName, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(codeClassName || '');
      const language = match ? match[1] : '';
      if (!inline && match) {
        const codeText = String(children).replace(/\n$/, '');
        return (
          <CodeBlock variant={variant} language={language} codeText={codeText}>
            {children}
          </CodeBlock>
        );
      }
      return (
        <code
          className={
            variant === 'compact'
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-1 py-0.5 rounded text-xs font-mono'
              : 'bg-gray-100 dark:bg-[#2d2d2d] text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-sm font-mono'
          }
          {...props}
        >
          {children}
        </code>
      );
    },
    p: ({ children }: any) => <p className={variant === 'compact' ? 'mb-2 last:mb-0 leading-relaxed text-sm' : 'mb-3 last:mb-0 leading-relaxed'}>{children}</p>,
    ul: ({ children }: any) => <ul className={variant === 'compact' ? 'list-disc list-inside mb-2 space-y-0.5 ml-2 text-sm' : 'list-disc list-inside mb-3 space-y-1 ml-4'}>{children}</ul>,
    ol: ({ children }: any) => <ol className={variant === 'compact' ? 'list-decimal list-inside mb-2 space-y-0.5 ml-2 text-sm' : 'list-decimal list-inside mb-3 space-y-1 ml-4'}>{children}</ol>,
    blockquote: ({ children }: any) => (
      <blockquote
        className={
          variant === 'compact'
            ? 'border-l-3 border-gray-300 dark:border-gray-600 pl-3 my-2 italic text-gray-600 dark:text-gray-400 text-sm'
            : 'border-l-4 border-primary-500 dark:border-primary-400 pl-4 my-3 italic text-gray-700 dark:text-[#ffffff]'
        }
      >
        {children}
      </blockquote>
    ),
    a: ({ href, children }: any) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">
        {children}
      </a>
    ),
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-2">
        <table className="min-w-full border-collapse border border-gray-300 dark:border-[#404040] text-xs">{children}</table>
      </div>
    ),
    th: ({ children }: any) => <th className="border border-gray-300 dark:border-[#404040] px-2 py-1 font-semibold text-left">{children}</th>,
    td: ({ children }: any) => <td className="border border-gray-300 dark:border-[#404040] px-2 py-1">{children}</td>,
    img: ({ src, alt }: any) => <MarkdownImage src={src} alt={alt} />,
  };

  const mergedComponents: Components = {
    ...defaultComponents,
    ...(components || {}),
  };

  if (!markdown) {
    return (
      <div className={className ? className : 'text-[15px] leading-relaxed whitespace-pre-wrap break-words text-gray-900 dark:text-[#ffffff]'}>
        {renderedContent}
      </div>
    );
  }

  return (
    <div className={className ? className : 'prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-[#ffffff] markdown-content'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mergedComponents}>
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
};

