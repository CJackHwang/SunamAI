import type { WorkspaceState } from './types';

/** A development workspace starts from a new in-memory state on every reload. */
export function createInitialWorkspaceState(now = Date.now()): WorkspaceState {
  const entropy = Math.random().toString(36).slice(2, 8);
  const defaultSessionId = `s-${now.toString(36)}-${entropy}`;
  const defaultContainerId = `c-${now.toString(36)}-${entropy}`;
  return {
    sessions: [{ id: defaultSessionId, title: '新建对话', updatedAt: now }],
    containers: [{ id: defaultContainerId, name: '默认容器', updatedAt: now }],
    activeSessionId: defaultSessionId,
    activeContainerId: defaultContainerId,
  };
}
