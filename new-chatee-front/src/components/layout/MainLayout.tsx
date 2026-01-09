'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { CreateThreadModal } from '@/components/thread';
import { CreateChatModal } from '@/components/chat';
import { useAuthStore } from '@/lib/store';
import { wsClient } from '@/lib/websocket';

interface MainLayoutProps {
  children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, token } = useAuthStore();

  // Redirect to login if not authenticated
  useEffect(() => {
    const publicPaths = ['/login', '/register'];
    if (!isAuthenticated && !publicPaths.includes(pathname)) {
      router.push('/login');
    }
  }, [isAuthenticated, pathname, router]);

  // Connect WebSocket
  useEffect(() => {
    if (isAuthenticated && token) {
      wsClient.connect(token);
    }

    return () => {
      wsClient.disconnect();
    };
  }, [isAuthenticated, token]);

  // Don't show layout on auth pages
  const isAuthPage = ['/login', '/register'].includes(pathname);

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-dark-50">
      {/* Sidebar - Desktop */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Main Content */}
      <main className="lg:ml-64 min-h-screen pb-16 lg:pb-0">
        {children}
      </main>

      {/* Mobile Navigation */}
      <MobileNav />

      {/* Global Modals */}
      <CreateThreadModal />
      <CreateChatModal />
    </div>
  );
}
