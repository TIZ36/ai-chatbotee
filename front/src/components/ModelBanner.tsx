/**
 * 模型信息Banner组件
 * 显示当前使用的模型和流式输出状态
 */

import React from 'react';
import { Brain, Radio } from 'lucide-react';
import { LLMConfigFromDB } from '../services/llmApi';

interface ModelBannerProps {
  currentModel: LLMConfigFromDB | null;
  streamEnabled: boolean;
}

const ModelBanner: React.FC<ModelBannerProps> = ({ currentModel, streamEnabled }) => {
  if (!currentModel) {
    return null;
  }

  const getProviderColor = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'openai':
        return 'bg-[#10A37F]';
      case 'deepseek':
        return 'bg-[#5B68DF]';
      case 'anthropic':
        return 'bg-[#D4A574]';
      case 'gemini':
        return 'bg-[#4285F4]';
      case 'ollama':
        return 'bg-[#1D4ED8]';
      default:
        return 'bg-gray-500';
    }
  };

  const getProviderName = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'openai':
        return 'OpenAI';
      case 'deepseek':
        return 'DeepSeek';
      case 'anthropic':
        return 'Anthropic';
      case 'gemini':
        return 'Gemini';
      case 'ollama':
        return 'Ollama';
      default:
        return provider;
    }
  };

  return (
    <div className="h-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* 模型信息 */}
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded flex items-center justify-center ${getProviderColor(currentModel.provider)}`}>
            <Brain className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium text-gray-900 dark:text-gray-100 leading-tight">
              {currentModel.name}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
              {getProviderName(currentModel.provider)} · {currentModel.model || '未设置模型'}
            </span>
          </div>
        </div>
      </div>

      {/* 流式输出状态 */}
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md ${
          streamEnabled 
            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' 
            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
        }`}>
          <Radio className={`w-3.5 h-3.5 ${streamEnabled ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500'}`} />
          <span className="text-xs font-medium">
            {streamEnabled ? '流式输出' : '非流式'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ModelBanner;

