import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dispose, flushSnapshots, resetWebContainer, resetWebContainerIfCurrent, detachWebContainer, getWebContainer } = vi.hoisted(() => ({
  dispose: vi.fn(),
  flushSnapshots: vi.fn(async () => undefined),
  resetWebContainer: vi.fn(),
  resetWebContainerIfCurrent: vi.fn(async () => undefined),
  detachWebContainer: vi.fn(),
  getWebContainer: vi.fn(() => Promise.resolve({ booted: true })),
}));

vi.mock('@/shared/lib/webcontainer', () => ({ getWebContainer, resetWebContainer, resetWebContainerIfCurrent, detachWebContainer }));
vi.mock('@/entities/persistence/v3Repository', () => ({ v3Persistence: {} }));
vi.mock('@/features/runtime/WebContainerAgentRuntime', () => ({
  WebContainerAgentRuntime: class {
    flushSnapshots = flushSnapshots;
    dispose = dispose;
  },
}));

import { disposeWorkspaceRuntime, getWorkspaceRuntime } from '@/features/runtime/runtimeSingleton';

describe('disposeWorkspaceRuntime (关闭即释放)', () => {
  beforeEach(() => {
    dispose.mockClear();
    flushSnapshots.mockClear();
    resetWebContainer.mockClear();
    resetWebContainerIfCurrent.mockClear();
    detachWebContainer.mockClear();
    getWebContainer.mockClear();
  });

  // Must run before any boot so the module singleton is empty (the no-boot branch).
  it('is a safe no-op when nothing was ever booted', async () => {
    await disposeWorkspaceRuntime();
    expect(resetWebContainer).toHaveBeenCalled();
  });

  it('flushes snapshots, disposes the runtime, detaches + tears down WebContainer, and clears the singleton', async () => {
    const first = await getWorkspaceRuntime();
    expect(first).toBeTruthy();

    await disposeWorkspaceRuntime();

    expect(flushSnapshots).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
    expect(detachWebContainer).toHaveBeenCalled();
    expect(resetWebContainerIfCurrent).toHaveBeenCalled();
  });

  it('re-opens with a fresh boot instead of reusing the disposed instance', async () => {
    const first = await getWorkspaceRuntime();
    await disposeWorkspaceRuntime();
    const second = await getWorkspaceRuntime();

    expect(second).not.toBe(first);
    expect(getWebContainer).toHaveBeenCalledTimes(2);
  });
});
