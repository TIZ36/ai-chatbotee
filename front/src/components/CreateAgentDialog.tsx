/**
 * 创建智能体对话框
 * 两个 Tab：基础设置（头像/昵称/人设/LLM）、高级设置（Persona配置）
 */

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader, Bot, User, Sliders, Upload, Wand2, Send, Image as ImageIcon } from 'lucide-react';
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
import { createRole } from '../services/roleApi';
import { getLLMConfigs, type LLMConfigFromDB } from '../services/llmApi';
import { emitSessionsChanged } from '../utils/sessionEvents';
import { getBackendUrl } from '../utils/backendUrl';

type TabType = 'basic' | 'advanced';

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const CreateAgentDialog: React.FC<CreateAgentDialogProps> = ({
  open,
  onOpenChange,
  onSaved,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const [personaConfig, setPersonaConfig] = useState<AgentPersonaFullConfig>(defaultPersonaConfig);
  const [isSaving, setIsSaving] = useState(false);
  
  // 基础设置字段
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [llmConfigId, setLlmConfigId] = useState<string>('');
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  
  // AI 头像生成
  const [avatarDesc, setAvatarDesc] = useState('');
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [avatarModelId, setAvatarModelId] = useState<string>('');
  
  // 人设优化
  const [refinePrompt, setRefinePrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [refineModelId, setRefineModelId] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载 LLM 配置
  useEffect(() => {
    if (open) {
      getLLMConfigs().then(configs => {
        const enabledConfigs = configs.filter(c => c.enabled);
        setLlmConfigs(enabledConfigs);
        
        // 选择默认配置
        const defaultConfig = configs.find(c => c.is_default && c.enabled) || configs.find(c => c.enabled);
        if (defaultConfig) {
          setLlmConfigId(defaultConfig.config_id);
        }
        
        // 头像生成模型：只选择 Gemini
        const imageGenConfigs = enabledConfigs.filter(c => c.provider === 'gemini');
        if (imageGenConfigs.length > 0) {
          setAvatarModelId(imageGenConfigs[0].config_id);
        }
        
        // 人设优化模型：选择默认或第一个
        if (defaultConfig) {
          setRefineModelId(defaultConfig.config_id);
        }
      }).catch(console.error);
    }
  }, [open]);

  // 重置表单
  useEffect(() => {
    if (!open) {
      // 延迟重置以避免关闭动画期间看到闪烁
      const timer = setTimeout(() => {
        setActiveTab('basic');
        setName('');
        setAvatar(null);
        setSystemPrompt('');
        setAvatarDesc('');
        setRefinePrompt('');
        setPersonaConfig(defaultPersonaConfig);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

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
      setAvatar(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // AI 生成头像
  const handleGenerateAvatar = async () => {
    if (!avatarDesc.trim()) {
      toast({ title: '请输入头像描述', variant: 'destructive' });
      return;
    }

    if (!avatarModelId) {
      toast({ title: '请选择生图模型', variant: 'destructive' });
      return;
    }

    setIsGeneratingAvatar(true);
    try {
      // 调用后端生成头像接口
      const response = await fetch(`${getBackendUrl()}/api/llm/generate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: avatarModelId,
          name: name || '智能体',
          description: avatarDesc
        })
      });

      const data = await response.json();
      
      if (data.success && data.avatar) {
        setAvatar(data.avatar);
        toast({ title: '头像已生成', variant: 'success' });
      } else {
        throw new Error(data.error || '生成失败');
      }
    } catch (error: any) {
      toast({ 
        title: '头像生成失败', 
        description: error.message || '请稍后重试', 
        variant: 'destructive'
      });
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  // 人设优化/扩写
  const handleRefineSystemPrompt = async () => {
    if (!refinePrompt.trim()) {
      toast({ title: '请输入优化指令', variant: 'destructive' });
      return;
    }

    if (!refineModelId) {
      toast({ title: '请选择优化模型', variant: 'destructive' });
      return;
    }

    setIsRefining(true);
    try {
      // 调用后端优化人设接口
      const response = await fetch(`${getBackendUrl()}/api/llm/refine-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: refineModelId,
          current_prompt: systemPrompt,
          instruction: refinePrompt
        })
      });

      const data = await response.json();
      
      if (data.success && data.refined_prompt) {
        setSystemPrompt(data.refined_prompt);
        setRefinePrompt('');
        toast({ title: '人设已优化', variant: 'success' });
      } else {
        throw new Error(data.error || '优化失败');
      }
    } catch (error: any) {
      toast({ 
        title: '优化失败', 
        description: error.message || '请稍后重试', 
        variant: 'destructive' 
      });
    } finally {
      setIsRefining(false);
    }
  };

  // 创建智能体
  const handleCreate = async () => {
    // 验证必填字段
    if (!name.trim()) {
      toast({ title: '请输入昵称', variant: 'destructive' });
      setActiveTab('basic');
      return;
    }

    if (!llmConfigId) {
      toast({ title: '请选择默认模型', variant: 'destructive' });
      setActiveTab('basic');
      return;
    }

    setIsSaving(true);
    try {
      await createRole({
        name: name.trim(),
        avatar: avatar || '',
        system_prompt: systemPrompt.trim(),
        llm_config_id: llmConfigId,
        persona: personaConfig,
      });
      
      toast({ 
        title: '智能体已创建', 
        description: `「${name.trim()}」已添加到智能体列表`,
        variant: 'success' 
      });
      
      emitSessionsChanged();
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error('[CreateAgentDialog] Create failed:', error);
      toast({
        title: '创建失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 统计已启用的 Persona 功能
  const enabledFeatures: string[] = [];
  if (personaConfig.responseMode === 'persona') enabledFeatures.push('人格模式');
  if (personaConfig.voice.enabled) enabledFeatures.push('语音');
  if (personaConfig.thinking.enabled) enabledFeatures.push('自驱思考');
  if (personaConfig.memoryTriggers.length > 0) enabledFeatures.push(`${personaConfig.memoryTriggers.length}条触发`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col [data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 [data-skin='niho']:text-[var(--text-primary)]">
            <Sparkles className="w-5 h-5 [data-skin='niho']:text-[var(--color-accent)]" />
            创建智能体
          </DialogTitle>
          <DialogDescription className="[data-skin='niho']:text-[var(--niho-skyblue-gray)]">
            创建一个具有独特人设和能力的 AI 智能体
          </DialogDescription>
        </DialogHeader>

        {/* Tab 切换 - Niho 主题 */}
        <div className="flex border-b border-gray-200 dark:border-[#404040] [data-skin='niho']:border-[var(--niho-text-border)]">
          <button
            onClick={() => setActiveTab('basic')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'basic'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400 [data-skin="niho"]:border-[var(--color-accent)] [data-skin="niho"]:text-[var(--color-accent)]'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 [data-skin="niho"]:text-[var(--niho-skyblue-gray)] [data-skin="niho"]:hover:text-[var(--text-primary)]'
            }`}
          >
            <User className="w-4 h-4" />
            基础设置
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'advanced'
                ? 'border-primary-500 text-primary-600 dark:text-primary-400 [data-skin="niho"]:border-[var(--color-accent)] [data-skin="niho"]:text-[var(--color-accent)]'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 [data-skin="niho"]:text-[var(--niho-skyblue-gray)] [data-skin="niho"]:hover:text-[var(--text-primary)]'
            }`}
          >
            <Sliders className="w-4 h-4" />
            高级设置
            {enabledFeatures.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded [data-skin='niho']:bg-[var(--color-accent-bg)] [data-skin='niho']:text-[var(--color-accent)] [data-skin='niho']:border [data-skin='niho']:border-[var(--color-accent-bg)]">
                {enabledFeatures.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab 内容 */}
        <div className="flex-1 overflow-y-auto py-4">
          {activeTab === 'basic' ? (
            <div className="space-y-5 px-1">
              {/* 头像 */}
              <div>
                <Label className="text-sm font-medium mb-2 block [data-skin='niho']:text-[var(--text-primary)]">头像</Label>
                <div className="flex items-start gap-4">
                  {/* 头像预览 */}
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 border-2 border-gray-200 dark:border-[#404040] flex items-center justify-center flex-shrink-0 [data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)]">
                    {avatar ? (
                      <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      <Bot className="w-10 h-10 text-gray-400 dark:text-gray-600 [data-skin='niho']:text-[var(--color-accent)]" />
                    )}
                  </div>

                  {/* 上传/生成操作 */}
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-8 [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:bg-transparent [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:hover:bg-[var(--color-accent-bg)] [data-skin='niho']:hover:border-[var(--color-accent-bg)] [data-skin='niho']:hover:text-[var(--color-accent)]"
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                        上传图片
                      </Button>
                      {avatar && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAvatar(null)}
                          className="h-8 text-red-600 hover:text-red-700 dark:text-red-400 [data-skin='niho']:text-[var(--color-secondary)] [data-skin='niho']:hover:text-[var(--color-secondary-hover)] [data-skin='niho']:hover:bg-[var(--color-secondary-bg)]"
                        >
                          清除
                        </Button>
                      )}
                    </div>

                    {/* AI 生成头像 */}
                    <div className="space-y-2">
                      <Label className="text-xs font-medium [data-skin='niho']:text-[var(--text-primary)]">生图模型</Label>
                      <Select value={avatarModelId} onValueChange={setAvatarModelId}>
                        <SelectTrigger className="h-8 text-xs [data-skin='niho']:bg-[var(--niho-pure-black-elevated)] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:focus:border-[var(--color-accent-bg)]">
                          <SelectValue placeholder="选择生图模型" />
                        </SelectTrigger>
                        <SelectContent className="[data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)]">
                          {llmConfigs.filter(c => c.provider === 'gemini').map(config => (
                            <SelectItem 
                              key={config.config_id} 
                              value={config.config_id}
                              className="[data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:hover:bg-[var(--color-accent-bg)] [data-skin='niho']:focus:bg-[var(--color-accent-bg)]"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{config.name}</span>
                                <span className="text-[10px] opacity-50 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded [data-skin='niho']:bg-[var(--niho-text-bg)] [data-skin='niho']:text-[var(--niho-skyblue-gray)]">
                                  {config.provider} · {config.model}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="flex gap-2">
                        <Input
                          placeholder="描述头像特征（如：年轻女性、科技感、蓝色调）"
                          value={avatarDesc}
                          onChange={(e) => setAvatarDesc(e.target.value)}
                          className="flex-1 h-8 text-xs [data-skin='niho']:bg-[var(--niho-pure-black-elevated)] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:placeholder:text-[var(--niho-skyblue-gray)] [data-skin='niho']:focus:border-[var(--color-accent-bg)]"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isGeneratingAvatar) {
                              e.preventDefault();
                              handleGenerateAvatar();
                            }
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleGenerateAvatar}
                          disabled={isGeneratingAvatar || !avatarDesc.trim() || !avatarModelId}
                          className="h-8 [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:bg-transparent [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:hover:bg-[var(--color-accent-bg)] [data-skin='niho']:hover:border-[var(--color-accent-bg)] [data-skin='niho']:hover:text-[var(--color-accent)]"
                        >
                          {isGeneratingAvatar ? (
                            <Loader className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ImageIcon className="w-3.5 h-3.5" />
                          )}
                          <span className="ml-1.5">AI 生成</span>
                        </Button>
                      </div>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 [data-skin='niho']:text-[var(--niho-skyblue-gray)]">
                        支持上传图片或使用 AI 根据描述生成头像
                      </p>
                    </div>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </div>
              </div>

              {/* 昵称 */}
              <div>
                <Label htmlFor="agent-name" className="text-sm font-medium mb-2 block [data-skin='niho']:text-[var(--text-primary)]">
                  昵称 <span className="text-red-500 [data-skin='niho']:text-[var(--color-secondary)]">*</span>
                </Label>
                <Input
                  id="agent-name"
                  placeholder="给智能体起个名字"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full [data-skin='niho']:bg-[var(--niho-pure-black-elevated)] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:placeholder:text-[var(--niho-skyblue-gray)] [data-skin='niho']:focus:border-[var(--color-accent-bg)] [data-skin='niho']:focus:ring-[var(--color-accent-bg)]"
                />
              </div>

              {/* 默认模型 */}
              <div>
                <Label htmlFor="agent-llm" className="text-sm font-medium mb-2 block [data-skin='niho']:text-[var(--text-primary)]">
                  默认模型 <span className="text-red-500 [data-skin='niho']:text-[var(--color-secondary)]">*</span>
                </Label>
                <Select value={llmConfigId} onValueChange={setLlmConfigId}>
                  <SelectTrigger id="agent-llm" className="w-full [data-skin='niho']:bg-[var(--niho-pure-black-elevated)] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:focus:border-[var(--color-accent-bg)]">
                    <SelectValue placeholder="选择默认模型配置" />
                  </SelectTrigger>
                  <SelectContent className="[data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)]">
                    {llmConfigs.map(config => (
                      <SelectItem 
                        key={config.config_id} 
                        value={config.config_id}
                        className="[data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:hover:bg-[var(--color-accent-bg)] [data-skin='niho']:focus:bg-[var(--color-accent-bg)]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{config.name}</span>
                          <span className="text-[10px] opacity-50 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded [data-skin='niho']:bg-[var(--niho-text-bg)] [data-skin='niho']:text-[var(--niho-skyblue-gray)]">
                            {config.provider} · {config.model}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 人设（System Prompt） */}
              <div>
                <Label htmlFor="agent-prompt" className="text-sm font-medium mb-2 block [data-skin='niho']:text-[var(--text-primary)]">
                  人设 / System Prompt
                </Label>
                <Textarea
                  id="agent-prompt"
                  placeholder="定义角色的性格、说话方式、知识背景等...&#10;示例：你是一个专业的编程导师，擅长用简洁的语言解释复杂概念，对新手友好且有耐心。"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="min-h-[140px] resize-none w-full [data-skin='niho']:bg-[var(--niho-pure-black-elevated)] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:placeholder:text-[var(--niho-skyblue-gray)] [data-skin='niho']:focus:border-[var(--color-accent-bg)] [data-skin='niho']:focus:ring-[var(--color-accent-bg)]"
                />

                {/* 人设优化/扩写输入框 */}
                <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-[#404040] [data-skin='niho']:bg-[var(--niho-pure-black-elevated)] [data-skin='niho']:border-[var(--niho-text-border)]">
                  <div className="flex items-center gap-2 mb-2">
                    <Wand2 className="w-3.5 h-3.5 text-primary-500 [data-skin='niho']:text-[var(--color-accent)]" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300 [data-skin='niho']:text-[var(--text-primary)]">
                      人设优化助手
                    </span>
                  </div>
                  
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs font-medium [data-skin='niho']:text-[var(--text-primary)]">优化模型</Label>
                      <Select value={refineModelId} onValueChange={setRefineModelId}>
                        <SelectTrigger className="h-8 text-xs bg-white dark:bg-gray-900 [data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:focus:border-[var(--color-accent-bg)]">
                          <SelectValue placeholder="选择优化模型" />
                        </SelectTrigger>
                        <SelectContent className="[data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)]">
                          {llmConfigs.map(config => (
                            <SelectItem 
                              key={config.config_id} 
                              value={config.config_id}
                              className="[data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:hover:bg-[var(--color-accent-bg)] [data-skin='niho']:focus:bg-[var(--color-accent-bg)]"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{config.name}</span>
                                <span className="text-[10px] opacity-50 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded [data-skin='niho']:bg-[var(--niho-text-bg)] [data-skin='niho']:text-[var(--niho-skyblue-gray)]">
                                  {config.provider} · {config.model}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex gap-2">
                      <Input
                        placeholder="输入优化需求，如：让角色更幽默、扩写细节、调整语气为专业..."
                        value={refinePrompt}
                        onChange={(e) => setRefinePrompt(e.target.value)}
                        className="flex-1 h-9 text-sm bg-white dark:bg-gray-900 [data-skin='niho']:bg-[#000000] [data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:placeholder:text-[var(--niho-skyblue-gray)] [data-skin='niho']:focus:border-[var(--color-accent-bg)]"
                        disabled={isRefining}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isRefining && !e.shiftKey) {
                            e.preventDefault();
                            handleRefineSystemPrompt();
                          }
                        }}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleRefineSystemPrompt}
                        disabled={isRefining || !refinePrompt.trim() || !refineModelId}
                        className="h-9 [data-skin='niho']:bg-[var(--color-accent)] [data-skin='niho']:text-[#000000] [data-skin='niho']:hover:bg-[var(--color-accent-hover)] [data-skin='niho']:shadow-[0_0_12px_rgba(0,255,136,0.3)] [data-skin='niho']:disabled:opacity-50"
                      >
                        {isRefining ? (
                          <Loader className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2 [data-skin='niho']:text-[var(--niho-skyblue-gray)]">
                    使用选择的模型对上方人设进行扩写、润色或优化
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-1">
              <AgentPersonaConfig
                config={personaConfig}
                onChange={setPersonaConfig}
              />
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-gray-200 dark:border-[#404040] pt-4 [data-skin='niho']:border-[var(--niho-text-border)]">
          <Button 
            variant="secondary" 
            onClick={() => onOpenChange(false)}
            className="[data-skin='niho']:border-[var(--niho-text-border)] [data-skin='niho']:bg-transparent [data-skin='niho']:text-[var(--text-primary)] [data-skin='niho']:hover:bg-[var(--niho-text-bg)]"
          >
            取消
          </Button>
          <Button 
            variant="primary" 
            onClick={handleCreate}
            disabled={isSaving || !name.trim() || !llmConfigId}
            className="[data-skin='niho']:bg-[var(--color-accent)] [data-skin='niho']:text-[#000000] [data-skin='niho']:hover:bg-[var(--color-accent-hover)] [data-skin='niho']:shadow-[0_0_12px_rgba(0,255,136,0.3)] [data-skin='niho']:disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader className="w-4 h-4 animate-spin mr-2" />
                创建中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                创建智能体
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateAgentDialog;
