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
    const lastUser = [...(request.messages ?? [])].reverse().find((message) => message.role === 'user');
    const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
    if (!request.stream || !request.tools?.length) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: lastUserText.includes('Keep this session plain.') ? 'Plain conversation' : 'Resource review' } }] }) });
      return;
    }
    if (lastUserText.includes('Keep this session plain.')) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamToolCalls([
        { id: 'plain-plan', name: 'update_plan', arguments: { items: [{ id: 'plain', title: 'Complete without delegation', status: 'completed' }] } },
        { id: 'plain-complete', name: 'complete_task', arguments: { summary: 'Plain session complete.', evidence: ['No child Agent created.'] } },
      ]) });
      return;
    }
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
  if (viewport.width <= 900) {
    await page.locator('.mobile-sidebar-toggle').click();
  }
  await expect(page.locator('.sidebar-session-disclosure')).toHaveAttribute('data-expanded', 'true');
  await expect(page.locator('.sidebar-subagent-row')).toBeVisible();
  await page.getByRole('button', { name: '新建任务' }).click();
  await expect(page.locator('.sidebar-session-group')).toHaveCount(2);
  const plainSession = page.locator('.sidebar-session-group').filter({ hasNot: page.locator('.sidebar-subagent-row') });
  const childSession = page.locator('.sidebar-session-group').filter({ has: page.locator('.sidebar-subagent-row') });
  await expect(plainSession).toHaveClass(/active/);
  if (viewport.width <= 900) await page.locator('.mobile-sidebar-close').click();
  await composer.fill('Keep this session plain.');
  await page.locator('.chat-submit').click();
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Plain session complete\.$/ })).toBeVisible({ timeout: 60_000 });
  if (viewport.width <= 900) await page.locator('.mobile-sidebar-toggle').click();
  await expect(page.locator('.sidebar-session-group')).toHaveCount(2);
  await expect(plainSession).toContainText('Plain conversation');
  await expect(page.locator('.chat-message[data-role="user"]').first()).toHaveCSS('background-color', 'rgb(58, 58, 58)');
  await expect(plainSession.locator('.sidebar-session-chevron')).toHaveCount(0);
  await expect(childSession.locator('.sidebar-session-chevron')).toHaveCount(1);
  const childAction = childSession.locator('.sidebar-subagent-row .item-action');
  if (viewport.width > 900) await childSession.locator('.sidebar-subagent-row').hover();
  await expect(childAction).toBeVisible();
  const childActionBox = await childAction.boundingBox();
  await childAction.click();
  const childMenu = page.locator('body > .sidebar-context-menu.subagent-context-menu');
  await expect(childMenu).toBeVisible();
  await expect(childMenu.locator('.context-item')).toHaveCSS('border-radius', '20px');
  if (viewport.width <= 900) await childMenu.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const childMenuBox = await childMenu.boundingBox();
  expect(childActionBox).not.toBeNull();
  expect(childMenuBox).not.toBeNull();
  if (viewport.width <= 900) {
    await expect(childMenu).toHaveCSS('border-radius', '28px 28px 0px 0px');
    expect(childMenuBox!.x).toBe(0);
    expect(childMenuBox!.width).toBe(viewport.width);
    expect(childMenuBox!.y + childMenuBox!.height).toBe(viewport.height);
    expect(await childMenu.evaluate((element) => getComputedStyle(element).animationName)).toBe('context-sheet-up');
  } else {
    await expect(childMenu).toHaveCSS('border-radius', '28px');
    expect(childMenuBox!.x).toBeGreaterThanOrEqual(8);
    expect(childMenuBox!.x + childMenuBox!.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(childMenuBox!.y).toBeGreaterThanOrEqual(8);
    expect(childMenuBox!.y + childMenuBox!.height).toBeLessThanOrEqual(viewport.height - 8);
    expect(Math.abs(childMenuBox!.y - childActionBox!.y)).toBeLessThan(100);
  }
  await expect(page).toHaveScreenshot(viewport.width <= 900 ? 'subagent-menu-mobile.png' : 'subagent-menu-desktop.png', { maxDiffPixelRatio: 0.002 });
  await page.locator('body > .action-menu-overlay').click({ position: { x: 2, y: 2 } });
  await expect(childMenu).toHaveClass(/is-exiting/);
  expect(await childMenu.evaluate((element) => getComputedStyle(element).animationName)).toBe(viewport.width <= 900 ? 'context-sheet-down' : 'context-menu-out');
  await expect(childMenu).toHaveCount(0);
  await childSession.locator('.sidebar-session-summary').click({ button: 'right' });
  const resourceMenu = page.locator('.sidebar-context-menu:not(.subagent-context-menu)');
  await expect(resourceMenu).toBeVisible();
  if (viewport.width <= 900) {
    await resourceMenu.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const resourceMenuBox = await resourceMenu.boundingBox();
    expect(resourceMenuBox).not.toBeNull();
    expect(resourceMenuBox!.x).toBe(0);
    expect(resourceMenuBox!.width).toBe(viewport.width);
    expect(resourceMenuBox!.y + resourceMenuBox!.height).toBe(viewport.height);
    expect(await resourceMenu.evaluate((element) => getComputedStyle(element).animationName)).toBe('context-sheet-up');
  }
  await page.getByRole('menuitem', { name: '置顶' }).click();
  await expect(childSession.locator('.sidebar-session-summary > .lucide-pin')).toHaveCount(1);
  await expect(childSession.locator('.sidebar-session-summary > .lucide-history')).toHaveCount(0);
  const actionOffsets = await page.locator('.sidebar-session-action').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().right));
  expect(Math.max(...actionOffsets) - Math.min(...actionOffsets)).toBeLessThan(1);
  await childSession.locator('.sidebar-session-summary').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名' }).click();
  const editingSummary = childSession.locator('.sidebar-session-summary.is-editing');
  await expect(editingSummary.locator('.sidebar-session-trailing')).toHaveCount(0);
  await expect(childSession.locator('.sidebar-session-action')).toHaveCount(0);
  const editGeometry = await editingSummary.evaluate((summary) => {
    const row = summary.getBoundingClientRect();
    const input = summary.querySelector('input')!.getBoundingClientRect();
    return { contained: input.right <= row.right && input.left >= row.left, width: input.width };
  });
  expect(editGeometry.contained).toBe(true);
  expect(editGeometry.width).toBeGreaterThan(100);
  await editingSummary.locator('input').press('Enter');
  await expect(page.locator('.sidebar')).toHaveScreenshot(viewport.width <= 900 ? 'history-mixed-mobile.png' : 'history-mixed-desktop.png', { maxDiffPixelRatio: 0.002 });
  await childSession.locator('.sidebar-session-summary').click();
  if (!await childSession.locator('details').getAttribute('open')) await childSession.locator('.sidebar-session-summary').click();
  if (viewport.width <= 900) {
    await page.locator('.mobile-sidebar-close').click();
  }
  await page.locator('.task-list-summary').click();
  await expect(page.locator('.task-list-subagent')).toHaveCount(1);
  const taskTools = page.locator('details.task-list-tools');
  await expect(taskTools).toHaveCount(1);
  await taskTools.locator('summary').click();
  await expect(taskTools).toHaveAttribute('open', '');
  await expect(taskTools).toHaveAttribute('data-animating', 'true');
  await expect(taskTools).not.toHaveAttribute('data-animating', 'true');
  await taskTools.locator('summary').click();
  await expect(taskTools).toHaveAttribute('data-animating', 'true');
  await expect(taskTools).not.toHaveAttribute('data-animating', 'true');
  await expect(taskTools).not.toHaveAttribute('open', '');
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
  await page.locator('.chat-message-list').evaluate((element) => {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    element.scrollTop = 0;
  });
  await expect(attachments).toBeVisible();
}

test('configuration gate keeps the desktop visual baseline', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.settings-modal-content')).toHaveCSS('border-radius', '28px');
  await expect(page).toHaveScreenshot('configuration-desktop.png', { maxDiffPixelRatio: 0.002 });
});

test('configuration gate keeps the mobile visual baseline', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.settings-modal-content')).toHaveCSS('border-radius', '28px 28px 0px 0px');
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
