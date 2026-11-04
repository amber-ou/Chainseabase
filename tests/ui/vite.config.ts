import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: {
    '@': path.resolve(import.meta.dirname, '../../src'),
    // the login fixture renders the real LoginScreen outside Next.js
    'next/navigation': path.resolve(import.meta.dirname, 'next-navigation-stub.ts'),
  } },
  esbuild: { jsx: 'automatic' },
  css: { postcss: path.resolve(import.meta.dirname, '../..') },
  server: { host: '127.0.0.1', port: 3201, strictPort: true },
});
