/**
 * LLM配置组件 - 紧凑版
 * 用于配置和管理LLM API设置，保存到MySQL数据库
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Plus, Trash2, CheckCircle, XCircle, Edit2, Brain, Save, X, Loader2, Eye, EyeOff, Type, Image as ImageIcon, Video, Music, Download, Upload, ChevronDown, ChevronRight, Camera } from 'lucide-react';
import { 
  getLLMConfigs, createLLMConfig, updateLLMConfig, deleteLLMConfig, getLLMConfigApiKey, 
  LLMConfigFromDB, CreateLLMConfigRequest,
  downloadLLMConfigAsJson, downloadAllLLMConfigsAsJson, importLLMConfigsFromFile, importLLMConfigs
} from '../services/llmApi';
import { fetchOllamaModels } from '../services/ollamaService';
import PageLayout, { Card, EmptyState } from './ui/PageLayout';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { InputField, TextareaField, FormFieldGroup } from './ui/FormField';
import { toast } from './ui/use-toast';
import { Checkbox } from './ui/Checkbox';
import { Switch } from './ui/Switch';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from './ui/Select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';

// Provider display info
const PROVIDER_INFO: Record<string, { name: string; color: string; icon: string }> = {
  openai: { name: 'OpenAI', color: '#10A37F', icon: '🤖' },
  anthropic: { name: 'Anthropic (Claude)', color: '#D4A574', icon: '🧠' },
  gemini: { name: 'Google Gemini', color: '#4285F4', icon: '✨' },
  ollama: { name: 'Ollama', color: '#1D4ED8', icon: '🦙' },
  local: { name: '本地模型', color: '#6B7280', icon: '💻' },
  custom: { name: '自定义', color: '#8B5CF6', icon: '⚙️' },
};

// Helper to convert file to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

const LLMConfigPanel: React.FC = () => {
  const [configs, setConfigs] = useState<LLMConfigFromDB[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LLMConfigFromDB | null>(null);
  const [newConfig, setNewConfig] = useState<CreateLLMConfigRequest>({
    name: '',
    provider: 'openai',
    api_key: '',
    api_url: '',
    model: '',
    enabled: true,
    tags: [],
    description: '',
  });
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [isLoadingOllamaModels, setIsLoadingOllamaModels] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false); // 控制API密钥显示/隐藏
  const [loadingApiKey, setLoadingApiKey] = useState(false); // 加载API密钥状态
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set()); // 展开的供应商
  const logoInputRef = useRef<HTMLInputElement>(null); // Logo 上传输入框引用

  // Handle logo upload
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    // Validate file size (max 500KB)
    if (file.size > 500 * 1024) {
      alert('图片大小不能超过 500KB');
      return;
    }

    try {
      const base64 = await fileToBase64(file);
      setNewConfig(prev => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          providerLogo: base64,
        },
      }));
    } catch (error) {
      console.error('Failed to convert image:', error);
      alert('图片处理失败');
    }
  };

  // Remove logo
  const handleRemoveLogo = () => {
    setNewConfig(prev => ({
      ...prev,
      metadata: {
        ...prev.metadata,
        providerLogo: undefined,
      },
    }));
    if (logoInputRef.current) {
      logoInputRef.current.value = '';
    }
  };

  // Get provider logo (custom or default)
  const getProviderLogo = (config: LLMConfigFromDB) => {
    const customLogo = config.metadata?.providerLogo;
    if (customLogo) {
      return (
        <img 
          src={customLogo} 
          alt={config.provider} 
          className="w-full h-full object-cover rounded"
        />
      );
    }
    const info = PROVIDER_INFO[config.provider.toLowerCase()] || { icon: '📦', color: '#6B7280' };
    return (
      <span className="text-sm">{info.icon}</span>
    );
  };

  // Get provider logo for group header (uses first config with custom logo, or default)
  const getProviderGroupLogo = (provider: string, configs: LLMConfigFromDB[]) => {
    // Find first config with custom logo
    const configWithLogo = configs.find(c => c.metadata?.providerLogo);
    if (configWithLogo?.metadata?.providerLogo) {
      return (
        <img 
          src={configWithLogo.metadata.providerLogo} 
          alt={provider} 
          className="w-full h-full object-cover rounded-lg"
        />
      );
    }
    const info = PROVIDER_INFO[provider] || { icon: '📦', color: '#6B7280' };
    return (
      <span className="text-lg">{info.icon}</span>
    );
  };

  // Group configs by provider
  const configsByProvider = useMemo(() => {
    const grouped: Record<string, LLMConfigFromDB[]> = {};
    configs.forEach(config => {
      const provider = config.provider.toLowerCase();
      if (!grouped[provider]) {
        grouped[provider] = [];
      }
      grouped[provider].push(config);
    });
    return grouped;
  }, [configs]);

  // Get sorted provider keys
  const providerKeys = useMemo(() => {
    return Object.keys(configsByProvider).sort((a, b) => {
      // Sort by number of configs (descending), then alphabetically
      const countDiff = configsByProvider[b].length - configsByProvider[a].length;
      if (countDiff !== 0) return countDiff;
      return a.localeCompare(b);
    });
  }, [configsByProvider]);

  // Toggle provider expansion
  const toggleProvider = (provider: string) => {
    setExpandedProviders(prev => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  };

  // Expand all providers
  const expandAllProviders = () => {
    setExpandedProviders(new Set(providerKeys));
  };

  // Collapse all providers
  const collapseAllProviders = () => {
    setExpandedProviders(new Set());
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      setIsLoading(true);
      const data = await getLLMConfigs();
      setConfigs(data);
      // Expand all providers by default
      const providers = new Set(data.map(c => c.provider.toLowerCase()));
      setExpandedProviders(providers);
    } catch (error) {
      console.error('Failed to load LLM configs:', error);
      toast({
        title: '加载配置失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 获取 Ollama 模型列表
  const loadOllamaModels = useCallback(async (serverUrl: string) => {
    if (!serverUrl || !serverUrl.trim()) {
      setOllamaModels([]);
      setOllamaError(null);
      return;
    }

    setIsLoadingOllamaModels(true);
    setOllamaError(null);

    try {
      const models = await fetchOllamaModels(serverUrl.trim());
      setOllamaModels(models);
      // 如果当前没有选择模型，且模型列表不为空，自动选择第一个
      setNewConfig(prev => {
        if (!prev.model && models.length > 0) {
          return { ...prev, model: models[0] };
        }
        return prev;
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setOllamaError(errorMessage);
      setOllamaModels([]);
      console.error('Failed to fetch Ollama models:', error);
    } finally {
      setIsLoadingOllamaModels(false);
    }
  }, []);

  // 当 Ollama 服务器地址改变时，自动获取模型列表
  useEffect(() => {
    if (newConfig.provider === 'ollama' && newConfig.api_url) {
      // 使用防抖，避免频繁请求
      const timer = setTimeout(() => {
        loadOllamaModels(newConfig.api_url || '');
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setOllamaModels([]);
      setOllamaError(null);
    }
  }, [newConfig.provider, newConfig.api_url, loadOllamaModels]);

  const handleAddConfig = async () => {
    // Ollama 不需要 API key，其他提供商需要
    const requiresApiKey = newConfig.provider !== 'ollama';
    if (!newConfig.name || (requiresApiKey && !newConfig.api_key)) {
      toast({
        title: requiresApiKey ? '请填写配置名称和 API 密钥' : '请填写配置名称',
        variant: 'destructive',
      });
      return;
    }

    try {
      await createLLMConfig(newConfig);
      await loadConfigs();
      
      // 重置表单
    setNewConfig({
        name: '',
      provider: 'openai',
        api_key: '',
        api_url: '',
        model: '',
      enabled: true,
        tags: [],
        description: '',
        metadata: {},
    });
    setIsAdding(false);
    } catch (error) {
      console.error('Failed to add config:', error);
      toast({
        title: '添加配置失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleUpdateConfig = async () => {
    // 编辑时：Ollama 不需要 API key，其他提供商在新建时需要，但编辑时可以不填写（留空则不更新）
    if (!editingId || !newConfig.name) {
      toast({ title: '请填写配置名称', variant: 'destructive' });
      return;
    }

    // 构建更新数据，如果api_key为空字符串，则不包含在更新数据中（后端会保留原有值）
    const updateData: Partial<CreateLLMConfigRequest> = {
      name: newConfig.name,
      provider: newConfig.provider,
      api_url: newConfig.api_url,
      model: newConfig.model,
      enabled: newConfig.enabled,
      tags: newConfig.tags,
      description: newConfig.description,
      metadata: newConfig.metadata,
    };
    
    // 只有在非Ollama且提供了api_key时才更新api_key
    if (newConfig.provider !== 'ollama' && newConfig.api_key && newConfig.api_key.trim() !== '') {
      updateData.api_key = newConfig.api_key;
    }

    try {
      await updateLLMConfig(editingId, updateData);
      await loadConfigs();
    
      // 重置表单
    setNewConfig({
        name: '',
      provider: 'openai',
        api_key: '',
        api_url: '',
        model: '',
      enabled: true,
        tags: [],
        description: '',
        metadata: {},
    });
    setIsAdding(false);
    setEditingId(null);
    } catch (error) {
      console.error('Failed to update config:', error);
      toast({
        title: '更新配置失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleDeleteConfig = async (configId: string) => {
    try {
      await deleteLLMConfig(configId);
      await loadConfigs();
    } catch (error) {
      console.error('Failed to delete config:', error);
      toast({
        title: '删除配置失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleEditConfig = async (config: LLMConfigFromDB) => {
    setNewConfig({
      name: config.name,
      provider: config.provider,
      api_key: '', // 初始为空，用户可以通过点击眼睛图标查看
      api_url: config.api_url,
      model: config.model,
      enabled: config.enabled,
      tags: config.tags || [],
      description: config.description,
      metadata: config.metadata || {},
    });
    setEditingId(config.config_id);
      setIsAdding(true);
    setShowApiKey(false); // 重置显示状态
  };

  // 加载并显示API密钥
  const handleLoadApiKey = async () => {
    if (!editingId) return;
    
    if (showApiKey) {
      // 如果已经显示，则隐藏
      setShowApiKey(false);
      setNewConfig(prev => ({ ...prev, api_key: '' }));
      return;
    }
    
    // 加载API密钥
    setLoadingApiKey(true);
    try {
      const apiKey = await getLLMConfigApiKey(editingId);
      setNewConfig(prev => ({ ...prev, api_key: apiKey }));
      setShowApiKey(true);
    } catch (error) {
      console.error('Failed to load API key:', error);
      alert(`加载API密钥失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoadingApiKey(false);
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setShowApiKey(false);
    setNewConfig({
      name: '',
      provider: 'openai',
      api_key: '',
      api_url: '',
      model: '',
      enabled: true,
      tags: [],
      description: '',
      metadata: {},
    });
  };

  // 导出单个配置
  const handleExportConfig = async (config: LLMConfigFromDB) => {
    try {
      await downloadLLMConfigAsJson(config.config_id, config.name);
    } catch (error) {
      console.error('Failed to export config:', error);
      alert(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 导出所有配置
  const handleExportAllConfigs = async () => {
    try {
      await downloadAllLLMConfigsAsJson();
    } catch (error) {
      console.error('Failed to export all configs:', error);
      alert(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 导入配置
  const handleImportConfigs = async () => {
    try {
      const data = await importLLMConfigsFromFile();
      
      // 询问处理方式
      const skipExisting = confirm(
        '检测到配置文件。\n\n' +
        '点击"确定"：跳过已存在的同名配置\n' +
        '点击"取消"：创建新配置（添加后缀）'
      );
      
      const result = await importLLMConfigs(data, skipExisting);
      
      let message = `成功导入 ${result.imported.length} 个配置`;
      if (result.skipped.length > 0) {
        message += `\n跳过 ${result.skipped.length} 个已存在的配置`;
      }
      alert(message);
      
      // 刷新列表
      await loadConfigs();
    } catch (error) {
      console.error('Failed to import configs:', error);
      alert(`导入失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const getProviderPlaceholder = (provider: string) => {
    switch (provider) {
      case 'openai':
        return 'sk-...';
      case 'anthropic':
        return 'sk-ant-...';
      case 'gemini':
        return 'AIza...';
      case 'ollama':
        return 'Ollama 不需要 API 密钥（可选）';
      default:
        return 'API密钥';
    }
  };

  const getProviderDefaultUrl = (provider: string) => {
    switch (provider) {
      case 'openai':
        return 'https://api.openai.com/v1/chat/completions';
      case 'anthropic':
        return 'https://api.anthropic.com/v1/messages';
      case 'gemini':
        return 'https://generativelanguage.googleapis.com/v1beta';
      case 'ollama':
        return 'http://localhost:11434';
      default:
        return '';
    }
  };

  const getProviderDefaultModel = (provider: string) => {
    switch (provider) {
      case 'openai':
        return 'gpt-4';
      case 'anthropic':
        return 'claude-3-5-sonnet-20241022';
      case 'gemini':
        return 'gemini-2.5-flash';
      case 'ollama':
        return '';
      default:
        return '';
    }
  };

  const getProviderUrlPlaceholder = (provider: string) => {
    switch (provider) {
      case 'openai':
        return 'https://api.openai.com/v1/chat/completions 或 https://api.deepseek.com';
      case 'anthropic':
        return 'https://api.anthropic.com/v1/messages';
      case 'gemini':
        return 'https://generativelanguage.googleapis.com/v1beta';
      case 'ollama':
        return 'http://10.104.4.16:11434 或 http://localhost:11434';
      default:
        return '例如: https://api.example.com/v1/chat/completions';
    }
  };

  if (isLoading) {
    return (
      <PageLayout
        title="LLM 模型配置"
        description="管理您的大语言模型 API 配置"
        icon={Brain}
      >
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-[#7c3aed] rounded-full animate-spin" />
          <span className="ml-3 text-gray-500 dark:text-gray-400">加载中...</span>
        </div>
      </PageLayout>
    );
  }

  const headerActions = !isAdding ? (
    <div className="flex items-center space-x-2">
      {/* 导入按钮 */}
      <Button
        onClick={handleImportConfigs}
        variant="ghost"
        size="sm"
        className="text-sm"
        title="导入配置"
      >
        <Upload className="w-4 h-4" />
        <span>导入</span>
      </Button>
      
      {/* 导出全部按钮 */}
      <Button
        onClick={handleExportAllConfigs}
        variant="ghost"
        size="sm"
        className="text-sm"
        title="导出所有配置"
      >
        <Download className="w-4 h-4" />
        <span>导出全部</span>
      </Button>
      
      <div className="w-px h-6 bg-gray-200 dark:bg-[#404040]" />
      
      {/* 添加模型按钮 */}
      <Button
        onClick={() => {
          setIsAdding(true);
          setEditingId(null);
          setNewConfig({
            name: '',
            provider: 'openai',
            api_key: '',
            api_url: '',
            model: '',
            enabled: true,
            tags: [],
            description: '',
            metadata: {},
          });
        }}
        variant="primary"
      >
        <Plus className="w-4 h-4" />
        <span>添加模型</span>
      </Button>
    </div>
  ) : null;

  return (
    <PageLayout
      title="LLM 模型配置"
      description="管理您的大语言模型 API 配置"
      icon={Brain}
      headerActions={headerActions}
    >
      <div className="space-y-4">

      {/* 紧凑的添加/编辑表单 */}
      {isAdding && (
        <Card 
          title={editingId ? '编辑模型配置' : '添加新模型'}
          headerAction={
            <Button onClick={handleCancel} variant="ghost" size="icon">
              <X className="w-5 h-5" />
            </Button>
          }
        >
          
          <FormFieldGroup spacing="compact">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* 配置名称 */}
              <InputField
                label="配置名称"
                required
                inputProps={{
                  id: "config-name",
                  type: "text",
                  value: newConfig.name || '',
                  onChange: (e) => setNewConfig({ ...newConfig, name: e.target.value }),
                  placeholder: "例如: OpenAI GPT-4",
                }}
              />

            {/* 提供商 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                提供商 *
              </label>
              <Select
                value={newConfig.provider || 'openai'}
                onValueChange={(value) => {
                  const provider =
                    value as CreateLLMConfigRequest['provider'];
                  setNewConfig({
                    ...newConfig,
                    provider,
                    api_url: getProviderDefaultUrl(provider),
                    model: getProviderDefaultModel(provider),
                    api_key: provider === 'ollama' ? '' : newConfig.api_key,
                  });
                }}
              >
                <SelectTrigger className="input-field">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const provider = (newConfig.provider || 'openai').toLowerCase();
                      switch (provider) {
                        case 'openai':
                          return <Brain className="w-4 h-4 text-[#10A37F]" />;
                        case 'anthropic':
                          return <Brain className="w-4 h-4 text-[#D4A574]" />;
                        case 'gemini':
                          return <Brain className="w-4 h-4 text-[#4285F4]" />;
                        case 'ollama':
                          return <Brain className="w-4 h-4 text-[#1D4ED8]" />;
                        default:
                          return <Brain className="w-4 h-4 text-gray-400" />;
                      }
                    })()}
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                  <SelectItem value="gemini">Google Gemini</SelectItem>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="local">本地模型</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 供应商 Logo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                供应商 Logo <span className="text-xs text-gray-500 font-normal">(可选，≤500KB)</span>
              </label>
              <div className="flex items-center space-x-3">
                {/* Logo 预览 */}
                <div 
                  className="w-12 h-12 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-[#363636]"
                  style={{ 
                    backgroundColor: newConfig.metadata?.providerLogo 
                      ? 'transparent' 
                      : PROVIDER_INFO[newConfig.provider || 'openai']?.color || '#6B7280'
                  }}
                >
                  {newConfig.metadata?.providerLogo ? (
                    <img 
                      src={newConfig.metadata.providerLogo} 
                      alt="Provider logo" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xl text-white">
                      {PROVIDER_INFO[newConfig.provider || 'openai']?.icon || '📦'}
                    </span>
                  )}
                </div>
                
                {/* 上传/移除按钮 */}
                <div className="flex flex-col space-y-1">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                    id="logo-upload"
                  />
                  <label
                    htmlFor="logo-upload"
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-[#404040] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] rounded-lg cursor-pointer transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>上传 Logo</span>
                  </label>
                  {newConfig.metadata?.providerLogo && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>移除</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* API密钥 */}
            {newConfig.provider !== 'ollama' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API密钥 {!editingId && <span className="text-red-500">*</span>} {editingId && <span className="text-xs text-gray-500">(留空则不更新)</span>}
                </label>
                <div className="relative">
                <input
                    type={showApiKey ? 'text' : 'password'}
                  value={newConfig.api_key || ''}
                  onChange={(e) => setNewConfig({ ...newConfig, api_key: e.target.value })}
                    className="input-field pr-10"
                    placeholder={editingId ? '点击右侧眼睛图标查看或留空不更新' : getProviderPlaceholder(newConfig.provider || 'openai')}
                    readOnly={editingId !== null && !showApiKey && !newConfig.api_key}
                  />
                  {editingId && (
                    <button
                      type="button"
                      onClick={handleLoadApiKey}
                      disabled={loadingApiKey}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
                      title={showApiKey ? '隐藏API密钥' : '显示API密钥'}
                    >
                      {loadingApiKey ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : showApiKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 模型名称 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                模型名称 {newConfig.provider === 'ollama' && <span className="text-xs text-gray-500">(从服务器自动获取)</span>}
              </label>
              {newConfig.provider === 'ollama' ? (
                <div>
                  <Select
                    value={newConfig.model || ''}
                    onValueChange={(value) =>
                      setNewConfig({ ...newConfig, model: value })
                    }
                  >
                    <SelectTrigger
                      className="input-field"
                      disabled={isLoadingOllamaModels || ollamaModels.length === 0}
                    >
                      <SelectValue
                        placeholder={
                          isLoadingOllamaModels
                            ? '正在加载模型列表...'
                            : ollamaModels.length === 0
                            ? '请先输入服务器地址'
                            : '请选择模型'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {ollamaModels.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isLoadingOllamaModels && (
                    <div className="flex items-center space-x-2 mt-1 text-xs text-gray-500">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>正在获取模型列表...</span>
                    </div>
                  )}
                  {ollamaError && (
                    <div className="mt-1 text-xs text-red-600">
                      {ollamaError}
                    </div>
                  )}
                  {!isLoadingOllamaModels && !ollamaError && ollamaModels.length > 0 && (
                    <div className="mt-1 text-xs text-green-600">
                      已找到 {ollamaModels.length} 个模型
                    </div>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={newConfig.model || ''}
                  onChange={(e) => setNewConfig({ ...newConfig, model: e.target.value })}
                  className="input-field"
                  placeholder={getProviderDefaultModel(newConfig.provider || 'openai')}
                />
              )}
            </div>

            {/* API URL */}
            {(newConfig.provider === 'local' || newConfig.provider === 'custom' || newConfig.provider === 'openai' || newConfig.provider === 'gemini' || newConfig.provider === 'ollama') && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {newConfig.provider === 'ollama' ? 'Ollama 服务器地址' : 'API URL'}
                  <span className="text-gray-500 text-xs font-normal ml-1">
                    {newConfig.provider === 'ollama' ? '*' : '(可选，覆盖默认地址)'}
                  </span>
                </label>
                <input
                  type="text"
                  value={newConfig.api_url || ''}
                  onChange={(e) => setNewConfig({ ...newConfig, api_url: e.target.value, model: '' })}
                  className="input-field"
                  placeholder={getProviderUrlPlaceholder(newConfig.provider || 'openai')}
                />
                <p className="text-xs text-gray-500 mt-1">
                  {newConfig.provider === 'ollama' ? (
                    <>
                      默认: {getProviderDefaultUrl('ollama')}
                      <span className="block mt-1">
                        💡 提示：输入服务器地址后，系统会自动获取可用模型列表。系统会自动添加路径 /api/chat
                      </span>
                      <span className="block mt-1 text-green-600">
                        ✅ Ollama 模型不需要 API 密钥，可以直接使用
                      </span>
                    </>
                  ) : (
                    <>
                      默认: {getProviderDefaultUrl(newConfig.provider || 'openai')}
                      {newConfig.provider === 'openai' && (
                        <span className="block mt-1">
                          💡 提示：OpenAI兼容的API（如DeepSeek），可以只输入host（如 https://api.deepseek.com），系统会自动添加路径 /v1/chat/completions
                        </span>
                      )}
                    </>
                  )}
                </p>
              </div>
            )}

            {/* 描述 */}
            <TextareaField
              label="描述（可选）"
              textareaProps={{
                id: "config-description",
                value: newConfig.description || '',
                onChange: (e) => setNewConfig({ ...newConfig, description: e.target.value }),
                rows: 2,
                placeholder: "模型描述...",
              }}
              className="md:col-span-2"
            />

            {/* Thinking 模式配置 */}
            <div className="md:col-span-2 flex items-center space-x-2">
              <Switch
                id="enableThinking"
                checked={newConfig.metadata?.enableThinking ?? false}
                onCheckedChange={(checked) => {
                  setNewConfig({
                    ...newConfig,
                    metadata: {
                      ...newConfig.metadata,
                      enableThinking: checked,
                    },
                  });
                }}
              />
              <label
                htmlFor="enableThinking"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                启用 Thinking 模式（深度思考）
              </label>
              <span className="text-xs text-gray-500">
                （一旦启用，聊天中不允许切换模式。用户可灵活测试后确认）
              </span>
            </div>

            {/* 支持的输入类型 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                支持的输入类型
              </label>
              <div className="flex flex-wrap gap-3">
                {(['text', 'image', 'video', 'audio'] as const).map((type) => {
                  const supportedInputs = newConfig.metadata?.supportedInputs || [];
                  const isChecked = supportedInputs.includes(type);
                  const icons = {
                    text: Type,
                    image: ImageIcon,
                    video: Video,
                    audio: Music,
                  };
                  const labels = {
                    text: '文字',
                    image: '图片',
                    video: '视频',
                    audio: '音频',
                  };
                  const Icon = icons[type];
                  
                  return (
                    <label key={type} className="flex items-center space-x-1.5 cursor-pointer">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          const nextChecked = checked === true;
                          const current = newConfig.metadata?.supportedInputs || [];
                          const updated = nextChecked
                            ? [...current, type]
                            : current.filter((t: string) => t !== type);
                          setNewConfig({
                            ...newConfig,
                            metadata: {
                              ...newConfig.metadata,
                              supportedInputs: updated,
                            },
                          });
                        }}
                      />
                      <Icon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{labels[type]}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 支持的输出类型 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                支持的输出类型
              </label>
              <div className="flex flex-wrap gap-3">
                {(['text', 'image', 'video', 'audio'] as const).map((type) => {
                  const supportedOutputs = newConfig.metadata?.supportedOutputs || [];
                  const isChecked = supportedOutputs.includes(type);
                  const icons = {
                    text: Type,
                    image: ImageIcon,
                    video: Video,
                    audio: Music,
                  };
                  const labels = {
                    text: '文字',
                    image: '图片',
                    video: '视频',
                    audio: '音频',
                  };
                  const Icon = icons[type];
                  
                  return (
                    <label key={type} className="flex items-center space-x-1.5 cursor-pointer">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          const nextChecked = checked === true;
                          const current = newConfig.metadata?.supportedOutputs || [];
                          const updated = nextChecked
                            ? [...current, type]
                            : current.filter((t: string) => t !== type);
                          setNewConfig({
                            ...newConfig,
                            metadata: {
                              ...newConfig.metadata,
                              supportedOutputs: updated,
                            },
                          });
                        }}
                      />
                      <Icon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{labels[type]}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 启用状态 */}
            <div className="md:col-span-2 flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={newConfig.enabled ?? true}
                onCheckedChange={(checked) =>
                  setNewConfig({ ...newConfig, enabled: checked })
                }
              />
              <label
                htmlFor="enabled"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                启用此配置
              </label>
            </div>
            </div>
          </FormFieldGroup>

          {/* 操作按钮 */}
          <div className="flex space-x-2 mt-4 pt-4 border-t border-gray-200 dark:border-[#404040]">
              <Button
                onClick={editingId ? handleUpdateConfig : handleAddConfig}
                variant="primary"
              >
                <Save className="w-4 h-4" />
                <span>{editingId ? '保存' : '添加'}</span>
              </Button>
              <Button
                onClick={handleCancel}
                variant="secondary"
              >
                取消
              </Button>
          </div>
        </Card>
      )}

      {/* 按供应商分组显示 */}
      {configs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Brain}
            title="暂无LLM配置"
            description="点击「添加模型」按钮来添加配置"
            action={
              <Button
                onClick={() => setIsAdding(true)}
                variant="primary"
              >
                <Plus className="w-4 h-4" />
                <span>添加模型</span>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* 展开/折叠全部按钮 */}
          <div className="flex items-center justify-end space-x-2 mb-2">
            <button
              onClick={expandAllProviders}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              展开全部
            </button>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button
              onClick={collapseAllProviders}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              折叠全部
            </button>
          </div>

          {/* 按供应商分组 */}
          <div className="space-y-3">
            {providerKeys.map(provider => {
              const providerConfigs = configsByProvider[provider];
              const isExpanded = expandedProviders.has(provider);
              const info = PROVIDER_INFO[provider] || { name: provider, color: '#6B7280', icon: '📦' };
              const enabledCount = providerConfigs.filter(c => c.enabled).length;

              return (
                <div 
                  key={provider}
                  className="rounded-xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2d2d2d] overflow-hidden shadow-sm"
                >
                  {/* 供应商头部 */}
                  <button
                    onClick={() => toggleProvider(provider)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-[#363636] transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      {/* 展开/折叠图标 */}
                      <div className="text-gray-400 dark:text-gray-500">
                        {isExpanded ? (
                          <ChevronDown className="w-5 h-5" />
                        ) : (
                          <ChevronRight className="w-5 h-5" />
                        )}
                      </div>
                      {/* 供应商图标和名称 */}
                      <div 
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-lg overflow-hidden"
                        style={{ backgroundColor: providerConfigs.some(c => c.metadata?.providerLogo) ? 'transparent' : info.color }}
                      >
                        {getProviderGroupLogo(provider, providerConfigs)}
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {info.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {providerConfigs.length} 个模型 · {enabledCount} 个启用
                        </div>
                      </div>
                    </div>
                    {/* 状态徽章 */}
                    <div className="flex items-center space-x-2">
                      {enabledCount > 0 && (
                        <span className="ui-badge-success">
                          {enabledCount} 启用
                        </span>
                      )}
                      {providerConfigs.length - enabledCount > 0 && (
                        <span className="px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full">
                          {providerConfigs.length - enabledCount} 禁用
                        </span>
                      )}
                    </div>
                  </button>

                  {/* 模型列表 */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 dark:border-[#404040]">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-[#363636]">
                            <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-4 py-2">配置名称</th>
                            <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-4 py-2">模型</th>
                            <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 px-4 py-2">状态</th>
                            <th className="text-right text-xs font-medium text-gray-500 dark:text-gray-400 px-4 py-2">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {providerConfigs.map((config, index) => (
                            <tr 
                              key={config.config_id} 
                              className={`
                                hover:bg-gray-50 dark:hover:bg-[#363636] transition-colors
                                ${index !== providerConfigs.length - 1 ? 'border-b border-gray-100 dark:border-[#404040]' : ''}
                              `}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center space-x-2.5">
                                  {/* 小 Logo 显示 */}
                                  {config.metadata?.providerLogo && (
                                    <div className="w-6 h-6 rounded flex-shrink-0 overflow-hidden border border-gray-200 dark:border-[#404040]">
                                      <img 
                                        src={config.metadata.providerLogo} 
                                        alt="" 
                                        className="w-full h-full object-cover"
                                      />
                                    </div>
                                  )}
                                  <div>
                                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                                      {config.name}
                                    </div>
                                    {config.description && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                                        {config.description}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <code className="text-xs bg-gray-100 dark:bg-[#404040] px-2 py-1 rounded text-gray-700 dark:text-gray-300">
                                  {config.model || '-'}
                                </code>
                              </td>
                              <td className="px-4 py-3">
                                {config.enabled ? (
                                  <span className="ui-model-enabled inline-flex items-center space-x-1">
                                    <CheckCircle className="w-3 h-3" />
                                    <span>已启用</span>
                                  </span>
                                ) : (
                                  <span className="ui-model-disabled inline-flex items-center space-x-1">
                                    <XCircle className="w-3 h-3" />
                                    <span>已禁用</span>
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end space-x-1">
                                  <button
                                    onClick={() => handleEditConfig(config)}
                                    className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
                                    title="编辑"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleExportConfig(config)}
                                    className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
                                    title="导出"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteTarget(config)}
                                    className="p-1.5 rounded-lg text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                    title="删除"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除模型配置"
        description={`确定要删除「${deleteTarget?.name}」吗？此操作不可撤销。`}
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const id = deleteTarget.config_id;
          setDeleteTarget(null);
          await handleDeleteConfig(id);
        }}
      />
    </PageLayout>
  );
};

export default LLMConfigPanel;
