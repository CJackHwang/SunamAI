import { expect } from '@playwright/test';

function sse(delta: object): string {
  const hasToolCalls = Array.isArray((delta as { tool_calls?: unknown[] }).tool_calls) && (delta as { tool_calls: unknown[] }).tool_calls.length > 0;
  const finishReason = hasToolCalls ? 'tool_calls' : 'stop';
  return [
    `data: ${JSON.stringify({ choices: [{ delta }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}`,
    'data: [DONE]',
    '',
  ].join('\n\n');
}

/**
 * TASK-UX3：用独立设置页配置渠道（替代旧弹窗）。
 * 首次访问无供应商 → 设置页自动打开 → 添加供应商 → 获取全局模型 → 返回主界面。
 */
export async function configureE2E(page: import('@playwright/test').Page, options: { routeChat?: boolean; piEngineOff?: boolean } = {}) {
  await page.route('https://e2e.invalid/v1/models', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'e2e-model' }] }) }));
  if (options.routeChat) {
    await page.route('https://e2e.invalid/v1/chat/completions', (route) => route.fulfill({ contentType: 'text/event-stream', body: sse({ content: '纯聊天应答' }) }));
  }
  await page.goto('/');
  await page.evaluate((engineOff) => {
    localStorage.clear();
    if (engineOff) localStorage.setItem('sunam_v2_feature_pi_engine', '0');
  }, options.piEngineOff ?? false);
  await page.reload();
  // 设置页（供应商 tab）自动打开：添加一个供应商。
  await page.getByRole('button', { name: '添加供应商' }).click();
  await page.getByLabel('名称', { exact: true }).fill('E2E');
  await page.getByLabel('接口地址 (OpenAI Compatible)').fill('https://e2e.invalid/v1');
  await page.getByLabel('API 密钥').fill('e2e-key');
  await page.getByLabel('默认模型').fill('temporary-model');
  await page.getByRole('button', { name: '保存并继续' }).click();
  // 全局对话模型：获取模型列表并选中。
  await page.getByRole('button', { name: '获取模型' }).click();
  await expect(page.getByLabel('模型')).toHaveValue('e2e-model');
  // 返回主界面。
  await page.locator('.settings-back-btn').click();
  await expect(page.locator('textarea[placeholder*="问 Sunam"]')).toBeEnabled({ timeout: 100_000 });
}
