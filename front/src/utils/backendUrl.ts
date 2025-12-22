/**
 * 获取后端 API 地址的工具函数
 * 根据当前访问的域名动态推断后端地址，支持局域网访问
 */

/**
 * 获取后端 API 地址
 * 优先级：
 * 1. 环境变量 VITE_BACKEND_URL
 * 2. 如果使用反向代理（同域名同端口），使用相对路径（推荐）
 * 3. 根据当前访问的域名动态推断（同域名，端口 3002）
 * 4. 默认值 http://localhost:3002
 */
export function getBackendUrl(): string {
  // 1. 优先使用环境变量
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl) {
    return envUrl;
  }

  // 2. 在浏览器环境中
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    
    // 如果是 Electron 环境，从配置读取
    if ((window as any).electronAPI) {
      // 尝试从 Electron 配置读取（异步，需要缓存）
      const cachedUrl = (window as any).__cachedBackendUrl;
      if (cachedUrl) {
        return cachedUrl;
      }
      // 默认值，实际值会在应用启动时通过 API 获取
      return 'http://localhost:3002';
    }
    
    // 如果使用反向代理（前端和后端在同一端口），使用相对路径
    // 这样可以避免跨端口请求，提升性能
    // 注意：如果使用 nginx 反向代理，建议设置 VITE_BACKEND_URL 环境变量为空字符串或相对路径
    // 这里保持原有逻辑，通过环境变量控制
    
    // 开发环境：根据当前访问的域名构建后端地址（使用相同协议和域名，端口 3002）
    // 注意：如果使用 nginx 反向代理，应该设置 VITE_BACKEND_URL 环境变量
    return `${protocol}//${hostname}:3002`;
  }

  // 3. 默认值
  return 'http://localhost:3002';
}

