import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // The web app is served from the domain root. Root-relative assets keep the
  // favicon resolvable when the browser is on a nested client-side route.
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@openagent/core/messages': path.resolve(__dirname, '../openagent/src/messages.ts'),
      '@openagent/core/runtime': path.resolve(__dirname, '../openagent/src/runtime.ts'),
      '@openagent/core/types': path.resolve(__dirname, '../openagent/src/types.ts'),
      '@openagent/core': path.resolve(__dirname, '../openagent/src/index.ts'),
    },
  },
  build: {
    // mammoth 只提供预构建的浏览器单文件（约 500 kB），无法再拆分；
    // 它仅在用户导入 .docx 时按需加载，不进入首屏。
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 只把 React 基础库单独成块：其余依赖已随路由懒加载拆分，
        // 强行归并反而会产生更大的 chunk。
        manualChunks(id) {
          const file = id.replace(/\\/g, '/');
          if (
            /\/node_modules\/(react|react-dom|react-router|scheduler)\//.test(
              file,
            )
          )
            return 'vendor-react';
          // docx 解析只在导入文档时按需加载，单独成块避免与其他按需依赖混在一起。
          if (/\/node_modules\/mammoth\//.test(file)) return 'vendor-docx';
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/auth': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/packages': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/arena': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/optimize': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/profiles': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/agents': {
        target: 'http://127.0.0.1:3001', changeOrigin: true,
        bypass(req) { if (req.headers.accept?.includes('text/html')) return '/index.html'; },
      },
      '/runtimes': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/llm': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/events': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/admin': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/components/lite/**',
      ],
    },
  },
})
