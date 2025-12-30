/**
 * 底部状态栏组件
 * 显示系统关键指标：Redis、MySQL、LLM Key、Topic监控
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Database, Key, MessageSquare, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getBackendUrl } from '../services/compat/electron';

interface StatusItem {
  name: string;
  status: 'online' | 'offline' | 'checking' | 'warning';
  message?: string;
  icon: React.ReactNode;
}

interface LLMKeyStatus {
  total: number;
  enabled: number;
  withKey: number;
  withoutKey: number;
}

interface TopicStatus {
  total: number;
  active: number;
  participants: number;
}

const StatusBar: React.FC = () => {
  const [redisStatus, setRedisStatus] = useState<StatusItem>({
    name: 'Redis',
    status: 'checking',
    icon: <Database className="w-3.5 h-3.5" />,
  });
  const [mysqlStatus, setMysqlStatus] = useState<StatusItem>({
    name: 'MySQL',
    status: 'checking',
    icon: <Database className="w-3.5 h-3.5" />,
  });
  const [llmKeyStatus, setLlmKeyStatus] = useState<LLMKeyStatus>({
    total: 0,
    enabled: 0,
    withKey: 0,
    withoutKey: 0,
  });
  const [topicStatus, setTopicStatus] = useState<TopicStatus>({
    total: 0,
    active: 0,
    participants: 0,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [backendUrl, setBackendUrl] = useState<string>('');

  useEffect(() => {
    getBackendUrl().then(setBackendUrl);
  }, []);

  const checkStatus = useCallback(async () => {
    if (!backendUrl) return;

    setIsRefreshing(true);

    try {
      // 检查后端健康状态
      const healthRes = await fetch(`${backendUrl}/api/health`);
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        
        // Redis状态
        let redisMessage = '未连接';
        if (healthData.redis) {
          redisMessage = '已连接';
        } else if (!healthData.redis_enabled) {
          redisMessage = '已禁用';
        } else if (healthData.redis_error) {
          redisMessage = healthData.redis_error.length > 20 
            ? healthData.redis_error.substring(0, 20) + '...' 
            : healthData.redis_error;
        }
        
        setRedisStatus({
          name: 'Redis',
          status: healthData.redis ? 'online' : (healthData.redis_enabled ? 'offline' : 'warning'),
          message: redisMessage,
          icon: <Database className="w-3.5 h-3.5" />,
        });
        setMysqlStatus({
          name: 'MySQL',
          status: healthData.mysql ? 'online' : 'offline',
          message: healthData.mysql ? '已连接' : '未连接',
          icon: <Database className="w-3.5 h-3.5" />,
        });
      } else {
        setRedisStatus({
          name: 'Redis',
          status: 'offline',
          message: '后端离线',
          icon: <Database className="w-3.5 h-3.5" />,
        });
        setMysqlStatus({
          name: 'MySQL',
          status: 'offline',
          message: '后端离线',
          icon: <Database className="w-3.5 h-3.5" />,
        });
      }

      // 检查LLM配置和Key状态
      try {
        const llmRes = await fetch(`${backendUrl}/api/llm/configs`);
        if (llmRes.ok) {
          const llmData = await llmRes.json();
          const configs = Array.isArray(llmData) ? llmData : (llmData.configs || []);
          const enabled = configs.filter((c: any) => c.enabled);
          const withKey = enabled.filter((c: any) => {
            // ollama不需要api_key
            if (c.provider === 'ollama') {
              return true;
            }
            // 检查has_api_key字段（后端to_dict方法会设置）
            if (c.has_api_key !== undefined) {
              return c.has_api_key === true;
            }
            // 兼容旧版本：检查api_key字段（但后端通常不会返回）
            return !!c.api_key;
          });
          const withoutKey = enabled.filter((c: any) => {
            // ollama不需要api_key
            if (c.provider === 'ollama') {
              return false;
            }
            // 检查has_api_key字段
            if (c.has_api_key !== undefined) {
              return c.has_api_key === false;
            }
            // 兼容旧版本
            return !c.api_key;
          });

          setLlmKeyStatus({
            total: configs.length,
            enabled: enabled.length,
            withKey: withKey.length,
            withoutKey: withoutKey.length,
          });
        }
      } catch (error) {
        console.error('[StatusBar] Failed to fetch LLM configs:', error);
      }

      // 检查Topic状态
      try {
        const topicRes = await fetch(`${backendUrl}/api/sessions`);
        if (topicRes.ok) {
          const topicData = await topicRes.json();
          const topics = Array.isArray(topicData) ? topicData : (topicData.sessions || topicData.topics || []);
          const activeTopics = topics.filter((t: any) => {
            // 最近24小时内有消息的topic认为是活跃的
            if (!t.last_message_at) return false;
            const lastMessageTime = new Date(t.last_message_at).getTime();
            const now = Date.now();
            return now - lastMessageTime < 24 * 60 * 60 * 1000;
          });
          
          // 获取参与者数量（需要单独请求每个topic的参与者，这里先统计topic数量）
          // 为了性能，这里只统计topic数量，不获取详细参与者信息
          setTopicStatus({
            total: topics.length,
            active: activeTopics.length,
            participants: 0, // 暂时不统计，避免性能问题
          });
        }
      } catch (error) {
        console.error('[StatusBar] Failed to fetch topics:', error);
      }
    } catch (error) {
      console.error('[StatusBar] Status check failed:', error);
      setRedisStatus({
        name: 'Redis',
        status: 'offline',
        message: '检查失败',
        icon: <Database className="w-3.5 h-3.5" />,
      });
      setMysqlStatus({
        name: 'MySQL',
        status: 'offline',
        message: '检查失败',
        icon: <Database className="w-3.5 h-3.5" />,
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [backendUrl]);

  useEffect(() => {
    if (backendUrl) {
      checkStatus();
      // 每30秒自动刷新一次
      const interval = setInterval(checkStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [backendUrl, checkStatus]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'text-green-500';
      case 'offline':
        return 'text-red-500';
      case 'warning':
        return 'text-yellow-500';
      case 'checking':
        return 'text-gray-400 animate-pulse';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      case 'offline':
        return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
      case 'warning':
        return <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 h-7 bg-gray-100 dark:bg-[#1a1a1a] border-t border-gray-200 dark:border-[#404040] flex items-center justify-between px-4 text-xs z-50">
      <div className="flex items-center gap-4">
        {/* Redis状态 */}
        <div className="flex items-center gap-1.5">
          {redisStatus.icon}
          <span className="text-gray-600 dark:text-gray-400">Redis</span>
          {getStatusIcon(redisStatus.status)}
          {redisStatus.message && (
            <span className={`text-xs ${getStatusColor(redisStatus.status)}`}>
              {redisStatus.message}
            </span>
          )}
        </div>

        {/* MySQL状态 */}
        <div className="flex items-center gap-1.5">
          {mysqlStatus.icon}
          <span className="text-gray-600 dark:text-gray-400">MySQL</span>
          {getStatusIcon(mysqlStatus.status)}
          {mysqlStatus.message && (
            <span className={`text-xs ${getStatusColor(mysqlStatus.status)}`}>
              {mysqlStatus.message}
            </span>
          )}
        </div>

        {/* LLM Key状态 */}
        <div className="flex items-center gap-1.5">
          <Key className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-gray-600 dark:text-gray-400">LLM</span>
          {llmKeyStatus.withoutKey > 0 ? (
            <span className="text-yellow-500 text-xs">
              {llmKeyStatus.withKey}/{llmKeyStatus.enabled} 有Key
            </span>
          ) : llmKeyStatus.enabled > 0 ? (
            <span className="text-green-500 text-xs">
              {llmKeyStatus.enabled} 已配置
            </span>
          ) : (
            <span className="text-gray-400 text-xs">未配置</span>
          )}
        </div>

        {/* Topic监控 */}
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-gray-600 dark:text-gray-400">Topic</span>
          <span className="text-gray-500 text-xs">
            {topicStatus.total} 个 / {topicStatus.active} 活跃
          </span>
        </div>
      </div>

      {/* 刷新按钮 */}
      <button
        onClick={checkStatus}
        disabled={isRefreshing}
        className="flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
        title="刷新状态"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
};

export default StatusBar;
