import type { WebContainer } from '@webcontainer/api';
import type { V2PersistenceRepository } from '@/shared/persistence/v2Repository';
import { V2SnapshotScheduler } from '@/shared/persistence/snapshotScheduler';
import { getContainerRoot } from '@/shared/lib/containerPaths';
import { toErrorMessage } from '@/shared/lib/errors';

/** Owns container restoration, filesystem watches, and durable snapshot timing. */
export class WorkspaceSnapshotCoordinator {
  private readonly restored = new Map<string, Promise<void>>();
  private readonly watchers = new Map<string, { close(): void }>();
  private readonly scheduler: V2SnapshotScheduler;
  private readonly webcontainer: WebContainer;
  private readonly repository: V2PersistenceRepository;
  private readonly errorListeners = new Set<(error: string) => void>();

  constructor(webcontainer: WebContainer, repository: V2PersistenceRepository) {
    this.webcontainer = webcontainer;
    this.repository = repository;
    this.scheduler = new V2SnapshotScheduler(repository, async (containerId) => webcontainer.export(getContainerRoot(containerId)), 750, (error) => this.reportError(error));
  }

  subscribeErrors(listener: (error: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  ensure(containerId: string): Promise<void> {
    const existing = this.restored.get(containerId);
    if (existing) return existing;
    const restoration = this.restore(containerId);
    this.restored.set(containerId, restoration);
    void restoration.catch((error) => { this.restored.delete(containerId); this.reportError(error); });
    return restoration;
  }

  private async restore(containerId: string): Promise<void> {
    const root = getContainerRoot(containerId);
    await this.webcontainer.fs.mkdir(root, { recursive: true });
    const snapshot = await this.repository.loadSnapshot(containerId);
    if (snapshot.value) await this.webcontainer.mount(snapshot.value, { mountPoint: root });
    await this.webcontainer.fs.mkdir(root, { recursive: true });
    if (!this.watchers.has(containerId)) {
      this.watchers.set(containerId, this.webcontainer.fs.watch(root, () => this.scheduler.schedule(containerId)));
    }
  }

  schedule(containerId: string): void { this.scheduler.schedule(containerId); }
  flushAll(): Promise<void> { return this.scheduler.flushAll(); }

  dispose(): void {
    this.watchers.forEach((watcher) => watcher.close());
    this.watchers.clear();
    this.restored.clear();
    this.scheduler.dispose();
    this.errorListeners.clear();
  }

  private reportError(error: unknown): void {
    const message = toErrorMessage(error);
    this.errorListeners.forEach((listener) => listener(message));
  }
}
