import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // відносні шляхи: збірка працює за будь-якою адресою (на Pages це /dialer/widget/)
  base: './',
  plugins: [vue(), tailwindcss()],
  // дві сторінки: застосунок (index.html, GitHub Pages) і віджет для iframe (widget.html, embed.js)
  build: { rollupOptions: { input: { app: 'index.html', widget: 'widget.html' } } },
  // локально застосунок ходить на сервер через проксі (той самий origin, CORS не потрібен)
  server: { proxy: { '/auth': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom' },
});
