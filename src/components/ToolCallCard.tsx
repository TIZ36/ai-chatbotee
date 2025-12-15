/**
 * 工具调用卡片组件
 * 显示工具信息并提供调用界面
 */

import React, { useState } from 'react';
import { Play, CheckCircle, XCircle, Loader } from 'lucide-react';
import { Button } from './ui/Button';
import { MCPTool } from '../services/mcpClient';
import { truncateBase64Strings } from '../utils/textUtils';

interface ToolCallCardProps {
  serverId: string;
  tool: MCPTool;
  onCall: (serverId: string, toolName: string, args: any) => void;
  isLoading: boolean;
  result?: any;
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({
  serverId,
  tool,
  onCall,
  isLoading,
  result,
}) => {
  const [args, setArgs] = useState<Record<string, any>>({});
  const [argErrors, setArgErrors] = useState<Record<string, string>>({});

  // 初始化参数
  React.useEffect(() => {
    const initialArgs: Record<string, any> = {};
    if (tool.inputSchema.properties) {
      Object.keys(tool.inputSchema.properties).forEach(key => {
        const prop = tool.inputSchema.properties![key];
        if (prop.default !== undefined) {
          initialArgs[key] = prop.default;
        } else if (prop.type === 'array') {
          initialArgs[key] = [];
        } else if (prop.type === 'object') {
          initialArgs[key] = {};
        } else {
          initialArgs[key] = '';
        }
      });
    }
    setArgs(initialArgs);
  }, [tool]);

  const handleArgChange = (key: string, value: any) => {
    setArgs(prev => ({ ...prev, [key]: value }));
    // 清除错误
    if (argErrors[key]) {
      setArgErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  const validateArgs = (): boolean => {
    const errors: Record<string, string> = {};
    const required = tool.inputSchema.required || [];

    required.forEach(key => {
      if (args[key] === undefined || args[key] === '' || args[key] === null) {
        errors[key] = '此字段为必填项';
      }
    });

    setArgErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCall = () => {
    if (!validateArgs()) {
      return;
    }

    // 处理参数类型转换
    const processedArgs: Record<string, any> = {};
    Object.keys(args).forEach(key => {
      const prop = tool.inputSchema.properties?.[key];
      if (prop) {
        let value = args[key];
        
        // 尝试类型转换
        if (prop.type === 'number' && typeof value === 'string') {
          value = value === '' ? undefined : Number(value);
          if (isNaN(value)) {
            setArgErrors(prev => ({ ...prev, [key]: '请输入有效的数字' }));
            return;
          }
        } else if (prop.type === 'boolean' && typeof value === 'string') {
          value = value === 'true' || value === '1';
        } else if (prop.type === 'array' && typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch {
            // 如果不是 JSON，尝试按逗号分割
            value = value.split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        } else if (prop.type === 'object' && typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch {
            setArgErrors(prev => ({ ...prev, [key]: '请输入有效的 JSON' }));
            return;
          }
        }
        
        if (value !== undefined && value !== '') {
          processedArgs[key] = value;
        }
      }
    });

    onCall(serverId, tool.name, processedArgs);
  };

  const renderInput = (key: string, prop: any) => {
    const value = args[key] ?? '';
    const isRequired = tool.inputSchema.required?.includes(key);
    const error = argErrors[key];

    switch (prop.type) {
      case 'boolean':
        return (
          <select
            value={String(value)}
            onChange={(e) => handleArgChange(key, e.target.value === 'true')}
            className={`input-field ${error ? 'input-error' : ''}`}
          >
            <option value="true">是</option>
            <option value="false">否</option>
          </select>
        );
      
      case 'array':
      case 'object':
        return (
          <textarea
            value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                handleArgChange(key, parsed);
              } catch {
                handleArgChange(key, e.target.value);
              }
            }}
            className={`input-field font-mono text-sm ${error ? 'input-error' : ''}`}
            rows={3}
            placeholder={prop.type === 'array' ? '["item1", "item2"]' : '{"key": "value"}'}
          />
        );
      
      case 'number':
        return (
          <input
            type="number"
            value={value}
            onChange={(e) => handleArgChange(key, e.target.value)}
            className={`input-field ${error ? 'input-error' : ''}`}
            placeholder={prop.description || `请输入${key}`}
          />
        );
      
      default:
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => handleArgChange(key, e.target.value)}
            className={`input-field ${error ? 'input-error' : ''}`}
            placeholder={prop.description || `请输入${key}`}
          />
        );
    }
  };

  return (
    <div className="bg-gray-50 dark:bg-[#2d2d2d] rounded-lg p-4 border border-gray-200 dark:border-[#404040]">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">{tool.name}</h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">{tool.description}</p>
        </div>
        <Button
          onClick={handleCall}
          disabled={isLoading}
          variant="primary"
        >
          {isLoading ? (
            <Loader className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          <span>调用</span>
        </Button>
      </div>

      {/* 参数输入 */}
      {tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length > 0 && (
        <div className="space-y-3 mt-3">
          {Object.entries(tool.inputSchema.properties).map(([key, prop]: [string, any]) => {
            const isRequired = tool.inputSchema.required?.includes(key);
            return (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {key}
                  {isRequired && <span className="text-red-500 ml-1">*</span>}
                </label>
                {renderInput(key, prop)}
                {prop.description && (
                  <p className="text-xs text-gray-500 mt-1">{prop.description}</p>
                )}
                {argErrors[key] && (
                  <p className="text-xs text-red-600 mt-1">{argErrors[key]}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 结果显示 */}
      {result !== undefined && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-[#404040]">
          <div className="flex items-center space-x-2 mb-2">
            {result.error ? (
              <XCircle className="w-4 h-4 text-red-500" />
            ) : (
              <CheckCircle className="w-4 h-4 text-green-500" />
            )}
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">调用结果</span>
          </div>
          <pre className="bg-gray-900 text-green-400 p-3 rounded text-xs overflow-auto max-h-64">
            {truncateBase64Strings(JSON.stringify(result, null, 2))}
          </pre>
        </div>
      )}
    </div>
  );
};

export default ToolCallCard;

