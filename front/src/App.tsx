import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { Brain, Plug, Settings, MessageCircle, Globe, Bot, Users, BookOpen, Plus, FolderOpen, Image as ImageIcon } from 'lucide-react';
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
import Workflow from './components/Workflow';
import CrawlerConfigPage from './components/CrawlerConfigPage';
import AgentsPage from './components/AgentsPage';
// 新架构组件
import StatusBar from './components/StatusBar';
import { getAgents, getSessions, createSession, deleteSession, type Session } from './services/sessionApi';
import { toast } from './components/ui/use-toast';
import { ConfirmDialog } from './components/ui/ConfirmDialog';

// 导航项组件 - 带动画和tooltip
interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  isActive: boolean;
  isNiho?: boolean;
  tooltipPlacement?: 'right' | 'bottom';
}

const NavItem: React.FC<NavItemProps> = ({ to, icon, title, isActive, isNiho, tooltipPlacement = 'right' }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const inactiveClass = isNiho
    ? 'text-[var(--color-highlight)] hover:bg-white/5 hover:opacity-90'
    : 'text-gray-500 dark:text-[#a0a0a0] hover:bg-white/50 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white';

  const tooltipBottom = tooltipPlacement === 'bottom';
  return (
    <div className="relative group">
      <Link
        to={to}
        className={`
          w-8 h-8 flex items-center justify-center rounded-lg 
          transition-all duration-200 ease-out relative
          ${isActive 
            ? `bg-[var(--color-accent)]/90 shadow-sm backdrop-blur-sm ${isNiho ? 'text-[var(--color-highlight)]' : 'text-white'}`
            : inactiveClass
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
      {/* Tooltip - 毛玻璃效果；顶部导航时显示在下方 */}
      {showTooltip && (
        <div
          className={`absolute px-2 py-1 glass-popup text-gray-800 dark:text-white text-xs z-50 whitespace-nowrap pointer-events-none ${
            tooltipBottom ? 'left-1/2 -translate-x-1/2 top-full mt-2' : 'left-full ml-2 top-1/2 -translate-y-1/2'
          }`}
        >
          {title}
          <div
            className={`absolute w-0 h-0 border-transparent ${
              tooltipBottom
                ? 'left-1/2 -translate-x-1/2 bottom-full border-b-[6px] border-b-white/85 dark:border-b-[#1e1e1e]/90 border-x-4 border-x-transparent'
                : 'right-full top-1/2 -translate-y-1/2 border-t-4 border-b-4 border-r-4 border-r-white/85 dark:border-r-[#1e1e1e]/90'
            }`}
          />
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
  const DEFAULT_AGENT_ID = 'agent_chaya'; // 默认 Agent ID
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => {
    // 从 localStorage 恢复上次选择的会话
    const saved = localStorage.getItem('chatee_last_open_chat');
    // 兼容旧的 key
    const legacy = localStorage.getItem('selected_session_id');
    // 如果之前选择的是临时会话，重定向到默认 Agent
    const lastSession = saved || legacy;
    if (!lastSession || lastSession === 'temporary-session') {
      return DEFAULT_AGENT_ID;
    }
    return lastSession;
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

  // Chaya 头像（用于左侧导航第一项）
  const [chayaAvatar, setChayaAvatar] = useState<string | null>(null);
  useEffect(() => {
    getAgents().then((agents) => {
      const chaya = agents?.find((a) => a.session_id === DEFAULT_AGENT_ID);
      setChayaAvatar(chaya?.avatar ?? null);
    }).catch(() => setChayaAvatar(null));
  }, []);

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

  // 应用主题（light/dark/niho）
  useEffect(() => {
    const root = window.document.documentElement;
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    
    // 获取当前主题（兼容旧的 theme + skin 组合）
    const currentTheme = settings.theme === 'niho' || settings.skin === 'niho' 
      ? 'niho' 
      : settings.theme === 'dark' 
      ? 'dark' 
      : 'light';
    
    // 移动端强制使用霓虹主题
    const effectiveTheme = mobile ? 'niho' : currentTheme;
    
    root.setAttribute('data-skin', effectiveTheme === 'niho' ? 'niho' : 'default');
    root.setAttribute('data-mobile', mobile ? 'true' : 'false');

    const isNiho = effectiveTheme === 'niho';
    const isDark = isNiho || effectiveTheme === 'dark';

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
      
      // 获取当前主题
      const currentTheme = settings.theme === 'niho' || settings.skin === 'niho' 
        ? 'niho' 
        : settings.theme === 'dark' 
        ? 'dark' 
        : 'light';
      const effectiveTheme = mobile ? 'niho' : currentTheme;
      
      root.setAttribute('data-skin', effectiveTheme === 'niho' ? 'niho' : 'default');
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [settings.theme, settings.skin]);

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


  const loadSwitcherData = async (validateSelection: boolean = false) => {
    try {
      setIsLoadingSwitcher(true);
      const [agents, sessions] = await Promise.all([getAgents(), getSessions()]);
      setSwitcherAgents(agents || []);
      const topics = (sessions || []).filter(s => s.session_type === 'topic_general');
      setSwitcherTopics(topics);
      
      // 验证当前选择的会话是否存在（仅在需要时验证，避免无限循环）
      if (validateSelection) {
        const currentId = selectedSessionId;
        if (currentId) {
          const allSessions = [...(agents || []), ...(sessions || [])];
          const sessionExists = allSessions.some(s => s.session_id === currentId);
          if (!sessionExists && currentId !== DEFAULT_AGENT_ID) {
            // 当前选择的会话不存在，切换到默认 Agent
            handleSelectSession(DEFAULT_AGENT_ID);
          }
        } else {
          // 如果没有选择任何会话，默认选择 chaya
          handleSelectSession(DEFAULT_AGENT_ID);
        }
      }
    } catch (e) {
      setSwitcherAgents([]);
      setSwitcherTopics([]);
      // 如果加载失败且需要验证选择，且没有选择会话，默认选择 chaya
      if (validateSelection && !selectedSessionId) {
        handleSelectSession(DEFAULT_AGENT_ID);
      }
    } finally {
      setIsLoadingSwitcher(false);
    }
  };

  useEffect(() => {
    if (!showConversationSwitcher) return;
    loadSwitcherData(false); // 切换器打开时不需要验证选择
  }, [showConversationSwitcher]);

  // 应用启动时加载会话列表并验证默认选择
  useEffect(() => {
    loadSwitcherData(true); // 启动时验证选择
  }, []); // 只在组件挂载时执行一次

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
      
      // 如果删除的是当前选中的会话，切换到默认 Agent
      if (selectedSessionId === session_id) {
        handleSelectSession(DEFAULT_AGENT_ID);
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

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isNiho = isMobile || settings.theme === 'niho' || settings.skin === 'niho';

  return (
    <div className={`app-root-bg h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 dark:from-[#0f0f0f] dark:via-[#141414] dark:to-[#0f0f0f] flex flex-col transition-colors duration-200 overflow-hidden ${isMobile ? 'mobile-no-status-bar' : ''}`}>
      {/* macOS 专用小标题栏 - 仅用于红黄绿按钮拖拽区域 */}
      
      {/* 顶部导航栏 - 居中向两边扩散的图标 */}
      <nav
        className="glass-top-nav z-50 flex items-center justify-center gap-2 py-2 px-2 app-no-drag"
        style={isMobile ? { paddingTop: 'calc(0.5rem + var(--safe-area-inset-top))' } : undefined}
      >
        <NavItem
          to="/"
          icon={
            chayaAvatar ? (
              <img src={chayaAvatar} alt="Chaya" className="w-[18px] h-[18px] rounded-full object-cover" />
            ) : isDarkMode ? (
              <img src={appLogoDark} alt="Chaya" className="w-[18px] h-[18px] object-contain" />
            ) : (
              <img src={appLogoLight} alt="Chaya" className="w-[18px] h-[18px] object-contain" />
            )
          }
          title="Chaya 对话"
          isActive={location.pathname === '/'}
          isNiho={isNiho}
          tooltipPlacement="bottom"
        />
        <NavItem
          to="/agents"
          icon={<Users className="w-[18px] h-[18px]" strokeWidth={1.5} />}
          title="Persona 管理"
          isActive={location.pathname === '/agents'}
          isNiho={isNiho}
          tooltipPlacement="bottom"
        />
        <NavItem
          to="/llm-config"
          icon={<Brain className="w-[18px] h-[18px]" strokeWidth={1.5} />}
          title="大模型录入"
          isActive={location.pathname === '/llm-config'}
          isNiho={isNiho}
          tooltipPlacement="bottom"
        />
        <NavItem
          to="/mcp-config"
          icon={<Plug className="w-[18px] h-[18px]" strokeWidth={1.5} />}
          title="mcp录入"
          isActive={location.pathname === '/mcp-config'}
          isNiho={isNiho}
          tooltipPlacement="bottom"
        />
        <NavItem
          to="/crawler-config"
          icon={<Globe className="w-[18px] h-[18px]" strokeWidth={1.5} />}
          title="爬虫"
          isActive={location.pathname === '/crawler-config'}
          isNiho={isNiho}
          tooltipPlacement="bottom"
        />
        <NavItem
          to="/settings"
          icon={<Settings className="w-[18px] h-[18px]" strokeWidth={1.5} />}
          title="设置"
          isActive={location.pathname === '/settings'}
          isNiho={isNiho}
          tooltipPlacement="bottom"
        />
      </nav>

      {/* 主要内容区域 - 无 header，直接为页面内容 */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
                      设置
                    </Button>
                  </div>
                  <div className="space-y-1 w-full">
                    {isLoadingSwitcher ? (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                    ) : switcherAgents.length === 0 ? (
                      <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-3 text-center">
                        Chaya 是系统提供的智能体，可在「Persona 管理」中切换人设与声音
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



                    {/* LLM配置页面 */}
                    <Route path="/llm-config" element={<LLMConfigPanel />} />

                    {/* MCP配置页面 */}
                    <Route path="/mcp-config" element={<MCPConfig />} />

                    {/* 爬虫配置页面 */}
                    <Route path="/crawler-config" element={<CrawlerConfigPage />} />

                    {/* 设置页面 */}
                    <Route path="/settings" element={
                      <SettingsPanel
                        settings={settings}
                        onUpdateSettings={updateSettings}
                      />
                    } />


                    {/* 智能体管理页面 */}
                    <Route path="/agents" element={<AgentsPage />} />

                  </Routes>
                </div>
              </div>
            </div>

          </div>
        )}
        </main>
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
