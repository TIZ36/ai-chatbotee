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
  
  // Notion OAuth (保留向后兼容)
  notionOAuthAuthorize: (authorizationUrl: string) => 
    ipcRenderer.invoke('notion-oauth-authorize', authorizationUrl),
});

// 类型定义（供TypeScript使用）
export interface ElectronAPI {
  // 下载相关API已移除（工作流工具不需要）
  openFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  getFileInfo: (filePath: string) => Promise<{ exists: boolean; size: number; isFile: boolean; mtime: number; error?: string }>;
  listDirectory: (dirPath: string) => Promise<{ success: boolean; files: Array<{ name: string; path: string; size: number; isFile: boolean; mtime: number }>; error?: string }>;
  createTerminal: (cwd?: string) => Promise<number>;
  writeTerminal: (pid: number, data: string) => Promise<void>;
  resizeTerminal: (pid: number, cols: number, rows: number) => Promise<void>;
  killTerminal: (pid: number) => Promise<void>;
  executeCommand: (command: string, cwd?: string) => Promise<number>;
  killCommand: (processId: number) => Promise<void>;
  // onDownloadTaskUpdated已移除（工作流工具不需要）
  onTerminalData: (callback: (data: { pid: number; data: string }) => void) => void;
  onTerminalExit: (callback: (data: { pid: number; exitCode: number; signal?: number }) => void) => void;
  onTerminalOutput: (callback: (data: { type: 'stdout' | 'stderr'; data: string }) => void) => void;
  onCommandExit: (callback: (data: { processId: number; code: number | null }) => void) => void;
  // removeDownloadTaskUpdatedListener已移除（工作流工具不需要）
  removeTerminalListeners: () => void;
  toggleDevTools: () => Promise<{ opened: boolean }>;
  openDevTools: () => Promise<{ success: boolean }>;
  mcpOAuthAuthorize: (params: { authorizationUrl: string; windowTitle?: string }) => Promise<{ code: string; state: string }>;
  mcpOAuthOpenExternal: (params: { authorizationUrl: string }) => Promise<{ success: boolean }>;
  notionOAuthAuthorize: (authorizationUrl: string) => Promise<{ code: string; state: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

