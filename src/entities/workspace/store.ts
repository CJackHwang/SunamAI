import { useEffect, useSyncExternalStore } from 'react';
import { createInitialWorkspaceState } from '@/entities/workspace/repository';
import type { SessionStatus, WorkspaceState } from '@/entities/workspace/types';
import { v2Persistence, type V2PersistenceRepository } from '@/shared/persistence/v2Repository';
import { toErrorMessage } from '@/shared/lib/errors';
import { createSessionActions } from './sessionStore';
import { createContainerActions } from './containerStore';

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

const DAMAGED_WORKSPACE_MESSAGE = 'The saved workspace is damaged and was isolated. Retry after reviewing the storage error; no replacement workspace was written.';

function ensureWorkspaceRecordIsSafe(result: Awaited<ReturnType<V2PersistenceRepository['loadWorkspace']>>) {
  if (!result.value && result.issues.length) throw new Error(DAMAGED_WORKSPACE_MESSAGE);
  return result.value;
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
  
  const getState = () => state;
  const isHydratedAndSafe = () => state.hydrated && !state.persistenceError;
  
  const reportPersistenceError = (error: unknown) => {
    state = { ...state, persistenceError: toErrorMessage(error) };
    listeners.forEach((listener) => listener());
  };

  const sessionActions = createSessionActions(setState, getState, isHydratedAndSafe, now, repository, reportPersistenceError);
  const containerActions = createContainerActions(setState, getState, now, repository, reportPersistenceError);

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
    ...sessionActions,
    ...containerActions,
  };
}

const workspaceStore = createWorkspaceStore({
  sessions: [],
  containers: [],
  activeSessionId: null,
  activeContainerId: null,
});

export function useWorkspaceStore() {
  const state = useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getSnapshot, workspaceStore.getSnapshot);
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
