import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { Brain, Plug, Workflow as WorkflowIcon, Settings, Code, Terminal, MessageCircle, Globe, Sparkles, Bot, Users } from 'lucide-react';
import TerminalPanel from './components/TerminalPanel';
import { setTerminalExecutor } from './utils/terminalExecutor';
import SettingsPanel from './components/SettingsPanel';
import LLMConfigPanel from './components/LLMConfig';
import MCPConfig from './components/MCPConfig';
import WorkflowEditor from './components/WorkflowEditor';
import Workflow from './components/Workflow';
import CrawlerConfigPage from './components/CrawlerConfigPage';
import AgentsPage from './components/AgentsPage';
import SessionSidebar from './components/SessionSidebar';
import RoundTableChat from './components/RoundTableChat';

// 导航项组件 - 带动画和tooltip
interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  isActive: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon, title, isActive }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative group">
      <Link
        to={to}
        className={`
          w-11 h-11 flex items-center justify-center rounded-xl 
          transition-all duration-300 ease-out relative
          flex-shrink-0
          ${isActive 
            ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30 scale-105' 
            : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200 hover:scale-105'
          }
        `}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title=""
      >
        <div className={`transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
          {icon}
        </div>
        {/* 激活指示器 */}
        {isActive && (
          <div className="absolute inset-0 rounded-xl bg-primary-600/20 animate-pulse-soft" />
        )}
      </Link>
      {/* Tooltip */}
      {showTooltip && !isActive && (
        <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-gray-900 dark:bg-gray-800 text-white text-xs rounded-lg shadow-lg z-50 whitespace-nowrap slide-in-left pointer-events-none">
          {title}
          <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-gray-900 dark:border-r-gray-800" />
        </div>
      )}
    </div>
  );
};

interface Settings {
  theme: 'light' | 'dark' | 'system';
  autoRefresh: boolean;
  refreshInterval: number;
  videoColumns: number;
}

const App: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [, setTerminalState] = useState({ isMinimized: false, isMaximized: false });
  const terminalExecuteCommandRef = React.useRef<((command: string) => void) | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedRoundTableId, setSelectedRoundTableId] = useState<string | null>(null);
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

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    // 如果当前不在聊天页面，导航到聊天页面
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  // 配置会话（打开配置对话框）
  const handleConfigSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    // 导航到聊天页面并触发配置对话框
    if (location.pathname !== '/') {
      navigate(`/?config=${sessionId}`);
    } else {
      // 如果已经在聊天页面，通过URL参数触发
      navigate(`/?config=${sessionId}`, { replace: true });
    }
  };

  const handleNewSession = () => {
    // 新会话创建后的回调
  };

  const handleSelectRoundTable = (roundTableId: string) => {
    setSelectedRoundTableId(roundTableId);
    // 导航到圆桌会议页面（使用agents页面）
    navigate('/agents');
  };

  // 判断是否显示terminal独占页面
  const isTerminalPage = location.pathname === '/terminal';
  
  // 判断是否为聊天页面
  const isChatPage = location.pathname === '/';
  
  // 圆桌模式状态
  const [isRoundTableMode, setIsRoundTableMode] = useState(false);
  const [currentRoundTableId, setCurrentRoundTableId] = useState<string | null>(null);

  const handleToggleRoundTable = async () => {
    if (!isRoundTableMode) {
      // 切换到圆桌模式
      setIsRoundTableMode(true);
      // 如果没有当前圆桌会议，创建一个新的
      if (!currentRoundTableId) {
        try {
          const { createRoundTable } = await import('./services/roundTableApi');
          const newTable = await createRoundTable();
          setCurrentRoundTableId(newTable.round_table_id);
        } catch (error) {
          console.error('Failed to create round table:', error);
        }
      }
    } else {
      // 退出圆桌模式
      setIsRoundTableMode(false);
      setCurrentRoundTableId(null);
    }
  };

  const handleAddToRoundTable = async (sessionId: string) => {
    // 添加到圆桌会议的逻辑
    if (!currentRoundTableId) {
      // 如果没有当前圆桌会议，创建一个新的
      try {
        const { createRoundTable, addParticipant } = await import('./services/roundTableApi');
        const newTable = await createRoundTable();
        setCurrentRoundTableId(newTable.round_table_id);
        // 添加参与者
        await addParticipant(newTable.round_table_id, sessionId);
      } catch (error) {
        console.error('Failed to add to round table:', error);
      }
    } else {
      // 添加参与者到现有圆桌会议
      try {
        const { addParticipant } = await import('./services/roundTableApi');
        await addParticipant(currentRoundTableId, sessionId);
      } catch (error) {
        console.error('Failed to add participant:', error);
      }
    }
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-950 flex transition-colors duration-300 overflow-hidden">
      {/* 中间导航栏 */}
      <nav className="w-[72px] bg-white dark:bg-gray-900 shadow-sm border-r border-gray-200 dark:border-gray-800 flex flex-col items-center flex-shrink-0 z-50">

        {/* 上方导航：聊天、MCP、Workflow */}
        <div className="flex flex-col items-center space-y-2 w-full px-2 app-no-drag">
          <NavItem
            to="/"
            icon={<Bot className="w-[22px] h-[22px]" strokeWidth={2} />}
            title="聊天"
            isActive={location.pathname === '/'}
          />

          <NavItem
            to="/mcp-config"
            icon={<Plug className="w-[22px] h-[22px]" strokeWidth={2} />}
            title="MCP配置"
            isActive={location.pathname === '/mcp-config'}
          />

          <NavItem
            to="/workflow-editor"
            icon={<WorkflowIcon className="w-[22px] h-[22px]" strokeWidth={2} />}
            title="工作流编辑器"
            isActive={location.pathname === '/workflow-editor'}
          />
        </div>
        
        <div className="flex-1 app-drag" />
        
        {/* 分隔线 */}
        <div className="w-8 h-px bg-gray-200 dark:bg-gray-700 my-2 app-no-drag" />
        
        {/* 下方导航：设置、模型录入及其他功能 */}
        <div className="flex flex-col items-center space-y-2 w-full px-2 app-no-drag flex-shrink-0 mb-2">
          <NavItem
            to="/settings"
            icon={<Settings className="w-[22px] h-[22px]" strokeWidth={2} />}
            title="设置"
            isActive={location.pathname === '/settings'}
          />

          <NavItem
            to="/llm-config"
            icon={<Brain className="w-[22px] h-[22px]" strokeWidth={2} />}
            title="LLM配置"
            isActive={location.pathname === '/llm-config'}
          />

          <NavItem
            to="/crawler-config"
            icon={<Globe className="w-[22px] h-[22px]" strokeWidth={2} />}
            title="爬虫配置"
            isActive={location.pathname === '/crawler-config'}
          />
          
          {/* 终端按钮 - 点击时独占右侧 */}
          <div className="relative group">
            <Link
              to="/terminal"
              className={`
                w-11 h-11 flex items-center justify-center rounded-xl 
                transition-all duration-300 ease-out relative
                ${isTerminalPage
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/30 scale-105' 
                  : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200 hover:scale-105'
                }
              `}
              title="终端"
            >
              <div className={`transition-transform duration-300 ${isTerminalPage ? 'scale-110' : 'group-hover:scale-110'}`}>
                <Terminal className="w-[22px] h-[22px]" strokeWidth={2} />
              </div>
              {isTerminalPage && (
                <div className="absolute inset-0 rounded-xl bg-primary-600/20 animate-pulse-soft" />
              )}
            </Link>
          </div>

          {/* DevTools 按钮 - 增强版 */}
          <div className="relative group">
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
              className="w-11 h-11 flex items-center justify-center rounded-xl transition-all duration-300 ease-out text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-gray-900 dark:hover:text-gray-200 hover:scale-105"
              title="开发者工具 (F12)"
            >
              <div className="transition-transform duration-300 group-hover:scale-110">
                <Code className="w-[22px] h-[22px]" strokeWidth={2} />
              </div>
            </button>
          </div>
        </div>
      </nav>

      {/* 主要内容区域 - 全屏显示 */}
      <main className="flex flex-col flex-1 min-h-0 transition-all duration-300 relative overflow-hidden bg-gray-50 dark:bg-gray-950">
        
        {isTerminalPage ? (
          /* Terminal 独占页面 */
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
            <TerminalPanel
              isOpen={true}
              onClose={() => navigate('/')}
              onStateChange={(isMinimized, isMaximized) => {
                setTerminalState({ isMinimized, isMaximized });
              }}
              onExecuteCommandReady={(executeCommand) => {
                terminalExecuteCommandRef.current = executeCommand;
                setTerminalExecutor(executeCommand);
              }}
            />
          </div>
        ) : isChatPage ? (
          /* 聊天页面 - 左右布局 */
          <div className="flex flex-1 min-h-0 min-w-0">
            {/* 左侧会话列表 */}
            <SessionSidebar
              selectedSessionId={selectedSessionId}
              onSelectSession={handleSelectSession}
              onNewSession={handleNewSession}
              isRoundTableMode={isRoundTableMode}
              onAddToRoundTable={handleAddToRoundTable}
              onConfigSession={handleConfigSession}
            />
            
            {/* 中间会议按钮 */}
            <div className="w-1 flex items-center justify-center bg-gray-100 dark:bg-gray-800 relative group">
              <button
                onClick={handleToggleRoundTable}
                className={`
                  absolute left-1/2 -translate-x-1/2 w-8 h-16 rounded-r-lg transition-all
                  ${isRoundTableMode
                    ? 'bg-primary-600 text-white shadow-lg'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-primary-100 dark:hover:bg-primary-900/20'
                  }
                `}
                title={isRoundTableMode ? '退出圆桌会议' : '进入圆桌会议'}
              >
                <Users className="w-4 h-4 mx-auto" />
              </button>
            </div>
            
            {/* 右侧聊天区域 */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
              {isRoundTableMode ? (
                /* 圆桌聊天 */
                <RoundTableChat
                  roundTableId={currentRoundTableId}
                  onRoundTableChange={setCurrentRoundTableId}
                />
              ) : (
                /* 普通聊天 */
                <Workflow sessionId={selectedSessionId} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 min-w-0">
            {/* 主内容区域 - 全屏 */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
              <div className="flex-1 overflow-hidden min-w-0 flex flex-col relative">
                <div className={`h-full flex flex-col page-transition-enter`}>
                  <Routes>
                    {/* 工作流聊天界面 - 全屏显示 */}
                    <Route path="/" element={<Workflow sessionId={selectedSessionId} />} />

                    {/* 工作流编辑器 */}
                    <Route path="/workflow-editor" element={<WorkflowEditor />} />

                    {/* LLM配置页面 */}
                    <Route path="/llm-config" element={<LLMConfigPanel />} />

                    {/* MCP配置页面 */}
                    <Route path="/mcp-config" element={<MCPConfig />} />

                    {/* 爬虫配置页面 */}
                    <Route path="/crawler-config" element={<CrawlerConfigPage />} />

                  {/* 智能体页面 */}
                  <Route path="/agents" element={<AgentsPage selectedRoundTableId={selectedRoundTableId} />} />

                  {/* Terminal 页面 */}
                  <Route path="/terminal" element={<div />} />

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

            {/* 右侧终端区域 - 带动画 - 优化布局（仅在非terminal页面且isTerminalOpen时显示） */}
            {isTerminalOpen && !isTerminalPage && (
              <div className="w-[45%] min-w-[400px] flex flex-col min-h-0 min-w-0 border-l border-gray-200 dark:border-gray-800 bg-gray-900 flex-shrink-0 slide-in-right shadow-lg">
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
        )}
      </main>
    </div>
  );
};

export default App;

