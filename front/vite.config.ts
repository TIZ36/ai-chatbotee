import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5177,
    strictPort: true,
    watch: {
      // 忽略不需要监视的目录，减少文件监视器数量
      ignored: [
        '**/../../backend/venv/**',
        '**/node_modules/**',
        '**/.git/**',
      ],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // 将 @lobehub/icons 单独打包，实现按需加载
          'lobe-icons': ['@lobehub/icons'],
          // 将 antd 单独打包
          'antd': ['antd'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['@lobehub/icons', 'antd', '@lobehub/ui', '@lobehub/fluent-emoji'],
  },
});

