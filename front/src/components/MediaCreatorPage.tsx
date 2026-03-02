/**
 * chatu 页
 * - Chaya 图片工具栏：水平滚动缩略图条，一键选用
 * - 创作区：图像 Tab（文生图 / 图生图）、视频 Tab
 *   图片来源：Chaya 工具栏选取、本地上传、剪贴板粘贴
 * - 媒体管理区
 *
 * 遵循 niho_color_rule 与 front-mainpanel-layout
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import PageLayout, { Card } from './ui/PageLayout';
import { Button } from './ui/Button';
import { DataListItem } from './ui/DataListItem';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/Dialog';
import { CapabilityIcons } from './ui/CapabilityIcons';
import { messageApi, type Message } from '../services/api';
import { mediaApi, type MediaProvider } from '../services/mediaApi';
import { getSession } from '../services/sessionApi';
import type { PersonaPreset } from '../services/roleApi';
import {
  ImageIcon,
  Film,
  ImagePlus,
  Video,
  Loader2,
  X,
  Download,
  RefreshCw,
  Sparkles,
  Wand2,
  Upload,
  Clipboard,
  ZoomIn,
  Tag,
  Plus,
  Save,
  Trash2,
  Bookmark,
  PenLine,
  UserCircle,
  ChevronDown,
  ChevronUp,
  Copy,
} from 'lucide-react';
import { resolveMediaSrc } from '../utils/mediaSrc';

const CHAYA_SESSION_ID = 'agent_chaya';

/** 解析为可用于 img 的 URL，空或无效时返回空字符串（避免 net::ERR_INVALID_URL） */
function safeImgSrc(url: string | undefined): string {
  const raw = (url ?? '').trim();
  if (!raw) return '';
  const resolved = resolveMediaSrc(raw);
  return resolved.trim();
}

type CreateTab = 'image' | 'video';

/* ─── MediaItem ─── */
interface MediaItem {
  url: string;
  mimeType?: string;
  rawB64?: string;
  messageId?: string;
  /** 标记来源 */
  source?: 'chaya' | 'upload' | 'paste' | 'generated';
  /** 持久化产出 ID（后端 media_outputs.output_id） */
  output_id?: string;
}

/* ─── 从 Message[] 提取图片 ─── */
function extractMediaFromMessages(messages: Message[]): MediaItem[] {
  const out: MediaItem[] = [];
  for (const msg of messages) {
    let ext: any = msg.ext;
    if (typeof ext === 'string') { try { ext = JSON.parse(ext); } catch { ext = null; } }
    const collect = (list: any[], msgId?: string) => {
      if (!Array.isArray(list)) return;
      for (const m of list) {
        if (!m || typeof m !== 'object') continue;
        if (m.type && m.type !== 'image') continue;
        const mime = m.mimeType || m.mime_type || 'image/png';
        const raw = m.data ?? m.url ?? '';
        const url = (typeof raw === 'string' && raw.startsWith('data:'))
          ? raw
          : (m.url || (raw ? `data:${mime};base64,${raw}` : ''));
        if (url) out.push({ url, mimeType: mime, rawB64: typeof raw === 'string' && !raw.startsWith('data:') ? raw : undefined, messageId: msgId, source: 'chaya' });
      }
    };
    if (ext) { collect(ext.media, msg.message_id); collect(ext.images, msg.message_id); }
    const tc = msg.tool_calls as any;
    if (tc) {
      if (Array.isArray(tc)) { for (const item of tc) { if (item && typeof item === 'object' && Array.isArray(item.media)) collect(item.media, msg.message_id); } }
      else if (typeof tc === 'object' && Array.isArray(tc.media)) collect(tc.media, msg.message_id);
    }
    let mcp: any = msg.mcpdetail;
    if (typeof mcp === 'string') { try { mcp = JSON.parse(mcp); } catch { mcp = null; } }
    if (mcp && Array.isArray(mcp.raw_result)) {
      for (const item of mcp.raw_result) {
        if (item?.type === 'image') {
          const mime = item.mimeType || 'image/png';
          const raw = item.data ?? item.url ?? '';
          const url = (typeof raw === 'string' && raw.startsWith('data:'))
            ? raw
            : (item.url || (raw ? `data:${mime};base64,${raw}` : ''));
          if (url) out.push({ url, mimeType: mime, rawB64: typeof raw === 'string' && !raw.startsWith('data:') ? raw : undefined, messageId: msg.message_id, source: 'chaya' });
        }
      }
    }
    if (msg.content) {
      const b64Re = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g;
      let match: RegExpExecArray | null;
      while ((match = b64Re.exec(msg.content)) !== null) {
        out.push({ url: match[0], messageId: msg.message_id, source: 'chaya' });
      }
    }
  }
  return out;
}

/* ─── File → MediaItem ─── */
function fileToMediaItem(file: File): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const rawB64 = dataUrl.includes(';base64,') ? dataUrl.split(';base64,')[1] : undefined;
      resolve({ url: dataUrl, mimeType: file.type || 'image/png', rawB64, source: 'upload' });
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/* ─── 样式常量 ─── */
const tabBase = 'pb-2 text-sm font-medium transition-colors cursor-pointer select-none';
const tabInactive = `${tabBase} border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200`;
const tabActive = `${tabBase} border-b-2 border-[var(--color-accent)] text-gray-900 dark:text-white`;

const btnPrimary = '!bg-[var(--color-accent)] !text-black hover:!bg-[var(--color-accent-hover)] border-0';
const btnSecondary = 'border border-gray-300 dark:border-[#404040] bg-transparent';
const btnPink = '!bg-[var(--color-secondary)] !text-white hover:!opacity-90 border-0';

const textPrimary = 'text-gray-900 dark:text-white';
const textMuted = 'text-gray-500 dark:text-gray-400';

const inputClass = `w-full px-3 py-2 text-sm rounded-md border
  bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-[#333]
  focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]`;

const panelClass = `rounded-lg border
  bg-gray-50 dark:bg-[#111] border-gray-200 dark:border-[#333]`;

/* ─── 系统提示词预设 ─── */
interface PromptPreset {
  label: string;
  /** 追加到描述前的提示词 */
  text: string;
  /** 显示的标签颜色 CSS (accent / secondary / highlight) */
  color?: 'accent' | 'secondary' | 'highlight';
}

const PROMPT_PRESETS: PromptPreset[] = [
  { label: '动漫风格', text: '以高质量日式动漫风格绘制，线条清晰，色彩鲜艳，', color: 'secondary' },
  { label: '赛博朋克', text: '赛博朋克风格，霓虹灯光效果，暗色调城市背景，未来科技感，', color: 'accent' },
  { label: '水彩画', text: '水彩画风格，笔触柔和，色彩晕染过渡自然，纸质质感，', color: 'highlight' },
  { label: '写实摄影', text: '专业摄影写实风格，高清 8K 画质，自然光照，浅景深，', color: 'accent' },
  { label: '油画古典', text: '古典油画风格，丰富的笔触质感，温暖的色调，戏剧性光影，', color: 'highlight' },
  { label: '像素画', text: '像素艺术风格，16-bit 复古游戏画风，清晰的像素边缘，', color: 'secondary' },
  { label: '扁平插画', text: '现代扁平矢量插画风格，简洁几何形状，明亮纯色，无阴影，', color: 'accent' },
  { label: '3D 渲染', text: '高质量 3D 渲染风格，柔和光照，细腻材质，Blender/C4D 质感，', color: 'secondary' },
  { label: '素描线稿', text: '黑白铅笔素描风格，精细的线条与阴影，手绘质感，', color: 'highlight' },
  { label: '中国水墨', text: '传统中国水墨画风格，留白意境，墨色浓淡变化，宣纸质感，', color: 'accent' },
];

/* ─── 自定义提示词 ─── */
interface CustomPrompt {
  id: string;
  label: string;
  text: string;
}

const CUSTOM_PROMPTS_KEY = 'media-creator-custom-prompts';

function loadCustomPrompts(): CustomPrompt[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PROMPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveCustomPrompts(prompts: CustomPrompt[]) {
  localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(prompts));
}

/* ═══════════════════════════════════════════════════════════ */

interface MediaCreatorPageProps {
  /** 嵌入模式：不包裹 PageLayout，由父级提供布局 */
  embedded?: boolean;
}

const MediaCreatorPage: React.FC<MediaCreatorPageProps> = ({ embedded = false }) => {
  /* ─── State ─── */
  const [chayaMedia, setChayaMedia] = useState<MediaItem[]>([]);
  const [chayaLoading, setChayaLoading] = useState(true);

  const [providers, setProviders] = useState<MediaProvider[]>([]);
  const [providerLoading, setProviderLoading] = useState(true);
  /** 选中的 config_id（粒度到具体模型配置） */
  const [selectedConfigId, setSelectedConfigId] = useState('');

  const [createTab, setCreateTab] = useState<CreateTab>('image');
  const [showModelDialog, setShowModelDialog] = useState(false);

  // 统一图像生成（无图=文生图，有图=二创）
  const [refImages, setRefImages] = useState<MediaItem[]>([]);
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgLoading, setImgLoading] = useState(false);
  const [imgResult, setImgResult] = useState<MediaItem | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  // 拖拽高亮
  const [dragOver, setDragOver] = useState(false);

  // 视频
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoTaskId, setVideoTaskId] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState('');
  const [videoOutput, setVideoOutput] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  // 创作产出媒体库（持久化懒加载：一次 10 条）
  const [createdMedia, setCreatedMedia] = useState<MediaItem[]>([]);
  const [createdMediaLoading, setCreatedMediaLoading] = useState(true);
  const [createdMediaHasMore, setCreatedMediaHasMore] = useState(true);
  const [createdMediaLoadingMore, setCreatedMediaLoadingMore] = useState(false);

  // 素材库 Tab：Chaya / Chatu 创作
  const [materialTab, setMaterialTab] = useState<'chaya' | 'chatu'>('chaya');

  // Chaya 人设
  const [chayaSystemPrompt, setChayaSystemPrompt] = useState('');
  const [chayaPersonaPresets, setChayaPersonaPresets] = useState<PersonaPreset[]>([]);
  const [chayaCurrentPersonaId, setChayaCurrentPersonaId] = useState<string | null>(null);
  const [personaExpanded, setPersonaExpanded] = useState(false);

  // 自定义提示词
  const [customPrompts, setCustomPrompts] = useState<CustomPrompt[]>(() => loadCustomPrompts());
  const [showAddPrompt, setShowAddPrompt] = useState(false);
  const [newPromptLabel, setNewPromptLabel] = useState('');
  const [newPromptText, setNewPromptText] = useState('');
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  /* ─── Load ─── */
  const loadChayaMedia = useCallback(async () => {
    setChayaLoading(true);
    try {
      const res = await messageApi.getMessagesPaginated(CHAYA_SESSION_ID, { limit: 200 });
      setChayaMedia(extractMediaFromMessages(res.messages || []));
    } catch {
      try {
        const msgs = await messageApi.getMessages(CHAYA_SESSION_ID, { limit: 200 });
        setChayaMedia(extractMediaFromMessages(Array.isArray(msgs) ? msgs : []));
      } catch { setChayaMedia([]); }
    } finally { setChayaLoading(false); }
  }, []);

  const loadProviders = useCallback(async () => {
    setProviderLoading(true);
    try {
      const res = await mediaApi.getProviders();
      const list = res.providers || [];
      setProviders(list);
      const allConfigIds = new Set(list.flatMap((p) => (p.configs || []).map((c) => c.config_id)));
      const firstCfg = list[0]?.configs?.[0];
      if (list.length && firstCfg) {
        if (!selectedConfigId || !allConfigIds.has(selectedConfigId)) {
          setSelectedConfigId(firstCfg.config_id);
        }
      } else {
        setSelectedConfigId('');
      }
    } catch { setProviders([]); setSelectedConfigId(''); }
    finally { setProviderLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadChayaPersona = useCallback(async () => {
    try {
      const session = await getSession(CHAYA_SESSION_ID);
      setChayaSystemPrompt(session.system_prompt || '');
      const ext = session.ext || {};
      const presets: PersonaPreset[] = Array.isArray(ext.personaPresets) ? ext.personaPresets : [];
      setChayaPersonaPresets(presets);
      setChayaCurrentPersonaId(ext.currentPersonaId || null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadChayaMedia(); }, [loadChayaMedia]);
  useEffect(() => { loadProviders(); }, [loadProviders]);
  useEffect(() => { loadChayaPersona(); }, [loadChayaPersona]);

  const PAGE_SIZE = 10;
  /* ─── 持久化创作产出：懒加载，首次 10 条 ─── */
  useEffect(() => {
    let cancelled = false;
    setCreatedMediaLoading(true);
    setCreatedMediaHasMore(true);
    mediaApi.listOutputs(PAGE_SIZE, 0)
      .then((res) => {
        if (cancelled) return;
        const list = res.items || [];
        const items: MediaItem[] = list.map((o) => ({
          url: mediaApi.getOutputFileUrl(o.output_id),
          mimeType: o.mime_type,
          source: 'generated' as const,
          output_id: o.output_id,
        }));
        setCreatedMedia(items);
        setCreatedMediaHasMore(list.length >= PAGE_SIZE);
      })
      .catch(() => { if (!cancelled) setCreatedMedia([]); setCreatedMediaHasMore(false); })
      .finally(() => { if (!cancelled) setCreatedMediaLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const loadMoreCreatedMedia = useCallback(() => {
    if (createdMediaLoadingMore || !createdMediaHasMore) return;
    setCreatedMediaLoadingMore(true);
    mediaApi.listOutputs(PAGE_SIZE, createdMedia.length)
      .then((res) => {
        const list = res.items || [];
        const items: MediaItem[] = list.map((o) => ({
          url: mediaApi.getOutputFileUrl(o.output_id),
          mimeType: o.mime_type,
          source: 'generated' as const,
          output_id: o.output_id,
        }));
        setCreatedMedia((prev) => [...prev, ...items]);
        setCreatedMediaHasMore(list.length >= PAGE_SIZE);
      })
      .catch(() => setCreatedMediaHasMore(false))
      .finally(() => setCreatedMediaLoadingMore(false));
  }, [createdMedia.length, createdMediaHasMore, createdMediaLoadingMore]);

  /* ─── 自定义提示词 CRUD ─── */
  const addCustomPrompt = () => {
    const label = newPromptLabel.trim();
    const text = newPromptText.trim();
    if (!label || !text) return;

    if (editingPromptId) {
      // 编辑
      const updated = customPrompts.map((p) =>
        p.id === editingPromptId ? { ...p, label, text } : p
      );
      setCustomPrompts(updated);
      saveCustomPrompts(updated);
      setEditingPromptId(null);
    } else {
      // 新增
      const newPrompt: CustomPrompt = { id: `cp-${Date.now()}`, label, text };
      const updated = [...customPrompts, newPrompt];
      setCustomPrompts(updated);
      saveCustomPrompts(updated);
    }
    setNewPromptLabel('');
    setNewPromptText('');
    setShowAddPrompt(false);
  };

  const deleteCustomPrompt = (id: string) => {
    const updated = customPrompts.filter((p) => p.id !== id);
    setCustomPrompts(updated);
    saveCustomPrompts(updated);
    if (editingPromptId === id) {
      setEditingPromptId(null);
      setNewPromptLabel('');
      setNewPromptText('');
    }
  };

  const startEditPrompt = (prompt: CustomPrompt) => {
    setEditingPromptId(prompt.id);
    setNewPromptLabel(prompt.label);
    setNewPromptText(prompt.text);
    setShowAddPrompt(true);
  };

  const cancelEditPrompt = () => {
    setEditingPromptId(null);
    setNewPromptLabel('');
    setNewPromptText('');
    setShowAddPrompt(false);
  };

  /** 将提示词前缀追加到当前 prompt（图像或视频 tab） */
  const applyPromptText = (text: string) => {
    if (createTab === 'image') {
      setImgPrompt((prev) => text + prev);
    } else {
      setVideoPrompt((prev) => text + prev);
    }
  };

  /* ─── 按 Tab 筛选可用 configs（使用 per-config capabilities, media_purpose 优先） ─── */
  const currentConfigs = (() => {
    const out: Array<{
      config_id: string; name: string; model: string; provider: string;
      providerId: string; providerName: string;
      capabilities?: { image: boolean; video: boolean };
      media_purpose?: boolean;
    }> = [];
    for (const p of providers) {
      for (const c of p.configs || []) {
        const caps = (c as any).capabilities as { image: boolean; video: boolean } | undefined;
        const isMediaPurpose = !!(c as any).media_purpose;
        const isImage = caps ? caps.image : !!(p.image?.generate || p.image?.edit);
        const isVideo = caps ? caps.video : !!p.video?.submit;
        if (createTab === 'image' && isImage) {
          out.push({ ...c, providerId: p.id, providerName: p.name, capabilities: caps, media_purpose: isMediaPurpose });
        } else if (createTab === 'video' && isVideo) {
          out.push({ ...c, providerId: p.id, providerName: p.name, capabilities: caps, media_purpose: isMediaPurpose });
        }
      }
    }
    // 排序：media_purpose 优先
    out.sort((a, b) => (b.media_purpose ? 1 : 0) - (a.media_purpose ? 1 : 0));
    return out;
  })();

  /** 当前选中 config 的完整信息 */
  const activeConfig = currentConfigs.find((c) => c.config_id === selectedConfigId);
  /** 当前选中 config 所属 provider id */
  const activeProviderId = activeConfig?.providerId || '';

  // 如果当前选中不在 tab 可用列表中，自动切到第一个
  useEffect(() => {
    if (!activeConfig && currentConfigs.length > 0) {
      setSelectedConfigId(currentConfigs[0].config_id);
    }
  }, [createTab, activeConfig, currentConfigs]);

  /* ─── 添加到创作产出库 ─── */
  const addToCreated = useCallback((item: MediaItem) => {
    setCreatedMedia((prev) => {
      // 去重（按 url 或 output_id）
      if (prev.some((p) => p.url === item.url || (item.output_id && p.output_id === item.output_id))) return prev;
      return [item, ...prev];
    });
  }, []);

  /** 从 item 获取 base64 用于持久化（rawB64 / data URL / 或 fetch blob URL） */
  const getBase64FromItem = useCallback((item: MediaItem): Promise<string | null> => {
    if (item.rawB64) return Promise.resolve(item.rawB64);
    if (item.url.startsWith('data:') && item.url.includes(';base64,')) {
      return Promise.resolve(item.url.split(';base64,')[1] ?? null);
    }
    if (item.url.startsWith('data:')) return Promise.resolve(item.url.split(',')[1] ?? null);
    return fetch(item.url)
      .then((r) => r.blob())
      .then((blob) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const b64 = dataUrl.includes(';base64,') ? dataUrl.split(';base64,')[1] : dataUrl.split(',')[1];
          resolve(b64 ?? '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }));
  }, []);

  /** 持久化到后端并更新为后端文件 URL（chatu 生成后自动保存，下次打开从 listOutputs 加载） */
  const persistCreatedItem = useCallback(async (item: MediaItem) => {
    if (item.output_id || item.source !== 'generated') return;
    const mediaType = item.mimeType?.startsWith('video/') ? 'video' : 'image';
    try {
      const b64 = await getBase64FromItem(item);
      if (!b64) return;
      const res = await mediaApi.saveOutput({
        data: b64,
        media_type: mediaType,
        mime_type: item.mimeType,
        source: 'generated',
      });
      if (res.error) {
        console.warn('[chatu] 保存产出失败:', res.error);
        return;
      }
      const fileUrl = mediaApi.getOutputFileUrl(res.output_id);
      setCreatedMedia((prev) =>
        prev.map((p) => (p.url === item.url ? { ...p, url: fileUrl, output_id: res.output_id } : p))
      );
    } catch (e) {
      console.warn('[chatu] 保存产出异常:', e);
    }
  }, [getBase64FromItem]);


  /* ─── 选择参考图（追加） ─── */
  const pickRefImage = (item: MediaItem) => {
    setRefImages((prev) => {
      // 去重
      if (prev.some((p) => p.url === item.url)) return prev;
      return [...prev, item];
    });
    setImgResult(null);
    setImgError(null);
    if (createTab !== 'image') setCreateTab('image');
  };

  /** 移除某张参考图 */
  const removeRefImage = (index: number) => {
    setRefImages((prev) => prev.filter((_, i) => i !== index));
  };

  /** 清空所有参考图 */
  const clearRefImages = () => {
    setRefImages([]);
  };

  /* ─── 文件上传（支持多文件） ─── */
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      try {
        const item = await fileToMediaItem(file);
        pickRefImage(item);
      } catch { /* ignore */ }
    }
  };

  /* ─── 剪贴板粘贴 ─── */
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const media = await fileToMediaItem(file);
          media.source = 'paste';
          pickRefImage(media);
        }
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  /* ─── 拖放 ─── */
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  };

  /* ─── 获取 base64（支持 URL / data URL / rawB64） ─── */
  const getB64 = useCallback(async (item: MediaItem): Promise<string | null> => {
    if (item.rawB64) return item.rawB64;
    if (item.url.startsWith('data:') && item.url.includes(';base64,')) return item.url.split(';base64,')[1];
    if (item.url.startsWith('data:')) return item.url.split(',')[1] ?? null;
    // 其他情况（如后端文件 URL）转成 base64
    return getBase64FromItem(item);
  }, [getBase64FromItem]);

  /* ─── 统一图像生成（无图=文生图，有图=二创，支持多图） ─── */
  const handleGenerate = async () => {
    if (!imgPrompt.trim() || !activeConfig) return;
    setImgLoading(true); setImgError(null); setImgResult(null);
    const isEdit = refImages.length > 0;
    try {
      let result: any;
      const cfgId = activeConfig.config_id;
      if (isEdit) {
        // 二创（图生图）— 传所有参考图
        const images_b64 = (await Promise.all(refImages.map(async (img) => {
          const data = await getB64(img);
          if (!data) return null;
          return {
            data,
            mime: img.mimeType || 'image/png',
          };
        }))).filter(Boolean) as Array<{ data: string; mime: string }>;
        if (images_b64.length === 0) {
          throw new Error('参考图无效或无法读取');
        }
        if (activeProviderId === 'gemini') {
          result = await mediaApi.geminiImageEdit({
            prompt: imgPrompt,
            image_b64: images_b64[0].data,
            images_b64: images_b64.map((i) => i.data),
            config_id: cfgId,
          });
        } else {
          throw new Error(`不支持的图像供应商: ${activeProviderId}`);
        }
      } else {
        // 文生图
        if (activeProviderId === 'gemini') {
          result = await mediaApi.geminiImageGenerate({ prompt: imgPrompt, config_id: cfgId });
        } else {
          throw new Error(`不支持的图像供应商: ${activeProviderId}`);
        }
      }
      if (result.error) throw new Error(result.error);
      const m = result.media?.[0];
      if (!m) throw new Error('未返回图片');
      const mime = m.mimeType || 'image/png';
      const url = m.url || (m.data ? `data:${mime};base64,${m.data}` : '');
      if (url) {
        const item: MediaItem = { url, mimeType: mime, rawB64: m.data, source: 'generated' };
        setImgResult(item);
        addToCreated(item);
        persistCreatedItem(item);
      }
    } catch (e: any) { setImgError(e?.message || String(e)); }
    finally { setImgLoading(false); }
  };

  /* ─── 视频（支持 Gemini/Veo 和 Runway） ─── */
  const handleVideoSubmit = async () => {
    if (!videoPrompt.trim() && refImages.length === 0) return;
    setVideoLoading(true); setVideoError(null); setVideoTaskId(null); setVideoOutput(null); setVideoStatus('');
    try {
      if (activeProviderId === 'gemini') {
        // Gemini Veo 视频生成
        const body: any = { prompt: videoPrompt };
        if (refImages.length > 0) {
          const b64 = await getB64(refImages[0]);
          if (!b64) throw new Error('参考图无效或无法读取');
          body.image_b64 = b64;
        }
        if (activeConfig) {
          body.config_id = activeConfig.config_id;
          body.model = activeConfig.model;
        }
        const result = await mediaApi.geminiVideoSubmit(body);
        if (result.error) throw new Error(result.error);
        if (result.task_name) {
          setVideoTaskId(result.task_name);
          setVideoStatus('PROCESSING');
          pollGeminiVideo(result.task_name, activeConfig?.config_id);
        }
      } else if (activeProviderId === 'runway') {
        // Runway 视频生成
        const body: any = {};
        if (videoPrompt.trim()) body.prompt_text = videoPrompt;
        if (refImages.length > 0) body.prompt_image = refImages[0].url;
        if (activeConfig) body.model = activeConfig.model;
        const result = await mediaApi.runwayVideoSubmit(body);
        if (result.error) throw new Error(result.error);
        if (result.task_id) { setVideoTaskId(result.task_id); setVideoStatus('PENDING'); pollRunwayVideo(result.task_id); }
      } else {
        throw new Error(`不支持的视频供应商: ${activeProviderId}`);
      }
    } catch (e: any) { setVideoError(e?.message || String(e)); }
    finally { setVideoLoading(false); }
  };

  /** 轮询 Runway 视频状态 */
  const pollRunwayVideo = (taskId: string) => {
    let n = 0;
    const go = async () => {
      if (n++ >= 60) { setVideoError('轮询超时'); return; }
      try {
        const r = await mediaApi.runwayVideoStatus(taskId);
        const st = (r.status || '').toUpperCase();
        setVideoStatus(st);
        if (st === 'SUCCEEDED' || st === 'COMPLETED') {
          setVideoOutput(r.output || null);
          if (r.output) {
            const vItem: MediaItem = { url: r.output, mimeType: 'video/mp4', source: 'generated' };
            addToCreated(vItem);
            persistCreatedItem(vItem);
          }
          return;
        }
        if (st === 'FAILED' || st === 'CANCELLED' || st === 'ERROR') { setVideoError(r.error || `状态: ${st}`); return; }
        setTimeout(go, 5000);
      } catch (e: any) { setVideoError(e?.message || '轮询失败'); }
    };
    setTimeout(go, 3000);
  };

  /** 轮询 Gemini Veo 视频状态 */
  const pollGeminiVideo = (taskName: string, configId?: string) => {
    let n = 0;
    const go = async () => {
      if (n++ >= 120) { setVideoError('轮询超时（10 分钟）'); return; }
      try {
        const r = await mediaApi.geminiVideoStatus(taskName, configId);
        const st = (r.status || '').toUpperCase();
        setVideoStatus(st);
        if (st === 'SUCCEEDED' || st === 'COMPLETED') {
          if (r.output) {
            // 视频 URI 需要 API Key 才能访问，通过后端代理下载
            try {
              setVideoStatus('DOWNLOADING');
              const blobUrl = await mediaApi.geminiVideoDownload(r.output, configId);
              setVideoOutput(blobUrl);
              const vItem: MediaItem = { url: blobUrl, mimeType: 'video/mp4', source: 'generated' };
              addToCreated(vItem);
              persistCreatedItem(vItem);
            } catch (dlErr: any) {
              setVideoError(`视频生成成功，但下载失败: ${dlErr?.message || '未知错误'}`);
            }
          } else {
            setVideoOutput(null);
            setVideoError('视频生成完成，但未返回视频地址');
          }
          return;
        }
        if (st === 'FAILED' || st === 'CANCELLED' || st === 'ERROR') {
          setVideoError(r.error || `状态: ${st}`);
          return;
        }
        // PROCESSING — 继续轮询
        setTimeout(go, 5000);
      } catch (e: any) { setVideoError(e?.message || '轮询失败'); }
    };
    setTimeout(go, 5000);
  };

  /* ─── Download ─── */
  const dl = (url: string, name?: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = name || 'media'; a.target = '_blank';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  /* ─── 隐藏 file input ─── */
  const triggerFileInput = () => fileInputRef.current?.click();

  /* ═══════════════ RENDER ═══════════════ */

  const mainContent = (
    <>
      <div className="chatu-page max-w-6xl mx-auto flex flex-col gap-4">
        {/* ═══ 顶部：素材库（Tab：Chaya / Chatu 创作） ═══ */}
        <div className={`niho-card-1 rounded-lg border ${panelClass} p-3 space-y-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 border-b border-transparent">
              <button
                type="button"
                className={`pb-1.5 text-[11px] font-medium border-b-2 transition-colors ${materialTab === 'chaya' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : `border-transparent ${textMuted}`}`}
                onClick={() => setMaterialTab('chaya')}
              >
                Chaya
              </button>
              <button
                type="button"
                className={`pb-1.5 text-[11px] font-medium border-b-2 transition-colors ${materialTab === 'chatu' ? 'border-[var(--color-secondary)] text-[var(--color-secondary)]' : `border-transparent ${textMuted}`}`}
                onClick={() => setMaterialTab('chatu')}
              >
                Chatu 创作
              </button>
            </div>
          </div>
          {materialTab === 'chaya' && (
            <div className="min-w-0">
              <p className={`text-[10px] ${textMuted} mb-1.5 flex items-center gap-1`}>
                {chayaLoading ? '...' : `${chayaMedia.length} 张`}
                <button type="button" onClick={loadChayaMedia} disabled={chayaLoading} className="p-0.5 rounded hover:bg-white/10" title="刷新">
                  <RefreshCw className={`w-3 h-3 ${chayaLoading ? 'animate-spin' : ''}`} />
                </button>
              </p>
              <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                {chayaMedia.length === 0 && !chayaLoading ? (
                  <span className={`text-[10px] ${textMuted}`}>暂无 — 与 Chaya 对话后出现</span>
                ) : chayaLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                ) : (
                  chayaMedia.map((item, i) => {
                    const isActive = refImages.some((r) => r.url === item.url);
                    const src = safeImgSrc(item.url);
                    return (
                      <div
                        key={i}
                        className={`chatu-thumb flex-shrink-0 w-14 h-14 rounded-md overflow-hidden cursor-pointer border-2 transition-all
                          ${isActive ? 'chatu-thumb--active border-[var(--color-accent)]' : 'border-transparent hover:border-[var(--color-accent)]/40'}`}
                        onClick={() => pickRefImage(item)}
                        title="选用"
                      >
                        {src ? (
                          <img src={src} alt="" className="w-full h-full object-cover bg-black" />
                        ) : (
                          <div className="w-full h-full bg-black flex items-center justify-center text-[var(--niho-skyblue-gray)]">
                            <ImageIcon className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
          {materialTab === 'chatu' && (
            <div className="min-w-0">
              <p className={`text-[10px] ${textMuted} mb-1.5 flex items-center gap-1`}>
                {createdMediaLoading ? '加载中...' : `${createdMedia.length} 项`}
                {createdMedia.length > 0 && (
                  <button type="button" className="p-0.5 rounded hover:bg-white/10" title="清空" onClick={async () => {
                    await Promise.all(createdMedia.filter((i) => i.output_id).map((i) => mediaApi.deleteOutput(i.output_id!)));
                    setCreatedMedia([]);
                  }}>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </p>
              <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                {createdMediaLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--color-secondary)]" />
                ) : createdMedia.length === 0 ? (
                  <span className={`text-[10px] ${textMuted}`}>生成后自动保存并出现在这里</span>
                ) : (
                  <>
                    {createdMedia.map((item, i) => {
                      const isVideo = item.mimeType?.startsWith('video/');
                      const isActive = refImages.some((r) => r.url === item.url);
                      return (
                        <div
                          key={`c-${i}`}
                          className={`chatu-thumb flex-shrink-0 w-14 h-14 rounded-md overflow-hidden cursor-pointer border-2 transition-all relative group/ct
                            ${isActive ? 'chatu-thumb--active-pink border-[var(--color-secondary)]' : 'border-transparent hover:border-[var(--color-secondary)]/40'}`}
                          onClick={() => !isVideo && pickRefImage(item)}
                          title={isVideo ? '视频' : '选用二创'}
                        >
                          {isVideo ? (
                            <div className="w-full h-full bg-black flex items-center justify-center">
                              <Film className="w-4 h-4 text-[var(--color-secondary)]" />
                            </div>
                          ) : (() => {
                            const src = safeImgSrc(item.url);
                            return src ? (
                              <img src={src} alt="" className="w-full h-full object-cover bg-black" />
                            ) : (
                              <div className="w-full h-full bg-black flex items-center justify-center text-[var(--niho-skyblue-gray)]">
                                <ImageIcon className="w-6 h-6" />
                              </div>
                            );
                          })()}
                          <div className="absolute inset-0 bg-black/0 group-hover/ct:bg-black/40 flex items-end justify-center opacity-0 group-hover/ct:opacity-100 pb-0.5 gap-0.5 transition-colors">
                            <button className="p-0.5 rounded bg-black/60 text-white" onClick={(e) => { e.stopPropagation(); isVideo ? window.open(item.url, '_blank') : setLightboxUrl(resolveMediaSrc(item.url ?? '')); }}><ZoomIn className="w-2.5 h-2.5" /></button>
                            <button className="p-0.5 rounded bg-black/60 text-white" onClick={(e) => { e.stopPropagation(); dl(item.output_id ? `${mediaApi.getOutputFileUrl(item.output_id)}?download=1` : resolveMediaSrc(item.url ?? ''), isVideo ? `video-${i}.mp4` : `created-${i}.png`); }}><Download className="w-2.5 h-2.5" /></button>
                          </div>
                          <span className="absolute top-0 left-0 text-[7px] px-0.5 rounded-br bg-[var(--color-secondary)]/80 text-white">{isVideo ? '视频' : '图'}</span>
                        </div>
                      );
                    })}
                    {createdMediaHasMore && (
                      <button
                        type="button"
                        className="flex-shrink-0 w-14 h-14 rounded-md border-2 border-dashed border-[var(--niho-text-border)] flex items-center justify-center text-[10px] text-[var(--niho-skyblue-gray)] hover:border-[var(--color-secondary)]/50 hover:text-[var(--color-secondary)] transition-colors disabled:opacity-50"
                        onClick={loadMoreCreatedMedia}
                        disabled={createdMediaLoadingMore}
                        title="加载更多"
                      >
                        {createdMediaLoadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : '加载更多'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-6">
        {/* ════════ 创作区 ════════ */}
        <Card title="创作区" variant="persona" size="relaxed">
          <div className="space-y-4">
            {/* Tab */}
            <div className="flex gap-6 border-b border-gray-200 dark:border-[#333]">
              <button type="button" className={createTab === 'image' ? tabActive : tabInactive} onClick={() => setCreateTab('image')}>
                <span className="flex items-center gap-1.5"><ImageIcon className="w-4 h-4" /> 图像</span>
              </button>
              <button type="button" className={createTab === 'video' ? tabActive : tabInactive} onClick={() => setCreateTab('video')}>
                <span className="flex items-center gap-1.5"><Film className="w-4 h-4" /> 视频</span>
              </button>
            </div>

            {/* 模型选择 — 图像 Tab 时右侧放生成按钮 */}
            {providerLoading ? (
              <div className={`flex items-center gap-2 text-sm ${textMuted}`}><Loader2 className="w-4 h-4 animate-spin" /> 加载模型配置...</div>
            ) : currentConfigs.length === 0 ? (
              <div className={`text-sm ${textMuted} ${panelClass} p-3`}>
                {createTab === 'image'
                  ? '未配置图像模型 — 请在「大模型录入 → chatu 录入」中添加支持生图的模型'
                  : '未配置视频模型 — 请在「大模型录入 → chatu 录入」中添加支持视频生成的模型'}
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className={`${btnSecondary} !text-xs gap-1.5`}
                    onClick={() => setShowModelDialog(true)}
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    {activeConfig
                      ? <span className="truncate max-w-[200px]">{activeConfig.model || activeConfig.name}</span>
                      : '选择模型'}
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </Button>
                  {activeConfig && (
                    <span className="flex items-center gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded bg-white/5 ${textMuted}`}>{activeConfig.providerName}</span>
                      {activeConfig.capabilities?.image && <span className="text-[9px] px-1 py-0 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">图</span>}
                      {activeConfig.capabilities?.video && <span className="text-[9px] px-1 py-0 rounded bg-[var(--color-highlight)]/10 text-[var(--color-highlight)]">视</span>}
                    </span>
                  )}
                </div>
                {createTab === 'image' && (
                  <Button
                    className={refImages.length > 0 ? btnPink : btnPrimary}
                    size="sm"
                    disabled={imgLoading || !imgPrompt.trim() || !activeConfig}
                    onClick={handleGenerate}
                  >
                    {imgLoading
                      ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> 生成中...</>
                      : refImages.length > 0
                        ? <><Sparkles className="w-4 h-4 mr-1" /> 二创</>
                        : <><Wand2 className="w-4 h-4 mr-1" /> 生成</>
                    }
                  </Button>
                )}
              </div>
            )}

            {/* ── 图像 Tab — 统一创作 + 结果 ── */}
            {createTab === 'image' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ═══ 左栏：统一输入区 ═══ */}
                <div
                  ref={dropZoneRef}
                  className={`niho-card-2 ${panelClass} p-4 space-y-4 min-w-0 transition-colors ${dragOver ? '!border-[var(--color-accent)] bg-[var(--color-accent)]/5' : ''}`}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                >
                  {/* 标题 */}
                  <div className="flex items-center justify-between">
                    <h3 className={`text-sm font-medium ${textPrimary} flex items-center gap-1.5`}>
                      <Wand2 className="w-4 h-4 text-[var(--color-accent)]" />
                      {refImages.length > 0 ? `二创（${refImages.length}张参考图）` : '文生图'}
                    </h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      refImages.length > 0
                        ? 'bg-[var(--color-secondary)]/15 text-[var(--color-secondary)]'
                        : 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                    }`}>
                      {refImages.length > 0 ? '已挂载参考图' : '纯文字生图'}
                    </span>
                  </div>

                  {/* 参考图区域（多图） */}
                  {refImages.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex gap-2 flex-wrap">
                        {refImages.map((img, idx) => {
                          const src = safeImgSrc(img.url);
                          return (
                          <div key={idx} className="relative flex-shrink-0 group/ri">
                            {src ? (
                              <img
                                src={src}
                                alt={`参考图 ${idx + 1}`}
                                className="rounded-md border border-[var(--color-accent)]/50 h-16 w-auto object-contain cursor-pointer"
                                onClick={() => setLightboxUrl(resolveMediaSrc(img.url ?? ''))}
                              />
                            ) : (
                              <div className="rounded-md border border-[var(--color-accent)]/50 h-16 w-16 flex items-center justify-center bg-black text-[var(--niho-skyblue-gray)]">
                                <ImageIcon className="w-6 h-6" />
                              </div>
                            )}
                            <button
                              className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-[var(--color-secondary)] text-white
                                opacity-0 group-hover/ri:opacity-100 transition-opacity"
                              onClick={() => removeRefImage(idx)}
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                            <span className="absolute bottom-0.5 left-0.5 text-[7px] px-0.5 py-0 rounded bg-black/60 text-white leading-tight">
                              {img.source === 'chaya' ? 'Chaya' : img.source === 'upload' ? '上传' : img.source === 'paste' ? '粘贴' : '生成'}
                            </span>
                          </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-1.5 flex-wrap items-center">
                        <Button variant="outline" size="sm" className={`${btnSecondary} !text-[11px] !py-0.5 !px-2`} onClick={triggerFileInput}>
                          <Plus className="w-3 h-3 mr-1" /> 添加更多
                        </Button>
                        <Button variant="outline" size="sm" className={`${btnSecondary} !text-[11px] !py-0.5 !px-2`} onClick={clearRefImages}>
                          <X className="w-3 h-3 mr-1" /> 全部移除
                        </Button>
                        <span className={`text-[10px] ${textMuted} opacity-60`}>支持多图参考，Gemini 多图融合生成</span>
                      </div>
                    </div>
                  ) : (
                    <div className={`
                      flex items-center justify-between py-2.5 px-3 gap-3
                      border border-dashed rounded-lg transition-colors
                      ${dragOver
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                        : 'border-gray-300 dark:border-[#333]'
                      }
                    `}>
                      <div className="flex items-center gap-2 min-w-0">
                        <ImagePlus className={`w-5 h-5 ${textMuted} opacity-50 flex-shrink-0`} />
                        <p className={`text-xs ${textMuted} truncate`}>添加参考图 → 自动切换为二创</p>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <Button variant="outline" size="sm" className={`${btnSecondary} !text-[11px] !py-0.5 !px-2`} onClick={triggerFileInput}>
                          <Upload className="w-3 h-3 mr-1" /> 上传
                        </Button>
                        <Button variant="outline" size="sm" className={`${btnSecondary} !text-[11px] !py-0.5 !px-2`}
                          onClick={() => {
                            navigator.clipboard.read?.().then(items => {
                              for (const ci of items) {
                                const imgType = ci.types.find(t => t.startsWith('image/'));
                                if (imgType) {
                                  ci.getType(imgType).then(blob => {
                                    const file = new File([blob], 'paste.png', { type: imgType });
                                    fileToMediaItem(file).then(m => { m.source = 'paste'; pickRefImage(m); });
                                  });
                                  return;
                                }
                              }
                            }).catch(() => {});
                          }}
                        >
                          <Clipboard className="w-3 h-3 mr-1" /> 粘贴
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ── 提示词区域：系统预设 + 自定义 ── */}
                  <div className="space-y-2.5">
                    {/* 系统风格预设 */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Tag className="w-3 h-3 text-[var(--color-highlight)]" />
                        <span className={`text-[10px] font-medium ${textMuted}`}>风格预设</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {PROMPT_PRESETS.map((p) => {
                          const colorVar = p.color === 'secondary' ? 'var(--color-secondary)'
                            : p.color === 'highlight' ? 'var(--color-highlight)'
                            : 'var(--color-accent)';
                          return (
                            <button
                              key={p.label}
                              type="button"
                              className="text-[10px] px-2 py-0.5 rounded-full border transition-colors
                                hover:opacity-80 active:scale-95 cursor-pointer select-none"
                              style={{
                                borderColor: colorVar,
                                color: colorVar,
                                backgroundColor: 'transparent',
                              }}
                              onClick={() => applyPromptText(p.text)}
                              title={`填充: ${p.text}`}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Chaya 人设提示词 */}
                    {(chayaSystemPrompt || chayaPersonaPresets.length > 0) && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <UserCircle className="w-3 h-3 text-[var(--color-accent)]" />
                            <span className={`text-[10px] font-medium ${textMuted}`}>
                              Chaya 人设
                              {chayaPersonaPresets.length > 0 && ` (${chayaPersonaPresets.length + 1})`}
                            </span>
                          </div>
                          <button
                            type="button"
                            className={`text-[10px] flex items-center gap-0.5 ${textMuted} hover:text-[var(--color-accent)] transition-colors`}
                            onClick={() => setPersonaExpanded(!personaExpanded)}
                          >
                            {personaExpanded ? <><ChevronUp className="w-2.5 h-2.5" /> 收起</> : <><ChevronDown className="w-2.5 h-2.5" /> 展开</>}
                          </button>
                        </div>

                        {/* 人设预设标签行 */}
                        <div className="flex flex-wrap gap-1.5">
                          {/* 当前主人设 */}
                          {chayaSystemPrompt && (
                            <button
                              type="button"
                              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors
                                hover:opacity-80 active:scale-95 cursor-pointer select-none
                                border-[var(--color-accent)] text-[var(--color-accent)]
                                ${!chayaCurrentPersonaId ? 'bg-[var(--color-accent)]/10' : 'bg-transparent'}`}
                              onClick={() => applyPromptText(chayaSystemPrompt)}
                              title="点击填充当前人设全文"
                            >
                              主人设{!chayaCurrentPersonaId && ' ●'}
                            </button>
                          )}
                          {/* 人设预设列表 */}
                          {chayaPersonaPresets.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors
                                hover:opacity-80 active:scale-95 cursor-pointer select-none
                                border-[var(--color-accent)]/60 text-[var(--color-accent)]
                                ${chayaCurrentPersonaId === preset.id ? 'bg-[var(--color-accent)]/10' : 'bg-transparent'}`}
                              onClick={() => applyPromptText(preset.system_prompt)}
                              title={`点击填充「${preset.nickname}」人设`}
                            >
                              {preset.nickname}{chayaCurrentPersonaId === preset.id && ' ●'}
                            </button>
                          ))}
                        </div>

                        {/* 展开后显示人设内容 */}
                        {personaExpanded && (
                          <div className="space-y-2 mt-1">
                            {/* 当前主人设内容 */}
                            {chayaSystemPrompt && (
                              <div className={`niho-block-green ${panelClass} p-2 space-y-1 !bg-transparent`}>
                                <div className="flex items-center justify-between">
                                  <span className={`text-[9px] font-medium ${textMuted}`}>
                                    主人设{!chayaCurrentPersonaId && <span className="text-[var(--color-accent)] ml-1">当前激活</span>}
                                  </span>
                                  <button
                                    type="button"
                                    className={`text-[9px] flex items-center gap-0.5 ${textMuted} hover:text-[var(--color-accent)] transition-colors`}
                                    onClick={() => applyPromptText(chayaSystemPrompt)}
                                    title="填充到描述"
                                  >
                                    <Copy className="w-2.5 h-2.5" /> 填充
                                  </button>
                                </div>
                                <p className={`text-[10px] leading-relaxed ${textMuted} whitespace-pre-wrap max-h-[100px] overflow-auto no-scrollbar`}>
                                  {chayaSystemPrompt}
                                </p>
                              </div>
                            )}
                            {/* 各预设人设内容 */}
                            {chayaPersonaPresets.map((preset) => (
                              <div key={preset.id} className={`niho-block-green ${panelClass} p-2 space-y-1 !bg-transparent`}>
                                <div className="flex items-center justify-between">
                                  <span className={`text-[9px] font-medium ${textMuted}`}>
                                    {preset.nickname}
                                    {chayaCurrentPersonaId === preset.id && <span className="text-[var(--color-accent)] ml-1">当前激活</span>}
                                  </span>
                                  <button
                                    type="button"
                                    className={`text-[9px] flex items-center gap-0.5 ${textMuted} hover:text-[var(--color-accent)] transition-colors`}
                                    onClick={() => applyPromptText(preset.system_prompt)}
                                    title="填充到描述"
                                  >
                                    <Copy className="w-2.5 h-2.5" /> 填充
                                  </button>
                                </div>
                                <p className={`text-[10px] leading-relaxed ${textMuted} whitespace-pre-wrap max-h-[100px] overflow-auto no-scrollbar`}>
                                  {preset.system_prompt}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 自定义提示词 */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Bookmark className="w-3 h-3 text-[var(--color-secondary)]" />
                          <span className={`text-[10px] font-medium ${textMuted}`}>
                            我的提示词{customPrompts.length > 0 && ` (${customPrompts.length})`}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={`text-[10px] flex items-center gap-0.5 transition-colors
                            ${showAddPrompt ? 'text-[var(--color-secondary)]' : `${textMuted} hover:text-[var(--color-accent)]`}`}
                          onClick={() => { if (showAddPrompt) cancelEditPrompt(); else setShowAddPrompt(true); }}
                        >
                          {showAddPrompt ? <><X className="w-2.5 h-2.5" /> 取消</> : <><Plus className="w-2.5 h-2.5" /> 新建</>}
                        </button>
                      </div>

                      {/* 自定义标签列表 */}
                      {customPrompts.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {customPrompts.map((cp) => (
                            <div key={cp.id} className="group/cp relative inline-flex items-center">
                              <button
                                type="button"
                                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors
                                  hover:opacity-80 active:scale-95 cursor-pointer select-none
                                  border-[var(--color-secondary)] text-[var(--color-secondary)]
                                  ${editingPromptId === cp.id ? 'bg-[var(--color-secondary)]/15' : 'bg-transparent'}`}
                                onClick={() => applyPromptText(cp.text)}
                                title={`填充: ${cp.text}`}
                              >
                                {cp.label}
                              </button>
                              {/* hover 操作 */}
                              <div className="absolute -top-1 -right-1 flex gap-0 opacity-0 group-hover/cp:opacity-100 transition-opacity z-10">
                                <button
                                  type="button"
                                  className="p-0.5 rounded-full bg-[var(--niho-pure-black,#000)] border border-[var(--niho-text-border,#333)]
                                    text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
                                  onClick={(e) => { e.stopPropagation(); startEditPrompt(cp); }}
                                  title="编辑"
                                >
                                  <PenLine className="w-2 h-2" />
                                </button>
                                <button
                                  type="button"
                                  className="p-0.5 rounded-full bg-[var(--niho-pure-black,#000)] border border-[var(--niho-text-border,#333)]
                                    text-[var(--color-secondary)] hover:text-[var(--niho-mist-pink)] transition-colors"
                                  onClick={(e) => { e.stopPropagation(); deleteCustomPrompt(cp.id); }}
                                  title="删除"
                                >
                                  <Trash2 className="w-2 h-2" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {customPrompts.length === 0 && !showAddPrompt && (
                        <p className={`text-[10px] ${textMuted} opacity-50`}>点击「新建」保存常用提示词</p>
                      )}

                      {/* 新建 / 编辑表单 */}
                      {showAddPrompt && (
                        <div className={`niho-block-pink ${panelClass} p-2.5 space-y-2 !bg-transparent`}>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="标签名（如「星空场景」）"
                              className={`${inputClass} !py-1 !text-[11px] flex-shrink-0`}
                              style={{ width: '120px' }}
                              value={newPromptLabel}
                              onChange={(e) => setNewPromptLabel(e.target.value)}
                              maxLength={20}
                              autoFocus
                            />
                            <input
                              type="text"
                              placeholder="提示词内容（如「浩瀚星空背景，繁星点点，银河横跨画面，」）"
                              className={`${inputClass} !py-1 !text-[11px] flex-1 min-w-0`}
                              value={newPromptText}
                              onChange={(e) => setNewPromptText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomPrompt(); } }}
                            />
                          </div>
                          <div className="flex gap-1.5 items-center">
                            <Button size="sm" className={`${btnPrimary} !text-[10px] !py-0.5 !px-2`}
                              disabled={!newPromptLabel.trim() || !newPromptText.trim()}
                              onClick={addCustomPrompt}
                            >
                              <Save className="w-3 h-3 mr-0.5" />
                              {editingPromptId ? '更新' : '保存'}
                            </Button>
                            <button type="button" className={`text-[10px] ${textMuted} hover:text-[var(--color-secondary)]`} onClick={cancelEditPrompt}>
                              取消
                            </button>
                            {editingPromptId && (
                              <button
                                type="button"
                                className="text-[10px] text-[var(--color-secondary)] hover:text-[var(--niho-mist-pink)] ml-auto"
                                onClick={() => { deleteCustomPrompt(editingPromptId); }}
                              >
                                <Trash2 className="w-3 h-3 inline mr-0.5" /> 删除
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 文字描述 */}
                  <textarea
                    placeholder={refImages.length > 0 ? '描述你希望对图片进行的修改或风格变换...' : '描述你想要的画面...'}
                    className={`${inputClass} resize-none`}
                    rows={4}
                    value={imgPrompt}
                    onChange={(e) => setImgPrompt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !imgLoading) { e.preventDefault(); handleGenerate(); } }}
                  />

                  {/* 操作栏：清空描述等，生成按钮已移至模型选择右侧 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {imgPrompt.trim() && (
                      <button
                        type="button"
                        className={`text-[10px] ${textMuted} hover:text-[var(--color-secondary)] transition-colors`}
                        onClick={() => setImgPrompt('')}
                      >
                        清空描述
                      </button>
                    )}
                    <span className={`text-[10px] ${textMuted} opacity-50 ml-auto`}>Enter 发送 · Shift+Enter 换行</span>
                  </div>
                  {imgError && <p className="text-xs text-[var(--color-secondary)]">{imgError}</p>}
                </div>

                {/* ═══ 右栏：结果区 ═══ */}
                <div className="space-y-4 min-w-0">
                  {/* 最新结果 */}
                  {imgResult && (() => {
                    const resultSrc = safeImgSrc(imgResult.url);
                    return (
                    <div className={`niho-card-3 ${panelClass} p-4 space-y-3`}>
                      <p className={`text-xs font-medium ${textPrimary} flex items-center gap-1.5`}>
                        <Wand2 className="w-3.5 h-3.5 text-[var(--color-accent)]" /> 生成结果
                      </p>
                      {resultSrc ? (
                        <img
                          src={resultSrc}
                          alt="生成结果"
                          className="rounded-md border border-gray-200 dark:border-[#333] w-full h-auto max-h-[320px] object-contain cursor-pointer"
                          onClick={() => setLightboxUrl(resolveMediaSrc(imgResult!.url ?? ''))}
                        />
                      ) : (
                        <div className="rounded-md border border-gray-200 dark:border-[#333] w-full min-h-[120px] flex items-center justify-center bg-black/50 text-[var(--niho-skyblue-gray)]">
                          <ImageIcon className="w-10 h-10" />
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" className={btnSecondary} onClick={() => resultSrc && dl(resultSrc, 'gen.png')}>
                          <Download className="w-3.5 h-3.5 mr-1" /> 下载
                        </Button>
                        <Button size="sm" className={btnPink} onClick={() => pickRefImage(imgResult)}>
                          <Sparkles className="w-3.5 h-3.5 mr-1" /> 用于二创
                        </Button>
                      </div>
                    </div>
                    );
                  })()}

                  {/* 空结果提示 */}
                  {!imgResult && (
                    <div className={`chatu-empty-result niho-card-1 ${panelClass} p-6 flex flex-col items-center justify-center min-h-[200px]`}>
                      <ImageIcon className={`w-10 h-10 ${textMuted} opacity-30 mb-3`} />
                      <p className={`text-xs ${textMuted}`}>生成结果将显示在此处</p>
                      <p className={`text-[10px] ${textMuted} opacity-60 mt-1`}>在左侧输入提示词后点击生成</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── 视频 Tab ── */}
            {createTab === 'video' && (
              <div className="space-y-4">
                {/* 当前供应商提示 */}
                {activeConfig && (
                  <div className={`text-[10px] ${textMuted} space-y-1`}>
                    <div className="flex items-center gap-1.5">
                      <Film className="w-3 h-3" />
                      <span>
                        当前模型：<span className="text-[var(--color-accent)]">{activeConfig.providerName} / {activeConfig.model || activeConfig.name}</span>
                        {activeProviderId === 'gemini' && <span className="ml-1 text-[var(--color-highlight)]">（Veo 视频生成，复用 Gemini API Key）</span>}
                      </span>
                    </div>
                    {activeProviderId === 'gemini' && (activeConfig.model || '').toLowerCase().includes('veo-3.1') && (
                      <div className="flex items-center gap-2 flex-wrap pl-5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">支持首帧图</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-highlight)]/10 text-[var(--color-highlight)]">参考图(≤3)</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-secondary)]/10 text-[var(--color-secondary)]">首末帧插值</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">视频续写</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-highlight)]/10 text-[var(--color-highlight)]">原生音频</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 视频参考图 + 提示词 */}
                <div className={`niho-card-2 ${panelClass} p-4 space-y-3`}>
                  <h3 className={`text-sm font-medium ${textPrimary} flex items-center gap-1.5`}>
                    <Video className="w-4 h-4 text-[var(--color-accent)]" /> 视频创作
                  </h3>
                  <p className={`text-xs ${textMuted}`}>输入描述生成视频；可选附加参考图作为首帧</p>

                  {refImages.length > 0 && (() => {
                    const firstFrameSrc = safeImgSrc(refImages[0]?.url);
                    return (
                    <div className="relative inline-block">
                      {firstFrameSrc ? (
                        <img src={firstFrameSrc} alt="首帧" className="rounded-md max-h-24 w-auto border border-[var(--color-accent)]/50" />
                      ) : (
                        <div className="rounded-md max-h-24 w-24 flex items-center justify-center border border-[var(--color-accent)]/50 bg-black text-[var(--niho-skyblue-gray)]">
                          <ImageIcon className="w-6 h-6" />
                        </div>
                      )}
                      <button className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-[var(--color-secondary)] text-white" onClick={() => removeRefImage(0)}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    );
                  })()}

                  {refImages.length === 0 && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className={btnSecondary} onClick={triggerFileInput}>
                        <Upload className="w-3.5 h-3.5 mr-1" /> 上传首帧
                      </Button>
                      <span className={`text-xs self-center ${textMuted}`}>或从 Chaya 工具栏选取，或拖拽/粘贴</span>
                    </div>
                  )}

                  {/* 提示词预设（视频共用） */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3 h-3 text-[var(--color-highlight)]" />
                      <span className={`text-[10px] font-medium ${textMuted}`}>风格预设</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PROMPT_PRESETS.slice(0, 5).map((p) => {
                        const colorVar = p.color === 'secondary' ? 'var(--color-secondary)'
                          : p.color === 'highlight' ? 'var(--color-highlight)'
                          : 'var(--color-accent)';
                        return (
                          <button key={p.label} type="button"
                            className="text-[10px] px-2 py-0.5 rounded-full border transition-colors
                              hover:opacity-80 active:scale-95 cursor-pointer select-none"
                            style={{ borderColor: colorVar, color: colorVar, backgroundColor: 'transparent' }}
                            onClick={() => applyPromptText(p.text)}
                            title={`填充: ${p.text}`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                      {/* Chaya 人设 */}
                      {(chayaSystemPrompt || chayaPersonaPresets.length > 0) && (
                        <>
                          <span className={`text-[9px] ${textMuted} opacity-40 self-center`}>|</span>
                          {chayaSystemPrompt && (
                            <button type="button"
                              className="text-[10px] px-2 py-0.5 rounded-full border transition-colors
                                hover:opacity-80 active:scale-95 cursor-pointer select-none
                                border-[var(--color-accent)]/60 text-[var(--color-accent)] bg-transparent"
                              onClick={() => applyPromptText(chayaSystemPrompt)}
                              title="填充 Chaya 主人设"
                            >
                              <UserCircle className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />主人设
                            </button>
                          )}
                          {chayaPersonaPresets.map((preset) => (
                            <button key={preset.id} type="button"
                              className="text-[10px] px-2 py-0.5 rounded-full border transition-colors
                                hover:opacity-80 active:scale-95 cursor-pointer select-none
                                border-[var(--color-accent)]/60 text-[var(--color-accent)] bg-transparent"
                              onClick={() => applyPromptText(preset.system_prompt)}
                              title={`填充「${preset.nickname}」人设`}
                            >
                              {preset.nickname}
                            </button>
                          ))}
                        </>
                      )}
                      {/* 自定义 */}
                      {customPrompts.length > 0 && (
                        <>
                          <span className={`text-[9px] ${textMuted} opacity-40 self-center`}>|</span>
                          {customPrompts.map((cp) => (
                            <button key={cp.id} type="button"
                              className="text-[10px] px-2 py-0.5 rounded-full border transition-colors
                                hover:opacity-80 active:scale-95 cursor-pointer select-none
                                border-[var(--color-secondary)] text-[var(--color-secondary)] bg-transparent"
                              onClick={() => applyPromptText(cp.text)}
                              title={`填充: ${cp.text}`}
                            >
                              {cp.label}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>

                  <textarea
                    placeholder="描述视频场景..."
                    className={`${inputClass} resize-none`}
                    rows={3}
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                  />
                  <Button className={btnPrimary} size="sm"
                    disabled={videoLoading || (!videoPrompt.trim() && refImages.length === 0) || !activeConfig}
                    onClick={handleVideoSubmit}
                  >
                    {videoLoading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> 提交中...</> : <><Film className="w-4 h-4 mr-1" /> 生成视频</>}
                  </Button>
                </div>

                {/* 视频状态 */}
                {(videoTaskId || videoError) && (
                  <div className={`niho-card-2 ${panelClass} p-4 space-y-2`}>
                    <h4 className={`text-xs font-medium ${textPrimary}`}>视频任务</h4>
                    {videoError && <p className="text-xs text-[var(--color-secondary)]">{videoError}</p>}
                    {videoTaskId && (
                      <>
                        <p className={`text-xs ${textMuted}`}>
                          任务: <code className="text-[var(--color-accent)] text-[10px]">{videoTaskId.length > 50 ? `...${videoTaskId.slice(-40)}` : videoTaskId}</code>
                          {' '}状态: <span className={`font-medium ${
                            ['SUCCEEDED','COMPLETED'].includes(videoStatus) ? 'text-[var(--color-accent)]'
                            : ['FAILED','CANCELLED','ERROR'].includes(videoStatus) ? 'text-[var(--color-secondary)]'
                            : 'text-[var(--color-highlight)]'
                          }`}>{videoStatus || '...'}</span>
                        </p>
                        {videoStatus === 'PROCESSING' && (
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-highlight)]" />
                            <span className={`text-xs ${textMuted}`}>视频生成中，请稍候...</span>
                          </div>
                        )}
                        {videoStatus === 'DOWNLOADING' && (
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-accent)]" />
                            <span className={`text-xs ${textMuted}`}>视频生成完成，正在下载...</span>
                          </div>
                        )}
                        {videoOutput && (
                          <div className="mt-2">
                            <video src={videoOutput} controls className="rounded-md max-h-60 w-full" />
                            <Button size="sm" className={`mt-2 ${btnSecondary}`} onClick={() => dl(videoOutput, 'video.mp4')}>
                              <Download className="w-3.5 h-3.5 mr-1" /> 下载
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
        </div>
      </div>

      {/* 隐藏文件 input（支持多选） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { handleFileUpload(e.target.files); e.target.value = ''; }}
      />

      {/* ════════ 模型选择弹框 ════════ */}
      <Dialog open={showModelDialog} onOpenChange={setShowModelDialog}>
        <DialogContent className="chatee-dialog-standard max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-[var(--color-accent)]" />
              选择{createTab === 'image' ? '图像' : '视频'}模型
            </DialogTitle>
            <DialogDescription>
              {createTab === 'image' ? '选择一个支持图像生成的模型' : '选择一个支持视频生成的模型'}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            // 按供应商分组
            const grouped = new Map<string, typeof currentConfigs>();
            for (const c of currentConfigs) {
              const key = c.providerName || c.providerId;
              if (!grouped.has(key)) grouped.set(key, []);
              grouped.get(key)!.push(c);
            }
            const entries = Array.from(grouped.entries());

            return (
              <div className="flex flex-col max-h-[60vh]">
                {/* 供应商 Tab */}
                {entries.length > 1 && (
                  <div className="flex border-b border-gray-200 dark:border-[#404040] overflow-x-auto no-scrollbar">
                    {entries.map(([provName, configs]) => (
                      <button
                        key={provName}
                        className={`
                          flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap border-b-2
                          border-transparent hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/30
                        `}
                      >
                        <span>{provName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5">
                          {configs.length}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {/* 模型列表 */}
                <div className="flex-1 overflow-y-auto pr-1" style={{ maxHeight: '50vh' }}>
                  {entries.map(([provName, configs]) => (
                    <div key={provName} className="py-2">
                      {entries.length > 1 && (
                        <div className={`px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider ${textMuted}`}>{provName}</div>
                      )}
                      <div className="space-y-0.5">
                        {configs.map((c) => {
                          const isSelected = selectedConfigId === c.config_id;
                          const caps = c.capabilities;
                          return (
                            <DataListItem
                              key={c.config_id}
                              id={c.config_id}
                              title={c.model || c.name}
                              description={
                                [
                                  c.media_purpose ? '媒体专用' : null,
                                  caps?.image ? '生图' : null,
                                  caps?.video ? '生视频' : null,
                                ].filter(Boolean).join(' · ') || c.providerName
                              }
                              badge={
                                <CapabilityIcons
                                  capabilities={{ image_gen: caps?.image, video_gen: caps?.video }}
                                  modelName={c.model}
                                  className="w-3.5 h-3.5"
                                />
                              }
                              isSelected={isSelected}
                              className=""
                              onClick={() => {
                                setSelectedConfigId(c.config_id);
                                setShowModelDialog(false);
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ════════ Lightbox ════════ */}
      {lightboxUrl && (() => {
        const lbSrc = safeImgSrc(lightboxUrl);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setLightboxUrl(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {lbSrc ? (
              <img src={lbSrc} alt="" className="max-w-full max-h-[85vh] rounded-lg shadow-2xl" />
            ) : (
              <div className="max-w-full max-h-[85vh] flex items-center justify-center rounded-lg border border-[#333] bg-black/50 text-[var(--niho-skyblue-gray)] px-8 py-6">
                无法加载图片
              </div>
            )}
            <button className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80" onClick={() => setLightboxUrl(null)}>
              <X className="w-5 h-5" />
            </button>
            <div className="absolute bottom-2 right-2 flex gap-2">
              <button className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80" onClick={() => lbSrc && dl(lbSrc, 'image.png')}>
                <Download className="w-4 h-4" />
              </button>
              <button
                className="p-1.5 rounded-full bg-[var(--color-secondary)]/80 text-white hover:bg-[var(--color-secondary)]"
                onClick={() => { if (lightboxUrl) pickRefImage({ url: lightboxUrl }); setLightboxUrl(null); }}
              >
                <Sparkles className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );

  if (embedded) {
    return (
      <div className="h-full overflow-y-auto no-scrollbar px-2 py-3">
        {mainContent}
      </div>
    );
  }

  return (
    <PageLayout
      title="chatu"
      description="文生图 / 图生图 / 视频创作"
      variant="persona"
      personaConstrainContent={false}
    >
      {mainContent}
    </PageLayout>
  );
};

export default MediaCreatorPage;
