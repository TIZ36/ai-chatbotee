/**
 * 完整的内嵌终端面板组件
 * 使用PTY实现，支持所有bash/zsh命令和交互式程序
 * UI设计：传统终端输入方式，用户直接在终端内输入命令
 * 功能：支持主题换肤、搜索、清空等操作
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Trash2, Search, Folder, Palette } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import 'xterm/css/xterm.css';

interface TerminalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialCommand?: string;
  autoExecute?: boolean;
  onStateChange?: (isMinimized: boolean, isMaximized: boolean) => void;
  onExecuteCommandReady?: (executeCommand: (command: string) => void) => void;
  // 项目管理相关props
  currentProject?: any;
  onProjectSelect?: (project: any) => void;
  onSearchRecordSelect?: (record: any) => void;
  onNewSearch?: () => void;
  onProjectUpdate?: (project: any) => void;
}

const TerminalPanel: React.FC<TerminalPanelProps> = ({ 
  isOpen, 
  onClose, 
  initialCommand,
  autoExecute = false,
  onStateChange,
  onExecuteCommandReady,
  currentProject,
  onProjectSelect,
  onSearchRecordSelect,
  onNewSearch,
  onProjectUpdate,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const ptyPidRef = useRef<number | null>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [currentDir, setCurrentDir] = useState<string>('');
  const [gitInfo, setGitInfo] = useState<string>('');
  const shouldAutoScrollRef = useRef<boolean>(false); // 是否应该自动滚动
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const isElectronRef = useRef<boolean>(false);
  
  // 主题管理
  type ThemeName = 'classic' | 'vscode' | 'dracula' | 'solarized-dark' | 'solarized-light' | 'monokai';
  const [currentTheme, setCurrentTheme] = useState<ThemeName>('classic');
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  
  // 主题配置
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

  // 检查是否在Electron环境中
  useEffect(() => {
    isElectronRef.current = typeof window !== 'undefined' && 
      (window as any).electronAPI !== undefined;
  }, []);

  // 滚动到顶部
  const scrollToTop = useCallback(() => {
    if (outputContainerRef.current) {
      const container = outputContainerRef.current;
      requestAnimationFrame(() => {
        container.scrollTop = 0;
      });
    }
  }, []);

  // 自动滚动到底部（仅在应该滚动时）
  const scrollToBottom = useCallback(() => {
    if (outputContainerRef.current && shouldAutoScrollRef.current) {
      const container = outputContainerRef.current;
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, []);

  // 获取当前目录和git信息
  const updatePromptInfo = useCallback(async () => {
    if (!isElectronRef.current || !(window as any).electronAPI) {
      return;
    }

    try {
      // 尝试使用executeCommand方法（如果存在）
      if ((window as any).electronAPI.executeCommand) {
        // 获取当前目录
        const pwdResult = await (window as any).electronAPI.executeCommand('pwd');
        if (pwdResult && pwdResult.stdout) {
          const dir = pwdResult.stdout.trim();
          setCurrentDir(dir);
        }

        // 获取git信息
        const gitBranchResult = await (window as any).electronAPI.executeCommand('git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""');
        const gitStatusResult = await (window as any).electronAPI.executeCommand('git status --porcelain 2>/dev/null | wc -l | tr -d " " || echo "0"');
        
        let gitInfoText = '';
        if (gitBranchResult && gitBranchResult.stdout && gitBranchResult.stdout.trim()) {
          const branch = gitBranchResult.stdout.trim();
          const changes = gitStatusResult?.stdout?.trim() || '0';
          gitInfoText = `git:(${branch})`;
          if (changes !== '0' && changes !== '') {
            gitInfoText += ` *${changes}`;
          }
        }
        setGitInfo(gitInfoText);
      } else {
        // 如果没有executeCommand方法，通过PTY执行命令
        // 注意：这需要PTY已经创建
        if (ptyPidRef.current) {
          // 通过PTY执行命令获取信息
          // 这里暂时不实现，因为需要解析输出比较复杂
          // 可以后续通过监听PTY输出来实现
          console.log('executeCommand not available, using PTY fallback');
        }
      }
    } catch (error) {
      console.error('Failed to update prompt info:', error);
    }
  }, []);

  // 切换主题
  const changeTheme = useCallback((themeName: ThemeName) => {
    setCurrentTheme(themeName);
    setIsThemeMenuOpen(false);
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.options.theme = themes[themeName];
      // 更新容器背景色
      if (terminalRef.current) {
        terminalRef.current.style.backgroundColor = themes[themeName].background;
      }
    }
  }, [themes]);

  // 监听主题变化，更新终端主题
  useEffect(() => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.options.theme = themes[currentTheme];
      if (terminalRef.current) {
        terminalRef.current.style.backgroundColor = themes[currentTheme].background;
      }
    }
  }, [currentTheme, themes]);

  // 创建PTY终端
  const createPTYTerminal = useCallback(async () => {
    if (!isElectronRef.current || !(window as any).electronAPI) {
      return null;
    }

    try {
      const pid = await (window as any).electronAPI.createTerminal();
      ptyPidRef.current = pid;

      // 监听PTY数据
      const dataHandler = (data: { pid: number; data: string }) => {
        if (data.pid === pid && terminalInstanceRef.current) {
          // 直接写入终端，xterm会自动处理
          terminalInstanceRef.current.write(data.data);
          
          // 检测pwd命令的输出，更新当前目录
          // 匹配pwd命令的输出: /path/to/dir
          const pwdOutputMatch = data.data.match(/(?:^|\r\n|\n)([\/~][^\s\r\n\[\]]+?)(?:\r\n|\n|$)/);
          if (pwdOutputMatch && pwdOutputMatch[1]) {
            const newDir = pwdOutputMatch[1].trim();
            // 只更新如果看起来像绝对路径或home目录
            if ((newDir.startsWith('/') || newDir.startsWith('~')) && newDir.length > 0) {
              setCurrentDir(newDir);
            }
          }
          
          // 检测命令提示符中的目录（PS1格式）
          // 匹配格式: user@host:/path/to/dir$ 或 /path/to/dir$
          const promptMatch = data.data.match(/(?:^|\r\n|\n)(?:[^\s:]+@[^\s:]+:)?([\/~][^\s\$#\r\n]+?)[\$#%]\s*$/m);
          if (promptMatch && promptMatch[1]) {
            const newDir = promptMatch[1].trim();
            if ((newDir.startsWith('/') || newDir.startsWith('~')) && newDir.length > 0 && !newDir.includes('[')) {
              setCurrentDir(newDir);
            }
          }
          
          // 只在应该自动滚动时才滚动（用户提交命令后）
          if (shouldAutoScrollRef.current) {
            setTimeout(() => {
              scrollToBottom();
            }, 50);
          }
        }
      };

      const exitHandler = (data: { pid: number; exitCode: number }) => {
        if (data.pid === pid) {
          ptyPidRef.current = null;
          if (terminalInstanceRef.current) {
            terminalInstanceRef.current.write('\r\n\x1b[31m[进程已退出]\x1b[0m\r\n');
            // 进程退出时也滚动
            if (shouldAutoScrollRef.current) {
              setTimeout(scrollToBottom, 50);
            }
          }
        }
      };

      (window as any).electronAPI.onTerminalData(dataHandler);
      (window as any).electronAPI.onTerminalExit(exitHandler);

      return pid;
    } catch (error: any) {
      console.error('Failed to create terminal:', error);
      return null;
    }
  }, [scrollToBottom]);

  // 写入数据到PTY
  const writeToPTY = useCallback((data: string) => {
    if (ptyPidRef.current && (window as any).electronAPI) {
      (window as any).electronAPI.writeTerminal(ptyPidRef.current, data);
    }
  }, []);

  // 执行命令（供外部调用）
  const executeCommand = useCallback(async (command: string) => {
    if (!command.trim() || !ptyPidRef.current) return;
    
    // 启用自动滚动
    shouldAutoScrollRef.current = true;
    
    // 发送到PTY
    writeToPTY(command + '\r');
    
    // 延迟更新提示信息
    setTimeout(() => {
      updatePromptInfo();
      scrollToBottom();
    }, 300);
  }, [writeToPTY, scrollToBottom, updatePromptInfo]);

  // 调整终端大小
  const resizeTerminal = useCallback(() => {
    if (ptyPidRef.current && terminalInstanceRef.current && fitAddonRef.current && (window as any).electronAPI) {
      try {
        fitAddonRef.current.fit();
        // 检查终端是否已经初始化完成
        if (terminalInstanceRef.current && terminalInstanceRef.current.element && terminalInstanceRef.current.element.offsetWidth > 0) {
          // 使用 terminal 的 cols 和 rows 属性，而不是 dimensions
          const cols = terminalInstanceRef.current.cols;
          const rows = terminalInstanceRef.current.rows;
          if (cols && rows && cols > 0 && rows > 0) {
            (window as any).electronAPI.resizeTerminal(
              ptyPidRef.current,
              cols,
              rows
            );
          }
        }
      } catch (error) {
        console.error('Failed to resize terminal:', error);
      }
    }
  }, []);

  // 初始化终端 - 始终初始化，不因isOpen而销毁，保持会话
  useEffect(() => {
    if (!terminalRef.current || !outputContainerRef.current) return;

    // 创建终端实例 - 使用当前主题
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", "Cascadia Code", monospace',
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      letterSpacing: 0,
      lineHeight: 1.2,
      scrollback: 1000,
      tabStopWidth: 4,
      theme: themes[currentTheme],
      allowProposedApi: true,
      allowTransparency: false,
      convertEol: false,
      disableStdin: false, // 启用terminal输入，让用户直接在终端内输入
    });

    // 加载addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    const unicode11Addon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';

    terminal.open(terminalRef.current);
    
    terminalInstanceRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // 延迟fit，确保容器已经渲染
    setTimeout(() => {
      if (fitAddonRef.current && terminalRef.current && terminal.element) {
        try {
          fitAddonRef.current.fit();
        } catch (error) {
          console.error('Failed to fit terminal:', error);
        }
      }
      // 通知外部executeCommand已准备好
      if (onExecuteCommandReady) {
        onExecuteCommandReady(executeCommand);
      }
    }, 100);

    // 创建PTY终端
    if (isElectronRef.current) {
      createPTYTerminal().then((pid) => {
        // 初始化时获取目录和git信息
        updatePromptInfo();
        
        if (pid && initialCommand && autoExecute) {
          // 自动执行初始命令
          setTimeout(() => {
            writeToPTY(initialCommand + '\r');
          }, 100);
        }
      });
    } else {
      terminal.writeln('\x1b[31m警告: 此功能需要在Electron环境中运行\x1b[0m');
      terminal.writeln('');
    }

    // Tab补全处理函数（需要在onData之前定义）
    const handleTabCompletion = async (term: Terminal, input: string, cursorPos: number): Promise<string[]> => {
      // 获取当前单词（从最后一个空格或斜杠到光标位置）
      const lastSpace = input.lastIndexOf(' ', cursorPos - 1);
      const lastSlash = input.lastIndexOf('/', cursorPos - 1);
      const lastSep = Math.max(lastSpace, lastSlash);
      const prefix = input.substring(0, lastSep + 1);
      const currentWord = input.substring(lastSep + 1, cursorPos);
      
      if (!currentWord) {
        return [];
      }
      
      // 如果是在文件路径中，尝试补全文件/目录
      if (currentWord.includes('/') || lastSep >= 0) {
        // 提取目录路径
        const pathParts = (prefix + currentWord).split('/');
        const dir = pathParts.slice(0, -1).join('/') || '.';
        const filePrefix = pathParts[pathParts.length - 1] || '';
        
        // 通过PTY执行ls命令获取补全列表
        return new Promise((resolve) => {
          let output = '';
          let resolved = false;
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve([]);
            }
          }, 1000);
          
          const tempHandler = (data: { pid: number; data: string }) => {
            if (data.pid === ptyPidRef.current && !resolved) {
              output += data.data;
            }
          };
          
          // 临时监听输出
          if ((window as any).electronAPI) {
            (window as any).electronAPI.onTerminalData(tempHandler);
            
            // 执行ls命令获取补全
            const lsCommand = `compgen -f "${dir}/${filePrefix}" 2>/dev/null | sed "s|^${dir}/||" | head -20 || ls -1 "${dir}" 2>/dev/null | grep "^${filePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" | head -20 || echo ""`;
            writeToPTY(lsCommand + '\r');
            
            // 500ms后解析结果
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                const lines = output.split('\n').filter(f => f.trim());
                const files = lines.filter(f => f.startsWith(filePrefix));
                resolve(files.map(f => f.substring(filePrefix.length)));
              }
            }, 500);
          } else {
            resolve([]);
          }
        });
      }
      
      // 命令补全（常见命令列表）
      const commands = [
        'cd', 'ls', 'pwd', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'grep', 'find',
        'git', 'npm', 'node', 'python', 'python3', 'yt-dlp', 'ffmpeg'
      ];
      
      return commands.filter(cmd => cmd.startsWith(currentWord) && cmd !== currentWord);
    };

    // 处理终端内的键盘输入
    // 注意：由于启用了stdin，xterm会直接处理大部分输入
    // 我们主要拦截Tab键来实现补全功能
    let tabCompletionBuffer = ''; // 用于Tab补全的缓冲区
    let tabCompletionIndex = 0; // Tab补全索引
    let tabCompletions: string[] = []; // Tab补全列表
    
    terminal.onData((data: string) => {
      // 处理Tab键补全
      if (data === '\t' || data === '\x09') {
        // 获取当前行的内容（通过读取终端缓冲区）
        // 由于xterm直接处理输入，我们需要通过其他方式获取当前输入
        // 这里我们使用一个简化的方法：拦截Tab并发送补全请求
        handleTabCompletion(terminal, tabCompletionBuffer, tabCompletionBuffer.length).then((completions) => {
          if (completions.length > 0) {
            tabCompletions = completions;
            if (tabCompletionIndex >= completions.length) {
              tabCompletionIndex = 0;
            }
            const completion = completions[tabCompletionIndex];
            
            // 发送补全结果到终端
            // 注意：由于shell可能已经处理了部分输入，我们需要发送完整的补全
            writeToPTY(completion);
            tabCompletionBuffer += completion;
            tabCompletionIndex = (tabCompletionIndex + 1) % completions.length;
          } else {
            // 如果没有补全，发送Tab字符让shell处理
            writeToPTY('\t');
          }
        });
        return; // 阻止默认Tab行为
      }
      
      // 记录输入到缓冲区（用于Tab补全）
      if (data.length === 1 && data >= ' ') {
        tabCompletionBuffer += data;
      } else if (data === '\r' || data === '\n') {
        // Enter键，清空缓冲区
        const command = tabCompletionBuffer.trim();
        if (command) {
          // 添加到历史记录
          setCommandHistory(prev => {
            const newHistory = [...prev];
            if (newHistory[newHistory.length - 1] !== command) {
              newHistory.push(command);
            }
            return newHistory.slice(-100); // 保留最近100条
          });
        }
        tabCompletionBuffer = '';
        tabCompletions = [];
        tabCompletionIndex = 0;
        shouldAutoScrollRef.current = true;
      } else if (data === '\x7f' || data === '\b') {
        // 退格键
        if (tabCompletionBuffer.length > 0) {
          tabCompletionBuffer = tabCompletionBuffer.slice(0, -1);
        }
      }
      
      // 所有其他输入直接发送到PTY，让shell处理
      writeToPTY(data);
    });
    
    // 终端初始化后聚焦
    setTimeout(() => {
      terminal.focus();
    }, 200);

    // 监听窗口大小变化
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current && outputContainerRef.current && terminalInstanceRef.current) {
        // 确保终端容器有正确的高度
        const container = outputContainerRef.current;
        if (container && container.clientHeight > 0 && terminalInstanceRef.current.element) {
          try {
            fitAddonRef.current.fit();
            resizeTerminal();
          } catch (error) {
            console.error('Failed to resize terminal on window resize:', error);
          }
        }
      }
    };
    
    // 初始调整大小
    setTimeout(() => {
      handleResize();
    }, 200);

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    if (outputContainerRef.current) {
      resizeObserver.observe(outputContainerRef.current);
    }
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      
      if (ptyPidRef.current && (window as any).electronAPI) {
        (window as any).electronAPI.killTerminal(ptyPidRef.current);
      }
      
      if ((window as any).electronAPI) {
        (window as any).electronAPI.removeTerminalListeners();
      }
      
      terminal.dispose();
    };
    // 移除isOpen和currentTheme依赖，确保终端始终存在，不会因显示/隐藏或主题变化而重新初始化
    // 主题变化通过单独的useEffect处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

  // 清空终端
  const handleClear = () => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.clear();
    }
  };

  // 搜索功能
  const handleSearch = useCallback(() => {
    if (searchAddonRef.current && searchTerm) {
      searchAddonRef.current.findNext(searchTerm);
    }
  }, [searchTerm]);

  // 处理搜索快捷键和点击外部关闭主题菜单
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F 打开搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      // Escape 关闭搜索或主题菜单
      if (e.key === 'Escape') {
        if (isSearchOpen) {
          setIsSearchOpen(false);
          setSearchTerm('');
        }
        if (isThemeMenuOpen) {
          setIsThemeMenuOpen(false);
        }
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (isThemeMenuOpen && !(e.target as Element).closest('.relative')) {
        setIsThemeMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [isSearchOpen, isThemeMenuOpen]);

  // 终端始终渲染，保持会话
  return (
    <div
      className="flex-shrink-0 bg-gray-950 flex flex-col w-full h-full transition-all duration-300 border-l border-gray-800"
    >
      {/* 简化的工具栏 - 只保留必要的操作按钮 - Glass Effect */}
      <div className="flex flex-row items-center justify-end px-4 py-3 bg-gray-900/80 backdrop-blur-md border-b border-gray-800 flex-shrink-0 sticky top-0 z-10">
        <div className="flex flex-row items-center space-x-2">
          {/* 主题切换按钮 */}
          <div className="relative">
            <button
              onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-200"
              title="切换主题"
            >
              <Palette className="w-4 h-4" />
            </button>
            {isThemeMenuOpen && (
              <div className="absolute right-0 top-full mt-2 bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl border border-gray-800 py-2 z-50 min-w-[180px]">
                {Object.keys(themes).map((themeName) => (
                  <button
                    key={themeName}
                    onClick={() => changeTheme(themeName as ThemeName)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-white/5 transition-colors ${
                      currentTheme === themeName ? 'bg-white/10 text-white font-medium' : 'text-gray-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="capitalize">{themeName.replace('-', ' ')}</span>
                      {currentTheme === themeName && (
                        <span className="text-primary-400">✓</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className={`p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-200 ${
              isSearchOpen ? 'bg-white/10 text-white' : ''
            }`}
            title="搜索 (Cmd/Ctrl+F)"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={handleClear}
            className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-200"
            title="清空终端"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      {isSearchOpen && (
        <div className="px-4 py-3 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 flex-shrink-0 animate-fade-in">
          <div className="flex items-center space-x-3">
            <Search className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSearch();
                } else if (e.key === 'Escape') {
                  setIsSearchOpen(false);
                  setSearchTerm('');
                }
              }}
              placeholder="在终端中搜索..."
              className="flex-1 bg-transparent text-gray-200 text-sm placeholder-gray-600 focus:outline-none"
              autoFocus
            />
            <div className="flex items-center space-x-2">
              <button
                onClick={handleSearch}
                className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                查找
              </button>
              <button
                onClick={() => {
                  setIsSearchOpen(false);
                  setSearchTerm('');
                }}
                className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 终端内容区域 - 占满整个面板 */}
      <div className="flex flex-1 min-h-0 bg-gray-950">
        {/* 终端显示区域 - 100%宽度 */}
        <div className="w-full flex flex-col min-w-0">
          <div
            ref={outputContainerRef}
            className="flex-1 overflow-y-auto min-h-0 scrollbar-thin"
            style={{
              padding: '16px',
              paddingTop: '16px',
              scrollBehavior: 'smooth',
            }}
            onScroll={(e) => {
              const target = e.target as HTMLDivElement;
              const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 10;
              // 如果用户手动滚动到底部，启用自动滚动
              if (isAtBottom) {
                shouldAutoScrollRef.current = true;
              } else {
                // 如果用户向上滚动，禁用自动滚动
                shouldAutoScrollRef.current = false;
              }
            }}
          >
            <div
              ref={terminalRef}
              className="w-full terminal-container"
              style={{ 
                height: '100%',
                minHeight: '200px',
                backgroundColor: themes[currentTheme].background,
              }}
            />
          </div>
        </div>
      </div>
        
      {/* 移除底部输入框，用户直接在终端内输入 */}
    </div>
  );
};

export default TerminalPanel;
