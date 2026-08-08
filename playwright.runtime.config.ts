import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests/runtime',
  timeout: 120_000,
  expect: { timeout: 100_000 },
  // 真实 WebContainer 测试是资源密集（共享一个 preview server + 浏览器 WebContainer boot）。
  // 串行执行避免并行 worker 争抢同一 Succinix host / preview 导致的间歇性超时（CI 与本地一致）。
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173' },
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
