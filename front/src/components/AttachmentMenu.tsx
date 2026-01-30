/**
 * 附件菜单（合并 MCP / 工作流 / 技能包 / 附件）
 */

import React, { useState, useRef, useEffect } from 'react';
import { Plug, Workflow as WorkflowIcon, Package, Paperclip, X } from 'lucide-react';
import { Button } from './ui/Button';

interface SkillPack {
  skill_pack_id: string;
  name: string;
  summary?: string;
}

interface AttachmentMenuProps {
  mcpServers: Array<{ id: string; name: string; display_name?: string; client_name?: string }>;
  workflows: Array<{ workflow_id: string; name: string }>;
  skillPacks: SkillPack[];
  selectedMcpServerIds: Set<string>;
  selectedWorkflowIds: Set<string>;
  selectedSkillPackIds: Set<string>;
  connectedMcpServerIds: Set<string>;
  connectingMcpServerIds?: Set<string>;
  onSelectMCP: (serverId: string) => void;
  onDeselectMCP: (serverId: string) => void;
  onConnectMCP?: (serverId: string) => Promise<void>;
  onSelectWorkflow: (workflowId: string) => void;
  onDeselectWorkflow: (workflowId: string) => void;
  onSelectSkillPack: (skillPackId: string) => void;
  onDeselectSkillPack: (skillPackId: string) => void;
  onAttachFile: (files: FileList) => void;
  attachedCount?: number;
}

const AttachmentMenu: React.FC<AttachmentMenuProps> = ({
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
  attachedCount = 0,
}) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedCount =
    selectedMcpServerIds.size + selectedWorkflowIds.size + selectedSkillPackIds.size + attachedCount;

  const connectedCount = mcpServers.filter(s => connectedMcpServerIds.has(s.id)).length;

  return (
    <div ref={wrapperRef} className="relative flex-shrink-0">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(v => !v)}
        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        title="输入附加：MCP / 工作流 / 技能包 / 附件"
      >
        <Paperclip className="w-3.5 h-3.5" />
        <span>附件</span>
        {selectedCount > 0 && (
          <span className="text-[10px] font-medium">{selectedCount}</span>
        )}
      </Button>

      {open && (
        <div className="attachment-panel fixed left-3 right-3 bottom-24 mb-2 w-auto bg-white/95 dark:bg-[#141414]/95 rounded-lg shadow-2xl border border-border/30 z-50 max-h-[60vh] overflow-y-auto no-scrollbar backdrop-blur-md sm:absolute sm:bottom-full sm:left-0 sm:right-auto sm:mb-2 sm:w-[min(520px,90vw)] sm:max-h-[70vh]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
            <div className="text-sm font-medium text-gray-900 dark:text-[#e0e0e0]">输入附加</div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setOpen(false)}
              title="关闭"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* MCP */}
          <div className="px-3 pt-3">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-[#888]">
              <Plug className="w-3.5 h-3.5 text-emerald-600 dark:text-[#00d4aa]" />
              <span>工具 / MCP</span>
              <span className="text-[10px]">({connectedCount}/{mcpServers.length} 已连接)</span>
              {selectedMcpServerIds.size > 0 && (
                <span className="text-[10px] text-emerald-600 dark:text-[#00d4aa] font-medium">
                  {selectedMcpServerIds.size} 个已选
                </span>
              )}
            </div>
          </div>
          <div className="p-2">
            {mcpServers.length === 0 ? (
              <div className="text-xs text-gray-400 dark:text-gray-500 px-2 py-3">暂无 MCP 服务器</div>
            ) : (
              mcpServers.map(server => {
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
                        onDeselectMCP(server.id);
                      } else {
                        onSelectMCP(server.id);
                      }
                    }}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                      isConnecting
                        ? 'opacity-70 cursor-wait'
                        : !isConnected
                        ? 'hover:bg-muted/40 border border-dashed border-border/60'
                        : isSelected
                        ? 'bg-emerald-50 dark:bg-[rgba(0,212,170,0.08)] border border-emerald-200 dark:border-[rgba(0,212,170,0.20)]'
                        : 'hover:bg-muted/40'
                    }`}
                    title={isConnecting ? '正在连接...' : !isConnected ? '点击连接此服务器' : isSelected ? '点击取消选择' : '点击选择此服务器'}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Plug className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-emerald-600 dark:text-[#00d4aa]' : isConnected ? 'text-emerald-500 dark:text-[#00d4aa]' : 'text-gray-400 dark:text-[#555]'}`} />
                      <span className={`text-sm truncate ${isConnected ? 'text-gray-900 dark:text-[#e0e0e0]' : 'text-gray-600 dark:text-[#888]'}`}>
                        {server.display_name || server.client_name || server.name}
                      </span>
                      {isConnecting && (
                        <span className="text-[10px] text-emerald-500 dark:text-[#00d4aa]">连接中...</span>
                      )}
                      {!isConnected && !isConnecting && (
                        <span className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">点击连接</span>
                      )}
                    </div>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-[#00d4aa] ml-2 flex-shrink-0" />}
                  </div>
                );
              })
            )}
          </div>

          {/* Workflow */}
          <div className="px-3 pt-2 border-t border-border/40">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-[#888]">
              <WorkflowIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-[#00d4aa]" />
              <span>工作流</span>
              {selectedWorkflowIds.size > 0 && (
                <span className="text-[10px] text-emerald-600 dark:text-[#00d4aa] font-medium">
                  {selectedWorkflowIds.size} 个已选
                </span>
              )}
            </div>
          </div>
          <div className="p-2">
            {workflows.length === 0 ? (
              <div className="text-xs text-gray-400 dark:text-gray-500 px-2 py-3">暂无工作流</div>
            ) : (
              workflows.map(workflow => {
                const isSelected = selectedWorkflowIds.has(workflow.workflow_id);
                return (
                  <div
                    key={workflow.workflow_id}
                    onClick={() => {
                      if (isSelected) onDeselectWorkflow(workflow.workflow_id);
                      else onSelectWorkflow(workflow.workflow_id);
                    }}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-emerald-50 dark:bg-[rgba(0,212,170,0.08)] border border-emerald-200 dark:border-[rgba(0,212,170,0.20)]'
                        : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <WorkflowIcon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-emerald-600 dark:text-[#00d4aa]' : 'text-gray-400 dark:text-[#555]'}`} />
                      <span className="text-sm text-gray-900 dark:text-[#e0e0e0] truncate">{workflow.name}</span>
                    </div>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-[#00d4aa] ml-2 flex-shrink-0" />}
                  </div>
                );
              })
            )}
          </div>

          {/* Skill packs */}
          <div className="px-3 pt-2 border-t border-border/40">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-[#888]">
              <Package className="w-3.5 h-3.5 text-emerald-600 dark:text-[#00d4aa]" />
              <span>技能包</span>
              {selectedSkillPackIds.size > 0 && (
                <span className="text-[10px] text-emerald-600 dark:text-[#00d4aa] font-medium">
                  {selectedSkillPackIds.size} 个已选
                </span>
              )}
            </div>
          </div>
          <div className="p-2">
            {skillPacks.length === 0 ? (
              <div className="text-xs text-gray-400 dark:text-gray-500 px-2 py-3">暂无技能包</div>
            ) : (
              skillPacks.map(skillPack => {
                const isSelected = selectedSkillPackIds.has(skillPack.skill_pack_id);
                return (
                  <div
                    key={skillPack.skill_pack_id}
                    onClick={() => {
                      if (isSelected) onDeselectSkillPack(skillPack.skill_pack_id);
                      else onSelectSkillPack(skillPack.skill_pack_id);
                    }}
                    className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-emerald-50 dark:bg-[rgba(0,212,170,0.08)] border border-emerald-200 dark:border-[rgba(0,212,170,0.20)]'
                        : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Package className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-emerald-600 dark:text-[#00d4aa]' : 'text-gray-400 dark:text-[#555]'}`} />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-gray-900 dark:text-[#e0e0e0] truncate block">
                          {skillPack.name}
                        </span>
                        {skillPack.summary && (
                          <span className="text-xs text-gray-500 dark:text-[#888] truncate block">
                            {skillPack.summary.length > 50 ? skillPack.summary.slice(0, 50) + '...' : skillPack.summary}
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-[#00d4aa] ml-2 flex-shrink-0" />}
                  </div>
                );
              })
            )}
          </div>

          {/* Attachments */}
          <div className="px-3 pt-2 pb-1 border-t border-border/40">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-[#888]">
              <Paperclip className="w-3.5 h-3.5 text-emerald-600 dark:text-[#00d4aa]" />
              <span>附件</span>
              {attachedCount > 0 && (
                <span className="text-[10px] text-emerald-600 dark:text-[#00d4aa] font-medium">
                  {attachedCount} 个已添加
                </span>
              )}
            </div>
            <div className="mt-2">
              <label className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs bg-muted/50 text-gray-700 dark:text-[#d0d0d0] cursor-pointer hover:bg-muted/70">
                <Paperclip className="w-3.5 h-3.5" />
                <span>上传图片/视频</span>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttachmentMenu;
