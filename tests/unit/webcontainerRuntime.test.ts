import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WebContainerAgentRuntime } from '@/features/runtime/WebContainerAgentRuntime';
import type { WebContainer } from '@webcontainer/api';
import { Blob as NodeBlob } from 'node:buffer';
import { estimateTextTokens } from '@/shared/lib/tokenEstimate';

const { mockRun, mockSpawn, mockPs, mockKill, spawnedPids, nextPid, resetSpawns } = vi.hoisted(() => {
  let pidCounter = 0;
  const spawnedPids: number[] = [];
  return {
    mockRun: vi.fn(),
    mockSpawn: vi.fn(),
    mockPs: vi.fn(),
    mockKill: vi.fn(),
    spawnedPids,
    nextPid: () => ++pidCounter,
    resetSpawns: () => { pidCounter = 0; spawnedPids.length = 0; },
  };
});

// Succinix 文件 RPC 客户端用 mock 替换：runtime/serviceRegistry 共享同一实例，命令走 mock 方法。
vi.mock('@/features/runtime/succinixClient', () => {
  class MockSuccinixClient {
    run = mockRun;
    spawn = mockSpawn;
    ps = mockPs;
    kill = mockKill;
    cwd = vi.fn(async () => '');
    setCwd = vi.fn(async () => ({ ok: true }));
  }
  return { SuccinixClient: MockSuccinixClient };
});

beforeEach(() => {
  resetSpawns();
  mockRun.mockReset();
  mockSpawn.mockReset();
  mockPs.mockReset();
  mockKill.mockReset();
  mockRun.mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '', timedOut: false });
  mockSpawn.mockImplementation(async () => {
    const pid = nextPid();
    spawnedPids.push(pid);
    return { ok: true, pid };
  });
  mockPs.mockImplementation(async () => spawnedPids.map((pid) => ({ pid, cmd: 'node -e ...', status: 'running', startTime: 0 })));
  mockKill.mockImplementation(async (pid: number) => {
    const index = spawnedPids.indexOf(pid);
    if (index >= 0) spawnedPids.splice(index, 1);
    return { ok: true, killed: true, message: 'killed' };
  });
});

function createRuntime(snapshot: Record<string, unknown> | null = null) {
  const webcontainer = {
    workdir: '/home/workspace',
    fs: {
      mkdir: vi.fn(async () => undefined),
      watch: vi.fn(() => ({ close: vi.fn() })),
      readdir: vi.fn(async () => []),
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
    mount: vi.fn(async () => undefined),
    export: vi.fn(async () => ({})),
    spawn: vi.fn(),
    on: vi.fn(() => () => undefined),
  };
  const repository = {
    loadSnapshotState: vi.fn(async () => ({
      value: snapshot ? { containerId: 'c-1', tree: snapshot, fileCount: 1, byteSize: 1, revision: 7, updatedAt: 1 } : null,
      issues: [],
    })),
    saveSnapshot: vi.fn(async () => undefined),
  };
  return { runtime: new WebContainerAgentRuntime(webcontainer as unknown as WebContainer, repository as never), webcontainer };
}

function createFilesystemRuntime() {
  const files = new Map<string, Uint8Array>([
    ['c-1/src/main.txt', new TextEncoder().encode('line one\nneedle line\nline three')],
    ['c-1/node_modules/skip.txt', new TextEncoder().encode('skip')],
    ['c-1/.git/config', new TextEncoder().encode('skip')],
    ['c-1/large.bin', new Uint8Array(200_001)],
  ]);
  const directories = new Set(['c-1', 'c-1/src', 'c-1/node_modules', 'c-1/.git']);
  const watchers: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const inputs: string[] = [];
  const events: string[] = [];
  const readFile = vi.fn(async (path: string, encoding?: string) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error('ENOENT');
    return encoding === 'utf-8' ? new TextDecoder().decode(bytes) : bytes;
  });
  const readdir = vi.fn(async (path: string) => {
    const names = new Set<string>();
    const prefix = `${path}/`;
    [...directories, ...files.keys()].forEach((candidate) => {
      if (!candidate.startsWith(prefix)) return;
      const next = candidate.slice(prefix.length).split('/')[0];
      if (next) names.add(next);
    });
    return [...names].map((name) => {
      const child = `${path}/${name}`;
      return { name, isDirectory: () => directories.has(child) };
    });
  });
  const webcontainer = {
    workdir: '/home/workspace',
    fs: {
      mkdir: vi.fn(async (path: string) => { directories.add(path); }),
      watch: vi.fn(() => { const watcher = { close: vi.fn() }; watchers.push(watcher); return watcher; }),
      readdir,
      readFile,
      writeFile: vi.fn(async (path: string, content: string | Uint8Array) => { files.set(path, typeof content === 'string' ? new TextEncoder().encode(content) : content); }),
      rm: vi.fn(async (path: string) => { files.delete(path); }),
    },
    mount: vi.fn(async () => undefined),
    export: vi.fn(async () => ({ 'snapshot.txt': { file: { contents: 'saved' } } })),
    spawn: vi.fn(),
    on: vi.fn(() => () => undefined),
  };
  const resources = new Map([
    ['text-resource', { id: 'text-resource', sessionId: 's-1', originatingRunId: 'r-1', name: 'note.txt', kind: 'text' as const, mimeType: 'text/plain', size: 13, sha256: 'text-hash', createdAt: 1, blob: new NodeBlob(['one\ntwo\nthree']) as unknown as Blob }],
    ['cjk-resource', { id: 'cjk-resource', sessionId: 's-1', originatingRunId: 'r-1', name: 'cjk.txt', kind: 'text' as const, mimeType: 'text/plain', size: 600, sha256: 'cjk-hash', createdAt: 1, blob: new NodeBlob(['中文😀'.repeat(200)]) as unknown as Blob }],
    ['image-resource', { id: 'image-resource', sessionId: 's-1', originatingRunId: 'r-1', name: 'image.png', kind: 'image' as const, mimeType: 'image/png', size: 3, sha256: 'image-hash', createdAt: 2, blob: new NodeBlob(['png']) as unknown as Blob }],
  ]);
  const repository = {
    loadSnapshotState: vi.fn(async () => ({ value: null, issues: [] })),
    saveSnapshot: vi.fn(async () => undefined),
    listResources: vi.fn(async () => ({ value: [...resources.values()].map(({ blob: _blob, ...resource }) => resource), issues: [] })),
    loadResource: vi.fn(async (id: string) => ({ value: resources.get(id) ?? null, issues: [] })),
  };
  const runtime = new WebContainerAgentRuntime(webcontainer as unknown as WebContainer, repository as never);
  runtime.subscribe((event) => events.push(event.type));
  return { runtime, files, webcontainer, repository, inputs, watchers, events };
}

describe('WebContainerAgentRuntime process ownership', () => {
  it('launches the user shell through the shared Succinix spawn path', async () => {
    const { runtime } = createRuntime();
    const spawned = await runtime.spawnUserShell('c-1');
    expect(spawned.launchId).toBeTruthy();
    expect(spawned.process.output).toBeInstanceOf(ReadableStream);
    expect(spawned.process.input).toBeInstanceOf(WritableStream);
    expect(typeof spawned.process.kill).toBe('function');
    expect(mockSpawn).toHaveBeenCalledWith(expect.stringContaining('node -e'), expect.anything());
    runtime.dispose();
  });

  it('lists all and only running processes in the requested container', async () => {
    const { runtime } = createRuntime();
    const first = await runtime.runShell({ command: 'one', mode: 'background', sessionId: 's-1', runId: 'r-1', containerId: 'c-1' });
    await runtime.runShell({ command: 'two', mode: 'background', sessionId: 's-2', runId: 'r-2', containerId: 'c-2' });
    expect(runtime.getProcesses({ containerId: 'c-1' }).map((process) => process.command)).toEqual(['one']);
    expect(runtime.getProcesses()).toHaveLength(2);
    await expect(runtime.stopProcess(first.process.id, { sessionId: 's-1', runId: 'r-1', containerId: 'c-1' })).resolves.toBe(true);
    expect(runtime.getProcesses({ containerId: 'c-1' })).toEqual([]);
    runtime.dispose();
  });

  it('publishes transport failures as output errors and still removes the exited process', async () => {
    const { runtime } = createRuntime();
    const events: string[] = [];
    runtime.subscribe((event) => events.push(event.type));
    mockRun.mockRejectedValueOnce(new Error('stream broke'));
    await runtime.runShell({ command: 'broken', mode: 'foreground', sessionId: 's-1', runId: 'r-1', containerId: 'c-1' });
    expect(events).toEqual(expect.arrayContaining(['started', 'error', 'exited']));
    expect(runtime.getProcesses({ containerId: 'c-1' })).toEqual([]);
  });

  it('rejects cross-session, cross-run, and cross-container process operations', async () => {
    const { runtime } = createRuntime();
    const result = await runtime.runShell({ command: 'npm run dev', mode: 'background', sessionId: 's-1', runId: 'r-1', containerId: 'c-1' });
    const owner = { sessionId: 's-1', runId: 'r-1', containerId: 'c-1' };
    const intruder = { sessionId: 's-2', runId: 'r-1', containerId: 'c-1' };

    expect(runtime.observeProcess(result.process.id, owner)).not.toBeNull();
    expect(runtime.observeProcess(result.process.id, intruder)).toBeNull();
    await expect(runtime.sendProcessInput(result.process.id, intruder, 'nope')).resolves.toBe(false);
    await expect(runtime.stopProcess(result.process.id, intruder)).resolves.toBe(false);
    expect(mockKill).not.toHaveBeenCalled();

    runtime.stopRun(owner);
    expect(mockKill).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it('advances the runtime revision exactly once when a registered process is explicitly stopped', async () => {
    const { runtime } = createRuntime();
    const owner = { sessionId: 's-1', runId: 'r-old', containerId: 'c-1' };
    const result = await runtime.runShell({ command: 'npm run dev -- --port 1919', mode: 'background', ...owner });
    const beforeStop = await runtime.getWorkspaceRevision('c-1');

    await expect(runtime.stopProcess(result.process.id, owner)).resolves.toBe(true);
    const afterStop = await runtime.getWorkspaceRevision('c-1');
    expect(afterStop).toBe(beforeStop + 1);
    expect(mockKill).toHaveBeenCalledOnce();
    expect(runtime.getProcesses(owner)).toEqual([]);
    runtime.dispose();
  });

  it('merges the Succinix process table with registry ownership and marks system processes protected (M5)', async () => {
    const { runtime } = createRuntime();
    const result = await runtime.runShell({ command: 'node server.js', mode: 'background', sessionId: 's-1', runId: 'r-1', containerId: 'c-1' });
    mockPs.mockResolvedValueOnce([
      { pid: 1, cmd: 'node server.js', status: 'running', startTime: 20 },
      { pid: 99, cmd: 'node host.js', status: 'running', startTime: 10 },
    ]);
    const views = await runtime.getSuccinixProcesses('c-1');
    const system = views.find((view) => view.pid === 99);
    const agent = views.find((view) => view.pid === 1);
    expect(system).toBeDefined();
    expect(system?.protected).toBe(true);
    expect(system?.id).toBe('succinix-99');
    expect(system?.processId).toBeUndefined();
    expect(agent).toBeDefined();
    expect(agent?.protected).toBe(false);
    expect(agent?.id).toBe(result.process.id);
    expect(agent?.processId).toBe(result.process.id);
    expect(agent?.command).toBe('node server.js');
    expect(agent?.sessionId).toBe('s-1');
    expect(agent?.runId).toBe('r-1');
    runtime.dispose();
  });

  it('surfaces a running foreground run process (killable:false, no host pid) in the process table (V1 H1-2)', async () => {
    const { runtime } = createRuntime();
    // run 永不完成：前台 run shim 停留在注册表（succinixPid 为 null），应作为进程行可见。
    mockRun.mockReturnValue(new Promise(() => {}));
    void runtime.runShell({ command: 'npm test', mode: 'foreground', sessionId: 's-1', runId: 'r-1', containerId: 'c-1', timeoutMs: 2_000 });
    try {
      await vi.waitFor(async () => {
        const views = await runtime.getSuccinixProcesses('c-1');
        const runShim = views.find((view) => view.command === 'npm test');
        expect(runShim).toBeDefined();
        expect(runShim?.pid).toBeUndefined();      // 无 host pid
        expect(runShim?.killable).toBe(false);      // 仅展示不管理
        expect(runShim?.isRunning).toBe(true);
        expect(runShim?.processId).toBeDefined();   // 所有权可关联回 session/run
      }, { timeout: 2_000 });
    } finally {
      runtime.dispose();
    }
  });

  it('does not block the process table refresh when ps() is occupied by a long run (V1 H1-2)', async () => {
    const { runtime } = createRuntime();
    // 后台进程注册进 registry（tracked）——ps() 被长 run 占住时靠 registry 兜底渲染。
    const result = await runtime.runShell({ command: 'node server.js', mode: 'background', sessionId: 's-1', runId: 'r-1', containerId: 'c-1' });
    mockPs.mockReturnValue(new Promise(() => {})); // FIFO 被占：ps() 永不 resolve
    const started = Date.now();
    const views = await runtime.getSuccinixProcesses('c-1');
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(1_000 - 250); // 等到了最佳努力截止（PS_SNAPSHOT_TIMEOUT_MS）
    expect(elapsed).toBeLessThan(3_000); // 不被 ps() 无限阻塞
    const agent = views.find((view) => view.id === result.process.id);
    expect(agent).toBeDefined();
    expect(agent?.isRunning).toBe(true);
    runtime.dispose();
  });

  it('refuses to kill a protected system process by pid (M5)', async () => {
    const { runtime } = createRuntime();
    mockPs.mockResolvedValueOnce([{ pid: 7, cmd: 'node python-daemon.js', status: 'running', startTime: 1 }]);
    const result = await runtime.stopProcessByPid(7);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/protected system process/);
    expect(mockKill).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('kills a non-system process by pid (M5)', async () => {
    const { runtime } = createRuntime();
    mockPs.mockResolvedValueOnce([{ pid: 7, cmd: 'node server.js', status: 'running', startTime: 1 }]);
    const result = await runtime.stopProcessByPid(7);
    expect(result.ok).toBe(true);
    expect(mockKill).toHaveBeenCalledWith(7);
    runtime.dispose();
  });

  it('refuses to stop a registered process whose command matches a system process (M5)', async () => {
    const { runtime } = createRuntime();
    const result = await runtime.runShell({ command: 'node host.js', mode: 'background', sessionId: 's-1', runId: 'r-1', containerId: 'c-1' });
    await expect(runtime.stopProcess(result.process.id, { sessionId: 's-1', runId: 'r-1', containerId: 'c-1' })).resolves.toBe(false);
    expect(mockKill).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('stops an owned foreground process when its run signal is aborted', async () => {
    const { runtime } = createRuntime();
    const controller = new AbortController();
    const running = runtime.runShell({ command: 'hang', mode: 'foreground', sessionId: 's-1', runId: 'r-1', containerId: 'c-1', signal: controller.signal });
    controller.abort(new DOMException('stopped', 'AbortError'));
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(runtime.getProcesses({ containerId: 'c-1' })).toEqual([]);
    runtime.dispose();
  });

  it('restores the v3 snapshot into the shared container root before work starts', async () => {
    const tree = { 'restored.txt': { file: { contents: 'v3' } } };
    const { runtime, webcontainer } = createRuntime(tree);
    await runtime.ensureContainer('c-1');
    expect(webcontainer.mount).toHaveBeenCalledWith(tree, { mountPoint: 'c-1' });
    expect(webcontainer.fs.watch).toHaveBeenCalledWith('c-1', expect.any(Function));
  });

  it('uses the shared root for bounded file operations, process output, snapshots, and disposal', async () => {
    const { runtime, files, webcontainer, repository, inputs, watchers, events } = createFilesystemRuntime();
    await runtime.ensureContainer('c-1');
    await runtime.ensureContainer('c-1');
    expect(webcontainer.fs.watch).toHaveBeenCalledTimes(1);
    expect(await runtime.listWorkspace('c-1', 3)).toEqual(expect.arrayContaining([{ path: 'src', isDirectory: true }, { path: 'src/main.txt', isDirectory: false }]));
    expect((await runtime.listWorkspace('c-1', 3)).some((entry) => entry.path.includes('node_modules') || entry.path.includes('.git'))).toBe(false);
    expect(await runtime.readWorkspaceFile('c-1', 'src/main.txt', 2, 2)).toContain('   2 | needle line');
    expect(await runtime.searchWorkspace('c-1', 'needle', 5)).toEqual([{ path: 'src/main.txt', line: 2, content: 'needle line' }]);

    const changes = await runtime.applyWorkspaceChanges('c-1', [{ path: 'src/main.txt', content: 'updated', expectedContent: 'line one\nneedle line\nline three' }, { path: 'new.txt', content: 'new' }]);
    expect(changes[0]).toEqual({ path: 'src/main.txt', kind: 'updated', beforeBytes: 31, afterBytes: 7 });
    expect(new TextDecoder().decode(files.get('c-1/new.txt'))).toBe('new');
    await runtime.applyWorkspaceChanges('c-1', [{ path: '/home/workspace/c-1/absolute.txt', content: 'same root' }]);
    expect(new TextDecoder().decode(files.get('c-1/absolute.txt'))).toBe('same root');
    await expect(runtime.applyWorkspaceChanges('c-1', [{ path: 'home/user/parallel.txt', content: 'blocked' }])).rejects.toThrow('/home/workspace/c-1');
    expect(files.has('c-1/home/user/parallel.txt')).toBe(false);
    await expect(runtime.applyWorkspaceChanges('c-1', [{ path: 'src/main.txt', content: 'nope', expectedContent: 'stale' }])).rejects.toThrow('Refusing to overwrite');

    mockRun.mockResolvedValueOnce({ ok: true, exitCode: 0, stdout: 'hello output', stderr: '', timedOut: false });
    const result = await runtime.runShell({ command: 'echo hi', mode: 'foreground', timeoutMs: 1_000, sessionId: 's-1', runId: 'r-1', containerId: 'c-1' });
    await Promise.resolve();
    const ownership = { sessionId: 's-1', runId: 'r-1', containerId: 'c-1' };
    expect(result.timedOut).toBe(false);
    expect(await runtime.getWorkspaceRevision('c-1')).toBeGreaterThanOrEqual(2);
    expect(runtime.getProcesses(ownership)).toHaveLength(0);
    expect(await runtime.sendProcessInput(result.process.id, ownership, 'input')).toBe(false);
    expect(events).toEqual(expect.arrayContaining(['started', 'output', 'exited']));
    await runtime.flushSnapshots();
    expect(webcontainer.export).toHaveBeenCalledWith('c-1', expect.objectContaining({ format: 'json', excludes: expect.arrayContaining(['node_modules/**', 'dist/**']) }));
    expect(mockRun).toHaveBeenCalledWith('cd /workspace/c-1 && echo hi', { timeoutMs: 1_000, env: { HOME: '/home/workspace', SUNAM_WORKSPACE: '/home/workspace/c-1' } });
    expect(repository.saveSnapshot).toHaveBeenCalledWith('c-1', expect.any(Object), expect.any(Number));
    runtime.dispose();
    expect(watchers[0]?.close).toHaveBeenCalledOnce();
    expect(inputs).toEqual([]);
  });

  it('rolls back earlier writes when an atomic workspace batch fails', async () => {
    const { runtime, files, webcontainer } = createFilesystemRuntime();
    const writeFile = vi.mocked(webcontainer.fs.writeFile);
    writeFile.mockImplementation(async (path: string, content: string | Uint8Array) => {
      if (path.endsWith('/src/main.txt')) throw new Error('disk write failed');
      files.set(path, typeof content === 'string' ? new TextEncoder().encode(content) : content);
    });
    await expect(runtime.applyWorkspaceChanges('c-1', [
      { path: 'temporary.txt', content: 'must roll back' },
      { path: 'src/main.txt', content: 'must fail', expectedContent: 'line one\nneedle line\nline three' },
    ])).rejects.toThrow('disk write failed');
    expect(files.has('c-1/temporary.txt')).toBe(false);
    expect(new TextDecoder().decode(files.get('c-1/src/main.txt'))).toBe('line one\nneedle line\nline three');
  });

  it('rejects duplicate paths before writing an atomic workspace batch', async () => {
    const { runtime, webcontainer } = createFilesystemRuntime();
    await expect(runtime.applyWorkspaceChanges('c-1', [
      { path: 'same.txt', content: 'one' },
      { path: 'same.txt', content: 'two' },
    ])).rejects.toThrow('duplicate path');
    expect(webcontainer.fs.writeFile).not.toHaveBeenCalled();
  });

  it('reads, describes, and materializes persisted resources on demand', async () => {
    const { runtime, files } = createFilesystemRuntime();
    expect(await runtime.getWorkspaceRevision('c-1')).toBe(0);
    expect(await runtime.listResources('s-1')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'text-resource' }), expect.objectContaining({ id: 'image-resource' })]));
    expect(await runtime.readResourceText('s-1', 'text-resource', 2, 3)).toBe('   2 | two\n   3 | three');
    expect(await runtime.readResourceText('s-1', 'text-resource', 1, 3, 1)).toContain('resource range truncated');
    const boundedCjk = await runtime.readResourceText('s-1', 'cjk-resource', 1, 3, 64);
    expect(boundedCjk).toContain('resource range truncated');
    expect(estimateTextTokens(boundedCjk)).toBeLessThanOrEqual(64);
    await expect(runtime.readResourceText('s-1', 'image-resource')).rejects.toThrow('not a text resource');
    await expect(runtime.readResourceText('s-1', 'missing')).rejects.toThrow('not found');
    await expect(runtime.readResourceText('foreign-session', 'text-resource')).rejects.toThrow('not found in this session');
    expect(await runtime.readResourceImage('s-1', 'image-resource')).toEqual(expect.objectContaining({ id: 'image-resource', kind: 'image' }));
    await expect(runtime.readResourceImage('s-1', 'text-resource')).rejects.toThrow('not an image resource');
    const change = await runtime.materializeResource('s-1', 'c-1', 'image-resource', 'assets/image.png');
    expect(change).toMatchObject({ path: 'assets/image.png', kind: 'created', afterBytes: 3 });
    expect(new TextDecoder().decode(files.get('c-1/assets/image.png'))).toBe('png');
    expect(await runtime.getWorkspaceRevision('c-1')).toBe(1);
  });

  it('bounds the active user terminal without exposing an input bridge', () => {
    const { runtime } = createFilesystemRuntime();
    runtime.appendUserTerminalBuffer('a'.repeat(20_100));
    runtime.appendUserTerminalBuffer('tail');
    expect(runtime.getUserTerminalBuffer()).toHaveLength(20_000);
    expect(runtime.getUserTerminalBuffer().endsWith('tail')).toBe(true);
  });

  it('surfaces snapshot write failures through the runtime error channel', async () => {
    const { runtime, repository } = createFilesystemRuntime();
    const errors: string[] = [];
    runtime.subscribeErrors((error) => errors.push(error));
    vi.mocked(repository.saveSnapshot).mockRejectedValueOnce(new Error('snapshot disk full'));
    await expect(runtime.flushWorkspace('c-1')).rejects.toThrow('snapshot disk full');
    expect(errors).toEqual(['snapshot disk full']);
    runtime.dispose();
  });

  it('rejects a shell request that is already cancelled', async () => {
    const { runtime } = createRuntime();
    const controller = new AbortController();
    controller.abort(new DOMException('stopped', 'AbortError'));
    await expect(runtime.runShell({ command: 'never', mode: 'foreground', sessionId: 's-1', runId: 'r-1', containerId: 'c-1', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
