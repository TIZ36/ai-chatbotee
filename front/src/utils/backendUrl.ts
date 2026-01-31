/**
 * 获取后端 API 地址的工具函数
 * 根据当前访问的域名动态推断后端地址，支持局域网访问
 */

/**
 * 获取后端 API 地址
 * 优先级：
 * 1. 环境变量 VITE_BACKEND_URL
 * 2. 根据当前访问的域名动态推断（同域名，端口 3002）
 * 3. 默认值 http://localhost:3002
 */
export function getBackendUrl(): string {
  // 1. 优先使用环境变量
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.trim();
  }

  // 2. 在浏览器环境中，根据当前访问的域名动态推断
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    // 支持局域网访问：如果访问 http://192.168.x.x:5177，会自动使用 http://192.168.x.x:3002
    return `${protocol}//${hostname}:3002`;
  }

  // 3. 默认值
  return 'http://localhost:3002';
}

