import { createInitialWorkspaceState } from '@/entities/workspace/repository';
import type { SessionStatus, WorkspacePersistenceRepository, WorkspaceState } from '@/entities/workspace/types';
import { toErrorMessage } from '@/shared/lib/errors';
import { createSessionActions } from './sessionStore';
import { createContainerActions } from './containerStore';

export type { Container, Session, WorkspaceState } from '@/entities/workspace/types';

export interface WorkspaceSnapshot extends WorkspaceState {
  hydrated: boolean;
  persistenceError: string | null;
}

export interface WorkspaceStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => WorkspaceSnapshot;
  hydrate: () => Promise<void>;
  reload: () => Promise<void>;
  reset: () => Promise<void>;
  createSession: () => string;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => Promise<void>;
  togglePinSession: (id: string) => void;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
  selectSession: (id: string) => void;
  createContainer: () => string;
  renameContainer: (id: string, name: string) => void;
  deleteContainer: (id: string) => Promise<void>;
  togglePinContainer: (id: string) => void;
  selectContainer: (id: string) => void;
}

const DAMAGED_WORKSPACE_MESSAGE = 'The saved workspace is damaged and was isolated. Retry after reviewing the storage error; no replacement workspace was written.';

const lazyWorkspacePersistence: WorkspacePersistenceRepository = {
  async loadWorkspace() { return (await import('@/entities/persistence/v3Repository')).v3Persistence.loadWorkspace(); },
  async saveWorkspace(workspace) { return (await import('@/entities/persistence/v3Repository')).v3Persistence.saveWorkspace(workspace); },
  async deleteSession(sessionId, nextWorkspace) { return (await import('@/entities/persistence/v3Repository')).v3Persistence.deleteSession(sessionId, nextWorkspace); },
  async deleteContainer(containerId, nextWorkspace) { return (await import('@/entities/persistence/v3Repository')).v3Persistence.deleteContainer(containerId, nextWorkspace); },
};

function ensureWorkspaceRecordIsSafe(result: Awaited<ReturnType<WorkspacePersistenceRepository['loadWorkspace']>>) {
  if (!result.value && result.issues.length) throw new Error(DAMAGED_WORKSPACE_MESSAGE);
  return result.value;
}

export function createWorkspaceStore(
  initialState: WorkspaceState = createInitialWorkspaceState(),
  now: () => number = Date.now,
  repository: WorkspacePersistenceRepository = lazyWorkspacePersistence,
): WorkspaceStore {
  let state: WorkspaceSnapshot = { ...initialState, hydrated: false, persistenceError: null };
  let hydration: Promise<void> | null = null;
  let writeChain = Promise.resolve();
  const listeners = new Set<() => void>();
  
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  
  const reportPersistenceError = (error: unknown) => {
      state = { ...state, persistenceError: toErrorMessage(error) };
      listeners.forEach((listener) => listener());
  };

  const enqueuePersistence = (operation: () => Promise<void>): Promise<void> => {
    writeChain = writeChain.then(operation).catch(reportPersistenceError);
    return writeChain;
  };

  const currentWorkspaceState = (): WorkspaceState => ({
    sessions: state.sessions,
    containers: state.containers,
    activeSessionId: state.activeSessionId,
    activeContainerId: state.activeContainerId,
  });

  const persist = () => {
    void enqueuePersistence(() => repository.saveWorkspace(currentWorkspaceState()));
  };
  
  const setState = (updater: (previous: WorkspaceState) => WorkspaceState, options: { persist?: boolean } = {}): WorkspaceState => {
    if (!state.hydrated || state.persistenceError) return state;
    const nextState = updater(state);
    if (nextState === state) return state;
    state = { ...nextState, hydrated: state.hydrated, persistenceError: null };
    if (options.persist !== false) persist();
    listeners.forEach((listener) => listener());
    return state;
  };
  
  const getState = () => state;
  const isHydratedAndSafe = () => state.hydrated && !state.persistenceError;
  
  const sessionActions = createSessionActions(setState, getState, isHydratedAndSafe, now, repository, enqueuePersistence);
  const containerActions = createContainerActions(setState, getState, now, repository, enqueuePersistence);

  return {
    subscribe,
    getSnapshot: () => state,
    hydrate: async () => {
      if (hydration) return hydration;
      hydration = (async () => {
        const loaded = await repository.loadWorkspace();
        const next = ensureWorkspaceRecordIsSafe(loaded) ?? createInitialWorkspaceState(now());
        state = { ...next, hydrated: true, persistenceError: null };
        if (!loaded.value) persist();
        listeners.forEach((listener) => listener());
        await writeChain;
      })().catch((error) => {
        state = { ...state, hydrated: false, persistenceError: toErrorMessage(error) };
        listeners.forEach((listener) => listener());
      });
      return hydration;
    },
    reload: async () => {
      await writeChain;
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
      await enqueuePersistence(() => repository.saveWorkspace(next));
      listeners.forEach((listener) => listener());
    },
    ...sessionActions,
    ...containerActions,
  };
}
