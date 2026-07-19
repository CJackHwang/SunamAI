import type { FileSystemTree } from '@webcontainer/api';
import type { V2PersistenceRepository } from './v2Repository';

/**
 * Coalesces bursts of filesystem changes. A container can have at most one
 * snapshot in flight and one queued follow-up snapshot.
 */
export class V2SnapshotScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly queued = new Set<string>();
  private readonly repository: V2PersistenceRepository;
  private readonly capture: (containerId: string) => Promise<FileSystemTree>;
  private readonly delayMs: number;

  constructor(repository: V2PersistenceRepository, capture: (containerId: string) => Promise<FileSystemTree>, delayMs = 750) {
    this.repository = repository;
    this.capture = capture;
    this.delayMs = delayMs;
  }

  schedule(containerId: string): void {
    const existing = this.timers.get(containerId);
    if (existing) clearTimeout(existing);
    this.timers.set(containerId, setTimeout(() => {
      this.timers.delete(containerId);
      void this.flush(containerId);
    }, this.delayMs));
  }

  async flush(containerId: string): Promise<void> {
    const active = this.running.get(containerId);
    if (active) {
      this.queued.add(containerId);
      await active;
      return;
    }
    const work = (async () => {
      const tree = await this.capture(containerId);
      await this.repository.saveSnapshot(containerId, tree);
    })();
    this.running.set(containerId, work);
    try {
      await work;
    } finally {
      this.running.delete(containerId);
    }
    if (this.queued.delete(containerId)) await this.flush(containerId);
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
