import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages serves a project site under /<repo>/; CI passes BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [vue()],
  // Dev-only: the SW script lives under /src/sw/ but must control the whole site.
  server: { host: true, headers: { 'Service-Worker-Allowed': '/' } },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
