'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Calendar, MapPin, LinkIcon } from 'lucide-react';
import { Avatar, Button } from '@/components/ui';
import { FollowButton } from './FollowButton';
import { FollowListModal } from './FollowListModal';
import { formatNumber, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/lib/store';
import type { UserProfile } from '@/lib/types';

interface UserProfileCardProps {
  profile: UserProfile;
  onStartChat?: () => void;
}

export function UserProfileCard({ profile, onStartChat }: UserProfileCardProps) {
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(profile.follower_count);
  const { user } = useAuthStore();

  const isOwnProfile = user?.id === profile.id;

  const handleFollowChange = (following: boolean) => {
    setFollowerCount((prev) => prev + (following ? 1 : -1));
  };

  return (
    <div className="bg-white border border-dark-200 rounded-xl overflow-hidden">
      {/* Banner */}
      <div className="h-32 bg-gradient-to-r from-primary-400 to-primary-600" />

      {/* Profile Info */}
      <div className="px-6 pb-6">
        {/* Avatar */}
        <div className="-mt-16 mb-4 flex items-end justify-between">
          <Avatar
            src={profile.avatar_url}
            userId={profile.id}
            alt={profile.display_name}
            size="xl"
            className="border-4 border-white"
          />

          <div className="flex gap-2">
            {isOwnProfile ? (
              <Link href="/settings">
                <Button variant="outline">编辑资料</Button>
              </Link>
            ) : (
              <>
                <Button variant="outline" onClick={onStartChat}>
                  私信
                </Button>
                <FollowButton
                  userId={profile.id}
                  isFollowing={profile.is_following}
                  onFollowChange={handleFollowChange}
                />
              </>
            )}
          </div>
        </div>

        {/* Name */}
        <h1 className="text-xl font-bold text-dark-900">{profile.display_name}</h1>
        <p className="text-dark-500">@{profile.username}</p>

        {/* Bio */}
        {profile.bio && (
          <p className="mt-3 text-dark-700 whitespace-pre-wrap">{profile.bio}</p>
        )}

        {/* Meta */}
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-dark-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {formatDate(profile.created_at)} 加入
          </span>
        </div>

        {/* Stats */}
        <div className="mt-4 flex gap-6">
          <button
            onClick={() => setShowFollowing(true)}
            className="hover:underline"
          >
            <span className="font-bold text-dark-900">
              {formatNumber(profile.following_count)}
            </span>
            <span className="text-dark-500 ml-1">关注</span>
          </button>

          <button
            onClick={() => setShowFollowers(true)}
            className="hover:underline"
          >
            <span className="font-bold text-dark-900">
              {formatNumber(followerCount)}
            </span>
            <span className="text-dark-500 ml-1">粉丝</span>
          </button>
        </div>
      </div>

      {/* Follow Modals */}
      <FollowListModal
        isOpen={showFollowers}
        onClose={() => setShowFollowers(false)}
        userId={profile.id}
        type="followers"
        username={profile.display_name}
      />

      <FollowListModal
        isOpen={showFollowing}
        onClose={() => setShowFollowing(false)}
        userId={profile.id}
        type="following"
        username={profile.display_name}
      />
    </div>
  );
}
