/**
 * Electron预加载脚本
 * 在渲染进程中暴露安全的Electron API
 */

import { contextBridge, ipcRenderer } from 'electron';

// 暴露受保护的方法给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 下载功能已移除（工作流工具不需要）
  openFolder: (folderPath: string) => ipcRenderer.invoke('open-folder', folderPath),
  getFileInfo: (filePath: string) => ipcRenderer.invoke('get-file-info', filePath),
  listDirectory: (dirPath: string) => ipcRenderer.invoke('list-directory', dirPath),
  readFileAsDataUrl: (filePath: string) => ipcRenderer.invoke('read-file-as-data-url', filePath),
  
  // 终端相关 - PTY支持
  createTerminal: (cwd?: string) => 
    ipcRenderer.invoke('create-terminal', cwd),
  writeTerminal: (pid: number, data: string) => 
    ipcRenderer.invoke('write-terminal', pid, data),
  resizeTerminal: (pid: number, cols: number, rows: number) => 
    ipcRenderer.invoke('resize-terminal', pid, cols, rows),
  killTerminal: (pid: number) => 
    ipcRenderer.invoke('kill-terminal', pid),
  
  // 向后兼容的单命令执行
  executeCommand: (command: string, cwd?: string) => 
    ipcRenderer.invoke('execute-command', command, cwd),
  killCommand: (processId: number) => 
    ipcRenderer.invoke('kill-command', processId),
  
  // 下载任务更新监听已移除（工作流工具不需要）
  
  // 监听PTY终端数据
  onTerminalData: (callback: (data: { pid: number; data: string }) => void) => {
    ipcRenderer.on('terminal-data', (_, data) => callback(data));
  },
  
  // 监听PTY终端退出
  onTerminalExit: (callback: (data: { pid: number; exitCode: number; signal?: number }) => void) => {
    ipcRenderer.on('terminal-exit', (_, data) => callback(data));
  },
  
  // 向后兼容的终端输出监听
  onTerminalOutput: (callback: (data: { type: 'stdout' | 'stderr'; data: string }) => void) => {
    ipcRenderer.on('terminal-output', (_, data) => callback(data));
  },
  
  // 监听命令完成
  onCommandExit: (callback: (data: { processId: number; code: number | null }) => void) => {
    ipcRenderer.on('command-exit', (_, data) => callback(data));
  },
  
  // 移除监听器
  // removeDownloadTaskUpdatedListener已移除（工作流工具不需要）
  
  removeTerminalListeners: () => {
    ipcRenderer.removeAllListeners('terminal-output');
    ipcRenderer.removeAllListeners('command-exit');
  },
  
  // 开发者工具
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  openDevTools: () => ipcRenderer.invoke('open-devtools'),
  
  // MCP OAuth (通用)
  mcpOAuthAuthorize: (params: { authorizationUrl: string; windowTitle?: string }) => 
    ipcRenderer.invoke('mcp-oauth-authorize', params),
  
  // MCP OAuth (打开外部浏览器)
  mcpOAuthOpenExternal: (params: { authorizationUrl: string }) => 
    ipcRenderer.invoke('mcp-oauth-open-external', params),

  // ============================================================================
  // MCP Runner（stdio 本地进程）
  // ============================================================================

  mcpRunnerStart: (params: { serverId: string; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }) =>
    ipcRenderer.invoke('mcp-runner-start', params),
  mcpRunnerStop: (params: { serverId: string }) =>
    ipcRenderer.invoke('mcp-runner-stop', params),
  mcpRunnerListTools: (params: { serverId: string; forceRefresh?: boolean }) =>
    ipcRenderer.invoke('mcp-runner-list-tools', params),
  mcpRunnerCallTool: (params: { serverId: string; toolName: string; args: Record<string, any>; timeoutMs?: number }) =>
    ipcRenderer.invoke('mcp-runner-call-tool', params),
  
  // Notion OAuth (保留向后兼容)
  notionOAuthAuthorize: (authorizationUrl: string) => 
    ipcRenderer.invoke('notion-oauth-authorize', authorizationUrl),

  // Window controls (custom titlebar)
  toggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  
  // 后端地址配置
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
  setBackendUrl: (url: string) => ipcRenderer.invoke('set-backend-url', url),
  
  // ============================================================================
  // 扩展 API（新架构支持）
  // ============================================================================
  
  // 系统信息
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getPlatform: () => process.platform,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // 文件对话框
  showOpenDialog: (options: any) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options: any) => ipcRenderer.invoke('show-save-dialog', options),
  
  // 文件读写
  readFile: (filePath: string, encoding?: string) => 
    ipcRenderer.invoke('read-file', filePath, encoding),
  writeFile: (filePath: string, data: string | ArrayBuffer) => 
    ipcRenderer.invoke('write-file', filePath, data),
  
  // 媒体文件保存
  saveMediaFile: (params: { data: string; mimeType: string; defaultPath?: string; filename?: string }) => 
    ipcRenderer.invoke('save-media-file', params),
  
  // 剪贴板
  clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),
  clipboardWriteText: (text: string) => ipcRenderer.invoke('clipboard-write-text', text),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard-read-image'),
  clipboardWriteImage: (dataUrl: string) => ipcRenderer.invoke('clipboard-write-image', dataUrl),
  
  // 通知
  showNotification: (options: { title: string; body: string; icon?: string; silent?: boolean }) => 
    ipcRenderer.invoke('show-notification', options),
});

// 类型定义（供TypeScript使用）
export interface ElectronAPI {
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
  // MCP Runner（stdio）
  // ============================================================================
  mcpRunnerStart: (params: { serverId: string; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }) => Promise<{ success: boolean; error?: string }>;
  mcpRunnerStop: (params: { serverId: string }) => Promise<{ success: boolean; error?: string }>;
  mcpRunnerListTools: (params: { serverId: string; forceRefresh?: boolean }) => Promise<{ tools: any[] }>;
  mcpRunnerCallTool: (params: { serverId: string; toolName: string; args: Record<string, any>; timeoutMs?: number }) => Promise<{ result: any; isError?: boolean }>;
  
  // ============================================================================
  // 窗口控制
  // ============================================================================
  toggleMaximize: () => Promise<{ maximized: boolean }>;
  getBackendUrl: () => Promise<string>;
  setBackendUrl: (url: string) => Promise<void>;
  
  // ============================================================================
  // 后端配置
  
  // ============================================================================
  // 扩展 API（新架构支持）
  // ============================================================================
  
  // 系统信息
  getSystemInfo: () => Promise<{ platform: string; arch: string; version: string; hostname: string; userDataPath: string }>;
  getPlatform: () => string;
  getAppVersion: () => Promise<string>;
  
  // 文件对话框
  showOpenDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  
  // 文件读写
  readFile: (filePath: string, encoding?: string) => Promise<string | ArrayBuffer>;
  writeFile: (filePath: string, data: string | ArrayBuffer) => Promise<void>;
  
  // 媒体文件保存
  saveMediaFile: (params: {
    data: string;
    mimeType: string;
    defaultPath?: string;
    filename?: string;
  }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  
  // 剪贴板
  clipboardReadText: () => Promise<string>;
  clipboardWriteText: (text: string) => Promise<void>;
  clipboardReadImage: () => Promise<string | null>;
  clipboardWriteImage: (dataUrl: string) => Promise<void>;
  
  // 通知
  showNotification: (options: {
    title: string;
    body: string;
    icon?: string;
    silent?: boolean;
  }) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
