'use client';

import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { formatDate, truncate } from '@/lib/utils';
import { useAuthStore } from '@/lib/store';
import type { Chat } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ChatListItemProps {
  chat: Chat;
  isActive?: boolean;
}

export function ChatListItem({ chat, isActive }: ChatListItemProps) {
  const { user } = useAuthStore();

  // For private chats, get the other participant
  const otherParticipant = chat.chat_type === 'PRIVATE'
    ? chat.participants.find((p) => p.user_id !== user?.id)
    : null;

  const displayName = chat.chat_type === 'PRIVATE'
    ? otherParticipant?.user?.display_name || '用户'
    : chat.title || '群聊';

  const avatarUserId = chat.chat_type === 'PRIVATE'
    ? otherParticipant?.user_id
    : chat.chat_key;

  const lastMessageContent = chat.last_message?.base.raw_content || '';
  const hasUnread = (chat.unread_count || 0) > 0;

  return (
    <Link
      href={`/chat/${chat.chat_key}`}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg transition-colors',
        isActive ? 'bg-primary-50' : 'hover:bg-dark-50'
      )}
    >
      <div className="relative">
        <Avatar
          src={otherParticipant?.user?.avatar_url}
          userId={avatarUserId}
          alt={displayName}
          size="md"
        />
        {hasUnread && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
            {chat.unread_count! > 99 ? '99+' : chat.unread_count}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={cn(
            'font-medium truncate',
            hasUnread ? 'text-dark-900' : 'text-dark-700'
          )}>
            {displayName}
          </span>
          <span className="text-xs text-dark-400 flex-shrink-0 ml-2">
            {formatDate(chat.stats.last_active_at)}
          </span>
        </div>

        <p className={cn(
          'text-sm truncate mt-0.5',
          hasUnread ? 'text-dark-700 font-medium' : 'text-dark-500'
        )}>
          {truncate(lastMessageContent, 30) || '暂无消息'}
        </p>
      </div>
    </Link>
  );
}
