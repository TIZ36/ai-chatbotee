/**
 * Workflow 会话管理 Hook
 * 管理会话切换、临时会话、会话元数据等
 */

import { useState, useMemo, useCallback } from 'react';
import { createSessionConversationAdapter } from '../../../conversation/adapters/sessionConversation';
import { useConversation } from '../../../conversation/useConversation';
import type { Session } from '../../../services/sessionApi';
import type { Message } from '../types';

const TEMPORARY_SESSION_ID = 'temporary-session';

export interface UseWorkflowSessionProps {
  externalSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
}

export interface UseWorkflowSessionReturn {
  currentSessionId: string | null;
  setCurrentSessionId: (id: string | null) => void;
  isTemporarySession: boolean;
  setIsTemporarySession: (isTemp: boolean) => void;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  hasMoreBefore: boolean;
  loadMoreBefore: () => Promise<void>;
  isLoading: boolean;
  loadInitial: () => Promise<void>;
  sessions: Session[];
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  currentSessionMeta: Session | null;
  setCurrentSessionMeta: (session: Session | null) => void;
  currentSessionType: string;
  filterVisibleSessions: (list: Session[]) => Session[];
}

export function useWorkflowSession({
  externalSessionId,
  onSelectSession,
}: UseWorkflowSessionProps): UseWorkflowSessionReturn {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    externalSessionId || TEMPORARY_SESSION_ID
  );
  const [isTemporarySession, setIsTemporarySession] = useState(
    !externalSessionId || externalSessionId === TEMPORARY_SESSION_ID
  );

  const [tempMessages, setTempMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: '你好！我是你的 AI 工作流助手。这是临时会话，不会保存历史记录。',
    },
  ]);

  const sessionAdapter = useMemo(
    () => (currentSessionId && !isTemporarySession ? createSessionConversationAdapter(currentSessionId) : null),
    [currentSessionId, isTemporarySession]
  );

  const {
    messages: persistedMessages,
    setMessages: setPersistedMessages,
    hasMoreBefore: hasMorePersistedMessages,
    loadMoreBefore: loadMorePersistedMessages,
    isLoading: isLoadingPersistedMessages,
    loadInitial: loadPersistedInitial,
  } = useConversation(sessionAdapter, { pageSize: 10 });

  // 兼容现有代码：统一通过 messages/setMessages 操作当前"显示中的会话"
  const messages: Message[] = isTemporarySession
    ? tempMessages
    : (persistedMessages as unknown as Message[]);
  const setMessages: React.Dispatch<React.SetStateAction<Message[]>> = isTemporarySession
    ? setTempMessages
    : (setPersistedMessages as unknown as React.Dispatch<React.SetStateAction<Message[]>>);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionMeta, setCurrentSessionMeta] = useState<Session | null>(null);

  const filterVisibleSessions = useCallback((list: Session[]) => {
    return (list || []).filter(s => s.session_type !== 'memory' && s.session_type !== 'research');
  }, []);

  // 当前会话类型 (派生状态)
  const currentSessionType = useMemo(() => {
    if (isTemporarySession) return 'temporary';
    const session = sessions.find(s => s.session_id === currentSessionId) || currentSessionMeta;
    const type = session?.session_type;
    if (type === 'memory' || type === 'research') return 'temporary';
    return type || 'temporary';
  }, [currentSessionId, sessions, currentSessionMeta, isTemporarySession]);

  return {
    currentSessionId,
    setCurrentSessionId,
    isTemporarySession,
    setIsTemporarySession,
    messages,
    setMessages,
    hasMoreBefore: hasMorePersistedMessages,
    loadMoreBefore: loadMorePersistedMessages,
    isLoading: isLoadingPersistedMessages,
    loadInitial: loadPersistedInitial,
    sessions,
    setSessions,
    currentSessionMeta,
    setCurrentSessionMeta,
    currentSessionType,
    filterVisibleSessions,
  };
}
