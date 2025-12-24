export {};

declare global {
  interface Window {
    /** Electron preload 注入（部分页面使用） */
    electron?: any;
  }
}


