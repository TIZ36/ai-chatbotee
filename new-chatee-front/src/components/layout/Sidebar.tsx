'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  MessageCircle,
  Mail,
  User,
  PenSquare,
  Settings,
  LogOut,
} from 'lucide-react';
import { Avatar, Button } from '@/components/ui';
import { useAuthStore, useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', icon: Home, label: '首页' },
  { href: '/threads', icon: MessageCircle, label: '动态' },
  { href: '/chat', icon: Mail, label: '私信' },
  { href: '/profile', icon: User, label: '我的' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const { setShowNewThreadModal } = useUIStore();

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-dark-200 flex flex-col">
      {/* Logo */}
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold text-dark-900">Chatee</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href === '/profile' ? `/profile/${user?.id}` : item.href}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-xl transition-colors',
                    isActive
                      ? 'bg-primary-50 text-primary-600'
                      : 'text-dark-600 hover:bg-dark-50'
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* New Thread Button */}
        <Button
          className="w-full mt-4 gap-2"
          onClick={() => setShowNewThreadModal(true)}
        >
          <PenSquare className="w-5 h-5" />
          发布动态
        </Button>
      </nav>

      {/* User Menu */}
      <div className="p-4 border-t border-dark-200">
        <div className="flex items-center gap-3">
          <Avatar
            src={user?.avatar_url}
            userId={user?.id}
            alt={user?.display_name}
            size="md"
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-dark-900 truncate">
              {user?.display_name || 'Guest'}
            </p>
            <p className="text-sm text-dark-500 truncate">
              @{user?.username || 'guest'}
            </p>
          </div>
          <div className="flex gap-1">
            <Link
              href="/settings"
              className="p-2 text-dark-400 hover:text-dark-600 hover:bg-dark-100 rounded-lg transition-colors"
            >
              <Settings className="w-5 h-5" />
            </Link>
            <button
              onClick={handleLogout}
              className="p-2 text-dark-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
