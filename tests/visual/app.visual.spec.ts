import { expect, test } from '@playwright/test';

test('configuration gate keeps the desktop visual baseline', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page).toHaveScreenshot('configuration-desktop.png', { maxDiffPixelRatio: 0.05 });
});

test('configuration gate keeps the mobile visual baseline', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page).toHaveScreenshot('configuration-mobile.png', { maxDiffPixelRatio: 0.05 });
});
