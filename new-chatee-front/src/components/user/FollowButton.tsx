'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface FollowButtonProps {
  userId: string;
  isFollowing?: boolean;
  onFollowChange?: (following: boolean) => void;
  size?: 'sm' | 'md';
}

export function FollowButton({
  userId,
  isFollowing: initialFollowing = false,
  onFollowChange,
  size = 'md',
}: FollowButtonProps) {
  const [isFollowing, setIsFollowing] = useState(initialFollowing);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuthStore();

  // Don't show button for own profile
  if (user?.id === userId) {
    return null;
  }

  const handleClick = async () => {
    setIsLoading(true);

    const result = isFollowing
      ? await userApi.unfollow(userId)
      : await userApi.follow(userId);

    setIsLoading(false);

    if (result.success) {
      const newState = !isFollowing;
      setIsFollowing(newState);
      onFollowChange?.(newState);
    }
  };

  return (
    <Button
      variant={isFollowing ? 'outline' : 'primary'}
      size={size}
      onClick={handleClick}
      isLoading={isLoading}
      className={isFollowing ? 'hover:bg-red-50 hover:text-red-600 hover:border-red-300' : ''}
    >
      {isFollowing ? '已关注' : '关注'}
    </Button>
  );
}
