/**
 * Electron主进程
 * 负责窗口管理、下载功能、终端集成等
 */

import { app, BrowserWindow, ipcMain, shell, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as pty from 'node-pty';

// ============================================================================
// MCP Runner（stdio 本地进程）- 运行时管理
// ============================================================================

type StdioRunnerState = {
  serverId: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  client: any | null;
  transport: any | null;
  startedAt: number;
  toolsCache?: any[];
  toolsCacheAt?: number;
};

const stdioRunners: Map<string, StdioRunnerState> = new Map();

async function loadMcpClientSdk(): Promise<{ Client: any; StdioTransport: any }> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  // 不同版本 SDK 的导出路径可能不同：做兼容探测
  const candidates = [
    '@modelcontextprotocol/sdk/client/stdio.js',
    '@modelcontextprotocol/sdk/client/stdio/index.js',
    '@modelcontextprotocol/sdk/client/stdio',
  ];
  let StdioTransport: any = null;
  for (const c of candidates) {
    try {
      const mod: any = await import(c);
      StdioTransport = mod.StdioClientTransport || mod.StdioTransport || mod.default || null;
      if (StdioTransport) break;
    } catch {
      // try next
    }
  }
  if (!StdioTransport) {
    throw new Error('Failed to load MCP stdio client transport from @modelcontextprotocol/sdk');
  }
  return { Client, StdioTransport };
}

async function ensureRunnerStarted(params: { serverId: string; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }) {
  const serverId = params.serverId;
  const existing = stdioRunners.get(serverId);
  if (existing && existing.client) {
    return existing;
  }

  const command = params.command;
  const args = params.args || [];
  const env = params.env || {};

  const { Client, StdioTransport } = await loadMcpClientSdk();

  const transport = new StdioTransport({
    command,
    args,
    env: { ...process.env, ...env },
    cwd: params.cwd,
  });

  const client = new Client(
    { name: 'chatee-electron', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  await client.connect(transport);

  const state: StdioRunnerState = {
    serverId,
    command,
    args,
    env,
    cwd: params.cwd,
    client,
    transport,
    startedAt: Date.now(),
  };
  stdioRunners.set(serverId, state);

  return state;
}

async function stopRunner(serverId: string) {
  const state = stdioRunners.get(serverId);
  if (!state) return;
  try {
    if (state.client) {
      await state.client.close();
    }
  } catch {
    // ignore
  }
  try {
    if (state.transport?.close) {
      await state.transport.close();
    }
  } catch {
    // ignore
  }
  stdioRunners.delete(serverId);
}

// 配置存储路径
const CONFIG_FILE = path.join(app.getPath('userData'), 'backend-config.json');

// 读取后端地址配置
function getBackendUrlConfig(): string {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return config.backendUrl || 'http://localhost:3002';
    }
  } catch (error) {
    console.error('[Config] Error reading config:', error);
  }
  return 'http://localhost:3002';
}

// 保存后端地址配置
function setBackendUrlConfig(url: string): void {
  try {
    const config = {
      backendUrl: url || 'http://localhost:3002',
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[Config] Backend URL saved:', url);
  } catch (error) {
    console.error('[Config] Error saving config:', error);
  }
}

// 下载任务管理（已移除，工作流工具不需要）
/*
interface DownloadTask {
  taskId: string;
  videoId: string;
  videoUrl: string;
  quality: string;
  format: string;
  status: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  speed?: string;
  eta?: string;
  size?: string;
  process?: ChildProcess;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
}

class DownloadManager extends EventEmitter {
  private tasks: Map<string, DownloadTask> = new Map();
  private downloadDir: string;

  constructor() {
    super();
    // 设置下载目录为应用目录下的downloads文件夹
    this.downloadDir = path.join(app.getPath('userData'), 'downloads');
    this.ensureDownloadDir();
  }

  private ensureDownloadDir() {
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  getDownloadDir(): string {
    return this.downloadDir;
  }

  createTask(videoId: string, videoUrl: string, quality: string, format: string): string {
    const taskId = `task_${Date.now()}_${videoId}`;
    const task: DownloadTask = {
      taskId,
      videoId,
      videoUrl,
      quality,
      format,
      status: 'queued',
      progress: 0,
    };
    this.tasks.set(taskId, task);
    this.emit('task-created', task);
    return taskId;
  }

  async startDownload(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = 'downloading';
    this.emit('task-updated', task);

    try {
      const command = this.buildYtDlpCommand(task);
      const downloadProcess = spawn('yt-dlp', command, {
        cwd: this.downloadDir,
        shell: true,
      });

      task.process = downloadProcess;

      let stdout = '';
      let stderr = '';

      downloadProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
        this.parseProgress(task, data.toString());
      });

      downloadProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
        this.parseProgress(task, data.toString());
      });

      downloadProcess.on('close', (code) => {
        if (code === 0) {
          task.status = 'completed';
          this.findDownloadedFile(task);
        } else {
          task.status = 'failed';
          task.error = stderr || 'Download failed';
        }
        this.emit('task-updated', task);
      });

      downloadProcess.on('error', (error) => {
        task.status = 'failed';
        task.error = error.message;
        this.emit('task-updated', task);
      });

    } catch (error: any) {
      task.status = 'failed';
      task.error = error.message;
      this.emit('task-updated', task);
    }
  }

  private buildYtDlpCommand(task: DownloadTask): string[] {
    const options: string[] = [
      '--no-playlist',
      '--progress',
      '--newline',
      '--no-warnings',
    ];

    // MP3格式特殊处理
    if (task.format === 'mp3') {
      options.push('-x', '--audio-format', 'mp3');
      const qualityMap: { [key: string]: string } = {
        highest: '0',
        high: '192K',
        medium: '128K',
        low: '64K',
      };
      options.push('--audio-quality', qualityMap[task.quality] || '0');
    } else {
      // 视频格式
      const formatMap: { [key: string]: string } = {
        mp4: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best',
        webm: 'bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo[ext=webm]+bestaudio/best[ext=webm]/best',
        best: 'best',
      };
      const formatOption = formatMap[task.format] || 'best';
      options.push('-f', formatOption);
    }

    // 输出模板
    const outputTemplate = path.join(this.downloadDir, '%(title)s.%(ext)s');
    options.push('-o', outputTemplate);

    // 视频URL
    options.push(task.videoUrl);

    return options;
  }

  private parseProgress(task: DownloadTask, output: string) {
    // 解析yt-dlp进度输出
    const lines = output.split('\n');
    for (const line of lines) {
      // 匹配进度: [download] 12.5% of 100.00MiB at 1.23MiB/s ETA 00:45
      const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (progressMatch) {
        task.progress = parseFloat(progressMatch[1]);
      }

      const speedMatch = line.match(/at\s+([\d.]+[KMGT]?i?B\/s)/);
      if (speedMatch) {
        task.speed = speedMatch[1];
      }

      const etaMatch = line.match(/ETA\s+(\d+:\d+)/);
      if (etaMatch) {
        task.eta = etaMatch[1];
      }
    }
    this.emit('task-updated', task);
  }

  private findDownloadedFile(task: DownloadTask) {
    const files = fs.readdirSync(this.downloadDir);
    // 查找最近修改的文件
    const fileStats = files
      .map((file) => ({
        name: file,
        path: path.join(this.downloadDir, file),
        stats: fs.statSync(path.join(this.downloadDir, file)),
      }))
      .filter((f) => f.stats.isFile())
      .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);

    if (fileStats.length > 0) {
      const latestFile = fileStats[0];
      task.filePath = latestFile.path;
      task.fileName = latestFile.name;
      task.fileSize = latestFile.stats.size;
    }
  }

  pauseTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task?.process && task.process.pid) {
      if (process.platform === 'win32') {
        // Windows: 使用taskkill
        spawn('taskkill', ['/PID', task.process.pid.toString(), '/T', '/F']);
      } else {
        // Unix: 发送SIGSTOP
        task.process.kill('SIGSTOP');
      }
      task.status = 'paused';
      this.emit('task-updated', task);
    }
  }

  resumeTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task?.process && task.process.pid) {
      if (process.platform === 'win32') {
        // Windows需要重新启动进程
        this.startDownload(taskId);
      } else {
        // Unix: 发送SIGCONT
        task.process.kill('SIGCONT');
        task.status = 'downloading';
        this.emit('task-updated', task);
      }
    }
  }

  deleteTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      if (task.process) {
        task.process.kill();
      }
      if (task.filePath && fs.existsSync(task.filePath)) {
        fs.unlinkSync(task.filePath);
      }
      this.tasks.delete(taskId);
      this.emit('task-deleted', taskId);
    }
  }

  getTasks(): DownloadTask[] {
    return Array.from(this.tasks.values());
  }

  getTask(taskId: string): DownloadTask | undefined {
    return this.tasks.get(taskId);
  }
}
*/

// 下载管理器已移除（工作流工具不需要）
// const downloadManager = new DownloadManager();

// 创建主窗口
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // 获取主显示器的工作区域尺寸
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  // 计算窗口大小（屏幕的90%）
  const windowWidth = Math.floor(screenWidth * 0.9);
  const windowHeight = Math.floor(screenHeight * 0.9);
  
  // 计算居中位置
  const x = Math.floor((screenWidth - windowWidth) / 2);
  const y = Math.floor((screenHeight - windowHeight) / 2);
  
  const isDarwin = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  
  // 设置应用图标路径
  // 在开发环境中，__dirname 指向 electron/dist，需要向上两级到项目根目录
  // 在生产环境中，图标应该在应用资源目录中
  let iconPath: string | undefined;
  const devIconPath = path.join(__dirname, '../../front/assets/app_logo_dark.png');
  const prodIconPath = path.join(process.resourcesPath || __dirname, 'assets/app_logo_dark.png');
  
  if (fs.existsSync(devIconPath)) {
    iconPath = devIconPath;
  } else if (fs.existsSync(prodIconPath)) {
    iconPath = prodIconPath;
  }
  
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    minWidth: 1200,
    minHeight: 800,
    icon: iconPath, // 设置窗口图标
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    // macOS：使用系统红黄绿按钮，并将 Web 内容延伸到标题栏（方便自定义顶部工具条）
    titleBarStyle: isDarwin ? 'hiddenInset' : 'default',
    // macOS：微调红黄绿按钮位置，让顶部工具条对齐更舒服
    trafficLightPosition: isDarwin ? { x: 12, y: 10 } : undefined,
    // Windows：使用 titleBarOverlay 让自绘顶部栏更自然
    titleBarOverlay: isWin
      ? {
          color: '#18181b',
          symbolColor: '#b0b0b0',
          height: 36,
        }
      : undefined,
    // 统一使用系统 frame（macOS 需要红黄绿按钮）
    frame: true,
    show: true, // 立即显示窗口
  });

  console.log(`Window created: ${windowWidth}x${windowHeight} at (${x}, ${y})`);
  
  // 确保窗口显示并聚焦
  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      // macOS 特定：确保窗口在最前面
      if (process.platform === 'darwin' && mainWindow) {
        app.dock?.show();
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        mainWindow.setAlwaysOnTop(true);
        setTimeout(() => {
          if (mainWindow) {
            mainWindow.setAlwaysOnTop(false);
          }
        }, 100);
      }
    }
  });
  
  // 如果 ready-to-show 事件没有触发，延迟显示窗口
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('Window not visible, forcing show...');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1000);

  // 开发环境加载Vite开发服务器，生产环境加载构建后的文件
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    // 开发模式：加载Vite开发服务器
    const viteUrl = 'http://localhost:5177'; // 工作流工具端口
    console.log(`Loading Vite dev server: ${viteUrl}`);
    
    mainWindow.loadURL(viteUrl).catch((err) => {
      console.error('Failed to load Vite dev server:', err);
      // 如果Vite服务器未启动，显示错误页面
      mainWindow?.loadURL(`data:text/html;charset=utf-8,
        <html>
          <head><title>Vite Server Not Running</title></head>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1>Vite开发服务器未运行</h1>
            <p>请先启动Vite开发服务器：</p>
            <pre style="background: #f5f5f5; padding: 20px; border-radius: 5px; display: inline-block;">
npm run dev:vite
            </pre>
            <p style="margin-top: 20px;">或者运行：</p>
            <pre style="background: #f5f5f5; padding: 20px; border-radius: 5px; display: inline-block;">
./start-electron.sh
            </pre>
          </body>
        </html>
      `);
    });
    
    // 开发模式下自动打开开发者工具
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('Page loaded successfully');
      // 开发模式下打开开发者工具以便调试
      if (isDev) {
        mainWindow?.webContents.openDevTools();
      }
    });
  } else {
    // 生产模式：加载构建后的文件
    const indexPath = path.join(__dirname, '../dist/index.html');
    console.log(`Loading production build: ${indexPath}`);
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('Failed to load production build:', err);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 监听页面加载错误
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Page load failed:', errorCode, errorDescription);
  });
}

// IPC处理程序 - 下载管理（已移除，工作流工具不需要）
/*
ipcMain.handle('get-download-dir', () => {
  return downloadManager.getDownloadDir();
});

ipcMain.handle('create-download-task', async (_, videoId: string, videoUrl: string, quality: string, format: string) => {
  const taskId = downloadManager.createTask(videoId, videoUrl, quality, format);
  await downloadManager.startDownload(taskId);
  return taskId;
});

ipcMain.handle('get-download-tasks', () => {
  return downloadManager.getTasks();
});

ipcMain.handle('get-download-task', (_, taskId: string) => {
  return downloadManager.getTask(taskId);
});

ipcMain.handle('pause-download-task', (_, taskId: string) => {
  downloadManager.pauseTask(taskId);
});

ipcMain.handle('resume-download-task', (_, taskId: string) => {
  downloadManager.resumeTask(taskId);
});

ipcMain.handle('delete-download-task', (_, taskId: string) => {
  downloadManager.deleteTask(taskId);
});

ipcMain.handle('open-download-folder', () => {
  shell.openPath(downloadManager.getDownloadDir());
});
*/

// 打开指定文件夹
ipcMain.handle('open-folder', async (_, folderPath: string) => {
  try {
    await shell.openPath(folderPath);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

// 获取文件信息（大小、是否存在）
ipcMain.handle('get-file-info', async (_, filePath: string) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      exists: true,
      size: stats.size,
      isFile: stats.isFile(),
      mtime: stats.mtimeMs,
    };
  } catch (error: any) {
    return {
      exists: false,
      size: 0,
      isFile: false,
      error: error.message,
    };
  }
});

// 列出目录中的文件
ipcMain.handle('list-directory', async (_, dirPath: string) => {
  try {
    const files = fs.readdirSync(dirPath);
    const fileInfos = files.map(file => {
      const fullPath = path.join(dirPath, file);
      const stats = fs.statSync(fullPath);
      return {
        name: file,
        path: fullPath,
        size: stats.size,
        isFile: stats.isFile(),
        mtime: stats.mtimeMs,
      };
    });
    // 按修改时间排序，最新的在前
    fileInfos.sort((a, b) => b.mtime - a.mtime);
    return { success: true, files: fileInfos };
  } catch (error: any) {
    return { success: false, error: error.message, files: [] };
  }
});

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.bmp':
      return 'image/bmp';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

// 读取本地文件并返回 data URL（用于在 webSecurity=true 时加载本地图片）
ipcMain.handle('read-file-as-data-url', async (_, filePath: string) => {
  const MAX_BYTES = 25 * 1024 * 1024; // 25MB 上限，避免大文件拖垮渲染进程
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      throw new Error('Path is not a file');
    }
    if (stats.size > MAX_BYTES) {
      throw new Error(`File too large: ${stats.size} bytes`);
    }
    const mime = guessMimeType(filePath);
    const buf = fs.readFileSync(filePath);
    const base64 = buf.toString('base64');
    return `data:${mime};base64,${base64}`;
  } catch (error: any) {
    console.error('[File] read-file-as-data-url failed:', filePath, error);
    throw error;
  }
});

// 终端进程管理 - PTY支持
interface TerminalSession {
  pty: pty.IPty;
  pid: number;
}

const terminalSessions = new Map<number, TerminalSession>();
const terminalProcesses = new Map<number, ChildProcess>(); // 向后兼容

// 监听下载任务更新事件（已移除，工作流工具不需要）
/*
downloadManager.on('task-updated', (task: DownloadTask) => {
  if (mainWindow) {
    mainWindow.webContents.send('download-task-updated', task);
  }
});
*/

// IPC处理程序 - 终端命令执行
ipcMain.handle('execute-command', async (_, command: string, cwd?: string) => {
  return new Promise<number>((resolve, reject) => {
    try {
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
      const shellArgs = process.platform === 'win32' ? ['/c'] : ['-c'];
      
      const processOptions: any = {
        shell: true,
        cwd: cwd || process.cwd(),
      };
      
      const childProcess = spawn(shell, [...shellArgs, command], processOptions);
      
      if (!childProcess.pid) {
        reject(new Error('Failed to start process'));
        return;
      }
      
      terminalProcesses.set(childProcess.pid, childProcess);
      
      // 发送stdout输出
      childProcess.stdout?.on('data', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('terminal-output', {
            processId: childProcess.pid,
            type: 'stdout',
            data: data.toString(),
          });
        }
      });
      
      // 发送stderr输出
      childProcess.stderr?.on('data', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('terminal-output', {
            processId: childProcess.pid,
            type: 'stderr',
            data: data.toString(),
          });
        }
      });
      
      // 进程退出
      childProcess.on('exit', (code) => {
        terminalProcesses.delete(childProcess.pid!);
        if (mainWindow) {
          mainWindow.webContents.send('command-exit', {
            processId: childProcess.pid,
            code,
          });
        }
      });
      
      // 进程错误
      childProcess.on('error', (error) => {
        terminalProcesses.delete(childProcess.pid!);
        if (mainWindow) {
          mainWindow.webContents.send('terminal-output', {
            processId: childProcess.pid,
            type: 'stderr',
            data: `Error: ${error.message}\n`,
          });
        }
        reject(error);
      });
      
      resolve(childProcess.pid);
    } catch (error: any) {
      reject(error);
    }
  });
});

ipcMain.handle('kill-command', async (_, processId: number) => {
  // 先尝试PTY会话
  const session = terminalSessions.get(processId);
  if (session) {
    try {
      session.pty.kill();
      terminalSessions.delete(processId);
      return;
    } catch (error) {
      console.error('Failed to kill PTY session:', error);
    }
  }
  
  // 向后兼容：尝试普通进程
  const childProcess = terminalProcesses.get(processId);
  if (childProcess && childProcess.pid) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', childProcess.pid.toString(), '/T', '/F']);
      } else {
        childProcess.kill('SIGTERM');
      }
      terminalProcesses.delete(processId);
    } catch (error) {
      console.error('Failed to kill process:', error);
    }
  }
});

// IPC处理程序 - 创建PTY终端会话
ipcMain.handle('create-terminal', async (_, cwd?: string) => {
  try {
    const shell = process.platform === 'win32' 
      ? process.env.COMSPEC || 'cmd.exe'
      : process.env.SHELL || '/bin/zsh';
    
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || process.cwd() || process.env.HOME || '/',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const session: TerminalSession = {
      pty: ptyProcess,
      pid: ptyProcess.pid,
    };

    terminalSessions.set(ptyProcess.pid, session);

    // 监听PTY输出
    ptyProcess.onData((data) => {
      if (mainWindow) {
        mainWindow.webContents.send('terminal-data', {
          pid: ptyProcess.pid,
          data,
        });
      }
    });

    // 监听PTY退出
    ptyProcess.onExit(({ exitCode, signal }) => {
      terminalSessions.delete(ptyProcess.pid);
      if (mainWindow) {
        mainWindow.webContents.send('terminal-exit', {
          pid: ptyProcess.pid,
          exitCode,
          signal,
        });
      }
    });

    return ptyProcess.pid;
  } catch (error: any) {
    console.error('Failed to create terminal:', error);
    throw error;
  }
});

// IPC处理程序 - 写入数据到PTY
ipcMain.handle('write-terminal', async (_, pid: number, data: string) => {
  const session = terminalSessions.get(pid);
  if (session) {
    session.pty.write(data);
  }
});

// IPC处理程序 - 调整PTY大小
ipcMain.handle('resize-terminal', async (_, pid: number, cols: number, rows: number) => {
  const session = terminalSessions.get(pid);
  if (session) {
    session.pty.resize(cols, rows);
  }
});

// IPC处理程序 - 终止PTY进程
ipcMain.handle('kill-terminal', async (_, pid: number) => {
  const session = terminalSessions.get(pid);
  if (session) {
    try {
      session.pty.kill();
      terminalSessions.delete(pid);
    } catch (error) {
      console.error('Failed to kill terminal:', error);
    }
  }
});

// ============================================================================
// 扩展 IPC 处理程序（新架构支持）
// ============================================================================

// 系统信息
ipcMain.handle('get-system-info', async () => {
  const os = require('os');
  return {
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
    hostname: os.hostname(),
    userDataPath: app.getPath('userData'),
  };
});

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

// 文件对话框
ipcMain.handle('show-open-dialog', async (_, options: any) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow!, options);
  return result;
});

ipcMain.handle('show-save-dialog', async (_, options: any) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow!, options);
  return result;
});

// 文件读写
ipcMain.handle('read-file', async (_, filePath: string, encoding?: string) => {
  return fs.readFileSync(filePath, encoding as BufferEncoding);
});

ipcMain.handle('write-file', async (_, filePath: string, data: string | Buffer) => {
  fs.writeFileSync(filePath, data);
});

// 媒体文件保存
ipcMain.handle('save-media-file', async (_, params: { data: string; mimeType: string; defaultPath?: string; filename?: string }) => {
  const { dialog } = require('electron');
  
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
    
    let savePath: string;
    if (defaultPath) {
      // 确保目录存在
      if (!fs.existsSync(defaultPath)) {
        fs.mkdirSync(defaultPath, { recursive: true });
      }
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

// 剪贴板
ipcMain.handle('clipboard-read-text', () => {
  const { clipboard } = require('electron');
  return clipboard.readText();
});

ipcMain.handle('clipboard-write-text', (_, text: string) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
});

ipcMain.handle('clipboard-read-image', () => {
  const { clipboard } = require('electron');
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  return image.toDataURL();
});

ipcMain.handle('clipboard-write-image', (_, dataUrl: string) => {
  const { clipboard, nativeImage } = require('electron');
  const image = nativeImage.createFromDataURL(dataUrl);
  clipboard.writeImage(image);
});

// 通知
ipcMain.handle('show-notification', async (_, options: { title: string; body: string; icon?: string; silent?: boolean }) => {
  const { Notification } = require('electron');
  const notification = new Notification(options);
  notification.show();
});

// ============================================================================
// IPC处理程序 - 后端地址配置
// ============================================================================

ipcMain.handle('get-backend-url', async () => {
  return getBackendUrlConfig();
});

ipcMain.handle('set-backend-url', async (_, url: string) => {
  setBackendUrlConfig(url);
});

// ============================================================================
// IPC处理程序 - 开发者工具
// ============================================================================

ipcMain.handle('toggle-devtools', async () => {
  if (mainWindow) {
    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
      return { opened: false };
    } else {
      mainWindow.webContents.openDevTools();
      return { opened: true };
    }
  }
  return { opened: false };
});

ipcMain.handle('open-devtools', async () => {
  if (mainWindow) {
    mainWindow.webContents.openDevTools();
    return { success: true };
  }
  return { success: false };
});

// IPC处理程序 - 窗口控制（用于自定义拖拽区双击最大化）
ipcMain.handle('window-toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!win) return { maximized: false };
  if (win.isMaximized()) {
    win.unmaximize();
    return { maximized: false };
  }
  win.maximize();
  return { maximized: true };
});

// IPC处理程序 - 通用 MCP OAuth 授权
ipcMain.handle('mcp-oauth-authorize', async (_, params: { authorizationUrl: string; windowTitle?: string }) => {
  const { authorizationUrl, windowTitle = 'MCP Authorization' } = params;
  
  return new Promise<{ code: string; state: string }>((resolve, reject) => {
    console.log('[MCP OAuth] Opening authorization window:', authorizationUrl);
    console.log('[MCP OAuth] Window title:', windowTitle);
    
    // 创建OAuth授权窗口
    const authWindow = new BrowserWindow({
      width: 600,
      height: 700,
      show: true,
      modal: true,
      parent: mainWindow || undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
      title: windowTitle,
    });

    // 加载授权URL
    authWindow.loadURL(authorizationUrl);

    // 监听窗口关闭
    authWindow.on('closed', () => {
      console.log('[MCP OAuth] Authorization window closed by user');
      reject(new Error('Authorization cancelled by user'));
    });

    // 监听URL变化，捕获回调
    authWindow.webContents.on('will-redirect', (event: any, navigationUrl: string) => {
      console.log('[MCP OAuth] Will redirect to:', navigationUrl);
      
      // 如果是后端回调 URL，阻止默认加载并手动处理
      if (navigationUrl.includes('/mcp/oauth/callback/')) {
        console.log('[MCP OAuth] Preventing default redirect, will handle manually');
        event.preventDefault();
      }
      
      handleOAuthCallback(navigationUrl, authWindow, resolve, reject);
    });

    // 监听导航事件
    authWindow.webContents.on('will-navigate', (event: any, navigationUrl: string) => {
      console.log('[MCP OAuth] Will navigate to:', navigationUrl);
      
      // 如果是后端回调 URL，阻止默认加载并手动处理
      if (navigationUrl.includes('/mcp/oauth/callback/')) {
        console.log('[MCP OAuth] Preventing default navigation, will handle manually');
        event.preventDefault();
      }
      
      handleOAuthCallback(navigationUrl, authWindow, resolve, reject);
    });

    // 监听导航完成
    authWindow.webContents.on('did-finish-load', () => {
      const currentUrl = authWindow.webContents.getURL();
      console.log('[MCP OAuth] Page loaded:', currentUrl);
      
      // 检查是否是后端回调地址（新格式：/mcp/oauth/callback/{oauth_session_id}）
      if (currentUrl.includes('/mcp/oauth/callback/')) {
        console.log('[MCP OAuth] Detected backend callback URL');
        handleOAuthCallback(currentUrl, authWindow, resolve, reject);
      } else if (currentUrl.includes('code=') || currentUrl.includes('error=')) {
        // 直接 OAuth 回调（非后端代理）
        handleOAuthCallback(currentUrl, authWindow, resolve, reject);
      }
    });
  });
});

// 处理OAuth回调（通用）
function handleOAuthCallback(
  url: string,
  authWindow: BrowserWindow,
  resolve: (value: { code: string; state: string }) => void,
  reject: (error: Error) => void
) {
  try {
    console.log('[MCP OAuth] Handling callback URL:', url);
    
    // 解析URL参数
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');
    const error = urlObj.searchParams.get('error');
    const errorDescription = urlObj.searchParams.get('error_description');

    // 检查是否是后端回调地址（新格式：/mcp/oauth/callback/{oauth_session_id}）
    const isBackendCallback = url.includes('/mcp/oauth/callback/');
    
    if (isBackendCallback) {
      console.log('[MCP OAuth] Backend callback detected');
      
      // 检查是否有错误
      if (error) {
        console.error('[MCP OAuth] Authorization error:', error, errorDescription);
        // 延迟关闭，让用户看到错误页面
        setTimeout(() => {
          authWindow.close();
        }, 2000);
        reject(new Error(errorDescription || error));
        return;
      }

      // 检查是否有授权码（需要手动转发到后端）
      if (code) {
        console.log('[MCP OAuth] Authorization code received, forwarding to backend');
        console.log('[MCP OAuth] Code:', code.substring(0, 20) + '...');
        console.log('[MCP OAuth] State:', state || 'none');
        console.log('[MCP OAuth] Callback URL:', url);
        
        // 手动向后端发送 GET 请求，让后端处理 token 交换
        const https = require('https');
        const http = require('http');
        
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;
        
        console.log('[MCP OAuth] Sending request to backend:', url);
        
        protocol.get(url, (res: any) => {
          let data = '';
          
          res.on('data', (chunk: any) => {
            data += chunk;
          });
          
          res.on('end', () => {
            console.log('[MCP OAuth] Backend response status:', res.statusCode);
            console.log('[MCP OAuth] Backend response length:', data.length);
            
            if (res.statusCode === 200) {
              console.log('[MCP OAuth] ✅ Token exchange successful');
              
              // 延迟关闭，让用户看到成功页面
              setTimeout(() => {
                authWindow.close();
                resolve({ code, state: state || '' });
              }, 1500);
            } else {
              console.error('[MCP OAuth] ❌ Token exchange failed:', res.statusCode);
              // 即使失败也要关闭窗口
              setTimeout(() => {
                authWindow.close();
                reject(new Error(`Token exchange failed: ${res.statusCode}`));
              }, 2000);
            }
          });
        }).on('error', (err: any) => {
          console.error('[MCP OAuth] ❌ Error sending request to backend:', err);
          authWindow.close();
          reject(err);
        });
        
        return;
      } else {
        // 后端回调页面已加载，但没有 code/state（可能是成功页面）
        // 检查页面标题或内容来判断是否成功
        authWindow.webContents.executeJavaScript(`
          document.title.includes('成功') || 
          document.title.includes('success') ||
          document.title.includes('OAuth') ||
          document.body.innerText.includes('成功') || 
          document.body.innerText.includes('success') ||
          document.body.innerText.includes('Access token')
        `).then((isSuccess: boolean) => {
          if (isSuccess) {
            console.log('[MCP OAuth] Success page detected, closing window');
            // 立即关闭窗口
            authWindow.close();
            // 返回空的 code 和 state，前端会创建服务器配置
            resolve({ code: '', state: '' });
          } else {
            console.log('[MCP OAuth] Backend callback page loaded, waiting for parameters...');
            // 如果页面加载完成但没有检测到成功，可能是重定向中
            // 等待一下再检查
            setTimeout(() => {
              const currentUrl = authWindow.webContents.getURL();
              if (currentUrl.includes('/mcp/oauth/callback') && !currentUrl.includes('code=')) {
                // 可能是成功页面，尝试关闭
                console.log('[MCP OAuth] Assuming success after timeout, closing window');
                authWindow.close();
                resolve({ code: '', state: '' });
              }
            }, 2000);
          }
        }).catch((err) => {
          console.log('[MCP OAuth] Could not check page content:', err);
          // 如果检查失败，假设成功并关闭窗口
          setTimeout(() => {
            authWindow.close();
            resolve({ code: '', state: '' });
          }, 1500);
        });
        return;
      }
    }

    // 直接 OAuth 回调（非后端代理）
    // 检查是否有错误
    if (error) {
      console.error('[MCP OAuth] Authorization error:', error, errorDescription);
      authWindow.close();
      reject(new Error(errorDescription || error));
      return;
    }

    // 检查是否有授权码
    if (code && state) {
      console.log('[MCP OAuth] Authorization code received');
      console.log('[MCP OAuth] Code:', code.substring(0, 20) + '...');
      console.log('[MCP OAuth] State:', state);
      
      // 关闭授权窗口
      authWindow.close();
      
      // 返回授权码和state
      resolve({ code, state });
    } else {
      // URL不包含回调参数，继续等待
      console.log('[MCP OAuth] URL does not contain callback parameters yet');
    }
  } catch (error: any) {
    console.error('[MCP OAuth] Error handling callback:', error);
    authWindow.close();
    reject(error);
  }
}

// IPC处理程序 - 打开系统外部浏览器进行OAuth认证
ipcMain.handle('mcp-oauth-open-external', async (_, params: { authorizationUrl: string }) => {
  const { authorizationUrl } = params;
  console.log('[MCP OAuth] Opening external browser for authorization:', authorizationUrl);
  
  try {
    // 使用 shell.openExternal 打开系统默认浏览器
    await shell.openExternal(authorizationUrl);
    console.log('[MCP OAuth] ✅ External browser opened successfully');
    return { success: true };
  } catch (error: any) {
    console.error('[MCP OAuth] ❌ Failed to open external browser:', error);
    throw error;
  }
});

// ============================================================================
// IPC处理程序 - MCP Runner（stdio 本地进程）
// ============================================================================

ipcMain.handle(
  'mcp-runner-start',
  async (_, params: { serverId: string; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }) => {
    try {
      await ensureRunnerStarted(params);
      return { success: true };
    } catch (error: any) {
      console.error('[MCP Runner] start failed:', error);
      return { success: false, error: error?.message || String(error) };
    }
  }
);

ipcMain.handle('mcp-runner-stop', async (_, params: { serverId: string }) => {
  try {
    await stopRunner(params.serverId);
    return { success: true };
  } catch (error: any) {
    console.error('[MCP Runner] stop failed:', error);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('mcp-runner-list-tools', async (_, params: { serverId: string; forceRefresh?: boolean }) => {
  const state = stdioRunners.get(params.serverId);
  if (!state || !state.client) {
    throw new Error(`Runner not started for serverId=${params.serverId}`);
  }

  const ttlMs = 5 * 60 * 1000;
  const now = Date.now();
  if (!params.forceRefresh && state.toolsCache && state.toolsCacheAt && now - state.toolsCacheAt < ttlMs) {
    return { tools: state.toolsCache };
  }

  const result = await state.client.listTools();
  const tools = result?.tools || [];
  state.toolsCache = tools;
  state.toolsCacheAt = now;
  return { tools };
});

ipcMain.handle(
  'mcp-runner-call-tool',
  async (
    _,
    params: { serverId: string; toolName: string; args: Record<string, any>; timeoutMs?: number }
  ) => {
    const state = stdioRunners.get(params.serverId);
    if (!state || !state.client) {
      throw new Error(`Runner not started for serverId=${params.serverId}`);
    }

    const timeoutMs = params.timeoutMs || 60000;
    const callPromise = state.client.callTool({ name: params.toolName, arguments: params.args });
    const result = await Promise.race([
      callPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tool call timeout')), timeoutMs)),
    ]);

    return { result: result?.content ?? result, isError: !!result?.isError };
  }
);

// IPC处理程序 - Notion OAuth 授权（保留向后兼容，调用通用处理函数）
ipcMain.handle('notion-oauth-authorize', async (_, authorizationUrl: string) => {
  // 直接调用通用的 MCP OAuth 处理逻辑
  return new Promise<{ code: string; state: string }>((resolve, reject) => {
    console.log('[Notion OAuth] Opening authorization window:', authorizationUrl);
    
    const authWindow = new BrowserWindow({
      width: 600,
      height: 700,
      show: true,
      modal: true,
      parent: mainWindow || undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
      title: 'Notion Authorization',
    });

    authWindow.loadURL(authorizationUrl);

    authWindow.on('closed', () => {
      console.log('[Notion OAuth] Authorization window closed by user');
      reject(new Error('Authorization cancelled by user'));
    });

    authWindow.webContents.on('will-redirect', (event: any, navigationUrl: string) => {
      handleOAuthCallback(navigationUrl, authWindow, resolve, reject);
    });

    authWindow.webContents.on('will-navigate', (event: any, navigationUrl: string) => {
      handleOAuthCallback(navigationUrl, authWindow, resolve, reject);
    });

    authWindow.webContents.on('did-finish-load', () => {
      const currentUrl = authWindow.webContents.getURL();
      if (currentUrl.includes('code=') || currentUrl.includes('error=')) {
        handleOAuthCallback(currentUrl, authWindow, resolve, reject);
      }
    });
  });
});

// 应用生命周期
app.whenReady().then(() => {
  console.log('Electron app ready, creating window...');
  console.log('App is packaged:', app.isPackaged);
  console.log('NODE_ENV:', process.env.NODE_ENV);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      console.log('No windows found, creating new window...');
      createWindow();
    }
  });
}).catch((error) => {
  console.error('Failed to start Electron app:', error);
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
