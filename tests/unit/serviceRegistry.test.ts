import { describe, expect, it, vi } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import { RuntimeServiceRegistry } from '@/features/runtime/serviceRegistry';

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
  it('joins a managed launch to an exact listener PID and stops it through the retained handle', async () => {
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    const { launchId, process } = await registry.spawn({ source: 'agent', containerId: 'c-1', command: 'jsh', args: ['-c', 'npm run dev'], processId: 'proc-1', sessionId: 's-1', runId: 'r-1' });
    fixture.emit('port', 5173, 'open', 'https://5173.example.test');
    expect(registry.getPorts()).toEqual([{ port: 5173, url: 'https://5173.example.test', state: 'identifying' }]);

    fixture.appendServiceEvent({ action: 'listening', launchId, containerId: 'c-1', pid: 4321, port: 5173, timestamp: Date.now() });
    await settleEvents();
    expect(registry.getPorts()).toEqual([expect.objectContaining({ port: 5173, state: 'managed', pid: 4321, launchId, processId: 'proc-1', source: 'agent' })]);

    (process as unknown as FakeProcess).onKill = () => fixture.emit('port', 5173, 'close', '');
    await expect(registry.stopPort(5173)).resolves.toBe(true);
    expect(registry.getPorts()).toEqual([]);
    registry.dispose();
  });

  it('classifies an unregistered open port as orphaned after the reconciliation window', async () => {
    vi.useFakeTimers();
    try {
      const fixture = new FakeWebContainer();
      const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
      await registry.initialize();
      fixture.emit('server-ready', 3000, 'https://3000.example.test');
      expect(registry.getPorts()[0]?.state).toBe('identifying');
      await vi.advanceTimersByTimeAsync(1_500);
      expect(registry.getPorts()[0]?.state).toBe('orphaned');
      registry.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the listener PID to stop a terminal service without killing its shell', async () => {
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    const { launchId, process: terminalShell } = await registry.spawn({ source: 'terminal', containerId: 'c-1', command: 'jsh' });

    fixture.appendServiceEvent({ action: 'listening', launchId, containerId: 'c-1', pid: 9876, port: 8080, timestamp: Date.now() });
    await settleEvents();
    fixture.emit('port', 8080, 'open', 'https://8080.example.test');
    expect(registry.getPorts()).toEqual([expect.objectContaining({ port: 8080, state: 'managed', pid: 9876, source: 'terminal' })]);

    fixture.onSpawn = (command, args, helper) => {
      if (command !== 'node') return;
      expect(args).toEqual(['-e', expect.stringContaining('process.kill'), '9876']);
      helper.complete(0);
      queueMicrotask(() => fixture.emit('port', 8080, 'close', ''));
    };
    await expect(registry.stopPort(8080)).resolves.toBe(true);

    expect((terminalShell as FakeProcess).killed).toBe(false);
    expect(registry.getPorts()).toEqual([]);
    registry.dispose();
  });

  it('writes the listener preload outside container project roots', async () => {
    const fixture = new FakeWebContainer();
    const registry = new RuntimeServiceRegistry(fixture as unknown as WebContainer, vi.fn());
    await registry.initialize();
    expect(fixture.files.get('.sunam/runtime/service-hook.cjs')).toContain('net.Server.prototype.listen');
    expect([...fixture.files.keys()].every((path) => !path.includes('.sunam/workspaces/'))).toBe(true);
    registry.dispose();
  });
});
