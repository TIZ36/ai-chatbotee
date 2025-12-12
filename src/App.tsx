import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { Brain, Plug, Workflow as WorkflowIcon, Settings, Code, Terminal, MessageCircle, Globe, Sparkles, Bot, Users, BookOpen } from 'lucide-react';
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
import ResearchPanel from './components/ResearchPanel';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';

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
          w-9 h-9 flex items-center justify-center rounded-xl 
          transition-all duration-200 ease-out relative
          flex-shrink-0
          ${isActive 
            ? 'bg-[var(--color-accent)] text-white' 
            : 'text-[#b0b0b0] hover:bg-[#202022] hover:text-white'
          }
        `}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        title=""
      >
        <div className={`transition-transform duration-200 ${isActive ? '' : 'group-hover:scale-105'}`}>
          {icon}
        </div>
      </Link>
      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#363636] text-white text-xs rounded-lg shadow-lg z-50 whitespace-nowrap pointer-events-none border border-[#404040]">
          {title}
          <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-[#363636]" />
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>('temporary-session');
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
  const [participantRefreshKey, setParticipantRefreshKey] = useState(0);
  
  // Research 模式状态
  const [isResearchMode, setIsResearchMode] = useState(false);
  const [currentResearchSessionId, setCurrentResearchSessionId] = useState<string | null>(null);
  const leftPanelRef = React.useRef<ImperativePanelHandle>(null);
  const autoCollapsedRef = React.useRef(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    const shouldCollapse = isResearchMode || isRoundTableMode;
    if (shouldCollapse && !autoCollapsedRef.current) {
      leftPanelRef.current?.collapse();
      autoCollapsedRef.current = true;
      setIsSidebarCollapsed(true);
      return;
    }
    if (!shouldCollapse && autoCollapsedRef.current) {
      leftPanelRef.current?.expand();
      autoCollapsedRef.current = false;
      setIsSidebarCollapsed(false);
    }
  }, [isResearchMode, isRoundTableMode]);

  const handleToggleRoundTable = async () => {
    if (!isRoundTableMode) {
      // 切换到圆桌模式，但不自动创建新圆桌
      // 用户可以在圆桌界面选择已有圆桌或手动创建新圆桌
      setIsRoundTableMode(true);
      setIsResearchMode(false);
    } else {
      // 退出圆桌模式
      setIsRoundTableMode(false);
      // 保留当前圆桌ID，下次进入时可以继续
      // setCurrentRoundTableId(null);
    }
  };
  
  const handleToggleResearch = () => {
    setIsResearchMode(prev => {
      const next = !prev;
      if (next) {
        // 进入 Research 模式时，退出圆桌模式
        setIsRoundTableMode(false);
      }
      return next;
    });
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
        // 触发参与者列表刷新
        setParticipantRefreshKey(prev => prev + 1);
      } catch (error) {
        console.error('Failed to add to round table:', error);
      }
    } else {
      // 添加参与者到现有圆桌会议
      try {
        const { addParticipant } = await import('./services/roundTableApi');
        await addParticipant(currentRoundTableId, sessionId);
        // 触发参与者列表刷新
        setParticipantRefreshKey(prev => prev + 1);
      } catch (error) {
        console.error('Failed to add participant:', error);
      }
    }
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-[#1a1a1a] flex flex-col transition-colors duration-200 overflow-hidden">
      {/* 顶部拖拽区域 - 支持三指拖动与双击最大化 */}
      <div
        className="w-full h-7 flex-shrink-0 app-drag bg-transparent"
        title="拖动窗口 / 双击最大化"
        onDoubleClick={() => {
          window.electronAPI?.toggleMaximize?.();
        }}
      />
      
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* 中间导航栏 - GNOME 风格 */}
      <nav className="w-[52px] bg-white dark:bg-[#2d2d2d] border-r border-gray-200 dark:border-[#404040] flex flex-col items-center flex-shrink-0 z-50 pt-3">

        {/* 上方导航：聊天、MCP、Workflow */}
        <div className="flex flex-col items-center space-y-1.5 w-full px-1.5 app-no-drag">
          <NavItem
            to="/"
            icon={<Bot className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="聊天"
            isActive={location.pathname === '/'}
          />

          <NavItem
            to="/mcp-config"
            icon={<Plug className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="MCP配置"
            isActive={location.pathname === '/mcp-config'}
          />

          <NavItem
            to="/workflow-editor"
            icon={<WorkflowIcon className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="工作流编辑器"
            isActive={location.pathname === '/workflow-editor'}
          />
        </div>
        
        <div className="flex-1 app-drag" />
        
        {/* 分隔线 */}
        <div className="w-6 h-px bg-gray-200 dark:bg-[#404040] my-1.5 app-no-drag" />
        
        {/* 下方导航：设置、模型录入及其他功能 */}
        <div className="flex flex-col items-center space-y-1.5 w-full px-1.5 app-no-drag flex-shrink-0 mb-2">
          <NavItem
            to="/settings"
            icon={<Settings className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="设置"
            isActive={location.pathname === '/settings'}
          />

          <NavItem
            to="/llm-config"
            icon={<Brain className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="LLM配置"
            isActive={location.pathname === '/llm-config'}
          />

          <NavItem
            to="/crawler-config"
            icon={<Globe className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="爬虫配置"
            isActive={location.pathname === '/crawler-config'}
          />
          
          {/* 终端按钮 - 点击时独占右侧 */}
          <div className="relative group">
            <Link
              to="/terminal"
              className={`
                w-9 h-9 flex items-center justify-center rounded-xl 
                transition-all duration-200 ease-out relative
                ${isTerminalPage
                  ? 'bg-[var(--color-accent)] text-white' 
                  : 'text-[#b0b0b0] hover:bg-[#202022] hover:text-white'
                }
              `}
              title="终端"
            >
              <div className={`transition-transform duration-200 ${isTerminalPage ? '' : 'group-hover:scale-105'}`}>
                <Terminal className="w-[18px] h-[18px]" strokeWidth={1.5} />
              </div>
            </Link>
          </div>

          {/* DevTools 按钮 */}
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
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200 ease-out text-[#b0b0b0] hover:bg-[#363636] hover:text-white"
              title="开发者工具 (F12)"
            >
              <div className="transition-transform duration-200 group-hover:scale-105">
                <Code className="w-[18px] h-[18px]" strokeWidth={1.5} />
              </div>
            </button>
          </div>
        </div>
      </nav>

      {/* 主要内容区域 - 全屏显示 */}
      <main
        className={`flex flex-col flex-1 min-h-0 transition-all duration-200 relative ${
          isTerminalPage ? 'overflow-visible' : 'overflow-hidden'
        } bg-gray-100 dark:bg-[#18181b]`}
      >
        
        {isTerminalPage ? (
          /* Terminal 独占页面 */
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-visible m-2">
            <div className="flex-1 rounded-xl bg-white dark:bg-[#18181b] border border-gray-200 dark:border-[#27272a] overflow-visible">
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
          </div>
        ) : isChatPage ? (
          /* 聊天页面 - 可拖拽分栏布局（IDE 风格） */
          <div className="relative flex flex-1 min-h-0 min-w-0 p-2">
            <PanelGroup direction="horizontal" className="flex flex-1 min-h-0 min-w-0">
              {/* 左侧会话列表（可折叠） */}
              <Panel
                ref={leftPanelRef}
                defaultSize={18}
                minSize={12}
                maxSize={28}
                collapsible
                collapsedSize={0}
                onCollapse={() => setIsSidebarCollapsed(true)}
                onExpand={() => setIsSidebarCollapsed(false)}
                className={`overflow-hidden border border-gray-200 dark:border-[#27272a] bg-gray-50 dark:bg-[#202022] ${
                  isSidebarCollapsed
                    ? 'rounded-xl border-r-0'
                    : 'rounded-xl rounded-r-none border-r-0'
                }`}
              >
                <SessionSidebar
                  selectedSessionId={selectedSessionId}
                  onSelectSession={handleSelectSession}
                  onNewSession={handleNewSession}
                  isRoundTableMode={isRoundTableMode}
                  onAddToRoundTable={handleAddToRoundTable}
                  onConfigSession={handleConfigSession}
                />
              </Panel>

              {!isSidebarCollapsed && (
                <PanelResizeHandle className="flex w-1 items-center justify-center cursor-col-resize">
                  <div className="h-full w-px bg-gray-200 dark:bg-[#27272a] hover:bg-[var(--color-accent)] transition-colors" />
                </PanelResizeHandle>
              )}

              {/* 主面板（Research 或 Chat/RoundTable） */}
              <Panel
                minSize={40}
                className={`relative overflow-hidden border border-gray-200 dark:border-[#27272a] bg-white dark:bg-[#18181b] ${
                  isSidebarCollapsed
                    ? 'rounded-xl'
                    : 'rounded-xl rounded-l-none border-l-0'
                }`}
              >
                {/* 浮动 Dock：模式 + 侧栏折叠 */}
                <div className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-10">
                  <button
                    onClick={() => {
                      autoCollapsedRef.current = false;
                      if (isSidebarCollapsed) {
                        leftPanelRef.current?.expand();
                        setIsSidebarCollapsed(false);
                      } else {
                        leftPanelRef.current?.collapse();
                        setIsSidebarCollapsed(true);
                      }
                    }}
                    className="w-7 h-7 rounded-lg border border-gray-200 dark:border-[#27272a] bg-white dark:bg-[#202022] text-gray-500 dark:text-[#b0b0b0] hover:bg-[var(--color-hover-bg)]"
                    title={isSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
                  >
                    {isSidebarCollapsed ? '›' : '‹'}
                  </button>
                  <button
                    onClick={handleToggleRoundTable}
                    className={`
                      w-7 h-14 rounded-lg transition-all
                      border border-gray-200 dark:border-[#27272a]
                      ${isRoundTableMode
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-white dark:bg-[#202022] text-gray-500 dark:text-[#b0b0b0] hover:bg-[var(--color-accent-bg)] hover:text-[var(--color-accent)]'
                      }
                    `}
                    title={isRoundTableMode ? '退出圆桌会议' : '进入圆桌会议'}
                  >
                    <Users className="w-4 h-4 mx-auto" />
                  </button>

                  <button
                    onClick={handleToggleResearch}
                    className={`
                      w-7 h-14 rounded-lg transition-all
                      border border-gray-200 dark:border-[#27272a]
                      ${isResearchMode
                        ? 'bg-[var(--color-accent)] text-white'
                        : 'bg-white dark:bg-[#202022] text-gray-500 dark:text-[#b0b0b0] hover:bg-[var(--color-accent-bg)] hover:text-[var(--color-accent)]'
                      }
                    `}
                    title={isResearchMode ? '退出 Research' : '进入 Research'}
                  >
                    <BookOpen className="w-4 h-4 mx-auto" />
                  </button>
                </div>

                {isResearchMode ? (
                  <ResearchPanel
                    chatSessionId={selectedSessionId}
                    researchSessionId={currentResearchSessionId}
                    onResearchSessionChange={setCurrentResearchSessionId}
                    onExit={() => setIsResearchMode(false)}
                  />
                ) : isRoundTableMode ? (
                  <RoundTableChat
                    roundTableId={currentRoundTableId}
                    onRoundTableChange={setCurrentRoundTableId}
                    refreshKey={participantRefreshKey}
                  />
                ) : (
                  <Workflow sessionId={selectedSessionId} />
                )}
              </Panel>
            </PanelGroup>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 min-w-0 p-2 gap-2">
            {/* 主内容区域面板 - GNOME 风格 */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden rounded-xl bg-white dark:bg-[#18181b] border border-gray-200 dark:border-[#27272a]">
              <div className="flex-1 overflow-hidden min-w-0 flex flex-col relative">
                <div className={`h-full flex flex-col`}>
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

            {/* 右侧终端区域 - GNOME 风格 */}
            {isTerminalOpen && !isTerminalPage && (
              <div className="w-[45%] min-w-[400px] flex flex-col min-h-0 min-w-0 flex-shrink-0 rounded-xl bg-white dark:bg-[#18181b] border border-gray-200 dark:border-[#27272a] overflow-visible slide-in-right">
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
    </div>
  );
};

export default App;
