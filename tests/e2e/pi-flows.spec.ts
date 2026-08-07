import { expect, test } from '@playwright/test';

function sse(delta: object): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
}

function sseText(content: string): string {
  return sse({ content });
}

/**
 * TASK-PISWITCH R1-R3 e2e：pi 通道默认引擎下，附件与断点恢复全链跑通。
 *
 * 与 agent-flows.spec.ts（钉旧引擎逃生门）互补：这批测试不设置
 * sunam_v2_feature_pi_engine，即走 pi 默认路径。
 */
async function openPiConfigured(page: import('@playwright/test').Page, baseUrl: string, opts: { chatOnly?: boolean } = {}) {
  await page.addInitScript(({ url, chatOnly }) => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'e2e-no-network');
    localStorage.setItem('sunam_v2_base_url', url);
    localStorage.setItem('sunam_v2_api_model', 'e2e-model');
    // Chat-only keeps the composer usable without booting a real WebContainer.
    if (chatOnly) {
      localStorage.setItem('sunam_v2_capability_config', JSON.stringify({ modules: { 'virtual-container': { enabled: false } }, tools: {} }));
    }
  }, { url: baseUrl, chatOnly: opts.chatOnly });
  await page.goto('/');
  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  await expect(composer).toBeEnabled({ timeout: 100_000 });
  return composer;
}

/** 读取 v3 runs store 的全部记录（供持久化断言/等待）。 */
async function readV3Runs(page: import('@playwright/test').Page): Promise<Array<{ id?: string; payload?: { phase?: string; sessionId?: string } }>> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sunam-v3');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<any[]>((resolve, reject) => {
      const request = database.transaction('runs', 'readonly').objectStore('runs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records;
  });
}

test('pi channel embeds an image attachment into the multimodal model request and renders the reply', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://pi-attach-e2e.invalid/v1';
  const requestBodies: Array<{ stream?: boolean; messages?: Array<{ content: unknown }> }> = [];
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Attachment test' } }] }) });
      return;
    }
    requestBodies.push(body);
    await route.fulfill({ contentType: 'text/event-stream', body: sseText('已看到图片') });
  });
  const composer = await openPiConfigured(page, baseUrl, { chatOnly: true });
  await page.locator('.chat-composer-shell input[type="file"]').setInputFiles('public/sunam-appicon-192.png');
  await composer.fill('看图');
  await composer.press('Enter');

  await expect(page.locator('.chat-message[data-role="assistant"] .chat-answer').filter({ hasText: /^已看到图片$/ })).toBeVisible({ timeout: 60_000 });

  // 附件 chips 与旧引擎一致（pi 通道保留 _ui_attachments）。
  await expect(page.locator('.message-attachments')).toContainText('sunam-appicon-192.png');

  // 模型请求的末条 user 消息是「文本 + image_url」多模态 content。
  expect(requestBodies.length).toBeGreaterThan(0);
  const lastContent = requestBodies.at(-1)!.messages!.at(-1)!.content;
  expect(Array.isArray(lastContent)).toBe(true);
  const parts = lastContent as Array<{ type: string; text?: string; image_url?: { url: string } }>;
  expect(parts.some((part) => part.type === 'text' && part.text?.includes('Attached resources'))).toBe(true);
  const imageUrl = parts.find((part) => part.type === 'image_url')?.image_url?.url;
  expect(imageUrl).toBeDefined();
  expect(imageUrl).toMatch(/^data:image\/png;base64,/);
});

test('pi channel resumes an interrupted run from the persisted session history', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://pi-resume-e2e.invalid/v1';
  const streamedBodies: Array<{ stream?: boolean; messages?: Array<{ role: string; content: unknown }> }> = [];
  let streamingTurn = 0;
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ role: string; content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Resume test' } }] }) });
      return;
    }
    streamingTurn += 1;
    if (streamingTurn === 1) {
      // 第一轮：hang 住不返回，制造活跃 run → 刷新后被打断。
      await new Promise<never>(() => undefined);
      return;
    }
    streamedBodies.push(body);
    await route.fulfill({ contentType: 'text/event-stream', body: sseText('已从断点继续') });
  });
  const composer = await openPiConfigured(page, baseUrl);
  await composer.fill('build the feature');
  await composer.press('Enter');
  // 等待 run 进入活跃态（pi agent_start → phase planning）。
  await expect(page.locator('.task-list-phase')).toContainText('planning', { timeout: 30_000 });
  // 等待 v3 run 持久化完成（IndexedDB 异步写），避免刷新丢失活跃 run。
  await expect.poll(async () => (await readV3Runs(page)).some((record) => record.payload?.phase === 'planning'), { timeout: 15_000 }).toBe(true);

  await page.reload();
  // 刷新恢复：活跃 pi run 被打断，RunBoard 出现「从断点继续」。
  await expect(page.locator('.task-list-phase')).toContainText('interrupted', { timeout: 60_000 });
  await page.locator('.task-list-summary').click();
  await page.getByRole('button', { name: '从断点继续折腾' }).click();

  // pi 通道从会话历史继续：resume 请求携带首轮 user 消息 + resume 提示。
  await expect(page.locator('.chat-message[data-role="assistant"] .chat-answer').filter({ hasText: /^已从断点继续$/ })).toBeVisible({ timeout: 60_000 });
  expect(streamedBodies).toHaveLength(1);
  const resumedMessages = streamedBodies[0]!.messages!;
  const texts = resumedMessages
    .map((message) => Array.isArray(message.content) ? (message.content as Array<{ text?: string }>).map((part) => part.text ?? '').join('') : String(message.content))
    .join('\n');
  expect(texts).toContain('build the feature');
  expect(texts).toContain('Continue from checkpoint:');
});
