import { describe, expect, it, vi } from 'vitest';
import { scheduleToolBatch } from '@/features/agent-core/toolBatchScheduler';

describe('scheduleToolBatch', () => {
  it('bounds adjacent reads and serializes mutations', async () => {
    const timeline: string[] = [];
    let activeReads = 0;
    let peakReads = 0;
    const calls = ['read-1', 'read-2', 'read-3', 'write', 'read-4'];
    const results = await scheduleToolBatch({
      calls,
      isConcurrencySafe: (call) => call.startsWith('read'),
      maxConcurrency: 2,
      assertCanContinue: vi.fn(),
      execute: async (call) => {
        timeline.push(`start:${call}`);
        if (call.startsWith('read')) { activeReads += 1; peakReads = Math.max(peakReads, activeReads); await Promise.resolve(); activeReads -= 1; }
        timeline.push(`end:${call}`);
        return { call, result: call };
      },
    });
    expect(results.map(({ result }) => result)).toEqual(calls);
    expect(peakReads).toBe(2);
    expect(timeline.indexOf('start:write')).toBeGreaterThan(timeline.indexOf('end:read-3'));
    expect(timeline.indexOf('start:read-4')).toBeGreaterThan(timeline.indexOf('end:write'));
  });
});
