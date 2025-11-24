/**
 * 爬虫配置页面
 * 包含爬虫测试、模块管理和批次管理功能
 */

import React, { useState, useEffect } from 'react';
import { Globe, Package, Database, Plus, Trash2, Edit2, RefreshCw, X, ChevronRight, ChevronDown, Loader, AlertCircle } from 'lucide-react';
import CrawlerTestPage from './CrawlerTestPage';
import { 
  getModules, 
  getBatches, 
  deleteModule, 
  deleteBatch, 
  createBatch,
  CrawlerModule, 
  CrawlerBatch 
} from '../services/crawlerApi';

const CrawlerConfigPage: React.FC = () => {
  const [showTestPage, setShowTestPage] = useState(false);
  const [modules, setModules] = useState<CrawlerModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [moduleBatches, setModuleBatches] = useState<Map<string, CrawlerBatch[]>>(new Map());
  const [loadingBatches, setLoadingBatches] = useState<Set<string>>(new Set());
  const [refreshingBatch, setRefreshingBatch] = useState<string | null>(null);
  const [editingModuleId, setEditingModuleId] = useState<string | undefined>(undefined);
  const [editingBatchId, setEditingBatchId] = useState<string | undefined>(undefined);

  useEffect(() => {
    loadModules();
  }, []);

  const loadModules = async () => {
    try {
      setLoading(true);
      const result = await getModules();
      setModules(result);
    } catch (error) {
      console.error('[CrawlerConfigPage] Failed to load modules:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBatches = async (moduleId: string) => {
    if (moduleBatches.has(moduleId)) {
      return; // 已经加载过
    }

    try {
      setLoadingBatches(prev => new Set(prev).add(moduleId));
      const batches = await getBatches(moduleId);
      setModuleBatches(prev => new Map(prev).set(moduleId, batches));
    } catch (error) {
      console.error('[CrawlerConfigPage] Failed to load batches:', error);
    } finally {
      setLoadingBatches(prev => {
        const next = new Set(prev);
        next.delete(moduleId);
        return next;
      });
    }
  };

  const handleModuleToggle = (moduleId: string) => {
    if (expandedModuleId === moduleId) {
      setExpandedModuleId(null);
    } else {
      setExpandedModuleId(moduleId);
      loadBatches(moduleId);
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (!confirm('确定要删除这个模块吗？这将删除所有相关的批次数据。')) {
      return;
    }

    try {
      await deleteModule(moduleId);
      setModules(prev => prev.filter(m => m.module_id !== moduleId));
      setModuleBatches(prev => {
        const next = new Map(prev);
        next.delete(moduleId);
        return next;
      });
      if (expandedModuleId === moduleId) {
        setExpandedModuleId(null);
      }
    } catch (error) {
      console.error('[CrawlerConfigPage] Failed to delete module:', error);
      alert('删除模块失败');
    }
  };

  const handleDeleteBatch = async (moduleId: string, batchId: string) => {
    if (!confirm('确定要删除这个批次吗？')) {
      return;
    }

    try {
      await deleteBatch(moduleId, batchId);
      setModuleBatches(prev => {
        const next = new Map(prev);
        const batches = next.get(moduleId) || [];
        next.set(moduleId, batches.filter(b => b.batch_id !== batchId));
        return next;
      });
    } catch (error) {
      console.error('[CrawlerConfigPage] Failed to delete batch:', error);
      alert('删除批次失败');
    }
  };

  const handleRefreshBatch = async (moduleId: string, batchName: string) => {
    try {
      setRefreshingBatch(`${moduleId}:${batchName}`);
      await createBatch(moduleId, batchName, true); // force_refresh = true
      // 重新加载批次列表
      const batches = await getBatches(moduleId);
      setModuleBatches(prev => new Map(prev).set(moduleId, batches));
    } catch (error) {
      console.error('[CrawlerConfigPage] Failed to refresh batch:', error);
      alert('刷新批次失败');
    } finally {
      setRefreshingBatch(null);
    }
  };

  const handleModuleCreated = () => {
    setShowTestPage(false);
    loadModules(); // 重新加载模块列表
  };

  if (showTestPage) {
    return (
      <CrawlerTestPage
        onClose={() => {
          setShowTestPage(false);
          setEditingModuleId(undefined);
          setEditingBatchId(undefined);
        }}
        onModuleCreated={handleModuleCreated}
        moduleId={editingModuleId}
        batchId={editingBatchId}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6 px-6 pt-6 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <Globe className="w-7 h-7 text-primary-600" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">爬虫配置</h1>
        </div>
        <button
          onClick={() => setShowTestPage(true)}
          className="btn-primary flex items-center space-x-2 px-4 py-2"
        >
          <Plus className="w-4 h-4" />
          <span>新建爬虫模块</span>
        </button>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader className="w-6 h-6 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-500">加载中...</span>
          </div>
        ) : modules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Package className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
              还没有爬虫模块
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              点击右上角的"新建爬虫模块"按钮开始创建
            </p>
            <button
              onClick={() => setShowTestPage(true)}
              className="btn-primary flex items-center space-x-2 px-4 py-2"
            >
              <Plus className="w-4 h-4" />
              <span>创建第一个模块</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {modules.map(module => {
              const isExpanded = expandedModuleId === module.module_id;
              const batches = moduleBatches.get(module.module_id) || [];
              const isLoadingBatches = loadingBatches.has(module.module_id);

              return (
                <div
                  key={module.module_id}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
                >
                  {/* 模块头部 */}
                  <div className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <button
                        onClick={() => handleModuleToggle(module.module_id)}
                        className="flex items-center space-x-2 flex-1 min-w-0 text-left"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                        )}
                        <Package className="w-5 h-5 text-blue-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {module.module_name}
                          </h3>
                          {module.description && (
                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-1">
                              {module.description}
                            </p>
                          )}
                        </div>
                      </button>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {batches.length} 个批次
                      </span>
                      <button
                        onClick={() => handleDeleteModule(module.module_id)}
                        className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                        title="删除模块"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* 批次列表 */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 dark:border-gray-700">
                      {isLoadingBatches ? (
                        <div className="flex items-center justify-center p-8">
                          <Loader className="w-5 h-5 animate-spin text-gray-400" />
                          <span className="ml-2 text-sm text-gray-500">加载批次中...</span>
                        </div>
                      ) : batches.length === 0 ? (
                        <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                          该模块还没有批次数据
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                          {batches.map(batch => {
                            const isRefreshing = refreshingBatch === `${module.module_id}:${batch.batch_name}`;
                            return (
                              <div
                                key={batch.batch_id}
                                className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                                    <Database className="w-4 h-4 text-green-500 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center space-x-2">
                                        <span className="font-medium text-gray-900 dark:text-gray-100">
                                          {batch.batch_name}
                                        </span>
                                        <span
                                          className={`text-xs px-2 py-0.5 rounded ${
                                            batch.status === 'completed'
                                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                              : batch.status === 'error'
                                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                          }`}
                                        >
                                          {batch.status === 'completed' ? '已完成' : batch.status === 'error' ? '错误' : '进行中'}
                                        </span>
                                      </div>
                                      <div className="flex items-center space-x-4 mt-1 text-xs text-gray-500 dark:text-gray-400">
                                        {batch.crawled_at && (
                                          <span>
                                            爬取时间: {new Date(batch.crawled_at).toLocaleString('zh-CN')}
                                          </span>
                                        )}
                                        {batch.item_count !== undefined && (
                                          <span>{batch.item_count} 条数据</span>
                                        )}
                                      </div>
                                      {batch.error_message && (
                                        <div className="flex items-center space-x-1 mt-1 text-xs text-red-600 dark:text-red-400">
                                          <AlertCircle className="w-3 h-3" />
                                          <span>{batch.error_message}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-2 flex-shrink-0 ml-4">
                                    {batch.status === 'completed' && (
                                      <button
                                        onClick={() => handleRefreshBatch(module.module_id, batch.batch_name)}
                                        disabled={isRefreshing}
                                        className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors disabled:opacity-50"
                                        title="刷新批次"
                                      >
                                        {isRefreshing ? (
                                          <Loader className="w-4 h-4 animate-spin" />
                                        ) : (
                                          <RefreshCw className="w-4 h-4" />
                                        )}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        setEditingModuleId(module.module_id);
                                        setEditingBatchId(batch.batch_id);
                                        setShowTestPage(true);
                                      }}
                                      className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                      title="编辑批次解析数据"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteBatch(module.module_id, batch.batch_id)}
                                      className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                      title="删除批次"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CrawlerConfigPage;
