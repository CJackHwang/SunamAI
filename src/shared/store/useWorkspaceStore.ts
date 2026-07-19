import { useSyncExternalStore } from 'react';
import { loadWorkspaceState, saveWorkspaceState } from '@/entities/workspace/repository';
import type { Container, Session, SessionStatus, WorkspaceState } from '@/entities/workspace/types';

export type { Container, Session, WorkspaceState } from '@/entities/workspace/types';

interface WorkspaceStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => WorkspaceState;
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
  initialState: WorkspaceState = loadWorkspaceState(),
  persist: (state: WorkspaceState) => void = saveWorkspaceState,
  now: () => number = Date.now,
): WorkspaceStore {
  let state = initialState;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const setState = (updater: (previous: WorkspaceState) => WorkspaceState) => {
    const nextState = updater(state);
    if (nextState === state) return;
    state = nextState;
    persist(state);
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe,
    getSnapshot: () => state,
    createSession: () => {
      const timestamp = now();
      const session: Session = { id: `s-${timestamp.toString(36)}`, title: '新对话', updatedAt: timestamp };
      setState((previous) => ({ ...previous, sessions: [session, ...previous.sessions], activeSessionId: session.id }));
      return session.id;
    },
    renameSession: (id, title) => setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => session.id === id ? { ...session, title, updatedAt: now() } : session),
    })),
    deleteSession: (id) => setState((previous) => {
      const sessions = previous.sessions.filter((session) => session.id !== id);
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
      const container: Container = { id: `c-${timestamp.toString(36)}`, name: '新容器', updatedAt: timestamp };
      setState((previous) => ({ ...previous, containers: [container, ...previous.containers], activeContainerId: container.id }));
      return container.id;
    },
    renameContainer: (id, name) => setState((previous) => ({
      ...previous,
      containers: previous.containers.map((container) => container.id === id ? { ...container, name, updatedAt: now() } : container),
    })),
    deleteContainer: (id) => setState((previous) => {
      const containers = previous.containers.filter((container) => container.id !== id);
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
  return {
    ...state,
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
