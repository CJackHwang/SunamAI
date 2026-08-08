import { describe, expect, it } from 'vitest';
import { ContainerMutationLease } from '@/features/agent-core/mutationLease';

describe('ContainerMutationLease', () => {
  it('serializes operations on the same container and returns their values', async () => {
    const lease = new ContainerMutationLease();
    const order: string[] = [];
    const results = await Promise.all([
      lease.run('c-1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('a');
        return 'a';
      }),
      lease.run('c-1', async () => {
        order.push('b');
        return 'b';
      }),
    ]);
    expect(results).toEqual(['a', 'b']);
    // The second operation must not start before the first one completes.
    expect(order).toEqual(['a', 'b']);
  });

  it('allows operations on different containers to run concurrently', async () => {
    const lease = new ContainerMutationLease();
    const order: string[] = [];
    await Promise.all([
      lease.run('c-a', async () => { await new Promise((resolve) => setTimeout(resolve, 10)); order.push('a'); }),
      lease.run('c-b', async () => { order.push('b'); }),
    ]);
    expect(order).toContain('b');
    expect(order[0]).toBe('b');
  });

  it('recovers from a rejected operation and still runs the queued successor', async () => {
    const lease = new ContainerMutationLease();
    await expect(lease.run('c-1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const result = await lease.run('c-1', async () => 'after');
    expect(result).toBe('after');
  });

  it('cleans up the queue after the final operation completes', async () => {
    const lease = new ContainerMutationLease();
    await lease.run('c-1', async () => 1);
    // A subsequent run must start immediately (no stale queue entry blocking it).
    const result = await lease.run('c-1', async () => 2);
    expect(result).toBe(2);
  });
});
