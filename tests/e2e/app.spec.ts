import { expect, test } from '@playwright/test';

async function configure(page: import('@playwright/test').Page) {
  await page.route('https://e2e.invalid/v1/models', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'e2e-model' }] }) }));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByLabel('接口地址 (OpenAI Compatible)').fill('https://e2e.invalid/v1');
  await page.getByLabel('API 密钥').fill('e2e-key');
  await page.getByLabel('模型').fill('temporary-model');
  await page.getByRole('button', { name: '获取模型' }).click();
  await expect(page.getByLabel('模型')).toHaveValue('e2e-model');
  await page.getByRole('button', { name: '保存并继续' }).click();
  await expect(page.locator('textarea[placeholder="问 Sunam 任何问题..."]')).toBeEnabled({ timeout: 100_000 });
}

test('first visit preserves the API configuration gate', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '配置' })).toBeVisible();
  await expect(page.getByText('请先配置 API Key 以开始使用。')).toBeVisible();
});

test('settings and session/container CRUD remain durable and isolated', async ({ page }) => {
  test.setTimeout(120_000);
  await configure(page);
  const history = page.locator('.sidebar-section').filter({ hasText: '历史对话' });
  const containers = page.locator('.sidebar-section').filter({ hasText: '容器' });
  const firstSession = history.locator('.sidebar-session-group').filter({ has: page.locator('.sidebar-session-summary', { hasText: '新对话' }) });
  await firstSession.locator('.sidebar-session-summary').click({ button: 'right' });
  await page.getByRole('button', { name: '重命名' }).click();
  await history.locator('.sidebar-item-input').fill('已命名会话');
  await history.locator('.sidebar-item-input').press('Enter');
  await expect(history).toContainText('已命名会话');
  const renamedSession = history.locator('.sidebar-session-group').filter({ hasText: '已命名会话' });
  await renamedSession.locator('.sidebar-session-summary').click({ button: 'right' });
  await page.getByRole('button', { name: '置顶' }).click();
  await expect(renamedSession.locator('.sidebar-session-summary > .lucide-pin')).toHaveCount(1);
  await expect(renamedSession.locator('.sidebar-session-summary > .lucide-history')).toHaveCount(0);

  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(history.locator('.sidebar-item')).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.accept());
  await containers.getByTitle('新建容器').click();
  await expect(containers.locator('.sidebar-item')).toHaveCount(2);

  const newSession = history.locator('.sidebar-session-group').filter({ has: page.locator('.sidebar-session-summary', { hasText: '新对话' }) });
  await newSession.locator('.sidebar-session-summary').click({ button: 'right' });
  await page.getByRole('button', { name: '删除' }).click();
  await expect(history.locator('.sidebar-item')).toHaveCount(1);

  const newContainer = containers.locator('.sidebar-item').filter({ hasText: '新容器1' });
  await newContainer.locator('.item-action').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除' }).click();
  await expect(containers.locator('.sidebar-item')).toHaveCount(1);
  await page.reload();
  await expect(history).toContainText('已命名会话');
  await expect(history.locator('.sidebar-item')).toHaveCount(1);
  await expect(containers.locator('.sidebar-item')).toHaveCount(1);
});

test('a fresh workspace uses the selected locale for default resource names', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_locale', 'ja-JP');
    localStorage.setItem('sunam_v2_api_key', 'locale-e2e-key');
    localStorage.setItem('sunam_v2_base_url', 'https://locale.invalid/v1');
    localStorage.setItem('sunam_v2_api_model', 'locale-model');
  });
  await page.goto('/');
  const history = page.locator('.sidebar-section').filter({ hasText: '履歴' });
  const containers = page.locator('.sidebar-section').filter({ hasText: 'コンテナ' });
  await expect(history.locator('.sidebar-item')).toContainText('新しい会話');
  await expect(containers.locator('.sidebar-item')).toContainText('新規コンテナ');
});
