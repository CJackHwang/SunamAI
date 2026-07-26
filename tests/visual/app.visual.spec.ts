import { expect, test } from '@playwright/test';

function streamToolCalls(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } }] })}\n\ndata: [DONE]\n\n`;
}

async function openResourceSubagentWorkspace(page: import('@playwright/test').Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'visual-no-network');
    localStorage.setItem('sunam_v2_base_url', 'https://visual.invalid/v1');
    localStorage.setItem('sunam_v2_api_model', 'visual-model');
  });
  let rootTurn = 0;
  await page.route('https://visual.invalid/v1/chat/completions', async (route) => {
    const request = route.request().postDataJSON() as { stream?: boolean; tools?: unknown[]; messages?: Array<{ role: string; content: unknown }> };
    if (!request.stream || !request.tools?.length) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Resource review' } }] }) });
      return;
    }
    const lastUser = [...(request.messages ?? [])].reverse().find((message) => message.role === 'user');
    const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
    if (lastUserText.includes('Inspect attached resource metadata only.')) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamToolCalls([{ id: 'child-complete', name: 'complete_task', arguments: { summary: 'Attachment metadata inspected.', evidence: ['Resource manifest received by delegated explorer.'] } }]) });
      return;
    }
    rootTurn += 1;
    if (rootTurn === 1) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamToolCalls([
        { id: 'plan', name: 'update_plan', arguments: { items: [{ id: 'delegate', title: 'Delegate resource inspection', status: 'in_progress' }] } },
        { id: 'spawn', name: 'spawn_subagent', arguments: { task_id: 'resource-review', role: 'explore', prompt: 'Inspect attached resource metadata only.' } },
      ]) });
      return;
    }
    if (rootTurn === 2) {
      const transcript = JSON.stringify(request.messages ?? []);
      const runId = transcript.match(/r-child-[0-9a-f-]{20,}/i)?.[0];
      if (!runId) throw new Error('Visual fixture could not find the delegated run id.');
      await route.fulfill({ contentType: 'text/event-stream', body: streamToolCalls([{ id: 'wait', name: 'wait_subagents', arguments: { run_ids: [runId] } }]) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: streamToolCalls([
      { id: 'plan-done', name: 'update_plan', arguments: { items: [{ id: 'delegate', title: 'Delegate resource inspection', status: 'completed' }] } },
      { id: 'root-complete', name: 'complete_task', arguments: { summary: 'Resource review coordinated.', evidence: ['Explorer returned structured resource evidence.'] } },
    ]) });
  });
  await page.goto('/');
  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  await expect(composer).toBeEnabled({ timeout: 100_000 });
  await page.locator('.chat-composer-shell input[type="file"]').setInputFiles({ name: 'requirements.txt', mimeType: 'text/plain', buffer: Buffer.from('visual resource fixture') });
  await composer.fill('Please delegate an explorer to review the attached resource and report structured evidence for this visual baseline.');
  await page.locator('.chat-submit').click();
  await expect(page.locator('.task-list-phase')).toHaveText('completed', { timeout: 60_000 });
  await page.locator('.task-list-summary').click();
  await expect(page.locator('.task-list-subagent')).toHaveCount(1);
  const attachments = page.locator('.message-attachments');
  await expect(attachments).toContainText('requirements.txt');
  const firstTool = page.locator('details.chat-tool').first();
  await firstTool.locator('summary').click();
  await expect(firstTool).toHaveAttribute('open', '');
  await expect(firstTool).toHaveAttribute('data-animating', 'true');
  await expect(firstTool).not.toHaveAttribute('data-animating', 'true');
  await page.locator('.model-selector-btn').click();
  const modelMenu = page.locator('.model-selector-menu');
  await expect(modelMenu).toBeVisible();
  await page.locator('.model-selector-overlay').click();
  await expect(modelMenu).toHaveClass(/is-exiting/);
  expect(await modelMenu.evaluate((element) => getComputedStyle(element).animationName)).toBe('model-selector-out');
  await expect(modelMenu).toHaveCount(0);
  await page.locator('.chat-message-list').evaluate((element) => { element.scrollTop = 0; });
  await expect(attachments).toBeVisible();
}

test('configuration gate keeps the desktop visual baseline', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page).toHaveScreenshot('configuration-desktop.png', { maxDiffPixelRatio: 0.002 });
});

test('configuration gate keeps the mobile visual baseline', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page).toHaveScreenshot('configuration-mobile.png', { maxDiffPixelRatio: 0.002 });
});

test('workspace resource card and subtask tree keep the desktop visual baseline', async ({ page }) => {
  test.setTimeout(120_000);
  await openResourceSubagentWorkspace(page, { width: 1440, height: 900 });
  await expect(page).toHaveScreenshot('workspace-resources-subagents-desktop.png', { maxDiffPixelRatio: 0.002 });
});

test('workspace resource card and subtask tree keep the mobile visual baseline', async ({ page }) => {
  test.setTimeout(120_000);
  await openResourceSubagentWorkspace(page, { width: 390, height: 844 });
  await expect(page.locator('.chat-input')).toHaveCSS('scrollbar-width', 'none');
  await expect(page).toHaveScreenshot('workspace-resources-subagents-mobile.png', { maxDiffPixelRatio: 0.002 });
});
