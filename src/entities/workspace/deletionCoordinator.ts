export type WorkspaceDeletionTarget = { kind: 'session' | 'container'; id: string };
type DeletionPreparation = (target: WorkspaceDeletionTarget) => Promise<void>;

const preparations = new Set<DeletionPreparation>();

export function registerWorkspaceDeletionPreparation(preparation: DeletionPreparation): () => void {
  preparations.add(preparation);
  return () => preparations.delete(preparation);
}

export async function prepareWorkspaceDeletion(target: WorkspaceDeletionTarget): Promise<void> {
  await Promise.all([...preparations].map((preparation) => preparation(target)));
}
