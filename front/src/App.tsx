import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Settings,
  Bot,
  Users,
  Plus,
  FolderOpen,
  Film,
  Sun,
  Moon,
  MessageSquare,
  Package,
  Plug,
  Palette,
  Hand,
  Sparkles,
  Radio,
  Headphones,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
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
import McpWorkspacePanel from './components/McpWorkspacePanel';
import McpSupportPage from './components/McpSupportPage';
import Workflow from './components/Workflow';
import AgentsPage from './components/AgentsPage';
import MediaCreatorPage from './components/MediaCreatorPage';
import CommunicationPage from './components/CommunicationPage';
import SkillPackEntryPage from './components/SkillPackEntryPage';
import AgentPersonaDialog from './components/AgentPersonaDialog';
import { getAgents, getSessions, createSession, deleteSession, getSession, type Session } from './services/sessionApi';
import { toast } from './components/ui/use-toast';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { CapsuleToggle } from './components/ui/CapsuleToggle';
import { SESSIONS_CHANGED_EVENT } from './utils/sessionEvents';
import { MCP_AUTO_USE_LS_KEY, readMcpAutoUseEnabled, writeMcpAutoUseEnabled } from './utils/mcpAutoUse';
import { ChillPage } from './components/ChillPage';
import { ChillMiniBar } from './components/ChillMiniBar';
import { ChillGlobalPlayer } from './components/ChillGlobalPlayer';
import type { ChillPanelTab } from './components/ChillPanel';

export type SkinId = 'light' | 'niho';
export type FontId = 'default' | 'pixel' | 'terminal' | 'rounded' | 'dotgothic' | 'silkscreen';

interface Settings {
  font: FontId;
  autoRefresh: boolean;
  refreshInterval: number;
  videoColumns: number;
  enableToolCalling: boolean;
}

type MainModule = 'chat' | 'media' | 'chill' | 'settings';
type ChatSubTab = 'chaya' | 'mcp' | 'skill' | 'persona' | 'communication';
type MediaSubTab = 'image' | 'video';
type SettingsSubTab = 'general' | 'llm';

const LS_MAIN = 'chatee_main_module';
const LS_CHAT_SUB = 'chatee_chat_sub_tab';
const LS_MEDIA_SUB = 'chatee_media_sub_tab';
const LS_SETTINGS_SUB = 'chatee_settings_sub_tab';
const LS_CHILL_SUB = 'chatee_chill_sub_tab';
const LS_OPEN_AGENT_TABS = 'chatee_open_agent_tabs';
const LS_AGENT_LIST_COLLAPSED = 'chatee_agent_list_collapsed';

function readLs<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw && allowed.includes(raw as T)) return raw as T;
  } catch { /* */ }
  return fallback;
}

/** 右侧书签导航按钮 */
const RailBtn: React.FC<{
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ active, onClick, title, children }) => {
  const [tip, setTip] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setTip(true)}
        onMouseLeave={() => setTip(false)}
        title=""
        className={`app-rail-btn ${active ? 'app-rail-btn--active' : ''}`}
      >
        {children}
      </button>
      {tip && (
        <div className="app-rail-tooltip">
          {title}
          <span className="app-rail-tooltip-arrow" />
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const isElectron =
    import.meta.env.VITE_ELECTRON === 'true' ||
    (typeof window !== 'undefined' && !!window.chateeElectron?.isElectron);

  const isDarwin =
    typeof window !== 'undefined' &&
    (window.chateeElectron?.platform === 'darwin' || /Mac|iPhone|iPad/.test(navigator.platform ?? ''));

  const location = useLocation();
  const navigate = useNavigate();
  const DEFAULT_AGENT_ID = 'agent_chaya';
  const normalizeOpenAgentTabs = useCallback((ids: string[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!unique.includes(DEFAULT_AGENT_ID)) unique.unshift(DEFAULT_AGENT_ID);
    return unique;
  }, [DEFAULT_AGENT_ID]);

  // ── 主模块 / 子 Tab 状态 ──
  const [mainModule, setMainModule] = useState<MainModule>(() =>
    readLs(LS_MAIN, ['chat', 'media', 'chill', 'settings'] as const, 'chat'),
  );
  const [chatSubTab, setChatSubTab] = useState<ChatSubTab>(() =>
    readLs(LS_CHAT_SUB, ['chaya', 'mcp', 'skill', 'persona', 'communication'] as const, 'chaya'),
  );
  const [mediaSubTab, setMediaSubTab] = useState<MediaSubTab>(() =>
    readLs(LS_MEDIA_SUB, ['image', 'video'] as const, 'image'),
  );
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>(() =>
    readLs(LS_SETTINGS_SUB, ['general', 'llm'] as const, 'general'),
  );
  const [chillSubTab, setChillSubTab] = useState<ChillPanelTab>(() =>
    readLs(LS_CHILL_SUB, ['live', 'search'] as const, 'live'),
  );

  useEffect(() => {
    try {
      localStorage.setItem(LS_MAIN, mainModule);
      localStorage.setItem(LS_CHAT_SUB, chatSubTab);
      localStorage.setItem(LS_MEDIA_SUB, mediaSubTab);
      localStorage.setItem(LS_SETTINGS_SUB, settingsSubTab);
      localStorage.setItem(LS_CHILL_SUB, chillSubTab);
    } catch { /* */ }
  }, [mainModule, chatSubTab, mediaSubTab, settingsSubTab, chillSubTab]);

  const isMcpSupportRoute = location.pathname === '/mcp-support';
  const [mcpAutoUse, setMcpAutoUse] = useState(() => readMcpAutoUseEnabled());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === MCP_AUTO_USE_LS_KEY || e.key === null) {
        setMcpAutoUse(readMcpAutoUseEnabled());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const onMcpAutoUseChange = useCallback((checked: boolean) => {
    writeMcpAutoUseEnabled(checked);
    setMcpAutoUse(checked);
  }, []);

  useEffect(() => {
    if (location.pathname === '/mcp-support' && mainModule !== 'chat') {
      navigate('/', { replace: true });
    }
  }, [mainModule, location.pathname, navigate]);

  // ── 会话 ──
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => {
    const saved = localStorage.getItem('chatee_last_open_chat');
    const legacy = localStorage.getItem('selected_session_id');
    const lastSession = saved || legacy;
    if (!lastSession || lastSession === 'temporary-session') return DEFAULT_AGENT_ID;
    return lastSession;
  });
  const [openAgentTabIds, setOpenAgentTabIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LS_OPEN_AGENT_TABS);
      if (!raw) return [DEFAULT_AGENT_ID];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [DEFAULT_AGENT_ID];
      const ids = parsed.filter((id) => typeof id === 'string') as string[];
      return ids.length > 0 ? Array.from(new Set(ids)) : [DEFAULT_AGENT_ID];
    } catch {
      return [DEFAULT_AGENT_ID];
    }
  });
  const [isCreatingAgentTab, setIsCreatingAgentTab] = useState(false);
  const [isAgentListCollapsed, setIsAgentListCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_AGENT_LIST_COLLAPSED) === '1';
    } catch {
      return false;
    }
  });

  const [settings, setSettings] = useState<Settings>(() => {
    const saved = localStorage.getItem('settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const { theme, skin, ...rest } = parsed;
        return { font: 'default', autoRefresh: false, refreshInterval: 60, videoColumns: 4, enableToolCalling: true, ...rest };
      } catch { return { font: 'default', autoRefresh: false, refreshInterval: 60, videoColumns: 4, enableToolCalling: true }; }
    }
    return { font: 'default', autoRefresh: false, refreshInterval: 60, videoColumns: 4, enableToolCalling: true };
  });

  const [chayaAvatar, setChayaAvatar] = useState<string | null>(null);
  const loadChayaAvatar = useCallback(async () => {
    try {
      const agents = await getAgents();
      const avatar = agents?.find((a) => a.session_id === DEFAULT_AGENT_ID)?.avatar ?? null;
      setChayaAvatar((avatar && avatar.trim()) ? avatar : null);
    } catch {
      setChayaAvatar(null);
    }
  }, [DEFAULT_AGENT_ID]);

  useEffect(() => {
    loadChayaAvatar();
  }, [loadChayaAvatar]);

  useEffect(() => {
    const handleSessionsChanged = () => {
      loadChayaAvatar();
    };
    window.addEventListener(SESSIONS_CHANGED_EVENT, handleSessionsChanged);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, handleSessionsChanged);
  }, [loadChayaAvatar]);

  useEffect(() => { localStorage.setItem('settings', JSON.stringify(settings)); }, [settings]);

  useEffect(() => {
    if (selectedSessionId) {
      localStorage.setItem('chatee_last_open_chat', selectedSessionId);
      if (localStorage.getItem('selected_session_id')) localStorage.removeItem('selected_session_id');
    }
  }, [selectedSessionId]);

  // ── 皮肤 ──
  const SKIN_STORAGE_KEY = 'chatee_skin';
  const [skin, setSkin] = useState<SkinId>(() => {
    try { const s = localStorage.getItem(SKIN_STORAGE_KEY); if (s === 'light' || s === 'niho') return s; } catch { /* */ }
    return 'niho';
  });

  useEffect(() => {
    if (!isElectron) return;
    const root = document.documentElement;
    root.setAttribute('data-electron', 'true');
    const p = window.chateeElectron?.platform;
    if (p) root.setAttribute('data-electron-platform', p);
    return () => { root.removeAttribute('data-electron'); root.removeAttribute('data-electron-platform'); };
  }, [isElectron]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute('data-dashboard', 'true');
    if (skin === 'niho') { root.classList.add('dark'); root.setAttribute('data-skin', 'niho'); }
    else { root.classList.remove('dark'); root.setAttribute('data-skin', 'light'); }
  }, [skin]);

  useEffect(() => { try { localStorage.setItem(SKIN_STORAGE_KEY, skin); } catch { /* */ } }, [skin]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => document.documentElement.setAttribute('data-mobile', mq.matches ? 'true' : 'false');
    sync(); mq.addEventListener('change', sync); return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => { document.documentElement.setAttribute('data-font', settings.font); }, [settings.font]);

  const updateSettings = (ns: Partial<Settings>) => setSettings((p) => ({ ...p, ...ns }));

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setMainModule('chat');
    setChatSubTab('chaya');
    if (location.pathname !== '/') navigate('/');
  }, [location.pathname, navigate]);

  const handleSelectAgentSession = useCallback((sessionId: string) => {
    setOpenAgentTabIds((prev) => normalizeOpenAgentTabs([...prev, sessionId]));
    setSelectedSessionId(sessionId);
    setMainModule('chat');
    if (location.pathname !== '/') navigate('/');
  }, [location.pathname, navigate, normalizeOpenAgentTabs]);

  useEffect(() => {
    const p = location.pathname;
    if (p === '/llm-config')      { setMainModule('settings'); setSettingsSubTab('llm');     navigate('/', { replace: true }); return; }
    if (p === '/mcp-config')      { setMainModule('chat');     setChatSubTab('mcp');         navigate('/', { replace: true }); return; }
    if (p === '/settings')        { setMainModule('settings'); setSettingsSubTab('general'); navigate('/', { replace: true }); return; }
    if (p === '/agents')          { setMainModule('chat');     setChatSubTab('persona');     navigate('/', { replace: true }); return; }
    if (p === '/communication')  { setMainModule('chat');     setChatSubTab('communication'); navigate('/', { replace: true }); return; }
    if (p === '/chill')            { setMainModule('chill');   navigate('/', { replace: true }); return; }
    if (p === '/media-creator' || p === '/media-creator-image') { setMainModule('media'); setMediaSubTab('image'); navigate('/', { replace: true }); return; }
    if (p === '/media-creator-video') { setMainModule('media'); setMediaSubTab('video'); navigate('/', { replace: true }); }
  }, [location.pathname, navigate]);

  // ── 对话切换弹窗 ──
  const [showConversationSwitcher, setShowConversationSwitcher] = useState(false);
  const [switcherSearch, setSwitcherSearch] = useState('');
  const [isLoadingSwitcher, setIsLoadingSwitcher] = useState(false);
  const [switcherAgents, setSwitcherAgents] = useState<Session[]>([]);
  const [switcherTopics, setSwitcherTopics] = useState<Session[]>([]);
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<Session | null>(null);
  const [showAgentPersonaDialog, setShowAgentPersonaDialog] = useState(false);
  const [agentPersonaDialogAgent, setAgentPersonaDialogAgent] = useState<Session | null>(null);

  const loadSwitcherData = async (validateSelection = false) => {
    try {
      setIsLoadingSwitcher(true);
      const [agents, sessions] = await Promise.all([getAgents(), getSessions()]);
      const nextAgents = agents || [];
      setSwitcherAgents(nextAgents);
      setSwitcherTopics((sessions || []).filter((s) => s.session_type === 'topic_general'));
      const validAgentIds = new Set(nextAgents.map((a) => a.session_id));
      validAgentIds.add(DEFAULT_AGENT_ID);
      setOpenAgentTabIds((prev) => normalizeOpenAgentTabs(prev.filter((id) => validAgentIds.has(id))));
      if (validateSelection) {
        const cur = selectedSessionId;
        if (cur) {
          const all = [...nextAgents, ...(sessions || [])];
          if (!all.some((s) => s.session_id === cur) && cur !== DEFAULT_AGENT_ID) handleSelectSession(DEFAULT_AGENT_ID);
        } else handleSelectSession(DEFAULT_AGENT_ID);
      }
    } catch {
      setSwitcherAgents([]); setSwitcherTopics([]);
      if (validateSelection && !selectedSessionId) handleSelectSession(DEFAULT_AGENT_ID);
    } finally { setIsLoadingSwitcher(false); }
  };

  useEffect(() => { if (showConversationSwitcher) loadSwitcherData(false); }, [showConversationSwitcher]);
  useEffect(() => { loadSwitcherData(true); }, []);
  useEffect(() => {
    setOpenAgentTabIds((prev) => normalizeOpenAgentTabs(prev));
  }, [normalizeOpenAgentTabs]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_OPEN_AGENT_TABS, JSON.stringify(openAgentTabIds));
    } catch { /* ignore */ }
  }, [openAgentTabIds]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_AGENT_LIST_COLLAPSED, isAgentListCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [isAgentListCollapsed]);
  useEffect(() => {
    if (!selectedSessionId) return;
    const isAgent = selectedSessionId === DEFAULT_AGENT_ID || switcherAgents.some((a) => a.session_id === selectedSessionId);
    if (!isAgent) return;
    setOpenAgentTabIds((prev) => normalizeOpenAgentTabs([...prev, selectedSessionId]));
  }, [DEFAULT_AGENT_ID, normalizeOpenAgentTabs, selectedSessionId, switcherAgents]);

  const handleCreateAgentTab = useCallback(async () => {
    try {
      setIsCreatingAgentTab(true);
      const created = await createSession(undefined, undefined, 'agent');
      handleSelectAgentSession(created.session_id);
      await loadSwitcherData(false);
      toast({ title: '已新建 Agent', description: '新会话无历史对话，记忆从当前窗口重新累计', variant: 'success' });
    } catch (error) {
      toast({
        title: '创建 Agent 失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsCreatingAgentTab(false);
    }
  }, [handleSelectAgentSession, loadSwitcherData]);

  const handleDeleteSessionConfirm = (session: Session, e: React.MouseEvent) => { e.stopPropagation(); setDeleteSessionTarget(session); };

  const handleOpenAgentPersonaDialog = useCallback(async (agentId: string) => {
    try {
      const cached = switcherAgents.find((a) => a.session_id === agentId);
      let target = cached || null;
      if (!target) {
        const fresh = await getSession(agentId);
        target = fresh;
      }
      if (!target) return;
      setAgentPersonaDialogAgent(target);
      setShowAgentPersonaDialog(true);
    } catch (error) {
      toast({
        title: '加载 Agent 配置失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, [switcherAgents]);

  const performDeleteSession = async () => {
    if (!deleteSessionTarget) return;
    const { session_id, name, title } = deleteSessionTarget;
    try {
      await deleteSession(session_id);
      toast({ title: '已删除', description: `「${name || title || '会话'}」已成功删除`, variant: 'success' });
      if (selectedSessionId === session_id) handleSelectSession(DEFAULT_AGENT_ID);
      await loadSwitcherData();
    } catch (error) {
      toast({ title: '删除失败', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally { setDeleteSessionTarget(null); }
  };

  const handleCreateTopic = async () => {
    try {
      setIsCreatingTopic(true);
      const ns = await createSession(undefined, undefined, 'topic_general');
      setShowConversationSwitcher(false);
      handleSelectSession(ns.session_id);
      toast({ title: '话题已创建', variant: 'success' });
    } catch (error) {
      toast({ title: '创建话题失败', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally { setIsCreatingTopic(false); }
  };

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const fn = () => setIsMobile(mq.matches);
    mq.addEventListener('change', fn); return () => mq.removeEventListener('change', fn);
  }, []);

  // ── 气泡 Tab ──
  const chatTabs: { id: ChatSubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'chaya',   label: 'Chat',     icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: 'mcp',     label: 'MCP',      icon: <Plug className="w-3.5 h-3.5" /> },
    { id: 'skill',   label: 'Skill',    icon: <Package className="w-3.5 h-3.5" /> },
    { id: 'persona', label: 'Persona',  icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'communication', label: '通信', icon: <Radio className="w-3.5 h-3.5" /> },
  ];
  const mediaTabs: { id: MediaSubTab; label: string }[] = [
    { id: 'image', label: '生图' },
    { id: 'video', label: '生视频' },
  ];
  const settingsTabs: { id: SettingsSubTab; label: string }[] = [
    { id: 'general', label: '通用设置' },
    { id: 'llm', label: '模型录入' },
  ];
  const chillTabs: { id: ChillPanelTab; label: string }[] = [
    { id: 'live', label: '直播' },
    { id: 'search', label: '搜索' },
  ];

  const activeAgentSessionId =
    selectedSessionId && (selectedSessionId === DEFAULT_AGENT_ID || switcherAgents.some((a) => a.session_id === selectedSessionId))
      ? selectedSessionId
      : DEFAULT_AGENT_ID;
  const activeAgentMeta =
    activeAgentSessionId === DEFAULT_AGENT_ID
      ? { name: 'Chaya', avatar: chayaAvatar || null }
      : switcherAgents.find((a) => a.session_id === activeAgentSessionId) || null;

  // ── 内容渲染 ──
  const renderPanel = () => {
    if (mainModule === 'chat' && isMcpSupportRoute) {
      return (
        <div className="h-full min-h-0 overflow-hidden">
          <McpSupportPage />
        </div>
      );
    }
    if (mainModule === 'chat') {
      if (chatSubTab === 'chaya') return <div key={`c-${activeAgentSessionId}`} className="h-full min-h-0"><Workflow sessionId={activeAgentSessionId} onSelectSession={handleSelectSession} enableToolCalling={settings.enableToolCalling} onToggleToolCalling={(v) => updateSettings({ enableToolCalling: v })} /></div>;
      if (chatSubTab === 'mcp') return <div className="h-full min-h-0 overflow-hidden"><McpWorkspacePanel sessionId={activeAgentSessionId} /></div>;
      if (chatSubTab === 'skill') return <SkillPackEntryPage sessionId={activeAgentSessionId} />;
      if (chatSubTab === 'communication') return <div className="h-full min-h-0 overflow-hidden"><CommunicationPage sessionId={activeAgentSessionId} /></div>;
      return <div className="h-full min-h-0 overflow-hidden"><AgentsPage sessionId={activeAgentSessionId} /></div>;
    }
    if (mainModule === 'media') return <div className="h-full min-h-0"><MediaCreatorPage embedded mode={mediaSubTab === 'video' ? 'video' : 'image'} /></div>;
    if (mainModule === 'chill') {
      return (
        <div className="h-full min-h-0 overflow-hidden">
          <ChillPage isMobile={isMobile} tab={chillSubTab} onTabChange={setChillSubTab} />
        </div>
      );
    }
    if (settingsSubTab === 'general') return <SettingsPanel settings={settings} onUpdateSettings={updateSettings} />;
    return <div className="h-full min-h-0 overflow-hidden llm-config-page"><LLMConfigPanel /></div>;
  };

  return (
    <div className={`app-shell ${isElectron && isDarwin ? 'app-shell--darwin' : ''}`}>
      {/* macOS 红绿灯占位条 — 在 app-frame 外面，背景跟外壳一致 */}
      <div className="app-darwin-titlebar">
        <span className="app-darwin-titlebar-text">Chaya</span>
      </div>

      <div className="app-frame">
        {/* ─── 左侧主导航 (Rail) ─── */}
        <aside className="app-rail app-no-drag">
          <div className="app-rail-top">
            <RailBtn active={mainModule === 'chat'} onClick={() => setMainModule('chat')} title="聊天与工具">
              <Bot className="w-5 h-5" strokeWidth={1.75} />
            </RailBtn>
            <RailBtn active={mainModule === 'media'} onClick={() => setMainModule('media')} title="媒体创作">
              <Film className="w-5 h-5" strokeWidth={1.75} />
            </RailBtn>
            <RailBtn active={mainModule === 'chill'} onClick={() => setMainModule('chill')} title="Chill 氛围">
              <Headphones className="w-5 h-5" strokeWidth={1.75} />
            </RailBtn>
          </div>
          <div className="app-rail-bottom">
            <RailBtn active={mainModule === 'settings'} onClick={() => setMainModule('settings')} title="设置">
              <Settings className="w-5 h-5" strokeWidth={1.75} />
            </RailBtn>
            <button
              type="button"
              onClick={() => setSkin(skin === 'niho' ? 'light' : 'niho')}
              className="app-rail-theme-btn"
              title={skin === 'niho' ? '切换到亮色' : '切换到暗色'}
            >
              {skin === 'niho'
                ? <Sun className="w-4 h-4" strokeWidth={2} />
                : <Moon className="w-4 h-4" strokeWidth={2} />
              }
            </button>
          </div>
        </aside>

        {/* ─── 主区域 ─── */}
        <div className="app-main relative">
          <ChillMiniBar suppress={mainModule === 'chill'} onOpenChill={() => setMainModule('chill')} />
          <ChillGlobalPlayer />
          {mainModule !== 'chat' && (
            <header
              className={`app-bubble-bar ${isElectron ? 'electron-titlebar-drag' : ''}`}
              style={isMobile ? { paddingTop: 'var(--safe-area-inset-top)' } : undefined}
            >
              <nav className="app-bubble-tabs">
                {mainModule === 'media' && mediaTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setMediaSubTab(t.id)}
                    className={`app-bubble-tab app-no-drag ${mediaSubTab === t.id ? 'app-bubble-tab--active' : ''}`}
                  >
                    <span className="app-bubble-tab-label">{t.label}</span>
                  </button>
                ))}
                {mainModule === 'settings' && settingsTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSettingsSubTab(t.id)}
                    className={`app-bubble-tab app-no-drag ${settingsSubTab === t.id ? 'app-bubble-tab--active' : ''}`}
                  >
                    <span className="app-bubble-tab-label">{t.label}</span>
                  </button>
                ))}
                {mainModule === 'chill' && chillTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setChillSubTab(t.id)}
                    className={`app-bubble-tab app-no-drag ${chillSubTab === t.id ? 'app-bubble-tab--active' : ''}`}
                  >
                    <span className="app-bubble-tab-label">{t.label}</span>
                  </button>
                ))}
              </nav>
            </header>
          )}

          <main className="app-content">
            {/* 对话切换弹窗 */}
            <Dialog open={showConversationSwitcher} onOpenChange={(o) => { setShowConversationSwitcher(o); if (!o) setSwitcherSearch(''); }}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <div className="flex items-center justify-between pr-8">
                    <div>
                      <DialogTitle>选择对话</DialogTitle>
                      <DialogDescription>选择智能体或话题开始对话</DialogDescription>
                    </div>
                    <Button variant="outline" size="sm" className="h-8" onClick={handleCreateTopic} disabled={isCreatingTopic}>
                      <Plus className="w-3.5 h-3.5 mr-1.5" />
                      {isCreatingTopic ? '创建中...' : '新建话题'}
                    </Button>
                  </div>
                </DialogHeader>
                <Input value={switcherSearch} onChange={(e) => setSwitcherSearch(e.target.value)} placeholder="搜索智能体或话题..." className="h-9" />
                <ScrollArea className="h-[60vh] pr-2 w-full">
                  <div className="space-y-4 py-2 w-full min-w-0">
                    <div className="w-full">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 px-1 mb-1 flex items-center justify-between">
                        <span className="flex items-center gap-1.5"><Bot className="w-3.5 h-3.5" />智能体</span>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => { setShowConversationSwitcher(false); setMainModule('chat'); setChatSubTab('persona'); }}>
                          <Users className="w-3 h-3 mr-1" />人格设置
                        </Button>
                      </div>
                      <div className="space-y-1 w-full">
                        {isLoadingSwitcher ? (
                          <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                        ) : switcherAgents.length === 0 ? (
                          <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-3 text-center">暂无智能体，可在上方 Tab 栏点击 + 新建</div>
                        ) : (
                          switcherAgents.filter((a) => { const q = switcherSearch.trim().toLowerCase(); if (!q) return true; return (a.name || a.title || a.session_id).toLowerCase().includes(q) || (a.system_prompt || '').toLowerCase().includes(q); }).map((a) => (
                            <DataListItem key={a.session_id} id={a.session_id} title={a.name || a.title || `Agent ${a.session_id.slice(0, 8)}`} description={a.system_prompt ? a.system_prompt.split('\n')[0]?.slice(0, 80) + (a.system_prompt.length > 80 ? '...' : '') : `${a.message_count || 0} 条消息`} avatar={a.avatar || undefined} isSelected={selectedSessionId === a.session_id} onClick={() => { setShowConversationSwitcher(false); handleSelectAgentSession(a.session_id); }} onDelete={(e) => handleDeleteSessionConfirm(a, e)} />
                          ))
                        )}
                      </div>
                    </div>
                    <div className="w-full">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 px-1 mb-1 flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5" />话题</div>
                      <div className="space-y-1 w-full">
                        {isLoadingSwitcher ? (
                          <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                        ) : switcherTopics.length === 0 ? (
                          <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-3 text-center">暂无话题</div>
                        ) : (
                          switcherTopics.filter((t) => { const q = switcherSearch.trim().toLowerCase(); if (!q) return true; return (t.name || t.title || t.preview_text || t.session_id).toLowerCase().includes(q); }).map((t) => (
                            <DataListItem key={t.session_id} id={t.session_id} title={t.name || t.title || t.preview_text || `话题 ${t.session_id.slice(0, 8)}`} description={`${t.message_count || 0} 条消息`} icon={FolderOpen} isSelected={selectedSessionId === t.session_id} onClick={() => { setShowConversationSwitcher(false); handleSelectSession(t.session_id); }} onDelete={(e) => handleDeleteSessionConfirm(t, e)} />
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
                <DialogFooter><Button variant="secondary" onClick={() => setShowConversationSwitcher(false)}>关闭</Button></DialogFooter>
              </DialogContent>
            </Dialog>

            {mainModule === 'chat' && !isMcpSupportRoute ? (
              <div className="flex-1 min-h-0 overflow-hidden flex gap-3 p-3">
                {!isAgentListCollapsed && (
                  <aside className="w-[243px] rounded-2xl border border-[var(--border-default)] bg-[var(--surface-secondary)] flex flex-col overflow-hidden">
                  <div className="agent-list-header border-b border-[var(--border-default)] flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">Agents</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="h-6 w-6 inline-flex items-center justify-center rounded border border-[var(--border-default)] hover:bg-[var(--surface-tertiary)]"
                        onClick={handleCreateAgentTab}
                        disabled={isCreatingAgentTab}
                        title="新增 Agent"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className="h-6 w-6 inline-flex items-center justify-center rounded border border-[var(--border-default)] hover:bg-[var(--surface-tertiary)]"
                        onClick={() => setIsAgentListCollapsed(true)}
                        title="折叠 Agent 列表"
                      >
                        <PanelLeftClose className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1">
                    <div
                      className={`w-full rounded-md text-xs border transition-colors flex items-center gap-2 ${activeAgentSessionId === DEFAULT_AGENT_ID ? 'border-[var(--color-accent)] bg-[var(--surface-tertiary)] text-[var(--text-primary)]' : 'border-transparent hover:border-[var(--border-default)] text-[var(--text-secondary)]'}`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectAgentSession(DEFAULT_AGENT_ID)}
                        className="flex-1 text-left px-2 py-1.5"
                        title="Chaya"
                      >
                        <span className="block truncate">Chaya</span>
                      </button>
                    </div>
                    {switcherAgents.filter((a) => a.session_id !== DEFAULT_AGENT_ID).map((agent) => {
                      const sid = agent.session_id;
                      const isActive = activeAgentSessionId === sid;
                      const label = agent.name || agent.title || `Agent ${sid.slice(0, 6)}`;
                      return (
                        <div
                          key={sid}
                          className={`w-full flex items-center gap-1 rounded-md text-xs border transition-colors ${isActive ? 'border-[var(--color-accent)] bg-[var(--surface-tertiary)] text-[var(--text-primary)]' : 'border-transparent hover:border-[var(--border-default)] text-[var(--text-secondary)]'}`}
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectAgentSession(sid)}
                            className="flex-1 text-left px-2 py-1.5"
                            title={label}
                          >
                            <span className="block truncate">{label}</span>
                          </button>
                          <button
                            type="button"
                            className="mr-1 h-5 w-5 inline-flex items-center justify-center rounded hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-500"
                            title={`删除 ${label}`}
                            onClick={(e) => handleDeleteSessionConfirm(agent, e)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  </aside>
                )}
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)]">
                  <div className="app-bubble-bar app-no-drag agent-panel-subnav">
                    <nav className="app-bubble-tabs">
                      {isAgentListCollapsed && (
                        <button
                          type="button"
                          onClick={() => setIsAgentListCollapsed(false)}
                          className="app-bubble-tab app-no-drag"
                          title="展开 Agent 列表"
                        >
                          <span className="app-bubble-tab-icon"><PanelLeftOpen className="w-3.5 h-3.5" /></span>
                          <span className="app-bubble-tab-label">Agents</span>
                        </button>
                      )}
                      {chatTabs.map((t) => {
                        if (t.id === 'mcp') {
                          return (
                            <div
                              key={t.id}
                              className={`app-bubble-tab app-no-drag flex items-center gap-2 ${chatSubTab === t.id ? 'app-bubble-tab--active' : ''}`}
                              title="开启后，对话中由系统按内容自动选用已启用的 MCP；关闭后仅使用输入区「插件」中勾选的服务器。"
                            >
                              <button
                                type="button"
                                onClick={() => setChatSubTab('mcp')}
                                className="inline-flex items-center gap-1.5"
                              >
                                <span className="app-bubble-tab-icon">{t.icon}</span>
                                <span className="app-bubble-tab-label">{t.label}</span>
                              </button>
                              <CapsuleToggle
                                checked={mcpAutoUse}
                                onCheckedChange={onMcpAutoUseChange}
                                aria-label="对话中自动使用 MCP"
                                leftIcon={<Hand />}
                                rightIcon={<Sparkles />}
                              />
                            </div>
                          );
                        }

                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setChatSubTab(t.id)}
                            className={`app-bubble-tab app-no-drag ${chatSubTab === t.id ? 'app-bubble-tab--active' : ''}`}
                          >
                            <span className="app-bubble-tab-icon">{t.icon}</span>
                            <span className="app-bubble-tab-label">{t.label}</span>
                          </button>
                        );
                      })}
                    </nav>
                    <button
                      type="button"
                      className="agent-subnav-profile"
                      onClick={() => handleOpenAgentPersonaDialog(activeAgentSessionId)}
                      title={`配置 ${activeAgentMeta?.name || 'Agent'}`}
                    >
                      <span className="agent-subnav-profile-avatar">
                        {activeAgentMeta?.avatar ? (
                          <img src={activeAgentMeta.avatar} alt={activeAgentMeta?.name || 'Agent'} className="w-full h-full object-cover" />
                        ) : (
                          <Bot className="w-3.5 h-3.5" strokeWidth={1.75} />
                        )}
                      </span>
                      <span className="agent-subnav-profile-name">{activeAgentMeta?.name || 'Agent'}</span>
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-hidden">{renderPanel()}</div>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-hidden">{renderPanel()}</div>
            )}
          </main>
        </div>

      </div>

      <ConfirmDialog
        open={deleteSessionTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteSessionTarget(null); }}
        title="删除确认"
        description={`您确定要删除「${deleteSessionTarget?.name || deleteSessionTarget?.title || '该会话'}」吗？此操作不可撤销。`}
        variant="destructive"
        onConfirm={performDeleteSession}
      />

      <AgentPersonaDialog
        agent={agentPersonaDialogAgent}
        open={showAgentPersonaDialog}
        onOpenChange={(open) => {
          setShowAgentPersonaDialog(open);
          if (!open) setAgentPersonaDialogAgent(null);
        }}
        onSaved={async () => {
          await loadSwitcherData(false);
          await loadChayaAvatar();
        }}
      />
    </div>
  );
};

export default App;
