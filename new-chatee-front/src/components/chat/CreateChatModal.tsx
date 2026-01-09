'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Modal, Avatar, Input } from '@/components/ui';
import { chatApi, userApi } from '@/lib/api';
import { useChatStore, useUIStore } from '@/lib/store';
import type { User } from '@/lib/types';

export function CreateChatModal() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const { showNewChatModal, setShowNewChatModal } = useUIStore();
  const { addChat } = useChatStore();

  // Mock search - in real app, this would call the API
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setError('');

    // Simulated search - replace with actual API call
    // const result = await userApi.searchUsers(searchQuery);
    
    // Mock results for demo
    setTimeout(() => {
      setSearchResults([
        {
          id: 'user1',
          username: 'demo_user',
          display_name: 'Demo User',
          follower_count: 100,
          following_count: 50,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]);
      setIsSearching(false);
    }, 500);
  };

  const handleSelectUser = (user: User) => {
    if (!selectedUsers.find((u) => u.id === user.id)) {
      setSelectedUsers([...selectedUsers, user]);
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleRemoveUser = (userId: string) => {
    setSelectedUsers(selectedUsers.filter((u) => u.id !== userId));
  };

  const handleCreateChat = async () => {
    if (selectedUsers.length === 0) {
      setError('请至少选择一个用户');
      return;
    }

    setIsCreating(true);
    setError('');

    const result = await chatApi.createChat({
      chat_type: selectedUsers.length === 1 ? 'PRIVATE' : 'GROUP',
      participant_ids: selectedUsers.map((u) => u.id),
    });

    setIsCreating(false);

    if (result.success && result.data) {
      // Fetch the created chat to get full data
      const chatResult = await chatApi.getChat(result.data.chat_key);
      if (chatResult.success && chatResult.data) {
        addChat(chatResult.data);
      }
      handleClose();
    } else {
      setError(result.error?.message || '创建失败');
    }
  };

  const handleClose = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedUsers([]);
    setError('');
    setShowNewChatModal(false);
  };

  return (
    <Modal
      isOpen={showNewChatModal}
      onClose={handleClose}
      title="发起私信"
      size="md"
    >
      <div className="space-y-4">
        {/* Selected Users */}
        {selectedUsers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-2 bg-primary-50 text-primary-700 px-3 py-1 rounded-full"
              >
                <span className="text-sm">{user.display_name}</span>
                <button
                  onClick={() => handleRemoveUser(user.id)}
                  className="hover:text-primary-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Search Input */}
        <div className="relative">
          <Input
            placeholder="搜索用户..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            onClick={handleSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-600"
          >
            <Search className="w-5 h-5" />
          </button>
        </div>

        {/* Search Results */}
        {isSearching ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : searchResults.length > 0 ? (
          <div className="border border-dark-200 rounded-lg overflow-hidden">
            {searchResults.map((user) => (
              <button
                key={user.id}
                onClick={() => handleSelectUser(user)}
                className="w-full flex items-center gap-3 p-3 hover:bg-dark-50 transition-colors"
              >
                <Avatar
                  src={user.avatar_url}
                  userId={user.id}
                  alt={user.display_name}
                  size="sm"
                />
                <div className="text-left">
                  <p className="font-medium text-dark-900">{user.display_name}</p>
                  <p className="text-sm text-dark-500">@{user.username}</p>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {/* Error */}
        {error && <p className="text-red-500 text-sm">{error}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose}>
            取消
          </Button>
          <Button
            onClick={handleCreateChat}
            isLoading={isCreating}
            disabled={selectedUsers.length === 0}
          >
            开始聊天
          </Button>
        </div>
      </div>
    </Modal>
  );
}
