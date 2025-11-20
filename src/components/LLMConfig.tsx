/**
 * LLM配置组件 - 紧凑版
 * 用于配置和管理LLM API设置，保存到MySQL数据库
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, CheckCircle, XCircle, Edit2, Brain, Key, Save, X, Loader2 } from 'lucide-react';
import { getLLMConfigs, createLLMConfig, updateLLMConfig, deleteLLMConfig, LLMConfigFromDB, CreateLLMConfigRequest } from '../services/llmApi';
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
    });
    setIsAdding(false);
    } catch (error) {
      console.error('Failed to add config:', error);
      alert(`添加配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleUpdateConfig = async () => {
    // Ollama 不需要 API key，其他提供商需要
    const requiresApiKey = newConfig.provider !== 'ollama';
    if (!editingId || !newConfig.name || (requiresApiKey && !newConfig.api_key)) {
      alert(requiresApiKey ? '请填写配置名称和API密钥' : '请填写配置名称');
      return;
    }

    try {
      await updateLLMConfig(editingId, newConfig);
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

  const handleEditConfig = (config: LLMConfigFromDB) => {
    setNewConfig({
      name: config.name,
      provider: config.provider,
      api_key: '', // 不显示API密钥（安全）
      api_url: config.api_url,
      model: config.model,
      enabled: config.enabled,
      tags: config.tags || [],
      description: config.description,
    });
    setEditingId(config.config_id);
      setIsAdding(true);
  };

  const handleCancel = () => {
    setIsAdding(false);
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
    });
  };

  const getProviderPlaceholder = (provider: string) => {
    switch (provider) {
      case 'openai':
        return 'sk-...';
      case 'anthropic':
        return 'sk-ant-...';
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                提供商 *
              </label>
              <select
                value={newConfig.provider || 'openai'}
                onChange={(e) => {
                  const provider = e.target.value as CreateLLMConfigRequest['provider'];
                  setNewConfig({
                    ...newConfig,
                    provider,
                    api_url: getProviderDefaultUrl(provider),
                    model: getProviderDefaultModel(provider),
                    api_key: provider === 'ollama' ? '' : newConfig.api_key, // Ollama 清空 API key
                  });
                }}
                className="input-field"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="ollama">Ollama</option>
                <option value="local">本地模型</option>
                <option value="custom">自定义</option>
              </select>
            </div>

            {/* API密钥 */}
            {newConfig.provider !== 'ollama' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API密钥 * {editingId && <span className="text-xs text-gray-500">(留空则不更新)</span>}
                </label>
                <input
                  type="password"
                  value={newConfig.api_key || ''}
                  onChange={(e) => setNewConfig({ ...newConfig, api_key: e.target.value })}
                  className="input-field"
                  placeholder={getProviderPlaceholder(newConfig.provider || 'openai')}
                />
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
            {(newConfig.provider === 'local' || newConfig.provider === 'custom' || newConfig.provider === 'openai' || newConfig.provider === 'ollama') && (
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
          configs.map((config) => (
                  <tr key={config.config_id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-2 px-3">
                      <div className="font-medium text-gray-900">{config.name}</div>
                      {config.description && (
                        <div className="text-xs text-gray-500 mt-1">{config.description}</div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-sm text-gray-600">{config.provider}</td>
                    <td className="py-2 px-3 text-sm text-gray-600">{config.model || '-'}</td>
                    <td className="py-2 px-3">
                      {config.enabled ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
                          <CheckCircle className="w-3 h-3" />
                          <span>已启用</span>
                      </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded">
                          <XCircle className="w-3 h-3" />
                          <span>已禁用</span>
                        </span>
                  )}
                    </td>
                    <td className="py-3 px-4">
                <div className="flex items-center space-x-2">
                    <button
                          onClick={() => handleEditConfig(config)}
                          className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                    title="编辑"
                  >
                          <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                          onClick={() => handleDeleteConfig(config.config_id)}
                          className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                    title="删除"
                  >
                          <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                    </td>
                  </tr>
          ))
        )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LLMConfigPanel;
