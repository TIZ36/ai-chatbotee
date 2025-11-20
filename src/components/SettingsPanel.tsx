import React from 'react';
import { Settings, Trash2, Save, Code } from 'lucide-react';
import { Settings as SettingsType } from '../services/storage';

interface SettingsPanelProps {
  settings: SettingsType;
  onUpdateSettings: (settings: Partial<SettingsType>) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const handleClearData = () => {
    if (window.confirm('确定要清除所有数据吗？此操作不可撤销。')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2 mb-2">
        <Settings className="w-6 h-6 text-gray-600 dark:text-gray-400" />
        <h1 className="text-2xl font-bold">设置</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 主题设置 */}
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-3">外观设置</h2>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 dark:text-gray-300 mb-1.5">
                主题模式
              </label>
              <select
                value={settings.theme || 'system'}
                onChange={(e) => onUpdateSettings({ theme: e.target.value as any })}
                className="input-field"
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色模式</option>
                <option value="dark">深色模式</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                选择界面的显示模式
              </p>
            </div>
          </div>
        </div>

        {/* 自动刷新设置 */}
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-3">自动刷新</h2>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                启用自动刷新
              </label>
              <input
                type="checkbox"
                checked={settings.autoRefresh}
                onChange={(e) => onUpdateSettings({ autoRefresh: e.target.checked })}
                className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                刷新间隔 (分钟)
              </label>
              <input
                type="number"
                min="5"
                max="1440"
                value={settings.refreshInterval}
                onChange={(e) => onUpdateSettings({ refreshInterval: parseInt(e.target.value) })}
                className="input-field"
                disabled={!settings.autoRefresh}
              />
              <p className="text-xs text-gray-500 mt-1">
                最小5分钟，最大24小时 (1440分钟)
              </p>
            </div>
          </div>
        </div>

        {/* 视频设置 */}
        <div className="card p-4">
          <h2 className="text-lg font-semibold mb-3">视频设置</h2>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                每个频道最大视频数量
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={settings.maxVideosPerChannel}
                onChange={(e) => onUpdateSettings({ maxVideosPerChannel: parseInt(e.target.value) })}
                className="input-field"
              />
              <p className="text-xs text-gray-500 mt-1">
                获取频道视频时的最大数量限制
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                频道页面视频列数
              </label>
              <select
                value={settings.videoColumns}
                onChange={(e) => onUpdateSettings({ videoColumns: parseInt(e.target.value) })}
                className="input-field"
              >
                <option value={1}>1列 (适合小屏幕)</option>
                <option value={2}>2列 (默认)</option>
                <option value={3}>3列 (适合大屏幕)</option>
                <option value={4}>4列 (适合超大屏幕)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                设置频道页面右侧视频的显示列数
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* API设置 */}
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-3">API设置</h2>
        
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              YouTube Data API 密钥
            </label>
            <input
              type="password"
              placeholder="输入你的YouTube API密钥"
              className="input-field"
              defaultValue={import.meta.env.VITE_YOUTUBE_API_KEY || ''}
              readOnly
            />
            <p className="text-xs text-gray-500 mt-1">
              请在环境变量中设置 VITE_YOUTUBE_API_KEY
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <h3 className="font-medium text-blue-900 mb-1.5">如何获取API密钥？</h3>
            <ol className="text-sm text-blue-800 space-y-1">
              <li>1. 访问 <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console</a></li>
              <li>2. 创建新项目或选择现有项目</li>
              <li>3. 启用 YouTube Data API v3</li>
              <li>4. 创建API密钥</li>
              <li>5. 在项目根目录创建 .env.local 文件</li>
              <li>6. 添加: VITE_YOUTUBE_API_KEY=你的密钥</li>
            </ol>
          </div>
        </div>
      </div>

      {/* 数据管理 */}
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-3">数据管理</h2>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">清除所有数据</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">删除所有收藏的频道、视频和设置</p>
            </div>
            <button
              onClick={handleClearData}
              className="btn-secondary flex items-center space-x-2 text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
              <span>清除数据</span>
            </button>
          </div>

          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">导出数据</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">下载所有数据为JSON文件</p>
            </div>
            <button
              onClick={() => {
                const data = {
                  favoriteChannels: JSON.parse(localStorage.getItem('youtube_favorite_channels') || '[]'),
                  favoriteVideos: JSON.parse(localStorage.getItem('youtube_favorite_videos') || '[]'),
                  settings: JSON.parse(localStorage.getItem('youtube_settings') || '{}'),
                };
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `youtube-manager-backup-${new Date().toISOString().split('T')[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="btn-secondary flex items-center space-x-2"
            >
              <Save className="w-4 h-4" />
              <span>导出</span>
            </button>
          </div>
        </div>
      </div>


      {/* 开发者工具 */}
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-3">开发者工具</h2>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">打开开发者工具</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">打开或关闭浏览器开发者工具窗口</p>
            </div>
            <button
              onClick={async () => {
                if (window.electronAPI) {
                  try {
                    await window.electronAPI.toggleDevTools();
                  } catch (error) {
                    console.error('Failed to toggle dev tools:', error);
                  }
                } else {
                  // 非 Electron 环境，使用浏览器原生方式
                  console.log('Not in Electron environment');
                }
              }}
              className="btn-primary flex items-center space-x-2"
            >
              <Code className="w-4 h-4" />
              <span>切换开发者工具</span>
            </button>
          </div>
        </div>
      </div>

      {/* 关于 */}
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-3">关于</h2>
        
        <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <p>YouTube视频管理器 v0.1.0</p>
          <p>一个帮助你管理YouTube视频和频道的工具</p>
          <p>功能包括：</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>获取视频和频道信息</li>
            <li>收藏喜爱的视频和频道</li>
            <li>自动刷新频道更新</li>
            <li>搜索YouTube视频</li>
            <li>MCP服务器集成</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel; 