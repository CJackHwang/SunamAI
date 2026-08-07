import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWebContainer: vi.fn(),
  resetWebContainer: vi.fn(async () => undefined),
  detachWebContainer: vi.fn(),
  resetWebContainerIfCurrent: vi.fn(async () => undefined),
  bootSuccinixHost: vi.fn(async () => undefined),
  restoreSuccinixFileSnapshot: vi.fn(async () => undefined),
  startSuccinixFileSnapshot: vi.fn(),
  flushSuccinixFileSnapshot: vi.fn(async () => undefined),
  flushSnapshots: vi.fn(async () => undefined),
  dispose: vi.fn(),
  instances: [] as Array<{
    flushSnapshots: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@/shared/lib/webcontainer', () => ({
  getWebContainer: mocks.getWebContainer,
  resetWebContainer: mocks.resetWebContainer,
  detachWebContainer: mocks.detachWebContainer,
  resetWebContainerIfCurrent: mocks.resetWebContainerIfCurrent,
}));

vi.mock('@/features/runtime/WebContainerAgentRuntime', () => ({
  WebContainerAgentRuntime: class {
    readonly bootSuccinixHost = mocks.bootSuccinixHost;
    readonly restoreSuccinixFileSnapshot = mocks.restoreSuccinixFileSnapshot;
    readonly startSuccinixFileSnapshot = mocks.startSuccinixFileSnapshot;
    readonly flushSuccinixFileSnapshot = mocks.flushSuccinixFileSnapshot;
    readonly flushSnapshots = mocks.flushSnapshots;
    readonly dispose = mocks.dispose;
    constructor() { mocks.instances.push(this); }
  },
}));

import { disposeWorkspaceRuntime, forceRestartWorkspaceRuntime, getWorkspaceRuntime, waitForWorkspaceHostReady } from '@/features/runtime/runtimeSingleton';

describe('workspace runtime singleton', () => {
  beforeEach(async () => {
    // 每个测试从干净单例开始（清空 runtimeInstance / host 信号）。
    await disposeWorkspaceRuntime();
    mocks.getWebContainer.mockReset();
    mocks.resetWebContainer.mockClear();
    mocks.detachWebContainer.mockClear();
    mocks.resetWebContainerIfCurrent.mockClear();
    mocks.bootSuccinixHost.mockReset().mockResolvedValue(undefined);
    mocks.restoreSuccinixFileSnapshot.mockReset().mockResolvedValue(undefined);
    mocks.startSuccinixFileSnapshot.mockReset();
    mocks.flushSuccinixFileSnapshot.mockReset().mockResolvedValue(undefined);
    mocks.flushSnapshots.mockReset().mockResolvedValue(undefined);
    mocks.dispose.mockReset();
    mocks.getWebContainer.mockResolvedValue({ id: 'webcontainer' });
  });

  it('fails closed when snapshot flush fails before a forced restart', async () => {
    const current = await getWorkspaceRuntime();
    const flushError = new Error('snapshot write failed');
    const onRuntimeDiscarded = vi.fn();
    mocks.flushSnapshots.mockRejectedValueOnce(flushError);

    await expect(forceRestartWorkspaceRuntime(onRuntimeDiscarded)).rejects.toThrow('snapshot write failed');

    expect(onRuntimeDiscarded).not.toHaveBeenCalled();
    expect(mocks.resetWebContainer).not.toHaveBeenCalled();
    expect(mocks.dispose).not.toHaveBeenCalled();
    expect(await getWorkspaceRuntime()).toBe(current);

    const discardedAfterFlush = vi.fn();
    const restarted = await forceRestartWorkspaceRuntime(discardedAfterFlush);
    expect(discardedAfterFlush).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.resetWebContainer).toHaveBeenCalledOnce();
    expect(restarted).not.toBe(current);
  });

  it('exposes the runtime after WC boot while the Succinix host boot continues in the background (R1)', async () => {
    const instance = await getWorkspaceRuntime();
    // Phase 1 resolved — runtime is available immediately (terminal UI can show).
    expect(instance.runtime).toBeDefined();
    // Host boot runs in background: restore → bootSuccinixHost → start snapshot.
    await expect(waitForWorkspaceHostReady()).resolves.toBeUndefined();
    expect(mocks.restoreSuccinixFileSnapshot).toHaveBeenCalled();
    expect(mocks.bootSuccinixHost).toHaveBeenCalled();
    expect(mocks.startSuccinixFileSnapshot).toHaveBeenCalled();
  });

  it('rejects waitForWorkspaceHostReady when the background host boot fails', async () => {
    mocks.bootSuccinixHost.mockRejectedValueOnce(new Error('host boom'));
    await getWorkspaceRuntime();
    await expect(waitForWorkspaceHostReady()).rejects.toThrow('host boom');
  });

  it('resets the host boot signal on dispose so a re-enable boots fresh', async () => {
    const first = await getWorkspaceRuntime();
    await waitForWorkspaceHostReady();
    await disposeWorkspaceRuntime();
    // dispose 清空单例 + host 信号；下次 getWorkspaceRuntime 全新 boot。
    const second = await getWorkspaceRuntime();
    expect(second).not.toBe(first);
    await expect(waitForWorkspaceHostReady()).resolves.toBeUndefined();
  });
});
