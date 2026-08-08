import { expect, test } from '@playwright/test';

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

function toolCalls(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): string {
  return sse({ tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
}

function proseAndToolCalls(content: string, calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): string {
  const toolDelta = { choices: [{ delta: { tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } }] };
  const finishDelta = { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: ${JSON.stringify(toolDelta)}\n\ndata: ${JSON.stringify(finishDelta)}\n\ndata: [DONE]\n\n`;
}

async function openConfigured(page: import('@playwright/test').Page, baseUrl: string) {
  await page.addInitScript(({ url }) => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'e2e-no-network');
    localStorage.setItem('sunam_v2_base_url', url);
    localStorage.setItem('sunam_v2_api_model', 'e2e-model');
    // R4 后旧引擎已删除、pi 为唯一实现；M1 逃生门（终审组2）落地后关 pi 会阻断 Agent 运行，
    // 这批 e2e 走 pi 驱动（mock /chat/completions），显式开启 pi 引擎。
    localStorage.setItem('sunam_v2_feature_pi_engine', '1');
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
  let markCompactionStarted: () => void = () => undefined;
  let releaseCompaction: () => void = () => undefined;
  const compactionStarted = new Promise<void>((resolve) => { markCompactionStarted = resolve; });
  const compactionGate = new Promise<void>((resolve) => { releaseCompaction = resolve; });
  let markSecondMainStarted: () => void = () => undefined;
  let releaseSecondMain: () => void = () => undefined;
  const secondMainStarted = new Promise<void>((resolve) => { markSecondMainStarted = resolve; });
  const secondMainGate = new Promise<void>((resolve) => { releaseSecondMain = resolve; });
  let streamTurn = 0;
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ content?: unknown }> };
    const isSemanticCompaction = JSON.stringify(body.messages ?? []).includes('Create a compact factual continuation record');
    if (isSemanticCompaction) {
      markCompactionStarted();
      await compactionGate;
      await route.fulfill({ contentType: 'text/event-stream', body: sse({ content: 'Compact continuation facts.' }) });
      return;
    }
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Compact test' } }] }) });
      return;
    }
    streamTurn += 1;
    if (streamTurn === 1) {
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([
        { id: 'prepare-history', name: 'report_progress', arguments: { message: 'Preparing compaction history.' } },
      ]) });
      return;
    }
    if (streamTurn === 2) {
      markSecondMainStarted();
      await secondMainGate;
      await route.fulfill({ contentType: 'text/event-stream', body: proseAndToolCalls('历史分析：'.repeat(20_000), [
        { id: 'progress-before-compaction', name: 'report_progress', arguments: { message: 'Preparing the next model turn.' } },
      ]) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: proseAndToolCalls('压缩后正文与工具同时显示。', [
      { id: 'plan', name: 'update_plan', arguments: { items: [{ id: 'compact', title: 'Compact and finish', status: 'completed' }] } },
      { id: 'complete', name: 'complete_task', arguments: { summary: 'Oversized prompt handled.', evidence: ['Automatic context compaction completed.'] } },
    ]) });
  });
  const composer = await openConfigured(page, baseUrl);
  await composer.fill('实现自动压缩验证。');
  await composer.press('Enter');
  await secondMainStarted;
  await composer.fill('继续，并在下一轮压缩旧上下文。');
  await page.getByRole('button', { name: '发送' }).click();
  releaseSecondMain();
  await compactionStarted;
  await expect(page.getByRole('status')).toHaveText('正在自动压缩上下文');
  releaseCompaction();
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph')
    .filter({ hasText: /^Oversized prompt handled\.$/ }))
    .toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('压缩后正文与工具同时显示。')).toBeVisible();
  await page.getByText('已完成: update_plan').click();
  const expandedTool = page.locator('.chat-tool[open]');
  const argumentsViewport = expandedTool.locator('.chat-tool-arguments');
  const resultViewport = expandedTool.locator('.chat-tool-result-content');
  await expect(argumentsViewport).toHaveCSS('max-height', '96px');
  await expect(resultViewport).toHaveCSS('max-height', '96px');
  // The disclosure animates the tool's width/height via WAAPI; `max-height` is a static
  // value, so the assertions above resolve while the width is still moving. Measure only
  // after the animation settles (`data-animating` is removed on finish) — otherwise the two
  // boundingBox() calls can straddle fast early animation frames and report unequal widths
  // on a slow CI runner (the arguments and result boxes share one flex width by design).
  await expect(expandedTool).not.toHaveAttribute('data-animating', 'true', { timeout: 10_000 });
  const [argumentsBox, resultBox] = await Promise.all([argumentsViewport.boundingBox(), resultViewport.boundingBox()]);
  expect(argumentsBox).not.toBeNull();
  expect(resultBox).not.toBeNull();
  expect(Math.abs(argumentsBox!.width - resultBox!.width)).toBeLessThan(1);
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
  await expect(composer).toBeEnabled();
  await expect(page.getByRole('button', { name: '停止主 Agent' })).toBeEnabled();
  await page.getByRole('button', { name: '停止主 Agent' }).click();
  await expect(page.locator('.task-list-phase')).toHaveText('cancelled', { timeout: 60_000 });
});

test('running composer keeps its normal style and queues guidance into the next model turn', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://guidance-e2e.invalid/v1';
  let releaseFirst: () => void = () => undefined;
  let markFirstStarted: () => void = () => undefined;
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const modelTranscripts: string[] = [];
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ role: string; content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Guidance flow' } }] }) });
      return;
    }
    modelTranscripts.push(JSON.stringify(body.messages ?? []));
    if (modelTranscripts.length === 1) {
      markFirstStarted();
      await firstGate;
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'progress', name: 'report_progress', arguments: { message: 'Initial action finished.' } }]) });
      return;
    }
    if (!modelTranscripts.at(-1)?.includes('Prioritize the mobile composer.')) throw new Error('Guidance did not reach the next model turn.');
    await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'guided-complete', name: 'complete_task', arguments: { summary: 'Guidance applied.', evidence: ['Mobile composer guidance applied on the next turn.'] } }]) });
  });

  const composer = await openConfigured(page, baseUrl);
  await composer.fill('Start a task and wait for guidance.');
  const send = page.locator('.chat-submit');
  await expect(send).toBeEnabled();
  await expect(send).toHaveCSS('opacity', '1');
  const normalStyles = await page.locator('.chat-input-row').evaluate((row) => {
    const input = getComputedStyle(row.querySelector('textarea')!);
    const button = getComputedStyle(row.querySelector('button')!);
    return { inputBackground: input.backgroundColor, inputColor: input.color, buttonBackground: button.backgroundColor, buttonColor: button.color, buttonOpacity: button.opacity };
  });
  await composer.press('Enter');
  await firstStarted;
  await expect(composer).toBeEnabled();
  await expect(send).toHaveAttribute('aria-label', '停止主 Agent');
  await expect(send).toHaveCSS('opacity', '1');
  const thinking = page.getByRole('status');
  await expect(thinking).toHaveText('Sunam 正在思考...');
  await expect(thinking).toHaveCSS('animation-name', 'thinking-text-sheen');
  await expect(thinking).toHaveCSS('animation-duration', '3s');
  await expect(thinking).toHaveCSS('background-repeat', 'no-repeat');
  await expect(thinking).toHaveCSS('background-size', '250% 100%');
  const sheenPositions = await thinking.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error('Thinking sheen animation is missing.');
    animation.pause();
    return [0, 450, 900, 1_350, 1_800, 2_400, 2_984, 2_999, 3_001].map((time) => {
      animation.currentTime = time;
      return Number.parseFloat(getComputedStyle(element).backgroundPositionX);
    });
  });
  expect(sheenPositions[0]).toBeCloseTo(100, 0);
  expect(sheenPositions[1]).toBeCloseTo(75, 0);
  expect(sheenPositions[2]).toBeCloseTo(50, 0);
  expect(sheenPositions[3]).toBeCloseTo(25, 0);
  expect(sheenPositions[4]).toBeCloseTo(0, 0);
  expect(sheenPositions[5]).toBeCloseTo(0, 0);
  expect(sheenPositions[6]).toBeCloseTo(0, 0);
  expect(sheenPositions[7]).toBeCloseTo(0, 0);
  expect(sheenPositions[8]).toBeCloseTo(100, 0);
  await composer.fill('Prioritize the mobile composer.');
  await expect(send).toBeEnabled();
  await expect(send).toHaveAttribute('aria-label', '发送');
  await expect.poll(async () => page.locator('.chat-input-row').evaluate((row) => {
    const input = getComputedStyle(row.querySelector('textarea')!);
    const button = getComputedStyle(row.querySelector('button')!);
    return { inputBackground: input.backgroundColor, inputColor: input.color, buttonBackground: button.backgroundColor, buttonColor: button.color, buttonOpacity: button.opacity };
  })).toEqual(normalStyles);
  await send.click();
  await expect(page.locator('.chat-message[data-role="user"]', { hasText: 'Prioritize the mobile composer.' })).toBeVisible();
  releaseFirst();

  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Guidance applied\.$/ })).toBeVisible({ timeout: 60_000 });
  expect(modelTranscripts).toHaveLength(2);
  expect(modelTranscripts[0]).not.toContain('Prioritize the mobile composer.');
  expect(modelTranscripts[1]).toContain('Prioritize the mobile composer.');
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
  const sidebarDisclosure = page.locator('.sidebar-session-disclosure');
  const sidebarChild = page.locator('.sidebar-subagent-row');
  await expect(sidebarDisclosure).toHaveAttribute('open', '');
  await expect(sidebarDisclosure).not.toHaveAttribute('data-animating');
  await expect(sidebarChild).toBeVisible();
  await sidebarChild.click();
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
  await childMenu.getByRole('menuitem', { name: '删除' }).click();
  await expect(childRow).toHaveCount(0);
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Delegation complete\.$/ })).toBeVisible();
});

test('a child asks only its parent, resumes from parent guidance, and completes explicitly', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://subagent-parent-e2e.invalid/v1';
  let rootTurn = 0;
  let childTurn = 0;
  let childTools: string[] = [];
  const rootTranscripts: string[] = [];
  let rootReceivedBlocked = false;
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; tools?: Array<{ function?: { name?: string } }>; messages?: Array<{ role: string; content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Parent coordination' } }] }) });
      return;
    }
    const lastUser = [...(body.messages ?? [])].reverse().find((message) => message.role === 'user');
    const text = String(lastUser?.content ?? '');
    if (text.includes('Ask the parent which target to inspect.')) {
      childTurn += 1;
      childTools = (body.tools ?? []).flatMap((tool) => tool.function?.name ? [tool.function.name] : []);
      if (childTurn === 1) {
        await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'ask-parent', name: 'ask_parent', arguments: { question: 'Which target should I inspect?' } }]) });
      } else {
        const transcript = JSON.stringify(body.messages ?? []);
        if (!transcript.includes('Inspect the mobile composer.')) throw new Error('Child did not receive parent guidance.');
        await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'child-complete', name: 'complete_task', arguments: { summary: 'Parent-guided inspection complete.', evidence: ['Inspected the mobile composer.'] } }]) });
      }
      return;
    }
    rootTurn += 1;
    const transcript = JSON.stringify(body.messages ?? []);
    rootTranscripts.push(transcript);
    const runId = transcript.match(/r-child-[0-9a-f-]{20,}/i)?.[0];
    if (rootTurn === 1) {
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([
        { id: 'parent-plan', name: 'update_plan', arguments: { items: [{ id: 'coordinate', title: 'Coordinate parent-guided child', status: 'in_progress' }] } },
        { id: 'spawn-child', name: 'spawn_subagent', arguments: { task_id: 'parent-guided', role: 'explore', prompt: 'Ask the parent which target to inspect.' } },
      ]) });
      return;
    }
    if (!runId) throw new Error('Parent coordination fixture did not receive the child ID.');
    if (rootTurn === 2 || rootTurn === 4) {
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: `wait-${rootTurn}`, name: 'wait_subagents', arguments: { run_ids: [runId] } }]) });
      return;
    }
    if (rootTurn === 3) {
      rootReceivedBlocked = (body.messages ?? []).some((message) => typeof message.content === 'string' && message.content.includes('Which target should I inspect?') && message.content.includes('"status":"blocked"'));
      if (!rootReceivedBlocked) throw new Error('Root did not receive the child blocker.');
      await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([{ id: 'guide-child', name: 'message_subagent', arguments: { run_id: runId, message: 'Inspect the mobile composer.' } }]) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: toolCalls([
      { id: 'parent-plan-done', name: 'update_plan', arguments: { items: [{ id: 'coordinate', title: 'Coordinate parent-guided child', status: 'completed' }] } },
      { id: 'root-complete', name: 'complete_task', arguments: { summary: 'Parent coordination complete.', evidence: ['Child completed after parent guidance.'] } },
    ]) });
  });

  const composer = await openConfigured(page, baseUrl);
  await composer.fill('Delegate an explorer that must ask its parent for the target, answer it, and wait for explicit completion.');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Parent coordination complete\.$/ })).toBeVisible({ timeout: 60_000 });
  expect(childTools).toContain('ask_parent');
  expect(childTools).not.toContain('ask_user');
  expect(rootReceivedBlocked).toBe(true);
  await expect(page.locator('.chat-message[data-role="user"]', { hasText: 'Which target should I inspect?' })).toHaveCount(0);
  const sidebarDisclosure = page.locator('.sidebar-session-disclosure');
  const sidebarChild = page.locator('.sidebar-subagent-row');
  await expect(sidebarDisclosure).toHaveAttribute('open', '');
  await expect(sidebarDisclosure).not.toHaveAttribute('data-animating');
  await expect(sidebarChild).toBeVisible();
  await sidebarChild.click();
  await expect(page.getByRole('button', { name: '返回父 Agent' })).toBeVisible();
  await expect(page.getByRole('button', { name: /停止.*子 Agent/ })).toHaveCount(0);
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Which target should I inspect\?$/ })).toBeVisible();
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph').filter({ hasText: /^Parent-guided inspection complete\.$/ })).toBeVisible();
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
  const sidebarDisclosure = page.locator('.sidebar-session-disclosure');
  const sidebarChild = page.locator('.sidebar-subagent-row');
  await expect(sidebarChild).toHaveCount(1);
  await expect(sidebarDisclosure).toHaveAttribute('open', '');
  await expect(sidebarDisclosure).not.toHaveAttribute('data-animating');
  await expect(sidebarChild).toBeVisible();
  await sidebarChild.click();
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
  await page.getByRole('menuitem', { name: '删除' }).click();
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
