import type { CapabilityAvailability } from '@/shared/contracts/capability';
import { toErrorMessage } from '@/shared/lib/errors';
import { getWorkspaceRuntime, waitForWorkspaceHostReady } from './runtimeSingleton';
import { clearContainerUnavailable, markContainerUnavailable } from './containerUnavailable';

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
 *
 *  R2：boot 失败（环境不支持 Succinix → 受限）时持久化标记（markContainerUnavailable），
 *  像主动关闭一样记录——下次进入由 provider 读取标记跳过自动开启。成功 boot / 手动重试
 *  清除标记重新检测（R3：判定标准不变，只改触发后的持久化行为）。
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
    // R2：手动重试清除受限标记，重新检测（失败会再次落标记）。
    clearContainerUnavailable();
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
      // R1：getWorkspaceRuntime 在 WC 容器就绪即 resolve；waitForWorkspaceHostReady 等待
      // 后台 Succinix host boot 完成——可用性结论仍以"WC + host 全就绪"为准（判定不变）。
      await getWorkspaceRuntime();
      await waitForWorkspaceHostReady();
      // 成功 boot：清除受限标记（环境已可用）。
      clearContainerUnavailable();
      this.set('enabled');
      return 'enabled';
    } catch (error) {
      // L2 竞态防御（终审）：forceRestart/dispose 清掉 hostBootPromise 后，在途的
      // waitForWorkspaceHostReady 会以 "has not started" reject——这是信号被回收，不是
      // 环境真实不可用。区分处理：该错误不落受限标记（避免误写持久化受限态）。
      const isHostSignalRecycled = error instanceof Error && error.message.includes('has not started');
      this.set('restricted');
      if (!isHostSignalRecycled) {
        // R2：受限 → 持久化标记（下次进入不自动开启）。
        markContainerUnavailable();
      }
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
