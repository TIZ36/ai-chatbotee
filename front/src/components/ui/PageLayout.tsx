/**
 * 统一的页面布局组件
 * 为所有面板提供一致的外观和间距
 */

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface PageLayoutProps {
  /** 页面标题 */
  title: string;
  /** 页面描述/副标题 */
  description?: string;
  /** 标题图标 */
  icon?: LucideIcon;
  /** 右上角操作区域 */
  headerActions?: React.ReactNode;
  /** 主要内容区域 */
  children: React.ReactNode;
  /** 是否显示页面头部 */
  showHeader?: boolean;
  /** 自定义内容区域类名 */
  contentClassName?: string;
  /** 是否使用全宽布局（用于编辑器等需要最大化空间的页面） */
  fullWidth?: boolean;
  /** 是否使用紧凑模式（减少内边距） */
  compact?: boolean;
}

const PageLayout: React.FC<PageLayoutProps> = ({
  title,
  description,
  icon: Icon,
  headerActions,
  children,
  showHeader = true,
  contentClassName = '',
  fullWidth = false,
  compact = false,
}) => {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 主容器 - 毛玻璃效果 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 页面头部 - 毛玻璃效果 */}
        {showHeader && (
          <div className="flex-shrink-0 px-3 py-2 glass-header">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {Icon && (
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--color-accent)]/10 dark:bg-[var(--color-accent)]/20">
                    <Icon className="w-4 h-4 text-[var(--color-accent)]" strokeWidth={1.5} />
                  </div>
                )}
                <div>
                  <h1 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h1>
                  {description && typeof description === 'string' && description.trim() && description !== '0' && (
                    <p className="text-[10px] text-gray-500 dark:text-[#808080] mt-0.5">{description}</p>
                  )}
                </div>
              </div>
              {headerActions && (
                <div className="flex items-center space-x-1.5">
                  {headerActions}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 内容区域 - 带滚动 */}
        <div className={`
          flex-1 overflow-auto
          ${fullWidth ? '' : compact ? 'p-2' : 'p-3'}
          ${contentClassName}
        `}>
          {children}
        </div>
      </div>
    </div>
  );
};

/**
 * 卡片组件 - 用于内容分组 (带立体阴影)
 */
interface CardProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  /** 是否无内边距 */
  noPadding?: boolean;
  /** 自定义头部操作 */
  headerAction?: React.ReactNode;
  /** 卡片大小: 默认(default)、紧凑(compact)、宽松(relaxed) */
  size?: 'compact' | 'default' | 'relaxed';
}

export const Card: React.FC<CardProps> = ({
  title,
  description,
  children,
  className = '',
  noPadding = false,
  headerAction,
  size = 'default',
}) => {
  const paddingClass = {
    compact: 'p-2',
    default: 'p-3',
    relaxed: 'p-4',
  }[size];

  return (
    <div className={`glass-card ${className}`}>
      {(title || headerAction) && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200/30 dark:border-white/5">
          <div>
            {title && (
              <h3 className="text-xs font-semibold text-gray-900 dark:text-white">{title}</h3>
            )}
            {description && typeof description === 'string' && description.trim() && description !== '0' && (
              <p className="text-[10px] text-gray-500 dark:text-[#808080] mt-0.5">{description}</p>
            )}
          </div>
          {headerAction}
        </div>
      )}
      <div className={noPadding ? '' : paddingClass}>
        {children}
      </div>
    </div>
  );
};

/**
 * 区块组件 - 用于页面内的大分区
 */
interface SectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({
  title,
  description,
  children,
  className = '',
  headerAction,
}) => {
  return (
    <div className={`glass-section mb-3 ${className}`}>
      {(title || headerAction) && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200/20 dark:border-white/5">
          <div>
            {title && (
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
            )}
            {description && typeof description === 'string' && description.trim() && description !== '0' && (
              <p className="text-[10px] text-gray-500 dark:text-[#808080] mt-0.5">{description}</p>
            )}
          </div>
          {headerAction}
        </div>
      )}
      <div className="p-2">
        {children}
      </div>
    </div>
  );
};

/**
 * 列表项组件
 */
interface ListItemProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}

export const ListItem: React.FC<ListItemProps> = ({
  children,
  className = '',
  onClick,
  active = false,
  disabled = false,
}) => {
  return (
    <div
      onClick={!disabled ? onClick : undefined}
      className={`
        px-2 py-1.5 rounded-md transition-all duration-150
        ${active 
          ? 'bg-primary-100/80 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' 
          : 'hover:bg-gray-100/60 dark:hover:bg-white/5'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
};


/**
 * 徽章组件 - 状态指示
 */
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  className = '',
}) => {
  const variantClass = {
    default: 'bg-gray-100 text-gray-700 dark:bg-[#404040] dark:text-[#e0e0e0]',
    success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  }[variant];

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${variantClass} badge-${variant} ${className}`}>
      {children}
    </span>
  );
};

/**
 * 空状态组件
 */
interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-center justify-center py-12 text-center ${className}`}>
      {Icon && (
        <div className="text-gray-300 dark:text-gray-600 mb-4 [data-skin='niho']:text-[var(--neon-green-500)]">
          <Icon className="w-12 h-12" strokeWidth={1} />
        </div>
      )}
      <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2 [data-skin='niho']:text-[#e8f5f0]">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-md [data-skin='niho']:text-[var(--niho-skyblue-gray)]">{description}</p>
      )}
      {action && (
        <div className="mt-2">
          {action}
        </div>
      )}
    </div>
  );
};

/**
 * 提示框组件
 */
interface AlertProps {
  children: React.ReactNode;
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  children,
  variant = 'info',
  title,
  className = '',
}) => {
  const variantClass = {
    info: 'bg-primary-50 border-primary-200 text-primary-800 dark:bg-primary-900/10 dark:border-primary-800/40 dark:text-primary-300 [data-skin="niho"]:bg-[#000] [data-skin="niho"]:border-[rgba(0,229,255,0.18)] [data-skin="niho"]:text-[#00e5ff]',
    success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800/50 dark:text-green-300 [data-skin="niho"]:bg-[#000] [data-skin="niho"]:border-[rgba(0,255,136,0.18)] [data-skin="niho"]:text-[#00ff88]',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/20 dark:border-yellow-800/50 dark:text-yellow-300 [data-skin="niho"]:bg-[#000] [data-skin="niho"]:border-[rgba(255,215,0,0.18)] [data-skin="niho"]:text-[#ffd700]',
    error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-300 [data-skin="niho"]:bg-[#000] [data-skin="niho"]:border-[rgba(255,107,157,0.18)] [data-skin="niho"]:text-[#ff6b9d]',
  }[variant];

  return (
    <div className={`rounded-xl p-4 border ${variantClass} ${className}`}>
      {title && <div className="font-semibold mb-1">{title}</div>}
      <div className="text-sm">{children}</div>
    </div>
  );
};

export default PageLayout;
