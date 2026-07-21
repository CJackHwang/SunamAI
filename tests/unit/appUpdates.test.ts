import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceWorker = vi.hoisted(() => ({
  applyUpdate: vi.fn(async () => undefined),
  registerSW: vi.fn(),
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: serviceWorker.registerSW,
}));

describe('app updates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('PROD', true);
    serviceWorker.applyUpdate.mockReset();
    serviceWorker.applyUpdate.mockResolvedValue(undefined);
    serviceWorker.registerSW.mockReset();
    serviceWorker.registerSW.mockReturnValue(serviceWorker.applyUpdate);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
  });

  it('defers activation until the user accepts a waiting update', async () => {
    const updates = await import('@/shared/lib/appUpdates');
    const listener = vi.fn();
    updates.subscribeToAppUpdate(listener);
    updates.initializeAppUpdates();

    expect(serviceWorker.registerSW).toHaveBeenCalledOnce();
    const options = serviceWorker.registerSW.mock.calls[0]?.[0];
    expect(options).toMatchObject({ immediate: true });
    expect(updates.getAppUpdateSnapshot()).toBe(false);
    options?.onNeedRefresh?.();
    expect(listener).toHaveBeenCalledOnce();
    expect(updates.getAppUpdateSnapshot()).toBe(true);

    await updates.reloadToApplyUpdate();
    expect(serviceWorker.applyUpdate).toHaveBeenCalledWith(true);
  });
});
