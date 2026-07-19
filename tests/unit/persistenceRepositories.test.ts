import { beforeEach, describe, expect, it } from 'vitest';
import { getMessageStorageKey, loadMessages, saveMessages } from '@/entities/message/repository';
import { loadWorkspaceState } from '@/entities/workspace/repository';
import { appendAiTerminalHistory, getAiTerminalHistory } from '@/shared/lib/terminalHistory';
import { STORAGE_KEYS } from '@/shared/lib/storage';

describe('persisted workspace resources', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips messages and safely ignores invalid message storage', () => {
    saveMessages('s-1', [{ role: 'user', content: 'hello' }]);
    expect(loadMessages('s-1')).toEqual([{ role: 'user', content: 'hello' }]);
    localStorage.setItem(getMessageStorageKey('s-2'), '{bad');
    expect(loadMessages('s-2')).toEqual([]);
  });

  it('normalizes legacy workspace selections and preserves terminal history bounds', () => {
    localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify({ sessions: [{ id: 's-1', title: 'one', updatedAt: 1 }], containers: [{ id: 'c-1', name: 'one', updatedAt: 1 }], activeSessionId: 'missing', activeContainerId: 'missing' }));
    expect(loadWorkspaceState(() => 1)).toMatchObject({ activeSessionId: 's-1', activeContainerId: 'c-1' });
    appendAiTerminalHistory('s-1', 'a'.repeat(50_001));
    expect(getAiTerminalHistory('s-1')).toHaveLength(50_000);
    expect(getAiTerminalHistory(null)).toBe('');
  });
});
