/**
 * 左侧会话列表组件
 * 包含会话、Agent、Mindstorm三个标签页
 */

import React, { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Sparkles, Plus, Trash2, Search, ArrowUp } from 'lucide-react';
import { 
  getSessions, 
  createSession, 
  deleteSession, 
  Session,
  getAgents,
  upgradeToAgent
} from '../services/sessionApi';

interface SessionSidebarProps {
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  isRoundTableMode?: boolean; // 是否为圆桌模式
  onAddToRoundTable?: (sessionId: string) => void; // 添加到圆桌会议的回调
  onConfigSession?: (sessionId: string) => void; // 配置会话的回调（打开配置对话框）
}

type TabType = 'sessions' | 'agents';

const SessionSidebar: React.FC<SessionSidebarProps> = ({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  isRoundTableMode = false,
  onAddToRoundTable,
  onConfigSession,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('sessions');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getSessions();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 加载智能体列表
  const loadAgents = useCallback(async () => {
    try {
      setIsLoading(true);
      const agentsData = await getAgents();
      setAgents(agentsData || []);
    } catch (error) {
      console.error('Failed to load agents:', error);
      setAgents([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 根据标签页加载数据
  useEffect(() => {
    if (activeTab === 'sessions') {
      loadSessions();
    } else if (activeTab === 'agents') {
      loadAgents();
    }
  }, [activeTab, loadSessions, loadAgents]);

  // 圆桌模式下自动切换到agents标签
  useEffect(() => {
    if (isRoundTableMode) {
      setActiveTab('agents');
    }
  }, [isRoundTableMode]);

  // 创建新会话
  const handleCreateSession = async () => {
    try {
      const newSession = await createSession(undefined, undefined, 'memory');
      await loadSessions();
      onSelectSession(newSession.session_id);
      onNewSession();
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  // 删除会话
  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (confirm('确定要删除此会话吗？')) {
      try {
        await deleteSession(sessionId);
        if (activeTab === 'sessions') {
          await loadSessions();
        } else if (activeTab === 'agents') {
          await loadAgents();
        }
        if (selectedSessionId === sessionId) {
          onSelectSession('');
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }
  };

  // 添加到圆桌会议
  const handleAddToRoundTable = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (onAddToRoundTable) {
      onAddToRoundTable(sessionId);
    }
  };

  // 点击头像打开配置对话框
  const handleAvatarClick = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    if (onConfigSession) {
      onConfigSession(session.session_id);
    }
  };

  // 升级为智能体
  const handleUpgradeToAgent = async (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    if (session.session_type === 'agent') {
      alert('该会话已经是智能体');
      return;
    }
    if (!confirm(`确定要将"${getDisplayName(session)}"升级为智能体吗？`)) {
      return;
    }
    try {
      await upgradeToAgent(session.session_id, {
        name: session.name || getDisplayName(session),
        avatar: session.avatar || null,
        system_prompt: session.system_prompt || '',
        llm_config_id: session.llm_config_id || null,
      });
      await loadSessions();
      await loadAgents();
      alert('升级成功！');
    } catch (error) {
      console.error('Failed to upgrade to agent:', error);
      alert('升级失败：' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  // 获取显示名称
  const getDisplayName = (session: Session): string => {
    return session.name || session.title || session.preview_text || '新会话';
  };

  // 获取显示列表
  const getDisplayList = (): Session[] => {
    let list: Session[] = [];
    if (activeTab === 'sessions') {
      list = sessions;
    } else if (activeTab === 'agents') {
      list = agents;
    }

    // 搜索过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(session => {
        const name = getDisplayName(session).toLowerCase();
        return name.includes(query);
      });
    }

    return list;
  };

  const displayList = getDisplayList();
  const temporarySessionId = 'temporary-session';
  const isTemporarySelected = selectedSessionId === temporarySessionId;

  return (
    <div className="w-[280px] bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col h-full">
      {/* 标签页切换 - 可滑动 */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setActiveTab('sessions')}
          className={`
            flex-shrink-0 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap
            ${activeTab === 'sessions'
              ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400 bg-gray-50 dark:bg-gray-800'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
            }
          `}
        >
          <div className="flex items-center justify-center gap-2">
            <MessageCircle className="w-4 h-4" />
            <span>会话</span>
          </div>
        </button>
        <button
          onClick={() => setActiveTab('agents')}
          className={`
            flex-shrink-0 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap
            ${activeTab === 'agents'
              ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400 bg-gray-50 dark:bg-gray-800'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
            }
          `}
        >
          <div className="flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4" />
            <span>Agent</span>
          </div>
        </button>
      </div>

      {/* 搜索框和新建按钮 */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-400"
            />
          </div>
          {activeTab === 'sessions' && (
            <button
              onClick={handleCreateSession}
              className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-1"
              title="新建会话"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
          {activeTab === 'agents' && (
            <>
              {isRoundTableMode ? (
                <button
                  onClick={handleCreateSession}
                  className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-1"
                  title="新建智能体"
                >
                  <Plus className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleCreateSession}
                  className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors flex items-center gap-1"
                  title="新建智能体"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 列表内容 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <div className="p-2">
            {/* 临时会话选项（仅在sessions标签页显示） */}
            {activeTab === 'sessions' && (
              <div
                onClick={() => onSelectSession(temporarySessionId)}
                className={`
                  group relative p-3 mb-1 rounded-lg cursor-pointer transition-colors
                  ${isTemporarySelected
                    ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                      临时会话
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      (不保存历史)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {displayList.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                <MessageCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">暂无{activeTab === 'sessions' ? '会话' : '智能体'}</p>
              </div>
            ) : (
              displayList.map((session) => {
              const isSelected = selectedSessionId === session.session_id;
              const displayName = getDisplayName(session);
              
              return (
                <div
                  key={session.session_id}
                  onClick={() => onSelectSession(session.session_id)}
                  className={`
                    group relative p-3 mb-1 rounded-lg cursor-pointer transition-colors
                    ${isSelected
                      ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }
                  `}
                >
                  <div className="flex items-start gap-3">
                    {/* 头像 - 可点击打开配置 */}
                    {session.avatar ? (
                      <img
                        src={session.avatar}
                        alt={displayName}
                        onClick={(e) => handleAvatarClick(e, session)}
                        className="w-8 h-8 rounded-lg flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-primary-400 transition-all"
                        title="点击配置"
                      />
                    ) : (
                      <div 
                        onClick={(e) => handleAvatarClick(e, session)}
                        className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-900 flex items-center justify-center flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-primary-400 transition-all"
                        title="点击配置"
                      >
                        <MessageCircle className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                      </div>
                    )}
                    
                    {/* 内容 */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                        {displayName}
                      </div>
                      {session.preview_text && !session.name && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                          {session.preview_text}
                        </div>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {isRoundTableMode && activeTab === 'agents' && (
                        <button
                          onClick={(e) => handleAddToRoundTable(e, session.session_id)}
                          className="p-1 hover:bg-primary-100 dark:hover:bg-primary-900/20 rounded transition-colors"
                          title="添加到圆桌会议"
                        >
                          <Plus className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                        </button>
                      )}
                      {/* 升级为智能体按钮（仅记忆体显示） */}
                      {activeTab === 'sessions' && session.session_type === 'memory' && (
                        <button
                          onClick={(e) => handleUpgradeToAgent(e, session)}
                          className="p-1 hover:bg-purple-100 dark:hover:bg-purple-900/20 rounded transition-colors"
                          title="升级为智能体"
                        >
                          <ArrowUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDeleteSession(e, session.session_id)}
                        className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            }))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SessionSidebar;

