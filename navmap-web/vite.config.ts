import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
        // Keep the web origin as Host so the backend same-origin
        // cookie check (Origin vs Host) passes. changeOrigin:true would
        // rewrite Host to the backend target and trigger 403
        // "cross-origin write rejected" on PUT/POST /api/admin/*.
        changeOrigin: false,
      },
    },
    ...(process.env.VITE_HTTPS_CERT && process.env.VITE_HTTPS_KEY
      ? {
          https: {
            cert: readFileSync(process.env.VITE_HTTPS_CERT),
            key: readFileSync(process.env.VITE_HTTPS_KEY),
          },
        }
      : {}),
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    maxWorkers: 2,
    testTimeout: 15_000,
    exclude: ['e2e/**', 'node_modules/**', '.superpowers/**'],
  },
});
