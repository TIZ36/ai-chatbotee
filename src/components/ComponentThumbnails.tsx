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
  onSelectMCP: (serverId: string) => void;
  onDeselectMCP: (serverId: string) => void;
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
  onSelectMCP,
  onDeselectMCP,
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
              flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] transition-all relative
              ${selectedMcpServerIds.size > 0
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium ring-1 ring-blue-200 dark:ring-blue-800'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400'
              }
            `}
            title={`MCP 服务器 (${connectedCount}/${mcpServers.length}已连接${selectedMcpServerIds.size > 0 ? `, ${selectedMcpServerIds.size}个已选` : ''}) - 点击查看列表`}
          >
            <Plug className="w-3 h-3 flex-shrink-0" />
            {selectedMcpServerIds.size > 0 && (
              <span className="ml-0.5 text-[10px] font-bold">{selectedMcpServerIds.size}</span>
            )}
          </button>

          {/* MCP 列表弹窗 */}
          {showMCPList && (
            <div className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 max-h-96 overflow-y-auto">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Plug className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">MCP 服务器</h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      ({connectedCount}/{mcpServers.length}已连接)
                    </span>
                    {selectedMcpServerIds.size > 0 && (
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                        {selectedMcpServerIds.size}个已选
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowMCPList(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
                    const isSelected = selectedMcpServerIds.has(server.id);
                    return (
                      <div
                        key={server.id}
                        onClick={() => {
                          if (!isConnected) return; // 未连接的服务器不能选择
                          if (isSelected) {
                            onDeselectMCP(server.id);
                          } else {
                            onSelectMCP(server.id);
                          }
                        }}
                        className={`
                          flex items-center justify-between p-2 rounded-lg transition-colors
                          ${!isConnected 
                            ? 'opacity-50 cursor-not-allowed'
                            : isSelected
                              ? 'bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 cursor-pointer'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer'
                          }
                        `}
                        title={!isConnected ? '未连接 - 请先在 MCP 配置页面连接此服务器' : undefined}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="relative">
                            <Plug className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-primary-600 dark:text-primary-400' : isConnected ? 'text-gray-400' : 'text-gray-300'}`} />
                            {isConnected && (
                              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-white dark:border-gray-800"></span>
                            )}
                          </div>
                          <span className={`text-sm truncate ${isConnected ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
                            {server.display_name || server.client_name || server.name}
                          </span>
                          {!isConnected && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">(未连接)</span>
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
              flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] transition-all relative
              ${selectedWorkflowIds.size > 0
                ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-medium ring-1 ring-purple-200 dark:ring-purple-800'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400'
              }
            `}
            title={`工作流${selectedWorkflowIds.size > 0 ? ` (${selectedWorkflowIds.size}个已选)` : ''} - 点击查看列表`}
          >
            <WorkflowIcon className="w-3 h-3 flex-shrink-0" />
            {selectedWorkflowIds.size > 0 && (
              <span className="ml-0.5 text-[10px] font-bold">{selectedWorkflowIds.size}</span>
            )}
          </button>

          {/* Workflow 列表弹窗 */}
          {showWorkflowList && (
            <div className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 max-h-96 overflow-y-auto">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <WorkflowIcon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">工作流</h3>
                    {selectedWorkflowIds.size > 0 && (
                      <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                        ({selectedWorkflowIds.size}个已选)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowWorkflowList(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
              flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] transition-all relative
              ${selectedSkillPackIds.size > 0
                ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium ring-1 ring-amber-200 dark:ring-amber-800'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400'
              }
            `}
            title={`技能包${selectedSkillPackIds.size > 0 ? ` (${selectedSkillPackIds.size}个已选)` : ''} - 点击查看列表`}
          >
            <Package className="w-3 h-3 flex-shrink-0" />
            {selectedSkillPackIds.size > 0 && (
              <span className="ml-0.5 text-[10px] font-bold">{selectedSkillPackIds.size}</span>
            )}
          </button>

          {/* 技能包 列表弹窗 */}
          {showSkillPackList && (
            <div className="absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 max-h-96 overflow-y-auto">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">技能包</h3>
                    {selectedSkillPackIds.size > 0 && (
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                        ({selectedSkillPackIds.size}个已选)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowSkillPackList(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
      <label className="cursor-pointer flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] transition-all text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400" title="上传图片或视频">
        <Paperclip className="w-3 h-3 flex-shrink-0" />
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

