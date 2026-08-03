import type { CapabilityAvailability } from '@/shared/contracts/capability';
import { toErrorMessage } from '@/shared/lib/errors';
import { getWorkspaceRuntime } from './runtimeSingleton';

export type ContainerBootOutcome = 'enabled' | 'restricted';

/**
 * Session-level container availability coordinator.
 *
 *  - `initialize()`: attempt boot once. Success → 'enabled'; failure → 'restricted' and
 *    fires the failure callback exactly once (the user is told once per page load).
 *  - `retry()`: user-triggered re-initialization (the container switch in the capability
 *    panel is the retry affordance). Success → 'enabled'; failure stays 'restricted' and
 *    does not re-notify.
 *  - No automatic retries: every boot is user-initiated, so a flaky browser never loops.
 */
export class ContainerAvailabilityController {
  private availability: CapabilityAvailability = 'enabled';
  private starting = false;
  private readonly listeners = new Set<() => void>();
  private failureNotified = false;
  private onFailure: ((message: string) => void) | null = null;
  private booting: Promise<ContainerBootOutcome> | null = null;

  get(): CapabilityAvailability {
    return this.availability;
  }

  /** True while a boot (initialize/retry) is in flight — lets the UI show a "starting" state. */
  isStarting(): boolean {
    return this.starting;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setOnFailure(callback: ((message: string) => void) | null): void {
    this.onFailure = callback;
  }

  initialize(): Promise<ContainerBootOutcome> {
    this.booting ??= this.boot();
    return this.booting;
  }

  async retry(): Promise<ContainerBootOutcome> {
    this.booting = null;
    return this.boot();
  }

  /**
   * Reset after a close-and-release so the next enable does a fresh boot (never reuses the
   * cached outcome of a previous cycle) and can notify the user once on a new failure.
   */
  resetForReboot(): void {
    this.booting = null;
    this.failureNotified = false;
    this.availability = 'enabled';
    this.setStarting(false);
  }

  private async boot(): Promise<ContainerBootOutcome> {
    this.setStarting(true);
    try {
      await getWorkspaceRuntime();
      this.set('enabled');
      return 'enabled';
    } catch (error) {
      this.set('restricted');
      this.notifyFailure(toErrorMessage(error));
      return 'restricted';
    } finally {
      this.setStarting(false);
    }
  }

  private setStarting(next: boolean): void {
    if (next === this.starting) return;
    this.starting = next;
    for (const listener of this.listeners) listener();
  }

  private set(next: CapabilityAvailability): void {
    if (next === this.availability) return;
    this.availability = next;
    for (const listener of this.listeners) listener();
  }

  private notifyFailure(message: string): void {
    if (this.failureNotified) return;
    this.failureNotified = true;
    this.onFailure?.(message);
  }
}
