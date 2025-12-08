import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { Brain, Plug, Workflow as WorkflowIcon, Settings, Code, Terminal, MessageCircle, Globe, Sparkles } from 'lucide-react';
import TerminalPanel from './components/TerminalPanel';
import { setTerminalExecutor } from './utils/terminalExecutor';
import SettingsPanel from './components/SettingsPanel';
import LLMConfigPanel from './components/LLMConfig';
import MCPConfig from './components/MCPConfig';
import WorkflowEditor from './components/WorkflowEditor';
import Workflow from './components/Workflow';
import CrawlerConfigPage from './components/CrawlerConfigPage';
import AgentsPage from './components/AgentsPage';

interface Settings {
  theme: 'light' | 'dark' | 'system';
  autoRefresh: boolean;
  refreshInterval: number;
  videoColumns: number;
}

const App: React.FC = () => {
  const location = useLocation();
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [, setTerminalState] = useState({ isMinimized: false, isMaximized: false });
  const terminalExecuteCommandRef = React.useRef<((command: string) => void) | null>(null);
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return { theme: 'system', autoRefresh: false, refreshInterval: 60, videoColumns: 4 };
      }
    }
    return { theme: 'system', autoRefresh: false, refreshInterval: 60, videoColumns: 4 };
  });

  // 保存设置
  useEffect(() => {
    localStorage.setItem('settings', JSON.stringify(settings));
  }, [settings]);

  // 应用主题
  useEffect(() => {
    const root = window.document.documentElement;
    const isDark = settings.theme === 'dark' || 
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const getContainerClasses = () => {
    if (isTerminalOpen) {
      return 'container-responsive';
    } else {
      return 'w-full px-3 sm:px-4 lg:px-6';
    }
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-950 flex transition-colors duration-300 overflow-hidden">
      {/* 左侧导航栏 */}
      <nav className="w-[72px] bg-white dark:bg-gray-900 shadow-sm border-r border-gray-200 dark:border-gray-800 flex flex-col items-center pb-6 flex-shrink-0 z-50">
        {/* macOS 窗口拖动区域 & 顶部占位 */}
        <div className="w-full h-[52px] flex-shrink-0 app-drag" />

        <div className="flex flex-col items-center space-y-2 w-full px-2 app-no-drag overflow-y-auto hide-scrollbar">
          <Link
            to="/"
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 group relative flex-shrink-0 ${
              location.pathname === '/' 
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30' 
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            title="大语言模型聊天模式"
          >
            <MessageCircle className="w-[22px] h-[22px]" strokeWidth={2} />
          </Link>

          <Link
            to="/workflow-editor"
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 group relative flex-shrink-0 ${
              location.pathname === '/workflow-editor' 
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30' 
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            title="工作流编辑器"
          >
            <WorkflowIcon className="w-[22px] h-[22px]" strokeWidth={2} />
          </Link>

          <Link
            to="/agents"
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 group relative flex-shrink-0 ${
              location.pathname === '/agents' 
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30' 
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            title="智能体"
          >
            <Sparkles className="w-[22px] h-[22px]" strokeWidth={2} />
          </Link>
        </div>
        
        <div className="flex-1 app-drag" />
        
        <div className="flex flex-col items-center space-y-2 w-full px-2 app-no-drag flex-shrink-0 mb-2">
          <Link
            to="/settings"
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 group relative ${
              location.pathname === '/settings' 
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30' 
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            title="设置"
          >
            <Settings className="w-[22px] h-[22px]" strokeWidth={2} />
          </Link>

          <Link
            to="/llm-config"
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 group relative ${
              location.pathname === '/llm-config'
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30'
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            title="LLM配置"
          >
            <Brain className="w-[22px] h-[22px]" strokeWidth={2} />
          </Link>

          <Link
            to="/mcp-config"
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 group relative ${
              location.pathname === '/mcp-config'
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30'
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            title="MCP配置"
          >
            <Plug className="w-[22px] h-[22px]" strokeWidth={2} />
          </Link>

          <Link
            to="/crawler-config"
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 group relative ${
              location.pathname === '/crawler-config'
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30'
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            title="爬虫配置"
          >
            <Globe className="w-[22px] h-[22px]" strokeWidth={2} />
          </Link>
          
          {/* 终端切换按钮 */}
          <button
            onClick={() => setIsTerminalOpen(!isTerminalOpen)}
            className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 ${
              isTerminalOpen
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30'
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
            title={isTerminalOpen ? '隐藏终端' : '显示终端'}
          >
            <Terminal className="w-[22px] h-[22px]" strokeWidth={2} />
          </button>

          {/* DevTools 按钮 */}
          <button
            onClick={async () => {
              if (window.electronAPI) {
                try {
                  await window.electronAPI.toggleDevTools();
                } catch (error) {
                  console.error('Failed to toggle dev tools:', error);
                }
              } else {
                alert('在浏览器环境中，请使用以下快捷键打开开发者工具：\n\nWindows/Linux: F12 或 Ctrl+Shift+I\nMac: Cmd+Option+I');
              }
            }}
            className="w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200"
            title="开发者工具 (F12)"
          >
            <Code className="w-[22px] h-[22px]" strokeWidth={2} />
          </button>
        </div>
      </nav>

      {/* 主要内容 */}
      <main className="flex flex-col flex-1 min-h-0 transition-all duration-300 relative overflow-hidden">
        {/* macOS 窗口拖动区域 - 顶部标题栏 */}
        <div className="h-[52px] w-full app-drag flex-shrink-0 bg-gray-50 dark:bg-gray-950" />
        
        <div className="flex flex-1 min-h-0 min-w-0">
          {/* 左侧内容区域 */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-gray-50 dark:bg-gray-950">
            <div className="flex-1 overflow-hidden min-w-0 flex flex-col relative">
              <div className={`${getContainerClasses()} h-full flex flex-col py-4`}>
                <Routes>
                  {/* 工作流聊天界面 */}
                  <Route path="/" element={<Workflow />} />

                  {/* 工作流编辑器 */}
                  <Route path="/workflow-editor" element={<WorkflowEditor />} />

                  {/* LLM配置页面 */}
                  <Route path="/llm-config" element={<LLMConfigPanel />} />

                  {/* MCP配置页面 */}
                  <Route path="/mcp-config" element={<MCPConfig />} />

                  {/* 爬虫配置页面 */}
                  <Route path="/crawler-config" element={<CrawlerConfigPage />} />

                  {/* 智能体页面 */}
                  <Route path="/agents" element={<AgentsPage />} />

                  {/* 设置页面 */}
                  <Route path="/settings" element={
                    <SettingsPanel
                      settings={settings}
                      onUpdateSettings={updateSettings}
                    />
                  } />
                </Routes>
              </div>
            </div>
          </div>

          {/* 右侧终端区域 */}
          {isTerminalOpen && (
            <div className="w-[50%] flex flex-col min-h-0 min-w-0 border-l border-gray-200 bg-gray-900 flex-shrink-0">
              <TerminalPanel
                isOpen={true}
                onClose={() => setIsTerminalOpen(false)}
                onStateChange={(isMinimized, isMaximized) => {
                  setTerminalState({ isMinimized, isMaximized });
                }}
                onExecuteCommandReady={(executeCommand) => {
                  terminalExecuteCommandRef.current = executeCommand;
                  setTerminalExecutor(executeCommand);
                }}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;

