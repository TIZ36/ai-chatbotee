'use client';

import { useEffect, useState } from 'react';
import { ThreadCard } from './ThreadCard';
import { threadApi } from '@/lib/api';
import { useThreadStore } from '@/lib/store';
import type { Thread } from '@/lib/types';

interface ThreadListProps {
  userId?: string;
  showEmpty?: boolean;
}

export function ThreadList({ userId, showEmpty = true }: ThreadListProps) {
  const { threads, setThreads, isLoading, setLoading } = useThreadStore();
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [pageToken, setPageToken] = useState<string | undefined>();

  const loadThreads = async (reset = false) => {
    setLoading(true);
    setError('');

    const result = await threadApi.listThreads({
      page_size: 20,
      page_token: reset ? undefined : pageToken,
      user_id: userId,
    });

    setLoading(false);

    if (result.success && result.data) {
      const newThreads = result.data.items;
      if (reset) {
        setThreads(newThreads);
      } else {
        setThreads([...threads, ...newThreads]);
      }
      setHasMore(result.data.has_more || false);
      setPageToken(result.data.next_page_token);
    } else {
      setError(result.error?.message || '加载失败');
    }
  };

  useEffect(() => {
    loadThreads(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      loadThreads();
    }
  };

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500">{error}</p>
        <button
          onClick={() => loadThreads(true)}
          className="mt-2 text-primary-600 hover:underline"
        >
          重试
        </button>
      </div>
    );
  }

  if (!isLoading && threads.length === 0 && showEmpty) {
    return (
      <div className="text-center py-12">
        <p className="text-dark-400">暂无动态</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {threads.map((thread) => (
        <ThreadCard key={thread.thread_id} thread={thread} />
      ))}

      {isLoading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      )}

      {hasMore && !isLoading && (
        <button
          onClick={handleLoadMore}
          className="w-full py-3 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
        >
          加载更多
        </button>
      )}
    </div>
  );
}
