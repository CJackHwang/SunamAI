import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerAvailabilityController } from '@/features/runtime/containerAvailability';

vi.mock('@/features/runtime/runtimeSingleton', () => ({
  getWorkspaceRuntime: vi.fn(),
  waitForWorkspaceHostReady: vi.fn(async () => undefined),
}));

vi.mock('@/features/runtime/containerUnavailable', () => ({
  markContainerUnavailable: vi.fn(),
  clearContainerUnavailable: vi.fn(),
  isContainerUnavailable: vi.fn(() => false),
}));

import { getWorkspaceRuntime, waitForWorkspaceHostReady } from '@/features/runtime/runtimeSingleton';
import { clearContainerUnavailable, markContainerUnavailable } from '@/features/runtime/containerUnavailable';

const bootMock = vi.mocked(getWorkspaceRuntime);
const hostReadyMock = vi.mocked(waitForWorkspaceHostReady);
const markMock = vi.mocked(markContainerUnavailable);
const clearMock = vi.mocked(clearContainerUnavailable);

describe('ContainerAvailabilityController', () => {
  beforeEach(() => {
    bootMock.mockReset();
    hostReadyMock.mockReset();
    hostReadyMock.mockResolvedValue(undefined);
    markMock.mockReset();
    clearMock.mockReset();
  });

  it('reports enabled after a successful boot and never calls onFailure', async () => {
    bootMock.mockResolvedValue({ webcontainer: {} as never, runtime: {} as never });
    const controller = new ContainerAvailabilityController();
    const onFailure = vi.fn();
    controller.setOnFailure(onFailure);
    await expect(controller.initialize()).resolves.toBe('enabled');
    expect(controller.get()).toBe('enabled');
    expect(onFailure).not.toHaveBeenCalled();
    expect(clearMock).toHaveBeenCalled();
    expect(markMock).not.toHaveBeenCalled();
  });

  it('reports restricted on a failed boot and calls onFailure exactly once', async () => {
    bootMock.mockRejectedValue(new Error('boot exploded'));
    const controller = new ContainerAvailabilityController();
    const onFailure = vi.fn();
    controller.setOnFailure(onFailure);
    await expect(controller.initialize()).resolves.toBe('restricted');
    expect(controller.get()).toBe('restricted');
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining('boot exploded'));
  });

  it('recovers from restricted to enabled on a successful retry', async () => {
    bootMock.mockRejectedValueOnce(new Error('boot exploded'));
    bootMock.mockResolvedValue({ webcontainer: {} as never, runtime: {} as never });
    const controller = new ContainerAvailabilityController();
    const onFailure = vi.fn();
    controller.setOnFailure(onFailure);
    await controller.initialize();
    expect(controller.get()).toBe('restricted');
    await expect(controller.retry()).resolves.toBe('enabled');
    expect(controller.get()).toBe('enabled');
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('stays restricted after a failed retry without re-notifying', async () => {
    bootMock.mockRejectedValue(new Error('first'));
    const controller = new ContainerAvailabilityController();
    const onFailure = vi.fn();
    controller.setOnFailure(onFailure);
    await controller.initialize();
    bootMock.mockRejectedValueOnce(new Error('second'));
    await expect(controller.retry()).resolves.toBe('restricted');
    expect(controller.get()).toBe('restricted');
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when availability changes', async () => {
    bootMock.mockRejectedValueOnce(new Error('boom'));
    bootMock.mockResolvedValueOnce({ webcontainer: {} as never, runtime: {} as never });
    const controller = new ContainerAvailabilityController();
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.initialize();
    expect(controller.get()).toBe('restricted');
    expect(listener).toHaveBeenCalled();
    await controller.retry();
    expect(controller.get()).toBe('enabled');
  });

  it('deduplicates concurrent initialize calls into a single boot', async () => {
    let resolveBoot: ((value: { webcontainer: never; runtime: never }) => void) | undefined;
    bootMock.mockImplementation(() => new Promise<{ webcontainer: never; runtime: never }>((resolve) => { resolveBoot = resolve; }));
    const controller = new ContainerAvailabilityController();
    const first = controller.initialize();
    const second = controller.initialize();
    resolveBoot?.({ webcontainer: undefined as never, runtime: undefined as never });
    await Promise.all([first, second]);
    expect(bootMock).toHaveBeenCalledTimes(1);
    expect(controller.get()).toBe('enabled');
  });

  it('resetForReboot clears the cached outcome so the next enable does a fresh boot', async () => {
    bootMock.mockResolvedValue({ webcontainer: {} as never, runtime: {} as never });
    const controller = new ContainerAvailabilityController();
    await controller.initialize();
    expect(bootMock).toHaveBeenCalledTimes(1);
    controller.resetForReboot();
    await controller.initialize();
    expect(bootMock).toHaveBeenCalledTimes(2);
  });

  it('reports isStarting while a boot is in flight and clears it when it settles', async () => {
    let resolveBoot: ((value: { webcontainer: never; runtime: never }) => void) | undefined;
    bootMock.mockImplementation(() => new Promise<{ webcontainer: never; runtime: never }>((resolve) => { resolveBoot = resolve; }));
    const controller = new ContainerAvailabilityController();
    const listener = vi.fn();
    controller.subscribe(listener);
    const pending = controller.initialize();
    expect(controller.isStarting()).toBe(true);
    resolveBoot?.({ webcontainer: undefined as never, runtime: undefined as never });
    await pending;
    expect(controller.isStarting()).toBe(false);
  });

  it('resetForReboot re-arms the one-time failure notification for a new boot cycle', async () => {
    bootMock.mockRejectedValueOnce(new Error('first'));
    const controller = new ContainerAvailabilityController();
    const onFailure = vi.fn();
    controller.setOnFailure(onFailure);
    await controller.initialize();
    expect(onFailure).toHaveBeenCalledTimes(1);
    controller.resetForReboot();
    bootMock.mockRejectedValueOnce(new Error('second'));
    await controller.initialize();
    expect(onFailure).toHaveBeenCalledTimes(2);
  });
});

describe('ContainerAvailabilityController restricted-state persistence (R2)', () => {
  beforeEach(() => {
    bootMock.mockReset();
    hostReadyMock.mockReset();
    hostReadyMock.mockResolvedValue(undefined);
    markMock.mockReset();
    clearMock.mockReset();
  });

  it('marks the container unavailable when a boot fails (restricted → persisted marker)', async () => {
    bootMock.mockRejectedValue(new Error('no cross-origin isolation'));
    const controller = new ContainerAvailabilityController();
    await controller.initialize();
    expect(controller.get()).toBe('restricted');
    expect(markMock).toHaveBeenCalledTimes(1);
  });

  it('marks unavailable again when a manual retry fails', async () => {
    bootMock.mockRejectedValue(new Error('still unsupported'));
    const controller = new ContainerAvailabilityController();
    await controller.initialize();
    expect(markMock).toHaveBeenCalledTimes(1);
    await controller.retry();
    expect(markMock).toHaveBeenCalledTimes(2);
  });

  it('clears the recorded marker when a boot succeeds', async () => {
    bootMock.mockResolvedValue({ webcontainer: {} as never, runtime: {} as never });
    const controller = new ContainerAvailabilityController();
    await controller.initialize();
    expect(clearMock).toHaveBeenCalled();
    expect(markMock).not.toHaveBeenCalled();
  });

  it('clears the recorded marker on manual retry before re-detecting', async () => {
    bootMock.mockRejectedValueOnce(new Error('first'));
    bootMock.mockResolvedValue({ webcontainer: {} as never, runtime: {} as never });
    const controller = new ContainerAvailabilityController();
    await controller.initialize();
    expect(markMock).toHaveBeenCalledTimes(1);
    await expect(controller.retry()).resolves.toBe('enabled');
    // retry 先清除标记，成功 boot 再次清除（幂等）；不再落标记。
    expect(clearMock).toHaveBeenCalled();
    expect(markMock).toHaveBeenCalledTimes(1);
  });

  it('waits for the Succinix host boot before declaring enabled', async () => {
    bootMock.mockResolvedValue({ webcontainer: {} as never, runtime: {} as never });
    hostReadyMock.mockRejectedValueOnce(new Error('host did not become ready'));
    const controller = new ContainerAvailabilityController();
    await expect(controller.initialize()).resolves.toBe('restricted');
    expect(controller.get()).toBe('restricted');
    expect(markMock).toHaveBeenCalledTimes(1);
  });
});
