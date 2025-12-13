/**
 * 数据列表项组件 - 封装常用的列表项展示模式
 * 用于替代重复的列表项布局代码
 */

import React from 'react';
import { ListItem } from './PageLayout';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { cn } from '@/utils/cn';
import { LucideIcon, Edit2, Trash2 } from 'lucide-react';

export interface DataListItemProps {
  // 基础属性
  id: string;
  title: string;
  description?: string;
  avatar?: string | React.ReactNode;
  icon?: LucideIcon;
  
  // 状态
  isSelected?: boolean;
  isActive?: boolean;
  badge?: React.ReactNode;
  
  // 交互
  onClick?: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  onEdit?: (e: React.MouseEvent) => void;
  actions?: React.ReactNode;
  
  // 样式
  className?: string;
  disabled?: boolean;
}

/**
 * 数据列表项 - 用于会话列表、配置列表等场景
 * 
 * @example
 * <DataListItem
 *   id={item.id}
 *   title={item.name}
 *   description={item.description}
 *   avatar={item.avatar}
 *   isSelected={selectedId === item.id}
 *   onClick={() => handleSelect(item.id)}
 *   onDelete={(e) => handleDelete(e, item.id)}
 * />
 */
export const DataListItem: React.FC<DataListItemProps> = ({
  id,
  title,
  description,
  avatar,
  icon: Icon,
  isSelected = false,
  isActive = false,
  badge,
  onClick,
  onDelete,
  onEdit,
  actions,
  className,
  disabled = false,
}) => {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(e);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit) {
      onEdit(e);
    }
  };

  return (
    <ListItem
      active={isSelected || isActive}
      onClick={handleClick}
      disabled={disabled}
      className={cn(className)}
    >
      <div className="flex items-center justify-between w-full gap-3">
        {/* 左侧内容 */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* 头像/图标 */}
          {avatar && (
            <div className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden bg-mutedToken flex items-center justify-center">
              {typeof avatar === 'string' ? (
                <img src={avatar} alt={title} className="w-full h-full object-cover" />
              ) : (
                avatar
              )}
            </div>
          )}
          {Icon && !avatar && (
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-mutedToken flex items-center justify-center">
              <Icon className="w-5 h-5 text-mutedToken-foreground" />
            </div>
          )}

          {/* 文本内容 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-medium text-sm truncate">{title}</div>
              {badge}
            </div>
            {description && (
              <div className="text-xs text-mutedToken-foreground truncate mt-0.5">
                {description}
              </div>
            )}
          </div>
        </div>

        {/* 右侧操作 */}
        {(onDelete || onEdit || actions) && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {onEdit && (
              <IconButton
                icon={Edit2}
                label="编辑"
                onClick={handleEdit}
                variant="ghost"
                size="icon"
              />
            )}
            {onDelete && (
              <IconButton
                icon={Trash2}
                label="删除"
                onClick={handleDelete}
                variant="ghost"
                size="icon"
              />
            )}
            {actions}
          </div>
        )}
      </div>
    </ListItem>
  );
};

