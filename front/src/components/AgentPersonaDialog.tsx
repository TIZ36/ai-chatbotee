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
  if (config.memoryTriggers.length > 0) enabledFeatures.push(`${config.memoryTriggers.length}条触发规则`);

  const enabledLlmConfigs = llmConfigs.filter(c => c.enabled);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            智能体配置
          </DialogTitle>
        </DialogHeader>

        {/* Tab 切换 */}
        <div className="flex items-center gap-2 border-b border-gray-200/70 dark:border-[#404040]/70">
          <button
            onClick={() => setActiveTab('basic')}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'basic'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            基本信息
          </button>
          <button
            onClick={() => setActiveTab('persona')}
            className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'persona'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            高级设置
            {enabledFeatures.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded">
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
                <Label className="mb-1 block">头像</Label>
                <div className="flex items-center gap-3">
                  <div className="relative w-16 h-16 rounded-full overflow-hidden border border-gray-200 dark:border-[#404040] flex items-center justify-center bg-gray-100 dark:bg-[#363636]">
                    {editAvatar ? (
                      <img src={editAvatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <Bot className="w-6 h-6 text-gray-400" />
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
                    >
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                      上传头像
                    </Button>
                    {editAvatar && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditAvatar(null)}
                        className="text-red-500 hover:text-red-600"
                      >
                        清除头像
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* 名称 */}
              <div>
                <Label htmlFor="agent-name" className="mb-1 block">名称</Label>
                <Input
                  id="agent-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="智能体名称"
                />
              </div>

              {/* 默认 LLM */}
              <div>
                <Label className="mb-1 block">默认 LLM</Label>
                <Select
                  value={editLlmConfigId || ''}
                  onValueChange={(v) => setEditLlmConfigId(v || null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择 LLM 配置" />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledLlmConfigs.map(c => (
                      <SelectItem key={c.config_id} value={c.config_id}>
                        {c.name} {c.model ? `· ${c.model}` : ''} {c.provider ? `(${c.provider})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 人设 / System Prompt */}
              <div>
                <Label htmlFor="agent-prompt" className="mb-1 block">人设 / System Prompt</Label>
                <Textarea
                  id="agent-prompt"
                  value={editSystemPrompt}
                  onChange={(e) => setEditSystemPrompt(e.target.value)}
                  placeholder="定义智能体的角色、能力和行为..."
                  className="min-h-[160px]"
                />
              </div>
            </div>
          ) : (
            <AgentPersonaConfig
              config={config}
              onChange={setConfig}
              compact
            />
          )}
        </div>

        <DialogFooter className="flex items-center justify-between border-t pt-3">
          <div className="text-[11px] text-gray-500">
            {activeTab === 'persona' && enabledFeatures.length > 0 
              ? `已启用: ${enabledFeatures.join('、')}`
              : activeTab === 'persona' 
                ? '未启用任何高级功能'
                : ''
            }
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={isSaving}>
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
