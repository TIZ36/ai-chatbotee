'use client';

import { useState } from 'react';
import { Button, Textarea, Modal } from '@/components/ui';
import { threadApi } from '@/lib/api';
import { useThreadStore, useUIStore } from '@/lib/store';

export function CreateThreadModal() {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const { showNewThreadModal, setShowNewThreadModal } = useUIStore();
  const { addThread } = useThreadStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!content.trim()) {
      setError('内容不能为空');
      return;
    }

    setIsLoading(true);
    setError('');

    const result = await threadApi.createThread({
      content: content.trim(),
      title: title.trim() || undefined,
    });

    setIsLoading(false);

    if (result.success && result.data) {
      // Fetch the created thread to get full data
      const threadResult = await threadApi.getThread(result.data.thread_id);
      if (threadResult.success && threadResult.data) {
        addThread(threadResult.data);
      }
      
      setContent('');
      setTitle('');
      setShowNewThreadModal(false);
    } else {
      setError(result.error?.message || '发布失败');
    }
  };

  const handleClose = () => {
    setContent('');
    setTitle('');
    setError('');
    setShowNewThreadModal(false);
  };

  const remainingChars = 500 - content.length;

  return (
    <Modal
      isOpen={showNewThreadModal}
      onClose={handleClose}
      title="发布动态"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="标题（可选）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 border border-dark-300 rounded-lg text-dark-900 placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          maxLength={100}
        />

        <Textarea
          placeholder="分享你的想法..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          maxLength={500}
          error={error}
          className="resize-none"
        />

        <div className="flex items-center justify-between">
          <span
            className={`text-sm ${
              remainingChars < 0
                ? 'text-red-500'
                : remainingChars < 50
                ? 'text-yellow-500'
                : 'text-dark-400'
            }`}
          >
            {remainingChars}
          </span>

          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={handleClose}>
              取消
            </Button>
            <Button
              type="submit"
              isLoading={isLoading}
              disabled={!content.trim() || remainingChars < 0}
            >
              发布
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
