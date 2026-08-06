import { describe, expect, it, vi } from 'vitest';
import { SuccinixClient } from '@/features/runtime/succinixClient';

/** 模拟 Succinix host：写 /cmd.json 时按 cmd 立即产出 /result-<id>.json。 */
function createHostFixture(overrides?: Partial<Record<string, Record<string, unknown>>>) {
  const files = new Map<string, string>();
  const writtenIds: unknown[] = [];
  const writtenCmds: string[] = [];
  const readPaths: string[] = [];
  /** M6：每个 /cmd.json 写入时的「会话 cwd + env 文件」快照，用于并发隔离断言。 */
  const writtenContext: Array<{ cmd: string; cwd: string; env: string | null }> = [];
  // 宿主单一会话 cwd（初始 process.cwd() 的 /workspace 映射）。
  let sessionCwd = '/workspace';
  const responses: Record<string, Record<string, unknown>> = {
    run: { ok: true, exitCode: 0, stdout: 'out', stderr: '', runtime: 'lifo' },
    spawn: { ok: true, pid: 99, runtime: 'node' },
    ps: { ok: true, kind: 'ps', processes: [{ pid: 99, cmd: 'node -e x', status: 'running', startTime: 1 }] },
    kill: { ok: true, killed: true, message: 'killed' },
    cwd: { ok: true, kind: 'cwd', cwd: '/home/workspace' },
    setCwd: { ok: true, kind: 'cwd', cwd: '/workspace/c-1' },
    ping: { ok: true, kind: 'pong' },
    ...overrides,
  };
  const fs = {
    mkdir: vi.fn(async () => undefined),
    rm: vi.fn(async (path: string) => { files.delete(path); }),
    writeFile: vi.fn(async (path: string, content: string) => {
      if (path === '/cmd.json') {
        const request = JSON.parse(content) as { id: unknown; cmd: string; opts?: { cwd?: string } };
        writtenIds.push(request.id);
        writtenCmds.push(request.cmd);
        if (request.cmd === 'setCwd') sessionCwd = request.opts?.cwd ?? sessionCwd;
        writtenContext.push({ cmd: request.cmd, cwd: sessionCwd, env: files.get('/etc/succinix.env') ?? null });
        const payload = responses[request.cmd] ?? { ok: false, error: 'unknown command' };
        files.set(`/result-${request.id}.json`, JSON.stringify({ id: request.id, ...payload }));
      } else {
        files.set(path, content);
      }
    }),
    readFile: vi.fn(async (path: string) => {
      readPaths.push(path);
      const value = files.get(path);
      if (value === undefined) throw new Error('ENOENT');
      return value;
    }),
  };
  return { fs, files, writtenIds, writtenCmds, readPaths, writtenContext };
}

describe('SuccinixClient file RPC', () => {
  it('runs a command and returns the unified routing result', async () => {
    const { fs } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    const result = await client.run('ls -la');
    expect(result).toEqual({ ok: true, exitCode: 0, stdout: 'out', stderr: '', runtime: 'lifo', timedOut: false });
    // 请求 id 严格递增数字（host 忽略非数字 id），读到即删结果文件。
    expect(fs.rm).toHaveBeenCalledWith('/result-1.json');
  });

  it('marks run results timed out when host reports a timeout stderr', async () => {
    const { fs } = createHostFixture({
      run: { ok: false, exitCode: -1, stdout: '', stderr: 'node subprocess timed out after 30000ms, killed', runtime: 'node' },
    });
    const client = new SuccinixClient(fs as never);
    const result = await client.run('npm install', { timeoutMs: 30_000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-1);
  });

  it('returns timedOut true when the host never answers the result file', async () => {
    const files = new Map<string, string>();
    const fs = {
      rm: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
      readFile: vi.fn(async () => { throw new Error('ENOENT'); }),
    };
    const client = new SuccinixClient(fs as never);
    const result = await client.run('hang', { timeoutMs: 1_000 });
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('spawns a background process and returns its pid', async () => {
    const { fs } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    await expect(client.spawn('node server.js')).resolves.toEqual({ ok: true, pid: 99 });
  });

  it('lists the host process table and kills a process by pid', async () => {
    const { fs } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    const processes = await client.ps();
    expect(processes).toEqual([{ pid: 99, cmd: 'node -e x', status: 'running', startTime: 1 }]);
    await expect(client.kill(99)).resolves.toEqual({ ok: true, killed: true, message: 'killed' });
  });

  it('reads and explicitly sets the session working directory', async () => {
    const { fs } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    await expect(client.cwd()).resolves.toBe('/home/workspace');
    await expect(client.setCwd('/home/workspace/c-1')).resolves.toEqual({ ok: true });
  });

  it('cleans up a stale /cmd.json before writing a new request', async () => {
    const { fs, writtenIds } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    await client.run('one');
    await client.run('two');
    expect(writtenIds).toEqual([1, 2]);
    // 每次写请求前先强制清理残留 /cmd.json。
    expect(fs.rm).toHaveBeenCalledWith('/cmd.json', { force: true });
  });

  it('marks run results timed out when the host settles with exitCode 130 (Lifo AbortError)', async () => {
    const { fs } = createHostFixture({
      run: { ok: false, exitCode: 130, stdout: '', stderr: '', runtime: 'lifo' },
    });
    const client = new SuccinixClient(fs as never);
    const result = await client.run('sleep 100');
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(130);
  });

  it('answers the host liveness probe through ping', async () => {
    const { fs } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    await expect(client.ping()).resolves.toBe(true);
  });

  it('returns false when the host answers the liveness probe with a non-pong kind', async () => {
    const { fs } = createHostFixture({ ping: { ok: true, kind: 'error' } });
    const client = new SuccinixClient(fs as never);
    await expect(client.ping()).resolves.toBe(false);
  });

  it('writes /etc/succinix.env before the run RPC when env is passed', async () => {
    const { fs, files, writtenCmds } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    await client.run('node -e x', { env: { HOME: '/home/workspace', SUNAM_WORKSPACE: '/home/workspace/c-1' } });
    expect(files.get('/etc/succinix.env')).toBe('HOME=/home/workspace\nSUNAM_WORKSPACE=/home/workspace/c-1\n');
    // env 写入在 run 请求之前（同一 FIFO 链），host spawn 子进程时能读到最新值。
    expect(writtenCmds).toEqual(['run']);
    expect(fs.mkdir).toHaveBeenCalledWith('/etc', { recursive: true });
  });

  it('sets the session cwd before a spawn when cwd is passed', async () => {
    const { fs, writtenCmds } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    await expect(client.spawn('node server.js', { cwd: '/workspace/c-1' })).resolves.toEqual({ ok: true, pid: 99 });
    expect(writtenCmds).toEqual(['setCwd', 'spawn']);
  });

  it('keeps each container setCwd adjacent to its spawn under concurrent requests', async () => {
    // M6 并发门禁：两个容器交替 spawn 时，会话 cwd 不得被另一容器的 setCwd 插队
    //（A setCwd 后 B setCwd 先到 → A 的 spawn 会落在 B 目录）。setCwd 必须紧跟同容器的 spawn。
    const { fs, writtenContext } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    await Promise.all([
      client.spawn('node server-a.js', { cwd: '/workspace/c-a' }),
      client.spawn('node server-b.js', { cwd: '/workspace/c-b' }),
    ]);
    const spawnCwds = writtenContext.filter((entry) => entry.cmd === 'spawn').map((entry) => entry.cwd);
    // 每个 spawn 执行时，会话 cwd 必须已是自己的容器根（setCwd 与 spawn 原子成对）。
    expect(spawnCwds.sort()).toEqual(['/workspace/c-a', '/workspace/c-b']);
    // 序列内每个 setCwd 之后紧跟同容器的 spawn（无跨容器插队）。
    for (let index = 0; index < writtenContext.length; index += 1) {
      const entry = writtenContext[index];
      if (!entry || entry.cmd !== 'setCwd') continue;
      const next = writtenContext[index + 1];
      expect(next).toBeDefined();
      expect(next!.cmd).toBe('spawn');
      expect(next!.cwd).toBe(entry.cwd);
    }
  });

  it('keeps each container env file adjacent to its run under concurrent requests', async () => {
    // M6 并发门禁：两个容器交替 run 时，/etc/succinix.env 不得被另一容器的 env 写入插队
    //（A 写 env 后 B 的 env 先到 → A 的命令读到 B 的环境变量）。env 写入必须紧跟同容器的 run。
    const { fs, writtenContext } = createHostFixture();
    const client = new SuccinixClient(fs as never);
    await Promise.all([
      client.run('echo a', { env: { SUNAM_WORKSPACE: '/home/workspace/c-a' } }),
      client.run('echo b', { env: { SUNAM_WORKSPACE: '/home/workspace/c-b' } }),
    ]);
    const runEnvs = writtenContext.filter((entry) => entry.cmd === 'run').map((entry) => entry.env ?? '');
    expect(runEnvs.filter((env) => env.includes('/home/workspace/c-a')).length).toBe(1);
    expect(runEnvs.filter((env) => env.includes('/home/workspace/c-b')).length).toBe(1);
  });
});
