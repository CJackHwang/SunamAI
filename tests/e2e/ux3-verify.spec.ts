import { expect, test } from '@playwright/test';
import { configureE2E } from './configure';

function sse(delta: object): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
}

/**
 * TASK-UX3 e2e：独立设置页（供应商 / 皮套 / 关于）+ 本机/端口地址渠道 + 皮套热插拔。
 */
test('settings page exposes three tabs and the About tab links Succinix', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // 未配置供应商 → 设置页自动打开。
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '供应商' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '皮套' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '关于' })).toBeVisible();
  await page.getByRole('tab', { name: '关于' }).click();
  await expect(page.getByText('Sunam', { exact: true })).toBeVisible();
  const succinixButton = page.getByRole('button', { name: 'Succinix 项目' });
  await expect(succinixButton).toBeVisible();
});

test('local/port endpoint: fetch models and chat complete (R2 CORS fix)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('http://127.0.0.1:11434/v1/models', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'mock-model-a' }] }) }));
  await page.route('http://127.0.0.1:11434/v1/chat/completions', (route) => route.fulfill({ contentType: 'text/event-stream', body: sse({ content: 'local mock pong' }) }));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: '添加供应商' }).click();
  await page.getByLabel('名称', { exact: true }).fill('Local');
  await page.getByLabel('接口地址 (OpenAI Compatible)').fill('http://127.0.0.1:11434/v1');
  await page.getByLabel('API 密钥').fill('mock-key');
  await page.getByLabel('默认模型').fill('mock-model-a');
  await page.getByRole('button', { name: '保存并继续' }).click();
  await page.getByRole('button', { name: '获取模型' }).click();
  await expect(page.getByLabel('模型')).toHaveValue('mock-model-a');
  await page.locator('.settings-back-btn').click();
  const composer = page.locator('textarea[placeholder*="问 Sunam"]');
  await expect(composer).toBeEnabled({ timeout: 100_000 });
  await composer.fill('hello local');
  await composer.press('Enter');
  await expect(page.getByText('local mock pong')).toBeVisible({ timeout: 30_000 });
});

test('persona creation hot-swaps into the top model selector', async ({ page }) => {
  test.setTimeout(120_000);
  await configureE2E(page);
  // 打开设置 → 皮套 tab。
  await page.getByTitle('全局设置').click();
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await page.getByRole('tab', { name: '皮套' }).click();
  await page.getByRole('button', { name: '新建皮套' }).click();
  await page.getByLabel('名称', { exact: true }).fill('Custom Agent');
  await page.getByLabel('系统提示词').fill('You are a terse assistant.');
  await page.getByRole('button', { name: '保存并继续' }).click();
  await expect(page.getByText('Custom Agent')).toBeVisible();
  await page.locator('.settings-back-btn').click();
  // 顶部模型选择器出现新皮套。
  await expect(page.locator('.model-selector-btn')).toContainText('Sunam 6.9 Pron', { timeout: 30_000 });
  await page.locator('.model-selector-btn').click();
  await page.getByRole('button', { name: 'Custom Agent' }).click();
  await expect(page.locator('.model-selector-btn')).toContainText('Custom Agent');
});
