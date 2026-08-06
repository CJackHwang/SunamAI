import { expect, test } from '@playwright/test';

// M3 R3 刷新恢复端到端验证（双层快照协调）：
//   创建工作区文件（v3 权威）+ 改 Succinix /etc 状态 + 装纯 py 包（.pyodide，Succinix 文件快照权威）
//   → 等待系统层快照落盘 → 刷新 → 三者都在 + v3 revision 正确。
// 纯 py 包用直接写 .pyodide/site-packages + installed.json 模拟 pip 结果（等价于 pip install
// 的落盘效果，避免测试依赖外网 PyPI；持久化机制与真实 pip 包一致）。

function streamResponse(delta: object): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
}

function streamTools(calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): string {
  return streamResponse({ tool_calls: calls.map((call, index) => ({ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
}

// 创建命令：工作区文件（cwd=容器根，v3 收录）+ /etc + .pyodide（HOME 绝对路径，Succinix 文件快照收录）。
const CREATE_COMMAND = `mkdir -p project && echo "hello" > project/app.txt && node -e "const fs=require('fs');const h=process.env.HOME;fs.mkdirSync(h+'/etc',{recursive:true});fs.writeFileSync(h+'/etc/succinix.env','M3_TEST_VAR=1\\n');fs.mkdirSync(h+'/.pyodide/site-packages',{recursive:true});fs.writeFileSync(h+'/.pyodide/site-packages/m3pkg.py','VALUE = 42\\n');fs.writeFileSync(h+'/.pyodide/installed.json',JSON.stringify({packages:['m3pkg']}))"`;

// 验证命令：检查三者都在（含 .pyodide/installed.json），输出 JSON + 稳定标记。
// 标记用字符码动态拼接（M3_OK / M3_X），使标记字面量不出现在命令源码里 —— 消息序列化后
// 只有命令实际输出才会含该 token，模型侧判定才可靠（引号被转义的 JSON 键匹配不可靠）。
const VERIFY_COMMAND = `node -e "const fs=require('fs');const h=process.env.HOME;const r={workspace:fs.existsSync('project/app.txt'),etc:fs.existsSync(h+'/etc/succinix.env'),pyodide:fs.existsSync(h+'/.pyodide/site-packages/m3pkg.py'),installed:fs.existsSync(h+'/.pyodide/installed.json')};const ok=r.workspace&&r.etc&&r.pyodide;const okTag=[77,51,95,79,75].map(c=>String.fromCharCode(c)).join('');const badTag=[77,51,95,88].map(c=>String.fromCharCode(c)).join('');process.stdout.write(JSON.stringify(r)+(ok?okTag:badTag));if(!ok)process.exit(1)"`;

test('refresh keeps workspace + /etc state + .pyodide package, with a correct v3 revision', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'm3-snapshot-no-network');
    localStorage.setItem('sunam_v2_base_url', 'https://m3-snapshot.invalid/v1');
    localStorage.setItem('sunam_v2_api_model', 'm3-snapshot');
  });

  let turn = 0;
  await page.route('https://m3-snapshot.invalid/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON() as { stream?: boolean; messages?: Array<{ content: unknown }> };
    if (!body.stream) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'M3 snapshot' } }] }) });
      return;
    }
    turn += 1;
    // Phase 1（首次加载）：创建三类数据。
    if (turn === 1) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'plan', name: 'update_plan', arguments: { items: [{ id: 'create', title: 'Create data across both snapshot layers', status: 'in_progress' }] } },
        { id: 'create', name: 'shell_run', arguments: { command: CREATE_COMMAND, mode: 'foreground' } },
      ]) });
      return;
    }
    if (turn === 2) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'plan-done', name: 'update_plan', arguments: { items: [{ id: 'create', title: 'Create data across both snapshot layers', status: 'completed' }] } },
        { id: 'complete', name: 'complete_task', arguments: { summary: 'Created workspace, /etc state, and .pyodide package.', evidence: ['phase 1 files written.'] } },
      ]) });
      return;
    }
    // Phase 2（刷新后）：验证三类数据都恢复。命令输出 M3_OK（全部命中）或 M3_X（有缺失），
    // 两者都只出现在命令输出里（源码用字符码拼 token，不落字面量），判定稳定。
    const transcript = JSON.stringify(body.messages ?? []);
    if (transcript.includes('M3_OK')) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'plan-verify-done', name: 'update_plan', arguments: { items: [{ id: 'verify', title: 'Verify refresh recovery', status: 'completed' }] } },
        { id: 'complete', name: 'complete_task', arguments: { summary: 'Refresh recovery verified.', evidence: ['Workspace, /etc state, and .pyodide package survived the refresh.'] } },
      ]) });
      return;
    }
    if (transcript.includes('M3_X')) {
      await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
        { id: 'plan-verify-fail', name: 'update_plan', arguments: { items: [{ id: 'verify', title: 'Verify refresh recovery', status: 'failed' }] } },
        { id: 'complete', name: 'complete_task', arguments: { summary: 'Refresh recovery FAILED: a required file is missing.', evidence: ['M3_X marker observed.'] } },
      ]) });
      return;
    }
    await route.fulfill({ contentType: 'text/event-stream', body: streamTools([
      { id: 'plan-verify', name: 'update_plan', arguments: { items: [{ id: 'verify', title: 'Verify refresh recovery', status: 'in_progress' }] } },
      { id: 'verify', name: 'shell_run', arguments: { command: VERIFY_COMMAND, mode: 'foreground' } },
    ]) });
    return;
  });

  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');

  // ─── Phase 1：创建数据 ───
  await page.goto('/');
  await expect(composer).toBeEnabled();
  await composer.fill('Create a workspace project, set Succinix env state, and install a pure-Python package.');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph')
    .filter({ hasText: /^Created workspace, \/etc state, and \.pyodide package\.$/ }))
    .toBeVisible({ timeout: 100_000 });

  // 等待系统层快照落盘（succinix-persist 含 /etc/succinix.env 与 .pyodide/site-packages/m3pkg.py）。
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('succinix-persist', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const record = await new Promise<any>((resolve, reject) => {
      const req = db.transaction('snapshots', 'readonly').objectStore('snapshots').get('current');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const files = (record?.files ?? []) as Array<{ path: string }>;
    return {
      etc: files.some((f) => f.path === '/etc/succinix.env'),
      pyodide: files.some((f) => f.path === '/.pyodide/site-packages/m3pkg.py'),
      installed: files.some((f) => f.path === '/.pyodide/installed.json'),
      fileCount: (record?.meta?.fileCount as number) ?? 0,
    };
  })).toMatchObject({ etc: true, pyodide: true, installed: true });
  const succinixFileCount = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('succinix-persist', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const record = await new Promise<any>((resolve, reject) => {
      const req = db.transaction('snapshots', 'readonly').objectStore('snapshots').get('current');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return (record?.meta?.fileCount as number) ?? 0;
  });
  expect(succinixFileCount).toBeGreaterThanOrEqual(3);

  // v3 工作区快照已收录 project/app.txt 且 revision 正确（agent 验证证据依赖 revision）。
  const v3 = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sunam-v3');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['workspace', 'snapshots'], 'readonly');
    const workspace = await new Promise<any>((resolve, reject) => {
      const req = tx.objectStore('workspace').get('current');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const record = await new Promise<any>((resolve, reject) => {
      const req = tx.objectStore('snapshots').get(workspace?.payload?.activeContainerId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return {
      revision: record?.payload?.revision,
      treeKeys: Object.keys(record?.payload?.tree ?? {}),
      hasAppTxt: Boolean(record?.payload?.tree?.project?.directory?.['app.txt']),
      rootHasEtc: Boolean(record?.payload?.tree?.etc), // v3 快照不应包含系统层（职责分离）
    };
  });
  expect(v3.revision).toBeGreaterThan(0);
  expect(v3.treeKeys).toContain('project');
  expect(v3.hasAppTxt).toBe(true);
  expect(v3.rootHasEtc).toBe(false);

  // ─── 刷新：双层恢复 ───
  await page.reload();
  await expect(composer).toBeEnabled({ timeout: 100_000 });

  // ─── Phase 2：验证恢复 ───
  await composer.fill('Verify that the workspace project, Succinix env state, and pure-Python package all survived the refresh.');
  await composer.press('Enter');
  await expect(page.locator('.chat-message[data-role="assistant"] .markdown-paragraph')
    .filter({ hasText: /^Refresh recovery verified\.$/ }))
    .toBeVisible({ timeout: 100_000 });
});
