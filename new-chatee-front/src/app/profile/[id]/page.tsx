'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { UserProfileCard } from '@/components/user';
import { ThreadList } from '@/components/thread';
import { userApi, chatApi } from '@/lib/api';
import { useChatStore } from '@/lib/store';
import type { UserProfile } from '@/lib/types';

export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const { addChat } = useChatStore();

  useEffect(() => {
    const loadProfile = async () => {
      setIsLoading(true);
      setError('');

      const result = await userApi.getUser(userId);

      setIsLoading(false);

      if (result.success && result.data) {
        setProfile(result.data);
      } else {
        setError(result.error?.message || '加载失败');
      }
    };

    loadProfile();
  }, [userId]);

  const handleStartChat = async () => {
    if (!profile) return;

    // Create or get existing chat
    const result = await chatApi.createChat({
      chat_type: 'PRIVATE',
      participant_ids: [profile.id],
    });

    if (result.success && result.data) {
      // Fetch full chat data
      const chatResult = await chatApi.getChat(result.data.chat_key);
      if (chatResult.success && chatResult.data) {
        addChat(chatResult.data);
      }
      router.push(`/chat/${result.data.chat_key}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="text-center py-12">
          <p className="text-red-500">{error || '用户不存在'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Profile Card */}
      <UserProfileCard profile={profile} onStartChat={handleStartChat} />

      {/* User's Threads */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-dark-900 mb-4">
          {profile.display_name} 的动态
        </h2>
        <ThreadList userId={profile.id} />
      </div>
    </div>
  );
}
