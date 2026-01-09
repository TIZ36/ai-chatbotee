'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ChatList, ChatWindow } from '@/components/chat';
import { chatApi } from '@/lib/api';
import type { Chat } from '@/lib/types';

export default function ChatDetailPage() {
  const params = useParams();
  const chatKey = params.id as string;

  const [chat, setChat] = useState<Chat | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadChat = async () => {
      setIsLoading(true);
      setError('');

      const result = await chatApi.getChat(chatKey);

      setIsLoading(false);

      if (result.success && result.data) {
        setChat(result.data);
      } else {
        setError(result.error?.message || '加载失败');
      }
    };

    loadChat();
  }, [chatKey]);

  return (
    <div className="h-screen flex">
      {/* Chat List - Hidden on mobile when viewing a chat */}
      <div className="hidden lg:block w-80 border-r border-dark-200 bg-white">
        <ChatList activeChatKey={chatKey} />
      </div>

      {/* Chat Window */}
      <div className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : error || !chat ? (
          <div className="flex items-center justify-center h-full text-red-500">
            {error || '对话不存在'}
          </div>
        ) : (
          <ChatWindow chat={chat} />
        )}
      </div>
    </div>
  );
}
