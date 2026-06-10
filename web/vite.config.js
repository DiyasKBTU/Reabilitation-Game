import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ble': resolve(__dirname, '../packages/ble'),
      '@game2d': resolve(__dirname, '../packages/game-2d'),
      '@game3d': resolve(__dirname, '../packages/game-3d'),
      // packages/game-3d импортирует 'three', но модуль установлен в web/node_modules.
      // Алиас на ESM-сборку, чтобы Rollup нашёл его из любого места.
      'three': resolve(__dirname, 'node_modules/three/build/three.module.js'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          state: ['zustand'],
          three: ['three'],
        },
      },
    },
  },
});
