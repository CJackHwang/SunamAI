import type { WorkspaceState } from './types';
import { ensureStorageSchema, STORAGE_KEYS, readJson, writeJson } from '@/shared/lib/storage';

function createInitialWorkspaceState(now = Date.now()): WorkspaceState {
  const defaultSessionId = `s-${now.toString(36)}`;
  const defaultContainerId = `c-${now.toString(36)}`;
  return {
    sessions: [{ id: defaultSessionId, title: '新建对话', updatedAt: now }],
    containers: [{ id: defaultContainerId, name: '默认容器', updatedAt: now }],
    activeSessionId: defaultSessionId,
    activeContainerId: defaultContainerId,
  };
}

function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkspaceState>;
  return Array.isArray(candidate.sessions) && Array.isArray(candidate.containers);
}

/** Reads the legacy workspace key and normalizes missing selection fields in place. */
export function loadWorkspaceState(now = Date.now): WorkspaceState {
  ensureStorageSchema();
  const fallback = createInitialWorkspaceState(now());
  const saved = readJson<unknown>(STORAGE_KEYS.workspace, fallback);
  if (!isWorkspaceState(saved)) return fallback;

  const sessions = saved.sessions.filter((session): session is WorkspaceState['sessions'][number] =>
    Boolean(session && typeof session.id === 'string' && typeof session.title === 'string'),
  );
  const containers = saved.containers.filter((container): container is WorkspaceState['containers'][number] =>
    Boolean(container && typeof container.id === 'string' && typeof container.name === 'string'),
  );

  const activeSessionId = sessions.some((session) => session.id === saved.activeSessionId)
    ? saved.activeSessionId
    : sessions[0]?.id ?? null;
  const activeContainerId = containers.some((container) => container.id === saved.activeContainerId)
    ? saved.activeContainerId
    : containers[0]?.id ?? null;

  return { sessions, containers, activeSessionId, activeContainerId };
}

export function saveWorkspaceState(state: WorkspaceState): void {
  writeJson(STORAGE_KEYS.workspace, state);
}

export { createInitialWorkspaceState };
