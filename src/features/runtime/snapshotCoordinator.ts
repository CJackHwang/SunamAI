import type { WebContainer } from '@webcontainer/api';
import type { V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import { V3SnapshotScheduler } from './snapshotScheduler';
import { getContainerRoot } from '@/shared/lib/containerPaths';
import { toErrorMessage } from '@/shared/lib/errors';

const SNAPSHOT_EXPORT_EXCLUDES = [
  'node_modules/**', '**/node_modules/**', '.git/**', '**/.git/**', 'dist/**', '**/dist/**', 'coverage/**', '**/coverage/**',
  'playwright-report/**', '**/playwright-report/**', 'test-results/**', '**/test-results/**', '.cache/**', '**/.cache/**',
  '.vite/**', '**/.vite/**', '.turbo/**', '**/.turbo/**', '.next/**', '**/.next/**', '.nuxt/**', '**/.nuxt/**', '.parcel-cache/**', '**/.parcel-cache/**',
];

/** Owns container restoration, filesystem watches, and durable snapshot timing. */
export class WorkspaceSnapshotCoordinator {
  private readonly restored = new Map<string, Promise<void>>();
  private readonly watchers = new Map<string, { close(): void }>();
  private readonly scheduler: V3SnapshotScheduler;
  private readonly webcontainer: WebContainer;
  private readonly repository: V3PersistenceRepository;
  private readonly errorListeners = new Set<(error: string) => void>();
  private readonly revisions = new Map<string, number>();

  constructor(webcontainer: WebContainer, repository: V3PersistenceRepository) {
    this.webcontainer = webcontainer;
    this.repository = repository;
    this.scheduler = new V3SnapshotScheduler(repository, async (containerId) => webcontainer.export(getContainerRoot(containerId), { format: 'json', excludes: SNAPSHOT_EXPORT_EXCLUDES }), 750, (error) => this.reportError(error), (containerId) => this.getRevision(containerId));
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
    const snapshot = await this.repository.loadSnapshotState(containerId);
    this.revisions.set(containerId, snapshot.value?.revision ?? 0);
    // M3 R1 双层协调（SunamAI checkpoint × Succinix 文件快照）：
    // 恢复顺序是 Succinix 文件快照先（runtimeSingleton boot 时 restore → 再拉起 host），
    // 本方法随后把 v3 工作区树 mount 到容器根。webcontainer.mount(tree, { mountPoint }) 实测为
    // 「作用域限定在该目录 + merge 语义」：只写 mountPoint 子树，不触碰 /etc、/usr/lib、
    // .pyodide 等系统层（Succinix host 权威），也不删除 mountPoint 内未收录的既有文件 ——
    // 因此工作区最终以 v3 快照为准、系统层保持 Succinix 快照版本，互不覆盖。
    if (snapshot.value) await this.webcontainer.mount(snapshot.value.tree, { mountPoint: root });
    await this.webcontainer.fs.mkdir(root, { recursive: true });
    if (!this.watchers.has(containerId)) {
      this.watchers.set(containerId, this.webcontainer.fs.watch(root, () => {
        this.bumpRevision(containerId);
        this.scheduler.schedule(containerId);
      }));
    }
  }

  getRevision(containerId: string): number { return this.revisions.get(containerId) ?? 0; }
  bumpRevision(containerId: string): number {
    const next = this.getRevision(containerId) + 1;
    this.revisions.set(containerId, next);
    return next;
  }
  schedule(containerId: string): void { this.scheduler.schedule(containerId); }
  async flush(containerId: string): Promise<void> {
    try { await this.scheduler.flush(containerId); }
    catch (error) { this.reportError(error); throw error; }
  }
  async flushAll(): Promise<void> {
    try { await this.scheduler.flushAll(); }
    catch (error) { this.reportError(error); throw error; }
  }

  dispose(): void {
    this.watchers.forEach((watcher) => watcher.close());
    this.watchers.clear();
    this.restored.clear();
    this.revisions.clear();
    this.scheduler.dispose();
    this.errorListeners.clear();
  }

  private reportError(error: unknown): void {
    const message = toErrorMessage(error);
    this.errorListeners.forEach((listener) => listener(message));
  }
}
