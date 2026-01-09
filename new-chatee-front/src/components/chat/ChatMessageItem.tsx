'use client';

import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { formatDate, cn } from '@/lib/utils';
import type { ChatMessage } from '@/lib/types';

interface ChatMessageItemProps {
  message: ChatMessage;
  isOwn: boolean;
  showAvatar?: boolean;
}

export function ChatMessageItem({ message, isOwn, showAvatar = true }: ChatMessageItemProps) {
  return (
    <div
      className={cn(
        'flex gap-2',
        isOwn ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div className={cn('w-8 flex-shrink-0', !showAvatar && 'invisible')}>
        {showAvatar && (
          <Link href={`/profile/${message.base.author_id}`}>
            <Avatar
              src={message.author?.avatar_url}
              userId={message.base.author_id}
              size="sm"
            />
          </Link>
        )}
      </div>

      {/* Message Bubble */}
      <div
        className={cn(
          'max-w-[70%] px-4 py-2 rounded-2xl',
          isOwn
            ? 'bg-primary-600 text-white rounded-br-md'
            : 'bg-dark-100 text-dark-900 rounded-bl-md'
        )}
      >
        {/* Sender name for group chats */}
        {!isOwn && showAvatar && message.author && (
          <p className="text-xs font-medium text-dark-500 mb-1">
            {message.author.display_name}
          </p>
        )}

        {/* Content */}
        <p className="whitespace-pre-wrap break-words">
          {message.base.raw_content}
        </p>

        {/* Timestamp */}
        <p
          className={cn(
            'text-xs mt-1',
            isOwn ? 'text-primary-200' : 'text-dark-400'
          )}
        >
          {formatDate(message.base.timestamp)}
        </p>
      </div>
    </div>
  );
}
