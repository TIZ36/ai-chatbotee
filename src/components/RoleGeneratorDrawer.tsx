import React, { useEffect, useMemo, useState } from 'react';
import { Send, Sparkles, X } from 'lucide-react';

import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { ScrollArea } from './ui/ScrollArea';
import { Textarea } from './ui/Textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { toast } from './ui/use-toast';

import type { Session } from '../services/sessionApi';
import { getSession } from '../services/sessionApi';
import { getLLMConfigApiKey, getLLMConfigs, type LLMConfigFromDB } from '../services/llmApi';
import { LLMClient, type LLMMessage } from '../services/llmClient';
import { updateRoleProfile } from '../services/roleApi';
import { emitSessionsChanged } from '../utils/sessionEvents';

type GeneratorChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type RoleGeneratorResult = {
  assistant_message?: string;
  name?: string;
  system_prompt?: string;
  role?: {
    name?: string;
    system_prompt?: string;
  };
};

function encodeSvgDataUri(svg: string) {
  const toBase64 = (input: string) => {
    try {
      return btoa(unescape(encodeURIComponent(input)));
    } catch {
      return btoa(input);
    }
  };
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

function makeDefaultAvatar(name: string) {
  const label = (name || 'R').trim().slice(0, 2).toUpperCase();
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c3aed" />
      <stop offset="1" stop-color="#06b6d4" />
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="18" fill="url(#g)"/>
  <text x="48" y="56" font-size="34" font-family="ui-sans-serif, system-ui" font-weight="700" text-anchor="middle" fill="#ffffff">${label}</text>
</svg>
`.trim();
  return encodeSvgDataUri(svg);
}

function tryExtractJson(text: string): RoleGeneratorResult {
  const raw = (text || '').trim();
  if (!raw) throw new Error('Empty LLM response');

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] || raw).trim();

  const tryParse = (s: string) => {
    try {
      return JSON.parse(s) as RoleGeneratorResult;
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const sliced = candidate.slice(first, last + 1);
    const parsed = tryParse(sliced);
    if (parsed) return parsed;
  }

  throw new Error('无法解析模型输出（需要严格 JSON）');
}

function buildGeneratorSystemPrompt() {
  return [
    '你是「角色生成器」(Role Generator)。你的目标：把用户的一句话或多轮补充，转化为一个高质量、可直接用于系统提示词的“人设”。',
    '',
    '要求：',
    '- 只输出严格 JSON，不要输出 markdown、代码块、解释性文字。',
    '- 输出必须包含 role.name 与 role.system_prompt（或在顶层 name/system_prompt）。',
    '- system_prompt 需要可执行、可复用：包含角色定位/目标、沟通风格、能力边界、优先级、结构化输出偏好、工具使用原则（如有）、安全与合规边界。',
    '- 如果用户提供了现有草稿，应在其基础上“保留优势 + 修补缺口 + 变得更可用”。',
    '',
    'JSON Schema:',
    '{',
    '  "assistant_message": "给用户的简短提示（可选）",',
    '  "role": {',
    '    "name": "角色名称",',
    '    "system_prompt": "系统提示词全文"',
    '  }',
    '}',
  ].join('\n');
}

export interface RoleGeneratorDrawerProps {
  open: boolean;
  roleId: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenRoleConfig?: (roleId: string) => void;
}

export const RoleGeneratorDrawer: React.FC<RoleGeneratorDrawerProps> = ({
  open,
  roleId,
  onOpenChange,
  onOpenRoleConfig,
}) => {
  const [role, setRole] = useState<Session | null>(null);
  const [isLoadingRole, setIsLoadingRole] = useState(false);

  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [isLoadingLlmConfigs, setIsLoadingLlmConfigs] = useState(false);
  const enabledConfigs = useMemo(() => llmConfigs.filter((c) => c.enabled), [llmConfigs]);

  const [selectedGeneratorLlmConfigId, setSelectedGeneratorLlmConfigId] = useState<string>('');

  const [oneLiner, setOneLiner] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chat, setChat] = useState<GeneratorChatMessage[]>([]);

  const [draftName, setDraftName] = useState('');
  const [draftSystemPrompt, setDraftSystemPrompt] = useState('');
  const [draftAvatar, setDraftAvatar] = useState<string>('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    (async () => {
      try {
        setIsLoadingLlmConfigs(true);
        const configs = await getLLMConfigs();
        if (canceled) return;
        setLlmConfigs(configs);
      } catch (error) {
        console.error('[RoleGeneratorDrawer] Failed to load LLM configs:', error);
        if (!canceled) setLlmConfigs([]);
      } finally {
        if (!canceled) setIsLoadingLlmConfigs(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !roleId) return;
    let canceled = false;
    (async () => {
      try {
        setIsLoadingRole(true);
        const s = await getSession(roleId);
        if (canceled) return;
        setRole(s);
        setDraftName(s.name || s.title || '');
        setDraftSystemPrompt(s.system_prompt || '');
        setDraftAvatar(s.avatar || '');
      } catch (error) {
        console.error('[RoleGeneratorDrawer] Failed to load role:', error);
        if (!canceled) setRole(null);
      } finally {
        if (!canceled) setIsLoadingRole(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [open, roleId]);

  useEffect(() => {
    if (!open) return;
    if (selectedGeneratorLlmConfigId) return;
    const preferred =
      role?.llm_config_id ||
      enabledConfigs[0]?.config_id ||
      llmConfigs[0]?.config_id ||
      '';
    if (preferred) setSelectedGeneratorLlmConfigId(preferred);
  }, [open, role?.llm_config_id, enabledConfigs, llmConfigs, selectedGeneratorLlmConfigId]);

  const selectedGeneratorConfig = useMemo(
    () => llmConfigs.find((c) => c.config_id === selectedGeneratorLlmConfigId) || null,
    [llmConfigs, selectedGeneratorLlmConfigId],
  );

  const canGenerate = Boolean(selectedGeneratorConfig?.config_id) && !isGenerating;
  const canSave = Boolean(roleId) && Boolean(draftSystemPrompt.trim()) && Boolean(selectedGeneratorLlmConfigId) && !isSaving;

  const pushChat = (msg: Omit<GeneratorChatMessage, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setChat((prev) => [...prev, { ...msg, id }]);
  };

  const runGenerate = async (userText: string) => {
    if (!selectedGeneratorConfig) {
      toast({ title: '请先选择生成器使用的 LLM', variant: 'destructive' });
      return;
    }
    const input = userText.trim();
    if (!input) return;

    pushChat({ role: 'user', content: input });
    setIsGenerating(true);
    try {
      const apiKey = await getLLMConfigApiKey(selectedGeneratorConfig.config_id);
      if (selectedGeneratorConfig.provider !== 'ollama' && !apiKey) {
        throw new Error('API密钥未配置，请检查生成器的 LLM 配置');
      }

      const llmClient = new LLMClient({
        id: selectedGeneratorConfig.config_id,
        provider: selectedGeneratorConfig.provider,
        name: selectedGeneratorConfig.name,
        apiKey,
        apiUrl: selectedGeneratorConfig.api_url,
        model: selectedGeneratorConfig.model,
        enabled: selectedGeneratorConfig.enabled,
        metadata: selectedGeneratorConfig.metadata,
      });

      const contextPayload = {
        role_id: roleId,
        current_role: {
          name: draftName || role?.name || role?.title || '',
          system_prompt: draftSystemPrompt || role?.system_prompt || '',
        },
        user_input: input,
      };

      const messages: LLMMessage[] = [
        { role: 'system', content: buildGeneratorSystemPrompt() },
        ...chat.map((m) => ({ role: m.role, content: m.content } as LLMMessage)),
        { role: 'user', content: JSON.stringify(contextPayload, null, 2) },
      ];

      const resp = await llmClient.chat(messages, undefined, false);
      const parsed = tryExtractJson(resp.content || '');
      const nextName = (parsed.role?.name || parsed.name || '').trim();
      const nextSystemPrompt = (parsed.role?.system_prompt || parsed.system_prompt || '').trim();
      const assistantMessage = (parsed.assistant_message || '').trim();

      pushChat({
        role: 'assistant',
        content: assistantMessage || resp.content || '(无内容)',
      });

      if (!nextSystemPrompt) {
        throw new Error('模型输出缺少 system_prompt');
      }

      setDraftName(nextName || draftName || role?.name || role?.title || '');
      setDraftSystemPrompt(nextSystemPrompt);
      if (!draftAvatar) {
        const avatarName = nextName || draftName || role?.name || role?.title || 'Role';
        setDraftAvatar(makeDefaultAvatar(avatarName));
      }
    } catch (error) {
      console.error('[RoleGeneratorDrawer] generate error:', error);
      toast({
        title: '生成失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateFromOneLiner = async () => {
    const text = oneLiner.trim();
    if (!text) return;
    setOneLiner('');
    await runGenerate(text);
  };

  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    await runGenerate(text);
  };

  const handleSaveToRole = async () => {
    if (!roleId) return;
    const name = (draftName || role?.name || role?.title || '').trim() || '未命名角色';
    const systemPrompt = draftSystemPrompt.trim();
    const avatar = (draftAvatar || '').trim() || makeDefaultAvatar(name);
    const llmConfigId = selectedGeneratorLlmConfigId;

    if (!systemPrompt || !llmConfigId) return;

    setIsSaving(true);
    try {
      await updateRoleProfile(roleId, {
        name,
        avatar,
        system_prompt: systemPrompt,
        llm_config_id: llmConfigId,
        reason: 'role_generator',
      });
      emitSessionsChanged();
      toast({ title: '已写入角色', variant: 'success' });
      onOpenRoleConfig?.(roleId);
      onOpenChange(false);
    } catch (error) {
      console.error('[RoleGeneratorDrawer] save error:', error);
      toast({
        title: '写入失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const drawerTitle = role?.name || role?.title || (roleId ? `角色 ${roleId.slice(0, 8)}` : '角色生成器');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={[
          'left-auto right-0 top-0 h-[100dvh] w-[560px] max-w-[100vw] translate-x-0 translate-y-0',
          'rounded-none border-l border-borderToken',
          'p-0',
        ].join(' ')}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-borderToken p-4">
            <DialogHeader className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
                <span className="truncate">角色生成器</span>
              </DialogTitle>
              <DialogDescription className="truncate">
                {isLoadingRole ? '加载角色中...' : `写入目标：${drawerTitle}`}
              </DialogDescription>
            </DialogHeader>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} title="关闭">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-foreground">生成器使用的 LLM</div>
                {isLoadingLlmConfigs && <div className="text-xs text-mutedToken-foreground">加载中...</div>}
              </div>
              <Select value={selectedGeneratorLlmConfigId} onValueChange={setSelectedGeneratorLlmConfigId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择一个 LLM 配置" />
                </SelectTrigger>
                <SelectContent>
                  {enabledConfigs.map((c) => (
                    <SelectItem key={c.config_id} value={c.config_id}>
                      {c.name} {c.model ? `· ${c.model}` : ''} {c.provider ? `(${c.provider})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {enabledConfigs.length === 0 && (
                <div className="text-xs text-mutedToken-foreground">
                  没有可用的 LLM 配置（请先在 LLM 配置里启用至少一个）。
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">一句话生成</div>
              <div className="flex items-center gap-2">
                <Input
                  value={oneLiner}
                  onChange={(e) => setOneLiner(e.target.value)}
                  placeholder="例如：一个擅长把 PRD 转成可执行任务列表的产品经理，输出要结构化..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleGenerateFromOneLiner();
                    }
                  }}
                />
                <Button variant="primary" disabled={!canGenerate || !oneLiner.trim()} onClick={handleGenerateFromOneLiner}>
                  生成
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 border-y border-borderToken">
            <div className="p-3 border-b border-borderToken text-sm font-medium">多轮打磨</div>
            <ScrollArea className="h-[calc(100%-52px)]">
              <div className="p-3 space-y-2">
                {chat.length === 0 ? (
                  <div className="text-sm text-mutedToken-foreground">
                    你可以不断补充约束/风格/能力边界，我会迭代优化系统提示词草稿。
                  </div>
                ) : (
                  chat.map((m) => (
                    <div
                      key={m.id}
                      className={[
                        'rounded-md border border-borderToken p-2 text-sm whitespace-pre-wrap',
                        m.role === 'user' ? 'bg-background' : 'bg-mutedToken/50',
                      ].join(' ')}
                    >
                      <div className="mb-1 text-xs text-mutedToken-foreground">
                        {m.role === 'user' ? '你' : '生成器'}
                      </div>
                      {m.content}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="继续补充：目标用户是谁？输出格式？语气？禁止做什么？有什么特殊技能？"
                className="min-h-[72px]"
              />
              <Button
                variant="primary"
                size="icon"
                disabled={!canGenerate || !chatInput.trim()}
                onClick={handleSendChat}
                title="发送"
              >
                {isGenerating ? (
                  <div className="h-4 w-4 border-2 border-white/90 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">草稿（可编辑）</div>
              <div className="grid grid-cols-1 gap-2">
                <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="角色名称" />
                <Textarea
                  value={draftSystemPrompt}
                  onChange={(e) => setDraftSystemPrompt(e.target.value)}
                  placeholder="系统提示词（system prompt）"
                  className="min-h-[160px]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                disabled={!roleId}
                onClick={() => {
                  if (roleId) onOpenRoleConfig?.(roleId);
                  onOpenChange(false);
                }}
              >
                打开配置
              </Button>
              <Button variant="primary" disabled={!canSave} onClick={handleSaveToRole}>
                {isSaving ? '写入中...' : '写入角色'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

