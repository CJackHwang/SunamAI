import { expect, test } from '@playwright/test';

function sse(delta: object): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
}

function toolCalls(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): string {
  return sse({ tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
}

async function openConfigured(page: import('@playwright/test').Page, baseUrl: string) {
  await page.addInitScript(({ url }) => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'e2e-no-network');
    localStorage.setItem('sunam_v2_base_url', url);
    localStorage.setItem('sunam_v2_api_model', 'e2e-model');
  }, { url: baseUrl });
  await page.goto('/');
  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  await expect(composer).toBeEnabled({ timeout: 100_000 });
  return composer;
}

test('image attachment automatically falls back when the configured model rejects vision', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://vision-e2e.invalid/v1';
  const requestContents: unknown[] = [];
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages: Array<{ content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Vision test' } }] }) });
      return;
    }
    requestContents.push(body.messages.at(-1)?.content);
    if (requestContents.length === 1) {
      await route.fulfill({ status: 415, contentType: 'text/plain', body: 'vision unsupported' });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: sse({ content: '视觉降级成功' }) });
  });
  const composer = await openConfigured(page, baseUrl);
  await page.locator('.chat-composer-shell input[type="file"]').setInputFiles('public/sunam-appicon-192.png');
  await composer.fill('看图');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph')
    .filter({ hasText: /^视觉降级成功$/ }))
    .toBeVisible({ timeout: 60_000 });
  expect(requestContents).toHaveLength(2);
  expect(requestContents[0]).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image_url' })]));
  expect(String(requestContents[1])).toContain('[image resource:');
  await expect(page.locator('.message-attachments')).toContainText('sunam-appicon-192.png');
});

test('automatic compaction handles an oversized prompt without user controls', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://compact-e2e.invalid/v1';
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Compact test' } }] }) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([
      { id: 'plan', name: 'update_plan', arguments: { items: [{ id: 'compact', title: 'Compact and finish', status: 'completed' }] } },
      { id: 'complete', name: 'complete_task', arguments: { summary: 'Oversized prompt handled.', evidence: ['Automatic context compaction completed.'] } },
    ]) });
  });
  const composer = await openConfigured(page, baseUrl);
  await composer.fill(`实现自动压缩验证：${'长上下文'.repeat(30_000)}`);
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph')
    .filter({ hasText: /^Oversized prompt handled\.$/ }))
    .toBeVisible({ timeout: 60_000 });
  await page.locator('.task-list-summary').click();
  await expect(page.locator('.task-list-compaction')).toContainText('上下文已自动压缩');
  await expect(page.locator('.task-list-compaction')).toContainText(/\d+ → \d+ tokens/);
});

test('an interrupted run resumes from a new run and reconciles its checkpoint', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://resume-e2e.invalid/v1';
  let streamingTurn = 0;
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Resume test' } }] }) });
      return;
    }
    streamingTurn += 1;
    if (streamingTurn === 1) {
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'progress', name: 'report_progress', arguments: { message: 'checkpoint ready' } }]) });
      return;
    }
    if (streamingTurn === 2) return;
    await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([
      { id: 'resume-plan', name: 'update_plan', arguments: { items: [{ id: 'resume', title: 'Reconcile checkpoint state', status: 'completed' }] } },
      { id: 'resume-complete', name: 'complete_task', arguments: { summary: 'Resumed from checkpoint.', evidence: ['New run reconciled the interrupted state.'] } },
    ]) });
  });
  const composer = await openConfigured(page, baseUrl);
  await composer.fill('Check');
  await composer.press('Enter');
  await expect(page.locator('.task-list-progress')).toHaveText('checkpoint ready');
  const readCheckpointRunId = () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sunam-v3');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<any[]>((resolve, reject) => {
      const request = database.transaction('checkpoints', 'readonly').objectStore('checkpoints').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records[0]?.payload?.runId as string | undefined;
  });
  await expect.poll(readCheckpointRunId).not.toBeUndefined();
  const checkpointRunId = await readCheckpointRunId();
  if (!checkpointRunId) throw new Error('Checkpoint fixture did not persist the interrupted run.');
  await page.reload();
  await expect(page.locator('.task-list-phase')).toHaveText('interrupted', { timeout: 60_000 });
  await page.locator('.task-list-summary').click();
  await page.getByRole('button', { name: '从断点继续折腾' }).click();
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Resumed from checkpoint\.$/ })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => page.evaluate(async (sourceRunId) => {
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
    return records.some((record) => record.payload?.parentRunId === sourceRunId && record.payload?.phase === 'completed');
  }, checkpointRunId)).toBe(true);
});

test('a user cancellation aborts the active model request and closes the run', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://cancel-e2e.invalid/v1';
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean };
    if (!body.stream) await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Cancel test' } }] }) });
  });
  const composer = await openConfigured(page, baseUrl);
  await composer.fill('Stop');
  await composer.press('Enter');
  await expect(page.locator('.chat-submit')).toBeEnabled();
  await page.locator('.chat-submit').click();
  await expect(page.locator('.task-list-phase')).toHaveText('cancelled', { timeout: 60_000 });
});

test('a failed session keeps its status indicator separate from the action slot', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://failed-status-e2e.invalid/v1';
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Invalid tool schema' } }) });
  });
  const composer = await openConfigured(page, baseUrl);
  await composer.fill('Trigger a visible failure state.');
  await composer.press('Enter');

  await expect(page.locator('.task-list-phase')).toHaveText('failed', { timeout: 60_000 });
  const status = page.locator('.sidebar-session-status');
  const action = page.locator('.sidebar-session-action');
  await expect(status.locator('.sidebar-status-dot.danger')).toBeVisible();
  const statusBox = await status.boundingBox();
  const actionBox = await action.boundingBox();
  expect(statusBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(actionBox!.x);
});

test('the root agent delegates, waits, and renders a structured child run', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://subagent-e2e.invalid/v1';
  let rootTurn = 0;
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ role: string; content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Delegated task' } }] }) });
      return;
    }
    const lastUser = [...(body.messages ?? [])].reverse().find((message) => message.role === 'user');
    if (String(lastUser?.content).includes('Inspect independently.')) {
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([
        { id: 'child-plan', name: 'update_plan', arguments: { items: [{ id: 'inspect-child', title: 'Inspect child metadata', status: 'completed' }] } },
        { id: 'child-done', name: 'complete_task', arguments: { summary: 'Explorer finished.', evidence: ['Independent inspection complete.'] } },
      ]) });
      return;
    }
    rootTurn += 1;
    if (rootTurn === 1) {
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([
        { id: 'plan', name: 'update_plan', arguments: { items: [{ id: 'delegate', title: 'Delegate inspection', status: 'in_progress' }] } },
        { id: 'spawn', name: 'spawn_subagent', arguments: { task_id: 'inspect', role: 'explore', prompt: 'Inspect independently.' } },
      ]) });
      return;
    }
    if (rootTurn === 2) {
      const runId = JSON.stringify(body.messages ?? []).match(/r-child-[0-9a-f-]{20,}/i)?.[0];
      if (!runId) throw new Error('Subagent fixture did not receive a child run id.');
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'wait', name: 'wait_subagents', arguments: { run_ids: [runId] } }]) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([
      { id: 'plan-done', name: 'update_plan', arguments: { items: [{ id: 'delegate', title: 'Delegate inspection', status: 'completed' }] } },
      { id: 'root-done', name: 'complete_task', arguments: { summary: 'Delegation complete.', evidence: ['Explorer notification synthesized.'] } },
    ]) });
  });
  const composer = await openConfigured(page, baseUrl);
  await composer.fill('Please create a subagent to inspect this task independently and synthesize its evidence.');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Delegation complete\.$/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.chat-message[data-role="user"]', { hasText: 'Inspect independently.' })).toHaveCount(0);
  await page.locator('.task-list-summary').click();
  await expect(page.locator('.task-list-subagent')).toHaveCount(1);
  await expect(page.locator('.task-list-subagent')).toContainText('explore');
  await expect(page.locator('.task-list-subagent')).toContainText('Explorer finished.');
  await page.locator('.sidebar-session-summary').click();
  await expect(page.locator('.sidebar-subagent-row')).toHaveCount(1);
  await page.locator('.sidebar-subagent-row').click();
  await expect(page.locator('.chat-message[data-role="user"]')).toContainText('Inspect independently.');
  await expect(page.locator('.chat-input, .chat-attach-btn')).toHaveCount(0);
  await expect(page.locator('.task-list-popover')).toHaveCount(1);
  await page.locator('.task-list-summary').click();
  await expect(page.locator('.task-list-plan')).toContainText('Inspect child metadata');
  await expect(page.locator('.task-list-plan')).not.toContainText('Delegate inspection');
  await page.locator('.sidebar-session-summary').click();
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Delegation complete\.$/ })).toBeVisible();
  await expect(page.locator('.chat-input')).toBeVisible();
  await expect(page.locator('.sidebar-session-disclosure')).toHaveAttribute('open', '');
  await page.locator('.sidebar-session-summary').click();
  await expect(page.locator('.sidebar-session-disclosure')).not.toHaveAttribute('open', '');
  await page.locator('.sidebar-session-summary').click();
  const childRow = page.locator('.sidebar-subagent-row');
  await childRow.hover();
  await childRow.locator('.item-action').click();
  const childMenu = page.locator('body > .sidebar-context-menu');
  await expect(childMenu).toBeVisible();
  const menuBox = await childMenu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width);
  await childMenu.getByRole('button', { name: '删除' }).click();
  await expect(childRow).toHaveCount(0);
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Delegation complete\.$/ })).toBeVisible();
});

test('stopping one child leaves its sibling and parent running', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://subagent-stop-e2e.invalid/v1';
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  let rootTurn = 0;
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ role: string; content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Parallel delegation' } }] }) });
      return;
    }
    const lastUser = [...(body.messages ?? [])].reverse().find((message) => message.role === 'user');
    const text = String(lastUser?.content ?? '');
    if (text.includes('Hold child one.')) {
      await firstGate;
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'first-complete', name: 'complete_task', arguments: { summary: 'First finished.', evidence: ['first'] } }]) }).catch(() => undefined);
      return;
    }
    if (text.includes('Hold child two.')) {
      await secondGate;
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'second-complete', name: 'complete_task', arguments: { summary: 'Second finished.', evidence: ['second'] } }]) }).catch(() => undefined);
      return;
    }
    rootTurn += 1;
    if (rootTurn === 1) {
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([
        { id: 'spawn-first', name: 'spawn_subagent', arguments: { task_id: 'first', role: 'explore', prompt: 'Hold child one.' } },
        { id: 'spawn-second', name: 'spawn_subagent', arguments: { task_id: 'second', role: 'task', prompt: 'Hold child two.' } },
      ]) });
      return;
    }
    if (rootTurn === 2 || rootTurn === 3) {
      const runIds = [...new Set(JSON.stringify(body.messages ?? []).match(/r-child-[0-9a-f-]{20,}/gi) ?? [])];
      if (runIds.length !== 2) throw new Error('Parallel subagent fixture did not receive both child IDs.');
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: `wait-next-${rootTurn}`, name: 'wait_subagents', arguments: { run_ids: runIds } }]) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'root-complete', name: 'complete_task', arguments: { summary: 'Parent stayed alive.', evidence: ['second child completed'] } }]) });
  });

  const composer = await openConfigured(page, baseUrl);
  await composer.fill('Run two independent children and wait for both.');
  await composer.press('Enter');
  await expect(page.locator('.sidebar-subagent-row')).toHaveCount(2, { timeout: 60_000 });
  await page.locator('.sidebar-session-summary').click();
  const childRows = page.locator('.sidebar-subagent-row');
  await expect(childRows.getByText('explore', { exact: true })).toHaveCount(1);
  await expect(childRows.getByText('task', { exact: true })).toHaveCount(1);
  await childRows.first().click();
  if ((await page.locator('.chat-message[data-role="user"]').textContent())?.includes('Hold child two.')) await childRows.nth(1).click();
  await expect(page.locator('.chat-message[data-role="user"]')).toContainText('Hold child one.');
  await page.locator('.sidebar-subagent-row:not(.active)').click();
  await expect(page.locator('.chat-message[data-role="user"]')).toContainText('Hold child two.');
  await expect(page.locator('.chat-message[data-role="user"]')).not.toContainText('Hold child one.');
  await page.locator('.sidebar-subagent-row:not(.active)').click();
  await expect(page.locator('.chat-message[data-role="user"]')).toContainText('Hold child one.');
  await expect(page.locator('.chat-message[data-role="user"]')).not.toContainText('Hold child two.');
  await page.getByRole('button', { name: '停止此子 Agent' }).click();
  releaseFirst();
  await expect(page.getByRole('button', { name: '返回父 Agent' })).toBeVisible();
  await expect(page.locator('.sidebar-session-summary .sidebar-running')).toBeVisible();
  await expect(page.locator('.sidebar-subagent-row:not(.active) .sidebar-running')).toBeVisible();
  releaseSecond();
  await page.getByRole('button', { name: '返回父 Agent' }).click();
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Parent stayed alive\.$/ })).toBeVisible({ timeout: 60_000 });
});

test('a new root family prunes terminal children from the previous round', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://subagent-prune-e2e.invalid/v1';
  const turns = new Map<string, number>();
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ role: string; content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Cleanup rounds' } }] }) });
      return;
    }
    const lastUser = [...(body.messages ?? [])].reverse().find((message) => message.role === 'user');
    const text = String(lastUser?.content ?? '');
    if (text.includes('Child from round')) {
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'child-complete', name: 'complete_task', arguments: { summary: `${text} complete.`, evidence: [text] } }]) });
      return;
    }
    const round = text.includes('Round two') ? 'two' : 'one';
    const turn = (turns.get(round) ?? 0) + 1;
    turns.set(round, turn);
    if (turn === 1) {
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: `spawn-${round}`, name: 'spawn_subagent', arguments: { task_id: `round-${round}`, role: 'explore', prompt: `Child from round ${round}.` } }]) });
      return;
    }
    if (turn === 2) {
      const runId = (JSON.stringify(body.messages ?? []).match(/r-child-[0-9a-f-]{20,}/gi) ?? []).at(-1);
      if (!runId) throw new Error(`Cleanup fixture could not find the ${round} child ID.`);
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: `wait-${round}`, name: 'wait_subagents', arguments: { run_ids: [runId] } }]) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: `complete-${round}`, name: 'complete_task', arguments: { summary: `Round ${round} complete.`, evidence: [`round ${round}`] } }]) });
  });

  const composer = await openConfigured(page, baseUrl);
  await composer.fill('Round one');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Round one complete\.$/ })).toBeVisible({ timeout: 60_000 });
  await page.locator('.sidebar-session-summary').click();
  await expect(page.locator('.sidebar-subagent-row')).toHaveCount(1);

  await composer.fill('Round two');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Round two complete\.$/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.sidebar-subagent-row')).toHaveCount(1);
  if (!await page.locator('.sidebar-session-disclosure').getAttribute('open')) await page.locator('.sidebar-session-summary').click();
  await page.locator('.sidebar-subagent-row').click();
  await expect(page.locator('.chat-message[data-role="user"]')).toContainText('Child from round two.');
  await expect(page.locator('.chat-message[data-role="user"]')).not.toContainText('Child from round one.');

  const sessionId = await page.evaluate(async () => {
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
    return records[0]?.payload?.sessionId as string | undefined;
  });
  if (!sessionId) throw new Error('Parent-session deletion fixture could not find the session ID.');
  await page.locator('.sidebar-session-summary').click({ button: 'right' });
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.locator('.sidebar-session-group')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(async (deletedSessionId) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sunam-v3');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const storeNames = ['runs', 'events', 'checkpoints', 'resources', 'agentTasks'] as const;
    const remaining = await Promise.all(storeNames.map((storeName) => new Promise<number>((resolve, reject) => {
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).index('sessionId').count(IDBKeyRange.only(deletedSessionId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })));
    const workspace = await new Promise<any>((resolve, reject) => {
      const request = database.transaction('workspace', 'readonly').objectStore('workspace').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return remaining.every((count) => count === 0) && !workspace?.payload?.sessions?.some((session: { id: string }) => session.id === deletedSessionId);
  }, sessionId)).toBe(true);
});
