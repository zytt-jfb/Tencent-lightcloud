import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // M7: 相对路径部署（任意子路径可用）；如需固定子路径改为 '/xxx/'
  base: './',
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  optimizeDeps: {
    include: [
      '@biz-reporting/shared-types',
      '@biz-reporting/shared-constants',
    ],
  },

  build: {
    commonjsOptions: {
      include: [/shared-types/, /shared-constants/, /node_modules/],
    },
  },

  server: {
    port: 5174,
    proxy: {
      '/api': {
        // 开发默认 localhost:3000；F-05A 本地验收通过 VITE_DEV_API_TARGET 指向隔离 API
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
