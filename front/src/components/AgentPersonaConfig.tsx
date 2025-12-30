/**
 * Agent 人设配置组件
 * 包含语音配置、自驱思考、记忆触发三个子功能
 */

import React, { useState } from 'react';
import { 
  Volume2, Brain, Sparkles, Plus, Trash2, 
  Clock, Tag, AlertCircle, MessageSquare
} from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Switch } from './ui/Switch';
import { Badge } from './ui/PageLayout';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from './ui/Select';
import { toast } from './ui/use-toast';

// ============================================================================
// 类型定义
// ============================================================================

/** 语音人设配置 */
export interface VoicePersonaConfig {
  enabled: boolean;
  provider: 'openai' | 'elevenlabs' | 'azure' | 'local';
  voiceId: string;
  voiceName: string;
  language: string;
  speed?: number;
  pitch?: number;
}

/** 自驱思考配置 */
export interface AutonomousThinkingConfig {
  enabled: boolean;
  interval: number; // 毫秒
  topics: string[];
  memoryTriggered: boolean;
}

/** 记忆触发规则 */
export interface MemoryTriggerRule {
  id: string;
  name: string;
  type: 'importance' | 'recent' | 'keyword';
  keywords?: string[];
  threshold?: number;
  withinHours?: number;
  action: string;
  cooldown: number; // 毫秒
  enabled: boolean;
}

/** 响应模式 */
export type ResponseMode = 'normal' | 'persona';

/** Agent 人设完整配置 */
export interface AgentPersonaFullConfig {
  voice: VoicePersonaConfig;
  thinking: AutonomousThinkingConfig;
  memoryTriggers: MemoryTriggerRule[];
  responseMode: ResponseMode; // 响应模式：normal=普通聊天（立刻响应），persona=人格模式（思考是否响应）
}

interface AgentPersonaConfigProps {
  config: AgentPersonaFullConfig;
  onChange: (config: AgentPersonaFullConfig) => void;
  compact?: boolean;
}

// ============================================================================
// 默认配置
// ============================================================================

export const defaultPersonaConfig: AgentPersonaFullConfig = {
  voice: {
    enabled: false,
    provider: 'openai',
    voiceId: 'alloy',
    voiceName: 'Alloy',
    language: 'zh-CN',
    speed: 1.0,
    pitch: 1.0,
  },
  thinking: {
    enabled: false,
    interval: 3600000, // 1小时
    topics: [],
    memoryTriggered: false,
  },
  memoryTriggers: [],
  responseMode: 'normal', // 默认普通聊天模式
};

// ============================================================================
// 预设选项
// ============================================================================

const VOICE_PROVIDERS = [
  { value: 'openai', label: 'OpenAI TTS', voices: [
    { id: 'alloy', name: 'Alloy (中性)' },
    { id: 'echo', name: 'Echo (男声)' },
    { id: 'fable', name: 'Fable (英式)' },
    { id: 'onyx', name: 'Onyx (低沉男声)' },
    { id: 'nova', name: 'Nova (女声)' },
    { id: 'shimmer', name: 'Shimmer (柔和女声)' },
  ]},
  { value: 'elevenlabs', label: 'ElevenLabs', voices: [
    { id: 'rachel', name: 'Rachel' },
    { id: 'adam', name: 'Adam' },
    { id: 'antoni', name: 'Antoni' },
  ]},
  { value: 'azure', label: 'Azure TTS', voices: [
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (女声)' },
    { id: 'zh-CN-YunxiNeural', name: '云希 (男声)' },
    { id: 'zh-CN-YunyangNeural', name: '云扬 (新闻)' },
  ]},
];

const LANGUAGES = [
  { value: 'zh-CN', label: '中文 (简体)' },
  { value: 'zh-TW', label: '中文 (繁体)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
];

const THINKING_INTERVALS = [
  { value: 1800000, label: '30 分钟' },
  { value: 3600000, label: '1 小时' },
  { value: 7200000, label: '2 小时' },
  { value: 14400000, label: '4 小时' },
  { value: 86400000, label: '1 天' },
];

const TRIGGER_COOLDOWNS = [
  { value: 300000, label: '5 分钟' },
  { value: 900000, label: '15 分钟' },
  { value: 1800000, label: '30 分钟' },
  { value: 3600000, label: '1 小时' },
];

// ============================================================================
// 语音配置面板
// ============================================================================

interface VoiceConfigPanelProps {
  config: VoicePersonaConfig;
  onChange: (config: VoicePersonaConfig) => void;
}

const VoiceConfigPanel: React.FC<VoiceConfigPanelProps> = ({ config, onChange }) => {
  const currentProvider = VOICE_PROVIDERS.find(p => p.value === config.provider);
  const voices = currentProvider?.voices || [];

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-medium">语音配置</span>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => onChange({ ...config, enabled })}
        />
      </div>
      {config.enabled && (
        <div className="space-y-4 p-3">
          {/* TTS 提供者 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>TTS 提供者</Label>
              <Select
                value={config.provider}
                onValueChange={(provider: any) => {
                  const newProvider = VOICE_PROVIDERS.find(p => p.value === provider);
                  const defaultVoice = newProvider?.voices[0];
                  onChange({
                    ...config,
                    provider,
                    voiceId: defaultVoice?.id || '',
                    voiceName: defaultVoice?.name || '',
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_PROVIDERS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>语音角色</Label>
              <Select
                value={config.voiceId}
                onValueChange={(voiceId) => {
                  const voice = voices.find(v => v.id === voiceId);
                  onChange({
                    ...config,
                    voiceId,
                    voiceName: voice?.name || voiceId,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {voices.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 语言和速度 */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>语言</Label>
              <Select
                value={config.language}
                onValueChange={(language) => onChange({ ...config, language })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map(l => (
                    <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>语速 ({config.speed?.toFixed(1)}x)</Label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={config.speed || 1.0}
                onChange={(e) => onChange({ ...config, speed: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 mt-2"
              />
            </div>
            <div>
              <Label>音调 ({config.pitch?.toFixed(1)}x)</Label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={config.pitch || 1.0}
                onChange={(e) => onChange({ ...config, pitch: parseFloat(e.target.value) })}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 mt-2"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 自驱思考配置面板
// ============================================================================

interface ThinkingConfigPanelProps {
  config: AutonomousThinkingConfig;
  onChange: (config: AutonomousThinkingConfig) => void;
}

const ThinkingConfigPanel: React.FC<ThinkingConfigPanelProps> = ({ config, onChange }) => {
  const [newTopic, setNewTopic] = useState('');

  const addTopic = () => {
    if (!newTopic.trim()) return;
    if (config.topics.includes(newTopic.trim())) {
      toast({ title: '主题已存在', variant: 'destructive' });
      return;
    }
    onChange({
      ...config,
      topics: [...config.topics, newTopic.trim()],
    });
    setNewTopic('');
  };

  const removeTopic = (topic: string) => {
    onChange({
      ...config,
      topics: config.topics.filter(t => t !== topic),
    });
  };

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-500" />
          <span className="text-sm font-medium">自驱思考</span>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => onChange({ ...config, enabled })}
        />
      </div>
      {config.enabled && (
        <div className="space-y-4 p-3">
          {/* 思考间隔 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                思考间隔
              </Label>
              <Select
                value={config.interval.toString()}
                onValueChange={(v) => onChange({ ...config, interval: parseInt(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_INTERVALS.map(i => (
                    <SelectItem key={i.value} value={i.value.toString()}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <div className="flex items-center gap-2">
                <Switch
                  checked={config.memoryTriggered}
                  onCheckedChange={(memoryTriggered) => onChange({ ...config, memoryTriggered })}
                />
                <Label className="text-sm">记忆触发思考</Label>
              </div>
            </div>
          </div>

          {/* 思考主题 */}
          <div>
            <Label className="flex items-center gap-1 mb-2">
              <Tag className="w-3 h-3" />
              思考主题
            </Label>
            <div className="flex gap-2 mb-2">
              <Input
                placeholder="添加主题..."
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTopic()}
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={addTopic}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {config.topics.map(topic => (
                <Badge key={topic} variant="info" className="flex items-center gap-1">
                  {topic}
                  <button onClick={() => removeTopic(topic)} className="hover:text-red-500">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
              {config.topics.length === 0 && (
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  添加 Agent 会自主思考的话题
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 记忆触发配置面板
// ============================================================================

interface MemoryTriggerPanelProps {
  rules: MemoryTriggerRule[];
  onChange: (rules: MemoryTriggerRule[]) => void;
}

const MemoryTriggerPanel: React.FC<MemoryTriggerPanelProps> = ({ rules, onChange }) => {
  const [showAddRule, setShowAddRule] = useState(false);
  const [newRule, setNewRule] = useState<Partial<MemoryTriggerRule>>({
    type: 'keyword',
    keywords: [],
    threshold: 0.8,
    withinHours: 1,
    action: 'notify',
    cooldown: 900000,
    enabled: true,
  });
  const [keywordInput, setKeywordInput] = useState('');

  const addRule = () => {
    if (!newRule.name?.trim()) {
      toast({ title: '请输入规则名称', variant: 'destructive' });
      return;
    }
    
    const rule: MemoryTriggerRule = {
      id: `rule_${Date.now()}`,
      name: newRule.name!,
      type: newRule.type || 'keyword',
      keywords: newRule.keywords,
      threshold: newRule.threshold,
      withinHours: newRule.withinHours,
      action: newRule.action || 'notify',
      cooldown: newRule.cooldown || 900000,
      enabled: true,
    };
    
    onChange([...rules, rule]);
    setShowAddRule(false);
    setNewRule({
      type: 'keyword',
      keywords: [],
      threshold: 0.8,
      withinHours: 1,
      action: 'notify',
      cooldown: 900000,
      enabled: true,
    });
  };

  const removeRule = (id: string) => {
    onChange(rules.filter(r => r.id !== id));
  };

  const toggleRule = (id: string) => {
    onChange(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-yellow-500" />
          <span className="text-sm font-medium">记忆触发</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowAddRule(true)}>
          <Plus className="w-4 h-4 mr-1" />
          添加规则
        </Button>
      </div>
      <div className="space-y-2 p-3">
        {rules.length === 0 ? (
          <div className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">
            <AlertCircle className="w-5 h-5 mx-auto mb-2 opacity-50" />
            暂无触发规则，添加规则让 Agent 根据记忆自动执行动作
          </div>
        ) : (
          rules.map(rule => (
            <div 
              key={rule.id}
              className={`flex items-center justify-between p-2 rounded-lg border ${
                rule.enabled 
                  ? 'bg-[var(--color-bg-secondary)] border-[var(--color-border)]' 
                  : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-60'
              }`}
            >
              <div className="flex items-center gap-2">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={() => toggleRule(rule.id)}
                />
                <div>
                  <div className="text-sm font-medium">{rule.name}</div>
                  <div className="text-xs text-[var(--color-text-tertiary)]">
                    {rule.type === 'keyword' && `关键词: ${rule.keywords?.join(', ')}`}
                    {rule.type === 'importance' && `重要度 ≥ ${rule.threshold}`}
                    {rule.type === 'recent' && `${rule.withinHours}小时内`}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeRule(rule.id)}>
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
            </div>
          ))
        )}

        {/* 添加规则表单 */}
        {showAddRule && (
          <div className="p-3 border border-dashed border-[var(--color-border)] rounded-lg space-y-3">
            <div>
              <Label>规则名称</Label>
              <Input
                placeholder="如：重要消息提醒"
                value={newRule.name || ''}
                onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>触发类型</Label>
                <Select
                  value={newRule.type}
                  onValueChange={(type: any) => setNewRule({ ...newRule, type })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keyword">关键词匹配</SelectItem>
                    <SelectItem value="importance">重要度阈值</SelectItem>
                    <SelectItem value="recent">近期记忆</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>冷却时间</Label>
                <Select
                  value={newRule.cooldown?.toString()}
                  onValueChange={(v) => setNewRule({ ...newRule, cooldown: parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_COOLDOWNS.map(c => (
                      <SelectItem key={c.value} value={c.value.toString()}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* 类型特定配置 */}
            {newRule.type === 'keyword' && (
              <div>
                <Label>关键词（逗号分隔）</Label>
                <Input
                  placeholder="重要, 紧急, 提醒"
                  value={keywordInput}
                  onChange={(e) => {
                    setKeywordInput(e.target.value);
                    setNewRule({
                      ...newRule,
                      keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean),
                    });
                  }}
                />
              </div>
            )}
            {newRule.type === 'importance' && (
              <div>
                <Label>重要度阈值 ({newRule.threshold})</Label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={newRule.threshold}
                  onChange={(e) => setNewRule({ ...newRule, threshold: parseFloat(e.target.value) })}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                />
              </div>
            )}
            {newRule.type === 'recent' && (
              <div>
                <Label>时间范围（小时）</Label>
                <Input
                  type="number"
                  min="1"
                  max="24"
                  value={newRule.withinHours}
                  onChange={(e) => setNewRule({ ...newRule, withinHours: parseInt(e.target.value) })}
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowAddRule(false)}>
                取消
              </Button>
              <Button variant="primary" size="sm" onClick={addRule}>
                添加
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 主组件
// ============================================================================

// ============================================================================
// 响应模式配置面板
// ============================================================================

interface ResponseModePanelProps {
  responseMode: ResponseMode;
  onChange: (mode: ResponseMode) => void;
}

const ResponseModePanel: React.FC<ResponseModePanelProps> = ({ responseMode, onChange }) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-gray-500" />
        <Label className="text-sm font-medium">响应模式</Label>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="radio"
            id="response-mode-normal"
            name="responseMode"
            value="normal"
            checked={responseMode === 'normal'}
            onChange={(e) => onChange(e.target.value as ResponseMode)}
            className="w-4 h-4 text-primary-600 focus:ring-primary-500"
          />
          <Label htmlFor="response-mode-normal" className="cursor-pointer font-normal">
            <div className="font-medium">普通聊天</div>
            <div className="text-xs text-gray-500">立刻响应消息并发送回答，就像之前的聊天</div>
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="radio"
            id="response-mode-persona"
            name="responseMode"
            value="persona"
            checked={responseMode === 'persona'}
            onChange={(e) => onChange(e.target.value as ResponseMode)}
            className="w-4 h-4 text-primary-600 focus:ring-primary-500"
          />
          <Label htmlFor="response-mode-persona" className="cursor-pointer font-normal">
            <div className="font-medium">人格模式</div>
            <div className="text-xs text-gray-500">会思考是否要响应，根据角色和能力判断是否参与</div>
          </Label>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 主组件
// ============================================================================

const AgentPersonaConfig: React.FC<AgentPersonaConfigProps> = ({
  config,
  onChange,
  compact = false,
}) => {
  return (
    <div className={`space-y-4 ${compact ? '' : 'p-4'}`}>
      {/* 响应模式配置 */}
      <ResponseModePanel
        responseMode={config.responseMode}
        onChange={(responseMode) => onChange({ ...config, responseMode })}
      />

      {/* 语音配置 */}
      <VoiceConfigPanel
        config={config.voice}
        onChange={(voice) => onChange({ ...config, voice })}
      />

      {/* 自驱思考 */}
      <ThinkingConfigPanel
        config={config.thinking}
        onChange={(thinking) => onChange({ ...config, thinking })}
      />

      {/* 记忆触发 */}
      <MemoryTriggerPanel
        rules={config.memoryTriggers}
        onChange={(memoryTriggers) => onChange({ ...config, memoryTriggers })}
      />
    </div>
  );
};

export default AgentPersonaConfig;
