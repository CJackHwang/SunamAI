import { afterEach, describe, expect, it, vi } from 'vitest';
import { V3SnapshotScheduler } from '@/features/runtime/snapshotScheduler';

describe('V3SnapshotScheduler', () => {
  afterEach(() => vi.useRealTimers());
  it('serializes duplicate snapshot work and retains one queued follow-up', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const capture = vi.fn(async () => {
      if (capture.mock.calls.length === 1) await firstGate;
      return { 'demo.txt': { file: { contents: 'ok' } } };
    });
    const repository = { saveSnapshot: vi.fn(async () => undefined) };
    const scheduler = new V3SnapshotScheduler(repository as never, capture, 1_000);

    const first = scheduler.flush('c-1');
    const queued = scheduler.flush('c-1');
    releaseFirst?.();
    await Promise.all([first, queued]);

    expect(capture).toHaveBeenCalledTimes(2);
    expect(repository.saveSnapshot).toHaveBeenCalledTimes(2);
    expect(repository.saveSnapshot).toHaveBeenLastCalledWith('c-1', expect.any(Object), 0);
  });

  it('runs the queued follow-up after the active snapshot fails', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const capture = vi.fn(async () => {
      if (capture.mock.calls.length === 1) await firstGate;
      return { 'demo.txt': { file: { contents: 'ok' } } };
    });
    const repository = {
      saveSnapshot: vi.fn()
        .mockRejectedValueOnce(new Error('temporary snapshot failure'))
        .mockResolvedValueOnce(undefined),
    };
    const scheduler = new V3SnapshotScheduler(repository as never, capture, 1_000);

    const active = scheduler.flush('c-1');
    const queued = scheduler.flush('c-1');
    releaseFirst?.();

    await expect(active).rejects.toThrow('temporary snapshot failure');
    await expect(queued).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(repository.saveSnapshot).toHaveBeenCalledTimes(2);
  });

  it('debounces scheduled writes, flushes pending containers, and disposes timers', async () => {
    vi.useFakeTimers();
    const capture = vi.fn(async () => ({ 'demo.txt': { file: { contents: 'ok' } } }));
    const repository = { saveSnapshot: vi.fn(async () => undefined) };
    const scheduler = new V3SnapshotScheduler(repository as never, capture, 100);
    scheduler.schedule('c-1');
    scheduler.schedule('c-1');
    await vi.advanceTimersByTimeAsync(100);
    expect(capture).toHaveBeenCalledTimes(1);

    scheduler.schedule('c-2');
    await scheduler.flushAll();
    expect(capture).toHaveBeenCalledWith('c-2');
    scheduler.schedule('c-3');
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(capture).not.toHaveBeenCalledWith('c-3');
  });

  it('cancels the debounce timer when an explicit checkpoint flush runs first', async () => {
    vi.useFakeTimers();
    const capture = vi.fn(async () => ({ 'demo.txt': { file: { contents: 'ok' } } }));
    const repository = { saveSnapshot: vi.fn(async () => undefined) };
    const scheduler = new V3SnapshotScheduler(repository as never, capture, 100);
    scheduler.schedule('c-1');
    await scheduler.flush('c-1');
    await vi.advanceTimersByTimeAsync(100);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});
