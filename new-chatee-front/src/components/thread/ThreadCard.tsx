'use client';

import Link from 'next/link';
import { MessageCircle, Heart, Share2, MoreHorizontal } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { formatDate, formatNumber, truncate } from '@/lib/utils';
import type { Thread } from '@/lib/types';

interface ThreadCardProps {
  thread: Thread;
  onLike?: () => void;
  onShare?: () => void;
}

export function ThreadCard({ thread, onLike, onShare }: ThreadCardProps) {
  const content = thread.root_message?.base.raw_content || '';
  
  return (
    <div className="bg-white border border-dark-200 rounded-xl p-4 hover:border-dark-300 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href={`/profile/${thread.owner_id}`}>
          <Avatar
            src={thread.owner?.avatar_url}
            userId={thread.owner_id}
            alt={thread.owner?.display_name || 'User'}
            size="md"
          />
        </Link>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/profile/${thread.owner_id}`}
              className="font-medium text-dark-900 hover:underline"
            >
              {thread.owner?.display_name || 'Unknown User'}
            </Link>
            <span className="text-dark-400">@{thread.owner?.username || 'user'}</span>
            <span className="text-dark-400">·</span>
            <span className="text-dark-400 text-sm">
              {formatDate(thread.created_at)}
            </span>
          </div>

          {/* Title */}
          {thread.title && (
            <h3 className="font-semibold text-dark-900 mt-1">{thread.title}</h3>
          )}

          {/* Content */}
          <Link href={`/thread/${thread.thread_id}`}>
            <p className="text-dark-700 mt-2 whitespace-pre-wrap">
              {truncate(content, 280)}
            </p>
          </Link>

          {/* Actions */}
          <div className="flex items-center gap-6 mt-3">
            <Link
              href={`/thread/${thread.thread_id}`}
              className="flex items-center gap-1.5 text-dark-500 hover:text-primary-600 transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="text-sm">{formatNumber(thread.stats.reply_count)}</span>
            </Link>

            <button
              onClick={onLike}
              className="flex items-center gap-1.5 text-dark-500 hover:text-red-500 transition-colors"
            >
              <Heart className="w-4 h-4" />
              <span className="text-sm">{formatNumber(thread.stats.participant_count)}</span>
            </button>

            <button
              onClick={onShare}
              className="flex items-center gap-1.5 text-dark-500 hover:text-primary-600 transition-colors"
            >
              <Share2 className="w-4 h-4" />
            </button>

            <button className="ml-auto text-dark-400 hover:text-dark-600 transition-colors">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
