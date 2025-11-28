/**
 * 智能体列表页面
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Bot, MessageCircle, Trash2, Edit2, X } from 'lucide-react';
import { getAgents, deleteSession, Session } from '../services/sessionApi';
import { getLLMConfigs, LLMConfigFromDB } from '../services/llmApi';

const AgentsPage: React.FC = () => {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Session[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadAgents();
    loadLLMConfigs();
  }, []);

  const loadAgents = async () => {
    try {
      setIsLoading(true);
      const agentSessions = await getAgents();
      console.log('[AgentsPage] Loaded agents:', agentSessions.length);
      setAgents(agentSessions);
    } catch (error) {
      console.error('[AgentsPage] Failed to load agents:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLLMConfigs = async () => {
    try {
      const configs = await getLLMConfigs();
      setLlmConfigs(configs);
    } catch (error) {
      console.error('[AgentsPage] Failed to load LLM configs:', error);
    }
  };

  const handleDeleteAgent = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('确定要删除这个智能体吗？此操作不可恢复。')) {
      return;
    }
    
    try {
      await deleteSession(sessionId);
      await loadAgents();
    } catch (error) {
      console.error('[AgentsPage] Failed to delete agent:', error);
      alert('删除智能体失败，请重试');
    }
  };

  const handleSelectAgent = (sessionId: string) => {
    // 导航到主聊天界面，并传递会话ID
    navigate(`/?session=${sessionId}`);
  };

  const getLLMConfigName = (llmConfigId?: string) => {
    if (!llmConfigId) return '未设置';
    const config = llmConfigs.find(c => c.config_id === llmConfigId);
    return config?.name || '未知模型';
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* 头部 */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex items-center space-x-3">
          <Sparkles className="w-6 h-6 text-purple-500" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">智能体</h1>
        </div>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          管理和使用您的智能体
        </p>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500 dark:text-gray-400">加载中...</div>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Sparkles className="w-16 h-16 text-gray-300 dark:text-gray-700 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              还没有智能体
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              您可以在聊天界面中将记忆体升级为智能体
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              前往聊天界面
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {agents.map((agent) => {
              const displayName = agent.name || agent.title || `智能体 ${agent.session_id.substring(0, 8)}`;
              const avatarUrl = agent.avatar || null;
              
              return (
                <div
                  key={agent.session_id}
                  className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-all cursor-pointer group"
                  onClick={() => handleSelectAgent(agent.session_id)}
                >
                  {/* 头像和名称 */}
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-purple-200 dark:border-purple-800 flex items-center justify-center bg-purple-100 dark:bg-purple-900/30 flex-shrink-0">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                      ) : (
                        <Bot className="w-6 h-6 text-purple-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                        {displayName}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {getLLMConfigName(agent.llm_config_id)}
                      </p>
                    </div>
                  </div>

                  {/* 人设预览 */}
                  {agent.system_prompt && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
                      {agent.system_prompt.length > 100 
                        ? agent.system_prompt.substring(0, 100) + '...' 
                        : agent.system_prompt}
                    </p>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center space-x-1 text-xs text-gray-500 dark:text-gray-400">
                      <MessageCircle className="w-3 h-3" />
                      <span>{agent.message_count || 0} 条消息</span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteAgent(agent.session_id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all"
                      title="删除智能体"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentsPage;
