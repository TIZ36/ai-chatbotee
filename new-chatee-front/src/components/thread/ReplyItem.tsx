'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MessageCircle, CornerDownRight } from 'lucide-react';
import { Avatar, Button, Textarea } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { threadApi } from '@/lib/api';
import type { ThreadMessage } from '@/lib/types';

interface ReplyItemProps {
  reply: ThreadMessage;
  onReply?: (parentId: string) => void;
  depth?: number;
  maxDepth?: number;
}

export function ReplyItem({ reply, onReply, depth = 0, maxDepth = 3 }: ReplyItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmitReply = async () => {
    if (!replyContent.trim()) return;

    setIsSubmitting(true);
    const result = await threadApi.createReply({
      thread_id: reply.thread_id,
      parent_msg_id: reply.base.msg_id,
      content: replyContent.trim(),
    });
    setIsSubmitting(false);

    if (result.success) {
      setReplyContent('');
      setShowReplyForm(false);
      // Trigger refresh
      if (onReply) onReply(reply.base.msg_id);
    }
  };

  return (
    <div className={`${depth > 0 ? 'ml-8 border-l-2 border-dark-200 pl-4' : ''}`}>
      <div className="py-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Link href={`/profile/${reply.base.author_id}`}>
            <Avatar
              src={reply.author?.avatar_url}
              userId={reply.base.author_id}
              size="sm"
            />
          </Link>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/profile/${reply.base.author_id}`}
                className="font-medium text-dark-900 hover:underline text-sm"
              >
                {reply.author?.display_name || 'Unknown'}
              </Link>
              <span className="text-dark-400 text-sm">
                @{reply.author?.username || 'user'}
              </span>
              <span className="text-dark-400 text-sm">·</span>
              <span className="text-dark-400 text-sm">
                {formatDate(reply.base.timestamp)}
              </span>
            </div>

            {/* Content */}
            <p className="text-dark-700 mt-1 whitespace-pre-wrap text-sm">
              {reply.base.raw_content}
            </p>

            {/* Actions */}
            {depth < maxDepth && (
              <button
                onClick={() => setShowReplyForm(!showReplyForm)}
                className="flex items-center gap-1 mt-2 text-dark-500 hover:text-primary-600 text-sm transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                回复
              </button>
            )}
          </div>
        </div>

        {/* Reply Form */}
        {showReplyForm && (
          <div className="mt-3 ml-11">
            <Textarea
              placeholder="写下你的回复..."
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={2}
              className="text-sm"
            />
            <div className="flex justify-end gap-2 mt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowReplyForm(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleSubmitReply}
                isLoading={isSubmitting}
                disabled={!replyContent.trim()}
              >
                <CornerDownRight className="w-3.5 h-3.5 mr-1" />
                回复
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Nested Replies */}
      {reply.replies && reply.replies.length > 0 && (
        <div className="space-y-0">
          {reply.replies.map((nestedReply) => (
            <ReplyItem
              key={nestedReply.base.msg_id}
              reply={nestedReply}
              onReply={onReply}
              depth={depth + 1}
              maxDepth={maxDepth}
            />
          ))}
        </div>
      )}
    </div>
  );
}
