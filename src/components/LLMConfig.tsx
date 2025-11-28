/**
 * LLM配置组件 - 紧凑版
 * 用于配置和管理LLM API设置，保存到MySQL数据库
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, CheckCircle, XCircle, Edit2, Brain, Save, X, Loader2, Eye, EyeOff, Type, Image, Video, Music } from 'lucide-react';
import { getLLMConfigs, createLLMConfig, updateLLMConfig, deleteLLMConfig, getLLMConfigApiKey, LLMConfigFromDB, CreateLLMConfigRequest } from '../services/llmApi';
import { fetchOllamaModels } from '../services/ollamaService';

const LLMConfigPanel: React.FC = () => {
  const [configs, setConfigs] = useState<LLMConfigFromDB[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      setIsLoading(true);
      const data = await getLLMConfigs();
      setConfigs(data);
    } catch (error) {
      console.error('Failed to load LLM configs:', error);
      alert(`加载配置失败: ${error instanceof Error ? error.message : String(error)}`);
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
      alert(requiresApiKey ? '请填写配置名称和API密钥' : '请填写配置名称');
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
      alert(`添加配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleUpdateConfig = async () => {
    // 编辑时：Ollama 不需要 API key，其他提供商在新建时需要，但编辑时可以不填写（留空则不更新）
    if (!editingId || !newConfig.name) {
      alert('请填写配置名称');
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
      alert(`更新配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDeleteConfig = async (configId: string) => {
    if (!window.confirm('确定要删除此配置吗？')) {
      return;
    }

    try {
      await deleteLLMConfig(configId);
      await loadConfigs();
    } catch (error) {
      console.error('Failed to delete config:', error);
      alert(`删除配置失败: ${error instanceof Error ? error.message : String(error)}`);
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
      <div className="flex items-center justify-center py-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <Brain className="w-6 h-6 text-gray-600" />
          <h2 className="text-2xl font-semibold">LLM 模型配置</h2>
        </div>
        {!isAdding && (
        <button
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
          className="btn-primary flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
            <span>添加模型</span>
        </button>
        )}
      </div>

      {/* 紧凑的添加/编辑表单 */}
      {isAdding && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">
              {editingId ? '编辑模型配置' : '添加新模型'}
          </h3>
            <button
              onClick={handleCancel}
              className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 配置名称 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                配置名称 *
              </label>
              <input
                type="text"
                value={newConfig.name || ''}
                onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })}
                className="input-field"
                placeholder="例如: OpenAI GPT-4"
              />
            </div>

            {/* 提供商 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                提供商 *
              </label>
              <div className="relative">
                <select
                  value={newConfig.provider || 'openai'}
                  onChange={(e) => {
                    const provider = e.target.value as CreateLLMConfigRequest['provider'];
                    setNewConfig({
                      ...newConfig,
                      provider,
                      api_url: getProviderDefaultUrl(provider),
                      model: getProviderDefaultModel(provider),
                      api_key: (provider === 'ollama') ? '' : newConfig.api_key, // Ollama 清空 API key
                    });
                  }}
                  className="input-field appearance-none pr-8"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="ollama">Ollama</option>
                  <option value="local">本地模型</option>
                  <option value="custom">自定义</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
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
                </div>
              </div>
            </div>

            {/* API密钥 */}
            {newConfig.provider !== 'ollama' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                模型名称 {newConfig.provider === 'ollama' && <span className="text-xs text-gray-500">(从服务器自动获取)</span>}
              </label>
              {newConfig.provider === 'ollama' ? (
                <div>
                  <select
                    value={newConfig.model || ''}
                    onChange={(e) => setNewConfig({ ...newConfig, model: e.target.value })}
                    className="input-field"
                    disabled={isLoadingOllamaModels || ollamaModels.length === 0}
                  >
                    <option value="">{isLoadingOllamaModels ? '正在加载模型列表...' : ollamaModels.length === 0 ? '请先输入服务器地址' : '请选择模型'}</option>
                    {ollamaModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                描述（可选）
              </label>
              <textarea
                value={newConfig.description || ''}
                onChange={(e) => setNewConfig({ ...newConfig, description: e.target.value })}
                className="input-field"
                rows={2}
                placeholder="模型描述..."
              />
            </div>

            {/* Thinking 模式配置 */}
            <div className="md:col-span-2 flex items-center space-x-2">
              <input
                type="checkbox"
                id="enableThinking"
                checked={newConfig.metadata?.enableThinking ?? false}
                onChange={(e) => {
                  setNewConfig({
                    ...newConfig,
                    metadata: {
                      ...newConfig.metadata,
                      enableThinking: e.target.checked,
                    },
                  });
                }}
                className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
              />
              <label htmlFor="enableThinking" className="text-sm font-medium text-gray-700">
                启用 Thinking 模式（深度思考）
              </label>
              <span className="text-xs text-gray-500">
                （一旦启用，聊天中不允许切换模式。用户可灵活测试后确认）
              </span>
            </div>

            {/* 支持的输入类型 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                支持的输入类型
              </label>
              <div className="flex flex-wrap gap-3">
                {(['text', 'image', 'video', 'audio'] as const).map((type) => {
                  const supportedInputs = newConfig.metadata?.supportedInputs || [];
                  const isChecked = supportedInputs.includes(type);
                  const icons = {
                    text: Type,
                    image: Image,
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
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const current = newConfig.metadata?.supportedInputs || [];
                          const updated = e.target.checked
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
                        className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
                      />
                      <Icon className="w-4 h-4 text-gray-600" />
                      <span className="text-sm text-gray-700">{labels[type]}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 支持的输出类型 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                支持的输出类型
              </label>
              <div className="flex flex-wrap gap-3">
                {(['text', 'image', 'video', 'audio'] as const).map((type) => {
                  const supportedOutputs = newConfig.metadata?.supportedOutputs || [];
                  const isChecked = supportedOutputs.includes(type);
                  const icons = {
                    text: Type,
                    image: Image,
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
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const current = newConfig.metadata?.supportedOutputs || [];
                          const updated = e.target.checked
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
                        className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
                      />
                      <Icon className="w-4 h-4 text-gray-600" />
                      <span className="text-sm text-gray-700">{labels[type]}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 启用状态 */}
            <div className="md:col-span-2 flex items-center space-x-2">
              <input
                type="checkbox"
                id="enabled"
                checked={newConfig.enabled ?? true}
                onChange={(e) => setNewConfig({ ...newConfig, enabled: e.target.checked })}
                className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
              />
              <label htmlFor="enabled" className="text-sm font-medium text-gray-700">
                启用此配置
              </label>
            </div>
            </div>

          {/* 操作按钮 */}
          <div className="flex space-x-2 mt-3 pt-3 border-t border-gray-200">
              <button
                onClick={editingId ? handleUpdateConfig : handleAddConfig}
                className="btn-primary flex items-center space-x-2"
              >
              <Save className="w-4 h-4" />
              <span>{editingId ? '保存' : '添加'}</span>
              </button>
              <button
              onClick={handleCancel}
                className="btn-secondary"
              >
                取消
              </button>
          </div>
        </div>
      )}

      {/* 紧凑的配置列表表格 */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-sm font-semibold text-gray-700">名称</th>
                <th className="text-left py-2 px-3 text-sm font-semibold text-gray-700">提供商</th>
                <th className="text-left py-2 px-3 text-sm font-semibold text-gray-700">模型</th>
                <th className="text-left py-2 px-3 text-sm font-semibold text-gray-700">状态</th>
                <th className="text-left py-2 px-3 text-sm font-semibold text-gray-700">操作</th>
              </tr>
            </thead>
            <tbody>
        {configs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-4">
                    <Brain className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-600">暂无LLM配置</p>
                    <p className="text-sm text-gray-500 mt-1">点击"添加模型"按钮来添加配置</p>
                  </td>
                </tr>
        ) : (
          configs.map((config) => {
            // 获取提供商图标
            const getProviderIcon = (provider: string) => {
              switch (provider.toLowerCase()) {
                case 'openai':
                  return (
                    <div className="w-5 h-5 rounded bg-[#10A37F] flex items-center justify-center">
                      <Brain className="w-3.5 h-3.5 text-white" />
                    </div>
                  );
                case 'anthropic':
                  return (
                    <div className="w-5 h-5 rounded bg-[#D4A574] flex items-center justify-center">
                      <Brain className="w-3.5 h-3.5 text-white" />
                    </div>
                  );
                case 'gemini':
                  return (
                    <div className="w-5 h-5 rounded bg-[#4285F4] flex items-center justify-center">
                      <Brain className="w-3.5 h-3.5 text-white" />
                    </div>
                  );
                case 'ollama':
                  return (
                    <div className="w-5 h-5 rounded bg-[#1D4ED8] flex items-center justify-center">
                      <Brain className="w-3.5 h-3.5 text-white" />
                    </div>
                  );
                case 'custom':
                  return (
                    <div className="w-5 h-5 rounded bg-gray-500 flex items-center justify-center">
                      <Brain className="w-3.5 h-3.5 text-white" />
                    </div>
                  );
                default:
                  return (
                    <div className="w-5 h-5 rounded bg-gray-400 flex items-center justify-center">
                      <Brain className="w-3.5 h-3.5 text-white" />
                    </div>
                  );
              }
            };

            return (
                  <tr key={config.config_id} className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-2.5">
                        {getProviderIcon(config.provider)}
                        <div>
                          <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{config.name}</div>
                          {config.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{config.description}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-1.5">
                        {getProviderIcon(config.provider)}
                        <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">{config.provider}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="text-sm text-gray-600 dark:text-gray-400">{config.model || '-'}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      {config.enabled ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded">
                          <CheckCircle className="w-3 h-3" />
                          <span>已启用</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                          <XCircle className="w-3 h-3" />
                          <span>已禁用</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                <div className="flex items-center space-x-1.5">
                    <button
                          onClick={() => handleEditConfig(config)}
                          className="p-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    title="编辑"
                  >
                          <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                          onClick={() => handleDeleteConfig(config.config_id)}
                          className="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="删除"
                  >
                          <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                    </td>
                  </tr>
            );
          })
        )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LLMConfigPanel;
