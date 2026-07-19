import { describe, expect, it } from 'vitest';
import { mergeSessionRecords } from '@/features/agent-core/useAgentV2';

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
});
