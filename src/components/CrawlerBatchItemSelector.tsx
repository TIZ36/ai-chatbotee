/**
 * 爬虫批次数据项选择器
 * 完全照搬@选择器的布局设计，用于选择批次内的结构化数据
 */

import React, { useState, useEffect, useRef } from 'react';
import { FileText, List, Search, X, Database } from 'lucide-react';
import { CrawlerBatch } from '../services/crawlerApi';

interface CrawlerBatchItemSelectorProps {
  batch: CrawlerBatch;
  position: { top: number; left: number; maxHeight: number };
  onSelect: (item: any) => void;
  onClose: () => void;
}

const CrawlerBatchItemSelector: React.FC<CrawlerBatchItemSelectorProps> = ({
  batch,
  position,
  onSelect,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 优先使用 parsed_data（用户标记后生成的解析数据），如果没有则使用 crawled_data.normalized
  // parsed_data 现在是一个简单的数组，每个元素包含 title 和 content
  let items: any[] = [];
  let format = 'article';
  
  if (batch.parsed_data && Array.isArray(batch.parsed_data)) {
    // parsed_data 是数组格式，直接使用
    items = batch.parsed_data.map((item, index) => ({
      id: `item_${index + 1}`,
      title: item.title || '',
      content: item.content || ''
    }));
    format = 'list';
  } else if (batch.crawled_data?.normalized) {
    // 使用 crawled_data.normalized
    const normalizedData = batch.crawled_data.normalized;
    items = normalizedData.items || [];
    format = normalizedData.format || 'article';
  }

  // 过滤数据项（模糊匹配）
  const filteredItems = items.filter((item: any) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const title = (item.title || '').toLowerCase();
    const content = (item.content || '').toLowerCase();
    return title.includes(query) || content.includes(query);
  });

  useEffect(() => {
    // 自动聚焦搜索输入框，让用户可以立即开始输入搜索
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    // 重置选中索引当搜索查询改变时
    setSelectedIndex(0);
  }, [searchQuery]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filteredItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        onSelect(filteredItems[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={selectorRef}
      className="fixed z-[100] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-y-auto at-selector-container"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        minWidth: '200px',
        maxWidth: '400px',
        maxHeight: `${position.maxHeight || 400}px`,
      }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseUp={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {/* 头部标题 - 完全照搬@选择器的样式 */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          选择数据项
        </div>
      </div>

      {/* 搜索框 */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <Search className="w-3 h-3 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索..."
            className="flex-1 bg-transparent border-none outline-none text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
                e.stopPropagation();
                handleKeyDown(e as any);
              }
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {format === 'list' ? (
            <span className="flex items-center space-x-1">
              <List className="w-3 h-3" />
              <span>{filteredItems.length} / {items.length} 项</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1">
              <FileText className="w-3 h-3" />
              <span>{filteredItems.length} / {items.length} 项</span>
            </span>
          )}
        </div>
      </div>

      {/* 数据项列表 - 完全照搬@选择器的样式 */}
      <div className="py-1">
        {filteredItems.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {searchQuery ? '没有找到匹配的数据项' : '该批次没有数据项'}
          </div>
        ) : (
          filteredItems.map((item: any, index: number) => {
            const isSelected = index === selectedIndex;
            return (
              <div
                key={item.id || index}
                className={`px-3 py-2 cursor-pointer transition-colors flex items-center space-x-2 ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
                onClick={() => onSelect(item)}
              >
                <Database className="w-4 h-4 text-green-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {item.title && (
                    <div className="text-sm text-gray-900 dark:text-gray-100 truncate">
                      {item.title}
                    </div>
                  )}
                  {item.content && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
                      {item.content.length > 80 
                        ? item.content.substring(0, 80) + '...' 
                        : item.content}
                    </div>
                  )}
                  {!item.title && !item.content && (
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      数据项 #{index + 1}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CrawlerBatchItemSelector;
