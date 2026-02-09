/**
 * Discord 管理面板（Chaya 子 tab）
 * - Bot Token 录入与启停
 * - 已绑定频道列表与人设设置
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Play,
  Square,
  RefreshCw,
  Settings2,
  Trash2,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  AtSign,
  BookOpen,
} from 'lucide-react';
import { Card } from './ui/PageLayout';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { toast } from './ui/use-toast';
import { getBackendUrl } from '../utils/backendUrl';
import {
  getDiscordStatus,
  getDiscordChannels,
  getDiscordConfig,
  updateDiscordConfig,
  startDiscordBot,
  stopDiscordBot,
  updateDiscordChannel,
  unbindDiscordChannel,
  type DiscordStatus,
  type DiscordChannelBinding,
} from '../services/discordApi';

/** Discord 品牌色图标（简化） */
const DiscordIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden
  >
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const textMuted = 'text-gray-500 dark:text-gray-400';
const panelClass = 'rounded-lg border bg-gray-50 dark:bg-[#111] border-gray-200 dark:border-[#333]';

interface DiscordPanelProps {
  /** 嵌入在 Chaya 子 tab 中，不包 PageLayout */
  embedded?: boolean;
}

const DiscordPanel: React.FC<DiscordPanelProps> = ({ embedded = true }) => {
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [channels, setChannels] = useState<DiscordChannelBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  const [editingPersona, setEditingPersona] = useState<DiscordChannelBinding | null>(null);
  const [personaDraft, setPersonaDraft] = useState('');
  const [savingPersona, setSavingPersona] = useState(false);
  const [guideExpanded, setGuideExpanded] = useState(false);
  const [discordConfig, setDiscordConfig] = useState<{ default_llm_config_id: string }>({ default_llm_config_id: '' });
  const [llmConfigs, setLlmConfigs] = useState<Array<{ config_id: string; name: string; model?: string }>>([]);
  const [savingConfig, setSavingConfig] = useState(false);
  /** 频道级草稿：channel_id -> { system_prompt, llm_config_id }，保存后后端会立即同步到 Chaya Actor */
  const [channelDrafts, setChannelDrafts] = useState<Record<string, { system_prompt: string; llm_config_id: string }>>({});
  const [savingChannelId, setSavingChannelId] = useState<string | null>(null);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const base = getBackendUrl();
      const [s, c, cfg, llmRes] = await Promise.all([
        getDiscordStatus(),
        getDiscordChannels(false),
        getDiscordConfig().catch(() => ({ default_llm_config_id: '' })),
        fetch(`${base}/api/llm/configs`).then((r) => r.json()).catch(() => ({ configs: [] })),
      ]);
      setStatus(s);
      setChannels(c);
      setDiscordConfig(cfg);
      setLlmConfigs(llmRes?.configs || []);
    } catch (e) {
      toast({
        title: '加载失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
      setStatus(null);
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const result = await startDiscordBot(token.trim() || undefined);
      if (result.ok) {
        toast({ title: '已提交启动', description: result.message || 'Bot 正在启动，请稍后刷新状态' });
        setToken('');
        setTimeout(load, 2000);
      } else {
        toast({ title: '启动失败', description: result.error, variant: 'destructive' });
      }
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      const result = await stopDiscordBot();
      if (result.ok) {
        toast({ title: '已停止', description: 'Discord Bot 已停止' });
        load();
      } else {
        toast({ title: '停止失败', description: result.error, variant: 'destructive' });
      }
    } finally {
      setStopping(false);
    }
  };

  const handleUpdateChannel = async (
    channelId: string,
    updates: Partial<Pick<DiscordChannelBinding, 'trigger_mode' | 'enabled' | 'config_override'>>
  ) => {
    try {
      await updateDiscordChannel(channelId, updates);
      toast({ title: '已更新' });
      load();
    } catch (e) {
      toast({
        title: '更新失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  };

  const handleUnbind = async (c: DiscordChannelBinding, deleteSession: boolean) => {
    try {
      const result = await unbindDiscordChannel(c.channel_id, deleteSession);
      if (result.ok) {
        toast({ title: '已解绑', description: `频道 #${c.channel_name || c.channel_id} 已解绑` });
        load();
        if (expandedChannelId === c.channel_id) setExpandedChannelId(null);
      } else {
        toast({ title: '解绑失败', description: result.error, variant: 'destructive' });
      }
    } catch (e) {
      toast({
        title: '解绑失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  };

  const openPersonaDialog = (c: DiscordChannelBinding) => {
    setEditingPersona(c);
    const draft = channelDrafts[c.channel_id];
    setPersonaDraft(draft?.system_prompt ?? c.config_override?.system_prompt ?? '');
  };

  const savePersona = async () => {
    if (!editingPersona) return;
    setSavingPersona(true);
    try {
      await updateDiscordChannel(editingPersona.channel_id, {
        config_override: {
          ...editingPersona.config_override,
          system_prompt: personaDraft.trim() || undefined,
        },
      });
      toast({ title: '人设已保存', description: '已同步到该频道 Chaya Actor' });
      setEditingPersona(null);
      setChannelDrafts((prev) => {
        const next = { ...prev };
        if (editingPersona) delete next[editingPersona.channel_id];
        return next;
      });
      load();
    } catch (e) {
      toast({
        title: '保存失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setSavingPersona(false);
    }
  };

  const content = (
    <div className="discord-panel max-w-2xl mx-auto flex flex-col gap-4 p-4 overflow-y-auto no-scrollbar h-full">
      <div className="flex items-center gap-2 mb-1">
        <DiscordIcon className="w-5 h-5 text-[#5865F2]" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Discord 管理</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setTokenDialogOpen(true)} className="!h-7 !px-2 !text-xs !bg-[var(--color-accent)] !border-[var(--color-accent)] !text-black hover:!opacity-90">
            录入 Bot
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {loading && !status ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent)]" />
        </div>
      ) : (
        <>
          {/* Bot 状态：在线/离线、用户名、该 Bot 默认模型（不同 Bot 可设不同默认） */}
          <Card title="Bot 状态" variant="persona" size="relaxed" className={panelClass}>
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-sm ${status?.running ? 'text-green-600 dark:text-green-400' : textMuted}`}>
                  {status?.running ? '● 在线' : '○ 离线'}
                </span>
                {status?.username && <span className={`text-sm ${textMuted}`}>{status.username}</span>}
              </div>
              {status && !status.running && status.last_error && (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
                  上次启动失败：{status.last_error}
                  <span className={`block mt-0.5 ${textMuted}`}>请检查 Token 是否从 Discord 开发者门户的 Bot 页面复制，且无多余空格。</span>
                </p>
              )}
              <div className="space-y-2">
                <label className={`block text-xs font-medium ${textMuted}`}>该 Bot 默认模型（新绑定频道与未单独设置的频道使用，不同 Bot 可设不同默认）</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={discordConfig.default_llm_config_id}
                    onChange={async (e) => {
                      const v = e.target.value;
                      setSavingConfig(true);
                      try {
                        await updateDiscordConfig({ default_llm_config_id: v });
                        setDiscordConfig((prev) => ({ ...prev, default_llm_config_id: v }));
                        toast({ title: '已保存', description: '该 Bot 默认模型已更新' });
                      } catch (err) {
                        toast({
                          title: '保存失败',
                          description: err instanceof Error ? err.message : String(err),
                          variant: 'destructive',
                        });
                      } finally {
                        setSavingConfig(false);
                      }
                    }}
                    disabled={savingConfig}
                    className={`text-sm px-3 py-2 rounded-lg border bg-white dark:bg-[#0a0a0a] border-gray-200 dark:border-[#333] text-gray-900 dark:text-white min-w-[200px] ${textMuted}`}
                  >
                    <option value="">不设置（继承 Chaya 或 config）</option>
                    {llmConfigs.map((c) => (
                      <option key={c.config_id} value={c.config_id}>
                        {c.name || c.config_id}{c.model ? ` · ${c.model}` : ''}
                      </option>
                    ))}
                  </select>
                  {savingConfig && <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />}
                </div>
              </div>
            </div>
          </Card>

          {/* 已绑定频道：按服务器分组，频道归属在对应服务器下 */}
          <Card title="已绑定频道" variant="persona" size="relaxed" className={panelClass}>
            {channels.length === 0 ? (
              <p className={`text-sm ${textMuted} py-4`}>
                暂无绑定。在 Discord 频道中 @Chaya 发送消息即可自动创建绑定（需在 config.yaml 开启 auto_create_session）。
              </p>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const byGuild: Record<string, { guild_name: string; channels: DiscordChannelBinding[] }> = {};
                  channels.forEach((c) => {
                    const gid = c.guild_id || 'unknown';
                    if (!byGuild[gid]) {
                      byGuild[gid] = { guild_name: c.guild_name || '未知服务器', channels: [] };
                    }
                    byGuild[gid].channels.push(c);
                  });
                  return Object.entries(byGuild).map(([guildId, { guild_name, channels: guildChannels }]) => (
                    <div key={guildId} className="rounded-lg border border-gray-200 dark:border-[#333] bg-gray-50/50 dark:bg-[#0a0a0a] overflow-hidden">
                      <div className="px-3 py-2 border-b border-gray-200 dark:border-[#333] bg-white dark:bg-[#111] flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{guild_name}</span>
                        <span className={`text-xs ${textMuted}`}>
                          {status?.running ? '● 在线' : '○ 离线'}
                        </span>
                        <span className={`text-[10px] ${textMuted} ml-auto`}>{guildChannels.length} 个频道</span>
                      </div>
                      <ul className="divide-y divide-gray-100 dark:divide-white/5">
                        {guildChannels.map((c) => {
                          const draft = channelDrafts[c.channel_id] ?? {
                            system_prompt: c.config_override?.system_prompt ?? '',
                            llm_config_id: c.config_override?.llm_config_id ?? '',
                          };
                          const channelLabel = `#${c.channel_name || c.channel_id}`;
                          const displayName = `${guild_name} / ${channelLabel}`;
                          return (
                            <li key={c.channel_id} className="bg-white dark:bg-[#0a0a0a]">
                              <button
                                type="button"
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                                onClick={() => {
                                  setExpandedChannelId((id) => (id === c.channel_id ? null : c.channel_id));
                                  if (expandedChannelId !== c.channel_id && !channelDrafts[c.channel_id]) {
                                    setChannelDrafts((prev) => ({
                                      ...prev,
                                      [c.channel_id]: {
                                        system_prompt: c.config_override?.system_prompt ?? '',
                                        llm_config_id: c.config_override?.llm_config_id ?? '',
                                      },
                                    }));
                                  }
                                }}
                              >
                                {expandedChannelId === c.channel_id ? (
                                  <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                )}
                                <span className="font-medium text-sm text-gray-900 dark:text-white truncate" title={channelLabel}>
                                  {channelLabel}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0 rounded ${textMuted} ml-auto`}>
                                  {c.trigger_mode === 'mention' ? (
                                    <><AtSign className="w-3 h-3 inline" /> 仅 @</>
                                  ) : (
                                    <><MessageCircle className="w-3 h-3 inline" /> 全部</>
                                  )}
                                </span>
                              </button>
                      {expandedChannelId === c.channel_id && (
                        <div className="px-3 pb-3 pt-0 border-t border-gray-100 dark:border-white/5 space-y-3">
                          <p className={`text-xs ${textMuted} pt-2`}>
                            为 <strong className="text-gray-700 dark:text-gray-200">{displayName}</strong> 设置人设与模型，保存后立即同步到该频道的 Chaya Actor。
                          </p>
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className={`text-xs font-medium ${textMuted}`}>人设（系统提示词）</label>
                              <button
                                type="button"
                                className="text-xs text-[#5865F2] hover:underline"
                                onClick={() => openPersonaDialog(c)}
                              >
                                在弹窗中编辑
                              </button>
                            </div>
                            <textarea
                              value={draft.system_prompt}
                              onChange={(e) =>
                                setChannelDrafts((prev) => ({
                                  ...prev,
                                  [c.channel_id]: { ...(prev[c.channel_id] ?? draft), system_prompt: e.target.value },
                                }))
                              }
                              placeholder="留空则使用 Chaya 默认人设..."
                              className={`w-full px-2.5 py-2 text-xs rounded border bg-white dark:bg-[#0a0a0a] border-gray-200 dark:border-[#333] text-gray-900 dark:text-white resize-y min-h-[72px] ${textMuted}`}
                              rows={3}
                            />
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs ${textMuted}`}>模型：</span>
                            <select
                              value={draft.llm_config_id}
                              onChange={(e) =>
                                setChannelDrafts((prev) => ({
                                  ...prev,
                                  [c.channel_id]: { ...(prev[c.channel_id] ?? draft), llm_config_id: e.target.value },
                                }))
                              }
                              className={`text-xs px-2 py-1.5 rounded border bg-white dark:bg-[#111] border-gray-200 dark:border-[#333] min-w-[160px] text-gray-900 dark:text-white`}
                              title="该频道使用的 LLM，未设置则用默认模型"
                            >
                              <option value="">使用默认模型</option>
                              {llmConfigs.map((cfg) => (
                                <option key={cfg.config_id} value={cfg.config_id}>
                                  {cfg.name || cfg.config_id}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              onClick={async () => {
                                setSavingChannelId(c.channel_id);
                                try {
                                  await updateDiscordChannel(c.channel_id, {
                                    config_override: {
                                      ...c.config_override,
                                      system_prompt: (channelDrafts[c.channel_id] ?? draft).system_prompt.trim() || undefined,
                                      llm_config_id: (channelDrafts[c.channel_id] ?? draft).llm_config_id || undefined,
                                    },
                                  });
                                  toast({ title: '已保存', description: '人设与模型已更新，并已同步到该频道 Chaya Actor' });
                                  load();
                                } catch (err) {
                                  toast({
                                    title: '保存失败',
                                    description: err instanceof Error ? err.message : String(err),
                                    variant: 'destructive',
                                  });
                                } finally {
                                  setSavingChannelId(null);
                                }
                              }}
                              disabled={savingChannelId === c.channel_id}
                              className="!text-xs !bg-[var(--color-accent)] !text-black hover:!opacity-90"
                            >
                              {savingChannelId === c.channel_id ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                              保存
                            </Button>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-100 dark:border-white/5">
                            <select
                              value={c.trigger_mode}
                              onChange={(e) =>
                                handleUpdateChannel(c.channel_id, {
                                  trigger_mode: e.target.value as 'mention' | 'all',
                                })
                              }
                              className={`text-xs px-2 py-1 rounded border bg-white dark:bg-[#111] border-gray-200 dark:border-[#333] ${textMuted}`}
                            >
                              <option value="mention">仅 @Chaya 回复</option>
                              <option value="all">全部消息回复</option>
                            </select>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={c.enabled}
                                onChange={(e) =>
                                  handleUpdateChannel(c.channel_id, { enabled: e.target.checked })
                                }
                                className="rounded border-gray-300 dark:border-[#404040]"
                              />
                              启用
                            </label>
                            <Button
                              size="sm"
                              variant="outline"
                              className="!text-xs !text-red-500 border-red-500/30 ml-auto"
                              onClick={() => handleUnbind(c, false)}
                            >
                              <Trash2 className="w-3 h-3 mr-1" /> 解绑
                            </Button>
                          </div>
                          {(c.message_count !== undefined || c.last_message_at) && (
                            <p className={`text-[10px] ${textMuted}`}>
                              消息数 {c.message_count ?? 0}
                              {c.last_message_at && ` · 最后活跃 ${c.last_message_at.slice(0, 19)}`}
                            </p>
                          )}
                        </div>
                      )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ));
                })()}
              </div>
            )}
          </Card>
        </>
      )}

      {/* 录入 Bot Token 弹窗（Token + 使用说明） */}
      <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
        <DialogContent className="chatee-dialog-standard max-w-lg">
          <DialogHeader>
            <DialogTitle>录入 Bot</DialogTitle>
            <DialogDescription>
              填写 Discord Bot Token 并启动；Token 会持久化，重启服务可自动启动。下方可展开使用说明。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto no-scrollbar space-y-4">
            <div className="space-y-2">
              <label className={`block text-xs font-medium ${textMuted}`}>Bot Token</label>
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="从 Discord 开发者门户 → 应用 → Bot 复制"
                className="font-mono text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleStart}
                disabled={status?.running || starting}
                className="!bg-[var(--color-accent)] !text-black hover:!opacity-90"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span className="ml-1">启动</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleStop}
                disabled={!status?.running || stopping}
                className="border-gray-300 dark:border-[#404040]"
              >
                {stopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                <span className="ml-1">停止</span>
              </Button>
            </div>
            <div className={`rounded border border-gray-200 dark:border-[#333] overflow-hidden ${panelClass}`}>
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-gray-700 dark:text-gray-200"
                onClick={() => setGuideExpanded((e) => !e)}
                aria-expanded={guideExpanded}
              >
                <BookOpen className="w-4 h-4 text-[#5865F2] flex-shrink-0" />
                <span className="text-sm font-medium">使用说明</span>
                {guideExpanded ? <ChevronDown className="w-4 h-4 text-gray-500 ml-auto" /> : <ChevronRight className="w-4 h-4 text-gray-500 ml-auto" />}
              </button>
              {guideExpanded && (
                <div className="border-t border-gray-100 dark:border-white/5 px-3 py-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">后端配置与 Token</h4>
                      <ul className={`text-xs ${textMuted} space-y-1.5 list-disc list-inside`}>
                        <li><code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-[#222]">config.yaml</code> 中增加 <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-[#222]">discord</code> 块；<strong className="text-gray-700 dark:text-gray-300">bot_token</strong> 从 <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-[#5865F2] hover:underline">Developer Portal</a> → Bot 复制。</li>
                        <li><strong className="text-gray-700 dark:text-gray-300">Privileged Intents</strong>：Bot 页必须开启 <strong className="text-gray-700 dark:text-gray-300">MESSAGE CONTENT INTENT</strong>。</li>
                        <li>输入 Token 并「启动」会持久化；<code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-[#222]">auto_start: true</code> 时重启后自动启动。</li>
                      </ul>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">邀请与使用</h4>
                      <ul className={`text-xs ${textMuted} space-y-1.5 list-disc list-inside`}>
                        <li>OAuth2 → URL Generator，Scopes 勾选 <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-[#222]">bot</code>，用生成的 URL 邀请到服务器。</li>
                        <li>频道内 <strong className="text-gray-700 dark:text-gray-300">@Chaya</strong> 发消息即可；下方可为每个频道设置人设与模型。</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="niho-close-pink" onClick={() => setTokenDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 人设编辑弹窗 */}
      <Dialog open={!!editingPersona} onOpenChange={(open) => !open && setEditingPersona(null)}>
        <DialogContent className="chatee-dialog-standard max-w-lg">
          <DialogHeader>
            <DialogTitle>频道人设</DialogTitle>
            <DialogDescription>
              {editingPersona
                ? `${[editingPersona.guild_name, `#${editingPersona.channel_name || editingPersona.channel_id}`].filter(Boolean).join(' / ') || editingPersona.channel_id} 的 Chaya 系统提示词，保存后立即同步到该频道 Actor。`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-auto no-scrollbar">
            <textarea
              value={personaDraft}
              onChange={(e) => setPersonaDraft(e.target.value)}
              placeholder="留空则使用 Chaya 默认人设..."
              className="w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-[#333] text-gray-900 dark:text-white resize-none min-h-[120px]"
              rows={6}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="niho-close-pink" onClick={() => setEditingPersona(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={savePersona}
              disabled={savingPersona}
            >
              {savingPersona ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (embedded) {
    return <div className="h-full overflow-y-auto no-scrollbar">{content}</div>;
  }
  return content;
};

export default DiscordPanel;
export { DiscordIcon };
