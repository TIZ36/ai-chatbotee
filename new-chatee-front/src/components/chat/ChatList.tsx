'use client';

import { useEffect, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { ChatListItem } from './ChatListItem';
import { Button } from '@/components/ui';
import { chatApi } from '@/lib/api';
import { useChatStore, useUIStore } from '@/lib/store';

interface ChatListProps {
  activeChatKey?: string;
}

export function ChatList({ activeChatKey }: ChatListProps) {
  const { chats, setChats, isLoading, setLoading } = useChatStore();
  const { setShowNewChatModal } = useUIStore();
  const [error, setError] = useState('');

  const loadChats = async () => {
    setLoading(true);
    setError('');

    const result = await chatApi.listChats({ page_size: 50 });

    setLoading(false);

    if (result.success && result.data) {
      setChats(result.data.items);
    } else {
      setError(result.error?.message || '加载失败');
    }
  };

  useEffect(() => {
    loadChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-dark-200">
        <h2 className="text-lg font-semibold text-dark-900">私信</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNewChatModal(true)}
        >
          <MessageSquarePlus className="w-5 h-5" />
        </Button>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-red-500">{error}</p>
            <button
              onClick={loadChats}
              className="mt-2 text-primary-600 hover:underline"
            >
              重试
            </button>
          </div>
        ) : chats.length === 0 ? (
          <div className="text-center py-12 px-4">
            <MessageSquarePlus className="w-12 h-12 text-dark-300 mx-auto mb-3" />
            <p className="text-dark-500">暂无私信</p>
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => setShowNewChatModal(true)}
            >
              发起私信
            </Button>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {chats.map((chat) => (
              <ChatListItem
                key={chat.chat_key}
                chat={chat}
                isActive={chat.chat_key === activeChatKey}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
