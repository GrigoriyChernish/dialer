import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // відносні шляхи: збірка працює за будь-якою адресою (на Pages це /dialer/widget/)
  base: './',
  plugins: [vue(), tailwindcss()],
  // сторінки: застосунок (index.html, GitHub Pages), віджет для iframe (widget.html, embed.js) і міні-вікно вхідного на десктопі (incoming.html, Tauri)
  build: { rollupOptions: { input: { app: 'index.html', widget: 'widget.html', incoming: 'incoming.html' } } },
  // локально застосунок ходить на сервер через проксі (той самий origin, CORS не потрібен)
  server: { proxy: { '/auth': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom' },
});
