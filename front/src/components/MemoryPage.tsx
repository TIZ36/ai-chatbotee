/**
 * Memory 管理界面
 * 管理记忆体（持久化对话记忆）
 */

import React, { useEffect, useState, useCallback } from 'react';
import { 
  Brain, Plus, Trash2, Edit2, Search, 
  MessageSquare, Calendar, RefreshCw, Save
} from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Card, Badge, EmptyState, ListItem } from './ui/PageLayout';
import { Label } from './ui/Label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { toast } from './ui/use-toast';
import { getBackendUrl } from '../services/compat/electron';

// ============================================================================
// 类型定义
// ============================================================================

interface Memory {
  session_id: string;
  title?: string;
  name?: string;
  llm_config_id?: string;
  system_prompt?: string;
  avatar?: string;
  created_at: string;
  updated_at: string;
  last_message_at?: string;
  message_count?: number;
}

interface LLMConfig {
  config_id: string;
  name: string;
  provider: string;
}

// ============================================================================
// 记忆体卡片组件
// ============================================================================

interface MemoryCardProps {
  memory: Memory;
  isSelected: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const MemoryCard: React.FC<MemoryCardProps> = ({
  memory,
  isSelected,
  onClick,
  onEdit,
  onDelete,
}) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <ListItem
      active={isSelected}
      onClick={onClick}
      className="group"
    >
      <div className="flex items-center gap-3 w-full">
        {/* 头像 */}
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
          {memory.avatar ? (
            <img 
              src={memory.avatar} 
              alt={memory.name || memory.title || '记忆体'} 
              className="w-full h-full object-cover rounded-lg"
            />
          ) : (
            <Brain className="w-5 h-5 text-white" />
          )}
        </div>
        
        {/* 信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">
              {memory.name || memory.title || '未命名记忆体'}
            </span>
            <Badge variant="info" className="text-xs">记忆体</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {memory.last_message_at && (
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {formatDate(memory.last_message_at)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {formatDate(memory.created_at)}
            </span>
          </div>
        </div>
        
        {/* 操作按钮 */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      </div>
    </ListItem>
  );
};

// ============================================================================
// 主组件
// ============================================================================

const MemoryPage: React.FC = () => {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfig[]>([]);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [backendUrl, setBackendUrlState] = useState<string>('');
  
  // 对话框状态
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  
  // 表单状态
  const [formData, setFormData] = useState({
    name: '',
    system_prompt: '',
    llm_config_id: '',
  });

  // 获取后端 URL
  useEffect(() => {
    getBackendUrl().then(setBackendUrlState);
  }, []);

  // 获取数据
  const fetchData = useCallback(async () => {
    if (!backendUrl) return;
    
    setIsLoading(true);
    
    try {
      const [memoriesRes, llmRes] = await Promise.all([
        fetch(`${backendUrl}/api/sessions/memories`),
        fetch(`${backendUrl}/api/llm/configs`),
      ]);

      if (memoriesRes.ok) {
        const data = await memoriesRes.json();
        // 兼容两种返回格式
        setMemories(Array.isArray(data) ? data : (data.memories || data.sessions || []));
      }

      if (llmRes.ok) {
        const data = await llmRes.json();
        // 兼容两种返回格式：{ configs: [...] } 或直接 [...]
        const configs = Array.isArray(data) ? data : (data.configs || []);
        setLlmConfigs(configs.filter((c: any) => c.enabled));
      }
    } catch (error) {
      console.error('[MemoryPage] Failed to fetch data:', error);
      toast({
        title: '加载失败',
        description: '无法获取记忆体列表',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => {
    if (backendUrl) {
      fetchData();
    }
  }, [backendUrl, fetchData]);

  // 创建记忆体
  const handleCreate = async () => {
    if (!backendUrl) return;
    
    try {
      const response = await fetch(`${backendUrl}/api/sessions/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name || '新记忆体',
          system_prompt: formData.system_prompt,
          llm_config_id: formData.llm_config_id || undefined,
        }),
      });

      if (response.ok) {
        toast({
          title: '创建成功',
          description: '记忆体已创建',
          variant: 'success',
        });
        setIsCreateDialogOpen(false);
        setFormData({ name: '', system_prompt: '', llm_config_id: '' });
        fetchData();
      } else {
        throw new Error('创建失败');
      }
    } catch (error) {
      toast({
        title: '创建失败',
        description: '无法创建记忆体',
        variant: 'destructive',
      });
    }
  };

  // 更新记忆体
  const handleUpdate = async () => {
    if (!backendUrl || !editingMemory) return;
    
    try {
      const response = await fetch(`${backendUrl}/api/sessions/${editingMemory.session_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          system_prompt: formData.system_prompt,
          llm_config_id: formData.llm_config_id || undefined,
        }),
      });

      if (response.ok) {
        toast({
          title: '更新成功',
          description: '记忆体已更新',
          variant: 'success',
        });
        setIsEditDialogOpen(false);
        setEditingMemory(null);
        fetchData();
      } else {
        throw new Error('更新失败');
      }
    } catch (error) {
      toast({
        title: '更新失败',
        description: '无法更新记忆体',
        variant: 'destructive',
      });
    }
  };

  // 删除记忆体
  const handleDelete = async () => {
    if (!backendUrl || !editingMemory) return;
    
    try {
      const response = await fetch(`${backendUrl}/api/sessions/${editingMemory.session_id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({
          title: '删除成功',
          description: '记忆体已删除',
          variant: 'success',
        });
        setIsDeleteDialogOpen(false);
        setEditingMemory(null);
        if (selectedMemory?.session_id === editingMemory.session_id) {
          setSelectedMemory(null);
        }
        fetchData();
      } else {
        throw new Error('删除失败');
      }
    } catch (error) {
      toast({
        title: '删除失败',
        description: '无法删除记忆体',
        variant: 'destructive',
      });
    }
  };

  // 打开编辑对话框
  const openEditDialog = (memory: Memory) => {
    setEditingMemory(memory);
    setFormData({
      name: memory.name || memory.title || '',
      system_prompt: memory.system_prompt || '',
      llm_config_id: memory.llm_config_id || '',
    });
    setIsEditDialogOpen(true);
  };

  // 打开删除对话框
  const openDeleteDialog = (memory: Memory) => {
    setEditingMemory(memory);
    setIsDeleteDialogOpen(true);
  };

  // 过滤记忆体
  const filteredMemories = memories.filter(m => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      m.name?.toLowerCase().includes(query) ||
      m.title?.toLowerCase().includes(query) ||
      m.system_prompt?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="h-full flex bg-[var(--color-bg-primary)]">
      {/* 左侧列表 */}
      <div className="w-80 border-r border-[var(--color-border)] flex flex-col">
        {/* 标题栏 */}
        <div className="p-4 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-500" />
              记忆体
            </h1>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setFormData({ name: '', system_prompt: '', llm_config_id: '' });
                setIsCreateDialogOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1" />
              新建
            </Button>
          </div>
          
          {/* 搜索 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
            <Input
              placeholder="搜索记忆体..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        
        {/* 列表 */}
        <div className="flex-1 overflow-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-text-tertiary)]" />
            </div>
          ) : filteredMemories.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="暂无记忆体"
              description="创建一个记忆体来保存对话记忆"
              action={
                <Button variant="primary" onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" />
                  创建记忆体
                </Button>
              }
            />
          ) : (
            <div className="space-y-1">
              {filteredMemories.map(memory => (
                <MemoryCard
                  key={memory.session_id}
                  memory={memory}
                  isSelected={selectedMemory?.session_id === memory.session_id}
                  onClick={() => setSelectedMemory(memory)}
                  onEdit={() => openEditDialog(memory)}
                  onDelete={() => openDeleteDialog(memory)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右侧详情 */}
      <div className="flex-1 p-6 overflow-auto">
        {selectedMemory ? (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* 头部信息 */}
            <Card>
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  {selectedMemory.avatar ? (
                    <img 
                      src={selectedMemory.avatar} 
                      alt={selectedMemory.name || '记忆体'}
                      className="w-full h-full object-cover rounded-xl"
                    />
                  ) : (
                    <Brain className="w-8 h-8 text-white" />
                  )}
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-semibold">
                    {selectedMemory.name || selectedMemory.title || '未命名记忆体'}
                  </h2>
                  <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
                    创建于 {new Date(selectedMemory.created_at).toLocaleDateString('zh-CN')}
                  </p>
                </div>
                <Button variant="outline" onClick={() => openEditDialog(selectedMemory)}>
                  <Edit2 className="w-4 h-4 mr-1" />
                  编辑
                </Button>
              </div>
            </Card>

            {/* 系统提示词 */}
            {selectedMemory.system_prompt && (
              <Card title="系统提示词">
                <p className="text-sm whitespace-pre-wrap text-[var(--color-text-secondary)]">
                  {selectedMemory.system_prompt}
                </p>
              </Card>
            )}

            {/* 配置信息 */}
            <Card title="配置">
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--color-text-secondary)]">LLM 配置</span>
                  <span>{
                    llmConfigs.find(c => c.config_id === selectedMemory.llm_config_id)?.name 
                    || '默认'
                  }</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--color-text-secondary)]">会话 ID</span>
                  <span className="font-mono text-xs">{selectedMemory.session_id}</span>
                </div>
              </div>
            </Card>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              icon={Brain}
              title="选择一个记忆体"
              description="从左侧列表选择或创建新的记忆体"
            />
          </div>
        )}
      </div>

      {/* 创建对话框 */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建记忆体</DialogTitle>
            <DialogDescription>
              记忆体用于保存对话历史和上下文，实现持久化记忆
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="name">名称</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="输入记忆体名称"
              />
            </div>
            <div>
              <Label htmlFor="llm_config">LLM 配置</Label>
              <select
                id="llm_config"
                value={formData.llm_config_id}
                onChange={(e) => setFormData(prev => ({ ...prev, llm_config_id: e.target.value }))}
                className="w-full h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-sm"
              >
                <option value="">默认配置</option>
                {llmConfigs.map(config => (
                  <option key={config.config_id} value={config.config_id}>
                    {config.name} ({config.provider})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="system_prompt">系统提示词</Label>
              <Textarea
                id="system_prompt"
                value={formData.system_prompt}
                onChange={(e) => setFormData(prev => ({ ...prev, system_prompt: e.target.value }))}
                placeholder="设置记忆体的系统提示词..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsCreateDialogOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleCreate}>
              <Save className="w-4 h-4 mr-1" />
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑记忆体</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="edit-name">名称</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="输入记忆体名称"
              />
            </div>
            <div>
              <Label htmlFor="edit-llm_config">LLM 配置</Label>
              <select
                id="edit-llm_config"
                value={formData.llm_config_id}
                onChange={(e) => setFormData(prev => ({ ...prev, llm_config_id: e.target.value }))}
                className="w-full h-9 px-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-sm"
              >
                <option value="">默认配置</option>
                {llmConfigs.map(config => (
                  <option key={config.config_id} value={config.config_id}>
                    {config.name} ({config.provider})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="edit-system_prompt">系统提示词</Label>
              <Textarea
                id="edit-system_prompt"
                value={formData.system_prompt}
                onChange={(e) => setFormData(prev => ({ ...prev, system_prompt: e.target.value }))}
                placeholder="设置记忆体的系统提示词..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsEditDialogOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleUpdate}>
              <Save className="w-4 h-4 mr-1" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="删除记忆体"
        description={`确定要删除"${editingMemory?.name || editingMemory?.title || '未命名记忆体'}"吗？此操作不可撤销，所有对话记录将被永久删除。`}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
};

export default MemoryPage;
