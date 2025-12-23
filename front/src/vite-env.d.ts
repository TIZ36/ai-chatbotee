/// <reference types="vite/client" />

interface ElectronAPI {
  // 终端相关
  createTerminal: (cwd?: string) => Promise<number>;
  writeTerminal: (pid: number, data: string) => Promise<void>;
  resizeTerminal: (pid: number, cols: number, rows: number) => Promise<void>;
  killTerminal: (pid: number) => Promise<void>;
  executeCommand: (command: string, cwd?: string) => Promise<number>;
  killCommand: (processId: number) => Promise<void>;
  // 文件操作
  openFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  getFileInfo: (filePath: string) => Promise<{ exists: boolean; size: number; isFile: boolean; mtime: number; error?: string }>;
  listDirectory: (dirPath: string) => Promise<{ success: boolean; files: Array<{ name: string; path: string; size: number; isFile: boolean; mtime: number }>; error?: string }>;
  // 事件监听
  onTerminalData: (callback: (data: { pid: number; data: string }) => void) => void;
  onTerminalExit: (callback: (data: { pid: number; exitCode: number; signal?: number }) => void) => void;
  onTerminalOutput: (callback: (data: { type: 'stdout' | 'stderr'; data: string }) => void) => void;
  onCommandExit: (callback: (data: { processId: number; code: number | null }) => void) => void;
  removeTerminalListeners: () => void;
  // OAuth相关
  mcpOAuthAuthorize: (params: { authorizationUrl: string; windowTitle?: string }) => Promise<{ code: string; state: string }>;
  mcpOAuthOpenExternal: (params: { authorizationUrl: string }) => Promise<{ success: boolean }>;
  notionOAuthAuthorize: (authorizationUrl: string) => Promise<{ code: string; state: string }>;
  // 开发者工具
  toggleDevTools: () => Promise<{ opened: boolean }>;
  openDevTools: () => Promise<{ success: boolean }>;
  // 窗口控制
  toggleMaximize: () => Promise<{ maximized: boolean }>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
/// <reference types="vite/client" />

interface ElectronAPI {
  // ============================================================================
  // 文件系统（基础）
  // ============================================================================
  openFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  getFileInfo: (filePath: string) => Promise<{ exists: boolean; size: number; isFile: boolean; mtime: number; error?: string }>;
  listDirectory: (dirPath: string) => Promise<{ success: boolean; files: Array<{ name: string; path: string; size: number; isFile: boolean; mtime: number }>; error?: string }>;
  readFileAsDataUrl: (filePath: string) => Promise<string>;
  
  // ============================================================================
  // 终端（PTY）
  // ============================================================================
  createTerminal: (cwd?: string) => Promise<number>;
  writeTerminal: (pid: number, data: string) => Promise<void>;
  resizeTerminal: (pid: number, cols: number, rows: number) => Promise<void>;
  killTerminal: (pid: number) => Promise<void>;
  executeCommand: (command: string, cwd?: string) => Promise<number>;
  killCommand: (processId: number) => Promise<void>;
  onTerminalData: (callback: (data: { pid: number; data: string }) => void) => void;
  onTerminalExit: (callback: (data: { pid: number; exitCode: number; signal?: number }) => void) => void;
  onTerminalOutput: (callback: (data: { type: 'stdout' | 'stderr'; data: string }) => void) => void;
  onCommandExit: (callback: (data: { processId: number; code: number | null }) => void) => void;
  removeTerminalListeners: () => void;
  
  // ============================================================================
  // 开发者工具
  // ============================================================================
  toggleDevTools: () => Promise<{ opened: boolean }>;
  openDevTools: () => Promise<{ success: boolean }>;
  
  // ============================================================================
  // OAuth
  // ============================================================================
  mcpOAuthAuthorize: (params: { authorizationUrl: string; windowTitle?: string }) => Promise<{ code: string; state: string }>;
  mcpOAuthOpenExternal: (params: { authorizationUrl: string }) => Promise<{ success: boolean }>;
  notionOAuthAuthorize: (authorizationUrl: string) => Promise<{ code: string; state: string }>;
  
  // ============================================================================
  // 窗口控制
  // ============================================================================
  toggleMaximize: () => Promise<{ maximized: boolean }>;
  
  // ============================================================================
  // 后端配置
  // ============================================================================
  getBackendUrl: () => Promise<string>;
  setBackendUrl: (url: string) => Promise<void>;
  
  // ============================================================================
  // 扩展 API（新架构支持）
  // ============================================================================
  
  // 系统信息
  getSystemInfo?: () => Promise<{ platform: string; arch: string; version: string; hostname: string; userDataPath: string }>;
  getPlatform?: () => string;
  getAppVersion?: () => Promise<string>;
  
  // 文件对话框
  showOpenDialog?: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog?: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  
  // 文件读写
  readFile?: (filePath: string, encoding?: string) => Promise<string | ArrayBuffer>;
  writeFile?: (filePath: string, data: string | ArrayBuffer) => Promise<void>;
  
  // 媒体文件保存
  saveMediaFile?: (params: {
    data: string;
    mimeType: string;
    defaultPath?: string;
    filename?: string;
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  
  // 剪贴板
  clipboardReadText?: () => Promise<string>;
  clipboardWriteText?: (text: string) => Promise<void>;
  clipboardReadImage?: () => Promise<string | null>;
  clipboardWriteImage?: (dataUrl: string) => Promise<void>;
  
  // 通知
  showNotification?: (options: {
    title: string;
    body: string;
    icon?: string;
    silent?: boolean;
  }) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
