import { describe, expect, it } from 'vitest';
import { AgentEventStore } from '@/features/agent-core/eventStore';
import type { AgentRun } from '@/features/agent-core/types';

function run(id: string, sessionId: string): AgentRun {
  return {
    id, sessionId, containerId: 'c-1', model: 'm', persona: 'Sunam 1.14 Homo', phase: 'acting', createdAt: 1, updatedAt: 1,
    task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, verified: false },
    chaos: { persona: 'Sunam 1.14 Homo', ritual: 'ritual', privateGoods: 'good', styleDirective: 'style', invariants: [] },
    budget: { maxModelTurns: 1, maxToolCalls: 1, maxDurationMs: 1 }, modelTurns: 0, toolCalls: 0, summary: '',
  };
}

describe('AgentEventStore', () => {
  it('marks unfinished v2 Runs as interrupted on recovery', async () => {
    const store = new AgentEventStore();
    const sessionId = `v2-${Date.now()}`;
    const active = run(`r-${Date.now()}`, sessionId);
    await store.append({ id: `${active.id}:1`, kind: 'run_started', sessionId, runId: active.id, sequence: 1, createdAt: 1, run: active });
    const recovered = await store.markInterruptedRuns(sessionId);
    expect(recovered.find((candidate) => candidate.id === active.id)?.phase).toBe('interrupted');
  });
});
