'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }

    setIsLoading(true);
    setError('');

    const result = await authApi.login({ username, password });

    setIsLoading(false);

    if (result.success && result.data) {
      setAuth(result.data.user, result.data.token);
      router.push('/');
    } else {
      setError(result.error?.message || '登录失败');
    }
  };

  // Demo login for development
  const handleDemoLogin = () => {
    const demoUser = {
      id: 'demo-user-1',
      username: 'demo',
      display_name: 'Demo User',
      follower_count: 100,
      following_count: 50,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    setAuth(demoUser, 'demo-token');
    router.push('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 rounded-2xl mb-4">
            <MessageCircle className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-dark-900">Chatee</h1>
          <p className="text-dark-500 mt-2">登录你的账号</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="用户名"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
            />

            <Input
              label="密码"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
            />

            {error && (
              <p className="text-red-500 text-sm">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              isLoading={isLoading}
            >
              登录
            </Button>
          </form>

          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleDemoLogin}
            >
              使用演示账号登录
            </Button>
          </div>

          <div className="mt-6 text-center text-sm text-dark-500">
            还没有账号？{' '}
            <Link href="/register" className="text-primary-600 hover:underline">
              立即注册
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
