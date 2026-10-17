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
    // 拆出体积最大的两个第三方依赖：业务代码改动时这两个 chunk 的 hash 不变，可继续命中浏览器缓存。
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'antd-vendor': ['antd', '@ant-design/icons'],
        },
      },
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
