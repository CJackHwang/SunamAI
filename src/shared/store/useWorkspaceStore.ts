import { useEffect, useSyncExternalStore } from 'react';
import { createInitialWorkspaceState } from '@/entities/workspace/repository';
import type { Container, Session, SessionStatus, WorkspaceState } from '@/entities/workspace/types';
import { v2Persistence, type V2PersistenceRepository } from '@/shared/persistence/v2Repository';

export type { Container, Session, WorkspaceState } from '@/entities/workspace/types';

interface WorkspaceSnapshot extends WorkspaceState { hydrated: boolean; }

interface WorkspaceStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => WorkspaceSnapshot;
  hydrate: () => Promise<void>;
  reload: () => Promise<void>;
  reset: () => Promise<void>;
  createSession: () => string;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  togglePinSession: (id: string) => void;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
  selectSession: (id: string) => void;
  createContainer: () => string;
  renameContainer: (id: string, name: string) => void;
  deleteContainer: (id: string) => void;
  togglePinContainer: (id: string) => void;
  selectContainer: (id: string) => void;
}

export function createWorkspaceStore(
  initialState: WorkspaceState = createInitialWorkspaceState(),
  now: () => number = Date.now,
  repository: V2PersistenceRepository = v2Persistence,
): WorkspaceStore {
  let state: WorkspaceSnapshot = { ...initialState, hydrated: false };
  let hydration: Promise<void> | null = null;
  let writeChain = Promise.resolve();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const persist = (next: WorkspaceState) => {
    writeChain = writeChain.then(() => repository.saveWorkspace(next)).catch((error) => console.error('Failed to persist v2 workspace:', error));
  };
  const setState = (updater: (previous: WorkspaceState) => WorkspaceState) => {
    const nextState = updater(state);
    if (nextState === state) return;
    state = { ...nextState, hydrated: state.hydrated };
    persist(state);
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe,
    getSnapshot: () => state,
    hydrate: async () => {
      if (hydration) return hydration;
      hydration = (async () => {
        const loaded = await repository.loadWorkspace();
        const next = loaded.value ?? createInitialWorkspaceState(now());
        state = { ...next, hydrated: true };
        if (!loaded.value) persist(next);
        listeners.forEach((listener) => listener());
        await writeChain;
      })().catch((error) => {
        console.error('Failed to load v2 workspace:', error);
        state = { ...createInitialWorkspaceState(now()), hydrated: true };
        listeners.forEach((listener) => listener());
      });
      return hydration;
    },
    reload: async () => {
      hydration = null;
      await (async () => {
        const loaded = await repository.loadWorkspace();
        state = { ...(loaded.value ?? createInitialWorkspaceState(now())), hydrated: true };
        listeners.forEach((listener) => listener());
      })();
    },
    reset: async () => {
      const next = createInitialWorkspaceState(now());
      state = { ...next, hydrated: true };
      await repository.saveWorkspace(next);
      listeners.forEach((listener) => listener());
    },
    createSession: () => {
      const timestamp = now();
      const session: Session = { id: `s-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, title: '新对话', updatedAt: timestamp };
      setState((previous) => ({ ...previous, sessions: [session, ...previous.sessions], activeSessionId: session.id }));
      return session.id;
    },
    renameSession: (id, title) => setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => session.id === id ? { ...session, title, updatedAt: now() } : session),
    })),
    deleteSession: (id) => setState((previous) => {
      const sessions = previous.sessions.filter((session) => session.id !== id);
      void repository.deleteSession(id).catch((error) => console.error('Failed to delete v2 session data:', error));
      return { ...previous, sessions, activeSessionId: previous.activeSessionId === id ? sessions[0]?.id ?? null : previous.activeSessionId };
    }),
    togglePinSession: (id) => setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => session.id === id ? { ...session, pinned: !session.pinned, updatedAt: now() } : session),
    })),
    updateSessionStatus: (id, status) => setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => session.id === id ? { ...session, status } : session),
    })),
    selectSession: (id) => setState((previous) => ({
      ...previous,
      activeSessionId: id,
      sessions: previous.sessions.map((session) => session.id === id && (session.status === 'completed_unread' || session.status === 'failed_unread')
        ? { ...session, status: 'idle' }
        : session),
    })),
    createContainer: () => {
      const timestamp = now();
      const container: Container = { id: `c-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: '新容器', updatedAt: timestamp };
      setState((previous) => ({ ...previous, containers: [container, ...previous.containers], activeContainerId: container.id }));
      return container.id;
    },
    renameContainer: (id, name) => setState((previous) => ({
      ...previous,
      containers: previous.containers.map((container) => container.id === id ? { ...container, name, updatedAt: now() } : container),
    })),
    deleteContainer: (id) => setState((previous) => {
      const containers = previous.containers.filter((container) => container.id !== id);
      void repository.deleteContainer(id).catch((error) => console.error('Failed to delete v2 container data:', error));
      return { ...previous, containers, activeContainerId: previous.activeContainerId === id ? containers[0]?.id ?? null : previous.activeContainerId };
    }),
    togglePinContainer: (id) => setState((previous) => ({
      ...previous,
      containers: previous.containers.map((container) => container.id === id ? { ...container, pinned: !container.pinned, updatedAt: now() } : container),
    })),
    selectContainer: (id) => setState((previous) => ({ ...previous, activeContainerId: id })),
  };
}

const workspaceStore = createWorkspaceStore();

export function useWorkspaceStore() {
  const state = useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getSnapshot);
  useEffect(() => { void workspaceStore.hydrate(); }, []);
  return {
    ...state,
    reloadWorkspace: workspaceStore.reload,
    resetWorkspace: workspaceStore.reset,
    createSession: workspaceStore.createSession,
    renameSession: workspaceStore.renameSession,
    deleteSession: workspaceStore.deleteSession,
    togglePinSession: workspaceStore.togglePinSession,
    updateSessionStatus: workspaceStore.updateSessionStatus,
    selectSession: workspaceStore.selectSession,
    createContainer: workspaceStore.createContainer,
    renameContainer: workspaceStore.renameContainer,
    deleteContainer: workspaceStore.deleteContainer,
    togglePinContainer: workspaceStore.togglePinContainer,
    selectContainer: workspaceStore.selectContainer,
  };
}
