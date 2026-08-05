import type { WebContainer } from '@webcontainer/api';
import type { ProcessOwnership, ProcessStatus, RuntimeProcessEvent } from '@/shared/contracts/agentRuntime';
import type { SuccinixProcessEntry } from './succinixClient';

export type WebContainerProcess = Awaited<ReturnType<WebContainer['spawn']>>;

/**
 * Succinix 适配后的进程对象：结构与 WebContainerProcess 兼容（UI/契约不变），
 * 额外暴露 host 侧 pid 供 ps() 数据源对账（run 语义前台完成进程为 null）。
 */
export interface SuccinixProcessShim extends WebContainerProcess {
  succinixPid: number | null;
  /** run 语义：host 是否因超时终止了命令（驱动 runShell 的 timedOut 语义）。 */
  succinixTimedOut: boolean;
}

interface ManagedProcess extends ProcessStatus {
  process: SuccinixProcessShim;
}

export class ProcessRegistry {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly listeners = new Set<(event: RuntimeProcessEvent) => void>();

  subscribe(listener: (event: RuntimeProcessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  add(status: ProcessStatus, process: SuccinixProcessShim): void {
    const managed = { ...status, process };
    this.processes.set(status.id, managed);
    this.publish('started', managed);
  }

  appendOutput(processId: string, chunk: string, maxLength: number): void {
    const process = this.processes.get(processId);
    if (!process) return;
    process.output = `${process.output}${chunk}`.slice(-maxLength);
    process.cursor += chunk.length;
    this.publish('output', process, chunk);
  }

  reportError(processId: string, error: string): void {
    const process = this.processes.get(processId);
    if (process) this.publish('error', process, error);
  }

  markExited(processId: string, exitCode: number): void {
    const process = this.processes.get(processId);
    if (!process) return;
    process.isRunning = false;
    process.exitCode = exitCode;
    this.publish('exited', process);
    this.processes.delete(processId);
  }

  observe(processId: string, ownership: ProcessOwnership, cursor = 0): ProcessStatus | null {
    const process = this.processes.get(processId);
    if (!process || !this.hasOwnership(process, ownership)) return null;
    const snapshot = this.snapshot(process);
    const offset = Math.max(0, Math.min(cursor, snapshot.cursor));
    snapshot.output = offset === 0
      ? snapshot.output.slice(-10_000)
      : snapshot.output.slice(Math.max(0, offset - Math.max(0, snapshot.cursor - snapshot.output.length)));
    return snapshot;
  }

  async sendInput(processId: string, ownership: ProcessOwnership, _input: string): Promise<boolean> {
    const process = this.processes.get(processId);
    if (!process || !this.hasOwnership(process, ownership) || !process.isRunning) return false;
    // Succinix 文件 RPC 不支持交互 stdin（物理边界）；进程工具层已有对应容错。
    return false;
  }

  stop(processId: string, ownership: ProcessOwnership): boolean {
    const process = this.processes.get(processId);
    if (!process || !this.hasOwnership(process, ownership) || !process.isRunning) return false;
    process.process.kill();
    process.isRunning = false;
    this.publish('stopped', process);
    this.processes.delete(processId);
    return true;
  }

  stopOwned(ownership: ProcessOwnership): void {
    for (const process of [...this.processes.values()]) {
      if (this.hasOwnership(process, ownership)) this.stop(process.id, ownership);
    }
  }

  list(ownership?: Partial<ProcessOwnership>): ProcessStatus[] {
    return Array.from(this.processes.values())
      .filter((process) => process.isRunning && (!ownership
        || (ownership.sessionId === undefined || process.sessionId === ownership.sessionId)
        && (ownership.runId === undefined || process.runId === ownership.runId)
        && (ownership.containerId === undefined || process.containerId === ownership.containerId)))
      .map((process) => this.snapshot(process));
  }

  /** 是否仍有需要 ps() 对账的后台进程（带 host pid 且运行中）。 */
  hasTrackedPids(): boolean {
    return [...this.processes.values()].some((process) => process.isRunning && process.process.succinixPid !== null);
  }

  /**
   * ps() 数据源对账：把注册表中带 host pid 的进程与 Succinix 进程表对照，
   * host 表里已消失的进程按退出处理（用表中记录的 exitCode，缺省 -1）。
   * 输出尾部同步不在 M1 范围（进程 UI 对账是 M5）。
   */
  reconcile(entries: SuccinixProcessEntry[]): void {
    const runningPids = new Set(entries.filter((entry) => entry.status === 'running').map((entry) => entry.pid));
    for (const process of [...this.processes.values()]) {
      if (!process.isRunning || process.process.succinixPid === null) continue;
      const pid = process.process.succinixPid;
      if (runningPids.has(pid)) continue;
      const entry = entries.find((candidate) => candidate.pid === pid);
      this.markExited(process.id, entry?.exitCode ?? -1);
    }
  }

  dispose(): void {
    for (const process of this.processes.values()) process.process.kill();
    this.processes.clear();
    this.listeners.clear();
  }

  private hasOwnership(process: ProcessStatus, ownership: ProcessOwnership): boolean {
    return process.sessionId === ownership.sessionId
      && process.runId === ownership.runId
      && process.containerId === ownership.containerId;
  }

  private snapshot(process: ManagedProcess): ProcessStatus {
    const { process: _process, ...snapshot } = process;
    return { ...snapshot };
  }

  private publish(type: RuntimeProcessEvent['type'], process: ManagedProcess, chunk?: string): void {
    const snapshot = this.snapshot(process);
    this.listeners.forEach((listener) => listener({ type, process: snapshot, ...(chunk !== undefined ? { chunk } : {}) }));
  }
}
