import type { Metadata } from 'next';
import { MainLayout } from '@/components/layout';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chatee - Social Chat Platform',
  description: 'A modern social chat platform with threads, following, and private messaging',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <MainLayout>{children}</MainLayout>
      </body>
    </html>
  );
}
