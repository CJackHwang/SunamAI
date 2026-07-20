import { useEffect, useSyncExternalStore } from 'react';
import { createInitialWorkspaceState } from '@/entities/workspace/repository';
import type { Container, Session, SessionStatus, WorkspaceState } from '@/entities/workspace/types';
import { v2Persistence, type V2PersistenceRepository } from '@/shared/persistence/v2Repository';
import { createId } from '@/shared/lib/ids';
import { toErrorMessage } from '@/shared/lib/errors';

export type { Container, Session, WorkspaceState } from '@/entities/workspace/types';

interface WorkspaceSnapshot extends WorkspaceState {
  hydrated: boolean;
  persistenceError: string | null;
}

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

const EMPTY_SESSION_TITLES = new Set(['新对话', '新建对话']);
const DAMAGED_WORKSPACE_MESSAGE = 'The saved workspace is damaged and was isolated. Retry after reviewing the storage error; no replacement workspace was written.';

function ensureWorkspaceRecordIsSafe(result: Awaited<ReturnType<V2PersistenceRepository['loadWorkspace']>>) {
  if (!result.value && result.issues.length) throw new Error(DAMAGED_WORKSPACE_MESSAGE);
  return result.value;
}

function isReusableEmptySession(session: Session) {
  // Every launched run sets a status synchronously. An idle status may therefore
  // belong to an interrupted run and must not be mistaken for an empty context.
  return EMPTY_SESSION_TITLES.has(session.title.trim()) && session.status === undefined;
}

function normalizeContainerName(name: string) {
  return name.trim().normalize('NFKC').toLocaleLowerCase();
}

export function nextUniqueContainerName(containers: Container[], requestedName = '新容器', excludedId?: string) {
  const baseName = requestedName.trim() || '新容器';
  const occupied = new Set(containers
    .filter((container) => container.id !== excludedId)
    .map((container) => normalizeContainerName(container.name)));
  if (!occupied.has(normalizeContainerName(baseName))) return baseName;
  const numberedName = /^(.*?)(\d+)$/u.exec(baseName);
  const stem = numberedName?.[1] || baseName;
  let suffix = numberedName ? Number(numberedName[2]) + 1 : 1;
  while (occupied.has(normalizeContainerName(`${stem}${suffix}`))) suffix += 1;
  return `${stem}${suffix}`;
}

export function createWorkspaceStore(
  initialState: WorkspaceState = createInitialWorkspaceState(),
  now: () => number = Date.now,
  repository: V2PersistenceRepository = v2Persistence,
): WorkspaceStore {
  let state: WorkspaceSnapshot = { ...initialState, hydrated: false, persistenceError: null };
  let hydration: Promise<void> | null = null;
  let writeChain = Promise.resolve();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const persist = (next: WorkspaceState) => {
    writeChain = writeChain.then(() => repository.saveWorkspace(next)).catch((error) => {
      state = { ...state, persistenceError: toErrorMessage(error) };
      listeners.forEach((listener) => listener());
    });
  };
  const setState = (updater: (previous: WorkspaceState) => WorkspaceState) => {
    if (!state.hydrated || state.persistenceError) return;
    const nextState = updater(state);
    if (nextState === state) return;
    state = { ...nextState, hydrated: state.hydrated, persistenceError: null };
    persist(state);
    listeners.forEach((listener) => listener());
  };
  const reportPersistenceError = (error: unknown) => {
    state = { ...state, persistenceError: toErrorMessage(error) };
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe,
    getSnapshot: () => state,
    hydrate: async () => {
      if (hydration) return hydration;
      hydration = (async () => {
        const loaded = await repository.loadWorkspace();
        const next = ensureWorkspaceRecordIsSafe(loaded) ?? createInitialWorkspaceState(now());
        state = { ...next, hydrated: true, persistenceError: null };
        if (!loaded.value) persist(next);
        listeners.forEach((listener) => listener());
        await writeChain;
      })().catch((error) => {
        state = { ...state, hydrated: false, persistenceError: toErrorMessage(error) };
        listeners.forEach((listener) => listener());
      });
      return hydration;
    },
    reload: async () => {
      hydration = null;
      state = { ...state, hydrated: false, persistenceError: null };
      listeners.forEach((listener) => listener());
      try {
        const loaded = await repository.loadWorkspace();
        state = { ...(ensureWorkspaceRecordIsSafe(loaded) ?? createInitialWorkspaceState(now())), hydrated: true, persistenceError: null };
        listeners.forEach((listener) => listener());
      } catch (error) {
        state = { ...state, hydrated: false, persistenceError: toErrorMessage(error) };
        listeners.forEach((listener) => listener());
      }
    },
    reset: async () => {
      const next = createInitialWorkspaceState(now());
      state = { ...next, hydrated: true, persistenceError: null };
      await repository.saveWorkspace(next);
      listeners.forEach((listener) => listener());
    },
    createSession: () => {
      const emptySessions = state.sessions.filter(isReusableEmptySession);
      const reusable = emptySessions.find((session) => session.id === state.activeSessionId) ?? emptySessions[0];
      if (reusable) {
        if (!state.hydrated || state.persistenceError) return reusable.id;
        const redundantIds = new Set(emptySessions.filter((session) => session.id !== reusable.id).map((session) => session.id));
        setState((previous) => previous.activeSessionId === reusable.id && redundantIds.size === 0
          ? previous
          : { ...previous, sessions: previous.sessions.filter((session) => !redundantIds.has(session.id)), activeSessionId: reusable.id });
        redundantIds.forEach((id) => { void repository.deleteSession(id).catch(reportPersistenceError); });
        return reusable.id;
      }
      const timestamp = now();
      const session: Session = { id: createId('s'), title: '新对话', updatedAt: timestamp };
      setState((previous) => ({ ...previous, sessions: [session, ...previous.sessions], activeSessionId: session.id }));
      return session.id;
    },
    renameSession: (id, title) => setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => session.id === id ? { ...session, title, updatedAt: now() } : session),
    })),
    deleteSession: (id) => setState((previous) => {
      const sessions = previous.sessions.filter((session) => session.id !== id);
      void repository.deleteSession(id).catch(reportPersistenceError);
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
      const container: Container = { id: createId('c'), name: nextUniqueContainerName(state.containers), updatedAt: timestamp };
      setState((previous) => ({ ...previous, containers: [container, ...previous.containers], activeContainerId: container.id }));
      return container.id;
    },
    renameContainer: (id, name) => setState((previous) => {
      const uniqueName = nextUniqueContainerName(previous.containers, name, id);
      return {
        ...previous,
        containers: previous.containers.map((container) => container.id === id ? { ...container, name: uniqueName, updatedAt: now() } : container),
      };
    }),
    deleteContainer: (id) => setState((previous) => {
      const containers = previous.containers.filter((container) => container.id !== id);
      void repository.deleteContainer(id).catch(reportPersistenceError);
      return { ...previous, containers, activeContainerId: previous.activeContainerId === id ? containers[0]?.id ?? null : previous.activeContainerId };
    }),
    togglePinContainer: (id) => setState((previous) => ({
      ...previous,
      containers: previous.containers.map((container) => container.id === id ? { ...container, pinned: !container.pinned, updatedAt: now() } : container),
    })),
    selectContainer: (id) => setState((previous) => ({ ...previous, activeContainerId: id })),
  };
}

const workspaceStore = createWorkspaceStore({
  sessions: [],
  containers: [],
  activeSessionId: null,
  activeContainerId: null,
});

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
