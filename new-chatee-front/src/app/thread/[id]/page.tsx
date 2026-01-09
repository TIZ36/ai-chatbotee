'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { ThreadCard, ReplyItem } from '@/components/thread';
import { Button, Textarea } from '@/components/ui';
import { threadApi } from '@/lib/api';
import type { Thread, ThreadMessage } from '@/lib/types';

export default function ThreadDetailPage() {
  const params = useParams();
  const threadId = params.id as string;

  const [thread, setThread] = useState<Thread | null>(null);
  const [replies, setReplies] = useState<ThreadMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadThread = async () => {
    setIsLoading(true);
    setError('');

    const result = await threadApi.getThread(threadId);

    if (result.success && result.data) {
      setThread(result.data);
    } else {
      setError(result.error?.message || '加载失败');
    }

    // Load replies
    const repliesResult = await threadApi.listReplies(threadId, { page_size: 50 });
    
    if (repliesResult.success && repliesResult.data) {
      setReplies(repliesResult.data.items);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const handleSubmitReply = async () => {
    if (!replyContent.trim()) return;

    setIsSubmitting(true);

    const result = await threadApi.createReply({
      thread_id: threadId,
      content: replyContent.trim(),
    });

    setIsSubmitting(false);

    if (result.success) {
      setReplyContent('');
      loadThread(); // Refresh
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="text-center py-12">
          <p className="text-red-500">{error || '动态不存在'}</p>
          <Link href="/" className="mt-4 text-primary-600 hover:underline">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/"
          className="p-2 text-dark-600 hover:bg-dark-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-dark-900">动态详情</h1>
      </div>

      {/* Thread */}
      <ThreadCard thread={thread} />

      {/* Reply Form */}
      <div className="mt-6 bg-white border border-dark-200 rounded-xl p-4">
        <Textarea
          placeholder="写下你的回复..."
          value={replyContent}
          onChange={(e) => setReplyContent(e.target.value)}
          rows={3}
        />
        <div className="flex justify-end mt-3">
          <Button
            onClick={handleSubmitReply}
            isLoading={isSubmitting}
            disabled={!replyContent.trim()}
          >
            发布回复
          </Button>
        </div>
      </div>

      {/* Replies */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-dark-900 mb-4">
          回复 ({replies.length})
        </h2>

        {replies.length === 0 ? (
          <div className="text-center py-8 text-dark-400">
            暂无回复，快来抢沙发！
          </div>
        ) : (
          <div className="bg-white border border-dark-200 rounded-xl divide-y divide-dark-100">
            {replies.map((reply) => (
              <ReplyItem
                key={reply.base.msg_id}
                reply={reply}
                onReply={() => loadThread()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
