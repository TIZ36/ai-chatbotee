/**
 * MCP、Workflow、技能包和附件缩略图标组件
 * 依附在输入框边缘，点击显示具体列表和功能介绍
 */

import React, { useState, useRef, useEffect } from 'react';
import { Plug, Workflow as WorkflowIcon, Package, Paperclip, X, ChevronDown, ChevronUp } from 'lucide-react';

interface SkillPack {
  skill_pack_id: string;
  name: string;
  summary?: string;
}

interface ComponentThumbnailsProps {
  mcpServers: Array<{ id: string; name: string; display_name?: string; client_name?: string }>;
  workflows: Array<{ workflow_id: string; name: string }>;
  skillPacks: SkillPack[];
  selectedMcpServerIds: Set<string>;
  selectedWorkflowIds: Set<string>;
  selectedSkillPackIds: Set<string>;
  connectedMcpServerIds: Set<string>;
  connectingMcpServerIds?: Set<string>; // 正在连接中的服务器
  onSelectMCP: (serverId: string) => void;
  onDeselectMCP: (serverId: string) => void;
  onConnectMCP?: (serverId: string) => Promise<void>; // 连接MCP服务器
  onSelectWorkflow: (workflowId: string) => void;
  onDeselectWorkflow: (workflowId: string) => void;
  onSelectSkillPack: (skillPackId: string) => void;
  onDeselectSkillPack: (skillPackId: string) => void;
  onAttachFile: (files: FileList) => void;
}

const ComponentThumbnails: React.FC<ComponentThumbnailsProps> = ({
  mcpServers,
  workflows,
  skillPacks,
  selectedMcpServerIds,
  selectedWorkflowIds,
  selectedSkillPackIds,
  connectedMcpServerIds,
  connectingMcpServerIds = new Set(),
  onSelectMCP,
  onDeselectMCP,
  onConnectMCP,
  onSelectWorkflow,
  onDeselectWorkflow,
  onSelectSkillPack,
  onDeselectSkillPack,
  onAttachFile,
}) => {
  const [showMCPList, setShowMCPList] = useState(false);
  const [showWorkflowList, setShowWorkflowList] = useState(false);
  const [showSkillPackList, setShowSkillPackList] = useState(false);
  const mcpRef = useRef<HTMLDivElement>(null);
  const workflowRef = useRef<HTMLDivElement>(null);
  const skillPackRef = useRef<HTMLDivElement>(null);

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
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 显示所有MCP服务器，不仅仅是已连接的
  const availableMcpServers = mcpServers;
  const connectedCount = mcpServers.filter(s => connectedMcpServerIds.has(s.id)).length;
  const availableWorkflows = workflows;
  const availableSkillPacks = skillPacks;

  return (
    <>
      {/* MCP 缩略图标 - Tag样式 - 始终显示 */}
      {(
        <div className="relative" ref={mcpRef}>
          <button
            onClick={() => {
              setShowMCPList(!showMCPList);
              setShowWorkflowList(false);
            }}
            className={`
              flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
              ${selectedMcpServerIds.size > 0
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium ring-1 ring-primary-200 dark:ring-primary-800'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }
            `}
            title={`MCP 服务器 (${connectedCount}/${mcpServers.length}已连接${selectedMcpServerIds.size > 0 ? `, ${selectedMcpServerIds.size}个已选` : ''}) - 点击查看列表`}
          >
            <Plug className="w-3.5 h-3.5 flex-shrink-0" />
            {selectedMcpServerIds.size > 0 && (
              <span className="text-[10px] font-medium">{selectedMcpServerIds.size}</span>
            )}
          </button>

          {/* MCP 列表弹窗 */}
          {showMCPList && (
            <div className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 max-h-96 overflow-y-auto">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Plug className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">MCP 服务器</h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      ({connectedCount}/{mcpServers.length}已连接)
                    </span>
                    {selectedMcpServerIds.size > 0 && (
                      <span className="text-xs text-primary-600 dark:text-primary-400 font-medium">
                        {selectedMcpServerIds.size}个已选
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowMCPList(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="关闭"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Model Context Protocol - 提供工具和上下文能力，点击选择或取消选择服务器
                </p>
              </div>
              <div className="p-2">
                {availableMcpServers.length === 0 ? (
                  <div className="text-center py-6">
                    <Plug className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                      暂无 MCP 服务器配置
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      请在导航栏的「MCP」页面添加和连接服务器
                    </p>
                  </div>
                ) : (
                  availableMcpServers.map((server) => {
                    const isConnected = connectedMcpServerIds.has(server.id);
                    const isConnecting = connectingMcpServerIds.has(server.id);
                    const isSelected = selectedMcpServerIds.has(server.id);
                    return (
                      <div
                        key={server.id}
                        onClick={async () => {
                          if (isConnecting) return; // 正在连接中不能操作
                          if (!isConnected) {
                            // 未连接的服务器，尝试连接
                            if (onConnectMCP) {
                              await onConnectMCP(server.id);
                            }
                            return;
                          }
                          // 已连接的服务器，切换选择状态
                          if (isSelected) {
                            onDeselectMCP(server.id);
                          } else {
                            onSelectMCP(server.id);
                          }
                        }}
                        className={`
                          flex items-center justify-between p-2 rounded-lg transition-colors cursor-pointer
                          ${isConnecting
                            ? 'opacity-70 cursor-wait'
                            : !isConnected 
                              ? 'hover:bg-yellow-50 dark:hover:bg-yellow-900/20 border border-dashed border-gray-300 dark:border-gray-600'
                              : isSelected
                                ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                          }
                        `}
                        title={isConnecting ? '正在连接...' : !isConnected ? '点击连接此服务器' : isSelected ? '点击取消选择' : '点击选择此服务器'}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="relative">
                            {isConnecting ? (
                              <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                              <>
                                <Plug className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-primary-600 dark:text-primary-400' : isConnected ? 'text-green-500' : 'text-gray-400'}`} />
                                {isConnected && (
                                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-white dark:border-gray-800"></span>
                                )}
                              </>
                            )}
                          </div>
                          <span className={`text-sm truncate ${isConnected ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
                            {server.display_name || server.client_name || server.name}
                          </span>
                          {isConnecting && (
                            <span className="text-[10px] text-primary-500">连接中...</span>
                          )}
                          {!isConnected && !isConnecting && (
                            <span className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">点击连接</span>
                          )}
                        </div>
                        {isSelected && (
                          <div className="w-2 h-2 rounded-full bg-primary-600 ml-2 flex-shrink-0"></div>
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

      {/* Workflow 缩略图标 - Tag样式 - 始终显示 */}
      {(
        <div className="relative" ref={workflowRef}>
          <button
            onClick={() => {
              setShowWorkflowList(!showWorkflowList);
              setShowMCPList(false);
            }}
            className={`
              flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
              ${selectedWorkflowIds.size > 0
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium ring-1 ring-primary-200 dark:ring-primary-800'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }
            `}
            title={`工作流${selectedWorkflowIds.size > 0 ? ` (${selectedWorkflowIds.size}个已选)` : ''} - 点击查看列表`}
          >
            <WorkflowIcon className="w-3.5 h-3.5 flex-shrink-0" />
            {selectedWorkflowIds.size > 0 && (
              <span className="text-[10px] font-medium">{selectedWorkflowIds.size}</span>
            )}
          </button>

          {/* Workflow 列表弹窗 */}
          {showWorkflowList && (
            <div className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 max-h-96 overflow-y-auto">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <WorkflowIcon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">工作流</h3>
                    {selectedWorkflowIds.size > 0 && (
                      <span className="text-xs text-primary-600 dark:text-primary-400 font-medium">
                        ({selectedWorkflowIds.size}个已选)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowWorkflowList(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="关闭"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  自动化工作流程 - 连接多个步骤完成任务，点击选择或取消选择工作流
                </p>
              </div>
              <div className="p-2">
                {availableWorkflows.length === 0 ? (
                  <div className="text-center py-6">
                    <WorkflowIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                      暂无工作流
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      请在导航栏的「工作流」页面创建工作流
                    </p>
                  </div>
                ) : (
                  availableWorkflows.map((workflow) => {
                    const isSelected = selectedWorkflowIds.has(workflow.workflow_id);
                    return (
                      <div
                        key={workflow.workflow_id}
                        onClick={() => {
                          if (isSelected) {
                            onDeselectWorkflow(workflow.workflow_id);
                          } else {
                            onSelectWorkflow(workflow.workflow_id);
                          }
                        }}
                        className={`
                          flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors
                          ${isSelected
                            ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                          }
                        `}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <WorkflowIcon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400'}`} />
                          <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                            {workflow.name}
                          </span>
                        </div>
                        {isSelected && (
                          <div className="w-2 h-2 rounded-full bg-primary-600 ml-2 flex-shrink-0"></div>
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

      {/* 技能包 缩略图标 - Tag样式 - 始终显示 */}
      {(
        <div className="relative" ref={skillPackRef}>
          <button
            onClick={() => {
              setShowSkillPackList(!showSkillPackList);
              setShowMCPList(false);
              setShowWorkflowList(false);
            }}
            className={`
              flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all
              ${selectedSkillPackIds.size > 0
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium ring-1 ring-amber-200 dark:ring-amber-800'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              }
            `}
            title={`技能包${selectedSkillPackIds.size > 0 ? ` (${selectedSkillPackIds.size}个已选)` : ''} - 点击查看列表`}
          >
            <Package className="w-3.5 h-3.5 flex-shrink-0" />
            {selectedSkillPackIds.size > 0 && (
              <span className="text-[10px] font-medium">{selectedSkillPackIds.size}</span>
            )}
          </button>

          {/* 技能包 列表弹窗 */}
          {showSkillPackList && (
            <div className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 max-h-96 overflow-y-auto">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">技能包</h3>
                    {selectedSkillPackIds.size > 0 && (
                      <span className="text-xs text-primary-600 dark:text-primary-400 font-medium">
                        ({selectedSkillPackIds.size}个已选)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowSkillPackList(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    title="关闭"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  技能包 - 预定义的对话模板和能力，点击选择或取消选择
                </p>
              </div>
              <div className="p-2">
                {availableSkillPacks.length === 0 ? (
                  <div className="text-center py-6">
                    <Package className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                      暂无技能包
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      在对话中选择消息，点击「创建技能包」来创建
                    </p>
                  </div>
                ) : (
                  availableSkillPacks.map((skillPack) => {
                    const isSelected = selectedSkillPackIds.has(skillPack.skill_pack_id);
                    return (
                      <div
                        key={skillPack.skill_pack_id}
                        onClick={() => {
                          if (isSelected) {
                            onDeselectSkillPack(skillPack.skill_pack_id);
                          } else {
                            onSelectSkillPack(skillPack.skill_pack_id);
                          }
                        }}
                        className={`
                          flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors
                          ${isSelected
                            ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                          }
                        `}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Package className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-900 dark:text-gray-100 truncate block">
                              {skillPack.name}
                            </span>
                            {skillPack.summary && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate block">
                                {skillPack.summary.length > 50 ? skillPack.summary.substring(0, 50) + '...' : skillPack.summary}
                              </span>
                            )}
                          </div>
                        </div>
                        {isSelected && (
                          <div className="w-2 h-2 rounded-full bg-amber-600 ml-2 flex-shrink-0"></div>
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

      {/* 附件上传按钮 - Tag样式 */}
      <label className="cursor-pointer flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] transition-all text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300" title="上传图片或视频">
        <Paperclip className="w-3.5 h-3.5 flex-shrink-0" />
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAttachFile(e.target.files);
              // 清空 input，允许重复选择同一文件
              e.target.value = '';
            }
          }}
        />
      </label>
    </>
  );
};

export default ComponentThumbnails;
