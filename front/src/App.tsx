import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { Brain, Plug, Workflow as WorkflowIcon, Settings, Code, MessageCircle, Globe, Sparkles, Bot, Users, BookOpen, Activity, Plus, FolderOpen, Image as ImageIcon, Palette, Check, Type } from 'lucide-react';
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
import SettingsPanel from './components/SettingsPanel';
import LLMConfigPanel from './components/LLMConfig';
import MCPConfig from './components/MCPConfig';
import WorkflowEditor from './components/WorkflowEditor';
import Workflow from './components/Workflow';
import CrawlerConfigPage from './components/CrawlerConfigPage';
import AgentsPage from './components/AgentsPage';
// 新架构组件
import SystemStatusPanel from './components/SystemStatusPanel';
import StatusBar from './components/StatusBar';
import { getAgents, getSessions, createSession, deleteSession, type Session } from './services/sessionApi';
import { getRoundTables, type RoundTable } from './services/roundTableApi';
import { toast } from './components/ui/use-toast';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import MediaLibraryPage from './components/MediaLibraryPage';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/DropdownMenu';

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

export type SkinId = 'default' | 'niho';

export type FontId = 'default' | 'pixel' | 'terminal' | 'rounded' | 'dotgothic' | 'silkscreen';

interface Settings {
  theme: 'light' | 'dark' | 'system';
  skin: SkinId;
  font: FontId;
  autoRefresh: boolean;
  refreshInterval: number;
  videoColumns: number;
  enableToolCalling: boolean;
}

const App: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => {
    // 从 localStorage 恢复上次选择的会话
    const saved = localStorage.getItem('chatee_last_open_chat');
    // 兼容旧的 key
    const legacy = localStorage.getItem('selected_session_id');
    return saved || legacy || 'temporary-session';
  });
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { theme: 'system', skin: 'default', font: 'default', autoRefresh: false, refreshInterval: 60, videoColumns: 4, enableToolCalling: true, ...parsed };
      } catch {
        return { theme: 'system', skin: 'default', font: 'default', autoRefresh: false, refreshInterval: 60, videoColumns: 4, enableToolCalling: true };
      }
    }
    return { theme: 'system', skin: 'default', font: 'default', autoRefresh: false, refreshInterval: 60, videoColumns: 4, enableToolCalling: true };
  });

  // 保存设置
  useEffect(() => {
    localStorage.setItem('settings', JSON.stringify(settings));
  }, [settings]);



  // 保存选中的会话ID（用于重启后恢复）
  useEffect(() => {
    if (selectedSessionId) {
      localStorage.setItem('chatee_last_open_chat', selectedSessionId);
      // 清理旧的 key（如果存在）
      if (localStorage.getItem('selected_session_id')) {
        localStorage.removeItem('selected_session_id');
      }
    }
  }, [selectedSessionId]);

  // 应用主题
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const root = window.document.documentElement;
    return root.classList.contains('dark');
  });

  // 应用主题（light/dark）与皮肤（default/niho）；移动端强制 niho
  useEffect(() => {
    const root = window.document.documentElement;
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const skin = mobile ? 'niho' : settings.skin;
    root.setAttribute('data-skin', skin);
    root.setAttribute('data-mobile', mobile ? 'true' : 'false');

    const isNiho = skin === 'niho';
    const isDark = isNiho || settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    setIsDarkMode(isDark);
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme, settings.skin]);

  // 同步 data-mobile 与移动端强制 niho（resize 时）
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => {
      const root = document.documentElement;
      const mobile = mq.matches;
      root.setAttribute('data-mobile', mobile ? 'true' : 'false');
      if (mobile) root.setAttribute('data-skin', 'niho');
      else root.setAttribute('data-skin', settings.skin);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [settings.skin]);

  // 应用字体
  useEffect(() => {
    document.documentElement.setAttribute('data-font', settings.font);
  }, [settings.font]);

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

  // 判断是否显示terminal独占页面
  
  // 判断是否为聊天页面
  const isChatPage = location.pathname === '/';
  
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  // 全局"切换对话"弹窗（Agent / Topic）
  const [showConversationSwitcher, setShowConversationSwitcher] = useState(false);
  const [switcherSearch, setSwitcherSearch] = useState('');
  const [isLoadingSwitcher, setIsLoadingSwitcher] = useState(false);
  const [switcherAgents, setSwitcherAgents] = useState<Session[]>([]);
  const [switcherTopics, setSwitcherTopics] = useState<Session[]>([]);
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<Session | null>(null);

  // 媒体库已升级为主页面（/media-library），不再使用弹窗

  const loadSwitcherData = async () => {
    try {
      setIsLoadingSwitcher(true);
      const [agents, sessions] = await Promise.all([getAgents(), getSessions()]);
      setSwitcherAgents(agents || []);
      const topics = (sessions || []).filter(s => s.session_type === 'topic_general');
      setSwitcherTopics(topics);
    } catch (e) {
      setSwitcherAgents([]);
      setSwitcherTopics([]);
    } finally {
      setIsLoadingSwitcher(false);
    }
  };

  useEffect(() => {
    if (!showConversationSwitcher) return;
    loadSwitcherData();
  }, [showConversationSwitcher]);

  // 处理删除会话
  const handleDeleteSessionConfirm = async (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteSessionTarget(session);
  };

  const performDeleteSession = async () => {
    if (!deleteSessionTarget) return;
    const { session_id, name, title } = deleteSessionTarget;
    try {
      await deleteSession(session_id);
      toast({
        title: '已删除',
        description: `「${name || title || '会话'}」已成功删除`,
        variant: 'success',
      });
      
      // 如果删除的是当前选中的会话，切换到临时会话
      if (selectedSessionId === session_id) {
        handleSelectSession('temporary-session');
      }
      
      // 刷新列表
      await loadSwitcherData();
    } catch (error) {
      console.error('[App] Failed to delete session:', error);
      toast({
        title: '删除失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setDeleteSessionTarget(null);
    }
  };

  // 创建新话题
  const handleCreateTopic = async () => {
    try {
      setIsCreatingTopic(true);
      const newSession = await createSession(undefined, undefined, 'topic_general');
      setShowConversationSwitcher(false);
      handleSelectSession(newSession.session_id);
      toast({
        title: '话题已创建',
        description: '新话题已创建，开始对话吧！',
        variant: 'success',
      });
    } catch (error) {
      console.error('[App] Failed to create topic:', error);
      toast({
        title: '创建话题失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsCreatingTopic(false);
    }
  };

  // 左侧边栏显示状态（移动端默认收起）
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => {
      setIsMobile(mq.matches);
      if (mq.matches) setIsSidebarCollapsed(true);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className={`app-root-bg h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 dark:from-[#0f0f0f] dark:via-[#141414] dark:to-[#0f0f0f] flex flex-col transition-colors duration-200 overflow-hidden ${isMobile ? 'mobile-no-status-bar' : ''}`}>
      {/* macOS 专用小标题栏 - 仅用于红黄绿按钮拖拽区域 */}
      
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
      {/* 移动端侧栏遮罩 */}
      {isMobile && !isSidebarCollapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-hidden
          onClick={() => setIsSidebarCollapsed(true)}
        />
      )}
      {/* 左侧导航栏 - 毛玻璃效果；移动端为浮层 */}
        <nav 
          className={`glass-sidebar flex flex-col items-center flex-shrink-0 z-50 pt-2 transition-all duration-300 ease-in-out overflow-hidden ${
            isSidebarCollapsed ? 'w-0 border-r-0' : 'w-[48px]'
          } ${isMobile && !isSidebarCollapsed ? 'fixed left-0 top-0 bottom-0 shadow-xl' : ''}`}
          style={isMobile && !isSidebarCollapsed ? { paddingTop: 'calc(0.5rem + var(--safe-area-inset-top))' } : undefined}
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
            to="/media-library"
            icon={<ImageIcon className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="媒体库"
            isActive={location.pathname === '/media-library'}
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

          <NavItem
            to="/system-status"
            icon={<Activity className="w-[18px] h-[18px]" strokeWidth={1.5} />}
            title="系统状态"
            isActive={location.pathname === '/system-status'}
          />

          {/* DevTools 按钮 */}
          <div className="relative group">
            <button
              onClick={() => {
                alert('在浏览器环境中，请使用以下快捷键打开开发者工具：\n\nWindows/Linux: F12 或 Ctrl+Shift+I\nMac: Cmd+Option+I');
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
          className="h-10 flex-shrink-0 glass-header flex items-center justify-between px-3 min-h-[44px] md:min-h-0"
          style={isMobile ? { paddingTop: 'max(0.25rem, var(--safe-area-inset-top))', paddingLeft: 'calc(0.75rem + var(--safe-area-inset-left))', paddingRight: 'calc(0.75rem + var(--safe-area-inset-right))' } : undefined}
        >
          {/* 左侧 Logo - 移动端满足 44px 触摸目标 */}
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity touch-target min-h-[44px] min-w-[44px] -m-2 p-2 md:min-h-0 md:min-w-0 md:m-0 md:p-0"
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

          {/* 右侧：字体 + 皮肤（仅桌面端）+ 切换对话按钮 */}
          <div className="flex items-center gap-2">
            {!isMobile && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs glass-toolbar gap-1.5"
                      title="切换字体"
                    >
                      <Type className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline max-w-[4rem] truncate">
                        {settings.font === 'default' ? '默认' : settings.font === 'pixel' ? '像素' : settings.font === 'terminal' ? '终端' : settings.font === 'rounded' ? '圆体' : settings.font === 'dotgothic' ? '点阵' : '像素屏'}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[160px] max-h-[70vh] overflow-y-auto">
                    <DropdownMenuItem onClick={() => updateSettings({ font: 'default' })} className="flex items-center justify-between">
                      <span>默认 (Inter)</span>
                      {settings.font === 'default' && <Check className="w-4 h-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => updateSettings({ font: 'pixel' })} className="flex items-center justify-between">
                      <span>像素 (Press Start 2P)</span>
                      {settings.font === 'pixel' && <Check className="w-4 h-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => updateSettings({ font: 'terminal' })} className="flex items-center justify-between">
                      <span>终端 (VT323)</span>
                      {settings.font === 'terminal' && <Check className="w-4 h-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => updateSettings({ font: 'rounded' })} className="flex items-center justify-between">
                      <span>圆体 (Comfortaa)</span>
                      {settings.font === 'rounded' && <Check className="w-4 h-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => updateSettings({ font: 'dotgothic' })} className="flex items-center justify-between">
                      <span>点阵 (DotGothic16)</span>
                      {settings.font === 'dotgothic' && <Check className="w-4 h-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => updateSettings({ font: 'silkscreen' })} className="flex items-center justify-between">
                      <span>像素屏 (Silkscreen)</span>
                      {settings.font === 'silkscreen' && <Check className="w-4 h-4" />}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs glass-toolbar gap-1.5"
                      title="切换皮肤"
                    >
                      <Palette className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">
                        {settings.skin === 'niho' ? 'Niho' : '默认'}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[140px]">
                    <DropdownMenuItem
                      onClick={() => updateSettings({ skin: 'default' })}
                      className="flex items-center justify-between"
                    >
                      <span>Chatee 默认</span>
                      {settings.skin === 'default' && <Check className="w-4 h-4" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => updateSettings({ skin: 'niho' })}
                      className="flex items-center justify-between"
                    >
                      <span>Niho 霓虹</span>
                      {settings.skin === 'niho' && <Check className="w-4 h-4" />}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {isChatPage && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs glass-toolbar"
                onClick={() => {
                  setShowConversationSwitcher(true);
                }}
                title="切换对话（智能体 / 话题）"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>切换</span>
              </Button>
            )}
          </div>
        </header>

        {/* 全局切换对话弹窗（Agent / Topic） */}
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
                  <DialogDescription>选择智能体或话题开始对话</DialogDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8"
                    onClick={handleCreateTopic}
                    disabled={isCreatingTopic}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    {isCreatingTopic ? '创建中...' : '新建话题'}
                  </Button>
                  <Button 
                    variant="primary" 
                    size="sm" 
                    className="h-8"
                    onClick={() => {
                      setShowConversationSwitcher(false);
                      navigate('/agents', { state: { openGenerator: true } });
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
                placeholder="搜索智能体或话题..."
                className="h-9"
              />
            </div>

            <ScrollArea className="h-[60vh] pr-2 w-full">
              <div className="space-y-4 py-2 w-full min-w-0">
                {/* 临时会话 */}
                {(!switcherSearch.trim() || '临时会话'.includes(switcherSearch.trim())) && (
                  <div className="w-full">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 px-1 mb-1 flex items-center gap-1.5">
                      <MessageCircle className="w-3.5 h-3.5" />
                      快速开始
                    </div>
                    <div className="space-y-1 w-full">
                      <DataListItem
                        id="temporary-session"
                        title="临时会话"
                        description="不保存历史记录，适合快速提问"
                        icon={MessageCircle}
                        isSelected={selectedSessionId === 'temporary-session'}
                        onClick={() => {
                          setShowConversationSwitcher(false);
                          handleSelectSession('temporary-session');
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* 智能体 */}
                <div className="w-full">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 px-1 mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5" />
                      智能体
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        setShowConversationSwitcher(false);
                        navigate('/agents');
                      }}
                    >
                      <Users className="w-3 h-3 mr-1" />
                      管理
                    </Button>
                  </div>
                  <div className="space-y-1 w-full">
                    {isLoadingSwitcher ? (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                    ) : switcherAgents.length === 0 ? (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-3 text-center">
                        暂无智能体，点击右上角「新建智能体」创建
                      </div>
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
                            isSelected={selectedSessionId === a.session_id}
                            onClick={() => {
                              setShowConversationSwitcher(false);
                              handleSelectSession(a.session_id);
                            }}
                            onDelete={(e) => handleDeleteSessionConfirm(a, e)}
                          />
                        ))
                    )}
                  </div>
                </div>

                {/* 话题 */}
                <div className="w-full">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 px-1 mb-1 flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5" />
                    话题
                  </div>
                  <div className="space-y-1 w-full">
                    {isLoadingSwitcher ? (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                    ) : switcherTopics.length === 0 ? (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-3 text-center">
                        暂无话题，点击右上角「新建话题」创建
                      </div>
                    ) : (
                      switcherTopics
                        .filter((t) => {
                          const q = switcherSearch.trim().toLowerCase();
                          if (!q) return true;
                          const name = (t.name || t.title || t.preview_text || t.session_id).toLowerCase();
                          return name.includes(q);
                        })
                        .map((t) => (
                          <DataListItem
                            key={t.session_id}
                            id={t.session_id}
                            title={t.name || t.title || t.preview_text || `话题 ${t.session_id.slice(0, 8)}`}
                            description={`${t.message_count || 0} 条消息 · ${t.last_message_at ? new Date(t.last_message_at).toLocaleDateString() : '无记录'}`}
                            icon={FolderOpen}
                            isSelected={selectedSessionId === t.session_id}
                            onClick={() => {
                              setShowConversationSwitcher(false);
                              handleSelectSession(t.session_id);
                            }}
                            onDelete={(e) => handleDeleteSessionConfirm(t, e)}
                          />
                        ))
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
          className={`flex flex-col flex-1 min-h-0 transition-all duration-200 relative overflow-hidden`}
        >
          
          {isChatPage ? (
          /* 聊天页面 - 毛玻璃效果 */
          <div className="relative flex flex-1 min-h-0 min-w-0 p-0">
            <div className="flex-1 relative overflow-hidden">
              <div
                key={`chat-${selectedSessionId}`}
                className="h-full fade-in"
              >
                  <Workflow
                    sessionId={selectedSessionId}
                    onSelectSession={handleSelectSession}
                    enableToolCalling={settings.enableToolCalling}
                    onToggleToolCalling={(enabled) => updateSettings({ enableToolCalling: enabled })}
                  />
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
                          enableToolCalling={settings.enableToolCalling}
                          onToggleToolCalling={(enabled) => updateSettings({ enableToolCalling: enabled })}
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

                    {/* 设置页面 */}
                    <Route path="/settings" element={
                      <SettingsPanel
                        settings={settings}
                        onUpdateSettings={updateSettings}
                      />
                    } />


                    {/* 智能体管理页面 */}
                    <Route path="/agents" element={<AgentsPage />} />

                    {/* 媒体库 */}
                    <Route path="/media-library" element={<MediaLibraryPage />} />
                  </Routes>
                </div>
              </div>
            </div>

          </div>
        )}
        </main>
      </div>
      </div>

      <ConfirmDialog
        open={deleteSessionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteSessionTarget(null);
        }}
        title="删除确认"
        description={`您确定要删除「${deleteSessionTarget?.name || deleteSessionTarget?.title || '该会话'}」吗？此操作不可撤销，所有历史消息都将丢失。`}
        variant="destructive"
        onConfirm={performDeleteSession}
      />

      {/* 底部状态栏 - 移动端不显示 */}
      {!isMobile && <StatusBar />}
    </div>
  );
};

export default App;
