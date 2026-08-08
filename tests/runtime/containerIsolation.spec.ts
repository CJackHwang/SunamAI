import { expect, test } from '@playwright/test';

// M6 R1 多容器隔离真实测试：两个虚拟容器（c-a、c-b）的文件系统与 cwd 互不可见。
// 关键标记均用字符码动态拼装，使标记字面量不出现在命令源码里——消息序列化后只有命令
// 实际输出才会含该 token（引号被转义的 JSON 键匹配不可靠，succinixLayer 同款手法）。
//  A_ONLY       = [65,95,79,78,76,89]
//  B_ISOLATED   = [66,95,73,83,79,76,65,84,69,68]
//  LEAKED       = [76,69,65,75,69,68]
//  OK           = [79,75]
//  BAD          = [66,65,68]

function streamResponse(delta: object): string {
  const hasToolCalls = Array.isArray((delta as { tool_calls?: unknown[] }).tool_calls) && (delta as { tool_calls: unknown[] }).tool_calls.length > 0;
  const finishReason = hasToolCalls ? 'tool_calls' : 'stop';
  return [
    `data: ${JSON.stringify({ choices: [{ delta }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}`,
    'data: [DONE]',
    '',
  ].join('\n\n');
}

function streamTools(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): string {
  return streamResponse({ tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
}

// 容器 A：写入隔离标记文件（内容经字符码拼装，命令源码不含 A_ONLY 字面量），并输出容器 A 的 SUNAM_WORKSPACE。
const SETUP_COMMAND = `node -e "const fs=require('fs');fs.writeFileSync('isolation-proof.txt',[65,95,79,78,76,89].map(c=>String.fromCharCode(c)).join(''));process.stdout.write('PATH_AT_A='+process.env.SUNAM_WORKSPACE)"`;
// 容器 B：探测容器 A 的标记文件是否可见——不可见输出 B_ISOLATED，可见输出 LEAKED。
const BOUNDARY_COMMAND = `node -e "const fs=require('fs');const iso=[66,95,73,83,79,76,65,84,69,68].map(c=>String.fromCharCode(c)).join('');const leak=[76,69,65,75,69,68].map(c=>String.fromCharCode(c)).join('');process.stdout.write(fs.existsSync('isolation-proof.txt')?leak:iso)"`;
// 输出当前容器的 SUNAM_WORKSPACE（会话 cwd 切换后应为容器 B 根）。
const PATH_AT_B_COMMAND = `node -e "process.stdout.write('PATH_AT_B='+process.env.SUNAM_WORKSPACE)"`;
// 切回容器 A：文件内容须仍为 A_ONLY（字符码校验），且 SUNAM_WORKSPACE 回到容器 A 根。
const VERIFY_A_COMMAND = `node -e "const fs=require('fs');const exp=[65,95,79,78,76,89].map(c=>String.fromCharCode(c)).join('');const ok=[79,75].map(c=>String.fromCharCode(c)).join('');const bad=[66,65,68].map(c=>String.fromCharCode(c)).join('');const act=fs.readFileSync('isolation-proof.txt','utf8').trim();process.stdout.write((act===exp?ok:bad)+'|PATH_BACK_A='+process.env.SUNAM_WORKSPACE)"`;

test('real WebContainer isolates two virtual containers (files + cwd) across switches', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'm6-isolation-no-network');
    localStorage.setItem('sunam_v2_base_url', 'https://m6-isolation.invalid/v1');
    localStorage.setItem('sunam_v2_api_model', 'm6-isolation');
  });

  // 新建容器有确认对话框：自动接受。
  page.on('dialog', (dialog) => dialog.accept());

  let turn = 0;
  let pathAtA = '';
  let pathAtB = '';

  await page.route('https://m6-isolation.invalid/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; tools?: unknown[]; messages?: Array<{ content?: unknown }> };
    if (!body.stream || !body.tools?.length) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'M6 isolation' } }] }) });
      return;
    }
    turn += 1;
    const transcript = JSON.stringify(body.messages ?? []);

    // 阶段 A（首条消息自动创建容器 A）：建标记文件并上报自身根路径。
    // complete_task 带 stopRun='completed'，其 summary 即终端消息——mock 无独立收尾 turn。
    if (turn === 1) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'plan-a', name: 'update_plan', arguments: { items: [{ id: 'a', title: 'Set up isolation marker', status: 'in_progress' }] } },
        { id: 'setup-a', name: 'run_command', arguments: { command: SETUP_COMMAND, mode: 'foreground' } },
      ]) });
      return;
    }
    if (turn === 2) {
      const match = transcript.match(/PATH_AT_A=(\/home\/workspace\/c-[A-Za-z0-9_-]+)/);
      if (!match) throw new Error('Container A did not report SUNAM_WORKSPACE.');
      pathAtA = match[1]!;
      // pi 自治循环：complete_task 不终止 run，需以纯文本收尾（stopReason='stop'）结束当前阶段。
      await route.fulfill({ contentType: 'text/event-stream', body: streamResponse({ content: 'Container A setup complete' }) });
      return;
    }

    // 阶段 B（UI 新建容器 B 后 active 为 B）：B 不可见 A 的文件，且会话 cwd 是 B 根。
    if (turn === 3) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'plan-b', name: 'update_plan', arguments: { items: [{ id: 'b', title: 'Verify boundary from container B', status: 'in_progress' }] } },
        { id: 'boundary-b', name: 'run_command', arguments: { command: BOUNDARY_COMMAND, mode: 'foreground' } },
      ]) });
      return;
    }
    if (turn === 4) {
      if (!transcript.includes('B_ISOLATED')) throw new Error('Container B observed container A file (isolation leak).');
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'path-b', name: 'run_command', arguments: { command: PATH_AT_B_COMMAND, mode: 'foreground' } },
      ]) });
      return;
    }
    if (turn === 5) {
      const match = transcript.match(/PATH_AT_B=(\/home\/workspace\/c-[A-Za-z0-9_-]+)/);
      if (!match) throw new Error('Container B did not report SUNAM_WORKSPACE.');
      pathAtB = match[1]!;
      if (pathAtB === pathAtA) throw new Error('Container B shares the same workspace root as container A.');
      await route.fulfill({ contentType: 'text/event-stream', body: streamResponse({ content: 'Isolation boundary verified from container B' }) });
      return;
    }

    // 阶段 C（切回容器 A）：标记文件仍在、会话 cwd 回到 A 根。
    if (turn === 6) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'plan-a2', name: 'update_plan', arguments: { items: [{ id: 'a2', title: 'Verify container A marker after switch', status: 'in_progress' }] } },
        { id: 'verify-a', name: 'run_command', arguments: { command: VERIFY_A_COMMAND, mode: 'foreground' } },
      ]) });
      return;
    }
    if (turn === 7) {
      if (!transcript.includes('OK|PATH_BACK_A=')) throw new Error('Container A lost its isolation marker after switching away and back.');
      const back = transcript.match(/PATH_BACK_A=(\/home\/workspace\/c-[A-Za-z0-9_-]+)/)?.[1] ?? '';
      if (back !== pathAtA) throw new Error('Container A cwd changed after switching containers.');
      await route.fulfill({ contentType: 'text/event-stream', body: streamResponse({ content: 'Container A retains its marker after switching' }) });
      return;
    }
    throw new Error(`Unexpected model turn ${turn} in container isolation test.`);
  });

  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');
  const assistantMessage = page.locator('.chat-message[data-role="assistant"] .markdown-paragraph');

  // ── 阶段 A：容器 A 建标记文件 ──
  await page.goto('/');
  await expect(composer).toBeEnabled();
  await composer.fill('Set up an isolation marker file in this container.');
  await composer.press('Enter');
  await expect(assistantMessage.filter({ hasText: /^Container A setup complete$/ })).toBeVisible({ timeout: 100_000 });

  // ── 展开侧栏（桌面默认已展开），读取容器 A id，新建容器 B（自动切为 active）──
  const containersSection = page.locator('.sidebar-section').filter({ hasText: '容器' });
  await expect(containersSection.locator('.sidebar-item')).toHaveCount(1);
  const containerAId = await containersSection.locator('.sidebar-item').getAttribute('data-reorder-key');
  expect(containerAId).toMatch(/^c-[A-Za-z0-9_-]+$/);
  await containersSection.locator('.sidebar-icon-btn').click();
  await expect(containersSection.locator('.sidebar-item')).toHaveCount(2);
  // 新容器创建后 active 自动指向 B。
  const containerBId = await containersSection.locator('.sidebar-item.active').getAttribute('data-reorder-key');
  expect(containerBId).toMatch(/^c-[A-Za-z0-9_-]+$/);
  expect(containerBId).not.toBe(containerAId);

  // ── 阶段 B：容器 B 不可见 A 的文件，cwd 是 B 根 ──
  await composer.fill('Check the isolation boundary from this container.');
  await composer.press('Enter');
  await expect(assistantMessage.filter({ hasText: /^Isolation boundary verified from container B$/ })).toBeVisible({ timeout: 100_000 });

  // ── 阶段 C：切回容器 A，标记文件仍在、cwd 回到 A 根 ──
  await containersSection.locator(`.sidebar-item[data-reorder-key="${containerAId}"]`).click();
  await expect(containersSection.locator('.sidebar-item.active')).toHaveAttribute('data-reorder-key', containerAId!);
  await composer.fill('Verify this container still has its marker file.');
  await composer.press('Enter');
  await expect(assistantMessage.filter({ hasText: /^Container A retains its marker after switching$/ })).toBeVisible({ timeout: 100_000 });
});
