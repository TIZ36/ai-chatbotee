import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot, Sliders, Loader, Volume2, Plus, Check, Brain, Sparkles, Zap,
  MessageSquare, Database, Shapes, Pencil
} from 'lucide-react';
import { getAgents, Session } from '../services/sessionApi';
import { listRoleVersions, activateRoleVersion, updateRoleProfile } from '../services/roleApi';
import type { RoleVersion, PersonaPreset, VoicePreset } from '../services/roleApi';
import AgentPersonaDialog from './AgentPersonaDialog';
import PersonaPresetDialog from './PersonaPresetDialog';
import VoicePresetDialog from './VoicePresetDialog';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';
import { toast } from './ui/use-toast';
import {
  defaultPersonaConfig,
  type AgentPersonaFullConfig,
} from './AgentPersonaConfig';

const CHAYA_ID = 'agent_chaya';

const AgentsPage: React.FC = () => {
  const navigate = useNavigate();

  const [agents, setAgents] = useState<Session[]>([]);
  const [roleVersions, setRoleVersions] = useState<RoleVersion[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [personaEditAgent, setPersonaEditAgent] = useState<Session | null>(null);
  const [personaDialogInitialTab, setPersonaDialogInitialTab] = useState<'basic' | 'persona'>('basic');
  const [personaConfig, setPersonaConfig] = useState<AgentPersonaFullConfig>(defaultPersonaConfig);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaPresetDialogOpen, setPersonaPresetDialogOpen] = useState(false);
  const [personaPresetEdit, setPersonaPresetEdit] = useState<PersonaPreset | null>(null);
  const [voicePresetDialogOpen, setVoicePresetDialogOpen] = useState(false);
  const [voicePresetEdit, setVoicePresetEdit] = useState<VoicePreset | null>(null);
  const [presetSaving, setPresetSaving] = useState(false);

  const chaya = agents.find((a) => a.session_id === CHAYA_ID) ?? null;
  const personaPresets: PersonaPreset[] = (chaya?.ext as any)?.personaPresets ?? [];
  const voicePresets: VoicePreset[] = (chaya?.ext as any)?.voicePresets ?? [];

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

  const loadRoleVersions = useCallback(async () => {
    try {
      setIsLoadingVersions(true);
      const res = await listRoleVersions(CHAYA_ID);
      setRoleVersions(res);
    } catch (error) {
      console.error('[AgentsPage] Failed to load role versions:', error);
      setRoleVersions([]);
    } finally {
      setIsLoadingVersions(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  useEffect(() => {
    if (chaya) loadRoleVersions();
  }, [chaya?.session_id, loadRoleVersions]);

  useEffect(() => {
    if (chaya?.ext?.persona) {
      const p = chaya.ext.persona as any;
      setPersonaConfig({
        voice: p.voice || defaultPersonaConfig.voice,
        thinking: p.thinking || defaultPersonaConfig.thinking,
        memoryTriggers: p.memoryTriggers || [],
        responseMode: p.responseMode || defaultPersonaConfig.responseMode,
        memoryTriggersEnabled: p.memoryTriggersEnabled !== false,
        skillTriggerEnabled: p.skillTriggerEnabled !== false,
      });
    }
  }, [chaya?.session_id, chaya?.ext?.persona]);

  const handleActivateVersion = async (versionId: string) => {
    try {
      await activateRoleVersion(CHAYA_ID, versionId);
      await loadAgents();
      await loadRoleVersions();
      toast({ title: '已切换为该人设', variant: 'success' });
    } catch (e) {
      toast({
        title: '切换失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  };

  const handleTogglePersona = async (
    field: keyof AgentPersonaFullConfig,
    value: boolean | AgentPersonaFullConfig['responseMode']
  ) => {
    const next = { ...personaConfig, [field]: value };
    setPersonaConfig(next);
    setPersonaSaving(true);
    try {
      await updateRoleProfile(CHAYA_ID, {
        persona: next,
        reason: 'persona_toggle',
      });
      await loadAgents();
    } catch (e) {
      toast({
        title: '保存失败',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
      setPersonaConfig(personaConfig);
    } finally {
      setPersonaSaving(false);
    }
  };

  const openPersonaDialog = (tab: 'basic' | 'persona') => {
    setPersonaDialogInitialTab(tab);
    setPersonaEditAgent(chaya ?? null);
  };

  const savePersonaPresets = async (nextList: PersonaPreset[]) => {
    if (!chaya) return;
    setPresetSaving(true);
    try {
      const ext = { ...(chaya.ext || {}), personaPresets: nextList };
      await updateRoleProfile(CHAYA_ID, { ext });
      await loadAgents();
      toast({ title: '人设预设已保存', variant: 'success' });
    } catch (e) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setPresetSaving(false);
    }
  };

  const saveVoicePresets = async (nextList: VoicePreset[]) => {
    if (!chaya) return;
    setPresetSaving(true);
    try {
      const ext = { ...(chaya.ext || {}), voicePresets: nextList };
      await updateRoleProfile(CHAYA_ID, { ext });
      await loadAgents();
      toast({ title: '音色预设已保存', variant: 'success' });
    } catch (e) {
      toast({ title: '保存失败', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setPresetSaving(false);
    }
  };

  const handleSavePersonaPreset = (preset: PersonaPreset) => {
    const isEdit = personaPresetEdit != null;
    const next = isEdit
      ? personaPresets.map((p) => (p.id === preset.id ? preset : p))
      : [...personaPresets, preset];
    savePersonaPresets(next);
    setPersonaPresetEdit(null);
  };

  const handleSaveVoicePreset = (preset: VoicePreset) => {
    const isEdit = voicePresetEdit != null;
    const next = isEdit
      ? voicePresets.map((v) => (v.id === preset.id ? preset : v))
      : [...voicePresets, preset];
    saveVoicePresets(next);
    setVoicePresetEdit(null);
  };

  return (
    <>
      <div className="agents-page h-full flex flex-col bg-gray-50 dark:bg-[#1a1a1a]">
        <div className="agents-page-header flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 min-h-9">
            <div className="flex items-center justify-start min-w-0" />
            <div className="flex flex-col items-center justify-center min-w-0 max-w-full px-2 text-center">
              <h1 className="agents-page-title text-xl font-bold text-gray-900 dark:text-white">
                Persona 管理
              </h1>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-[#858585]">
                可添加：人设、音色 · 可开关：人格模式、自驱思考、记忆锚点、技能触发 · 常开：记忆、行为塑造
              </p>
            </div>
            <div className="flex items-center justify-end min-w-0" />
          </div>
        </div>

        <div className="agents-page-list flex-1 overflow-y-auto p-6 no-scrollbar">
          {isLoadingAgents ? (
            <div className="flex items-center justify-center min-h-[200px]">
              <Loader className="w-6 h-6 animate-spin text-primary-500" />
              <span className="ml-2 text-sm text-gray-500">加载中...</span>
            </div>
          ) : !chaya ? (
            <div className="agents-page-empty-state flex flex-col items-center justify-center min-h-[200px] text-center py-12">
              <Bot className="w-12 h-12 text-gray-400 mb-3" />
              <p className="text-sm text-gray-500">
                Chaya 未就绪，请刷新或检查后端
              </p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-8">
              {/* 可添加部分 */}
              <section className="space-y-3">
                <h2 className="agents-page-section-title text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  可添加
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* 人设管理：预设列表 + 添加/编辑弹窗 */}
                  <div className="agents-page-card rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">人设管理</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { setPersonaPresetEdit(null); setPersonaPresetDialogOpen(true); }}
                        className="agents-page-btn-secondary"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        添加人设
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-[#858585] mb-3">
                      添加或编辑人设预设（昵称 + 系统提示词），可在与 Chaya 聊天时切换
                    </p>
                    {personaPresets.length === 0 ? (
                      <p className="text-xs text-gray-500">
                        暂无预设，点击「添加人设」创建
                      </p>
                    ) : (
                      <ul className="space-y-2 max-h-40 overflow-y-auto no-scrollbar">
                        {personaPresets.map((p) => (
                          <li
                            key={p.id}
                            className="agents-page-list-item flex items-center justify-between gap-2 py-1.5 px-2 rounded border border-transparent hover:bg-gray-50 dark:hover:bg-[#363636]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate text-gray-900 dark:text-white">
                                {p.nickname}
                              </div>
                              {p.system_prompt && (
                                <div className="text-[10px] text-gray-500 truncate">
                                  {p.system_prompt.slice(0, 60)}{p.system_prompt.length > 60 ? '...' : ''}
                                </div>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-[var(--color-accent)]"
                              onClick={() => { setPersonaPresetEdit(p); setPersonaPresetDialogOpen(true); }}
                              title="编辑"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {/* TTS / 音色管理：预设列表 + 添加/编辑弹窗 */}
                  <div className="agents-page-card rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                        TTS / 音色管理
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { setVoicePresetEdit(null); setVoicePresetDialogOpen(true); }}
                        className="agents-page-btn-secondary"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        添加音色
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-[#858585] mb-3">
                      添加或编辑音色预设（昵称 + 提供方/角色），可在与 Chaya 聊天时切换
                    </p>
                    {voicePresets.length === 0 ? (
                      <p className="text-xs text-gray-500">
                        暂无预设，点击「添加音色」创建
                      </p>
                    ) : (
                      <ul className="space-y-2 max-h-40 overflow-y-auto no-scrollbar">
                        {voicePresets.map((v) => (
                          <li
                            key={v.id}
                            className="agents-page-list-item flex items-center justify-between gap-2 py-1.5 px-2 rounded border border-transparent hover:bg-gray-50 dark:hover:bg-[#363636]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate text-gray-900 dark:text-white">
                                {v.nickname}
                              </div>
                              <div className="text-[10px] text-gray-500 truncate">
                                {v.voiceName}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 hover:text-[var(--color-accent)]"
                              onClick={() => { setVoicePresetEdit(v); setVoicePresetDialogOpen(true); }}
                              title="编辑"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </section>

              {/* 可开关部分 */}
              <section className="space-y-3">
                <h2 className="agents-page-section-title text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Sliders className="w-4 h-4" />
                  可开关
                </h2>
                <div className="agents-page-card rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] p-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 agents-page-icon--accent">
                        <MessageSquare className="w-4 h-4 text-gray-500" />
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">人格模式</div>
                          <div className="text-xs text-gray-500">思考是否要响应后再参与对话</div>
                        </div>
                      </div>
                      <Switch
                        checked={personaConfig.responseMode === 'persona'}
                        onCheckedChange={(v) => handleTogglePersona('responseMode', v ? 'persona' : 'normal')}
                        disabled={personaSaving}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 agents-page-icon--secondary">
                        <Brain className="w-4 h-4 text-purple-500" />
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">自驱思考</div>
                          <div className="text-xs text-gray-500">按间隔或记忆自主思考</div>
                        </div>
                      </div>
                      <Switch
                        checked={personaConfig.thinking.enabled}
                        onCheckedChange={(v) => handleTogglePersona('thinking', { ...personaConfig.thinking, enabled: v })}
                        disabled={personaSaving}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 agents-page-icon--highlight">
                        <Sparkles className="w-4 h-4 text-yellow-500" />
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">记忆锚点</div>
                          <div className="text-xs text-gray-500">根据记忆规则自动执行动作</div>
                        </div>
                      </div>
                      <Switch
                        checked={personaConfig.memoryTriggersEnabled !== false}
                        onCheckedChange={(v) => handleTogglePersona('memoryTriggersEnabled', v)}
                        disabled={personaSaving}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 agents-page-icon--highlight">
                        <Zap className="w-4 h-4 text-amber-500" />
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">技能触发</div>
                          <div className="text-xs text-gray-500">根据上下文与技能包自动触发能力</div>
                        </div>
                      </div>
                      <Switch
                        checked={personaConfig.skillTriggerEnabled !== false}
                        onCheckedChange={(v) => handleTogglePersona('skillTriggerEnabled', v)}
                        disabled={personaSaving}
                      />
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-gray-500">
                    更多细节可在
                    <button
                      type="button"
                      className="mx-1 underline text-primary-600 dark:text-primary-400 hover:underline"
                      onClick={() => openPersonaDialog('persona')}
                    >
                      Chaya 能力
                    </button>
                    中配置（如思考间隔、记忆规则等）
                  </p>
                </div>
              </section>

              {/* 不可开关部分 */}
              <section className="space-y-3">
                <h2 className="agents-page-section-title agents-page-section-title--muted text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Shapes className="w-4 h-4" />
                  不可开关（常开能力）
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="agents-page-card rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] p-4 opacity-90">
                    <div className="flex items-center gap-2 mb-2">
                      <Database className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">记忆</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      Chaya 会持续积累与你的对话记忆，用于上下文与长期偏好，无需单独开关。
                    </p>
                  </div>
                  <div className="agents-page-card rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] p-4 opacity-90">
                    <div className="flex items-center gap-2 mb-2">
                      <Shapes className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">行为塑造</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      通过长期聊天积累，Chaya 会对自己的能力和行为形成认知，无需单独开关。
                    </p>
                  </div>
                </div>
              </section>

              <div className="flex justify-center pt-2">
                <Button
                  variant="primary"
                  onClick={() => handleSelectAgent(CHAYA_ID)}
                  className="agents-page-cta"
                >
                  去和 Chaya 聊天
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AgentPersonaDialog
        agent={personaEditAgent}
        open={personaEditAgent !== null}
        onOpenChange={(open) => {
          if (!open) setPersonaEditAgent(null);
        }}
        onSaved={() => {
          loadAgents();
          loadRoleVersions();
        }}
        initialTab={personaDialogInitialTab}
      />

      <PersonaPresetDialog
        open={personaPresetDialogOpen}
        onOpenChange={setPersonaPresetDialogOpen}
        mode={personaPresetEdit ? 'edit' : 'add'}
        initial={personaPresetEdit}
        onSave={handleSavePersonaPreset}
        saving={presetSaving}
      />
      <VoicePresetDialog
        open={voicePresetDialogOpen}
        onOpenChange={setVoicePresetDialogOpen}
        mode={voicePresetEdit ? 'edit' : 'add'}
        initial={voicePresetEdit}
        onSave={handleSaveVoicePreset}
        saving={presetSaving}
      />
    </>
  );

  function handleSelectAgent(sessionId: string) {
    navigate(`/?session=${sessionId}`);
  }
};

export default AgentsPage;
