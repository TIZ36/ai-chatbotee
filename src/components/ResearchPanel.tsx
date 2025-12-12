import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, ChevronLeft, ChevronRight, Download, FileText, FolderOpen, Hand, Info, Link as LinkIcon, PanelLeftClose, PanelLeftOpen, Play, Plus, Search, Upload, Settings, X } from 'lucide-react';
import { createSession, getAgents, getSession, getSessionMessages, saveMessage, updateSessionAvatar, updateSessionLLMConfig, updateSessionSystemPrompt, type Session } from '../services/sessionApi';
import { getLLMConfig, getLLMConfigApiKey, getLLMConfigs, type LLMConfigFromDB } from '../services/llmApi';
import { LLMClient } from '../services/llmClient';
import { parseMentions } from '../services/roundTableApi';
import { addUrlSource, getSourceFileUrl, listSources, resolveSources, retrieve, uploadSources, type ResearchSource } from '../services/researchApi';

export interface ResearchPanelProps {
  chatSessionId: string | null;
  researchSessionId: string | null;
  onResearchSessionChange: (sessionId: string | null) => void;
  onExit: () => void;
}

type ResearchMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at?: string;
  // 前端仅用于流式更新定位，不入库
  local_id?: string;
};

type ResearchAgent = Pick<Session, 'session_id' | 'name' | 'avatar' | 'llm_config_id' | 'system_prompt'>;

const LS_RESEARCH_MAP_KEY = 'research_session_map_v1';
// 研究员（Researcher）是课题组里指定的一个 agent（负责：规划 + 组织）
const LS_RESEARCH_RESEARCHER_MAP = 'research_researcher_map_v1';
const LS_RESEARCH_SELECTED_AGENTS = 'research_selected_agents_v1';

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function extractPlainText(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractPlainText).join('');
  if (typeof node === 'object' && node.props && node.props.children) return extractPlainText(node.props.children);
  return '';
}

function replaceTextRange(text: string, start: number, end: number, replacement: string) {
  return text.slice(0, start) + replacement + text.slice(end);
}

function extractMarkdownHeadings(md: string): Array<{ index: number; level: number; text: string }> {
  const lines = String(md || '').split('\n');
  const headings: Array<{ index: number; level: number; text: string }> = [];
  let inFence = false;
  let idx = 0;
  for (const raw of lines) {
    const line = raw || '';
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (!m) continue;
    const level = m[1].length;
    let text = m[2].trim();
    // drop trailing # markers
    text = text.replace(/\s+#+\s*$/, '').trim();
    if (!text) continue;
    headings.push({ index: idx++, level, text });
  }
  return headings;
}

function getTriggerContext(text: string, caret: number): { trigger: '@' | '$'; start: number; query: string } | null {
  // Look backwards from caret to find nearest '@' or '$' that isn't preceded by a non-space char sequence breaker.
  // Stop at whitespace/newline.
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@' || ch === '$') {
      const trigger = ch as '@' | '$';
      const query = text.slice(i + 1, caret);
      // disallow spaces inside query
      if (/\s/.test(query)) return null;
      return { trigger, start: i, query };
    }
    if (/\s/.test(ch)) break;
  }
  return null;
}

const MarkdownArticle: React.FC<{ content: string; onSplitTask?: (task: string) => void; onAssignTask?: (task: string) => void }> = ({ content, onSplitTask, onAssignTask }) => {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-[#ffffff] markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          li: ({ children, ...props }: any) => {
            const isTask = typeof props.checked === 'boolean' || (props.className || '').includes('task-list-item');
            const text = extractPlainText(children).trim();
            return (
              <li className="group relative pr-16">
                {children}
                {isTask && text && onSplitTask && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSplitTask(text);
                    }}
                    className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded bg-gray-200/70 dark:bg-gray-700/60 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                    title="拆分为并发研究窗口"
                  >
                    Split
                  </button>
                )}
                {isTask && text && onAssignTask && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onAssignTask(text);
                    }}
                    className="absolute right-11 top-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded bg-[#7c3aed]/15 hover:bg-[#7c3aed]/25 text-[#7c3aed]"
                    title="分配给课题成员异步分析"
                  >
                    Assign
                  </button>
                )}
              </li>
            );
          },
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  );
};

const ORGANIZER_MARKER = '<!-- organizer_status -->';
const LS_RESEARCH_PROGRESS_WIDTH = 'research_progress_width_v1';
const LS_RESEARCH_PROGRESS_FONT_PX = 'research_progress_font_px_v1';

const ProgressMarkdown: React.FC<{ content: string }> = ({ content }) => {
  let headingIndex = 0;
  const makeHeading =
    (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
    // eslint-disable-next-line react/display-name
    ({ node, ...props }: any) => {
      const idx = headingIndex++;
      return React.createElement(Tag, { ...props, 'data-heading-index': idx });
    };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: makeHeading('h1'),
        h2: makeHeading('h2'),
        h3: makeHeading('h3'),
        h4: makeHeading('h4'),
        h5: makeHeading('h5'),
        h6: makeHeading('h6'),
      }}
    >
      {content || ''}
    </ReactMarkdown>
  );
};

const ResearchPanel: React.FC<ResearchPanelProps> = ({
  chatSessionId,
  researchSessionId,
  onResearchSessionChange,
  onExit,
}) => {
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);

  const [allAgents, setAllAgents] = useState<ResearchAgent[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<ResearchAgent[]>(() => {
    const stored = safeJsonParse<string[]>(localStorage.getItem(LS_RESEARCH_SELECTED_AGENTS), []);
    return stored.map(session_id => ({ session_id } as ResearchAgent));
  });
  
  // 研究员（课题组指定成员）
  const [researcherAgentId, setResearcherAgentId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showResearcherSettings, setShowResearcherSettings] = useState(false);
  const [sourcesCollapsed, setSourcesCollapsed] = useState<boolean>(true);

  const [messages, setMessages] = useState<ResearchMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  // Sources
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [pinnedSourceIds, setPinnedSourceIds] = useState<string[]>([]);
  const [panelDragOver, setPanelDragOver] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [retrieveQuery, setRetrieveQuery] = useState('');
  const [retrieveResults, setRetrieveResults] = useState<Array<{ doc_id: string; source_id: string; rel_path?: string; score: number; snippet: string }>>([]);
  const [isRetrieving, setIsRetrieving] = useState(false);
  
  // 研究员设置草稿
  const [researcherDraftId, setResearcherDraftId] = useState<string | null>(null);
  const [researcherDraftAvatar, setResearcherDraftAvatar] = useState<string>('');
  const [researcherDraftPrompt, setResearcherDraftPrompt] = useState<string>('');
  const [researcherDraftLLMConfigId, setResearcherDraftLLMConfigId] = useState<string | null>(null);
  const [isSavingResearcher, setIsSavingResearcher] = useState(false);
  
  // 并发研究窗口
  type WindowStatus = 'idle' | 'running' | 'done';
  type ResearchWindowMessage = { role: 'user' | 'assistant'; content: string; createdAt: number };
  type ResearchWindow = {
    id: string;
    title: string;
    status: WindowStatus;
    collapsed: boolean;
    assignedAgentIds: string[];
    messages: ResearchWindowMessage[];
    draft: string;
  };
  const [windows, setWindows] = useState<ResearchWindow[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  
  // TODO 分配弹窗
  const [assignTask, setAssignTask] = useState<string | null>(null);
  const [assignToAgentId, setAssignToAgentId] = useState<string | null>(null);
  
  // 输入框 @ / $ 自动补全
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [acOpen, setAcOpen] = useState(false);
  const [acType, setAcType] = useState<'mention' | 'source'>('mention');
  const [acQuery, setAcQuery] = useState('');
  const [acStart, setAcStart] = useState<number>(0);
  const [acIndex, setAcIndex] = useState(0);
  
  // 课题进展（由研究员/组织者自动更新）：显示在输入框下方
  const [organizerMarkdown, setOrganizerMarkdown] = useState<string>('');
  const [organizerUpdatedAt, setOrganizerUpdatedAt] = useState<number | null>(null);
  const [organizerRunning, setOrganizerRunning] = useState(false);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const [progressWidth, setProgressWidth] = useState<number>(() => {
    const raw = localStorage.getItem(LS_RESEARCH_PROGRESS_WIDTH);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 200 ? n : 420;
  });
  const [progressFontPx, setProgressFontPx] = useState<number>(() => {
    const raw = localStorage.getItem(LS_RESEARCH_PROGRESS_FONT_PX);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 11 && n <= 20 ? n : 13;
  });
  const progressScrollRef = useRef<HTMLDivElement>(null);

  const progressHeadings = useMemo(() => extractMarkdownHeadings(organizerMarkdown), [organizerMarkdown]);

  useEffect(() => {
    localStorage.setItem(LS_RESEARCH_PROGRESS_WIDTH, String(progressWidth));
  }, [progressWidth]);
  
  useEffect(() => {
    localStorage.setItem(LS_RESEARCH_PROGRESS_FONT_PX, String(progressFontPx));
  }, [progressFontPx]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const researcherAvatarInputRef = useRef<HTMLInputElement>(null);

  const pinnedSources = useMemo(() => {
    const map = new Map(sources.map(s => [s.source_id, s]));
    return pinnedSourceIds.map(id => map.get(id)).filter(Boolean) as ResearchSource[];
  }, [pinnedSourceIds, sources]);

  // 加载 LLM 配置列表
  useEffect(() => {
    (async () => {
      try {
        const configs = await getLLMConfigs();
        setLlmConfigs(configs);
      } catch (e) {
        console.warn('[Research] Failed to load llm configs:', e);
        setLlmConfigs([]);
      }
    })();
  }, []);

  // 初始化 researcher（按 researchSessionId 维度记忆）
  useEffect(() => {
    if (!researchSessionId) return;
    const map = safeJsonParse<Record<string, string>>(localStorage.getItem(LS_RESEARCH_RESEARCHER_MAP), {});
    const stored = map[researchSessionId];
    if (stored) {
      setResearcherAgentId(stored);
      return;
    }
    // 默认：选课题组第一个
    if (selectedAgents.length > 0 && selectedAgents[0]?.session_id) {
      setResearcherAgentId(selectedAgents[0].session_id);
    }
  }, [researchSessionId, selectedAgents]);
  
  // 同步 researcher 选择到 localStorage（按 researchSessionId）
  useEffect(() => {
    if (!researchSessionId || !researcherAgentId) return;
    const map = safeJsonParse<Record<string, string>>(localStorage.getItem(LS_RESEARCH_RESEARCHER_MAP), {});
    map[researchSessionId] = researcherAgentId;
    localStorage.setItem(LS_RESEARCH_RESEARCHER_MAP, JSON.stringify(map));
  }, [researchSessionId, researcherAgentId]);

  // 拉取 agent 列表，并用真实信息补全 selectedAgents
  useEffect(() => {
    (async () => {
      const agents = await getAgents();
      const asResearchAgents = (agents || []).map(a => ({
        session_id: a.session_id,
        name: a.name,
        avatar: a.avatar,
        llm_config_id: a.llm_config_id,
        system_prompt: a.system_prompt,
      }));
      setAllAgents(asResearchAgents);

      setSelectedAgents(prev => {
        const byId = new Map(asResearchAgents.map(a => [a.session_id, a]));
        return prev
          .map(p => byId.get(p.session_id) || p)
          .filter(p => !!p.session_id);
      });
    })();
  }, []);

  // 进入 research：为当前 chatSession 创建/复用 researchSession
  useEffect(() => {
    if (researchSessionId) return;

    (async () => {
      const chatId = chatSessionId || 'temporary-session';
      const map = safeJsonParse<Record<string, string>>(localStorage.getItem(LS_RESEARCH_MAP_KEY), {});
      const existing = map[chatId];
      if (existing) {
        onResearchSessionChange(existing);
        return;
      }

      try {
        const s = await createSession(undefined, `Research: ${chatId}`, 'research');
        const nextMap = { ...map, [chatId]: s.session_id };
        localStorage.setItem(LS_RESEARCH_MAP_KEY, JSON.stringify(nextMap));
        onResearchSessionChange(s.session_id);
      } catch (e) {
        console.error('[Research] Failed to create research session:', e);
      }
    })();
  }, [chatSessionId, onResearchSessionChange, researchSessionId]);

  // 加载 research 历史消息
  useEffect(() => {
    if (!researchSessionId) return;
    (async () => {
      try {
        const res = await getSessionMessages(researchSessionId, 1, 200);
        const asc = (res.messages || []).slice().reverse();
        const list = asc.map(m => ({ role: m.role, content: m.content, created_at: m.created_at }));
        setMessages(list);
        // 从历史中恢复最近一次组织者状态
        const lastOrg = [...list].reverse().find((m: any) => m?.role === 'assistant' && typeof m.content === 'string' && m.content.includes(ORGANIZER_MARKER));
        if (lastOrg?.content) {
          const md = String(lastOrg.content).replace(ORGANIZER_MARKER, '').trim();
          if (md) {
            setOrganizerMarkdown(md);
            setOrganizerUpdatedAt(Date.now());
          }
        }
      } catch (e) {
        console.warn('[Research] Failed to load research messages:', e);
        setMessages([]);
      }
    })();
  }, [researchSessionId]);
  
  // 加载 sources
  useEffect(() => {
    if (!researchSessionId) return;
    (async () => {
      try {
        const s = await listSources(researchSessionId);
        setSources(s);
      } catch (e) {
        console.warn('[Research] Failed to load sources:', e);
        setSources([]);
      }
    })();
  }, [researchSessionId]);

  // 同步 selectedAgents 到 localStorage
  useEffect(() => {
    const ids = selectedAgents.map(a => a.session_id).filter(Boolean);
    localStorage.setItem(LS_RESEARCH_SELECTED_AGENTS, JSON.stringify(ids));
  }, [selectedAgents]);
  
  // 打开研究员设置时加载草稿
  useEffect(() => {
    if (!showResearcherSettings) return;
    const id = researcherAgentId || (selectedAgents[0]?.session_id || null);
    setResearcherDraftId(id);
    (async () => {
      if (!id) return;
      try {
        const s = await getSession(id);
        setResearcherDraftAvatar(s.avatar || '');
        setResearcherDraftPrompt(s.system_prompt || '');
        setResearcherDraftLLMConfigId(s.llm_config_id || null);
      } catch (e) {
        console.warn('[Research] Failed to load researcher session:', e);
      }
    })();
  }, [researcherAgentId, selectedAgents, showResearcherSettings]);

  const documentMarkdown = useMemo(() => {
    if (messages.length === 0) {
      return [
        `## 开始研究`,
        ``,
        `- 在下方输入问题开始；或点击左侧 Sources 添加资料后再提问。`,
        `- 用法说明请点击标题旁的 \`Info\` 图标查看。`,
      ].join('\n');
    }

    const parts: string[] = [];
    for (const m of messages) {
      if (m.role === 'user') {
        parts.push(`## 问题\n\n${m.content}\n`);
      } else if (m.role === 'assistant') {
        // 组织者状态不渲染到正文（改为右侧面板）
        if (typeof m.content === 'string' && m.content.includes(ORGANIZER_MARKER)) continue;
        parts.push(`${m.content}\n`);
      }
    }
    return parts.join('\n---\n\n');
  }, [messages]);

  const buildSourcesReferenceMarkdown = useCallback(async (raw: string) => {
    if (!researchSessionId) return { text: raw, appended: '' };
    const pattern = /\$([\w\u4e00-\u9fa5\.\-\/]+)/g;
    const tokens = new Set<string>();
    let m;
    while ((m = pattern.exec(raw)) !== null) {
      if (m[1]) tokens.add(m[1]);
    }
    if (tokens.size === 0) return { text: raw, appended: '' };

    try {
      const res = await resolveSources({ session_id: researchSessionId, tokens: Array.from(tokens) });
      const items = res.resolved || [];
      const lines: string[] = [];
      lines.push('---');
      lines.push('');
      lines.push('## Sources 引用（由 $token 自动展开）');
      for (const it of items) {
        if (!it?.found) {
          lines.push(`- \`$${it.token}\`：未找到对应 source`);
          continue;
        }
        const s = it.source || {};
        const title = s.title || s.source_id;
        const type = s.source_type || 'unknown';
        if (type === 'url') {
          lines.push(`- \`$${it.token}\`（url）：[${title}](${it.url || s.url || ''})`);
        } else if (type === 'dir') {
          const dir = it.dir || {};
          lines.push(`- \`$${it.token}\`（dir）：**${title}**（已索引 ${dir.doc_count || 0} 篇文档）`);
          const sample = (dir.sample_paths || []).slice(0, 10);
          if (sample.length > 0) {
            lines.push(`  - 样例路径：`);
            for (const p of sample) lines.push(`    - ${p}`);
          }
          lines.push(`  - 可用“Sources检索”或在问题中描述要检索的关键词。`);
        } else {
          lines.push(`- \`$${it.token}\`（${type}）：**${title}**${s.mime_type ? ` · ${s.mime_type}` : ''}`);
          if (it.snippet) {
            lines.push('');
            lines.push('```text');
            lines.push(String(it.snippet).slice(0, 2500));
            lines.push('```');
          } else {
            lines.push(`  - （暂无可用文本片段；如为二进制/图片，可描述你希望提取的信息）`);
          }
        }
      }
      const appended = lines.join('\n');
      return { text: raw, appended };
    } catch (e) {
      return { text: raw, appended: `\n\n> ⚠️ Sources 引用解析失败：${e instanceof Error ? e.message : String(e)}\n` };
    }
  }, [researchSessionId]);

  useEffect(() => {
    // 保持滚动到底部
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [documentMarkdown]);

  const availableAgentsForPicker = useMemo(() => {
    const selected = new Set(selectedAgents.map(a => a.session_id));
    return allAgents.filter(a => !selected.has(a.session_id));
  }, [allAgents, selectedAgents]);
  
  const mentionCandidates = useMemo(() => {
    // mentionable: topic group members
    return selectedAgents
      .filter(a => a.session_id)
      .map(a => ({
        id: a.session_id,
        name: a.name || a.session_id.slice(0, 8),
        avatar: a.avatar,
      }));
  }, [selectedAgents]);
  
  const sourceCandidates = useMemo(() => {
    return sources.map(s => ({
      id: s.source_id,
      title: s.title || s.source_id,
      type: s.source_type,
    }));
  }, [sources]);
  
  const filteredMentionCandidates = useMemo(() => {
    const q = acQuery.trim().toLowerCase();
    const list = mentionCandidates;
    if (!q) return list;
    return list.filter(x => x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
  }, [acQuery, mentionCandidates]);
  
  const filteredSourceCandidates = useMemo(() => {
    const q = acQuery.trim().toLowerCase();
    const list = sourceCandidates;
    if (!q) return list;
    return list.filter(x => x.title.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
  }, [acQuery, sourceCandidates]);

  const researcherAgent = useMemo(() => {
    if (!researcherAgentId) return null;
    return (
      selectedAgents.find(a => a.session_id === researcherAgentId) ||
      allAgents.find(a => a.session_id === researcherAgentId) ||
      null
    );
  }, [allAgents, researcherAgentId, selectedAgents]);

  const handleAddAgent = (agent: ResearchAgent) => {
    setSelectedAgents(prev => [...prev, agent]);
  };

  const handleRemoveAgent = (session_id: string) => {
    if (session_id === researcherAgentId) {
      alert('研究员不可移除；如需更换，请在研究员设置中更换研究员。');
      return;
    }
    setSelectedAgents(prev => prev.filter(a => a.session_id !== session_id));
  };

  const buildLLMMessageHistory = (): Array<{ role: 'user' | 'assistant'; content: string }> => {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of messages) {
      if (m.role === 'user' || m.role === 'assistant') {
        // 不把组织者状态写入对话历史（避免污染上下文）
        if (m.role === 'assistant' && typeof m.content === 'string' && m.content.includes(ORGANIZER_MARKER)) continue;
        history.push({ role: m.role, content: m.content });
      }
    }
    // 限制长度，避免过长
    return history.slice(-30);
  };

  const runOrganizer = async (latestUserQuestion: string, latestAssistant: string) => {
    // 研究员承担组织者职责
    if (!researchSessionId) return;
    if (!researcherAgentId) return;
    try {
      setOrganizerRunning(true);
      const researcherSession = await getSession(researcherAgentId);
      const cfgId = researcherSession.llm_config_id || localStorage.getItem('current_llm_config_id') || '';
      if (!cfgId) return;
      const cfg = await getLLMConfig(cfgId);
      const apiKey = await getLLMConfigApiKey(cfgId);
      if (cfg.provider !== 'ollama' && !apiKey) return;

      const llm = new LLMClient({
        id: cfg.config_id,
        provider: cfg.provider,
        name: cfg.name,
        apiKey,
        apiUrl: cfg.api_url,
        model: cfg.model,
        enabled: cfg.enabled,
        metadata: cfg.metadata,
      });

      const basePrompt = (researcherSession.system_prompt || '你是研究员。') + '\n\n要求：中文Markdown，结构化，简洁，不要寒暄。';
      const organizerSystem = [
        basePrompt,
        '',
        '当前任务：你是“课题进展”组织者，需要把分散的信息收敛为可快速预览的进展卡片内容。',
        '',
        '写作要求：',
        '- 简略、概括、信息密度高（避免长篇解释）。',
        '- 强模块意识：用小标题表达“模块/子系统/工作流”，不要堆叠流水账。',
        '- 善用 Mermaid：当涉及流程/分工/依赖时，优先给出 1 个 mermaid 流程图（flowchart/sequence 均可）。',
        '- 把前后相关内容汇总到同一个部分：只保留一个「进展概览」段落（不要出现多个总结）。',
        '',
        '输出模板（尽量遵循）：',
        '## 进展概览',
        '- ...（3-6条要点）',
        '',
        '## 模块进展',
        '- 模块A：...',
        '- 模块B：...',
        '',
        '## 下一步（可并发）',
        '- [ ] ...',
        '',
        '## 风险与依赖',
        '- ...',
        '',
        '## 工作流（Mermaid）',
        '```mermaid',
        'flowchart TD',
        '  A[输入] --> B[分析]',
        '```',
      ].join('\n');
      const organizerInput = [
        `【最新问题】\n${latestUserQuestion}`,
        `【最新回答】\n${latestAssistant}`,
        `【当前课题进展】\n${organizerMarkdown || '(暂无)'}`,
        `【当前文章】\n${documentMarkdown}`,
      ].join('\n\n');

      // stream：实时更新课题进展卡片
      let acc = '';
      setOrganizerMarkdown('');
      const resp = await llm.handleUserRequestWithThinking(
        organizerInput,
        organizerSystem,
        undefined,
        true,
        (chunk) => {
          if (!chunk) return;
          acc += chunk;
          setOrganizerMarkdown(acc);
        },
        buildLLMMessageHistory()
      );

      const md = String(resp.content || acc || '').trim();
      if (!md) return;
      setOrganizerMarkdown(md);
      setOrganizerUpdatedAt(Date.now());

      // 仍然保存到消息历史，但用 marker 标记；正文渲染时会过滤
      const content = `${ORGANIZER_MARKER}\n${md}\n`;
      const message_id = `org-${Date.now()}`;
      setMessages(prev => [...prev, { role: 'assistant', content }]);
      await saveMessage(researchSessionId, { message_id, role: 'assistant', content, model: cfg.model || 'unknown' });
    } catch (e) {
      console.warn('[Research] Organizer failed:', e);
    } finally {
      setOrganizerRunning(false);
    }
  };

  const handleSend = async () => {
    if (!researchSessionId) return;
    const text = input.trim();
    if (!text) return;
    if (!researcherAgentId) {
      alert('请先在课题组中指定研究员（点击研究员头像设置）');
      return;
    }

    setIsSending(true);
    setInput('');

    // $source 引用展开
    const expanded = await buildSourcesReferenceMarkdown(text);
    const finalUserContent = expanded.appended ? `${expanded.text}\n\n${expanded.appended}` : expanded.text;

    const userMessageId = `r-user-${Date.now()}`;
    setMessages(prev => [...prev, { role: 'user', content: finalUserContent }]);
    try {
      await saveMessage(researchSessionId, { message_id: userMessageId, role: 'user', content: finalUserContent, model: 'user' });
    } catch (e) {
      console.warn('[Research] Failed to save user message:', e);
    }

    try {
      // 解析 @ 提及：只允许已加入课题组的 agent 响应
      const participants = selectedAgents
        .filter(a => a.session_id && a.name)
        .map(a => ({ session_id: a.session_id, name: a.name! })) as any;
      const mentions = parseMentions(finalUserContent, participants);
      const mentionedAgents = selectedAgents.filter(a => mentions.includes(a.session_id));

      // 无 @ 时：由研究模型拆解问题并给出 TODO
      if (mentionedAgents.length === 0) {
        const researcherSession = await getSession(researcherAgentId);
        const cfgId = researcherSession.llm_config_id || localStorage.getItem('current_llm_config_id') || '';
        if (!cfgId) throw new Error('研究员未配置模型');
        const cfg = await getLLMConfig(cfgId);
        const apiKey = await getLLMConfigApiKey(cfgId);
        if (cfg.provider !== 'ollama' && !apiKey) {
          throw new Error('研究模型 API Key 未配置');
        }

        const llm = new LLMClient({
          id: cfg.config_id,
          provider: cfg.provider,
          name: cfg.name,
          apiKey,
          apiUrl: cfg.api_url,
          model: cfg.model,
          enabled: cfg.enabled,
          metadata: cfg.metadata,
        });

        const basePrompt = (researcherSession.system_prompt || '你是研究员。') + '\n\n要求：中文Markdown，结构化，简洁，不要寒暄。';
        const systemPrompt = [
          basePrompt,
          '',
          '当前任务：规划/拆解（用户未@任何课题组成员）。',
          '你需要：',
          '1) 分析问题的解决方式与可能的未知点',
          '2) 给出任务划分（可并发）',
          '3) 给出清晰可执行的 TODO 列表（markdown checklist）',
          '4) 以“文章组织形式”输出（Markdown）',
          '',
          '输出结构建议：',
          '- 摘要',
          '- 关键假设/风险',
          '- 任务划分（并发）',
          '- TODO',
          '- 需要的资料（Sources）',
        ].join('\n');

        // 研究员回答：stream 模式
        const local_id = `asst-local-${Date.now()}`;
        const assistantMessageId = `r-asst-${Date.now()}`;
        setMessages(prev => [...prev, { role: 'assistant', content: '', local_id }]);

        let acc = '';
        const resp = await llm.handleUserRequestWithThinking(
          finalUserContent,
          systemPrompt,
          undefined,
          true,
          (chunk) => {
            if (!chunk) return;
            acc += chunk;
            setMessages(prev =>
              prev.map(m => (m.local_id === local_id ? { ...m, content: acc } : m))
            );
          },
          buildLLMMessageHistory()
        );

        const finalContent = String(resp.content || acc || '').trim();
        setMessages(prev =>
          prev.map(m => (m.local_id === local_id ? { ...m, content: finalContent } : m))
        );
        await saveMessage(researchSessionId, { message_id: assistantMessageId, role: 'assistant', content: finalContent, model: cfg.model || 'unknown' });

        // 自动运行 Organizer
        await runOrganizer(finalUserContent, finalContent);
        return;
      }

      // 有 @：只触发被 @ 的 agent
      const outputs: string[] = [];
      for (const agent of mentionedAgents) {
        try {
          const agentSession = await getSession(agent.session_id);
          const agentConfigId = agentSession.llm_config_id || (await getSession(researcherAgentId)).llm_config_id || localStorage.getItem('current_llm_config_id') || null;
          if (!agentConfigId) continue;

          const cfg = await getLLMConfig(agentConfigId);
          const apiKey = await getLLMConfigApiKey(agentConfigId);
          if (cfg.provider !== 'ollama' && !apiKey) continue;

          const llm = new LLMClient({
            id: cfg.config_id,
            provider: cfg.provider,
            name: cfg.name,
            apiKey,
            apiUrl: cfg.api_url,
            model: cfg.model,
            enabled: cfg.enabled,
            metadata: cfg.metadata,
          });

          const agentPrompt = agentSession.system_prompt || '你是一个研究助理。请用中文、结构化Markdown回答。';
          const agentInput = [
            `【课题上下文】`,
            documentMarkdown,
            ``,
            `【用户问题】`,
            finalUserContent,
          ].join('\n');

          const resp = await llm.handleUserRequestWithThinking(
            agentInput,
            agentPrompt,
            undefined,
            false,
            undefined,
            buildLLMMessageHistory()
          );

          outputs.push(`### @${agentSession.name || agent.session_id}\n\n${resp.content}\n`);
        } catch (e) {
          outputs.push(`### @${agent.name || agent.session_id}\n\n（生成失败：${e instanceof Error ? e.message : String(e)}）\n`);
        }
      }

        const merged = outputs.join('\n');
        const assistantMessageId = `r-asst-${Date.now()}`;
        // agents 回答保持非 stream（目前这里是合并后一次性输出）
        setMessages(prev => [...prev, { role: 'assistant', content: merged }]);
        await saveMessage(researchSessionId, { message_id: assistantMessageId, role: 'assistant', content: merged, model: 'agents' });

      await runOrganizer(finalUserContent, merged);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const content = `> ❌ Research 生成失败：${err}\n`;
      setMessages(prev => [...prev, { role: 'assistant', content }]);
      try {
        await saveMessage(researchSessionId, { role: 'assistant', content, model: 'error' });
      } catch {}
    } finally {
      setIsSending(false);
    }
  };
  
  const updateAutocomplete = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const ctx = getTriggerContext(el.value, caret);
    if (!ctx) {
      setAcOpen(false);
      return;
    }
    setAcOpen(true);
    setAcType(ctx.trigger === '@' ? 'mention' : 'source');
    setAcQuery(ctx.query);
    setAcStart(ctx.start);
    setAcIndex(0);
  }, []);
  
  const pickAutocomplete = useCallback((label: string) => {
    const el = inputRef.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const before = el.value;
    const replacement = label + ' ';
    const next = replaceTextRange(before, acStart, caret, replacement);
    setInput(next);
    setAcOpen(false);
    // move caret after inserted token
    requestAnimationFrame(() => {
      el.focus();
      const pos = acStart + replacement.length;
      el.setSelectionRange(pos, pos);
    });
  }, [acStart]);

  const pinSource = useCallback((sourceId: string) => {
    if (!sourceId) return;
    setPinnedSourceIds(prev => (prev.includes(sourceId) ? prev : [sourceId, ...prev]));
    // also insert $token if we can
    const s = sources.find(x => x.source_id === sourceId);
    const token = s?.title || s?.source_id;
    if (token) {
      setInput(prev => (prev ? `${prev} $${token}` : `$${token}`));
    }
  }, [sources]);

  const handleDropFilesToPanel = useCallback(async (files: File[]) => {
    if (!researchSessionId) return;
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      const created = await uploadSources({ session_id: researchSessionId, files });
      const s = await listSources(researchSessionId);
      setSources(s);
      const createdSources: ResearchSource[] = (created as any)?.sources || [];
      if (createdSources.length > 0) {
        setPinnedSourceIds(prev => {
          const next = [...prev];
          for (const it of createdSources) {
            if (!next.includes(it.source_id)) next.unshift(it.source_id);
          }
          return next;
        });
      }
    } catch (err) {
      alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsUploading(false);
    }
  }, [researchSessionId]);

  const enabledConfigs = useMemo(() => llmConfigs.filter(c => c.enabled), [llmConfigs]);
  const researcherBadgeText = useMemo(() => {
    if (!researcherAgent) return '未指定研究员';
    return `研究员：${researcherAgent.name || researcherAgent.session_id}`;
  }, [researcherAgent]);
  
  const helpMarkdown = useMemo(() => {
    return [
      '## Research 用法',
      '',
      '### 1) 课题组与研究员',
      '- 在输入框上方添加课题组成员（小头像）。',
      '- 研究员是课题组中指定的一个 Agent（承担：规划 + 组织）。点击研究员头像可设置头像/人设/模型。',
      '',
      '### 2) 提问规则',
      '- **不 @ 任何人**：由研究员分析问题、拆解任务，并输出 TODO checklist（Markdown）。',
      '- **@ 某个成员**：只有被 @ 的成员会回答；未 @ 的不会主动回答。',
      '',
      '### 3) 并发研究窗口',
      '- 在文章里的 TODO 项右侧 hover 出现 **Split**，点击可拆分出并发研究窗口。',
      '- 研究窗口可指派课题组成员负责，支持追问与“举手(完成)”状态。',
      '',
      '### 4) Sources（资料区）',
      '- 左侧虚线框支持添加 URL / 上传文件 / 上传目录并索引；也支持拖拽上传。',
      '- 可在 Sources 下方检索已索引的文本片段，点击会自动填入输入框作为研究任务提示。',
      '',
      '### 5) 导出',
      '- 右上角下载按钮可将当前研究报告保存为 `.md`。',
    ].join('\\n');
  }, []);
  
  const splitTaskToWindow = useCallback((task: string) => {
    const id = `rw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const w: ResearchWindow = {
      id,
      title: task.slice(0, 80),
      status: 'idle',
      collapsed: false,
      assignedAgentIds: [],
      messages: [{ role: 'user', content: `请研究并解决：${task}`, createdAt: Date.now() }],
      draft: '',
    };
    setWindows(prev => [w, ...prev]);
    setActiveWindowId(id);
  }, []);
  
  const activeWindow = useMemo(() => windows.find(w => w.id === activeWindowId) || null, [activeWindowId, windows]);
  
  const updateWindow = useCallback((id: string, patch: Partial<ResearchWindow>) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)));
  }, []);
  
  const appendWindowMessage = useCallback((id: string, msg: ResearchWindowMessage) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, messages: [...w.messages, msg] } : w)));
  }, []);
  
  const runWindowResearch = useCallback(async (windowId: string) => {
    const w = windows.find(x => x.id === windowId);
    if (!w) return;
    if (!researchSessionId) return;
    if (!researcherAgentId && w.assignedAgentIds.length === 0) {
      alert('请先指定研究员，或在窗口内指定一个智能体负责');
      return;
    }
    
    updateWindow(windowId, { status: 'running' });
    try {
      // 提交窗口内草稿为一条 user 消息（追问）
      const draft = (w.draft || '').trim();
      let effectiveMessages = w.messages;
      if (draft) {
        const userMsg: ResearchWindowMessage = { role: 'user', content: draft, createdAt: Date.now() };
        appendWindowMessage(windowId, userMsg);
        updateWindow(windowId, { draft: '' });
        effectiveMessages = [...w.messages, userMsg];
      }

      const agentId = w.assignedAgentIds[0] || null;
      let cfgId: string | null = null;
      let systemPrompt = [
        `你是并发研究窗口中的研究助理。`,
        `你需要针对窗口标题对应的问题，给出可验证的结论、关键依据、以及下一步行动建议。`,
        `输出为中文 Markdown，结构化、简洁。`,
      ].join('\n');

      if (agentId) {
        const agentSession = await getSession(agentId);
        cfgId = agentSession.llm_config_id || cfgId;
        systemPrompt = agentSession.system_prompt || systemPrompt;
      } else if (researcherAgentId) {
        const researcherSession = await getSession(researcherAgentId);
        cfgId = researcherSession.llm_config_id || null;
        systemPrompt = researcherSession.system_prompt || systemPrompt;
      }

      if (!cfgId) throw new Error('没有可用模型配置');

      const cfg = await getLLMConfig(cfgId);
      const apiKey = await getLLMConfigApiKey(cfgId);
      if (cfg.provider !== 'ollama' && !apiKey) {
        throw new Error('API Key 未配置');
      }

      const llm = new LLMClient({
        id: cfg.config_id,
        provider: cfg.provider,
        name: cfg.name,
        apiKey,
        apiUrl: cfg.api_url,
        model: cfg.model,
        enabled: cfg.enabled,
        metadata: cfg.metadata,
      });

      const sourcesBrief = sources.slice(0, 20).map(s => `- (${s.source_type}) ${s.title || s.url || s.source_id}`).join('\n');
      const windowHistory = effectiveMessages
        .slice(-12)
        .map(m => `${m.role === 'user' ? '用户' : '研究者'}：${m.content}`)
        .join('\n\n');

      const userInput = [
        `【窗口标题】`,
        w.title,
        ``,
        `【主文章上下文】`,
        documentMarkdown,
        ``,
        `【Sources（摘要）】`,
        sourcesBrief || '(无)',
        ``,
        `【窗口对话】`,
        windowHistory || '(无)',
      ].join('\n');

      const messageHistory = effectiveMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content })) as any;

      const resp = await llm.handleUserRequestWithThinking(
        userInput,
        systemPrompt,
        undefined,
        false,
        undefined,
        messageHistory
      );

      appendWindowMessage(windowId, { role: 'assistant', content: resp.content, createdAt: Date.now() });
      updateWindow(windowId, { status: 'idle' });
      return;
    } catch (e) {
      appendWindowMessage(windowId, { role: 'assistant', content: `> ❌ 研究失败：${e instanceof Error ? e.message : String(e)}\n`, createdAt: Date.now() });
      updateWindow(windowId, { status: 'idle' });
      return;
    } finally {
      // 如果用户手动标记 done，保持 done；否则从 running 回到 idle
      setWindows(prev => prev.map(win => (win.id === windowId && win.status === 'running' ? { ...win, status: 'idle' } : win)));
    }
  }, [
    appendWindowMessage,
    documentMarkdown,
    researcherAgentId,
    researchSessionId,
    sources,
    updateWindow,
    windows,
  ]);
  
  const assignTaskToAgent = useCallback((task: string, agentId: string) => {
    const id = `rw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const w: ResearchWindow = {
      id,
      title: task.slice(0, 80),
      status: 'running',
      collapsed: false,
      assignedAgentIds: [agentId],
      messages: [{ role: 'user', content: `请研究并解决：${task}`, createdAt: Date.now() }],
      draft: '',
    };
    setWindows(prev => [w, ...prev]);
    setActiveWindowId(id);
    // 异步触发研究，不阻塞 UI
    setTimeout(() => runWindowResearch(id), 50);
  }, [runWindowResearch]);
  
  const triggerOrganizerRefresh = useCallback(async () => {
    // 从当前消息里找最新的 user / assistant（排除 organizer marker）作为输入
    let latestUser = '';
    let latestAssistant = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as any;
      if (!latestAssistant && m?.role === 'assistant' && typeof m.content === 'string' && !m.content.includes(ORGANIZER_MARKER)) {
        latestAssistant = m.content;
      }
      if (!latestUser && m?.role === 'user' && typeof m.content === 'string') {
        latestUser = m.content;
      }
      if (latestUser && latestAssistant) break;
    }
    if (!latestUser && !latestAssistant) return;
    await runOrganizer(latestUser || '(无最新问题)', latestAssistant || '(无最新回答)');
  }, [messages, runOrganizer]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 顶部栏 */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-transparent bg-white/70 dark:bg-[#262626]/70 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onExit}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-[#b0b0b0]"
              title="退出 Research"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-[#e0e0e0]">
              <BookOpen className="w-4 h-4 text-[#7c3aed]" />
              <span className="font-medium">Research</span>
              <button
                onClick={() => setShowHelp(true)}
                className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-[#b0b0b0]"
                title="Research 用法"
              >
                <Info className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex justify-center">
            <div className="text-xs text-gray-500 dark:text-[#a0a0a0] truncate max-w-[55%]" title={researcherBadgeText}>
              {researcherBadgeText}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowResearcherSettings(true)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-[#b0b0b0]"
              title="研究员设置（头像/人设/模型）"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const name = (chatSessionId || 'research').replace(/[^\w\u4e00-\u9fa5-]/g, '_');
                downloadTextFile(`${name}_research.md`, documentMarkdown);
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-[#b0b0b0]"
              title="下载研究报告（Markdown）"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Help 弹窗（Info） */}
      {showHelp && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">Research 用法</div>
              <button
                onClick={() => setShowHelp(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-[#b0b0b0]"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 max-h-[70vh] overflow-auto">
              <MarkdownArticle content={helpMarkdown} />
            </div>
          </div>
        </div>
      )}
      
      {/* 研究员设置弹窗（研究员是课题组指定成员） */}
      {showResearcherSettings && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">研究员设置（头像 / 人设 / 模型）</div>
              <button
                onClick={() => setShowResearcherSettings(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-[#b0b0b0]"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-20 text-xs text-gray-500 dark:text-[#a0a0a0]">研究员</div>
                <select
                  value={researcherDraftId || ''}
                  onChange={async (e) => {
                    const v = e.target.value || null;
                    setResearcherDraftId(v);
                    if (!v) return;
                    // 保证研究员属于课题组
                    if (!selectedAgents.some(a => a.session_id === v)) {
                      const a = allAgents.find(x => x.session_id === v);
                      if (a) setSelectedAgents(prev => [a, ...prev]);
                    }
                    try {
                      const s = await getSession(v);
                      setResearcherDraftAvatar(s.avatar || '');
                      setResearcherDraftPrompt(s.system_prompt || '');
                      setResearcherDraftLLMConfigId(s.llm_config_id || null);
                    } catch {}
                  }}
                  className="flex-1 text-xs px-2 py-1 rounded-lg bg-white dark:bg-[#1f1f1f] border border-gray-200 dark:border-[#404040] text-gray-700 dark:text-[#e0e0e0] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/40"
                >
                  <option value="" disabled>
                    请选择课题组成员…
                  </option>
                  {selectedAgents.map(a => (
                    <option key={a.session_id} value={a.session_id}>
                      {a.name || a.session_id}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="w-20 text-xs text-gray-500 dark:text-[#a0a0a0]">头像</div>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full overflow-hidden border border-gray-200 dark:border-[#404040] bg-gray-100 dark:bg-[#363636] flex items-center justify-center">
                    {researcherDraftAvatar ? (
                      <img src={researcherDraftAvatar} alt="researcher avatar" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-gray-500">R</span>
                    )}
                  </div>
                  <button
                    onClick={() => researcherAvatarInputRef.current?.click()}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#363636] text-gray-700 dark:text-[#e0e0e0]"
                  >
                    选择图片
                  </button>
                  {researcherDraftAvatar && (
                    <button
                      onClick={() => setResearcherDraftAvatar('')}
                      className="px-3 py-2 text-sm rounded-lg text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
                    >
                      清除
                    </button>
                  )}
                  <input
                    ref={researcherAvatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.currentTarget.value = '';
                      if (!file) return;
                      try {
                        const dataUrl = await readFileAsDataUrl(file);
                        setResearcherDraftAvatar(dataUrl);
                      } catch (err) {
                        alert(`读取头像失败：${err instanceof Error ? err.message : String(err)}`);
                      }
                    }}
                  />
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="w-20 text-xs text-gray-500 dark:text-[#a0a0a0]">模型</div>
                <select
                  value={researcherDraftLLMConfigId || ''}
                  onChange={(e) => setResearcherDraftLLMConfigId(e.target.value || null)}
                  className="flex-1 text-xs px-2 py-1 rounded-lg bg-white dark:bg-[#1f1f1f] border border-gray-200 dark:border-[#404040] text-gray-700 dark:text-[#e0e0e0] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/40"
                >
                  <option value="">（不设置，使用系统默认）</option>
                  {enabledConfigs.map(c => (
                    <option key={c.config_id} value={c.config_id}>
                      {c.name} ({c.provider}/{c.model || 'default'})
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="space-y-2">
                <div className="text-xs text-gray-500 dark:text-[#a0a0a0]">人设（系统提示词）</div>
                <textarea
                  value={researcherDraftPrompt}
                  onChange={(e) => setResearcherDraftPrompt(e.target.value)}
                  placeholder="研究员的人设与工作方式…"
                  className="w-full min-h-[180px] px-3 py-2 text-sm rounded-lg bg-gray-50 dark:bg-[#1f1f1f] border border-gray-200 dark:border-[#404040] text-gray-900 dark:text-[#e0e0e0] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/40"
                />
              </div>
              
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowResearcherSettings(false)}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#363636] text-gray-700 dark:text-[#e0e0e0]"
                >
                  取消
                </button>
                <button
                  disabled={!researcherDraftId || isSavingResearcher}
                  onClick={async () => {
                    if (!researcherDraftId) return;
                    setIsSavingResearcher(true);
                    try {
                      await updateSessionAvatar(researcherDraftId, researcherDraftAvatar || '');
                      await updateSessionSystemPrompt(researcherDraftId, researcherDraftPrompt || null);
                      await updateSessionLLMConfig(researcherDraftId, researcherDraftLLMConfigId || null);
                      
                      setResearcherAgentId(researcherDraftId);
                      // 同步本地 agent 列表展示
                      const refreshed = await getSession(researcherDraftId);
                      setSelectedAgents(prev => prev.map(a => (a.session_id === researcherDraftId ? { ...a, ...refreshed } as any : a)));
                      setAllAgents(prev => prev.map(a => (a.session_id === researcherDraftId ? { ...a, ...refreshed } as any : a)));
                      
                      setShowResearcherSettings(false);
                    } catch (err) {
                      alert(`保存失败：${err instanceof Error ? err.message : String(err)}`);
                    } finally {
                      setIsSavingResearcher(false);
                    }
                  }}
                  className="px-3 py-2 text-sm rounded-lg bg-[#7c3aed] hover:bg-[#6d28d9] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingResearcher ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TODO 分配弹窗：点击文章中的 TODO 项可分配给成员异步研究 */}
      {assignTask && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-[#2d2d2d] border border-gray-200 dark:border-[#404040] shadow-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">分配 TODO 异步分析</div>
              <button
                onClick={() => setAssignTask(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-[#b0b0b0]"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-sm text-gray-800 dark:text-[#e0e0e0]">
                <div className="text-xs text-gray-500 dark:text-[#a0a0a0] mb-1">任务</div>
                <div className="rounded-lg border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#1f1f1f] p-2">
                  {assignTask}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-20 text-xs text-gray-500 dark:text-[#a0a0a0]">分配给</div>
                <select
                  value={assignToAgentId || ''}
                  onChange={(e) => setAssignToAgentId(e.target.value || null)}
                  className="flex-1 text-xs px-2 py-1 rounded-lg bg-white dark:bg-[#1f1f1f] border border-gray-200 dark:border-[#404040] text-gray-700 dark:text-[#e0e0e0] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/40"
                >
                  <option value="" disabled>
                    选择课题成员…
                  </option>
                  {selectedAgents.map(a => (
                    <option key={a.session_id} value={a.session_id}>
                      {a.name || a.session_id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setAssignTask(null)}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#363636] text-gray-700 dark:text-[#e0e0e0]"
                >
                  取消
                </button>
                <button
                  disabled={!assignToAgentId}
                  onClick={() => {
                    if (!assignTask || !assignToAgentId) return;
                    assignTaskToAgent(assignTask, assignToAgentId);
                    setAssignTask(null);
                  }}
                  className="px-3 py-2 text-sm rounded-lg bg-[#7c3aed] hover:bg-[#6d28d9] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  分配并开始
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 主体：三列布局 - Sources | 文章+输入 | 课题进展 */}
      <div className="flex-1 min-h-0 flex">
        {/* 左侧 Sources */}
        {!sourcesCollapsed && (
          <div className="w-[220px] flex-shrink-0 bg-[#fafafa] dark:bg-[#232323]">
          <div
            className="h-full p-3 flex flex-col min-h-0"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!researchSessionId) return;
              const files = Array.from(e.dataTransfer.files || []);
              if (files.length === 0) return;
              setIsUploading(true);
              try {
                await uploadSources({ session_id: researchSessionId, files });
                const s = await listSources(researchSessionId);
                setSources(s);
              } catch (err) {
                alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setIsUploading(false);
              }
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-600 dark:text-[#b0b0b0] uppercase tracking-wide">Sources</div>
              <div className="flex items-center gap-0.5">
                <button
                  className="p-1 rounded hover:bg-white dark:hover:bg-[#404040] text-gray-500 dark:text-[#808080]"
                  title="上传文件"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5" />
                </button>
                <button
                  className="p-1 rounded hover:bg-white dark:hover:bg-[#404040] text-gray-500 dark:text-[#808080]"
                  title="添加目录"
                  onClick={() => dirInputRef.current?.click()}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
                <button
                  className="p-1 rounded hover:bg-white dark:hover:bg-[#404040] text-gray-500 dark:text-[#808080]"
                  title="收起"
                  onClick={() => setSourcesCollapsed(true)}
                >
                  <PanelLeftClose className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 隐藏上传控件 */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={async (e) => {
                if (!researchSessionId) return;
                const files = Array.from(e.target.files || []);
                e.currentTarget.value = '';
                if (files.length === 0) return;
                setIsUploading(true);
                try {
                  await uploadSources({ session_id: researchSessionId, files });
                  const s = await listSources(researchSessionId);
                  setSources(s);
                } catch (err) {
                  alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setIsUploading(false);
                }
              }}
            />
            <input
              ref={dirInputRef}
              type="file"
              multiple
              className="hidden"
              // @ts-ignore - webkitdirectory is non-standard but supported in Chromium/Electron
              webkitdirectory="true"
              // @ts-ignore
              directory="true"
              onChange={async (e) => {
                if (!researchSessionId) return;
                const files = Array.from(e.target.files || []);
                e.currentTarget.value = '';
                if (files.length === 0) return;
                // 目录别名：取 webkitRelativePath 的第一级目录名
                const first = files[0] as any;
                const rel = (first?.webkitRelativePath || '').toString();
                const dirName = rel ? rel.split('/')[0] : `dir-${Date.now()}`;
                setIsUploading(true);
                try {
                  await uploadSources({ session_id: researchSessionId, files, upload_kind: 'dir', dir_alias: dirName });
                  const s = await listSources(researchSessionId);
                  setSources(s);
                } catch (err) {
                  alert(`目录索引失败：${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setIsUploading(false);
                }
              }}
            />

            {/* URL 添加 */}
            <div className="mt-2 flex gap-1">
              <div className="relative flex-1">
                <LinkIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 dark:text-[#707070]" />
                <input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && sourceUrl.trim() && researchSessionId) {
                      e.preventDefault();
                      (async () => {
                        const url = sourceUrl.trim();
                        setSourceUrl('');
                        try {
                          await addUrlSource({ session_id: researchSessionId, url });
                          const s = await listSources(researchSessionId);
                          setSources(s);
                        } catch (err) {
                          alert(`添加URL失败：${err instanceof Error ? err.message : String(err)}`);
                        }
                      })();
                    }
                  }}
                  placeholder="URL…"
                  className="w-full pl-6 pr-2 py-1 text-[11px] bg-white dark:bg-[#1f1f1f] border border-gray-200/70 dark:border-[#404040] rounded-md focus:outline-none focus:ring-1 focus:ring-[#7c3aed]/40 text-gray-800 dark:text-[#e0e0e0] placeholder-gray-400 dark:placeholder-[#606060]"
                />
              </div>
              <button
                disabled={!researchSessionId || !sourceUrl.trim()}
                onClick={async () => {
                  if (!researchSessionId) return;
                  const url = sourceUrl.trim();
                  if (!url) return;
                  setSourceUrl('');
                  try {
                    await addUrlSource({ session_id: researchSessionId, url });
                    const s = await listSources(researchSessionId);
                    setSources(s);
                  } catch (err) {
                    alert(`添加URL失败：${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
                className="px-2 py-1 text-[10px] rounded-md bg-[#7c3aed] hover:bg-[#6d28d9] text-white disabled:opacity-40 disabled:cursor-not-allowed"
                title="添加"
              >
                +
              </button>
            </div>

            {/* Sources 列表 */}
            <div className="mt-2 flex-1 min-h-0 overflow-auto space-y-0.5">
              {isUploading && (
                <div className="text-[10px] text-gray-500 dark:text-[#909090] py-1">上传中…</div>
              )}
              {sources.length === 0 && !isUploading && (
                <div className="text-[10px] text-gray-400 dark:text-[#707070] py-2">拖拽文件或使用上方添加</div>
              )}
              {sources.map(s => (
                <button
                  key={s.source_id}
                  draggable
                  onDragStart={(e) => {
                    try {
                      e.dataTransfer.setData('application/x-research-source', JSON.stringify({ session_id: researchSessionId, source_id: s.source_id }));
                      e.dataTransfer.effectAllowed = 'copy';
                    } catch {}
                  }}
                  onClick={() => {
                    const token = s.title || s.source_id;
                    setInput(prev => (prev ? `${prev} $${token}` : `$${token}`));
                  }}
                  className="w-full text-left px-2 py-1 rounded-md hover:bg-white dark:hover:bg-[#2d2d2d] transition-colors"
                  title="点击插入 $引用"
                >
                  <div className="text-[11px] text-gray-700 dark:text-[#d0d0d0] truncate">
                    {s.title || s.url || s.source_id}
                  </div>
                  <div className="text-[9px] text-gray-400 dark:text-[#707070] truncate">
                    {s.source_type}{s.mime_type ? ` · ${s.mime_type}` : ''}
                  </div>
                </button>
              ))}
            </div>

            {/* 检索 */}
            <div className="mt-3">
              <div className="flex gap-1">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 dark:text-[#707070]" />
                  <input
                    value={retrieveQuery}
                    onChange={(e) => setRetrieveQuery(e.target.value)}
                    placeholder="检索…"
                    className="w-full pl-6 pr-2 py-1 text-[11px] bg-white dark:bg-[#1f1f1f] border border-gray-200/70 dark:border-[#404040] rounded-md focus:outline-none focus:ring-1 focus:ring-[#7c3aed]/40 text-gray-800 dark:text-[#e0e0e0] placeholder-gray-400 dark:placeholder-[#606060]"
                  />
                </div>
                <button
                  disabled={!researchSessionId || !retrieveQuery.trim() || isRetrieving}
                  onClick={async () => {
                    if (!researchSessionId) return;
                    const q = retrieveQuery.trim();
                    if (!q) return;
                    setIsRetrieving(true);
                    try {
                      const res = await retrieve({ session_id: researchSessionId, query: q, limit: 6 });
                      setRetrieveResults(res.results || []);
                    } catch (err) {
                      alert(`检索失败：${err instanceof Error ? err.message : String(err)}`);
                    } finally {
                      setIsRetrieving(false);
                    }
                  }}
                  className="px-2 py-1 text-[10px] rounded-md bg-gray-100 dark:bg-[#363636] hover:bg-gray-200 dark:hover:bg-[#404040] text-gray-600 dark:text-[#c0c0c0] disabled:opacity-40"
                  title="检索"
                >
                  {isRetrieving ? '…' : '查'}
                </button>
              </div>
              {retrieveResults.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {retrieveResults.map(r => (
                    <button
                      key={r.doc_id}
                      onClick={() => {
                        const snippet = r.snippet || '';
                        setInput(prev => prev ? prev : `参考检索结果（${r.rel_path || r.doc_id}）：\n\n${snippet}\n\n请据此回答/补全文章。`);
                      }}
                      className="w-full text-left px-2 py-1 rounded-md hover:bg-white dark:hover:bg-[#2d2d2d]"
                      title="点击将片段放入输入框"
                    >
                      <div className="text-[11px] text-gray-700 dark:text-[#d0d0d0] truncate">
                        {r.rel_path || r.doc_id}
                      </div>
                      <div className="text-[9px] text-gray-400 dark:text-[#707070] line-clamp-2">
                        {r.snippet}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        )}
        
        {sourcesCollapsed && (
          <div className="w-[22px] flex-shrink-0 bg-[#fafafa] dark:bg-[#232323] flex items-start justify-center pt-3">
            <button
              className="p-1 rounded hover:bg-white dark:hover:bg-[#363636] text-gray-500 dark:text-[#808080]"
              title="展开 Sources"
              onClick={() => setSourcesCollapsed(false)}
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 中间列：文章 + 输入框（不含课题进展） */}
        <div
          className={`flex-1 min-w-0 flex flex-col bg-[#f8f9fa] dark:bg-[#1a1a1a] relative ${panelDragOver ? 'ring-2 ring-[#7c3aed]/40 ring-inset' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPanelDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPanelDragOver(false);
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setPanelDragOver(false);
            const dt = e.dataTransfer;
            // 1) From Sources list
            const payload = dt.getData('application/x-research-source');
            if (payload) {
              try {
                const obj = JSON.parse(payload);
                if (obj?.source_id) pinSource(String(obj.source_id));
                return;
              } catch {}
            }
            // 2) From OS/filesystem
            const files = Array.from(dt.files || []);
            if (files.length > 0) {
              await handleDropFilesToPanel(files);
            }
          }}
        >
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto p-3">
              {/* Pinned sources strip */}
              {pinnedSources.length > 0 && (
                <div className="mb-2">
                  <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
                    {pinnedSources.map(ps => {
                      const isImage = ps.source_type === 'image' || (ps.mime_type || '').startsWith('image/');
                      const token = ps.title || ps.source_id;
                      const imgUrl = researchSessionId ? getSourceFileUrl({ session_id: researchSessionId, source_id: ps.source_id }) : '';
                      return (
                        <div
                          key={ps.source_id}
                          className="group flex items-center gap-1.5 rounded-lg bg-white dark:bg-[#2d2d2d] px-2 py-1 flex-shrink-0 max-w-[200px] shadow-sm"
                          title={token}
                        >
                          {isImage ? (
                            <div className="w-7 h-7 rounded overflow-hidden bg-gray-100 dark:bg-[#1f1f1f] flex-shrink-0">
                              {imgUrl ? <img src={imgUrl} alt={token} className="w-full h-full object-cover" /> : null}
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded bg-gray-100 dark:bg-[#1f1f1f] flex items-center justify-center flex-shrink-0">
                              <FileText className="w-3.5 h-3.5 text-gray-500 dark:text-[#909090]" />
                            </div>
                          )}
                          <button
                            onClick={() => setInput(prev => (prev ? `${prev} $${token}` : `$${token}`))}
                            className="min-w-0 text-left"
                            title="点击插入 $引用"
                          >
                            <div className="text-[11px] text-gray-700 dark:text-[#d0d0d0] truncate">{token}</div>
                          </button>
                          <button
                            onClick={() => setPinnedSourceIds(prev => prev.filter(id => id !== ps.source_id))}
                            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-400 dark:text-[#707070]"
                            title="移除"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {messages
                  .filter(m => !(m.role === 'assistant' && typeof m.content === 'string' && m.content.includes(ORGANIZER_MARKER)))
                  .map((m, idx) => {
                    const key = m.local_id || `${m.role}-${idx}`;
                    if (m.role === 'user') {
                      return (
                        <div
                          key={key}
                          className="rounded-xl bg-[#e8f4fc] dark:bg-[#1a2332] px-3 py-2"
                        >
                          <div className="text-[10px] font-medium text-[#3b82f6] dark:text-[#60a5fa] mb-0.5 uppercase tracking-wide">Q</div>
                          <div className="text-sm text-gray-800 dark:text-[#e0e0e0] whitespace-pre-wrap">{m.content}</div>
                        </div>
                      );
                    }
                    // assistant / others: article-style card
                    return (
                      <div
                        key={key}
                        className="rounded-xl bg-white dark:bg-[#262626] px-3 py-2 shadow-sm"
                      >
                        <div className="text-[10px] font-medium text-[#7c3aed] dark:text-[#a78bfa] mb-1 uppercase tracking-wide">
                          {m.role === 'assistant' ? 'A' : m.role}
                        </div>
                        <MarkdownArticle
                          content={m.content}
                          onSplitTask={m.role === 'assistant' ? splitTaskToWindow : undefined}
                          onAssignTask={
                            m.role === 'assistant'
                              ? (task) => {
                                  setAssignTask(task);
                                  setAssignToAgentId(null);
                                }
                              : undefined
                          }
                        />
                      </div>
                    );
                  })}
              </div>
            </div>

          {/* 输入区（集成课题组/成员/发送） */}
          <div className="flex-shrink-0 px-3 pb-3">
            <div className="relative rounded-xl bg-white dark:bg-[#262626] shadow-md overflow-hidden">
              {/* 课题组成员栏（集成在输入框内顶部） */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 dark:border-[#363636]">
                <div className="flex items-center gap-1.5 min-w-0">
                  {/* 研究员 */}
                  <button
                    onClick={() => setShowResearcherSettings(true)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#7c3aed]/10 hover:bg-[#7c3aed]/15 transition-colors"
                    title="研究员设置"
                  >
                    <div className="w-5 h-5 rounded-full overflow-hidden bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                      {researcherAgent?.avatar ? (
                        <img src={researcherAgent.avatar} alt={researcherAgent.name || researcherAgent.session_id} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[9px] text-purple-600 dark:text-purple-200">R</span>
                      )}
                    </div>
                    <span className="text-[10px] text-[#7c3aed] font-medium">研究员</span>
                  </button>
                  
                  {/* 成员头像 */}
                  <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
                    {selectedAgents.map(a => (
                      <button
                        key={a.session_id}
                        onClick={() => handleRemoveAgent(a.session_id)}
                        className="group relative w-5 h-5 rounded-full overflow-hidden bg-gray-100 dark:bg-[#363636] flex-shrink-0"
                        title={`移除：${a.name || a.session_id}`}
                      >
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name || a.session_id} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[8px] text-gray-600 dark:text-[#b0b0b0] w-full h-full flex items-center justify-center">A</span>
                        )}
                        <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[8px]">×</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <details className="group">
                    <summary className="list-none cursor-pointer p-1 rounded hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-500 dark:text-[#808080]" title="添加成员">
                      <Plus className="w-3.5 h-3.5" />
                    </summary>
                    <div className="absolute right-0 bottom-full mb-1 w-56 max-h-52 overflow-auto rounded-lg bg-white dark:bg-[#2d2d2d] shadow-xl z-50">
                      <div className="px-2 py-1.5 text-[10px] text-gray-500 dark:text-[#909090] border-b border-gray-100 dark:border-[#363636]">
                        点击添加；用 <span className="font-mono">@名称</span> 指定回应者
                      </div>
                      {availableAgentsForPicker.length === 0 ? (
                        <div className="px-2 py-2 text-xs text-gray-500 dark:text-[#909090]">无更多</div>
                      ) : (
                        availableAgentsForPicker.map(a => (
                          <button
                            key={a.session_id}
                            onClick={() => handleAddAgent(a)}
                            className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#363636] text-left"
                          >
                            <div className="w-5 h-5 rounded-full overflow-hidden bg-gray-100 dark:bg-[#363636] flex items-center justify-center flex-shrink-0">
                              {a.avatar ? (
                                <img src={a.avatar} alt={a.name || a.session_id} className="w-full h-full object-cover" />
                              ) : (
                                <span className="text-[8px] text-gray-600 dark:text-[#b0b0b0]">A</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-700 dark:text-[#d0d0d0] truncate">{a.name || a.session_id}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </details>
                </div>
              </div>
              
              {/* 输入框 + 发送按钮 */}
              <div className="relative flex items-end gap-2 p-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    requestAnimationFrame(updateAutocomplete);
                  }}
                  onClick={() => requestAnimationFrame(updateAutocomplete)}
                  onKeyUp={() => requestAnimationFrame(updateAutocomplete)}
                  placeholder="输入问题…（@ 成员，$ 引用）"
                  className="flex-1 min-h-[44px] max-h-[140px] resize-y px-3 py-2 text-sm bg-transparent text-gray-800 dark:text-[#e0e0e0] placeholder-gray-400 dark:placeholder-[#606060] focus:outline-none"
                  onKeyDown={(e) => {
                    if (acOpen) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const max = acType === 'mention' ? filteredMentionCandidates.length : filteredSourceCandidates.length;
                        setAcIndex(prev => (max ? (prev + 1) % max : 0));
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const max = acType === 'mention' ? filteredMentionCandidates.length : filteredSourceCandidates.length;
                        setAcIndex(prev => (max ? (prev - 1 + max) % max : 0));
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setAcOpen(false);
                        return;
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (acType === 'mention') {
                          const item = filteredMentionCandidates[acIndex];
                          if (item) pickAutocomplete(`@${item.name}`);
                        } else {
                          const item = filteredSourceCandidates[acIndex];
                          if (item) pickAutocomplete(`$${item.title}`);
                        }
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={isSending || !researchSessionId}
                  className="px-4 py-2 rounded-lg bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  title="发送"
                >
                  {isSending ? '…' : '发送'}
                </button>
              
                {/* Autocomplete dropdown */}
                {acOpen && (
                  <div className="absolute left-0 right-0 bottom-full mb-1 max-h-[200px] overflow-auto rounded-lg bg-white dark:bg-[#2d2d2d] shadow-xl z-50">
                    <div className="px-2 py-1.5 text-[10px] text-gray-500 dark:text-[#909090] border-b border-gray-100 dark:border-[#363636]">
                      {acType === 'mention' ? '@ 成员' : '$ 引用'}：{acQuery || '全部'}
                    </div>
                    {(acType === 'mention' ? filteredMentionCandidates : filteredSourceCandidates).length === 0 ? (
                      <div className="px-2 py-2 text-xs text-gray-500 dark:text-[#909090]">无匹配</div>
                    ) : (
                      (acType === 'mention' ? filteredMentionCandidates : filteredSourceCandidates).map((item: any, idx: number) => (
                        <button
                          key={(acType === 'mention' ? item.id : item.id) + idx}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (acType === 'mention') pickAutocomplete(`@${item.name}`);
                            else pickAutocomplete(`$${item.title}`);
                          }}
                          className={`w-full px-2 py-1.5 text-left flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#363636] ${idx === acIndex ? 'bg-gray-50 dark:bg-[#363636]' : ''}`}
                        >
                          {acType === 'mention' ? (
                            <>
                              <div className="w-5 h-5 rounded-full overflow-hidden bg-gray-100 dark:bg-[#363636] flex items-center justify-center flex-shrink-0">
                                {item.avatar ? (
                                  <img src={item.avatar} alt={item.name} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-[8px] text-gray-600 dark:text-[#b0b0b0]">A</span>
                                )}
                              </div>
                              <span className="text-xs text-gray-700 dark:text-[#d0d0d0] truncate">@{item.name}</span>
                            </>
                          ) : (
                            <>
                              <span className="px-1 py-0.5 rounded bg-gray-200/70 dark:bg-gray-700/50 text-[9px] text-gray-600 dark:text-gray-300">{item.type}</span>
                              <span className="text-xs text-gray-700 dark:text-[#d0d0d0] truncate">${item.title}</span>
                            </>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 并发研究：边缘 Tab + 研究窗口面板 */}
          {windows.length > 0 && (
            <div className="absolute right-1 top-14 flex flex-col gap-1 z-40">
              {windows.slice(0, 8).map((w) => {
                const isActive = w.id === activeWindowId && !w.collapsed;
                const statusColor =
                  w.status === 'done' ? 'bg-green-500' : w.status === 'running' ? 'bg-blue-500' : 'bg-gray-400';
                return (
                  <button
                    key={w.id}
                    onClick={() => {
                      setActiveWindowId(w.id);
                      updateWindow(w.id, { collapsed: false });
                    }}
                    className={`group w-8 h-12 rounded-lg border border-gray-200 dark:border-[#404040] shadow-sm flex flex-col items-center justify-center gap-1 transition-colors ${
                      isActive ? 'bg-[#7c3aed] text-white' : 'bg-white dark:bg-[#363636] text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-50 dark:hover:bg-[#404040]'
                    }`}
                    title={w.title}
                  >
                    <div className={`w-2 h-2 rounded-full ${statusColor}`} />
                    {w.status === 'done' ? (
                      <Hand className="w-3.5 h-3.5" />
                    ) : (
                      <span className="text-[10px] font-semibold leading-none">
                        {w.title.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {activeWindow && !activeWindow.collapsed && (
            <div className="absolute right-0 top-0 bottom-0 w-[380px] z-50 bg-white dark:bg-[#2d2d2d] border-l border-gray-200 dark:border-[#404040] shadow-2xl flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-[#404040] bg-gray-50/50 dark:bg-[#363636]/30">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {activeWindow.title}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-[#a0a0a0]">
                    {activeWindow.status === 'running'
                      ? '研究中…'
                      : activeWindow.status === 'done'
                        ? '已举手（研究OK）'
                        : '待研究'}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => runWindowResearch(activeWindow.id)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-700 dark:text-[#e0e0e0]"
                    title="触发研究"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() =>
                      updateWindow(activeWindow.id, { status: activeWindow.status === 'done' ? 'idle' : 'done' })
                    }
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-700 dark:text-[#e0e0e0]"
                    title="举手/取消举手（研究OK）"
                  >
                    <Hand className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => updateWindow(activeWindow.id, { collapsed: true })}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-700 dark:text-[#e0e0e0]"
                    title="折叠到边缘"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setWindows(prev => prev.filter(x => x.id !== activeWindow.id));
                      setActiveWindowId(prev => (prev === activeWindow.id ? null : prev));
                    }}
                    className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-300"
                    title="关闭窗口"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Assign agents */}
              <div className="px-3 py-2 border-b border-gray-200 dark:border-[#404040]">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs text-gray-500 dark:text-[#a0a0a0]">指派负责智能体（未指派则用研究模型）</div>
                  <div className="text-[11px] text-gray-500 dark:text-[#a0a0a0]">
                    已选 {activeWindow.assignedAgentIds.length}
                  </div>
                </div>
                <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
                  {selectedAgents.map(a => {
                    const selected = activeWindow.assignedAgentIds.includes(a.session_id);
                    return (
                      <button
                        key={a.session_id}
                        onClick={() => {
                          updateWindow(activeWindow.id, {
                            assignedAgentIds: selected
                              ? activeWindow.assignedAgentIds.filter(id => id !== a.session_id)
                              : [a.session_id],
                          });
                        }}
                        className={`w-7 h-7 rounded-full overflow-hidden border flex items-center justify-center flex-shrink-0 ${
                          selected
                            ? 'border-[#7c3aed] ring-2 ring-[#7c3aed]/30'
                            : 'border-gray-200 dark:border-[#404040]'
                        } bg-purple-100 dark:bg-purple-900/30`}
                        title={a.name || a.session_id}
                      >
                        {a.avatar ? (
                          <img src={a.avatar} alt={a.name || a.session_id} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] text-purple-700 dark:text-purple-200">A</span>
                        )}
                      </button>
                    );
                  })}
                  {selectedAgents.length === 0 && (
                    <span className="text-xs text-gray-400 dark:text-[#888]">课题组为空</span>
                  )}
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 min-h-0 overflow-auto p-3">
                <div className="space-y-3">
                  {activeWindow.messages.map((m, idx) => (
                    <div key={idx}>
                      <div className="text-[11px] text-gray-500 dark:text-[#a0a0a0] mb-1">
                        {m.role === 'user' ? '问题' : '研究结果'}
                      </div>
                      <div className="rounded-lg border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#1f1f1f] p-2">
                        <MarkdownArticle content={m.content} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="p-3 border-t border-gray-200 dark:border-[#404040]">
                <textarea
                  value={activeWindow.draft}
                  onChange={(e) => updateWindow(activeWindow.id, { draft: e.target.value })}
                  placeholder="追问/补充…（Enter 触发研究，Shift+Enter 换行）"
                  className="w-full min-h-[44px] max-h-[120px] resize-y px-3 py-2 text-sm rounded-lg bg-gray-50 dark:bg-[#1f1f1f] border border-gray-200 dark:border-[#404040] text-gray-900 dark:text-[#e0e0e0] focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/40"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      runWindowResearch(activeWindow.id);
                    }
                  }}
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => runWindowResearch(activeWindow.id)}
                    className="px-3 py-2 rounded-lg bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm"
                  >
                    研究
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右侧课题进展（独立全高度列） */}
        <div
          className="relative flex-shrink-0 bg-[#f5f5f5] dark:bg-[#1f1f1f] transition-all"
          style={{ width: progressCollapsed ? 28 : progressWidth }}
        >
          {!progressCollapsed && (
            <div
              className="absolute -left-1 top-0 bottom-0 w-3 cursor-col-resize z-50"
              title="拖拽调整宽度"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startW = progressWidth;
                const body = document.body;
                const prevCursor = body.style.cursor;
                const prevSelect = body.style.userSelect;
                body.style.cursor = 'col-resize';
                body.style.userSelect = 'none';
                const onMove = (ev: MouseEvent) => {
                  const dx = startX - ev.clientX;
                  const next = Math.max(260, Math.min(800, startW + dx));
                  setProgressWidth(next);
                };
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                  body.style.cursor = prevCursor;
                  body.style.userSelect = prevSelect;
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            >
              <div className="w-full h-full hover:bg-[#7c3aed]/20" />
            </div>
          )}
          {progressCollapsed ? (
            <div className="h-full flex flex-col items-center pt-3">
              <button onClick={() => setProgressCollapsed(false)} className="p-1 rounded hover:bg-white dark:hover:bg-[#363636] text-gray-500 dark:text-[#808080]" title="展开">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="mt-2 text-[9px] text-gray-400 dark:text-[#707070] rotate-180 select-none [writing-mode:vertical-rl]">进展</div>
            </div>
          ) : (
            <div className="h-full flex flex-col p-2">
              <div className="flex items-center justify-between mb-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-700 dark:text-[#d0d0d0]">课题进展</div>
                  <div className="text-[9px] text-gray-400 dark:text-[#707070] truncate">
                    {organizerRunning ? '更新中…' : organizerUpdatedAt ? new Date(organizerUpdatedAt).toLocaleTimeString() : ''}
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <select value={progressFontPx} onChange={(e) => setProgressFontPx(Number(e.target.value))} className="text-[9px] px-1 py-0.5 rounded bg-white dark:bg-[#2d2d2d] text-gray-600 dark:text-[#b0b0b0] focus:outline-none" title="字号">
                    {[11, 12, 13, 14, 16, 18, 20].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={triggerOrganizerRefresh} className="p-1 rounded hover:bg-white dark:hover:bg-[#363636] text-gray-500 dark:text-[#808080]" title="刷新"><Play className="w-3 h-3" /></button>
                  <button onClick={() => setProgressCollapsed(true)} className="p-1 rounded hover:bg-white dark:hover:bg-[#363636] text-gray-500 dark:text-[#808080]" title="折叠"><ChevronRight className="w-3 h-3" /></button>
                </div>
              </div>
              <div className="flex-1 min-h-0 flex rounded-lg bg-white dark:bg-[#262626] shadow-sm overflow-hidden" style={{ fontSize: `${progressFontPx}px` }}>
                <div className="w-[120px] flex-shrink-0 bg-[#fafafa] dark:bg-[#1f1f1f] p-2 overflow-auto">
                  <div className="text-[9px] font-semibold text-gray-500 dark:text-[#808080] mb-1 uppercase tracking-wide">提纲</div>
                  {progressHeadings.length === 0 ? (
                    <div className="text-[10px] text-gray-400 dark:text-[#606060]">暂无</div>
                  ) : (
                    <div className="space-y-0.5">
                      {progressHeadings.map(h => (
                        <button
                          key={h.index}
                          onClick={() => {
                            const el = progressScrollRef.current?.querySelector(`[data-heading-index="${h.index}"]`) as HTMLElement | null;
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                          className="w-full text-left px-1.5 py-0.5 rounded hover:bg-white dark:hover:bg-[#2d2d2d] text-[10px] text-gray-600 dark:text-[#c0c0c0] line-clamp-2"
                          title={h.text}
                          style={{ paddingLeft: Math.min(10, (h.level - 1) * 5) + 4 }}
                        >
                          {h.text}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div ref={progressScrollRef} className="flex-1 min-h-0 overflow-auto p-2">
                  {organizerMarkdown ? <ProgressMarkdown content={organizerMarkdown} /> : <div className="text-xs text-gray-500 dark:text-[#909090]">发送问题后自动生成进展</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResearchPanel;



