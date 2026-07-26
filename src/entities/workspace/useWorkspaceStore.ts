import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { createWorkspaceStore, type WorkspaceSnapshot } from './store';
import type { WorkspaceCreationDefaults } from './defaults';

const workspaceStore = createWorkspaceStore({ sessions: [], containers: [], activeSessionId: null, activeContainerId: null });

const workspaceActions = {
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

export function configureWorkspaceCreationDefaults(defaults: WorkspaceCreationDefaults): void {
  workspaceStore.configureCreationDefaults(defaults);
}

export function useWorkspaceSelector<T>(selector: (state: WorkspaceSnapshot) => T, equality: (left: T, right: T) => boolean = Object.is): T {
  const cache = useRef<{ snapshot: WorkspaceSnapshot; selector: typeof selector; selection: T } | null>(null);
  const getSelection = useCallback(() => {
    const snapshot = workspaceStore.getSnapshot();
    if (cache.current?.snapshot === snapshot && cache.current.selector === selector) return cache.current.selection;
    const selection = selector(snapshot);
    if (cache.current && equality(cache.current.selection, selection)) {
      cache.current = { snapshot, selector, selection: cache.current.selection };
      return cache.current.selection;
    }
    cache.current = { snapshot, selector, selection };
    return selection;
  }, [equality, selector]);
  const selection = useSyncExternalStore(workspaceStore.subscribe, getSelection, getSelection);
  useEffect(() => { void workspaceStore.hydrate(); }, []);
  return selection;
}

export function useWorkspaceActions() {
  useEffect(() => { void workspaceStore.hydrate(); }, []);
  return workspaceActions;
}
