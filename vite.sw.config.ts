import { defineConfig } from 'vite';

// Service worker is built as a single classic script so it works in every browser.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/sw/sw.ts', formats: ['iife'], name: 'sw', fileName: () => 'sw.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
