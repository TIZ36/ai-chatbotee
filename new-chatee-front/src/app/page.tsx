'use client';

import { useEffect } from 'react';
import { PenSquare } from 'lucide-react';
import { ThreadList } from '@/components/thread';
import { Button } from '@/components/ui';
import { useUIStore, useAuthStore } from '@/lib/store';

export default function HomePage() {
  const { user } = useAuthStore();
  const { setShowNewThreadModal } = useUIStore();

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-dark-900">首页</h1>
          <p className="text-dark-500">欢迎回来, {user?.display_name || 'Guest'}!</p>
        </div>
        <Button onClick={() => setShowNewThreadModal(true)} className="gap-2">
          <PenSquare className="w-4 h-4" />
          发布
        </Button>
      </div>

      {/* Thread Feed */}
      <ThreadList />
    </div>
  );
}
