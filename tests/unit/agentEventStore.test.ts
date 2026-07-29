import { describe, expect, it } from 'vitest';
import { AgentEventStore } from '@/features/agent-core/eventStore';
import type { AgentRun } from '@/features/agent-core/types';
import { V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import { clearV3Database } from '../helpers/persistenceDatabase';

function run(id: string, sessionId: string): AgentRun {
  return {
    id, sessionId, containerId: 'c-1', model: 'm', persona: 'Sunam 6.9 Pron', phase: 'acting', createdAt: 1, updatedAt: 1,
    task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
    chaos: { persona: 'Sunam 6.9 Pron', ritual: 'ritual', privateGoods: 'goods', styleDirective: 'style', invariants: [] },
    budget: { maxModelTurns: 1, maxToolCalls: 1, maxDurationMs: 1 }, modelTurns: 0, toolCalls: 0, summary: '',
  };
}

describe('AgentEventStore', () => {
  it('marks unfinished v3 Runs as interrupted on recovery', async () => {
    const repository = new V3PersistenceRepository();
    await clearV3Database();
    const store = new AgentEventStore(repository);
    const sessionId = `v3-${Date.now()}`;
    const active = run(`r-${Date.now()}`, sessionId);
    const awaitingParent = { ...run(`r-awaiting-${Date.now()}`, sessionId), phase: 'awaiting_parent' as const, depth: 1, parentRunId: active.id, rootRunId: active.id, agentRole: 'explore' as const };
    await store.append({ id: `${active.id}:1`, kind: 'run_started', sessionId, runId: active.id, sequence: 1, createdAt: 1, run: active });
    await store.append({ id: `${active.id}:2`, kind: 'message', sessionId, runId: active.id, sequence: 2, createdAt: 2, message: { role: 'user', content: 'persisted message' } });
    await store.saveCheckpoint({ id: `cp-${active.id}`, runId: active.id, sessionId, containerId: 'c-1', summary: 'resume here', messages: [{ role: 'user', content: 'persisted message' }], createdAt: 3 });
    await store.saveRun(awaitingParent);
    await store.saveAgentTask({ id: 'active-task', taskId: 'active-task', sessionId, rootRunId: active.id, parentRunId: active.id, runId: 'child-active', role: 'explore', prompt: 'inspect', status: 'running', createdAt: 1, updatedAt: 1, evidence: [], changedPaths: [], verificationRecords: [] });
    expect(await store.loadSessionEvents(sessionId)).toHaveLength(2);
    expect((await store.latestCheckpoint(active.id))?.summary).toBe('resume here');
    const recovered = await store.markInterruptedRuns(sessionId);
    expect(recovered.find((candidate) => candidate.id === active.id)?.phase).toBe('interrupted');
    expect(recovered.find((candidate) => candidate.id === awaitingParent.id)?.phase).toBe('interrupted');
    expect(await store.listAgentTasks(active.id)).toEqual([expect.objectContaining({ id: 'active-task', status: 'interrupted' })]);
  });

  it('ignores transient and duplicate memory events and pages older history', async () => {
    const repository = new V3PersistenceRepository();
    await clearV3Database();
    const store = new AgentEventStore(repository);
    for (let sequence = 1; sequence <= 260; sequence += 1) await repository.appendEvent({ id: `page:${sequence}`, kind: 'message', sessionId: 'paged', runId: 'page', sequence, createdAt: sequence, message: { role: 'user', content: String(sequence) } });
    await store.append({ id: 'transient', kind: 'assistant_delta', sessionId: 'paged', runId: 'page', sequence: 261, createdAt: 261, content: 'x', reasoningContent: '', transient: true });
    const first = await store.loadSessionEvents('paged');
    expect(first).toHaveLength(250);
    expect(store.hasOlderSessionEvents('paged')).toBe(true);
    const older = await store.loadOlderSessionEvents('paged');
    expect(older.events).toHaveLength(260);
    expect(older.hasMore).toBe(false);
    expect(store.hasOlderSessionEvents('paged')).toBe(false);
  });

  it('merges persisted and in-memory runs and persists delegated tasks', async () => {
    const repository = new V3PersistenceRepository();
    await clearV3Database();
    const store = new AgentEventStore(repository);
    const persisted = { ...run('persisted', 'merge'), updatedAt: 1, phase: 'completed' as const };
    const memory = { ...run('memory', 'merge'), updatedAt: 2 };
    await repository.saveRun(persisted);
    await store.saveRun(memory);
    expect((await store.loadSessionRuns('merge')).map((item) => item.id)).toEqual(['memory', 'persisted']);
    const task = { id: 'task', taskId: 'task', sessionId: 'merge', rootRunId: 'memory', parentRunId: 'memory', role: 'explore' as const, prompt: 'inspect', status: 'queued' as const, createdAt: 1, updatedAt: 1, evidence: [], changedPaths: [], verificationRecords: [] };
    await store.saveAgentTask(task);
    expect(await store.listAgentTasks('memory')).toEqual([task]);
  });

  it('loads a child Run transcript on demand without replacing the current session page', async () => {
    const repository = new V3PersistenceRepository();
    await clearV3Database();
    const store = new AgentEventStore(repository);
    for (let sequence = 1; sequence <= 20; sequence += 1) await repository.appendEvent({ id: `child:${sequence}`, kind: 'message', sessionId: 'session', runId: 'child', sequence, createdAt: sequence, message: { role: 'assistant', content: `child ${sequence}` } });
    for (let sequence = 1; sequence <= 260; sequence += 1) await repository.appendEvent({ id: `root:${sequence}`, kind: 'message', sessionId: 'session', runId: 'root', sequence, createdAt: 100 + sequence, message: { role: 'assistant', content: `root ${sequence}` } });
    expect(await store.loadSessionEvents('session')).toHaveLength(250);
    const merged = await store.loadRunEvents('session', 'child');
    expect(merged).toHaveLength(270);
    expect(merged.filter((event) => event.runId === 'child')).toHaveLength(20);
  });
});
