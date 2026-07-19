import { afterEach, describe, expect, it, vi } from 'vitest';
import { V2SnapshotScheduler } from '@/shared/persistence/snapshotScheduler';

describe('V2SnapshotScheduler', () => {
  afterEach(() => vi.useRealTimers());
  it('serializes duplicate snapshot work and retains one queued follow-up', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const capture = vi.fn(async () => {
      if (capture.mock.calls.length === 1) await firstGate;
      return { 'demo.txt': { file: { contents: 'ok' } } };
    });
    const repository = { saveSnapshot: vi.fn(async () => undefined) };
    const scheduler = new V2SnapshotScheduler(repository as never, capture, 1_000);

    const first = scheduler.flush('c-1');
    const queued = scheduler.flush('c-1');
    releaseFirst?.();
    await Promise.all([first, queued]);

    expect(capture).toHaveBeenCalledTimes(2);
    expect(repository.saveSnapshot).toHaveBeenCalledTimes(2);
  });

  it('debounces scheduled writes, flushes pending containers, and disposes timers', async () => {
    vi.useFakeTimers();
    const capture = vi.fn(async () => ({ 'demo.txt': { file: { contents: 'ok' } } }));
    const repository = { saveSnapshot: vi.fn(async () => undefined) };
    const scheduler = new V2SnapshotScheduler(repository as never, capture, 100);
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
});
