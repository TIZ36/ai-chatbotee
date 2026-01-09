'use client';

import { ThreadList } from '@/components/thread';

export default function ThreadsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-dark-900">动态</h1>
        <p className="text-dark-500">查看所有动态</p>
      </div>

      {/* Thread List */}
      <ThreadList />
    </div>
  );
}
