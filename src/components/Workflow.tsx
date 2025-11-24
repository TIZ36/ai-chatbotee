/**
 * 工作流界面组件
 * 整合LLM模型和MCP工具，通过聊天完成任务
 */

import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader, Bot, User, Wrench, AlertCircle, CheckCircle, Brain, Plug, RefreshCw, Power, XCircle, ChevronDown, ChevronUp, MessageCircle, FileText, Plus, History, Sparkles, Workflow as WorkflowIcon, GripVertical, Play, ArrowRight, Trash2, X, Edit2, RotateCw, Database, Image as ImageIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LLMClient, LLMMessage } from '../services/llmClient';
import { getLLMConfigs, getLLMConfig, getLLMConfigApiKey, LLMConfigFromDB } from '../services/llmApi';
import { mcpManager, MCPServer, MCPTool } from '../services/mcpClient';
import { getMCPServers, MCPServerConfig } from '../services/mcpApi';
import { getSessions, createSession, getSessionMessages, saveMessage, summarizeSession, getSessionSummaries, deleteSession, clearSummarizeCache, deleteMessage, executeMessageComponent, updateSessionAvatar, Session, Summary } from '../services/sessionApi';
import { estimate_messages_tokens, get_model_max_tokens, estimate_tokens } from '../services/tokenCounter';
import { getWorkflows, getWorkflow, Workflow as WorkflowType, WorkflowNode, WorkflowConnection } from '../services/workflowApi';
import { getBatch } from '../services/crawlerApi';
import CrawlerModuleSelector from './CrawlerModuleSelector';
import CrawlerBatchItemSelector from './CrawlerBatchItemSelector';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string; // 思考过程（用于 o1 等思考模型）
  toolCalls?: Array<{ name: string; arguments: any; result?: any }>;
  isStreaming?: boolean; // 是否正在流式输出
  isThinking?: boolean; // 是否正在思考
  toolType?: 'workflow' | 'mcp'; // 感知组件类型（当 role === 'tool' 时使用）
  workflowId?: string; // 工作流ID（如果是工作流消息）
  workflowName?: string; // 工作流名称
  workflowStatus?: 'pending' | 'running' | 'completed' | 'error'; // 工作流状态
  workflowResult?: string; // 工作流执行结果
  workflowConfig?: { nodes: WorkflowNode[]; connections: WorkflowConnection[] }; // 工作流配置（节点和连接）
  isSummary?: boolean; // 是否是总结消息（不显示，但用于标记总结点）
}

const Workflow: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true); // 流式响应开关
  const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set()); // 已折叠的思考过程
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null); // 正在编辑的消息ID
  
  // @ 符号选择器状态
  const [showAtSelector, setShowAtSelector] = useState(false);
  const [atSelectorPosition, setAtSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 256 });
  const [atSelectorQuery, setAtSelectorQuery] = useState('');
  const [atSelectorIndex, setAtSelectorIndex] = useState(-1); // @ 符号在输入中的位置
  const [selectedComponentIndex, setSelectedComponentIndex] = useState(0); // 当前选中的组件索引（用于键盘导航）
  const [selectedComponents, setSelectedComponents] = useState<Array<{ type: 'mcp' | 'workflow'; id: string; name: string }>>([]); // 已选定的组件（tag）
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // /模块 选择器状态
  const [showModuleSelector, setShowModuleSelector] = useState(false);
  const [moduleSelectorPosition, setModuleSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 256 });
  const [moduleSelectorQuery, setModuleSelectorQuery] = useState('');
  const [moduleSelectorIndex, setModuleSelectorIndex] = useState(-1); // /模块 在输入中的位置
  
  // 批次数据项选择器状态
  const [showBatchItemSelector, setShowBatchItemSelector] = useState(false);
  const [batchItemSelectorPosition, setBatchItemSelectorPosition] = useState({ top: 0, left: 0, maxHeight: 400 });
  const [selectedBatch, setSelectedBatch] = useState<any>(null);
  
  // 选定的批次数据项（作为系统提示词）
  const [selectedBatchItem, setSelectedBatchItem] = useState<{ item: any; batchName: string } | null>(null);
  
  // 批次数据项选择后的操作选择（临时状态）
  const [pendingBatchItem, setPendingBatchItem] = useState<{ item: any; batchName: string } | null>(null);
  
  // 会话管理
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionAvatar, setCurrentSessionAvatar] = useState<string | null>(null); // 当前会话的头像
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [messagePage, setMessagePage] = useState(1);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showNewMessagePrompt, setShowNewMessagePrompt] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  
  // LLM配置
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigFromDB[]>([]);
  const [selectedLLMConfigId, setSelectedLLMConfigId] = useState<string | null>(null);
  const [selectedLLMConfig, setSelectedLLMConfig] = useState<LLMConfigFromDB | null>(null);
  
  // MCP配置
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [connectedMcpServerIds, setConnectedMcpServerIds] = useState<Set<string>>(new Set());
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<Set<string>>(new Set());
  const [mcpTools, setMcpTools] = useState<Map<string, MCPTool[]>>(new Map());
  const [connectingServers, setConnectingServers] = useState<Set<string>>(new Set());
  const [expandedServerIds, setExpandedServerIds] = useState<Set<string>>(new Set());
  
  // 工作流列表
  const [workflows, setWorkflows] = useState<WorkflowType[]>([]);
  
  // 拖拽状态
  const [draggingComponent, setDraggingComponent] = useState<{ type: 'mcp' | 'workflow'; id: string; name: string } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isInitialLoadRef = useRef(true);
  const shouldMaintainScrollRef = useRef(false);
  const isUserScrollingRef = useRef(false);
  const scrollPositionRef = useRef<{ anchorMessageId: string; anchorOffsetTop: number; scrollTop: number } | null>(null);
  const isLoadingMoreRef = useRef(false);
  const lastMessageCountRef = useRef(0);

  // 检查是否应该自动滚动到底部
  const shouldAutoScroll = () => {
    if (!chatContainerRef.current) return false;
    const container = chatContainerRef.current;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    // 如果距离底部小于100px，认为用户在底部附近，应该自动滚动
    return scrollHeight - scrollTop - clientHeight < 100;
  };

  useEffect(() => {
    // 如果需要保持滚动位置（加载更多历史消息），不滚动
    if (shouldMaintainScrollRef.current) {
      shouldMaintainScrollRef.current = false;
      // lastMessageCountRef 已经在 setMessages 中更新了，这里不需要再更新
      return;
    }
    
    // 如果正在加载更多历史消息，不处理自动滚动
    if (isLoadingMoreRef.current) {
      return;
    }
    
    // 如果是初始加载，直接跳到底部（不使用动画）
    if (isInitialLoadRef.current && messages.length > 0) {
      requestAnimationFrame(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
          isInitialLoadRef.current = false;
          lastMessageCountRef.current = messages.length;
        }
      });
      return;
    }
    
    // 检测是否有新消息（消息数量增加，且是追加到末尾的新消息，不是加载的历史消息）
    // 注意：如果消息数量减少或不变，说明可能是替换消息（如编辑、删除），不处理
    if (messages.length <= lastMessageCountRef.current) {
      // 消息数量没有增加，可能是替换或删除，更新计数但不滚动
      lastMessageCountRef.current = messages.length;
      return;
    }
    
    const hasNewMessages = messages.length > lastMessageCountRef.current;
    const newMessageCount = hasNewMessages ? messages.length - lastMessageCountRef.current : 0;
    
    if (hasNewMessages) {
      // 更新 lastMessageCountRef
      lastMessageCountRef.current = messages.length;
      
      // 如果用户在底部附近，自动滚动到底部
      if (shouldAutoScroll() && !isUserScrollingRef.current) {
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        });
        // 用户已经在底部，隐藏新消息提示
        setShowNewMessagePrompt(false);
        setUnreadMessageCount(0);
      } else {
        // 用户不在底部，显示新消息提示
        setShowNewMessagePrompt(true);
        setUnreadMessageCount(prev => prev + newMessageCount);
      }
    }
  }, [messages]);

  // 加载会话列表
  const loadSessions = async () => {
    try {
      const sessionList = await getSessions();
      setSessions(sessionList);
    } catch (error) {
      console.error('[Workflow] Failed to load sessions:', error);
      // 如果加载失败，设置为空数组，避免后续错误
      setSessions([]);
    }
  };

  // 加载LLM配置和MCP服务器列表
  useEffect(() => {
    loadLLMConfigs();
    loadMCPServers();
    loadSessions();
    loadWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // 当选择会话时，加载历史消息和头像
  useEffect(() => {
    if (currentSessionId) {
      loadSessionMessages(currentSessionId);
      loadSessionSummaries(currentSessionId);
      // 加载会话头像
      const session = sessions.find(s => s.session_id === currentSessionId);
      if (session?.avatar) {
        setCurrentSessionAvatar(session.avatar);
      } else {
        setCurrentSessionAvatar(null);
      }
    } else {
      // 新会话，清空消息（保留系统消息）
      setMessages([{
        id: '1',
        role: 'system',
        content: '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
      }]);
      setSummaries([]);
      setCurrentSessionAvatar(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, sessions]);
  
  // 当弹框显示时，调整位置使底部对齐光标，并滚动到底部
  useEffect(() => {
    if (showAtSelector && selectorRef.current && inputRef.current) {
      // 使用 setTimeout 确保 DOM 已更新
      setTimeout(() => {
        if (selectorRef.current && inputRef.current) {
          const selector = selectorRef.current;
          const actualHeight = selector.offsetHeight;
          
          // 重新获取光标位置
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const cursorPosition = textarea.selectionStart || 0;
          const value = textarea.value;
          const textBeforeCursor = value.substring(0, cursorPosition);
          
          // 计算光标位置（简化版本，使用之前的逻辑）
          const styles = window.getComputedStyle(textarea);
          const lines = textBeforeCursor.split('\n');
          const lineIndex = lines.length - 1;
          
          // 计算行高和 padding
          const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
          const paddingTop = parseFloat(styles.paddingTop) || 0;
          
          const cursorY = textareaRect.top + paddingTop + (lineIndex * lineHeight) - textarea.scrollTop;
          
          // 调整弹框位置，使底部对齐光标
          const newTop = cursorY - actualHeight;
          
          // 如果调整后超出顶部，则限制在顶部
          if (newTop < 10) {
            selector.style.top = '10px';
          } else {
            selector.style.top = `${newTop}px`;
          }
          
          // 滚动到底部，使最新内容在底部显示
          selector.scrollTop = selector.scrollHeight;
        }
      }, 10); // 稍微延迟以确保内容已渲染
    }
  }, [showAtSelector, atSelectorQuery, mcpServers, workflows]);
  
  // 监听点击外部关闭模块选择器
  useEffect(() => {
    if (!showModuleSelector) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // 检查点击是否在选择器外部（不包括输入框和选择器本身）
      const isClickInsideSelector = target.closest('.at-selector-container');
      const isClickInsideInput = inputRef.current?.contains(target);
      
      if (!isClickInsideSelector && !isClickInsideInput) {
        console.log('[Workflow] 点击外部，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    };
    
    // 延迟添加监听器，避免立即触发
    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModuleSelector]);
  
  // 监听ESC键关闭模块选择器
  useEffect(() => {
    if (!showModuleSelector) return;
    
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        console.log('[Workflow] 按下ESC，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
        
        // 重新聚焦输入框
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }
    };
    
    document.addEventListener('keydown', handleEscKey);
    
    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [showModuleSelector]);
  
  // 加载会话消息
  const loadSessionMessages = async (session_id: string, page: number = 1) => {
    try {
      setIsLoadingMessages(true);
      
      // 如果是加载更多历史消息（page > 1），记录当前滚动位置
      if (page > 1 && chatContainerRef.current && messages.length > 0) {
        isLoadingMoreRef.current = true;
        const container = chatContainerRef.current;
        const scrollTop = container.scrollTop;
        
        // 找到容器顶部附近的第一条消息作为锚点
        let anchorMessageId: string | null = null;
        let anchorOffsetTop = 0;
        const threshold = 200; // 距离顶部200px内的消息
        
        for (const msg of messages) {
          const element = container.querySelector(`[data-message-id="${msg.id}"]`) as HTMLElement;
          if (element) {
            const elementTop = element.offsetTop;
            const relativeTop = elementTop - scrollTop;
            
            // 找到最接近顶部且在阈值内的消息
            if (relativeTop >= -threshold && relativeTop <= threshold) {
              anchorMessageId = msg.id;
              anchorOffsetTop = elementTop;
              break;
            }
          }
        }
        
        // 如果没找到合适的锚点，使用第一条消息
        if (!anchorMessageId && messages.length > 0) {
          const firstElement = container.querySelector(`[data-message-id="${messages[0].id}"]`) as HTMLElement;
          if (firstElement) {
            anchorMessageId = messages[0].id;
            anchorOffsetTop = firstElement.offsetTop;
          }
        }
        
        if (anchorMessageId) {
          scrollPositionRef.current = {
            anchorMessageId,
            anchorOffsetTop,
            scrollTop,
          };
          shouldMaintainScrollRef.current = true;
        }
      }
      
      // 默认只加载20条消息，加快初始加载速度
      const data = await getSessionMessages(session_id, page, 20);
      
      // 先加载总结列表，用于关联总结消息和提示信息
      const summaryList = await getSessionSummaries(session_id);
      
      // 格式化消息，恢复工作流信息
      const formatMessage = async (msg: any): Promise<Message | null> => {
        // 确保 role 正确：如果是 'workflow'，转换为 'tool'
        let role = msg.role;
        if (role === 'workflow') {
          role = 'tool';
          console.warn('[Workflow] Fixed invalid role "workflow" to "tool" for message:', msg.message_id);
        }
        
        // 检查是否是总结消息（通过 content 前缀识别）
        const isSummaryMessage = role === 'system' && msg.content?.startsWith('__SUMMARY__');
        const actualContent = isSummaryMessage 
          ? msg.content.replace(/^__SUMMARY__/, '') // 移除前缀，保留实际内容
          : msg.content;
        
        // 检查是否是系统提示词消息（通过 tool_calls 中的 isSystemPrompt 标识）
        const toolCalls = msg.tool_calls && typeof msg.tool_calls === 'object' ? msg.tool_calls : null;
        const isSystemPromptMessage = role === 'system' && toolCalls && (toolCalls as any).isSystemPrompt === true;
        
        const baseMessage: Message = {
          id: msg.message_id,
          role: role as 'user' | 'assistant' | 'tool' | 'system',
          content: actualContent,
          thinking: msg.thinking,
          toolCalls: msg.tool_calls,
          isSummary: isSummaryMessage, // 标记为总结消息
        };
        
        // 如果是系统提示词消息，恢复 selectedBatchItem
        if (isSystemPromptMessage && toolCalls) {
          const systemPromptData = toolCalls as any;
          if (systemPromptData.batchName && systemPromptData.item) {
            setSelectedBatchItem({
              batchName: systemPromptData.batchName,
              item: systemPromptData.item,
            });
            console.log('[Workflow] Restored system prompt from message:', msg.message_id);
          }
        }
        
        // 如果是工具消息（感知组件），尝试从 content 或 tool_calls 中恢复工作流信息
        if (baseMessage.role === 'tool') {
          // 过滤掉没有执行输出的感知组件（pending状态且没有content）
          if (!msg.content || msg.content.trim() === '' || msg.content === '[]') {
            const toolCalls = msg.tool_calls && typeof msg.tool_calls === 'object' ? msg.tool_calls : null;
            const workflowStatus = toolCalls?.workflowStatus;
            if (workflowStatus === 'pending') {
              // 跳过这个无效的感知组件消息
              console.log('[Workflow] Skipping invalid tool message (pending without output):', msg.message_id);
              return null;
            }
          }
          
          // 尝试从 tool_calls 中恢复工作流信息（如果之前保存过）
          if (msg.tool_calls && typeof msg.tool_calls === 'object') {
            baseMessage.toolType = msg.tool_calls.toolType || msg.tool_calls.workflowType; // 兼容旧数据
            baseMessage.workflowId = msg.tool_calls.workflowId;
            baseMessage.workflowName = msg.tool_calls.workflowName;
            baseMessage.workflowStatus = msg.tool_calls.workflowStatus || 'completed';
            
            // 确保恢复的消息有完整的工作流信息，允许重新执行
            if (!baseMessage.workflowId || !baseMessage.toolType) {
              console.warn('[Workflow] Restored tool message missing workflowId or toolType:', msg.message_id);
            }
          } else {
            // 如果没有 tool_calls，尝试从 content 中解析（兼容旧数据）
            console.warn('[Workflow] Restored tool message missing tool_calls:', msg.message_id);
          }
          
          // 如果工作流ID存在，尝试加载工作流配置
          if (baseMessage.workflowId && baseMessage.toolType === 'workflow') {
            try {
              const workflowDetails = await getWorkflow(baseMessage.workflowId);
              baseMessage.workflowConfig = workflowDetails?.config;
            } catch (error) {
              console.error('[Workflow] Failed to load workflow details:', error);
              // 即使加载失败，也允许重新执行（使用已有的 workflowId）
            }
          }
        }
        
        return baseMessage;
      };
      
      // 格式化消息，恢复工作流信息
      const formattedMessages = await Promise.all(data.messages.map(formatMessage));
      // 过滤掉null值（无效的感知组件消息）
      const validMessages = formattedMessages.filter((msg): msg is Message => msg !== null);
      
      // 在总结消息之后插入提示消息
      const messagesWithNotifications: Message[] = [];
      for (let i = 0; i < validMessages.length; i++) {
        const msg = validMessages[i];
        messagesWithNotifications.push(msg);
        
        // 如果是总结消息，查找对应的总结记录并添加提示消息
        if (msg.isSummary) {
          // 检查下一条消息是否已经是提示消息（避免重复添加）
          const nextMsg = validMessages[i + 1];
          const isAlreadyHasNotification = nextMsg && 
            nextMsg.role === 'system' && 
            (nextMsg.content.includes('已精简为') || nextMsg.content.includes('总结完成'));
          
          if (!isAlreadyHasNotification) {
            // 通过内容匹配找到对应的总结记录
            const matchingSummary = summaryList.find(s => 
              s.summary_content === msg.content || 
              msg.content.includes(s.summary_content) ||
              s.summary_content.includes(msg.content)
            );
            
            if (matchingSummary) {
              const tokenAfter = matchingSummary.token_count_after || 0;
              const tokenBefore = matchingSummary.token_count_before || 0;
              const notificationMessage: Message = {
                id: `notification-${msg.id}`,
                role: 'system',
                content: `您的对话内容已精简为 ${tokenAfter.toLocaleString()} token（原 ${tokenBefore.toLocaleString()} token）`,
              };
              messagesWithNotifications.push(notificationMessage);
            }
          }
        }
      }
      
      if (page === 1) {
        // 第一页，替换所有消息（显示最新的消息）
        setMessages(messagesWithNotifications);
        isInitialLoadRef.current = true; // 标记为初始加载，会直接跳到底部
        lastMessageCountRef.current = messagesWithNotifications.length;
        // 重置新消息提示
        setShowNewMessagePrompt(false);
        setUnreadMessageCount(0);
      } else {
        // 后续页，添加到前面（加载历史消息）
        // 在设置消息之前，先设置标志阻止自动滚动，并预计算新消息数量
        shouldMaintainScrollRef.current = true;
        const oldMessageCount = messages.length;
        const newTotalCount = oldMessageCount + messagesWithNotifications.length;
        
        // 预先更新 lastMessageCountRef，这样 useEffect 就不会误判为新消息
        lastMessageCountRef.current = newTotalCount;
        
        setMessages(prev => {
          const newMessages = [...messagesWithNotifications, ...prev];
          
          // 恢复滚动位置（保持锚点消息的位置不变，类似微信的加载历史消息）
          if (scrollPositionRef.current && chatContainerRef.current) {
            // 使用双重 requestAnimationFrame 确保 DOM 完全更新
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const container = chatContainerRef.current;
                if (container && scrollPositionRef.current) {
                  const { anchorMessageId, anchorOffsetTop, scrollTop: oldScrollTop } = scrollPositionRef.current;
                  if (anchorMessageId) {
                    const anchorElement = container.querySelector(`[data-message-id="${anchorMessageId}"]`) as HTMLElement;
                    if (anchorElement) {
                      // 计算新位置：目标消息的新位置 - 之前目标消息距离顶部的距离
                      const newAnchorOffsetTop = anchorElement.offsetTop;
                      const distanceFromTop = anchorOffsetTop - oldScrollTop;
                      const newScrollTop = newAnchorOffsetTop - distanceFromTop;
                      container.scrollTop = newScrollTop;
                    }
                  }
                  scrollPositionRef.current = null;
                  isLoadingMoreRef.current = false;
                }
              });
            });
          } else {
            isLoadingMoreRef.current = false;
          }
          
          return newMessages;
        });
      }
      
      setMessagePage(page);
      setHasMoreMessages(data.page < data.total_pages);
    } catch (error) {
      console.error('[Workflow] Failed to load messages:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  };
  
  // 加载会话总结
  const loadSessionSummaries = async (session_id: string) => {
    try {
      const summaryList = await getSessionSummaries(session_id);
      setSummaries(summaryList);
    } catch (error) {
      console.error('[Workflow] Failed to load summaries:', error);
    }
  };
  
  // 创建新会话
  const handleCreateNewSession = async () => {
    try {
      const newSession = await createSession(
        selectedLLMConfigId || undefined,
        '新会话'
      );
      setCurrentSessionId(newSession.session_id);
      await loadSessions();
    } catch (error) {
      console.error('[Workflow] Failed to create session:', error);
      alert('创建会话失败，请重试');
    }
  };
  
  // 选择会话
  const handleSelectSession = async (session_id: string) => {
    setCurrentSessionId(session_id);
    setMessagePage(1);
  };
  
  // 删除会话
  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止触发会话选择
    
    if (!confirm('确定要删除这个会话吗？此操作不可恢复。')) {
      return;
    }
    
    try {
      await deleteSession(sessionId);
      
      // 如果删除的是当前会话，切换到新会话
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([{
          id: '1',
          role: 'system',
          content: '你好！我是你的 AI 工作流助手。请先选择 LLM 模型，然后开始对话。如果需要使用工具，可以选择 MCP 服务器。',
        }]);
        setSummaries([]);
        setCurrentSessionAvatar(null);
      }
      
      // 重新加载会话列表
      await loadSessions();
    } catch (error) {
      console.error('[Workflow] Failed to delete session:', error);
      alert('删除会话失败，请重试');
    }
  };
  
  // 处理头像上传
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentSessionId) {
      alert('请先选择一个会话');
      return;
    }
    
    const file = e.target.files?.[0];
    if (!file) return;
    
    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    
    // 检查文件大小（限制为2MB）
    if (file.size > 2 * 1024 * 1024) {
      alert('图片大小不能超过2MB');
      return;
    }
    
    try {
      // 将文件转换为base64
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64String = event.target?.result as string;
        
        if (!base64String) {
          alert('图片读取失败');
          return;
        }
        
        try {
          // 保存到数据库
          await updateSessionAvatar(currentSessionId, base64String);
          
          // 更新本地状态
          setCurrentSessionAvatar(base64String);
          
          // 更新会话列表中的头像
          setSessions(prev => prev.map(s => 
            s.session_id === currentSessionId 
              ? { ...s, avatar: base64String }
              : s
          ));
          
          console.log('[Workflow] Avatar updated successfully');
        } catch (error) {
          console.error('[Workflow] Failed to update avatar:', error);
          alert('头像更新失败，请重试');
        }
      };
      
      reader.onerror = () => {
        alert('图片读取失败');
      };
      
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('[Workflow] Failed to process avatar:', error);
      alert('头像处理失败，请重试');
    }
    
    // 清空input，允许重复选择同一文件
    e.target.value = '';
  };
  
  // 处理总结的通用函数
  const processSummarize = async (
    sessionId: string,
    messagesToSummarize: Array<{ message_id?: string; role: string; content: string }>,
    isAuto: boolean = false
  ) => {
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      throw new Error('LLM配置未选择');
    }

    const model = selectedLLMConfig.model || 'gpt-4';
    
    // 调用总结 API
    const summary = await summarizeSession(sessionId, {
      llm_config_id: selectedLLMConfigId,
      model: model,
      messages: messagesToSummarize,
    });
    
    // 获取被总结的最后一条消息ID（用于确定插入位置）
    const lastSummarizedMessageId = messagesToSummarize
      .map(msg => msg.message_id)
      .filter((id): id is string => !!id)
      .pop();
    
    // 将总结内容作为 system 类型的消息保存（不显示，但用于标记总结点）
    // 使用特殊格式来标识这是总结消息：__SUMMARY__{summary_content}
    const summaryMessageId = `msg-${Date.now()}`;
    
    // 计算总结消息的累积 token：总结前的累积 token + 总结消息的 token
    const tokenCountBeforeAcc = (summary as any).token_count_before_acc || 0;
    const summaryMessageTokens = estimate_tokens(summary.summary_content, model);
    const summaryAccToken = tokenCountBeforeAcc + summaryMessageTokens;
    
    const summarySystemMessage = {
      message_id: summaryMessageId,
      role: 'system' as const,
      content: `__SUMMARY__${summary.summary_content}`, // 使用特殊前缀标识总结消息
      model: model,
      acc_token: summaryAccToken, // 设置总结消息的累积 token
    };
    
    await saveMessage(sessionId, summarySystemMessage);
    
    // 后端会自动重新计算总结后所有消息的 acc_token（在 saveMessage API 中处理）
    
    // 添加提示消息到消息列表（显示给用户）
    const tokenAfter = summary.token_count_after || 0;
    const tokenBefore = summary.token_count_before || 0;
    const notificationMessageId = `notification-${Date.now()}`;
    const notificationMessage: Message = {
      id: notificationMessageId,
      role: 'system',
      content: `${isAuto ? '' : '总结完成！'}您的对话内容已精简为 ${tokenAfter.toLocaleString()} token（原 ${tokenBefore.toLocaleString()} token）`,
    };
    
    // 在消息列表中添加总结消息（标记为不显示）和提示消息
    setMessages(prev => {
      const newMessages = [...prev];
      
      // 找到最后一条被总结消息的位置
      const lastSummarizedIndex = lastSummarizedMessageId 
        ? newMessages.findIndex(msg => msg.id === lastSummarizedMessageId)
        : -1;
      
      const insertIndex = lastSummarizedIndex >= 0 ? lastSummarizedIndex + 1 : newMessages.length;
      
      // 插入总结消息（system 类型，isSummary: true，不显示）
      const summaryMessage: Message = {
        id: summaryMessageId,
        role: 'system',
        content: summary.summary_content, // 保存实际内容，但标记为总结消息
        isSummary: true, // 标记为总结消息，不显示
      };
      
      // 插入提示消息（显示给用户）
      newMessages.splice(insertIndex, 0, summaryMessage, notificationMessage);
      
      return newMessages;
    });
    
    // 重新加载消息列表（确保与数据库同步）
    await loadSessionMessages(sessionId, 1);
    
    // 重新加载总结列表
    await loadSessionSummaries(sessionId);
    
    // 清除总结缓存
    await clearSummarizeCache(sessionId);
    
    console.log(`[Workflow] ${isAuto ? 'Auto-' : ''}Summarized: ${tokenBefore} -> ${tokenAfter} tokens`);
    
    return summary;
  };

  // 手动触发总结
  const handleManualSummarize = async () => {
    if (!currentSessionId || !selectedLLMConfigId || !selectedLLMConfig) {
      alert('请先选择会话和LLM模型');
      return;
    }
    
    try {
      setIsSummarizing(true);
      
      // 获取当前会话的所有消息（用于总结）
      // 排除系统消息（包括系统提示词消息）和总结消息
      const allMessages = messages.filter(m => {
        if (m.role === 'system' || m.isSummary) {
          // 检查是否是系统提示词消息
          const isSystemPrompt = m.toolCalls && 
            typeof m.toolCalls === 'object' &&
            (m.toolCalls as any).isSystemPrompt === true;
          if (isSystemPrompt) {
            return false; // 排除系统提示词消息
          }
          // 排除其他系统消息和总结消息
          return false;
        }
        return true;
      });
      const messagesToSummarize = allMessages.map(msg => ({
        message_id: msg.id,
        role: msg.role,
        content: msg.content,
        token_count: estimate_tokens(msg.content, selectedLLMConfig.model || 'gpt-4'),
      }));
      
      if (messagesToSummarize.length === 0) {
        alert('没有可总结的消息');
        return;
      }
      
      const summary = await processSummarize(currentSessionId, messagesToSummarize, false);
      
      // 显示总结完成的提示消息
      const tokenAfter = summary.token_count_after || 0;
      const tokenBefore = summary.token_count_before || 0;
      const notificationMsg: Message = {
        id: `manual-summary-notification-${Date.now()}`,
        role: 'system',
        content: `总结完成！对话内容已精简为 ${tokenAfter.toLocaleString()} token（原 ${tokenBefore.toLocaleString()} token）`,
      };
      setMessages(prev => [...prev, notificationMsg]);
    } catch (error) {
      console.error('[Workflow] Failed to summarize:', error);
      alert(`总结失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  const loadLLMConfigs = async () => {
    try {
      console.log('[Workflow] Loading LLM configs...');
      const configs = await getLLMConfigs();
      console.log('[Workflow] Loaded LLM configs:', configs);
      
      // 过滤启用的配置（确保 enabled 是布尔值）
      const enabledConfigs = configs.filter(c => Boolean(c.enabled));
      console.log('[Workflow] Enabled LLM configs:', enabledConfigs);
      
      setLlmConfigs(enabledConfigs);
      
      // 默认选择第一个启用的配置
      if (enabledConfigs.length > 0 && !selectedLLMConfigId) {
        const firstConfig = enabledConfigs[0];
        console.log('[Workflow] Auto-selecting first LLM config:', firstConfig);
        setSelectedLLMConfigId(firstConfig.config_id);
        setSelectedLLMConfig(firstConfig);
        console.log('[Workflow] Auto-selected LLM config:', firstConfig.config_id, firstConfig);
      }
    } catch (error) {
      console.error('[Workflow] Failed to load LLM configs:', error);
      // 显示错误消息给用户
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `❌ 加载LLM配置失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  const loadMCPServers = async () => {
    try {
      console.log('[Workflow] Loading MCP servers...');
      const servers = await getMCPServers();
      console.log('[Workflow] Loaded MCP servers:', servers);
      setMcpServers(servers);
    } catch (error) {
      console.error('[Workflow] Failed to load MCP servers:', error);
    }
  };
  
  // 加载工作流列表
  const loadWorkflows = async () => {
    try {
      console.log('[Workflow] Loading workflows...');
      const workflowList = await getWorkflows();
      console.log('[Workflow] Loaded workflows:', workflowList);
      setWorkflows(workflowList);
    } catch (error) {
      console.error('[Workflow] Failed to load workflows:', error);
      setWorkflows([]);
    }
  };


  /**
   * 连接到 MCP 服务器
   */
  const handleConnectServer = async (serverId: string) => {
    const server = mcpServers.find(s => s.id === serverId);
    if (!server) return;

    setConnectingServers(prev => new Set(prev).add(serverId));

    try {
      console.log(`[Workflow] Connecting to ${server.name}...`);
      
      // 转换为 MCPServer 格式
      const mcpServer: MCPServer = {
        id: server.id,
        name: server.name,
        url: server.url,
        type: server.type,
        enabled: server.enabled,
        description: server.description,
        metadata: server.metadata,
      };

      const client = await mcpManager.addServer(mcpServer);

      // 加载工具列表
      const tools = await client.listTools();
      setMcpTools(prev => new Map(prev).set(serverId, tools));
      setConnectedMcpServerIds(prev => new Set(prev).add(serverId));
      console.log(`[Workflow] Connected to ${server.name}, loaded ${tools.length} tools`);

    } catch (error) {
      console.error(`[Workflow] Failed to connect to ${server.name}:`, error);
      alert(`连接失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setConnectingServers(prev => {
        const newSet = new Set(prev);
        newSet.delete(serverId);
        return newSet;
      });
    }
  };

  /**
   * 断开 MCP 服务器连接
   */
  const handleDisconnectServer = (serverId: string) => {
    mcpManager.removeServer(serverId);
    setConnectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
    setSelectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
    setMcpTools(prev => {
      const newMap = new Map(prev);
      newMap.delete(serverId);
      return newMap;
    });
    setExpandedServerIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(serverId);
      return newSet;
    });
    console.log(`[Workflow] Disconnected from server: ${serverId}`);
  };

  /**
   * 切换服务器工具展开状态
   */
  const handleToggleServerExpand = (serverId: string) => {
    setExpandedServerIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        newSet.add(serverId);
      }
      return newSet;
    });
  };

  const handleLLMConfigChange = async (configId: string) => {
    console.log('[Workflow] LLM config changed:', configId);
    
    if (!configId) {
      setSelectedLLMConfigId(null);
      setSelectedLLMConfig(null);
      return;
    }
    
    setSelectedLLMConfigId(configId);
    
    // 先从已加载的配置列表中查找，避免额外的 API 调用
    const configFromList = llmConfigs.find(c => c.config_id === configId);
    if (configFromList) {
      console.log('[Workflow] Found config in list:', configFromList);
      setSelectedLLMConfig(configFromList);
      return;
    }
    
    // 如果列表中没有，尝试从 API 获取
    try {
      console.log('[Workflow] Loading config from API:', configId);
      const config = await getLLMConfig(configId);
      console.log('[Workflow] Loaded config from API:', config);
      setSelectedLLMConfig(config);
    } catch (error) {
      console.error('[Workflow] Failed to load LLM config:', error);
      setSelectedLLMConfig(null);
      // 显示错误消息
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `❌ 加载LLM配置失败: ${error instanceof Error ? error.message : String(error)}`,
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  /**
   * 切换是否使用某个 MCP 服务器的工具
   */
  const handleToggleMcpServerUsage = (serverId: string) => {
    setSelectedMcpServerIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(serverId)) {
        newSet.delete(serverId);
      } else {
        // 只有已连接的服务器才能被选择使用
        if (connectedMcpServerIds.has(serverId)) {
          newSet.add(serverId);
        }
      }
      return newSet;
    });
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    // 检查配置
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '❌ 请先选择一个 LLM 模型',
      };
      setMessages(prev => [...prev, errorMsg]);
      return;
    }

    // 如果是编辑模式，先处理重新发送
    if (editingMessageId) {
      await handleResendMessage(editingMessageId, input.trim());
      return;
    }

    // 检查是否有选定的组件（tag）
    // 只处理工作流，MCP通过selectedMcpServerIds在正常对话中使用工具
    const workflowComponents = selectedComponents.filter(c => c.type === 'workflow');
    if (workflowComponents.length > 0) {
      // 使用第一个选定的工作流
      const matchedComponent = workflowComponents[0];
      const userInput = input.trim();
      
      if (!userInput) {
        alert('请输入要执行的内容');
        return;
      }
      
      if (matchedComponent) {
        // 先保存用户输入消息
        let sessionId = currentSessionId;
        if (!sessionId) {
          try {
            const newSession = await createSession(selectedLLMConfigId, userInput.substring(0, 50));
            sessionId = newSession.session_id;
            setCurrentSessionId(sessionId);
            await loadSessions();
          } catch (error) {
            console.error('[Workflow] Failed to create session:', error);
          }
        }
        
        const userMessageId = `msg-${Date.now()}`;
        const userMessage: Message = {
          id: userMessageId,
          role: 'user',
          content: userInput,
        };
        
        setMessages(prev => [...prev, userMessage]);
        
        // 保存用户消息
        if (sessionId) {
          try {
            await saveMessage(sessionId, {
              message_id: userMessageId,
              role: 'user',
              content: userInput,
              model: selectedLLMConfig.model || 'gpt-4',
            });
          } catch (error) {
            console.error('[Workflow] Failed to save user message:', error);
          }
        }
        
        // 添加感知组件消息
        await addWorkflowMessage(matchedComponent);
        
        // 等待消息添加到列表
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 找到刚添加的感知组件消息
        const currentMessages = messages;
        const workflowMessages = currentMessages.filter(m => m.role === 'tool' && m.workflowId === matchedComponent.id);
        let latestWorkflowMessage = workflowMessages[workflowMessages.length - 1];
        
        // 如果找不到，从最新的消息中查找
        if (!latestWorkflowMessage) {
          // 等待状态更新
          await new Promise(resolve => setTimeout(resolve, 200));
          const updatedMessages = messages;
          const updatedWorkflowMessages = updatedMessages.filter(m => m.role === 'tool' && m.workflowId === matchedComponent.id);
          latestWorkflowMessage = updatedWorkflowMessages[updatedWorkflowMessages.length - 1];
        }
        
        if (latestWorkflowMessage) {
          // 添加提示消息给大模型（显示动画）
          const instructionMessageId = `instruction-${Date.now()}`;
          const instructionMessage: Message = {
            id: instructionMessageId,
            role: 'assistant',
            content: '',
            isThinking: true,
          };
          setMessages(prev => [...prev, instructionMessage]);
          
          // 更新提示消息内容（带动画效果）
          setTimeout(() => {
            setMessages(prev => prev.map(msg =>
              msg.id === instructionMessageId
                ? {
                    ...msg,
                    content: `📋 收到感知组件指令：${matchedComponent.name} (工作流)，正在执行该步骤...`,
                    isThinking: false,
                  }
                : msg
            ));
          }, 500);
          
          // 执行感知组件
          await handleExecuteWorkflow(latestWorkflowMessage.id);
        }
        
        setInput('');
        return;
      }
    }

    // 检查是否有待执行的工作流，如果有则回退到工作流消息之前
    const lastWorkflowMessage = messages.filter(m => m.role === 'tool' && m.workflowStatus === 'pending').pop();
    if (lastWorkflowMessage) {
      const workflowIndex = messages.findIndex(m => m.id === lastWorkflowMessage.id);
      if (workflowIndex >= 0) {
        // 回退到工作流消息之前（保留工作流消息之前的所有消息）
        const targetMessage = workflowIndex > 0 ? messages[workflowIndex - 1] : messages[0];
        await rollbackMessages(targetMessage.id);
      }
    }

    // 如果没有当前会话，创建新会话
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const newSession = await createSession(selectedLLMConfigId, input.trim().substring(0, 50));
        sessionId = newSession.session_id;
        setCurrentSessionId(sessionId);
        await loadSessions();
      } catch (error) {
        console.error('[Workflow] Failed to create session:', error);
        // 继续执行，即使创建会话失败
      }
    }

    // MCP 服务器是可选的，不需要强制选择

    const userMessageId = `msg-${Date.now()}`;
    const userMessage: Message = {
      id: userMessageId,
      role: 'user',
      content: input.trim(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    
    // 保存用户消息到数据库
    if (sessionId) {
      try {
        await saveMessage(sessionId, {
          message_id: userMessageId,
          role: 'user',
          content: userMessage.content,
          model: selectedLLMConfig.model || 'gpt-4',
        });
      } catch (error) {
        console.error('[Workflow] Failed to save user message:', error);
      }
    }

    try {
      // 获取API密钥（Ollama 不需要 API key）
      const apiKey = await getLLMConfigApiKey(selectedLLMConfigId);
      if (selectedLLMConfig.provider !== 'ollama' && !apiKey) {
        throw new Error('API密钥未配置，请检查LLM配置');
      }

      // 收集所有可用的MCP工具（如果选择了MCP服务器）
      const allTools: MCPTool[] = [];
      if (selectedMcpServerIds.size > 0) {
        for (const serverId of selectedMcpServerIds) {
          const tools = mcpTools.get(serverId) || [];
          allTools.push(...tools);
        }
      }

      // 创建LLM客户端
      const llmClient = new LLMClient({
        id: selectedLLMConfig.config_id,
        provider: selectedLLMConfig.provider,
        name: selectedLLMConfig.name,
        apiKey: apiKey,
        apiUrl: selectedLLMConfig.api_url,
        model: selectedLLMConfig.model,
        enabled: selectedLLMConfig.enabled,
        metadata: selectedLLMConfig.metadata,
      });

      // 构建系统提示词
      // 优先从消息中获取系统提示词（如果已保存）
      let systemPrompt = '你是一个智能工作流助手，可以帮助用户完成各种任务。';
      
      // 查找系统提示词消息
      const systemPromptMessage = messages.find(m => 
        m.role === 'system' && 
        m.toolCalls && 
        typeof m.toolCalls === 'object' &&
        (m.toolCalls as any).isSystemPrompt === true
      );
      
      if (systemPromptMessage) {
        // 使用已保存的系统提示词消息内容
        systemPrompt = systemPromptMessage.content;
        console.log('[Workflow] Using saved system prompt from message');
      } else {
        // 如果没有保存的系统提示词，使用当前选定的批次数据项构建
        // 添加历史总结（如果有）
        if (summaries.length > 0) {
          const summaryTexts = summaries.map(s => s.summary_content).join('\n\n');
          systemPrompt += `\n\n以下是之前对话的总结，请参考这些上下文：\n\n${summaryTexts}\n\n`;
        }
        
        // 添加选定的批次数据项（如果有）
        if (selectedBatchItem) {
          const { item, batchName } = selectedBatchItem;
          systemPrompt += `\n\n【参考资料 - ${batchName}】\n`;
          if (item.title) {
            systemPrompt += `标题: ${item.title}\n`;
          }
          if (item.content) {
            systemPrompt += `内容:\n${item.content}\n`;
          }
          systemPrompt += '\n请基于以上参考资料回答用户的问题。';
          
          console.log('[Workflow] 添加批次数据项到系统提示词:', { item, batchName });
        }
      }
      
      // 添加历史总结（如果有，且系统提示词消息中没有）
      if (summaries.length > 0 && !systemPromptMessage) {
        const summaryTexts = summaries.map(s => s.summary_content).join('\n\n');
        systemPrompt += `\n\n以下是之前对话的总结，请参考这些上下文：\n\n${summaryTexts}\n\n`;
      }
      
      if (allTools.length > 0) {
        systemPrompt += `\n\n你可以使用以下 MCP 工具来帮助用户完成任务：\n\n${allTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n')}\n\n当用户需要执行操作时，使用相应的工具。用中文回复用户，并清晰地说明你执行的操作和结果。`;
      } else {
        systemPrompt += '请根据用户的问题提供有用的回答和建议。用中文回复用户。';
      }

      // 构建消息历史（用于 token 计数和自动 summarize）
      const model = selectedLLMConfig.model || 'gpt-4';
      // 使用从后端获取的 max_tokens，如果没有则使用前端函数作为后备
      const maxTokens = selectedLLMConfig.max_tokens || get_model_max_tokens(model);
      const tokenThreshold = maxTokens - 1000; // 在限额-1000时触发 summarize
      
      // 找到最近一条总结消息的位置，只计算实际会发送的消息
      let lastSummaryIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].isSummary) {
          lastSummaryIndex = i;
          break;
        }
      }
      
      // 如果找到总结消息，从总结消息开始计算（包含总结消息）；否则计算所有消息
      const messagesToCount = lastSummaryIndex >= 0 
        ? messages.slice(lastSummaryIndex)
        : messages;
      
      // 构建用于token计算的消息列表（排除不发送的系统消息）
      const conversationMessages = messagesToCount
        .filter(m => {
          // 排除系统消息（但包含总结消息和系统提示词消息，因为总结消息会作为user消息发送，系统提示词消息已包含在systemPrompt中）
          if (m.role === 'system' && !m.isSummary) {
            // 检查是否是系统提示词消息
            const isSystemPrompt = m.toolCalls && 
              typeof m.toolCalls === 'object' &&
              (m.toolCalls as any).isSystemPrompt === true;
            if (!isSystemPrompt) {
              return false; // 排除普通系统消息
            }
          }
          return true;
        })
        .map(msg => {
          // 如果是总结消息，作为user消息计算token
          if (msg.isSummary) {
            return {
              role: 'user' as const,
              content: msg.content,
              thinking: undefined,
            };
          }
          return {
            role: msg.role,
            content: msg.content,
            thinking: msg.thinking,
          };
        });
      
      // 估算当前 token 数量（包括新用户消息）
      const currentTokens = estimate_messages_tokens(conversationMessages, model);
      
      // 将消息历史转换为 LLMMessage 格式（用于传递给 LLMClient）
      // 使用之前找到的 lastSummaryIndex，从总结消息开始（包含总结消息）
      const messagesToSend = lastSummaryIndex >= 0 
        ? messages.slice(lastSummaryIndex)
        : messages;
      
      const messageHistory: LLMMessage[] = [];
      for (const msg of messagesToSend) {
        // 如果是总结消息，将其内容作为 user 消息发送
        if (msg.isSummary) {
          messageHistory.push({
            role: 'user',
            content: msg.content, // 总结内容作为 user 消息
          });
          continue;
        }
        
        // 排除其他系统消息（通知消息等），但保留系统提示词消息（它已包含在systemPrompt中，不需要重复发送）
        if (msg.role === 'system') {
          // 检查是否是系统提示词消息
          const isSystemPrompt = msg.toolCalls && 
            typeof msg.toolCalls === 'object' &&
            (msg.toolCalls as any).isSystemPrompt === true;
          if (!isSystemPrompt) {
            continue; // 排除普通系统消息
          }
          // 系统提示词消息也不发送（因为它已包含在systemPrompt中）
          continue;
        }
        
        // 如果是 workflow 类型的 tool 消息，转换为 tool 类型
        if (msg.role === 'tool' && msg.toolType === 'workflow') {
          const workflowOutput = msg.content || '执行完成';
          messageHistory.push({
            role: 'tool',
            name: msg.workflowName || 'workflow',
            content: `我自己执行了一些操作，有这样的输出：${workflowOutput}`,
          });
        }
        // 其他 tool 消息（如 MCP）排除
        else if (msg.role === 'tool') {
          continue;
        }
        // user 和 assistant 消息直接转换
        else if (msg.role === 'user' || msg.role === 'assistant') {
          messageHistory.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }
      
      // 检查是否需要自动 summarize
      let needsSummarize = false;
      if (currentTokens > tokenThreshold) {
        console.log(`[Workflow] Token count (${currentTokens}) exceeds threshold (${tokenThreshold}), triggering summarize`);
        needsSummarize = true;
      }
      
      // 如果需要 summarize，先执行总结
      if (needsSummarize && sessionId) {
        try {
          setIsSummarizing(true);
          const messagesToSummarize = conversationMessages.slice(0, -1).map((msg, idx) => ({
            message_id: messages.find(m => m.content === msg.content && m.role === msg.role)?.id || `msg-${idx}`,
            role: msg.role,
            content: msg.content,
          }));
          
          if (messagesToSummarize.length > 0) {
            await processSummarize(sessionId, messagesToSummarize, true);
          }
        } catch (error) {
          console.error('[Workflow] Auto-summarize failed:', error);
          // 继续执行，即使 summarize 失败
        } finally {
          setIsSummarizing(false);
        }
      }

      // 创建流式响应的消息
      const assistantMessageId = `msg-${Date.now() + 1}`;
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        thinking: '',
        isStreaming: true,
        isThinking: true, // 初始状态为思考中
      };
      setMessages(prev => [...prev, assistantMessage]);
      // 默认折叠思考过程
      setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));

      // 使用LLM客户端处理用户请求（自动调用MCP工具）
      let fullResponse = '';
      let fullThinking = '';
      let hasStartedContent = false; // 标记是否开始输出内容
      
      // 创建临时消息更新函数
      const updateMessage = (content: string, thinking?: string, isThinking?: boolean, isStreaming?: boolean) => {
        setMessages(prev => prev.map(msg => 
          msg.id === assistantMessageId 
            ? { 
                ...msg, 
                content, 
                thinking: thinking !== undefined ? thinking : msg.thinking,
                isThinking: isThinking !== undefined ? isThinking : msg.isThinking,
                isStreaming: isStreaming !== undefined ? isStreaming : msg.isStreaming,
              }
            : msg
        ));
      };

      if (streamEnabled) {
        // 流式响应模式
        const response = await llmClient.handleUserRequestWithThinking(
          userMessage.content,
          systemPrompt,
          allTools.length > 0 ? allTools : undefined,
          true, // 启用流式响应
          (chunk: string, thinking?: string) => {
            // 流式更新消息内容
            if (chunk) {
              fullResponse += chunk;
              hasStartedContent = true;
              // 如果开始输出内容，切换到回答状态，但保持流式
              updateMessage(fullResponse, fullThinking, false, true);
            }
            if (thinking !== undefined && thinking.length > 0) {
              fullThinking = thinking; // 流式更新思考过程
              // 如果有思考内容但还没有开始输出内容，保持思考状态
              if (!hasStartedContent) {
                updateMessage(fullResponse, fullThinking, true, true);
              } else {
                // 如果已经开始输出内容，思考过程应该展开但标记为回答中
                updateMessage(fullResponse, fullThinking, false, true);
              }
            }
          },
          messageHistory // 传递消息历史
        );

        // 确保最终内容已更新（包括思考过程）
        // 结果完成后，自动折叠思考并更新状态为完成
        const finalContent = response.content || fullResponse;
        const finalThinking = response.thinking || fullThinking;
        updateMessage(finalContent, finalThinking, false, false);
        // 自动折叠思考过程（如果有思考内容）
        if (finalThinking && finalThinking.trim().length > 0) {
          setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));
        }
        
        // 保存助手消息到数据库（流式响应模式）
        if (sessionId) {
          try {
            await saveMessage(sessionId, {
              message_id: assistantMessageId,
              role: 'assistant',
              content: finalContent, // 保存完整的回答内容
              thinking: finalThinking, // 保存思考过程
              model: selectedLLMConfig.model || 'gpt-4',
            });
            console.log('[Workflow] Saved assistant message to database:', assistantMessageId);
          } catch (error) {
            console.error('[Workflow] Failed to save assistant message:', error);
          }
        }
      } else {
        // 非流式响应模式
        const response = await llmClient.handleUserRequestWithThinking(
          userMessage.content,
          systemPrompt,
          allTools.length > 0 ? allTools : undefined,
          false, // 禁用流式响应
          undefined, // 非流式模式不需要 onChunk
          messageHistory // 传递消息历史
        );
        updateMessage(response.content, response.thinking, false, false);
        // 自动折叠思考过程（如果有思考内容）
        if (response.thinking && response.thinking.trim().length > 0) {
          setCollapsedThinking(prev => new Set(prev).add(assistantMessageId));
        }
        
        // 保存助手消息到数据库（非流式响应模式）
        if (sessionId) {
          try {
            await saveMessage(sessionId, {
              message_id: assistantMessageId,
              role: 'assistant',
              content: response.content, // 保存完整的回答内容
              thinking: response.thinking, // 保存思考过程
              model: selectedLLMConfig.model || 'gpt-4',
            });
            console.log('[Workflow] Saved assistant message to database:', assistantMessageId);
          } catch (error) {
            console.error('[Workflow] Failed to save assistant message:', error);
          }
        }
      }
      
      // 无论流式还是非流式，完成后都更新 isLoading 状态
      setIsLoading(false);
    } catch (error) {
      console.error('[Workflow] Error details:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ 错误: ${errorMsg}

🔍 排查步骤：
1. 检查 LLM 模型配置是否正确
2. 检查 MCP 服务器是否已连接
3. 检查 API 密钥是否有效
4. 查看浏览器控制台的详细错误信息`,
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 开始编辑消息
  const handleStartEdit = (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (message && message.role === 'user') {
      setEditingMessageId(messageId);
      setInput(message.content);
      inputRef.current?.focus();
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setInput('');
  };

  // 重新发送消息（编辑后或直接重新发送）
  const handleResendMessage = async (messageId: string, newContent?: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || message.role !== 'user') {
      return;
    }

    const contentToSend = newContent || message.content;
    
    // 找到该消息的索引
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      return;
    }

    // 删除该消息及其之后的所有消息（包括数据库中的）
    const messagesToDelete = messages.slice(messageIndex);
    
    if (currentSessionId) {
      try {
        // 删除数据库中的消息
        for (const msg of messagesToDelete) {
          if (msg.role !== 'system') {
            try {
              await deleteMessage(currentSessionId, msg.id);
            } catch (error) {
              console.error(`[Workflow] Failed to delete message ${msg.id}:`, error);
            }
          }
        }
        
        // 清除总结缓存（因为删除了消息）
        await clearSummarizeCache(currentSessionId);
        await loadSessionSummaries(currentSessionId);
      } catch (error) {
        console.error('[Workflow] Failed to delete messages:', error);
      }
    }

    // 从消息列表中删除这些消息（保留到该消息之前的所有消息）
    setMessages(prev => prev.slice(0, messageIndex));
    
    // 取消编辑状态
    setEditingMessageId(null);
    
    // 使用新内容发送消息
    setInput(contentToSend);
    // 等待状态更新后发送
    setTimeout(() => {
      handleSend();
    }, 100);
  };

  const toggleThinkingCollapse = (messageId: string) => {
    setCollapsedThinking(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };
  
  // 处理输入框变化，检测 @ 符号和 /模块 命令
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    
    const cursorPosition = e.target.selectionStart || 0;
    const textBeforeCursor = value.substring(0, cursorPosition);
    
    // 检测 / 命令（优先于@符号）
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
        setShowAtSelector(false); // 隐藏@选择器
        
        // 计算选择器位置（参考@选择器的逻辑，从下往上展开）
        if (inputRef.current) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          
          // 使用更可靠的方法：创建一个完全镜像 textarea 的隐藏 div 元素
          const mirror = document.createElement('div');
          
          // 复制关键样式，确保与 textarea 完全一致
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
          
          // 设置文本内容到光标位置
          mirror.textContent = textBeforeCursor;
          document.body.appendChild(mirror);
          
          // 使用 Range API 来获取文本末尾（光标位置）的精确坐标
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              // 设置 range 到文本末尾（光标位置）
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              
              // 使用 right 属性来获取光标右侧的位置（更可靠）
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
              
              // 如果 right 和 left 相同（width 为 0），说明光标在文本末尾
              if (rangeRect.width === 0 && textLength > 0) {
                // 创建一个临时元素来测量文本宽度
                const measureSpan = document.createElement('span');
                measureSpan.style.font = styles.font;
                measureSpan.style.fontSize = styles.fontSize;
                measureSpan.style.fontFamily = styles.fontFamily;
                measureSpan.style.fontWeight = styles.fontWeight;
                measureSpan.style.fontStyle = styles.fontStyle;
                measureSpan.style.letterSpacing = styles.letterSpacing;
                measureSpan.style.whiteSpace = 'pre';
                measureSpan.textContent = textBeforeCursor;
                measureSpan.style.position = 'absolute';
                measureSpan.style.visibility = 'hidden';
                document.body.appendChild(measureSpan);
                const textWidth = measureSpan.offsetWidth;
                document.body.removeChild(measureSpan);
                
                // 使用 mirror 的位置 + padding + 文本宽度
                const mirrorRect = mirror.getBoundingClientRect();
                const paddingLeft = parseFloat(styles.paddingLeft) || 0;
                cursorX = mirrorRect.left + paddingLeft + textWidth;
              }
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            // 如果 Range API 失败，使用备用方法
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            
            // 计算当前行的宽度
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
            
            // 计算行高和 padding
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          // 清理临时元素
          document.body.removeChild(mirror);
          
          // 选择器尺寸
          const selectorMaxHeight = 256; // max-h-64 = 256px
          const selectorWidth = 320; // 与 CrawlerModuleSelector 的宽度一致
          const viewportWidth = window.innerWidth;
          
          // 计算选择器位置（以光标为锚点，从下往上展开）
          // 策略：弹框底部紧贴光标位置，向上扩展
          
          // 左侧位置：光标右侧，加间距
          let left = cursorX + 8;
          
          // 如果选择器会超出右侧边界，则显示在光标左侧
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8; // 显示在光标左侧
            // 如果左侧也不够，就显示在光标右侧（即使会超出）
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          
          // 确保不会超出左侧
          if (left < 10) {
            left = 10;
          }
          
          // 使用 bottom 定位：弹框底部紧贴光标，向上扩展
          // 计算 bottom 值：从窗口底部到光标位置的距离
          const bottom = window.innerHeight - cursorY + 5; // 5px 间距，让弹框稍微在光标上方
          
          // 计算可用的向上高度（从光标到屏幕顶部的空间）
          const availableHeightAbove = cursorY - 20; // 留20px顶部边距
          
          // 最大高度取较小值：配置的最大高度 或 可用空间
          const actualMaxHeight = Math.min(selectorMaxHeight, availableHeightAbove);
          
          console.log('[Workflow] Module selector position:', {
            cursorY,
            bottom,
            availableHeightAbove,
            actualMaxHeight,
            windowHeight: window.innerHeight
          });
          
          setModuleSelectorPosition({
            bottom, // 使用 bottom 定位，从下往上扩展
            left,
            maxHeight: actualMaxHeight
          } as any);
          setShowModuleSelector(true);
        }
        return;
      } else {
        // / 后面有空格或换行，或不在行首，关闭选择器
        console.log('[Workflow] / 字符条件不符合，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    } else {
      // 没有找到 / 字符，关闭选择器
      if (showModuleSelector) {
        console.log('[Workflow] 删除了 / 字符，关闭模块选择器');
        setShowModuleSelector(false);
        setModuleSelectorIndex(-1);
      }
    }
    
    // 检测 @ 符号
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    console.log('[Workflow] Input change:', {
      value,
      cursorPosition,
      textBeforeCursor,
      lastAtIndex,
      showAtSelector,
    });
    
    if (lastAtIndex !== -1) {
      // 检查 @ 后面是否有空格或换行（如果有，说明不是在选择组件）
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      const hasSpaceOrNewline = textAfterAt.includes(' ') || textAfterAt.includes('\n');
      
      console.log('[Workflow] @ symbol detected:', {
        textAfterAt,
        hasSpaceOrNewline,
      });
      
      if (!hasSpaceOrNewline) {
        // 检查是否已经选择了感知组件
        if (selectedComponents.length > 0) {
          // 已经选择了组件，提示需要先删除
          console.log('[Workflow] Component already selected, need to remove first');
          setShowAtSelector(false);
          // 可以显示一个提示，但先不显示选择器
          return;
        }
        
        // 显示选择器
        const query = textAfterAt.toLowerCase();
        setAtSelectorIndex(lastAtIndex);
        setAtSelectorQuery(query);
        
        console.log('[Workflow] Showing selector with query:', query);
        
        // 计算选择器位置（跟随光标位置，出现在右上方）
        if (inputRef.current) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          
          // 使用更可靠的方法：创建一个完全镜像 textarea 的隐藏 div 元素
          const mirror = document.createElement('div');
          
          // 复制关键样式，确保与 textarea 完全一致
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
          
          // 设置文本内容到光标位置
          const textBeforeCursor = value.substring(0, cursorPosition);
          mirror.textContent = textBeforeCursor;
          
          document.body.appendChild(mirror);
          
          // 使用 Range API 来获取文本末尾（光标位置）的精确坐标
          let cursorX: number;
          let cursorY: number;
          
          try {
            const range = document.createRange();
            const mirrorTextNode = mirror.firstChild;
            
            if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
              // 设置 range 到文本末尾（光标位置）
              const textLength = mirrorTextNode.textContent?.length || 0;
              range.setStart(mirrorTextNode, textLength);
              range.setEnd(mirrorTextNode, textLength);
              const rangeRect = range.getBoundingClientRect();
              
              // 使用 right 属性来获取光标右侧的位置（更可靠）
              // 对于空 range（光标位置），right 会指向光标右侧
              cursorX = rangeRect.right;
              cursorY = rangeRect.top;
              
              // 如果 right 和 left 相同（width 为 0），说明光标在文本末尾
              // 这种情况下，我们需要测量文本的实际宽度
              if (rangeRect.width === 0 && textLength > 0) {
                // 创建一个临时元素来测量文本宽度
                const measureSpan = document.createElement('span');
                measureSpan.style.font = styles.font;
                measureSpan.style.fontSize = styles.fontSize;
                measureSpan.style.fontFamily = styles.fontFamily;
                measureSpan.style.fontWeight = styles.fontWeight;
                measureSpan.style.fontStyle = styles.fontStyle;
                measureSpan.style.letterSpacing = styles.letterSpacing;
                measureSpan.style.whiteSpace = 'pre';
                measureSpan.textContent = textBeforeCursor;
                measureSpan.style.position = 'absolute';
                measureSpan.style.visibility = 'hidden';
                document.body.appendChild(measureSpan);
                const textWidth = measureSpan.offsetWidth;
                document.body.removeChild(measureSpan);
                
                // 使用 mirror 的位置 + padding + 文本宽度
                const mirrorRect = mirror.getBoundingClientRect();
                const paddingLeft = parseFloat(styles.paddingLeft) || 0;
                cursorX = mirrorRect.left + paddingLeft + textWidth;
              }
            } else {
              throw new Error('No text node found');
            }
          } catch (e) {
            // 如果 Range API 失败，使用备用方法
            const mirrorRect = mirror.getBoundingClientRect();
            const lines = textBeforeCursor.split('\n');
            const lineIndex = lines.length - 1;
            const lineText = lines[lineIndex] || '';
            
            // 计算当前行的宽度
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
            
            // 计算行高和 padding
            const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.2;
            const paddingTop = parseFloat(styles.paddingTop) || 0;
            const paddingLeft = parseFloat(styles.paddingLeft) || 0;
            
            cursorX = mirrorRect.left + paddingLeft + lineWidth;
            cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
          }
          
          // 清理临时元素
          document.body.removeChild(mirror);
          
          // 选择器尺寸
          const selectorMaxHeight = 256; // max-h-64 = 256px
          const selectorWidth = 300; // maxWidth
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          
          // 计算选择器位置（以光标为锚点，从下往上展开）
          // 策略：弹框底部对齐光标位置，向上展开
          // 先计算弹框的理想高度（最大不超过 selectorMaxHeight）
          const idealHeight = selectorMaxHeight;
          
          // 计算弹框顶部位置：光标位置 - 弹框高度
          // 这样弹框底部会对齐光标位置
          let top = cursorY - idealHeight;
          let left = cursorX + 8; // 光标右侧，加上间距
          
          // 如果弹框会超出顶部，调整位置
          // 确保至少留出 10px 的顶部边距
          if (top < 10) {
            // 如果上方空间不足，限制弹框高度，使其顶部对齐到 10px
            // 这样弹框会从顶部开始，但底部尽量靠近光标
            // 注意：实际高度会在 CSS 中通过 max-height 限制，位置会在 useEffect 中进一步调整
            top = 10;
          }
          
          // 如果选择器会超出右侧边界，则显示在光标左侧
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8; // 显示在光标左侧
            // 如果左侧也不够，就显示在光标右侧（即使会超出）
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          
          // 确保不会超出左侧
          if (left < 10) {
            left = 10;
          }
          
          // 计算实际可用的最大高度（从 top 到光标位置的距离）
          const maxAvailableHeight = cursorY - top - 8; // 减去一些间距
          
          // 如果可用高度小于最大高度，使用可用高度
          const actualMaxHeight = Math.min(selectorMaxHeight, maxAvailableHeight);
          
          console.log('[Workflow] Selector position calculated (cursor):', { 
            top, 
            left, 
            cursorX,
            cursorY,
            textareaRect,
            viewportHeight,
            viewportWidth,
            cursorPosition,
            actualMaxHeight,
            maxAvailableHeight
          });
          
          setAtSelectorPosition({ 
            top, 
            left,
            maxHeight: actualMaxHeight // 传递最大高度
          });
          setShowAtSelector(true);
          setSelectedComponentIndex(0); // 重置选中索引
        } else {
          console.warn('[Workflow] inputRef.current is null');
        }
      } else {
        console.log('[Workflow] Hiding selector: space or newline after @');
        setShowAtSelector(false);
      }
    } else {
      console.log('[Workflow] No @ symbol found, hiding selector');
      setShowAtSelector(false);
    }
  };
  
  // 获取可选择的组件列表（用于键盘导航）
  const getSelectableComponents = React.useCallback(() => {
    const mcpList = mcpServers
      .filter(s => 
        connectedMcpServerIds.has(s.id) &&
        s.name.toLowerCase().includes(atSelectorQuery)
      )
      .map(s => ({ type: 'mcp' as const, id: s.id, name: s.name }));
    
    const workflowList = workflows
      .filter(w => w.name.toLowerCase().includes(atSelectorQuery))
      .map(w => ({ type: 'workflow' as const, id: w.workflow_id, name: w.name }));
    
    return [...mcpList, ...workflowList];
  }, [mcpServers, connectedMcpServerIds, workflows, atSelectorQuery]);
  
  // 处理模块选择（/模块命令）
  const handleModuleSelect = async (moduleId: string, batchId: string, batchName: string) => {
    try {
      // 获取批次数据
      const batch = await getBatch(moduleId, batchId);
      
      // 检查数据是否存在
      if (!batch || !batch.crawled_data) {
        alert('该批次没有数据');
        return;
      }
      
      // 优先使用 parsed_data（用户标记后生成的解析数据），如果没有则使用 crawled_data.normalized
      // parsed_data 现在是一个简单的数组，每个元素包含 title 和 content
      let normalizedData: any = null;
      
      if (batch.parsed_data && Array.isArray(batch.parsed_data)) {
        // parsed_data 是数组格式，转换为对象格式
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
        // parsed_data 是对象格式（兼容旧数据）
        normalizedData = batch.parsed_data;
      } else if (batch.crawled_data?.normalized) {
        // 使用 crawled_data.normalized
        normalizedData = batch.crawled_data.normalized;
      }
      
      if (!normalizedData || !normalizedData.items || normalizedData.items.length === 0) {
        alert('该批次没有解析数据，请先在爬虫配置页面标记并生成解析数据');
        return;
      }
      
      // 如果有多个数据项，显示选择器让用户选择
      if (normalizedData.items.length > 1) {
        setSelectedBatch(batch);
        setShowModuleSelector(false);
        
        // 计算批次数据项选择器的位置（使用相同的位置计算逻辑）
        if (inputRef.current && moduleSelectorIndex !== -1) {
          const textarea = inputRef.current;
          const textareaRect = textarea.getBoundingClientRect();
          const styles = window.getComputedStyle(textarea);
          const cursorPosition = moduleSelectorIndex + 1 + moduleSelectorQuery.length;
          const textBeforeCursor = input.substring(0, cursorPosition);
          
          // 使用与模块选择器相同的位置计算逻辑
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
          const selectorWidth = 500;
          const viewportWidth = window.innerWidth;
          const idealHeight = selectorMaxHeight;
          let top = cursorY - idealHeight;
          let left = cursorX + 8;
          
          if (top < 10) {
            top = 10;
          }
          
          if (left + selectorWidth > viewportWidth - 10) {
            left = cursorX - selectorWidth - 8;
            if (left < 10) {
              left = cursorX + 8;
            }
          }
          
          if (left < 10) {
            left = 10;
          }
          
          const maxAvailableHeight = cursorY - top - 8;
          const actualMaxHeight = Math.min(selectorMaxHeight, maxAvailableHeight);
          
          setBatchItemSelectorPosition({
            top,
            left,
            maxHeight: actualMaxHeight
          });
          setShowBatchItemSelector(true);
        }
      } else {
        // 只有一个数据项，直接插入
        const item = normalizedData.items[0];
        handleBatchItemSelect(item, batchName);
      }
    } catch (error: any) {
      console.error('[Workflow] Failed to select module:', error);
      alert(`获取模块数据失败: ${error.message || '未知错误'}`);
    }
  };
  
  // 处理批次数据项选择（显示操作选择界面）
  const handleBatchItemSelect = (item: any, batchName: string) => {
    console.log('[Workflow] 选定批次数据项，等待用户选择操作:', { item, batchName });
    
    // 保存待处理的批次数据项
    setPendingBatchItem({ item, batchName });
    
    // 关闭选择器
    setShowBatchItemSelector(false);
    setShowModuleSelector(false);
    setModuleSelectorIndex(-1);
    setModuleSelectorQuery('');
    setSelectedBatch(null);
    
    // 如果还在输入框中保留了 /模块 文本，清除它
    if (inputRef.current && moduleSelectorIndex !== -1) {
      const textBefore = input.substring(0, moduleSelectorIndex);
      const textAfter = input.substring(moduleSelectorIndex + 1 + moduleSelectorQuery.length);
      const newText = textBefore + textAfter;
      setInput(newText);
      
      // 设置光标位置
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(textBefore.length, textBefore.length);
          inputRef.current.focus();
        }
      }, 0);
    }
  };
  
  // 将批次数据项设置为系统提示词
  const handleSetAsSystemPrompt = async () => {
    if (!pendingBatchItem) return;
    
    const { item, batchName } = pendingBatchItem;
    console.log('[Workflow] 设置批次数据项为系统提示词:', { item, batchName });
    
    // 保存选定的批次数据项
    setSelectedBatchItem({ item, batchName });
    setPendingBatchItem(null);
    
    
    // 如果有会话，保存或更新系统提示词消息
    if (currentSessionId) {
      try {
        // 构建系统提示词内容
        let systemPromptContent = '你是一个智能工作流助手，可以帮助用户完成各种任务。\n\n';
        systemPromptContent += `【参考资料 - ${batchName}】\n`;
        if (item.title) {
          systemPromptContent += `标题: ${item.title}\n`;
        }
        if (item.content) {
          systemPromptContent += `内容:\n${item.content}\n`;
        }
        systemPromptContent += '\n请基于以上参考资料回答用户的问题。';
        
        // 查找是否已有系统提示词消息
        const existingSystemPromptMsg = messages.find(m => 
          m.role === 'system' && 
          m.toolCalls && 
          typeof m.toolCalls === 'object' &&
          (m.toolCalls as any).isSystemPrompt === true
        );
        
        if (existingSystemPromptMsg) {
          // 更新现有系统提示词消息
          const systemPromptMessageId = existingSystemPromptMsg.id;
          
          // 更新本地消息
          setMessages(prev => prev.map(msg => 
            msg.id === systemPromptMessageId
              ? {
                  ...msg,
                  content: systemPromptContent,
                  toolCalls: {
                    isSystemPrompt: true,
                    batchName,
                    item,
                  }
                }
              : msg
          ));
          
          // 更新数据库中的消息（需要先删除旧消息，再创建新消息，因为消息ID不变）
          // 注意：这里我们直接更新内容，但数据库可能需要特殊处理
          // 为了简化，我们可以删除旧消息并创建新消息
          try {
            await deleteMessage(currentSessionId, systemPromptMessageId);
            await saveMessage(currentSessionId, {
              message_id: systemPromptMessageId,
              role: 'system',
              content: systemPromptContent,
              tool_calls: {
                isSystemPrompt: true,
                batchName,
                item,
              },
              model: selectedLLMConfig?.model || 'gpt-4',
            });
            console.log('[Workflow] Updated system prompt message:', systemPromptMessageId);
          } catch (error) {
            console.error('[Workflow] Failed to update system prompt message:', error);
          }
        } else {
          // 创建新的系统提示词消息
          const systemPromptMessageId = `system-prompt-${Date.now()}`;
          const systemPromptMessage: Message = {
            id: systemPromptMessageId,
            role: 'system',
            content: systemPromptContent,
            toolCalls: {
              isSystemPrompt: true,
              batchName,
              item,
            },
          };
          
          // 添加到消息列表（插入到第一条用户消息之前，或最前面）
          setMessages(prev => {
            const userMessageIndex = prev.findIndex(m => m.role === 'user');
            if (userMessageIndex >= 0) {
              // 插入到第一条用户消息之前
              const newMessages = [...prev];
              newMessages.splice(userMessageIndex, 0, systemPromptMessage);
              return newMessages;
            } else {
              // 如果没有用户消息，插入到最前面（系统消息之后）
              const systemMessageIndex = prev.findIndex(m => m.role === 'system' && !m.toolCalls);
              if (systemMessageIndex >= 0) {
                const newMessages = [...prev];
                newMessages.splice(systemMessageIndex + 1, 0, systemPromptMessage);
                return newMessages;
              } else {
                return [systemPromptMessage, ...prev];
              }
            }
          });
          
          // 保存到数据库
          try {
            await saveMessage(currentSessionId, {
              message_id: systemPromptMessageId,
              role: 'system',
              content: systemPromptContent,
              tool_calls: {
                isSystemPrompt: true,
                batchName,
                item,
              },
              model: selectedLLMConfig?.model || 'gpt-4',
            });
            console.log('[Workflow] Saved system prompt message:', systemPromptMessageId);
          } catch (error) {
            console.error('[Workflow] Failed to save system prompt message:', error);
          }
        }
      } catch (error) {
        console.error('[Workflow] Failed to save/update system prompt:', error);
      }
    }
  };
  
  // 将批次数据项作为对话内容插入
  const handleInsertAsMessage = () => {
    if (!pendingBatchItem) return;
    
    const { item, batchName } = pendingBatchItem;
    console.log('[Workflow] 将批次数据项插入为对话内容:', { item, batchName });
    
    // 构建插入的文本
    let insertText = `[引用: ${batchName}]\n`;
    if (item.title) {
      insertText += `标题: ${item.title}\n`;
    }
    if (item.content) {
      insertText += `内容: ${item.content}\n`;
    }
    insertText += '\n';
    
    // 插入到输入框
    if (inputRef.current) {
      const currentValue = input;
      const cursorPosition = inputRef.current.selectionStart || currentValue.length;
      const textBefore = currentValue.substring(0, cursorPosition);
      const textAfter = currentValue.substring(cursorPosition);
      const newText = textBefore + insertText + textAfter;
      
      setInput(newText);
      setPendingBatchItem(null);
      
      // 设置光标位置
      setTimeout(() => {
        if (inputRef.current) {
          const newCursorPos = textBefore.length + insertText.length;
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
          inputRef.current.focus();
        }
      }, 0);
    }
  };
  
  // 选择感知组件（添加为 tag）
  const handleSelectComponent = (component: { type: 'mcp' | 'workflow'; id: string; name: string }) => {
    if (atSelectorIndex === -1) return;
    
    // 检查是否已经选择了组件（限制只能选择一个）
    if (selectedComponents.length > 0) {
      console.log('[Workflow] Component already selected, cannot add another');
      // 显示提示信息
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '⚠️ 只能选择一个感知组件。请先删除已选择的组件，然后再选择新的组件。',
      };
      setMessages(prev => [...prev, errorMsg]);
      setShowAtSelector(false);
      setAtSelectorIndex(-1);
      setAtSelectorQuery('');
      return;
    }
    
    // 检查是否已经添加过该组件
    const isAlreadySelected = selectedComponents.some(
      c => c.id === component.id && c.type === component.type
    );
    
    if (!isAlreadySelected) {
      // 添加到已选定的组件列表
      setSelectedComponents(prev => [...prev, component]);
      
      // 如果是MCP服务器，自动激活它（添加到selectedMcpServerIds）
      if (component.type === 'mcp') {
        // 确保MCP服务器已连接
        if (connectedMcpServerIds.has(component.id)) {
          setSelectedMcpServerIds(prev => {
            const newSet = new Set(prev);
            newSet.add(component.id);
            return newSet;
          });
          console.log('[Workflow] Auto-activated MCP server:', component.name);
        } else {
          console.warn('[Workflow] MCP server not connected, cannot activate:', component.name);
        }
      }
    }
    
    // 移除输入框中的 @ 符号及其后的内容
    const beforeAt = input.substring(0, atSelectorIndex);
    const afterAt = input.substring(atSelectorIndex + 1);
    const spaceIndex = afterAt.indexOf(' ');
    const newlineIndex = afterAt.indexOf('\n');
    const endIndex = spaceIndex !== -1 && newlineIndex !== -1 
      ? Math.min(spaceIndex, newlineIndex)
      : spaceIndex !== -1 
      ? spaceIndex 
      : newlineIndex !== -1 
      ? newlineIndex 
      : afterAt.length;
    
    // 移除 @ 符号和查询文本，保留后续内容
    const newInput = beforeAt + afterAt.substring(endIndex);
    setInput(newInput);
    setShowAtSelector(false);
    setAtSelectorIndex(-1);
    setAtSelectorQuery('');
    
    // 聚焦输入框
    if (inputRef.current) {
      inputRef.current.focus();
      const newCursorPos = atSelectorIndex;
      setTimeout(() => {
        inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };
  
  // 删除选定的组件（tag）
  const handleRemoveComponent = (index: number) => {
    const component = selectedComponents[index];
    if (component) {
      // 如果是MCP服务器，从selectedMcpServerIds中移除
      if (component.type === 'mcp') {
        setSelectedMcpServerIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(component.id);
          return newSet;
        });
        console.log('[Workflow] Deactivated MCP server:', component.name);
      }
    }
    setSelectedComponents(prev => prev.filter((_, i) => i !== index));
  };

  // 处理拖拽组件到对话框
  const handleDropComponent = async (component: { type: 'mcp' | 'workflow'; id: string; name: string }) => {
    if (!currentSessionId) {
      // 如果没有会话，先创建
      try {
        const newSession = await createSession(
          selectedLLMConfigId || undefined,
          `会话 - ${component.name}`
        );
        setCurrentSessionId(newSession.session_id);
        await loadSessions();
        // 创建会话后添加工作流消息
        addWorkflowMessage(component);
      } catch (error) {
        console.error('[Workflow] Failed to create session:', error);
        alert('创建会话失败，请重试');
      }
    } else {
      addWorkflowMessage(component);
    }
  };
  
  // 添加工作流消息（保存到数据库，以便后端API能够找到并执行）
  const addWorkflowMessage = async (component: { type: 'mcp' | 'workflow'; id: string; name: string }) => {
    const workflowMessageId = `workflow-${Date.now()}`;
    
    // 如果是工作流，获取详细信息（包括节点）
    let workflowDetails: WorkflowType | null = null;
    if (component.type === 'workflow') {
      try {
        workflowDetails = await getWorkflow(component.id);
        console.log('[Workflow] Loaded workflow details:', workflowDetails);
      } catch (error) {
        console.error('[Workflow] Failed to load workflow details:', error);
      }
    }
    
    const workflowMessage: Message = {
      id: workflowMessageId,
      role: 'tool',
      content: '',
      toolType: component.type, // 'workflow' 或 'mcp'
      workflowId: component.id,
      workflowName: component.name,
      workflowStatus: 'pending',
      workflowConfig: workflowDetails?.config, // 保存工作流配置（节点和连接）
    };
    
    setMessages(prev => [...prev, workflowMessage]);
    
    // 保存消息到数据库，tool_calls字段包含组件信息，以便后端API能够找到并执行
    if (currentSessionId) {
      try {
        await saveMessage(currentSessionId, {
          message_id: workflowMessageId,
          role: 'tool',
          content: '',
          tool_calls: {
            toolType: component.type,
            workflowId: component.id,
            workflowName: component.name,
            workflowStatus: 'pending',
            workflowConfig: workflowDetails?.config,
          },
        });
        console.log('[Workflow] Saved workflow message to database:', workflowMessageId);
      } catch (error) {
        console.error('[Workflow] Failed to save workflow message:', error);
      }
    }
  };
  
  // 执行工作流
  const handleExecuteWorkflow = async (messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    if (!message || !message.workflowId) {
      console.error('[Workflow] Cannot execute workflow: message not found or missing workflowId', { messageId, message });
      alert('无法执行工作流：缺少必要信息');
      return;
    }
    
    // 检查是否选择了LLM配置
    if (!selectedLLMConfigId || !selectedLLMConfig) {
      alert('请先选择 LLM 模型');
      return;
    }
    
    // 获取上一条消息作为输入（跳过其他工作流消息，找到用户或助手消息）
    const messageIndex = messages.findIndex(m => m.id === messageId);
    let previousMessage: Message | null = null;
    for (let i = messageIndex - 1; i >= 0; i--) {
      const msg = messages[i];
      // 跳过工作流消息，找到用户或助手消息
      if (msg.role === 'user' || msg.role === 'assistant') {
        previousMessage = msg;
        break;
      }
    }
    
    const input = previousMessage?.content || '';
    
    if (!input) {
      alert('上一条消息为空，无法执行工作流');
      return;
    }
    
    // 更新消息状态为运行中
    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? { ...msg, workflowStatus: 'running' }
        : msg
    ));
    
    try {
      // 使用新的 message_execution API 执行感知组件
      const execution = await executeMessageComponent(
        messageId,
        selectedLLMConfigId,
        input
      );
      
      // 更新消息状态和结果
      const result = execution.result || execution.error_message || '执行完成';
      const status = execution.status === 'completed' ? 'completed' : 'error';
      
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { 
              ...msg, 
              workflowStatus: status,
              content: result,
            }
          : msg
      ));
      
      // 注意：不再直接保存消息到数据库，执行结果已通过 message_execution 表管理
      console.log('[Workflow] Execution completed:', execution);
      
    } catch (error) {
      console.error('[Workflow] Failed to execute workflow:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { 
              ...msg, 
              workflowStatus: 'error',
              content: `❌ 执行失败: ${errorMsg}`,
            }
          : msg
      ));
      
      // 注意：错误信息已通过 message_execution 表记录
      console.error('[Workflow] Execution error:', errorMsg);
    }
  };

  // 删除工作流消息
  const handleDeleteWorkflowMessage = async (messageId: string) => {
    if (!confirm('确定要删除这个感知流程吗？')) {
      return;
    }
    
    // 从消息列表中删除
    setMessages(prev => prev.filter(msg => msg.id !== messageId));
    
    // 从数据库删除（如果已保存）
    if (currentSessionId) {
      try {
        await deleteMessage(currentSessionId, messageId);
        console.log('[Workflow] Deleted workflow message:', messageId);
      } catch (error) {
        console.error('[Workflow] Failed to delete workflow message:', error);
        // 如果删除失败，恢复消息到列表中
        const message = messages.find(m => m.id === messageId);
        if (message) {
          setMessages(prev => [...prev, message]);
          alert('删除失败，请重试');
        }
      }
    }
  };
  
  // 回退消息到指定位置（用于重新触发）
  const rollbackMessages = async (targetMessageId: string) => {
    const targetIndex = messages.findIndex(m => m.id === targetMessageId);
    if (targetIndex === -1) {
      // 如果找不到目标消息，回退到第一条消息
      setMessages(prev => prev.slice(0, 1));
      return;
    }
    
    // 找到回退范围内的所有消息ID
    const messagesToDelete = messages.slice(targetIndex + 1).map(m => m.id);
    
    // 检查回退范围内是否有工作流消息或AI回复（可能触发过summarize）
    const rollbackMessagesList = messages.slice(targetIndex + 1);
    const hasWorkflowOrAssistant = rollbackMessagesList.some(msg => 
      msg.role === 'tool' || msg.role === 'assistant'
    );
    
    // 如果回退范围内有工作流或AI回复，且存在summaries，删除summary缓存
    if (hasWorkflowOrAssistant && summaries.length > 0 && currentSessionId) {
      try {
        await clearSummarizeCache(currentSessionId);
        // 重新加载summaries
        await loadSessionSummaries(currentSessionId);
        console.log('[Workflow] Cleared summarize cache due to rollback');
      } catch (error) {
        console.error('[Workflow] Failed to clear summarize cache:', error);
      }
    }
    
    // 回退消息列表
    setMessages(prev => prev.slice(0, targetIndex + 1));
    
    // 从数据库删除回退的消息（如果已保存）
    if (currentSessionId && messagesToDelete.length > 0) {
      try {
        // TODO: 批量删除消息的API
        console.log('[Workflow] Rolled back messages:', messagesToDelete);
      } catch (error) {
        console.error('[Workflow] Failed to rollback messages:', error);
      }
    }
  };

  const renderMessageContent = (message: Message) => {
    // 工具消息（感知组件）
    if (message.role === 'tool' && message.toolType) {
      const workflowConfig = message.workflowConfig;
      const nodes = workflowConfig?.nodes || [];
      const connections = workflowConfig?.connections || [];
      
      // 获取节点类型统计
      const nodeTypeCounts = nodes.reduce((acc, node) => {
        acc[node.type] = (acc[node.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      return (
        <div className="w-full bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-lg">
          {/* 标题栏和删除按钮 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${
                message.toolType === 'workflow' 
                  ? 'bg-gray-900 dark:bg-gray-100' 
                  : 'bg-gray-800 dark:bg-gray-200'
              }`}>
                {message.toolType === 'workflow' ? (
                  <WorkflowIcon className="w-5 h-5 text-white dark:text-gray-900" />
                ) : (
                  <Plug className="w-5 h-5 text-white dark:text-gray-900" />
                )}
              </div>
              <div>
                <div className="font-semibold text-base text-gray-900 dark:text-gray-100">
                  {message.workflowName || '感知组件'}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {message.toolType === 'workflow' ? '工作流组件' : message.toolType === 'mcp' ? 'MCP服务器' : '感知组件'}
                </div>
              </div>
            </div>
            <button
              onClick={() => handleDeleteWorkflowMessage(message.id)}
              className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
              title="删除感知流程"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          
          {/* 工作流执行流程图 - 优化设计 */}
          <div className="w-full bg-white dark:bg-gray-900 rounded-lg p-5 border-2 border-gray-200 dark:border-gray-700 mb-4 shadow-inner">
            <div className="flex items-center justify-between w-full">
              {/* 输入节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className="w-20 h-20 rounded-2xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 flex items-center justify-center text-sm font-bold shadow-lg mb-3 transition-all">
                  输入
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded">
                  {(() => {
                    const messageIndex = messages.findIndex(m => m.id === message.id);
                    const prevMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;
                    return prevMessage?.content?.substring(0, 25) || '等待输入...';
                  })()}
                </div>
              </div>
              
              {/* 箭头 */}
              <ArrowRight className="w-10 h-10 text-gray-400 dark:text-gray-600 mx-3 flex-shrink-0" />
              
              {/* 工作流节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className={`w-24 h-24 rounded-2xl ${
                  message.workflowStatus === 'running' 
                    ? 'bg-gray-700 dark:bg-gray-300 animate-pulse shadow-xl' 
                    : message.workflowStatus === 'completed'
                    ? 'bg-gray-900 dark:bg-gray-100 shadow-xl'
                    : message.workflowStatus === 'error'
                    ? 'bg-gray-600 dark:bg-gray-500 shadow-lg'
                    : 'bg-gray-800 dark:bg-gray-200 shadow-lg'
                } text-white dark:text-gray-900 flex items-center justify-center text-xs font-bold text-center px-3 mb-3 transition-all`}>
                  <div className="truncate">{message.workflowName || '工作流'}</div>
                </div>
                <div className={`text-xs font-medium px-2 py-1 rounded ${
                  message.workflowStatus === 'pending' ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300' :
                  message.workflowStatus === 'running' ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                  message.workflowStatus === 'completed' ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                  'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                }`}>
                  {message.workflowStatus === 'pending' ? '待执行' :
                   message.workflowStatus === 'running' ? '执行中...' :
                   message.workflowStatus === 'completed' ? '已完成' :
                   message.workflowStatus === 'error' ? '执行失败' : '未知'}
                </div>
              </div>
              
              {/* 箭头 */}
              <ArrowRight className="w-10 h-10 text-gray-400 dark:text-gray-600 mx-3 flex-shrink-0" />
              
              {/* 输出节点 */}
              <div className="flex flex-col items-center flex-1">
                <div className={`w-20 h-20 rounded-2xl ${
                  message.workflowStatus === 'completed' 
                    ? 'bg-gray-900 dark:bg-gray-100 shadow-xl' 
                    : message.workflowStatus === 'error'
                    ? 'bg-gray-600 dark:bg-gray-500 shadow-lg'
                    : 'bg-gray-300 dark:bg-gray-700 shadow-md'
                } text-white dark:text-gray-900 flex items-center justify-center text-sm font-bold mb-3 transition-all`}>
                  输出
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 text-center max-w-[120px] px-2 py-1 bg-gray-50 dark:bg-gray-800 rounded">
                  {message.workflowStatus === 'completed' ? '已生成结果' :
                   message.workflowStatus === 'error' ? '执行失败' :
                   '等待输出...'}
                </div>
              </div>
            </div>
          </div>
          
          {/* 工作流内部细节（节点信息） */}
          {message.toolType === 'workflow' && nodes.length > 0 && (
            <div className="w-full bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700 mb-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
                工作流内部结构
              </div>
              <div className="space-y-2">
                {/* 节点类型统计 */}
                <div className="flex flex-wrap gap-2">
                  {Object.entries(nodeTypeCounts).map(([type, count]) => (
                    <div
                      key={type}
                      className="px-2.5 py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs text-gray-700 dark:text-gray-300"
                    >
                      <span className="font-medium">{type}:</span> {count}
                    </div>
                  ))}
                </div>
                
                {/* 节点列表 */}
                <div className="mt-3 space-y-1.5">
                  <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    节点详情:
                  </div>
                  {nodes.map((node) => (
                    <div
                      key={node.id}
                      className="flex items-center space-x-2 px-2 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs"
                    >
                      <div className="w-2 h-2 rounded-full bg-gray-600 dark:bg-gray-400 flex-shrink-0"></div>
                      <span className="text-gray-700 dark:text-gray-300 font-medium">{node.type}</span>
                      {node.data.label && (
                        <span className="text-gray-500 dark:text-gray-500 truncate">- {node.data.label}</span>
                      )}
                    </div>
                  ))}
                </div>
                
                {/* 连接信息 */}
                {connections.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                      连接关系: {connections.length} 条
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* 执行按钮或执行结果 */}
          {message.workflowId ? (
            message.workflowStatus === 'pending' ? (
              <button
                onClick={() => handleExecuteWorkflow(message.id)}
                className="w-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm"
              >
                <Play className="w-4 h-4" />
                <span>开始执行</span>
              </button>
            ) : message.workflowStatus === 'running' ? (
              <div className="flex items-center justify-center space-x-2 text-gray-700 dark:text-gray-300 py-2.5">
                <Loader className="w-4 h-4 animate-spin" />
                <span className="text-sm font-medium">执行中...</span>
              </div>
            ) : message.workflowStatus === 'completed' || message.workflowStatus === 'error' ? (
              <div className="space-y-3">
                {/* 执行结果 */}
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wide">
                    {message.workflowStatus === 'completed' ? '执行结果' : '执行失败'}
                  </div>
                  {(() => {
                    const content = message.content || '';
                    const logMatch = content.match(/执行日志:\s*\n(.*)/s);
                    const mainContent = logMatch ? content.substring(0, logMatch.index) : content;
                    const logs = logMatch ? logMatch[1].trim().split('\n') : [];
                    
                    return (
                      <div className="space-y-3">
                        {/* 主要内容 */}
                        {mainContent && (
                          <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                            {mainContent.trim()}
                          </div>
                        )}
                        
                        {/* 执行日志 */}
                        {logs.length > 0 && (
                          <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3">
                            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
                              执行日志
                            </div>
                            <div className="bg-gray-900 dark:bg-gray-950 text-green-400 dark:text-green-300 font-mono text-xs p-3 rounded border border-gray-700 dark:border-gray-600 max-h-64 overflow-y-auto">
                              {logs.map((log, idx) => (
                                <div key={idx} className="mb-1">
                                  {log}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                
                {/* 重新执行按钮 */}
                <button
                  onClick={() => handleExecuteWorkflow(message.id)}
                  className="w-full bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-gray-300 px-4 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-sm"
                >
                  <Play className="w-4 h-4" />
                  <span>重新执行</span>
                </button>
              </div>
            ) : null
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
              无法执行：缺少工作流信息
            </div>
          )}
        </div>
      );
    }
    
    // 普通工具调用消息（不是感知组件）
    if (message.role === 'tool' && message.toolCalls && !message.toolType) {
      return (
        <div>
          <div className="font-medium text-sm mb-2">工具调用:</div>
          {message.toolCalls.map((toolCall, idx) => (
            <div key={idx} className="mb-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <Wrench className="w-4 h-4 text-blue-500" />
                <span className="font-medium text-sm">{toolCall.name}</span>
              </div>
              {toolCall.arguments && (
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                  <span className="font-medium">参数:</span>
                  <pre className="mt-1 bg-white dark:bg-gray-900 p-2 rounded border text-xs overflow-auto">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                </div>
              )}
              {toolCall.result && (
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  <span className="font-medium">结果:</span>
                  <pre className="mt-1 bg-white dark:bg-gray-900 p-2 rounded border text-xs overflow-auto">
                    {JSON.stringify(toolCall.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    }

    const isThinkingCollapsed = collapsedThinking.has(message.id);
    const hasThinking = message.thinking && message.thinking.trim().length > 0;

    return (
      <div>
        {hasThinking && (
          <div className="mb-3 border-b border-gray-200 dark:border-gray-700 pb-3">
            <button
              onClick={() => toggleThinkingCollapse(message.id)}
              className="flex items-center space-x-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mb-2"
            >
              {isThinkingCollapsed ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
              <span className="font-medium">思考过程</span>
            </button>
            {!isThinkingCollapsed && (
              <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 font-mono leading-relaxed whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                {message.thinking}
                {message.isStreaming && message.isThinking && (
                  <span className="inline-block ml-2 w-1.5 h-1.5 bg-blue-500 dark:bg-blue-400 rounded-full animate-pulse"></span>
                )}
              </div>
            )}
          </div>
        )}
        {/* AI 助手消息使用 Markdown 渲染 */}
        {message.role === 'assistant' ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-gray-900 dark:text-gray-100 markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // 代码块样式
                code: ({ node, inline, className, children, ...props }: any) => {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : '';
                  
                  if (!inline && match) {
                    // 代码块 - 使用独立的组件来处理复制状态
                    const codeText = String(children).replace(/\n$/, '');
                    const CodeBlock = () => {
                      const [copied, setCopied] = useState(false);
                      
                      return (
                        <div className="relative group my-3">
                          {/* 语言标签 */}
                          {language && (
                            <div className="absolute top-2 left-2 text-xs text-gray-400 dark:text-gray-500 font-mono bg-gray-800/50 dark:bg-gray-900/50 px-2 py-0.5 rounded z-10">
                              {language}
                            </div>
                          )}
                          <pre className="bg-gray-900 dark:bg-gray-950 text-gray-100 rounded-lg p-4 pt-8 overflow-x-auto border border-gray-700 dark:border-gray-600">
                            <code className={className} {...props}>
                              {children}
                            </code>
                          </pre>
                          <button
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(codeText);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              } catch (err) {
                                console.error('Failed to copy:', err);
                              }
                            }}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2 py-1 rounded text-xs flex items-center space-x-1 z-10"
                            title="复制代码"
                          >
                            {copied ? (
                              <>
                                <CheckCircle className="w-3 h-3" />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <FileText className="w-3 h-3" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    };
                    
                    return <CodeBlock />;
                  } else {
                    // 行内代码
                    return (
                      <code className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                        {children}
                      </code>
                    );
                  }
                },
                // 段落样式
                p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
                // 标题样式
                h1: ({ children }: any) => <h1 className="text-2xl font-bold mt-4 mb-3 first:mt-0">{children}</h1>,
                h2: ({ children }: any) => <h2 className="text-xl font-bold mt-4 mb-3 first:mt-0">{children}</h2>,
                h3: ({ children }: any) => <h3 className="text-lg font-bold mt-3 mb-2 first:mt-0">{children}</h3>,
                // 列表样式
                ul: ({ children }: any) => <ul className="list-disc list-inside mb-3 space-y-1 ml-4">{children}</ul>,
                ol: ({ children }: any) => <ol className="list-decimal list-inside mb-3 space-y-1 ml-4">{children}</ol>,
                li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
                // 引用样式
                blockquote: ({ children }: any) => (
                  <blockquote className="border-l-4 border-blue-500 dark:border-blue-400 pl-4 my-3 italic text-gray-700 dark:text-gray-300">
                    {children}
                  </blockquote>
                ),
                // 链接样式
                a: ({ href, children }: any) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {children}
                  </a>
                ),
                // 表格样式
                table: ({ children }: any) => (
                  <div className="overflow-x-auto my-3">
                    <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }: any) => (
                  <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>
                ),
                tbody: ({ children }: any) => <tbody>{children}</tbody>,
                tr: ({ children }: any) => (
                  <tr className="border-b border-gray-200 dark:border-gray-700">{children}</tr>
                ),
                th: ({ children }: any) => (
                  <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left font-semibold">
                    {children}
                  </th>
                ),
                td: ({ children }: any) => (
                  <td className="border border-gray-300 dark:border-gray-600 px-3 py-2">
                    {children}
                  </td>
                ),
                // 水平分割线
                hr: () => <hr className="my-4 border-gray-300 dark:border-gray-700" />,
                // 强调样式
                strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }: any) => <em className="italic">{children}</em>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
            {message.content}
          </div>
        )}
      </div>
    );
  };

  // 统计可用工具数量
  const totalTools = Array.from(mcpTools.values()).flat().length;

  return (
    <div className="h-full flex flex-col">
      {/* 标题栏 */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center space-x-2">
          <MessageCircle className="w-6 h-6 text-gray-600" />
          <h2 className="text-2xl font-semibold">智能聊天</h2>
        </div>
        <div className="flex items-center space-x-2">
          {/* Summarize 按钮 */}
          {currentSessionId && messages.filter(m => m.role !== 'system').length > 0 && (
            <button
              onClick={handleManualSummarize}
              disabled={isSummarizing}
              className="btn-primary flex items-center space-x-1.5 px-3 py-1.5 text-sm disabled:opacity-50"
              title="总结当前会话内容"
            >
              {isSummarizing ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>总结</span>
            </button>
          )}
        </div>
      </div>

      {/* 主要内容区域：左侧配置 + 右侧聊天 */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* 左侧配置面板 */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
          {/* LLM模型选择模块 */}
          <div className="card p-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
              <Brain className="w-4 h-4 inline mr-1" />
              LLM 模型 *
            </label>
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={streamEnabled}
                  onChange={(e) => setStreamEnabled(e.target.checked)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="text-xs text-gray-600">流式响应</span>
              </label>
            </div>
            <div className="relative">
            <select
              value={selectedLLMConfigId || ''}
              onChange={(e) => {
                console.log('[Workflow] Select onChange:', e.target.value);
                handleLLMConfigChange(e.target.value);
              }}
                className="input-field w-full text-sm appearance-none pr-8"
            >
              <option value="">请选择LLM模型...</option>
              {llmConfigs.map((config) => (
                <option key={config.config_id} value={config.config_id}>
                  {config.name} {config.model && `(${config.model})`} [{config.provider}]
                </option>
              ))}
            </select>
              {selectedLLMConfig && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  {(() => {
                    const provider = selectedLLMConfig.provider.toLowerCase();
                    switch (provider) {
                      case 'openai':
                        return <Brain className="w-4 h-4 text-[#10A37F]" />;
                      case 'anthropic':
                        return <Brain className="w-4 h-4 text-[#D4A574]" />;
                      case 'ollama':
                        return <Brain className="w-4 h-4 text-[#1D4ED8]" />;
                      default:
                        return <Brain className="w-4 h-4 text-gray-400" />;
                    }
                  })()}
                </div>
              )}
            </div>
            {selectedLLMConfig ? (
              <div className="mt-2 text-xs text-gray-600">
                <span className="font-medium">已选择:</span> {selectedLLMConfig.name}
                {selectedLLMConfig.model && ` - ${selectedLLMConfig.model}`}
              </div>
            ) : selectedLLMConfigId ? (
              <div className="mt-2 text-xs text-amber-600">
                <span className="font-medium">加载中...</span>
              </div>
            ) : null}
          </div>

          {/* 会话列表模块 */}
          <div className="card p-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                <History className="w-4 h-4 inline mr-1" />
                会话列表
            </label>
              <div className="flex items-center space-x-1">
                {/* 头像上传按钮（仅在有会话时显示） */}
                {currentSessionId && (
                  <label
                    className="flex items-center space-x-1 px-2 py-1 text-xs text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors cursor-pointer"
                    title="更换机器人头像"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>头像</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </label>
                )}
                <button
                  onClick={handleCreateNewSession}
                  className="flex items-center space-x-1 px-2 py-1 text-xs text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                  title="创建新会话"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>新建</span>
                </button>
              </div>
            </div>
            {/* 会话列表容器：固定高度，显示5个会话项，其他需要滚动 */}
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {/* 新会话选项 */}
              <button
                onClick={() => {
                  setCurrentSessionId(null);
                  setMessagePage(1);
                }}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${
                  !currentSessionId
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-700'
                    : 'bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <MessageCircle className="w-4 h-4 flex-shrink-0" />
                  <span className="font-medium truncate">新会话</span>
                </div>
              </button>
              
              {/* 历史会话列表 */}
              {sessions.length === 0 ? (
                <div className="text-center py-4 text-xs text-gray-500 dark:text-gray-400">
                  暂无历史会话
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.session_id}
                    className={`group relative w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${
                      currentSessionId === session.session_id
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-700'
                        : 'bg-gray-50 dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <button
                      onClick={() => handleSelectSession(session.session_id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start space-x-2">
                        <FileText className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">
                            {session.title || `会话 ${session.session_id.substring(0, 8)}`}
                          </div>
                          <div className="flex items-center space-x-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                            {session.message_count ? (
                              <span>{session.message_count} 条消息</span>
                            ) : null}
                            {session.last_message_at && (
                              <span className="truncate">
                                {new Date(session.last_message_at).toLocaleDateString('zh-CN', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => handleDeleteSession(session.session_id, e)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded"
                      title="删除会话"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 感知组件列表（MCP + 工作流） */}
          <div className="card p-3 flex-1 flex flex-col min-h-0">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <Brain className="w-4 h-4 inline mr-1" />
              感知组件
            </label>
            <div className="flex-1 overflow-y-auto space-y-2 border border-gray-200 dark:border-gray-700 rounded-lg p-2">
              {mcpServers.length === 0 && workflows.length === 0 ? (
                <div className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
                  暂无可用的感知组件，请先在配置页面添加
                </div>
              ) : (
                <>
                  {/* MCP 服务器分组 */}
                  {mcpServers.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-1.5 px-1.5 py-1">
                        <Plug className="w-3.5 h-3.5 text-blue-500" />
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                          MCP 服务器
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ({mcpServers.length})
                        </span>
                      </div>
                      {mcpServers.map((server) => {
                  const isConnected = connectedMcpServerIds.has(server.id);
                  const isSelected = selectedMcpServerIds.has(server.id);
                  const isConnecting = connectingServers.has(server.id);
                  const isExpanded = expandedServerIds.has(server.id);
                  const tools = mcpTools.get(server.id) || [];
                  
                  return (
                    <div
                      key={server.id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 flex items-center group"
                      draggable={isConnected}
                      onDragStart={(e) => {
                        if (isConnected) {
                          setDraggingComponent({ type: 'mcp', id: server.id, name: server.name });
                          e.dataTransfer.effectAllowed = 'move';
                        }
                      }}
                      onDragEnd={() => {
                        setDraggingComponent(null);
                      }}
                    >
                      {/* 服务器主要信息行 */}
                      <div className="flex items-center space-x-2 p-1.5 flex-1 min-w-0">
                        {/* 服务器连接控制 */}
                        <button
                          onClick={() => isConnected ? handleDisconnectServer(server.id) : handleConnectServer(server.id)}
                          disabled={isConnecting}
                          className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                            isConnected
                              ? 'text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/20'
                              : 'text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                          } ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                          title={isConnected ? '断开连接' : '连接'}
                        >
                          {isConnecting ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : isConnected ? (
                            <Power className="w-4 h-4" />
                          ) : (
                            <XCircle className="w-4 h-4" />
                          )}
                        </button>

                        {/* 服务器信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <Plug className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                              {server.name}
                            </span>
                            {isConnected && (
                              <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                                已连接
                              </span>
                            )}
                            {isConnected && tools.length > 0 && (
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                ({tools.length} 工具)
                              </span>
                            )}
                          </div>
                          {server.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                              {server.description}
                            </div>
                          )}
                        </div>

                        {/* 展开/收起按钮（仅在已连接且有工具时显示） */}
                        {isConnected && tools.length > 0 && (
                          <button
                            onClick={() => handleToggleServerExpand(server.id)}
                            className="flex-shrink-0 p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                            title={isExpanded ? '收起工具' : '展开工具'}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        )}

                        {/* 使用开关（仅在已连接时可用） */}
                        {isConnected && (
                          <label className="flex items-center space-x-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleMcpServerUsage(server.id)}
                              className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500 dark:bg-gray-700 dark:border-gray-600"
                            />
                            <span className="text-xs text-gray-600 dark:text-gray-400">使用</span>
                          </label>
                        )}
                      </div>
                      
                      {/* 拖动触点（仅在已连接时显示） */}
                      {isConnected && (
                        <div
                          className="flex-shrink-0 p-2 cursor-grab active:cursor-grabbing text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          title="拖动到对话框接入"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <GripVertical className="w-4 h-4" />
                        </div>
                      )}

                      {/* 工具列表（展开时显示） */}
                      {isConnected && isExpanded && tools.length > 0 && (
                        <div className="border-t border-gray-200 bg-white p-2 space-y-1.5">
                          <div className="text-xs font-medium text-gray-700 mb-1.5">
                            可用工具:
                          </div>
                          {tools.map((tool, index) => (
                            <div
                              key={index}
                              className="bg-gray-50 border border-gray-200 rounded p-2 hover:bg-gray-100 transition-colors"
                            >
                              <div className="flex items-start space-x-2">
                                <Wrench className="w-3 h-3 text-blue-500 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-gray-900">
                                    {tool.name}
                                  </div>
                                  {tool.description && (
                                    <div className="text-xs text-gray-600 mt-1">
                                      {tool.description}
                                    </div>
                                  )}
                                  {tool.inputSchema?.properties && (
                                    <div className="mt-1.5">
                                      <div className="text-xs text-gray-500 mb-1">参数:</div>
                                      <div className="flex flex-wrap gap-1">
                                        {Object.keys(tool.inputSchema.properties).map((param) => (
                                          <span
                                            key={param}
                                            className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded"
                                          >
                                            {param}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                  })}
                    </div>
                  )}
                  
                  {/* 工作流分组 */}
                  {workflows.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center space-x-1.5 px-1.5 py-1">
                        <WorkflowIcon className="w-3.5 h-3.5 text-purple-500" />
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                          工作流
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ({workflows.length})
                        </span>
                      </div>
                      {workflows.map((workflow) => (
                    <div
                      key={workflow.workflow_id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 flex items-center group"
                      draggable={true}
                      onDragStart={(e) => {
                        setDraggingComponent({ type: 'workflow', id: workflow.workflow_id, name: workflow.name });
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDraggingComponent(null);
                      }}
                    >
                      <div className="flex items-center space-x-2 p-1.5 flex-1 min-w-0">
                        <WorkflowIcon className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {workflow.name}
                          </div>
                          {workflow.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                              {workflow.description}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* 拖动触点 */}
                      <div
                        className="flex-shrink-0 p-2 cursor-grab active:cursor-grabbing text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        title="拖动到对话框接入"
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                    </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            {selectedMcpServerIds.size > 0 && (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-gray-700">
                <span className="font-medium">已选择:</span> {selectedMcpServerIds.size} 个服务器，
                共 {totalTools} 个工具可用
              </div>
            )}
        </div>
      </div>

        {/* 右侧聊天界面 */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 card">
        {/* 状态栏 */}
          <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Bot className="w-5 h-5 text-blue-500" />
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI 工作流助手</span>
            </div>
            <div className="flex items-center space-x-2.5">
              {selectedLLMConfig ? (
                <div className="flex items-center space-x-1.5 text-green-600 dark:text-green-400 text-xs font-medium">
                  <CheckCircle className="w-4 h-4" />
                  <span>
                    就绪
                    {selectedMcpServerIds.size > 0 && ` (${selectedMcpServerIds.size} 个MCP服务器, ${totalTools} 个工具)`}
                  </span>
                </div>
              ) : (
                <div className="flex items-center space-x-1.5 text-amber-600 dark:text-amber-400 text-xs font-medium">
                  <AlertCircle className="w-4 h-4" />
                  <span>未配置</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 消息列表 */}
          <div 
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-4 relative"
            onScroll={(e) => {
              const container = e.currentTarget;
              const scrollTop = container.scrollTop;
              
              // 检测用户是否在滚动（排除程序控制的滚动）
              if (!isLoadingMoreRef.current) {
                isUserScrollingRef.current = true;
                // 500ms 后重置，认为用户停止滚动
                setTimeout(() => {
                  isUserScrollingRef.current = false;
                }, 500);
              }
              
              // 滚动到顶部附近时，自动加载更多历史消息（类似微信、Telegram）
              if (scrollTop < 150 && hasMoreMessages && !isLoadingMessages && !isLoadingMoreRef.current) {
                loadSessionMessages(currentSessionId!, messagePage + 1);
              }
              
              // 用户滚动到底部时，隐藏新消息提示
              if (shouldAutoScroll()) {
                setShowNewMessagePrompt(false);
                setUnreadMessageCount(0);
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingComponent) {
                handleDropComponent(draggingComponent);
                setDraggingComponent(null);
              }
            }}
          >
          {/* 加载更多历史消息提示（固定在顶部，类似微信） */}
          {hasMoreMessages && (
            <div className="sticky top-0 z-10 flex justify-center mb-2 pointer-events-none">
              <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border border-gray-200 dark:border-gray-700 pointer-events-auto">
                {isLoadingMessages ? (
                  <div className="flex items-center space-x-2 text-xs text-gray-600 dark:text-gray-400">
                    <Loader className="w-3 h-3 animate-spin" />
                    <span>加载历史消息...</span>
                  </div>
                ) : (
                  <button
                    onClick={() => loadSessionMessages(currentSessionId!, messagePage + 1)}
                    className="flex items-center space-x-2 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >
                    <ChevronUp className="w-3 h-3" />
                    <span>加载更多</span>
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* 新消息提示（固定在底部，类似微信、Telegram） */}
          {showNewMessagePrompt && unreadMessageCount > 0 && (
            <div className="sticky bottom-4 z-10 flex justify-center pointer-events-none">
              <button
                onClick={() => {
                  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                  setShowNewMessagePrompt(false);
                  setUnreadMessageCount(0);
                }}
                className="bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center space-x-2 text-sm font-medium transition-all pointer-events-auto hover:scale-105"
              >
                <ChevronDown className="w-4 h-4" />
                <span>
                  {unreadMessageCount === 1 ? '1 条新消息' : `${unreadMessageCount} 条新消息`}
                </span>
              </button>
            </div>
          )}
          {messages.filter(msg => {
            // 过滤掉总结消息和系统提示词消息（系统提示词消息已在输入框上方显示）
            if (msg.isSummary) return false;
            if (msg.role === 'system' && 
                msg.toolCalls && 
                typeof msg.toolCalls === 'object' &&
                (msg.toolCalls as any).isSystemPrompt === true) {
              return false; // 不显示系统提示词消息
            }
            return true;
          }).map((message) => {
            // 如果是总结提示消息，使用特殊的居中显示样式
            const isSummaryNotification = message.role === 'system' && 
              (message.content.includes('总结完成') || message.content.includes('已精简为'));
            
            if (isSummaryNotification) {
              return (
                <div key={message.id} data-message-id={message.id} className="flex justify-center my-2">
                  <div className="text-xs text-gray-500 dark:text-gray-400 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full">
                    {message.content}
                  </div>
                </div>
              );
            }
            
            return (
            <div
              key={message.id}
              data-message-id={message.id}
              className={`flex items-start space-x-3 ${
                message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''
              }`}
            >
              <div className="flex-shrink-0 flex items-center space-x-2">
              <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shadow-sm overflow-hidden ${
                  message.role === 'user'
                    ? 'bg-primary-500 text-white'
                    : message.role === 'assistant'
                    ? 'bg-blue-500 text-white'
                    : message.role === 'tool'
                      ? message.toolType === 'workflow'
                        ? 'bg-purple-500 text-white'
                        : message.toolType === 'mcp'
                    ? 'bg-green-500 text-white'
                        : 'bg-gray-500 text-white'
                    : 'bg-gray-400 text-white'
                }`}
              >
                {message.role === 'user' ? (
                    <User className="w-5 h-5" />
                ) : message.role === 'assistant' ? (
                    // 如果有头像，显示头像；否则显示Bot图标
                    currentSessionAvatar ? (
                      <img 
                        src={currentSessionAvatar} 
                        alt="Avatar" 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Bot className="w-5 h-5" />
                    )
                ) : message.role === 'tool' ? (
                    message.toolType === 'workflow' ? (
                      <WorkflowIcon className="w-5 h-5" />
                    ) : message.toolType === 'mcp' ? (
                      <Plug className="w-5 h-5" />
                    ) : (
                      <Wrench className="w-5 h-5" />
                    )
                  ) : (
                    <Bot className="w-5 h-5" />
                  )}
                </div>
                {/* 思考/回答状态指示器 */}
                {message.role === 'assistant' && (
                  <div className="flex items-center space-x-1.5">
                    {message.isThinking && (!message.content || message.content.length === 0) ? (
                      // 思考中动画（只有思考，还没有内容）
                      <div className="flex items-center space-x-1.5">
                        <Loader className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">思考中</span>
                      </div>
                    ) : message.isStreaming ? (
                      // 回答中动画（正在流式输出内容）
                      <div className="flex items-center space-x-1.5">
                        <div className="flex space-x-0.5">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }}></div>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">回答中</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="flex-1 group relative">
                <div
                  className={`rounded-xl p-4 shadow-sm ${
                    message.role === 'user'
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-gray-900 dark:text-gray-100'
                      : message.role === 'assistant'
                      ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700'
                      : message.role === 'tool'
                      ? message.toolType === 'workflow'
                        ? 'bg-purple-50 dark:bg-purple-900/20 text-gray-900 dark:text-gray-100 border border-purple-200 dark:border-purple-700'
                        : message.toolType === 'mcp'
                        ? 'bg-green-50 dark:bg-green-900/20 text-gray-900 dark:text-gray-100 border border-green-200 dark:border-green-700'
                        : 'bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                      : 'bg-yellow-50 dark:bg-yellow-900/20 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {renderMessageContent(message)}
                </div>
                {/* 用户消息的编辑和重新发送按钮 */}
                {message.role === 'user' && !isLoading && (
                  <div className="absolute top-2 right-2 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleStartEdit(message.id)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-all"
                      title="编辑消息"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleResendMessage(message.id)}
                      className="p-1.5 text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-all"
                      title="重新发送"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
          <div 
            className="border-t border-gray-200 p-3 flex-shrink-0 relative"
            onClick={(e) => {
              // 点击输入框区域外部时关闭选择器（但不包括选择器本身）
              const target = e.target as HTMLElement;
              if ((showAtSelector || showModuleSelector) && !target.closest('.at-selector-container') && !target.closest('textarea')) {
                setShowAtSelector(false);
              }
            }}
          >
          {/* 已选定的组件 tag */}
          {selectedComponents.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedComponents.map((component, index) => (
                <div
                  key={`${component.type}-${component.id}-${index}`}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md text-sm border border-gray-200 dark:border-gray-600"
                >
                  {component.type === 'workflow' ? (
                    <WorkflowIcon className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                  ) : (
                    <Plug className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                  )}
                  <span className="font-medium">{component.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveComponent(index);
                    }}
                    className="ml-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex-shrink-0"
                    title="删除"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* 显示待处理的批次数据项（选择操作） */}
          {pendingBatchItem && (
            <div className="mb-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <Database className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                      📋 已选择: {pendingBatchItem.batchName}
                    </span>
                  </div>
                  {pendingBatchItem.item.title && (
                    <div className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">
                      {pendingBatchItem.item.title}
                    </div>
                  )}
                  {pendingBatchItem.item.content && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
                      {pendingBatchItem.item.content.length > 150 
                        ? pendingBatchItem.item.content.substring(0, 150) + '...' 
                        : pendingBatchItem.item.content}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setPendingBatchItem(null)}
                  className="ml-2 p-1 text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 transition-colors flex-shrink-0"
                  title="取消"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSetAsSystemPrompt}
                  className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center space-x-2"
                >
                  <Brain className="w-4 h-4" />
                  <span>🤖 设置为系统提示词</span>
                </button>
                <button
                  onClick={handleInsertAsMessage}
                  className="flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center space-x-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>💬 作为对话内容</span>
                </button>
              </div>
            </div>
          )}
          
          {/* 显示选定的批次数据项（系统提示词） */}
          {selectedBatchItem && (
            <div className="mb-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <Database className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      🤖 机器人人设: {selectedBatchItem.batchName}
                    </span>
                  </div>
                  {selectedBatchItem.item.title && (
                    <div className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">
                      {selectedBatchItem.item.title}
                    </div>
                  )}
                  {selectedBatchItem.item.content && (
                    <div className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
                      {selectedBatchItem.item.content.length > 150 
                        ? selectedBatchItem.item.content.substring(0, 150) + '...' 
                        : selectedBatchItem.item.content}
                    </div>
                  )}
                </div>
                <button
                  onClick={async () => {
                    // 清除选定的批次数据项
                    setSelectedBatchItem(null);
                    
                    // 如果有会话，删除系统提示词消息
                    if (currentSessionId) {
                      const systemPromptMessage = messages.find(m => 
                        m.role === 'system' && 
                        m.toolCalls && 
                        typeof m.toolCalls === 'object' &&
                        (m.toolCalls as any).isSystemPrompt === true
                      );
                      
                      if (systemPromptMessage) {
                        try {
                          await deleteMessage(currentSessionId, systemPromptMessage.id);
                          setMessages(prev => prev.filter(m => m.id !== systemPromptMessage.id));
                          console.log('[Workflow] Deleted system prompt message');
                        } catch (error) {
                          console.error('[Workflow] Failed to delete system prompt message:', error);
                        }
                      }
                    }
                  }}
                  className="ml-2 p-1 text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors flex-shrink-0"
                  title="取消选择"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 text-xs text-blue-600 dark:text-blue-400">
                💡 此数据已保存为系统提示词，将作为机器人人设持续生效
              </div>
            </div>
          )}
          
          <div className="flex space-x-2">
            <div className="flex-1 relative at-selector-container">
            <textarea
                ref={inputRef}
              value={input}
                onChange={handleInputChange}
              onKeyPress={handleKeyPress}
                onKeyDown={(e) => {
                  // 如果批次数据项选择器显示，不处理键盘事件（由 CrawlerBatchItemSelector 处理）
                  if (showBatchItemSelector) {
                    return;
                  }
                  
                  // 如果模块选择器显示，不处理键盘事件（由 CrawlerModuleSelector 处理）
                  if (showModuleSelector) {
                    return;
                  }
                  
                  // 如果@选择器显示，处理上下箭头和回车
                  if (showAtSelector) {
                    const selectableComponentsList = getSelectableComponents();
                    
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedComponentIndex(prev => 
                        prev < selectableComponentsList.length - 1 ? prev + 1 : prev
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedComponentIndex(prev => prev > 0 ? prev - 1 : 0);
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (selectableComponentsList[selectedComponentIndex]) {
                        handleSelectComponent(selectableComponentsList[selectedComponentIndex]);
                      }
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      console.log('[Workflow] Closing selector via Escape');
                      setShowAtSelector(false);
                    }
                  }
                }}
                onBlur={(e) => {
                  // 如果批次数据项选择器显示，不处理blur（由组件自己处理）
                  if (showBatchItemSelector) {
                    return;
                  }
                  
                  // 如果模块选择器显示，不处理blur（由组件自己处理）
                  if (showModuleSelector) {
                    return;
                  }
                  
                  // 如果选择器未显示，不需要处理
                  if (!showAtSelector) {
                    return;
                  }
                  
                  // 清除之前的定时器
                  if (blurTimeoutRef.current) {
                    clearTimeout(blurTimeoutRef.current);
                    blurTimeoutRef.current = null;
                  }
                  
                  // 延迟关闭，以便点击选择器时不会立即关闭
                  blurTimeoutRef.current = setTimeout(() => {
                    // 检查当前焦点是否在选择器或其子元素上
                    const activeElement = document.activeElement;
                    const isFocusInSelector = activeElement?.closest('.at-selector-container');
                    
                    // 检查选择器元素是否仍然存在且显示
                    const selectorElement = selectorRef.current;
                    const isSelectorVisible = selectorElement && 
                                             document.contains(selectorElement) && 
                                             showAtSelector;
                    
                    // 如果焦点不在选择器上，且选择器仍然显示，则关闭
                    if (isSelectorVisible && !isFocusInSelector) {
                      // 再次检查relatedTarget（可能为null）
                      const relatedTarget = e.relatedTarget as HTMLElement;
                      if (!relatedTarget || !relatedTarget.closest('.at-selector-container')) {
                        console.log('[Workflow] Closing selector via blur');
                        setShowAtSelector(false);
                      }
                    }
                    
                    blurTimeoutRef.current = null;
                  }, 300); // 增加延迟时间
                }}
                onFocus={() => {
                  // 如果输入框获得焦点且当前有@符号，显示选择器
                  if (inputRef.current) {
                    const value = inputRef.current.value;
                    const cursorPosition = inputRef.current.selectionStart || 0;
                    const textBeforeCursor = value.substring(0, cursorPosition);
                    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
                    
                    if (lastAtIndex !== -1) {
                      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
                      const hasSpaceOrNewline = textAfterAt.includes(' ') || textAfterAt.includes('\n');
                      
                      if (!hasSpaceOrNewline && selectedComponents.length === 0) {
                        // 触发位置重新计算
                        handleInputChange({ target: inputRef.current } as React.ChangeEvent<HTMLTextAreaElement>);
                      }
                    }
                  }
                }}
              placeholder={
                editingMessageId
                  ? '编辑消息...'
                  : !selectedLLMConfig
                  ? '请先选择 LLM 模型...'
                  : selectedMcpServerIds.size > 0
                    ? `输入你的任务，我可以使用 ${totalTools} 个工具帮助你完成... (输入 @ 选择感知组件)`
                    : '输入你的问题，我会尽力帮助你... (输入 @ 选择感知组件，输入 / 引用爬虫数据)'
              }
                className="flex-1 input-field resize-none text-sm w-full"
              rows={3}
              disabled={isLoading || !selectedLLMConfig}
            />
            {/* 编辑模式提示和取消按钮 */}
            {editingMessageId && (
              <div className="absolute top-2 right-2 flex items-center space-x-2">
                <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">编辑模式</span>
                <button
                  onClick={handleCancelEdit}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  title="取消编辑"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
              
          {/* /模块 选择器 */}
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
              onSelect={(item) => {
                const batchName = selectedBatch.batch_name;
                handleBatchItemSelect(item, batchName);
              }}
              onClose={() => {
                setShowBatchItemSelector(false);
                setSelectedBatch(null);
                // 重新显示模块选择器
                if (moduleSelectorIndex !== -1) {
                  setShowModuleSelector(true);
                }
              }}
            />
          )}
          
          {/* @ 符号选择器 */}
          {showAtSelector && (
            <div
              ref={selectorRef}
              className="fixed z-[100] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-y-auto at-selector-container"
                  style={{
                    top: `${atSelectorPosition.top}px`,
                    left: `${atSelectorPosition.left}px`,
                    minWidth: '200px',
                    maxWidth: '300px',
                    maxHeight: `${atSelectorPosition.maxHeight || 256}px`, // 使用动态计算的最大高度
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault(); // 防止触发 blur
                    e.stopPropagation(); // 阻止事件冒泡
                    // 清除blur定时器，防止选择器被关闭
                    if (blurTimeoutRef.current) {
                      clearTimeout(blurTimeoutRef.current);
                      blurTimeoutRef.current = null;
                    }
                  }}
                  onMouseUp={(e) => {
                    e.preventDefault(); // 防止触发 blur
                    e.stopPropagation(); // 阻止事件冒泡
                  }}
                >
                  <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                    <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      选择感知组件
                    </div>
                  </div>
                  
                  {/* MCP 服务器列表 */}
                  {mcpServers.filter(s => 
                    connectedMcpServerIds.has(s.id) &&
                    s.name.toLowerCase().includes(atSelectorQuery)
                  ).length > 0 && (
                    <div className="py-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 px-3 py-1.5">
                        MCP 服务器
                      </div>
                      {mcpServers
                        .filter(s => 
                          connectedMcpServerIds.has(s.id) &&
                          s.name.toLowerCase().includes(atSelectorQuery)
                        )
                        .map((server) => {
                          const component = { type: 'mcp' as const, id: server.id, name: server.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={server.id}
                              onClick={() => handleSelectComponent(component)}
                              className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                                isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : ''
                              }`}
                            >
                              <Plug className="w-4 h-4 text-blue-500 flex-shrink-0" />
                              <span className="text-sm text-gray-900 dark:text-gray-100">{server.name}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  
                  {/* 工作流列表 */}
                  {workflows.filter(w => 
                    w.name.toLowerCase().includes(atSelectorQuery)
                  ).length > 0 && (
                    <div className="py-1">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 px-3 py-1.5">
                        工作流
                      </div>
                      {workflows
                        .filter(w => w.name.toLowerCase().includes(atSelectorQuery))
                        .map((workflow) => {
                          const component = { type: 'workflow' as const, id: workflow.workflow_id, name: workflow.name };
                          const selectableComponents = getSelectableComponents();
                          const componentIndex = selectableComponents.findIndex((c: { type: 'mcp' | 'workflow'; id: string; name: string }) => c.id === component.id && c.type === component.type);
                          const isSelected = componentIndex === selectedComponentIndex;
                          return (
                            <div
                              key={workflow.workflow_id}
                              onClick={() => handleSelectComponent(component)}
                              className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                                isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : ''
                              }`}
                            >
                              <WorkflowIcon className="w-4 h-4 text-purple-500 flex-shrink-0" />
                              <span className="text-sm text-gray-900 dark:text-gray-100">{workflow.name}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                  
                  {/* 无匹配结果 */}
                  {mcpServers.filter(s => 
                    connectedMcpServerIds.has(s.id) &&
                    s.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 &&
                  workflows.filter(w => 
                    w.name.toLowerCase().includes(atSelectorQuery)
                  ).length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 text-center">
                      未找到匹配的感知组件
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim() || !selectedLLMConfig}
              className="btn-primary flex items-center space-x-2 self-end disabled:opacity-50"
            >
              {isLoading ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>{editingMessageId ? '保存并重新发送' : '发送'}</span>
            </button>
          </div>
          {/* Token计数显示 */}
          {selectedLLMConfig && messages.filter(m => m.role !== 'system' && !m.isSummary).length > 0 && (() => {
            const model = selectedLLMConfig.model || 'gpt-4';
            
            // 找到最近一条总结消息的位置，只计算实际会发送的消息
            let lastSummaryIndex = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].isSummary) {
                lastSummaryIndex = i;
                break;
              }
            }
            
            // 如果找到总结消息，从总结消息开始计算（包含总结消息）；否则计算所有消息
            const messagesToCount = lastSummaryIndex >= 0 
              ? messages.slice(lastSummaryIndex)
              : messages;
            
            // 构建用于token计算的消息列表（排除不发送的系统消息）
            const conversationMessages = messagesToCount
              .filter(m => {
                // 排除系统消息（但包含总结消息，因为总结消息会作为user消息发送）
                if (m.role === 'system' && !m.isSummary) {
                  return false;
                }
                return true;
              })
              .map(msg => {
                // 如果是总结消息，作为user消息计算token
                if (msg.isSummary) {
                  return {
                    role: 'user' as const,
                    content: msg.content,
                    thinking: undefined,
                  };
                }
                return {
                  role: msg.role,
                  content: msg.content,
                  thinking: msg.thinking,
                };
              });
            
            const currentTokens = estimate_messages_tokens(conversationMessages, model);
            // 使用从后端获取的 max_tokens，如果没有则使用前端函数作为后备
            const maxTokens = selectedLLMConfig?.max_tokens || get_model_max_tokens(model);
            return (
              <div className="text-xs text-yellow-600 dark:text-yellow-400 mt-1 px-1">
                累计会话 Token: {currentTokens.toLocaleString()} / {maxTokens.toLocaleString()}
              </div>
            );
          })()}
          <p className="text-xs text-gray-500 mt-2">
            {!selectedLLMConfig ? (
              '请先选择 LLM 模型'
            ) : selectedComponents.length > 0 ? (
              <>已选择感知组件：<span className="font-medium">{selectedComponents[0].name}</span>。如需更换，请先删除当前组件，然后使用 @ 选择新的组件。</>
            ) : selectedMcpServerIds.size > 0 ? (
              <>提示：我可以使用 {totalTools} 个 MCP 工具帮助你完成任务，例如<span className="font-medium">"发布内容"</span>、<span className="font-medium">"查询信息"</span>等。使用 @ 可以选择感知组件。</>
            ) : (
              <>提示：你可以直接与我对话，我会尽力帮助你。如果需要使用工具，请在 MCP 服务器中选择至少一个服务器，或使用 @ 选择感知组件。</>
            )}
          </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Workflow;

