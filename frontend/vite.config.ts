import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /* В режиме разработки фронтенд и бэкенд на разных портах.
       Прокси избавляет от настройки CORS и делает cookie однодоменными. */
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
