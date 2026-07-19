import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '@/shared/store/useWorkspaceStore';
import type { WorkspaceState } from '@/entities/workspace/types';
import { V2PersistenceRepository } from '@/shared/persistence/v2Repository';

const initialState: WorkspaceState = {
  sessions: [{ id: 's-old', title: '旧会话', updatedAt: 1 }],
  containers: [{ id: 'c-old', name: '旧容器', updatedAt: 1 }],
  activeSessionId: 's-old',
  activeContainerId: 'c-old',
};

function transientRepository() {
  return { saveWorkspace: vi.fn(async () => undefined), deleteSession: vi.fn(async () => undefined), deleteContainer: vi.fn(async () => undefined) } as never;
}

describe('workspace store', () => {
  it('creates, selects, pins and removes sessions in the current in-memory workspace', () => {
    const store = createWorkspaceStore(initialState, () => 42, transientRepository());
    const sessionId = store.createSession();
    expect(sessionId).toMatch(/^s-16-/);
    store.renameSession(sessionId, '重命名');
    store.togglePinSession(sessionId);
    store.updateSessionStatus(sessionId, 'completed_unread');
    store.selectSession(sessionId);
    expect(store.getSnapshot().sessions[0]).toMatchObject({ title: '重命名', pinned: true, status: 'idle' });
    store.deleteSession(sessionId);
    expect(store.getSnapshot().activeSessionId).toBe('s-old');
  });

  it('keeps container selection valid after deletion', () => {
    const store = createWorkspaceStore(initialState, () => 50, transientRepository());
    const newId = store.createContainer();
    store.deleteContainer(newId);
    expect(store.getSnapshot().activeContainerId).toBe('c-old');
  });

  it('hydrates the v2 workspace state on a fresh store', async () => {
    const repository = new V2PersistenceRepository();
    await repository.clearAll();
    await repository.saveWorkspace(initialState);
    const store = createWorkspaceStore({ ...initialState, sessions: [], containers: [], activeSessionId: null, activeContainerId: null }, () => 60, repository);
    await store.hydrate();
    expect(store.getSnapshot()).toMatchObject({ activeSessionId: 's-old', activeContainerId: 'c-old' });
  });

  it('renames, pins, selects, reloads, and resets v2 workspace metadata', async () => {
    const repository = { saveWorkspace: vi.fn(async () => undefined), deleteSession: vi.fn(async () => undefined), deleteContainer: vi.fn(async () => undefined), loadWorkspace: vi.fn(async () => ({ value: { ...initialState, activeSessionId: 's-old', activeContainerId: 'c-old' }, issues: [] })) } as never;
    const store = createWorkspaceStore(initialState, () => 70, repository);
    store.renameSession('s-old', 'Renamed');
    store.togglePinSession('s-old');
    store.updateSessionStatus('s-old', 'completed_unread');
    store.selectSession('s-old');
    store.renameContainer('c-old', 'Renamed container');
    store.togglePinContainer('c-old');
    store.selectContainer('c-old');
    await store.reload();
    expect(store.getSnapshot().sessions[0]).toMatchObject({ title: '旧会话' });
    await store.reset();
    expect(store.getSnapshot().sessions).toHaveLength(1);
    expect((repository as { saveWorkspace: ReturnType<typeof vi.fn> }).saveWorkspace).toHaveBeenCalled();
  });

  it('starts a fresh v2 workspace when none exists and leaves no stale active IDs after the last deletion', async () => {
    const repository = { saveWorkspace: vi.fn(async () => undefined), deleteSession: vi.fn(async () => undefined), deleteContainer: vi.fn(async () => undefined), loadWorkspace: vi.fn(async () => ({ value: null, issues: [] })) } as never;
    const store = createWorkspaceStore({ sessions: [{ id: 'only-session', title: 'Only', updatedAt: 1, status: 'failed_unread' }], containers: [{ id: 'only-container', name: 'Only', updatedAt: 1 }], activeSessionId: 'only-session', activeContainerId: 'only-container' }, () => 80, repository);
    await store.hydrate();
    expect(store.getSnapshot().hydrated).toBe(true);
    expect(store.getSnapshot().sessions).toHaveLength(1);
    const freshSessionId = store.getSnapshot().sessions[0]!.id;
    store.updateSessionStatus(freshSessionId, 'failed_unread');
    store.selectSession(freshSessionId);
    expect(store.getSnapshot().sessions[0]?.status).toBe('idle');

    const isolated = createWorkspaceStore({ sessions: [{ id: 'last-session', title: 'Last', updatedAt: 1 }], containers: [{ id: 'last-container', name: 'Last', updatedAt: 1 }], activeSessionId: 'last-session', activeContainerId: 'last-container' }, () => 81, repository);
    isolated.deleteSession('last-session');
    isolated.deleteContainer('last-container');
    expect(isolated.getSnapshot()).toMatchObject({ activeSessionId: null, activeContainerId: null });
  });

  it('recovers with a fresh workspace if v2 hydration fails', async () => {
    const repository = { saveWorkspace: vi.fn(async () => undefined), deleteSession: vi.fn(async () => undefined), deleteContainer: vi.fn(async () => undefined), loadWorkspace: vi.fn(async () => { throw new Error('indexeddb unavailable'); }) } as never;
    const store = createWorkspaceStore({ sessions: [], containers: [], activeSessionId: null, activeContainerId: null }, () => 90, repository);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await store.hydrate();
    expect(store.getSnapshot()).toMatchObject({ hydrated: true });
    expect(store.getSnapshot().sessions).toHaveLength(1);
    spy.mockRestore();
  });
});
