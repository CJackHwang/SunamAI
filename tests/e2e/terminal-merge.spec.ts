import { expect, test } from '@playwright/test';

function sse(delta: object): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
}

async function openApp(page: import('@playwright/test').Page, opts: { baseUrl: string; chatOnly?: boolean }) {
  await page.addInitScript(({ url, chatOnly }) => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'e2e-no-network');
    localStorage.setItem('sunam_v2_base_url', url);
    localStorage.setItem('sunam_v2_api_model', 'e2e-model');
    // TASK-PISWITCH R3：pi 引擎默认开启；这批 e2e 走旧引擎逃生门。
    localStorage.setItem('sunam_v2_feature_pi_engine', '0');
    // Chat-only keeps the composer usable without booting a real WebContainer.
    // (`tools` must be present — sanitizeConfig reads both overrides maps.)
    if (chatOnly) {
      localStorage.setItem('sunam_v2_capability_config', JSON.stringify({ modules: { 'virtual-container': { enabled: false } }, tools: {} }));
    }
  }, { url: opts.baseUrl, chatOnly: opts.chatOnly });
  await page.goto('/');
  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  await expect(composer).toBeEnabled({ timeout: 100_000 });
  return composer;
}

test('wide markdown tables scroll inside the chat bubble instead of squeezing', async ({ page }) => {
  test.setTimeout(90_000);
  const baseUrl = 'https://table-e2e.invalid/v1';
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Table test' } }] }) });
      return;
    }
    const table = [
      '| first-column-content-is-quite-long | second-column-content-is-quite-long | third-column-content-is-quite-long | fourth-column-content-is-quite-long | fifth-column-content-is-quite-long | sixth-column-content-is-quite-long |',
      '| --- | --- | --- | --- | --- | --- |',
      '| alpha | beta | gamma | delta | epsilon | zeta |',
    ].join('\n');
    await route.fulfill({ contentType: 'text/event-stream', body: sse({ content: table }) });
  });
  const composer = await openApp(page, { baseUrl, chatOnly: true });
  await composer.fill('render a table');
  await composer.press('Enter');

  const table = page.locator('.markdown-table');
  await expect(table).toBeVisible({ timeout: 60_000 });
  // The table takes its natural width (Chromium resolves `width: max-content` to the
  // used pixel width) so the wrap scrolls horizontally instead of squeezing columns.
  // Poll: the message bubbles in with a size animation, so layout settles a beat late.
  await expect.poll(async () => table.evaluate((element) => {
    const wrap = element.closest('.markdown-table-wrap');
    if (!wrap) return false;
    return wrap.scrollWidth > wrap.clientWidth && element.getBoundingClientRect().width > wrap.clientWidth;
  }), { timeout: 10_000 }).toBe(true);
});

test('vertical touch drag on a terminal is translated into xterm scrolling', async ({ page }) => {
  test.setTimeout(90_000);
  const baseUrl = 'https://touch-e2e.invalid/v1';
  await openApp(page, { baseUrl, chatOnly: true });

  // The user terminal panel is mounted even in chat-only mode (kept alive for reuse);
  // wait for xterm to have created its custom scrollable element.
  const scrollable = page.locator('.xterm-scrollable-element').first();
  await expect(scrollable).toHaveCount(1, { timeout: 60_000 });

  const wheelDeltas = await page.evaluate(() => {
    const screen = document.querySelector('.terminal-view-screen');
    const target = document.querySelector('.xterm-scrollable-element');
    if (!screen || !target) return null;
    const deltas: number[] = [];
    target.addEventListener('wheel', (event) => deltas.push((event as WheelEvent).deltaY), { passive: true });
    const dispatch = (type: string, y: number) => {
      const point = new Touch({ identifier: 1, target: screen, clientX: 60, clientY: y });
      screen.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: [point], changedTouches: [point] }));
    };
    dispatch('touchstart', 320);
    dispatch('touchmove', 260); // deltaY +60
    dispatch('touchmove', 190); // deltaY +70
    dispatch('touchend', 190);
    return deltas;
  });
  expect(wheelDeltas).not.toBeNull();
  expect(wheelDeltas!.length).toBeGreaterThan(0);
  expect(wheelDeltas!.reduce((sum, delta) => sum + delta, 0)).toBe(130);
});

test('merged Sunam computer view exposes 电脑/终端/服务/文件 through the capsule island', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://capsule-e2e.invalid/v1';
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Capsule test' } }] }) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: sse({ content: 'ok' }) });
  });
  await openApp(page, { baseUrl });

  // TASK-UX1: desktop loads half-expanded with the 终端 sub-view active, so the capsule
  // island is already visible without expanding from the rail.
  const capsule = page.locator('.terminal-capsule');
  await expect(capsule).toBeVisible({ timeout: 60_000 });
  const tabs = capsule.locator('[role="tab"]');
  await expect(tabs).toHaveCount(4);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

  await tabs.nth(0).click();
  await expect(page.locator('[id="terminal-segment-panel-ai"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[id="terminal-segment-panel-user"]')).toHaveAttribute('data-active', 'false');

  await tabs.nth(1).click();
  await expect(page.locator('[id="terminal-segment-panel-user"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[id="terminal-segment-panel-ai"]')).toHaveAttribute('data-active', 'false');

  await tabs.nth(2).click();
  await expect(page.locator('[id="terminal-segment-panel-services"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[id="terminal-segment-panel-user"]')).toHaveAttribute('data-active', 'false');

  await tabs.nth(3).click();
  await expect(page.locator('[id="terminal-segment-panel-files"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[id="terminal-segment-panel-services"]')).toHaveAttribute('data-active', 'false');
});
