import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '../../src') } },
  esbuild: { jsx: 'automatic' },
  css: { postcss: path.resolve(import.meta.dirname, '../..') },
  server: { host: '127.0.0.1', port: 3201, strictPort: true },
});
