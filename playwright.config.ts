import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/e2e/**/*.spec.ts', '**/visual/**/*.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // CI runners are shared and slow; the high-timing-sensitivity e2e flows
  // (image attachment fallback, compaction gates) occasionally flake on
  // cold runners. One retry on CI keeps the gate honest while absorbing
  // genuine environment jitter — a systematic failure still fails twice.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{ext}',
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      ...(executablePath ? { launchOptions: { executablePath } } : {}),
    },
  }],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
