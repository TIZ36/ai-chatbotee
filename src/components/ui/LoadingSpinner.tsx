/**
 * 加载状态组件 - 统一的加载指示器
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  text?: string;
}

/**
 * 加载指示器 - 用于异步操作、数据加载等场景
 * 
 * @example
 * <LoadingSpinner size="md" text="加载中..." />
 */
export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  className,
  text,
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      <Loader2 className={cn('animate-spin text-mutedToken-foreground', sizeClasses[size])} />
      {text && (
        <span className="text-sm text-mutedToken-foreground">{text}</span>
      )}
    </div>
  );
};

/**
 * 全屏加载遮罩 - 用于页面级加载状态
 */
export interface LoadingOverlayProps {
  isLoading: boolean;
  text?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isLoading,
  text = '加载中...',
}) => {
  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size="lg" />
        {text && <p className="text-sm text-mutedToken-foreground">{text}</p>}
      </div>
    </div>
  );
};

