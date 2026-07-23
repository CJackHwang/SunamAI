import { describe, expect, it } from 'vitest';
import { mergeSessionRecords, recoveredSessionStatus } from '@/features/agent-core/useAgentV2';
import type { AgentRun } from '@/features/agent-core/types';

describe('useAgentV2 session isolation', () => {
  it('retains concurrent records for the active session without leaking the previous session', () => {
    const persisted = [{ id: 'new-persisted', sessionId: 's-new', value: 1 }];
    const current = [
      { id: 'old', sessionId: 's-old', value: 2 },
      { id: 'new-live', sessionId: 's-new', value: 3 },
    ];

    expect(mergeSessionRecords(persisted, current, 's-new')).toEqual([
      { id: 'new-persisted', sessionId: 's-new', value: 1 },
      { id: 'new-live', sessionId: 's-new', value: 3 },
    ]);
  });

  it('clears a stale running badge when the newest recovered run is interrupted', () => {
    const run = (id: string, phase: AgentRun['phase'], updatedAt: number): AgentRun => ({
      id, phase, updatedAt, sessionId: 's-1', containerId: 'c-1', model: 'm', persona: 'Sunam 6.9 Pron', createdAt: 1,
      task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
      chaos: { persona: 'Sunam 6.9 Pron', styleDirective: '', invariants: [] },
      budget: { maxModelTurns: 1, maxToolCalls: 1, maxDurationMs: 1 }, modelTurns: 0, toolCalls: 0, summary: '',
    });

    expect(recoveredSessionStatus([run('old', 'completed', 1), run('latest', 'interrupted', 2)])).toBe('idle');
    expect(recoveredSessionStatus([run('active', 'acting', 3)])).toBeNull();
  });
});
