/**
 * 爬虫模块选择器组件
 * 完全照搬@选择器的布局设计
 */

import React, { useState, useEffect, useRef } from 'react';
import { Globe, ChevronRight, Loader, Package, Database } from 'lucide-react';
import { searchModules, ModuleWithBatches, getBatch } from '../services/crawlerApi';

interface CrawlerModuleSelectorProps {
  query?: string;
  position: { top?: number; bottom?: number; left: number; maxHeight: number };
  onSelect: (moduleId: string, batchId: string, batchName: string) => void;
  onClose: () => void;
}

const CrawlerModuleSelector: React.FC<CrawlerModuleSelectorProps> = ({
  query,
  position,
  onSelect,
  onClose,
}) => {
  const [modules, setModules] = useState<ModuleWithBatches[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadModules();
  }, [query]);

  useEffect(() => {
    // 自动聚焦选择器
    if (selectorRef.current && !loading && modules.length > 0) {
      selectorRef.current.focus();
    }
  }, [loading, modules]);

  const loadModules = async () => {
    try {
      setLoading(true);
      const result = await searchModules(query);
      setModules(result);
      if (result.length > 0 && result[0].batches.length > 0) {
        setExpandedModuleId(result[0].module_id);
      }
      setSelectedIndex(0);
    } catch (error) {
      console.error('[CrawlerModuleSelector] Failed to load modules:', error);
    } finally {
      setLoading(false);
    }
  };

  // 计算所有可选项（扁平化列表）
  const getAllSelectableItems = () => {
    const items: Array<{ type: 'module' | 'batch'; moduleIndex: number; batchIndex?: number }> = [];
    modules.forEach((module, moduleIndex) => {
      // 只添加有批次的模块，或者直接添加批次
      if (module.batches.length > 0) {
        if (expandedModuleId === module.module_id) {
          // 模块展开时，添加所有批次
          module.batches.forEach((_, batchIndex) => {
            items.push({ type: 'batch', moduleIndex, batchIndex });
          });
        } else {
          // 模块未展开时，只添加模块本身（用于展开）
          items.push({ type: 'module', moduleIndex });
        }
      }
    });
    return items;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (loading) return;

    const allItems = getAllSelectableItems();
    if (allItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = allItems[selectedIndex];
      if (item.type === 'module') {
        // 展开/折叠模块
        const module = modules[item.moduleIndex];
        setExpandedModuleId(expandedModuleId === module.module_id ? null : module.module_id);
        setSelectedIndex(0);
      } else if (item.type === 'batch' && item.batchIndex !== undefined) {
        // 选择批次
        const module = modules[item.moduleIndex];
        const batch = module.batches[item.batchIndex];
        onSelect(module.module_id, batch.batch_id, batch.batch_name);
      }
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    // 自动展开选中的模块
    const selectedItem = allItems[selectedIndex];
    if (selectedItem && selectedItem.type === 'module') {
      const module = modules[selectedItem.moduleIndex];
      if (expandedModuleId !== module.module_id && module.batches.length > 0) {
        setExpandedModuleId(module.module_id);
        setSelectedIndex(0);
      }
    }
  };

  const allItems = getAllSelectableItems();

  if (loading) {
    return (
      <div
        ref={selectorRef}
        className="fixed z-[100] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden at-selector-container"
        style={{
          ...(position.bottom !== undefined ? {
            bottom: `${position.bottom}px`
          } : {
            top: `${position.top}px`
          }),
          left: `${position.left}px`,
          minWidth: '200px',
          maxWidth: '300px',
          maxHeight: `${position.maxHeight || 256}px`,
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
        <div className="p-4 flex items-center justify-center">
          <Loader className="w-4 h-4 animate-spin text-gray-500" />
          <span className="ml-2 text-sm text-gray-500">加载中...</span>
        </div>
      </div>
    );
  }

  if (modules.length === 0) {
    return (
      <div
        ref={selectorRef}
        className="fixed z-[100] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden at-selector-container"
        style={{
          ...(position.bottom !== undefined ? {
            bottom: `${position.bottom}px`
          } : {
            top: `${position.top}px`
          }),
          left: `${position.left}px`,
          minWidth: '200px',
          maxWidth: '300px',
          maxHeight: `${position.maxHeight || 256}px`,
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
        <div className="p-2 border-b border-gray-200 dark:border-gray-700">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            选择爬虫批次
          </div>
        </div>
        <div className="p-4 text-sm text-gray-500 text-center">
          没有找到模块
        </div>
      </div>
    );
  }

  return (
    <div
      ref={selectorRef}
      className="fixed z-[100] bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-y-auto at-selector-container"
      style={{
        ...(position.bottom !== undefined ? {
          bottom: `${position.bottom}px`
        } : {
          top: `${position.top}px`
        }),
        left: `${position.left}px`,
        minWidth: '200px',
        maxWidth: '300px',
        maxHeight: `${position.maxHeight || 256}px`,
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
          选择爬虫批次
        </div>
      </div>

      {/* 模块和批次列表 */}
      <div className="py-1">
        {modules.map((module, moduleIndex) => {
          const isModuleExpanded = expandedModuleId === module.module_id;
          
          // 如果模块展开，显示批次；否则显示模块（用于展开）
          if (isModuleExpanded && module.batches.length > 0) {
            return (
              <div key={module.module_id}>
                {/* 模块标题（可折叠） */}
                <div
                  className="text-xs font-medium text-gray-500 dark:text-gray-400 px-3 py-1.5 flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  onClick={() => {
                    setExpandedModuleId(null);
                    setSelectedIndex(0);
                  }}
                >
                  <ChevronRight className="w-3 h-3 transform rotate-90" />
                  <Package className="w-3 h-3 text-blue-500" />
                  <span className="truncate">{module.module_name}</span>
                  <span className="text-xs text-gray-400">({module.batches.length})</span>
                </div>
                
                {/* 批次列表 */}
                {module.batches.map((batch, batchIndex) => {
                  const itemIndex = allItems.findIndex(
                    item => item.type === 'batch' && item.moduleIndex === moduleIndex && item.batchIndex === batchIndex
                  );
                  const isSelected = itemIndex === selectedIndex;

                  return (
                    <div
                      key={batch.batch_id}
                      className={`px-3 py-2 cursor-pointer transition-colors flex items-center space-x-2 ${
                        isSelected
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                      onClick={() => {
                        onSelect(module.module_id, batch.batch_id, batch.batch_name);
                      }}
                    >
                      <Database className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-900 dark:text-gray-100 truncate">
                          {batch.batch_name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {batch.item_count || 0} 条数据
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          } else {
            // 模块未展开，显示模块项（用于展开）
            const itemIndex = allItems.findIndex(
              item => item.type === 'module' && item.moduleIndex === moduleIndex
            );
            const isSelected = itemIndex === selectedIndex;

            if (module.batches.length === 0) {
              return null; // 没有批次的模块不显示
            }

            return (
              <div
                key={module.module_id}
                className={`px-3 py-2 cursor-pointer transition-colors flex items-center space-x-2 ${
                  isSelected
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
                onClick={() => {
                  setExpandedModuleId(module.module_id);
                  setSelectedIndex(0);
                }}
              >
                <Package className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900 dark:text-gray-100 truncate">
                    {module.module_name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {module.batches.length} 个批次
                  </div>
                </div>
                <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
              </div>
            );
          }
        })}
      </div>
    </div>
  );
};

export default CrawlerModuleSelector;
