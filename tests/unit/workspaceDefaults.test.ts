import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceStore } from '@/entities/workspace/store';
import { isDefaultSessionTitle } from '@/entities/workspace/defaults';

function emptyRepository() {
  return {
    loadWorkspace: vi.fn(async () => ({ value: null, issues: [] })),
    saveWorkspace: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
    deleteContainer: vi.fn(async () => undefined),
  };
}

describe('localized workspace defaults', () => {
  it('uses the current creation language for hydration, later resources, and reset without renaming custom resources', async () => {
    const repository = emptyRepository();
    const store = createWorkspaceStore({ sessions: [], containers: [], activeSessionId: null, activeContainerId: null }, () => 10, repository);
    store.configureCreationDefaults({ sessionTitle: 'New conversation', containerName: 'New container' });
    await store.hydrate();
    const initial = store.getSnapshot();
    expect(initial.sessions[0]?.title).toBe('New conversation');
    expect(initial.containers[0]?.name).toBe('New container');

    store.renameSession(initial.sessions[0]!.id, 'Custom title');
    store.renameContainer(initial.containers[0]!.id, 'Custom container');
    store.configureCreationDefaults({ sessionTitle: '新しい会話', containerName: '新規コンテナ' });
    const sessionId = store.createSession();
    const containerId = store.createContainer();
    expect(store.getSnapshot().sessions.find((session) => session.id === sessionId)?.title).toBe('新しい会話');
    expect(store.getSnapshot().containers.find((container) => container.id === containerId)?.name).toBe('新規コンテナ');
    expect(store.getSnapshot().sessions.some((session) => session.title === 'Custom title')).toBe(true);
    expect(store.getSnapshot().containers.some((container) => container.name === 'Custom container')).toBe(true);

    await store.reset();
    expect(store.getSnapshot().sessions[0]?.title).toBe('新しい会話');
    expect(store.getSnapshot().containers[0]?.name).toBe('新規コンテナ');
  });

  it('recognizes supported legacy localized empty-session names', () => {
    expect(['新对话', '新建对话', 'New conversation', 'New chat', '新しい会話', '新規会話'].every(isDefaultSessionTitle)).toBe(true);
    expect(isDefaultSessionTitle('User-defined task')).toBe(false);
  });

  it('falls back to non-empty canonical defaults when injected labels are blank', async () => {
    const store = createWorkspaceStore({ sessions: [], containers: [], activeSessionId: null, activeContainerId: null }, () => 10, emptyRepository());
    store.configureCreationDefaults({ sessionTitle: '   ', containerName: '' });
    await store.hydrate();
    expect(store.getSnapshot().sessions[0]?.title).toBe('新对话');
    expect(store.getSnapshot().containers[0]?.name).toBe('新容器');
  });
});
