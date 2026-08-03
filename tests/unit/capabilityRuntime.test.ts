import { describe, expect, it, vi } from 'vitest';
import { CapabilityAwareRuntime } from '@/features/runtime/CapabilityAwareRuntime';
import type { WebContainerAgentRuntime } from '@/features/runtime/WebContainerAgentRuntime';
import type { V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import type { StoredAgentResource } from '@/entities/resource/types';

const textResource: StoredAgentResource = {
  id: 'res-text', sessionId: 's-1', originatingRunId: 'r-1', name: 'a.txt', kind: 'text',
  mimeType: 'text/plain', size: 11, sha256: 'sha', createdAt: 1, blob: new Blob(['hello world'], { type: 'text/plain' }),
};
const imageResource: StoredAgentResource = {
  id: 'res-img', sessionId: 's-1', originatingRunId: 'r-1', name: 'a.png', kind: 'image',
  mimeType: 'image/png', size: 4, sha256: 'sha2', createdAt: 2, blob: new Blob(['png'], { type: 'image/png' }),
};

function makeRepository(resources: StoredAgentResource[]): V3PersistenceRepository {
  return {
    listResources: vi.fn(async (sessionId: string) => ({ value: resources.filter((r) => r.sessionId === sessionId), issues: [] })),
    loadResource: vi.fn(async (id: string) => ({ value: resources.find((r) => r.id === id) ?? null, issues: [] })),
  } as unknown as V3PersistenceRepository;
}

function makeContainerRuntime(): WebContainerAgentRuntime {
  return {
    ensureContainer: vi.fn(async () => undefined),
    getWorkspaceRevision: vi.fn(async () => 42),
    listWorkspace: vi.fn(async () => [{ path: 'a.ts', isDirectory: false }]),
    runShell: vi.fn(async () => ({ process: { id: 'p', sessionId: 's', runId: 'r', containerId: 'c', command: 'echo', isRunning: false, output: 'ok', cursor: 2, exitCode: 0 }, timedOut: false })),
    getUserTerminalBuffer: vi.fn(() => 'terminal buffer'),
    subscribe: vi.fn(() => () => undefined),
    stopRun: vi.fn(),
    getProcesses: vi.fn(() => []),
  } as unknown as WebContainerAgentRuntime;
}

describe('CapabilityAwareRuntime', () => {
  it('delegates container methods when the container is available', async () => {
    const containerRuntime = makeContainerRuntime();
    const runtime = new CapabilityAwareRuntime(containerRuntime, true, makeRepository([textResource]));

    await runtime.ensureContainer('c-1');
    expect(containerRuntime.ensureContainer).toHaveBeenCalledWith('c-1');
    await expect(runtime.getWorkspaceRevision('c-1')).resolves.toBe(42);
    await expect(runtime.listWorkspace('c-1', 3)).resolves.toEqual([{ path: 'a.ts', isDirectory: false }]);
    expect(runtime.getUserTerminalBuffer()).toBe('terminal buffer');
  });

  it('no-ops / empties container methods when the container is unavailable', async () => {
    const containerRuntime = makeContainerRuntime();
    const runtime = new CapabilityAwareRuntime(containerRuntime, false, makeRepository([]));

    await expect(runtime.ensureContainer('c-1')).resolves.toBeUndefined();
    await expect(runtime.getWorkspaceRevision('c-1')).resolves.toBe(0);
    await expect(runtime.listWorkspace('c-1', 3)).resolves.toEqual([]);
    await expect(runtime.runShell({ command: 'x', containerId: 'c', sessionId: 's', runId: 'r', mode: 'foreground' })).rejects.toThrow(/disabled/);
    expect(runtime.getProcesses()).toEqual([]);
    expect(runtime.getUserTerminalBuffer()).toBe('');
    expect(containerRuntime.getUserTerminalBuffer).not.toHaveBeenCalled();
  });

  it('works with a null container runtime in chat-only mode', async () => {
    const runtime = new CapabilityAwareRuntime(null, false, makeRepository([textResource]));
    await expect(runtime.getWorkspaceRevision('c')).resolves.toBe(0);
    await expect(runtime.listWorkspace('c', 3)).resolves.toEqual([]);
    expect(runtime.subscribe(() => undefined)).toBeInstanceOf(Function);
    await expect(runtime.readResourceText('s-1', 'res-text')).resolves.toContain('hello world');
  });

  it('reads text and image resources from IndexedDB regardless of container availability', async () => {
    const runtime = new CapabilityAwareRuntime(null, false, makeRepository([textResource, imageResource]));
    const text = await runtime.readResourceText('s-1', 'res-text');
    expect(text).toContain('hello world');
    const image = await runtime.readResourceImage('s-1', 'res-img');
    expect(image.kind).toBe('image');
    expect(image).not.toHaveProperty('blob');
  });

  it('rejects resources from another session and wrong kinds', async () => {
    const runtime = new CapabilityAwareRuntime(null, false, makeRepository([textResource]));
    await expect(runtime.readResourceText('s-other', 'res-text')).rejects.toThrow(/not found/);
    await expect(runtime.readResourceText('s-1', 'res-missing')).rejects.toThrow(/not found/);
    await expect(runtime.readResourceImage('s-1', 'res-text')).rejects.toThrow(/not an image/);
  });

  it('lists resources through the repository', async () => {
    const runtime = new CapabilityAwareRuntime(null, false, makeRepository([textResource, imageResource]));
    const resources = await runtime.listResources('s-1');
    expect(resources.map((r) => r.id)).toEqual(['res-text', 'res-img']);
  });

  it('throws on container-bound mutations when unavailable', async () => {
    const runtime = new CapabilityAwareRuntime(null, false, makeRepository([]));
    await expect(runtime.materializeResource('s', 'c', 'res-text', '/a.txt')).rejects.toThrow(/disabled/);
    await expect(runtime.applyWorkspaceChanges('c', [{ path: 'a', content: 'b' }])).rejects.toThrow(/disabled/);
    await expect(runtime.readWorkspaceFile('c', 'a')).rejects.toThrow(/disabled/);
  });
});
