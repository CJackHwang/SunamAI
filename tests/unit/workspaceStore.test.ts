import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '@/entities/workspace/store';
import type { WorkspaceState } from '@/entities/workspace/types';
import { V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import { clearV3Database } from '../helpers/persistenceDatabase';
import { registerWorkspaceDeletionPreparation } from '@/entities/workspace/deletionCoordinator';

const initialState: WorkspaceState = {
  sessions: [{ id: 's-old', title: '旧会话', updatedAt: 1 }],
  containers: [{ id: 'c-old', name: '旧容器', updatedAt: 1 }],
  activeSessionId: 's-old',
  activeContainerId: 'c-old',
};

function transientRepository(state: WorkspaceState = initialState) {
  return { saveWorkspace: vi.fn(async () => undefined), deleteSession: vi.fn(async () => undefined), deleteContainer: vi.fn(async () => undefined), loadWorkspace: vi.fn(async () => ({ value: state, issues: [] })) } as never;
}

describe('workspace store', () => {
  it('creates, selects, pins and removes sessions in the hydrated workspace', async () => {
    const store = createWorkspaceStore(initialState, () => 42, transientRepository());
    await store.hydrate();
    const sessionId = store.createSession();
    expect(sessionId).toMatch(/^s-/);
    store.renameSession(sessionId, '重命名');
    store.togglePinSession(sessionId);
    store.updateSessionStatus(sessionId, 'completed_unread');
    store.selectSession(sessionId);
    expect(store.getSnapshot().sessions[0]).toMatchObject({ title: '重命名', pinned: true, status: 'idle' });
    await store.deleteSession(sessionId);
    expect(store.getSnapshot().activeSessionId).toBe('s-old');
  });

  it('keeps container selection valid after deletion', async () => {
    const store = createWorkspaceStore(initialState, () => 50, transientRepository());
    await store.hydrate();
    const newId = store.createContainer();
    await store.deleteContainer(newId);
    expect(store.getSnapshot().activeContainerId).toBe('c-old');
  });

  it('reuses one empty conversation and consolidates redundant empty conversations', async () => {
    const emptyState: WorkspaceState = {
      ...initialState,
      sessions: [{ id: 's-empty', title: '新建对话', updatedAt: 2 }, { id: 's-redundant', title: '新对话', updatedAt: 1 }],
      activeSessionId: null,
    };
    const repository = transientRepository(emptyState);
    const store = createWorkspaceStore(emptyState, () => 51, repository);
    await store.hydrate();
    expect(store.createSession()).toBe('s-empty');
    expect(store.createSession()).toBe('s-empty');
    expect(store.getSnapshot().sessions).toHaveLength(1);
    expect(store.getSnapshot().activeSessionId).toBe('s-empty');
    await vi.waitFor(() => expect((repository as unknown as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession).toHaveBeenCalledWith('s-redundant', expect.objectContaining({ activeSessionId: 's-empty' })));

    store.updateSessionStatus('s-empty', 'running');
    expect(store.createSession()).not.toBe('s-empty');
    expect(store.getSnapshot().sessions).toHaveLength(2);
  });

  it('auto-suffixes duplicate container names when creating and renaming', async () => {
    const state = { ...initialState, containers: [], activeContainerId: null };
    const store = createWorkspaceStore(state, () => 52, transientRepository(state));
    await store.hydrate();
    const firstId = store.createContainer();
    const secondId = store.createContainer();
    const thirdId = store.createContainer();
    expect(store.getSnapshot().containers.map((container) => container.name)).toEqual(['新容器2', '新容器1', '新容器']);

    store.renameContainer(thirdId, ' 新容器1 ');
    expect(store.getSnapshot().containers.find((container) => container.id === thirdId)?.name).toBe('新容器2');
    expect(new Set(store.getSnapshot().containers.map((container) => container.name)).size).toBe(3);
    expect(firstId).not.toBe(secondId);
  });

  it('hydrates the v3 workspace state on a fresh store', async () => {
    const repository = new V3PersistenceRepository();
    await clearV3Database();
    await repository.saveWorkspace(initialState);
    const store = createWorkspaceStore({ ...initialState, sessions: [], containers: [], activeSessionId: null, activeContainerId: null }, () => 60, repository);
    await store.hydrate();
    expect(store.getSnapshot()).toMatchObject({ activeSessionId: 's-old', activeContainerId: 'c-old' });
  });

  it('blocks workspace mutations until the durable record has hydrated', async () => {
    let finishLoad!: (value: { value: WorkspaceState; issues: [] }) => void;
    const repository = {
      saveWorkspace: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
      deleteContainer: vi.fn(async () => undefined),
      loadWorkspace: vi.fn(() => new Promise<{ value: WorkspaceState; issues: [] }>((resolve) => { finishLoad = resolve; })),
    } as never;
    const store = createWorkspaceStore(initialState, () => 61, repository);
    const hydration = store.hydrate();
    store.renameSession('s-old', 'must wait');
    expect(store.getSnapshot().sessions[0]?.title).toBe('旧会话');
    finishLoad({ value: initialState, issues: [] });
    await hydration;
    store.renameSession('s-old', 'ready');
    expect(store.getSnapshot().sessions[0]?.title).toBe('ready');
  });

  it('renames, pins, selects, reloads, and resets v3 workspace metadata', async () => {
    const repository = { saveWorkspace: vi.fn(async () => undefined), deleteSession: vi.fn(async () => undefined), deleteContainer: vi.fn(async () => undefined), loadWorkspace: vi.fn(async () => ({ value: { ...initialState, activeSessionId: 's-old', activeContainerId: 'c-old' }, issues: [] })) } as never;
    const store = createWorkspaceStore(initialState, () => 70, repository);
    await store.hydrate();
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

  it('starts a fresh v3 workspace when none exists and leaves no stale active IDs after the last deletion', async () => {
    const repository = { saveWorkspace: vi.fn(async () => undefined), deleteSession: vi.fn(async () => undefined), deleteContainer: vi.fn(async () => undefined), loadWorkspace: vi.fn(async () => ({ value: null, issues: [] })) } as never;
    const store = createWorkspaceStore({ sessions: [{ id: 'only-session', title: 'Only', updatedAt: 1, status: 'failed_unread' }], containers: [{ id: 'only-container', name: 'Only', updatedAt: 1 }], activeSessionId: 'only-session', activeContainerId: 'only-container' }, () => 80, repository);
    await store.hydrate();
    expect(store.getSnapshot().hydrated).toBe(true);
    expect(store.getSnapshot().sessions).toHaveLength(1);
    const freshSessionId = store.getSnapshot().sessions[0]!.id;
    store.updateSessionStatus(freshSessionId, 'failed_unread');
    store.selectSession(freshSessionId);
    expect(store.getSnapshot().sessions[0]?.status).toBe('idle');

    const isolatedState = { sessions: [{ id: 'last-session', title: 'Last', updatedAt: 1 }], containers: [{ id: 'last-container', name: 'Last', updatedAt: 1 }], activeSessionId: 'last-session', activeContainerId: 'last-container' } satisfies WorkspaceState;
    const isolated = createWorkspaceStore(isolatedState, () => 81, transientRepository(isolatedState));
    await isolated.hydrate();
    await isolated.deleteSession('last-session');
    await isolated.deleteContainer('last-container');
    expect(isolated.getSnapshot()).toMatchObject({ activeSessionId: null, activeContainerId: null });
  });

  it('pauses editing instead of inventing a workspace if v3 hydration fails', async () => {
    const repository = { saveWorkspace: vi.fn(async () => undefined), deleteSession: vi.fn(async () => undefined), deleteContainer: vi.fn(async () => undefined), loadWorkspace: vi.fn(async () => { throw new Error('indexeddb unavailable'); }) } as never;
    const store = createWorkspaceStore({ sessions: [], containers: [], activeSessionId: null, activeContainerId: null }, () => 90, repository);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await store.hydrate();
    expect(store.getSnapshot()).toMatchObject({ hydrated: false, persistenceError: 'indexeddb unavailable' });
    expect(store.getSnapshot().sessions).toHaveLength(0);
    spy.mockRestore();
  });

  it('does not overwrite a quarantined workspace record with a fresh workspace', async () => {
    const repository = {
      saveWorkspace: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
      deleteContainer: vi.fn(async () => undefined),
      loadWorkspace: vi.fn(async () => ({ value: null, issues: [{ id: 'issue-workspace-current' }] })),
    } as never;
    const store = createWorkspaceStore(initialState, () => 90, repository);
    await store.hydrate();
    expect(store.getSnapshot().hydrated).toBe(false);
    expect(store.getSnapshot().persistenceError).toContain('no replacement workspace was written');
    expect((repository as { saveWorkspace: ReturnType<typeof vi.fn> }).saveWorkspace).not.toHaveBeenCalled();
    expect(store.getSnapshot().sessions).toEqual(initialState.sessions);
  });

  it('exposes write failures and blocks later mutations until retry', async () => {
    const repository = { saveWorkspace: vi.fn(async () => { throw new Error('write failed'); }), deleteSession: vi.fn(async () => undefined), deleteContainer: vi.fn(async () => undefined), loadWorkspace: vi.fn(async () => ({ value: initialState, issues: [] })) } as never;
    const store = createWorkspaceStore(initialState, () => 91, repository);
    await store.hydrate();
    const id = store.createSession();
    await vi.waitFor(() => expect(store.getSnapshot().persistenceError).toBe('write failed'));
    const titleBefore = store.getSnapshot().sessions.find((session) => session.id === id)?.title;
    store.renameSession(id, 'must not mutate');
    expect(store.getSnapshot().sessions.find((session) => session.id === id)?.title).toBe(titleBefore);
  });

  it('surfaces scoped deletion failures instead of logging and continuing silently', async () => {
    const repository = { saveWorkspace: vi.fn(async () => undefined), deleteSession: vi.fn(async () => { throw new Error('delete failed'); }), deleteContainer: vi.fn(async () => undefined), loadWorkspace: vi.fn(async () => ({ value: initialState, issues: [] })) } as never;
    const store = createWorkspaceStore(initialState, () => 92, repository);
    await store.hydrate();
    await store.deleteSession('s-old');
    expect(store.getSnapshot().persistenceError).toBe('delete failed');
  });

  it('serializes workspace saves and transactional deletions in call order', async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const repository = {
      saveWorkspace: vi.fn(() => saveGate),
      deleteSession: vi.fn(async () => undefined),
      deleteContainer: vi.fn(async () => undefined),
      loadWorkspace: vi.fn(async () => ({ value: initialState, issues: [] })),
    } as never;
    const store = createWorkspaceStore(initialState, () => 93, repository);
    await store.hydrate();
    const sessionId = store.createSession();
    const deletion = store.deleteSession(sessionId);
    await Promise.resolve();
    expect((repository as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession).not.toHaveBeenCalled();
    releaseSave();
    await deletion;
    await vi.waitFor(() => expect((repository as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession).toHaveBeenCalledOnce());
  });

  it('waits for active-run deletion preparation before removing durable session data', async () => {
    let releasePreparation!: () => void;
    const preparationGate = new Promise<void>((resolve) => { releasePreparation = resolve; });
    const preparation = vi.fn(() => preparationGate);
    const unregister = registerWorkspaceDeletionPreparation(preparation);
    const repository = transientRepository();
    try {
      const store = createWorkspaceStore(initialState, () => 94, repository);
      await store.hydrate();
      const deletion = store.deleteSession('s-old');
      await vi.waitFor(() => expect(preparation).toHaveBeenCalledWith({ kind: 'session', id: 's-old' }));
      expect((repository as unknown as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession).not.toHaveBeenCalled();
      releasePreparation();
      await deletion;
      await vi.waitFor(() => expect((repository as unknown as { deleteSession: ReturnType<typeof vi.fn> }).deleteSession).toHaveBeenCalledOnce());
    } finally {
      unregister();
    }
  });
});
