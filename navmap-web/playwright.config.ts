import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5197',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    { command: 'npx tsx scripts/e2e-server.ts', cwd: '../navmap-backend', url: 'http://127.0.0.1:3197/health', reuseExistingServer: false },
    { command: 'npm run dev -- --port 5197 --strictPort', url: 'http://127.0.0.1:5197', reuseExistingServer: false,
      env: { VITE_API_PROXY_TARGET: 'http://127.0.0.1:3197' } },
  ],
});
