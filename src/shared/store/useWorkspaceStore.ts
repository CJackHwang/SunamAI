import { useState, useEffect, useCallback } from 'react';

export interface Session {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
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

const defaultState: WorkspaceState = {
  sessions: [{ id: 'default-session', title: '新建对话', updatedAt: Date.now() }],
  containers: [{ id: 'default-container', name: '默认容器', updatedAt: Date.now() }],
  activeSessionId: 'default-session',
  activeContainerId: 'default-container',
};

export function useWorkspaceStore() {
  const [state, setState] = useState<WorkspaceState>(defaultState);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setState(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse workspace state', e);
      }
    }
  }, []);

  // Save to localStorage whenever state changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const updateState = useCallback((updates: Partial<WorkspaceState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  // --- Session Methods ---
  const createSession = useCallback(() => {
    const newSession: Session = {
      id: `session-${Date.now()}`,
      title: '新对话',
      updatedAt: Date.now(),
    };
    setState((prev) => ({
      ...prev,
      sessions: [newSession, ...prev.sessions],
      activeSessionId: newSession.id,
    }));
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

  const selectSession = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeSessionId: id }));
  }, []);

  // --- Container Methods ---
  const createContainer = useCallback(() => {
    const newContainer: Container = {
      id: `container-${Date.now()}`,
      name: '新容器',
      updatedAt: Date.now(),
    };
    setState((prev) => ({
      ...prev,
      containers: [newContainer, ...prev.containers],
      activeContainerId: newContainer.id,
    }));
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
    selectSession,
    createContainer,
    renameContainer,
    deleteContainer,
    togglePinContainer,
    selectContainer,
  };
}
