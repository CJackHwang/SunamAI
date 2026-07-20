import type { WorkspaceState } from './types';
import { createId } from '@/shared/lib/ids';

/** Creates the first durable workspace only when the v2 database has no workspace record. */
export function createInitialWorkspaceState(now = Date.now()): WorkspaceState {
  const defaultSessionId = createId('s');
  const defaultContainerId = createId('c');
  return {
    sessions: [{ id: defaultSessionId, title: '新建对话', updatedAt: now }],
    containers: [{ id: defaultContainerId, name: '默认容器', updatedAt: now }],
    activeSessionId: defaultSessionId,
    activeContainerId: defaultContainerId,
  };
}
