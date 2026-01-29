import React, { useState, useEffect } from 'react';
import { Settings, Trash2, Save, Code } from 'lucide-react';
import { GlobalSettings as SettingsType } from '../services/core/shared/types';
import PageLayout, { Card } from './ui/PageLayout';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/Dialog';
import { Button } from './ui/Button';
import { toast } from './ui/use-toast';

interface SettingsPanelProps {
  settings: SettingsType;
  onUpdateSettings: (settings: Partial<SettingsType>) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [backendUrl, setBackendUrl] = useState<string>('http://localhost:3001');
  const [isElectron, setIsElectron] = useState(false);
  const [isSavingBackendUrl, setIsSavingBackendUrl] = useState(false);

  // 检查是否为 Electron 环境
  useEffect(() => {
    const checkElectron = () => {
      return typeof window !== 'undefined' && (window as any).electronAPI !== undefined;
    };
    setIsElectron(checkElectron());
    
    // 如果是 Electron 环境，加载后端地址配置
    if (checkElectron() && (window as any).electronAPI?.getBackendUrl) {
      (window as any).electronAPI.getBackendUrl().then((url: string) => {
        setBackendUrl(url || 'http://localhost:3001');
      }).catch((error: Error) => {
        console.error('[SettingsPanel] Failed to load backend URL:', error);
      });
    }
  }, []);

  const handleSaveBackendUrl = async () => {
    if (!isElectron || !(window as any).electronAPI?.setBackendUrl) {
      return;
    }
    
    setIsSavingBackendUrl(true);
    try {
      await (window as any).electronAPI.setBackendUrl(backendUrl);
      // 更新缓存
      (window as any).__cachedBackendUrl = backendUrl;
      // 提示用户
      toast({
        title: '保存成功',
        description: '后端地址已保存，请重启应用以使配置生效',
        variant: 'success',
      });
    } catch (error) {
      console.error('[SettingsPanel] Failed to save backend URL:', error);
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      });
    } finally {
      setIsSavingBackendUrl(false);
    }
  };

  const handleClearData = () => {
    setClearDataOpen(true);
  }; 

  return (
    <PageLayout
      title="设置"
      description="管理应用配置和偏好设置"
      icon={Settings}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 max-w-7xl">
        {/* 主题设置 */}
        <Card title="外观设置">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5">
                主题模式
              </label>
              <select
                value={settings.theme || 'system'}
                onChange={(e) => onUpdateSettings({ theme: e.target.value as 'light' | 'dark' | 'system' })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 focus:border-[#7c3aed] transition-all duration-150"
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色模式</option>
                <option value="dark">深色模式</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                选择界面的显示模式
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5">
                皮肤
              </label>
              <select
                value={(settings as any).skin || 'default'}
                onChange={(e) => onUpdateSettings({ skin: e.target.value as 'default' | 'gmgn' })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 focus:border-[#7c3aed] transition-all duration-150"
              >
                <option value="default">Chatee 默认</option>
                <option value="gmgn">GMGN 风格</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                参考 gmgn.ai 的深色霓虹绿风格
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5">
                字体
              </label>
              <select
                value={(settings as any).font || 'default'}
                onChange={(e) => onUpdateSettings({ font: e.target.value as 'default' | 'pixel' | 'terminal' | 'rounded' | 'dotgothic' | 'silkscreen' })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 focus:border-[#7c3aed] transition-all duration-150"
                style={{ fontFamily: (settings as any).font === 'pixel' ? '"Press Start 2P", cursive' : (settings as any).font === 'terminal' ? '"VT323", monospace' : (settings as any).font === 'rounded' ? '"Comfortaa", cursive' : (settings as any).font === 'dotgothic' ? '"DotGothic16", sans-serif' : (settings as any).font === 'silkscreen' ? '"Silkscreen", sans-serif' : 'inherit' }}
              >
                <option value="default">默认 (Inter)</option>
                <option value="pixel">像素 (Press Start 2P)</option>
                <option value="terminal">终端 (VT323)</option>
                <option value="rounded">圆体 (Comfortaa)</option>
                <option value="dotgothic">点阵 (DotGothic16)</option>
                <option value="silkscreen">像素屏 (Silkscreen)</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                选择界面字体，像素字体会启用点阵网格背景和块状边框
              </p>
            </div>
          </div>
        </Card>

        {/* 自动刷新设置 */}
        <Card title="自动刷新">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-[#e0e0e0]">
                启用自动刷新
              </label>
              <input
                type="checkbox"
                checked={settings.autoRefresh}
                onChange={(e) => onUpdateSettings({ autoRefresh: e.target.checked })}
                className="w-4 h-4 text-[#7c3aed] border-gray-300 dark:border-[#505050] rounded focus:ring-[#7c3aed] bg-white dark:bg-[#2d2d2d]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5">
                刷新间隔 (分钟)
              </label>
              <input
                type="number"
                min="5"
                max="1440"
                value={settings.refreshInterval}
                onChange={(e) => onUpdateSettings({ refreshInterval: parseInt(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 focus:border-[#7c3aed] transition-all duration-150 disabled:opacity-50"
                disabled={!settings.autoRefresh}
              />
              <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                最小5分钟，最大24小时 (1440分钟)
              </p>
            </div>
          </div>
        </Card>

        {/* 视频设置 */}
        <Card title="视频设置">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5">
                每个频道最大视频数量
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={settings.maxVideosPerChannel}
                onChange={(e) => onUpdateSettings({ maxVideosPerChannel: parseInt(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 focus:border-[#7c3aed] transition-all duration-150"
              />
              <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                获取频道视频时的最大数量限制
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5">
                频道页面视频列数
              </label>
              <select
                value={settings.videoColumns}
                onChange={(e) => onUpdateSettings({ videoColumns: parseInt(e.target.value) })}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 focus:border-[#7c3aed] transition-all duration-150"
              >
                <option value={1}>1列 (适合小屏幕)</option>
                <option value={2}>2列 (默认)</option>
                <option value={3}>3列 (适合大屏幕)</option>
                <option value={4}>4列 (适合超大屏幕)</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                设置频道页面右侧视频的显示列数
              </p>
            </div>
          </div>
        </Card>

        {/* Electron 后端地址配置 */}
        {isElectron && (
          <Card title="后端地址配置">
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-1.5">
                  后端 API 地址
                </label>
                <input
                  type="text"
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="http://localhost:3001"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 focus:border-[#7c3aed] transition-all duration-150 font-mono"
                />
                <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                  配置后端服务器的地址，修改后需要重启应用生效
                </p>
              </div>
              <Button
                onClick={handleSaveBackendUrl}
                variant="primary"
                size="sm"
                disabled={isSavingBackendUrl}
                className="w-full"
              >
                {isSavingBackendUrl ? '保存中...' : '保存配置'}
              </Button>
            </div>
          </Card>
        )}

        {/* API设置 */}
        <Card title="API设置">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-[#e0e0e0] mb-2">
                YouTube Data API 密钥
              </label>
              <input
                type="password"
                placeholder="输入你的YouTube API密钥"
                className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-[#2d2d2d] border border-gray-300 dark:border-[#505050] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]/50 focus:border-[#7c3aed] transition-all duration-150"
                defaultValue={import.meta.env.VITE_YOUTUBE_API_KEY || ''}
                readOnly
              />
              <p className="text-xs text-gray-500 dark:text-[#a0a0a0] mt-1">
                请在环境变量中设置 VITE_YOUTUBE_API_KEY
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-lg p-3">
              <h3 className="font-medium text-blue-900 dark:text-blue-300 mb-1.5 text-sm">如何获取API密钥？</h3>
              <ol className="text-xs text-blue-800 dark:text-blue-400 space-y-1">
                <li>1. 访问 <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console</a></li>
                <li>2. 创建新项目或选择现有项目</li>
                <li>3. 启用 YouTube Data API v3</li>
                <li>4. 创建API密钥</li>
              </ol>
            </div>
          </div>
        </Card>

        {/* 数据管理 */}
        <Card title="数据管理">
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040]">
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">清除所有数据</h3>
                <p className="text-xs text-gray-600 dark:text-[#a0a0a0]">删除所有收藏的频道、视频和设置</p>
              </div>
              <Button
                onClick={handleClearData}
                variant="destructive"
                size="sm"
                className="px-3 py-1.5 text-sm font-medium flex items-center space-x-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>清除</span>
              </Button>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040]">
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-white">导出数据</h3>
                <p className="text-xs text-gray-600 dark:text-[#a0a0a0]">下载所有数据为JSON文件</p>
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
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 dark:bg-[#404040] text-gray-700 dark:text-[#e0e0e0] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] border border-gray-300 dark:border-[#505050] transition-all duration-150 flex items-center space-x-1.5"
              >
                <Save className="w-4 h-4" />
                <span>导出</span>
              </button>
            </div>
          </div>
        </Card>

        {/* 开发者工具 */}
        <Card title="开发者工具">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#2d2d2d] rounded-lg border border-gray-200 dark:border-[#404040]">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">打开开发者工具</h3>
              <p className="text-xs text-gray-600 dark:text-[#a0a0a0]">打开或关闭浏览器开发者工具窗口</p>
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
                  console.log('Not in Electron environment');
                }
              }}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] active:bg-[#5b21b6] transition-all duration-150 flex items-center space-x-1.5"
            >
              <Code className="w-4 h-4" />
              <span>切换</span>
            </button>
          </div>
        </Card>

        {/* 关于 */}
        <Card title="关于">
          <div className="space-y-2 text-sm text-gray-600 dark:text-[#b0b0b0]">
            <p className="font-medium text-gray-900 dark:text-white">chatee v0.1.0</p>
            <p>一个帮助你管理 LLM 和 MCP 工作流的工具</p>
            <p className="mt-2">功能包括：</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
              <li>多 LLM 提供商集成</li>
              <li>MCP 服务器管理</li>
              <li>可视化工作流编辑器</li>
              <li>智能对话会话管理</li>
            </ul>
          </div>
        </Card>
      </div>

      <Dialog open={clearDataOpen} onOpenChange={setClearDataOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清除所有数据</DialogTitle>
            <DialogDescription>
              这将清除本地所有配置与会话数据，且不可撤销。确定继续吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="secondary" onClick={() => setClearDataOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
            >
              清除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
};

export default SettingsPanel;
