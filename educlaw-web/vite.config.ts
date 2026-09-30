import path from 'path'
import { defineConfig } from 'vite'
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
  server: {
    host: '0.0.0.0',
    proxy: {
      '/auth': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/packages': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/arena': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/optimize': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/profiles': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/agents': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/runtimes': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/llm': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/events': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/admin': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
})
