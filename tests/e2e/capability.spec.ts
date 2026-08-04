import { expect, test } from '@playwright/test';

function sse(delta: object): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
}

async function configure(page: import('@playwright/test').Page) {
  await page.route('https://e2e.invalid/v1/models', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'e2e-model' }] }) }));
  await page.route('https://e2e.invalid/v1/chat/completions', (route) => route.fulfill({ contentType: 'text/event-stream', body: sse({ content: '纯聊天应答' }) }));
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

async function openCapabilityTab(page: import('@playwright/test').Page) {
  const tabs = page.locator('.dual-terminal-tabs');
  if (await tabs.count() > 0) {
    await tabs.locator('.terminal-tab-btn').filter({ hasText: '能力库' }).click();
  } else {
    // Collapsed rail: the capability button expands the column and selects the tab.
    await page.locator('.collapsed-terminal-nav').getByTitle('能力库').click();
  }
  await expect(page.locator('.capability-rail')).toBeVisible();
}

test('the capability panel lives in the right column and toggles the container module', async ({ page }) => {
  test.setTimeout(120_000);
  await configure(page);

  await expect(page.locator('.dual-terminal')).toBeVisible();
  await openCapabilityTab(page); // expands the collapsed rail and lands on the capability tab
  await expect(page.locator('.terminal-tab-btn').filter({ hasText: 'Sunam的电脑' })).toBeVisible();

  // Turn the container module off → container tabs leave, the right sidebar (capability) stays.
  await page.locator('.capability-rail').getByRole('switch', { name: '虚拟容器' }).click();
  await expect(page.locator('.capability-rail')).toBeVisible();
  await expect(page.locator('.terminal-tab-btn').filter({ hasText: 'Sunam的电脑' })).toHaveCount(0);
  await expect(page.locator('.sidebar-section').filter({ hasText: '容器' })).toBeHidden();

  // Chat-only mode still completes a conversation (no container tools needed).
  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  await composer.fill('你好');
  await composer.press('Enter');
  await expect(page.locator('.chat-answer')).toContainText('纯聊天应答', { timeout: 30_000 });

  // Re-enable the container → the container tabs return alongside the capability tab.
  await page.locator('.capability-rail').getByRole('switch', { name: '虚拟容器' }).click();
  await expect(page.locator('.terminal-tab-btn').filter({ hasText: 'Sunam的电脑' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.capability-rail')).toBeVisible();
});

test('module rows expand to reveal agent-visible tools and warn on agent-runtime tools', async ({ page }) => {
  test.setTimeout(120_000);
  await configure(page);
  await openCapabilityTab(page);

  const rail = page.locator('.capability-rail');
  // Expanding the container module reveals its agent-visible tools.
  await rail.getByText('虚拟容器').click();
  await expect(rail.getByRole('switch', { name: 'shell_run' })).toBeVisible();
  await rail.getByText('虚拟容器').click();

  // The agent-runtime module warns that disabling is not recommended.
  await rail.getByText('Agent运行时').click();
  await expect(rail.getByText('不建议关闭').first()).toBeVisible();
});
