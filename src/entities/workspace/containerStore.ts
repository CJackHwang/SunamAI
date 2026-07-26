import { createId } from '@/shared/lib/ids';
import type { Container, WorkspacePersistenceRepository, WorkspaceState } from '@/entities/workspace/types';
import { prepareWorkspaceDeletion } from './deletionCoordinator';

function normalizeContainerName(name: string) {
  return name.trim().normalize('NFKC').toLocaleLowerCase();
}

function nextUniqueContainerName(containers: Container[], requestedName = '新容器', excludedId?: string) {
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

export function createContainerActions(
  setState: (updater: (previous: WorkspaceState) => WorkspaceState, options?: { persist?: boolean }) => WorkspaceState,
  getState: () => WorkspaceState,
  now: () => number,
  repository: WorkspacePersistenceRepository,
  enqueuePersistence: (operation: () => Promise<void>) => Promise<void>
) {
  return {
    createContainer: () => {
      const state = getState();
      const timestamp = now();
      const container: Container = { id: createId('c'), name: nextUniqueContainerName(state.containers), updatedAt: timestamp };
      setState((previous) => ({ ...previous, containers: [container, ...previous.containers], activeContainerId: container.id }));
      return container.id;
    },
    renameContainer: (id: string, name: string) => setState((previous) => {
      const target = previous.containers.find((container) => container.id === id);
      if (!target) return previous;
      const uniqueName = nextUniqueContainerName(previous.containers, name, id);
      if (target.name === uniqueName) return previous;
      return {
        ...previous,
        containers: previous.containers.map((container) => container.id === id ? { ...container, name: uniqueName, updatedAt: now() } : container),
      };
    }),
    deleteContainer: (id: string): Promise<void> => {
      if (!getState().containers.some((container) => container.id === id)) return Promise.resolve();
      return enqueuePersistence(async () => {
        await prepareWorkspaceDeletion({ kind: 'container', id });
        const current = getState();
        const containers = current.containers.filter((container) => container.id !== id);
        const next = { ...current, containers, activeContainerId: current.activeContainerId === id ? containers[0]?.id ?? null : current.activeContainerId };
        await repository.deleteContainer(id, next);
        setState((previous) => {
          const remaining = previous.containers.filter((container) => container.id !== id);
          return { ...previous, containers: remaining, activeContainerId: previous.activeContainerId === id ? remaining[0]?.id ?? null : previous.activeContainerId };
        }, { persist: false });
      });
    },
    togglePinContainer: (id: string) => setState((previous) => ({
      ...previous,
      containers: previous.containers.map((container) => container.id === id ? { ...container, pinned: !container.pinned, updatedAt: now() } : container),
    })),
    selectContainer: (id: string) => setState((previous) => previous.activeContainerId === id || !previous.containers.some((container) => container.id === id) ? previous : { ...previous, activeContainerId: id }),
  };
}
