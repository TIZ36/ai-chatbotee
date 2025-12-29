# Electron 接入设计

## 一、架构总览

Electron 作为桌面应用的容器，连接前端和后端，提供原生能力：

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Electron Main Process                        │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐      │
│  │   窗口管理  │  │  文件系统  │  │   终端PTY  │  │  OAuth窗口 │      │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘      │
│        │               │               │               │              │
│        └───────────────┴───────────────┴───────────────┘              │
│                              │                                         │
│                       ┌──────┴──────┐                                 │
│                       │   Preload   │                                 │
│                       │   Bridge    │                                 │
│                       └──────┬──────┘                                 │
├──────────────────────────────┼────────────────────────────────────────┤
│                              │                                         │
│  ┌───────────────────────────┴─────────────────────────────────┐     │
│  │                    Renderer Process                          │     │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │     │
│  │  │  React  │  │ Service │  │ Provider│  │  Apps   │        │     │
│  │  │   UI    │  │  Layer  │  │  Layer  │  │  Layer  │        │     │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                          Electron Renderer                            │
└──────────────────────────────────────────────────────────────────────┘
```

## 二、Preload Bridge 设计

### 2.1 当前 electronAPI 接口

```typescript
// electron/preload.ts
interface ElectronAPI {
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
}
```

### 2.2 扩展 electronAPI（配合新架构）

```typescript
// electron/preload.ts - 扩展接口
interface ElectronAPIExtended extends ElectronAPI {
  // ============================================================================
  // 系统信息
  // ============================================================================
  getSystemInfo: () => Promise<SystemInfo>;
  getPlatform: () => string;
  getAppVersion: () => string;
  
  // ============================================================================
  // 文件系统增强
  // ============================================================================
  
  // 选择文件/目录对话框
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogResult>;
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogResult>;
  
  // 文件读写
  readFile: (path: string, encoding?: string) => Promise<string | Buffer>;
  writeFile: (path: string, data: string | Buffer) => Promise<void>;
  
  // 媒体文件保存（配合 Core/media）
  saveMediaFile: (params: SaveMediaParams) => Promise<SaveMediaResult>;
  
  // ============================================================================
  // 剪贴板
  // ============================================================================
  clipboardReadText: () => Promise<string>;
  clipboardWriteText: (text: string) => Promise<void>;
  clipboardReadImage: () => Promise<string | null>; // base64
  clipboardWriteImage: (dataUrl: string) => Promise<void>;
  
  // ============================================================================
  // 通知
  // ============================================================================
  showNotification: (options: NotificationOptions) => Promise<void>;
  
  // ============================================================================
  // 应用生命周期
  // ============================================================================
  onAppActivate: (callback: () => void) => void;
  onAppBeforeQuit: (callback: () => void) => void;
  
  // ============================================================================
  // 深度链接（用于 OAuth 回调）
  // ============================================================================
  registerProtocolHandler: (protocol: string) => Promise<void>;
  onProtocolUrl: (callback: (url: string) => void) => void;
}
```

### 2.3 类型定义

```typescript
// front/src/types/electron.d.ts

interface SystemInfo {
  platform: 'darwin' | 'win32' | 'linux';
  arch: string;
  version: string;
  hostname: string;
  userDataPath: string;
}

interface FileInfo {
  exists: boolean;
  size: number;
  isFile: boolean;
  mtime: number;
  error?: string;
}

interface DirectoryListing {
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

interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
}

interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface SaveMediaParams {
  data: string; // base64
  mimeType: string;
  defaultPath?: string;
  filename?: string;
}

interface SaveMediaResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  silent?: boolean;
}

interface OAuthParams {
  authorizationUrl: string;
  windowTitle?: string;
}

interface OAuthResult {
  code: string;
  state: string;
}
```

## 三、Main Process 扩展

### 3.1 新增 IPC Handler

```typescript
// electron/main.ts - 新增处理程序

// ============================================================================
// 系统信息
// ============================================================================

ipcMain.handle('get-system-info', async () => {
  return {
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    hostname: os.hostname(),
    userDataPath: app.getPath('userData'),
  };
});

ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('get-app-version', () => app.getVersion());

// ============================================================================
// 文件对话框
// ============================================================================

ipcMain.handle('show-open-dialog', async (_, options: OpenDialogOptions) => {
  const result = await dialog.showOpenDialog(mainWindow!, options);
  return result;
});

ipcMain.handle('show-save-dialog', async (_, options: SaveDialogOptions) => {
  const result = await dialog.showSaveDialog(mainWindow!, options);
  return result;
});

// ============================================================================
// 文件读写
// ============================================================================

ipcMain.handle('read-file', async (_, filePath: string, encoding?: string) => {
  return fs.readFileSync(filePath, encoding as BufferEncoding);
});

ipcMain.handle('write-file', async (_, filePath: string, data: string | Buffer) => {
  fs.writeFileSync(filePath, data);
});

// ============================================================================
// 媒体文件保存
// ============================================================================

ipcMain.handle('save-media-file', async (_, params: SaveMediaParams) => {
  try {
    const { data, mimeType, defaultPath, filename } = params;
    
    // 根据 MIME 类型确定扩展名
    const extMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'audio/mp3': '.mp3',
      'audio/wav': '.wav',
    };
    const ext = extMap[mimeType] || '.bin';
    
    // 如果指定了默认路径，直接保存
    let savePath: string;
    if (defaultPath) {
      savePath = path.join(defaultPath, filename || `media_${Date.now()}${ext}`);
    } else {
      // 弹出保存对话框
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: filename || `media_${Date.now()}${ext}`,
        filters: [{ name: 'Media', extensions: [ext.slice(1)] }],
      });
      
      if (result.canceled || !result.filePath) {
        return { success: false, error: 'User cancelled' };
      }
      savePath = result.filePath;
    }
    
    // 解码 base64 并保存
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(savePath, buffer);
    
    return { success: true, filePath: savePath };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// ============================================================================
// 剪贴板
// ============================================================================

ipcMain.handle('clipboard-read-text', () => clipboard.readText());
ipcMain.handle('clipboard-write-text', (_, text: string) => clipboard.writeText(text));

ipcMain.handle('clipboard-read-image', () => {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  return image.toDataURL();
});

ipcMain.handle('clipboard-write-image', (_, dataUrl: string) => {
  const image = nativeImage.createFromDataURL(dataUrl);
  clipboard.writeImage(image);
});

// ============================================================================
// 通知
// ============================================================================

ipcMain.handle('show-notification', async (_, options: NotificationOptions) => {
  const notification = new Notification(options);
  notification.show();
});
```

### 3.2 Preload Script 扩展

```typescript
// electron/preload.ts - 扩展

import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  // ... 现有方法 ...
  
  // 系统信息
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getPlatform: () => process.platform,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // 文件对话框
  showOpenDialog: (options: any) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options: any) => ipcRenderer.invoke('show-save-dialog', options),
  
  // 文件读写
  readFile: (path: string, encoding?: string) => ipcRenderer.invoke('read-file', path, encoding),
  writeFile: (path: string, data: any) => ipcRenderer.invoke('write-file', path, data),
  
  // 媒体保存
  saveMediaFile: (params: any) => ipcRenderer.invoke('save-media-file', params),
  
  // 剪贴板
  clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),
  clipboardWriteText: (text: string) => ipcRenderer.invoke('clipboard-write-text', text),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard-read-image'),
  clipboardWriteImage: (dataUrl: string) => ipcRenderer.invoke('clipboard-write-image', dataUrl),
  
  // 通知
  showNotification: (options: any) => ipcRenderer.invoke('show-notification', options),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

## 四、前端服务层集成

### 4.1 Electron 兼容层

```typescript
// front/src/services/compat/electron.ts

/**
 * Electron API 兼容层
 * 在 Electron 环境中使用原生能力，在浏览器中使用 fallback
 */

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

export function getElectronAPI(): ElectronAPI | null {
  if (isElectron()) {
    return (window as any).electronAPI;
  }
  return null;
}

/**
 * 获取后端 URL
 * - Electron: 从配置读取
 * - Browser: 使用相对路径或环境变量
 */
export async function getBackendUrl(): Promise<string> {
  const api = getElectronAPI();
  if (api?.getBackendUrl) {
    return api.getBackendUrl();
  }
  return import.meta.env.VITE_BACKEND_URL || 'http://localhost:3002';
}

/**
 * 保存媒体文件
 * - Electron: 使用原生文件对话框
 * - Browser: 使用下载链接
 */
export async function saveMedia(
  data: string,
  mimeType: string,
  filename?: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const api = getElectronAPI();
  
  if (api?.saveMediaFile) {
    // Electron 环境
    return api.saveMediaFile({ data, mimeType, filename });
  }
  
  // 浏览器 fallback: 创建下载链接
  try {
    const blob = base64ToBlob(data, mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `media_${Date.now()}`;
    a.click();
    URL.revokeObjectURL(url);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * 显示通知
 */
export async function showNotification(
  title: string,
  body: string
): Promise<void> {
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

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
```

### 4.2 在 Provider 层使用

```typescript
// front/src/services/providers/mcp/MCPClient.ts

import { getBackendUrl, isElectron } from '../../compat/electron';

export class MCPClient {
  private async buildProxyUrl(serverUrl: string): Promise<string> {
    // 所有环境都使用后端代理，解决 CORS 问题
    const backendUrl = await getBackendUrl();
    const encodedUrl = encodeURIComponent(serverUrl);
    return `${backendUrl}/mcp?url=${encodedUrl}&transportType=streamable-http`;
  }
  
  // ...
}
```

### 4.3 在 Core/media 层使用

```typescript
// front/src/services/core/media/MediaRenderer.ts

import { saveMedia, isElectron } from '../../compat/electron';

export class MediaRenderer {
  /**
   * 保存生成的媒体到本地
   */
  async saveToLocal(
    mediaItem: MediaItem,
    defaultPath?: string
  ): Promise<{ success: boolean; filePath?: string }> {
    return saveMedia(
      mediaItem.data,
      mediaItem.mimeType,
      mediaItem.filename
    );
  }
}
```

## 五、OAuth 流程集成

### 5.1 Electron 中的 OAuth

```typescript
// front/src/services/providers/mcp/OAuthHandler.ts

import { getElectronAPI } from '../../compat/electron';

export class OAuthHandler {
  /**
   * 执行 OAuth 授权流程
   */
  async authorize(authorizationUrl: string, windowTitle?: string): Promise<OAuthResult> {
    const api = getElectronAPI();
    
    if (api?.mcpOAuthAuthorize) {
      // Electron: 打开授权窗口
      return api.mcpOAuthAuthorize({ authorizationUrl, windowTitle });
    }
    
    // 浏览器: 打开新标签页
    const popup = window.open(authorizationUrl, '_blank', 'width=600,height=700');
    
    return new Promise((resolve, reject) => {
      // 监听来自 popup 的消息
      const handler = (event: MessageEvent) => {
        if (event.data.type === 'oauth-callback') {
          window.removeEventListener('message', handler);
          popup?.close();
          resolve(event.data);
        }
      };
      window.addEventListener('message', handler);
      
      // 超时处理
      setTimeout(() => {
        window.removeEventListener('message', handler);
        popup?.close();
        reject(new Error('OAuth timeout'));
      }, 5 * 60 * 1000); // 5分钟超时
    });
  }
}
```

## 六、终端集成

### 6.1 终端服务

```typescript
// front/src/services/compat/terminal.ts

import { getElectronAPI, isElectron } from './electron';

export interface TerminalSession {
  pid: number;
  cwd: string;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (code: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export async function createTerminalSession(cwd?: string): Promise<TerminalSession | null> {
  const api = getElectronAPI();
  
  if (!api?.createTerminal) {
    console.warn('Terminal not available in browser');
    return null;
  }
  
  const pid = await api.createTerminal(cwd);
  
  return {
    pid,
    cwd: cwd || process.cwd(),
    
    onData: (callback) => {
      api.onTerminalData?.((data) => {
        if (data.pid === pid) {
          callback(data.data);
        }
      });
    },
    
    onExit: (callback) => {
      api.onTerminalExit?.((data) => {
        if (data.pid === pid) {
          callback(data.exitCode);
        }
      });
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
```

## 七、构建配置

### 7.1 Electron Builder 配置

```json
// package.json
{
  "build": {
    "appId": "com.chatee.app",
    "productName": "Chatee",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "electron/dist/**/*"
    ],
    "mac": {
      "category": "public.app-category.productivity",
      "icon": "front/assets/app_logo_dark.png",
      "target": ["dmg", "zip"]
    },
    "win": {
      "icon": "front/assets/app_logo_dark.png",
      "target": ["nsis", "portable"]
    },
    "linux": {
      "icon": "front/assets/app_logo_dark.png",
      "target": ["AppImage", "deb"]
    }
  }
}
```

### 7.2 开发脚本

```json
// package.json scripts
{
  "scripts": {
    "dev": "concurrently \"npm run dev:vite\" \"npm run dev:electron\"",
    "dev:vite": "cd front && vite --port 5177",
    "dev:electron": "wait-on http://localhost:5177 && electron .",
    "build": "npm run build:vite && npm run build:electron",
    "build:vite": "cd front && vite build",
    "build:electron": "tsc -p electron/tsconfig.json",
    "package": "npm run build && electron-builder"
  }
}
```

## 八、安全考虑

### 8.1 Context Isolation
- 保持 `contextIsolation: true`
- 使用 `contextBridge` 安全暴露 API

### 8.2 Node Integration
- 保持 `nodeIntegration: false`
- 敏感操作只在 main process 执行

### 8.3 Web Security
- 保持 `webSecurity: true`
- 通过后端代理解决 CORS

### 8.4 API Key 安全
- API Key 存储在后端数据库
- 前端只通过后端 API 获取（需要时）
