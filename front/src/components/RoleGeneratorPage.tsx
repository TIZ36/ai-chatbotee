/**
 * 角色生成器页面
 * 支持随机抽卡模式和手动模式
 * 左右分栏：左侧配置，右侧预览
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Sparkles, Wand2, Settings, Image as ImageIcon, Check, X, Loader, RefreshCw, Download, Save, ChevronDown, ChevronUp, Bot, Plus, Users, Upload, FileJson } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { Checkbox } from './ui/Checkbox';
import { Label } from './ui/Label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/Dialog';
import { ScrollArea } from './ui/ScrollArea';
import { toast } from './ui/use-toast';
import { getLLMConfigs, getLLMConfigApiKey, getLLMConfig, type LLMConfigFromDB } from '../services/llmApi';
import { LLMClient, type LLMMessage } from '../services/llmClient';
import { createRole, updateRoleProfile } from '../services/roleApi';
import { emitSessionsChanged } from '../utils/sessionEvents';
import { getAgents, getSession, type Session } from '../services/sessionApi';
import { getDimensionOptions, saveDimensionOption } from '../services/roleDimensionApi';
import CrawlerModuleSelector from './CrawlerModuleSelector';
import CrawlerBatchItemSelector from './CrawlerBatchItemSelector';
import { searchModules, getBatch } from '../services/crawlerApi';
import AgentPersonaConfig, { 
  defaultPersonaConfig, 
  type AgentPersonaFullConfig 
} from './AgentPersonaConfig';

type Mode = 'random' | 'manual' | 'import';

// 导出角色的 JSON 格式
export type RoleExportData = {
  version: string; // 格式版本号
  exportedAt: string; // 导出时间
  role: {
    name: string;
    system_prompt: string;
    avatar?: string;
    profession?: string; // 职业分类
    metadata?: Record<string, unknown>; // 额外元数据
  };
};

type RoleDraft = {
  name: string;
  system_prompt: string;
  avatar: string;
  llm_config_id: string;
  persona?: AgentPersonaFullConfig;
};

// 角色类型
type RoleType = 'career' | 'game'; // 职业角色 | 游戏角色

// 维度选择数据结构
type DimensionSelections = {
  roleType: RoleType; // 角色类型
  
  // 职业角色维度
  profession?: string | null;
  gender?: string | null; // 性别
  ageRange?: string | null;
  personality?: string | null;
  background?: string | null;
  conversationStyle?: string[];
  skills?: string[];
  
  // 游戏角色维度
  gameClass?: string | null; // 游戏职业
  gameGender?: string | null; // 游戏角色性别
  race?: string | null; // 种族
  alignment?: string | null; // 阵营
  levelRange?: string | null; // 等级范围
  skillTree?: string[]; // 技能树
  gameConversationStyle?: string[]; // 游戏角色对话风格
  
  // 共同维度
  avatarStyle: string | null;
};

// 维度选项定义
const PROFESSIONS = [
  '产品经理', '工程师', '设计师', '作家', '分析师', '教师', '医生', 
  '咨询师', '创业者', '研究员', '营销专家', '财务顾问', '不限'
];

const GENDERS = [
  '男', '女', '不限'
];

const AGE_RANGES = [
  '青年（20-30）', '中年（30-50）', '老年（50+）', '不限'
];

const PERSONALITIES = [
  '内向', '外向', '理性', '感性', '平衡', '不限'
];

const BACKGROUNDS = [
  '现代', '古代', '未来', '奇幻', '不限'
];

const CONVERSATION_STYLES = [
  '正式', '幽默', '专业', '友好', '严肃', '轻松', '学术', '通俗', '简洁', '详细'
];

const SKILLS = [
  '编程', '设计', '写作', '数据分析', '项目管理', '沟通', '教学', '研究', 
  '创意', '逻辑', '战略', '执行'
];

const AVATAR_STYLES = [
  '卡通', '写实', '抽象', '二次元', '像素风', '水彩', '简约', '复古'
];

// 游戏角色维度选项
const GAME_CLASSES = [
  '战士', '法师', '盗贼', '牧师', '游侠', '术士', '圣骑士', '德鲁伊', '野蛮人', '吟游诗人', '不限'
];

const RACES = [
  '人类', '精灵', '矮人', '兽人', '龙族', '亡灵', '天使', '恶魔', '不限'
];

const ALIGNMENTS = [
  '守序善良', '守序中立', '守序邪恶', '中立善良', '绝对中立', '中立邪恶', 
  '混乱善良', '混乱中立', '混乱邪恶', '不限'
];

const LEVEL_RANGES = [
  '新手（1-10级）', '进阶（11-30级）', '高级（31-50级）', 
  '大师（51-70级）', '传奇（71-90级）', '神话（91-100级）', '不限'
];

const SKILL_TREES = [
  '近战武器', '远程武器', '魔法攻击', '治疗', '防御', '潜行', '召唤', 
  '附魔', '炼金', '锻造', '采集', '交易'
];

const GAME_CONVERSATION_STYLES = [
  '英勇', '神秘', '狡猾', '虔诚', '自然', '狂野', '优雅', '幽默', '严肃', '友好'
];

// 预设组合
const PRESET_COMBINATIONS = [
  {
    name: '专业顾问',
    roleType: 'career' as RoleType,
    selections: {
      roleType: 'career' as RoleType,
      profession: '咨询师',
      gender: '不限',
      ageRange: '中年（30-50）',
      personality: '理性',
      background: '现代',
      conversationStyle: ['专业', '正式'],
      skills: ['沟通', '战略', '分析'],
      avatarStyle: '写实',
    },
  },
  {
    name: '创意设计师',
    roleType: 'career' as RoleType,
    selections: {
      roleType: 'career' as RoleType,
      profession: '设计师',
      gender: '不限',
      ageRange: '青年（20-30）',
      personality: '外向',
      background: '现代',
      conversationStyle: ['轻松', '友好', '创意'],
      skills: ['设计', '创意', '沟通'],
      avatarStyle: '卡通',
    },
  },
  {
    name: '技术专家',
    roleType: 'career' as RoleType,
    selections: {
      roleType: 'career' as RoleType,
      profession: '工程师',
      gender: '不限',
      ageRange: '中年（30-50）',
      personality: '理性',
      background: '现代',
      conversationStyle: ['专业', '简洁'],
      skills: ['编程', '逻辑', '分析'],
      avatarStyle: '简约',
    },
  },
  // 游戏角色预设
  {
    name: '英勇战士',
    roleType: 'game' as RoleType,
    selections: {
      roleType: 'game' as RoleType,
      gameClass: '战士',
      gameGender: '不限',
      race: '人类',
      alignment: '守序善良',
      levelRange: '高级（31-50级）',
      skillTree: ['近战武器', '防御'],
      gameConversationStyle: ['英勇', '严肃'],
      avatarStyle: '写实',
    },
  },
  {
    name: '神秘法师',
    roleType: 'game' as RoleType,
    selections: {
      roleType: 'game' as RoleType,
      gameClass: '法师',
      gameGender: '不限',
      race: '精灵',
      alignment: '中立善良',
      levelRange: '大师（51-70级）',
      skillTree: ['魔法攻击', '附魔'],
      gameConversationStyle: ['神秘', '优雅'],
      avatarStyle: '二次元',
    },
  },
  {
    name: '狡猾盗贼',
    roleType: 'game' as RoleType,
    selections: {
      roleType: 'game' as RoleType,
      gameClass: '盗贼',
      gameGender: '不限',
      race: '矮人',
      alignment: '混乱中立',
      levelRange: '进阶（11-30级）',
      skillTree: ['潜行', '远程武器'],
      gameConversationStyle: ['狡猾', '幽默'],
      avatarStyle: '像素风',
    },
  },
];

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

function tryExtractJson(text: string): { name?: string; system_prompt?: string; role?: { name?: string; system_prompt?: string } } {
  const raw = (text || '').trim();
  if (!raw) throw new Error('Empty LLM response');

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] || raw).trim();

  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
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
    '你是「角色生成器」(Role Generator)。你的目标：把用户的一句话或多轮补充，转化为一个高质量、可直接用于系统提示词的"人设"。',
    '',
    '要求：',
    '- 只输出严格 JSON，不要输出 markdown、代码块、解释性文字。',
    '- 输出必须包含 role.name 与 role.system_prompt（或在顶层 name/system_prompt）。',
    '- system_prompt 需要可执行、可复用：包含角色定位/目标、沟通风格、能力边界、优先级、结构化输出偏好、工具使用原则（如有）、安全与合规边界。',
    '',
    'JSON Schema:',
    '{',
    '  "role": {',
    '    "name": "角色名称",',
    '    "system_prompt": "系统提示词全文"',
    '  }',
    '}',
  ].join('\n');
}

function buildRandomGeneratorSystemPrompt(selections: DimensionSelections): string {
  const constraints: string[] = [];
  
  if (selections.roleType === 'career') {
    // 职业角色约束
    if (selections.profession && selections.profession !== '不限') {
      constraints.push(`职业类型：${selections.profession}`);
    }
    if (selections.gender && selections.gender !== '不限') {
      constraints.push(`性别：${selections.gender}`);
    }
    if (selections.ageRange && selections.ageRange !== '不限') {
      constraints.push(`年龄范围：${selections.ageRange}`);
    }
    if (selections.personality && selections.personality !== '不限') {
      constraints.push(`性格特点：${selections.personality}`);
    }
    if (selections.background && selections.background !== '不限') {
      constraints.push(`背景设定：${selections.background}`);
    }
    if (selections.conversationStyle && selections.conversationStyle.length > 0) {
      constraints.push(`对话风格：${selections.conversationStyle.join('、')}`);
    }
    if (selections.skills && selections.skills.length > 0) {
      constraints.push(`技能专长：${selections.skills.join('、')}`);
    }
  } else if (selections.roleType === 'game') {
    // 游戏角色约束（RPG风格）
    constraints.push('这是一个游戏角色（RPG风格），需要具有游戏角色的特色。');
    if (selections.gameClass && selections.gameClass !== '不限') {
      constraints.push(`职业类型：${selections.gameClass}`);
    }
    if (selections.gameGender && selections.gameGender !== '不限') {
      constraints.push(`性别：${selections.gameGender}`);
    }
    if (selections.race && selections.race !== '不限') {
      constraints.push(`种族：${selections.race}`);
    }
    if (selections.alignment && selections.alignment !== '不限') {
      constraints.push(`阵营：${selections.alignment}`);
    }
    if (selections.levelRange && selections.levelRange !== '不限') {
      constraints.push(`等级范围：${selections.levelRange}`);
    }
    if (selections.skillTree && selections.skillTree.length > 0) {
      constraints.push(`技能树：${selections.skillTree.join('、')}`);
    }
    if (selections.gameConversationStyle && selections.gameConversationStyle.length > 0) {
      constraints.push(`对话风格：${selections.gameConversationStyle.join('、')}`);
    }
  }
  
  const constraintText = constraints.length > 0 
    ? `\n\n约束条件（必须遵循）：\n${constraints.map(c => `- ${c}`).join('\n')}`
    : '';
  
  const roleTypeDescription = selections.roleType === 'career' 
    ? '职业角色人设'
    : '游戏角色人设（RPG风格，具有游戏角色的特色和背景）';
  
  return [
    `你是「随机角色生成器」。你需要根据用户提供的约束条件，生成一个有趣、有特色的${roleTypeDescription}。`,
    '',
    '要求：',
    '- 只输出严格 JSON，不要输出 markdown、代码块、解释性文字。',
    '- 输出必须包含 role.name 与 role.system_prompt。',
    '- 如果提供了约束条件，必须严格遵循这些约束。',
    '- 如果未提供约束条件，可以自由发挥创意。',
    '- system_prompt 需要详细、有趣、可执行，体现角色的特点和能力。',
    selections.roleType === 'game' ? '- 游戏角色的system_prompt应该包含游戏背景、能力设定、战斗风格等游戏相关元素。' : '',
    constraintText,
    '',
    'JSON Schema:',
    '{',
    '  "role": {',
    '    "name": "角色名称",',
    '    "system_prompt": "系统提示词全文"',
    '  }',
    '}',
  ].filter(Boolean).join('\n');
}

function buildAvatarGeneratorPrompt(roleName: string, systemPrompt: string, avatarStyle: string | null): string {
  const styleText = avatarStyle ? `\n- 头像风格：${avatarStyle}` : '';
  
  return `请为以下角色生成一个头像图片。角色信息：
名称：${roleName}
人设：${systemPrompt.substring(0, 500)}${styleText}

要求：
- 生成一个风格统一、有特色的头像图片
- 图片应该是圆形或方形，适合作为头像使用${styleText ? `\n- 必须使用${avatarStyle}风格` : '\n- 风格可以是卡通、写实、抽象等，根据角色特点选择'}
- 只输出图片，不需要文字说明`;
}

interface RoleGeneratorPageProps {
  /** 是否嵌入到 Dialog 中，影响高度计算和标题显示 */
  isEmbedded?: boolean;
}

const RoleGeneratorPage: React.FC<RoleGeneratorPageProps> = ({ isEmbedded = false }) => {
  const [mode, setMode] = useState<Mode>('random');
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [isLoadingConfigs, setIsLoadingConfigs] = useState(false);
  
  // 模型选择
  const [selectedGeneratorLlmConfigId, setSelectedGeneratorLlmConfigId] = useState<string>('');
  const [selectedAvatarLlmConfigId, setSelectedAvatarLlmConfigId] = useState<string>('');
  const [enableAutoAvatar, setEnableAutoAvatar] = useState(false);
  
  // 头像生成方式：'direct' 直接模型生成，'agent' 通过agent生成
  const [avatarGenerationMode, setAvatarGenerationMode] = useState<'direct' | 'agent'>('direct');
  const [selectedAvatarAgentId, setSelectedAvatarAgentId] = useState<string>('');
  const [availableAgents, setAvailableAgents] = useState<Session[]>([]);
  
  // 角色类型（随机模式）
  const [roleType, setRoleType] = useState<RoleType>('career');
  
  // 维度选择（随机模式）
  const [dimensionSelections, setDimensionSelections] = useState<DimensionSelections>({
    roleType: 'career',
    profession: null,
    gender: null,
    ageRange: null,
    personality: null,
    background: null,
    conversationStyle: [],
    skills: [],
    avatarStyle: null,
  });
  const [dimensionSectionsExpanded, setDimensionSectionsExpanded] = useState<Record<string, boolean>>({
    basic: true,
    style: false,
    skills: false,
    avatar: false,
  });
  
  // 手动模式输入
  const [manualInput, setManualInput] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  
  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [avatarGenerationStatus, setAvatarGenerationStatus] = useState<string>('');
  const [shouldStopAvatarGeneration, setShouldStopAvatarGeneration] = useState(false);
  
  // 角色草稿
  const [draft, setDraft] = useState<RoleDraft>({
    name: '',
    system_prompt: '',
    avatar: '',
    llm_config_id: '',
    persona: defaultPersonaConfig,
  });
  
  // 高级设置展开状态
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  
  // 生成的头像列表
  const [generatedAvatars, setGeneratedAvatars] = useState<Array<{ data: string; mimeType: string }>>([]);
  const [selectedAvatarIndex, setSelectedAvatarIndex] = useState<number | null>(null);
  
  // 保存状态
  const [isSaving, setIsSaving] = useState(false);
  const [savedRoleId, setSavedRoleId] = useState<string | null>(null);
  
  // 自定义维度选项
  const [customOptions, setCustomOptions] = useState<Record<string, string[]>>({});
  const [addOptionDialog, setAddOptionDialog] = useState<{
    open: boolean;
    dimensionType: string;
    roleType: RoleType;
    currentValue: string;
  }>({
    open: false,
    dimensionType: '',
    roleType: 'career',
    currentValue: '',
  });
  
  // 导入角色相关状态
  const [importJsonText, setImportJsonText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  
  // /模块 选择器状态（用于手动配置人设时引用爬虫批次数据）
  const [showModuleSelector, setShowModuleSelector] = useState(false);
  const [moduleSelectorPosition, setModuleSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 256 });
  const [moduleSelectorQuery, setModuleSelectorQuery] = useState('');
  const [moduleSelectorIndex, setModuleSelectorIndex] = useState(-1); // /模块 在输入中的位置
  const manualInputRef = useRef<HTMLTextAreaElement>(null);
  
  // 批次数据项选择器状态
  const [showBatchItemSelector, setShowBatchItemSelector] = useState(false);
  const [batchItemSelectorPosition, setBatchItemSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 400 });
  const [selectedBatch, setSelectedBatch] = useState<any>(null);


  // 加载 LLM 配置
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        setIsLoadingConfigs(true);
        const configs = await getLLMConfigs();
        if (canceled) return;
        setLlmConfigs(configs);
        
        // 默认选择第一个启用的配置
        const enabled = configs.filter(c => c.enabled);
        if (enabled.length > 0) {
          setSelectedGeneratorLlmConfigId(enabled[0].config_id);
        }
      } catch (error) {
        console.error('[RoleGenerator] Failed to load LLM configs:', error);
        if (!canceled) setLlmConfigs([]);
      } finally {
        if (!canceled) setIsLoadingConfigs(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  // 加载 Agents 列表（用于agent生成方式）
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const agents = await getAgents();
        if (canceled) return;
        // 过滤出使用图片生成模型的agents
        const imageAgents = [];
        for (const agent of agents) {
          if (agent.llm_config_id) {
            try {
              const config = await getLLMConfig(agent.llm_config_id);
              const supportedOutputs = config.metadata?.supportedOutputs || [];
              const supportsImage = supportedOutputs.includes('image') || 
                                   config.model?.toLowerCase().includes('image') ||
                                   config.model?.toLowerCase().includes('gemini-2.0-flash-exp') ||
                                   config.model?.toLowerCase().includes('gemini-2.5-flash-image');
              if (supportsImage) {
                imageAgents.push(agent);
              }
            } catch (e) {
              // 忽略错误，继续检查下一个
            }
          }
        }
        setAvailableAgents(imageAgents);
        if (imageAgents.length > 0 && !selectedAvatarAgentId) {
          setSelectedAvatarAgentId(imageAgents[0].session_id);
        }
      } catch (error) {
        console.error('[RoleGenerator] Failed to load agents:', error);
        if (!canceled) setAvailableAgents([]);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [selectedAvatarAgentId]);

  // 处理手动输入变化，检测 / 命令
  const handleManualInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setManualInput(value);
    
    const cursorPosition = e.target.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPosition);
    
    // 检测 / 命令
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');
    if (lastSlashIndex !== -1) {
      // 检查 / 后面是否有空格或换行（如果有，说明不是在选择）
      const textAfterSlash = textBeforeCursor.substring(lastSlashIndex + 1);
      const hasSpaceOrNewline = textAfterSlash.includes(' ') || textAfterSlash.includes('\n');
      
      // 检查是否在行首（/ 前面是行首或空格）
      const textBeforeSlash = textBeforeCursor.substring(0, lastSlashIndex);
      const isAtLineStart = textBeforeSlash.length === 0 || textBeforeSlash.endsWith('\n') || textBeforeSlash.endsWith(' ');
      
      if (!hasSpaceOrNewline && isAtLineStart) {
        // 显示模块选择器
        const query = textAfterSlash.toLowerCase();
        setModuleSelectorIndex(lastSlashIndex);
        setModuleSelectorQuery(query);
        
        // 计算选择器位置
        if (manualInputRef.current) {
          const textarea = manualInputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          
          // 创建镜像元素来计算光标位置
          const mirror = document.createElement('div');
          mirror.style.position = 'absolute';
          mirror.style.visibility = 'hidden';
          mirror.style.whiteSpace = styles.whiteSpace || 'pre-wrap';
          mirror.style.wordWrap = styles.wordWrap || 'break-word';
          mirror.style.overflowWrap = styles.overflowWrap || 'break-word';
          mirror.style.font = styles.font;
          mirror.style.fontSize = styles.fontSize;
          mirror.style.fontFamily = styles.fontFamily;
          mirror.style.fontWeight = styles.fontWeight;
          mirror.style.fontStyle = styles.fontStyle;
          mirror.style.letterSpacing = styles.letterSpacing;
          mirror.style.padding = styles.padding;
          mirror.style.border = styles.border;
          mirror.style.width = `${textarea.offsetWidth}px`;
          mirror.style.boxSizing = styles.boxSizing;
          mirror.style.lineHeight = styles.lineHeight;
          mirror.style.wordSpacing = styles.wordSpacing;
          mirror.style.top = `${textareaRect.top}px`;
          mirror.style.left = `${textareaRect.left}px`;
          mirror.textContent = textBeforeCursor;
          document.body.appendChild(mirror);
          
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            const lineMeasure = document.createElement('span');
            lineMeasure.style.font = styles.font;
            lineMeasure.style.fontSize = styles.fontSize;
            lineMeasure.style.fontFamily = styles.fontFamily;
            lineMeasure.style.fontWeight = styles.fontWeight;
            lineMeasure.style.fontStyle = styles.fontStyle;
            lineMeasure.style.letterSpacing = styles.letterSpacing;
            lineMeasure.style.whiteSpace = 'pre';
            lineMeasure.textContent = lineText;
            lineMeasure.style.position = 'absolute';
            lineMeasure.style.visibility = 'hidden';
            document.body.appendChild(lineMeasure);
            const lineWidth = lineMeasure.offsetWidth;
            document.body.removeChild(lineMeasure);
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          document.body.removeChild(mirror);
          
          const selectorMaxHeight = 256;
          const selectorWidth = 320;
          const viewportWidth = window.innerWidth;
          
          let left = cursorX + 8;
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8;
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          if (left < 10) {
            left = 10;
          }
          
          const bottom = window.innerHeight - cursorY + 5;
          const availableHeightAbove = cursorY - 20;
          const actualMaxHeight = Math.min(selectorMaxHeight, availableHeightAbove);
          
          setModuleSelectorPosition({
            bottom,
            left,
            maxHeight: actualMaxHeight
          } as any);
          setShowModuleSelector(true);
        }
        return;
      } else {
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    } else {
      if (showModuleSelector) {
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    }
  };

  // 处理模块选择（/模块命令）
  const handleModuleSelect = async (moduleId: string, batchId: string, batchName: string) => {
    try {
      // 获取批次数据
      const batch = await getBatch(moduleId, batchId);
      
      // 检查数据是否存在
      if (!batch || !batch.crawled_data) {
        toast({ title: '该批次没有数据', variant: 'destructive' });
        return;
      }
      
      // 优先使用 parsed_data（用户标记后生成的解析数据），如果没有则使用 crawled_data.normalized
      let normalizedData: any = null;
      
      if (batch.parsed_data && Array.isArray(batch.parsed_data)) {
        normalizedData = {
          items: batch.parsed_data.map((item, index) => ({
            id: `item_${index + 1}`,
            title: item.title || '',
            content: item.content || ''
          })),
          total_count: batch.parsed_data.length,
          format: 'list'
        };
      } else if (batch.parsed_data && typeof batch.parsed_data === 'object') {
        normalizedData = batch.parsed_data;
      } else if (batch.crawled_data?.normalized) {
        normalizedData = batch.crawled_data.normalized;
      }
      
      if (!normalizedData || !normalizedData.items || normalizedData.items.length === 0) {
        toast({ title: '该批次没有解析数据，请先在爬虫配置页面标记并生成解析数据', variant: 'destructive' });
        return;
      }
      
      // 如果有多个数据项，显示选择器让用户选择
      if (normalizedData.items.length > 1) {
        setSelectedBatch(batch);
        setShowModuleSelector(false);
        
        // 计算批次数据项选择器的位置
        if (manualInputRef.current && moduleSelectorIndex !== -1) {
          const textarea = manualInputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          const cursorPosition = moduleSelectorIndex + 1 + moduleSelectorQuery.length;
          const textBeforeCursor = manualInput.substring(0, cursorPosition);
          
          const mirror = document.createElement('div');
          mirror.style.position = 'absolute';
          mirror.style.visibility = 'hidden';
          mirror.style.whiteSpace = styles.whiteSpace || 'pre-wrap';
          mirror.style.wordWrap = styles.wordWrap || 'break-word';
          mirror.style.overflowWrap = styles.overflowWrap || 'break-word';
          mirror.style.font = styles.font;
          mirror.style.fontSize = styles.fontSize;
          mirror.style.fontFamily = styles.fontFamily;
          mirror.style.fontWeight = styles.fontWeight;
          mirror.style.fontStyle = styles.fontStyle;
          mirror.style.letterSpacing = styles.letterSpacing;
          mirror.style.padding = styles.padding;
          mirror.style.border = styles.border;
          mirror.style.width = `${textarea.offsetWidth}px`;
          mirror.style.boxSizing = styles.boxSizing;
          mirror.style.lineHeight = styles.lineHeight;
          mirror.style.wordSpacing = styles.wordSpacing;
          mirror.style.top = `${textareaRect.top}px`;
          mirror.style.left = `${textareaRect.left}px`;
          mirror.textContent = textBeforeCursor;
          document.body.appendChild(mirror);
          
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            const lineMeasure = document.createElement('span');
            lineMeasure.style.font = styles.font;
            lineMeasure.style.fontSize = styles.fontSize;
            lineMeasure.style.fontFamily = styles.fontFamily;
            lineMeasure.style.fontWeight = styles.fontWeight;
            lineMeasure.style.fontStyle = styles.fontStyle;
            lineMeasure.style.letterSpacing = styles.letterSpacing;
            lineMeasure.style.whiteSpace = 'pre';
            lineMeasure.textContent = lineText;
            lineMeasure.style.position = 'absolute';
            lineMeasure.style.visibility = 'hidden';
            document.body.appendChild(lineMeasure);
            const lineWidth = lineMeasure.offsetWidth;
            document.body.removeChild(lineMeasure);
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          document.body.removeChild(mirror);
          
          const selectorMaxHeight = 400;
          const selectorWidth = 400;
          const viewportWidth = window.innerWidth;
          
          let left = cursorX + 8;
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8;
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          if (left < 10) {
            left = 10;
          }
          
          const bottom = window.innerHeight - cursorY + 5;
          const availableHeightAbove = cursorY - 20;
          const actualMaxHeight = Math.min(selectorMaxHeight, availableHeightAbove);
          
          setBatchItemSelectorPosition({
            bottom,
            left,
            maxHeight: actualMaxHeight
          } as any);
          setShowBatchItemSelector(true);
        }
      } else {
        // 只有一个数据项，直接插入
        const item = normalizedData.items[0];
        const referenceText = `[引用：${batchName} - ${item.title || '数据项1'}]\n${item.content || ''}\n\n`;
        const textBeforeSlash = manualInput.substring(0, moduleSelectorIndex);
        const textAfterSlash = manualInput.substring(moduleSelectorIndex + 1 + moduleSelectorQuery.length);
        const newValue = textBeforeSlash + referenceText + textAfterSlash;
        setManualInput(newValue);
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
        setModuleSelectorQuery('');
        
        // 恢复光标位置
        setTimeout(() => {
          if (manualInputRef.current) {
            const newCursorPosition = textBeforeSlash.length + referenceText.length;
            manualInputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
            manualInputRef.current.focus();
          }
        }, 0);
      }
    } catch (error) {
      console.error('[RoleGenerator] Failed to select module:', error);
      toast({ title: '选择失败', description: error instanceof Error ? error.message : '未知错误', variant: 'destructive' });
    }
  };

  // 处理批次数据项选择
  const handleBatchItemSelect = (item: any) => {
    if (!selectedBatch || moduleSelectorIndex === -1) return;
    
    const batchName = selectedBatch.batch_name || '批次数据';
    const referenceText = `[引用：${batchName} - ${item.title || '数据项'}]\n${item.content || ''}\n\n`;
    const textBeforeSlash = manualInput.substring(0, moduleSelectorIndex);
    const textAfterSlash = manualInput.substring(moduleSelectorIndex + 1 + moduleSelectorQuery.length);
    const newValue = textBeforeSlash + referenceText + textAfterSlash;
    setManualInput(newValue);
    setShowBatchItemSelector(false);
    setSelectedBatch(null);
    setModuleSelectorIndex(-1);
    setModuleSelectorQuery('');
    
    // 恢复光标位置
    setTimeout(() => {
      if (manualInputRef.current) {
        const newCursorPosition = textBeforeSlash.length + referenceText.length;
        manualInputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
        manualInputRef.current.focus();
      }
    }, 0);
  };

  // 加载自定义维度选项
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const dimensionTypes = roleType === 'career' 
          ? ['profession', 'gender', 'ageRange', 'personality', 'background', 'conversationStyle', 'skills', 'avatarStyle']
          : ['gameClass', 'race', 'alignment', 'levelRange', 'skillTree', 'gameConversationStyle', 'avatarStyle'];
        
        const optionsMap: Record<string, string[]> = {};
        for (const dimType of dimensionTypes) {
          // gameGender在数据库中存储为gender，但roleType为game
          const dbDimensionType = dimType === 'gameGender' ? 'gender' : dimType;
          const options = await getDimensionOptions(dbDimensionType, roleType);
          if (!canceled) {
            optionsMap[dimType] = options;
          }
        }
        // 游戏角色的性别选项也使用gender维度
        if (roleType === 'game') {
          const genderOptions = await getDimensionOptions('gender', 'game');
          if (!canceled) {
            optionsMap['gameGender'] = genderOptions;
          }
        }
        if (!canceled) {
          setCustomOptions(optionsMap);
        }
      } catch (error) {
        console.error('[RoleGenerator] Failed to load custom options:', error);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [roleType]);

  // 点击外部关闭选择器
  useEffect(() => {
    if (!showModuleSelector && !showBatchItemSelector) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.crawler-module-selector') && !target.closest('.crawler-batch-item-selector')) {
        if (showModuleSelector) {
          setShowModuleSelector(false);
          setModuleSelectorIndex(-1);
          setModuleSelectorQuery('');
        }
        if (showBatchItemSelector) {
          setShowBatchItemSelector(false);
          setSelectedBatch(null);
          setModuleSelectorIndex(-1);
          setModuleSelectorQuery('');
        }
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModuleSelector, showBatchItemSelector]);

  // 打开添加选项对话框
  const openAddOptionDialog = (dimensionType: string) => {
    setAddOptionDialog({
      open: true,
      dimensionType,
      roleType,
      currentValue: '',
    });
  };

  // 保存自定义选项
  const handleSaveCustomOption = async () => {
    const { dimensionType, roleType: rt, currentValue } = addOptionDialog;
    if (!currentValue.trim()) {
      toast({ title: '请输入选项值', variant: 'destructive' });
      return;
    }

    // gameGender在数据库中存储为gender
    const dbDimensionType = dimensionType === 'gameGender' ? 'gender' : dimensionType;
    const result = await saveDimensionOption(dbDimensionType, rt, currentValue.trim());
    if (result.success) {
      toast({ title: '选项已保存', variant: 'success' });
      // 重新加载自定义选项
      const options = await getDimensionOptions(dbDimensionType, rt);
      setCustomOptions(prev => ({
        ...prev,
        [dimensionType]: options,
        // 如果是gender，同时更新gameGender（如果当前是游戏角色）
        ...(dimensionType === 'gender' && rt === 'game' ? { gameGender: options } : {}),
        // 如果是gameGender，同时更新gender（如果当前是游戏角色）
        ...(dimensionType === 'gameGender' ? { gender: options } : {}),
      }));
      setAddOptionDialog({ open: false, dimensionType: '', roleType: 'career', currentValue: '' });
    } else {
      toast({
        title: '保存失败',
        description: result.error || '未知错误',
        variant: 'destructive',
      });
    }
  };

  // 过滤可用的模型
  const enabledConfigs = useMemo(() => llmConfigs.filter(c => c.enabled), [llmConfigs]);
  
  // 支持图片生成的多模态模型
  const imageGenerationConfigs = useMemo(() => {
    return enabledConfigs.filter(c => {
      const supportedOutputs = c.metadata?.supportedOutputs || [];
      const supportsImage = supportedOutputs.includes('image');
      const isImageModel = c.model?.toLowerCase().includes('image') || 
                          c.model?.toLowerCase().includes('gemini-2.0-flash-exp') ||
                          c.model?.toLowerCase().includes('gemini-2.5-flash-image');
      return supportsImage || isImageModel;
    });
  }, [enabledConfigs]);

  const selectedGeneratorConfig = useMemo(
    () => llmConfigs.find(c => c.config_id === selectedGeneratorLlmConfigId) || null,
    [llmConfigs, selectedGeneratorLlmConfigId]
  );

  const selectedAvatarConfig = useMemo(
    () => llmConfigs.find(c => c.config_id === selectedAvatarLlmConfigId) || null,
    [llmConfigs, selectedAvatarLlmConfigId]
  );

  // 生成角色人设
  const generateRole = async (userInput?: string) => {
    if (!selectedGeneratorConfig) {
      toast({ title: '请先选择生成器使用的 LLM', variant: 'destructive' });
      return;
    }

    const input = userInput || (mode === 'random' ? '随机生成一个角色' : manualInput.trim());
    if (!input && mode === 'manual') {
      toast({ title: '请输入角色描述', variant: 'destructive' });
      return;
    }

    setIsGenerating(true);
    try {
      const apiKey = await getLLMConfigApiKey(selectedGeneratorConfig.config_id);
      if (selectedGeneratorConfig.provider !== 'ollama' && !apiKey) {
        throw new Error('API密钥未配置');
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

      // 更新维度选择的角色类型
      const currentSelections = mode === 'random' 
        ? { ...dimensionSelections, roleType }
        : dimensionSelections;
      
      const generatorSystemPrompt = mode === 'random' 
        ? buildRandomGeneratorSystemPrompt(currentSelections)
        : buildGeneratorSystemPrompt();
      
      const messages: LLMMessage[] = [
        { role: 'system', content: generatorSystemPrompt },
        ...chatHistory.map(m => ({ role: m.role, content: m.content } as LLMMessage)),
        { role: 'user', content: input },
      ];

      const resp = await llmClient.chat(messages, undefined, false);
      const parsed = tryExtractJson(resp.content || '');
      
      const name = (parsed.role?.name || parsed.name || '').trim();
      const roleSystemPrompt = (parsed.role?.system_prompt || parsed.system_prompt || '').trim();

      if (!roleSystemPrompt) {
        throw new Error('模型输出缺少 system_prompt');
      }

      const newDraft: RoleDraft = {
        name: name || '未命名角色',
        system_prompt: roleSystemPrompt,
        avatar: makeDefaultAvatar(name || 'Role'),
        llm_config_id: selectedGeneratorConfig.config_id,
      };

      setDraft(newDraft);
      setChatHistory(prev => [...prev, { role: 'user', content: input }, { role: 'assistant', content: `已生成角色：${name}` }]);
      
      if (mode === 'manual') {
        setManualInput('');
      }

      toast({ title: '角色生成成功', variant: 'success' });
    } catch (error) {
      console.error('[RoleGenerator] generate error:', error);
      toast({
        title: '生成失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // 生成单个头像（直接模型方式）
  const generateSingleAvatarDirect = async (prompt: string): Promise<Array<{ data: string; mimeType: string }>> => {
    if (!selectedAvatarConfig) throw new Error('未选择头像生成模型');
    
    const apiKey = await getLLMConfigApiKey(selectedAvatarConfig.config_id);
    if (selectedAvatarConfig.provider !== 'ollama' && !apiKey) {
      throw new Error('API密钥未配置');
    }

    const llmClient = new LLMClient({
      id: selectedAvatarConfig.config_id,
      provider: selectedAvatarConfig.provider,
      name: selectedAvatarConfig.name,
      apiKey,
      apiUrl: selectedAvatarConfig.api_url,
      model: selectedAvatarConfig.model,
      enabled: selectedAvatarConfig.enabled,
      metadata: selectedAvatarConfig.metadata,
    });

    const resp = await llmClient.chat(
      [{ role: 'user', content: prompt }],
      undefined,
      false
    );
    
    if (resp.media && resp.media.length > 0) {
      return resp.media.filter(m => m.type === 'image').map(m => ({
        data: m.data,
        mimeType: m.mimeType,
      }));
    }
    
    return [];
  };

  // 生成单个头像（Agent方式）
  const generateSingleAvatarViaAgent = async (prompt: string): Promise<Array<{ data: string; mimeType: string }>> => {
    if (!selectedAvatarAgentId) throw new Error('未选择头像生成Agent');
    
    const agent = await getSession(selectedAvatarAgentId);
    if (!agent.llm_config_id) throw new Error('Agent未配置模型');
    
    const config = await getLLMConfig(agent.llm_config_id);
    const apiKey = await getLLMConfigApiKey(agent.llm_config_id);
    if (config.provider !== 'ollama' && !apiKey) {
      throw new Error('API密钥未配置');
    }

    const llmClient = new LLMClient({
      id: config.config_id,
      provider: config.provider,
      name: config.name,
      apiKey,
      apiUrl: config.api_url,
      model: config.model,
      enabled: config.enabled,
      metadata: config.metadata,
    });

    const systemPrompt = agent.system_prompt || '你是一个专业的头像生成助手。';
    const userMessage = `${systemPrompt}\n\n${prompt}`;

    const resp = await llmClient.chat(
      [{ role: 'user', content: userMessage }],
      undefined,
      false
    );
    
    if (resp.media && resp.media.length > 0) {
      return resp.media.filter(m => m.type === 'image').map(m => ({
        data: m.data,
        mimeType: m.mimeType,
      }));
    }
    
    return [];
  };

  // 生成头像（流式显示 + 可中断）
  const generateAvatars = async () => {
    if (avatarGenerationMode === 'direct' && !selectedAvatarConfig) {
      toast({ title: '请先选择头像生成模型', variant: 'destructive' });
      return;
    }

    if (avatarGenerationMode === 'agent' && !selectedAvatarAgentId) {
      toast({ title: '请先选择头像生成Agent', variant: 'destructive' });
      return;
    }

    if (!draft.name || !draft.system_prompt) {
      toast({ title: '请先生成角色人设', variant: 'destructive' });
      return;
    }

    setIsGeneratingAvatar(true);
    setGeneratedAvatars([]);
    setSelectedAvatarIndex(null);
    setShouldStopAvatarGeneration(false);
    setAvatarGenerationStatus('正在努力生成更多头像 (0/3)');

    const targetCount = 3;
    const avatars: Array<{ data: string; mimeType: string }> = [];
    const prompt = buildAvatarGeneratorPrompt(draft.name, draft.system_prompt, dimensionSelections.avatarStyle);

    try {
      for (let i = 0; i < targetCount; i++) {
        // 检查是否应该停止
        if (shouldStopAvatarGeneration) {
          setAvatarGenerationStatus('已停止生成');
          break;
        }

        // 更新状态
        setAvatarGenerationStatus(`正在努力生成更多头像 (${i + 1}/${targetCount})`);

        try {
          // 根据生成方式选择不同的函数
          const newAvatars = avatarGenerationMode === 'direct'
            ? await generateSingleAvatarDirect(prompt)
            : await generateSingleAvatarViaAgent(prompt);

          if (newAvatars.length > 0) {
            avatars.push(...newAvatars);
            // 立即更新UI显示
            setGeneratedAvatars([...avatars]);
          }

          // 如果已经生成了足够的头像，提前退出
          if (avatars.length >= targetCount) break;

          // 添加小延迟，避免 API 限制（最后一个不需要延迟）
          if (i < targetCount - 1 && !shouldStopAvatarGeneration) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.warn(`[RoleGenerator] Failed to generate avatar ${i + 1}:`, error);
          // 继续生成下一个
        }
      }
      
      if (avatars.length === 0) {
        throw new Error('未生成任何头像，请检查模型是否支持图片生成');
      }

      setAvatarGenerationStatus('');
      toast({ title: `已生成 ${avatars.length} 个头像`, variant: 'success' });
    } catch (error) {
      console.error('[RoleGenerator] avatar generation error:', error);
      setAvatarGenerationStatus('');
      toast({
        title: '头像生成失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingAvatar(false);
      setShouldStopAvatarGeneration(false);
    }
  };

  // 停止头像生成
  const stopAvatarGeneration = () => {
    setShouldStopAvatarGeneration(true);
    setAvatarGenerationStatus('正在停止...');
  };

  // 选择头像
  const selectAvatar = (index: number) => {
    setSelectedAvatarIndex(index);
    const avatar = generatedAvatars[index];
    if (avatar) {
      setDraft(prev => ({
        ...prev,
        avatar: `data:${avatar.mimeType};base64,${avatar.data}`,
      }));
    }
  };

  // 保存角色
  const saveRole = async () => {
    if (!draft.name || !draft.system_prompt || !draft.llm_config_id) {
      toast({ title: '请先完成角色生成', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const avatar = draft.avatar || makeDefaultAvatar(draft.name);
      
      if (savedRoleId) {
        // 更新已有角色
        await updateRoleProfile(savedRoleId, {
          name: draft.name,
          avatar,
          system_prompt: draft.system_prompt,
          llm_config_id: draft.llm_config_id,
          reason: 'role_generator',
          persona: draft.persona,
        });
        toast({ title: '角色已更新', variant: 'success' });
      } else {
        // 创建新角色
        const role = await createRole({
          name: draft.name,
          avatar,
          system_prompt: draft.system_prompt,
          llm_config_id: draft.llm_config_id,
          persona: draft.persona,
        });
        setSavedRoleId(role.session_id);
        toast({ title: '角色已创建', variant: 'success' });
      }
      
      emitSessionsChanged();
    } catch (error) {
      console.error('[RoleGenerator] save error:', error);
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 重置
  const reset = () => {
    setDraft({
      name: '',
      system_prompt: '',
      avatar: '',
      llm_config_id: '',
      persona: defaultPersonaConfig,
    });
    setChatHistory([]);
    setManualInput('');
    setGeneratedAvatars([]);
    setSelectedAvatarIndex(null);
    setShowAdvancedSettings(false);
    setSavedRoleId(null);
    setRoleType('career');
    setDimensionSelections({
      roleType: 'career',
      profession: null,
      gender: null,
      ageRange: null,
      personality: null,
      background: null,
      conversationStyle: [],
      skills: [],
      avatarStyle: null,
    });
    setAvatarGenerationStatus('');
    setShouldStopAvatarGeneration(false);
  };

  // 应用预设组合
  const applyPreset = (preset: typeof PRESET_COMBINATIONS[0]) => {
    setRoleType(preset.roleType);
    setDimensionSelections(preset.selections);
    toast({ title: `已应用预设：${preset.name}`, variant: 'success' });
  };

  // 切换维度选择
  const toggleDimensionSelection = (category: keyof DimensionSelections, value: string, isMulti: boolean = false) => {
    if (isMulti) {
      setDimensionSelections(prev => {
        const current = (prev[category] as string[]) || [];
        const newValue = current.includes(value)
          ? current.filter(v => v !== value)
          : [...current, value];
        return { ...prev, [category]: newValue };
      });
    } else {
      setDimensionSelections(prev => ({
        ...prev,
        [category]: prev[category] === value ? null : value,
      }));
    }
  };

  // 切换角色类型
  const handleRoleTypeChange = (newRoleType: RoleType) => {
    setRoleType(newRoleType);
    // 重置维度选择
    if (newRoleType === 'career') {
      setDimensionSelections({
        roleType: 'career',
        profession: null,
        ageRange: null,
        personality: null,
        background: null,
        conversationStyle: [],
        skills: [],
        avatarStyle: dimensionSelections.avatarStyle,
      });
    } else {
      setDimensionSelections({
        roleType: 'game',
        gameClass: null,
        gameGender: null,
        race: null,
        alignment: null,
        levelRange: null,
        skillTree: [],
        gameConversationStyle: [],
        avatarStyle: dimensionSelections.avatarStyle,
      });
    }
  };

  // 解析导入的 JSON
  const parseImportJson = (jsonText: string): RoleExportData | null => {
    try {
      const data = JSON.parse(jsonText);
      // 验证必要字段
      if (!data.role || !data.role.name || !data.role.system_prompt) {
        setImportError('JSON 格式不正确：缺少必要字段 (role.name, role.system_prompt)');
        return null;
      }
      setImportError(null);
      return data as RoleExportData;
    } catch (e) {
      setImportError('JSON 解析失败：' + (e instanceof Error ? e.message : String(e)));
      return null;
    }
  };

  // 从文件导入
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportJsonText(content);
      parseImportJson(content);
    };
    reader.onerror = () => {
      setImportError('文件读取失败');
    };
    reader.readAsText(file);
    
    // 清空 input 以便再次选择同一文件
    e.target.value = '';
  };

  // 执行导入
  const handleImportRole = async () => {
    const data = parseImportJson(importJsonText);
    if (!data) return;
    
    setIsImporting(true);
    try {
      // 创建角色
      const newRole = await createRole({
        name: data.role.name,
        system_prompt: data.role.system_prompt,
        avatar: data.role.avatar || '',
        llm_config_id: selectedGeneratorLlmConfigId || enabledConfigs[0]?.config_id || '',
      });
      
      emitSessionsChanged();
      toast({ title: '角色导入成功', description: `已创建角色「${data.role.name}」`, variant: 'success' });
      
      // 重置导入状态
      setImportJsonText('');
      setImportError(null);
      
      // 更新预览
      setDraft({
        name: data.role.name,
        system_prompt: data.role.system_prompt,
        avatar: data.role.avatar || '',
        llm_config_id: selectedGeneratorLlmConfigId,
      });
      setSavedRoleId(newRole.session_id);
    } catch (error) {
      console.error('[RoleGenerator] Failed to import role:', error);
      toast({
        title: '导入失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  // 预览导入的角色
  const importPreview = useMemo(() => {
    if (!importJsonText.trim()) return null;
    const data = parseImportJson(importJsonText);
    if (!data) return null;
    return data.role;
  }, [importJsonText]);

  return (
    <div className={`flex flex-col bg-gray-50 dark:bg-[#1a1a1a] ${isEmbedded ? 'h-full' : 'h-full'}`}>
      {/* 顶部标题栏 - 嵌入模式下隐藏（由外部 Dialog 提供标题） */}
      {!isEmbedded && (
        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#7c3aed]/10 dark:bg-[#7c3aed]/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-[#7c3aed]" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900 dark:text-white">角色生成器</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">生成和配置 AI 角色人设</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={reset} disabled={isGenerating || isGeneratingAvatar}>
                <RefreshCw className="w-4 h-4 mr-2" />
                重置
              </Button>
              <Button variant="primary" onClick={saveRole} disabled={!draft.name || !draft.system_prompt || isSaving}>
                {isSaving ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    {savedRoleId ? '更新角色' : '保存角色'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 嵌入模式的操作栏 */}
      {isEmbedded && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={reset} disabled={isGenerating || isGeneratingAvatar}>
            <RefreshCw className="w-4 h-4 mr-1.5" />
            重置
          </Button>
          <Button variant="primary" size="sm" onClick={saveRole} disabled={!draft.name || !draft.system_prompt || isSaving}>
            {isSaving ? (
              <>
                <Loader className="w-4 h-4 mr-1.5 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-1.5" />
                {savedRoleId ? '更新角色' : '保存角色'}
              </>
            )}
          </Button>
        </div>
      )}

      {/* 主内容区域 - 左右分栏 */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* 左侧配置区域 */}
        <div className="w-[480px] flex-shrink-0 border-r border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] flex flex-col h-full overflow-hidden">
          {/* Tab 切换 */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-[#404040]">
            <div className="flex gap-2">
              <button
                onClick={() => setMode('random')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === 'random'
                    ? 'bg-[#7c3aed] text-white'
                    : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                }`}
              >
                <Wand2 className="w-4 h-4 inline mr-1.5" />
                随机抽卡
              </button>
              <button
                onClick={() => setMode('manual')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === 'manual'
                    ? 'bg-[#7c3aed] text-white'
                    : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                }`}
              >
                <Settings className="w-4 h-4 inline mr-1.5" />
                手动配置
              </button>
              <button
                onClick={() => setMode('import')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === 'import'
                    ? 'bg-[#7c3aed] text-white'
                    : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                }`}
              >
                <Upload className="w-4 h-4 inline mr-1.5" />
                导入角色
              </button>
            </div>
          </div>

          {/* 配置内容 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {/* 导入角色模式 */}
            {mode === 'import' ? (
              <div className="space-y-4">
                <div className="text-sm font-medium text-gray-900 dark:text-white">导入角色</div>
                
                {/* 文件上传按钮 */}
                <div>
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportFile}
                    className="hidden"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => importFileInputRef.current?.click()}
                    className="w-full"
                  >
                    <FileJson className="w-4 h-4 mr-2" />
                    选择 JSON 文件
                  </Button>
                </div>
                
                {/* JSON 文本框 */}
                <div>
                  <Label className="text-xs text-gray-600 dark:text-gray-400 mb-1.5 block">
                    或粘贴 JSON 内容
                  </Label>
                  <Textarea
                    value={importJsonText}
                    onChange={(e) => {
                      setImportJsonText(e.target.value);
                      if (e.target.value.trim()) {
                        parseImportJson(e.target.value);
                      } else {
                        setImportError(null);
                      }
                    }}
                    placeholder={`粘贴角色 JSON 数据，格式示例：
{
  "version": "1.0",
  "exportedAt": "2024-01-01T00:00:00Z",
  "role": {
    "name": "角色名称",
    "system_prompt": "角色人设描述",
    "avatar": "data:image/png;base64,..."
  }
}`}
                    className="font-mono text-xs h-64"
                  />
                </div>
                
                {/* 错误提示 */}
                {importError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>
                  </div>
                )}
                
                {/* 预览信息 */}
                {importPreview && !importError && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg space-y-2">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">✓ JSON 格式正确</p>
                    <div className="text-xs text-green-600 dark:text-green-500">
                      <p>角色名称: {importPreview.name}</p>
                      <p>人设长度: {importPreview.system_prompt.length} 字符</p>
                      <p>头像: {importPreview.avatar ? '已包含' : '无'}</p>
                    </div>
                  </div>
                )}
                
                {/* 导入按钮 */}
                <Button
                  variant="primary"
                  onClick={handleImportRole}
                  disabled={!importPreview || !!importError || isImporting}
                  className="w-full"
                >
                  {isImporting ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      导入中...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      导入角色
                    </>
                  )}
                </Button>
              </div>
            ) : (
            <>
            {/* 模型选择 */}
            <div className="space-y-3">
              <div className="text-sm font-medium text-gray-900 dark:text-white">模型配置</div>
              
              {/* 人设生成模型 */}
              <div>
                <Label className="text-xs text-gray-600 dark:text-gray-400 mb-1.5 block">
                  人设生成模型 <span className="text-red-500">*</span>
                </Label>
                <Select value={selectedGeneratorLlmConfigId} onValueChange={setSelectedGeneratorLlmConfigId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择生成人设的模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledConfigs.map(c => (
                      <SelectItem key={c.config_id} value={c.config_id}>
                        {c.name} {c.model ? `· ${c.model}` : ''} {c.provider ? `(${c.provider})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {enabledConfigs.length === 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    没有可用的 LLM 配置（请先在 LLM 配置里启用至少一个）
                  </p>
                )}
              </div>

              {/* 自动生成头像选项 */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="enable-auto-avatar"
                  checked={enableAutoAvatar}
                  onCheckedChange={(checked) => setEnableAutoAvatar(checked === true)}
                />
                <Label htmlFor="enable-auto-avatar" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  自动生成头像
                </Label>
              </div>

              {/* 头像生成配置（仅在启用自动生成头像时显示） */}
              {enableAutoAvatar && (
                <div className="space-y-3">
                  {/* 生成方式选择 */}
                  <div>
                    <Label className="text-xs text-gray-600 dark:text-gray-400 mb-1.5 block">
                      头像生成方式
                    </Label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setAvatarGenerationMode('direct')}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          avatarGenerationMode === 'direct'
                            ? 'bg-[#7c3aed] text-white'
                            : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                        }`}
                      >
                        直接模型
                      </button>
                      <button
                        onClick={() => setAvatarGenerationMode('agent')}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          avatarGenerationMode === 'agent'
                            ? 'bg-[#7c3aed] text-white'
                            : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                        }`}
                      >
                        Agent生成
                      </button>
                    </div>
                  </div>

                  {/* 直接模型方式 */}
                  {avatarGenerationMode === 'direct' && (
                    <div>
                      <Label className="text-xs text-gray-600 dark:text-gray-400 mb-1.5 block">
                        头像生成模型（多模态） <span className="text-red-500">*</span>
                      </Label>
                      <Select value={selectedAvatarLlmConfigId} onValueChange={setSelectedAvatarLlmConfigId}>
                        <SelectTrigger>
                          <SelectValue placeholder="选择支持图片生成的模型" />
                        </SelectTrigger>
                        <SelectContent>
                          {imageGenerationConfigs.length > 0 ? (
                            imageGenerationConfigs.map(c => (
                              <SelectItem key={c.config_id} value={c.config_id}>
                                {c.name} {c.model ? `· ${c.model}` : ''} {c.provider ? `(${c.provider})` : ''}
                              </SelectItem>
                            ))
                          ) : (
                            <div className="px-2 py-1.5 text-xs text-gray-500">
                              没有可用的图片生成模型
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      {imageGenerationConfigs.length === 0 && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          请先在 LLM 配置中启用支持图片生成的模型（如 Gemini 2.0 Flash Exp Image Generation）
                        </p>
                      )}
                    </div>
                  )}

                  {/* Agent方式 */}
                  {avatarGenerationMode === 'agent' && (
                    <div>
                      <Label className="text-xs text-gray-600 dark:text-gray-400 mb-1.5 block">
                        头像生成Agent <span className="text-red-500">*</span>
                      </Label>
                      <Select value={selectedAvatarAgentId} onValueChange={setSelectedAvatarAgentId}>
                        <SelectTrigger>
                          <SelectValue placeholder="选择使用图片生成模型的Agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableAgents.length > 0 ? (
                            availableAgents.map(agent => (
                              <SelectItem key={agent.session_id} value={agent.session_id}>
                                {agent.name || agent.title || agent.session_id}
                              </SelectItem>
                            ))
                          ) : (
                            <div className="px-2 py-1.5 text-xs text-gray-500">
                              没有可用的图片生成Agent
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                      {availableAgents.length === 0 && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          请先创建使用图片生成模型的Agent
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 模式特定内容 */}
            {mode === 'random' ? (
              <div className="space-y-4">
                {/* 角色类型Tab切换 */}
                <div className="flex gap-2 border-b border-gray-200 dark:border-[#404040]">
                  <button
                    onClick={() => handleRoleTypeChange('career')}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-all border-b-2 ${
                      roleType === 'career'
                        ? 'border-[#7c3aed] text-[#7c3aed]'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    职业角色
                  </button>
                  <button
                    onClick={() => handleRoleTypeChange('game')}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-all border-b-2 ${
                      roleType === 'game'
                        ? 'border-[#7c3aed] text-[#7c3aed]'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    游戏角色
                  </button>
                </div>

                {/* 预设组合 */}
                {PRESET_COMBINATIONS.filter(p => p.roleType === roleType).length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-600 dark:text-gray-400">快速预设</Label>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_COMBINATIONS.filter(p => p.roleType === roleType).map((preset) => (
                        <Button
                          key={preset.name}
                          variant="secondary"
                          size="sm"
                          onClick={() => applyPreset(preset)}
                          className="text-xs"
                        >
                          {preset.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 维度选择 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-gray-900 dark:text-white">角色维度</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (roleType === 'career') {
                          setDimensionSelections({
                            roleType: 'career',
                            profession: null,
                            ageRange: null,
                            personality: null,
                            background: null,
                            conversationStyle: [],
                            skills: [],
                            avatarStyle: dimensionSelections.avatarStyle,
                          });
                        } else {
                          setDimensionSelections({
                            roleType: 'game',
                            gameClass: null,
                            gameGender: null,
                            race: null,
                            alignment: null,
                            levelRange: null,
                            skillTree: [],
                            gameConversationStyle: [],
                            avatarStyle: dimensionSelections.avatarStyle,
                          });
                        }
                      }}
                      className="text-xs"
                    >
                      全部随机
                    </Button>
                  </div>

                  {/* 职业角色维度选择 */}
                  {roleType === 'career' && (
                    <>

                  {/* 基本属性 */}
                  <div className="space-y-2">
                    <button
                      onClick={() => setDimensionSectionsExpanded(prev => ({ ...prev, basic: !prev.basic }))}
                      className="flex items-center justify-between w-full text-xs font-medium text-gray-700 dark:text-gray-300"
                    >
                      <span>基本属性</span>
                      {dimensionSectionsExpanded.basic ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    {dimensionSectionsExpanded.basic && (
                      <div className="space-y-2 pl-2">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-xs text-gray-600 dark:text-gray-400">职业类型</Label>
                            <button
                              onClick={() => openAddOptionDialog('profession')}
                              className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                              title="添加自定义选项"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <Select
                            value={dimensionSelections.profession || '不限'}
                            onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, profession: v === '不限' ? null : v }))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PROFESSIONS.map(p => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                              ))}
                              {customOptions.profession?.map(opt => (
                                <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-xs text-gray-600 dark:text-gray-400">性别</Label>
                            <button
                              onClick={() => openAddOptionDialog('gender')}
                              className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                              title="添加自定义选项"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <Select
                            value={dimensionSelections.gender || '不限'}
                            onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, gender: v === '不限' ? null : v }))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {GENDERS.map(g => (
                                <SelectItem key={g} value={g}>{g}</SelectItem>
                              ))}
                              {customOptions.gender?.map(opt => (
                                <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-xs text-gray-600 dark:text-gray-400">年龄范围</Label>
                            <button
                              onClick={() => openAddOptionDialog('ageRange')}
                              className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                              title="添加自定义选项"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <Select
                            value={dimensionSelections.ageRange || '不限'}
                            onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, ageRange: v === '不限' ? null : v }))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {AGE_RANGES.map(a => (
                                <SelectItem key={a} value={a}>{a}</SelectItem>
                              ))}
                              {customOptions.ageRange?.map(opt => (
                                <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-xs text-gray-600 dark:text-gray-400">性格特点</Label>
                            <button
                              onClick={() => openAddOptionDialog('personality')}
                              className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                              title="添加自定义选项"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <Select
                            value={dimensionSelections.personality || '不限'}
                            onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, personality: v === '不限' ? null : v }))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PERSONALITIES.map(p => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                              ))}
                              {customOptions.personality?.map(opt => (
                                <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-xs text-gray-600 dark:text-gray-400">背景设定</Label>
                            <button
                              onClick={() => openAddOptionDialog('background')}
                              className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                              title="添加自定义选项"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <Select
                            value={dimensionSelections.background || '不限'}
                            onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, background: v === '不限' ? null : v }))}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {BACKGROUNDS.map(b => (
                                <SelectItem key={b} value={b}>{b}</SelectItem>
                              ))}
                              {customOptions.background?.map(opt => (
                                <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 对话风格 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setDimensionSectionsExpanded(prev => ({ ...prev, style: !prev.style }))}
                        className="flex items-center justify-between flex-1 text-xs font-medium text-gray-700 dark:text-gray-300"
                      >
                        <span>对话风格（多选）</span>
                        {dimensionSectionsExpanded.style ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => openAddOptionDialog('conversationStyle')}
                        className="ml-2 w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                        title="添加自定义选项"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    {dimensionSectionsExpanded.style && (
                      <div className="pl-2 space-y-1.5">
                        <div className="flex flex-wrap gap-2">
                          {CONVERSATION_STYLES.map(style => (
                            <button
                              key={style}
                              onClick={() => toggleDimensionSelection('conversationStyle', style, true)}
                              className={`px-2 py-1 rounded text-xs transition-colors ${
                                (dimensionSelections.conversationStyle || []).includes(style)
                                  ? 'bg-[#7c3aed] text-white'
                                  : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                              }`}
                            >
                              {style}
                            </button>
                          ))}
                          {customOptions.conversationStyle?.map(opt => (
                            <button
                              key={`custom-${opt}`}
                              onClick={() => toggleDimensionSelection('conversationStyle', opt, true)}
                              className={`px-2 py-1 rounded text-xs transition-colors ${
                                (dimensionSelections.conversationStyle || []).includes(opt)
                                  ? 'bg-[#7c3aed] text-white'
                                  : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 技能专长 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setDimensionSectionsExpanded(prev => ({ ...prev, skills: !prev.skills }))}
                        className="flex items-center justify-between flex-1 text-xs font-medium text-gray-700 dark:text-gray-300"
                      >
                        <span>技能专长（多选）</span>
                        {dimensionSectionsExpanded.skills ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => openAddOptionDialog('skills')}
                        className="ml-2 w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                        title="添加自定义选项"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    {dimensionSectionsExpanded.skills && (
                      <div className="pl-2 space-y-1.5">
                        <div className="flex flex-wrap gap-2">
                          {SKILLS.map(skill => (
                            <button
                              key={skill}
                              onClick={() => toggleDimensionSelection('skills', skill, true)}
                              className={`px-2 py-1 rounded text-xs transition-colors ${
                                (dimensionSelections.skills || []).includes(skill)
                                  ? 'bg-[#7c3aed] text-white'
                                  : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                              }`}
                            >
                              {skill}
                            </button>
                          ))}
                          {customOptions.skills?.map(opt => (
                            <button
                              key={`custom-${opt}`}
                              onClick={() => toggleDimensionSelection('skills', opt, true)}
                              className={`px-2 py-1 rounded text-xs transition-colors ${
                                (dimensionSelections.skills || []).includes(opt)
                                  ? 'bg-[#7c3aed] text-white'
                                  : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                    </>

                  )}

                  {/* 游戏角色维度选择 */}
                  {roleType === 'game' && (
                    <>
                      {/* 基本属性 */}
                      <div className="space-y-2">
                        <button
                          onClick={() => setDimensionSectionsExpanded(prev => ({ ...prev, basic: !prev.basic }))}
                          className="flex items-center justify-between w-full text-xs font-medium text-gray-700 dark:text-gray-300"
                        >
                          <span>基本属性</span>
                          {dimensionSectionsExpanded.basic ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                        {dimensionSectionsExpanded.basic && (
                          <div className="space-y-2 pl-2">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-xs text-gray-600 dark:text-gray-400">职业类型</Label>
                                <button
                                  onClick={() => openAddOptionDialog('gameClass')}
                                  className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                                  title="添加自定义选项"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                              <Select
                                value={dimensionSelections.gameClass || '不限'}
                                onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, gameClass: v === '不限' ? null : v }))}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {GAME_CLASSES.map(c => (
                                    <SelectItem key={c} value={c}>{c}</SelectItem>
                                  ))}
                                  {customOptions.gameClass?.map(opt => (
                                    <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-xs text-gray-600 dark:text-gray-400">性别</Label>
                                <button
                                  onClick={() => openAddOptionDialog('gameGender')}
                                  className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                                  title="添加自定义选项"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                              <Select
                                value={dimensionSelections.gameGender || '不限'}
                                onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, gameGender: v === '不限' ? null : v }))}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {GENDERS.map(g => (
                                    <SelectItem key={g} value={g}>{g}</SelectItem>
                                  ))}
                                  {customOptions.gameGender?.map(opt => (
                                    <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-xs text-gray-600 dark:text-gray-400">种族</Label>
                                <button
                                  onClick={() => openAddOptionDialog('race')}
                                  className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                                  title="添加自定义选项"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                              <Select
                                value={dimensionSelections.race || '不限'}
                                onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, race: v === '不限' ? null : v }))}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {RACES.map(r => (
                                    <SelectItem key={r} value={r}>{r}</SelectItem>
                                  ))}
                                  {customOptions.race?.map(opt => (
                                    <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-xs text-gray-600 dark:text-gray-400">阵营</Label>
                                <button
                                  onClick={() => openAddOptionDialog('alignment')}
                                  className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                                  title="添加自定义选项"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                              <Select
                                value={dimensionSelections.alignment || '不限'}
                                onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, alignment: v === '不限' ? null : v }))}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ALIGNMENTS.map(a => (
                                    <SelectItem key={a} value={a}>{a}</SelectItem>
                                  ))}
                                  {customOptions.alignment?.map(opt => (
                                    <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <Label className="text-xs text-gray-600 dark:text-gray-400">等级范围</Label>
                                <button
                                  onClick={() => openAddOptionDialog('levelRange')}
                                  className="w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                                  title="添加自定义选项"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                              <Select
                                value={dimensionSelections.levelRange || '不限'}
                                onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, levelRange: v === '不限' ? null : v }))}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {LEVEL_RANGES.map(l => (
                                    <SelectItem key={l} value={l}>{l}</SelectItem>
                                  ))}
                                  {customOptions.levelRange?.map(opt => (
                                    <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 技能树 */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => setDimensionSectionsExpanded(prev => ({ ...prev, skills: !prev.skills }))}
                            className="flex items-center justify-between flex-1 text-xs font-medium text-gray-700 dark:text-gray-300"
                          >
                            <span>技能树（多选）</span>
                            {dimensionSectionsExpanded.skills ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => openAddOptionDialog('skillTree')}
                            className="ml-2 w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                            title="添加自定义选项"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        {dimensionSectionsExpanded.skills && (
                          <div className="pl-2 space-y-1.5">
                            <div className="flex flex-wrap gap-2">
                              {SKILL_TREES.map(skill => (
                                <button
                                  key={skill}
                                  onClick={() => toggleDimensionSelection('skillTree', skill, true)}
                                  className={`px-2 py-1 rounded text-xs transition-colors ${
                                    (dimensionSelections.skillTree || []).includes(skill)
                                      ? 'bg-[#7c3aed] text-white'
                                      : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                                  }`}
                                >
                                  {skill}
                                </button>
                              ))}
                              {customOptions.skillTree?.map(opt => (
                                <button
                                  key={`custom-${opt}`}
                                  onClick={() => toggleDimensionSelection('skillTree', opt, true)}
                                  className={`px-2 py-1 rounded text-xs transition-colors ${
                                    (dimensionSelections.skillTree || []).includes(opt)
                                      ? 'bg-[#7c3aed] text-white'
                                      : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                                  }`}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 对话风格 */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => setDimensionSectionsExpanded(prev => ({ ...prev, style: !prev.style }))}
                            className="flex items-center justify-between flex-1 text-xs font-medium text-gray-700 dark:text-gray-300"
                          >
                            <span>对话风格（多选）</span>
                            {dimensionSectionsExpanded.style ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => openAddOptionDialog('gameConversationStyle')}
                            className="ml-2 w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                            title="添加自定义选项"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        {dimensionSectionsExpanded.style && (
                          <div className="pl-2 space-y-1.5">
                            <div className="flex flex-wrap gap-2">
                              {GAME_CONVERSATION_STYLES.map(style => (
                                <button
                                  key={style}
                                  onClick={() => toggleDimensionSelection('gameConversationStyle', style, true)}
                                  className={`px-2 py-1 rounded text-xs transition-colors ${
                                    (dimensionSelections.gameConversationStyle || []).includes(style)
                                      ? 'bg-[#7c3aed] text-white'
                                      : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                                  }`}
                                >
                                  {style}
                                </button>
                              ))}
                              {customOptions.gameConversationStyle?.map(opt => (
                                <button
                                  key={`custom-${opt}`}
                                  onClick={() => toggleDimensionSelection('gameConversationStyle', opt, true)}
                                  className={`px-2 py-1 rounded text-xs transition-colors ${
                                    (dimensionSelections.gameConversationStyle || []).includes(opt)
                                      ? 'bg-[#7c3aed] text-white'
                                      : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#404040]'
                                  }`}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* 头像风格（共同） */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setDimensionSectionsExpanded(prev => ({ ...prev, avatar: !prev.avatar }))}
                        className="flex items-center justify-between flex-1 text-xs font-medium text-gray-700 dark:text-gray-300"
                      >
                        <span>头像风格</span>
                        {dimensionSectionsExpanded.avatar ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => openAddOptionDialog('avatarStyle')}
                        className="ml-2 w-5 h-5 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:bg-[#6d28d9] transition-colors"
                        title="添加自定义选项"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    {dimensionSectionsExpanded.avatar && (
                      <div className="pl-2">
                        <Select
                          value={dimensionSelections.avatarStyle || '不限'}
                          onValueChange={(v) => setDimensionSelections(prev => ({ ...prev, avatarStyle: v === '不限' ? null : v }))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="不限">不限</SelectItem>
                            {AVATAR_STYLES.map(style => (
                              <SelectItem key={style} value={style}>{style}</SelectItem>
                            ))}
                            {customOptions.avatarStyle?.map(opt => (
                              <SelectItem key={`custom-${opt}`} value={opt}>{opt}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </div>

                {/* 生成按钮 */}
                <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-[#404040]">
                  <Button
                    variant="primary"
                    onClick={() => generateRole()}
                    disabled={!selectedGeneratorLlmConfigId || isGenerating}
                    className="w-full"
                  >
                    {isGenerating ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        生成中...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4 mr-2" />
                        随机生成角色
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-900 dark:text-white">手动配置</div>
                
                {/* 角色描述/人设输入 */}
                <div className="flex-1 flex flex-col min-h-0">
                  <Label className="text-xs text-gray-600 dark:text-gray-400 mb-1.5 block">
                    角色描述 / 系统提示词（System Prompt）
                  </Label>
                  <Textarea
                    ref={manualInputRef}
                    value={manualInput}
                    onChange={handleManualInputChange}
                    onKeyDown={(e) => {
                      // 如果模块选择器显示，不处理键盘事件（由 CrawlerModuleSelector 处理）
                      if (showModuleSelector) return;
                      // 如果批次数据项选择器显示，不处理键盘事件（由 CrawlerBatchItemSelector 处理）
                      if (showBatchItemSelector) return;
                    }}
                    placeholder={`可直接粘贴完整的人设/系统提示词，点击"确认使用"即可创建角色

输入 "/" 可以引用爬虫批次数据

也可以输入简短描述，点击"AI扩写"让模型帮你生成完整人设

示例：
你是一位资深产品经理，具有10年互联网产品经验。

## 核心能力
- 需求分析与拆解
- 任务优先级排序
- 跨团队协作沟通

## 工作风格
- 逻辑清晰，结构化思维
- 注重可执行性
- 善于追问澄清需求`}
                    className="flex-1 min-h-[500px] text-sm font-mono resize-y"
                  />
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (!manualInput.trim()) {
                          toast({ title: '请输入角色描述', variant: 'destructive' });
                          return;
                        }
                        // 直接使用输入内容作为人设，不进行模型扩写
                        // 尝试从第一行提取角色名称
                        const firstLine = manualInput.split('\n')[0];
                        let name = '自定义角色';
                        // 尝试匹配常见的角色描述格式
                        const nameMatch = firstLine.match(/你是(?:一[位个名])?(.{1,15}?)(?:[，,。\.：:]|$)/);
                        if (nameMatch) {
                          name = nameMatch[1].trim();
                        } else if (firstLine.length <= 20) {
                          name = firstLine.replace(/^[#\s*]+/, '').trim() || name;
                        }
                        
                        setDraft({
                          name: name,
                          system_prompt: manualInput.trim(),
                          avatar: makeDefaultAvatar(name),
                          llm_config_id: selectedGeneratorLlmConfigId || enabledConfigs[0]?.config_id || '',
                        });
                        toast({ title: '已应用人设', description: '可在右侧预览，点击顶部"保存角色"完成创建', variant: 'success' });
                      }}
                      disabled={!manualInput.trim()}
                      className="flex-1"
                    >
                      <Check className="w-4 h-4 mr-1.5" />
                      确认使用
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => generateRole()}
                      disabled={!selectedGeneratorLlmConfigId || !manualInput.trim() || isGenerating}
                      className="flex-1"
                    >
                      {isGenerating ? (
                        <Loader className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <Wand2 className="w-4 h-4 mr-1.5" />
                      )}
                      AI扩写
                    </Button>
                  </div>
                </div>

                {/* 多轮打磨 */}
                {chatHistory.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-600 dark:text-gray-400">多轮打磨</Label>
                    <div className="max-h-48 overflow-y-auto space-y-2 p-2 bg-gray-50 dark:bg-[#1f1f1f] rounded-lg">
                      {chatHistory.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`text-xs p-2 rounded ${
                            msg.role === 'user'
                              ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-900 dark:text-blue-200'
                              : 'bg-gray-100 dark:bg-[#363636] text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {msg.content}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="继续补充：目标用户、输出格式、语气..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            generateRole(chatInput);
                            setChatInput('');
                          }
                        }}
                      />
                      <Button
                        variant="secondary"
                        onClick={() => {
                          generateRole(chatInput);
                          setChatInput('');
                        }}
                        disabled={!selectedGeneratorLlmConfigId || !chatInput.trim() || isGenerating}
                      >
                        发送
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 生成头像按钮（人设生成后显示，如果选择了头像生成模型或Agent） */}
            {draft.name && (selectedAvatarLlmConfigId || selectedAvatarAgentId) && (
              <div className="space-y-2 pt-4 border-t border-gray-200 dark:border-[#404040]">
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                  {enableAutoAvatar ? '已启用自动生成头像' : '可选：生成头像'}
                </div>
                
                {/* 生成进度状态 */}
                {avatarGenerationStatus && (
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-[#1f1f1f] rounded-lg">
                    <span className="text-xs text-gray-600 dark:text-gray-400">{avatarGenerationStatus}</span>
                    {isGeneratingAvatar && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={stopAvatarGeneration}
                        className="h-6 px-2 text-xs"
                      >
                        <X className="w-3 h-3 mr-1" />
                        停止
                      </Button>
                    )}
                  </div>
                )}

                <Button
                  variant="secondary"
                  onClick={generateAvatars}
                  disabled={isGeneratingAvatar || (avatarGenerationMode === 'direct' && !selectedAvatarLlmConfigId) || (avatarGenerationMode === 'agent' && !selectedAvatarAgentId)}
                  className="w-full"
                >
                  {isGeneratingAvatar ? (
                    <>
                      <Loader className="w-4 h-4 mr-2 animate-spin" />
                      生成头像中...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4 mr-2" />
                      生成头像
                    </>
                  )}
                </Button>
              </div>
            )}
            </>
            )}
          </div>
        </div>

        {/* 右侧预览区域 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-gray-50 dark:bg-[#1a1a1a]">
          <div className="max-w-2xl mx-auto space-y-6 pb-8">
            {/* 角色预览卡片 */}
            {draft.name ? (
              <>
                {/* 头像和名称 */}
                <div className="bg-white dark:bg-[#2d2d2d] rounded-xl p-6 shadow-sm border border-gray-200 dark:border-[#404040]">
                  <div className="flex items-start gap-4">
                    <div className="relative">
                      <img
                        src={draft.avatar}
                        alt={draft.name}
                        className="w-24 h-24 rounded-full object-cover border-2 border-gray-200 dark:border-[#404040]"
                      />
                      {(selectedAvatarLlmConfigId || selectedAvatarAgentId) && (
                        <button
                          onClick={generateAvatars}
                          disabled={isGeneratingAvatar}
                          className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[#7c3aed] text-white flex items-center justify-center shadow-lg hover:bg-[#6d28d9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title={generatedAvatars.length > 0 ? '重新生成头像' : '生成头像'}
                        >
                          {isGeneratingAvatar ? (
                            <Loader className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                    <div className="flex-1">
                      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">{draft.name}</h2>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        模型：{selectedGeneratorConfig?.name || '未选择'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 生成的头像列表（流式显示） */}
                {(generatedAvatars.length > 0 || isGeneratingAvatar) && (
                  <div className="bg-white dark:bg-[#2d2d2d] rounded-xl p-4 shadow-sm border border-gray-200 dark:border-[#404040]">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">选择头像</div>
                      {isGeneratingAvatar && avatarGenerationStatus && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                          <Loader className="w-3 h-3 animate-spin" />
                          {avatarGenerationStatus}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {/* 已生成的头像 */}
                      {generatedAvatars.map((avatar, idx) => (
                        <button
                          key={idx}
                          onClick={() => selectAvatar(idx)}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                            selectedAvatarIndex === idx
                              ? 'border-[#7c3aed] ring-2 ring-[#7c3aed]/20'
                              : 'border-gray-200 dark:border-[#404040] hover:border-gray-300 dark:hover:border-[#505050]'
                          }`}
                        >
                          <img
                            src={`data:${avatar.mimeType};base64,${avatar.data}`}
                            alt={`头像 ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          {selectedAvatarIndex === idx && (
                            <div className="absolute inset-0 bg-[#7c3aed]/20 flex items-center justify-center">
                              <Check className="w-6 h-6 text-white" />
                            </div>
                          )}
                        </button>
                      ))}
                      {/* 生成中的占位符 */}
                      {isGeneratingAvatar && generatedAvatars.length < 3 && (
                        Array.from({ length: 3 - generatedAvatars.length }).map((_, idx) => (
                          <div
                            key={`loading-${idx}`}
                            className="aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-[#404040] flex items-center justify-center bg-gray-50 dark:bg-[#1f1f1f]"
                          >
                            <Loader className="w-6 h-6 text-gray-400 animate-spin" />
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* 系统提示词 */}
                <div className="bg-white dark:bg-[#2d2d2d] rounded-xl p-6 shadow-sm border border-gray-200 dark:border-[#404040]">
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-3">系统提示词</div>
                  <Textarea
                    value={draft.system_prompt}
                    onChange={(e) => setDraft(prev => ({ ...prev, system_prompt: e.target.value }))}
                    className="min-h-[300px] font-mono text-xs"
                    placeholder="系统提示词..."
                  />
                </div>

                {/* 角色名称编辑 */}
                <div className="bg-white dark:bg-[#2d2d2d] rounded-xl p-4 shadow-sm border border-gray-200 dark:border-[#404040]">
                  <Label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">角色名称</Label>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="角色名称"
                  />
                </div>

                {/* 高级设置 - Persona 配置 */}
                <div className="bg-white dark:bg-[#2d2d2d] rounded-xl shadow-sm border border-gray-200 dark:border-[#404040] overflow-hidden">
                  <button
                    onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-[#363636] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Settings className="w-4 h-4 text-gray-500" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">高级设置</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        (语音、自驱思考、记忆触发)
                      </span>
                    </div>
                    {showAdvancedSettings ? (
                      <ChevronUp className="w-4 h-4 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                  {showAdvancedSettings && (
                    <div className="border-t border-gray-200 dark:border-[#404040]">
                      <AgentPersonaConfig
                        config={draft.persona || defaultPersonaConfig}
                        onChange={(persona) => setDraft(prev => ({ ...prev, persona }))}
                        compact
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center">
                  <Sparkles className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">
                    {mode === 'random' ? '点击左侧"随机生成角色"开始' : '在左侧输入角色描述并生成'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* 添加自定义选项对话框 */}
      <Dialog open={addOptionDialog.open} onOpenChange={(open) => setAddOptionDialog(prev => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加自定义选项</DialogTitle>
            <DialogDescription>
              为维度"{addOptionDialog.dimensionType}"添加自定义选项
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-sm text-gray-700 dark:text-gray-300 mb-2 block">选项值</Label>
              <Input
                value={addOptionDialog.currentValue}
                onChange={(e) => setAddOptionDialog(prev => ({ ...prev, currentValue: e.target.value }))}
                placeholder="请输入选项值"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveCustomOption();
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setAddOptionDialog({ open: false, dimensionType: '', roleType: 'career', currentValue: '' })}
              >
                取消
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveCustomOption}
                disabled={!addOptionDialog.currentValue.trim()}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* 爬虫模块选择器 */}
      {showModuleSelector && (
        <CrawlerModuleSelector
          query={moduleSelectorQuery}
          position={moduleSelectorPosition}
          onSelect={handleModuleSelect}
          onClose={() => {
            setShowModuleSelector(false);
            setModuleSelectorIndex(-1);
            setModuleSelectorQuery('');
          }}
        />
      )}
      
      {/* 批次数据项选择器 */}
      {showBatchItemSelector && selectedBatch && (
        <CrawlerBatchItemSelector
          batch={selectedBatch}
          position={batchItemSelectorPosition}
          onSelect={handleBatchItemSelect}
          onClose={() => {
            setShowBatchItemSelector(false);
            setSelectedBatch(null);
            setModuleSelectorIndex(-1);
            setModuleSelectorQuery('');
          }}
        />
      )}
    </div>
  );
};

export default RoleGeneratorPage;

