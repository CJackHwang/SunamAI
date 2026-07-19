import { useSyncExternalStore, useCallback } from 'react';

export interface Session {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
  status?: 'idle' | 'running' | 'completed_unread' | 'failed_unread';
}

export interface Container {
  id: string;
  name: string;
  updatedAt: number;
  pinned?: boolean;
}

interface WorkspaceState {
  sessions: Session[];
  containers: Container[];
  activeSessionId: string | null;
  activeContainerId: string | null;
}

const STORAGE_KEY = 'sunam_workspace_state';

const getInitialState = (): WorkspaceState => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse workspace state', e);
    }
  }
  const initTs = Date.now();
  const defaultSessionId = `s-${initTs.toString(36)}`;
  const defaultContainerId = `c-${initTs.toString(36)}`;
  return {
    sessions: [{ id: defaultSessionId, title: '新建对话', updatedAt: initTs }],
    containers: [{ id: defaultContainerId, name: '默认容器', updatedAt: initTs }],
    activeSessionId: defaultSessionId,
    activeContainerId: defaultContainerId,
  };
};

// Global state variables
let globalState: WorkspaceState = getInitialState();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => globalState;

const setState = (updater: (prev: WorkspaceState) => WorkspaceState) => {
  const next = updater(globalState);
  if (next !== globalState) {
    globalState = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(globalState));
    listeners.forEach((l) => l());
  }
};

export function useWorkspaceStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const createSession = useCallback(() => {
    const ts = Date.now();
    const newSession: Session = {
      id: `s-${ts.toString(36)}`,
      title: '新对话',
      updatedAt: ts,
    };
    setState((prev) => ({
      ...prev,
      sessions: [newSession, ...prev.sessions],
      activeSessionId: newSession.id,
    }));
    return newSession.id;
  }, []);

  const renameSession = useCallback((id: string, newTitle: string) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, title: newTitle, updatedAt: Date.now() } : s)),
    }));
  }, []);

  const deleteSession = useCallback((id: string) => {
    setState((prev) => {
      const filtered = prev.sessions.filter((s) => s.id !== id);
      return {
        ...prev,
        sessions: filtered,
        activeSessionId: prev.activeSessionId === id ? (filtered[0]?.id || null) : prev.activeSessionId,
      };
    });
  }, []);

  const togglePinSession = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, pinned: !s.pinned, updatedAt: Date.now() } : s)),
    }));
  }, []);

  const updateSessionStatus = useCallback((id: string, status: Session['status']) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, status } : s)),
    }));
  }, []);

  const selectSession = useCallback((id: string) => {
    setState((prev) => {
      // Clear unread status when selecting
      const updatedSessions = prev.sessions.map((s) => {
        if (s.id === id && (s.status === 'completed_unread' || s.status === 'failed_unread')) {
          return { ...s, status: 'idle' as const };
        }
        return s;
      });
      return { ...prev, activeSessionId: id, sessions: updatedSessions };
    });
  }, []);

  const createContainer = useCallback(() => {
    const ts = Date.now();
    const newContainer: Container = {
      id: `c-${ts.toString(36)}`,
      name: '新容器',
      updatedAt: ts,
    };
    setState((prev) => ({
      ...prev,
      containers: [newContainer, ...prev.containers],
      activeContainerId: newContainer.id,
    }));
    return newContainer.id;
  }, []);

  const renameContainer = useCallback((id: string, newName: string) => {
    setState((prev) => ({
      ...prev,
      containers: prev.containers.map((c) => (c.id === id ? { ...c, name: newName, updatedAt: Date.now() } : c)),
    }));
  }, []);

  const deleteContainer = useCallback((id: string) => {
    setState((prev) => {
      const filtered = prev.containers.filter((c) => c.id !== id);
      return {
        ...prev,
        containers: filtered,
        activeContainerId: prev.activeContainerId === id ? (filtered[0]?.id || null) : prev.activeContainerId,
      };
    });
  }, []);

  const togglePinContainer = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      containers: prev.containers.map((c) => (c.id === id ? { ...c, pinned: !c.pinned, updatedAt: Date.now() } : c)),
    }));
  }, []);

  const selectContainer = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeContainerId: id }));
  }, []);

  return {
    ...state,
    createSession,
    renameSession,
    deleteSession,
    togglePinSession,
    updateSessionStatus,
    selectSession,
    createContainer,
    renameContainer,
    deleteContainer,
    togglePinContainer,
    selectContainer,
  };
}
