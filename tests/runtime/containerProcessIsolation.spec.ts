import { expect, test } from '@playwright/test';

// TASK-CISOL R2/R3 真实 WC 验收：两容器进程互不可见 + 跨容器 kill 拒绝。
// 直接经 ?sunam_test=1 暴露的 window.__sunamRuntime 驱动真实 runtime（不依赖 LLM/agent 链路）：
//  - 容器 A 后台 spawn 长驻进程 P_A（node setInterval，命令含唯一标记 cisol-pa）
//  - A 的 getSuccinixProcesses('c-a') 可见 P_A（scope=container + containerId=c-a + 真实 pid）
//  - 新建容器 B 后 getSuccinixProcesses('c-b') 不可见 P_A（互不可见）
//  - B 侧 stopProcessByPid(pidA, 'c-b') 拒绝（"belongs to another container"），且 P_A 仍存活
//  - A 侧 stopProcessByPid(pidA, 'c-a') 可 kill（本容器进程）

interface ProcViewLike { command?: string; pid?: number; scope?: string; containerId?: string }

interface SunamRuntimeHook {
  runtime: {
    runShell(request: { command: string; mode: 'foreground' | 'background'; sessionId: string; runId: string; containerId: string }): Promise<{ process: { id: string } }>;
    getSuccinixProcesses(containerId: string): Promise<ProcViewLike[]>;
    stopProcessByPid(pid: number, containerId?: string): Promise<{ ok: boolean; message: string }>;
  };
}

const SPAWN_COMMAND = `node -e "process.title='cisol-pa';setInterval(()=>{},1e9)"`;

async function spawnIn(page: import('@playwright/test').Page, containerId: string): Promise<void> {
  await page.evaluate(async ({ command, cid }) => {
    const inst = (window as unknown as { __sunamRuntime?: SunamRuntimeHook }).__sunamRuntime!;
    await inst.runtime.runShell({ command, mode: 'background', sessionId: 'cisol-s', runId: 'cisol-r', containerId: cid });
  }, { command: SPAWN_COMMAND, cid: containerId });
}

async function runtimeProcs(page: import('@playwright/test').Page, containerId: string): Promise<ProcViewLike[]> {
  return page.evaluate(async (cid) => (window as unknown as { __sunamRuntime?: SunamRuntimeHook }).__sunamRuntime!.runtime.getSuccinixProcesses(cid), containerId);
}

async function stopByPid(page: import('@playwright/test').Page, pid: number, containerId: string | null): Promise<{ ok: boolean; message: string }> {
  return page.evaluate(async ({ pid: targetPid, cid }) => {
    const inst = (window as unknown as { __sunamRuntime?: SunamRuntimeHook }).__sunamRuntime!;
    return inst.runtime.stopProcessByPid(targetPid, cid ?? undefined);
  }, { pid, cid: containerId });
}

test('real WebContainer isolates two containers at the process level (TASK-CISOL R2/R3)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'cisol-no-network');
    localStorage.setItem('sunam_v2_base_url', 'https://cisol.invalid/v1');
    localStorage.setItem('sunam_v2_api_model', 'cisol-isolation');
  });
  page.on('dialog', (dialog) => dialog.accept());
  // 无 LLM 依赖：拦截可能的请求，避免真实网络。
  await page.route('https://cisol.invalid/v1/chat/completions', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' } }] }),
  }));

  const composer = page.locator('textarea[placeholder="问 Sunam 任何问题..."]');

  // ── 阶段 A：容器 A 后台 spawn 长驻进程 P_A ──
  await page.goto('/?sunam_test=1');
  await expect(composer).toBeEnabled({ timeout: 90_000 });

  // 等 runtime 测试钩子就绪（attachFullRuntime 后设置）。
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __sunamRuntime?: unknown }).__sunamRuntime)), { timeout: 90_000 }).toBe(true);

  const containersSection = page.locator('.sidebar-section').filter({ hasText: '容器' });
  await expect(containersSection.locator('.sidebar-item')).toHaveCount(1);
  const containerAId = await containersSection.locator('.sidebar-item').getAttribute('data-reorder-key');
  expect(containerAId).toMatch(/^c-[A-Za-z0-9_-]+$/);

  await spawnIn(page, containerAId!);

  // P_A 出现在 A 的进程表：scope=container + containerId=c-a + 真实 pid。
  await expect.poll(async () => {
    const procs = await runtimeProcs(page, containerAId!);
    return procs.find((view) => (view.command ?? '').includes('cisol-pa'))?.pid ?? null;
  }, { timeout: 90_000 }).not.toBeNull();
  const procA = (await runtimeProcs(page, containerAId!)).find((view) => (view.command ?? '').includes('cisol-pa'));
  expect(procA).toBeDefined();
  expect(procA?.pid).toBeTruthy();
  expect(procA?.scope).toBe('container');
  expect(procA?.containerId).toBe(containerAId);

  // UI：A 的服务面板能看到 P_A（分组渲染，命令含标记）。
  await page.getByRole('button', { name: 'Sunam的电脑' }).click();
  await page.locator('.terminal-capsule').getByRole('tab', { name: '服务' }).click();
  const servicesList = page.locator('.services-process-list');
  await expect(servicesList).toContainText('cisol-pa', { timeout: 90_000 });

  // ── 阶段 B：新建容器 B，B 看不到 A 的进程（互不可见）──
  await containersSection.locator('.sidebar-icon-btn').click();
  await expect(containersSection.locator('.sidebar-item')).toHaveCount(2);
  const containerBId = await containersSection.locator('.sidebar-item.active').getAttribute('data-reorder-key');
  expect(containerBId).toMatch(/^c-[A-Za-z0-9_-]+$/);
  expect(containerBId).not.toBe(containerAId);

  // runtime 数据源：B 的进程表不含 P_A。
  await expect.poll(async () => {
    const procs = await runtimeProcs(page, containerBId!);
    return procs.some((view) => (view.command ?? '').includes('cisol-pa')) ? 'LEAKED' : 'ISOLATED';
  }, { timeout: 90_000 }).toBe('ISOLATED');

  // UI：B 的服务面板也不含 P_A。
  await expect(servicesList).toBeVisible({ timeout: 90_000 });
  await expect(servicesList).not.toContainText('cisol-pa');

  // ── 跨容器 kill 拒绝（R3）──
  const pidA = procA!.pid!;
  const refusal = await stopByPid(page, pidA, containerBId);
  expect(refusal.ok).toBe(false);
  expect(refusal.message).toMatch(/another container/);

  // 拒绝后 P_A 仍存活（A 仍可见）。
  await expect.poll(async () => {
    const procs = await runtimeProcs(page, containerAId!);
    return procs.some((view) => view.pid === pidA) ? 'ALIVE' : 'GONE';
  }, { timeout: 90_000 }).toBe('ALIVE');

  // ── 本容器 kill（R3 放行路径）──
  const ownKill = await stopByPid(page, pidA, containerAId);
  expect(ownKill.ok).toBe(true);
  await expect.poll(async () => {
    const procs = await runtimeProcs(page, containerAId!);
    return procs.some((view) => view.pid === pidA) ? 'ALIVE' : 'GONE';
  }, { timeout: 90_000 }).toBe('GONE');
});
