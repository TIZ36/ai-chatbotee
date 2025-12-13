/**
 * 统一的输入框工具标签组件
 * 用于会话、会议、研究三个界面的 MCP、工作流、文件引用功能
 * 
 * 设计原则：
 * - 小巧的 tag 样式按钮
 * - 点击展开详细列表
 * - 支持选择/取消选择
 * - 统一的视觉风格
 */

import React, { useState, useRef, useEffect } from 'react';
import { Plug, Workflow as WorkflowIcon, Package, Paperclip, X, FileText, Link as LinkIcon, Loader } from 'lucide-react';

// MCP 服务器类型
export interface MCPServerItem {
  id: string;
  name: string;
  display_name?: string;
  client_name?: string;
  description?: string;
}

// 工作流类型
export interface WorkflowItem {
  workflow_id: string;
  name: string;
  description?: string;
}

// 技能包类型
export interface SkillPackItem {
  skill_pack_id: string;
  name: string;
  summary?: string;
}

// Sources 类型（研究界面专用）
export interface SourceItem {
  source_id: string;
  title?: string;
  source_type: string;
  url?: string;
  mime_type?: string;
}

interface InputToolTagsProps {
  // MCP 相关
  mcpServers?: MCPServerItem[];
  selectedMcpServerIds?: Set<string>;
  connectedMcpServerIds?: Set<string>;
  connectingMcpServerIds?: Set<string>;
  onSelectMCP?: (serverId: string) => void;
  onDeselectMCP?: (serverId: string) => void;
  onConnectMCP?: (serverId: string) => Promise<void>;
  enableMCP?: boolean;
  onToggleMCP?: (enabled: boolean) => void;
  
  // 工作流相关
  workflows?: WorkflowItem[];
  selectedWorkflowIds?: Set<string>;
  onSelectWorkflow?: (workflowId: string) => void;
  onDeselectWorkflow?: (workflowId: string) => void;
  enableWorkflow?: boolean;
  onToggleWorkflow?: (enabled: boolean) => void;
  
  // 技能包相关
  skillPacks?: SkillPackItem[];
  selectedSkillPackIds?: Set<string>;
  onSelectSkillPack?: (skillPackId: string) => void;
  onDeselectSkillPack?: (skillPackId: string) => void;
  
  // Sources 相关（研究界面）
  sources?: SourceItem[];
  pinnedSourceIds?: string[];
  onPinSource?: (sourceId: string) => void;
  onUnpinSource?: (sourceId: string) => void;
  onInsertSourceToken?: (token: string) => void;
  
  // 文件附件
  onAttachFile?: (files: FileList) => void;
  attachedMediaCount?: number;
  
  // 显示控制
  showMCP?: boolean;
  showWorkflow?: boolean;
  showSkillPack?: boolean;
  showSources?: boolean;
  showAttachment?: boolean;
  
  // 模式：'select'（选择模式）或 'toggle'（开关模式）
  mcpMode?: 'select' | 'toggle';
  workflowMode?: 'select' | 'toggle';
  
  // 样式
  className?: string;
}

const InputToolTags: React.FC<InputToolTagsProps> = ({
  // MCP
  mcpServers = [],
  selectedMcpServerIds = new Set(),
  connectedMcpServerIds = new Set(),
  connectingMcpServerIds = new Set(),
  onSelectMCP,
  onDeselectMCP,
  onConnectMCP,
  enableMCP = true,
  onToggleMCP,
  
  // 工作流
  workflows = [],
  selectedWorkflowIds = new Set(),
  onSelectWorkflow,
  onDeselectWorkflow,
  enableWorkflow = true,
  onToggleWorkflow,
  
  // 技能包
  skillPacks = [],
  selectedSkillPackIds = new Set(),
  onSelectSkillPack,
  onDeselectSkillPack,
  
  // Sources
  sources = [],
  pinnedSourceIds = [],
  onPinSource,
  onUnpinSource,
  onInsertSourceToken,
  
  // 附件
  onAttachFile,
  attachedMediaCount = 0,
  
  // 显示控制
  showMCP = true,
  showWorkflow = true,
  showSkillPack = true,
  showSources = false,
  showAttachment = true,
  
  // 模式
  mcpMode = 'select',
  workflowMode = 'select',
  
  className = '',
}) => {
  const [showMCPList, setShowMCPList] = useState(false);
  const [showWorkflowList, setShowWorkflowList] = useState(false);
  const [showSkillPackList, setShowSkillPackList] = useState(false);
  const [showSourcesList, setShowSourcesList] = useState(false);
  
  const mcpRef = useRef<HTMLDivElement>(null);
  const workflowRef = useRef<HTMLDivElement>(null);
  const skillPackRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭列表
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mcpRef.current && !mcpRef.current.contains(event.target as Node)) {
        setShowMCPList(false);
      }
      if (workflowRef.current && !workflowRef.current.contains(event.target as Node)) {
        setShowWorkflowList(false);
      }
      if (skillPackRef.current && !skillPackRef.current.contains(event.target as Node)) {
        setShowSkillPackList(false);
      }
      if (sourcesRef.current && !sourcesRef.current.contains(event.target as Node)) {
        setShowSourcesList(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const connectedCount = mcpServers.filter(s => connectedMcpServerIds.has(s.id)).length;

  // 关闭其他列表
  const closeOtherLists = (except: string) => {
    if (except !== 'mcp') setShowMCPList(false);
    if (except !== 'workflow') setShowWorkflowList(false);
    if (except !== 'skillpack') setShowSkillPackList(false);
    if (except !== 'sources') setShowSourcesList(false);
  };

  return (
    <div className={`flex items-center gap-1 flex-wrap ${className}`}>
      {/* MCP Tag */}
      {showMCP && (
        <div className="relative" ref={mcpRef}>
          {mcpMode === 'toggle' ? (
            // 开关模式
            <button
              onClick={() => onToggleMCP?.(!enableMCP)}
              className={`
                flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
                ${enableMCP 
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' 
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                }
              `}
              title={enableMCP ? '已启用 MCP 工具' : '点击启用 MCP 工具'}
            >
              <Plug className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[10px]">MCP</span>
              {enableMCP && mcpServers.length > 0 && (
                <span className="text-[10px]">({mcpServers.length})</span>
              )}
            </button>
          ) : (
            // 选择模式
            <>
              <button
                onClick={() => {
                  setShowMCPList(!showMCPList);
                  closeOtherLists('mcp');
                }}
                className={`
                  flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
                  ${selectedMcpServerIds.size > 0
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 ring-1 ring-primary-200 dark:ring-primary-800'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                  }
                `}
                title={`MCP 服务器 (${connectedCount}/${mcpServers.length}已连接${selectedMcpServerIds.size > 0 ? `, ${selectedMcpServerIds.size}个已选` : ''})`}
              >
                <Plug className="w-3.5 h-3.5" />
                {selectedMcpServerIds.size > 0 && (
                  <span className="text-[10px] font-medium">{selectedMcpServerIds.size}</span>
                )}
              </button>

              {/* MCP 列表弹窗 */}
              {showMCPList && (
                <div className="absolute bottom-full left-0 mb-1 w-72 bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl border border-gray-200 dark:border-[#404040] z-50 max-h-80 overflow-hidden">
                  <div className="p-2.5 border-b border-gray-200 dark:border-[#363636]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Plug className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
                        <span className="text-xs font-medium text-gray-900 dark:text-white">MCP 服务器</span>
                        <span className="text-[10px] text-gray-500">({connectedCount}/{mcpServers.length})</span>
                      </div>
                      <button
                        onClick={() => setShowMCPList(false)}
                        className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                      点击选择或连接服务器
                    </p>
                  </div>
                  <div className="p-1.5 max-h-60 overflow-y-auto">
                    {mcpServers.length === 0 ? (
                      <div className="text-center py-4">
                        <Plug className="w-6 h-6 text-gray-300 dark:text-gray-600 mx-auto mb-1.5" />
                        <div className="text-xs text-gray-500 dark:text-gray-400">暂无 MCP 服务器</div>
                      </div>
                    ) : (
                      mcpServers.map((server) => {
                        const isConnected = connectedMcpServerIds.has(server.id);
                        const isConnecting = connectingMcpServerIds.has(server.id);
                        const isSelected = selectedMcpServerIds.has(server.id);
                        return (
                          <div
                            key={server.id}
                            onClick={async () => {
                              if (isConnecting) return;
                              if (!isConnected) {
                                if (onConnectMCP) await onConnectMCP(server.id);
                                return;
                              }
                              if (isSelected) {
                                onDeselectMCP?.(server.id);
                              } else {
                                onSelectMCP?.(server.id);
                              }
                            }}
                            className={`
                              flex items-center justify-between p-1.5 rounded-md cursor-pointer transition-colors
                              ${isConnecting ? 'opacity-70 cursor-wait' : ''}
                              ${!isConnected && !isConnecting ? 'border border-dashed border-gray-300 dark:border-gray-600 hover:bg-yellow-50 dark:hover:bg-yellow-900/20' : ''}
                              ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800' : ''}
                              ${isConnected && !isSelected ? 'hover:bg-gray-50 dark:hover:bg-[#363636]' : ''}
                            `}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isConnecting ? (
                                <Loader className="w-3.5 h-3.5 text-primary-500 animate-spin flex-shrink-0" />
                              ) : (
                                <div className="relative">
                                  <Plug className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-primary-600' : isConnected ? 'text-green-500' : 'text-gray-400'}`} />
                                  {isConnected && (
                                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                  )}
                                </div>
                              )}
                              <span className={`text-xs truncate ${isConnected ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                                {server.display_name || server.client_name || server.name}
                              </span>
                              {!isConnected && !isConnecting && (
                                <span className="text-[9px] text-yellow-600 dark:text-yellow-400 flex-shrink-0">点击连接</span>
                              )}
                            </div>
                            {isSelected && (
                              <div className="w-1.5 h-1.5 rounded-full bg-primary-600 flex-shrink-0"></div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Workflow Tag */}
      {showWorkflow && (
        <div className="relative" ref={workflowRef}>
          {workflowMode === 'toggle' ? (
            // 开关模式
            <button
              onClick={() => onToggleWorkflow?.(!enableWorkflow)}
              className={`
                flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
                ${enableWorkflow 
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' 
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                }
              `}
              title={enableWorkflow ? '已启用工作流' : '点击启用工作流'}
            >
              <WorkflowIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[10px]">流程</span>
              {enableWorkflow && workflows.length > 0 && (
                <span className="text-[10px]">({workflows.length})</span>
              )}
            </button>
          ) : (
            // 选择模式
            <>
              <button
                onClick={() => {
                  setShowWorkflowList(!showWorkflowList);
                  closeOtherLists('workflow');
                }}
                className={`
                  flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
                  ${selectedWorkflowIds.size > 0
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 ring-1 ring-primary-200 dark:ring-primary-800'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                  }
                `}
                title={`工作流${selectedWorkflowIds.size > 0 ? ` (${selectedWorkflowIds.size}个已选)` : ''}`}
              >
                <WorkflowIcon className="w-3.5 h-3.5" />
                {selectedWorkflowIds.size > 0 && (
                  <span className="text-[10px] font-medium">{selectedWorkflowIds.size}</span>
                )}
              </button>

              {/* Workflow 列表弹窗 */}
              {showWorkflowList && (
                <div className="absolute bottom-full left-0 mb-1 w-72 bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl border border-gray-200 dark:border-[#404040] z-50 max-h-80 overflow-hidden">
                  <div className="p-2.5 border-b border-gray-200 dark:border-[#363636]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <WorkflowIcon className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" />
                        <span className="text-xs font-medium text-gray-900 dark:text-white">工作流</span>
                        {selectedWorkflowIds.size > 0 && (
                          <span className="text-[10px] text-primary-600">({selectedWorkflowIds.size})</span>
                        )}
                      </div>
                      <button
                        onClick={() => setShowWorkflowList(false)}
                        className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                      自动化流程，点击选择或取消
                    </p>
                  </div>
                  <div className="p-1.5 max-h-60 overflow-y-auto">
                    {workflows.length === 0 ? (
                      <div className="text-center py-4">
                        <WorkflowIcon className="w-6 h-6 text-gray-300 dark:text-gray-600 mx-auto mb-1.5" />
                        <div className="text-xs text-gray-500 dark:text-gray-400">暂无工作流</div>
                      </div>
                    ) : (
                      workflows.map((workflow) => {
                        const isSelected = selectedWorkflowIds.has(workflow.workflow_id);
                        return (
                          <div
                            key={workflow.workflow_id}
                            onClick={() => {
                              if (isSelected) {
                                onDeselectWorkflow?.(workflow.workflow_id);
                              } else {
                                onSelectWorkflow?.(workflow.workflow_id);
                              }
                            }}
                            className={`
                              flex items-center justify-between p-1.5 rounded-md cursor-pointer transition-colors
                              ${isSelected
                                ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800'
                                : 'hover:bg-gray-50 dark:hover:bg-[#363636]'
                              }
                            `}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <WorkflowIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-primary-600' : 'text-gray-400'}`} />
                              <span className="text-xs text-gray-900 dark:text-white truncate">
                                {workflow.name}
                              </span>
                            </div>
                            {isSelected && (
                              <div className="w-1.5 h-1.5 rounded-full bg-primary-600 flex-shrink-0"></div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 技能包 Tag */}
      {showSkillPack && skillPacks.length > 0 && (
        <div className="relative" ref={skillPackRef}>
          <button
            onClick={() => {
              setShowSkillPackList(!showSkillPackList);
              closeOtherLists('skillpack');
            }}
            className={`
              flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
              ${selectedSkillPackIds.size > 0
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-800'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }
            `}
            title={`技能包${selectedSkillPackIds.size > 0 ? ` (${selectedSkillPackIds.size}个已选)` : ''}`}
          >
            <Package className="w-3.5 h-3.5" />
            {selectedSkillPackIds.size > 0 && (
              <span className="text-[10px] font-medium">{selectedSkillPackIds.size}</span>
            )}
          </button>

          {/* 技能包列表弹窗 */}
          {showSkillPackList && (
            <div className="absolute bottom-full left-0 mb-1 w-72 bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl border border-gray-200 dark:border-[#404040] z-50 max-h-80 overflow-hidden">
              <div className="p-2.5 border-b border-gray-200 dark:border-[#363636]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span className="text-xs font-medium text-gray-900 dark:text-white">技能包</span>
                    {selectedSkillPackIds.size > 0 && (
                      <span className="text-[10px] text-amber-600">({selectedSkillPackIds.size})</span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowSkillPackList(false)}
                    className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="p-1.5 max-h-60 overflow-y-auto">
                {skillPacks.map((skillPack) => {
                  const isSelected = selectedSkillPackIds.has(skillPack.skill_pack_id);
                  return (
                    <div
                      key={skillPack.skill_pack_id}
                      onClick={() => {
                        if (isSelected) {
                          onDeselectSkillPack?.(skillPack.skill_pack_id);
                        } else {
                          onSelectSkillPack?.(skillPack.skill_pack_id);
                        }
                      }}
                      className={`
                        flex items-center justify-between p-1.5 rounded-md cursor-pointer transition-colors
                        ${isSelected
                          ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                          : 'hover:bg-gray-50 dark:hover:bg-[#363636]'
                        }
                      `}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Package className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-amber-600' : 'text-gray-400'}`} />
                        <div className="min-w-0">
                          <span className="text-xs text-gray-900 dark:text-white truncate block">
                            {skillPack.name}
                          </span>
                          {skillPack.summary && (
                            <span className="text-[10px] text-gray-500 truncate block">
                              {skillPack.summary.length > 40 ? skillPack.summary.substring(0, 40) + '...' : skillPack.summary}
                            </span>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-600 flex-shrink-0"></div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sources Tag（研究界面专用） */}
      {showSources && (
        <div className="relative" ref={sourcesRef}>
          <button
            onClick={() => {
              setShowSourcesList(!showSourcesList);
              closeOtherLists('sources');
            }}
            className={`
              flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
              ${pinnedSourceIds.length > 0
                ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 ring-1 ring-purple-200 dark:ring-purple-800'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }
            `}
            title={`Sources 引用${pinnedSourceIds.length > 0 ? ` (${pinnedSourceIds.length}个已选)` : ''}`}
          >
            <FileText className="w-3.5 h-3.5" />
            {pinnedSourceIds.length > 0 && (
              <span className="text-[10px] font-medium">{pinnedSourceIds.length}</span>
            )}
          </button>

          {/* Sources 列表弹窗 */}
          {showSourcesList && (
            <div className="absolute bottom-full left-0 mb-1 w-72 bg-white dark:bg-[#2d2d2d] rounded-lg shadow-xl border border-gray-200 dark:border-[#404040] z-50 max-h-80 overflow-hidden">
              <div className="p-2.5 border-b border-gray-200 dark:border-[#363636]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    <span className="text-xs font-medium text-gray-900 dark:text-white">Sources 引用</span>
                    {pinnedSourceIds.length > 0 && (
                      <span className="text-[10px] text-purple-600">({pinnedSourceIds.length})</span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowSourcesList(false)}
                    className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                  点击将 $引用 插入输入框
                </p>
              </div>
              <div className="p-1.5 max-h-60 overflow-y-auto">
                {sources.length === 0 ? (
                  <div className="text-center py-4">
                    <FileText className="w-6 h-6 text-gray-300 dark:text-gray-600 mx-auto mb-1.5" />
                    <div className="text-xs text-gray-500 dark:text-gray-400">暂无 Sources</div>
                  </div>
                ) : (
                  sources.map((source) => {
                    const isPinned = pinnedSourceIds.includes(source.source_id);
                    const token = source.title || source.source_id;
                    return (
                      <div
                        key={source.source_id}
                        onClick={() => onInsertSourceToken?.(token)}
                        className={`
                          flex items-center justify-between p-1.5 rounded-md cursor-pointer transition-colors
                          ${isPinned
                            ? 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800'
                            : 'hover:bg-gray-50 dark:hover:bg-[#363636]'
                          }
                        `}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {source.source_type === 'url' ? (
                            <LinkIcon className="w-3.5 h-3.5 flex-shrink-0 text-blue-500" />
                          ) : (
                            <FileText className={`w-3.5 h-3.5 flex-shrink-0 ${isPinned ? 'text-purple-600' : 'text-gray-400'}`} />
                          )}
                          <div className="min-w-0">
                            <span className="text-xs text-gray-900 dark:text-white truncate block">
                              ${token}
                            </span>
                            <span className="text-[10px] text-gray-400 truncate block">
                              {source.source_type}{source.mime_type ? ` · ${source.mime_type}` : ''}
                            </span>
                          </div>
                        </div>
                        {isPinned && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onUnpinSource?.(source.source_id);
                            }}
                            className="p-0.5 text-gray-400 hover:text-red-500 rounded"
                            title="取消固定"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 附件上传按钮 */}
      {showAttachment && onAttachFile && (
        <label 
          className={`
            cursor-pointer flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
            ${attachedMediaCount > 0
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
              : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
            }
          `}
          title="上传图片或视频"
        >
          <Paperclip className="w-3.5 h-3.5" />
          {attachedMediaCount > 0 && (
            <span className="text-[10px] font-medium">{attachedMediaCount}</span>
          )}
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAttachFile(e.target.files);
                e.target.value = '';
              }
            }}
          />
        </label>
      )}
    </div>
  );
};

export default InputToolTags;

