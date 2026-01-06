import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Sparkles, Bot, MessageCircle, Trash2, Download, Upload, Sliders, X, Users, Loader
} from 'lucide-react';
import { 
  getAgents, deleteSession, Session, 
  downloadAgentAsJson, importAgentFromFile, importAgent 
} from '../services/sessionApi';
import { getLLMConfigs, LLMConfigFromDB } from '../services/llmApi';
import AgentPersonaDialog from './AgentPersonaDialog';
import CreateAgentDialog from './CreateAgentDialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { toast } from './ui/use-toast';

const AgentsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // 智能体列表状态
  const [agents, setAgents] = useState<Session[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<Session | null>(null);
  const [personaEditAgent, setPersonaEditAgent] = useState<Session | null>(null);
  const [personaDialogInitialTab, setPersonaDialogInitialTab] = useState<'basic' | 'persona'>('basic');
  const [showCreateAgent, setShowCreateAgent] = useState(false);

  // 处理从外部导航来的新建请求
  useEffect(() => {
    if (location.state?.openGenerator) {
      setShowCreateAgent(true);
      // 清除 state 避免刷新页面再次打开
      window.history.replaceState({}, document.title);
    }
  }, [location]);

  // 加载智能体列表
  const loadAgents = useCallback(async () => {
    try {
      setIsLoadingAgents(true);
      const agentSessions = await getAgents();
      setAgents(agentSessions);
    } catch (error) {
      console.error('[AgentsPage] Failed to load agents:', error);
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  // 加载 LLM 配置
  const loadLLMConfigs = useCallback(async () => {
    try {
      const configs = await getLLMConfigs();
      setLlmConfigs(configs);
    } catch (error) {
      console.error('[AgentsPage] Failed to load LLM configs:', error);
    }
  }, []);

  useEffect(() => {
    loadAgents();
    loadLLMConfigs();
  }, [loadAgents, loadLLMConfigs]);

  const performDeleteAgent = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      await loadAgents();
      toast({ title: '智能体已删除', variant: 'success' });
    } catch (error) {
      console.error('[AgentsPage] Failed to delete agent:', error);
      toast({
        title: '删除智能体失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 删除智能体（确认）
  const handleDeleteAgent = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const agent = agents.find((a) => a.session_id === sessionId) || null;
    setDeleteAgentTarget(agent);
  };

  // 跳转到私聊
  const handleSelectAgent = (sessionId: string) => {
    navigate(`/?session=${sessionId}`);
  };

  // 获取 LLM 配置名称
  const getLLMConfigName = (llmConfigId?: string) => {
    if (!llmConfigId) return '未设置';
    const config = llmConfigs.find(c => c.config_id === llmConfigId);
    return config?.name || '未知模型';
  };

  // 导出智能体
  const handleExportAgent = async (agent: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      const displayName = agent.name || agent.title || `智能体_${agent.session_id.substring(0, 8)}`;
      await downloadAgentAsJson(agent.session_id, displayName);
    } catch (error: any) {
      console.error('[AgentsPage] Failed to export agent:', error);
      alert(`导出失败: ${error.message}`);
    }
  };

  // 导入智能体
  const handleImportAgent = async () => {
    try {
      const data = await importAgentFromFile();
      
      // 询问LLM配置处理方式
      let llmMode: 'use_existing' | 'create_new' = 'use_existing';
      if (data.llm_config) {
        const existingConfig = llmConfigs.find(c => c.name === data.llm_config?.name);
        if (existingConfig) {
          const useExisting = confirm(
            `检测到同名的模型配置 "${data.llm_config.name}"。\n\n` +
            `点击"确定"使用已有配置\n` +
            `点击"取消"创建新配置（将添加后缀）`
          );
          llmMode = useExisting ? 'use_existing' : 'create_new';
        }
      }
      
      const result = await importAgent(data, llmMode);
      alert(`智能体 "${result.name}" 导入成功！`);
      
      // 刷新列表
      await loadAgents();
      await loadLLMConfigs();
    } catch (error: any) {
      console.error('[AgentsPage] Failed to import agent:', error);
      alert(`导入失败: ${error.message}`);
    }
  };

  return (
    <>
    <div className="h-full flex flex-col bg-gray-50 dark:bg-[#1a1a1a]">
      {/* 头部 */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d]">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">智能体管理</h1>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-[#858585]">
              创建、导入和管理您的 AI 智能体
            </p>
          </div>
          
          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportAgent}
              className="h-8"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              导入智能体
            </Button>
            
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowCreateAgent(true)}
              className="h-8"
            >
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              新建智能体
            </Button>
          </div>
        </div>
      </div>

      {/* 智能体列表 - 紧凑小卡片样式 */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoadingAgents ? (
          <div className="flex items-center justify-center h-full">
            <Loader className="w-6 h-6 animate-spin text-primary-500" />
            <span className="ml-2 text-sm text-gray-500 dark:text-[#858585]">加载中...</span>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-gray-400 dark:text-gray-600" />
            </div>
            <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1">
              暂无智能体
            </h3>
            <p className="text-sm text-gray-500 dark:text-[#858585] mb-6 max-w-xs mx-auto">
              您可以使用角色生成器创建一个智能体，或者从文件导入
            </p>
            <Button variant="primary" onClick={() => setShowCreateAgent(true)}>
              <Sparkles className="w-4 h-4 mr-2" />
              立即创建
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {agents.map((agent) => {
              const displayName = agent.name || agent.title || `智能体 ${agent.session_id.substring(0, 8)}`;
              const avatarUrl = agent.avatar || null;
              
              return (
                <div
                  key={agent.session_id}
                  className="bg-white dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040] p-2.5 hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 transition-all cursor-pointer group flex flex-col"
                  onClick={() => handleSelectAgent(agent.session_id)}
                >
                  <div className="flex items-start gap-2.5 mb-1.5">
                    {/* 头像 */}
                    <div 
                      className="relative w-9 h-9 rounded-lg overflow-hidden border border-gray-100 dark:border-[#404040] flex items-center justify-center bg-gray-50 dark:bg-gray-800 flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPersonaDialogInitialTab('basic');
                        setPersonaEditAgent(agent);
                      }}
                    >
                      {avatarUrl ? (
                        <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                      ) : (
                        <Bot className="w-5 h-5 text-primary-500" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {displayName}
                      </h3>
                      <p className="text-[10px] text-gray-500 dark:text-[#858585] truncate mt-0.5">
                        {getLLMConfigName(agent.llm_config_id)}
                      </p>
                    </div>
                  </div>

                  {/* 描述预览 */}
                  <div className="flex-1">
                    <p className="text-[11px] text-gray-500 dark:text-[#a0a0a0] line-clamp-2 leading-tight h-7 mb-1.5">
                      {agent.system_prompt || '暂无人设描述'}
                    </p>
                  </div>

                  {/* 操作栏 - 仅在悬停时显示或保持半透明 */}
                  <div className="flex items-center justify-between pt-1.5 border-t border-gray-100 dark:border-[#404040] mt-auto">
                    <div className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-[#666666]">
                      <MessageCircle className="w-2.5 h-2.5" />
                      <span>{agent.message_count || 0}</span>
                    </div>
                    
                    <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                      <IconButton
                        icon={Sliders}
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 text-gray-500 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPersonaDialogInitialTab('basic');
                          setPersonaEditAgent(agent);
                        }}
                        label="配置"
                      />
                      <IconButton
                        icon={Download}
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 text-gray-500 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        onClick={(e) => handleExportAgent(agent, e)}
                        label="导出"
                      />
                      <IconButton
                        icon={Trash2}
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        onClick={(e) => handleDeleteAgent(agent.session_id, e)}
                        label="删除"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>

    <ConfirmDialog
      open={deleteAgentTarget !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteAgentTarget(null);
      }}
      title="删除智能体"
      description={`确定要删除「${deleteAgentTarget?.name || deleteAgentTarget?.title}」吗？此操作不可恢复。`}
      variant="destructive"
      onConfirm={async () => {
        if (!deleteAgentTarget) return;
        const id = deleteAgentTarget.session_id;
        setDeleteAgentTarget(null);
        await performDeleteAgent(id);
      }}
    />

    {/* Persona 编辑对话框 */}
    <AgentPersonaDialog
      agent={personaEditAgent}
      open={personaEditAgent !== null}
      onOpenChange={(open) => {
        if (!open) setPersonaEditAgent(null);
      }}
      onSaved={() => loadAgents()}
      initialTab={personaDialogInitialTab}
    />

    {/* 角色生成器对话框（统一弹框风格） */}
    <CreateAgentDialog
      open={showCreateAgent}
      onOpenChange={setShowCreateAgent}
      onSaved={() => {
        setShowCreateAgent(false);
        loadAgents();
      }}
    />
    </>
  );
};

export default AgentsPage;
