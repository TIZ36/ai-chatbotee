/**
 * 插件菜单（合并 MCP / 技能包 / 媒体 / 功能开关）
 * 点击后以弹框形式展示，分组显示：工具/MCP、技能包、媒体、功能开关
 */

import React, { useState } from 'react';
import { Plug, Package, Paperclip } from 'lucide-react';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';
import { Label } from './ui/Label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';

interface SkillPack {
  skill_pack_id: string;
  name: string;
  summary?: string;
}

interface AttachmentMenuProps {
  mcpServers: Array<{ id: string; name: string; display_name?: string; client_name?: string }>;
  skillPacks: SkillPack[];
  selectedMcpServerIds: Set<string>;
  selectedSkillPackIds: Set<string>;
  connectedMcpServerIds: Set<string>;
  connectingMcpServerIds?: Set<string>;
  onSelectMCP: (serverId: string) => void;
  onDeselectMCP: (serverId: string) => void;
  onConnectMCP?: (serverId: string) => Promise<void>;
  onSelectSkillPack: (skillPackId: string) => void;
  onDeselectSkillPack: (skillPackId: string) => void;
  onAttachFile: (files: FileList) => void;
  attachedCount?: number;
  toolCallingEnabled?: boolean;
  onToggleToolCalling?: (enabled: boolean) => void;
}

type PluginTab = 'mcp' | 'skillPack' | 'media' | 'settings';

const AttachmentMenu: React.FC<AttachmentMenuProps> = ({
  mcpServers,
  skillPacks,
  selectedMcpServerIds,
  selectedSkillPackIds,
  connectedMcpServerIds,
  connectingMcpServerIds = new Set(),
  onSelectMCP,
  onDeselectMCP,
  onConnectMCP,
  onSelectSkillPack,
  onDeselectSkillPack,
  onAttachFile,
  attachedCount = 0,
  toolCallingEnabled = false,
  onToggleToolCalling,
}) => {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PluginTab>('mcp');

  const selectedCount =
    selectedMcpServerIds.size + selectedSkillPackIds.size + attachedCount;
  const connectedCount = mcpServers.filter(s => connectedMcpServerIds.has(s.id)).length;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        title="插件：MCP / 技能包 / 媒体"
      >
        <Plug className="w-3.5 h-3.5" />
        <span>插件</span>
        {selectedCount > 0 && (
          <span className="text-[10px] font-medium">{selectedCount}</span>
        )}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setActiveTab('mcp');
        }}
      >
        <DialogContent className="chatee-dialog-standard max-w-md flex flex-col max-h-[70vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              插件
            </DialogTitle>
            <DialogDescription>
              选择 MCP 工具、技能包、媒体或功能开关
            </DialogDescription>
          </DialogHeader>

          {/* Tab 页签（分组） */}
          <div className="flex flex-col min-h-0 flex-1">
            <div className="flex border-b border-gray-200 dark:border-[#404040] overflow-x-auto no-scrollbar flex-shrink-0">
              {[
                { id: 'mcp' as const, label: '工具 / MCP', count: mcpServers.length, show: true },
                { id: 'skillPack' as const, label: '技能包', count: skillPacks.length, show: true },
                { id: 'media' as const, label: '媒体', count: attachedCount, show: true },
                { id: 'settings' as const, label: '功能开关', count: onToggleToolCalling ? 1 : 0, show: !!onToggleToolCalling },
              ]
                .filter(({ show }) => show)
                .map(({ id, label, count }) => {
                  const isActive = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id)}
                      className={`
                        flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap
                        border-b-2
                        ${isActive
                          ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                        }
                      `}
                    >
                      <span>{label}</span>
                      {id === 'settings' ? null : (
                        <span
                          className={`
                            text-xs px-1.5 py-0.5 rounded-full
                            ${isActive
                              ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                            }
                          `}
                        >
                          {id === 'mcp' ? `${connectedCount}/${count}` : count}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>

            {/* 当前分组内容 */}
            <div
              className="flex-1 min-h-0 overflow-y-auto pr-2 no-scrollbar py-2"
              style={{ maxHeight: '50vh' }}
            >
            {activeTab === 'mcp' && (
              <div className="space-y-1 py-2">
                {mcpServers.length === 0 ? (
                  <div className="text-xs text-gray-400 dark:text-gray-500 px-2 py-3">
                    暂无 MCP 服务器
                  </div>
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
                        className={`
                          flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors
                          ${isConnecting
                            ? 'opacity-70 cursor-wait'
                            : !isConnected
                            ? 'hover:bg-muted/40 border border-dashed border-border/60'
                            : isSelected
                            ? 'bg-emerald-50 dark:bg-[rgba(0,212,170,0.08)] border border-emerald-200 dark:border-[rgba(0,212,170,0.20)]'
                            : 'hover:bg-muted/40'
                          }
                        `}
                        title={
                          isConnecting
                            ? '正在连接...'
                            : !isConnected
                            ? '点击连接此服务器'
                            : isSelected
                            ? '点击取消选择'
                            : '点击选择此服务器'
                        }
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Plug
                            className={`w-4 h-4 flex-shrink-0 ${
                              isSelected
                                ? 'text-emerald-600 dark:text-[#00d4aa]'
                                : isConnected
                                ? 'text-emerald-500 dark:text-[#00d4aa]'
                                : 'text-gray-400 dark:text-[#555]'
                            }`}
                          />
                          <span
                            className={`text-sm truncate ${
                              isConnected
                                ? 'text-gray-900 dark:text-[#e0e0e0]'
                                : 'text-gray-600 dark:text-[#888]'
                            }`}
                          >
                            {server.display_name ||
                              server.client_name ||
                              server.name}
                          </span>
                          {isConnecting && (
                            <span className="text-[10px] text-emerald-500 dark:text-[#00d4aa]">
                              连接中...
                            </span>
                          )}
                          {!isConnected && !isConnecting && (
                            <span className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">
                              点击连接
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <div className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-[#00d4aa] ml-2 flex-shrink-0" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {activeTab === 'skillPack' && (
              <div className="space-y-1 py-2">
                {skillPacks.length === 0 ? (
                  <div className="text-xs text-gray-400 dark:text-gray-500 px-2 py-3">
                    暂无技能包
                  </div>
                ) : (
                  skillPacks.map(skillPack => {
                    const isSelected = selectedSkillPackIds.has(
                      skillPack.skill_pack_id
                    );
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
                          flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors
                          ${isSelected
                            ? 'bg-emerald-50 dark:bg-[rgba(0,212,170,0.08)] border border-emerald-200 dark:border-[rgba(0,212,170,0.20)]'
                            : 'hover:bg-muted/40'
                          }
                        `}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Package
                            className={`w-4 h-4 flex-shrink-0 ${
                              isSelected
                                ? 'text-emerald-600 dark:text-[#00d4aa]'
                                : 'text-gray-400 dark:text-[#555]'
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-900 dark:text-[#e0e0e0] truncate block">
                              {skillPack.name}
                            </span>
                            {skillPack.summary && (
                              <span className="text-xs text-gray-500 dark:text-[#888] truncate block">
                                {skillPack.summary.length > 50
                                  ? skillPack.summary.slice(0, 50) + '...'
                                  : skillPack.summary}
                              </span>
                            )}
                          </div>
                        </div>
                        {isSelected && (
                          <div className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-[#00d4aa] ml-2 flex-shrink-0" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {activeTab === 'media' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-[#888]">
                  <Paperclip className="w-3.5 h-3.5 text-emerald-600 dark:text-[#00d4aa]" />
                  <span>媒体</span>
                  {attachedCount > 0 && (
                    <span className="text-[10px] text-emerald-600 dark:text-[#00d4aa] font-medium">
                      {attachedCount} 个已添加
                    </span>
                  )}
                </div>
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-muted/50 text-gray-700 dark:text-[#d0d0d0] cursor-pointer hover:bg-muted/70 border border-transparent hover:border-border/40 transition-colors">
                  <Paperclip className="w-4 h-4 flex-shrink-0" />
                  <span>上传图片/视频</span>
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={e => {
                      if (e.target.files && e.target.files.length > 0) {
                        onAttachFile(e.target.files);
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
              </div>
            )}

            {activeTab === 'settings' && onToggleToolCalling && (
              <div className="space-y-1">
                <div className="flex items-center justify-between p-3 rounded-md bg-muted/30 dark:bg-muted/20 border border-border/40">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <Label htmlFor="plugin-toolcall-toggle" className="text-sm font-medium text-foreground cursor-pointer">
                      ToolCall
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      允许模型调用 MCP 等工具
                    </span>
                  </div>
                  <Switch
                    id="plugin-toolcall-toggle"
                    checked={toolCallingEnabled}
                    onCheckedChange={checked => onToggleToolCalling(Boolean(checked))}
                    className="flex-shrink-0"
                  />
                </div>
              </div>
            )}
          </div>
          </div>

        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            className="niho-close-pink"
            onClick={() => setOpen(false)}
          >
            关闭
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AttachmentMenu;
