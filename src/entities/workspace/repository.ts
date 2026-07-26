import type { WorkspaceState } from './types';
import { createId } from '@/shared/lib/ids';
import { DEFAULT_WORKSPACE_CREATION_DEFAULTS, type WorkspaceCreationDefaults } from './defaults';

/** Creates the first durable workspace only when the active v3 database has no workspace record. */
export function createInitialWorkspaceState(now = Date.now(), defaults: WorkspaceCreationDefaults = DEFAULT_WORKSPACE_CREATION_DEFAULTS): WorkspaceState {
  const defaultSessionId = createId('s');
  const defaultContainerId = createId('c');
  return {
    sessions: [{ id: defaultSessionId, title: defaults.sessionTitle, updatedAt: now }],
    containers: [{ id: defaultContainerId, name: defaults.containerName, updatedAt: now }],
    activeSessionId: defaultSessionId,
    activeContainerId: defaultContainerId,
  };
}
