import { createId } from '@/shared/lib/ids';
import type { Container, WorkspaceState } from '@/entities/workspace/types';
import type { V2PersistenceRepository } from '@/shared/persistence/v2Repository';

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
  setState: (updater: (previous: WorkspaceState) => WorkspaceState) => void,
  getState: () => WorkspaceState,
  now: () => number,
  repository: V2PersistenceRepository,
  reportPersistenceError: (error: unknown) => void
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
      const uniqueName = nextUniqueContainerName(previous.containers, name, id);
      return {
        ...previous,
        containers: previous.containers.map((container) => container.id === id ? { ...container, name: uniqueName, updatedAt: now() } : container),
      };
    }),
    deleteContainer: (id: string) => setState((previous) => {
      const containers = previous.containers.filter((container) => container.id !== id);
      void repository.deleteContainer(id).catch(reportPersistenceError);
      return { ...previous, containers, activeContainerId: previous.activeContainerId === id ? containers[0]?.id ?? null : previous.activeContainerId };
    }),
    togglePinContainer: (id: string) => setState((previous) => ({
      ...previous,
      containers: previous.containers.map((container) => container.id === id ? { ...container, pinned: !container.pinned, updatedAt: now() } : container),
    })),
    selectContainer: (id: string) => setState((previous) => ({ ...previous, activeContainerId: id })),
  };
}
