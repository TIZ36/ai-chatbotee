import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { Brain, Plug, Workflow as WorkflowIcon, Settings, Code, Terminal, MessageCircle, Globe, Sparkles, Bot, Users, BookOpen, Shield, Activity } from 'lucide-react';
import appLogoDark from '../assets/app_logo_dark.png';
import appLogoLight from '../assets/app_logo_light.png';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import { ScrollArea } from './components/ui/ScrollArea';
import { DataListItem } from './components/ui/DataListItem';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/Dialog';
import TerminalPanel from './components/TerminalPanel';
import { setTerminalExecutor } from './utils/terminalExecutor';
import SettingsPanel from './components/SettingsPanel';
import LLMConfigPanel from './components/LLMConfig';
import MCPConfig from './components/MCPConfig';
import WorkflowEditor from './components/WorkflowEditor';
import Workflow from './components/Workflow';
import CrawlerConfigPage from './components/CrawlerConfigPage';
import RoundTableChat from './components/RoundTableChat';
import ResearchPanel from './components/ResearchPanel';
import UserAccessPage from './components/UserAccessPage';
import AgentsPage from './components/AgentsPage';
import RoleGeneratorPage from './components/RoleGeneratorPage';
// 新架构组件
import SystemStatusPanel from './components/SystemStatusPanel';
import { getAgents, getSessions, type Session } from './services/sessionApi';
import { getRoundTables, type RoundTable } from './services/roundTableApi';

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
          w-8 h-8 flex items-center justify-center rounded-lg 
          transition-all duration-200 ease-out relative
          flex-shrink-0
          ${isActive 
            ? 'bg-[var(--color-accent)]/90 text-white shadow-sm backdrop-blur-sm' 
            : 'text-gray-500 dark:text-[#a0a0a0] hover:bg-white/50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
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
      {/* Tooltip - 毛玻璃效果 */}
      {showTooltip && (
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 glass-popup text-gray-800 dark:text-white text-xs z-50 whitespace-nowrap pointer-events-none">
          {title}
          <div className="absolute right-full top-1/2 -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-white/85 dark:border-r-[#1e1e1e]/90" />
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => {
    // 从 localStorage 恢复上次选择的会话
    const saved = localStorage.getItem('selected_session_id');
    return saved || 'temporary-session';
  });
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
  const [isAdmin, setIsAdmin] = useState(false);

  // 保存设置
  useEffect(() => {
    localStorage.setItem('settings', JSON.stringify(settings));
  }, [settings]);

  // 检查用户权限（是否是管理员）
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const { getUserAccess } = await import('./services/userAccessApi');
        const user = await getUserAccess();
        setIsAdmin(user.is_owner || user.is_admin || false);
      } catch (error) {
        console.error('[App] Failed to check admin status:', error);
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, []);

  // Electron 环境：加载后端地址配置
  useEffect(() => {
    const loadBackendUrl = async () => {
      if (window.electronAPI?.getBackendUrl) {
        try {
          const backendUrl = await window.electronAPI.getBackendUrl();
          // 缓存到 window 对象，供 getBackendUrl 使用
          (window as any).__cachedBackendUrl = backendUrl;
          console.log('[App] Loaded backend URL from Electron config:', backendUrl);
        } catch (error) {
          console.error('[App] Failed to load backend URL from Electron:', error);
        }
      }
    };
    loadBackendUrl();
  }, []);

  // 保存选中的会话ID
  useEffect(() => {
    if (selectedSessionId) {
      localStorage.setItem('selected_session_id', selectedSessionId);
    }
  }, [selectedSessionId]);

  // 应用主题
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const root = window.document.documentElement;
    return root.classList.contains('dark');
  });

  useEffect(() => {
    const root = window.document.documentElement;
    const isDark = settings.theme === 'dark' || 
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    setIsDarkMode(isDark);
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
    // 选中人设（会话）时，回到普通会话模式
    setIsRoundTableMode(false);
    setIsResearchMode(false);
    setSelectedSessionId(sessionId);
    // 如果当前不在聊天页面，导航到聊天页面
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  const handleSelectMeeting = (roundTableId: string) => {
    setIsResearchMode(false);
    setIsRoundTableMode(true);
    setCurrentRoundTableId(roundTableId);
    if (location.pathname !== '/') navigate('/');
  };

  const handleSelectResearch = (researchSessionId: string) => {
    setIsRoundTableMode(false);
    setIsResearchMode(true);
    setCurrentResearchSessionId(researchSessionId);
    if (location.pathname !== '/') navigate('/');
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
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  // 全局“切换对话”弹窗（Agent / Meeting / Research）
  const [showConversationSwitcher, setShowConversationSwitcher] = useState(false);
  const [switcherSearch, setSwitcherSearch] = useState('');
  const [isLoadingSwitcher, setIsLoadingSwitcher] = useState(false);
  const [switcherAgents, setSwitcherAgents] = useState<Session[]>([]);
  const [switcherMeetings, setSwitcherMeetings] = useState<RoundTable[]>([]);
  const [switcherResearchSessions, setSwitcherResearchSessions] = useState<Session[]>([]);

  useEffect(() => {
    if (!showConversationSwitcher) return;
    let canceled = false;
    (async () => {
      try {
        setIsLoadingSwitcher(true);
        const [agents, meetings, allSessions] = await Promise.all([
          getAgents(),
          getRoundTables(),
          getSessions(),
        ]);
        if (canceled) return;
        setSwitcherAgents(agents || []);
        setSwitcherMeetings(meetings || []);
        const researchSessions = (allSessions || []).filter((s) => s.session_type === 'research');
        setSwitcherResearchSessions(researchSessions);
      } catch (e) {
        if (canceled) return;
        setSwitcherAgents([]);
        setSwitcherMeetings([]);
        setSwitcherResearchSessions([]);
      } finally {
        if (!canceled) setIsLoadingSwitcher(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [showConversationSwitcher]);

  // 左侧边栏显示状态
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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
    <div className="h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 dark:from-[#0f0f0f] dark:via-[#141414] dark:to-[#0f0f0f] flex flex-col transition-colors duration-200 overflow-hidden">
      {/* macOS 专用小标题栏 - 仅用于红黄绿按钮拖拽区域 */}
      {isMac && (
        <div
          className="w-full h-7 flex-shrink-0 app-drag glass-header"
          onDoubleClick={() => {
            window.electronAPI?.toggleMaximize?.();
          }}
        />
      )}
      
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* 左侧导航栏 - 毛玻璃效果 */}
        <nav 
          className={`glass-sidebar flex flex-col items-center flex-shrink-0 z-50 pt-2 transition-all duration-300 ease-in-out overflow-hidden ${
            isSidebarCollapsed ? 'w-0 border-r-0' : 'w-[48px]'
          }`}
        >

        {/* 上方导航：聊天、MCP、Workflow */}
        <div className="flex flex-col items-center space-y-1 w-full px-1 app-no-drag">
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

          <NavItem
            to="/agents"
            icon={<Users className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="智能体管理"
            isActive={location.pathname === '/agents'}
          />

          <NavItem
            to="/role-generator"
            icon={<Sparkles className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="角色生成器"
            isActive={location.pathname === '/role-generator'}
          />

        </div>
        
        <div className="flex-1 app-drag" />
        
        {/* 分隔线 */}
        <div className="w-5 h-px bg-gray-300/50 dark:bg-white/10 my-1 app-no-drag" />
        
        {/* 下方导航：设置、模型录入及其他功能 */}
        <div className="flex flex-col items-center space-y-1 w-full px-1 app-no-drag flex-shrink-0 mb-1.5">
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

          {/* 用户访问管理 - 仅管理员可见 */}
          {isAdmin && (
            <NavItem
              to="/user-access"
              icon={<Shield className="w-[18px] h-[18px]" strokeWidth={1.5} />}
              title="用户访问管理"
              isActive={location.pathname === '/user-access'}
            />
          )}

          <NavItem
            to="/system-status"
            icon={<Activity className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="系统状态"
            isActive={location.pathname === '/system-status'}
          />
          
          {/* 终端按钮 - 点击时独占右侧 */}
          <div className="relative group">
            <Link
              to="/terminal"
              className={`
                w-8 h-8 flex items-center justify-center rounded-lg 
                transition-all duration-200 ease-out relative
                ${isTerminalPage
                  ? 'bg-[var(--color-accent)]/90 text-white backdrop-blur-sm' 
                  : 'text-gray-500 dark:text-[#a0a0a0] hover:bg-white/50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white'
                }
              `}
              title="终端"
            >
              <div className={`transition-transform duration-200 ${isTerminalPage ? '' : 'group-hover:scale-105'}`}>
                <Terminal className="w-4 h-4" strokeWidth={1.5} />
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
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 ease-out text-gray-500 dark:text-[#a0a0a0] hover:bg-white/50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white"
              title="开发者工具 (F12)"
            >
              <div className="transition-transform duration-200 group-hover:scale-105">
                <Code className="w-4 h-4" strokeWidth={1.5} />
              </div>
            </button>
          </div>
        </div>
      </nav>

      {/* 主要内容区域 - 包含 header 和页面内容 */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header - Logo + 模式切换（仅聊天页显示切换按钮）- 毛玻璃效果 */}
        <header 
          className="h-10 flex-shrink-0 glass-header flex items-center justify-between px-3"
        >
          {/* 左侧 Logo */}
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              title="点击隐藏/显示侧边栏"
            >
              <img
                src={isDarkMode ? appLogoDark : appLogoLight}
                alt="chatee"
                className="h-6 w-6 object-contain"
              />
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">chatee</span>
            </div>
          </div>

          {/* 右侧切换对话按钮 */}
          <div className="flex items-center gap-2">
            {isChatPage && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs glass-toolbar"
                onClick={() => {
                  setShowConversationSwitcher(true);
                }}
                title="切换对话（Agent / Meeting / Research）"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>切换</span>
              </Button>
            )}
          </div>
        </header>

        {/* 全局切换对话弹窗（在 Meeting/Research/Agent 模式都可用） */}
        <Dialog
          open={showConversationSwitcher}
          onOpenChange={(open) => {
            setShowConversationSwitcher(open);
            if (!open) setSwitcherSearch('');
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <div className="flex items-center justify-between pr-8">
                <div>
                  <DialogTitle>选择对话</DialogTitle>
                  <DialogDescription>按类型选择：Agent / Meeting / Research</DialogDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8"
                    onClick={() => {
                      setShowConversationSwitcher(false);
                      navigate('/agents');
                    }}
                  >
                    <Users className="w-3.5 h-3.5 mr-1.5" />
                    管理智能体
                  </Button>
                  <Button 
                    variant="primary" 
                    size="sm" 
                    className="h-8"
                    onClick={() => {
                      setShowConversationSwitcher(false);
                      navigate('/role-generator');
                    }}
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                    新建智能体
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <div className="flex items-center gap-2">
              <Input
                value={switcherSearch}
                onChange={(e) => setSwitcherSearch(e.target.value)}
                placeholder="搜索 agent / meeting / research..."
                className="h-9"
              />
            </div>

            <ScrollArea className="h-[60vh] pr-2">
              <div className="space-y-4 py-2">
                {/* Agent */}
                <div>
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 px-1 mb-1">Agent</div>
                  <div className="space-y-1">
                    {(!switcherSearch.trim() || '临时会话'.includes(switcherSearch.trim())) && (
                      <DataListItem
                        id="temporary-session"
                        title="临时会话"
                        description="不保存历史"
                        icon={MessageCircle}
                        isSelected={selectedSessionId === 'temporary-session' && !isRoundTableMode && !isResearchMode}
                        onClick={() => {
                          setShowConversationSwitcher(false);
                          handleSelectSession('temporary-session');
                        }}
                      />
                    )}
                    {isLoadingSwitcher ? (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                    ) : (
                      switcherAgents
                        .filter((a) => {
                          const q = switcherSearch.trim().toLowerCase();
                          if (!q) return true;
                          const name = (a.name || a.title || a.session_id).toLowerCase();
                          const prompt = (a.system_prompt || '').toLowerCase();
                          return name.includes(q) || prompt.includes(q);
                        })
                        .map((a) => (
                          <DataListItem
                            key={a.session_id}
                            id={a.session_id}
                            title={a.name || a.title || `Agent ${a.session_id.slice(0, 8)}`}
                            description={
                              a.system_prompt
                                ? a.system_prompt.split('\n')[0]?.slice(0, 80) + (a.system_prompt.length > 80 ? '...' : '')
                                : `${a.message_count || 0} 条消息 · ${a.last_message_at ? new Date(a.last_message_at).toLocaleDateString() : '无记录'}`
                            }
                            avatar={a.avatar || undefined}
                            isSelected={!isRoundTableMode && !isResearchMode && selectedSessionId === a.session_id}
                            onClick={() => {
                              setShowConversationSwitcher(false);
                              handleSelectSession(a.session_id);
                            }}
                          />
                        ))
                    )}
                  </div>
                </div>

                {/* Meeting */}
                <div>
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 px-1 mb-1">Meeting</div>
                  <div className="space-y-1">
                    {isLoadingSwitcher ? (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                    ) : (
                      switcherMeetings
                        .filter((m) => {
                          const q = switcherSearch.trim().toLowerCase();
                          if (!q) return true;
                          return (m.name || '').toLowerCase().includes(q);
                        })
                        .map((m) => (
                          <DataListItem
                            key={m.round_table_id}
                            id={m.round_table_id}
                            title={m.name || `会议 ${m.round_table_id.slice(0, 8)}`}
                            description={`${m.participant_count} 人 · ${m.status === 'active' ? '进行中' : '已关闭'}`}
                            icon={Users}
                            isSelected={isRoundTableMode && currentRoundTableId === m.round_table_id}
                            onClick={() => {
                              setShowConversationSwitcher(false);
                              handleSelectMeeting(m.round_table_id);
                            }}
                          />
                        ))
                    )}
                    {!isLoadingSwitcher && switcherMeetings.length === 0 && (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">暂无会议</div>
                    )}
                  </div>
                </div>

                {/* Research */}
                <div>
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 px-1 mb-1">Research</div>
                  <div className="space-y-1">
                    {isLoadingSwitcher ? (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                    ) : (
                      switcherResearchSessions
                        .filter((s) => {
                          const q = switcherSearch.trim().toLowerCase();
                          if (!q) return true;
                          const name = (s.name || s.title || s.session_id).toLowerCase();
                          return name.includes(q);
                        })
                        .map((s) => (
                          <DataListItem
                            key={s.session_id}
                            id={s.session_id}
                            title={s.name || s.title || `Research ${s.session_id.slice(0, 8)}`}
                            description="研究资料与检索"
                            icon={BookOpen}
                            isSelected={isResearchMode && currentResearchSessionId === s.session_id}
                            onClick={() => {
                              setShowConversationSwitcher(false);
                              handleSelectResearch(s.session_id);
                            }}
                          />
                        ))
                    )}
                    {!isLoadingSwitcher && switcherResearchSessions.length === 0 && (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">暂无 Research 会话</div>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowConversationSwitcher(false)}>
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 页面内容区域 */}
        <main
          className={`flex flex-col flex-1 min-h-0 transition-all duration-200 relative ${
            isTerminalPage ? 'overflow-visible' : 'overflow-hidden'
          }`}
        >
          
          {isTerminalPage ? (
          /* Terminal 独占页面 */
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-visible m-1">
            <div className="flex-1 rounded-lg glass-panel overflow-visible">
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
          /* 聊天页面 - 毛玻璃效果 */
          <div className="relative flex flex-1 min-h-0 min-w-0 p-0">
            <div className="flex-1 relative overflow-hidden">
              <div
                key={`${isResearchMode ? 'research' : isRoundTableMode ? 'roundtable' : 'chat'}-${selectedSessionId}-${participantRefreshKey}`}
                className="h-full fade-in"
              >
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
                  <Workflow
                    sessionId={selectedSessionId}
                    onSelectSession={handleSelectSession}
                    onSelectMeeting={handleSelectMeeting}
                    onSelectResearch={handleSelectResearch}
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 min-w-0 p-1 gap-1">
            {/* 主内容区域面板 - 毛玻璃效果 */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden rounded-lg glass-panel">
              <div className="flex-1 overflow-hidden min-w-0 flex flex-col relative">
                <div className={`h-full flex flex-col`}>
                  <Routes>
                    {/* 工作流聊天界面 - 全屏显示 */}
                    <Route
                      path="/"
                      element={
                        <Workflow
                          sessionId={selectedSessionId}
                          onSelectSession={handleSelectSession}
                          onSelectMeeting={handleSelectMeeting}
                          onSelectResearch={handleSelectResearch}
                        />
                      }
                    />

                    {/* 工作流编辑器 */}
                    <Route path="/workflow-editor" element={<WorkflowEditor />} />


                    {/* LLM配置页面 */}
                    <Route path="/llm-config" element={<LLMConfigPanel />} />

                    {/* MCP配置页面 */}
                    <Route path="/mcp-config" element={<MCPConfig />} />

                    {/* 爬虫配置页面 */}
                    <Route path="/crawler-config" element={<CrawlerConfigPage />} />

                    {/* 系统状态页面 */}
                    <Route path="/system-status" element={<SystemStatusPanel />} />

                  {/* Terminal 页面 */}
                  <Route path="/terminal" element={<div />} />

                    {/* 设置页面 */}
                    <Route path="/settings" element={
                      <SettingsPanel
                        settings={settings}
                        onUpdateSettings={updateSettings}
                      />
                    } />

                    {/* 用户访问管理页面 */}
                    <Route path="/user-access" element={<UserAccessPage />} />

                    {/* 智能体管理页面 */}
                    <Route path="/agents" element={<AgentsPage />} />

                    {/* 角色生成器页面 */}
                    <Route path="/role-generator" element={<RoleGeneratorPage />} />
                  </Routes>
                </div>
              </div>
            </div>

            {/* 右侧终端区域 - 毛玻璃效果 */}
            {isTerminalOpen && !isTerminalPage && (
              <div className="w-[45%] min-w-[400px] flex flex-col min-h-0 min-w-0 flex-shrink-0 rounded-lg glass-panel overflow-visible slide-in-right">
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
    </div>
  );
};

export default App;
