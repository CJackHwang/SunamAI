import { describe, expect, it } from 'vitest';
import { AgentEventStore } from '@/features/agent-core/eventStore';
import type { AgentRun } from '@/features/agent-core/types';
import { V2PersistenceRepository } from '@/shared/persistence/v2Repository';
import { clearV2Database } from '../helpers/v2Database';

function run(id: string, sessionId: string): AgentRun {
  return {
    id, sessionId, containerId: 'c-1', model: 'm', persona: 'Sunam 1.14 Homo', phase: 'acting', createdAt: 1, updatedAt: 1,
    task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, verified: false, verificationEvidence: [] },
    chaos: { persona: 'Sunam 1.14 Homo', ritual: 'ritual', privateGoods: 'good', styleDirective: 'style', invariants: [] },
    budget: { maxModelTurns: 1, maxToolCalls: 1, maxDurationMs: 1 }, modelTurns: 0, toolCalls: 0, summary: '',
  };
}

describe('AgentEventStore', () => {
  it('marks unfinished v2 Runs as interrupted on recovery', async () => {
    const repository = new V2PersistenceRepository();
    await clearV2Database();
    const store = new AgentEventStore(repository);
    const sessionId = `v2-${Date.now()}`;
    const active = run(`r-${Date.now()}`, sessionId);
    await store.append({ id: `${active.id}:1`, kind: 'run_started', sessionId, runId: active.id, sequence: 1, createdAt: 1, run: active });
    await store.append({ id: `${active.id}:2`, kind: 'message', sessionId, runId: active.id, sequence: 2, createdAt: 2, message: { role: 'user', content: 'persisted message' } });
    await store.saveCheckpoint({ id: `cp-${active.id}`, runId: active.id, sessionId, containerId: 'c-1', summary: 'resume here', messages: [{ role: 'user', content: 'persisted message' }], createdAt: 3 });
    expect(await store.loadSessionEvents(sessionId)).toHaveLength(2);
    expect((await store.latestCheckpoint(active.id))?.summary).toBe('resume here');
    const recovered = await store.markInterruptedRuns(sessionId);
    expect(recovered.find((candidate) => candidate.id === active.id)?.phase).toBe('interrupted');
  });
});
