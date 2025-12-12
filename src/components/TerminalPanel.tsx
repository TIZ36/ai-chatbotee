/**
 * 完整的内嵌终端面板组件
 * 支持多终端标签、会话持久化、中文输入、LLM智能补全
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X, Trash2, Search, Palette, Plus, Brain, Check, ChevronDown, Edit3 } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import 'xterm/css/xterm.css';
import { useTerminal, TerminalSession, TAB_COLORS } from '../contexts/TerminalContext';
import { getLLMConfigs, getLLMConfigApiKey, LLMConfigFromDB } from '../services/llmApi';
import { LLMClient } from '../services/llmClient';

interface TerminalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialCommand?: string;
  autoExecute?: boolean;
  onStateChange?: (isMinimized: boolean, isMaximized: boolean) => void;
  onExecuteCommandReady?: (executeCommand: (command: string) => void) => void;
}

// 单个终端实例
interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  ptyPid: number | null;
  inputBuffer: string;
  outputBuffer: string[]; // 存储最近的终端输出行
}

// 终端智能补全的系统提示词
const TERMINAL_COMPLETION_SYSTEM_PROMPT = `你是一个智能终端补全助手。根据终端上下文和用户当前输入，预测并提供最可能的补全内容。

## 核心规则：

1. **只返回补全的剩余部分**，绝不重复用户已输入的内容
2. **纯文本输出**，不要有任何解释、引号、代码块或额外文字
3. 没有合适建议时返回空字符串
4. 补全必须是单行的

## 补全范围（不限于命令）：

- **文件/目录名**：从 ls、find、tree 等输出中提取
- **路径**：基于 pwd、cd 历史推断
- **Git 分支名**：从 git branch 输出中提取
- **进程名/PID**：从 ps、top 输出中提取
- **环境变量值**：从 env、echo $VAR 输出中提取
- **Docker 容器/镜像名**：从 docker ps、images 输出中提取
- **包名**：从 npm ls、pip list 输出中提取
- **IP/主机名**：从网络命令输出中提取
- **用户名**：从 /etc/passwd 或 who 输出中提取
- **任何终端中出现过的有意义的文本**

## 补全优先级：

1. 终端最近输出中出现的精确匹配内容（最高优先）
2. 当前命令语法的常见参数或值
3. 命令历史中的相似模式
4. 通用的 Shell 命令补全

## 示例：

终端显示: \`backend  src  README.md  package.json\`
- 输入 \`cat R\` → 返回 \`EADME.md\`
- 输入 \`cd s\` → 返回 \`rc\`
- 输入 \`cd b\` → 返回 \`ackend\`

终端显示: \`* main\n  feature/login\n  dev\`
- 输入 \`git checkout f\` → 返回 \`eature/login\`

终端显示: \`CONTAINER ID  IMAGE         STATUS\nabc123        nginx:latest  Up 2 hours\`
- 输入 \`docker exec -it a\` → 返回 \`bc123\`

请只返回补全文本，不要任何其他内容。`;

// 最大保存的终端输出行数
const MAX_OUTPUT_BUFFER_LINES = 50;

const TerminalPanel: React.FC<TerminalPanelProps> = ({ 
  isOpen, 
  onClose, 
  initialCommand,
  autoExecute = false,
  onStateChange,
  onExecuteCommandReady,
}) => {
  const {
    sessions,
    activeSessionId,
    addSession,
    removeSession,
    setActiveSession,
    renameSession,
    setSessionColor,
    setTerminalRef,
    addCommandToHistory,
    getRecentCommands,
    llmConfig,
    setLLMConfig,
    setPtyPid,
    getPtyPid,
  } = useTerminal();
  
  // 终端容器引用
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  
  // 终端实例映射 (sessionId -> instance)
  const terminalInstancesRef = useRef<Map<string, TerminalInstance>>(new Map());
  
  // UI 状态
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isLLMMenuOpen, setIsLLMMenuOpen] = useState(false);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  
  // 标签右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  
  // 重命名弹框状态
  const [renameDialog, setRenameDialog] = useState<{
    sessionId: string;
    name: string;
  } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 颜色选择弹框状态
  const [colorDialog, setColorDialog] = useState<{
    sessionId: string;
    currentColor: string | null;
  } | null>(null);

  // 弹框打开状态的 ref（用于在 useEffect 中检查）
  const isDialogOpenRef = useRef(false);
  
  // LLM 补全状态
  const [completionSuggestion, setCompletionSuggestion] = useState<string | null>(null);
  const [isCompletionLoading, setIsCompletionLoading] = useState(false);
  const completionRequestIdRef = useRef<number>(0); // 用于取消过时的请求
  
  // 光标位置状态（用于定位幽灵文本）- 使用视口坐标
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const ghostTextRef = useRef<HTMLDivElement>(null);
  
  // 请求时记录的光标位置（用于响应时比较）
  const requestCursorPosRef = useRef<{ charX: number; charY: number } | null>(null);
  
  // 生产者-消费者模式：补全任务队列（长度为1，新任务覆盖旧任务）
  const completionTaskRef = useRef<{
    input: string;
    sessionId: string;
    cursorPos: { charX: number; charY: number };
  } | null>(null);
  const producerTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const consumerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // 使用 ref 来保存最新的 llmConfig，避免闭包问题
  const llmConfigRef = useRef(llmConfig);
  const completionSuggestionRef = useRef(completionSuggestion);
  const llmConfigsRef = useRef(llmConfigs);
  const requestLLMCompletionRef = useRef<((currentInput: string, sessionId: string) => Promise<void>) | null>(null);
  
  const isElectronRef = useRef<boolean>(false);
  const shouldAutoScrollRef = useRef<boolean>(true);
  
  // 主题配置
  type ThemeName = 'classic' | 'vscode' | 'dracula' | 'solarized-dark' | 'solarized-light' | 'monokai';
  const [currentTheme, setCurrentTheme] = useState<ThemeName>('dracula');
  
  const themes: Record<ThemeName, any> = {
    classic: {
      background: '#000000',
      foreground: '#00ff00',
      cursor: '#00ff00',
      cursorAccent: '#000000',
      selection: '#333333',
      black: '#000000',
      red: '#ff0000',
      green: '#00ff00',
      yellow: '#ffff00',
      blue: '#0000ff',
      magenta: '#ff00ff',
      cyan: '#00ffff',
      white: '#ffffff',
      brightBlack: '#808080',
      brightRed: '#ff8080',
      brightGreen: '#80ff80',
      brightYellow: '#ffff80',
      brightBlue: '#8080ff',
      brightMagenta: '#ff80ff',
      brightCyan: '#80ffff',
      brightWhite: '#ffffff',
    },
    vscode: {
      background: '#1e1e1e',
      foreground: '#cccccc',
      cursor: '#aeafad',
      cursorAccent: '#000000',
      selection: '#264f78',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff',
    },
    dracula: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selection: '#44475a',
      black: '#000000',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#4d4d4d',
      brightRed: '#ff6e67',
      brightGreen: '#5af78e',
      brightYellow: '#f4f99d',
      brightBlue: '#caa9fa',
      brightMagenta: '#ff92d0',
      brightCyan: '#9aedfe',
      brightWhite: '#ffffff',
    },
    'solarized-dark': {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#839496',
      cursorAccent: '#002b36',
      selection: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
    'solarized-light': {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#657b83',
      cursorAccent: '#fdf6e3',
      selection: '#eee8d5',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3',
    },
    monokai: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#272822',
      selection: '#49483e',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f8f8f2',
    },
  };

  // 检查 Electron 环境
  useEffect(() => {
    isElectronRef.current = typeof window !== 'undefined' && 
      (window as any).electronAPI !== undefined;
  }, []);
  
  // 保持 llmConfig ref 同步
  useEffect(() => {
    llmConfigRef.current = llmConfig;
  }, [llmConfig]);
  
  // 保持 completionSuggestion ref 同步
  useEffect(() => {
    completionSuggestionRef.current = completionSuggestion;
  }, [completionSuggestion]);
  
  // 保持 llmConfigs ref 同步
  useEffect(() => {
    llmConfigsRef.current = llmConfigs;
  }, [llmConfigs]);
  
  // 加载 LLM 配置列表
  useEffect(() => {
    const loadLLMConfigs = async () => {
      try {
        const configs = await getLLMConfigs();
        setLlmConfigs(configs.filter(c => c.enabled));
      } catch (error) {
        console.error('Failed to load LLM configs:', error);
      }
    };
    loadLLMConfigs();
  }, []);
  
  // 如果没有会话，自动创建一个（使用 ref 防止重复创建）
  const hasCreatedInitialSession = useRef(false);
  useEffect(() => {
    if (sessions.length === 0 && !hasCreatedInitialSession.current) {
      hasCreatedInitialSession.current = true;
      addSession();
    }
  }, [sessions.length, addSession]);

  // 创建 PTY 终端
  const createPTYTerminal = useCallback(async (sessionId: string): Promise<number | null> => {
    if (!isElectronRef.current || !(window as any).electronAPI) {
      return null;
    }

    try {
      const pid = await (window as any).electronAPI.createTerminal();
      setPtyPid(sessionId, pid);

      // 监听 PTY 数据
      const dataHandler = (data: { pid: number; data: string }) => {
        const instance = terminalInstancesRef.current.get(sessionId);
        if (data.pid === pid && instance) {
          instance.terminal.write(data.data);
          
          // 捕获终端输出到缓冲区（用于 LLM 补全上下文）
          // 移除 ANSI 转义序列，按行分割
          const cleanOutput = data.data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
          const lines = cleanOutput.split(/\r?\n/);
          // 确保 outputBuffer 存在
          if (!instance.outputBuffer) {
            instance.outputBuffer = [];
          }
          for (const line of lines) {
            if (line.trim()) {
              instance.outputBuffer.push(line);
              // 保持缓冲区大小限制
              if (instance.outputBuffer.length > MAX_OUTPUT_BUFFER_LINES) {
                instance.outputBuffer.shift();
              }
            }
          }
          
          if (shouldAutoScrollRef.current) {
            setTimeout(() => {
              if (outputContainerRef.current) {
                outputContainerRef.current.scrollTop = outputContainerRef.current.scrollHeight;
              }
            }, 50);
          }
        }
      };

      const exitHandler = (data: { pid: number; exitCode: number }) => {
        if (data.pid === pid) {
          setPtyPid(sessionId, null);
          const instance = terminalInstancesRef.current.get(sessionId);
          if (instance) {
            instance.terminal.write('\r\n\x1b[31m[进程已退出]\x1b[0m\r\n');
          }
        }
      };

      (window as any).electronAPI.onTerminalData(dataHandler);
      (window as any).electronAPI.onTerminalExit(exitHandler);

      return pid;
    } catch (error) {
      console.error('Failed to create terminal:', error);
      return null;
    }
  }, [setPtyPid]);

  // 写入数据到 PTY
  const writeToPTY = useCallback((sessionId: string, data: string) => {
    const instance = terminalInstancesRef.current.get(sessionId);
    if (instance?.ptyPid && (window as any).electronAPI) {
      (window as any).electronAPI.writeTerminal(instance.ptyPid, data);
    }
  }, []);

  // LLM 补全请求
  const requestLLMCompletion = useCallback(async (currentInput: string, sessionId: string) => {
    // 前置检查 - 不需要设置 loading 状态
    if (!llmConfig.enabled || !llmConfig.configId || !currentInput.trim()) {
      setCompletionSuggestion(null);
      setIsCompletionLoading(false);
      return;
    }
    
    // 获取 LLM 配置
    const config = llmConfigs.find(c => c.config_id === llmConfig.configId);
    if (!config) {
      setCompletionSuggestion(null);
      setIsCompletionLoading(false);
      return;
    }
    
    // 记录请求时的光标位置
    const requestCursorPos = requestCursorPosRef.current;
    if (!requestCursorPos) {
      return;
    }
    
    // 生成新的请求 ID，用于取消过时的请求
    const requestId = ++completionRequestIdRef.current;
    
    setIsCompletionLoading(true);
    
    try {
      // 获取最近的命令历史作为上下文
      const recentCommands = getRecentCommands(20);
      
      // 获取终端输出作为上下文（取最后30行以获取更多文件名等信息）
      const instance = terminalInstancesRef.current.get(sessionId);
      const outputBuffer = instance?.outputBuffer || [];
      const terminalOutput = outputBuffer.slice(-30).join('\n');
      
      // 构建用户消息（包含上下文）
      const userPrompt = `## 终端输出（注意其中的文件名、目录名、分支名、容器ID等可补全内容）：
\`\`\`
${terminalOutput || '(无输出)'}
\`\`\`

## 命令历史：
${recentCommands.length > 0 ? recentCommands.slice(-10).map((cmd, i) => `${i + 1}. ${cmd}`).join('\n') : '(无历史)'}

## 当前输入：
\`${currentInput}\`

从终端输出中找到与当前输入匹配的内容进行补全。只返回补全部分：`;
      
      const apiKey = await getLLMConfigApiKey(llmConfig.configId);
      
      // 检查请求是否已过时
      if (requestId !== completionRequestIdRef.current) {
        return;
      }
      
      // 构造正确的 LLMConfig 对象
      const llmClient = new LLMClient({
        id: config.config_id,
        provider: config.provider as any,
        name: config.name,
        apiKey,
        apiUrl: config.api_url || undefined,
        model: config.model,
        enabled: config.enabled,
        metadata: config.metadata,
      });
      
      const response = await llmClient.chat([
        { role: 'system', content: TERMINAL_COMPLETION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]);
      
      // 再次检查请求是否已过时
      if (requestId !== completionRequestIdRef.current) {
        return;
      }
      
      const suggestion = response.content.trim();
      if (!suggestion || suggestion === '' || suggestion.includes('\n')) {
        setCompletionSuggestion(null);
        return;
      }
      
      // 获取当前终端实例，检查光标位置是否一致
      const terminal = instance?.terminal;
      if (!terminal) {
        console.log('[Completion] Terminal not found, discarding');
        setCompletionSuggestion(null);
        return;
      }
      
      const currentCharX = terminal.buffer.active.cursorX;
      const currentCharY = terminal.buffer.active.cursorY;
      
      // 比较光标位置
      if (currentCharX !== requestCursorPos.charX || currentCharY !== requestCursorPos.charY) {
        console.log('[Completion] Cursor moved, discarding suggestion:', {
          request: requestCursorPos,
          current: { charX: currentCharX, charY: currentCharY },
          suggestion
        });
        setCompletionSuggestion(null);
        return;
      }
      
      console.log('[Completion] Cursor position matched, showing suggestion:', suggestion);
      
      // 计算幽灵文本的显示位置（使用 fixed 定位，视口坐标）
      const termCore = (terminal as any)._core;
      const dimensions = termCore?._renderService?.dimensions;
      const cellWidth = dimensions?.css?.cell?.width || 9;
      const cellHeight = dimensions?.css?.cell?.height || 18;
      
      const screenElement = terminal.element?.querySelector('.xterm-screen');
      if (screenElement) {
        const screenRect = screenElement.getBoundingClientRect();
        const viewportY = terminal.buffer.active.viewportY;
        
        // 计算光标的视口坐标（光标右侧，+1 因为要显示在光标后面）
        setCursorPosition({
          x: screenRect.left + (currentCharX + 1) * cellWidth,
          y: screenRect.top + (currentCharY - viewportY) * cellHeight,
        });
      }
      
      setCompletionSuggestion(suggestion);
      
    } catch (error) {
      // 静默处理错误，不打断用户
      if (requestId === completionRequestIdRef.current) {
        setCompletionSuggestion(null);
      }
    } finally {
      // 只有最新的请求才更新 loading 状态
      if (requestId === completionRequestIdRef.current) {
        setIsCompletionLoading(false);
      }
    }
  }, [llmConfig, llmConfigs, getRecentCommands]);

  // 保持 requestLLMCompletion ref 同步
  useEffect(() => {
    requestLLMCompletionRef.current = requestLLMCompletion;
  }, [requestLLMCompletion]);

  // 消费者：每 0.5s 尝试消费一个补全任务
  useEffect(() => {
    consumerIntervalRef.current = setInterval(() => {
      const task = completionTaskRef.current;
      if (task && requestLLMCompletionRef.current) {
        // 消费任务
        completionTaskRef.current = null;
        
        // 记录请求时的光标位置
        requestCursorPosRef.current = task.cursorPos;
        
        console.log('[Consumer] Processing task:', task.input, 'at cursor:', task.cursorPos);
        
        // 执行补全请求
        requestLLMCompletionRef.current(task.input, task.sessionId);
      }
    }, 1500); // 每 1.5s 消费一次
    
    return () => {
      if (consumerIntervalRef.current) {
        clearInterval(consumerIntervalRef.current);
      }
    };
  }, []);

  // 初始化终端实例
  const initializeTerminal = useCallback((sessionId: string, containerElement: HTMLDivElement) => {
    // 检查是否已存在
    if (terminalInstancesRef.current.has(sessionId)) {
      return terminalInstancesRef.current.get(sessionId)!;
    }
    
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", "Cascadia Code", monospace',
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      letterSpacing: 0,
      lineHeight: 1.2,
      scrollback: 5000,
      tabStopWidth: 4,
      theme: themes[currentTheme],
      allowProposedApi: true,
      allowTransparency: false,
      convertEol: false,
      disableStdin: false,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    const unicode11Addon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

    terminal.open(containerElement);

    const instance: TerminalInstance = {
      terminal,
      fitAddon,
      searchAddon,
      ptyPid: null,
      inputBuffer: '',
      outputBuffer: [], // 初始化输出缓冲区
    };

    terminalInstancesRef.current.set(sessionId, instance);

    // 同步终端大小到 PTY 的函数
    const syncTerminalSize = () => {
      if (instance.ptyPid && isElectronRef.current && (window as any).electronAPI) {
        const cols = terminal.cols;
        const rows = terminal.rows;
        (window as any).electronAPI.resizeTerminal(instance.ptyPid, cols, rows);
        console.log('[Terminal] Synced size to PTY:', { cols, rows });
      }
    };

    // 延迟 fit 并同步大小
    setTimeout(() => {
      try {
        fitAddon.fit();
        syncTerminalSize();
      } catch (error) {
        console.error('Failed to fit terminal:', error);
      }
    }, 100);

    // 监听终端大小变化
    terminal.onResize(({ cols, rows }) => {
      if (instance.ptyPid && isElectronRef.current && (window as any).electronAPI) {
        (window as any).electronAPI.resizeTerminal(instance.ptyPid, cols, rows);
        console.log('[Terminal] Resized PTY:', { cols, rows });
      }
    });

    // 监听窗口大小变化
    const handleWindowResize = () => {
      try {
        fitAddon.fit();
        // onResize 事件会自动触发同步
      } catch (error) {
        console.error('Failed to fit on resize:', error);
      }
    };
    window.addEventListener('resize', handleWindowResize);

    // 创建 PTY
    if (isElectronRef.current) {
      createPTYTerminal(sessionId).then((pid) => {
        if (pid) {
          instance.ptyPid = pid;
          
          // 立即同步终端大小
          setTimeout(() => {
            syncTerminalSize();
          }, 50);
          
          // 设置 executeCommand 回调
          const executeCommand = (command: string) => {
            writeToPTY(sessionId, command + '\r');
            addCommandToHistory(command, sessionId);
          };
          
          setTerminalRef({ executeCommand }, sessionId);
          
          if (onExecuteCommandReady && sessionId === activeSessionId) {
            onExecuteCommandReady(executeCommand);
          }
          
          // 自动执行初始命令
          if (initialCommand && autoExecute) {
            setTimeout(() => {
              writeToPTY(sessionId, initialCommand + '\r');
            }, 100);
          }
        }
      });
    } else {
      terminal.writeln('\x1b[31m警告: 此功能需要在Electron环境中运行\x1b[0m');
    }

    // 处理终端输入
    let inputBuffer = '';
    
    terminal.onData((data: string) => {
      // 使用 ref 获取最新的值（避免闭包问题）
      const currentSuggestion = completionSuggestionRef.current;
      const currentLlmConfig = llmConfigRef.current;
      
      // Tab 键处理 - LLM 补全确认
      if (data === '\t' && currentSuggestion) {
        // 应用补全建议
        writeToPTY(sessionId, currentSuggestion);
        inputBuffer += currentSuggestion;
        setCompletionSuggestion(null);
        setCursorPosition(null);
        return;
      }
      
      // Tab 键 - 没有补全建议时发送到 shell
      if (data === '\t') {
        writeToPTY(sessionId, '\t');
        return;
      }
      
      // 清除之前的生产者定时器
      if (producerTimeoutRef.current) {
        clearTimeout(producerTimeoutRef.current);
      }
      
      // 递增请求 ID，使任何正在进行的请求失效
      completionRequestIdRef.current++;
      
      // 输入时清除之前的建议和加载状态
      setCompletionSuggestion(null);
      setCursorPosition(null);
      setIsCompletionLoading(false);
      
      // 清空任务队列
      completionTaskRef.current = null;
      
      // 记录输入到缓冲区
      if (data.length === 1 && data >= ' ') {
        inputBuffer += data;
        instance.inputBuffer = inputBuffer;
      } else if (data === '\r' || data === '\n') {
        // Enter 键 - 保存命令历史并清空缓冲区
        const command = inputBuffer.trim();
        if (command) {
          addCommandToHistory(command, sessionId);
        }
        inputBuffer = '';
        shouldAutoScrollRef.current = true;
        // Enter 后不触发补全
        writeToPTY(sessionId, data);
        return;
      } else if (data === '\x7f' || data === '\b') {
        // 退格键
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
        }
      } else if (data === '\x1b') {
        // Escape 键 - 取消补全，不触发新的补全
        writeToPTY(sessionId, data);
        return;
      }
      
      // 发送到 PTY
      writeToPTY(sessionId, data);
      
      // 生产者：输入后 0.3s 将任务入队（队列长度为1，新任务覆盖旧任务）
      if (currentLlmConfig.enabled && currentLlmConfig.configId && inputBuffer.trim()) {
        const bufferSnapshot = inputBuffer;
        producerTimeoutRef.current = setTimeout(() => {
          // 记录光标位置并入队
          const charX = terminal.buffer.active.cursorX;
          const charY = terminal.buffer.active.cursorY;
          
          // 新任务入队（覆盖旧任务）
          completionTaskRef.current = {
            input: bufferSnapshot,
            sessionId,
            cursorPos: { charX, charY },
          };
          
          console.log('[Producer] Task queued:', bufferSnapshot, 'at cursor:', { charX, charY });
        }, 800); // 0.8s 后入队
      }
    });

    // 聚焦（只有在没有弹框打开时）
    setTimeout(() => {
      if (!isDialogOpenRef.current) {
        terminal.focus();
      }
    }, 200);

    return instance;
  }, [
    currentTheme, themes, createPTYTerminal, writeToPTY, 
    setTerminalRef, addCommandToHistory, onExecuteCommandReady,
    activeSessionId, initialCommand, autoExecute
    // llmConfig, completionSuggestion, requestLLMCompletion 现在通过 ref 访问，避免闭包问题
  ]);

  // 切换活动会话时更新终端显示
  useEffect(() => {
    if (!activeSessionId || !terminalContainerRef.current) return;
    
    // 隐藏所有终端
    terminalInstancesRef.current.forEach((instance, id) => {
      if (instance.terminal.element) {
        instance.terminal.element.style.display = id === activeSessionId ? 'block' : 'none';
      }
    });
    
    // 获取或创建活动终端
    let instance = terminalInstancesRef.current.get(activeSessionId);
    if (!instance) {
      instance = initializeTerminal(activeSessionId, terminalContainerRef.current);
    }
    
    // 显示并聚焦
    if (instance.terminal.element) {
      instance.terminal.element.style.display = 'block';
      setTimeout(() => {
        instance!.fitAddon.fit();
        // 只有在没有弹框打开时才聚焦终端
        if (!isDialogOpenRef.current) {
          instance!.terminal.focus();
        }
        // 同步终端大小到 PTY（对 TUI 应用如 k9s, vim 很重要）
        if (instance!.ptyPid && isElectronRef.current && (window as any).electronAPI) {
          const cols = instance!.terminal.cols;
          const rows = instance!.terminal.rows;
          (window as any).electronAPI.resizeTerminal(instance!.ptyPid, cols, rows);
        }
      }, 100);
    }
  }, [activeSessionId, initializeTerminal]);

  // 切换主题
  const changeTheme = useCallback((themeName: ThemeName) => {
    setCurrentTheme(themeName);
    setIsThemeMenuOpen(false);
    
    // 更新所有终端的主题
    terminalInstancesRef.current.forEach((instance) => {
      instance.terminal.options.theme = themes[themeName];
    });
    
    if (terminalContainerRef.current) {
      terminalContainerRef.current.style.backgroundColor = themes[themeName].background;
    }
  }, [themes]);

  // 清空终端
  const handleClear = useCallback(() => {
    if (!activeSessionId) return;
    const instance = terminalInstancesRef.current.get(activeSessionId);
    if (instance) {
      instance.terminal.clear();
    }
  }, [activeSessionId]);

  // 搜索功能
  const handleSearch = useCallback(() => {
    if (!activeSessionId || !searchTerm) return;
    const instance = terminalInstancesRef.current.get(activeSessionId);
    if (instance) {
      instance.searchAddon.findNext(searchTerm);
    }
  }, [activeSessionId, searchTerm]);

  // 关闭会话
  const handleCloseSession = useCallback((sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    
    // 清理终端实例
    const instance = terminalInstancesRef.current.get(sessionId);
    if (instance) {
      if (instance.ptyPid && (window as any).electronAPI) {
        (window as any).electronAPI.killTerminal(instance.ptyPid);
      }
      instance.terminal.dispose();
      terminalInstancesRef.current.delete(sessionId);
    }
    
    removeSession(sessionId);
  }, [removeSession]);

  // 打开重命名弹框
  const openRenameDialog = useCallback((sessionId: string, currentName: string) => {
    setRenameDialog({ sessionId, name: currentName });
  }, []);

  // 保存重命名
  const handleSaveRename = useCallback(() => {
    if (renameDialog && renameDialog.name.trim()) {
      renameSession(renameDialog.sessionId, renameDialog.name.trim());
    }
    setRenameDialog(null);
  }, [renameDialog, renameSession]);

  // 当打开重命名弹框时聚焦输入框
  useEffect(() => {
    if (renameDialog && renameInputRef.current) {
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
  }, [renameDialog]);

  // 追踪弹框状态，用于阻止终端获取焦点
  useEffect(() => {
    isDialogOpenRef.current = !!(renameDialog || colorDialog || contextMenu);
  }, [renameDialog, colorDialog, contextMenu]);

  // 打开颜色选择弹框
  const openColorDialog = useCallback((sessionId: string, currentColor: string | null) => {
    setColorDialog({ sessionId, currentColor });
  }, []);

  // 选择颜色并关闭弹框
  const handleSelectColor = useCallback((color: string | null) => {
    if (colorDialog) {
      setSessionColor(colorDialog.sessionId, color);
    }
    setColorDialog(null);
  }, [colorDialog, setSessionColor]);

  // 处理快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      if (e.key === 'Escape') {
        if (isSearchOpen) {
          setIsSearchOpen(false);
          setSearchTerm('');
        }
        if (isThemeMenuOpen) setIsThemeMenuOpen(false);
        if (isLLMMenuOpen) setIsLLMMenuOpen(false);
        if (completionSuggestion) setCompletionSuggestion(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, isThemeMenuOpen, isLLMMenuOpen, completionSuggestion]);

  // 获取当前选中的 LLM 配置名称
  const selectedLLMName = useMemo(() => {
    if (!llmConfig.enabled || !llmConfig.configId) return null;
    const config = llmConfigs.find(c => c.config_id === llmConfig.configId);
    return config?.name || config?.model || '未知模型';
  }, [llmConfig, llmConfigs]);

  return (
    <div className="flex-shrink-0 bg-gray-950 flex flex-col w-full h-full transition-all duration-300 border-l border-gray-800 overflow-visible relative">
      {/* 标签栏 */}
      <div className="flex items-center bg-gray-900/80 backdrop-blur-md border-b border-gray-800 flex-shrink-0 relative z-20 overflow-visible">
        {/* 终端标签 */}
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-hide px-2 py-1 gap-1">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            
            return (
              <div
                key={session.id}
                onClick={() => setActiveSession(session.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openRenameDialog(session.id, session.name);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ sessionId: session.id, x: e.clientX, y: e.clientY });
                }}
                className={`
                  group flex items-center gap-2 px-3 py-1.5 rounded-t-lg cursor-pointer min-w-[100px] max-w-[180px]
                  transition-all duration-200 relative
                  ${isActive 
                    ? 'bg-gray-950 text-white border-t border-l border-r border-gray-700 -mb-px' 
                    : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                  }
                `}
                style={session.color ? { borderTopColor: session.color, borderTopWidth: '2px' } : undefined}
              >
                {/* 颜色指示器 */}
                {session.color && (
                  <div 
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: session.color }}
                  />
                )}
                
                <span className="flex-1 text-sm truncate">{session.name}</span>
                
                {/* 颜色选择器按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openColorDialog(session.id, session.color);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-gray-700 rounded transition-all"
                  title="更改颜色"
                >
                  <Palette className="w-3 h-3" />
                </button>
                
                {/* 关闭按钮 */}
                {sessions.length > 1 && (
                  <button
                    onClick={(e) => handleCloseSession(session.id, e)}
                    className="w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-gray-700 rounded transition-all"
                    title="关闭终端"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          
          {/* 新建标签按钮 */}
          <button
            onClick={() => addSession()}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all ml-1"
            title="新建终端 (点击添加)"
          >
            <Plus className="w-4 h-4" />
            <span className="sr-only">新建</span>
          </button>
        </div>
        
        {/* 工具栏 */}
        <div className="flex items-center space-x-1 px-2 relative z-30">
          {/* LLM 补全开关 */}
          <div className="relative">
            <button
              onClick={() => setIsLLMMenuOpen(!isLLMMenuOpen)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-all ${
                llmConfig.enabled 
                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' 
                  : 'text-gray-400 hover:text-white hover:bg-white/10'
              }`}
              title="LLM 智能补全"
            >
              <Brain className="w-4 h-4" />
              {llmConfig.enabled && selectedLLMName && (
                <span className="hidden sm:inline max-w-[80px] truncate">{selectedLLMName}</span>
              )}
              <ChevronDown className="w-3 h-3" />
            </button>
            
            {isLLMMenuOpen && (
              <div className="absolute right-0 top-full mt-2 bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl border border-gray-700 py-2 z-50 min-w-[200px]">
                {/* 启用/禁用开关 */}
                <button
                  onClick={() => {
                    setLLMConfig({ ...llmConfig, enabled: !llmConfig.enabled });
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors flex items-center justify-between"
                >
                  <span className={llmConfig.enabled ? 'text-white' : 'text-gray-400'}>
                    启用智能补全
                  </span>
                  {llmConfig.enabled && <Check className="w-4 h-4 text-[var(--color-accent)]" />}
                </button>
                
                <div className="border-t border-gray-700 my-1" />
                
                {/* LLM 模型选择 */}
                <div className="px-4 py-1 text-xs text-gray-500">选择模型</div>
                {llmConfigs.length === 0 ? (
                  <div className="px-4 py-2 text-sm text-gray-500">暂无可用模型</div>
                ) : (
                  llmConfigs.map((config) => (
                    <button
                      key={config.config_id}
                      onClick={() => {
                        setLLMConfig({ enabled: true, configId: config.config_id });
                        setIsLLMMenuOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors flex items-center justify-between ${
                        llmConfig.configId === config.config_id ? 'bg-white/10' : ''
                      }`}
                    >
                      <span className={llmConfig.configId === config.config_id ? 'text-white' : 'text-gray-400'}>
                        {config.name || config.model}
                      </span>
                      {llmConfig.configId === config.config_id && (
                        <Check className="w-4 h-4 text-[var(--color-accent)]" />
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          
          {/* 主题切换 */}
          <div className="relative">
            <button
              onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
              title="切换主题"
            >
              <Palette className="w-4 h-4" />
            </button>
            {isThemeMenuOpen && (
              <div className="absolute right-0 top-full mt-2 bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl border border-gray-700 py-2 z-50 min-w-[160px]">
                {Object.keys(themes).map((themeName) => (
                  <button
                    key={themeName}
                    onClick={() => changeTheme(themeName as ThemeName)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${
                      currentTheme === themeName ? 'bg-white/10 text-white' : 'text-gray-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="capitalize">{themeName.replace('-', ' ')}</span>
                      {currentTheme === themeName && <Check className="w-4 h-4 text-[var(--color-accent)]" />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* 搜索 */}
          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className={`p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all ${
              isSearchOpen ? 'bg-white/10 text-white' : ''
            }`}
            title="搜索 (Cmd/Ctrl+F)"
          >
            <Search className="w-4 h-4" />
          </button>
          
          {/* 清空 */}
          <button
            onClick={handleClear}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all"
            title="清空终端"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      {isSearchOpen && (
        <div className="px-4 py-3 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
                if (e.key === 'Escape') {
                  setIsSearchOpen(false);
                  setSearchTerm('');
                }
              }}
              placeholder="在终端中搜索..."
              className="flex-1 bg-transparent text-gray-200 text-sm placeholder-gray-600 focus:outline-none"
              autoFocus
            />
            <button
              onClick={handleSearch}
              className="px-3 py-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-xs font-medium rounded-lg transition-all"
            >
              查找
            </button>
            <button
              onClick={() => {
                setIsSearchOpen(false);
                setSearchTerm('');
              }}
              className="p-1.5 text-gray-500 hover:text-gray-300 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* LLM 补全加载提示 - 小型浮动提示 */}
      {isCompletionLoading && !completionSuggestion && (
        <div className="pointer-events-none absolute bottom-4 right-4 z-10 px-2 py-1 bg-gray-800/90 rounded text-xs text-gray-400 flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
          <span>补全中...</span>
        </div>
      )}

      {/* 终端内容区域 */}
      <div className="flex flex-1 min-h-0 bg-gray-950 relative">
        <div className="w-full flex flex-col min-w-0">
          <div
            ref={outputContainerRef}
            className="flex-1 overflow-y-auto min-h-0 scrollbar-thin relative"
            style={{
              padding: '16px',
              scrollBehavior: 'smooth',
            }}
            onScroll={(e) => {
              const target = e.target as HTMLDivElement;
              const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 10;
              shouldAutoScrollRef.current = isAtBottom;
            }}
          >
            <div
              ref={terminalContainerRef}
              className="w-full terminal-container relative"
              style={{ 
                height: '100%',
                minHeight: '200px',
                backgroundColor: themes[currentTheme].background,
              }}
            >
              {/* 幽灵文本补全建议 - 显示在光标后面 */}
              {completionSuggestion && cursorPosition && (
                <div
                  ref={ghostTextRef}
                  className="pointer-events-none font-mono whitespace-pre select-none"
                  style={{
                    position: 'fixed', // 使用 fixed 定位避免相对定位问题
                    left: `${cursorPosition.x}px`,
                    top: `${cursorPosition.y}px`,
                    zIndex: 9999,
                    color: 'rgba(156, 163, 175, 0.6)',
                    fontSize: '14px',
                    lineHeight: '18px',
                    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                    textShadow: '0 0 1px rgba(0,0,0,0.5)',
                  }}
                >
                  {completionSuggestion}
                  <span style={{ color: 'rgba(107, 114, 128, 0.5)', fontSize: '10px', marginLeft: '3px' }}>Tab</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          className="fixed bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              const session = sessions.find(s => s.id === contextMenu.sessionId);
              if (session) {
                openRenameDialog(contextMenu.sessionId, session.name);
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            <Edit3 className="w-4 h-4" />
            重命名
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const session = sessions.find(s => s.id === contextMenu.sessionId);
              if (session) {
                openColorDialog(contextMenu.sessionId, session.color);
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
          >
            <Palette className="w-4 h-4" />
            更改颜色
          </button>
          {sessions.length > 1 && (
            <>
              <div className="border-t border-gray-700 my-1" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseSession(contextMenu.sessionId);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-gray-700 transition-colors"
              >
                <X className="w-4 h-4" />
                关闭
              </button>
            </>
          )}
        </div>
      )}
      
      {/* 点击外部关闭右键菜单 */}
      {contextMenu && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setContextMenu(null)}
        />
      )}

      {/* 重命名弹框 */}
      {renameDialog && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-50"
            onClick={() => setRenameDialog(null)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-4 z-50 min-w-[300px]">
            <div className="text-sm text-gray-300 mb-3">重命名终端</div>
            <input
              ref={renameInputRef}
              type="text"
              value={renameDialog.name}
              onChange={(e) => setRenameDialog({ ...renameDialog, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveRename();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenameDialog(null);
                }
              }}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-md text-white text-sm outline-none focus:border-blue-500 transition-colors"
              placeholder="输入终端名称..."
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRenameDialog(null)}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-300 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveRename}
                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </>
      )}

      {/* 颜色选择弹框 */}
      {colorDialog && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-50"
            onClick={() => setColorDialog(null)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-4 z-50 min-w-[280px]">
            <div className="text-sm text-gray-300 mb-3">选择终端颜色</div>
            <div className="grid grid-cols-5 gap-2">
              {TAB_COLORS.map((color) => (
                <button
                  key={color.name}
                  onClick={() => handleSelectColor(color.value)}
                  className={`w-10 h-10 rounded-lg border-2 transition-all hover:scale-110 flex items-center justify-center ${
                    colorDialog.currentColor === color.value ? 'border-white ring-2 ring-blue-500' : 'border-transparent hover:border-gray-500'
                  }`}
                  style={{ 
                    backgroundColor: color.value || '#374151',
                  }}
                  title={color.name}
                >
                  {colorDialog.currentColor === color.value && (
                    <svg className="w-5 h-5 text-white drop-shadow-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setColorDialog(null)}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-300 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TerminalPanel;
