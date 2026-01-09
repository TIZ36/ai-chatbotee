'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Avatar, Button, Modal } from '@/components/ui';
import { FollowButton } from './FollowButton';
import { userApi } from '@/lib/api';
import type { FollowRelation, User } from '@/lib/types';

interface FollowListModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  type: 'followers' | 'following';
  username?: string;
}

export function FollowListModal({
  isOpen,
  onClose,
  userId,
  type,
  username,
}: FollowListModalProps) {
  const [relations, setRelations] = useState<FollowRelation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pageToken, setPageToken] = useState<string | undefined>();

  const loadRelations = async (reset = false) => {
    setIsLoading(true);

    const api = type === 'followers' ? userApi.getFollowers : userApi.getFollowing;
    const result = await api(userId, {
      page_size: 20,
      page_token: reset ? undefined : pageToken,
    });

    setIsLoading(false);

    if (result.success && result.data) {
      const items = result.data.items;
      if (reset) {
        setRelations(items);
      } else {
        setRelations([...relations, ...items]);
      }
      setHasMore(result.data.has_more || false);
      setPageToken(result.data.next_page_token);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadRelations(true);
    } else {
      setRelations([]);
      setPageToken(undefined);
      setHasMore(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, userId, type]);

  const getUser = (relation: FollowRelation): User | undefined => {
    return type === 'followers' ? relation.follower : relation.following;
  };

  const title = type === 'followers' 
    ? `${username || '用户'}的粉丝` 
    : `${username || '用户'}的关注`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="max-h-96 overflow-y-auto">
        {relations.length === 0 && !isLoading ? (
          <div className="text-center py-8 text-dark-400">
            {type === 'followers' ? '暂无粉丝' : '暂无关注'}
          </div>
        ) : (
          <div className="space-y-3">
            {relations.map((relation) => {
              const user = getUser(relation);
              if (!user) return null;

              return (
                <div
                  key={user.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-dark-50"
                >
                  <Link href={`/profile/${user.id}`} onClick={onClose}>
                    <Avatar
                      src={user.avatar_url}
                      userId={user.id}
                      alt={user.display_name}
                      size="md"
                    />
                  </Link>

                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/profile/${user.id}`}
                      onClick={onClose}
                      className="font-medium text-dark-900 hover:underline block truncate"
                    >
                      {user.display_name}
                    </Link>
                    <span className="text-dark-400 text-sm">@{user.username}</span>
                  </div>

                  <FollowButton userId={user.id} size="sm" />
                </div>
              );
            })}
          </div>
        )}

        {isLoading && (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        )}

        {hasMore && !isLoading && relations.length > 0 && (
          <button
            onClick={() => loadRelations()}
            className="w-full py-2 mt-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors text-sm"
          >
            加载更多
          </button>
        )}
      </div>
    </Modal>
  );
}
