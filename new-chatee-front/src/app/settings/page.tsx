'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button, Input, Textarea, Avatar } from '@/components/ui';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function SettingsPage() {
  const { user, setAuth, token } = useAuthStore();

  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) return;

    setIsLoading(true);
    setMessage({ type: '', text: '' });

    const result = await userApi.updateUser(user.id, {
      display_name: displayName.trim(),
      bio: bio.trim(),
    });

    setIsLoading(false);

    if (result.success && result.data) {
      setAuth(result.data, token || '');
      setMessage({ type: 'success', text: '保存成功' });
    } else {
      setMessage({ type: 'error', text: result.error?.message || '保存失败' });
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href={`/profile/${user?.id}`}
          className="p-2 text-dark-600 hover:bg-dark-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-bold text-dark-900">设置</h1>
      </div>

      {/* Settings Form */}
      <div className="bg-white border border-dark-200 rounded-xl p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <Avatar
              src={user?.avatar_url}
              userId={user?.id}
              alt={user?.display_name}
              size="xl"
            />
            <div>
              <Button type="button" variant="outline" size="sm">
                更换头像
              </Button>
              <p className="text-sm text-dark-500 mt-1">
                支持 JPG、PNG 格式，最大 2MB
              </p>
            </div>
          </div>

          {/* Display Name */}
          <Input
            label="显示名称"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="你的显示名称"
            maxLength={50}
          />

          {/* Bio */}
          <Textarea
            label="个人简介"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="介绍一下你自己..."
            rows={4}
            maxLength={200}
            helperText={`${bio.length}/200`}
          />

          {/* Message */}
          {message.text && (
            <p
              className={
                message.type === 'success' ? 'text-green-600' : 'text-red-500'
              }
            >
              {message.text}
            </p>
          )}

          {/* Submit */}
          <div className="flex justify-end">
            <Button type="submit" isLoading={isLoading}>
              保存更改
            </Button>
          </div>
        </form>
      </div>

      {/* Danger Zone */}
      <div className="mt-6 bg-white border border-red-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-red-600 mb-4">危险区域</h2>
        <p className="text-dark-600 mb-4">
          删除账号后，你的所有数据将被永久删除，无法恢复。
        </p>
        <Button variant="danger">删除账号</Button>
      </div>
    </div>
  );
}
