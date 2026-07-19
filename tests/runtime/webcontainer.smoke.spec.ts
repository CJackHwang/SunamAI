import { expect, test } from '@playwright/test';

test('real WebContainer runtime boots under the production isolation headers', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_api_key', 'runtime-smoke-no-network-call');
    localStorage.setItem('sunam_base_url', 'https://example.invalid/v1');
    localStorage.setItem('sunam_api_model', 'runtime-smoke');
  });
  await page.goto('/');
  await expect(page.locator('textarea[placeholder="问 Sunam 任何问题..."]')).toBeEnabled();
});
