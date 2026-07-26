import { describe, expect, it } from 'vitest';
import { detectEventTailDrift, detectWorkspaceDrift, mergeSessionRecords, recoveredSessionStatus, selectMessageWindow } from '@/features/agent-core/useAgentV2';
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
      chaos: { persona: 'Sunam 6.9 Pron', ritual: '', privateGoods: '', styleDirective: '', invariants: [] },
      budget: { maxModelTurns: 1, maxToolCalls: 1, maxDurationMs: 1 }, modelTurns: 0, toolCalls: 0, summary: '',
    });

    expect(recoveredSessionStatus([run('old', 'completed', 1), run('latest', 'interrupted', 2)])).toBe('idle');
    expect(recoveredSessionStatus([run('active', 'acting', 3)])).toBeNull();
  });

  it('detects resume drift only when a checkpoint revision is known and differs', () => {
    expect(detectWorkspaceDrift(undefined, 4)).toBeUndefined();
    expect(detectWorkspaceDrift(4, 4)).toBeUndefined();
    expect(detectWorkspaceDrift(3, 4)).toEqual({ checkpointRevision: 3, currentRevision: 4 });
  });

  it('detects persisted events that landed after the checkpoint tail', () => {
    expect(detectEventTailDrift(undefined, 5)).toBeUndefined();
    expect(detectEventTailDrift(5, 5)).toBeUndefined();
    expect(detectEventTailDrift(5, 7)).toEqual({ checkpointSequence: 5, currentSequence: 7 });
  });

  it('keeps a 5,000-message history inside the fixed 250-message DOM window', () => {
    const messages = Array.from({ length: 5_000 }, (_, index) => index);
    expect(selectMessageWindow(messages, null)).toEqual(messages.slice(4_750));
    expect(selectMessageWindow(messages, 2_500)).toEqual(messages.slice(2_250, 2_500));
    expect(selectMessageWindow(messages, 100)).toHaveLength(100);
  });
});
