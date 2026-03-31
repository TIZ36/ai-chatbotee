import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot, Loader, Volume2, Plus, Brain, Sparkles, Zap,
  MessageSquare, Pencil
} from 'lucide-react';
import { getAgents, Session } from '../services/sessionApi';
import { updateRoleProfile } from '../services/roleApi';
import type { PersonaPreset, VoicePreset } from '../services/roleApi';
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
const PERSONA_SECTIONS: Array<{
  id: 'persona-presets' | 'voice-presets' | 'persona-switches';
  label: string;
}> = [
  { id: 'persona-presets', label: '人设管理' },
  { id: 'voice-presets', label: '音色管理' },
  { id: 'persona-switches', label: '人格能力开关' },
];

const AgentsPage: React.FC = () => {
  const [agents, setAgents] = useState<Session[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [personaEditAgent, setPersonaEditAgent] = useState<Session | null>(null);
  const [personaDialogInitialTab, setPersonaDialogInitialTab] = useState<'basic' | 'persona'>('basic');
  const [personaConfig, setPersonaConfig] = useState<AgentPersonaFullConfig>(defaultPersonaConfig);
  const [personaSaving, setPersonaSaving] = useState(false);
  const [personaPresetDialogOpen, setPersonaPresetDialogOpen] = useState(false);
  const [personaPresetEdit, setPersonaPresetEdit] = useState<PersonaPreset | null>(null);
  const [voicePresetDialogOpen, setVoicePresetDialogOpen] = useState(false);
  const [voicePresetEdit, setVoicePresetEdit] = useState<VoicePreset | null>(null);
  const [presetSaving, setPresetSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<
    'persona-presets' | 'voice-presets' | 'persona-switches'
  >('persona-presets');

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

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

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

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'persona-presets':
        return (
          <div className="app-card-item agents-page-card app-card-pad">
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
              <ul className="space-y-2 max-h-[48vh] overflow-y-auto no-scrollbar">
                {personaPresets.map((p) => (
                  <li
                    key={p.id}
                    className="app-list-item agents-page-list-item flex items-center justify-between gap-2 py-1.5 px-2"
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
        );
      case 'voice-presets':
        return (
          <div className="app-card-item agents-page-card app-card-pad">
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
              <ul className="space-y-2 max-h-[48vh] overflow-y-auto no-scrollbar">
                {voicePresets.map((v) => (
                  <li
                    key={v.id}
                    className="app-list-item agents-page-list-item flex items-center justify-between gap-2 py-1.5 px-2"
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
        );
      case 'persona-switches':
        return (
          <div className="app-card-item agents-page-card app-card-pad">
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
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="agents-page h-full flex flex-col bg-[var(--surface-primary)]">
        <div className="flex-1 overflow-y-auto no-scrollbar app-pane-pad">
          {isLoadingAgents ? (
            <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
              <Loader className="w-6 h-6 animate-spin mr-2" />
              加载中…
            </div>
          ) : !chaya ? (
            <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
              <Bot className="w-10 h-10 text-[var(--text-muted)] mb-3 opacity-60" />
              <p className="text-sm text-[var(--text-secondary)]">
                Chaya 未就绪，请刷新或检查后端
              </p>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto w-full space-y-3">
              <div className="app-card-item app-card-pad-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)]">Chaya Persona 配置</div>
                  <div className="text-xs text-[var(--text-secondary)] mt-1">
                    管理人设与音色预设、能力开关与快捷操作
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button variant="outline" size="sm" className="h-8" onClick={() => openPersonaDialog('basic')}>
                    Chaya 配置
                  </Button>
                </div>
              </div>

              <div className="persona-two-pane">
                <aside className="persona-two-pane-nav">
                  <div className="persona-two-pane-nav-title">Persona 配置菜单</div>
                  <div className="persona-two-pane-nav-list">
                    {PERSONA_SECTIONS.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        className={`persona-two-pane-nav-item ${activeSection === section.id ? 'is-active' : ''}`}
                        onClick={() => setActiveSection(section.id)}
                      >
                        {section.label}
                      </button>
                    ))}
                  </div>
                </aside>
                <div className="persona-two-pane-content">
                  {renderActiveSection()}
                </div>
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
};

export default AgentsPage;
