/**
 * 工作流界面组件
 * 整合LLM模型和MCP工具，通过聊天完成任务
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Send, Loader, Bot, User, Wrench, AlertCircle, CheckCircle, Brain, Plug, RefreshCw, Power, XCircle, ChevronDown, ChevronUp, MessageCircle, FileText, Plus, History, Sparkles, Workflow as WorkflowIcon, GripVertical, Play, ArrowRight, Trash2, X, Edit2, RotateCw, Database, Paperclip, Type, Image, Video, Music, HelpCircle, Package, CheckSquare, Square, Quote, Lightbulb } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LLMClient, LLMMessage } from '../services/llmClient';
import { getLLMConfigs, getLLMConfig, getLLMConfigApiKey, LLMConfigFromDB } from '../services/llmApi';
import { mcpManager, MCPServer, MCPTool } from '../services/mcpClient';
import { getMCPServers, MCPServerConfig } from '../services/mcpApi';
import { getSessions, createSession, getSessionMessages, saveMessage, summarizeSession, getSessionSummaries, deleteSession, clearSummarizeCache, deleteMessage, executeMessageComponent, updateSessionAvatar, updateSessionName, updateSessionSystemPrompt, updateSessionMediaOutputPath, updateSessionLLMConfig, upgradeToAgent, Session, Summary } from '../services/sessionApi';
import { createSkillPack, saveSkillPack, optimizeSkillPackSummary, getSkillPacks, getSessionSkillPacks, assignSkillPack, unassignSkillPack, SkillPack, SessionSkillPack, SkillPackCreationResult, SkillPackProcessInfo } from '../services/skillPackApi';
import { estimate_messages_tokens, get_model_max_tokens, estimate_tokens } from '../services/tokenCounter';
import { getWorkflows, getWorkflow, Workflow as WorkflowType, WorkflowNode, WorkflowConnection } from '../services/workflowApi';
import { workflowPool } from '../services/workflowPool';
import { getBatch } from '../services/crawlerApi';
import CrawlerModuleSelector from './CrawlerModuleSelector';
import CrawlerBatchItemSelector from './CrawlerBatchItemSelector';
import ComponentThumbnails from './ComponentThumbnails';
import { Button } from './ui/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { toast } from './ui/use-toast';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string; // 思考过程（用于 o1 等思考模型）
  toolCalls?: Array<{ name: string; arguments: any; result?: any }> | { 
    // 系统提示词消息的元数据
    isSystemPrompt?: boolean;
    batchName?: string;
    item?: any;
    // 错误消息的重试元数据
    canRetry?: boolean;
    errorType?: 'network' | 'timeout' | 'api' | 'unknown';
    // 工具调用的标准格式（兼容）
    [key: string]: any;
  };
  isStreaming?: boolean; // 是否正在流式输出
  isThinking?: boolean; // 是否正在思考
  currentStep?: string; // 当前执行步骤（灰色小字显示）
  toolType?: 'workflow' | 'mcp'; // 感知组件类型（当 role === 'tool' 时使用）
  workflowId?: string; // 工作流ID（如果是工作流消息）
  workflowName?: string; // 工作流名称
  workflowStatus?: 'pending' | 'running' | 'completed' | 'error'; // 工作流状态
  workflowResult?: string; // 工作流执行结果
  workflowConfig?: { nodes: WorkflowNode[]; connections: WorkflowConnection[] }; // 工作流配置（节点和连接）
  isSummary?: boolean; // 是否是总结消息（不显示，但用于标记总结点）
  // 多模态内容支持
  media?: Array<{
    type: 'image' | 'video';
    mimeType: string;
    data: string; // base64 编码的数据或 URL
    url?: string; // 如果是 URL
  }>;
  // 思维签名（用于 Gemini）
  thoughtSignature?: string;
  toolCallSignatures?: Record<string, string>; // 工具调用的思维签名映射
}

// 会话列表项组件
interface SessionListItemProps {
  session: Session;
  displayName: string;
  avatarUrl: string | null;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onUpdateName: (name: string) => Promise<void>;
  onUpdateAvatar: (avatar: string) => Promise<void>;
  onConfigSaved?: () => Promise<Session | null>; // 配置保存后的回调，用于刷新会话列表，返回更新后的会话数据
}

const SessionListItem: React.FC<SessionListItemProps> = ({
  session,
  displayName,
  avatarUrl,
  isSelected,
  onSelect,
  onDelete,
  onUpdateName,
  onUpdateAvatar,
  onConfigSaved,
}) => {
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false); // 会话配置对话框（包含头像、昵称、人设、技能包、多媒体保存地址）
  const [editName, setEditName] = useState(session.name || '');
  const [editAvatar, setEditAvatar] = useState<string | null>(avatarUrl);
  const [editSystemPrompt, setEditSystemPrompt] = useState(session.system_prompt || '');
  const [editMediaOutputPath, setEditMediaOutputPath] = useState(session.media_output_path || '');
  const [editLlmConfigId, setEditLlmConfigId] = useState<string | null>(session.llm_config_id || null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configFileInputRef = useRef<HTMLInputElement>(null); // 配置对话框的文件输入
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false); // 配置保存状态
  const [activeConfigTab, setActiveConfigTab] = useState<'basic' | 'skillpack' | 'media'>('basic'); // 配置对话框的标签页
  
  // 技能包管理状态
  const [showSkillPackTab, setShowSkillPackTab] = useState(false);
  const [allSkillPacks, setAllSkillPacks] = useState<SkillPack[]>([]);
  const [sessionSkillPacks, setSessionSkillPacks] = useState<SessionSkillPack[]>([]);
  const [isLoadingSkillPacks, setIsLoadingSkillPacks] = useState(false);

  // 加载技能包数据
  const loadSkillPacks = async () => {
    setIsLoadingSkillPacks(true);
    try {
      const [allPacks, sessionPacks] = await Promise.all([
        getSkillPacks(),
        getSessionSkillPacks(session.session_id),
      ]);
      setAllSkillPacks(allPacks);
      setSessionSkillPacks(sessionPacks);
    } catch (error) {
      console.error('[SessionListItem] Failed to load skill packs:', error);
    } finally {
      setIsLoadingSkillPacks(false);
    }
  };

  // 点击头像弹出完整配置对话框
  const handleAvatarClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // 如果提供了刷新回调，先刷新会话数据以确保获取最新值（例如从圆桌面板修改的配置）
    let currentSession = session;
    if (onConfigSaved) {
      const updatedSession = await onConfigSaved();
      // 如果返回了更新后的会话数据，使用它；否则使用当前的 session prop
      if (updatedSession) {
        currentSession = updatedSession;
      }
    }
    // 从最新的会话数据加载值
    setEditName(currentSession.name || '');
    setEditAvatar(currentSession.avatar || null);
    setEditSystemPrompt(currentSession.system_prompt || '');
    setEditMediaOutputPath(currentSession.media_output_path || '');
    setActiveConfigTab('basic');
    loadSkillPacks();
    setShowConfigDialog(true);
  };

  // 当 session prop 变化时，同步更新编辑状态（如果对话框已打开）
  // 这确保当父组件刷新会话列表后，对话框中的值也会更新
  useEffect(() => {
    if (showConfigDialog) {
      setEditName(session.name || '');
      setEditAvatar(session.avatar || null);
      setEditSystemPrompt(session.system_prompt || '');
      setEditMediaOutputPath(session.media_output_path || '');
      setEditLlmConfigId(session.llm_config_id || null);
    }
  }, [session.name, session.avatar, session.system_prompt, session.media_output_path, session.llm_config_id, showConfigDialog]);

  // 打开完整编辑对话框（通过其他方式触发，如右键菜单等）
  const handleOpenFullEditDialog = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setShowEditDialog(true);
    setEditName(session.name || '');
    setEditAvatar(avatarUrl);
    setShowSkillPackTab(false);
    loadSkillPacks();
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    // 检查文件大小（限制为 2MB）
    if (file.size > 2 * 1024 * 1024) {
      alert('图片大小不能超过 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target?.result as string;
      setEditAvatar(base64String);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // 更新名称
      if (editName.trim() !== (session.name || '')) {
        await onUpdateName(editName.trim());
      }
      
      // 更新头像
      if (editAvatar !== avatarUrl) {
        await onUpdateAvatar(editAvatar || '');
      }
      
      setShowEditDialog(false);
    } catch (error) {
      console.error('[SessionListItem] Failed to save:', error);
      alert('保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setShowEditDialog(false);
    setEditName(session.name || '');
    setEditAvatar(avatarUrl);
    setShowSkillPackTab(false);
  };

  // 切换技能包分配状态
  const toggleSkillPackAssignment = async (skillPackId: string, isAssigned: boolean) => {
    try {
      if (isAssigned) {
        await unassignSkillPack(skillPackId, session.session_id);
      } else {
        const targetType = session.session_type === 'agent' ? 'agent' : 'memory';
        await assignSkillPack(skillPackId, session.session_id, targetType);
      }
      await loadSkillPacks();
    } catch (error: any) {
      console.error('[SessionListItem] Failed to toggle skill pack assignment:', error);
      alert(`操作失败: ${error.message}`);
    }
  };

  // 默认头像 SVG（机器人图标）
  const DefaultAvatar = () => (
    <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-primary-700 transition-colors">
      <Bot className="w-5 h-5 text-white" />
    </div>
  );

  return (
    <>
      <div
        className={`group relative w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${
          isSelected
            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-200 border border-primary-200 dark:border-primary-800'
            : 'bg-gray-50 dark:bg-[#363636] text-gray-700 dark:text-[#ffffff] hover:bg-gray-100 dark:hover:bg-[#404040] border border-gray-200 dark:border-[#404040]'
        }`}
      >
        <button
          onClick={onSelect}
          className="w-full text-left"
        >
          <div className="flex items-start space-x-2">
            {/* 头像 - 可点击 */}
            <div onClick={handleAvatarClick} className="cursor-pointer hover:opacity-80 transition-opacity">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="w-8 h-8 rounded-full flex-shrink-0 object-cover"
                />
              ) : (
                <DefaultAvatar />
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              {/* 名称显示 */}
              <div className="font-medium truncate">
                {displayName}
              </div>
              
              <div className="flex items-center space-x-2 mt-0.5 text-xs text-gray-500 dark:text-[#b0b0b0]">
                {session.message_count ? (
                  <span>{session.message_count} 条消息</span>
                ) : null}
                {session.last_message_at && (
                  <span className="truncate">
                    {new Date(session.last_message_at).toLocaleDateString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </button>
        
        {/* 删除按钮 */}
        <button
          onClick={onDelete}
          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded"
          title="删除会话"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 编辑对话框 */}
      {showEditDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleCancel}>
          <div className="bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-[#ffffff]">
                编辑会话
              </h3>
              <button
                onClick={handleCancel}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 标签页 */}
            <div className="flex border-b border-gray-200 dark:border-[#404040] mb-4">
              <button
                onClick={() => setShowSkillPackTab(false)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  !showSkillPackTab
                    ? 'border-primary-500 dark:border-primary-600 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-[#b0b0b0] hover:text-gray-700 dark:hover:text-[#cccccc]'
                }`}
              >
                基本信息
              </button>
              <button
                onClick={() => {
                  setShowSkillPackTab(true);
                  loadSkillPacks();
                }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  showSkillPackTab
                    ? 'border-primary-500 dark:border-primary-600 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-[#b0b0b0] hover:text-gray-700 dark:hover:text-[#cccccc]'
                }`}
              >
                技能包
              </button>
            </div>

            {showSkillPackTab ? (
              /* 技能包管理 */
              <div className="space-y-4">
                {isLoadingSkillPacks ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader className="w-6 h-6 animate-spin text-primary-500" />
                  </div>
                ) : (
                  <>
                    <div className="text-sm text-gray-600 dark:text-[#b0b0b0] mb-2">
                      为{session.session_type === 'agent' ? '智能体' : '记忆体'}分配技能包
                    </div>
                    {allSkillPacks.length === 0 ? (
                      <div className="text-center py-8 text-gray-500 dark:text-[#b0b0b0]">
                        暂无技能包，请在聊天界面创建技能包
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {allSkillPacks.map((pack) => {
                          const isAssigned = sessionSkillPacks.some(
                            sp => sp.skill_pack_id === pack.skill_pack_id
                          );
                          return (
                            <div
                              key={pack.skill_pack_id}
                              className={`flex items-start space-x-3 p-3 rounded-lg border ${
                                isAssigned
                                  ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
                                  : 'bg-gray-50 dark:bg-[#363636] border-gray-200 dark:border-[#404040]'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isAssigned}
                                onChange={() => toggleSkillPackAssignment(pack.skill_pack_id, isAssigned)}
                                className="mt-1 w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-gray-900 dark:text-white">
                                  {pack.name}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1 line-clamp-2">
                                  {pack.summary}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              /* 基本信息编辑 */
              <div className="space-y-4">
              {/* 头像编辑 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                  头像
                </label>
                <div className="flex items-center space-x-4">
                  <div className="relative">
                    {editAvatar ? (
                      <img
                        src={editAvatar}
                        alt="Avatar"
                        className="w-16 h-16 rounded-full object-cover border-2 border-gray-200 dark:border-[#404040]"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full bg-primary-600 flex items-center justify-center border-2 border-gray-200 dark:border-[#404040]">
                        <Bot className="w-8 h-8 text-white" />
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </div>
                  <div className="flex flex-col space-y-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-[#363636] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] text-gray-700 dark:text-[#ffffff] rounded transition-colors"
                    >
                      选择图片
                    </button>
                    {editAvatar && (
                      <button
                        onClick={() => setEditAvatar(null)}
                        className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded transition-colors"
                      >
                        清除头像
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-2">
                  支持 JPG、PNG 等图片格式，建议大小不超过 2MB
                </p>
              </div>

              {/* 名称编辑 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                  会话名称
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSave();
                    } else if (e.key === 'Escape') {
                      handleCancel();
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-600"
                  placeholder="输入会话名称（留空则使用默认名称）"
                />
              </div>

              {/* 人设显示 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                  人设
                </label>
                <div className={`px-3 py-2.5 rounded-lg text-sm ${
                  session.system_prompt 
                    ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700' 
                    : 'bg-gray-50 dark:bg-[#363636] border border-dashed border-gray-300 dark:border-[#404040]'
                }`}>
                  {session.system_prompt ? (
                    <p className="text-gray-700 dark:text-[#ffffff] line-clamp-3">
                      {session.system_prompt}
                    </p>
                  ) : (
                    <p className="text-gray-400 dark:text-[#808080] italic">
                      人设为空
                    </p>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1">
                  人设可在聊天界面底部设置
                </p>
              </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={handleCancel}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-[#ffffff] bg-gray-100 dark:bg-[#363636] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] rounded-lg transition-colors disabled:opacity-50"
              >
                关闭
              </button>
              {!showSkillPackTab && (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 flex items-center space-x-2"
                >
                  {isSaving ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      <span>保存中...</span>
                    </>
                  ) : (
                    <span>保存</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 会话配置对话框 - 使用 Portal 渲染到 body 下，确保在主界面中心显示 */}
      {showConfigDialog && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]" onClick={() => setShowConfigDialog(false)}>
          <div className="bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                配置会话
              </h3>
              <button
                onClick={() => setShowConfigDialog(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 标签页 */}
            <div className="flex border-b border-gray-200 dark:border-[#404040] flex-shrink-0">
              <button
                onClick={() => setActiveConfigTab('basic')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeConfigTab === 'basic'
                    ? 'border-primary-500 dark:border-primary-600 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-[#b0b0b0] hover:text-gray-700 dark:hover:text-[#cccccc]'
                }`}
              >
                基本信息
              </button>
              <button
                onClick={() => {
                  setActiveConfigTab('skillpack');
                  loadSkillPacks();
                }}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeConfigTab === 'skillpack'
                    ? 'border-primary-500 dark:border-primary-600 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-[#b0b0b0] hover:text-gray-700 dark:hover:text-[#cccccc]'
                }`}
              >
                技能包
              </button>
              <button
                onClick={() => setActiveConfigTab('media')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeConfigTab === 'media'
                    ? 'border-primary-500 dark:border-primary-600 text-primary-600 dark:text-primary-400'
                    : 'border-transparent text-gray-500 dark:text-[#b0b0b0] hover:text-gray-700 dark:hover:text-[#cccccc]'
                }`}
              >
                多媒体设置
              </button>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto p-5">
              {activeConfigTab === 'basic' && (
                <div className="space-y-4">
                  {/* 头像配置 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                      头像
                    </label>
                    <div className="flex items-center space-x-4">
                      <div className="relative">
                        <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-gray-200 dark:border-[#404040] flex items-center justify-center bg-gray-100 dark:bg-[#363636]">
                          {editAvatar ? (
                            <img src={editAvatar} alt="Avatar" className="w-full h-full object-cover" />
                          ) : (
                            <Bot className="w-10 h-10 text-gray-400" />
                          )}
                        </div>
                        <input
                          ref={configFileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (!file.type.startsWith('image/')) {
                              alert('请选择图片文件');
                              return;
                            }
                            if (file.size > 2 * 1024 * 1024) {
                              alert('图片大小不能超过 2MB');
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              setEditAvatar(event.target?.result as string);
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                      </div>
                      <div className="flex flex-col space-y-2">
                        <button
                          onClick={() => configFileInputRef.current?.click()}
                          className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-[#363636] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] text-gray-700 dark:text-[#ffffff] rounded transition-colors"
                        >
                          选择图片
                        </button>
                        {editAvatar && (
                          <button
                            onClick={() => setEditAvatar(null)}
                            className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded transition-colors"
                          >
                            清除头像
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-2">
                      支持 JPG、PNG 等格式，建议大小不超过 2MB
                    </p>
                  </div>

                  {/* 昵称配置 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                      昵称
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-600"
                      placeholder="输入会话昵称（留空则使用默认名称）"
                    />
                  </div>

                  {/* 人设配置 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                      人设
                    </label>
                    <textarea
                      value={editSystemPrompt}
                      onChange={(e) => setEditSystemPrompt(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-600 resize-none"
                      rows={6}
                      placeholder="输入系统提示词（人设），用于定义AI的角色和行为..."
                    />
                    <p className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1">
                      人设定义了AI的角色、风格和行为特征
                    </p>
                  </div>

                  {/* 默认模型配置 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                      默认模型
                    </label>
                    <select
                      value={editLlmConfigId || ''}
                      onChange={(e) => setEditLlmConfigId(e.target.value || null)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-600"
                    >
                      <option value="">不设置默认模型</option>
                      {llmConfigs.filter(c => c.enabled).map(config => (
                        <option key={config.config_id} value={config.config_id}>
                          {config.name} ({config.provider})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1">
                      选择该会话默认使用的 LLM 模型，选中后会自动应用到聊天
                    </p>
                  </div>
                </div>
              )}

              {activeConfigTab === 'skillpack' && (
                <div className="space-y-4">
                  {isLoadingSkillPacks ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader className="w-6 h-6 animate-spin text-primary-500" />
                    </div>
                  ) : (
                    <>
                      <div className="text-sm text-gray-600 dark:text-[#b0b0b0] mb-2">
                        为{session.session_type === 'agent' ? '智能体' : '记忆体'}分配技能包
                      </div>
                      {allSkillPacks.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 dark:text-[#b0b0b0]">
                          暂无技能包，请在聊天界面创建技能包
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {allSkillPacks.map((pack) => {
                            const isAssigned = sessionSkillPacks.some(
                              sp => sp.skill_pack_id === pack.skill_pack_id
                            );
                            return (
                              <div
                                key={pack.skill_pack_id}
                                className={`flex items-start space-x-3 p-3 rounded-lg border ${
                                  isAssigned
                                    ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
                                    : 'bg-gray-50 dark:bg-[#363636] border-gray-200 dark:border-[#404040]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isAssigned}
                                  onChange={() => toggleSkillPackAssignment(pack.skill_pack_id, isAssigned)}
                                  className="mt-1 w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm text-gray-900 dark:text-white">
                                    {pack.name}
                                  </div>
                                  <div className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1 line-clamp-2">
                                    {pack.summary}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeConfigTab === 'media' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                      多媒体保存地址
                    </label>
                    <input
                      type="text"
                      value={editMediaOutputPath}
                      onChange={(e) => setEditMediaOutputPath(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-600"
                      placeholder="输入本地路径，例如：/Users/username/Documents/media 或 C:\Users\username\Documents\media"
                    />
                    <p className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1">
                      设置图片、视频、音频等多媒体文件的保存路径。留空则使用默认路径。
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="px-5 py-4 bg-gray-50 dark:bg-[#1a1a1a] flex items-center justify-end space-x-3 flex-shrink-0">
              <button
                onClick={() => setShowConfigDialog(false)}
                className="text-sm text-gray-600 dark:text-[#b0b0b0] hover:text-gray-900 dark:hover:text-[#cccccc]"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  setIsSavingConfig(true);
                  try {
                    // 保存所有配置
                    const promises: Promise<void>[] = [];
                    
                    if (editName !== (session.name || '')) {
                      promises.push(onUpdateName(editName.trim()));
                    }
                    
                    if (editAvatar !== avatarUrl) {
                      promises.push(onUpdateAvatar(editAvatar || ''));
                    }
                    
                    if (editSystemPrompt !== (session.system_prompt || '')) {
                      promises.push(updateSessionSystemPrompt(session.session_id, editSystemPrompt.trim() || null));
                    }
                    
                    if (editMediaOutputPath !== (session.media_output_path || '')) {
                      promises.push(updateSessionMediaOutputPath(session.session_id, editMediaOutputPath.trim() || null));
                    }
                    
                    if (editLlmConfigId !== (session.llm_config_id || null)) {
                      promises.push(updateSessionLLMConfig(session.session_id, editLlmConfigId));
                      // 如果设置了默认模型，同时更新当前选中的模型
                      if (editLlmConfigId) {
                        setSelectedLLMConfigId(editLlmConfigId);
                      }
                    }
                    
                    await Promise.all(promises);
                    // 保存成功后，刷新会话列表以获取最新数据
                    if (onConfigSaved) {
                      await onConfigSaved();
                    }
                    setShowConfigDialog(false);
                  } catch (error) {
                    console.error('Failed to save config:', error);
                    alert('保存配置失败，请重试');
                  } finally {
                    setIsSavingConfig(false);
                  }
                }}
                disabled={isSavingConfig}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 flex items-center space-x-2"
              >
                {isSavingConfig ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>保存中...</span>
                  </>
                ) : (
                  <span>保存</span>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

interface WorkflowProps {
  sessionId?: string | null;
}

const Workflow: React.FC<WorkflowProps> = ({ sessionId: externalSessionId }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: '你好！我是你的 AI 工作流助手。这是临时会话，不会保存历史记录。',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // 多模态内容（图片、视频）
  const [attachedMedia, setAttachedMedia] = useState<Array<{
    type: 'image' | 'video';
    mimeType: string;
    data: string; // base64 编码的数据
    preview?: string; // 预览 URL（用于显示）
  }>>([]);
  const [streamEnabled, setStreamEnabled] = useState(true); // 流式响应开关
  const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set()); // 已折叠的思考过程
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null); // 正在编辑的消息ID
  const [quotedMessageId, setQuotedMessageId] = useState<string | null>(null); // 引用的消息ID
  const [isDraggingOver, setIsDraggingOver] = useState(false); // 是否正在拖拽文件
  const [isInputExpanded, setIsInputExpanded] = useState(false); // 输入框是否扩大
  const [isInputFocused, setIsInputFocused] = useState(false); // 输入框是否聚焦
  const [abortController, setAbortController] = useState<AbortController | null>(null); // 用于中断请求
  
  // @ 符号选择器状态
  const [showAtSelector, setShowAtSelector] = useState(false);
  const [atSelectorPosition, setAtSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 256 });
  const [atSelectorQuery, setAtSelectorQuery] = useState('');
  const [atSelectorIndex, setAtSelectorIndex] = useState(-1); // @ 符号在输入中的位置
  const [selectedComponentIndex, setSelectedComponentIndex] = useState(0); // 当前选中的组件索引（用于键盘导航）
  const [selectedComponents, setSelectedComponents] = useState<Array<{ type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }>>([]); // 已选定的组件（tag）
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // /模块 选择器状态
  const [showModuleSelector, setShowModuleSelector] = useState(false);
  const [moduleSelectorPosition, setModuleSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 256 });
  const [moduleSelectorQuery, setModuleSelectorQuery] = useState('');
  const [moduleSelectorIndex, setModuleSelectorIndex] = useState(-1); // /模块 在输入中的位置
  
  // 批次数据项选择器状态
  const [showBatchItemSelector, setShowBatchItemSelector] = useState(false);
  const [batchItemSelectorPosition, setBatchItemSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 400 });
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  
  // 选定的批次数据项（作为系统提示词）
  const [selectedBatchItem, setSelectedBatchItem] = useState<{ item: any; batchName: string } | null>(null);
  
  // 批次数据项选择后的操作选择（临时状态）
  const [pendingBatchItem, setPendingBatchItem] = useState<{ item: any; batchName: string } | null>(null);
  
  // 会话管理
  const [sessions, setSessions] = useState<Session[]>([]);
  const [temporarySessionId] = useState('temporary-session'); // 临时会话ID（固定）
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(temporarySessionId);
  const [currentSessionAvatar, setCurrentSessionAvatar] = useState<string | null>(null); // 当前会话的头像
  const [currentSystemPrompt, setCurrentSystemPrompt] = useState<string | null>(null); // 当前会话的系统提示词（人设）
  const [showAvatarConfigDialog, setShowAvatarConfigDialog] = useState(false); // 是否显示头像配置对话框
  const [avatarConfigDraft, setAvatarConfigDraft] = useState<string | null>(null); // 头像配置草稿
  const avatarConfigFileInputRef = useRef<HTMLInputElement>(null); // 头像配置对话框的文件输入
  
  // 头部配置对话框状态（用于从聊天头部点击头像时打开）
  const [showHeaderConfigDialog, setShowHeaderConfigDialog] = useState(false);
  const [headerConfigEditName, setHeaderConfigEditName] = useState('');
  const [headerConfigEditAvatar, setHeaderConfigEditAvatar] = useState<string | null>(null);
  const [headerConfigEditSystemPrompt, setHeaderConfigEditSystemPrompt] = useState('');
  const [headerConfigEditMediaOutputPath, setHeaderConfigEditMediaOutputPath] = useState('');
  const [headerConfigEditLlmConfigId, setHeaderConfigEditLlmConfigId] = useState<string | null>(null);
  const [headerConfigActiveTab, setHeaderConfigActiveTab] = useState<'basic' | 'skillpacks'>('basic');
  const headerConfigFileInputRef = useRef<HTMLInputElement>(null);
  const [isEditingSystemPrompt, setIsEditingSystemPrompt] = useState(false); // 是否正在编辑人设
  const [systemPromptDraft, setSystemPromptDraft] = useState(''); // 人设编辑草稿
  const [showHelpTooltip, setShowHelpTooltip] = useState(false); // 是否显示帮助提示
  const [showSessionTypeDialog, setShowSessionTypeDialog] = useState(false); // 是否显示会话类型选择对话框
  const [showUpgradeToAgentDialog, setShowUpgradeToAgentDialog] = useState(false); // 是否显示升级为智能体对话框
  const [isTemporarySession, setIsTemporarySession] = useState(true); // 当前是否为临时会话（默认是临时会话）
  const [agentName, setAgentName] = useState(''); // 升级为智能体时的名称
  const [agentAvatar, setAgentAvatar] = useState<string | null>(null); // 升级为智能体时的头像
  const [agentSystemPrompt, setAgentSystemPrompt] = useState(''); // 升级为智能体时的人设
  const [agentLLMConfigId, setAgentLLMConfigId] = useState<string | null>(null); // 升级为智能体时关联的LLM模型
  const [isUpgrading, setIsUpgrading] = useState(false); // 是否正在升级
  const agentAvatarFileInputRef = useRef<HTMLInputElement>(null); // 升级对话框的头像文件输入
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [messagePage, setMessagePage] = useState(1);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showNewMessagePrompt, setShowNewMessagePrompt] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  
  // 技能包相关状态
  const [isCreatingSkillPack, setIsCreatingSkillPack] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [skillPackSelectionMode, setSkillPackSelectionMode] = useState(false);
  const [showSkillPackDialog, setShowSkillPackDialog] = useState(false);
  const [skillPackResult, setSkillPackResult] = useState<SkillPackCreationResult | null>(null);
  const [skillPackProcessInfo, setSkillPackProcessInfo] = useState<SkillPackProcessInfo | null>(null);
  const [skillPackConversationText, setSkillPackConversationText] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationPrompt, setOptimizationPrompt] = useState('');
  const [selectedMCPForOptimization, setSelectedMCPForOptimization] = useState<string[]>([]); // 选中的MCP服务器ID列表
  const [currentSessionSkillPacks, setCurrentSessionSkillPacks] = useState<SessionSkillPack[]>([]);
  const [pendingSkillPackUse, setPendingSkillPackUse] = useState<{ skillPack: SessionSkillPack; messageId: string } | null>(null);
  
  // LLM配置
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [selectedLLMConfigId, setSelectedLLMConfigId] = useState<string | null>(null);
  const [selectedLLMConfig, setSelectedLLMConfig] = useState<LLMConfigFromDB | null>(null);
  
  // MCP配置
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [connectedMcpServerIds, setConnectedMcpServerIds] = useState<Set<string>>(new Set());
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<Set<string>>(new Set());
  const [mcpTools, setMcpTools] = useState<Map<string, MCPTool[]>>(new Map());
  const [connectingServers, setConnectingServers] = useState<Set<string>>(new Set());
  const [expandedServerIds, setExpandedServerIds] = useState<Set<string>>(new Set());
  
  // 工作流列表
  const [workflows, setWorkflows] = useState<WorkflowType[]>([]);
  
  // 技能包列表
  const [allSkillPacks, setAllSkillPacks] = useState<SkillPack[]>([]);
  
  // 拖拽状态
  const [draggingComponent, setDraggingComponent] = useState<{ type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const shouldMaintainScrollRef = useRef(false);
  const isUserScrollingRef = useRef(false);
  const scrollPositionRef = useRef<{ anchorMessageId: string; anchorOffsetTop: number; scrollTop: number } | null>(null);
  const isLoadingMoreRef = useRef(false);
  const lastMessageCountRef = useRef(0);
  
  // 保存最后一次请求信息，用于快速重试
  const lastRequestRef = useRef<{
    userMessage: string;
    systemPrompt: string;
    tools?: MCPTool[];
    messageHistory?: LLMMessage[];
    sessionId?: string;
    messageId?: string;
    model?: string;
  } | null>(null);

  // 检查是否应该自动滚动到底部
  const shouldAutoScroll = () => {
    if (!chatContainerRef.current) return false;
    const container = chatContainerRef.current;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    // 如果距离底部小于100px，认为用户在底部附近（最新消息位置）
    return scrollHeight - scrollTop - clientHeight < 100;
  };

  useEffect(() => {
    // 如果需要保持滚动位置（加载更多历史消息），不滚动
    if (shouldMaintainScrollRef.current) {
      shouldMaintainScrollRef.current = false;
      // lastMessageCountRef 已经在 setMessages 中更新了，这里不需要再更新
      return;
    }
    
    // 如果正在加载更多历史消息，不处理自动滚动
    if (isLoadingMoreRef.current) {
      return;
    }
    
    // 如果是初始加载，直接跳到底部（最新消息位置），不使用动画
    if (isInitialLoadRef.current && messages.length > 0) {
      // 使用 setTimeout 确保 DOM 已完全渲染
      setTimeout(() => {
        if (chatContainerRef.current) {
          const container = chatContainerRef.current;
          // 直接设置 scrollTop，不使用动画
          container.style.scrollBehavior = 'auto';
          container.scrollTop = container.scrollHeight;
          isInitialLoadRef.current = false;
          lastMessageCountRef.current = messages.length;
        }
      }, 0);
      return;
    }
    
    // 检测是否有新消息（消息数量增加，且是追加到末尾的新消息，不是加载的历史消息）
    // 注意：如果消息数量减少或不变，说明可能是替换消息（如编辑、删除），不处理
    if (messages.length <= lastMessageCountRef.current) {
      // 消息数量没有增加，可能是替换或删除，更新计数但不滚动
      lastMessageCountRef.current = messages.length;
      return;
    }
    
    const hasNewMessages = messages.length > lastMessageCountRef.current;
    const newMessageCount = hasNewMessages ? messages.length - lastMessageCountRef.current : 0;
    
    if (hasNewMessages) {
      // 更新 lastMessageCountRef
      lastMessageCountRef.current = messages.length;
      
      // 新消息在底部，如果用户在底部附近，自动滚动到底部（不使用动画）
      if (shouldAutoScroll() && !isUserScrollingRef.current) {
        setTimeout(() => {
          if (chatContainerRef.current) {
            const container = chatContainerRef.current;
            // 直接设置 scrollTop，不使用动画
            container.style.scrollBehavior = 'auto';
            container.scrollTop = container.scrollHeight;
          } else if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
          }
        }, 0);
        // 用户已经在底部，隐藏新消息提示
        setShowNewMessagePrompt(false);
        setUnreadMessageCount(0);
      } else {
        // 用户不在底部，显示新消息提示
        setShowNewMessagePrompt(true);
        setUnreadMessageCount(prev => prev + newMessageCount);
      }
    }
  }, [messages]);

  // 加载会话列表
  const loadSessions = async () => {
    try {
      const sessionList = await getSessions();
      setSessions(sessionList);
    } catch (error) {
      console.error('[Workflow] Failed to load sessions:', error);
      // 如果加载失败，设置为空数组，避免后续错误
      setSessions([]);
    }
  };

  // 从URL参数中获取会话ID（用于从智能体页面跳转过来）
  const [searchParams] = useSearchParams();
  
  // 加载LLM配置和MCP服务器列表
  useEffect(() => {
    loadLLMConfigs();
    loadMCPServers();
    loadSessions();
    loadWorkflows();
    loadSkillPacks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听外部传入的sessionId（从左侧会话列表选择）
  useEffect(() => {
    if (externalSessionId && externalSessionId !== currentSessionId) {
      handleSelectSession(externalSessionId);
    } else if (externalSessionId === null || externalSessionId === 'temporary-session') {
      // 如果外部sessionId为null或者是临时会话，切换到临时会话
      if (currentSessionId !== temporarySessionId) {
        handleSelectSession(temporarySessionId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSessionId]);

  // 从URL参数中加载会话
  useEffect(() => {
    const sessionIdFromUrl = searchParams.get('session');
    if (sessionIdFromUrl && sessions.length > 0) {
      const session = sessions.find(s => s.session_id === sessionIdFromUrl);
      if (session && session.session_type === 'agent') {
        handleSelectSession(sessionIdFromUrl);
        // 清除URL参数
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete('session');
        window.history.replaceState({}, '', window.location.pathname + (newSearchParams.toString() ? '?' + newSearchParams.toString() : ''));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, sessions]);

  // 监听配置会话请求（通过URL参数）
  useEffect(() => {
    const configSessionId = searchParams.get('config');
    if (configSessionId && configSessionId === currentSessionId && currentSessionId) {
      // 延迟打开对话框，确保会话数据已加载
      setTimeout(() => {
        setShowConfigDialog(true);
        // 清除URL参数
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete('config');
        window.history.replaceState({}, '', `${window.location.pathname}${newSearchParams.toString() ? '?' + newSearchParams.toString() : ''}`);
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, searchParams]);
  
  // 当选择会话时，加载历史消息、头像和人设
  useEffect(() => {
    if (currentSessionId) {
      if (isTemporarySession) {
        // 临时会话：不加载历史消息和总结
        setMessages([
          {
            id: '1',
            role: 'system',
            content: '你好！我是你的 AI 工作流助手。这是临时会话，不会保存历史记录。',
          },
        ]);
        setSummaries([]);
        setCurrentSessionAvatar(null);
        setCurrentSystemPrompt(null);
      } else {
        // 记忆体或智能体：正常加载
      loadSessionMessages(currentSessionId);
      loadSessionSummaries(currentSessionId);
      // 加载会话头像和人设
      const session = sessions.find(s => s.session_id === currentSessionId);
      if (session?.avatar) {
        setCurrentSessionAvatar(session.avatar);
      } else {
        setCurrentSessionAvatar(null);
      }
      // 加载人设
      setCurrentSystemPrompt(session?.system_prompt || null);
      // 加载技能包
      getSessionSkillPacks(currentSessionId).then(packs => {
        setCurrentSessionSkillPacks(packs);
      }).catch(err => {
        console.error('[Workflow] Failed to load skill packs:', err);
      });
      }
    } else {
      // 新会话，清空消息（保留系统消息）
      setMessages([{
        id: '1',
        role: 'system',
        content: '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
      }]);
      setSummaries([]);
      setCurrentSessionAvatar(null);
      setCurrentSystemPrompt(null);
      // 清空系统提示词状态
      setSelectedBatchItem(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, sessions, isTemporarySession]);
  
  // 当弹框显示时，调整位置使底部对齐光标，并滚动到底部
  useEffect(() => {
    if (showAtSelector && selectorRef.current && inputRef.current) {
      // 使用 setTimeout 确保 DOM 已更新
      setTimeout(() => {
        if (selectorRef.current && inputRef.current) {
          const selector = selectorRef.current;
          const actualHeight = selector.offsetHeight;
          
          // 重新获取光标位置
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const cursorPosition = textarea.selectionStart || 0;
          const value = textarea.value;
          const textBeforeCursor = value.substring(0, cursorPosition);
          
          // 计算光标位置（简化版本，使用之前的逻辑）
          const styles = window.getComputedStyle(textarea);
          const lines = textBeforeCursor.split('\n');
          const lineIndex = lines.length - 1;
          
          // 计算行高和 padding
          const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
          const paddingTop = parseFloat(styles.paddingTop) || 0;
          
          const cursorY = textareaRect.top + paddingTop + (lineIndex * lineHeight) - textarea.scrollTop;
          
          // 调整弹框位置，使底部对齐光标
          const newTop = cursorY - actualHeight;
          
          // 如果调整后超出顶部，则限制在顶部
          if (newTop < 10) {
            selector.style.top = '10px';
          } else {
            selector.style.top = `${newTop}px`;
          }
          
          // 滚动到底部，使最新内容在底部显示
          selector.scrollTop = selector.scrollHeight;
        }
      }, 10); // 稍微延迟以确保内容已渲染
    }
  }, [showAtSelector, atSelectorQuery, mcpServers, workflows]);
  
  // 监听点击外部关闭模块选择器
  useEffect(() => {
    if (!showModuleSelector) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // 检查点击是否在选择器外部（不包括输入框和选择器本身）
      const isClickInsideSelector = target.closest('.at-selector-container');
      const isClickInsideInput = inputRef.current?.contains(target);
      
      if (!isClickInsideSelector && !isClickInsideInput) {
        console.log('[Workflow] 点击外部，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    };
    
    // 延迟添加监听器，避免立即触发
    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModuleSelector]);
  
  // 监听ESC键关闭模块选择器
  useEffect(() => {
    if (!showModuleSelector) return;
    
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        console.log('[Workflow] 按下ESC，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
        
        // 重新聚焦输入框
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }
    };
    
    document.addEventListener('keydown', handleEscKey);
    
    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [showModuleSelector]);
  
  // 加载会话消息
  const loadSessionMessages = async (session_id: string, page: number = 1) => {
    try {
      setIsLoadingMessages(true);
      
      // 第一页加载时，先清空系统提示词状态（只有在找到系统提示词消息时才设置）
      if (page === 1) {
        setSelectedBatchItem(null);
      }
      
      // 如果是加载更多历史消息（page > 1），记录当前滚动位置（顶部附近）
      if (page > 1 && chatContainerRef.current && messages.length > 0) {
        isLoadingMoreRef.current = true;
        const container = chatContainerRef.current;
        const scrollTop = container.scrollTop;
        
        // 找到容器顶部附近的第一条消息作为锚点（历史消息在上方）
        let anchorMessageId: string | null = null;
        let anchorOffsetTop = 0;
        const threshold = 200; // 距离顶部200px内的消息
        
        for (const msg of messages) {
          const element = container.querySelector(`[data-message-id="${msg.id}"]`) as HTMLElement;
          if (element) {
            const elementTop = element.offsetTop;
            const relativeTop = elementTop - scrollTop;
            
            // 找到最接近顶部且在阈值内的消息
            if (relativeTop >= -threshold && relativeTop <= threshold) {
              anchorMessageId = msg.id;
              anchorOffsetTop = elementTop;
              break;
            }
          }
        }
        
        // 如果没找到合适的锚点，使用第一条消息（历史消息在上方）
        if (!anchorMessageId && messages.length > 0) {
          const firstElement = container.querySelector(`[data-message-id="${messages[0].id}"]`) as HTMLElement;
          if (firstElement) {
            anchorMessageId = messages[0].id;
            anchorOffsetTop = firstElement.offsetTop;
          }
        }
        
        if (anchorMessageId) {
          scrollPositionRef.current = {
            anchorMessageId,
            anchorOffsetTop,
            scrollTop,
          };
          shouldMaintainScrollRef.current = true;
        }
      }
      
      // 默认只加载20条消息，加快初始加载速度
      const data = await getSessionMessages(session_id, page, 20);
      
      // 先加载总结列表，用于关联总结消息和提示信息
      const summaryList = await getSessionSummaries(session_id);
      
      // 格式化消息，恢复工作流信息
      const formatMessage = async (msg: any): Promise<Message | null> => {
        // 确保 role 正确：如果是 'workflow'，转换为 'tool'
        let role = msg.role;
        if (role === 'workflow') {
          role = 'tool';
          console.warn('[Workflow] Fixed invalid role "workflow" to "tool" for message:', msg.message_id);
        }
        
        // 检查是否是总结消息（通过 content 前缀识别）
        const isSummaryMessage = role === 'system' && msg.content?.startsWith('__SUMMARY__');
        const actualContent = isSummaryMessage 
          ? msg.content.replace(/^__SUMMARY__/, '') // 移除前缀，保留实际内容
          : msg.content;
        
        // 检查是否是系统提示词消息（通过 tool_calls 中的 isSystemPrompt 标识）
        const toolCalls = msg.tool_calls && typeof msg.tool_calls === 'object' ? msg.tool_calls : null;
        const isSystemPromptMessage = role === 'system' && toolCalls && (toolCalls as any).isSystemPrompt === true;
        
        const baseMessage: Message = {
          id: msg.message_id,
          role: role as 'user' | 'assistant' | 'tool' | 'system',
          content: actualContent,
          thinking: msg.thinking,
          toolCalls: msg.tool_calls,
          isSummary: isSummaryMessage, // 标记为总结消息
        };
        
        // 恢复多模态内容（从 tool_calls 中读取）
        // 注意：tool_calls 可能是对象（包含 media）或数组（标准工具调用格式）
        if (toolCalls && typeof toolCalls === 'object' && !Array.isArray(toolCalls) && (toolCalls as any).media) {
          baseMessage.media = (toolCalls as any).media;
        }
        
        // 恢复思维签名（从 tool_calls 中读取）
        if (toolCalls && typeof toolCalls === 'object') {
          if ((toolCalls as any).thoughtSignature) {
            baseMessage.thoughtSignature = (toolCalls as any).thoughtSignature;
          }
          if ((toolCalls as any).toolCallSignatures) {
            baseMessage.toolCallSignatures = (toolCalls as any).toolCallSignatures;
          }
        }
        
        // 如果是系统提示词消息，恢复 selectedBatchItem（只在第一页加载时处理，避免重复设置）
        // 注意：第一页加载时，系统提示词的恢复已经在消息处理完成后统一处理，这里只处理后续页加载的情况
        if (isSystemPromptMessage && toolCalls && page > 1) {
          const systemPromptData = toolCalls as any;
          if (systemPromptData.batchName && systemPromptData.item) {
            setSelectedBatchItem({
              batchName: systemPromptData.batchName,
              item: systemPromptData.item,
            });
            console.log('[Workflow] Restored system prompt from message (page > 1):', msg.message_id);
          }
        }
        
        // 如果是工具消息（感知组件），尝试从 content 或 tool_calls 中恢复工作流信息
        if (baseMessage.role === 'tool') {
          // 过滤掉没有执行输出的感知组件（pending状态且没有content）
          if (!msg.content || msg.content.trim() === '' || msg.content === '[]') {
            const toolCalls = msg.tool_calls && typeof msg.tool_calls === 'object' ? msg.tool_calls : null;
            const workflowStatus = toolCalls?.workflowStatus;
            if (workflowStatus === 'pending') {
              // 跳过这个无效的感知组件消息
              console.log('[Workflow] Skipping invalid tool message (pending without output):', msg.message_id);
              return null;
            }
          }
          
          // 尝试从 tool_calls 中恢复工作流信息（如果之前保存过）
          if (msg.tool_calls && typeof msg.tool_calls === 'object') {
            baseMessage.toolType = msg.tool_calls.toolType || msg.tool_calls.workflowType; // 兼容旧数据
            baseMessage.workflowId = msg.tool_calls.workflowId;
            baseMessage.workflowName = msg.tool_calls.workflowName;
            baseMessage.workflowStatus = msg.tool_calls.workflowStatus || 'completed';
            
            // 确保恢复的消息有完整的工作流信息，允许重新执行
            if (!baseMessage.workflowId || !baseMessage.toolType) {
              console.warn('[Workflow] Restored tool message missing workflowId or toolType:', msg.message_id);
            }
          } else {
            // 如果没有 tool_calls，尝试从 content 中解析（兼容旧数据）
            console.warn('[Workflow] Restored tool message missing tool_calls:', msg.message_id);
          }
          
          // 如果工作流ID存在，尝试加载工作流配置
          if (baseMessage.workflowId && baseMessage.toolType === 'workflow') {
            try {
              const workflowDetails = await getWorkflow(baseMessage.workflowId);
              baseMessage.workflowConfig = workflowDetails?.config;
            } catch (error) {
              console.error('[Workflow] Failed to load workflow details:', error);
              // 即使加载失败，也允许重新执行（使用已有的 workflowId）
            }
          }
        }
        
        return baseMessage;
      };
      
      // 格式化消息，恢复工作流信息
      const formattedMessages = await Promise.all(data.messages.map(formatMessage));
      // 过滤掉null值（无效的感知组件消息）
      const validMessages = formattedMessages.filter((msg): msg is Message => msg !== null);
      
      // 在总结消息之后插入提示消息
      const messagesWithNotifications: Message[] = [];
      for (let i = 0; i < validMessages.length; i++) {
        const msg = validMessages[i];
        messagesWithNotifications.push(msg);
        
        // 如果是总结消息，查找对应的总结记录并添加提示消息
        if (msg.isSummary) {
          // 检查下一条消息是否已经是提示消息（避免重复添加）
          const nextMsg = validMessages[i + 1];
          const isAlreadyHasNotification = nextMsg && 
            nextMsg.role === 'system' && 
            (nextMsg.content.includes('已精简为') || nextMsg.content.includes('总结完成'));
          
          if (!isAlreadyHasNotification) {
            // 通过内容匹配找到对应的总结记录
            const matchingSummary = summaryList.find(s => 
              s.summary_content === msg.content || 
              msg.content.includes(s.summary_content) ||
              s.summary_content.includes(msg.content)
            );
            
            if (matchingSummary) {
              const tokenAfter = matchingSummary.token_count_after || 0;
              const tokenBefore = matchingSummary.token_count_before || 0;
              const notificationMessage: Message = {
                id: `notification-${msg.id}`,
                role: 'system',
                content: `您的对话内容已精简为 ${tokenAfter.toLocaleString()} token（原 ${tokenBefore.toLocaleString()} token）`,
              };
              messagesWithNotifications.push(notificationMessage);
            }
          }
        }
      }
      
      // 后端返回的消息已经是正序（最旧在前，最新在后），符合正常聊天显示顺序
      // 第一页加载时，只显示最新的消息（在底部），然后历史消息追加到上方
      if (page === 1) {
        // 第一页，只取最后几条消息（最新的），直接显示在底部
        // 后端返回的是正序（最旧在前，最新在后），我们只取最后的部分
        const latestMessages = messagesWithNotifications.slice(-20); // 只取最后20条（最新的）
        setMessages(latestMessages);
        isInitialLoadRef.current = true; // 标记为初始加载，会直接跳到底部（最新消息位置）
        lastMessageCountRef.current = latestMessages.length;
        // 重置新消息提示
        setShowNewMessagePrompt(false);
        setUnreadMessageCount(0);
        
        // 检查是否有系统提示词消息，如果有则设置 selectedBatchItem
        // 注意：这里需要检查所有消息，不仅仅是 latestMessages，因为系统提示词可能在历史消息中
        let foundSystemPrompt = false;
        for (const msg of messagesWithNotifications) {
          if (msg.role === 'system' && 
              msg.toolCalls && 
              typeof msg.toolCalls === 'object' &&
              (msg.toolCalls as any).isSystemPrompt === true) {
            const systemPromptData = msg.toolCalls as any;
            if (systemPromptData.batchName && systemPromptData.item) {
              setSelectedBatchItem({
                batchName: systemPromptData.batchName,
                item: systemPromptData.item,
              });
              foundSystemPrompt = true;
              console.log('[Workflow] Restored system prompt from message:', msg.id);
              break;
            }
          }
        }
        // 如果没有找到系统提示词消息，确保 selectedBatchItem 为 null
        if (!foundSystemPrompt) {
          setSelectedBatchItem(null);
        }
      } else {
        // 后续页，加载历史消息，追加到数组前面（显示在上方）
        // 在设置消息之前，先设置标志阻止自动滚动，并预计算新消息数量
        shouldMaintainScrollRef.current = true;
        const oldMessageCount = messages.length;
        const newTotalCount = oldMessageCount + messagesWithNotifications.length;
        
        // 预先更新 lastMessageCountRef，这样 useEffect 就不会误判为新消息
        lastMessageCountRef.current = newTotalCount;
        
        setMessages(prev => {
          // 历史消息追加到数组前面（显示在上方）
          const newMessages = [...messagesWithNotifications, ...prev];
          
          // 恢复滚动位置（保持锚点消息的位置不变，类似微信的加载历史消息）
          if (scrollPositionRef.current && chatContainerRef.current) {
            // 使用 setTimeout 确保 DOM 完全更新，并禁用滚动动画
            setTimeout(() => {
              const container = chatContainerRef.current;
              if (container && scrollPositionRef.current) {
                container.style.scrollBehavior = 'auto';
                const { anchorMessageId, anchorOffsetTop, scrollTop: oldScrollTop } = scrollPositionRef.current;
                if (anchorMessageId) {
                  const anchorElement = container.querySelector(`[data-message-id="${anchorMessageId}"]`) as HTMLElement;
                  if (anchorElement) {
                    // 计算新位置：目标消息的新位置 - 之前目标消息距离顶部的距离
                    const newAnchorOffsetTop = anchorElement.offsetTop;
                    const distanceFromTop = anchorOffsetTop - oldScrollTop;
                    const newScrollTop = newAnchorOffsetTop - distanceFromTop;
                    container.scrollTop = newScrollTop;
                  }
                }
                scrollPositionRef.current = null;
                isLoadingMoreRef.current = false;
              }
            }, 0);
          } else {
            isLoadingMoreRef.current = false;
          }
          
          return newMessages;
        });
      }
      
      setMessagePage(page);
      setHasMoreMessages(data.page < data.total_pages);
    } catch (error) {
      console.error('[Workflow] Failed to load messages:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  };
  
  // 加载会话总结
  const loadSessionSummaries = async (session_id: string) => {
    try {
      const summaryList = await getSessionSummaries(session_id);
      setSummaries(summaryList);
    } catch (error) {
      console.error('[Workflow] Failed to load summaries:', error);
    }
  };
  
  // 创建新会话 - 显示类型选择对话框
  const handleCreateNewSession = () => {
    if (!selectedLLMConfigId) {
      alert('请先选择 LLM 模型');
      return;
    }
    setShowSessionTypeDialog(true);
  };

  // 创建记忆体会话
  const handleCreateMemorySession = async () => {
    try {
      const newSession = await createSession(
        selectedLLMConfigId || undefined,
        '新会话',
        'memory'
      );
      setCurrentSessionId(newSession.session_id);
      setIsTemporarySession(false);
      setShowSessionTypeDialog(false);
      await loadSessions();
    } catch (error) {
      console.error('[Workflow] Failed to create memory session:', error);
      alert('创建记忆体失败，请重试');
    }
  };

  // 切换到临时会话
  const handleSwitchToTemporarySession = () => {
    setCurrentSessionId(temporarySessionId);
    setIsTemporarySession(true);
    setShowSessionTypeDialog(false);
    // 清空消息（临时会话不保存历史）
    setMessages([
      {
        id: '1',
        role: 'system',
        content: '你好！我是你的 AI 工作流助手。这是临时会话，不会保存历史记录。',
      },
    ]);
    setMessagePage(1);
    setSummaries([]);
  };
  
  // 选择会话
  const handleSelectSession = async (session_id: string) => {
    if (session_id === temporarySessionId) {
      // 切换到临时会话
      setIsTemporarySession(true);
      setCurrentSessionId(temporarySessionId);
      setMessages([
        {
          id: '1',
          role: 'system',
          content: '你好！我是你的 AI 工作流助手。这是临时会话，不会保存历史记录。',
        },
      ]);
      setMessagePage(1);
      setSummaries([]);
      setCurrentSystemPrompt(null);
      setCurrentSessionAvatar(null);
    } else {
      // 选择记忆体或智能体
      setIsTemporarySession(false);
    setCurrentSessionId(session_id);
    setMessagePage(1);
      // 加载会话信息
      const session = sessions.find(s => s.session_id === session_id);
      if (session) {
        setCurrentSessionAvatar(session.avatar || null);
        setCurrentSystemPrompt(session.system_prompt || null);
        // 如果是智能体，自动选择关联的LLM模型
        if (session.session_type === 'agent' && session.llm_config_id) {
          // 确保LLM配置已加载后再设置
          if (llmConfigs.length > 0) {
            const configExists = llmConfigs.some(c => c.config_id === session.llm_config_id);
            if (configExists) {
              setSelectedLLMConfigId(session.llm_config_id);
            } else {
              console.warn('[Workflow] Agent LLM config not found:', session.llm_config_id);
            }
          } else {
            // 如果配置还没加载，延迟设置
            setTimeout(() => {
              const configExists = llmConfigs.some(c => c.config_id === session.llm_config_id);
              if (configExists) {
                setSelectedLLMConfigId(session.llm_config_id);
              }
            }, 100);
          }
        }
      }
    }
  };
  
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // 删除会话（执行）
  const performDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);

      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([
          {
            id: '1',
            role: 'system',
            content:
              '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
          },
        ]);
        setSummaries([]);
        setCurrentSessionAvatar(null);
      }

      await loadSessions();
      toast({ title: '会话已删除', variant: 'success' });
    } catch (error) {
      console.error('[Workflow] Failed to delete session:', error);
      toast({
        title: '删除会话失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  // 删除会话（确认）
  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetSession = sessions.find((s) => s.session_id === sessionId);
    setDeleteSessionTarget({
      id: sessionId,
      name:
        targetSession?.name ||
        targetSession?.title ||
        targetSession?.preview_text ||
        '未命名会话',
    });
  };
  
  // 处理总结的通用函数
  const processSummarize = async (
    sessionId: string,
    messagesToSummarize: Array<{ message_id?: string; role: string; content: string }>,
    isAuto: boolean = false
  ) => {
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      throw new Error('LLM配置未选择');
    }

    const model = selectedLLMConfig.model || 'gpt-4';
    
    // 调用总结 API
    const summary = await summarizeSession(sessionId, {
      llm_config_id: selectedLLMConfigId,
      model: model,
      messages: messagesToSummarize,
    });
    
    // 获取被总结的最后一条消息ID（用于确定插入位置）
    const lastSummarizedMessageId = messagesToSummarize
      .map(msg => msg.message_id)
      .filter((id): id is string => !!id)
      .pop();
    
    // 将总结内容作为 system 类型的消息保存（不显示，但用于标记总结点）
    // 使用特殊格式来标识这是总结消息：__SUMMARY__{summary_content}
    const summaryMessageId = `msg-${Date.now()}`;
    
    // 计算总结消息的累积 token：总结前的累积 token + 总结消息的 token
    const tokenCountBeforeAcc = (summary as any).token_count_before_acc || 0;
    const summaryMessageTokens = estimate_tokens(summary.summary_content, model);
    const summaryAccToken = tokenCountBeforeAcc + summaryMessageTokens;
    
    const summarySystemMessage = {
      message_id: summaryMessageId,
      role: 'system' as const,
      content: `__SUMMARY__${summary.summary_content}`, // 使用特殊前缀标识总结消息
      model: model,
      acc_token: summaryAccToken, // 设置总结消息的累积 token
    };
    
    await saveMessage(sessionId, summarySystemMessage);
    
    // 后端会自动重新计算总结后所有消息的 acc_token（在 saveMessage API 中处理）
    
    // 添加提示消息到消息列表（显示给用户）
    const tokenAfter = summary.token_count_after || 0;
    const tokenBefore = summary.token_count_before || 0;
    const notificationMessageId = `notification-${Date.now()}`;
    const notificationMessage: Message = {
      id: notificationMessageId,
      role: 'system',
      content: `${isAuto ? '' : '总结完成！'}您的对话内容已精简为 ${tokenAfter.toLocaleString()} token（原 ${tokenBefore.toLocaleString()} token）`,
    };
    
    // 在消息列表中添加总结消息（标记为不显示）和提示消息
    setMessages(prev => {
      const newMessages = [...prev];
      
      // 找到最后一条被总结消息的位置
      const lastSummarizedIndex = lastSummarizedMessageId 
        ? newMessages.findIndex(msg => msg.id === lastSummarizedMessageId)
        : -1;
      
      const insertIndex = lastSummarizedIndex >= 0 ? lastSummarizedIndex + 1 : newMessages.length;
      
      // 插入总结消息（system 类型，isSummary: true，不显示）
      const summaryMessage: Message = {
        id: summaryMessageId,
        role: 'system',
        content: summary.summary_content, // 保存实际内容，但标记为总结消息
        isSummary: true, // 标记为总结消息，不显示
      };
      
      // 插入提示消息（显示给用户）
      newMessages.splice(insertIndex, 0, summaryMessage, notificationMessage);
      
      return newMessages;
    });
    
    // 重新加载消息列表（确保与数据库同步）
    await loadSessionMessages(sessionId, 1);
    
    // 重新加载总结列表
    await loadSessionSummaries(sessionId);
    
    // 清除总结缓存
    await clearSummarizeCache(sessionId);
    
    console.log(`[Workflow] ${isAuto ? 'Auto-' : ''}Summarized: ${tokenBefore} -> ${tokenAfter} tokens`);
    
    return summary;
  };

  // 手动触发总结
  const handleManualSummarize = async () => {
    if (!currentSessionId || !selectedLLMConfigId || !selectedLLMConfig) {
      alert('请先选择会话和LLM模型');
      return;
    }
    if (isTemporarySession) {
      alert('临时会话不支持总结功能');
      return;
    }
    
    try {
      setIsSummarizing(true);
      
      // 获取当前会话的所有消息（用于总结）
      // 排除系统消息（包括系统提示词消息）和总结消息
      const allMessages = messages.filter(m => {
        if (m.role === 'system' || m.isSummary) {
          // 检查是否是系统提示词消息
          const isSystemPrompt = m.toolCalls && 
            typeof m.toolCalls === 'object' &&
            (m.toolCalls as any).isSystemPrompt === true;
          if (isSystemPrompt) {
            return false; // 排除系统提示词消息
          }
          // 排除其他系统消息和总结消息
          return false;
        }
        return true;
      });
      const messagesToSummarize = allMessages.map(msg => ({
        message_id: msg.id,
        role: msg.role,
        content: msg.content,
        token_count: estimate_tokens(msg.content, selectedLLMConfig.model || 'gpt-4'),
      }));
      
      if (messagesToSummarize.length === 0) {
        alert('没有可总结的消息');
        return;
      }
      
      const summary = await processSummarize(currentSessionId, messagesToSummarize, false);
      
      // 显示总结完成的提示消息
      const tokenAfter = summary.token_count_after || 0;
      const tokenBefore = summary.token_count_before || 0;
      const notificationMsg: Message = {
        id: `manual-summary-notification-${Date.now()}`,
        role: 'system',
        content: `总结完成！对话内容已精简为 ${tokenAfter.toLocaleString()} token（原 ${tokenBefore.toLocaleString()} token）`,
      };
      // 新消息追加到数组后面（显示在底部）
      setMessages(prev => [...prev, notificationMsg]);
    } catch (error) {
      console.error('[Workflow] Failed to summarize:', error);
      alert(`总结失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  const loadLLMConfigs = async () => {
    try {
      console.log('[Workflow] Loading LLM configs...');
      const configs = await getLLMConfigs();
      console.log('[Workflow] Loaded LLM configs:', configs);
      
      // 过滤启用的配置（确保 enabled 是布尔值）
      const enabledConfigs = configs.filter(c => Boolean(c.enabled));
      console.log('[Workflow] Enabled LLM configs:', enabledConfigs);
      
      setLlmConfigs(enabledConfigs);
      
      // 默认选择第一个启用的配置
      if (enabledConfigs.length > 0 && !selectedLLMConfigId) {
        const firstConfig = enabledConfigs[0];
        console.log('[Workflow] Auto-selecting first LLM config:', firstConfig);
        setSelectedLLMConfigId(firstConfig.config_id);
        setSelectedLLMConfig(firstConfig);
        console.log('[Workflow] Auto-selected LLM config:', firstConfig.config_id, firstConfig);
      }
    } catch (error) {
      console.error('[Workflow] Failed to load LLM configs:', error);
      // 显示错误消息给用户
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `❌ 加载LLM配置失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  const loadMCPServers = async () => {
    try {
      console.log('[Workflow] Loading MCP servers...');
      const servers = await getMCPServers();
      console.log('[Workflow] Loaded MCP servers:', servers);
      setMcpServers(servers);
    } catch (error) {
      console.error('[Workflow] Failed to load MCP servers:', error);
    }
  };
  
  // 加载工作流列表
  const loadWorkflows = async () => {
    try {
      console.log('[Workflow] Loading workflows...');
      const workflowList = await getWorkflows();
      console.log('[Workflow] Loaded workflows:', workflowList);
      setWorkflows(workflowList);
    } catch (error) {
      console.error('[Workflow] Failed to load workflows:', error);
      setWorkflows([]);
    }
  };
  
  // 加载技能包列表
  const loadSkillPacks = async () => {
    try {
      console.log('[Workflow] Loading skill packs...');
      const skillPacks = await getSkillPacks();
      console.log('[Workflow] Loaded skill packs:', skillPacks);
      setAllSkillPacks(skillPacks);
    } catch (error) {
      console.error('[Workflow] Failed to load skill packs:', error);
      setAllSkillPacks([]);
    }
  };


  /**
   * 连接到 MCP 服务器
   */
  const handleConnectServer = async (serverId: string) => {
    const server = mcpServers.find(s => s.id === serverId);
    if (!server) return;

    setConnectingServers(prev => new Set(prev).add(serverId));

    try {
      console.log(`[Workflow] Connecting to ${server.name}...`);
      
      // 转换为 MCPServer 格式
      const mcpServer: MCPServer = {
        id: server.id,
        name: server.display_name || server.client_name || server.name,
        url: server.url,
        type: server.type,
        enabled: server.enabled,
        description: server.description,
        metadata: server.metadata,
        ext: server.ext, // 传递扩展配置（包括 response_format, server_type 等）
      };

      const client = await mcpManager.addServer(mcpServer);

      // 加载工具列表
      const tools = await client.listTools();
      setMcpTools(prev => new Map(prev).set(serverId, tools));
      setConnectedMcpServerIds(prev => new Set(prev).add(serverId));
      console.log(`[Workflow] Connected to ${server.name}, loaded ${tools.length} tools`);

    } catch (error) {
      console.error(`[Workflow] Failed to connect to ${server.name}:`, error);
      alert(`连接失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setConnectingServers(prev => {
        const newSet = new Set(prev);
        newSet.delete(serverId);
        return newSet;
      });
    }
  };

  /**
   * 断开 MCP 服务器连接
   */
  const handleDisconnectServer = (serverId: string) => {
    mcpManager.removeServer(serverId);
    setConnectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
    setSelectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
    setMcpTools(prev => {
      const newMap = new Map(prev);
      newMap.delete(serverId);
      return newMap;
    });
    setExpandedServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
    console.log(`[Workflow] Disconnected from server: ${serverId}`);
  };

  /**
   * 切换服务器工具展开状态
   */
  const handleToggleServerExpand = (serverId: string) => {
    setExpandedServerIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        newSet.add(serverId);
      }
      return newSet;
    });
  };

  const handleLLMConfigChange = async (configId: string) => {
    console.log('[Workflow] LLM config changed:', configId);
    
    if (!configId) {
      setSelectedLLMConfigId(null);
      setSelectedLLMConfig(null);
      return;
    }
    
    setSelectedLLMConfigId(configId);
    
    // 先从已加载的配置列表中查找，避免额外的 API 调用
    const configFromList = llmConfigs.find(c => c.config_id === configId);
    if (configFromList) {
      console.log('[Workflow] Found config in list:', configFromList);
      setSelectedLLMConfig(configFromList);
      return;
    }
    
    // 如果列表中没有，尝试从 API 获取
    try {
      console.log('[Workflow] Loading config from API:', configId);
      const config = await getLLMConfig(configId);
      console.log('[Workflow] Loaded config from API:', config);
      setSelectedLLMConfig(config);
    } catch (error) {
      console.error('[Workflow] Failed to load LLM config:', error);
      setSelectedLLMConfig(null);
      // 显示错误消息
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `❌ 加载LLM配置失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  /**
   * 切换是否使用某个 MCP 服务器的工具
   */
  const handleToggleMcpServerUsage = (serverId: string) => {
    setSelectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        // 只有已连接的服务器才能被选择使用
        if (connectedMcpServerIds.has(serverId)) {
          newSet.add(serverId);
        }
      }
      return newSet;
    });
  };

  const handleSend = async () => {
    // 允许发送文本或图片（至少有一个）
    if ((!input.trim() && attachedMedia.length === 0) || isLoading) return;

    // 检查配置
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '❌ 请先选择一个 LLM 模型',
      };
      // 新消息追加到数组后面（显示在底部）
      setMessages(prev => [...prev, errorMsg]);
      return;
    }

    // 如果是编辑模式，先处理重新发送
    if (editingMessageId) {
      await handleResendMessage(editingMessageId, input.trim());
      return;
    }

    // 检查是否有选定的组件（tag）
    // 只处理工作流，MCP通过selectedMcpServerIds在正常对话中使用工具
    const workflowComponents = selectedComponents.filter(c => c.type === 'workflow');
    if (workflowComponents.length > 0) {
      // 使用第一个选定的工作流
      const matchedComponent = workflowComponents[0];
      const userInput = input.trim();
      
      if (!userInput) {
        alert('请输入要执行的内容');
        return;
      }
      
      if (matchedComponent) {
        // 先保存用户输入消息
        let sessionId = currentSessionId;
        if (!sessionId) {
          try {
            const newSession = await createSession(selectedLLMConfigId, userInput.substring(0, 50));
            sessionId = newSession.session_id;
            setCurrentSessionId(sessionId);
            await loadSessions();
          } catch (error) {
            console.error('[Workflow] Failed to create session:', error);
          }
        }
        
        const userMessageId = `msg-${Date.now()}`;
        const userMessage: Message = {
          id: userMessageId,
          role: 'user',
          content: userInput,
        };
        
        // 新消息追加到数组后面（显示在底部）
        setMessages(prev => [...prev, userMessage]);
        
        // 保存用户消息（临时会话不保存）
        if (sessionId && !isTemporarySession) {
          try {
            await saveMessage(sessionId, {
              message_id: userMessageId,
              role: 'user',
              content: userInput,
              model: selectedLLMConfig.model || 'gpt-4',
            });
          } catch (error) {
            console.error('[Workflow] Failed to save user message:', error);
          }
        }
        
        // 添加感知组件消息
        await addWorkflowMessage(matchedComponent);
        
        // 等待消息添加到列表
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 找到刚添加的感知组件消息
        const currentMessages = messages;
        const workflowMessages = currentMessages.filter(m => m.role === 'tool' && m.workflowId === matchedComponent.id);
        let latestWorkflowMessage = workflowMessages[workflowMessages.length - 1];
        
        // 如果找不到，从最新的消息中查找
        if (!latestWorkflowMessage) {
          // 等待状态更新
          await new Promise(resolve => setTimeout(resolve, 200));
          const updatedMessages = messages;
          const updatedWorkflowMessages = updatedMessages.filter(m => m.role === 'tool' && m.workflowId === matchedComponent.id);
          latestWorkflowMessage = updatedWorkflowMessages[updatedWorkflowMessages.length - 1];
        }
        
        if (latestWorkflowMessage) {
          // 添加提示消息给大模型（显示动画）
          const instructionMessageId = `instruction-${Date.now()}`;
          const instructionMessage: Message = {
            id: instructionMessageId,
            role: 'assistant',
            content: '',
            isThinking: true,
          };
          // 新消息追加到数组后面（显示在底部）
          setMessages(prev => [...prev, instructionMessage]);
          
          // 更新提示消息内容（带动画效果）
          setTimeout(() => {
            setMessages(prev => prev.map(msg =>
              msg.id === instructionMessageId
                ? {
                    ...msg,
                    content: `📋 收到感知组件指令：${matchedComponent.name} (工作流)，正在执行该步骤...`,
                    isThinking: false,
                  }
                : msg
            ));
          }, 500);
          
          // 执行感知组件
          await handleExecuteWorkflow(latestWorkflowMessage.id);
        }
        
        setInput('');
        return;
      }
    }

    // 检查是否有待执行的工作流，如果有则回退到工作流消息之前
    const lastWorkflowMessage = messages.filter(m => m.role === 'tool' && m.workflowStatus === 'pending').pop();
    if (lastWorkflowMessage) {
      const workflowIndex = messages.findIndex(m => m.id === lastWorkflowMessage.id);
      if (workflowIndex >= 0) {
        // 回退到工作流消息之前（保留工作流消息之前的所有消息）
        const targetMessage = workflowIndex > 0 ? messages[workflowIndex - 1] : messages[0];
        await rollbackMessages(targetMessage.id);
      }
    }

    // 临时会话：不需要创建新会话，使用固定的临时会话ID
    let sessionId = isTemporarySession ? temporarySessionId : currentSessionId;
    if (!sessionId && !isTemporarySession) {
      try {
        const newSession = await createSession(selectedLLMConfigId, input.trim().substring(0, 50), 'memory');
        sessionId = newSession.session_id;
        setCurrentSessionId(sessionId);
        setIsTemporarySession(false);
        await loadSessions();
      } catch (error) {
        console.error('[Workflow] Failed to create session:', error);
        // 继续执行，即使创建会话失败
      }
    }

    // MCP 服务器是可选的，不需要强制选择

    const userMessageId = `msg-${Date.now()}`;
    
    // 如果有引用消息，在内容前添加引用信息
    let messageContent = input.trim() || (attachedMedia.length > 0 ? '[包含媒体内容]' : '');
    if (quotedMessageId) {
      const quotedMsg = messages.find(m => m.id === quotedMessageId);
      if (quotedMsg) {
        const quotedContent = quotedMsg.content.length > 200 
          ? quotedMsg.content.substring(0, 200) + '...' 
          : quotedMsg.content;
        messageContent = `[引用消息]\n${quotedContent}\n\n---\n\n${messageContent}`;
      }
    }
    
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content: messageContent,
      // 添加多模态内容
      media: attachedMedia.length > 0 ? attachedMedia.map(m => ({
        type: m.type,
        mimeType: m.mimeType,
        data: m.data,
      })) : undefined,
    };

    // 记录发送的媒体信息
    if (attachedMedia.length > 0) {
      console.log('[Workflow] 发送消息包含媒体:', attachedMedia.map(m => ({
        type: m.type,
        mimeType: m.mimeType,
        dataSize: Math.round(m.data.length / 1024) + 'KB',
      })));
    }

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setAttachedMedia([]); // 清空已发送的媒体
    setQuotedMessageId(null); // 清空引用消息
    setIsLoading(true);
    
    // 保存用户消息到数据库（临时会话不保存）
    if (sessionId && !isTemporarySession) {
      try {
        // 保存时包含媒体信息（存储在 tool_calls 中作为临时方案）
        const messageData: any = {
          message_id: userMessageId,
          role: 'user',
          content: userMessage.content,
          model: selectedLLMConfig.model || 'gpt-4',
        };
        
        // 如果有媒体内容，保存到 tool_calls
        if (userMessage.media && userMessage.media.length > 0) {
          messageData.tool_calls = { media: userMessage.media };
        }
        
        await saveMessage(sessionId, messageData);
      } catch (error) {
        console.error('[Workflow] Failed to save user message:', error);
      }
    }

    try {
      // 获取API密钥（Ollama 不需要 API key）
      const apiKey = await getLLMConfigApiKey(selectedLLMConfigId);
      if (selectedLLMConfig.provider !== 'ollama' && !apiKey) {
        throw new Error('API密钥未配置，请检查LLM配置');
      }

      // 收集所有可用的MCP工具（如果选择了MCP服务器）
      const allTools: MCPTool[] = [];
      if (selectedMcpServerIds.size > 0) {
        for (const serverId of selectedMcpServerIds) {
          const tools = mcpTools.get(serverId) || [];
          allTools.push(...tools);
        }
      }

      // 创建LLM客户端（传递 thinking 配置）
      // 使用模型配置中的 thinking 模式，而不是用户切换的状态
      const enableThinking = selectedLLMConfig.metadata?.enableThinking ?? false;
      const llmClient = new LLMClient({
        id: selectedLLMConfig.config_id,
        provider: selectedLLMConfig.provider,
        name: selectedLLMConfig.name,
        apiKey: apiKey,
        apiUrl: selectedLLMConfig.api_url,
        model: selectedLLMConfig.model,
        enabled: selectedLLMConfig.enabled,
        metadata: {
          ...selectedLLMConfig.metadata,
          enableThinking: enableThinking, // 使用模型配置中的 thinking 模式
        },
      });

      // 构建系统提示词
      // 优先使用会话属性中的人设，其次使用默认提示词
      let systemPrompt = currentSystemPrompt || '你是一个智能工作流助手，可以帮助用户完成各种任务。';
      
      if (currentSystemPrompt) {
        console.log('[Workflow] 使用会话人设:', currentSystemPrompt.slice(0, 50) + '...');
      }
      
      // 添加历史总结（如果有，临时会话不添加）
      if (summaries.length > 0 && !isTemporarySession) {
        const summaryTexts = summaries.map(s => s.summary_content).join('\n\n');
        systemPrompt += `\n\n以下是之前对话的总结，请参考这些上下文：\n\n${summaryTexts}\n\n`;
      }
      
      // 添加选定的批次数据项（如果有）
      if (selectedBatchItem) {
        const { item, batchName } = selectedBatchItem;
        systemPrompt += `\n\n【参考资料 - ${batchName}】\n`;
        if (item.title) {
          systemPrompt += `标题: ${item.title}\n`;
        }
        if (item.content) {
          systemPrompt += `内容:\n${item.content}\n`;
        }
        systemPrompt += '\n请基于以上参考资料回答用户的问题。';
        
        console.log('[Workflow] 添加批次数据项到系统提示词:', { item, batchName });
      }
      
      // 添加技能包信息（如果有）
      // 合并会话分配的技能包和通过@选择器选择的技能包
      const selectedSkillPacks = selectedComponents
        .filter(c => c.type === 'skillpack')
        .map(c => allSkillPacks.find(sp => sp.skill_pack_id === c.id))
        .filter((sp): sp is SkillPack => sp !== undefined);
      
      const allAvailableSkillPacks = [
        ...currentSessionSkillPacks,
        ...selectedSkillPacks.filter(sp => !currentSessionSkillPacks.some(csp => csp.skill_pack_id === sp.skill_pack_id))
      ];
      
      if (allAvailableSkillPacks.length > 0 && !isTemporarySession) {
        systemPrompt += `\n\n【可用技能包】\n以下是你可以参考使用的技能包。如果决定使用某个技能包，请在响应中明确说明："我将使用技能包：[技能包名称]"。\n\n`;
        allAvailableSkillPacks.forEach((pack, index) => {
          systemPrompt += `技能包 ${index + 1}: ${pack.name}\n${pack.summary}\n\n`;
        });
      }
      
      if (allTools.length > 0) {
        systemPrompt += `\n\n你可以使用以下 MCP 工具来帮助用户完成任务：\n\n${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n当用户需要执行操作时，使用相应的工具。用中文回复用户，并清晰地说明你执行的操作和结果。`;
      } else {
        systemPrompt += '请根据用户的问题提供有用的回答和建议。用中文回复用户。';
      }

      // 构建消息历史（用于 token 计数和自动 summarize）
      const model = selectedLLMConfig.model || 'gpt-4';
      // 使用从后端获取的 max_tokens，如果没有则使用前端函数作为后备
      const maxTokens = selectedLLMConfig.max_tokens || get_model_max_tokens(model);
      const tokenThreshold = maxTokens - 1000; // 在限额-1000时触发 summarize
      
      // 找到最近一条总结消息的位置，只计算实际会发送的消息
      let lastSummaryIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].isSummary) {
          lastSummaryIndex = i;
          break;
        }
      }
      
      // 如果找到总结消息，从总结消息开始计算（包含总结消息）；否则计算所有消息
      const messagesToCount = lastSummaryIndex >= 0 
        ? messages.slice(lastSummaryIndex)
        : messages;
      
      // 构建用于token计算的消息列表（排除不发送的系统消息）
      const conversationMessages = messagesToCount
        .filter(m => {
          // 排除系统消息（但包含总结消息和系统提示词消息，因为总结消息会作为user消息发送，系统提示词消息已包含在systemPrompt中）
          if (m.role === 'system' && !m.isSummary) {
            // 检查是否是系统提示词消息
            const isSystemPrompt = m.toolCalls && 
              typeof m.toolCalls === 'object' &&
              (m.toolCalls as any).isSystemPrompt === true;
            if (!isSystemPrompt) {
              return false; // 排除普通系统消息
            }
          }
          return true;
        })
        .map(msg => {
          // 如果是总结消息，作为user消息计算token
          if (msg.isSummary) {
            return {
              role: 'user' as const,
              content: msg.content,
              thinking: undefined,
            };
          }
          return {
            role: msg.role,
            content: msg.content,
            thinking: msg.thinking,
          };
        });
      
      // 估算当前 token 数量（包括新用户消息）
      const currentTokens = estimate_messages_tokens(conversationMessages, model);
      
      // 将消息历史转换为 LLMMessage 格式（用于传递给 LLMClient）
      // 临时会话：只发送当前用户消息，不发送历史消息
      const messagesToSend = isTemporarySession 
        ? [userMessage]  // 临时会话只发送当前消息
        : (lastSummaryIndex >= 0 
        ? messages.slice(lastSummaryIndex)
          : messages);
      
      const messageHistory: LLMMessage[] = [];
      for (const msg of messagesToSend) {
        // 如果是总结消息，将其内容作为 user 消息发送
        if (msg.isSummary) {
          messageHistory.push({
            role: 'user',
            content: msg.content, // 总结内容作为 user 消息
          });
          continue;
        }
        
        // 排除其他系统消息（通知消息等），但保留系统提示词消息（它已包含在systemPrompt中，不需要重复发送）
        if (msg.role === 'system') {
          // 检查是否是系统提示词消息
          const isSystemPrompt = msg.toolCalls && 
            typeof msg.toolCalls === 'object' &&
            (msg.toolCalls as any).isSystemPrompt === true;
          if (!isSystemPrompt) {
            continue; // 排除普通系统消息
          }
          // 系统提示词消息也不发送（因为它已包含在systemPrompt中）
          continue;
        }
        
        // 如果是 workflow 类型的 tool 消息，转换为 tool 类型
        if (msg.role === 'tool' && msg.toolType === 'workflow') {
          const workflowOutput = msg.content || '执行完成';
          messageHistory.push({
            role: 'tool',
            name: msg.workflowName || 'workflow',
            content: `我自己执行了一些操作，有这样的输出：${workflowOutput}`,
          });
        }
        // 其他 tool 消息（如 MCP）排除
        else if (msg.role === 'tool') {
          continue;
        }
        // user 和 assistant 消息直接转换（支持多模态和思维签名）
        else if (msg.role === 'user' || msg.role === 'assistant') {
          const llmMsg: LLMMessage = {
            role: msg.role,
            content: msg.content,
          };
          
          // 添加多模态内容
          if (msg.media && msg.media.length > 0) {
            llmMsg.parts = [];
            
            // 添加文本部分
            if (msg.content) {
              llmMsg.parts.push({ text: msg.content });
            }
            
            // 添加媒体部分
            for (const media of msg.media) {
              llmMsg.parts.push({
                inlineData: {
                  mimeType: media.mimeType,
                  data: media.data,
                },
              });
            }
          }
          
          // 添加思维签名
          if (msg.thoughtSignature) {
            if (llmMsg.parts && llmMsg.parts.length > 0) {
              // 如果有 parts，将签名添加到第一个 part
              if (!llmMsg.parts[0].thoughtSignature) {
                llmMsg.parts[0].thoughtSignature = msg.thoughtSignature;
              }
            } else {
              // 如果没有 parts，使用消息级别的签名
              llmMsg.thoughtSignature = msg.thoughtSignature;
            }
          }
          
          // 添加工具调用的思维签名
          if (msg.toolCallSignatures) {
            llmMsg.toolCallSignatures = msg.toolCallSignatures;
          }
          
          // 添加工具调用（如果是 assistant 消息）
          if (msg.role === 'assistant' && msg.toolCalls && Array.isArray(msg.toolCalls)) {
            llmMsg.tool_calls = msg.toolCalls.map((tc: any) => ({
              id: tc.name || `call_${Date.now()}`,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments || {}),
              },
            }));
          }
          
          messageHistory.push(llmMsg);
        }
      }
      
      // 检查是否需要自动 summarize
      let needsSummarize = false;
      if (currentTokens > tokenThreshold) {
        console.log(`[Workflow] Token count (${currentTokens}) exceeds threshold (${tokenThreshold}), triggering summarize`);
        needsSummarize = true;
      }
      
      // 如果需要 summarize，先执行总结（临时会话不进行总结）
      if (needsSummarize && sessionId && !isTemporarySession) {
        try {
          setIsSummarizing(true);
          const messagesToSummarize = conversationMessages.slice(0, -1).map((msg, idx) => ({
            message_id: messages.find(m => m.content === msg.content && m.role === msg.role)?.id || `msg-${idx}`,
            role: msg.role,
            content: msg.content,
          }));
          
          if (messagesToSummarize.length > 0) {
            await processSummarize(sessionId, messagesToSummarize, true);
          }
        } catch (error) {
          console.error('[Workflow] Auto-summarize failed:', error);
          // 继续执行，即使 summarize 失败
        } finally {
          setIsSummarizing(false);
        }
      }

      // 创建流式响应的消息
      const assistantMessageId = `msg-${Date.now() + 1}`;
      // 只有当模型配置中启用了思考模式时，才显示"思考中"状态
      const enableThinkingMode = selectedLLMConfig.metadata?.enableThinking ?? false;
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        thinking: '',
        isStreaming: true,
        isThinking: enableThinkingMode, // 只有启用思考模式时才显示思考中
      };
      // 新消息追加到数组后面（显示在底部）
      setMessages(prev => [...prev, assistantMessage]);
      // 默认折叠思考过程
      setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));

      // 创建AbortController用于中断请求
      const controller = new AbortController();
      setAbortController(controller);
      
      // 使用LLM客户端处理用户请求（自动调用MCP工具）
      let fullResponse = '';
      let fullThinking = '';
      let hasStartedContent = false; // 标记是否开始输出内容
      
      // 创建临时消息更新函数
      const updateMessage = (content: string, thinking?: string, isThinking?: boolean, isStreaming?: boolean, currentStep?: string) => {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { 
                ...msg, 
                content, 
                thinking: thinking !== undefined ? thinking : msg.thinking,
                isThinking: isThinking !== undefined ? isThinking : msg.isThinking,
                isStreaming: isStreaming !== undefined ? isStreaming : msg.isStreaming,
                currentStep: currentStep !== undefined ? currentStep : msg.currentStep,
              }
            : msg
        ));
      };
      
      // 步骤变化回调
      const handleStepChange = (step: string) => {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { 
                ...msg, 
                currentStep: step,
              }
            : msg
        ));
      };

      // 保存请求信息用于重试
      const requestInfo = {
        userMessage: userMessage.content,
        systemPrompt,
        tools: allTools.length > 0 ? allTools : undefined,
        messageHistory,
        sessionId: sessionId || undefined, // 将 null 转换为 undefined
        messageId: assistantMessageId,
        model: selectedLLMConfig.model || 'gpt-4',
      };
      
      // 存储到 ref 中，用于快速重试
      lastRequestRef.current = requestInfo;

      try {
        if (streamEnabled) {
          // 构建包含多模态内容的 LLMMessage
          const userLLMMessage: LLMMessage = {
            role: 'user',
            content: userMessage.content,
          };
          
          // 如果有媒体内容，构建 parts
          if (userMessage.media && userMessage.media.length > 0) {
            userLLMMessage.parts = [];
            if (userMessage.content) {
              userLLMMessage.parts.push({ text: userMessage.content });
            }
            for (const media of userMessage.media) {
              userLLMMessage.parts.push({
                inlineData: {
                  mimeType: media.mimeType,
                  data: media.data,
                },
              });
            }
          }
          
          // 将用户消息添加到消息历史（包含多模态内容）
          const messageHistoryWithUser = [...messageHistory, userLLMMessage];
          
          // 流式响应模式（使用包含多模态内容的消息历史）
          const response = await llmClient.handleUserRequestWithThinking(
            userMessage.content || '', // 即使没有文本内容，也传递空字符串
            systemPrompt,
            allTools.length > 0 ? allTools : undefined,
            true, // 启用流式响应
            (chunk: string, thinking?: string) => {
              // 流式更新消息内容
              if (chunk) {
                fullResponse += chunk;
                hasStartedContent = true;
              }
              
              // 更新思考过程（即使 thinking 是空字符串也要更新，确保UI能正确显示）
              if (thinking !== undefined) {
                fullThinking = thinking; // 流式更新思考过程
              }
              
              // 根据是否有内容来决定状态
              if (hasStartedContent) {
                // 如果已经开始输出内容，思考过程应该展开但标记为回答中
                updateMessage(fullResponse, fullThinking, false, true);
              } else if (fullThinking && fullThinking.length > 0) {
                // 如果有思考内容但还没有开始输出内容，保持思考状态
                updateMessage(fullResponse, fullThinking, true, true);
              } else {
                // 既没有内容也没有思考，只有启用思考模式时才显示思考状态
                updateMessage(fullResponse, fullThinking, enableThinkingMode, true);
              }
            },
            messageHistoryWithUser, // 传递包含多模态内容的消息历史
            handleStepChange // 传递步骤变化回调
          );

          // 确保最终内容已更新（包括思考过程）
          // 结果完成后，自动折叠思考并更新状态为完成
          const finalContent = response.content || fullResponse;
          const finalThinking = response.thinking || fullThinking;
          
          // 详细打印响应内容（用于调试 gemini-image 等问题）
          console.log(`[Workflow] 📥 LLM 响应完成:`, {
            hasContent: !!response.content,
            contentLength: response.content?.length || 0,
            hasThinking: !!response.thinking,
            thinkingLength: response.thinking?.length || 0,
            hasMedia: !!response.media,
            mediaCount: response.media?.length || 0,
            fullResponseLength: fullResponse?.length || 0,
          });
          
          // 如果响应为空，打印警告
          if (!response.content && !response.media?.length) {
            console.warn(`[Workflow] ⚠️ LLM 返回了空响应！`);
            console.warn(`[Workflow] ⚠️ 完整响应对象:`, JSON.stringify(response, (key, value) => {
              if (key === 'data' && typeof value === 'string' && value.length > 100) {
                return value.substring(0, 100) + `...(${value.length} chars)`;
              }
              return value;
            }, 2));
          }
          
          // 更新消息（包含思维签名和多模态输出）
          console.log(`[Workflow] 更新 assistant 消息: content长度=${finalContent?.length || 0}, media数量=${response.media?.length || 0}`);
          if (response.media && response.media.length > 0) {
            console.log(`[Workflow] 收到 Gemini 图片:`, response.media.map(m => `${m.type}(${m.mimeType}, ${Math.round(m.data?.length / 1024)}KB)`).join(', '));
          }
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { 
                  ...msg, 
                  content: finalContent,
                  thinking: finalThinking,
                  isThinking: false,
                  isStreaming: false,
                  thoughtSignature: response.thoughtSignature, // 保存思维签名
                  toolCallSignatures: response.toolCallSignatures, // 保存工具调用的思维签名
                  media: response.media, // 保存多模态输出（图片等）
                }
              : msg
          ));
          
          // 自动折叠思考过程（如果有思考内容）
          if (finalThinking && finalThinking.trim().length > 0) {
            setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));
          }
          
          // 检测是否使用了技能包
          if (currentSessionSkillPacks.length > 0 && finalContent) {
            const skillPackUsePattern = /我将使用技能包[：:]\s*([^\n]+)/i;
            const match = finalContent.match(skillPackUsePattern);
            if (match) {
              const skillPackName = match[1].trim();
              const usedSkillPack = currentSessionSkillPacks.find(
                pack => pack.name === skillPackName || finalContent.includes(pack.name)
              );
              if (usedSkillPack) {
                setPendingSkillPackUse({
                  skillPack: usedSkillPack,
                  messageId: assistantMessageId,
                });
              }
            }
          }
          
          // 保存助手消息到数据库（流式响应模式，包含思维签名和媒体内容，临时会话不保存）
          if (sessionId && !isTemporarySession) {
            try {
              const messageData: any = {
                message_id: assistantMessageId,
                role: 'assistant',
                content: finalContent, // 保存完整的回答内容
                thinking: finalThinking, // 保存思考过程
                model: selectedLLMConfig.model || 'gpt-4',
              };
              
              // 保存思维签名和媒体内容到 tool_calls 中
              const extData: any = {};
              if (response.thoughtSignature) {
                extData.thoughtSignature = response.thoughtSignature;
              }
              if (response.toolCallSignatures) {
                extData.toolCallSignatures = response.toolCallSignatures;
              }
              // 保存 AI 生成的图片（base64）
              if (response.media && response.media.length > 0) {
                extData.media = response.media;
                console.log(`[Workflow] 保存 ${response.media.length} 个 AI 生成的媒体文件到数据库`);
              }
              
              if (Object.keys(extData).length > 0) {
                messageData.tool_calls = extData;
              }
              
              await saveMessage(sessionId, messageData);
              console.log('[Workflow] Saved assistant message to database:', assistantMessageId);
            } catch (error) {
              console.error('[Workflow] Failed to save assistant message:', error);
            }
          }
        } else {
          // 构建包含多模态内容的 LLMMessage（非流式模式）
          const userLLMMessage: LLMMessage = {
            role: 'user',
            content: userMessage.content,
          };
          
          // 如果有媒体内容，构建 parts
          if (userMessage.media && userMessage.media.length > 0) {
            userLLMMessage.parts = [];
            if (userMessage.content) {
              userLLMMessage.parts.push({ text: userMessage.content });
            }
            for (const media of userMessage.media) {
              userLLMMessage.parts.push({
                inlineData: {
                  mimeType: media.mimeType,
                  data: media.data,
                },
              });
            }
          }
          
          // 将用户消息添加到消息历史（包含多模态内容）
          const messageHistoryWithUser = [...messageHistory, userLLMMessage];
          
          // 非流式响应模式（使用包含多模态内容的消息历史）
          const response = await llmClient.handleUserRequestWithThinking(
            userMessage.content || '', // 即使没有文本内容，也传递空字符串
            systemPrompt,
            allTools.length > 0 ? allTools : undefined,
            false, // 禁用流式响应
            undefined, // 非流式模式不需要 onChunk
            messageHistoryWithUser, // 传递包含多模态内容的消息历史
            handleStepChange // 传递步骤变化回调
          );
          // 更新消息（包含思维签名和多模态输出）
          setMessages(prev => prev.map(msg => 
            msg.id === assistantMessageId 
              ? { 
                  ...msg, 
                  content: response.content,
                  thinking: response.thinking,
                  isThinking: false,
                  isStreaming: false,
                  thoughtSignature: response.thoughtSignature, // 保存思维签名
                  toolCallSignatures: response.toolCallSignatures, // 保存工具调用的思维签名
                  media: response.media, // 保存多模态输出（图片等）
                }
              : msg
          ));
          
          // 自动折叠思考过程（如果有思考内容）
          if (response.thinking && response.thinking.trim().length > 0) {
            setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));
          }
          
          // 保存助手消息到数据库（非流式响应模式，包含思维签名和媒体内容，临时会话不保存）
          if (sessionId && !isTemporarySession) {
            try {
              const messageData: any = {
                message_id: assistantMessageId,
                role: 'assistant',
                content: response.content, // 保存完整的回答内容
                thinking: response.thinking, // 保存思考过程
                model: selectedLLMConfig.model || 'gpt-4',
              };
              
              // 保存思维签名和媒体内容到 tool_calls 中
              const extData: any = {};
              if (response.thoughtSignature) {
                extData.thoughtSignature = response.thoughtSignature;
              }
              if (response.toolCallSignatures) {
                extData.toolCallSignatures = response.toolCallSignatures;
              }
              // 保存 AI 生成的图片（base64）
              if (response.media && response.media.length > 0) {
                extData.media = response.media;
                console.log(`[Workflow] 保存 ${response.media.length} 个 AI 生成的媒体文件到数据库`);
              }
              
              if (Object.keys(extData).length > 0) {
                messageData.tool_calls = extData;
              }
              
              await saveMessage(sessionId, messageData);
              console.log('[Workflow] Saved assistant message to database:', assistantMessageId);
            } catch (error) {
              console.error('[Workflow] Failed to save assistant message:', error);
            }
          }
          
          // 检测是否使用了技能包（非流式模式）
          if (currentSessionSkillPacks.length > 0 && response.content) {
            const skillPackUsePattern = /我将使用技能包[：:]\s*([^\n]+)/i;
            const match = response.content.match(skillPackUsePattern);
            if (match) {
              const skillPackName = match[1].trim();
              const usedSkillPack = currentSessionSkillPacks.find(
                pack => pack.name === skillPackName || response.content.includes(pack.name)
              );
              if (usedSkillPack) {
                setPendingSkillPackUse({
                  skillPack: usedSkillPack,
                  messageId: assistantMessageId,
                });
              }
            }
          }
        }
        
        // 无论流式还是非流式，完成后都更新 isLoading 状态
        setIsLoading(false);
      } catch (error) {
        console.error('[Workflow] Error details:', error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        // 判断错误类型
        const isNetworkError = errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('Failed to');
        const isTimeoutError = errorMsg.includes('timeout') || errorMsg.includes('AbortError');
        const isRetryable = isNetworkError || isTimeoutError;
        
        // 更新消息状态为错误
        updateMessage(
          `❌ 错误: ${errorMsg}\n\n🔍 排查步骤：\n1. 检查 LLM 模型配置是否正确\n2. 检查 MCP 服务器是否已连接\n3. 检查 API 密钥是否有效\n4. 查看浏览器控制台的详细错误信息`,
          undefined,
          false,
          false
        );
        
        // 添加错误消息（带重试按钮）
        const errorMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: `❌ 错误: ${errorMsg}

🔍 排查步骤：
1. 检查 LLM 模型配置是否正确
2. 检查 MCP 服务器是否已连接
3. 检查 API 密钥是否有效
4. 查看浏览器控制台的详细错误信息`,
          // 添加错误元数据，用于UI显示重试按钮
          toolCalls: isRetryable ? { 
            canRetry: true, 
            errorType: (isNetworkError ? 'network' : isTimeoutError ? 'timeout' : 'unknown') as 'network' | 'timeout' | 'api' | 'unknown'
          } : undefined,
        };
        
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId ? errorMessage : msg
        ));
      } finally {
        setIsLoading(false);
      }
    } catch (outerError) {
      // 外层错误处理（如果内层try-catch没有捕获到）
      console.error('[Workflow] Outer error:', outerError);
      setIsLoading(false);
    }
  };
  
  // 快速重试失败的消息
  const handleRetryMessage = async (messageId: string) => {
    if (!lastRequestRef.current) {
      console.error('[Workflow] No previous request to retry');
      return;
    }
    
    const request = lastRequestRef.current;
    
    // 找到错误消息
    const errorMessage = messages.find(m => m.id === messageId);
    if (!errorMessage || errorMessage.role !== 'assistant') {
      return;
    }
    
    // 检查是否可以重试
    const canRetry = errorMessage.toolCalls && 
      typeof errorMessage.toolCalls === 'object' &&
      (errorMessage.toolCalls as any).canRetry === true;
    
    if (!canRetry) {
      alert('此错误无法自动重试，请检查配置后手动重试');
      return;
    }
    
    try {
      setIsLoading(true);
      
      // 更新消息状态为"重试中"
      setMessages(prev => prev.map(msg => 
        msg.id === messageId
          ? {
              ...msg,
              content: '🔄 正在重试...',
              isStreaming: true,
            }
          : msg
      ));
      
      // 重新发送请求（传递 thinking 配置）
      // 使用模型配置中的 thinking 模式，而不是用户切换的状态
      const enableThinking = selectedLLMConfig!.metadata?.enableThinking ?? false;
      const llmClient = new LLMClient({
        id: selectedLLMConfig!.config_id,
        provider: selectedLLMConfig!.provider,
        name: selectedLLMConfig!.name,
        apiKey: await getLLMConfigApiKey(selectedLLMConfigId!),
        apiUrl: selectedLLMConfig!.api_url,
        model: selectedLLMConfig!.model,
        enabled: selectedLLMConfig!.enabled,
        metadata: {
          ...selectedLLMConfig!.metadata,
          enableThinking: enableThinking, // 使用模型配置中的 thinking 模式
        },
      });
      
      let fullResponse = '';
      let fullThinking = '';
      let hasStartedContent = false;
      
      const updateMessage = (content: string, thinking?: string, isThinking?: boolean, isStreaming?: boolean, currentStep?: string) => {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { 
                ...msg, 
                content, 
                thinking: thinking !== undefined ? thinking : msg.thinking,
                isThinking: isThinking !== undefined ? isThinking : msg.isThinking,
                isStreaming: isStreaming !== undefined ? isStreaming : msg.isStreaming,
                currentStep: currentStep !== undefined ? currentStep : msg.currentStep,
              }
            : msg
        ));
      };
      
      // 步骤变化回调（用于重试）
      const handleStepChange = (step: string) => {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { 
                ...msg, 
                currentStep: step,
              }
            : msg
        ));
      };
      
      if (streamEnabled) {
        const response = await llmClient.handleUserRequestWithThinking(
          request.userMessage,
          request.systemPrompt,
          request.tools,
          true,
          (chunk: string, thinking?: string) => {
            // 流式更新消息内容
            if (chunk) {
              fullResponse += chunk;
              hasStartedContent = true;
            }
            
            // 更新思考过程（即使 thinking 是空字符串也要更新，确保UI能正确显示）
            if (thinking !== undefined) {
              fullThinking = thinking; // 流式更新思考过程
            }
            
            // 根据是否有内容来决定状态
            if (hasStartedContent) {
              // 如果已经开始输出内容，思考过程应该展开但标记为回答中
              updateMessage(fullResponse, fullThinking, false, true);
            } else if (fullThinking && fullThinking.length > 0) {
              // 如果有思考内容但还没有开始输出内容，保持思考状态
              updateMessage(fullResponse, fullThinking, true, true);
            } else {
              // 既没有内容也没有思考，只有启用思考模式时才显示思考状态
              updateMessage(fullResponse, fullThinking, enableThinking, true);
            }
          },
          request.messageHistory,
          handleStepChange
        );
        
        const finalContent = response.content || fullResponse;
        const finalThinking = response.thinking || fullThinking;
        updateMessage(finalContent, finalThinking, false, false);
        
        // 如果有多模态输出（图片等），添加到消息
        if (response.media && response.media.length > 0) {
          setMessages(prev => prev.map(msg => 
            msg.id === messageId ? { ...msg, media: response.media } : msg
          ));
        }
        
        if (finalThinking && finalThinking.trim().length > 0) {
          setCollapsedThinking(prev => new Set(prev).add(messageId));
        }
        
        // 保存到数据库（临时会话不保存）
        if (request.sessionId && !isTemporarySession) {
          try {
            const messageData: any = {
              message_id: messageId,
              role: 'assistant',
              content: finalContent,
              thinking: finalThinking,
              model: request.model || 'gpt-4',
            };
            
            // 保存媒体内容到 tool_calls 中
            if (response.media && response.media.length > 0) {
              messageData.tool_calls = { media: response.media };
              console.log(`[Workflow] 保存 ${response.media.length} 个 AI 生成的媒体文件到数据库`);
            }
            
            await saveMessage(request.sessionId, messageData);
          } catch (error) {
            console.error('[Workflow] Failed to save retried message:', error);
          }
        }
      } else {
        const response = await llmClient.handleUserRequestWithThinking(
          request.userMessage,
          request.systemPrompt,
          request.tools,
          false,
          undefined,
          request.messageHistory,
          handleStepChange
        );
        updateMessage(response.content, response.thinking, false, false);
        
        // 如果有多模态输出（图片等），添加到消息
        if (response.media && response.media.length > 0) {
          setMessages(prev => prev.map(msg => 
            msg.id === messageId ? { ...msg, media: response.media } : msg
          ));
        }
        
        if (response.thinking && response.thinking.trim().length > 0) {
          setCollapsedThinking(prev => new Set(prev).add(messageId));
        }
        
        // 保存到数据库
        if (request.sessionId) {
          try {
            const messageData: any = {
              message_id: messageId,
              role: 'assistant',
              content: response.content,
              thinking: response.thinking,
              model: request.model || 'gpt-4',
            };
            
            // 保存媒体内容到 tool_calls 中
            if (response.media && response.media.length > 0) {
              messageData.tool_calls = { media: response.media };
              console.log(`[Workflow] 保存 ${response.media.length} 个 AI 生成的媒体文件到数据库`);
            }
            
            await saveMessage(request.sessionId, messageData);
          } catch (error) {
            console.error('[Workflow] Failed to save retried message:', error);
          }
        }
      }
    } catch (error) {
      console.error('[Workflow] Retry failed:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 更新错误消息
      setMessages(prev => prev.map(msg => 
        msg.id === messageId
          ? {
              ...msg,
              content: `❌ 重试失败: ${errorMsg}\n\n请检查网络连接或稍后重试。`,
              isStreaming: false,
            }
          : msg
      ));
    } finally {
      setIsLoading(false);
    }
  };

  // 创建技能包
  const handleCreateSkillPack = async () => {
    if (!currentSessionId || selectedMessageIds.size === 0) {
      alert('请先选择要创建技能包的消息');
      return;
    }
    
    if (!selectedLLMConfigId) {
      alert('请先选择LLM模型用于生成技能包总结');
      return;
    }
    
    try {
      setIsCreatingSkillPack(true);
      
      const result = await createSkillPack({
        session_id: currentSessionId,
        message_ids: Array.from(selectedMessageIds),
        llm_config_id: selectedLLMConfigId,
      });
      
      setSkillPackResult(result);
      setSkillPackProcessInfo(result.process_info);
      setSkillPackConversationText(result.conversation_text);
      setShowSkillPackDialog(true);
      setSkillPackSelectionMode(false);
      setSelectedMessageIds(new Set());
    } catch (error: any) {
      console.error('[Workflow] Failed to create skill pack:', error);
      alert(`创建技能包失败: ${error.message}`);
    } finally {
      setIsCreatingSkillPack(false);
    }
  };

  // 保存技能包
  const handleSaveSkillPack = async () => {
    if (!skillPackResult) return;
    
    try {
      const saved = await saveSkillPack({
        name: skillPackResult.name,
        summary: skillPackResult.summary,
        source_session_id: skillPackResult.source_session_id,
        source_messages: skillPackResult.source_messages,
      });
      
      setShowSkillPackDialog(false);
      setSkillPackResult(null);
      setSkillPackProcessInfo(null);
      setSkillPackConversationText('');
      setOptimizationPrompt('');
      alert(`技能包 "${saved.name}" 保存成功！`);
    } catch (error: any) {
      console.error('[Workflow] Failed to save skill pack:', error);
      alert(`保存技能包失败: ${error.message}`);
    }
  };

  // 优化技能包总结
  const handleOptimizeSkillPack = async () => {
    if (!skillPackResult || !selectedLLMConfigId) return;
    
    try {
      setIsOptimizing(true);
      
      const optimized = await optimizeSkillPackSummary({
        conversation_text: skillPackConversationText,
        current_summary: skillPackResult.summary,
        optimization_prompt: optimizationPrompt,
        llm_config_id: selectedLLMConfigId,
        mcp_server_ids: selectedMCPForOptimization,
      });
      
      setSkillPackResult({
        ...skillPackResult,
        name: optimized.name,
        summary: optimized.summary,
      });
      setOptimizationPrompt('');
    } catch (error: any) {
      console.error('[Workflow] Failed to optimize skill pack:', error);
      alert(`优化技能包失败: ${error.message}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  // 切换消息选择状态
  const toggleMessageSelection = (messageId: string) => {
    if (!skillPackSelectionMode) return;
    
    setSelectedMessageIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // IME composing should not trigger send.
    if (isComposingRef.current || (e.nativeEvent as any)?.isComposing) return;
    // If any selector is open, let it handle Enter.
    if (showBatchItemSelector || showModuleSelector || showAtSelector) return;
    // shift+Enter: newline
    if (e.shiftKey) return;
    // Enter / Ctrl+Enter / Cmd+Enter: send
    e.preventDefault();
    handleSend();
  };

  // 开始编辑消息
  const handleStartEdit = (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (message && message.role === 'user') {
      setEditingMessageId(messageId);
      setInput(message.content);
      inputRef.current?.focus();
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setInput('');
  };

  // 重新发送消息（编辑后或直接重新发送）
  const handleResendMessage = async (messageId: string, newContent?: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.role !== 'user') {
      return;
    }

    const contentToSend = newContent || message.content;
    
    // 找到该消息的索引
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      return;
    }

    // 删除该消息及其之后的所有消息（包括数据库中的）
    const messagesToDelete = messages.slice(messageIndex);
    
    if (currentSessionId) {
      try {
        // 删除数据库中的消息
        for (const msg of messagesToDelete) {
          if (msg.role !== 'system') {
            try {
              await deleteMessage(currentSessionId, msg.id);
            } catch (error) {
              console.error(`[Workflow] Failed to delete message ${msg.id}:`, error);
            }
          }
        }
        
        // 清除总结缓存（因为删除了消息）
        await clearSummarizeCache(currentSessionId);
        await loadSessionSummaries(currentSessionId);
      } catch (error) {
        console.error('[Workflow] Failed to delete messages:', error);
      }
    }

    // 从消息列表中删除这些消息（保留到该消息之前的所有消息）
    setMessages(prev => prev.slice(0, messageIndex));
    
    // 取消编辑状态
    setEditingMessageId(null);
    
    // 使用新内容发送消息
    setInput(contentToSend);
    // 等待状态更新后发送
    setTimeout(() => {
      handleSend();
    }, 100);
  };

  const toggleThinkingCollapse = (messageId: string) => {
    setCollapsedThinking(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };
  
  // 处理输入框变化，检测 @ 符号和 /模块 命令
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    
    const cursorPosition = e.target.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPosition);
    
    // 检测 / 命令（优先于@符号）
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    if (lastSlashIndex !== -1) {
      // 检查 / 后面是否有空格或换行（如果有，说明不是在选择）
      const textAfterSlash = textBeforeCursor.substring(lastSlashIndex + 1);
      const hasSpaceOrNewline = textAfterSlash.includes(' ') || textAfterSlash.includes('\n');
      
      // 检查是否在行首（/ 前面是行首或空格）
      const textBeforeSlash = textBeforeCursor.substring(0, lastSlashIndex);
      const isAtLineStart = textBeforeSlash.length === 0 || textBeforeSlash.endsWith('\n') || textBeforeSlash.endsWith(' ');
      
      if (!hasSpaceOrNewline && isAtLineStart) {
        // 显示模块选择器
        const query = textAfterSlash.toLowerCase();
        setModuleSelectorIndex(lastSlashIndex);
        setModuleSelectorQuery(query);
        setShowAtSelector(false); // 隐藏@选择器
        
        // 计算选择器位置（参考@选择器的逻辑，从下往上展开）
        if (inputRef.current) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          
          // 使用更可靠的方法：创建一个完全镜像 textarea 的隐藏 div 元素
          const mirror = document.createElement('div');
          
          // 复制关键样式，确保与 textarea 完全一致
          mirror.style.position = 'absolute';
          mirror.style.visibility = 'hidden';
          mirror.style.whiteSpace = styles.whiteSpace || 'pre-wrap';
          mirror.style.wordWrap = styles.wordWrap || 'break-word';
          mirror.style.overflowWrap = styles.overflowWrap || 'break-word';
          mirror.style.font = styles.font;
          mirror.style.fontSize = styles.fontSize;
          mirror.style.fontFamily = styles.fontFamily;
          mirror.style.fontWeight = styles.fontWeight;
          mirror.style.fontStyle = styles.fontStyle;
          mirror.style.letterSpacing = styles.letterSpacing;
          mirror.style.padding = styles.padding;
          mirror.style.border = styles.border;
          mirror.style.width = `${textarea.offsetWidth}px`;
          mirror.style.boxSizing = styles.boxSizing;
          mirror.style.lineHeight = styles.lineHeight;
          mirror.style.wordSpacing = styles.wordSpacing;
          mirror.style.top = `${textareaRect.top}px`;
          mirror.style.left = `${textareaRect.left}px`;
          
          // 设置文本内容到光标位置
          mirror.textContent = textBeforeCursor;
          document.body.appendChild(mirror);
          
          // 使用 Range API 来获取文本末尾（光标位置）的精确坐标
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              // 设置 range 到文本末尾（光标位置）
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              
              // 使用 right 属性来获取光标右侧的位置（更可靠）
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
              
              // 如果 right 和 left 相同（width 为 0），说明光标在文本末尾
              if (rangeRect.width === 0 && textLength > 0) {
                // 创建一个临时元素来测量文本宽度
                const measureSpan = document.createElement('span');
                measureSpan.style.font = styles.font;
                measureSpan.style.fontSize = styles.fontSize;
                measureSpan.style.fontFamily = styles.fontFamily;
                measureSpan.style.fontWeight = styles.fontWeight;
                measureSpan.style.fontStyle = styles.fontStyle;
                measureSpan.style.letterSpacing = styles.letterSpacing;
                measureSpan.style.whiteSpace = 'pre';
                measureSpan.textContent = textBeforeCursor;
                measureSpan.style.position = 'absolute';
                measureSpan.style.visibility = 'hidden';
                document.body.appendChild(measureSpan);
                const textWidth = measureSpan.offsetWidth;
                document.body.removeChild(measureSpan);
                
                // 使用 mirror 的位置 + padding + 文本宽度
                const mirrorRect = mirror.getBoundingClientRect();
                const paddingLeft = parseFloat(styles.paddingLeft) || 0;
                cursorX = mirrorRect.left + paddingLeft + textWidth;
              }
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            // 如果 Range API 失败，使用备用方法
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            
            // 计算当前行的宽度
            const lineMeasure = document.createElement('span');
            lineMeasure.style.font = styles.font;
            lineMeasure.style.fontSize = styles.fontSize;
            lineMeasure.style.fontFamily = styles.fontFamily;
            lineMeasure.style.fontWeight = styles.fontWeight;
            lineMeasure.style.fontStyle = styles.fontStyle;
            lineMeasure.style.letterSpacing = styles.letterSpacing;
            lineMeasure.style.whiteSpace = 'pre';
            lineMeasure.textContent = lineText;
            lineMeasure.style.position = 'absolute';
            lineMeasure.style.visibility = 'hidden';
            document.body.appendChild(lineMeasure);
            const lineWidth = lineMeasure.offsetWidth;
            document.body.removeChild(lineMeasure);
            
            // 计算行高和 padding
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          // 清理临时元素
          document.body.removeChild(mirror);
          
          // 选择器尺寸
          const selectorMaxHeight = 256; // max-h-64 = 256px
          const selectorWidth = 320; // 与 CrawlerModuleSelector 的宽度一致
          const viewportWidth = window.innerWidth;
          
          // 计算选择器位置（以光标为锚点，从下往上展开）
          // 策略：弹框底部紧贴光标位置，向上扩展
          
          // 左侧位置：光标右侧，加间距
          let left = cursorX + 8;
          
          // 如果选择器会超出右侧边界，则显示在光标左侧
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8; // 显示在光标左侧
            // 如果左侧也不够，就显示在光标右侧（即使会超出）
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          
          // 确保不会超出左侧
          if (left < 10) {
            left = 10;
          }
          
          // 使用 bottom 定位：弹框底部紧贴光标，向上扩展
          // 计算 bottom 值：从窗口底部到光标位置的距离
          const bottom = window.innerHeight - cursorY + 5; // 5px 间距，让弹框稍微在光标上方
          
          // 计算可用的向上高度（从光标到屏幕顶部的空间）
          const availableHeightAbove = cursorY - 20; // 留20px顶部边距
          
          // 最大高度取较小值：配置的最大高度 或 可用空间
          const actualMaxHeight = Math.min(selectorMaxHeight, availableHeightAbove);
          
          console.log('[Workflow] Module selector position:', {
            cursorY,
            bottom,
            availableHeightAbove,
            actualMaxHeight,
            windowHeight: window.innerHeight
          });
          
          setModuleSelectorPosition({
            bottom, // 使用 bottom 定位，从下往上扩展
            left,
            maxHeight: actualMaxHeight
          } as any);
          setShowModuleSelector(true);
        }
        return;
      } else {
        // / 后面有空格或换行，或不在行首，关闭选择器
        console.log('[Workflow] / 字符条件不符合，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    } else {
      // 没有找到 / 字符，关闭选择器
      if (showModuleSelector) {
        console.log('[Workflow] 删除了 / 字符，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    }
    
    // 检测 @ 符号
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    console.log('[Workflow] Input change:', {
      value,
      cursorPosition,
      textBeforeCursor,
      lastAtIndex,
      showAtSelector,
    });
    
    if (lastAtIndex !== -1) {
      // 检查 @ 后面是否有空格或换行（如果有，说明不是在选择组件）
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const hasSpaceOrNewline = textAfterAt.includes(' ') || textAfterAt.includes('\n');
      
      console.log('[Workflow] @ symbol detected:', {
        textAfterAt,
        hasSpaceOrNewline,
      });
      
      if (!hasSpaceOrNewline) {
        // 检查是否已经选择了感知组件
        if (selectedComponents.length > 0) {
          // 已经选择了组件，提示需要先删除
          console.log('[Workflow] Component already selected, need to remove first');
          setShowAtSelector(false);
          // 可以显示一个提示，但先不显示选择器
          return;
        }
        
        // 显示选择器
        const query = textAfterAt.toLowerCase();
        setAtSelectorIndex(lastAtIndex);
        setAtSelectorQuery(query);
        
        console.log('[Workflow] Showing selector with query:', query);
        
        // 计算选择器位置（跟随光标位置，出现在右上方）
        if (inputRef.current) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          
          // 使用更可靠的方法：创建一个完全镜像 textarea 的隐藏 div 元素
          const mirror = document.createElement('div');
          
          // 复制关键样式，确保与 textarea 完全一致
          mirror.style.position = 'absolute';
          mirror.style.visibility = 'hidden';
          mirror.style.whiteSpace = styles.whiteSpace || 'pre-wrap';
          mirror.style.wordWrap = styles.wordWrap || 'break-word';
          mirror.style.overflowWrap = styles.overflowWrap || 'break-word';
          mirror.style.font = styles.font;
          mirror.style.fontSize = styles.fontSize;
          mirror.style.fontFamily = styles.fontFamily;
          mirror.style.fontWeight = styles.fontWeight;
          mirror.style.fontStyle = styles.fontStyle;
          mirror.style.letterSpacing = styles.letterSpacing;
          mirror.style.padding = styles.padding;
          mirror.style.border = styles.border;
          mirror.style.width = `${textarea.offsetWidth}px`;
          mirror.style.boxSizing = styles.boxSizing;
          mirror.style.lineHeight = styles.lineHeight;
          mirror.style.wordSpacing = styles.wordSpacing;
          mirror.style.top = `${textareaRect.top}px`;
          mirror.style.left = `${textareaRect.left}px`;
          
          // 设置文本内容到光标位置
          const textBeforeCursor = value.substring(0, cursorPosition);
          mirror.textContent = textBeforeCursor;
          
          document.body.appendChild(mirror);
          
          // 使用 Range API 来获取文本末尾（光标位置）的精确坐标
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              // 设置 range 到文本末尾（光标位置）
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              
              // 使用 right 属性来获取光标右侧的位置（更可靠）
              // 对于空 range（光标位置），right 会指向光标右侧
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
              
              // 如果 right 和 left 相同（width 为 0），说明光标在文本末尾
              // 这种情况下，我们需要测量文本的实际宽度
              if (rangeRect.width === 0 && textLength > 0) {
                // 创建一个临时元素来测量文本宽度
                const measureSpan = document.createElement('span');
                measureSpan.style.font = styles.font;
                measureSpan.style.fontSize = styles.fontSize;
                measureSpan.style.fontFamily = styles.fontFamily;
                measureSpan.style.fontWeight = styles.fontWeight;
                measureSpan.style.fontStyle = styles.fontStyle;
                measureSpan.style.letterSpacing = styles.letterSpacing;
                measureSpan.style.whiteSpace = 'pre';
                measureSpan.textContent = textBeforeCursor;
                measureSpan.style.position = 'absolute';
                measureSpan.style.visibility = 'hidden';
                document.body.appendChild(measureSpan);
                const textWidth = measureSpan.offsetWidth;
                document.body.removeChild(measureSpan);
                
                // 使用 mirror 的位置 + padding + 文本宽度
                const mirrorRect = mirror.getBoundingClientRect();
                const paddingLeft = parseFloat(styles.paddingLeft) || 0;
                cursorX = mirrorRect.left + paddingLeft + textWidth;
              }
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            // 如果 Range API 失败，使用备用方法
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            
            // 计算当前行的宽度
            const lineMeasure = document.createElement('span');
            lineMeasure.style.font = styles.font;
            lineMeasure.style.fontSize = styles.fontSize;
            lineMeasure.style.fontFamily = styles.fontFamily;
            lineMeasure.style.fontWeight = styles.fontWeight;
            lineMeasure.style.fontStyle = styles.fontStyle;
            lineMeasure.style.letterSpacing = styles.letterSpacing;
            lineMeasure.style.whiteSpace = 'pre';
            lineMeasure.textContent = lineText;
            lineMeasure.style.position = 'absolute';
            lineMeasure.style.visibility = 'hidden';
            document.body.appendChild(lineMeasure);
            const lineWidth = lineMeasure.offsetWidth;
            document.body.removeChild(lineMeasure);
            
            // 计算行高和 padding
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          // 清理临时元素
          document.body.removeChild(mirror);
          
          // 选择器尺寸
          const selectorMaxHeight = 256; // max-h-64 = 256px
          const selectorWidth = 300; // maxWidth
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          
          // 计算选择器位置（以光标为锚点，从下往上展开）
          // 策略：弹框底部对齐光标位置，向上展开
          // 先计算弹框的理想高度（最大不超过 selectorMaxHeight）
          const idealHeight = selectorMaxHeight;
          
          // 计算弹框顶部位置：光标位置 - 弹框高度
          // 这样弹框底部会对齐光标位置
          let top = cursorY - idealHeight;
          let left = cursorX + 8; // 光标右侧，加上间距
          
          // 如果弹框会超出顶部，调整位置
          // 确保至少留出 10px 的顶部边距
          if (top < 10) {
            // 如果上方空间不足，限制弹框高度，使其顶部对齐到 10px
            // 这样弹框会从顶部开始，但底部尽量靠近光标
            // 注意：实际高度会在 CSS 中通过 max-height 限制，位置会在 useEffect 中进一步调整
            top = 10;
          }
          
          // 如果选择器会超出右侧边界，则显示在光标左侧
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8; // 显示在光标左侧
            // 如果左侧也不够，就显示在光标右侧（即使会超出）
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          
          // 确保不会超出左侧
          if (left < 10) {
            left = 10;
          }
          
          // 计算实际可用的最大高度（从 top 到光标位置的距离）
          const maxAvailableHeight = cursorY - top - 8; // 减去一些间距
          
          // 如果可用高度小于最大高度，使用可用高度
          const actualMaxHeight = Math.min(selectorMaxHeight, maxAvailableHeight);
          
          console.log('[Workflow] Selector position calculated (cursor):', { 
            top, 
            left, 
            cursorX,
            cursorY,
            textareaRect,
            viewportHeight,
            viewportWidth,
            cursorPosition,
            actualMaxHeight,
            maxAvailableHeight
          });
          
          setAtSelectorPosition({ 
            top, 
            left,
            maxHeight: actualMaxHeight // 传递最大高度
          });
          setShowAtSelector(true);
          setSelectedComponentIndex(0); // 重置选中索引
        } else {
          console.warn('[Workflow] inputRef.current is null');
        }
      } else {
        console.log('[Workflow] Hiding selector: space or newline after @');
        setShowAtSelector(false);
      }
    } else {
      console.log('[Workflow] No @ symbol found, hiding selector');
      setShowAtSelector(false);
    }
  };
  
  // 获取可选择的组件列表（用于键盘导航）- 显示所有MCP，不仅仅是已连接的
  const getSelectableComponents = React.useCallback(() => {
    const mcpList = mcpServers
      .filter(s => s.name.toLowerCase().includes(atSelectorQuery))
      .map(s => ({ type: 'mcp' as const, id: s.id, name: s.name }));
    
    const workflowList = workflows
      .filter(w => w.name.toLowerCase().includes(atSelectorQuery))
      .map(w => ({ type: 'workflow' as const, id: w.workflow_id, name: w.name }));
    
    const skillPackList = allSkillPacks
      .filter(sp => sp.name.toLowerCase().includes(atSelectorQuery))
      .map(sp => ({ type: 'skillpack' as const, id: sp.skill_pack_id, name: sp.name }));
    
    return [...mcpList, ...workflowList, ...skillPackList];
  }, [mcpServers, workflows, allSkillPacks, atSelectorQuery]);
  
  // 处理模块选择（/模块命令）
  const handleModuleSelect = async (moduleId: string, batchId: string, batchName: string) => {
    try {
      // 获取批次数据
      const batch = await getBatch(moduleId, batchId);
      
      // 检查数据是否存在
      if (!batch || !batch.crawled_data) {
        alert('该批次没有数据');
        return;
      }
      
      // 优先使用 parsed_data（用户标记后生成的解析数据），如果没有则使用 crawled_data.normalized
      // parsed_data 现在是一个简单的数组，每个元素包含 title 和 content
      let normalizedData: any = null;
      
      if (batch.parsed_data && Array.isArray(batch.parsed_data)) {
        // parsed_data 是数组格式，转换为对象格式
        normalizedData = {
          items: batch.parsed_data.map((item, index) => ({
            id: `item_${index + 1}`,
            title: item.title || '',
            content: item.content || ''
          })),
          total_count: batch.parsed_data.length,
          format: 'list'
        };
      } else if (batch.parsed_data && typeof batch.parsed_data === 'object') {
        // parsed_data 是对象格式（兼容旧数据）
        normalizedData = batch.parsed_data;
      } else if (batch.crawled_data?.normalized) {
        // 使用 crawled_data.normalized
        normalizedData = batch.crawled_data.normalized;
      }
      
      if (!normalizedData || !normalizedData.items || normalizedData.items.length === 0) {
        alert('该批次没有解析数据，请先在爬虫配置页面标记并生成解析数据');
        return;
      }
      
      // 如果有多个数据项，显示选择器让用户选择
      if (normalizedData.items.length > 1) {
        setSelectedBatch(batch);
        setShowModuleSelector(false);
        
        // 计算批次数据项选择器的位置（使用相同的位置计算逻辑）
        if (inputRef.current && moduleSelectorIndex !== -1) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          const cursorPosition = moduleSelectorIndex + 1 + moduleSelectorQuery.length;
          const textBeforeCursor = input.substring(0, cursorPosition);
          
          // 使用与模块选择器相同的位置计算逻辑
          const mirror = document.createElement('div');
          mirror.style.position = 'absolute';
          mirror.style.visibility = 'hidden';
          mirror.style.whiteSpace = styles.whiteSpace || 'pre-wrap';
          mirror.style.wordWrap = styles.wordWrap || 'break-word';
          mirror.style.overflowWrap = styles.overflowWrap || 'break-word';
          mirror.style.font = styles.font;
          mirror.style.fontSize = styles.fontSize;
          mirror.style.fontFamily = styles.fontFamily;
          mirror.style.fontWeight = styles.fontWeight;
          mirror.style.fontStyle = styles.fontStyle;
          mirror.style.letterSpacing = styles.letterSpacing;
          mirror.style.padding = styles.padding;
          mirror.style.border = styles.border;
          mirror.style.width = `${textarea.offsetWidth}px`;
          mirror.style.boxSizing = styles.boxSizing;
          mirror.style.lineHeight = styles.lineHeight;
          mirror.style.wordSpacing = styles.wordSpacing;
          mirror.style.top = `${textareaRect.top}px`;
          mirror.style.left = `${textareaRect.left}px`;
          mirror.textContent = textBeforeCursor;
          document.body.appendChild(mirror);
          
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            const lineMeasure = document.createElement('span');
            lineMeasure.style.font = styles.font;
            lineMeasure.style.fontSize = styles.fontSize;
            lineMeasure.style.fontFamily = styles.fontFamily;
            lineMeasure.style.fontWeight = styles.fontWeight;
            lineMeasure.style.fontStyle = styles.fontStyle;
            lineMeasure.style.letterSpacing = styles.letterSpacing;
            lineMeasure.style.whiteSpace = 'pre';
            lineMeasure.textContent = lineText;
            lineMeasure.style.position = 'absolute';
            lineMeasure.style.visibility = 'hidden';
            document.body.appendChild(lineMeasure);
            const lineWidth = lineMeasure.offsetWidth;
            document.body.removeChild(lineMeasure);
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          document.body.removeChild(mirror);
          
          const selectorMaxHeight = 400;
          const selectorWidth = 500;
          const viewportWidth = window.innerWidth;
          const idealHeight = selectorMaxHeight;
          let top = cursorY - idealHeight;
          let left = cursorX + 8;
          
          if (top < 10) {
            top = 10;
          }
          
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8;
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          
          if (left < 10) {
            left = 10;
          }
          
          const maxAvailableHeight = cursorY - top - 8;
          const actualMaxHeight = Math.min(selectorMaxHeight, maxAvailableHeight);
          
          setBatchItemSelectorPosition({
            top,
            left,
            maxHeight: actualMaxHeight
          });
          setShowBatchItemSelector(true);
        }
      } else {
        // 只有一个数据项，直接插入
        const item = normalizedData.items[0];
        handleBatchItemSelect(item, batchName);
      }
    } catch (error: any) {
      console.error('[Workflow] Failed to select module:', error);
      alert(`获取模块数据失败: ${error.message || '未知错误'}`);
    }
  };
  
  // 处理批次数据项选择（显示操作选择界面）
  const handleBatchItemSelect = (item: any, batchName: string) => {
    console.log('[Workflow] 选定批次数据项，等待用户选择操作:', { item, batchName });
    
    // 保存待处理的批次数据项
    setPendingBatchItem({ item, batchName });
    
    // 关闭选择器
    setShowBatchItemSelector(false);
    setShowModuleSelector(false);
    setModuleSelectorIndex(-1);
    setModuleSelectorQuery('');
    setSelectedBatch(null);
    
    // 如果还在输入框中保留了 /模块 文本，清除它
    if (inputRef.current && moduleSelectorIndex !== -1) {
      const textBefore = input.substring(0, moduleSelectorIndex);
      const textAfter = input.substring(moduleSelectorIndex + 1 + moduleSelectorQuery.length);
      const newText = textBefore + textAfter;
      setInput(newText);
      
      // 设置光标位置
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(textBefore.length, textBefore.length);
          inputRef.current.focus();
        }
      }, 0);
    }
  };
  
  // 将批次数据项设置为系统提示词（人设）
  const handleSetAsSystemPrompt = async () => {
    if (!pendingBatchItem) return;
    
    const { item, batchName } = pendingBatchItem;
    console.log('[Workflow] 设置批次数据项为人设:', { item, batchName });
    
    // 构建人设内容
    let systemPromptContent = '';
    if (item.title) {
      systemPromptContent += `【${batchName}】${item.title}\n\n`;
    }
    if (item.content) {
      systemPromptContent += item.content;
    }
    
    // 保存选定的批次数据项（用于显示）
    setSelectedBatchItem({ item, batchName });
    setPendingBatchItem(null);
    
    // 更新会话的人设属性
    if (currentSessionId) {
      try {
        await updateSessionSystemPrompt(currentSessionId, systemPromptContent);
        setCurrentSystemPrompt(systemPromptContent);
        // 更新 sessions 列表
        setSessions(prev => prev.map(s => 
          s.session_id === currentSessionId ? { ...s, system_prompt: systemPromptContent } : s
        ));
        console.log('[Workflow] 人设已更新');
      } catch (error) {
        console.error('[Workflow] Failed to update system prompt:', error);
      }
    } else {
      // 没有会话时，只更新本地状态
      setCurrentSystemPrompt(systemPromptContent);
    }
  };
  
  // 将批次数据项作为对话内容插入
  const handleInsertAsMessage = () => {
    if (!pendingBatchItem) return;
    
    const { item, batchName } = pendingBatchItem;
    console.log('[Workflow] 将批次数据项插入为对话内容:', { item, batchName });
    
    // 构建插入的文本
    let insertText = `[引用: ${batchName}]\n`;
    if (item.title) {
      insertText += `标题: ${item.title}\n`;
    }
    if (item.content) {
      insertText += `内容: ${item.content}\n`;
    }
    insertText += '\n';
    
    // 插入到输入框
    if (inputRef.current) {
      const currentValue = input;
      const cursorPosition = inputRef.current.selectionStart || currentValue.length;
      const textBefore = currentValue.substring(0, cursorPosition);
      const textAfter = currentValue.substring(cursorPosition);
      const newText = textBefore + insertText + textAfter;
      
      setInput(newText);
      setPendingBatchItem(null);
      
      // 设置光标位置
      setTimeout(() => {
        if (inputRef.current) {
          const newCursorPos = textBefore.length + insertText.length;
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
          inputRef.current.focus();
        }
      }, 0);
    }
  };
  
  // 选择感知组件（添加为 tag）
  const handleSelectComponent = async (component: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => {
    if (atSelectorIndex === -1) return;
    
    // 检查是否已经选择了组件（限制只能选择一个）
    if (selectedComponents.length > 0) {
      console.log('[Workflow] Component already selected, cannot add another');
      // 显示提示信息
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '⚠️ 只能选择一个感知组件。请先删除已选择的组件，然后再选择新的组件。',
      };
      // 新消息追加到数组后面（显示在底部）
      setMessages(prev => [...prev, errorMsg]);
      setShowAtSelector(false);
      setAtSelectorIndex(-1);
      setAtSelectorQuery('');
      return;
    }
    
    // 检查是否已经添加过该组件
    const isAlreadySelected = selectedComponents.some(
      c => c.id === component.id && c.type === component.type
    );
    
    if (!isAlreadySelected) {
      // 如果是workflow，自动初始化（使用池化管理）
      if (component.type === 'workflow') {
        try {
          console.log(`[Workflow] Auto-initializing workflow: ${component.name} (${component.id})`);
          const instance = await workflowPool.acquireWorkflow(component.id);
          console.log(`[Workflow] Workflow initialized with ${instance.mcpClients.size} MCP clients`);
        } catch (error) {
          console.error(`[Workflow] Failed to initialize workflow:`, error);
          // 即使初始化失败，也允许添加组件（可能后续会重试）
        }
      }
      
      // 添加到已选定的组件列表
      setSelectedComponents(prev => [...prev, component]);
      
      // 如果是MCP服务器，自动激活它（添加到selectedMcpServerIds）
      if (component.type === 'mcp') {
        // 如果MCP服务器未连接，先尝试连接
        if (!connectedMcpServerIds.has(component.id)) {
          console.log('[Workflow] MCP server not connected, attempting to connect:', component.name);
          try {
            await handleConnectServer(component.id);
          } catch (error) {
            console.error('[Workflow] Failed to connect MCP server:', error);
          }
        }
        // 连接后添加到选中列表
        setSelectedMcpServerIds(prev => {
          const newSet = new Set(prev);
          newSet.add(component.id);
          return newSet;
        });
        console.log('[Workflow] Auto-activated MCP server:', component.name);
      }
    }
    
    // 移除输入框中的 @ 符号及其后的内容
    const beforeAt = input.substring(0, atSelectorIndex);
    const afterAt = input.substring(atSelectorIndex + 1);
    const spaceIndex = afterAt.indexOf(' ');
    const newlineIndex = afterAt.indexOf('\n');
    const endIndex = spaceIndex !== -1 && newlineIndex !== -1 
      ? Math.min(spaceIndex, newlineIndex)
      : spaceIndex !== -1 
      ? spaceIndex 
      : newlineIndex !== -1 
      ? newlineIndex 
      : afterAt.length;
    
    // 移除 @ 符号和查询文本，保留后续内容
    const newInput = beforeAt + afterAt.substring(endIndex);
    setInput(newInput);
    setShowAtSelector(false);
    setAtSelectorIndex(-1);
    setAtSelectorQuery('');
    
    // 聚焦输入框
    if (inputRef.current) {
      inputRef.current.focus();
      const newCursorPos = atSelectorIndex;
      setTimeout(() => {
        inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };
  
  // 删除选定的组件（tag）
  const handleRemoveComponent = (index: number) => {
    const component = selectedComponents[index];
    if (component) {
      // 如果是workflow，将实例放回池中
      if (component.type === 'workflow') {
        workflowPool.returnToPool(component.id);
        console.log(`[Workflow] Returned workflow instance to pool: ${component.name} (${component.id})`);
      }
      
      // 如果是MCP服务器，从selectedMcpServerIds中移除
      if (component.type === 'mcp') {
        setSelectedMcpServerIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(component.id);
          return newSet;
        });
        console.log('[Workflow] Deactivated MCP server:', component.name);
      }
    }
    setSelectedComponents(prev => prev.filter((_, i) => i !== index));
  };

  // 处理文件拖拽
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = event.target?.result as string;
          const base64Data = result.includes(',') ? result.split(',')[1] : result;
          const mimeType = file.type || 'image/png';
          
          setAttachedMedia(prev => [...prev, {
            type: 'image',
            mimeType,
            data: base64Data,
            preview: result,
          }]);
        };
        reader.readAsDataURL(file);
      }
    });
  };

  // 处理MCP和Workflow的选择（通过缩略图标）
  const handleSelectMCPFromThumbnail = (serverId: string) => {
    const server = mcpServers.find(s => s.id === serverId);
    if (server && connectedMcpServerIds.has(serverId)) {
      setSelectedMcpServerIds(prev => {
        const newSet = new Set(prev);
        newSet.add(serverId);
        return newSet;
      });
    }
  };

  const handleDeselectMCPFromThumbnail = (serverId: string) => {
    setSelectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
  };

  const handleSelectWorkflowFromThumbnail = (workflowId: string) => {
    const workflow = workflows.find(w => w.workflow_id === workflowId);
    if (workflow) {
      const component = { type: 'workflow' as const, id: workflowId, name: workflow.name };
      if (selectedComponents.length === 0) {
        setSelectedComponents([component]);
      }
    }
  };

  const handleDeselectWorkflowFromThumbnail = (workflowId: string) => {
    setSelectedComponents(prev => prev.filter(c => !(c.type === 'workflow' && c.id === workflowId)));
  };

  const handleSelectSkillPackFromThumbnail = (skillPackId: string) => {
    const skillPack = allSkillPacks.find(sp => sp.skill_pack_id === skillPackId);
    if (skillPack) {
      const component = { type: 'skillpack' as const, id: skillPackId, name: skillPack.name };
      if (!selectedComponents.some(c => c.type === 'skillpack' && c.id === skillPackId)) {
        setSelectedComponents(prev => [...prev, component]);
      }
    }
  };

  const handleDeselectSkillPackFromThumbnail = (skillPackId: string) => {
    setSelectedComponents(prev => prev.filter(c => !(c.type === 'skillpack' && c.id === skillPackId)));
  };

  // 处理附件上传
  const handleAttachFile = (files: FileList) => {
    const fileArray = Array.from(files);
    fileArray.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        // 移除 data URL 前缀，只保留 base64 数据
        const base64Data = result.includes(',') ? result.split(',')[1] : result;
        const mimeType = file.type;
        const type = mimeType.startsWith('image/') ? 'image' : 'video';
        
        setAttachedMedia(prev => [...prev, {
          type,
          mimeType,
          data: base64Data,
          preview: result, // 用于预览
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  // 获取选中的workflow IDs
  const selectedWorkflowIds = new Set(
    selectedComponents.filter(c => c.type === 'workflow').map(c => c.id)
  );

  // 获取选中的skill pack IDs
  const selectedSkillPackIds = new Set(
    selectedComponents.filter(c => c.type === 'skillpack').map(c => c.id)
  );

  // 处理拖拽组件到对话框
  const handleDropComponent = async (component: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => {
    if (!currentSessionId) {
      // 如果没有会话，先创建
      try {
        const newSession = await createSession(
          selectedLLMConfigId || undefined,
          `会话 - ${component.name}`
        );
        setCurrentSessionId(newSession.session_id);
        await loadSessions();
        // 创建会话后添加工作流消息
        addWorkflowMessage(component);
      } catch (error) {
        console.error('[Workflow] Failed to create session:', error);
        alert('创建会话失败，请重试');
      }
    } else {
      addWorkflowMessage(component);
    }
  };
  
  // 添加工作流消息（保存到数据库，以便后端API能够找到并执行）
  const addWorkflowMessage = async (component: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => {
    // 如果是技能包，不需要执行工作流，只需要在系统提示词中包含技能包内容
    if (component.type === 'skillpack') {
      // 技能包通过selectedComponents管理，在构建systemPrompt时包含
      // 这里只需要添加到selectedComponents中
      setSelectedComponents(prev => {
        const isAlreadySelected = prev.some(
          c => c.id === component.id && c.type === component.type
        );
        if (!isAlreadySelected) {
          return [...prev, component];
        }
        return prev;
      });
      return;
    }
    const workflowMessageId = `workflow-${Date.now()}`;
    
    // 如果是工作流，获取详细信息（包括节点）
    let workflowDetails: WorkflowType | null = null;
    if (component.type === 'workflow') {
      try {
        workflowDetails = await getWorkflow(component.id);
        console.log('[Workflow] Loaded workflow details:', workflowDetails);
      } catch (error) {
        console.error('[Workflow] Failed to load workflow details:', error);
      }
    }
    
    const workflowMessage: Message = {
      id: workflowMessageId,
      role: 'tool',
      content: '',
      toolType: component.type, // 'workflow' 或 'mcp'
      workflowId: component.id,
      workflowName: component.name,
      workflowStatus: 'pending',
      workflowConfig: workflowDetails?.config, // 保存工作流配置（节点和连接）
    };
    
    // 新消息追加到数组后面（显示在底部）
    setMessages(prev => [...prev, workflowMessage]);
    
    // 保存消息到数据库，tool_calls字段包含组件信息，以便后端API能够找到并执行（临时会话不保存）
    if (currentSessionId && !isTemporarySession) {
      try {
        await saveMessage(currentSessionId, {
          message_id: workflowMessageId,
          role: 'tool',
          content: '',
          tool_calls: {
            toolType: component.type,
            workflowId: component.id,
            workflowName: component.name,
            workflowStatus: 'pending',
            workflowConfig: workflowDetails?.config,
          },
        });
        console.log('[Workflow] Saved workflow message to database:', workflowMessageId);
      } catch (error) {
        console.error('[Workflow] Failed to save workflow message:', error);
      }
    }
  };
  
  // 执行工作流
  const handleExecuteWorkflow = async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || !message.workflowId) {
      console.error('[Workflow] Cannot execute workflow: message not found or missing workflowId', { messageId, message });
      alert('无法执行工作流：缺少必要信息');
      return;
    }
    
    // 检查是否选择了LLM配置
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      alert('请先选择 LLM 模型');
      return;
    }
    
    // 获取上一条消息作为输入（跳过其他工作流消息，找到用户或助手消息）
    const messageIndex = messages.findIndex(m => m.id === messageId);
    let previousMessage: Message | null = null;
    for (let i = messageIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      // 跳过工作流消息，找到用户或助手消息
      if (msg.role === 'user' || msg.role === 'assistant') {
        previousMessage = msg;
        break;
      }
    }
    
    const input = previousMessage?.content || '';
    
    if (!input) {
      alert('上一条消息为空，无法执行工作流');
      return;
    }
    
    // 更新消息状态为运行中
    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? { ...msg, workflowStatus: 'running' }
        : msg
    ));
    
    try {
      // 使用新的 message_execution API 执行感知组件
      const execution = await executeMessageComponent(
        messageId,
        selectedLLMConfigId,
        input
      );
      
      // 更新消息状态和结果
      const result = execution.result || execution.error_message || '执行完成';
      const status = execution.status === 'completed' ? 'completed' : 'error';
      
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { 
              ...msg, 
              workflowStatus: status,
              content: result,
            }
          : msg
      ));
      
      // 注意：不再直接保存消息到数据库，执行结果已通过 message_execution 表管理
      console.log('[Workflow] Execution completed:', execution);
      
    } catch (error) {
      console.error('[Workflow] Failed to execute workflow:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { 
              ...msg, 
              workflowStatus: 'error',
              content: `❌ 执行失败: ${errorMsg}`,
            }
          : msg
      ));
      
      // 注意：错误信息已通过 message_execution 表记录
      console.error('[Workflow] Execution error:', errorMsg);
    } finally {
      // 执行完成后，将workflow实例放回池中
      if (message?.workflowId) {
        workflowPool.returnToPool(message.workflowId);
        console.log(`[Workflow] Returned workflow instance to pool: ${message.workflowId}`);
      }
    }
  };

  // 删除工作流消息
  const handleDeleteWorkflowMessage = async (messageId: string) => {
    if (!confirm('确定要删除这个感知流程吗？')) {
      return;
    }
    
    // 从消息列表中删除
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
    
    // 从数据库删除（如果已保存）
    if (currentSessionId) {
      try {
        await deleteMessage(currentSessionId, messageId);
        console.log('[Workflow] Deleted workflow message:', messageId);
      } catch (error) {
        console.error('[Workflow] Failed to delete workflow message:', error);
        // 如果删除失败，恢复消息到列表中
        const message = messages.find(m => m.id === messageId);
        if (message) {
          // 新消息追加到数组后面（显示在底部）
          setMessages(prev => [...prev, message]);
          alert('删除失败，请重试');
        }
      }
    }
  };
  
  // 回退消息到指定位置（用于重新触发）
  const rollbackMessages = async (targetMessageId: string) => {
    const targetIndex = messages.findIndex(m => m.id === targetMessageId);
    if (targetIndex === -1) {
      // 如果找不到目标消息，回退到第一条消息
      setMessages(prev => prev.slice(0, 1));
      return;
    }
    
    // 找到回退范围内的所有消息ID
    const messagesToDelete = messages.slice(targetIndex + 1).map(m => m.id);
    
    // 检查回退范围内是否有工作流消息或AI回复（可能触发过summarize）
    const rollbackMessagesList = messages.slice(targetIndex + 1);
    const hasWorkflowOrAssistant = rollbackMessagesList.some(msg => 
      msg.role === 'tool' || msg.role === 'assistant'
    );
    
    // 如果回退范围内有工作流或AI回复，且存在summaries，删除summary缓存
    if (hasWorkflowOrAssistant && summaries.length > 0 && currentSessionId) {
      try {
        await clearSummarizeCache(currentSessionId);
        // 重新加载summaries
        await loadSessionSummaries(currentSessionId);
        console.log('[Workflow] Cleared summarize cache due to rollback');
      } catch (error) {
        console.error('[Workflow] Failed to clear summarize cache:', error);
      }
    }
    
    // 回退消息列表
    setMessages(prev => prev.slice(0, targetIndex + 1));
    
    // 从数据库删除回退的消息（如果已保存）
    if (currentSessionId && messagesToDelete.length > 0) {
      try {
        // TODO: 批量删除消息的API
        console.log('[Workflow] Rolled back messages:', messagesToDelete);
      } catch (error) {
        console.error('[Workflow] Failed to rollback messages:', error);
      }
    }
  };

  const renderMessageContent = (message: Message) => {
    // 思考/生成中的占位内容（当内容为空且正在处理时）
    if (message.role === 'assistant' && (!message.content || message.content.length === 0) && (message.isThinking || message.isStreaming)) {
      const hasThinkingContent = message.thinking && message.thinking.trim().length > 0;
      
      // 如果有思考内容，直接显示流式思考过程，不显示动画
      if (hasThinkingContent) {
        return (
          <div className="w-full">
            <div className="mb-2">
              <div className="flex items-center space-x-1 text-[10px] text-gray-400 dark:text-[#808080] mb-1">
                <Lightbulb className="w-3 h-3" />
                <span>思考过程</span>
                {message.isThinking && (
                  <>
                    <span>思考中...</span>
                    <span className="inline-block ml-1 w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse"></span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-[#808080] font-mono leading-relaxed whitespace-pre-wrap break-words bg-transparent">
                {message.thinking}
              </div>
            </div>
            {/* 中断按钮 */}
            {abortController && (
              <button
                onClick={() => {
                  abortController.abort();
                  setAbortController(null);
                  // 删除当前正在生成的消息
                  setMessages(prev => prev.filter(msg => msg.id !== message.id));
                  setIsLoading(false);
                }}
                className="mt-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg transition-colors"
              >
                <XCircle className="w-3.5 h-3.5 inline mr-1" />
                中断生成
              </button>
            )}
          </div>
        );
      }
      
      // 如果没有思考内容，显示简单的加载提示
      return (
        <div className="flex flex-col items-center justify-center py-4 px-4">
          <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-[#b0b0b0]">
            <Loader className="w-4 h-4 animate-spin" />
            <span>思考中...</span>
          </div>
          {/* 中断按钮 */}
          {abortController && (
            <button
              onClick={() => {
                abortController.abort();
                setAbortController(null);
                // 删除当前正在生成的消息
                setMessages(prev => prev.filter(msg => msg.id !== message.id));
                setIsLoading(false);
              }}
              className="mt-3 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg transition-colors"
            >
              <XCircle className="w-3.5 h-3.5 inline mr-1" />
              中断生成
            </button>
          )}
        </div>
      );
    }
    
    // 错误消息（带特殊样式）
    if (message.role === 'assistant' && message.content?.includes('❌ 错误')) {
      return (
        <div className="w-full">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm text-red-900 dark:text-red-100 whitespace-pre-wrap">
                  {message.content}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // 下载图片功能
    const downloadImage = (mediaItem: { type: 'image' | 'video'; mimeType: string; data: string; url?: string }, index: number) => {
      try {
        // 获取文件扩展名
        const ext = mediaItem.mimeType.split('/')[1] || 'png';
        const filename = `ai-image-${Date.now()}-${index + 1}.${ext}`;
        
        if (mediaItem.url) {
          // 如果是 URL，使用 fetch 下载
          fetch(mediaItem.url)
            .then(res => res.blob())
            .then(blob => {
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            });
        } else if (mediaItem.data) {
          // 如果是 base64 数据，转换为 blob 下载
          const byteCharacters = atob(mediaItem.data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: mediaItem.mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } catch (error) {
        console.error('下载图片失败:', error);
      }
    };
    
    // 多模态内容显示（图片、视频）
    const renderMedia = () => {
      if (!message.media || message.media.length === 0) {
        return null;
      }
      
      return (
        <div className="mb-3 space-y-2">
          {message.media.map((media, index) => (
            <div key={index} className="relative group">
              {media.type === 'image' ? (
                <div className="relative">
                  <img
                    src={media.url || `data:${media.mimeType};base64,${media.data}`}
                    alt={`图片 ${index + 1}`}
                    className="max-w-full max-h-96 rounded-lg border border-gray-300 dark:border-[#404040] object-contain cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => {
                      // 点击图片可以放大查看
                      const imgSrc = media.url || `data:${media.mimeType};base64,${media.data}`;
                      const newWindow = window.open('', '_blank');
                      if (newWindow) {
                        newWindow.document.write(`
                          <html>
                            <head><title>图片预览</title></head>
                            <body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#000">
                              <img src="${imgSrc}" style="max-width:100%;max-height:100vh;object-fit:contain;" />
                            </body>
                          </html>
                        `);
                      }
                    }}
                  />
                  {/* 悬浮操作按钮 */}
                  <div className="absolute bottom-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadImage(media, index);
                      }}
                      className="bg-primary-500/90 hover:bg-primary-600 text-white text-xs px-3 py-1.5 rounded-md flex items-center gap-1 shadow-lg transition-colors"
                      title="下载图片"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      下载
                    </button>
                    <span className="bg-black/60 text-white text-xs px-2 py-1 rounded">
                      点击放大
                    </span>
                  </div>
                </div>
              ) : (
                <div className="relative group">
                  <video
                    src={media.url || `data:${media.mimeType};base64,${media.data}`}
                    controls
                    className="max-w-full max-h-96 rounded-lg border border-gray-300 dark:border-[#404040]"
                  />
                  {/* 悬浮操作按钮 */}
                  <div className="absolute bottom-12 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadImage(media, index);
                      }}
                      className="bg-primary-500/90 hover:bg-primary-600 text-white text-xs px-3 py-1.5 rounded-md flex items-center gap-1 shadow-lg transition-colors"
                      title="下载视频"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      下载
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    };
    
    // 工具消息（感知组件）
    if (message.role === 'tool' && message.toolType) {
      const workflowConfig = message.workflowConfig;
      const nodes = workflowConfig?.nodes || [];
      const connections = workflowConfig?.connections || [];
      
      // 获取节点类型统计
      const nodeTypeCounts = nodes.reduce((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      return (
        <div className="w-full bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 rounded-xl p-5 border border-gray-200 dark:border-[#404040] shadow-lg">
          {/* 标题栏和删除按钮 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${
                message.toolType === 'workflow' 
                  ? 'bg-gray-900 dark:bg-gray-100' 
                  : 'bg-gray-800 dark:bg-gray-200'
              }`}>
                {message.toolType === 'workflow' ? (
                  <WorkflowIcon className="w-5 h-5 text-white dark:text-[#1e1e1e]" />
                ) : (
                  <Plug className="w-5 h-5 text-white dark:text-[#1e1e1e]" />
                )}
              </div>
              <div>
                <div className="font-semibold text-base text-gray-900 dark:text-[#ffffff]">
                  {message.workflowName || '感知组件'}
                </div>
                <div className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-0.5">
                  {message.toolType === 'workflow' ? '工作流组件' : message.toolType === 'mcp' ? 'MCP服务器' : '感知组件'}
                </div>
              </div>
            </div>
            <button
              onClick={() => handleDeleteWorkflowMessage(message.id)}
              className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
              title="删除感知流程"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          
          {/* 工作流执行流程图 - 优化设计 */}
          <div className="w-full bg-white dark:bg-[#2d2d2d] rounded-lg p-5 border-2 border-gray-200 dark:border-[#404040] mb-4 shadow-inner">
            <div className="flex items-center justify-between w-full">
              {/* 输入节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className="w-20 h-20 rounded-2xl bg-gray-900 dark:bg-gray-100 text-white dark:text-[#1e1e1e] flex items-center justify-center text-sm font-bold shadow-lg mb-3 transition-all">
                  输入
                </div>
                <div className="text-xs text-gray-600 dark:text-[#b0b0b0] text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-[#2d2d2d] rounded">
                  {(() => {
                    const messageIndex = messages.findIndex(m => m.id === message.id);
                    const prevMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;
                    return prevMessage?.content?.substring(0, 25) || '等待输入...';
                  })()}
                </div>
              </div>
              
              {/* 箭头 */}
              <ArrowRight className="w-10 h-10 text-gray-400 dark:text-[#b0b0b0] mx-3 flex-shrink-0" />
              
              {/* 工作流节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className={`w-24 h-24 rounded-2xl ${
                  message.workflowStatus === 'running' 
                    ? 'bg-gray-700 dark:bg-gray-300 animate-pulse shadow-xl' 
                    : message.workflowStatus === 'completed'
                    ? 'bg-gray-900 dark:bg-gray-100 shadow-xl'
                    : message.workflowStatus === 'error'
                    ? 'bg-gray-600 dark:bg-gray-500 shadow-lg'
                    : 'bg-gray-800 dark:bg-gray-200 shadow-lg'
                } text-white dark:text-[#1e1e1e] flex items-center justify-center text-xs font-bold text-center px-3 mb-3 transition-all`}>
                  <div className="truncate">{message.workflowName || '工作流'}</div>
                </div>
                <div className={`text-xs font-medium px-2 py-1 rounded ${
                  message.workflowStatus === 'pending' ? 'bg-gray-100 dark:bg-[#2d2d2d] text-gray-700 dark:text-[#ffffff]' :
                  message.workflowStatus === 'running' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' :
                  message.workflowStatus === 'completed' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                  'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                }`}>
                  {message.workflowStatus === 'pending' ? '待执行' :
                   message.workflowStatus === 'running' ? '执行中...' :
                   message.workflowStatus === 'completed' ? '已完成' :
                   message.workflowStatus === 'error' ? '执行失败' : '未知'}
                </div>
              </div>
              
              {/* 箭头 */}
              <ArrowRight className="w-10 h-10 text-gray-400 dark:text-[#b0b0b0] mx-3 flex-shrink-0" />
              
              {/* 输出节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className={`w-20 h-20 rounded-2xl ${
                  message.workflowStatus === 'completed' 
                    ? 'bg-gray-900 dark:bg-gray-100 shadow-xl' 
                    : message.workflowStatus === 'error'
                    ? 'bg-gray-600 dark:bg-gray-500 shadow-lg'
                    : 'bg-gray-300 dark:bg-[#363636] shadow-md'
                } text-white dark:text-[#1e1e1e] flex items-center justify-center text-sm font-bold mb-3 transition-all`}>
                  输出
                </div>
                <div className="text-xs text-gray-600 dark:text-[#b0b0b0] text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-[#2d2d2d] rounded">
                  {message.workflowStatus === 'completed' ? '已生成结果' :
                   message.workflowStatus === 'error' ? '执行失败' :
                   '等待输出...'}
                </div>
              </div>
            </div>
          </div>
          
          {/* 工作流内部细节（节点信息） */}
          {message.toolType === 'workflow' && nodes.length > 0 && (
            <div className="w-full bg-gray-50 dark:bg-[#363636] rounded-lg p-3 border border-gray-200 dark:border-[#404040] mb-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff] mb-2 uppercase tracking-wide">
                工作流内部结构
              </div>
              <div className="space-y-2">
                {/* 节点类型统计 */}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(nodeTypeCounts).map(([type, count]) => (
                    <div
                      key={type}
                      className="px-2.5 py-1 bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#404040] rounded text-xs text-gray-700 dark:text-[#ffffff]"
                    >
                      <span className="font-medium">{type}:</span> {count}
                    </div>
                  ))}
                </div>
                
                {/* 节点列表 */}
                <div className="mt-3 space-y-1.5">
                  <div className="text-xs font-medium text-gray-600 dark:text-[#b0b0b0] mb-1.5">
                    节点详情:
                  </div>
                  {nodes.map((node) => (
                    <div
                      key={node.id}
                      className="flex items-center space-x-2 px-2 py-1.5 bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] rounded text-xs"
                    >
                      <div className="w-2 h-2 rounded-full bg-gray-600 dark:bg-gray-400 flex-shrink-0"></div>
                      <span className="text-gray-700 dark:text-[#ffffff] font-medium">{node.type}</span>
                      {node.data.label && (
                        <span className="text-gray-500 dark:text-[#808080] truncate">- {node.data.label}</span>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* 连接信息 */}
                {connections.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-600 dark:text-[#b0b0b0] mb-1.5">
                      连接关系: {connections.length} 条
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* 执行按钮或执行结果 */}
          {message.workflowId ? (
            message.workflowStatus === 'pending' ? (
              <button
                onClick={() => handleExecuteWorkflow(message.id)}
                className="w-full bg-gray-900 dark:bg-gray-100 text-white dark:text-[#1e1e1e] hover:bg-gray-800 dark:hover:bg-gray-200 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm"
              >
                <Play className="w-4 h-4" />
                <span>开始执行</span>
              </button>
            ) : message.workflowStatus === 'running' ? (
              <div className="flex items-center justify-center space-x-2 text-gray-700 dark:text-[#ffffff] py-2.5">
                <Loader className="w-4 h-4 animate-spin" />
                <span className="text-sm font-medium">执行中...</span>
              </div>
            ) : message.workflowStatus === 'completed' || message.workflowStatus === 'error' ? (
              <div className="space-y-3">
                {/* 执行结果 */}
                <div className="bg-gray-50 dark:bg-[#363636] rounded-lg p-3 border border-gray-200 dark:border-[#404040]">
                  <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff] mb-2 uppercase tracking-wide">
                    {message.workflowStatus === 'completed' ? '执行结果' : '执行失败'}
                  </div>
                  {(() => {
                    const content = message.content || '';
                    const logMatch = content.match(/执行日志:\s*\n(.*)/s);
                    const mainContent = logMatch ? content.substring(0, logMatch.index) : content;
                    const logs = logMatch ? logMatch[1].trim().split('\n') : [];
                    
                    return (
                      <div className="space-y-3">
                        {/* 主要内容 */}
                        {mainContent && (
                          <div className="text-sm text-gray-900 dark:text-[#ffffff] whitespace-pre-wrap break-words">
                            {mainContent.trim()}
                          </div>
                        )}
                        
                        {/* 执行日志 */}
                        {logs.length > 0 && (
                          <div className="border-t border-gray-200 dark:border-[#404040] pt-3 mt-3">
                            <div className="text-xs font-semibold text-gray-600 dark:text-[#b0b0b0] mb-2">
                              执行日志
                            </div>
                            <div className="bg-gray-900 dark:bg-gray-950 text-green-400 dark:text-green-300 font-mono text-xs p-3 rounded border border-gray-700 dark:border-[#404040] max-h-64 overflow-y-auto">
                              {logs.map((log, idx) => (
                                <div key={idx} className="mb-1">
                                  {log}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                
                {/* 重新执行按钮 */}
                <button
                  onClick={() => handleExecuteWorkflow(message.id)}
                  className="w-full bg-gray-800 dark:bg-gray-200 text-white dark:text-[#1e1e1e] hover:bg-gray-700 dark:hover:bg-gray-300 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm"
                >
                  <Play className="w-4 h-4" />
                  <span>重新执行</span>
                </button>
              </div>
            ) : null
          ) : (
            <div className="text-xs text-gray-500 dark:text-[#b0b0b0] text-center py-2">
              无法执行：缺少工作流信息
            </div>
          )}
        </div>
      );
    }
    
    // 普通工具调用消息（不是感知组件）
    if (message.role === 'tool' && message.toolCalls && !message.toolType) {
      return (
        <div>
          <div className="font-medium text-sm mb-2">工具调用:</div>
          {Array.isArray(message.toolCalls) && message.toolCalls.map((toolCall: any, idx: number) => (
            <div key={idx} className="mb-3 p-3 bg-gray-50 dark:bg-[#363636] rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <Wrench className="w-4 h-4 text-primary-500" />
                <span className="font-medium text-sm">{toolCall.name}</span>
              </div>
              {toolCall.arguments && (
                <div className="text-xs text-gray-600 dark:text-[#b0b0b0] mb-2">
                  <span className="font-medium">参数:</span>
                  <pre className="mt-1 bg-white dark:bg-[#2d2d2d] p-2 rounded border text-xs overflow-auto">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                </div>
              )}
              {toolCall.result && (
                <div className="text-xs text-gray-600 dark:text-[#b0b0b0]">
                  <span className="font-medium">结果:</span>
                  <pre className="mt-1 bg-white dark:bg-[#2d2d2d] p-2 rounded border text-xs overflow-auto">
                    {JSON.stringify(toolCall.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    const isThinkingCollapsed = collapsedThinking.has(message.id);
    const hasThinking = message.thinking && message.thinking.trim().length > 0;
    const isThinkingActive = message.isThinking && message.isStreaming; // 正在思考中

    return (
      <div>
        {hasThinking && (
          <div className="mb-2">
            {isThinkingCollapsed ? (
              // 折叠状态：显示小灯泡按钮
              <button
                onClick={() => toggleThinkingCollapse(message.id)}
                className="flex items-center space-x-1 text-[10px] text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
                title="展开思考过程"
              >
                <Lightbulb className="w-3 h-3" />
                <span>思考过程</span>
              </button>
            ) : (
              // 展开状态：显示思考内容
              <div className="mb-2">
                <button
                  onClick={() => toggleThinkingCollapse(message.id)}
                  className="flex items-center space-x-1 text-[10px] text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-gray-400 transition-colors mb-1"
                  title="折叠思考过程"
                >
                  <Lightbulb className="w-3 h-3" />
                  <span>思考过程</span>
                </button>
                <div className="text-[11px] text-gray-400 dark:text-[#808080] font-mono leading-relaxed whitespace-pre-wrap break-words bg-transparent">
                  {message.thinking}
                  {isThinkingActive && (
                    <span className="inline-block ml-1 w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse"></span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {/* 如果正在思考但还没有思考内容，显示流式思考提示 */}
        {message.isThinking && !hasThinking && (
          <div className="mb-2 text-[10px] text-gray-400 dark:text-[#808080] flex items-center space-x-1">
            <Lightbulb className="w-3 h-3 animate-pulse" />
            <span>思考中...</span>
            <span className="inline-block w-1 h-1 bg-gray-400 dark:bg-gray-500 rounded-full animate-pulse"></span>
          </div>
        )}
        {/* 多模态内容显示 */}
        {renderMedia()}
        
        {/* AI 助手消息使用 Markdown 渲染 */}
        {message.role === 'assistant' ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-[#ffffff] markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // 代码块样式
                code: ({ node, inline, className, children, ...props }: any) => {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : '';
                  
                  if (!inline && match) {
                    // 代码块 - 使用独立的组件来处理复制状态
                    const codeText = String(children).replace(/\n$/, '');
                    const CodeBlock = () => {
                      const [copied, setCopied] = useState(false);
                      
                      return (
                        <div className="relative group my-3">
                          {/* 语言标签 */}
                          {language && (
                            <div className="absolute top-2 left-2 text-xs text-gray-400 dark:text-[#808080] font-mono bg-gray-800/50 dark:bg-[#363636] px-2 py-0.5 rounded z-10">
                              {language}
                            </div>
                          )}
                          <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-4 pt-8 overflow-x-auto border border-gray-700 dark:border-[#404040]">
                            <code className={className} {...props}>
                              {children}
                            </code>
                          </pre>
                          <button
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(codeText);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              } catch (err) {
                                console.error('Failed to copy:', err);
                              }
                            }}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-xs flex items-center space-x-1 z-10"
                            title="复制代码"
                          >
                            {copied ? (
                              <>
                                <CheckCircle className="w-3 h-3" />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <FileText className="w-3 h-3" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    };
                    
                    return <CodeBlock />;
                  } else {
                    // 行内代码
                    return (
                      <code className="bg-gray-100 dark:bg-[#2d2d2d] text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                        {children}
                      </code>
                    );
                  }
                },
                // 段落样式
                p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
                // 标题样式
                h1: ({ children }: any) => <h1 className="text-2xl font-bold mt-4 mb-3 first:mt-0">{children}</h1>,
                h2: ({ children }: any) => <h2 className="text-xl font-bold mt-4 mb-3 first:mt-0">{children}</h2>,
                h3: ({ children }: any) => <h3 className="text-lg font-bold mt-3 mb-2 first:mt-0">{children}</h3>,
                // 列表样式
                ul: ({ children }: any) => <ul className="list-disc list-inside mb-3 space-y-1 ml-4">{children}</ul>,
                ol: ({ children }: any) => <ol className="list-decimal list-inside mb-3 space-y-1 ml-4">{children}</ol>,
                li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
                // 引用样式
                blockquote: ({ children }: any) => (
                  <blockquote className="border-l-4 border-primary-500 dark:border-primary-400 pl-4 my-3 italic text-gray-700 dark:text-[#ffffff]">
                    {children}
                  </blockquote>
                ),
                // 链接样式
                a: ({ href, children }: any) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    {children}
                  </a>
                ),
                // 表格样式
                table: ({ children }: any) => (
                  <div className="overflow-x-auto my-3">
                    <table className="min-w-full border-collapse border border-gray-300 dark:border-[#404040]">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }: any) => (
                  <thead className="bg-gray-100 dark:bg-[#2d2d2d]">{children}</thead>
                ),
                tbody: ({ children }: any) => <tbody>{children}</tbody>,
                tr: ({ children }: any) => (
                  <tr className="border-b border-gray-200 dark:border-[#404040]">{children}</tr>
                ),
                th: ({ children }: any) => (
                  <th className="border border-gray-300 dark:border-[#404040] px-3 py-2 text-left font-semibold">
                    {children}
                  </th>
                ),
                td: ({ children }: any) => (
                  <td className="border border-gray-300 dark:border-[#404040] px-3 py-2">
                    {children}
                  </td>
                ),
                // 水平分割线
                hr: () => <hr className="my-4 border-gray-300 dark:border-[#404040]" />,
                // 强调样式
                strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }: any) => <em className="italic">{children}</em>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words text-gray-900 dark:text-[#ffffff]">
            {message.content}
          </div>
        )}
      </div>
    );
  };

  // 统计可用工具数量
  const totalTools = Array.from(mcpTools.values()).flat().length;

  return (
    <>
    <div className="h-full flex flex-col bg-gray-50 dark:bg-[#1a1a1a]">

      {/* 主要内容区域：聊天界面 - GNOME 风格布局 */}
      <div className="flex-1 flex min-h-0 p-2 gap-2">
        {/* 左侧配置面板 - 已隐藏，功能移至底部工具栏 */}
        {false && (
          <div className="w-[340px] flex-shrink-0 flex flex-col gap-4 overflow-y-auto pr-2">

          {/* 会话列表模块 - 已移至左侧边栏，此处隐藏 */}
          {false && (
          <div className="card p-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff]">
                <History className="w-4 h-4 inline mr-1" />
                会话列表
            </label>
              <div className="flex items-center space-x-1">
                <button
                  onClick={handleCreateNewSession}
                  className="flex items-center space-x-1 px-2 py-1 text-xs text-primary-600 dark:text-[#a78bfa] hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                  title="创建新会话"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新建</span>
                </button>
              </div>
            </div>
            {/* 会话列表容器：固定高度，显示5个会话项，其他需要滚动 */}
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {/* 临时会话选项 */}
              <button
                onClick={() => handleSelectSession(temporarySessionId)}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  isTemporarySession && currentSessionId === temporarySessionId
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                    : 'bg-gray-50 dark:bg-[#363636] text-gray-700 dark:text-[#ffffff] hover:bg-gray-100 dark:hover:bg-[#404040] border border-gray-200 dark:border-[#404040]'
                }`}
                title="临时会话：不保存历史记录，适合快速询问无关联问题"
              >
                <div className="flex items-center space-x-2">
                  <MessageCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="font-medium truncate">临时会话</span>
                  <span className="text-xs text-gray-500 dark:text-[#b0b0b0]">(不保存)</span>
                </div>
              </button>
              
              {/* 历史会话列表 */}
              {sessions.length === 0 ? (
                <div className="text-center py-4 text-xs text-gray-500 dark:text-[#b0b0b0]">
                  暂无历史会话
                </div>
              ) : (
                sessions.map((session) => {
                  // 确定显示的名称：优先使用 name，其次 title，最后使用 preview_text 或默认
                  const displayName = session.name || session.title || session.preview_text || `会话 ${session.session_id.substring(0, 8)}`;
                  
                  // 确定头像：session.avatar 已经是 base64 字符串（可能包含 data:image 前缀），直接使用
                  const avatarUrl = session.avatar || null;
                  
                  // 确定会话类型标签
                  const sessionTypeLabel = session.session_type === 'agent' ? '智能体' : session.session_type === 'memory' ? '记忆体' : '';
                  
                  return (
                    <div key={session.session_id} className="relative group">
                    <SessionListItem
                      session={session}
                      displayName={displayName}
                      avatarUrl={avatarUrl}
                      isSelected={currentSessionId === session.session_id}
                      onSelect={() => handleSelectSession(session.session_id)}
                      onDelete={(e: React.MouseEvent) => handleDeleteSession(session.session_id, e)}
                      onUpdateName={async (name: string) => {
                        await updateSessionName(session.session_id, name);
                        await loadSessions();
                      }}
                      onUpdateAvatar={async (avatar: string) => {
                        await updateSessionAvatar(session.session_id, avatar);
                        await loadSessions();
                        // 如果当前会话，也更新当前会话的头像状态
                        if (currentSessionId === session.session_id) {
                          setCurrentSessionAvatar(avatar || null);
                        }
                      }}
                      onConfigSaved={async () => {
                        // 直接从 API 获取最新数据（包括从圆桌面板修改的配置）
                        const allSessions = await getSessions();
                        const updatedSession = allSessions.find(s => s.session_id === session.session_id);
                        // 更新会话列表状态
                        setSessions(allSessions);
                        // 如果当前会话，也更新当前会话的状态
                        if (currentSessionId === session.session_id && updatedSession) {
                          setCurrentSessionAvatar(updatedSession.avatar || null);
                          setCurrentSystemPrompt(updatedSession.system_prompt || null);
                        }
                        // 返回更新后的会话数据，供对话框使用
                        return updatedSession || null;
                      }}
                    />
                      {/* 会话类型标签和升级按钮 */}
                      {sessionTypeLabel && (
                        <div className="absolute top-1 right-1 flex items-center space-x-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                            {sessionTypeLabel}
                          </span>
                          {session.session_type === 'memory' && (() => {
                            // 检查是否满足升级条件
                            const hasName = !!session.name;
                            const hasAvatar = !!session.avatar;
                            const hasSystemPrompt = !!session.system_prompt;
                            const canUpgrade = hasName && hasAvatar && hasSystemPrompt;
                            
                            return (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // 初始化升级对话框的数据
                                  setAgentName(session.name || '');
                                  setAgentAvatar(session.avatar || null);
                                  setAgentSystemPrompt(session.system_prompt || '');
                                  setAgentLLMConfigId(session.llm_config_id || selectedLLMConfigId || null);
                                  // 临时设置当前会话ID为要升级的会话
                                  const upgradeSessionId = session.session_id;
                                  setCurrentSessionId(upgradeSessionId);
                                  setShowUpgradeToAgentDialog(true);
                                }}
                                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                                  canUpgrade
                                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/50'
                                    : 'bg-gray-100 dark:bg-[#2d2d2d] text-gray-500 dark:text-[#b0b0b0] cursor-not-allowed'
                                }`}
                                title={canUpgrade ? '升级为智能体' : '需要设置名称、头像和人设才能升级'}
                                disabled={!canUpgrade}
                              >
                                {canUpgrade ? '升级' : '需完善'}
                              </button>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          )}

          {/* 感知组件列表（MCP + 工作流） */}
          <div className="card p-3 flex-1 flex flex-col min-h-0">
            <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
              <Brain className="w-4 h-4 inline mr-1" />
              感知组件
            </label>
            <div className="flex-1 overflow-y-auto space-y-2 border border-gray-200 dark:border-[#404040] rounded-lg p-2">
              {mcpServers.length === 0 && workflows.length === 0 ? (
                <div className="text-xs text-gray-500 dark:text-[#b0b0b0] text-center py-2">
                  暂无可用的感知组件，请先在配置页面添加
                </div>
              ) : (
                <>
                  {/* MCP 服务器分组 */}
                  {mcpServers.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-1.5 px-1.5 py-1">
                        <Plug className="w-3.5 h-3.5 text-primary-500" />
                        <span className="text-xs font-semibold text-gray-700 dark:text-[#ffffff] uppercase tracking-wide">
                          MCP 服务器
                        </span>
                        <span className="text-xs text-gray-500 dark:text-[#b0b0b0]">
                          ({mcpServers.length})
                        </span>
                      </div>
                      {mcpServers.map((server) => {
                  const isConnected = connectedMcpServerIds.has(server.id);
                  const isSelected = selectedMcpServerIds.has(server.id);
                  const isConnecting = connectingServers.has(server.id);
                  const isExpanded = expandedServerIds.has(server.id);
                  const tools = mcpTools.get(server.id) || [];
                  
                  return (
                    <div
                      key={server.id}
                      className="border border-gray-200 dark:border-[#404040] rounded-lg bg-gray-50 dark:bg-[#363636] group"
                      draggable={isConnected}
                      onDragStart={(e) => {
                        if (isConnected) {
                          setDraggingComponent({ type: 'mcp', id: server.id, name: server.name });
                          e.dataTransfer.effectAllowed = 'move';
                        }
                      }}
                      onDragEnd={() => {
                        setDraggingComponent(null);
                      }}
                    >
                      {/* 服务器主要信息行 - 始终显示 */}
                      <div className="flex items-center space-x-2 p-1.5">
                        {/* 服务器连接控制 */}
                        <button
                          onClick={() => isConnected ? handleDisconnectServer(server.id) : handleConnectServer(server.id)}
                          disabled={isConnecting}
                          className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                            isConnected
                              ? 'text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/20'
                              : 'text-gray-400 dark:text-[#808080] hover:bg-gray-200 dark:hover:bg-gray-700'
                          } ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title={isConnected ? '断开连接' : '连接'}
                        >
                          {isConnecting ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : isConnected ? (
                            <Power className="w-4 h-4" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                        </button>

                        {/* 服务器信息 - 始终显示 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap">
                            <Plug className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                            <span className="text-sm font-medium text-gray-900 dark:text-[#ffffff] truncate">
                              {server.display_name || server.client_name || server.name}
                            </span>
                            {isConnected && (
                              <span className="text-xs text-green-600 dark:text-green-400 font-medium flex-shrink-0">
                                已连接
                              </span>
                            )}
                            {isConnected && tools.length > 0 && (
                              <span className="text-xs text-gray-500 dark:text-[#b0b0b0] flex-shrink-0">
                                ({tools.length} 工具)
                              </span>
                            )}
                            {/* 服务器类型标签 */}
                            {server.ext?.server_type && (
                              <span className="text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 px-1.5 py-0.5 rounded flex-shrink-0">
                                {server.ext.server_type}
                              </span>
                            )}
                          </div>
                          {server.description && (
                            <div className="text-xs text-gray-500 dark:text-[#b0b0b0] truncate mt-0.5">
                              {server.description}
                            </div>
                          )}
                        </div>

                        {/* 展开/收起按钮（仅在已连接且有工具时显示） */}
                        {isConnected && tools.length > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleServerExpand(server.id);
                            }}
                            className="flex-shrink-0 p-1.5 text-gray-500 dark:text-[#b0b0b0] hover:text-gray-700 dark:hover:text-[#cccccc] hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                            title={isExpanded ? '收起工具' : '展开工具'}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        )}

                        {/* 使用开关（仅在已连接时可用） */}
                        {isConnected && (
                          <label className="flex items-center space-x-1 cursor-pointer flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleMcpServerUsage(server.id)}
                              className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500 dark:bg-[#363636] dark:border-[#404040]"
                            />
                            <span className="text-xs text-gray-600 dark:text-[#b0b0b0]">使用</span>
                          </label>
                        )}
                        
                        {/* 拖动触点（仅在已连接时显示） */}
                        {isConnected && (
                          <div
                            className="flex-shrink-0 p-1.5 cursor-grab active:cursor-grabbing text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-[#cccccc] transition-colors"
                            title="拖动到对话框接入"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <GripVertical className="w-4 h-4" />
                          </div>
                        )}
                      </div>

                      {/* 工具列表（展开时显示，在服务器信息下方） */}
                      {isConnected && isExpanded && tools.length > 0 && (
                        <div className="border-t border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] p-2 space-y-1.5">
                          <div className="text-xs font-medium text-gray-700 dark:text-[#ffffff] mb-1.5">
                            可用工具:
                          </div>
                          {tools.map((tool, index) => (
                            <div
                              key={index}
                              className="bg-gray-50 dark:bg-[#363636] border border-gray-200 dark:border-[#404040] rounded p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                            >
                              <div className="flex items-start space-x-2">
                                <Wrench className="w-3 h-3 text-primary-500 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-gray-900 dark:text-[#ffffff]">
                                    {tool.name}
                                  </div>
                                  {tool.description && (
                                    <div className="text-xs text-gray-600 dark:text-[#b0b0b0] mt-1">
                                      {tool.description}
                                    </div>
                                  )}
                                  {tool.inputSchema?.properties && (
                                    <div className="mt-1.5">
                                      <div className="text-xs text-gray-500 dark:text-[#b0b0b0] mb-1">参数:</div>
                                      <div className="flex flex-wrap gap-1">
                                        {Object.keys(tool.inputSchema.properties).map((param) => (
                                          <span
                                            key={param}
                                            className="text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 px-1.5 py-0.5 rounded"
                                          >
                                            {param}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                  })}
                    </div>
                  )}
                  
                  {/* 工作流分组 */}
                  {workflows.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-1.5 px-1.5 py-1">
                        <WorkflowIcon className="w-3.5 h-3.5 text-primary-500" />
                        <span className="text-xs font-semibold text-gray-700 dark:text-[#ffffff] uppercase tracking-wide">
                          工作流
                        </span>
                        <span className="text-xs text-gray-500 dark:text-[#b0b0b0]">
                          ({workflows.length})
                        </span>
                      </div>
                      {workflows.map((workflow) => (
                    <div
                      key={workflow.workflow_id}
                      className="border border-gray-200 dark:border-[#404040] rounded-lg bg-gray-50 dark:bg-[#363636] flex items-center group"
                      draggable={true}
                      onDragStart={(e) => {
                        setDraggingComponent({ type: 'workflow', id: workflow.workflow_id, name: workflow.name });
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDraggingComponent(null);
                      }}
                    >
                      <div className="flex items-center space-x-2 p-1.5 flex-1 min-w-0">
                        <WorkflowIcon className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-[#ffffff] truncate">
                            {workflow.name}
                          </div>
                          {workflow.description && (
                            <div className="text-xs text-gray-500 dark:text-[#b0b0b0] truncate mt-0.5">
                              {workflow.description}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* 拖动触点 */}
                      <div
                        className="flex-shrink-0 p-2 cursor-grab active:cursor-grabbing text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-[#cccccc] transition-colors"
                        title="拖动到对话框接入"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                    </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            {selectedMcpServerIds.size > 0 && (
              <div className="mt-2 text-xs text-gray-600 dark:text-[#b0b0b0] pt-2 border-t border-gray-200 dark:border-[#404040]">
                <span className="font-medium">已选择:</span> {selectedMcpServerIds.size} 个服务器，
                共 {totalTools} 个工具可用
              </div>
            )}
        </div>
        
        {/* 技能包列表 */}
        <div className="card p-3 flex-shrink-0">
          <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
            <Package className="w-4 h-4 inline mr-1" />
            技能包
          </label>
          <div className="space-y-1.5 border border-gray-200 dark:border-[#404040] rounded-lg p-2 max-h-64 overflow-y-auto">
            {allSkillPacks.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-[#b0b0b0] text-center py-2">
                暂无技能包，请先创建
              </div>
            ) : (
              allSkillPacks.map((skillPack) => (
                <div
                  key={skillPack.skill_pack_id}
                  className="border border-gray-200 dark:border-[#404040] rounded-lg bg-gray-50 dark:bg-[#363636] p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  onClick={() => {
                    const component = { type: 'skillpack' as const, id: skillPack.skill_pack_id, name: skillPack.name };
                    handleSelectComponent(component);
                  }}
                >
                  <div className="flex items-center space-x-2">
                    <Package className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-[#ffffff] truncate">
                        {skillPack.name}
                      </div>
                      {skillPack.summary && (
                        <div className="text-xs text-gray-500 dark:text-[#b0b0b0] truncate mt-0.5 line-clamp-2">
                          {skillPack.summary}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          </div>
        </div>
        )}

        {/* 聊天界面 - 全屏布局 */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-white dark:bg-[#2d2d2d] rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
        {/* 状态栏 - 优化样式 */}
          <div className="border-b border-gray-200 dark:border-[#404040] px-3 py-1 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              {/* 头像 - 可点击配置 */}
              <div 
                className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary-400 hover:ring-offset-1 transition-all overflow-hidden"
                onClick={() => {
                  if (currentSessionId && !isTemporarySession) {
                    // 从当前会话获取数据
                    const currentSession = sessions.find(s => s.session_id === currentSessionId);
                    if (currentSession) {
                      setHeaderConfigEditName(currentSession.name || '');
                      setHeaderConfigEditAvatar(currentSession.avatar || null);
                      setHeaderConfigEditSystemPrompt(currentSession.system_prompt || '');
                      setHeaderConfigEditMediaOutputPath(currentSession.media_output_path || '');
                      setHeaderConfigEditLlmConfigId(currentSession.llm_config_id || null);
                      setHeaderConfigActiveTab('basic');
                      setShowHeaderConfigDialog(true);
                    }
                  }
                }}
                title={currentSessionId && !isTemporarySession ? "点击配置会话" : "请先选择或创建会话"}
              >
                {currentSessionAvatar ? (
                  <img src={currentSessionAvatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <Bot className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                )}
              </div>
              <div>
                <span className="text-xs font-semibold text-gray-900 dark:text-[#ffffff] block leading-tight">
                  {(() => {
                    const currentSession = sessions.find(s => s.session_id === currentSessionId);
                    if (isTemporarySession) return '临时会话';
                    if (currentSession?.name) return currentSession.name;
                    if (currentSession?.session_type === 'agent') return '智能体';
                    return 'AI 工作流助手';
                  })()}
                </span>
                <span className="text-[10px] text-gray-500 dark:text-[#b0b0b0] leading-tight cursor-pointer hover:text-[var(--color-accent)]"
                  onClick={() => {
                    if (currentSessionId && !isTemporarySession) {
                      // 从当前会话获取数据
                      const currentSession = sessions.find(s => s.session_id === currentSessionId);
                      if (currentSession) {
                        setHeaderConfigEditName(currentSession.name || '');
                        setHeaderConfigEditAvatar(currentSession.avatar || null);
                        setHeaderConfigEditSystemPrompt(currentSession.system_prompt || '');
                        setHeaderConfigEditMediaOutputPath(currentSession.media_output_path || '');
                        setHeaderConfigEditLlmConfigId(currentSession.llm_config_id || null);
                        setHeaderConfigActiveTab('basic');
                        setShowHeaderConfigDialog(true);
                      }
                    }
                  }}
                >
                  {currentSessionId && !isTemporarySession ? '点击配置人设/模型/存储' : '智能对话与任务处理'}
                </span>
              </div>
              
              {/* 生效模型显示 - 在头像右侧 */}
              {selectedLLMConfig ? (
                <div className="flex items-center space-x-1.5 px-2 py-0.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-[10px] ml-2">
                  <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" />
                  <span className="text-green-700 dark:text-green-400 font-medium">
                    {selectedLLMConfig.name} {selectedLLMConfig.model && `(${selectedLLMConfig.model})`}
                  </span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-[10px] ml-2">
                  <AlertCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  <span className="text-amber-700 dark:text-amber-400">未配置</span>
                </div>
              )}
            </div>
            <div className="flex items-center space-x-2">
              {/* 模型选择和流式开关 - 右对齐 */}
              <div className="flex items-center space-x-2">
                <label className="text-[10px] font-medium text-gray-700 dark:text-[#ffffff] flex items-center space-x-1">
                  <Brain className="w-3 h-3" />
                  <span>模型:</span>
                </label>
                <select
                  value={selectedLLMConfigId || ''}
                  onChange={(e) => {
                    console.log('[Workflow] Select onChange:', e.target.value);
                    handleLLMConfigChange(e.target.value);
                  }}
                  className="input-field text-[10px] min-w-[140px] max-w-[180px] py-0.5 px-1.5 h-6"
                >
                  <option value="">请选择模型...</option>
                  {llmConfigs.map((config) => (
                    <option key={config.config_id} value={config.config_id}>
                      {config.name} {config.model && `(${config.model})`}
                    </option>
                  ))}
                </select>
                {/* 流式响应开关 */}
                <label className="flex items-center space-x-1 cursor-pointer group px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors">
                  <input
                    type="checkbox"
                    checked={streamEnabled}
                    onChange={(e) => setStreamEnabled(e.target.checked)}
                    className="w-3 h-3 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-[10px] text-gray-600 dark:text-[#b0b0b0]">流式</span>
                </label>
              </div>
              
              {/* 创建技能包按钮 */}
              {currentSessionId && messages.filter(m => m.role !== 'system').length > 0 && (
                <button
                  onClick={() => {
                    setSkillPackSelectionMode(!skillPackSelectionMode);
                    if (skillPackSelectionMode) {
                      setSelectedMessageIds(new Set());
                    }
                  }}
                  className={`flex items-center space-x-1 px-2.5 py-1 text-xs rounded transition-all ${
                    skillPackSelectionMode 
                      ? 'bg-primary-500 text-white' 
                      : 'btn-secondary text-xs'
                  }`}
                  title="创建技能包"
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>{skillPackSelectionMode ? '取消' : '技能包'}</span>
                </button>
              )}
              {/* Summarize 按钮 */}
              {currentSessionId && messages.filter(m => m.role !== 'system').length > 0 && (
                <button
                  onClick={handleManualSummarize}
                  disabled={isSummarizing}
                  className="btn-primary flex items-center space-x-1 px-2.5 py-1 text-xs disabled:opacity-50"
                  title="总结当前会话内容"
                >
                  {isSummarizing ? (
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>总结</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 消息列表 - 正常顺序显示（老消息在上，新消息在下） - 优化布局 */}
          <div 
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-4 relative bg-gray-50/50 dark:bg-gray-950/50"
            style={{ scrollBehavior: 'auto' }}
            onScroll={(e) => {
              const container = e.currentTarget;
              const scrollTop = container.scrollTop;
              
              // 检测用户是否在滚动（排除程序控制的滚动）
              if (!isLoadingMoreRef.current) {
                isUserScrollingRef.current = true;
                // 500ms 后重置，认为用户停止滚动
                setTimeout(() => {
                  isUserScrollingRef.current = false;
                }, 500);
              }
              
              // 滚动到顶部附近时，自动加载更多历史消息（历史消息在上方）
              if (scrollTop < 150 && hasMoreMessages && !isLoadingMessages && !isLoadingMoreRef.current) {
                loadSessionMessages(currentSessionId!, messagePage + 1);
              }
              
              // 用户滚动到底部时，隐藏新消息提示（最新消息在底部）
              if (shouldAutoScroll()) {
                setShowNewMessagePrompt(false);
                setUnreadMessageCount(0);
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingComponent) {
                handleDropComponent(draggingComponent);
                setDraggingComponent(null);
              }
            }}
          >
          {/* 加载更多历史消息提示（固定在顶部，历史消息在上方） */}
          {hasMoreMessages && (
            <div className="sticky top-0 z-10 flex justify-center mb-2 pointer-events-none">
              <div className="bg-white/95 dark:bg-[#2d2d2d]/95 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border border-gray-200 dark:border-[#404040] pointer-events-auto">
                {isLoadingMessages ? (
                  <div className="flex items-center space-x-2 text-xs text-gray-600 dark:text-[#b0b0b0]">
                    <Loader className="w-3 h-3 animate-spin" />
                    <span>加载历史消息...</span>
                  </div>
                ) : (
                  <button
                    onClick={() => loadSessionMessages(currentSessionId!, messagePage + 1)}
                    className="flex items-center space-x-2 text-xs text-gray-600 dark:text-[#b0b0b0] hover:text-gray-900 dark:hover:text-[#cccccc] transition-colors"
                  >
                    <ChevronUp className="w-3 h-3" />
                    <span>加载更多</span>
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* 新消息提示（固定在底部，最新消息在底部） */}
          {showNewMessagePrompt && unreadMessageCount > 0 && (
            <div className="sticky bottom-4 z-10 flex justify-center pointer-events-none">
              <button
                onClick={() => {
                  if (chatContainerRef.current) {
                    const container = chatContainerRef.current;
                    // 直接跳到底部（最新消息位置），不使用动画
                    container.style.scrollBehavior = 'auto';
                    container.scrollTop = container.scrollHeight;
                  } else if (messagesEndRef.current) {
                    messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
                  }
                  setShowNewMessagePrompt(false);
                  setUnreadMessageCount(0);
                }}
                className="bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center space-x-2 text-sm font-medium transition-all pointer-events-auto hover:scale-105"
              >
                <ChevronDown className="w-4 h-4" />
                <span>
                  {unreadMessageCount === 1 ? '1 条新消息' : `${unreadMessageCount} 条新消息`}
                </span>
              </button>
            </div>
          )}
          {messages.filter(msg => {
            // 过滤掉总结消息和系统提示词消息（系统提示词消息已在输入框上方显示）
            if (msg.isSummary) return false;
            if (msg.role === 'system' && 
                msg.toolCalls && 
                typeof msg.toolCalls === 'object' &&
                (msg.toolCalls as any).isSystemPrompt === true) {
              return false; // 不显示系统提示词消息
            }
            return true;
          }).map((message) => {
            // 如果是总结提示消息，使用特殊的居中显示样式
            const isSummaryNotification = message.role === 'system' && 
              (message.content.includes('总结完成') || message.content.includes('已精简为'));
            
            if (isSummaryNotification) {
              return (
                <div key={message.id} data-message-id={message.id} className="flex justify-center my-2">
                  <div className="text-xs text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5 bg-gray-100 dark:bg-[#2d2d2d] rounded-full">
                    {message.content}
                  </div>
                </div>
              );
            }
            
            const isSelected = selectedMessageIds.has(message.id);
            
            return (
            <div
              key={message.id}
              data-message-id={message.id}
              onClick={() => toggleMessageSelection(message.id)}
              className={`flex items-start space-x-2 fade-in-up stagger-item ${
                message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
              } ${
                skillPackSelectionMode 
                  ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-[#404040] rounded-lg p-2 -m-2 transition-all duration-200' 
                  : ''
              } ${
                isSelected && skillPackSelectionMode
                  ? 'bg-primary-50 dark:bg-primary-900/20 ring-2 ring-primary-300 dark:ring-primary-700 rounded-lg p-2 -m-2' 
                  : ''
              }`}
            >
              {/* 选择复选框（仅在选择模式下显示） */}
              {skillPackSelectionMode && (
                <div className={`flex-shrink-0 mt-0.5 ${message.role === 'user' ? 'ml-1.5' : 'mr-1.5'}`}>
                  {isSelected ? (
                    <CheckSquare className="w-4 h-4 text-primary-500" />
                  ) : (
                    <Square className="w-4 h-4 text-gray-400" />
                  )}
                </div>
              )}
              <div className="flex-shrink-0 flex items-center space-x-1.5">
              <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shadow-sm overflow-hidden ${
                  message.role === 'user'
                    ? 'bg-primary-500 text-white'
                    : message.role === 'assistant'
                    ? 'bg-primary-500 text-white'
                    : message.role === 'tool'
                      ? message.toolType === 'workflow'
                        ? 'bg-primary-500 text-white'
                        : message.toolType === 'mcp'
                    ? 'bg-green-500 text-white'
                        : 'bg-gray-500 text-white'
                    : 'bg-gray-400 text-white'
                }`}
              >
                {message.role === 'user' ? (
                    <User className="w-4 h-4" />
                ) : message.role === 'assistant' ? (
                    // 如果有头像，显示头像；否则显示Bot图标
                    currentSessionAvatar ? (
                      <img 
                        src={currentSessionAvatar} 
                        alt="Avatar" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )
                ) : message.role === 'tool' ? (
                    message.toolType === 'workflow' ? (
                      <WorkflowIcon className="w-4 h-4" />
                    ) : message.toolType === 'mcp' ? (
                      <Plug className="w-4 h-4" />
                    ) : (
                      <Wrench className="w-4 h-4" />
                    )
                  ) : (
                    <Bot className="w-4 h-4" />
                  )}
                </div>
                {/* 思考/回答状态指示器 */}
                {message.role === 'assistant' && (
                  <div className="flex items-center space-x-1.5">
                    {message.isThinking && (!message.content || message.content.length === 0) ? (
                      // 思考中动画（只有思考，还没有内容）- 增强版
                      <div className="flex items-center space-x-2">
                        {/* 大脑思考动画 */}
                        <div className="relative">
                          <Brain className="w-4 h-4 text-primary-500 animate-pulse" />
                          <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary-400 rounded-full animate-ping opacity-75"></div>
                        </div>
                        <div className="flex items-center space-x-1">
                          <span className="text-xs text-primary-600 dark:text-primary-400 font-medium">
                            {selectedLLMConfig?.provider === 'gemini' ? '深度思考中' : '思考中'}
                          </span>
                          {/* 思考进度动画 */}
                          <div className="flex space-x-0.5 ml-1">
                            <div className="w-1 h-1 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></div>
                            <div className="w-1 h-1 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}></div>
                            <div className="w-1 h-1 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}></div>
                          </div>
                        </div>
                      </div>
                    ) : message.isStreaming && (!message.content || message.content.length === 0) ? (
                      // 等待响应动画（流式模式但还没有内容）
                      <div className="flex items-center space-x-2">
                        <div className="relative">
                          <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                        </div>
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                          {selectedLLMConfig?.provider === 'gemini' ? '生成中，请稍候...' : '处理中...'}
                        </span>
                        <div className="flex space-x-0.5">
                          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '200ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '400ms' }}></div>
                        </div>
                      </div>
                    ) : message.isStreaming ? (
                      // 回答中动画（正在流式输出内容）
                      <div className="flex items-center space-x-1.5">
                        <div className="flex space-x-0.5">
                          <div className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-[#b0b0b0] font-medium">回答中</span>
                      </div>
                    ) : null}
                    {/* 当前执行步骤（灰色小字） */}
                    {message.currentStep && message.currentStep.trim() && (
                      <span className="text-xs text-gray-400 dark:text-[#808080] font-normal ml-2">
                        {message.currentStep}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex-1 group relative">
                <div
                  className={`rounded-lg p-2.5 transition-all duration-300 ${
                    message.role === 'user'
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-gray-900 dark:text-[#ffffff] shadow-sm hover:shadow-md'
                      : message.role === 'assistant'
                      ? 'bg-white dark:bg-[#2d2d2d] text-gray-900 dark:text-[#ffffff] border border-gray-200 dark:border-[#404040] shadow-lg hover:shadow-xl' // 更立体的阴影
                      : message.role === 'tool'
                      ? message.toolType === 'workflow'
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-gray-900 dark:text-[#ffffff] border border-primary-200 dark:border-primary-700 shadow-sm hover:shadow-md'
                        : message.toolType === 'mcp'
                        ? 'bg-green-50 dark:bg-green-900/20 text-gray-900 dark:text-[#ffffff] border border-green-200 dark:border-green-700 shadow-sm hover:shadow-md'
                        : 'bg-gray-50 dark:bg-[#2d2d2d] text-gray-900 dark:text-[#ffffff] shadow-sm hover:shadow-md'
                      : 'bg-yellow-50 dark:bg-yellow-900/20 text-gray-700 dark:text-[#ffffff] shadow-sm hover:shadow-md'
                  }`}
                  style={{
                    fontSize: message.role === 'assistant' ? '13px' : '12px', // 减小字体
                    lineHeight: message.role === 'assistant' ? '1.6' : '1.5', // 减小行高
                  }}
                >
                  {renderMessageContent(message)}
                </div>
                {/* 用户消息的编辑、重新发送和引用按钮 */}
                {message.role === 'user' && !isLoading && (
                  <div className="absolute top-2 right-2 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setQuotedMessageId(message.id)}
                      className="p-1.5 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-all"
                      title="引用此消息"
                    >
                      <Quote className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleStartEdit(message.id)}
                      className="p-1.5 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-all"
                      title="编辑消息"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleResendMessage(message.id)}
                      className="p-1.5 text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-all"
                      title="重新发送"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                
                {/* Assistant错误消息的重试按钮 */}
                {message.role === 'assistant' && 
                 message.content?.includes('❌ 错误') && 
                 message.toolCalls && 
                 typeof message.toolCalls === 'object' &&
                 (message.toolCalls as any).canRetry === true && (
                  <div className="absolute top-2 right-2 flex items-center space-x-1">
                    <button
                      onClick={() => handleRetryMessage(message.id)}
                      disabled={isLoading}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg transition-all flex items-center space-x-1.5 shadow-sm"
                      title="重试发送"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>重试</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
            );
          })}
          <div ref={messagesEndRef} />
          
          {/* 技能包选择确认栏 */}
          {skillPackSelectionMode && (
            <div className="sticky bottom-0 bg-white dark:bg-[#2d2d2d] border-t border-gray-200 dark:border-[#404040] p-3 flex items-center justify-between shadow-lg">
              <div className="flex items-center space-x-2">
                <Package className="w-5 h-5 text-primary-500" />
                <span className="text-sm text-gray-700 dark:text-[#ffffff]">
                  已选择 {selectedMessageIds.size} 条消息
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    setSkillPackSelectionMode(false);
                    setSelectedMessageIds(new Set());
                  }}
                  className="px-4 py-2 text-sm text-gray-600 dark:text-[#b0b0b0] hover:text-gray-900 dark:hover:text-[#cccccc]"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateSkillPack}
                  disabled={selectedMessageIds.size === 0 || isCreatingSkillPack || !selectedLLMConfigId}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center space-x-2"
                >
                  {isCreatingSkillPack ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" />
                      <span>创建中...</span>
                    </>
                  ) : (
                    <>
                      <Package className="w-4 h-4" />
                      <span>创建技能包</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 输入框 - 优化布局 */}
          <div 
            className={`border-t border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] px-4 py-3 flex-shrink-0 relative transition-colors ${
              isDraggingOver ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700' : ''
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={(e) => {
              // 点击输入框区域外部时关闭选择器（但不包括选择器本身）
              const target = e.target as HTMLElement;
              if ((showAtSelector || showModuleSelector) && !target.closest('.at-selector-container') && !target.closest('textarea')) {
                setShowAtSelector(false);
              }
            }}
          >
            {/* 拖拽提示 */}
            {isDraggingOver && (
              <div className="absolute inset-0 flex items-center justify-center bg-primary-100/50 dark:bg-primary-900/30 rounded-lg z-10 pointer-events-none">
                <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 font-medium">
                  <Image className="w-5 h-5" />
                  <span>松开以添加图片</span>
                </div>
              </div>
            )}
          {/* 已选定的组件 tag */}
          {selectedComponents.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedComponents.map((component, index) => (
                <div
                  key={`${component.type}-${component.id}-${index}`}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-[#ffffff] rounded-md text-sm border border-gray-200 dark:border-[#404040]"
                >
                  {component.type === 'workflow' ? (
                    <WorkflowIcon className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                  ) : component.type === 'skillpack' ? (
                    <Package className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  ) : (
                    <Plug className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
                  )}
                  <span className="font-medium">{component.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveComponent(index);
                    }}
                    className="ml-1 text-gray-400 dark:text-[#808080] hover:text-gray-600 dark:hover:text-[#cccccc] transition-colors flex-shrink-0"
                    title="删除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* 显示待处理的批次数据项（选择操作） */}
          {pendingBatchItem && (
            <div className="mb-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <Database className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                      📋 已选择: {pendingBatchItem.batchName}
                    </span>
                  </div>
                  {pendingBatchItem.item.title && (
                    <div className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">
                      {pendingBatchItem.item.title}
                    </div>
                  )}
                  {pendingBatchItem.item.content && (
                    <div className="text-xs text-gray-600 dark:text-[#b0b0b0] line-clamp-2 mt-1">
                      {pendingBatchItem.item.content.length > 150 
                        ? pendingBatchItem.item.content.substring(0, 150) + '...' 
                        : pendingBatchItem.item.content}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setPendingBatchItem(null)}
                  className="ml-2 p-1 text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 transition-colors flex-shrink-0"
                  title="取消"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSetAsSystemPrompt}
                  className="flex-1 px-3 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center space-x-2"
                >
                  <Brain className="w-4 h-4" />
                  <span>🤖 设置为系统提示词</span>
                </button>
                <button
                  onClick={handleInsertAsMessage}
                  className="flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center space-x-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>💬 作为对话内容</span>
                </button>
              </div>
            </div>
          )}
          
          {/* 显示选定的批次数据项（系统提示词） */}
          {selectedBatchItem && (
            <div className="mb-2 p-3 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <Database className="w-4 h-4 text-primary-600 dark:text-primary-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-primary-900 dark:text-primary-100">
                      🤖 机器人人设: {selectedBatchItem.batchName}
                    </span>
                  </div>
                  {selectedBatchItem.item.title && (
                    <div className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">
                      {selectedBatchItem.item.title}
                    </div>
                  )}
                  {selectedBatchItem.item.content && (
                    <div className="text-xs text-gray-600 dark:text-[#b0b0b0] line-clamp-2 mt-1">
                      {selectedBatchItem.item.content.length > 150 
                        ? selectedBatchItem.item.content.substring(0, 150) + '...' 
                        : selectedBatchItem.item.content}
                    </div>
                  )}
                </div>
                <button
                  onClick={async () => {
                    // 清除选定的批次数据项
                    setSelectedBatchItem(null);
                    
                    // 如果有会话，删除系统提示词消息
                    if (currentSessionId) {
                      const systemPromptMessage = messages.find(m => 
                        m.role === 'system' && 
                        m.toolCalls && 
                        typeof m.toolCalls === 'object' &&
                        (m.toolCalls as any).isSystemPrompt === true
                      );
                      
                      if (systemPromptMessage) {
                        try {
                          await deleteMessage(currentSessionId, systemPromptMessage.id);
                          setMessages(prev => prev.filter(m => m.id !== systemPromptMessage.id));
                          console.log('[Workflow] Deleted system prompt message');
                        } catch (error) {
                          console.error('[Workflow] Failed to delete system prompt message:', error);
                        }
                      }
                    }
                  }}
                  className="ml-2 p-1 text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 transition-colors flex-shrink-0"
                  title="取消选择"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 text-xs text-primary-600 dark:text-primary-400">
                💡 此数据已保存为系统提示词，将作为机器人人设持续生效
              </div>
            </div>
          )}
          

          {/* 引用消息显示 */}
          {quotedMessageId && (() => {
            const quotedMsg = messages.find(m => m.id === quotedMessageId);
            if (!quotedMsg) return null;
            return (
              <div className="mb-2 p-2 bg-gray-50 dark:bg-[#2d2d2d] border-l-4 border-primary-500 rounded-r-lg">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-500 dark:text-[#b0b0b0] mb-1">引用消息</div>
                    <div className="text-sm text-gray-700 dark:text-[#ffffff] line-clamp-2">
                      {quotedMsg.content.substring(0, 100)}{quotedMsg.content.length > 100 ? '...' : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => setQuotedMessageId(null)}
                    className="ml-2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })()}

          <div className="flex space-x-2">
            {/* 附件预览区域 */}
            {attachedMedia.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachedMedia.map((media, index) => (
                  <div key={index} className="relative group">
                    {media.type === 'image' ? (
                      <img
                        src={media.preview || `data:${media.mimeType};base64,${media.data}`}
                        alt={`附件 ${index + 1}`}
                        className="w-20 h-20 object-cover rounded border border-gray-300 dark:border-[#404040]"
                      />
                    ) : (
                      <video
                        src={media.preview || `data:${media.mimeType};base64,${media.data}`}
                        className="w-20 h-20 object-cover rounded border border-gray-300 dark:border-[#404040]"
                        controls={false}
                      />
                    )}
                    <button
                      onClick={() => {
                        setAttachedMedia(prev => prev.filter((_, i) => i !== index));
                      }}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除附件"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex-1 relative at-selector-container">
              {/* 输入框扩大按钮 - 当输入框聚焦时显示 */}
              {isInputFocused && (
                <button
                  onMouseDown={(e) => {
                    // Prevent textarea blur so click still toggles expand.
                    e.preventDefault();
                  }}
                  onClick={() => setIsInputExpanded(!isInputExpanded)}
                  className="absolute -top-8 left-1/2 transform -translate-x-1/2 z-10 p-1.5 bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] rounded-lg shadow-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-all"
                  title={isInputExpanded ? "缩小输入框" : "扩大输入框"}
                >
                  <ChevronUp className={`w-4 h-4 text-gray-600 dark:text-[#b0b0b0] transition-transform ${isInputExpanded ? 'rotate-180' : ''}`} />
                </button>
              )}
              
            <textarea
                ref={inputRef}
              value={input}
                onChange={handleInputChange}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              
              onFocus={(e) => {
                setIsInputFocused(true);
                // 保留原有的focus处理逻辑
                if (inputRef.current) {
                  const value = inputRef.current.value;
                  const cursorPosition = inputRef.current.selectionStart || 0;
                  const textBeforeCursor = value.substring(0, cursorPosition);
                  const lastAtIndex = textBeforeCursor.lastIndexOf('@');
                  
                  if (lastAtIndex !== -1) {
                    const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
                    const hasSpaceOrNewline = textAfterAt.includes(' ') || textAfterAt.includes('\n');
                    
                    if (!hasSpaceOrNewline && selectedComponents.length === 0) {
                      // 触发位置重新计算
                      handleInputChange({ target: inputRef.current } as React.ChangeEvent<HTMLTextAreaElement>);
                    }
                  }
                }
              }}
              onPaste={(e) => {
                // 检查粘贴板中是否有图片
                const items = e.clipboardData?.items;
                if (!items) return;
                
                const imageItems: DataTransferItem[] = [];
                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  if (item.type.startsWith('image/')) {
                    imageItems.push(item);
                  }
                }
                
                // 如果有图片，处理图片粘贴
                if (imageItems.length > 0) {
                  e.preventDefault(); // 阻止默认的文本粘贴行为
                  
                  imageItems.forEach(item => {
                    const file = item.getAsFile();
                    if (!file) return;
                    
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const result = event.target?.result as string;
                      // 移除 data URL 前缀，只保留 base64 数据
                      const base64Data = result.includes(',') ? result.split(',')[1] : result;
                      const mimeType = file.type || 'image/png';
                      
                      setAttachedMedia(prev => [...prev, {
                        type: 'image',
                        mimeType,
                        data: base64Data,
                        preview: result, // 用于预览
                      }]);
                      
                      console.log('[Workflow] 已粘贴图片:', mimeType, '大小:', Math.round(base64Data.length / 1024), 'KB');
                    };
                    reader.readAsDataURL(file);
                  });
                }
              }}
                onKeyDown={(e) => {
                  // Send/newline handling (runs before selector navigation).
                  handleKeyPress(e);
                  if (e.defaultPrevented) return;
                  // 如果批次数据项选择器显示，不处理键盘事件（由 CrawlerBatchItemSelector 处理）
                  if (showBatchItemSelector) {
                    return;
                  }
                  
                  // 如果模块选择器显示，不处理键盘事件（由 CrawlerModuleSelector 处理）
                  if (showModuleSelector) {
                    return;
                  }
                  
                  // 如果@选择器显示，处理上下箭头和回车
                  if (showAtSelector) {
                    const selectableComponentsList = getSelectableComponents();
                    
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedComponentIndex(prev => 
                        prev < selectableComponentsList.length - 1 ? prev + 1 : prev
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedComponentIndex(prev => prev > 0 ? prev - 1 : 0);
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (selectableComponentsList[selectedComponentIndex]) {
                        handleSelectComponent(selectableComponentsList[selectedComponentIndex]);
                      }
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      console.log('[Workflow] Closing selector via Escape');
                      setShowAtSelector(false);
                    }
                  }
                }}
                onBlur={(e) => {
                  setIsInputFocused(false);
                  // 如果批次数据项选择器显示，不处理blur（由组件自己处理）
                  if (showBatchItemSelector) {
                    return;
                  }
                  
                  // 如果模块选择器显示，不处理blur（由组件自己处理）
                  if (showModuleSelector) {
                    return;
                  }
                  
                  // 如果选择器未显示，不需要处理
                  if (!showAtSelector) {
                    return;
                  }
                  
                  // 清除之前的定时器
                  if (blurTimeoutRef.current) {
                    clearTimeout(blurTimeoutRef.current);
                    blurTimeoutRef.current = null;
                  }
                  
                  // 延迟关闭，以便点击选择器时不会立即关闭
                  blurTimeoutRef.current = setTimeout(() => {
                    // 检查当前焦点是否在选择器或其子元素上
                    const activeElement = document.activeElement;
                    const isFocusInSelector = activeElement?.closest('.at-selector-container');
                    
                    // 检查选择器元素是否仍然存在且显示
                    const selectorElement = selectorRef.current;
                    const isSelectorVisible = selectorElement && 
                                             document.contains(selectorElement) && 
                                             showAtSelector;
                    
                    // 如果焦点不在选择器上，且选择器仍然显示，则关闭
                    if (isSelectorVisible && !isFocusInSelector) {
                      // 再次检查relatedTarget（可能为null）
                      const relatedTarget = e.relatedTarget as HTMLElement;
                      if (!relatedTarget || !relatedTarget.closest('.at-selector-container')) {
                        console.log('[Workflow] Closing selector via blur');
                        setShowAtSelector(false);
                      }
                    }
                    
                    blurTimeoutRef.current = null;
                  }, 300); // 增加延迟时间
                }}
              placeholder={
                editingMessageId
                  ? '编辑消息...'
                  : !selectedLLMConfig
                  ? '请先选择 LLM 模型...'
                  : selectedMcpServerIds.size > 0
                    ? `输入你的任务，我可以使用 ${totalTools} 个工具帮助你完成... (输入 @ 选择感知组件)`
                    : '输入你的问题，我会尽力帮助你... (输入 @ 选择感知组件，输入 / 引用爬虫数据)'
              }
                className={`flex-1 resize-none w-full transition-all duration-200 bg-transparent border-none focus:outline-none focus:ring-0 text-gray-900 dark:text-[#ffffff] placeholder-gray-400 dark:placeholder-[#808080] px-3 pt-3 ${
                  isInputExpanded 
                    ? 'min-h-[300px] max-h-[500px]' 
                    : 'min-h-[50px] max-h-[200px]'
                }`}
              style={{ fontSize: '15px', lineHeight: '1.6' }}
              rows={2}
              disabled={isLoading || !selectedLLMConfig}
            />
            {/* 编辑模式提示和取消按钮 */}
            {editingMessageId && (
              <div className="absolute top-2 right-2 flex items-center space-x-2">
                <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">编辑模式</span>
                <button
                  onClick={handleCancelEdit}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc] transition-colors"
                  title="取消编辑"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
              
          {/* /模块 选择器 */}
          {showModuleSelector && (
            <CrawlerModuleSelector
              query={moduleSelectorQuery}
              position={moduleSelectorPosition}
              onSelect={handleModuleSelect}
              onClose={() => {
                setShowModuleSelector(false);
                setModuleSelectorIndex(-1);
                setModuleSelectorQuery('');
              }}
            />
          )}
          
          {/* 批次数据项选择器 */}
          {showBatchItemSelector && selectedBatch && (
            <CrawlerBatchItemSelector
              batch={selectedBatch}
              position={batchItemSelectorPosition}
              onSelect={(item) => {
                const batchName = selectedBatch.batch_name;
                handleBatchItemSelect(item, batchName);
              }}
              onClose={() => {
                setShowBatchItemSelector(false);
                setSelectedBatch(null);
                // 重新显示模块选择器
                if (moduleSelectorIndex !== -1) {
                  setShowModuleSelector(true);
                }
              }}
            />
          )}
          
          {/* @ 符号选择器 */}
          {showAtSelector && (
            <div
              ref={selectorRef}
              className="fixed z-[100] bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#404040] rounded-lg shadow-lg overflow-y-auto at-selector-container"
                  style={{
                    top: `${atSelectorPosition.top}px`,
                    left: `${atSelectorPosition.left}px`,
                    minWidth: '200px',
                    maxWidth: '300px',
                    maxHeight: `${atSelectorPosition.maxHeight || 256}px`, // 使用动态计算的最大高度
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault(); // 防止触发 blur
                    e.stopPropagation(); // 阻止事件冒泡
                    // 清除blur定时器，防止选择器被关闭
                    if (blurTimeoutRef.current) {
                      clearTimeout(blurTimeoutRef.current);
                      blurTimeoutRef.current = null;
                    }
                  }}
                  onMouseUp={(e) => {
                    e.preventDefault(); // 防止触发 blur
                    e.stopPropagation(); // 阻止事件冒泡
                  }}
                >
                  <div className="p-2 border-b border-gray-200 dark:border-[#404040]">
                    <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff]">
                      选择感知组件
                    </div>
                  </div>
                  
                  {/* MCP 服务器列表 - 显示所有MCP，不仅仅是已连接的 */}
                  {mcpServers.filter(s => 
                    s.name.toLowerCase().includes(atSelectorQuery)
                  ).length > 0 && (
                    <div className="py-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5 flex items-center justify-between">
                        <span>MCP 服务器</span>
                        <span className="text-[10px]">
                          ({connectedMcpServerIds.size}/{mcpServers.length}已连接)
                        </span>
                      </div>
                      {mcpServers
                        .filter(s => s.name.toLowerCase().includes(atSelectorQuery))
                        .map((server) => {
                          const isConnected = connectedMcpServerIds.has(server.id);
                          const isConnecting = connectingServers.has(server.id);
                          const component = { type: 'mcp' as const, id: server.id, name: server.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={server.id}
                              onClick={async () => {
                                if (isConnecting) return;
                                if (!isConnected) {
                                  // 未连接则先连接
                                  await handleConnectServer(server.id);
                                  // 连接成功后自动选择
                                  const newComponent = { type: 'mcp' as const, id: server.id, name: server.name };
                                  handleSelectComponent(newComponent);
                                } else {
                                  handleSelectComponent(component);
                                }
                              }}
                              className={`px-3 py-2 cursor-pointer flex items-center space-x-2 ${
                                isConnecting
                                  ? 'opacity-70 cursor-wait'
                                  : isSelected 
                                    ? 'bg-primary-100 dark:bg-primary-900/30' 
                                    : !isConnected
                                      ? 'hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className="relative">
                                {isConnecting ? (
                                  <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                                ) : (
                                  <>
                                    <Plug className={`w-4 h-4 flex-shrink-0 ${isConnected ? 'text-primary-500' : 'text-gray-400'}`} />
                                    {isConnected && (
                                      <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                    )}
                                  </>
                                )}
                              </div>
                              <span className={`text-sm ${isConnected ? 'text-gray-900 dark:text-[#ffffff]' : 'text-gray-600 dark:text-gray-400'}`}>
                                {server.display_name || server.client_name || server.name}
                              </span>
                              {isConnecting && (
                                <span className="text-[10px] text-primary-500 ml-auto">连接中...</span>
                              )}
                              {!isConnected && !isConnecting && (
                                <span className="text-[10px] text-yellow-600 dark:text-yellow-400 ml-auto">点击连接</span>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                  
                  {/* 工作流列表 */}
                  {workflows.filter(w => 
                    w.name.toLowerCase().includes(atSelectorQuery)
                  ).length > 0 && (
                    <div className="py-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5">
                        工作流
                      </div>
                      {workflows
                        .filter(w => w.name.toLowerCase().includes(atSelectorQuery))
                        .map((workflow) => {
                          const component = { type: 'workflow' as const, id: workflow.workflow_id, name: workflow.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={workflow.workflow_id}
                              onClick={() => handleSelectComponent(component)}
                              className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                                isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : ''
                              }`}
                            >
                              <WorkflowIcon className="w-4 h-4 text-primary-500 flex-shrink-0" />
                              <span className="text-sm text-gray-900 dark:text-[#ffffff]">{workflow.name}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  
                  {/* 技能包列表 */}
                  {allSkillPacks.filter(sp => 
                    sp.name.toLowerCase().includes(atSelectorQuery)
                  ).length > 0 && (
                    <div className="py-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5">
                        技能包
                      </div>
                      {allSkillPacks
                        .filter(sp => sp.name.toLowerCase().includes(atSelectorQuery))
                        .map((skillPack) => {
                          const component = { type: 'skillpack' as const, id: skillPack.skill_pack_id, name: skillPack.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow' | 'skillpack'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={skillPack.skill_pack_id}
                              onClick={() => handleSelectComponent(component)}
                              className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                                isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : ''
                              }`}
                            >
                              <Package className="w-4 h-4 text-amber-500 flex-shrink-0" />
                              <span className="text-sm text-gray-900 dark:text-[#ffffff]">{skillPack.name}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  
                  {/* 无匹配结果 */}
                  {mcpServers.filter(s => 
                    s.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 &&
                  workflows.filter(w => 
                    w.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 &&
                  allSkillPacks.filter(sp => 
                    sp.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-500 dark:text-[#b0b0b0] text-center">
                      未找到匹配的感知组件
                    </div>
                  )}
                </div>
              )}
              
              {/* 输入框底部工具栏和发送按钮 - 集成在输入框内 */}
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 dark:border-[#404040]/50">
                {/* 左侧：帮助图标 + MCP/Workflow缩略图标 + 人设 + Thinking 模式开关 */}
                <div className="flex items-center space-x-2">
                  {/* 帮助问号图标 */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowHelpTooltip(!showHelpTooltip)}
                      className="w-5 h-5 rounded-full bg-gray-400 hover:bg-gray-500 dark:bg-gray-600 dark:hover:bg-gray-500 text-white flex items-center justify-center transition-colors"
                      title="查看帮助"
                    >
                      <HelpCircle className="w-3 h-3" />
                    </button>
                    {/* 帮助提示弹窗 */}
                    {showHelpTooltip && (
                      <>
                        {/* 点击外部区域关闭 */}
                        <div 
                          className="fixed inset-0 z-10" 
                          onClick={() => setShowHelpTooltip(false)}
                        />
                        <div className="absolute bottom-full left-0 mb-2 w-80 p-3 bg-white dark:bg-[#2d2d2d] rounded-lg shadow-lg border border-gray-200 dark:border-[#404040] z-20">
                          <div className="text-xs text-gray-700 dark:text-[#ffffff] space-y-1">
                            {!selectedLLMConfig ? (
                              <p>请先选择 LLM 模型</p>
                            ) : selectedComponents.length > 0 ? (
                              <p>已选择感知组件：<span className="font-medium">{selectedComponents[0].name}</span>。如需更换，请先删除当前组件，然后使用 @ 选择新的组件。</p>
                            ) : selectedMcpServerIds.size > 0 ? (
                              <p>提示：我可以使用 {totalTools} 个 MCP 工具帮助你完成任务，例如<span className="font-medium">"发布内容"</span>、<span className="font-medium">"查询信息"</span>等。使用 @ 可以选择感知组件。</p>
                            ) : (
                              <p>提示：你可以直接与我对话，我会尽力帮助你。如果需要使用工具，请在 MCP 服务器中选择至少一个服务器，或使用 @ 选择感知组件。</p>
                            )}
                          </div>
                          <button
                            onClick={() => setShowHelpTooltip(false)}
                            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* MCP、Workflow、技能包、附件缩略图标 - Tag样式 */}
                  <ComponentThumbnails
                    mcpServers={mcpServers}
                    workflows={workflows}
                    skillPacks={allSkillPacks}
                    selectedMcpServerIds={selectedMcpServerIds}
                    selectedWorkflowIds={selectedWorkflowIds}
                    selectedSkillPackIds={selectedSkillPackIds}
                    connectedMcpServerIds={connectedMcpServerIds}
                    connectingMcpServerIds={connectingServers}
                    onSelectMCP={handleSelectMCPFromThumbnail}
                    onDeselectMCP={handleDeselectMCPFromThumbnail}
                    onConnectMCP={handleConnectServer}
                    onSelectWorkflow={handleSelectWorkflowFromThumbnail}
                    onDeselectWorkflow={handleDeselectWorkflowFromThumbnail}
                    onSelectSkillPack={handleSelectSkillPackFromThumbnail}
                    onDeselectSkillPack={handleDeselectSkillPackFromThumbnail}
                    onAttachFile={handleAttachFile}
                  />
                  
                  {/* 人设按钮 */}
                  {currentSessionId && (
                    <button
                      onClick={() => {
                        setSystemPromptDraft(currentSystemPrompt || '');
                        setIsEditingSystemPrompt(true);
                      }}
                      className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] transition-all ${
                        currentSystemPrompt 
                          ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' 
                          : 'text-gray-400 dark:text-[#808080] hover:text-gray-500 dark:hover:text-gray-400'
                      }`}
                      title={currentSystemPrompt ? `人设: ${currentSystemPrompt.length > 50 ? currentSystemPrompt.slice(0, 50) + '...' : currentSystemPrompt}` : '点击设置人设'}
                    >
                      <FileText className="w-3 h-3 flex-shrink-0" />
                      <span>人设</span>
                    </button>
                  )}
                  
                  {/* Thinking 模式显示（仅显示，不允许切换） */}
                  {selectedLLMConfig && (() => {
                    // 从模型配置中读取 thinking 模式
                    const enableThinking = selectedLLMConfig.metadata?.enableThinking ?? false;
                    
                    // 只显示状态，不允许切换（所有模型都显示）
                    return (
                      <div
                        className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] transition-all ${
                          enableThinking 
                            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium' 
                            : 'text-gray-400 dark:text-[#808080]'
                        }`}
                        title={enableThinking ? '深度思考模式（在模型配置中启用）' : '普通模式（在模型配置中禁用）'}
                      >
                        <Brain className="w-3 h-3" />
                        <span>{enableThinking ? '深度思考' : '普通'}</span>
                        {enableThinking && (
                          <span className="w-1 h-1 bg-primary-500 rounded-full animate-pulse"></span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                
                {/* 右侧：Token 计数 + 发送按钮 */}
                <div className="flex items-center space-x-3">
                  {selectedLLMConfig && messages.filter(m => m.role !== 'system' && !m.isSummary).length > 0 ? (() => {
                    const model = selectedLLMConfig.model || 'gpt-4';
                    let lastSummaryIndex = -1;
                    for (let i = messages.length - 1; i >= 0; i--) {
                      if (messages[i].isSummary) { lastSummaryIndex = i; break; }
                    }
                    const messagesToCount = lastSummaryIndex >= 0 ? messages.slice(lastSummaryIndex) : messages;
                    const conversationMessages = messagesToCount
                      .filter(m => !(m.role === 'system' && !m.isSummary))
                      .map(msg => msg.isSummary 
                        ? { role: 'user' as const, content: msg.content, thinking: undefined }
                        : { role: msg.role, content: msg.content, thinking: msg.thinking }
                      );
                    const currentTokens = estimate_messages_tokens(conversationMessages, model);
                    const maxTokens = selectedLLMConfig?.max_tokens || get_model_max_tokens(model);
                    return (
                      <span className="text-[11px] text-gray-400 dark:text-[#808080]">
                        {currentTokens.toLocaleString()} / {maxTokens.toLocaleString()} tokens
                      </span>
                    );
                  })() : null}
                  
                  {/* 发送按钮 */}
                  <Button
                    onClick={handleSend}
                    disabled={isLoading || (!input.trim() && attachedMedia.length === 0) || !selectedLLMConfig}
                    variant="primary"
                    size="default"
                    className="gap-1.5 px-3 py-1.5"
                  >
                    {isLoading ? (
                      <Loader className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    <span className="hidden sm:inline">
                      {editingMessageId ? '重新发送' : '发送'}
                    </span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
          
          {/* 人设编辑弹窗 */}
          {isEditingSystemPrompt && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setIsEditingSystemPrompt(false)}>
              <div 
                className="bg-white dark:bg-[#2d2d2d] rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-5 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-indigo-500" />
                    <span>设置人设</span>
                  </h3>
                  <button 
                    onClick={() => setIsEditingSystemPrompt(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-5">
                  <p className="text-sm text-gray-500 dark:text-[#b0b0b0] mb-3">
                    人设是 AI 的角色设定，会影响所有对话的回复风格和内容。
                  </p>
                  <textarea
                    value={systemPromptDraft}
                    onChange={(e) => setSystemPromptDraft(e.target.value)}
                    placeholder="例如：你是一个专业的产品经理，擅长分析用户需求和产品设计..."
                    className="w-full h-40 px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    autoFocus
                  />
                </div>
                <div className="px-5 py-4 bg-gray-50 dark:bg-[#363636] flex items-center justify-between">
                  <button
                    onClick={async () => {
                      if (currentSessionId) {
                        try {
                          await updateSessionSystemPrompt(currentSessionId, null);
                          setCurrentSystemPrompt(null);
                          setIsEditingSystemPrompt(false);
                          // 更新 sessions 列表中的数据
                          setSessions(prev => prev.map(s => 
                            s.session_id === currentSessionId ? { ...s, system_prompt: undefined } : s
                          ));
                        } catch (error) {
                          console.error('Failed to clear system prompt:', error);
                        }
                      }
                    }}
                    className="text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                  >
                    清除人设
                  </button>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => setIsEditingSystemPrompt(false)}
                      className="px-4 py-2 text-sm text-gray-600 dark:text-[#ffffff] hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                    >
                      取消
                    </button>
                    <button
                      onClick={async () => {
                        if (currentSessionId) {
                          try {
                            await updateSessionSystemPrompt(currentSessionId, systemPromptDraft || null);
                            setCurrentSystemPrompt(systemPromptDraft || null);
                            setIsEditingSystemPrompt(false);
                            // 更新 sessions 列表中的数据
                            setSessions(prev => prev.map(s => 
                              s.session_id === currentSessionId ? { ...s, system_prompt: systemPromptDraft || undefined } : s
                            ));
                          } catch (error) {
                            console.error('Failed to update system prompt:', error);
                          }
                        }
                      }}
                      className="px-4 py-2 text-sm bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg"
                    >
                      保存
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* 会话类型选择对话框 */}
          {showSessionTypeDialog && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSessionTypeDialog(false)}>
              <div 
                className="bg-white dark:bg-[#2d2d2d] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-5 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">选择会话类型</h3>
                  <button 
                    onClick={() => setShowSessionTypeDialog(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  {/* 临时会话选项 */}
                  <button
                    onClick={handleSwitchToTemporarySession}
                    className="w-full text-left p-4 border-2 border-gray-200 dark:border-[#404040] rounded-lg hover:border-amber-400 dark:hover:border-amber-600 transition-colors"
                  >
                    <div className="flex items-start space-x-3">
                      <MessageCircle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-1">临时会话</h4>
                        <p className="text-sm text-gray-600 dark:text-[#b0b0b0]">
                          不保存历史记录，不发送历史消息，不进行总结。适合快速询问各种无关联的问题。
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* 记忆体选项 */}
                  <button
                    onClick={handleCreateMemorySession}
                    className="w-full text-left p-4 border-2 border-gray-200 dark:border-[#404040] rounded-lg hover:border-primary-400 dark:hover:border-primary-600 transition-colors"
                  >
                    <div className="flex items-start space-x-3">
                      <Database className="w-6 h-6 text-primary-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 dark:text-white mb-1">记忆体</h4>
                        <p className="text-sm text-gray-600 dark:text-[#b0b0b0]">
                          保存所有消息记录，支持历史消息和总结功能。可以升级为智能体。
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 升级为智能体对话框 */}
          {showUpgradeToAgentDialog && (() => {
            const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
              const file = e.target.files?.[0];
              if (!file) return;

              if (!file.type.startsWith('image/')) {
                alert('请选择图片文件');
                return;
              }

              if (file.size > 2 * 1024 * 1024) {
                alert('图片大小不能超过 2MB');
                return;
              }

              const reader = new FileReader();
              reader.onload = (event) => {
                const base64String = event.target?.result as string;
                setAgentAvatar(base64String);
              };
              reader.readAsDataURL(file);
            };

            const handleUpgrade = async () => {
              if (!agentName.trim()) {
                alert('请输入智能体名称');
                return;
              }
              if (!agentAvatar) {
                alert('请上传智能体头像');
                return;
              }
              if (!agentSystemPrompt.trim()) {
                alert('请设置智能体人设');
                return;
              }
              if (!agentLLMConfigId) {
                alert('请选择关联的LLM模型');
                return;
              }

              if (!currentSessionId) {
                alert('会话ID不存在');
                return;
              }

              setIsUpgrading(true);
              try {
                await upgradeToAgent(
                  currentSessionId,
                  agentName.trim(),
                  agentAvatar,
                  agentSystemPrompt.trim(),
                  agentLLMConfigId
                );
                setCurrentSystemPrompt(agentSystemPrompt.trim());
                setCurrentSessionAvatar(agentAvatar);
                await loadSessions();
                setShowUpgradeToAgentDialog(false);
                alert('升级为智能体成功！');
              } catch (error) {
                console.error('[Workflow] Failed to upgrade to agent:', error);
                alert(`升级失败: ${error instanceof Error ? error.message : String(error)}`);
              } finally {
                setIsUpgrading(false);
              }
            };

            return (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowUpgradeToAgentDialog(false)}>
                <div 
                  className="bg-white dark:bg-[#2d2d2d] rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center space-x-2">
                      <Sparkles className="w-5 h-5 text-primary-500" />
                      <span>升级为智能体</span>
                    </h3>
                    <button 
                      onClick={() => setShowUpgradeToAgentDialog(false)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="p-5 space-y-4">
                    <p className="text-sm text-gray-600 dark:text-[#b0b0b0]">
                      智能体必须设置头像、名字和人设。升级后，该会话将拥有固定的身份和角色。
                    </p>

                    {/* 智能体名称 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-1">
                        智能体名称 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={agentName}
                        onChange={(e) => setAgentName(e.target.value)}
                        className="input-field"
                        placeholder="例如：AI助手、产品经理等"
                      />
          </div>

                    {/* 智能体头像 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-1">
                        智能体头像 <span className="text-red-500">*</span>
                      </label>
                      <div className="flex items-center space-x-3">
                        <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-gray-200 dark:border-[#404040] flex items-center justify-center bg-gray-100 dark:bg-[#363636]">
                          {agentAvatar ? (
                            <img src={agentAvatar} alt="Avatar" className="w-full h-full object-cover" />
                          ) : (
                            <Bot className="w-8 h-8 text-gray-400" />
                          )}
                        </div>
                        <button
                          onClick={() => agentAvatarFileInputRef.current?.click()}
                          className="btn-secondary text-sm"
                        >
                          选择头像
                        </button>
                        <input
                          ref={agentAvatarFileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleAvatarUpload}
                        />
                      </div>
                    </div>

                    {/* 智能体人设 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-1">
                        智能体人设 <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={agentSystemPrompt}
                        onChange={(e) => setAgentSystemPrompt(e.target.value)}
                        placeholder="例如：你是一个专业的产品经理，擅长分析用户需求和产品设计..."
                        className="input-field"
                        rows={4}
                      />
                    </div>

                    {/* 关联LLM模型 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-1">
                        关联LLM模型 <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={agentLLMConfigId || ''}
                        onChange={(e) => setAgentLLMConfigId(e.target.value || null)}
                        className="input-field"
                      >
                        <option value="">请选择模型</option>
                        {llmConfigs
                          .filter(config => config.enabled)
                          .map(config => (
                            <option key={config.config_id} value={config.config_id}>
                              {config.name} ({config.provider})
                            </option>
                          ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500 dark:text-[#b0b0b0]">
                        智能体将固定使用此模型，升级后不可更改
                      </p>
                    </div>
                  </div>
                  <div className="px-5 py-4 bg-gray-50 dark:bg-[#363636] flex items-center justify-between">
                    <button
                      onClick={() => setShowUpgradeToAgentDialog(false)}
                      className="text-sm text-gray-600 dark:text-[#b0b0b0] hover:text-gray-900 dark:hover:text-[#cccccc]"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleUpgrade}
                      disabled={isUpgrading || !agentName.trim() || !agentAvatar || !agentSystemPrompt.trim() || !agentLLMConfigId}
                      className="btn-primary text-sm disabled:opacity-50"
                    >
                      {isUpgrading ? '升级中...' : '确认升级'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 头像配置对话框 */}
          {showAvatarConfigDialog && currentSessionId && !isTemporarySession && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAvatarConfigDialog(false)}>
              <div className="bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    配置会话头像
                  </h3>
                  <button
                    onClick={() => setShowAvatarConfigDialog(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  {/* 头像预览和上传 */}
                  <div className="flex flex-col items-center space-y-4">
                    <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-gray-200 dark:border-[#404040] flex items-center justify-center bg-gray-100 dark:bg-[#363636]">
                      {avatarConfigDraft ? (
                        <img src={avatarConfigDraft} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <Bot className="w-12 h-12 text-gray-400" />
                      )}
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => avatarConfigFileInputRef.current?.click()}
                        className="btn-secondary text-sm"
                      >
                        选择图片
                      </button>
                      {avatarConfigDraft && (
                        <button
                          onClick={() => setAvatarConfigDraft(null)}
                          className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        >
                          清除头像
                        </button>
                      )}
                    </div>
                    <input
                      ref={avatarConfigFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (!file.type.startsWith('image/')) {
                          alert('请选择图片文件');
                          return;
                        }
                        if (file.size > 2 * 1024 * 1024) {
                          alert('图片大小不能超过 2MB');
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          setAvatarConfigDraft(event.target?.result as string);
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-[#b0b0b0] text-center">
                    支持 JPG、PNG 等格式，建议大小不超过 2MB
                  </p>
                </div>
                <div className="px-5 py-4 bg-gray-50 dark:bg-[#363636] flex items-center justify-end space-x-3">
                  <button
                    onClick={() => setShowAvatarConfigDialog(false)}
                    className="text-sm text-gray-600 dark:text-[#b0b0b0] hover:text-gray-900 dark:hover:text-[#cccccc]"
                  >
                    取消
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await updateSessionAvatar(currentSessionId, avatarConfigDraft || '');
                        setCurrentSessionAvatar(avatarConfigDraft);
                        // 更新会话列表中的头像
                        setSessions(prev => prev.map(s => 
                          s.session_id === currentSessionId 
                            ? { ...s, avatar: avatarConfigDraft || undefined }
                            : s
                        ));
                        setShowAvatarConfigDialog(false);
                      } catch (error) {
                        console.error('Failed to update avatar:', error);
                        alert('保存头像失败，请重试');
                      }
                    }}
                    className="btn-primary text-sm"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* 技能包制作过程对话框 */}
          {showSkillPackDialog && skillPackResult && skillPackProcessInfo && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Package className="w-6 h-6 text-primary-500" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      技能包制作完成
                    </h3>
                  </div>
                  <button
                    onClick={() => {
                      setShowSkillPackDialog(false);
                      setSkillPackResult(null);
                      setSkillPackProcessInfo(null);
                      setSkillPackConversationText('');
                      setOptimizationPrompt('');
                      setSelectedMCPForOptimization([]);
                    }}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="px-6 py-4 flex-1 overflow-y-auto">
                  {/* 制作过程信息 */}
                  <div className="mb-6">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-[#ffffff] mb-3">
                      制作过程
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-3">
                        <div className="text-xs text-gray-600 dark:text-[#b0b0b0] mb-1">消息数量</div>
                        <div className="text-lg font-semibold text-primary-600 dark:text-primary-400">
                          {skillPackProcessInfo.messages_count}
                        </div>
                      </div>
                      <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-3">
                        <div className="text-xs text-gray-600 dark:text-[#b0b0b0] mb-1">思考过程</div>
                        <div className="text-lg font-semibold text-primary-600 dark:text-primary-400">
                          {skillPackProcessInfo.thinking_count}
                        </div>
                      </div>
                      <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                        <div className="text-xs text-gray-600 dark:text-[#b0b0b0] mb-1">工具调用</div>
                        <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                          {skillPackProcessInfo.tool_calls_count}
                        </div>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                        <div className="text-xs text-gray-600 dark:text-[#b0b0b0] mb-1">媒体资源</div>
                        <div className="text-lg font-semibold text-amber-600 dark:text-amber-400">
                          {skillPackProcessInfo.media_count}
                        </div>
                        {skillPackProcessInfo.media_types.length > 0 && (
                          <div className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1">
                            {skillPackProcessInfo.media_types.join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-gray-500 dark:text-[#b0b0b0]">
                      对话记录长度: {skillPackProcessInfo.conversation_length.toLocaleString()} 字符 | 
                      提示词长度: {skillPackProcessInfo.prompt_length.toLocaleString()} 字符
                    </div>
                  </div>

                  {/* 技能包名称 */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                      技能包名称
                    </label>
                    <input
                      type="text"
                      value={skillPackResult.name}
                      onChange={(e) => setSkillPackResult({ ...skillPackResult, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  
                  {/* 技能包总结 */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                      技能包总结
                    </label>
                    <textarea
                      value={skillPackResult.summary}
                      onChange={(e) => setSkillPackResult({ ...skillPackResult, summary: e.target.value })}
                      rows={12}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                    />
                  </div>

                  {/* 优化总结区域 */}
                  <div className="mb-4 border-t border-gray-200 dark:border-[#404040] pt-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                      优化总结（可选）
                    </label>
                    
                    {/* MCP服务器选择 */}
                    <div className="mb-3">
                      <label className="block text-xs font-medium text-gray-600 dark:text-[#b0b0b0] mb-2">
                        连接感知模组（可选）- 用于验证工具名称和参数
                      </label>
                      <div className="space-y-2 max-h-32 overflow-y-auto border border-gray-200 dark:border-[#404040] rounded-lg p-2">
                        {mcpServers.filter(s => s.enabled).length === 0 ? (
                          <div className="text-xs text-gray-500 dark:text-[#b0b0b0] text-center py-2">
                            暂无启用的MCP服务器
                          </div>
                        ) : (
                          mcpServers
                            .filter(s => s.enabled)
                            .map(server => (
                              <label
                                key={server.server_id}
                                className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 p-2 rounded"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedMCPForOptimization.includes(server.server_id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedMCPForOptimization([...selectedMCPForOptimization, server.server_id]);
                                    } else {
                                      setSelectedMCPForOptimization(selectedMCPForOptimization.filter(id => id !== server.server_id));
                                    }
                                  }}
                                  className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
                                />
                                <Plug className="w-4 h-4 text-gray-400" />
                                <span className="text-sm text-gray-700 dark:text-[#ffffff]">{server.name}</span>
                              </label>
                            ))
                        )}
                      </div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-[#b0b0b0]">
                        选择MCP服务器后，优化时将连接这些服务器来验证工具名称和参数，生成更准确的技能包描述
                      </div>
                    </div>
                    
                    <textarea
                      value={optimizationPrompt}
                      onChange={(e) => setOptimizationPrompt(e.target.value)}
                      placeholder="例如：更详细地描述工具调用的参数，或者强调某个关键步骤..."
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    />
                    <button
                      onClick={handleOptimizeSkillPack}
                      disabled={isOptimizing || !selectedLLMConfigId}
                      className="mt-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center space-x-2"
                    >
                      {isOptimizing ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span>优化中...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>优化总结</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                
                <div className="px-6 py-4 border-t border-gray-200 dark:border-[#404040] flex items-center justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowSkillPackDialog(false);
                      setSkillPackResult(null);
                      setSkillPackProcessInfo(null);
                      setSkillPackConversationText('');
                      setOptimizationPrompt('');
                      setSelectedMCPForOptimization([]);
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-[#ffffff] bg-gray-100 dark:bg-[#363636] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveSkillPack}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm font-medium"
                  >
                    保存技能包
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* 技能包使用确认弹窗 */}
          {pendingSkillPackUse && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Package className="w-6 h-6 text-primary-500" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      确认使用技能包
                    </h3>
                  </div>
                  <button
                    onClick={() => setPendingSkillPackUse(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="px-6 py-4 flex-1 overflow-y-auto">
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-1">
                      技能包名称
                    </label>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {pendingSkillPackUse.skillPack.name}
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-1">
                      技能包内容
                    </label>
                    <div className="bg-gray-50 dark:bg-[#2d2d2d] rounded-lg p-4 text-sm text-gray-700 dark:text-[#ffffff] whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {pendingSkillPackUse.skillPack.summary}
                    </div>
                  </div>
                  
                  <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-700 rounded-lg p-3 text-sm text-primary-700 dark:text-primary-300">
                    <strong>提示：</strong>确认后，技能包内容将被注入到对话上下文中，AI将使用该技能包的能力来完成任务。
                  </div>
                </div>
                
                <div className="px-6 py-4 border-t border-gray-200 dark:border-[#404040] flex items-center justify-end space-x-2">
                  <button
                    onClick={() => setPendingSkillPackUse(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-[#ffffff] bg-gray-100 dark:bg-[#363636] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      // 技能包内容已经在系统提示词中，用户确认后只需关闭弹窗
                      // 如果需要重新发送请求，可以在这里实现
                      setPendingSkillPackUse(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors"
                  >
                    确认使用
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>

    {/* 头部配置对话框 - 使用 Portal 渲染到 body 下，确保在主界面中心显示 */}
    {showHeaderConfigDialog && createPortal(
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]" onClick={() => setShowHeaderConfigDialog(false)}>
        <div className="bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-5 py-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between flex-shrink-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-[#ffffff]">
              会话配置
            </h3>
            <button
              onClick={() => setShowHeaderConfigDialog(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-[#cccccc]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Tab 切换 */}
          <div className="px-5 py-2 border-b border-gray-200 dark:border-[#404040] flex space-x-4 flex-shrink-0">
            <button
              onClick={() => setHeaderConfigActiveTab('basic')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                headerConfigActiveTab === 'basic'
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-[#b0b0b0] hover:bg-gray-100 dark:hover:bg-[#363636]'
              }`}
            >
              基本信息
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* 头像和名称 */}
            <div className="flex items-start space-x-4">
              {/* 头像 */}
              <div className="flex flex-col items-center space-y-2">
                <div 
                  className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary-400 hover:ring-offset-2 transition-all overflow-hidden"
                  onClick={() => headerConfigFileInputRef.current?.click()}
                >
                  {headerConfigEditAvatar ? (
                    <img src={headerConfigEditAvatar} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <Bot className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                  )}
                </div>
                <input
                  ref={headerConfigFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (e) => {
                        setHeaderConfigEditAvatar(e.target?.result as string);
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                />
                <span className="text-xs text-gray-500 dark:text-[#b0b0b0]">点击更换</span>
              </div>
              
              {/* 名称 */}
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-1">
                  名称
                </label>
                <input
                  type="text"
                  value={headerConfigEditName}
                  onChange={(e) => setHeaderConfigEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-600"
                  placeholder="输入名称..."
                />
              </div>
            </div>
            
            {/* 默认模型选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                默认模型
              </label>
              <select
                value={headerConfigEditLlmConfigId || ''}
                onChange={(e) => setHeaderConfigEditLlmConfigId(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-600"
              >
                <option value="">使用当前选择的模型</option>
                {llmConfigs.filter(c => c.enabled).map(config => (
                  <option key={config.config_id} value={config.config_id}>
                    {config.name} ({config.model})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1">
                设置后，每次打开此会话时将自动切换到指定的模型
              </p>
            </div>
            
            {/* 人设配置 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                人设
              </label>
              <textarea
                value={headerConfigEditSystemPrompt}
                onChange={(e) => setHeaderConfigEditSystemPrompt(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-600 resize-none"
                rows={6}
                placeholder="输入系统提示词（人设），用于定义AI的角色和行为..."
              />
              <p className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1">
                人设定义了AI的角色、风格和行为特征
              </p>
            </div>
            
            {/* 多媒体保存路径 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#ffffff] mb-2">
                多媒体保存路径
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={headerConfigEditMediaOutputPath}
                  onChange={(e) => setHeaderConfigEditMediaOutputPath(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#363636] text-gray-900 dark:text-[#ffffff] focus:outline-none focus:ring-2 focus:ring-primary-500 dark:focus:ring-primary-600"
                  placeholder="输入保存路径..."
                />
                {window.electron && (
                  <button
                    onClick={async () => {
                      try {
                        const result = await window.electron.selectDirectory();
                        if (result) {
                          setHeaderConfigEditMediaOutputPath(result);
                        }
                      } catch (error) {
                        console.error('Failed to select directory:', error);
                      }
                    }}
                    className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-[#ffffff] bg-gray-100 dark:bg-[#363636] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] rounded-lg transition-colors border border-gray-300 dark:border-[#404040]"
                  >
                    浏览...
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-[#b0b0b0] mt-1">
                设置后，生成的图片、视频等多媒体内容将保存到此目录
              </p>
            </div>
          </div>
          
          {/* 底部按钮 */}
          <div className="px-5 py-4 bg-gray-50 dark:bg-[#1a1a1a] flex items-center justify-end space-x-3 flex-shrink-0">
            <button
              onClick={() => setShowHeaderConfigDialog(false)}
              className="text-sm text-gray-600 dark:text-[#b0b0b0] hover:text-gray-900 dark:hover:text-[#cccccc]"
            >
              取消
            </button>
            <button
              onClick={async () => {
                try {
                  const promises: Promise<void>[] = [];
                  const currentSession = sessions.find(s => s.session_id === currentSessionId);
                  if (!currentSession || !currentSessionId) return;
                  
                  // 更新名称
                  if (headerConfigEditName.trim() !== (currentSession.name || '')) {
                    promises.push(updateSessionName(currentSessionId, headerConfigEditName.trim()));
                  }
                  
                  // 更新头像
                  if (headerConfigEditAvatar !== currentSession.avatar) {
                    promises.push(updateSessionAvatar(currentSessionId, headerConfigEditAvatar));
                    setCurrentSessionAvatar(headerConfigEditAvatar);
                  }
                  
                  // 更新人设
                  if (headerConfigEditSystemPrompt !== (currentSession.system_prompt || '')) {
                    promises.push(updateSessionSystemPrompt(currentSessionId, headerConfigEditSystemPrompt.trim() || null));
                    setCurrentSystemPrompt(headerConfigEditSystemPrompt.trim() || null);
                  }
                  
                  // 更新多媒体保存路径
                  if (headerConfigEditMediaOutputPath !== (currentSession.media_output_path || '')) {
                    promises.push(updateSessionMediaOutputPath(currentSessionId, headerConfigEditMediaOutputPath.trim() || null));
                  }
                  
                  // 更新默认模型
                  if (headerConfigEditLlmConfigId !== (currentSession.llm_config_id || null)) {
                    promises.push(updateSessionLLMConfig(currentSessionId, headerConfigEditLlmConfigId));
                    // 如果设置了默认模型，自动切换当前模型
                    if (headerConfigEditLlmConfigId) {
                      setSelectedLLMConfigId(headerConfigEditLlmConfigId);
                    }
                  }
                  
                  await Promise.all(promises);
                  
                  // 刷新会话列表
                  const allSessions = await getSessions();
                  setSessions(allSessions);
                  
                  setShowHeaderConfigDialog(false);
                } catch (error) {
                  console.error('Failed to save config:', error);
                  alert('保存失败，请重试');
                }
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    <Dialog
      open={deleteSessionTarget !== null}
      onOpenChange={(open) => {
        if (!open) setDeleteSessionTarget(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除会话</DialogTitle>
          <DialogDescription>
            确定要删除「{deleteSessionTarget?.name}」吗？此操作不可恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button
            variant="secondary"
            onClick={() => setDeleteSessionTarget(null)}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!deleteSessionTarget) return;
              const id = deleteSessionTarget.id;
              setDeleteSessionTarget(null);
              await performDeleteSession(id);
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

export default Workflow;
