/**
 * chatu 页
 * - 创作区：图像 Tab（文生图 / 图生图）、视频 Tab
 *   图片来源：本地上传、剪贴板粘贴、Chatu 创作产出
 * - 媒体管理区：Chatu 创作产出，按时间分段展示
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
import { ImageSizeSelector } from './ImageSizeSelector';
import { mediaApi, type MediaProvider, type GoogleDriveItem } from '../services/mediaApi';
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
  Sparkles,
  Wand2,
  Upload,
  Clipboard,
  Plus,
  Save,
  Trash2,
  PenLine,
  UserCircle,
  ChevronDown,
  MessageCircle,
  Maximize2,
  FolderOpen,
  RefreshCw,
} from 'lucide-react';
import { resolveMediaSrc } from '../utils/mediaSrc';

const CHAYA_SESSION_ID = 'agent_chaya';

function GoogleDriveIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M7.78 3h8.44l4.22 7.31h-4.22L12 3.97 7.78 3z" fill="#0F9D58" />
      <path d="M3.56 10.31L7.78 3l2.11 3.66-4.22 7.31-2.11-3.66z" fill="#4285F4" />
      <path d="M16.22 21H7.78l-2.11-3.66h12.66L16.22 21z" fill="#F4B400" />
      <path d="M18.33 17.34H5.67l4.22-7.31h12.66l-4.22 7.31z" fill="#2A56C6" opacity="0.18" />
    </svg>
  );
}

/** 解析为可用于 img 的 URL，空或无效时返回空字符串（避免 net::ERR_INVALID_URL） */
function safeImgSrc(url: string | undefined): string {
  const raw = (url ?? '').trim();
  if (!raw) return '';
  const resolved = resolveMediaSrc(raw);
  return resolved.trim();
}

type CreateTab = 'chat' | 'image' | 'video';

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
  /** 创建时间（ISO 字符串），用于按时间分段 */
  created_at?: string;
  /** 本地生成任务ID（用于并发占位与回填） */
  job_id?: string;
  /** 同一次点击生成的一批图片共享同一 batch_id，图库中用虚线框分组展示 */
  batch_id?: string;
  /** 生成状态：pending=生成中，ready=完成，error=失败 */
  status?: 'pending' | 'ready' | 'error';
  error_message?: string;
}

function inferMediaConfigCaps(model: string | undefined, caps?: { image: boolean; video: boolean }) {
  if (caps?.image || caps?.video) return caps;
  const lower = (model || '').toLowerCase();
  return {
    image: lower.includes('grok-imagine') || lower.includes('dall-e') || lower.includes('gpt-image'),
    video: lower.includes('grok-imagine') && lower.includes('video'),
  };
}

function normalizeGeneratedImageMedia(media?: { mimeType?: string; url?: string; data?: string }) {
  if (!media) return null;
  const mime = media.mimeType || 'image/png';
  const rawB64 = media.data || undefined;
  const url = rawB64 ? `data:${mime};base64,${rawB64}` : (media.url || '');
  if (!url) return null;
  return { mime, rawB64, url };
}

/** 按 created_at 得到时间分段标签（今天/昨天/N天前/更早），用于图库列表展示顺序 */
function getDateLabel(iso: string | undefined): string {
  if (!iso) return '更早';
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - itemDay.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays <= 31) return `${diffDays}天前`;
  return '更早';
}

function dateSegmentSortKey(label: string): number {
  if (label === '今天') return 0;
  if (label === '昨天') return 1;
  const match = label.match(/^(\d+)天前$/);
  if (match) return 2 + parseInt(match[1], 10);
  return 999;
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
  /** 外部控制模式：both=页内可切换；image/video=固定模式 */
  mode?: 'both' | 'image' | 'video';
}

const MediaCreatorPage: React.FC<MediaCreatorPageProps> = ({ embedded = false, mode = 'both' }) => {
  /* ─── State ─── */
  const [providers, setProviders] = useState<MediaProvider[]>([]);
  const [providerLoading, setProviderLoading] = useState(true);
  /** 选中的 config_id（粒度到具体模型配置） */
  const [selectedConfigId, setSelectedConfigId] = useState('');

  const [createTab, setCreateTab] = useState<CreateTab>(mode === 'video' ? 'video' : mode === 'image' ? 'image' : 'chat');
  const [showModelDialog, setShowModelDialog] = useState(false);

  // 统一图像生成（无图=文生图，有图=二创）
  const [refImages, setRefImages] = useState<MediaItem[]>([]);
  const [imgPrompt, setImgPrompt] = useState('');
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

  // 创作产出媒体库（全量加载）
  const [createdMedia, setCreatedMedia] = useState<MediaItem[]>([]);

  // Chaya 人设
  const [chayaSystemPrompt, setChayaSystemPrompt] = useState('');
  const [chayaPersonaPresets, setChayaPersonaPresets] = useState<PersonaPreset[]>([]);
  const [chayaCurrentPersonaId, setChayaCurrentPersonaId] = useState<string | null>(null);

  // 自定义提示词
  const [customPrompts, setCustomPrompts] = useState<CustomPrompt[]>(() => loadCustomPrompts());
  const [showAddPrompt, setShowAddPrompt] = useState(false);
  const [newPromptLabel, setNewPromptLabel] = useState('');
  const [newPromptText, setNewPromptText] = useState('');
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);

  // 图像尺寸配置
  const [imageSize, setImageSize] = useState({
    width: 1024,
    height: 1024,
    aspectRatio: '1:1',
    count: 1,
  });

  // Lightbox
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // 紧凑图库滑动索引
  const [galleryIndex, setGalleryIndex] = useState(0);
  // 移动端图库/视频抽屉（< 768px）
  const [mobileGalleryOpen, setMobileGalleryOpen] = useState(false);
  const [mobileVideoDrawerOpen, setMobileVideoDrawerOpen] = useState(false);
  const [driveUploadingOutputId, setDriveUploadingOutputId] = useState<string | null>(null);
  const [showDriveDialog, setShowDriveDialog] = useState(false);
  const [driveFiles, setDriveFiles] = useState<GoogleDriveItem[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveNextPageToken, setDriveNextPageToken] = useState<string | null>(null);
  const [driveLoadingMore, setDriveLoadingMore] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  /* ─── 移动端检测（< 768px） ─── */
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  /* ─── Load ─── */
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

  useEffect(() => { loadProviders(); }, [loadProviders]);
  useEffect(() => { loadChayaPersona(); }, [loadChayaPersona]);

  useEffect(() => {
    if (mode === 'image' || mode === 'video') {
      setCreateTab(mode);
    }
  }, [mode]);

  useEffect(() => {
    if (createdMedia.length === 0) {
      setGalleryIndex(0);
      return;
    }
    if (galleryIndex > createdMedia.length - 1) {
      setGalleryIndex(createdMedia.length - 1);
    }
  }, [createdMedia.length, galleryIndex]);

  const FULL_LOAD_LIMIT = 500;
  const PENDING_STORAGE_KEY = 'media-creator-pending';

  /* ─── 持久化创作产出：全量加载，并合并上次未完成的 pending 占位（先于下方 persist 执行，避免被清空） ─── */
  useEffect(() => {
    let cancelled = false;
    const restorePending = (): MediaItem[] => {
      try {
        const raw = sessionStorage.getItem(PENDING_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as MediaItem[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const pending = restorePending();
    mediaApi.listOutputs(FULL_LOAD_LIMIT, 0)
      .then((res) => {
        if (cancelled) return;
        const list = res.items || [];
        const items: MediaItem[] = list.map((o) => ({
          url: mediaApi.getOutputFileUrl(o.output_id),
          mimeType: o.mime_type,
          source: 'generated' as const,
          output_id: o.output_id,
          created_at: o.created_at,
        }));
        setCreatedMedia([...pending, ...items]);
      })
      .catch(() => {
        if (!cancelled) setCreatedMedia(pending.length > 0 ? pending : []);
      });
    return () => { cancelled = true; };
  }, []);

  /* ─── 离开页面时持久化「生成中」占位，回来时由上方 load 恢复 ─── */
  useEffect(() => {
    const pending = createdMedia.filter((i) => i.status === 'pending');
    if (pending.length > 0) {
      try {
        sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
      } catch {
        // sessionStorage 写满时忽略
      }
    } else {
      sessionStorage.removeItem(PENDING_STORAGE_KEY);
    }
  }, [createdMedia]);

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
        const caps = inferMediaConfigCaps(c.model, (c as any).capabilities as { image: boolean; video: boolean } | undefined);
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
      // 去重（按 job_id / output_id / 有效 url）
      if (item.job_id && prev.some((p) => p.job_id === item.job_id)) return prev;
      if (item.output_id && prev.some((p) => p.output_id === item.output_id)) return prev;
      if (item.url && prev.some((p) => p.url === item.url)) return prev;
      const withTime = { ...item, created_at: item.created_at ?? new Date().toISOString() };
      return [withTime, ...prev];
    });
  }, []);

  /** 从 item 获取 base64 用于持久化（rawB64 / data URL / 或 fetch blob URL） */
  const getBase64FromItem = useCallback((item: MediaItem): Promise<string | null> => {
    if (item.rawB64) return Promise.resolve(item.rawB64);
    if (item.url.startsWith('data:') && item.url.includes(';base64,')) {
      return Promise.resolve(item.url.split(';base64,')[1] ?? null);
    }
    if (item.url.startsWith('data:')) return Promise.resolve(item.url.split(',')[1] ?? null);
    if (item.source === 'generated') return Promise.resolve(null);
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
      const createdAt = (res as { created_at?: string }).created_at ?? new Date().toISOString();
      setCreatedMedia((prev) =>
        prev.map((p) => {
          const byJob = item.job_id && p.job_id === item.job_id;
          const byUrl = item.url && p.url === item.url;
          if (!byJob && !byUrl) return p;
          return { ...p, url: fileUrl, output_id: res.output_id, created_at: createdAt, status: 'ready', error_message: undefined };
        })
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

  /** 从剪贴板粘贴图片（按钮点击） */
  const handlePasteFromClipboard = () => {
    navigator.clipboard.read?.().then((items) => {
      for (const ci of items) {
        const imgType = ci.types.find((t) => t.startsWith('image/'));
        if (imgType) {
          ci.getType(imgType).then((blob) => {
            const file = new File([blob], 'paste.png', { type: imgType });
            fileToMediaItem(file).then((m) => { m.source = 'paste'; pickRefImage(m); });
          });
          return;
        }
      }
    }).catch(() => {});
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

  /* ─── 获取 base64 ─── */
  const getB64 = (item: MediaItem): string => {
    if (item.rawB64) return item.rawB64;
    if (item.url.startsWith('data:') && item.url.includes(';base64,')) return item.url.split(';base64,')[1];
    return item.url;
  };

  const toOpenAIImageSize = (): string | undefined => {
    const ratio = imageSize.aspectRatio || '1:1';
    switch (ratio) {
      case '16:9':
        return '1792x1024';
      case '9:16':
        return '1024x1792';
      case '3:2':
      case '4:3':
      case '4:5':
      case '5:4':
      case '3:4':
      case '2:3':
      case '21:9':
      case '1:1':
      default:
        return '1024x1024';
    }
  };

  /* ─── 图生图：单次请求，单张结果 ─── */
  const runSingleGenerate = async (jobId: string, batchId: string) => {
    if (!activeConfig) return;
    const cfgId = activeConfig.config_id;
    try {
      const images_b64 = refImages.map((img) => ({ data: getB64(img), mime: img.mimeType || 'image/png' }));
      const result = activeProviderId === 'openai'
        ? await mediaApi.openaiImageEdits({
            prompt: imgPrompt,
            image_b64: images_b64[0]?.data,
            image_mime: images_b64[0]?.mime,
            config_id: cfgId,
            model: activeConfig.model,
          })
        : activeProviderId === 'gemini'
          ? await mediaApi.geminiImageEdit({
              prompt: imgPrompt,
              image_b64: images_b64[0].data,
              images_b64: images_b64.map((i) => i.data),
              config_id: cfgId,
              model: activeConfig.model,
              aspect_ratio: imageSize.aspectRatio || undefined,
              count: 1,
            })
          : await Promise.reject(new Error(`不支持的图像供应商: ${activeProviderId}`));
      if (result.error) throw new Error(result.error);
      const normalized = normalizeGeneratedImageMedia(result.media?.[0] as { mimeType?: string; url?: string; data?: string } | undefined);
      if (!normalized) throw new Error('未返回可用图片URL');
      const finalItem: MediaItem = {
        url: normalized.url,
        mimeType: normalized.mime,
        rawB64: normalized.rawB64,
        source: 'generated',
        created_at: new Date().toISOString(),
        job_id: jobId,
        batch_id: batchId,
        status: 'ready',
      };
      setCreatedMedia((prev) => prev.map((p) => (p.job_id === jobId ? { ...p, ...finalItem } : p)));
      persistCreatedItem(finalItem);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setImgError((prev) => (prev ? prev : msg));
      setCreatedMedia((prev) => prev.map((p) => (p.job_id === jobId ? { ...p, status: 'error', error_message: msg } : p)));
    }
  };

  /* ─── 文生图：单张请求（Gemini 不支持多 candidate，多图时并行发起多请求） ─── */
  const runSingleTextToImage = async (jobId: string, batchId: string) => {
    if (!activeConfig) return;
    const cfgId = activeConfig.config_id;
    try {
      const result = activeProviderId === 'openai'
        ? await mediaApi.openaiImageGenerations({
            prompt: imgPrompt,
            config_id: cfgId,
            model: activeConfig.model,
            size: toOpenAIImageSize(),
            response_format: 'b64_json',
          })
        : activeProviderId === 'gemini'
          ? await mediaApi.geminiImageGenerate({
              prompt: imgPrompt,
              config_id: cfgId,
              model: activeConfig.model,
              aspect_ratio: imageSize.aspectRatio || undefined,
              count: 1,
            })
          : await Promise.reject(new Error(`不支持的图像供应商: ${activeProviderId}`));
      if (result.error) throw new Error(result.error);
      type MediaEntry = { mimeType?: string; url?: string; data?: string };
      const normalized = normalizeGeneratedImageMedia((result.media as MediaEntry[])?.[0]);
      if (!normalized) throw new Error('图片数据无效');
      const finalItem: MediaItem = {
        url: normalized.url,
        mimeType: normalized.mime,
        rawB64: normalized.rawB64,
        source: 'generated',
        created_at: new Date().toISOString(),
        job_id: jobId,
        batch_id: batchId,
        status: 'ready',
      };
      setCreatedMedia((prev) => prev.map((p) => (p.job_id === jobId ? { ...p, ...finalItem } : p)));
      persistCreatedItem(finalItem);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setImgError((prev) => (prev ?? msg));
      setCreatedMedia((prev) => prev.map((p) => (p.job_id === jobId ? { ...p, status: 'error', error_message: msg } : p)));
    }
  };

  const handleGenerate = () => {
    if (!imgPrompt.trim() || !activeConfig) return;
    setImgError(null);
    const count = Math.max(1, Math.min(4, imageSize.count));
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    for (let i = 0; i < count; i++) {
      addToCreated({
        url: '',
        mimeType: 'image/png',
        source: 'generated',
        created_at: new Date().toISOString(),
        job_id: `${batchId}-${i}`,
        batch_id: batchId,
        status: 'pending',
      });
    }
    if (refImages.length > 0) {
      for (let i = 0; i < count; i++) runSingleGenerate(`${batchId}-${i}`, batchId);
    } else {
      for (let i = 0; i < count; i++) runSingleTextToImage(`${batchId}-${i}`, batchId);
    }
  };

  /* ─── 视频（支持 Gemini/Veo 和 Runway） ─── */
  const handleVideoSubmit = async () => {
    if (!videoPrompt.trim() && refImages.length === 0) return;
    setVideoLoading(true); setVideoError(null); setVideoTaskId(null); setVideoOutput(null); setVideoStatus('');
    try {
      if (activeProviderId === 'gemini') {
        // Gemini Veo 视频生成
        const body: any = { prompt: videoPrompt };
        if (refImages.length > 0) body.image_b64 = getB64(refImages[0]);
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

  /* ─── 下载：保存到本地，不新开标签 ─── */
  const dl = (url: string, name?: string) => {
    const filename = name || 'media';
    if (url.startsWith('data:')) {
      fetch(url)
        .then((res) => res.blob())
        .then((blob) => {
          const u = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = u;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(u);
        })
        .catch(() => {
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const ensureGoogleDriveConnected = useCallback(async (): Promise<boolean> => {
    try {
      const status = await mediaApi.googleDriveAuthStatus();
      if (status.connected) return true;
      const started = await mediaApi.googleDriveAuthStart();
      if (!started.auth_url) throw new Error('未获取到 Google 授权链接');
      window.open(started.auth_url, '_blank', 'noopener,noreferrer,width=520,height=720');
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const next = await mediaApi.googleDriveAuthStatus();
        if (next.connected) return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const uploadToGoogleDrive = useCallback(async (item: MediaItem | undefined | null) => {
    if (!item?.output_id) {
      window.alert('该图片尚未落盘，暂不可上传到 Drive');
      return;
    }
    if (driveUploadingOutputId) return;
    setDriveUploadingOutputId(item.output_id);
    try {
      const connected = await ensureGoogleDriveConnected();
      if (!connected) {
        throw new Error('Google 授权未完成，请重试');
      }
      const res = await mediaApi.uploadOutputToGoogleDrive(item.output_id);
      if (res.error || !res.ok) {
        throw new Error(res.error || '上传失败');
      }
      if (res.web_view_link) {
        window.open(res.web_view_link, '_blank', 'noopener,noreferrer');
      }
    } catch (e: any) {
      window.alert(e?.message || '上传 Google Drive 失败');
    } finally {
      setDriveUploadingOutputId(null);
    }
  }, [driveUploadingOutputId, ensureGoogleDriveConnected]);

  const loadGoogleDriveFiles = useCallback(async () => {
    setDriveLoading(true);
    setDriveError(null);
    try {
      const connected = await ensureGoogleDriveConnected();
      if (!connected) throw new Error('Google 授权未完成');
      const res = await mediaApi.listGoogleDriveFiles(12);
      setDriveFiles(res.items || []);
      setDriveNextPageToken(res.next_page_token || null);
    } catch (e: any) {
      setDriveError(e?.message || '读取 Google Drive 图库失败');
      setDriveFiles([]);
    } finally {
      setDriveLoading(false);
    }
  }, [ensureGoogleDriveConnected]);

  const loadMoreGoogleDriveFiles = useCallback(async () => {
    if (!driveNextPageToken || driveLoadingMore) return;
    setDriveLoadingMore(true);
    try {
      const res = await mediaApi.listGoogleDriveFiles(24, driveNextPageToken);
      setDriveFiles((prev) => [...prev, ...(res.items || [])]);
      setDriveNextPageToken(res.next_page_token || null);
    } catch {
      // ignore
    } finally {
      setDriveLoadingMore(false);
    }
  }, [driveLoadingMore, driveNextPageToken]);

  /* ─── 隐藏 file input ─── */
  const triggerFileInput = () => fileInputRef.current?.click();

  const pendingImageJobs = createdMedia.filter((i) => i.status === 'pending').length;

  const removeCreatedItem = async (item: MediaItem, index: number) => {
    if (item.output_id) {
      try { await mediaApi.deleteOutput(item.output_id); } catch { /* ignore */ }
    }
    setCreatedMedia((prev) => prev.filter((_, i) => i !== index));
  };

  /** 图库内容（空状态或主图+缩略图），供桌面端与移动端抽屉复用 */
  const renderGalleryBody = () => {
    if (createdMedia.length === 0) {
      return (
        <div className="media-create-empty-state">
          <ImageIcon className="w-12 h-12 opacity-40 mb-2" />
          <p className="text-sm font-medium text-[var(--text-secondary)]">暂无图片</p>
          <p className="text-xs mt-1">按以下步骤开始创作</p>
          <div className="steps">
            <span>1. 上传图片或从空白开始</span>
            <span>2. 输入描述</span>
            <span>3. 点击生成（可选多张，同批用虚线框分组）</span>
          </div>
        </div>
      );
    }
    const main = createdMedia[galleryIndex] ?? createdMedia[0];
    const mainIsVideo = !!main?.mimeType?.startsWith('video/');
    const mainSrc = safeImgSrc(main?.url);
    const mainPending = main?.status === 'pending';
    const mainError = main?.status === 'error';
    const dayMap = new Map<string, number[]>();
    createdMedia.forEach((item, index) => {
      const label = getDateLabel(item.created_at);
      if (!dayMap.has(label)) dayMap.set(label, []);
      dayMap.get(label)!.push(index);
    });
    const dayOrder = Array.from(dayMap.keys()).sort((a, b) => dateSegmentSortKey(a) - dateSegmentSortKey(b));
    return (
      <>
        <div className="flex items-center justify-between flex-shrink-0">
          <p className={`text-sm font-medium ${textPrimary} flex items-center gap-1.5`}>
            <Sparkles className="w-4 h-4 text-[var(--color-secondary)]" /> 当前
          </p>
          <span className={`text-xs ${textMuted}`}>{createdMedia.length} 张</span>
        </div>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden gap-1.5">
          <div className="media-create-gallery-main group/main relative rounded-xl overflow-hidden bg-black min-h-0">
            {mainPending ? (
              <div className="chatu-generating-spectrum-strong w-full h-full flex flex-col items-center justify-center gap-2 text-[var(--niho-skyblue-gray)]">
                <span className="relative z-10 text-sm font-medium text-white/90">生成中...</span>
              </div>
            ) : mainError ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[var(--color-secondary)] px-3">
                <X className="w-8 h-8" />
                <span className="text-xs text-center">{main?.error_message || '生成失败'}</span>
              </div>
            ) : mainIsVideo ? (
              <button type="button" className="w-full h-full flex items-center justify-center" onClick={() => main && window.open(main.url, '_blank')}>
                <Film className="w-12 h-12 text-[var(--color-secondary)]" />
              </button>
            ) : mainSrc ? (
              <img src={mainSrc} alt="当前" className="w-full h-full object-contain cursor-pointer" onClick={() => main && setLightboxUrl(resolveMediaSrc(main.url ?? ''))} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--niho-skyblue-gray)]">
                <ImageIcon className="w-10 h-10" />
              </div>
            )}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/main:opacity-100 transition-opacity z-10">
              <button type="button" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-[var(--color-secondary)]/80" onClick={() => main && removeCreatedItem(main, galleryIndex)} title="删除">
                <Trash2 className="w-4 h-4" />
              </button>
              {!mainPending && !mainError && !mainIsVideo && main && mainSrc && (
                <>
                  <button type="button" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-[var(--color-accent)]/80" onClick={() => main && pickRefImage({ url: main.url ?? '', mimeType: main.mimeType || 'image/png', rawB64: main.rawB64, source: 'generated' })} title="二创（追加为参考图）">
                    <Sparkles className="w-4 h-4" />
                  </button>
                  <button type="button" className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80" onClick={() => dl(mainSrc, 'gen.png')} title="保存到本地">
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-[#4285F4]/80"
                    onClick={() => uploadToGoogleDrive(main)}
                    title="保存到 Google Drive"
                  >
                    {driveUploadingOutputId === main.output_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleDriveIcon className="w-4 h-4" />}
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="media-create-gallery-thumb-strip no-scrollbar flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex flex-col gap-4 media-create-gallery-by-day flex-1 min-h-0 no-scrollbar">
              {dayOrder.map((dayLabel) => {
                const indices = dayMap.get(dayLabel)!;
                return (
                  <div key={dayLabel} className="media-create-day-segment flex-shrink-0">
                    <p className="media-create-day-segment-header">{dayLabel}</p>
                    <div className="media-create-thumb-grid">
                      {indices.map((index) => {
                        const item = createdMedia[index];
                        const src = safeImgSrc(item.url);
                        const isVideo = !!item.mimeType?.startsWith('video/');
                        const isPending = item.status === 'pending';
                        const isError = item.status === 'error';
                        const active = index === galleryIndex;
                        return (
                          <div key={`lib-${item.output_id || item.job_id || index}`} className="relative group/thumb">
                            <button
                              type="button"
                              className="w-full aspect-square overflow-hidden bg-black"
                              data-active={active ? '' : undefined}
                              onClick={() => setGalleryIndex(index)}
                              title={isVideo ? '视频' : '图片'}
                            >
                              {isPending ? (
                                <div className="chatu-generating-spectrum w-full h-full" title="生成中" />
                              ) : isError ? (
                                <div className="w-full h-full flex items-center justify-center"><X className="w-4 h-4 text-[var(--color-secondary)]" /></div>
                              ) : isVideo ? (
                                <div className="w-full h-full flex items-center justify-center"><Film className="w-4 h-4 text-[var(--color-secondary)]" /></div>
                              ) : src ? (
                                <img src={src} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[var(--niho-skyblue-gray)]"><ImageIcon className="w-4 h-4" /></div>
                              )}
                            </button>
                            <button
                              type="button"
                              className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                              onClick={(e) => { e.stopPropagation(); removeCreatedItem(item, index); }}
                              title="删除"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </>
    );
  };

  /* ═══════════════ RENDER ═══════════════ */

  const mainContent = (
    <>
      <div className="chatu-page chatu-page-one-screen h-full w-full flex flex-col min-h-0 px-2 py-1.5 sm:px-4 md:px-5 lg:px-6 max-w-[1360px] mx-auto w-full box-border">
        <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        {/* ════════ 创作区 ════════ */}
        <Card title="创作区" variant="persona" size="default" className="media-create-card flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden space-y-4">
            {/* Tab（仅 both 模式显示） */}
            {mode === 'both' && (
              <div className="flex gap-6 border-b border-gray-200 dark:border-[#333]">
                <button type="button" className={createTab === 'chat' ? tabActive : tabInactive} onClick={() => setCreateTab('chat')}>
                  <span className="flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> 聊天</span>
                </button>
                <button type="button" className={createTab === 'image' ? tabActive : tabInactive} onClick={() => setCreateTab('image')}>
                  <span className="flex items-center gap-1.5"><ImageIcon className="w-4 h-4" /> 图像</span>
                </button>
                <button type="button" className={createTab === 'video' ? tabActive : tabInactive} onClick={() => setCreateTab('video')}>
                  <span className="flex items-center gap-1.5"><Film className="w-4 h-4" /> 视频</span>
                </button>
              </div>
            )}

            {/* ── 聊天 Tab：引导至主聊天界面 ── */}
            {createTab === 'chat' && (
              <div className="media-create-layout flex-1 min-h-0 overflow-hidden">
                <div className="media-create-left-col flex flex-col gap-4 min-w-0 min-h-0 overflow-y-auto no-scrollbar">
                  <div className="prompt-and-ref-card rounded-2xl overflow-hidden flex flex-col flex-1 min-h-[200px] border border-[var(--border-default)] bg-[var(--surface-secondary)]">
                    <div className="p-4 flex flex-col items-center justify-center flex-1 text-center">
                      <MessageCircle className="w-12 h-12 text-[var(--color-accent)] opacity-80 mb-3" />
                      <h3 className={`text-sm font-medium ${textPrimary} mb-1`}>聊天</h3>
                      <p className={`text-xs ${textMuted} max-w-[280px]`}>请在左侧会话列表选择或创建会话，在对话界面与模型聊天。</p>
                    </div>
                  </div>
                </div>
                <div className="min-w-0 min-h-0 flex flex-col" />
              </div>
            )}

            {/* ── 图像 Tab — 上传区 + 描述 + 选项 + 结果；移动端图库用底部抽屉 ── */}
            {createTab === 'image' && (
              <>
              <div className="media-create-layout flex-1 min-h-0 overflow-hidden">
                {/* 左栏：参考图+描述 合体 → 自定义提示词 → 图片尺寸；移动端底部留空避免被 FAB 遮挡 */}
                <div className={`media-create-left-col flex flex-col gap-3 min-w-0 min-h-0 overflow-y-auto no-scrollbar ${isMobile ? 'chatu-left-col-with-fab' : ''}`}>
                  {/* 生成面板：描述在上、粘贴在下，生成按钮在右上角 */}
                  <div
                    ref={dropZoneRef}
                    className={`prompt-and-ref-card rounded-xl overflow-hidden flex flex-col flex-1 min-h-[240px] sm:min-h-[260px] md:min-h-[280px] relative ${dragOver ? 'ring-2 ring-[var(--color-accent)]/30' : ''}`}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                  >
                    {/* 上方：描述你的画面，文字区全宽；底部：模型+生成按钮栏，不显示文字 */}
                    <div className="prompt-and-ref-card__prompt flex-1 min-h-0 flex flex-col p-2.5">
                      <label className="media-create-prompt-label flex items-center gap-1 mb-1 text-sm flex-shrink-0">
                        <Wand2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                        描述你的画面
                      </label>
                      {/* 文字输入区：全宽排满 */}
                      <div className="flex-1 min-h-0 flex flex-col">
                        <textarea
                          placeholder={refImages.length > 0 ? '描述你希望对图片进行的修改或风格变换...' : '描述你想要的画面...'}
                          className={`${inputClass} resize-none rounded-lg min-h-[80px] flex-1 min-w-0 overflow-y-auto !py-2 !px-2.5`}
                          rows={3}
                          value={imgPrompt}
                          onChange={(e) => setImgPrompt(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
                        />
                        {imgError && <p className="text-xs text-[var(--color-secondary)] mt-1 flex-shrink-0">{imgError}</p>}
                      </div>
                      {/* 底部按钮栏：自定义提示词(左) | 模型+生成(右)，简练笔触 */}
                      <div className="flex-shrink-0 flex items-center justify-between gap-3 pt-3 mt-1 border-t border-[var(--border-subtle)] min-h-[48px]">
                        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto no-scrollbar">
                          <button
                            type="button"
                            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-normal transition-all ${showAddPrompt ? 'bg-[var(--color-secondary)]/15 text-[var(--color-secondary)]' : 'bg-transparent text-[var(--color-secondary)] hover:bg-[var(--color-secondary)]/10'}`}
                            onClick={() => { if (showAddPrompt) cancelEditPrompt(); else setShowAddPrompt(true); }}
                          >
                            {showAddPrompt ? <><X className="w-4 h-4" /> 取消</> : <><Plus className="w-4 h-4" /> 新建</>}
                          </button>
                          {customPrompts.length > 0 && customPrompts.map((cp) => (
                            <div key={cp.id} className="group/cp relative flex-shrink-0">
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex gap-0.5 opacity-0 group-hover/cp:opacity-100 transition-opacity z-10">
                                <button type="button" className="p-1.5 rounded-lg bg-black/90 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20" onClick={(e) => { e.stopPropagation(); startEditPrompt(cp); }} title="编辑"><PenLine className="w-3.5 h-3.5" /></button>
                                <button type="button" className="p-1.5 rounded-lg bg-black/90 text-[var(--color-secondary)] hover:bg-[var(--color-secondary)]/20" onClick={(e) => { e.stopPropagation(); deleteCustomPrompt(cp.id); }} title="删除"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                              <button
                                type="button"
                                className={`inline-flex items-center px-3 py-2 rounded-lg text-sm font-normal transition-all cursor-pointer select-none text-[var(--color-secondary)] bg-[var(--color-secondary)]/5 hover:bg-[var(--color-secondary)]/15 ${editingPromptId === cp.id ? 'ring-1 ring-[var(--color-secondary)]/25' : ''}`}
                                onClick={() => applyPromptText(cp.text)}
                                title={cp.text.slice(0, 60) + (cp.text.length > 60 ? '…' : '')}
                              >
                                {cp.label}
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-2">
                          {providerLoading ? (
                            <span className={`text-sm ${textMuted} flex items-center gap-1.5`}><Loader2 className="w-4 h-4 animate-spin" /> 加载中</span>
                          ) : currentConfigs.length === 0 ? (
                            <span className={`text-sm ${textMuted}`}>未配置模型</span>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className={`media-create-model-btn !min-h-[36px] !h-9 !px-3 !text-sm !font-normal !min-w-0 ${btnSecondary}`}
                              onClick={() => setShowModelDialog(true)}
                            >
                              {activeConfig ? <span className="truncate max-w-[120px] sm:max-w-[140px]">{activeConfig.model || activeConfig.name}</span> : '选择模型'}
                              <ChevronDown className="w-4 h-4 opacity-60 flex-shrink-0 ml-1" />
                            </Button>
                          )}
                          <Button
                            className={`media-create-create-btn !min-h-[36px] !h-9 !px-4 !text-sm !font-normal !min-w-0 ${refImages.length > 0 ? `media-create-create-btn--pink ${btnPink}` : btnPrimary}`}
                            size="sm"
                            disabled={!imgPrompt.trim() || !activeConfig}
                            onClick={handleGenerate}
                          >
                          {pendingImageJobs > 0
                            ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> 生成中({pendingImageJobs})</>
                            : refImages.length > 0
                              ? <><Sparkles className="w-4 h-4 mr-1" /> 二创</>
                              : <><Wand2 className="w-4 h-4 mr-1" /> 生成</>
                          }
                        </Button>
                        </div>
                      </div>
                      {showAddPrompt && (
                        <div className="flex-shrink-0 rounded-lg bg-[var(--surface-secondary)] p-2 mt-2 space-y-2 border border-[var(--border-subtle)]">
                          <div className="flex flex-col sm:flex-row gap-1.5">
                            <input type="text" placeholder="标签名" className={`${inputClass} !py-1 !text-xs flex-shrink-0`} style={{ width: '100px', maxWidth: '100%' }} value={newPromptLabel} onChange={(e) => setNewPromptLabel(e.target.value)} maxLength={20} autoFocus />
                            <input type="text" placeholder="提示词内容" className={`${inputClass} !py-1 !text-xs flex-1 min-w-0`} value={newPromptText} onChange={(e) => setNewPromptText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomPrompt(); } }} />
                          </div>
                          <div className="flex gap-1.5 items-center">
                            <Button size="sm" className="!bg-[var(--color-secondary)] !text-white hover:!bg-[var(--color-secondary-hover)] border-0 !text-[11px] !py-1 !px-2" disabled={!newPromptLabel.trim() || !newPromptText.trim()} onClick={addCustomPrompt}><Save className="w-3 h-3 mr-0.5" />{editingPromptId ? '更新' : '保存'}</Button>
                            <button type="button" className="text-xs text-[var(--text-muted)] hover:text-[var(--color-secondary)] px-2 py-1" onClick={cancelEditPrompt}>取消</button>
                            {editingPromptId && <button type="button" className="text-xs text-[var(--color-secondary)] hover:text-[var(--color-secondary-hover)] ml-auto flex items-center gap-1 px-2 py-1" onClick={() => deleteCustomPrompt(editingPromptId)}><Trash2 className="w-3.5 h-3.5" /> 删除</button>}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 下方：粘贴/上传参考图面板 */}
                    <div className="prompt-and-ref-card__images flex-shrink-0 min-h-0 py-1.5 px-2 sm:px-2.5 border-t border-[var(--border-subtle)] overflow-hidden relative">
                      {refImages.length > 0 ? (
                        <>
                          <div className="flex gap-1.5 flex-wrap max-h-[160px] overflow-y-auto overflow-x-hidden no-scrollbar min-w-0 pr-12">
                            {refImages.map((img, idx) => {
                              const src = safeImgSrc(img.url);
                              return (
                                <div key={idx} className="relative flex-shrink-0 group/ri">
                                  {src ? (
                                    <img
                                      src={src}
                                      alt={`参考图 ${idx + 1}`}
                                      className="rounded border border-[var(--color-accent)]/50 h-16 max-w-[100px] w-auto object-contain cursor-pointer"
                                      onClick={() => setLightboxUrl(resolveMediaSrc(img.url ?? ''))}
                                    />
                                  ) : (
                                    <div className="rounded border border-[var(--color-accent)]/50 h-16 w-16 flex items-center justify-center bg-black text-[var(--niho-skyblue-gray)]">
                                      <ImageIcon className="w-6 h-6" />
                                    </div>
                                  )}
                                  <button
                                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-[var(--color-secondary)] text-white opacity-0 group-hover/ri:opacity-100 transition-opacity"
                                    onClick={() => removeRefImage(idx)}
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                  <span className="absolute bottom-0 left-0 text-[6px] px-0.5 py-0 rounded bg-black/60 text-white leading-tight">
                                    {img.source === 'upload' ? '上传' : img.source === 'paste' ? '粘贴' : '生成'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="absolute bottom-1 right-1 flex gap-0.5" title="添加更多 / 全部移除">
                            <button type="button" className="p-1 rounded-md bg-black/40 text-white/90 hover:bg-[var(--color-accent)]/80 hover:text-white transition-colors" onClick={triggerFileInput} title="添加更多">
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" className="p-1 rounded-md bg-black/40 text-white/90 hover:bg-[var(--color-secondary)]/80 hover:text-white transition-colors" onClick={clearRefImages} title="全部移除">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className={`
                          flex items-center justify-between py-1.5 sm:py-2 px-2 sm:px-2.5 gap-2 rounded-lg border border-dashed transition-colors
                          ${dragOver ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--border-default)]'}
                        `}>
                          <div className="flex items-center gap-2 min-w-0">
                            <ImagePlus className={`w-5 h-5 ${textMuted} opacity-50 flex-shrink-0`} />
                            <p className={`text-xs ${textMuted} truncate`}>粘贴或上传参考图 → 自动切换为二创</p>
                          </div>
                          <div className="flex gap-1.5 flex-shrink-0">
                            <Button variant="outline" size="sm" className={`${btnSecondary} !text-[11px] !py-0.5 !px-2`} onClick={triggerFileInput}>
                              <Upload className="w-3 h-3 mr-1" /> 上传
                            </Button>
                            <Button variant="outline" size="sm" className={`${btnSecondary} !text-[11px] !py-0.5 !px-2`} onClick={handlePasteFromClipboard}>
                              <Clipboard className="w-3 h-3 mr-1" /> 粘贴
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 图片规格设置：宽高比 + 数量（模型选择已移至输入框内） */}
                  <div className="image-spec-block rounded-xl p-2.5 sm:p-3 border border-[var(--border-default)] space-y-3">
                    <div className="flex items-center gap-2">
                      <Maximize2 className="w-5 h-5 text-[var(--color-accent)]" />
                      <span className="text-sm font-semibold text-[var(--text-primary)]">图片规格设置</span>
                    </div>
                    <ImageSizeSelector
                      value={imageSize}
                      onChange={setImageSize}
                      disabled={!activeConfig}
                      hideTitle
                    />
                  </div>

                  </div>

                {/* 右栏：图库 — 桌面端 md+ 显示，移动端用底部抽屉 */}
                <div className="media-create-results-card media-create-gallery min-w-0 min-h-0 flex flex-col overflow-hidden hidden md:flex">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="media-create-results-title"><ImageIcon className="w-4 h-4" /> 图库</h3>
                    <Button
                      size="sm"
                      variant="outline"
                      className={`${btnSecondary} !text-[11px] !py-1 !px-2`}
                      onClick={() => {
                        setShowDriveDialog(true);
                        loadGoogleDriveFiles();
                      }}
                    >
                      <FolderOpen className="w-3.5 h-3.5 mr-1" />
                      Drive 图库
                    </Button>
                  </div>
                  {renderGalleryBody()}
                </div>
              </div>

            {/* 移动端图库：浮动按钮 + 底部抽屉（仅 image 模式且 isMobile） */}
            {createTab === 'image' && isMobile && (
              <>
                <button
                  type="button"
                  className="chatu-gallery-fab"
                  onClick={() => setMobileGalleryOpen(true)}
                  aria-label="查看图库"
                >
                  {createdMedia.length > 0 ? (
                    <div className="chatu-gallery-fab-preview">
                      {(() => {
                        const latest = createdMedia[0];
                        const src = safeImgSrc(latest?.url);
                        const isVideo = !!latest?.mimeType?.startsWith('video/');
                        return src && !isVideo ? (
                          <img src={src} alt="" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-[var(--surface-primary)]">
                            <ImageIcon className="w-4 h-4 text-[var(--text-muted)]" />
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <ImageIcon className="w-5 h-5 text-[var(--color-accent)]" />
                  )}
                  <span>{createdMedia.length} 张</span>
                </button>
                <div className={`chatu-mobile-gallery-drawer ${mobileGalleryOpen ? 'open' : ''}`}>
                  <div
                    className="chatu-mobile-gallery-drawer-backdrop"
                    onClick={() => setMobileGalleryOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="chatu-mobile-gallery-drawer-panel">
                    <div className="chatu-mobile-gallery-drawer-handle" />
                    <div className="chatu-mobile-gallery-drawer-header">
                      <h3 className="media-create-results-title m-0"><ImageIcon className="w-4 h-4" /> 图库</h3>
                      <button
                        type="button"
                        className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        onClick={() => setMobileGalleryOpen(false)}
                        aria-label="关闭"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="chatu-mobile-gallery-drawer-content">
                      {renderGalleryBody()}
                    </div>
                  </div>
                </div>
              </>
            )}
            </>
            )}

            {/* ── 视频 Tab：与图像 Tab 相同布局；移动端视频任务用底部抽屉 ── */}
            {createTab === 'video' && (
              <>
              <div className="media-create-layout flex-1 min-h-0 overflow-hidden">
                <div className={`media-create-left-col flex flex-col gap-3 min-w-0 min-h-0 overflow-y-auto no-scrollbar ${isMobile ? 'chatu-left-col-with-fab' : ''}`}>
                  {providerLoading ? (
                    <div className={`text-sm ${textMuted} ${panelClass} p-3 rounded-xl`}><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> 加载模型...</div>
                  ) : currentConfigs.length === 0 ? (
                    <div className={`text-sm ${textMuted} ${panelClass} p-3 rounded-xl`}>未配置视频模型，请至「大模型录入」添加支持视频的模型</div>
                  ) : (
                  <div
                    ref={dropZoneRef}
                    className={`prompt-and-ref-card rounded-xl overflow-hidden flex flex-col flex-1 min-h-[240px] sm:min-h-[260px] md:min-h-[280px] relative ${dragOver ? 'ring-2 ring-[var(--color-accent)]/30' : ''}`}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                  >
                    {/* 上方：描述视频场景，文字区全宽 */}
                    <div className="prompt-and-ref-card__prompt flex-1 min-h-0 flex flex-col p-2.5">
                      <label className="media-create-prompt-label flex items-center gap-1 mb-1 text-sm flex-shrink-0">
                        <Film className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                        描述视频场景
                      </label>
                      <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0 flex-wrap">
                        <p className={`text-xs ${textMuted}`}>可选参考图作为首帧</p>
                        {activeProviderId === 'gemini' && (activeConfig?.model || '').toLowerCase().includes('veo-3.1') && (
                          <div className="flex gap-2 flex-wrap">
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">首帧图</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-highlight)]/10 text-[var(--color-highlight)]">参考图≤3</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">视频续写</span>
                          </div>
                        )}
                      </div>
                      {/* 首帧图区域 */}
                      <div className="flex-shrink-0 mb-2">
                        {refImages.length > 0 ? (
                          <div className="flex items-center gap-2">
                            {(() => {
                              const firstFrameSrc = safeImgSrc(refImages[0]?.url);
                              return (
                                <div className="relative group/ff">
                                  {firstFrameSrc ? (
                                    <img src={firstFrameSrc} alt="首帧" className="rounded border border-[var(--color-accent)]/50 h-16 max-w-[100px] w-auto object-contain cursor-pointer" onClick={() => setLightboxUrl(firstFrameSrc)} />
                                  ) : (
                                    <div className="rounded border border-[var(--color-accent)]/50 h-16 w-16 flex items-center justify-center bg-black text-[var(--niho-skyblue-gray)]"><ImageIcon className="w-6 h-6" /></div>
                                  )}
                                  <button type="button" className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-[var(--color-secondary)] text-white opacity-0 group-hover/ff:opacity-100 transition-opacity" onClick={() => removeRefImage(0)}><X className="w-2.5 h-2.5" /></button>
                                </div>
                              );
                            })()}
                            <span className={`text-xs ${textMuted}`}>首帧图</span>
                          </div>
                        ) : (
                          <div className={`flex items-center justify-between py-1.5 sm:py-2 px-2 sm:px-2.5 gap-2 rounded-lg border border-dashed ${dragOver ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--border-default)]'}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <ImagePlus className={`w-5 h-5 ${textMuted} opacity-50 flex-shrink-0`} />
                              <p className={`text-xs ${textMuted} truncate`}>粘贴或上传首帧图</p>
                            </div>
                            <div className="flex gap-1.5 flex-shrink-0">
                              <Button variant="outline" size="sm" className={`${btnSecondary} !text-[11px] !py-0.5 !px-2`} onClick={triggerFileInput}><Upload className="w-3 h-3 mr-1" /> 上传</Button>
                              <Button variant="outline" size="sm" className={`${btnSecondary} !text-[11px] !py-0.5 !px-2`} onClick={handlePasteFromClipboard}><Clipboard className="w-3 h-3 mr-1" /> 粘贴</Button>
                            </div>
                          </div>
                        )}
                      </div>
                      {/* 文字输入区：全宽排满 */}
                      <div className="flex-1 min-h-0 flex flex-col">
                        <textarea
                          placeholder="描述视频场景、动作、氛围..."
                          className={`${inputClass} resize-none rounded-lg min-h-[80px] flex-1 min-w-0 overflow-y-auto !py-2 !px-2.5`}
                          rows={3}
                          value={videoPrompt}
                          onChange={(e) => setVideoPrompt(e.target.value)}
                        />
                      </div>
                      {/* 底部按钮栏：自定义提示词(左) | 模型+生成(右) */}
                      <div className="flex-shrink-0 flex items-center justify-between gap-3 pt-3 mt-1 border-t border-[var(--border-subtle)] min-h-[48px]">
                        <div className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto no-scrollbar">
                          <button
                            type="button"
                            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-normal transition-all ${showAddPrompt ? 'bg-[var(--color-secondary)]/15 text-[var(--color-secondary)]' : 'bg-transparent text-[var(--color-secondary)] hover:bg-[var(--color-secondary)]/10'}`}
                            onClick={() => { if (showAddPrompt) cancelEditPrompt(); else setShowAddPrompt(true); }}
                          >
                            {showAddPrompt ? <><X className="w-4 h-4" /> 取消</> : <><Plus className="w-4 h-4" /> 新建</>}
                          </button>
                          {customPrompts.map((cp) => (
                            <div key={cp.id} className="group/cp relative flex-shrink-0">
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex gap-0.5 opacity-0 group-hover/cp:opacity-100 transition-opacity z-10">
                                <button type="button" className="p-1.5 rounded-lg bg-black/90 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20" onClick={(e) => { e.stopPropagation(); startEditPrompt(cp); }} title="编辑"><PenLine className="w-3.5 h-3.5" /></button>
                                <button type="button" className="p-1.5 rounded-lg bg-black/90 text-[var(--color-secondary)] hover:bg-[var(--color-secondary)]/20" onClick={(e) => { e.stopPropagation(); deleteCustomPrompt(cp.id); }} title="删除"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                              <button type="button" className={`inline-flex items-center px-3 py-2 rounded-lg text-sm font-normal transition-all cursor-pointer select-none text-[var(--color-secondary)] bg-[var(--color-secondary)]/5 hover:bg-[var(--color-secondary)]/15 ${editingPromptId === cp.id ? 'ring-1 ring-[var(--color-secondary)]/25' : ''}`} onClick={() => applyPromptText(cp.text)} title={cp.text.slice(0, 60) + (cp.text.length > 60 ? '…' : '')}>{cp.label}</button>
                            </div>
                          ))}
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-2">
                          <Button variant="outline" size="sm" className={`media-create-model-btn !min-h-[36px] !h-9 !px-3 !text-sm !font-normal !min-w-0 ${btnSecondary}`} onClick={() => setShowModelDialog(true)}>
                            {activeConfig ? <span className="truncate max-w-[120px] sm:max-w-[140px]">{activeConfig.model || activeConfig.name}</span> : '选择模型'}
                            <ChevronDown className="w-4 h-4 opacity-60 flex-shrink-0 ml-1" />
                          </Button>
                          <Button className={`media-create-create-btn !min-h-[36px] !h-9 !px-4 !text-sm !font-normal !min-w-0 ${btnPrimary}`} size="sm" disabled={videoLoading || (!videoPrompt.trim() && refImages.length === 0) || !activeConfig} onClick={handleVideoSubmit}>
                            {videoLoading ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> 提交中...</> : <><Film className="w-4 h-4 mr-1" /> 生成视频</>}
                          </Button>
                        </div>
                      </div>
                      {showAddPrompt && (
                        <div className="flex-shrink-0 rounded-lg bg-[var(--surface-secondary)] p-2 mt-2 space-y-2 border border-[var(--border-subtle)]">
                          <div className="flex flex-col sm:flex-row gap-1.5">
                            <input type="text" placeholder="标签名" className={`${inputClass} !py-1 !text-xs flex-shrink-0`} style={{ width: '100px', maxWidth: '100%' }} value={newPromptLabel} onChange={(e) => setNewPromptLabel(e.target.value)} maxLength={20} autoFocus />
                            <input type="text" placeholder="提示词内容" className={`${inputClass} !py-1 !text-xs flex-1 min-w-0`} value={newPromptText} onChange={(e) => setNewPromptText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomPrompt(); } }} />
                          </div>
                          <div className="flex gap-1.5 items-center">
                            <Button size="sm" className="!bg-[var(--color-secondary)] !text-white hover:!bg-[var(--color-secondary-hover)] border-0 !text-[11px] !py-1 !px-2" disabled={!newPromptLabel.trim() || !newPromptText.trim()} onClick={addCustomPrompt}><Save className="w-3 h-3 mr-0.5" />{editingPromptId ? '更新' : '保存'}</Button>
                            <button type="button" className="text-xs text-[var(--text-muted)] hover:text-[var(--color-secondary)] px-2 py-1" onClick={cancelEditPrompt}>取消</button>
                            {editingPromptId && <button type="button" className="text-xs text-[var(--color-secondary)] hover:text-[var(--color-secondary-hover)] ml-auto flex items-center gap-1 px-2 py-1" onClick={() => deleteCustomPrompt(editingPromptId)}><Trash2 className="w-3.5 h-3.5" /> 删除</button>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                </div>
                {/* 右栏：视频任务与输出 — 桌面端 md+ 显示，移动端用底部抽屉 */}
                <div className="media-create-results-card min-w-0 min-h-0 flex flex-col overflow-hidden border border-[var(--border-default)] bg-[var(--surface-secondary)] rounded-xl hidden md:flex">
                  <h3 className="media-create-results-title"><Film className="w-4 h-4" /> 视频任务</h3>
                  {!videoTaskId && !videoError ? (
                    <div className="media-create-empty-state flex-1 flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
                      <Film className="w-10 h-10 opacity-40 mb-2" />
                      <p className="text-sm font-medium text-[var(--text-secondary)]">暂无任务</p>
                      <p className="text-xs mt-1">在左侧输入描述并提交生成视频</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto no-scrollbar px-3 pb-3">
                      {videoError && <p className="text-xs text-[var(--color-secondary)]">{videoError}</p>}
                      {videoTaskId && (
                        <>
                          <p className={`text-xs ${textMuted}`}>
                            状态: <span className={`font-medium ${['SUCCEEDED','COMPLETED'].includes(videoStatus) ? 'text-[var(--color-accent)]' : ['FAILED','CANCELLED','ERROR'].includes(videoStatus) ? 'text-[var(--color-secondary)]' : 'text-[var(--color-highlight)]'}`}>{videoStatus || '...'}</span>
                          </p>
                          {videoStatus === 'PROCESSING' && (
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-[var(--color-highlight)]" />
                              <span className="text-xs text-[var(--text-muted)]">视频生成中，请稍候...</span>
                            </div>
                          )}
                          {videoStatus === 'DOWNLOADING' && (
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                              <span className="text-xs text-[var(--text-muted)]">正在下载...</span>
                            </div>
                          )}
                          {videoOutput && (
                            <div className="mt-2 flex flex-col gap-2">
                              <video src={videoOutput} controls className="rounded-lg w-full max-h-[50vh]" />
                              <Button size="sm" className={btnSecondary} onClick={() => dl(videoOutput, 'video.mp4')}>
                                <Download className="w-3.5 h-3.5 mr-1" /> 保存到本地
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

            {/* 移动端视频任务：浮动按钮 + 底部抽屉 */}
            {isMobile && (
              <>
                <button
                  type="button"
                  className="chatu-gallery-fab"
                  onClick={() => setMobileVideoDrawerOpen(true)}
                  aria-label="查看视频任务"
                >
                  <Film className="w-5 h-5 text-[var(--color-accent)]" />
                  <span>{videoTaskId ? (videoOutput ? '已完成' : '生成中') : '视频任务'}</span>
                </button>
                <div className={`chatu-mobile-gallery-drawer ${mobileVideoDrawerOpen ? 'open' : ''}`}>
                  <div
                    className="chatu-mobile-gallery-drawer-backdrop"
                    onClick={() => setMobileVideoDrawerOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="chatu-mobile-gallery-drawer-panel">
                    <div className="chatu-mobile-gallery-drawer-handle" />
                    <div className="chatu-mobile-gallery-drawer-header">
                      <h3 className="media-create-results-title m-0"><Film className="w-4 h-4" /> 视频任务</h3>
                      <button
                        type="button"
                        className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        onClick={() => setMobileVideoDrawerOpen(false)}
                        aria-label="关闭"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="chatu-mobile-gallery-drawer-content">
                      {!videoTaskId && !videoError ? (
                        <div className="media-create-empty-state flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
                          <Film className="w-10 h-10 opacity-40 mb-2" />
                          <p className="text-sm font-medium text-[var(--text-secondary)]">暂无任务</p>
                          <p className="text-xs mt-1">在左侧输入描述并提交生成视频</p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {videoError && <p className="text-xs text-[var(--color-secondary)]">{videoError}</p>}
                          {videoTaskId && (
                            <>
                              <p className={`text-xs ${textMuted}`}>
                                状态: <span className={`font-medium ${['SUCCEEDED','COMPLETED'].includes(videoStatus) ? 'text-[var(--color-accent)]' : ['FAILED','CANCELLED','ERROR'].includes(videoStatus) ? 'text-[var(--color-secondary)]' : 'text-[var(--color-highlight)]'}`}>{videoStatus || '...'}</span>
                              </p>
                              {videoStatus === 'PROCESSING' && (
                                <div className="flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin text-[var(--color-highlight)]" />
                                  <span className="text-xs text-[var(--text-muted)]">视频生成中，请稍候...</span>
                                </div>
                              )}
                              {videoStatus === 'DOWNLOADING' && (
                                <div className="flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                                  <span className="text-xs text-[var(--text-muted)]">正在下载...</span>
                                </div>
                              )}
                              {videoOutput && (
                                <div className="mt-2 flex flex-col gap-2">
                                  <video src={videoOutput} controls className="rounded-lg w-full max-h-[50vh]" />
                                  <Button size="sm" className={btnSecondary} onClick={() => dl(videoOutput, 'video.mp4')}>
                                    <Download className="w-3.5 h-3.5 mr-1" /> 保存到本地
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
            </>
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
              选择{createTab === 'image' ? '图像' : createTab === 'video' ? '视频' : '图像'}模型
            </DialogTitle>
            <DialogDescription>
              {createTab === 'image' ? '选择一个支持图像生成的模型' : createTab === 'video' ? '选择一个支持视频生成的模型' : '选择模型'}
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

      <Dialog open={showDriveDialog} onOpenChange={setShowDriveDialog}>
        <DialogContent className="chatee-dialog-standard max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GoogleDriveIcon className="w-5 h-5" />
              Google Drive 图库（chaya）
            </DialogTitle>
            <DialogDescription>点击图片可加入参考图，或在新窗口打开 Drive 预览</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto no-scrollbar">
            <div className="flex items-center justify-end mb-2">
              <Button size="sm" variant="outline" className={btnSecondary} onClick={loadGoogleDriveFiles}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${driveLoading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            </div>
            {driveLoading ? (
              <div className={`text-sm ${textMuted} py-8 text-center`}>
                <Loader2 className="w-4 h-4 animate-spin inline mr-1" />
                加载中...
              </div>
            ) : driveError ? (
              <div className="text-sm text-[var(--color-secondary)] py-6 text-center">{driveError}</div>
            ) : driveFiles.length === 0 ? (
              <div className={`text-sm ${textMuted} py-6 text-center`}>目录里还没有可展示的图片/视频</div>
            ) : (
              <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {driveFiles.map((f) => {
                  const isVideo = (f.mime_type || '').startsWith('video/');
                  const thumbSrc = f.thumb_url ? mediaApi.getGoogleDriveFileThumbUrl(f.id) : '';
                  const fullSrc = f.preview_url ? mediaApi.getGoogleDriveFilePreviewUrl(f.id) : '';
                  return (
                    <div key={f.id} className="rounded-lg border border-[var(--border-default)] p-1.5 bg-black/20">
                      <button
                        type="button"
                        className="w-full aspect-square rounded overflow-hidden bg-black/60 flex items-center justify-center"
                        onClick={() => {
                          if (!isVideo && fullSrc) {
                            pickRefImage({ url: fullSrc, mimeType: f.mime_type || 'image/png', source: 'generated' });
                            setShowDriveDialog(false);
                          } else if (f.web_view_link) {
                            window.open(f.web_view_link, '_blank', 'noopener,noreferrer');
                          }
                        }}
                        title={f.name || ''}
                      >
                        {!isVideo && (thumbSrc || fullSrc) ? (
                          <img src={thumbSrc || fullSrc} alt={f.name || ''} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <Film className="w-6 h-6 text-[var(--color-highlight)]" />
                        )}
                      </button>
                      <div className="mt-1 flex items-center justify-between gap-1">
                        <p className="text-[10px] truncate text-[var(--text-muted)]" title={f.name || ''}>{f.name || '未命名'}</p>
                        {f.web_view_link && (
                          <button
                            type="button"
                            className="text-[10px] text-[var(--color-accent)] hover:underline"
                            onClick={() => window.open(f.web_view_link, '_blank', 'noopener,noreferrer')}
                          >
                            打开
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {driveNextPageToken && (
                <div className="mt-3 flex justify-center">
                  <Button size="sm" variant="outline" className={btnSecondary} onClick={loadMoreGoogleDriveFiles} disabled={driveLoadingMore}>
                    {driveLoadingMore ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> 加载中...</> : '加载更多'}
                  </Button>
                </div>
              )}
              </>
            )}
          </div>
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
            <button className="absolute top-2 right-2 p-2.5 sm:p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" onClick={() => setLightboxUrl(null)} aria-label="关闭">
              <X className="w-5 h-5" />
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 sm:left-auto sm:right-2 sm:translate-x-0 flex gap-3 sm:gap-2">
              <button className="p-2.5 sm:p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" onClick={() => lbSrc && dl(lbSrc, 'image.png')} aria-label="保存到本地">
                <Download className="w-5 h-5 sm:w-4 sm:h-4" />
              </button>
              <button
                className="p-2.5 sm:p-1.5 rounded-full bg-[#4285F4]/80 text-white hover:bg-[#4285F4] min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                onClick={() => {
                  const target = createdMedia.find((m) => resolveMediaSrc(m.url ?? '') === resolveMediaSrc(lightboxUrl ?? ''));
                  uploadToGoogleDrive(target);
                }}
                aria-label="保存到 Google Drive"
              >
                {driveUploadingOutputId ? <Loader2 className="w-5 h-5 sm:w-4 sm:h-4 animate-spin" /> : <GoogleDriveIcon className="w-5 h-5 sm:w-4 sm:h-4" />}
              </button>
              <button
                className="p-2.5 sm:p-1.5 rounded-full bg-[var(--color-secondary)]/80 text-white hover:bg-[var(--color-secondary)] min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                onClick={() => { if (lightboxUrl) pickRefImage({ url: lightboxUrl }); setLightboxUrl(null); }}
                aria-label="二创"
              >
                <Sparkles className="w-5 h-5 sm:w-4 sm:h-4" />
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
