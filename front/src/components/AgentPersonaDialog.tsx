/**
 * Agent Persona 配置对话框
 * 用于编辑已有 Agent 的基本信息和高级 Persona 设置
 * 支持两个 Tab：基本信息、高级设置
 */

import React, { useState, useEffect, useRef } from 'react';
import { Settings, Loader, Bot, User, Sliders, Upload } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Label } from './ui/Label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { toast } from './ui/use-toast';
import AgentPersonaConfig, { 
  defaultPersonaConfig, 
  type AgentPersonaFullConfig 
} from './AgentPersonaConfig';
import { updateRoleProfile } from '../services/roleApi';
import { getLLMConfigs, type LLMConfigFromDB } from '../services/llmApi';
import type { Session } from '../services/sessionApi';

type TabType = 'basic' | 'persona';

interface AgentPersonaDialogProps {
  agent: Session | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** 初始激活的 tab */
  initialTab?: TabType;
}

const AgentPersonaDialog: React.FC<AgentPersonaDialogProps> = ({
  agent,
  open,
  onOpenChange,
  onSaved,
  initialTab = 'basic',
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [config, setConfig] = useState<AgentPersonaFullConfig>(defaultPersonaConfig);
  const [isSaving, setIsSaving] = useState(false);
  
  // 基本信息编辑状态
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState<string | null>(null);
  const [editSystemPrompt, setEditSystemPrompt] = useState('');
  const [editLlmConfigId, setEditLlmConfigId] = useState<string | null>(null);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载 LLM 配置
  useEffect(() => {
    if (open) {
      getLLMConfigs().then(setLlmConfigs).catch(console.error);
    }
  }, [open]);

  // 加载 Agent 配置
  useEffect(() => {
    if (agent && open) {
      // 基本信息
      setEditName(agent.name || agent.title || '');
      setEditAvatar(agent.avatar || null);
      setEditSystemPrompt(agent.system_prompt || '');
      setEditLlmConfigId(agent.llm_config_id || null);
      
      // Persona 配置
      const savedPersona = (agent.ext as any)?.persona;
      if (savedPersona) {
        setConfig({
          voice: savedPersona.voice || defaultPersonaConfig.voice,
          thinking: savedPersona.thinking || defaultPersonaConfig.thinking,
          memoryTriggers: savedPersona.memoryTriggers || [],
          responseMode: savedPersona.responseMode || defaultPersonaConfig.responseMode,
          memoryTriggersEnabled: savedPersona.memoryTriggersEnabled !== false ? true : false,
          skillTriggerEnabled: savedPersona.skillTriggerEnabled !== false ? true : false,
        });
      } else {
        setConfig(defaultPersonaConfig);
      }
      
      // 重置到初始 tab
      setActiveTab(initialTab);
    }
  }, [agent, open, initialTab]);

  // 处理头像上传
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      toast({ title: '请选择图片文件', variant: 'destructive' });
      return;
    }
    
    const reader = new FileReader();
    reader.onload = () => {
      setEditAvatar(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!agent) return;

    setIsSaving(true);
    try {
      // 保存所有配置
      await updateRoleProfile(agent.session_id, {
        name: editName.trim() || undefined,
        avatar: editAvatar || undefined,
        system_prompt: editSystemPrompt.trim() || undefined,
        llm_config_id: editLlmConfigId || undefined,
        persona: config,
        reason: 'agent_config_dialog',
      });
      
      toast({ title: '配置已保存', variant: 'success' });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error('[AgentPersonaDialog] Save failed:', error);
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 统计已启用的 Persona 功能
  const enabledFeatures: string[] = [];
  if (config.responseMode === 'persona') enabledFeatures.push('人格模式');
  if (config.voice.enabled) enabledFeatures.push('语音');
  if (config.thinking.enabled) enabledFeatures.push('自驱思考');
  if (config.memoryTriggers.length > 0) enabledFeatures.push(`${config.memoryTriggers.length}条记忆锚点`);

  const enabledLlmConfigs = llmConfigs.filter(c => c.enabled);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col [data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 [data-skin='niho']:text-[var(--text-primary)]">
            <Settings className="w-5 h-5 [data-skin='niho']:text-[var(--color-accent)]" />
            Persona 管理
          </DialogTitle>
        </DialogHeader>

        {/* Tab 切换 - Niho 主题 */}
        <div className="flex items-center gap-2 border-b border-gray-200/70 dark:border-[#404040]/70 [data-skin='niho']:border-[var(--niho-text-border)]">
          <button
            onClick={() => setActiveTab('basic')}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'basic'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400 [data-skin="niho"]:border-[var(--color-accent)] [data-skin="niho"]:text-[var(--color-accent)]'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 [data-skin="niho"]:text-[var(--niho-skyblue-gray)] [data-skin="niho"]:hover:text-[var(--text-primary)]'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            人设与声音
          </button>
          <button
            onClick={() => setActiveTab('persona')}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'persona'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400 [data-skin="niho"]:border-[var(--color-accent)] [data-skin="niho"]:text-[var(--color-accent)]'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 [data-skin="niho"]:text-[var(--niho-skyblue-gray)] [data-skin="niho"]:hover:text-[var(--text-primary)]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Chaya 能力
            {enabledFeatures.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded [data-skin='niho']:bg-[var(--color-accent-bg)] [data-skin='niho']:text-[var(--color-accent)] [data-skin='niho']:border [data-skin='niho']:border-[var(--color-accent-bg)]">
                {enabledFeatures.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab 内容 */}
        <div className="flex-1 overflow-y-auto py-3 no-scrollbar">
          {activeTab === 'basic' ? (
            <div className="space-y-3 px-1">
              {/* 头像 */}
              <div>
                <Label className="mb-1 block [data-skin='niho']:text-[var(--text-primary)]">头像</Label>
                <div className="flex items-center gap-3">
                  <div className="relative w-16 h-16 rounded-full overflow-hidden border border-gray-200 dark:border-[#404040] flex items-center justify-center bg-gray-100 dark:bg-[#363636] [data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)]">
                    {editAvatar ? (
                      <img src={editAvatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <Bot className="w-6 h-6 text-gray-400 [data-skin='niho']:text-[var(--color-accent)]" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="[data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:bg-transparent [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:hover:bg-[var(--color-accent-bg)] [data-skin='niho']:hover:border-[var(--color-accent-bg)] [data-skin='niho']:hover:text-[var(--color-accent)]"
                    >
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                      上传头像
                    </Button>
                    {editAvatar && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditAvatar(null)}
                        className="text-red-500 hover:text-red-600 [data-skin='niho']:text-[var(--color-secondary)] [data-skin='niho']:hover:text-[var(--color-secondary-hover)] [data-skin='niho']:hover:bg-[var(--color-secondary-bg)]"
                      >
                        清除头像
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* 名称 */}
              <div>
                <Label htmlFor="agent-name" className="mb-1 block [data-skin='niho']:text-[var(--text-primary)]">名称</Label>
                <Input
                  id="agent-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="智能体名称"
                  className="[data-skin='niho']:bg-[var(--niho-pure-black-elevated)] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:placeholder:text-[var(--niho-skyblue-gray)] [data-skin='niho']:focus:border-[var(--color-accent-bg)] [data-skin='niho']:focus:ring-[var(--color-accent-bg)]"
                />
              </div>

              {/* 默认 LLM */}
              <div>
                <Label className="mb-1 block [data-skin='niho']:text-[var(--text-primary)]">默认 LLM</Label>
                <Select
                  value={editLlmConfigId || ''}
                  onValueChange={(v) => setEditLlmConfigId(v || null)}
                >
                  <SelectTrigger className="[data-skin='niho']:bg-[var(--niho-pure-black-elevated)] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:focus:border-[var(--color-accent-bg)]">
                    <SelectValue placeholder="选择 LLM 配置" />
                  </SelectTrigger>
                  <SelectContent className="[data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)]">
                    {enabledLlmConfigs.map(c => (
                      <SelectItem 
                        key={c.config_id} 
                        value={c.config_id}
                        className="[data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:hover:bg-[var(--color-accent-bg)] [data-skin='niho']:focus:bg-[var(--color-accent-bg)]"
                      >
                        {c.name} {c.model ? `· ${c.model}` : ''} {c.provider ? `(${c.provider})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 人设（可切换的 persona） */}
              <div>
                <Label htmlFor="agent-prompt" className="mb-1 block [data-skin='niho']:text-[var(--text-primary)]">人设</Label>
                <Textarea
                  id="agent-prompt"
                  value={editSystemPrompt}
                  onChange={(e) => setEditSystemPrompt(e.target.value)}
                  placeholder="定义角色、能力和行为..."
                  className="min-h-[160px] [data-skin='niho']:bg-[var(--niho-pure-black-elevated)] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:placeholder:text-[var(--niho-skyblue-gray)] [data-skin='niho']:focus:border-[var(--color-accent-bg)] [data-skin='niho']:focus:ring-[var(--color-accent-bg)]"
                />
              </div>

              {/* 声音（可切换的 persona） */}
              <AgentPersonaConfig config={config} onChange={setConfig} voiceOnly compact />
            </div>
          ) : (
            <AgentPersonaConfig
              config={config}
              onChange={setConfig}
              chayaOnly
              compact
            />
          )}
        </div>

        <DialogFooter className="flex items-center justify-between border-t pt-3 [data-skin='niho']:border-[var(--niho-text-border)]">
          <div className="text-[11px] text-gray-500 [data-skin='niho']:text-[var(--niho-skyblue-gray)]">
            {activeTab === 'persona' && enabledFeatures.length > 0 
              ? `Chaya 能力已启用: ${enabledFeatures.join('、')}`
              : activeTab === 'persona' 
                ? '人格模式、自驱思考、记忆锚点可在上方配置'
                : ''
            }
          </div>
          <div className="flex gap-2">
            <Button 
              variant="secondary" 
              onClick={() => onOpenChange(false)}
              className="[data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:bg-transparent [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:hover:bg-[var(--niho-text-bg)]"
            >
              取消
            </Button>
            <Button 
              variant="primary" 
              onClick={handleSave} 
              disabled={isSaving}
              className="[data-skin='niho']:bg-[var(--color-accent)] [data-skin='niho']:text-[#000000] [data-skin='niho']:hover:bg-[var(--color-accent-hover)] [data-skin='niho']:shadow-[0_0_12px_rgba(0,255,136,0.3)] [data-skin='niho']:disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                  保存中...
                </>
              ) : (
                '保存'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AgentPersonaDialog;
