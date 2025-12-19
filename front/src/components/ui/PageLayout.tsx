/**
 * 统一的页面布局组件 - GNOME 风格 (增强版)
 * 为所有面板提供一致的外观、3D阴影效果和间距
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
    <div className="h-full flex flex-col overflow-hidden gnome-page-container">
      {/* 主容器 - 统一的立体阴影效果 */}
      <div className="flex-1 flex flex-col overflow-hidden gnome-main-panel">
        {/* 页面头部 - 带底部阴影分隔 */}
        {showHeader && (
          <div className="gnome-panel-header">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {Icon && (
                  <div className="gnome-icon-box">
                    <Icon className="w-5 h-5 text-[#7c3aed]" strokeWidth={1.5} />
                  </div>
                )}
                <div>
                  <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h1>
                  {description && (
                    <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-0.5">{description}</p>
                  )}
                </div>
              </div>
              {headerActions && (
                <div className="flex items-center space-x-2">
                  {headerActions}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 内容区域 - 带滚动 */}
        <div className={`
          flex-1 overflow-auto
          ${fullWidth ? '' : compact ? 'p-4' : 'p-5'}
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
    compact: 'p-3',
    default: 'p-4',
    relaxed: 'p-5',
  }[size];

  return (
    <div className={`gnome-card ${className}`}>
      {(title || headerAction) && (
        <div className="gnome-card-header">
          <div>
            {title && (
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
            )}
            {description && (
              <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-0.5">{description}</p>
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
    <div className={`gnome-section ${className}`}>
      {(title || headerAction) && (
        <div className="gnome-section-header">
          <div>
            {title && (
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
            )}
            {description && (
              <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-0.5">{description}</p>
            )}
          </div>
          {headerAction}
        </div>
      )}
      <div className="gnome-section-content">
        {children}
      </div>
    </div>
  );
};

/**
 * 列表项组件 - GNOME 风格行
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
        gnome-list-item
        ${active ? 'gnome-list-item-active' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
};

/**
 * 按钮样式 - GNOME 风格 (增强版)
 */
export const buttonStyles = {
  primary: `
    gnome-btn gnome-btn-primary
  `,
  secondary: `
    gnome-btn gnome-btn-secondary
  `,
  danger: `
    gnome-btn gnome-btn-danger
  `,
  ghost: `
    gnome-btn gnome-btn-ghost
  `,
  icon: `
    gnome-btn-icon
  `,
};

/**
 * 输入框样式 - GNOME 风格
 */
export const inputStyles = {
  base: `gnome-input`,
  select: `gnome-select`,
  textarea: `gnome-input min-h-[80px] resize-y`,
};

/**
 * 标签样式 - GNOME 风格
 */
export const labelStyles = {
  base: `block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5`,
  hint: `text-xs text-gray-500 dark:text-[#a0a0a0] mt-1`,
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
    <span className={`gnome-badge ${variantClass} ${className}`}>
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
    <div className={`gnome-empty-state ${className}`}>
      {Icon && (
        <div className="gnome-empty-state-icon">
          <Icon className="w-12 h-12" strokeWidth={1} />
        </div>
      )}
      <h3 className="gnome-empty-state-title">{title}</h3>
      {description && (
        <p className="gnome-empty-state-description">{description}</p>
      )}
      {action && (
        <div className="gnome-empty-state-action">
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
    info: 'gnome-alert-info',
    success: 'gnome-alert-success',
    warning: 'gnome-alert-warning',
    error: 'gnome-alert-error',
  }[variant];

  return (
    <div className={`gnome-alert ${variantClass} ${className}`}>
      {title && <div className="gnome-alert-title">{title}</div>}
      <div className="gnome-alert-content">{children}</div>
    </div>
  );
};

export default PageLayout;
