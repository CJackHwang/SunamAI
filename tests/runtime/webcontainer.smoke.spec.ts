import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function readZipEntryNames(archive: Uint8Array): string[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const names: string[] = [];
  for (let offset = 0; offset <= archive.byteLength - 46;) {
    if (view.getUint32(offset, true) !== 0x02014b50) { offset += 1; continue; }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    names.push(decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function streamResponse(delta: object): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
}

function streamTools(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): string {
  return streamResponse({ tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
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
    const request = route.request().postDataJSON() as { stream?: boolean; tools?: unknown[]; messages?: Array<{ role?: string; content?: unknown }> };
    if (!request.stream || !request.tools?.length) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Runtime smoke' } }] }) });
      return;
    }
    modelTurn += 1;
    if (modelTurn === 1) {
      // 共享文件改由 agent 路径（shell_run → runShell）创建：用户终端无交互 stdin（物理边界），
      // 不再像 jsh 时代用终端键入命令落盘。cwd/env 语义由第二轮前台命令断言。
      const createSharedFiles = {
        index: 1,
        id: 'create-shared-files',
        type: 'function' as const,
        function: {
          name: 'shell_run',
          arguments: JSON.stringify({
            command: 'mkdir -p user-created/from-terminal node_modules/pkg dist && echo terminal > user-created/from-terminal/proof.txt && echo hidden > .hidden-export && echo dependency > node_modules/pkg/export.txt && echo build > dist/export.js',
            mode: 'foreground',
          }),
        },
      };
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
          { index: 0, id: 'plan', type: 'function', function: { name: 'update_plan', arguments: JSON.stringify({ items: [{ id: 'runtime', title: 'Runtime smoke', status: 'in_progress' }] }) } },
          createSharedFiles,
          ...backgroundCalls,
          { index: 20, id: 'tree', type: 'function', function: { name: 'workspace_tree', arguments: JSON.stringify({ max_depth: 4 }) } },
          { index: 21, id: 'write-shared', type: 'function', function: { name: 'apply_patch', arguments: JSON.stringify({ changes: [{ path: 'user-created/from-agent.txt', content: 'shared-agent-file' }] }) } },
        ] }),
      });
      return;
    }
    if (modelTurn === 2) {
      const transcript = JSON.stringify(request.messages ?? []);
      if (!transcript.includes('user-created/from-terminal/proof.txt')) throw new Error('Agent workspace_tree did not observe the shared container root file.');
      await route.fulfill({
        contentType: 'text/event-stream',
        body: streamTools([{ id: 'verify-shared-root', name: 'shell_run', arguments: { command: 'pwd && node -e "const fs=require(\'fs\');const root=process.env.SUNAM_WORKSPACE;if(process.cwd()!==root||process.env.HOME!==\'/home/workspace\'||!fs.existsSync(\'user-created/from-terminal/proof.txt\')||!fs.existsSync(\'user-created/from-agent.txt\'))process.exit(1);process.stdout.write(fs.readFileSync(root+\'/user-created/from-agent.txt\',\'utf8\'))"', mode: 'foreground' } }]),
      });
      return;
    }
    if (modelTurn === 3) {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: streamTools([{ id: 'plan-complete', name: 'update_plan', arguments: { items: [{ id: 'runtime', title: 'Runtime smoke', status: 'completed' }] } }]),
      });
      return;
    }
    await route.fulfill({
      contentType: 'text/event-stream',
      body: streamResponse({ content: 'Runtime smoke complete' }),
    });
  });

  await page.goto('/');
  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  await expect(composer).toBeEnabled();
  await expect(page.locator('.sidebar-toggle-btn.desktop-only-btn')).toBeVisible();
  await expect(page.locator('.sidebar-toggle-btn.mobile-sidebar-close')).toBeHidden();
  await page.locator('.sidebar-toggle-btn.desktop-only-btn').click();
  const leftNavigation = page.locator('.sidebar.collapsed');
  await expect(leftNavigation).toHaveCSS('width', '60px');
  const leftNavigationSection = leftNavigation.locator('.sidebar-section').first();
  const leftNavigationControl = leftNavigation.locator('.sidebar-action-btn').first();
  const leftRailStyles = await leftNavigation.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { width: styles.width, backgroundColor: styles.backgroundColor, separatorWidth: styles.borderRightWidth, separatorColor: styles.borderRightColor };
  });
  const leftControlStyles = await leftNavigationControl.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { width: styles.width, height: styles.height, borderRadius: styles.borderRadius };
  });
  const leftNavigationGap = await leftNavigationSection.evaluate((element) => getComputedStyle(element).gap);
  await leftNavigationControl.hover();
  await expect(leftNavigationControl).toHaveCSS('background-color', 'rgb(245, 245, 247)');
  const leftControlHover = await leftNavigationControl.evaluate((element) => getComputedStyle(element).backgroundColor);
  const disabledSend = page.locator('.chat-submit');
  await expect(disabledSend).toBeDisabled();
  await expect(composer).toHaveCSS('backdrop-filter', 'blur(22px) saturate(1.6)');
  await expect(disabledSend).toHaveCSS('backdrop-filter', 'blur(22px) saturate(1.6)');
  await page.getByRole('button', { name: 'Sunam的电脑' }).click();
  await page.locator('.terminal-capsule').getByRole('tab', { name: '终端' }).click();
  const workspace = page.locator('.workspace-container');
  const terminalSection = page.locator('.terminal-section');
  await expect(page.locator('.model-selector-header')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.model-selector-header')).toHaveCSS('opacity', '1');
  const workspaceWidth = await workspace.evaluate((element) => element.getBoundingClientRect().width);
  await expect.poll(() => terminalSection.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(workspaceWidth * 0.45);
  const halfTerminalWidth = await terminalSection.evaluate((element) => element.getBoundingClientRect().width);
  await page.getByTitle('全屏模式').click();
  await expect(workspace).toHaveAttribute('data-layout', 'full');
  await expect(terminalSection).toHaveCSS('transition-duration', '0.36s');
  await expect(page.locator('.model-selector-header')).toHaveCSS('opacity', '0');
  await expect.poll(() => terminalSection.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(halfTerminalWidth * 1.9);
  await expect.poll(() => page.locator('.chat-section').evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(2);
  await page.getByTitle('半屏模式').click();
  await expect(workspace).toHaveAttribute('data-layout', 'half');
  await expect(page.locator('.model-selector-header')).toHaveCSS('animation-name', 'workspace-model-header-settle');
  await expect.poll(() => terminalSection.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(halfTerminalWidth * 1.1);
  await page.locator('.terminal-layout-actions .terminal-icon-btn').last().click();
  const rightNavigation = page.locator('.collapsed-terminal-nav');
  await expect(rightNavigation).toBeVisible();
  const rightNavigationControl = rightNavigation.locator('.right-sidebar-btn:not(.active)').first();
  expect(await rightNavigation.evaluate((element) => getComputedStyle(element).gap)).toBe(leftNavigationGap);
  await expect(rightNavigation).toHaveCSS('width', leftRailStyles.width);
  await expect(rightNavigation).toHaveCSS('background-color', leftRailStyles.backgroundColor);
  await expect(rightNavigation).toHaveCSS('border-left-width', leftRailStyles.separatorWidth);
  await expect(rightNavigation).toHaveCSS('border-left-color', leftRailStyles.separatorColor);
  await expect(rightNavigation).toHaveCSS('box-shadow', 'none');
  await expect(rightNavigation).toHaveCSS('backdrop-filter', 'none');
  await expect(rightNavigationControl).toHaveCSS('width', leftControlStyles.width);
  await expect(rightNavigationControl).toHaveCSS('height', leftControlStyles.height);
  await expect(rightNavigationControl).toHaveCSS('border-radius', leftControlStyles.borderRadius);
  await rightNavigationControl.hover();
  await expect(rightNavigationControl).toHaveCSS('background-color', leftControlHover);
  await rightNavigation.getByTitle('Sunam的电脑').click();
  await page.locator('.terminal-capsule').getByRole('tab', { name: '终端' }).click();
  await expect(page.locator('.terminal-environment-dot')).toHaveCount(0);
  const terminalRows = page.locator('.xterm-rows').nth(1);
  await expect(terminalRows).not.toContainText(/\.sunam\/workspaces\/c-/);
  await expect(page.locator('.terminal-environment-path')).toHaveCount(0);

  // 用户终端无交互 stdin（Succinix 文件 RPC 物理边界）：终端是"读输出"横幅，不能再键入命令。
  // 断言横幅出现；共享文件与 cwd/env 语义改由 agent 路径（shell_run → runShell）验证。
  await expect(terminalRows).toContainText('Succinix terminal ready');

  await composer.fill('请执行完整的 WebContainer runtime smoke verification command and services test');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph')
    .filter({ hasText: /^Runtime smoke complete$/ }))
    .toHaveCount(1, { timeout: 100_000 });

  // 用户终端不可交互（物理边界），from-agent.txt 的存在改由下方文件管理器与 zip 校验断言。

  await page.locator('.terminal-capsule').getByRole('tab', { name: '文件' }).click();
  await expect(page.locator('.fm-breadcrumb')).toHaveText('/');
  await expect(page.locator('.fm-item-name').filter({ hasText: /^user-created$/ })).toBeVisible();
  await expect(page.locator('.fm-item-name').filter({ hasText: /^\.jshrc$/ })).toHaveCount(0);
  await expect(page.locator('.fm-toolbar .fm-toolbar-btn')).toHaveCount(2);
  await page.locator('.fm-item').filter({ has: page.locator('.fm-item-name', { hasText: /^user-created$/ }) }).dblclick();
  const agentFile = page.locator('.fm-item').filter({ has: page.locator('.fm-item-name', { hasText: /^from-agent\.txt$/ }) });
  await expect(agentFile.locator('.fm-item-size')).toHaveText('17 B');
  await page.getByRole('button', { name: '更多文件操作' }).click();
  const toolsMenu = page.getByRole('menu', { name: '更多文件操作' });
  await expect(toolsMenu.getByRole('menuitem')).toHaveCount(4);
  const downloadPromise = page.waitForEvent('download');
  await toolsMenu.getByRole('menuitem', { name: '导出完整工作区' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^c-[a-z0-9_-]+\.zip$/);
  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();
  const zipEntries = readZipEntryNames(await readFile(archivePath!));
  expect(zipEntries.some((name) => name.endsWith('.hidden-export'))).toBe(true);
  expect(zipEntries.some((name) => name.endsWith('node_modules/pkg/export.txt'))).toBe(true);
  expect(zipEntries.some((name) => name.endsWith('dist/export.js'))).toBe(true);
  expect(zipEntries.some((name) => name.endsWith('user-created/from-terminal/proof.txt'))).toBe(true);
  await page.locator('.fm-parent-item').dblclick();
  await expect(page.locator('.fm-breadcrumb')).toHaveText('/');

  await page.getByTitle('Expand Sidebar').click();
  const containers = page.locator('.sidebar-section').filter({ hasText: '容器' });
  const activeContainer = containers.locator('.sidebar-item.active');
  await activeContainer.locator('.item-action').click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  const containerEditor = containers.locator('.sidebar-item-input');
  await expect(activeContainer).toHaveClass(/is-editing/);
  expect(await containerEditor.evaluate((input) => {
    const inputStyles = getComputedStyle(input);
    const rowStyles = getComputedStyle(input.closest('.sidebar-item')!);
    return { inputOutlineStyle: inputStyles.outlineStyle, rowBoxShadow: rowStyles.boxShadow };
  })).toEqual({ inputOutlineStyle: 'none', rowBoxShadow: 'rgb(0, 122, 255) 0px 0px 0px 2px inset' });
  await containerEditor.fill('Runtime renamed container');
  await containerEditor.press('Enter');
  await expect(activeContainer).toContainText('Runtime renamed container');
  await expect(page.locator('.terminal-environment-path')).toHaveCount(0);
  await expect(page.locator('.fm-breadcrumb')).toHaveText('/');
  await expect(page.locator('.fm-item-name').filter({ hasText: /^user-created$/ })).toBeVisible();

  await page.locator('.dual-terminal-tabs').getByRole('button', { name: 'Sunam的电脑' }).click();
  await page.locator('.terminal-capsule').getByRole('tab', { name: '服务' }).click();
  const services = page.locator('.services-panel');
  const processList = page.locator('.services-process-list');
  await expect(services.getByText('端口 3457')).toBeVisible();
  // M1 后 NODE_OPTIONS hook 已移除（M2 端口对齐未做）：端口经 server-ready 检出但无 listener 记录，
  // 以 identifying → orphaned 呈现而非 managed——只有预览可用，"停止端口"按钮属 M2 语义。
  await expect(services.getByRole('button', { name: '预览端口 3457' })).toBeVisible();
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
  await expect(mobileNavigation.getByRole('button')).toHaveCount(3);
  await mobileNavigation.getByRole('button', { name: '对话' }).click();
  await expect(page.locator('.workspace-container')).toHaveAttribute('data-active-tab', 'chat');
  await expect(composer).toHaveCSS('backdrop-filter', 'blur(14px) saturate(1.6)');
  const ordinaryMobileMaterial = await composer.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { borderColor: styles.borderTopColor, backdrop: styles.backdropFilter };
  });
  expect(ordinaryMobileMaterial.borderColor).not.toBe('rgb(0, 0, 0)');
  expect(ordinaryMobileMaterial.backdrop).toBe('blur(14px) saturate(1.6)');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(composer).toHaveCSS('backdrop-filter', 'none');
  const forcedMaterial = await composer.evaluate((element) => {
    const styles = getComputedStyle(element);
    return { borderStyle: styles.borderTopStyle, backgroundColor: styles.backgroundColor };
  });
  expect(forcedMaterial.borderStyle).toBe('solid');
  expect(forcedMaterial.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  await page.emulateMedia({ forcedColors: 'none' });
  await composer.focus();
  await mobileNavigation.getByRole('button', { name: 'Sunam的电脑' }).click();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea'))).toBe(false);
  await mobileNavigation.getByRole('button', { name: '对话' }).click();
  await page.locator('.mobile-sidebar-toggle').click();
  const mobileSidebar = page.locator('.sidebar');
  await expect(mobileSidebar).toHaveClass(/mobile-open/);
  const mobileSidebarClose = mobileSidebar.getByRole('button', { name: '收起侧栏' });
  await expect(mobileSidebarClose).toBeVisible();
  await mobileSidebarClose.click();
  await expect(mobileSidebar).not.toHaveClass(/mobile-open/);
  await expect(page.locator('.mobile-overlay')).toHaveCount(0);
  await mobileNavigation.getByRole('button', { name: 'Sunam的电脑' }).click();
  await page.locator('.terminal-capsule').getByRole('tab', { name: '服务' }).click();
  await expect(page.locator('.workspace-container')).toHaveAttribute('data-active-tab', 'ai');
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

  // 端口未 managed 时无"停止端口"按钮；经进程行终止服务器进程，验证端口随之关闭
  //（stopProcess → host kill 子进程 → WebContainer port close → closePort）。
  const serverProcess = page.locator('.service-process-row').filter({ hasText: '3457' });
  await serverProcess.locator('.icon-button-danger').click();
  await expect(services.getByText('端口 3457')).toBeHidden();
  await expect(serverProcess).toHaveCount(0);
  await expect(page.locator('.service-process-row')).toHaveCount(17);

  // Files now lives inside the merged computer page and is reached through the capsule.
  await page.locator('.terminal-capsule').getByRole('tab', { name: '文件' }).click();
  await expect(page.locator('.workspace-container')).toHaveAttribute('data-active-tab', 'ai');
  await page.locator('.fm-item').filter({ has: page.locator('.fm-item-name', { hasText: /^user-created$/ }) }).dblclick();
  const mobileAgentFile = page.locator('.fm-item').filter({ has: page.locator('.fm-item-name', { hasText: /^from-agent\.txt$/ }) });
  const mobileSize = mobileAgentFile.locator('.fm-item-size');
  const mobileMenu = mobileAgentFile.locator('.fm-item-menu');
  await expect(mobileSize).toHaveText('17 B');
  await expect(mobileSize).toBeVisible();
  const [mobileSizeBox, mobileMenuBox] = await Promise.all([mobileSize.boundingBox(), mobileMenu.boundingBox()]);
  expect(mobileSizeBox).not.toBeNull();
  expect(mobileMenuBox).not.toBeNull();
  expect(mobileSizeBox!.x + mobileSizeBox!.width).toBeLessThanOrEqual(mobileMenuBox!.x);
});

test('real WebContainer materializes a resource and excludes generated directories before snapshot serialization', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'runtime-resource-no-network');
    localStorage.setItem('sunam_v2_base_url', 'https://runtime-resource.invalid/v1');
    localStorage.setItem('sunam_v2_api_model', 'runtime-resource');
  });
  let turn = 0;
  await page.route('https://runtime-resource.invalid/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Runtime resource' } }] }) });
      return;
    }
    turn += 1;
    if (turn === 1) {
      const transcript = JSON.stringify(body.messages ?? []);
      const resourceId = transcript.match(/file resource: (res-[0-9a-f-]+)/i)?.[1];
      if (!resourceId) throw new Error('Runtime fixture did not receive a resource id.');
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'plan', name: 'update_plan', arguments: { items: [{ id: 'resource', title: 'Materialize and verify resource', status: 'in_progress' }] } },
        { id: 'materialize', name: 'materialize_resource', arguments: { resource_id: resourceId, path: 'package.json' } },
      ]) });
      return;
    }
    if (turn === 2) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([{ id: 'verify', name: 'shell_run', arguments: { command: 'npm test', mode: 'foreground' } }]) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
      { id: 'plan-done', name: 'update_plan', arguments: { items: [{ id: 'resource', title: 'Materialize and verify resource', status: 'completed' }] } },
      { id: 'complete', name: 'complete_task', arguments: { summary: 'Resource materialized and snapshot filtered.', evidence: ['npm test passed in the materialized project.'] } },
    ]) });
  });

  await page.goto('/');
  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  await expect(composer).toBeEnabled();
  const packageJson = JSON.stringify({ scripts: { test: "mkdir -p node_modules/pkg dist src && echo ignored > node_modules/pkg/a.txt && echo built > dist/a.js && echo kept > src/kept.txt" } });
  await page.locator('.chat-composer-shell input[type="file"]').setInputFiles({ name: 'package.json', mimeType: 'application/json', buffer: Buffer.from(packageJson) });
  await composer.fill('Materialize this project resource, run its verification, and preserve only source workspace data in the durable snapshot.');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph')
    .filter({ hasText: /^Resource materialized and snapshot filtered\.$/ }))
    .toBeVisible({ timeout: 100_000 });

  const snapshot = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sunam-v3');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['workspace', 'snapshots'], 'readonly');
    const workspace = await new Promise<any>((resolve, reject) => {
      const request = transaction.objectStore('workspace').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = await new Promise<any>((resolve, reject) => {
      const request = transaction.objectStore('snapshots').get(workspace?.payload?.activeContainerId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const tree = record?.payload?.tree ?? {};
    return {
      rootEntries: Object.keys(tree),
      srcEntries: Object.keys(tree.src?.directory ?? {}),
      revision: record?.payload?.revision,
      fileCount: record?.payload?.fileCount,
      byteSize: record?.payload?.byteSize,
    };
  });
  expect(snapshot.rootEntries).toContain('src');
  expect(snapshot.srcEntries).toContain('kept.txt');
  expect(snapshot.rootEntries).not.toContain('node_modules');
  expect(snapshot.rootEntries).not.toContain('dist');
  expect(snapshot.revision).toBeGreaterThan(0);
  expect(snapshot.fileCount).toBeGreaterThan(0);
  expect(snapshot.byteSize).toBeGreaterThan(0);
});

test('real WebContainer cascades parent cancellation into a task child process', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'runtime-child-no-network');
    localStorage.setItem('sunam_v2_base_url', 'https://runtime-child.invalid/v1');
    localStorage.setItem('sunam_v2_api_model', 'runtime-child');
  });
  let rootTurn = 0;
  await page.route('https://runtime-child.invalid/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ role: string; content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Runtime child' } }] }) });
      return;
    }
    const lastUser = [...(body.messages ?? [])].reverse().find((message) => message.role === 'user');
    if (String(lastUser?.content).includes('Run the long verification command.')) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([{ id: 'child-shell', name: 'shell_run', arguments: { command: 'npm test', mode: 'foreground', timeout_ms: 300_000 } }]) });
      return;
    }
    rootTurn += 1;
    if (rootTurn === 1) {
      const transcript = JSON.stringify(body.messages ?? []);
      const resourceId = transcript.match(/file resource: (res-[0-9a-f-]+)/i)?.[1];
      if (!resourceId) throw new Error('Cancellation fixture did not receive a resource id.');
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'plan', name: 'update_plan', arguments: { items: [{ id: 'cancel', title: 'Start and cancel child verification', status: 'in_progress' }] } },
        { id: 'materialize', name: 'materialize_resource', arguments: { resource_id: resourceId, path: 'package.json' } },
        { id: 'spawn', name: 'spawn_subagent', arguments: { task_id: 'long-verify', role: 'task', prompt: 'Run the long verification command.' } },
      ]) });
      return;
    }
    const runId = JSON.stringify(body.messages ?? []).match(/r-child-[0-9a-f-]{20,}/i)?.[0];
    if (!runId) throw new Error('Cancellation fixture did not receive a child run id.');
    await route.fulfill({ contentType: 'text/event-stream', body: streamTools([{ id: 'wait', name: 'wait_subagents', arguments: { run_ids: [runId] } }]) });
  });

  await page.goto('/');
  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  await expect(composer).toBeEnabled();
  const packageJson = JSON.stringify({ scripts: { test: 'node -e "setInterval(()=>{},1000)"' } });
  await page.locator('.chat-composer-shell input[type="file"]').setInputFiles({ name: 'package.json', mimeType: 'application/json', buffer: Buffer.from(packageJson) });
  await composer.fill('Start a task child using this project resource, then wait while its long verification command runs.');
  await composer.press('Enter');
  await page.getByRole('button', { name: 'Sunam的电脑' }).click();
  await page.locator('.terminal-capsule').getByRole('tab', { name: '服务' }).click();
  await expect(page.locator('.service-process-row')).toHaveCount(1, { timeout: 100_000 });
  await page.getByRole('button', { name: '停止主 Agent' }).click();
  await expect(page.locator('.service-process-row')).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(async () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sunam-v3');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(['runs', 'agentTasks'], 'readonly');
    const runs = await new Promise<any[]>((resolve, reject) => {
      const request = transaction.objectStore('runs').getAll();
      request.onsuccess = () => resolve(request.result.map((record) => record.payload));
      request.onerror = () => reject(request.error);
    });
    const tasks = await new Promise<any[]>((resolve, reject) => {
      const request = transaction.objectStore('agentTasks').getAll();
      request.onsuccess = () => resolve(request.result.map((record) => record.payload));
      request.onerror = () => reject(request.error);
    });
    database.close();
    return {
      rootCancelled: runs.some((run) => run.agentRole === 'root' && run.phase === 'cancelled'),
      childCancelled: runs.some((run) => run.agentRole === 'task' && run.phase === 'cancelled'),
      taskCancelled: tasks.some((task) => task.role === 'task' && task.status === 'cancelled'),
    };
  })).toEqual({ rootCancelled: true, childCancelled: true, taskCancelled: true });
});
