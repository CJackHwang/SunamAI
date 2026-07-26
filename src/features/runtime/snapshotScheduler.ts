import type { FileSystemTree } from '@webcontainer/api';
import type { V3PersistenceRepository } from '@/entities/persistence/v3Repository';

/**
 * Coalesces bursts of filesystem changes. A container can have at most one
 * snapshot in flight and one queued follow-up snapshot.
 */
export class V3SnapshotScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly queued = new Set<string>();
  private readonly repository: V3PersistenceRepository;
  private readonly capture: (containerId: string) => Promise<FileSystemTree>;
  private readonly delayMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly getRevision: (containerId: string) => number;

  constructor(repository: V3PersistenceRepository, capture: (containerId: string) => Promise<FileSystemTree>, delayMs = 750, onError: (error: unknown) => void = () => undefined, getRevision: (containerId: string) => number = () => 0) {
    this.repository = repository;
    this.capture = capture;
    this.delayMs = delayMs;
    this.onError = onError;
    this.getRevision = getRevision;
  }

  schedule(containerId: string): void {
    const existing = this.timers.get(containerId);
    if (existing) clearTimeout(existing);
    this.timers.set(containerId, setTimeout(() => {
      this.timers.delete(containerId);
      void this.flush(containerId).catch(this.onError);
    }, this.delayMs));
  }

  async flush(containerId: string): Promise<void> {
    const scheduled = this.timers.get(containerId);
    if (scheduled) {
      clearTimeout(scheduled);
      this.timers.delete(containerId);
    }
    const active = this.running.get(containerId);
    if (active) {
      this.queued.add(containerId);
      try { await active; }
      catch { /* The owner of the active write reports its failure and starts the queued retry. */ }
      const followUp = this.running.get(containerId);
      if (followUp) await followUp;
      return;
    }
    const work = (async () => {
      const tree = await this.capture(containerId);
      await this.repository.saveSnapshot(containerId, tree, this.getRevision(containerId));
    })();
    this.running.set(containerId, work);
    let failure: unknown;
    try {
      await work;
    } catch (error) {
      failure = error;
    } finally {
      this.running.delete(containerId);
    }
    if (this.queued.delete(containerId)) {
      try { await this.flush(containerId); }
      catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  }

  async flushAll(): Promise<void> {
    const containers = new Set([...this.timers.keys(), ...this.running.keys(), ...this.queued]);
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    await Promise.all([...containers].map((containerId) => this.flush(containerId)));
  }

  dispose(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }
}
