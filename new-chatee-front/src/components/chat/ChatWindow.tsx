'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Avatar, Button } from '@/components/ui';
import { ChatMessageItem } from './ChatMessageItem';
import { chatApi } from '@/lib/api';
import { useChatStore, useAuthStore } from '@/lib/store';
import { wsClient, WS_EVENTS } from '@/lib/websocket';
import type { Chat, ChatMessage } from '@/lib/types';

interface ChatWindowProps {
  chat: Chat;
}

export function ChatWindow({ chat }: ChatWindowProps) {
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { user } = useAuthStore();
  const { messages, setMessages, addMessage } = useChatStore();

  const chatMessages = messages[chat.chat_key] || [];

  // Get other participant for private chats
  const otherParticipant = chat.chat_type === 'PRIVATE'
    ? chat.participants.find((p) => p.user_id !== user?.id)
    : null;

  const displayName = chat.chat_type === 'PRIVATE'
    ? otherParticipant?.user?.display_name || '用户'
    : chat.title || '群聊';

  // Load messages
  const loadMessages = async () => {
    setIsLoadingMessages(true);

    const result = await chatApi.getMessages(chat.chat_key, { page_size: 50 });

    setIsLoadingMessages(false);

    if (result.success && result.data) {
      setMessages(chat.chat_key, result.data.items.reverse());
    }
  };

  // Subscribe to new messages
  useEffect(() => {
    loadMessages();

    const unsubscribe = wsClient.subscribe(WS_EVENTS.CHAT_MESSAGE, (data) => {
      const message = data as ChatMessage;
      if (message.chat_key === chat.chat_key) {
        addMessage(chat.chat_key, message);
      }
    });

    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.chat_key]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  // Send message
  const handleSend = async () => {
    const content = inputValue.trim();
    if (!content || isSending) return;

    setIsSending(true);
    setInputValue('');

    const result = await chatApi.sendMessage({
      chat_key: chat.chat_key,
      content,
    });

    setIsSending(false);

    if (!result.success) {
      // Restore input on failure
      setInputValue(content);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-200">
        <Link href="/chat" className="lg:hidden">
          <ArrowLeft className="w-5 h-5 text-dark-600" />
        </Link>

        <Link href={otherParticipant ? `/profile/${otherParticipant.user_id}` : '#'}>
          <Avatar
            src={otherParticipant?.user?.avatar_url}
            userId={otherParticipant?.user_id || chat.chat_key}
            alt={displayName}
            size="md"
          />
        </Link>

        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-dark-900 truncate">{displayName}</h2>
          {chat.chat_type === 'GROUP' && (
            <p className="text-sm text-dark-500">
              {chat.participants.length} 位成员
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoadingMessages ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : chatMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-dark-400">
            <p>开始聊天吧！</p>
          </div>
        ) : (
          chatMessages.map((message, index) => (
            <ChatMessageItem
              key={message.base.msg_id}
              message={message}
              isOwn={message.base.author_id === user?.id}
              showAvatar={
                index === 0 ||
                chatMessages[index - 1].base.author_id !== message.base.author_id
              }
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-dark-200">
        <div className="flex items-end gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            className="flex-1 px-4 py-2 border border-dark-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent max-h-32"
            style={{ minHeight: '42px' }}
          />
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending}
            isLoading={isSending}
            className="rounded-xl"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
