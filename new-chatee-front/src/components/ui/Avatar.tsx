'use client';

import Image from 'next/image';
import { cn, getAvatarUrl } from '@/lib/utils';

interface AvatarProps {
  src?: string;
  alt?: string;
  userId?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function Avatar({ src, alt = 'Avatar', userId, size = 'md', className }: AvatarProps) {
  const sizes = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  };

  const avatarUrl = src || getAvatarUrl(userId || 'default');

  return (
    <div
      className={cn(
        'relative rounded-full overflow-hidden bg-dark-200',
        sizes[size],
        className
      )}
    >
      <Image
        src={avatarUrl}
        alt={alt}
        fill
        className="object-cover"
        unoptimized // For external URLs
      />
    </div>
  );
}
