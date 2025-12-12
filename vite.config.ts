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
    port: 5174,
    strictPort: false,
    watch: {
      // 忽略不需要监视的目录，减少文件监视器数量
      ignored: [
        '**/backend/venv/**',
        '**/node_modules/**',
        '**/.git/**',
      ],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

