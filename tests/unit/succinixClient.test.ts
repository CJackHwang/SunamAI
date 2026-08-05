import { describe, expect, it, vi } from 'vitest';
import { SuccinixClient } from '@/features/runtime/succinixClient';

/** 模拟 Succinix host：写 /cmd.json 时按 cmd 立即产出 /result-<id>.json。 */
function createHostFixture(overrides?: Partial<Record<string, Record<string, unknown>>>) {
  const files = new Map<string, string>();
  const writtenIds: unknown[] = [];
  const readPaths: string[] = [];
  const responses: Record<string, Record<string, unknown>> = {
    run: { ok: true, exitCode: 0, stdout: 'out', stderr: '', runtime: 'lifo' },
    spawn: { ok: true, pid: 99, runtime: 'node' },
    ps: { ok: true, kind: 'ps', processes: [{ pid: 99, cmd: 'node -e x', status: 'running', startTime: 1 }] },
    kill: { ok: true, killed: true, message: 'killed' },
    cwd: { ok: true, kind: 'cwd', cwd: '/home/workspace' },
    setCwd: { ok: true, kind: 'cwd', cwd: '/home/workspace/c-1' },
    ...overrides,
  };
  const fs = {
    rm: vi.fn(async (path: string) => { files.delete(path); }),
    writeFile: vi.fn(async (path: string, content: string) => {
      if (path === '/cmd.json') {
        const request = JSON.parse(content) as { id: unknown; cmd: string };
        writtenIds.push(request.id);
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
  return { fs, files, writtenIds, readPaths };
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
});
