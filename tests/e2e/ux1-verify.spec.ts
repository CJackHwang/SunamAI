import { expect, test } from '@playwright/test';

test('UX1: half-expanded sidebar + default 终端 segment accepts typed commands', async ({ page }) => {
  test.setTimeout(120_000);
  const baseUrl = 'https://ux1-e2e.invalid/v1';
  await page.addInitScript(({ url }) => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'e2e-no-network');
    localStorage.setItem('sunam_v2_base_url', url);
    localStorage.setItem('sunam_v2_api_model', 'e2e-model');
    localStorage.setItem('sunam_v2_feature_pi_engine', '0');
  }, { url: baseUrl });
  await page.route(`${baseUrl}/chat/completions`, async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'UX1 verify' } }] }) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: 'data: [DONE]\n\n' });
  });
  await page.goto('/');
  await expect(page.locator('textarea[placeholder="问 Sunam 任何问题..."]')).toBeEnabled({ timeout: 100_000 });

  // R1: right sidebar loads half-expanded by default (not the collapsed rail).
  await expect(page.locator('.workspace-container')).toHaveAttribute('data-layout', 'half');

  // R2: inside "Sunam的电脑" the 终端 (user) sub-view is active by default.
  const capsule = page.locator('.terminal-capsule');
  await expect(capsule).toBeVisible({ timeout: 60_000 });
  await expect(capsule.locator('[role="tab"]').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[id="terminal-segment-panel-user"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[id="terminal-segment-panel-ai"]')).toHaveAttribute('data-active', 'false');

  // R3: the interactive user shell is mounted and accepts typed commands.
  const userPanel = page.locator('[id="terminal-segment-panel-user"]');
  const userInput = userPanel.locator('.xterm-helper-textarea').first();
  await expect(userInput).toBeVisible({ timeout: 60_000 });
  // Not readOnly → disableStdin is false, i.e. a real typeable shell (unlike the
  // agent terminal which is readOnly).
  expect(await userInput.evaluate((element) => (element as HTMLTextAreaElement).readOnly)).toBe(false);

  // Capture keystrokes at document capture phase (xterm's own keydown handler runs
  // later and consumes the textarea buffer, so the element's value is unreliable).
  await page.evaluate(() => {
    (window as unknown as { __ux1keys: string[] }).__ux1keys = [];
    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest && target.closest('#terminal-segment-panel-user')) {
        (window as unknown as { __ux1keys: string[] }).__ux1keys.push(event.key);
      }
    }, true);
  });
  await userInput.click();
  await expect.poll(() => userInput.evaluate((element) => document.activeElement === element), { timeout: 5_000 }).toBe(true);
  await page.keyboard.type('ls -la');
  const keys = await userInput.evaluate(() => (window as unknown as { __ux1keys: string[] }).__ux1keys);
  expect(keys.join('')).toBe('ls -la');

  // 电脑 remains switchable (agent operation display).
  await capsule.locator('[role="tab"]').nth(0).click();
  await expect(page.locator('[id="terminal-segment-panel-ai"]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[id="terminal-segment-panel-user"]')).toHaveAttribute('data-active', 'false');
});
