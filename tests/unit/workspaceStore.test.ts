import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '@/shared/store/useWorkspaceStore';
import type { WorkspaceState } from '@/entities/workspace/types';

const initialState: WorkspaceState = {
  sessions: [{ id: 's-old', title: '旧会话', updatedAt: 1 }],
  containers: [{ id: 'c-old', name: '旧容器', updatedAt: 1 }],
  activeSessionId: 's-old',
  activeContainerId: 'c-old',
};

describe('workspace store', () => {
  it('creates, selects, pins and removes sessions in the current in-memory workspace', () => {
    const store = createWorkspaceStore(initialState, () => 42);
    const sessionId = store.createSession();
    expect(sessionId).toBe('s-16');
    store.renameSession(sessionId, '重命名');
    store.togglePinSession(sessionId);
    store.updateSessionStatus(sessionId, 'completed_unread');
    store.selectSession(sessionId);
    expect(store.getSnapshot().sessions[0]).toMatchObject({ title: '重命名', pinned: true, status: 'idle' });
    store.deleteSession(sessionId);
    expect(store.getSnapshot().activeSessionId).toBe('s-old');
  });

  it('keeps container selection valid after deletion', () => {
    const store = createWorkspaceStore(initialState, () => 50);
    const newId = store.createContainer();
    store.deleteContainer(newId);
    expect(store.getSnapshot().activeContainerId).toBe('c-old');
  });
});
