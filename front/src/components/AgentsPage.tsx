/**
 * 智能体列表页面
 * 上半部分：智能体网格列表（可添加到圆桌会议）
 * 下半部分：圆桌会议面板
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Sparkles, Bot, MessageCircle, Trash2, Plus, X, Users, 
  ChevronDown, ChevronUp, History, Settings, Loader, Download, Upload
} from 'lucide-react';
import { 
  getAgents, deleteSession, Session, 
  downloadAgentAsJson, importAgentFromFile, importAgent, AgentExportData 
} from '../services/sessionApi';
import { getLLMConfigs, LLMConfigFromDB } from '../services/llmApi';
import {
  RoundTable,
  RoundTableDetail,
  getRoundTables,
  createRoundTable,
  getRoundTable,
  deleteRoundTable,
  addParticipant,
  sendMessage,
} from '../services/roundTableApi';
import RoundTablePanel from './RoundTablePanel';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { toast } from './ui/use-toast';

interface AgentsPageProps {
  selectedRoundTableId?: string | null;
}

const AgentsPage: React.FC<AgentsPageProps> = ({ selectedRoundTableId }) => {
  const navigate = useNavigate();
  
  // 智能体列表状态
  const [agents, setAgents] = useState<Session[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  
  // 圆桌会议状态
  const [roundTables, setRoundTables] = useState<RoundTable[]>([]);
  const [activeRoundTable, setActiveRoundTable] = useState<RoundTableDetail | null>(null);
  const [isLoadingRoundTables, setIsLoadingRoundTables] = useState(true);
  const [showRoundTablePanel, setShowRoundTablePanel] = useState(true);
  const [showRoundTableHistory, setShowRoundTableHistory] = useState(false);
  const [isCreatingRoundTable, setIsCreatingRoundTable] = useState(false);
  const [roundTableRefreshTrigger, setRoundTableRefreshTrigger] = useState(0);
  const [deleteAgentTarget, setDeleteAgentTarget] = useState<Session | null>(null);
  const [deleteRoundTableTarget, setDeleteRoundTableTarget] = useState<RoundTable | null>(null);

  // 加载智能体列表
  const loadAgents = useCallback(async () => {
    try {
      setIsLoadingAgents(true);
      const agentSessions = await getAgents();
      console.log('[AgentsPage] Loaded agents:', agentSessions.length);
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

  // 加载圆桌会议列表
  const loadRoundTables = useCallback(async () => {
    try {
      setIsLoadingRoundTables(true);
      const tables = await getRoundTables();
      setRoundTables(tables);
      
      // 如果有活跃的圆桌会议，自动选中最新的
      const activeTable = tables.find(t => t.status === 'active');
      if (activeTable && !activeRoundTable) {
        const detail = await getRoundTable(activeTable.round_table_id);
        setActiveRoundTable(detail);
      }
    } catch (error) {
      console.error('[AgentsPage] Failed to load round tables:', error);
    } finally {
      setIsLoadingRoundTables(false);
    }
  }, [activeRoundTable]);

  useEffect(() => {
    loadAgents();
    loadLLMConfigs();
    loadRoundTables();
  }, []);

  // 监听外部传入的selectedRoundTableId，自动选中圆桌会议
  useEffect(() => {
    if (selectedRoundTableId && roundTables.length > 0) {
      const roundTable = roundTables.find(rt => rt.round_table_id === selectedRoundTableId);
      if (roundTable) {
        handleSelectRoundTable(selectedRoundTableId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoundTableId, roundTables]);

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

  // 添加智能体到圆桌会议
  const handleAddToRoundTable = async (agent: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      // 如果没有活跃的圆桌会议，先创建一个
      let roundTableId = activeRoundTable?.round_table_id;
      
      if (!roundTableId) {
        setIsCreatingRoundTable(true);
        const newTable = await createRoundTable();
        roundTableId = newTable.round_table_id;
        
        // 发送会议开始通知
        await sendMessage(roundTableId, {
          content: '圆桌会议已开始',
          sender_type: 'system',
        });
      }
      
      // 添加智能体
      await addParticipant(roundTableId, agent.session_id);
      
      // 发送加入通知
      const agentName = agent.name || agent.title || `智能体 ${agent.session_id.substring(0, 8)}`;
      await sendMessage(roundTableId, {
        content: `${agentName} 已加入圆桌会议`,
        sender_type: 'system',
      });
      
      // 刷新圆桌会议详情
      const detail = await getRoundTable(roundTableId);
      setActiveRoundTable(detail);
      setShowRoundTablePanel(true);
      
      // 触发 RoundTablePanel 刷新
      setRoundTableRefreshTrigger(prev => prev + 1);
      
      await loadRoundTables();
    } catch (error: any) {
      console.error('[AgentsPage] Failed to add to round table:', error);
      if (error.message?.includes('already in')) {
        alert('该智能体已在圆桌会议中');
      } else {
        alert('添加失败，请重试');
      }
    } finally {
      setIsCreatingRoundTable(false);
    }
  };

  // 创建新的圆桌会议
  const handleCreateRoundTable = async () => {
    try {
      setIsCreatingRoundTable(true);
      const newTable = await createRoundTable();
      
      // 发送会议开始通知
      await sendMessage(newTable.round_table_id, {
        content: '圆桌会议已开始',
        sender_type: 'system',
      });
      
      const detail = await getRoundTable(newTable.round_table_id);
      setActiveRoundTable(detail);
      setShowRoundTablePanel(true);
      
      await loadRoundTables();
    } catch (error) {
      console.error('[AgentsPage] Failed to create round table:', error);
      alert('创建圆桌会议失败，请重试');
    } finally {
      setIsCreatingRoundTable(false);
    }
  };

  // 选择历史圆桌会议
  const handleSelectRoundTable = async (roundTableId: string) => {
    try {
      const detail = await getRoundTable(roundTableId);
      setActiveRoundTable(detail);
      setShowRoundTableHistory(false);
      setShowRoundTablePanel(true);
    } catch (error) {
      console.error('[AgentsPage] Failed to load round table:', error);
    }
  };

  const performDeleteRoundTable = async (roundTableId: string) => {
    try {
      await deleteRoundTable(roundTableId);
      if (activeRoundTable?.round_table_id === roundTableId) {
        setActiveRoundTable(null);
      }
      await loadRoundTables();
      toast({ title: '圆桌会议已删除', variant: 'success' });
    } catch (error) {
      console.error('[AgentsPage] Failed to delete round table:', error);
      toast({
        title: '删除圆桌会议失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 删除圆桌会议（确认）
  const handleDeleteRoundTable = (roundTableId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const rt = roundTables.find((r) => r.round_table_id === roundTableId) || null;
    setDeleteRoundTableTarget(rt);
  };

  // 关闭圆桌会议面板
  const handleCloseRoundTable = () => {
    setShowRoundTablePanel(false);
  };

  // 获取 LLM 配置名称
  const getLLMConfigName = (llmConfigId?: string) => {
    if (!llmConfigId) return '未设置';
    const config = llmConfigs.find(c => c.config_id === llmConfigId);
    return config?.name || '未知模型';
  };

  // 检查智能体是否已在当前圆桌会议中
  const isAgentInRoundTable = (sessionId: string) => {
    return activeRoundTable?.participants.some(p => p.session_id === sessionId) || false;
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
              <Sparkles className="w-6 h-6 text-purple-500" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">智能体</h1>
            </div>
            <p className="mt-1 text-sm text-gray-600 dark:text-[#858585]">
              管理智能体，开启圆桌会议
            </p>
          </div>
          
          {/* 操作按钮 */}
          <div className="flex items-center space-x-2">
            {/* 导入智能体 */}
            <button
              onClick={handleImportAgent}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm text-gray-600 dark:text-[#858585] hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="导入智能体"
            >
              <Upload className="w-4 h-4" />
              <span>导入</span>
            </button>
            
            <div className="w-px h-6 bg-gray-200 dark:bg-[#3c3c3c]" />
            
            <button
              onClick={() => setShowRoundTableHistory(!showRoundTableHistory)}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm text-gray-600 dark:text-[#858585] hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <History className="w-4 h-4" />
              <span>历史会议</span>
            </button>
            
            <button
              onClick={handleCreateRoundTable}
              disabled={isCreatingRoundTable}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              {isCreatingRoundTable ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>新建会议</span>
            </button>
          </div>
        </div>
        
        {/* 历史会议下拉 */}
        {showRoundTableHistory && (
          <div className="mt-3 p-3 bg-gray-50 dark:bg-[#2a2d2e] rounded-lg border border-gray-200 dark:border-[#404040]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-[#cccccc]">历史会议</span>
              <button
                onClick={() => setShowRoundTableHistory(false)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            
            {isLoadingRoundTables ? (
              <div className="text-center py-4 text-sm text-gray-500">加载中...</div>
            ) : roundTables.length === 0 ? (
              <div className="text-center py-4 text-sm text-gray-500">暂无历史会议</div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {roundTables.map(rt => (
                  <div
                    key={rt.round_table_id}
                    onClick={() => handleSelectRoundTable(rt.round_table_id)}
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer group ${
                      activeRoundTable?.round_table_id === rt.round_table_id
                        ? 'bg-primary-100 dark:bg-primary-900/30'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <Users className="w-4 h-4 text-gray-500" />
                      <span className="text-sm text-gray-900 dark:text-white">{rt.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        rt.status === 'active' 
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-600 dark:bg-[#3c3c3c] dark:text-[#858585]'
                      }`}>
                        {rt.status === 'active' ? '进行中' : '已结束'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500">{rt.participant_count} 人</span>
                      <button
                        onClick={(e) => handleDeleteRoundTable(rt.round_table_id, e)}
                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-opacity"
                      >
                        <Trash2 className="w-3 h-3 text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 上半部分：智能体列表 */}
      <div className={`flex-shrink-0 overflow-y-auto p-6 ${showRoundTablePanel ? 'h-[25%] min-h-[150px]' : 'flex-1'}`}>
        {isLoadingAgents ? (
          <div className="flex items-center justify-center h-full">
            <Loader className="w-6 h-6 animate-spin text-primary-500" />
            <span className="ml-2 text-gray-500 dark:text-[#858585]">加载中...</span>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Sparkles className="w-16 h-16 text-gray-300 dark:text-gray-700 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              还没有智能体
            </h3>
            <p className="text-sm text-gray-500 dark:text-[#858585] mb-4">
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
              const inRoundTable = isAgentInRoundTable(agent.session_id);
              
              return (
                <div
                  key={agent.session_id}
                  className={`bg-white dark:bg-[#2a2d2e] rounded-xl border p-4 hover:shadow-lg transition-all cursor-pointer group ${
                    inRoundTable 
                      ? 'border-primary-300 dark:border-primary-700 ring-2 ring-primary-100 dark:ring-primary-900/30'
                      : 'border-gray-200 dark:border-[#404040]'
                  }`}
                  onClick={() => handleSelectAgent(agent.session_id)}
                >
                  {/* 头像和名称 */}
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-purple-200 dark:border-purple-800 flex items-center justify-center bg-purple-100 dark:bg-purple-900/30 flex-shrink-0">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                      ) : (
                        <Bot className="w-6 h-6 text-purple-500" />
                      )}
                      
                      {/* 圆桌会议参与标记 */}
                      {inRoundTable && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center border-2 border-white dark:border-gray-800">
                          <Users className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                        {displayName}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-[#858585] truncate">
                        {getLLMConfigName(agent.llm_config_id)}
                      </p>
                    </div>
                  </div>

                  {/* 人设预览 */}
                  {agent.system_prompt && (
                    <p className="text-sm text-gray-600 dark:text-[#858585] line-clamp-2 mb-3">
                      {agent.system_prompt.length > 100 
                        ? agent.system_prompt.substring(0, 100) + '...' 
                        : agent.system_prompt}
                    </p>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-[#404040]">
                    <div className="flex items-center space-x-1 text-xs text-gray-500 dark:text-[#858585]">
                      <MessageCircle className="w-3 h-3" />
                      <span>{agent.message_count || 0} 条消息</span>
                    </div>
                    
                    <div className="flex items-center space-x-1">
                      {/* 加入圆桌会议按钮 */}
                      {!inRoundTable && (
                        <button
                          onClick={(e) => handleAddToRoundTable(agent, e)}
                          className="p-1.5 text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-all"
                          title="加入圆桌会议"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                      
                      {/* 导出按钮 */}
                      <button
                        onClick={(e) => handleExportAgent(agent, e)}
                        className="p-1.5 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 rounded transition-all"
                        title="导出智能体"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      
                      {/* 私聊按钮 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectAgent(agent.session_id);
                        }}
                        className="p-1.5 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 rounded transition-all"
                        title="私聊"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>
                      
                      {/* 删除按钮 */}
                      <button
                        onClick={(e) => handleDeleteAgent(agent.session_id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all"
                        title="删除智能体"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 分隔栏 */}
      <div 
        className="flex-shrink-0 h-8 bg-gray-100 dark:bg-[#2a2d2e] border-y border-gray-200 dark:border-[#404040] flex items-center justify-center cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        onClick={() => setShowRoundTablePanel(!showRoundTablePanel)}
      >
        <div className="flex items-center space-x-2 text-sm text-gray-500">
          {showRoundTablePanel ? (
            <>
              <ChevronDown className="w-4 h-4" />
              <span>收起圆桌会议</span>
            </>
          ) : (
            <>
              <ChevronUp className="w-4 h-4" />
              <span>展开圆桌会议 {activeRoundTable && `(${activeRoundTable.name})`}</span>
            </>
          )}
        </div>
      </div>

      {/* 下半部分：圆桌会议面板 */}
      {showRoundTablePanel && (
        <div className="flex-1 min-h-0 p-4">
          {activeRoundTable ? (
            <RoundTablePanel
              roundTableId={activeRoundTable.round_table_id}
              onClose={handleCloseRoundTable}
              onParticipantChange={loadRoundTables}
              refreshTrigger={roundTableRefreshTrigger}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-[#404040]">
              <Users className="w-12 h-12 text-gray-300 dark:text-gray-700 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                开始圆桌会议
              </h3>
              <p className="text-sm text-gray-500 dark:text-[#858585] mb-4 text-center max-w-md">
                点击智能体卡片上的 <Plus className="w-4 h-4 inline" /> 按钮将智能体添加到会议中，<br/>
                或者创建新的圆桌会议
              </p>
              <button
                onClick={handleCreateRoundTable}
                disabled={isCreatingRoundTable}
                className="flex items-center space-x-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 transition-colors"
              >
                {isCreatingRoundTable ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                <span>创建圆桌会议</span>
              </button>
            </div>
          )}
        </div>
      )}
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

    <Dialog
      open={deleteRoundTableTarget !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteRoundTableTarget(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除圆桌会议</DialogTitle>
          <DialogDescription>
            确定要删除「{deleteRoundTableTarget?.name}」吗？此操作不可恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button
            variant="secondary"
            onClick={() => setDeleteRoundTableTarget(null)}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!deleteRoundTableTarget) return;
              const id = deleteRoundTableTarget.round_table_id;
              setDeleteRoundTableTarget(null);
              await performDeleteRoundTable(id);
            }}
          >
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default AgentsPage;
