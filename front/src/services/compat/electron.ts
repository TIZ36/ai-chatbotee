/**
 * Electron API 兼容层
 * 在 Electron 环境中使用原生能力，在浏览器中使用 fallback
 * 
 * @module compat/electron
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface SystemInfo {
  platform: 'darwin' | 'win32' | 'linux';
  arch: string;
  version: string;
  hostname: string;
  userDataPath: string;
}

export interface FileInfo {
  exists: boolean;
  size: number;
  isFile: boolean;
  mtime: number;
  error?: string;
}

export interface DirectoryListing {
  success: boolean;
  files: Array<{
    name: string;
    path: string;
    size: number;
    isFile: boolean;
    mtime: number;
  }>;
  error?: string;
}

export interface SaveMediaParams {
  data: string; // base64
  mimeType: string;
  defaultPath?: string;
  filename?: string;
}

export interface SaveMediaResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface OAuthParams {
  authorizationUrl: string;
  windowTitle?: string;
}

export interface OAuthResult {
  code: string;
  state: string;
}

export interface TerminalData {
  pid: number;
  data: string;
}

export interface TerminalExit {
  pid: number;
  exitCode: number;
  signal?: string;
}

/**
 * Electron API 接口定义
 */
export interface ElectronAPI {
  // 文件系统
  openFolder: (path: string) => Promise<{ success: boolean }>;
  getFileInfo: (path: string) => Promise<FileInfo>;
  listDirectory: (path: string) => Promise<DirectoryListing>;
  readFileAsDataUrl: (path: string) => Promise<string>;
  
  // 终端
  createTerminal: (cwd?: string) => Promise<number>;
  writeTerminal: (pid: number, data: string) => Promise<void>;
  resizeTerminal: (pid: number, cols: number, rows: number) => Promise<void>;
  killTerminal: (pid: number) => Promise<void>;
  onTerminalData: (callback: (data: TerminalData) => void) => void;
  onTerminalExit: (callback: (data: TerminalExit) => void) => void;
  
  // 窗口控制
  toggleMaximize: () => Promise<{ maximized: boolean }>;
  toggleDevTools: () => Promise<{ opened: boolean }>;
  
  // 后端配置
  getBackendUrl: () => Promise<string>;
  setBackendUrl: (url: string) => Promise<void>;
  
  // OAuth
  mcpOAuthAuthorize: (params: OAuthParams) => Promise<OAuthResult>;
  mcpOAuthOpenExternal: (params: { authorizationUrl: string }) => Promise<{ success: boolean }>;
  notionOAuthAuthorize: (authUrl: string) => Promise<OAuthResult>;
  
  // 扩展接口（可选）
  showOpenDialog?: (options: any) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog?: (options: any) => Promise<{ canceled: boolean; filePath?: string }>;
  readFile?: (path: string, encoding?: string) => Promise<string | ArrayBuffer>;
  writeFile?: (path: string, data: string | ArrayBuffer) => Promise<void>;
  saveMediaFile?: (params: SaveMediaParams) => Promise<SaveMediaResult>;
  clipboardReadText?: () => Promise<string>;
  clipboardWriteText?: (text: string) => Promise<void>;
  clipboardReadImage?: () => Promise<string | null>;
  clipboardWriteImage?: (dataUrl: string) => Promise<void>;
  showNotification?: (options: { title: string; body: string }) => Promise<void>;
}

// ============================================================================
// 环境检测
// ============================================================================

/**
 * 检查是否在 Electron 环境中运行
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

/**
 * 获取 Electron API 实例
 * @returns ElectronAPI 或 null（在浏览器环境中）
 */
export function getElectronAPI(): ElectronAPI | null {
  if (isElectron()) {
    return (window as any).electronAPI as ElectronAPI;
  }
  return null;
}

// ============================================================================
// 后端 URL
// ============================================================================

/**
 * 获取后端 URL
 * - Electron: 从配置读取
 * - Browser: 使用环境变量或默认值
 */
export async function getBackendUrl(): Promise<string> {
  const api = getElectronAPI();
  if (api?.getBackendUrl) {
    return api.getBackendUrl();
  }
  // 浏览器环境：使用环境变量或默认值（与 backend config.yaml server.port 一致）
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
}

/**
 * 设置后端 URL（仅 Electron 环境）
 */
export async function setBackendUrl(url: string): Promise<void> {
  const api = getElectronAPI();
  if (api?.setBackendUrl) {
    await api.setBackendUrl(url);
  }
}

// ============================================================================
// 文件系统
// ============================================================================

/**
 * 打开文件夹
 */
export async function openFolder(path: string): Promise<{ success: boolean }> {
  const api = getElectronAPI();
  if (api?.openFolder) {
    return api.openFolder(path);
  }
  // 浏览器 fallback：无法打开本地文件夹
  console.warn('[Electron Compat] openFolder not available in browser');
  return { success: false };
}

/**
 * 获取文件信息
 */
export async function getFileInfo(path: string): Promise<FileInfo> {
  const api = getElectronAPI();
  if (api?.getFileInfo) {
    return api.getFileInfo(path);
  }
  return { exists: false, size: 0, isFile: false, mtime: 0, error: 'Not in Electron' };
}

/**
 * 列出目录内容
 */
export async function listDirectory(path: string): Promise<DirectoryListing> {
  const api = getElectronAPI();
  if (api?.listDirectory) {
    return api.listDirectory(path);
  }
  return { success: false, files: [], error: 'Not in Electron' };
}

/**
 * 读取文件为 Data URL
 */
export async function readFileAsDataUrl(path: string): Promise<string | null> {
  const api = getElectronAPI();
  if (api?.readFileAsDataUrl) {
    try {
      return await api.readFileAsDataUrl(path);
    } catch (e) {
      console.error('[Electron Compat] readFileAsDataUrl error:', e);
      return null;
    }
  }
  return null;
}

// ============================================================================
// 媒体文件
// ============================================================================

/**
 * 将 base64 转换为 Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * 保存媒体文件
 * - Electron: 使用原生文件对话框或直接保存
 * - Browser: 使用下载链接
 */
export async function saveMedia(
  data: string,
  mimeType: string,
  filename?: string,
  defaultPath?: string
): Promise<SaveMediaResult> {
  const api = getElectronAPI();
  
  if (api?.saveMediaFile) {
    // Electron 环境
    return api.saveMediaFile({ data, mimeType, filename, defaultPath });
  }
  
  // 浏览器 fallback: 创建下载链接
  try {
    const blob = base64ToBlob(data, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `media_${Date.now()}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 剪贴板
// ============================================================================

/**
 * 读取剪贴板文本
 */
export async function clipboardReadText(): Promise<string> {
  const api = getElectronAPI();
  if (api?.clipboardReadText) {
    return api.clipboardReadText();
  }
  // 浏览器 fallback
  try {
    return await navigator.clipboard.readText();
  } catch (e) {
    console.warn('[Electron Compat] clipboardReadText failed:', e);
    return '';
  }
}

/**
 * 写入剪贴板文本
 */
export async function clipboardWriteText(text: string): Promise<void> {
  const api = getElectronAPI();
  if (api?.clipboardWriteText) {
    return api.clipboardWriteText(text);
  }
  // 浏览器 fallback
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.warn('[Electron Compat] clipboardWriteText failed:', e);
  }
}

// ============================================================================
// 通知
// ============================================================================

/**
 * 显示系统通知
 */
export async function showNotification(title: string, body: string): Promise<void> {
  const api = getElectronAPI();
  
  if (api?.showNotification) {
    await api.showNotification({ title, body });
    return;
  }
  
  // 浏览器 fallback: Web Notification API
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    }
  }
}

// ============================================================================
// OAuth
// ============================================================================

/**
 * 执行 MCP OAuth 授权
 */
export async function mcpOAuthAuthorize(
  authorizationUrl: string,
  windowTitle?: string
): Promise<OAuthResult | null> {
  const api = getElectronAPI();
  
  if (api?.mcpOAuthAuthorize) {
    try {
      return await api.mcpOAuthAuthorize({ authorizationUrl, windowTitle });
    } catch (e) {
      console.error('[Electron Compat] mcpOAuthAuthorize error:', e);
      return null;
    }
  }
  
  // 浏览器 fallback: 打开新窗口
  console.warn('[Electron Compat] mcpOAuthAuthorize: opening in new window');
  window.open(authorizationUrl, '_blank', 'width=600,height=700');
  return null;
}

/**
 * 在外部浏览器中打开 OAuth 授权
 */
export async function mcpOAuthOpenExternal(authorizationUrl: string): Promise<boolean> {
  const api = getElectronAPI();
  
  if (api?.mcpOAuthOpenExternal) {
    try {
      const result = await api.mcpOAuthOpenExternal({ authorizationUrl });
      return result.success;
    } catch (e) {
      console.error('[Electron Compat] mcpOAuthOpenExternal error:', e);
      return false;
    }
  }
  
  // 浏览器 fallback
  window.open(authorizationUrl, '_blank');
  return true;
}

// ============================================================================
// 终端
// ============================================================================

export interface TerminalSession {
  pid: number;
  cwd: string;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

/**
 * 创建终端会话
 * @returns 终端会话对象，在浏览器环境中返回 null
 */
export async function createTerminalSession(cwd?: string): Promise<TerminalSession | null> {
  const api = getElectronAPI();
  
  if (!api?.createTerminal) {
    console.warn('[Electron Compat] Terminal not available in browser');
    return null;
  }
  
  const pid = await api.createTerminal(cwd);
  
  const dataCallbacks: ((data: string) => void)[] = [];
  const exitCallbacks: ((code: number) => void)[] = [];
  
  // 设置监听器
  api.onTerminalData?.((data: TerminalData) => {
    if (data.pid === pid) {
      dataCallbacks.forEach(cb => cb(data.data));
    }
  });
  
  api.onTerminalExit?.((data: TerminalExit) => {
    if (data.pid === pid) {
      exitCallbacks.forEach(cb => cb(data.exitCode));
    }
  });
  
  return {
    pid,
    cwd: cwd || '',
    
    onData: (callback) => {
      dataCallbacks.push(callback);
    },
    
    onExit: (callback) => {
      exitCallbacks.push(callback);
    },
    
    write: (data) => {
      api.writeTerminal?.(pid, data);
    },
    
    resize: (cols, rows) => {
      api.resizeTerminal?.(pid, cols, rows);
    },
    
    kill: () => {
      api.killTerminal?.(pid);
    },
  };
}

// ============================================================================
// 窗口控制
// ============================================================================

/**
 * 切换窗口最大化状态
 */
export async function toggleMaximize(): Promise<boolean> {
  const api = getElectronAPI();
  if (api?.toggleMaximize) {
    const result = await api.toggleMaximize();
    return result.maximized;
  }
  return false;
}

/**
 * 切换开发者工具
 */
export async function toggleDevTools(): Promise<boolean> {
  const api = getElectronAPI();
  if (api?.toggleDevTools) {
    const result = await api.toggleDevTools();
    return result.opened;
  }
  return false;
}

// ============================================================================
// 导出
// ============================================================================

export default {
  isElectron,
  getElectronAPI,
  getBackendUrl,
  setBackendUrl,
  openFolder,
  getFileInfo,
  listDirectory,
  readFileAsDataUrl,
  saveMedia,
  clipboardReadText,
  clipboardWriteText,
  showNotification,
  mcpOAuthAuthorize,
  mcpOAuthOpenExternal,
  createTerminalSession,
  toggleMaximize,
  toggleDevTools,
};
