import { expect, test } from '@playwright/test';

// V2TERM 核心验收：用户终端接入 Succinix 完整系统界面。
// 覆盖：boot 横幅 + 自检摘要 + guest@succinix 提示符；整行命令 echo / node --version / cd+pwd / ls 输出回显。

test('user terminal shows the Succinix banner, guest prompt, and executes line commands (V2TERM)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('sunam_v2_api_key', 'runtime-smoke-no-network-call');
    localStorage.setItem('sunam_v2_base_url', 'https://example.invalid/v1');
    localStorage.setItem('sunam_v2_api_model', 'runtime-smoke');
  });
  // 无 LLM 依赖：拦截可能发出的请求，避免真实网络。
  await page.route('https://example.invalid/v1/chat/completions', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' } }] }),
  }));

  await page.goto('/');
  await expect(page.locator('textarea[placeholder="问 Sunam 任何问题..."]')).toBeEnabled({ timeout: 60_000 });

  // 进入 Sunam的电脑 → 终端段（用户终端）。
  await page.getByRole('button', { name: 'Sunam的电脑' }).click();
  await page.locator('.terminal-capsule').getByRole('tab', { name: '终端' }).click();

  const userTerminal = page.locator('.xterm-rows').nth(1);

  // R3：boot 横幅 + 自检摘要 + guest@succinix 提示符。
  await expect(userTerminal).toContainText(/Succinix 0\.2\.0/, { timeout: 120_000 });
  await expect(userTerminal).toContainText(/\[  OK  \] \d+ checks passed/);
  await expect(userTerminal).toContainText(/guest@succinix:~\$ /);

  // 点击终端聚焦（xterm 键盘输入走隐藏 textarea；.xterm-rows 被 .xterm-screen 覆盖）。
  await page.locator('.xterm-screen').nth(1).click({ position: { x: 120, y: 120 } });
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false)).toBe(true);

  // R2：整行命令 echo 回显（命令本身含输出标记，且提示符随后返回）。
  await page.keyboard.type('echo TERMINAL-ECHO-778899');
  await page.keyboard.press('Enter');
  await expect(userTerminal).toContainText('TERMINAL-ECHO-778899', { timeout: 30_000 });
  await expect(userTerminal).toContainText(/guest@succinix:~\$ /);

  // node --version：node 经 Lifo 混合链转真 Node，输出版本号（与输入串区分）。
  await page.keyboard.type('node --version');
  await page.keyboard.press('Enter');
  await expect(userTerminal).toContainText(/v\d+\.\d+\.\d+/, { timeout: 60_000 });

  // R4：mkdir + cd 后提示符目录跟随（~/mydir）。
  await page.keyboard.type('mkdir -p mydir');
  await page.keyboard.press('Enter');
  await expect(userTerminal).toContainText(/guest@succinix:~\$ /, { timeout: 60_000 });
  await page.keyboard.type('cd mydir');
  await page.keyboard.press('Enter');
  await expect(userTerminal).toContainText(/guest@succinix:~\/mydir\$ /, { timeout: 60_000 });

  // cd 后 pwd 反映新目录（本地命令，输出为 VFS 绝对路径）。
  await page.keyboard.type('pwd');
  await page.keyboard.press('Enter');
  await expect(userTerminal).toContainText(/\/workspace\/c-[a-z0-9_-]+\/mydir/, { timeout: 30_000 });

  // ls 回显目录内容。
  await page.keyboard.type('touch inside.txt');
  await page.keyboard.press('Enter');
  await page.keyboard.type('ls');
  await page.keyboard.press('Enter');
  await expect(userTerminal).toContainText('inside.txt', { timeout: 30_000 });
});
