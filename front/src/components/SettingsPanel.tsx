import React, { useState, useCallback, useEffect } from 'react';
import { Settings, Key, MessageSquare, RefreshCw, Users } from 'lucide-react';
import { GlobalSettings as SettingsType } from '../services/core/shared/types';
import PageLayout, { Card } from './ui/PageLayout';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { toast } from './ui/use-toast';
import { getBackendUrl } from '../utils/backendUrl';
import ActorPoolDialog from './ActorPoolDialog';

interface SettingsPanelProps {
  settings: SettingsType;
  onUpdateSettings: (settings: Partial<SettingsType>) => void;
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
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [backendUrl, setBackendUrl] = useState<string>(getBackendUrl());
  const [llmKeyStatus, setLlmKeyStatus] = useState<LLMKeyStatus>({
    total: 0,
    enabled: 0,
    withKey: 0,
    withoutKey: 0,
  });
  const [topicStatus, setTopicStatus] = useState<TopicStatus>({ total: 0, active: 0 });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actorPoolOpen, setActorPoolOpen] = useState(false);

  const checkStatus = useCallback(async () => {
    const url = getBackendUrl();
    if (!url) return;
    setIsRefreshing(true);
    try {
      try {
        const llmRes = await fetch(`${url}/api/llm/configs`);
        if (llmRes.ok) {
          const llmData = await llmRes.json();
          const configs = Array.isArray(llmData) ? llmData : (llmData.configs || []);
          const enabled = configs.filter((c: any) => c.enabled);
          const withKey = enabled.filter((c: any) => {
            if (c.provider === 'ollama') return true;
            if (c.has_api_key !== undefined) return c.has_api_key === true;
            return !!c.api_key;
          });
          const withoutKey = enabled.filter((c: any) => {
            if (c.provider === 'ollama') return false;
            if (c.has_api_key !== undefined) return c.has_api_key === false;
            return !c.api_key;
          });
          setLlmKeyStatus({ total: configs.length, enabled: enabled.length, withKey: withKey.length, withoutKey: withoutKey.length });
        }
      } catch (e) {
        console.error('[Settings] Failed to fetch LLM configs:', e);
      }
      try {
        const topicRes = await fetch(`${url}/api/sessions`);
        if (topicRes.ok) {
          const topicData = await topicRes.json();
          const topics = Array.isArray(topicData) ? topicData : (topicData.sessions || topicData.topics || []);
          const activeTopics = topics.filter((t: any) => {
            if (!t.last_message_at) return false;
            return Date.now() - new Date(t.last_message_at).getTime() < 24 * 60 * 60 * 1000;
          });
          setTopicStatus({ total: topics.length, active: activeTopics.length });
        }
      } catch (e) {
        console.error('[Settings] Failed to fetch topics:', e);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleSaveBackendUrl = () => {
    localStorage.setItem('chatee_backend_url', backendUrl);
    (window as any).__cachedBackendUrl = backendUrl;
    toast({
      title: '保存成功',
      description: '后端地址已更新，刷新页面后生效',
    });
    setBackendUrl(getBackendUrl());
  };

  return (
    <PageLayout
      title="设置"
      description="管理应用配置和偏好设置"
      icon={Settings}
      variant="persona"
    >
      <section className="settings-panel space-y-3">
        <h2 className="settings-panel-section-title text-sm font-semibold text-[var(--text-primary)]">通用</h2>
        <div className="settings-panel-cards flex flex-col gap-4">
          <Card title="后端服务器" variant="persona" size="relaxed" className="settings-panel-card">
            <div className="space-y-3">
              <div>
                <label className="settings-panel-label block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5">
                  后端服务器地址
                </label>
                <Input
                  type="text"
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="http://localhost:3002"
                  className="w-full"
                />
                <p className="settings-panel-desc text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                  设置后端 API 服务器地址，留空则使用默认值或根据当前域名自动推断
                </p>
              </div>
              <Button
                variant="primary"
                onClick={handleSaveBackendUrl}
                className="settings-panel-btn-primary w-full"
              >
                保存后端地址
              </Button>
            </div>
          </Card>

          <Card title="运行状态" variant="persona" size="relaxed" className="settings-panel-card">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[var(--text-primary)]"
                  onClick={() => setActorPoolOpen(true)}
                  title="查看正在工作的 Actor"
                >
                  <Users className="w-4 h-4 mr-2" />
                  Actor 池
                </Button>
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-[var(--text-muted)]" />
                  <span className="text-sm text-[var(--text-secondary)]">LLM</span>
                  {llmKeyStatus.withoutKey > 0 ? (
                    <span className="text-xs text-amber-500">
                      {llmKeyStatus.withKey}/{llmKeyStatus.enabled} 有Key
                    </span>
                  ) : llmKeyStatus.enabled > 0 ? (
                    <span className="text-xs text-emerald-500">{llmKeyStatus.enabled} 已配置</span>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">未配置</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[var(--text-muted)]" />
                  <span className="text-sm text-[var(--text-secondary)]">Topic</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {topicStatus.total} 个 / {topicStatus.active} 活跃
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={checkStatus}
                  disabled={isRefreshing}
                  className="text-[var(--text-muted)]"
                  title="刷新状态"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                当前后端：{backendUrl || '（默认）'}
              </p>
            </div>
          </Card>
        </div>
      </section>

      <ActorPoolDialog open={actorPoolOpen} onOpenChange={setActorPoolOpen} />
    </PageLayout>
  );
};

export default SettingsPanel;
