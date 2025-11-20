// Electron 启动文件 - 使用 CommonJS 格式
// 这个文件用于启动 Electron，避免与 package.json 中的 "type": "module" 冲突
// 加载编译后的 main.cjs 文件（TypeScript 编译后重命名为 .cjs）
require('./electron/dist/main.cjs');

