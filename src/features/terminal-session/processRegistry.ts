import type { WebContainer } from '@webcontainer/api';
import type { ProcessOwnership, ProcessStatus, RuntimeProcessEvent } from '@/shared/contracts/agentRuntime';

export type WebContainerProcess = Awaited<ReturnType<WebContainer['spawn']>>;

interface ManagedProcess extends ProcessStatus {
  process: WebContainerProcess;
}

export class ProcessRegistry {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly listeners = new Set<(event: RuntimeProcessEvent) => void>();

  subscribe(listener: (event: RuntimeProcessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  add(status: ProcessStatus, process: WebContainerProcess): void {
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

  async sendInput(processId: string, ownership: ProcessOwnership, input: string): Promise<boolean> {
    const process = this.processes.get(processId);
    if (!process || !this.hasOwnership(process, ownership) || !process.isRunning) return false;
    const writer = process.process.input.getWriter();
    try {
      await writer.write(input);
      return true;
    } finally {
      writer.releaseLock();
    }
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
    this.listeners.forEach((listener) => listener({ type, process: snapshot, chunk }));
  }
}
