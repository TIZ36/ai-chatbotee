import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import { GlobalSettings as SettingsType } from '../services/core/shared/types';
import PageLayout, { Card } from './ui/PageLayout';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { toast } from './ui/use-toast';
import { getBackendUrl } from '../utils/backendUrl';

interface SettingsPanelProps {
  settings: SettingsType;
  onUpdateSettings: (settings: Partial<SettingsType>) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [backendUrl, setBackendUrl] = useState<string>(getBackendUrl());

  // 获取当前主题值（兼容旧的 theme + skin 组合）
  const currentTheme = (settings as any).theme === 'niho' || (settings as any).skin === 'niho' 
    ? 'niho' 
    : (settings as any).theme === 'dark' 
    ? 'dark' 
    : 'light';

  const handleThemeChange = (theme: 'light' | 'dark' | 'niho') => {
    // 统一保存为 theme，移除 skin
    onUpdateSettings({ 
      theme: theme as any,
      skin: undefined, // 清除旧的 skin 设置
    });
  };

  const handleSaveBackendUrl = () => {
    // 保存到 localStorage
    localStorage.setItem('chatee_backend_url', backendUrl);
    // 更新环境变量缓存
    (window as any).__cachedBackendUrl = backendUrl;
    toast({
      title: '保存成功',
      description: '后端地址已更新，刷新页面后生效',
    });
  }; 

  return (
    <PageLayout
      title="设置"
      description="管理应用配置和偏好设置"
      icon={Settings}
      variant="persona"
    >
      <section className="settings-panel space-y-3">
        <h2 className="settings-panel-section-title text-sm font-semibold text-gray-700 dark:text-gray-300">通用</h2>
        <div className="settings-panel-cards flex flex-col gap-4">
          {/* 主题设置 */}
          <Card title="主题" variant="persona" size="relaxed" className="settings-panel-card">
          <div className="space-y-3">
            <div>
              <label className="settings-panel-label block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5">
                选择主题
              </label>
              <select
                value={currentTheme}
                onChange={(e) => handleThemeChange(e.target.value as 'light' | 'dark' | 'niho')}
                className="settings-panel-select w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 focus:border-[#7c3aed] transition-all duration-150"
              >
                <option value="light">浅色</option>
                <option value="dark">深色</option>
                <option value="niho">霓虹</option>
              </select>
              <p className="settings-panel-desc text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                选择界面的显示主题
              </p>
            </div>
          </div>
        </Card>

          {/* 后端服务器地址配置 */}
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
        </div>
      </section>
    </PageLayout>
  );
};

export default SettingsPanel;
