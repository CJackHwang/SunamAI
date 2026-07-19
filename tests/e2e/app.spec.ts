import { expect, test } from '@playwright/test';

test('first visit preserves the API configuration gate', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '配置' })).toBeVisible();
  await expect(page.getByText('请先配置 API Key 以开始使用。')).toBeVisible();
});
