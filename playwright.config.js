import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PPPIC_E2E_TOKEN ||= randomBytes(32).toString('base64url');
process.env.PPPIC_E2E_DIR ||= mkdtempSync(join(tmpdir(), 'pppic-e2e-'));
const baseURL = 'http://127.0.0.1:3344';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0,
  globalTimeout: 120000, timeout: 30000, reporter: [['list'], ['html', { open: 'never' }]],
  globalTeardown: './tests/e2e-teardown.js',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node src/server.js', url: baseURL + '/healthz', reuseExistingServer: false, timeout: 15000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    env: { HOST: '127.0.0.1', PORT: '3344', PUBLIC_URL: baseURL, DATA_DIR: process.env.PPPIC_E2E_DIR, ADMIN_TOKEN: process.env.PPPIC_E2E_TOKEN, STORAGE_DRIVER: 'local', COOKIE_SECURE: 'false', MAX_UPLOAD_MB: '20', STORAGE_LIMIT_MB: '100' },
  },
});
