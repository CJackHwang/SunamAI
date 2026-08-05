import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import { RuntimeServiceRegistry, extractDeclaredPorts, tailDelta } from '@/features/runtime/serviceRegistry';

const { mockRun, mockSpawn, mockPs, mockKill } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockSpawn: vi.fn(),
  mockPs: vi.fn(),
  mockKill: vi.fn(),
}));

// Succinix 文件 RPC 客户端用 mock 替换：spawn 底层执行（run/spawn/ps/kill）全部走 mock 方法。
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
  mockRun.mockReset();
  mockSpawn.mockReset();
  mockPs.mockReset();
  mockKill.mockReset();
  mockRun.mockResolvedValue({ ok: true, exitCode: 0, stdout: '', stderr: '', timedOut: false });
  mockSpawn.mockResolvedValue({ ok: true, pid: 4321 });
  mockPs.mockResolvedValue([]);
  mockKill.mockResolvedValue({ ok: true, killed: true, message: 'killed' });
});

class FakeProcess {
  readonly input = new WritableStream<string>();
  readonly output = new ReadableStream<string>({ start(controller) { controller.close(); } });
  readonly exit: Promise<number>;
  private resolveExit!: (code: number) => void;
  onKill: (() => void) | undefined;
  killed = false;

  constructor() {
    this.exit = new Promise((resolve) => { this.resolveExit = resolve; });
  }

  kill(): void {
    this.killed = true;
    this.onKill?.();
    this.resolveExit(0);
  }

  complete(code = 0): void {
    this.resolveExit(code);
  }

  resize(): void {}
}

class FakeWebContainer {
  readonly workdir = '/home/sunam';
  readonly files = new Map<string, string>();
  readonly processes: FakeProcess[] = [];
  private readonly watchers = new Set<() => void>();
  private readonly eventListeners = new Map<string, Set<(...args: never[]) => void>>();
  onSpawn: ((command: string, args: string[], process: FakeProcess) => void) | undefined;
  readonly fs = {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (path: string, content: string) => { this.files.set(path, content); }),
    readFile: vi.fn(async (path: string) => this.files.get(path) ?? ''),
    watch: vi.fn((_path: string, listener: () => void) => { this.watchers.add(listener); return { close: () => this.watchers.delete(listener) }; }),
  };

  async spawn(command: string, args: string[] = []): Promise<FakeProcess> {
    const process = new FakeProcess();
    this.processes.push(process);
    this.onSpawn?.(command, args, process);
    return process;
  }

  on(name: string, listener: (...args: never[]) => void): () => void {
    const listeners = this.eventListeners.get(name) ?? new Set();
    listeners.add(listener);
    this.eventListeners.set(name, listeners);
    return () => listeners.delete(listener);
  }

  emit(name: string, ...args: unknown[]): void {
    this.eventListeners.get(name)?.forEach((listener) => listener(...args as never[]));
  }

  appendServiceEvent(record: object): void {
    const path = '.sunam/runtime/service-events.jsonl';
    this.files.set(path, `${this.files.get(path) ?? ''}${JSON.stringify(record)}\n`);
    this.watchers.forEach((listener) => listener());
  }
}

async function settleEvents(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('RuntimeServiceRegistry', () => {
  it('infers a managed port from a launch command that declares the port', async () => {
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    const { launchId } = await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'node -e "require(\'http\').createServer((_,r)=>r.end(\'ok\')).listen(3457)"', processId: 'proc-1', sessionId: 's-1', runId: 'r-1' });
    fixture.emit('server-ready', 3457, 'https://3457.example.test');
    // R1：端口按声明端口（.listen(3457)）归属 launch，pid 取 Succinix host pid。
    expect(registry.getPorts()).toEqual([expect.objectContaining({ port: 3457, state: 'managed', pid: 4321, launchId, processId: 'proc-1', source: 'agent', containerId: 'c-1' })]);
    registry.dispose();
  });

  it('associates an open port to the single running service launch when no port is declared', async () => {
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    const { launchId } = await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'node server.js', processId: 'proc-2' });
    fixture.emit('port', 3000, 'open', 'https://3000.example.test');
    // R1 兜底：命令未声明端口但容器内只有一个 Agent 服务进程（node server.js），仍归属 managed。
    expect(registry.getPorts()).toEqual([expect.objectContaining({ port: 3000, state: 'managed', pid: 4321, launchId, source: 'agent' })]);
    registry.dispose();
  });

  it('does not associate a port with the read-only terminal base process', async () => {
    vi.useFakeTimers();
    try {
      const fixture = new FakeWebContainer();
      const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
      await registry.initialize();
      await registry.spawn({ source: 'terminal', containerId: 'c-1', command: 'node -e "console.log(\'Succinix terminal ready\');setInterval(()=>{},1e9)"' });
      fixture.emit('port', 3000, 'open', 'https://3000.example.test');
      // 终端底座进程（source=terminal）非服务，不参与 R1 兜底 → identifying → orphaned。
      expect(registry.getPorts()[0]?.state).toBe('identifying');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(registry.getPorts()[0]?.state).toBe('orphaned');
      registry.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies an unregistered open port as orphaned after the reconciliation window', async () => {
    vi.useFakeTimers();
    try {
      const fixture = new FakeWebContainer();
      const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
      await registry.initialize();
      fixture.emit('server-ready', 3000, 'https://3000.example.test');
      expect(registry.getPorts()[0]?.state).toBe('identifying');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(registry.getPorts()[0]?.state).toBe('orphaned');
      registry.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a port orphaned when multiple services run and none declare the port', async () => {
    vi.useFakeTimers();
    try {
      const fixture = new FakeWebContainer();
      const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
      await registry.initialize();
      await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'node server.js' });
      await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'node worker.js' });
      fixture.emit('server-ready', 3000, 'https://3000.example.test');
      expect(registry.getPorts()[0]?.state).toBe('identifying');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(registry.getPorts()[0]?.state).toBe('orphaned');
      registry.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the dormant listener-record channel authoritative when it appears', async () => {
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    const first = await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'node server.js' });
    const second = await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'node worker.js' });
    expect(first.launchId).not.toBe(second.launchId);
    fixture.emit('server-ready', 3000, 'https://3000.example.test');
    // 两个服务都未声明端口 → 推断不归属，先 identifying。
    expect(registry.getPorts()).toEqual([{ port: 3000, url: 'https://3000.example.test', state: 'identifying' }]);
    // 休眠的 listener 记录仍按记录归属（R2 保留通道）。
    fixture.appendServiceEvent({ action: 'listening', launchId: second.launchId, containerId: 'c-1', pid: 9876, port: 3000, timestamp: Date.now() });
    await settleEvents();
    expect(registry.getPorts()).toEqual([expect.objectContaining({ port: 3000, state: 'managed', pid: 9876, launchId: second.launchId })]);
    registry.dispose();
  });

  it('stops a managed port by killing the host pid through succinixClient', async () => {
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    const { launchId } = await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'node -e "...listen(8080)"', processId: 'proc-3' });
    fixture.emit('server-ready', 8080, 'https://8080.example.test');
    expect(registry.getPorts()).toEqual([expect.objectContaining({ port: 8080, state: 'managed', pid: 4321, launchId })]);
    const stopPromise = registry.stopPort(8080);
    fixture.emit('port', 8080, 'close', '');
    await expect(stopPromise).resolves.toBe(true);
    // R3：managed 端口 stop → succinixClient.kill(host pid)，不再走 webcontainer spawn helper。
    expect(mockKill).toHaveBeenCalledWith(4321);
    expect(registry.getPorts()).toEqual([]);
    registry.dispose();
  });

  it('stops a launch by killing the host pid through succinixClient', async () => {
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    const { launchId } = await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'node -e "...listen(3457)"' });
    expect(registry.stopLaunch(launchId)).toBe(true);
    expect(registry.stopLaunch(launchId)).toBe(false); // 已在 stopping
    await settleEvents();
    expect(mockKill).toHaveBeenCalledWith(4321);
    registry.dispose();
  });

  it('falls back to the retained killPid helper when the launch has no host pid', async () => {
    let resolveRun!: (value: unknown) => void;
    mockRun.mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    const { launchId } = await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'node', args: ['-c', 'node -e "setInterval(()=>{},1e9)"'] });
    // run 语义 launch 无 host pid（succinixPid null）；listener 记录把它归属到端口 8080。
    fixture.appendServiceEvent({ action: 'listening', launchId, containerId: 'c-1', pid: 9876, port: 8080, timestamp: Date.now() });
    await settleEvents();
    fixture.emit('port', 8080, 'open', 'https://8080.example.test');
    expect(registry.getPorts()).toEqual([expect.objectContaining({ port: 8080, state: 'managed', pid: 9876, source: 'agent' })]);
    fixture.onSpawn = (command, args, helper) => {
      if (command !== 'node') return;
      expect(args).toEqual(['-e', expect.stringContaining('process.kill'), '9876']);
      helper.complete(0);
      queueMicrotask(() => fixture.emit('port', 8080, 'close', ''));
    };
    await expect(registry.stopPort(8080)).resolves.toBe(true);
    expect(mockKill).not.toHaveBeenCalled();
    resolveRun({ ok: true, exitCode: 0, stdout: '', stderr: '', timedOut: false });
    registry.dispose();
  });

  it('keeps runtime scaffolding outside container roots without the dead NODE_OPTIONS hook', async () => {
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    // NODE_OPTIONS hook 注入已随 jsh 迁移移除（M3）：不再写 service-hook.cjs。
    expect(fixture.files.has('.sunam/runtime/service-hook.cjs')).toBe(false);
    expect([...fixture.files.keys()].every((path) => !path.includes('.sunam/workspaces/'))).toBe(true);
    registry.dispose();
  });
});

describe('extractDeclaredPorts', () => {
  it('extracts --port, .listen, PORT= and --server.port declarations', () => {
    expect(extractDeclaredPorts('tinbase --port 3001')).toEqual([3001]);
    expect(extractDeclaredPorts('node -e "require(\'http\').createServer(()=>{}).listen(3457)"')).toEqual([3457]);
    expect(extractDeclaredPorts('PORT=3000 node server.js')).toEqual([3000]);
    expect(extractDeclaredPorts('java -jar app.jar --server.port=8080')).toEqual([8080]);
    expect(extractDeclaredPorts('npm run dev -- --port 1919 --host 0.0.0.0')).toEqual([1919]);
  });

  it('returns nothing for commands without explicit ports', () => {
    expect(extractDeclaredPorts('node -e "setInterval(()=>{},1000)"')).toEqual([]);
    expect(extractDeclaredPorts('node server.js')).toEqual([]);
    expect(extractDeclaredPorts('ls -la')).toEqual([]);
    // 随机端口 listen(0) 与 node -p(print) 不作为声明。
    expect(extractDeclaredPorts('node -e "...listen(0)"')).toEqual([]);
    expect(extractDeclaredPorts('node -p "1+1"')).toEqual([]);
  });
});

describe('tailDelta', () => {
  it('emits the full candidate when nothing was emitted yet', () => {
    expect(tailDelta('', 'hello')).toBe('hello');
  });

  it('returns nothing when the candidate is already fully emitted', () => {
    expect(tailDelta('abc', 'abc')).toBe('');
    expect(tailDelta('abc', 'bc')).toBe('');
  });

  it('emits only the suffix past the longest tail overlap', () => {
    expect(tailDelta('hello world', 'world!!!')).toBe('!!!');
    expect(tailDelta('abc', 'abcd')).toBe('d');
    expect(tailDelta('ab', 'abcde')).toBe('cde');
    expect(tailDelta('abc', 'bcX')).toBe('X');
  });

  it('emits the full candidate when there is no tail overlap', () => {
    expect(tailDelta('abc', 'xyz')).toBe('xyz');
  });

  it('returns nothing for an empty candidate', () => {
    expect(tailDelta('abc', '')).toBe('');
  });
});
