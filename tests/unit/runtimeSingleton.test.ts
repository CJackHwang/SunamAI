import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWebContainer: vi.fn(),
  resetWebContainer: vi.fn(async () => undefined),
  instances: [] as Array<{ flushSnapshots: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
}));

vi.mock('@/shared/lib/webcontainer', () => ({
  getWebContainer: mocks.getWebContainer,
  resetWebContainer: mocks.resetWebContainer,
}));

vi.mock('@/features/runtime/WebContainerAgentRuntime', () => ({
  WebContainerAgentRuntime: class {
    readonly bootSuccinixHost = vi.fn(async () => undefined);
    readonly flushSnapshots = vi.fn(async () => undefined);
    readonly dispose = vi.fn();
    constructor() { mocks.instances.push(this); }
  },
}));

import { forceRestartWorkspaceRuntime, getWorkspaceRuntime } from '@/features/runtime/runtimeSingleton';

describe('workspace runtime singleton', () => {
  beforeEach(() => {
    mocks.getWebContainer.mockResolvedValue({ id: 'webcontainer' });
  });

  it('fails closed when snapshot flush fails before a forced restart', async () => {
    const current = await getWorkspaceRuntime();
    const flushError = new Error('snapshot write failed');
    const onRuntimeDiscarded = vi.fn();
    mocks.instances[0]!.flushSnapshots.mockRejectedValueOnce(flushError);

    await expect(forceRestartWorkspaceRuntime(onRuntimeDiscarded)).rejects.toThrow('snapshot write failed');

    expect(onRuntimeDiscarded).not.toHaveBeenCalled();
    expect(mocks.resetWebContainer).not.toHaveBeenCalled();
    expect(mocks.instances[0]!.dispose).not.toHaveBeenCalled();
    expect(await getWorkspaceRuntime()).toBe(current);

    const discardedAfterFlush = vi.fn();
    const restarted = await forceRestartWorkspaceRuntime(discardedAfterFlush);
    expect(discardedAfterFlush).toHaveBeenCalledOnce();
    expect(mocks.instances[0]!.dispose).toHaveBeenCalledOnce();
    expect(mocks.resetWebContainer).toHaveBeenCalledOnce();
    expect(restarted).not.toBe(current);
  });
});
