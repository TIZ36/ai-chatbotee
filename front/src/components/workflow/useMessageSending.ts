import React, { useRef } from 'react';
import { Message } from './MessageContent';
import { LLMClient, LLMMessage } from '../../services/llmClient';
import { saveMessage, createSession, updateSessionAvatar, updateSessionName, updateSessionSystemPrompt, updateSessionMediaOutputPath, updateSessionLLMConfig, Session } from '../../services/sessionApi';
import { mcpManager } from '../../services/mcpClient';
import { workflowPool } from '../../services/workflowPool';

export interface MessageSendingProps {
  sessionId: string | null;
  isTemporarySession: boolean;
  input: string;
  setInput: (value: string) => void;
  attachedMedia: any[];
  setAttachedMedia: (media: any[]) => void;
  quotedMessageId: string | null;
  setQuotedMessageId: (id: string | null) => void;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  selectedLLMConfigId: string | null;
  selectedLLMConfig: any;
  currentSystemPrompt: string | null;
  mcpServers: any[];
  workflows: any[];
  allSkillPacks: any[];
  currentSessionSkillPacks: any[];
  setIsLoading: (loading: boolean) => void;
  setCollapsedThinking: React.Dispatch<React.SetStateAction<Set<string>>>;
  lastRequestRef: React.MutableRefObject<any>;
  temporarySessionId: string;
  currentSessionMeta: Session | null;
  setCurrentSessionId: (id: string | null) => void;
  setIsTemporarySession: (isTemp: boolean) => void;
  loadSessions: () => Promise<void>;
  onSelectSession?: (sessionId: string) => void;
  streamEnabled: boolean;
  enableThinking: boolean;
}

export const useMessageSending = ({
  sessionId,
  isTemporarySession,
  input,
  setInput,
  attachedMedia,
  setAttachedMedia,
  quotedMessageId,
  setQuotedMessageId,
  messages,
  setMessages,
  selectedLLMConfigId,
  selectedLLMConfig,
  currentSystemPrompt,
  mcpServers,
  workflows,
  allSkillPacks,
  currentSessionSkillPacks,
  setIsLoading,
  setCollapsedThinking,
  lastRequestRef,
  temporarySessionId,
  currentSessionMeta,
  setCurrentSessionId,
  setIsTemporarySession,
  loadSessions,
  onSelectSession,
  streamEnabled,
  enableThinking,
}: MessageSendingProps) => {
  // Logic will go here
};
