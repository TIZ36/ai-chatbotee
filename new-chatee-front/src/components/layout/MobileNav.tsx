'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageCircle, Mail, User } from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', icon: Home, label: '首页' },
  { href: '/threads', icon: MessageCircle, label: '动态' },
  { href: '/chat', icon: Mail, label: '私信' },
  { href: '/profile', icon: User, label: '我的' },
];

export function MobileNav() {
  const pathname = usePathname();
  const { user } = useAuthStore();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-dark-200 lg:hidden z-50">
      <ul className="flex items-center justify-around py-2">
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
                  'flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-colors',
                  isActive
                    ? 'text-primary-600'
                    : 'text-dark-500 hover:text-dark-700'
                )}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-xs">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
