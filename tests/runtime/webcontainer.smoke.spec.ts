import { expect, test } from '@playwright/test';

function streamResponse(delta: object): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
}

test('real WebContainer keeps Agent processes, ports, and scrolling inside the services panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'runtime-smoke-no-network-call');
    localStorage.setItem('sunam_v2_base_url', 'https://example.invalid/v1');
    localStorage.setItem('sunam_v2_api_model', 'runtime-smoke');
  });

  let modelTurn = 0;
  await page.route('https://example.invalid/v1/chat/completions', async (route) => {
    const request = route.request().postDataJSON() as { stream?: boolean; tools?: unknown[] };
    if (!request.stream || !request.tools?.length) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Runtime smoke' } }] }) });
      return;
    }
    modelTurn += 1;
    if (modelTurn === 1) {
      const backgroundCalls = Array.from({ length: 18 }, (_, index) => ({
        index: index + 2,
        id: `background-${index}`,
        type: 'function' as const,
        function: {
          name: 'shell_run',
          arguments: JSON.stringify({
            command: index === 0 ? `node -e "require('http').createServer((_,r)=>r.end('ok')).listen(3457)"` : `node -e "setInterval(()=>{},1000)" # runtime-${index}`,
            mode: 'background',
          }),
        },
      }));
      await route.fulfill({
        contentType: 'text/event-stream',
        body: streamResponse({ tool_calls: [
          { index: 0, id: 'plan', type: 'function', function: { name: 'update_plan', arguments: JSON.stringify({ items: [{ id: 'runtime', title: 'Runtime smoke', status: 'completed' }] }) } },
          { index: 1, id: 'foreground', type: 'function', function: { name: 'shell_run', arguments: JSON.stringify({ command: 'echo runtime-foreground', mode: 'foreground' }) } },
          ...backgroundCalls,
        ] }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'text/event-stream',
      body: streamResponse({ tool_calls: [{ index: 0, id: 'complete', type: 'function', function: { name: 'complete_task', arguments: JSON.stringify({ summary: 'Runtime smoke complete', evidence: ['foreground exited', 'background processes started'] }) } }] }),
    });
  });

  await page.goto('/');
  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  await expect(composer).toBeEnabled();
  await expect(page.locator('.sidebar-toggle-btn.desktop-only-btn')).toBeVisible();
  await expect(page.locator('.sidebar-toggle-btn.mobile-sidebar-close')).toBeHidden();
  await page.locator('.sidebar-toggle-btn.desktop-only-btn').click();
  const leftNavigationGap = await page.locator('.sidebar.collapsed .sidebar-section').first().evaluate((element) => getComputedStyle(element).gap);
  const disabledSend = page.locator('.chat-submit');
  await expect(disabledSend).toBeDisabled();
  await expect(composer).toHaveCSS('backdrop-filter', 'blur(16px)');
  await expect(disabledSend).toHaveCSS('backdrop-filter', 'blur(16px)');
  await composer.fill('请执行完整的 WebContainer runtime smoke verification command and services test');
  await composer.press('Enter');

  await page.getByRole('button', { name: '终端' }).click();
  await page.locator('.terminal-layout-actions .terminal-icon-btn').last().click();
  const rightNavigation = page.locator('.collapsed-terminal-nav');
  await expect(rightNavigation).toBeVisible();
  expect(await rightNavigation.evaluate((element) => getComputedStyle(element).gap)).toBe(leftNavigationGap);
  await rightNavigation.getByTitle('终端').click();
  await expect(page.locator('.terminal-environment-dot')).toHaveCount(0);
  const terminalRows = page.locator('.xterm-rows').nth(1);
  await expect(terminalRows).toContainText('/containers/默认容器');
  await expect(terminalRows).not.toContainText(/\.sunam\/workspaces\/c-/);
  await expect(terminalRows).not.toContainText('//containers');

  await page.getByRole('button', { name: '服务' }).click();
  const services = page.locator('.services-panel');
  const processList = page.locator('.services-process-list');
  await expect(services.getByText('端口 3457')).toBeVisible();
  await expect(page.locator('.service-process-row')).toHaveCount(18);
  await expect(services).toHaveCSS('overflow', 'hidden');
  await expect(processList).toHaveCSS('overflow-y', 'auto');
  await expect(page.locator('.service-process-command').first()).not.toContainText('.sunam/workspaces');

  await services.getByRole('button', { name: '预览端口 3457' }).click();
  const preview = page.getByRole('dialog', { name: '端口 3457 实时预览' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('iframe')).toBeVisible();
  await expect.poll(() => preview.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), viewportWidth: innerWidth, viewportHeight: innerHeight };
  })).toEqual({ x: 0, y: 0, width: 1440, height: 900, viewportWidth: 1440, viewportHeight: 900 });
  await preview.getByRole('button', { name: '关闭预览' }).click();
  await expect(preview).toHaveCount(0);
  await expect(services).toBeVisible();

  const desktopLayout = await page.evaluate(() => {
    const list = document.querySelector('.services-process-list')!;
    const panel = document.querySelector('.terminal-content')!;
    const listBox = list.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    return { pageFits: document.documentElement.scrollHeight <= innerHeight, scrolls: list.scrollHeight > list.clientHeight, contained: listBox.bottom <= panelBox.bottom + 1 };
  });
  expect(desktopLayout).toEqual({ pageFits: true, scrolls: true, contained: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNavigation = page.getByRole('navigation', { name: '对话' });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.getByRole('button')).toHaveCount(5);
  await mobileNavigation.getByRole('button', { name: '对话' }).click();
  await expect(page.locator('.workspace-container')).toHaveAttribute('data-active-tab', 'chat');
  await page.locator('.mobile-sidebar-toggle').click();
  const mobileSidebar = page.locator('.sidebar');
  await expect(mobileSidebar).toHaveClass(/mobile-open/);
  const mobileSidebarClose = mobileSidebar.getByRole('button', { name: '收起侧栏' });
  await expect(mobileSidebarClose).toBeVisible();
  await mobileSidebarClose.click();
  await expect(mobileSidebar).not.toHaveClass(/mobile-open/);
  await expect(page.locator('.mobile-overlay')).toHaveCount(0);
  await mobileNavigation.getByRole('button', { name: '服务' }).click();
  await expect(page.locator('.workspace-container')).toHaveAttribute('data-active-tab', 'services');
  await services.getByRole('button', { name: '预览端口 3457' }).click();
  const mobilePreview = page.getByRole('dialog', { name: '端口 3457 实时预览' });
  await expect(mobilePreview).toBeVisible();
  await expect.poll(() => mobilePreview.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  })).toEqual({ width: 390, height: 844 });
  await mobilePreview.getByRole('button', { name: '关闭预览' }).click();
  const mobileLayout = await page.evaluate(() => {
    const list = document.querySelector('.services-process-list')!;
    const panel = document.querySelector('.terminal-content')!;
    const listBox = list.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    return { pageFits: document.documentElement.scrollHeight <= innerHeight, contained: listBox.bottom <= panelBox.bottom + 1 };
  });
  expect(mobileLayout).toEqual({ pageFits: true, contained: true });

  const serverProcess = page.locator('.service-process-row').filter({ hasText: '3457' });
  await serverProcess.getByRole('button').click();
  await expect(services.getByText('端口 3457')).toBeHidden();
  await expect(serverProcess).toHaveCount(0);
});
