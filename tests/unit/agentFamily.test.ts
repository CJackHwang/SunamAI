import { describe, expect, it, vi } from 'vitest';
import { AgentFamilyBudget, ContainerMutationLease } from '@/features/agent-core/agentFamily';

describe('Agent family primitives', () => {
  it('shares model, tool, and wall-clock budgets across a root family', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const budget = new AgentFamilyBudget(1, 2, 100);
    budget.consumeModelTurn();
    budget.reserveToolCalls(2);
    expect(budget.remaining()).toEqual({ modelTurns: 0, toolCalls: 0, durationMs: 100 });
    expect(() => budget.consumeModelTurn()).toThrow('model-turn');
    expect(() => budget.reserveToolCalls(1)).toThrow('tool-call');
    vi.setSystemTime(1_101);
    expect(budget.remaining()).toEqual({ modelTurns: 0, toolCalls: 0, durationMs: 0 });
    expect(() => budget.consumeModelTurn()).toThrow('time budget');
    vi.useRealTimers();
  });

  it('serializes mutations per container while allowing other containers to proceed', async () => {
    const lease = new ContainerMutationLease();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = lease.run('c-1', async () => { order.push('first-start'); await gate; order.push('first-end'); return 1; });
    const second = lease.run('c-1', async () => { order.push('second'); return 2; });
    const parallel = lease.run('c-2', async () => { order.push('parallel'); return 3; });
    await parallel;
    expect(order).toEqual(['first-start', 'parallel']);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(['first-start', 'parallel', 'first-end', 'second']);
  });

  it('releases the mutation lease after an operation fails', async () => {
    const lease = new ContainerMutationLease();
    await expect(lease.run('c-1', async () => { throw new Error('write failed'); })).rejects.toThrow('write failed');
    await expect(lease.run('c-1', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('serializes the same container across independent root-family lease instances', async () => {
    const firstLease = new ContainerMutationLease();
    const secondLease = new ContainerMutationLease();
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = firstLease.run('shared-container', async () => { active += 1; maximum = Math.max(maximum, active); await gate; active -= 1; });
    const second = secondLease.run('shared-container', async () => { active += 1; maximum = Math.max(maximum, active); active -= 1; });
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(maximum).toBe(1);
  });
});
