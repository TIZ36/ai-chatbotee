/**
 * 统一的 @ 符号选择器组件
 * 用于会话、研究界面选择 MCP、工作流、技能包、爬虫链接
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plug, Workflow as WorkflowIcon, Package, Globe, Loader, X } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './Dialog';

export interface MCPServerItem {
  id: string;
  name: string;
  display_name?: string;
  client_name?: string;
}

export interface WorkflowItem {
  workflow_id: string;
  name: string;
  description?: string;
}

export interface SkillPackItem {
  skill_pack_id: string;
  name: string;
  summary?: string;
}

export interface CrawlerCacheItem {
  url: string;
  title?: string;
  cached_at: string;
}

interface AtSelectorProps {
  // 位置
  position: { top?: number; bottom?: number; left: number; maxHeight?: number };
  
  // 数据
  mcpServers?: MCPServerItem[];
  workflows?: WorkflowItem[];
  skillPacks?: SkillPackItem[];
  crawlerCache?: CrawlerCacheItem[];
  
  // 状态
  query?: string;
  selectedIndex?: number;
  
  // MCP 相关
  connectedMcpServerIds?: Set<string>;
  connectingMcpServerIds?: Set<string>;
  onConnectMCP?: (serverId: string) => Promise<void>;
  
  // 选择回调
  onSelectMCP?: (serverId: string, name: string) => void;
  onSelectWorkflow?: (workflowId: string, name: string) => void;
  onSelectSkillPack?: (skillPackId: string, name: string) => void;
  onSelectCrawler?: (url: string) => void;
  onCrawlUrl?: (url: string) => Promise<void>; // 爬取新URL
  
  // 关闭
  onClose: () => void;
  
  // 样式
  className?: string;
}

const AtSelector: React.FC<AtSelectorProps> = ({
  position,
  mcpServers = [],
  workflows = [],
  skillPacks = [],
  crawlerCache = [],
  query = '',
  selectedIndex = 0,
  connectedMcpServerIds = new Set(),
  connectingMcpServerIds = new Set(),
  onConnectMCP,
  onSelectMCP,
  onSelectWorkflow,
  onSelectSkillPack,
  onSelectCrawler,
  onCrawlUrl,
  onClose,
  className = '',
}) => {
  const selectorRef = useRef<HTMLDivElement>(null);
  const [showCrawlerDialog, setShowCrawlerDialog] = useState(false);
  const [crawlerUrl, setCrawlerUrl] = useState('');
  const [isCrawling, setIsCrawling] = useState(false);
  
  // 过滤数据
  const filteredMcpServers = mcpServers.filter(s => 
    s.name.toLowerCase().includes(query.toLowerCase()) ||
    (s.display_name || s.client_name || '').toLowerCase().includes(query.toLowerCase())
  );
  
  const filteredWorkflows = workflows.filter(w => 
    w.name.toLowerCase().includes(query.toLowerCase())
  );
  
  const filteredSkillPacks = skillPacks.filter(sp => 
    sp.name.toLowerCase().includes(query.toLowerCase())
  );
  
  const filteredCrawlerCache = crawlerCache.filter(item => 
    item.url.toLowerCase().includes(query.toLowerCase()) ||
    (item.title || '').toLowerCase().includes(query.toLowerCase())
  );
  
  // 扁平化所有选项用于键盘导航
  const allItems: Array<{
    type: 'mcp' | 'workflow' | 'skillpack' | 'crawler' | 'crawler-new';
    id: string;
    name: string;
    data?: any;
  }> = [];
  
  filteredMcpServers.forEach(s => {
    allItems.push({ type: 'mcp', id: s.id, name: s.display_name || s.client_name || s.name, data: s });
  });
  filteredWorkflows.forEach(w => {
    allItems.push({ type: 'workflow', id: w.workflow_id, name: w.name, data: w });
  });
  filteredSkillPacks.forEach(sp => {
    allItems.push({ type: 'skillpack', id: sp.skill_pack_id, name: sp.name, data: sp });
  });
  filteredCrawlerCache.forEach(item => {
    allItems.push({ type: 'crawler', id: item.url, name: item.title || item.url, data: item });
  });
  // 添加"新建爬虫"选项
  if (query.trim() === '' || query.toLowerCase().includes('爬虫') || query.toLowerCase().includes('crawler')) {
    allItems.push({ type: 'crawler-new', id: 'crawler-new', name: '🕷️ 爬取新网页...', data: null });
  }
  
  const selectedItem = allItems[selectedIndex];
  
  // 处理选择
  const handleSelect = async (item: typeof allItems[0]) => {
    if (item.type === 'crawler-new') {
      setShowCrawlerDialog(true);
      return;
    }
    
    if (item.type === 'mcp') {
      const server = item.data as MCPServerItem;
      const isConnected = connectedMcpServerIds.has(server.id);
      if (!isConnected && onConnectMCP) {
        await onConnectMCP(server.id);
      }
      onSelectMCP?.(server.id, server.display_name || server.client_name || server.name);
    } else if (item.type === 'workflow') {
      const workflow = item.data as WorkflowItem;
      onSelectWorkflow?.(workflow.workflow_id, workflow.name);
    } else if (item.type === 'skillpack') {
      const skillPack = item.data as SkillPackItem;
      onSelectSkillPack?.(skillPack.skill_pack_id, skillPack.name);
    } else if (item.type === 'crawler') {
      const cacheItem = item.data as CrawlerCacheItem;
      onSelectCrawler?.(cacheItem.url);
    }
    
    onClose();
  };
  
  // 处理爬取新URL
  const handleCrawlUrl = async () => {
    if (!crawlerUrl.trim()) return;
    
    // 验证URL格式
    try {
      new URL(crawlerUrl);
    } catch {
      alert('请输入有效的URL地址');
      return;
    }
    
    setIsCrawling(true);
    try {
      if (onCrawlUrl) {
        await onCrawlUrl(crawlerUrl.trim());
      }
      setShowCrawlerDialog(false);
      setCrawlerUrl('');
      onClose();
    } catch (error) {
      console.error('[AtSelector] Failed to crawl URL:', error);
      alert(`爬取失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsCrawling(false);
    }
  };
  
  // 键盘事件处理（由父组件处理，这里不需要）
  // 注意：键盘导航由父组件通过selectedIndex prop控制
  
  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);
  
  const style: React.CSSProperties = {
    position: 'fixed',
    left: `${position.left}px`,
    ...(position.top !== undefined ? { top: `${position.top}px` } : {}),
    ...(position.bottom !== undefined ? { bottom: `${position.bottom}px` } : {}),
    maxHeight: position.maxHeight ? `${position.maxHeight}px` : '256px',
    zIndex: 10000, // 确保在最上层
  };
  
  const selectorNode = (
    <div
      ref={selectorRef}
      className={`bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#404040] rounded-lg shadow-xl overflow-hidden ${className}`}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="p-2 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-700 dark:text-[#ffffff]">
          @ 选择组件
        </div>
        <button
          onClick={onClose}
          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      
      <div className="overflow-y-auto" style={{ maxHeight: position.maxHeight ? `${position.maxHeight - 60}px` : '196px' }}>
          {/* MCP 服务器 */}
          {filteredMcpServers.length > 0 && (
            <div className="py-1">
              <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5 flex items-center justify-between">
                <span>MCP 服务器</span>
                <span className="text-[10px]">
                  ({connectedMcpServerIds.size}/{mcpServers.length}已连接)
                </span>
              </div>
              {filteredMcpServers.map((server) => {
                const isConnected = connectedMcpServerIds.has(server.id);
                const isConnecting = connectingMcpServerIds.has(server.id);
                const item = allItems.find(i => i.type === 'mcp' && i.id === server.id);
                const isSelected = item && allItems.indexOf(item) === selectedIndex;
                
                return (
                  <div
                    key={server.id}
                    onClick={async () => {
                      if (isConnecting) return;
                      if (!isConnected && onConnectMCP) {
                        await onConnectMCP(server.id);
                      }
                      if (item) handleSelect(item);
                    }}
                    className={`px-3 py-2 cursor-pointer flex items-center space-x-2 ${
                      isConnecting
                        ? 'opacity-70 cursor-wait'
                        : isSelected
                          ? 'bg-primary-100 dark:bg-primary-900/30'
                          : !isConnected
                            ? 'hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                            : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="relative">
                      {isConnecting ? (
                        <Loader className="w-4 h-4 text-primary-500 animate-spin" />
                      ) : (
                        <>
                          <Plug className={`w-4 h-4 flex-shrink-0 ${isConnected ? 'text-primary-500' : 'text-gray-400'}`} />
                          {isConnected && (
                            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                          )}
                        </>
                      )}
                    </div>
                    <span className={`text-sm flex-1 ${isConnected ? 'text-gray-900 dark:text-[#ffffff]' : 'text-gray-600 dark:text-gray-400'}`}>
                      {server.display_name || server.client_name || server.name}
                    </span>
                    {!isConnected && !isConnecting && (
                      <span className="text-[10px] text-yellow-600 dark:text-yellow-400">点击连接</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          
          {/* 工作流 */}
          {filteredWorkflows.length > 0 && (
            <div className="py-1">
              <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5">
                工作流
              </div>
              {filteredWorkflows.map((workflow) => {
                const item = allItems.find(i => i.type === 'workflow' && i.id === workflow.workflow_id);
                const isSelected = item && allItems.indexOf(item) === selectedIndex;
                
                return (
                  <div
                    key={workflow.workflow_id}
                    onClick={() => item && handleSelect(item)}
                    className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                      isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : ''
                    }`}
                  >
                    <WorkflowIcon className="w-4 h-4 text-primary-500 flex-shrink-0" />
                    <span className="text-sm text-gray-900 dark:text-[#ffffff]">{workflow.name}</span>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* 技能包 */}
          {filteredSkillPacks.length > 0 && (
            <div className="py-1">
              <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5">
                技能包
              </div>
              {filteredSkillPacks.map((skillPack) => {
                const item = allItems.find(i => i.type === 'skillpack' && i.id === skillPack.skill_pack_id);
                const isSelected = item && allItems.indexOf(item) === selectedIndex;
                
                return (
                  <div
                    key={skillPack.skill_pack_id}
                    onClick={() => item && handleSelect(item)}
                    className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                      isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : ''
                    }`}
                  >
                    <Package className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <span className="text-sm text-gray-900 dark:text-[#ffffff]">{skillPack.name}</span>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* 爬虫缓存 */}
          {filteredCrawlerCache.length > 0 && (
            <div className="py-1">
              <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5">
                已爬取的网页
              </div>
              {filteredCrawlerCache.map((item) => {
                const cacheItem = allItems.find(i => i.type === 'crawler' && i.id === item.url);
                const isSelected = cacheItem && allItems.indexOf(cacheItem) === selectedIndex;
                
                return (
                  <div
                    key={item.url}
                    onClick={() => cacheItem && handleSelect(cacheItem)}
                    className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                      isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : ''
                    }`}
                  >
                    <Globe className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 dark:text-[#ffffff] truncate">
                        {item.title || item.url}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                        {item.url}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* 新建爬虫选项 */}
          {allItems.some(i => i.type === 'crawler-new') && (
            <div className="py-1">
              {filteredCrawlerCache.length > 0 && (
                <div className="text-xs font-medium text-gray-500 dark:text-[#b0b0b0] px-3 py-1.5">
                  新建
                </div>
              )}
              {allItems
                .filter(i => i.type === 'crawler-new')
                .map((item) => {
                  const isSelected = allItems.indexOf(item) === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className={`px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer flex items-center space-x-2 ${
                        isSelected ? 'bg-primary-100 dark:bg-primary-900/30' : ''
                      }`}
                    >
                      <Globe className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span className="text-sm text-gray-900 dark:text-[#ffffff]">{item.name}</span>
                    </div>
                  );
                })}
            </div>
          )}
          
          {/* 空状态 */}
          {allItems.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
              无匹配项
            </div>
          )}
      </div>
    </div>
  );

  return (
    <>
      {typeof document !== 'undefined' ? createPortal(selectorNode, document.body) : selectorNode}
      
      {/* 爬虫对话框 */}
      <Dialog open={showCrawlerDialog} onOpenChange={setShowCrawlerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>爬取网页</DialogTitle>
            <DialogDescription>
              输入要爬取的网页URL，系统会自动爬取并缓存内容
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">网页URL</label>
              <Input
                value={crawlerUrl}
                onChange={(e) => setCrawlerUrl(e.target.value)}
                placeholder="https://example.com"
                disabled={isCrawling}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isCrawling) {
                    handleCrawlUrl();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setShowCrawlerDialog(false);
                setCrawlerUrl('');
              }}
              disabled={isCrawling}
            >
              取消
            </Button>
            <Button
              variant="primary"
              onClick={handleCrawlUrl}
              disabled={!crawlerUrl.trim() || isCrawling}
            >
              {isCrawling ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                  爬取中...
                </>
              ) : (
                '开始爬取'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AtSelector;

