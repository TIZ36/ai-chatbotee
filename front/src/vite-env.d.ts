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
