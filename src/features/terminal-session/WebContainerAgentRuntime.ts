import type { WebContainer } from '@webcontainer/api';
import type {
  AgentWorkspaceRuntime,
  ProcessOwnership,
  ProcessStatus,
  RuntimeProcessEvent,
  ShellRunRequest,
  ShellRunResult,
  WorkspaceTreeEntry,
} from '@/shared/contracts/agentRuntime';
import { getContainerRoot } from '@/shared/lib/containerPaths';
import { toErrorMessage } from '@/shared/lib/errors';
import { createId } from '@/shared/lib/ids';
import { v2Persistence, type V2PersistenceRepository } from '@/shared/persistence/v2Repository';
import { ProcessRegistry } from './processRegistry';
import { WorkspaceSnapshotCoordinator } from './snapshotCoordinator';
import { WorkspaceFileSystem } from './workspaceFileSystem';

const MAX_PROCESS_OUTPUT = 20_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Owns Agent-launched processes instead of leaking them through a terminal component.
 * A terminal may observe this class, but process ownership always remains with its Run.
 */
export class WebContainerAgentRuntime implements AgentWorkspaceRuntime {
  private readonly webcontainer: WebContainer;
  private readonly files: WorkspaceFileSystem;
  private readonly processes = new ProcessRegistry();
  private readonly snapshots: WorkspaceSnapshotCoordinator;
  private userTerminalBuffer = '';
  private userTerminalInputListener?: (data: string) => void;

  constructor(webcontainer: WebContainer, repository: V2PersistenceRepository = v2Persistence) {
    this.webcontainer = webcontainer;
    this.files = new WorkspaceFileSystem(webcontainer);
    this.snapshots = new WorkspaceSnapshotCoordinator(webcontainer, repository);
  }

  onUserTerminalInput(listener: (data: string) => void): void {
    this.userTerminalInputListener = listener;
  }

  async sendUserTerminalInput(data: string): Promise<boolean> {
    if (this.userTerminalInputListener) {
      this.userTerminalInputListener(data);
      return true;
    }
    return false;
  }

  getUserTerminalBuffer(): string {
    return this.userTerminalBuffer;
  }

  appendUserTerminalBuffer(data: string): void {
    this.userTerminalBuffer += data;
    if (this.userTerminalBuffer.length > MAX_PROCESS_OUTPUT) {
      this.userTerminalBuffer = this.userTerminalBuffer.slice(-MAX_PROCESS_OUTPUT);
    }
  }

  subscribe(listener: (event: RuntimeProcessEvent) => void): () => void {
    return this.processes.subscribe(listener);
  }

  subscribeErrors(listener: (error: string) => void): () => void { return this.snapshots.subscribeErrors(listener); }

  async ensureContainer(containerId: string): Promise<void> {
    await this.snapshots.ensure(containerId);
  }

  async flushSnapshots(): Promise<void> { await this.snapshots.flushAll(); }

  dispose(): void {
    this.snapshots.dispose();
    this.processes.dispose();
  }

  async listWorkspace(containerId: string, maxDepth: number): Promise<WorkspaceTreeEntry[]> {
    return this.files.list(containerId, maxDepth);
  }

  async readWorkspaceFile(containerId: string, path: string, startLine = 1, endLine = 240): Promise<string> {
    return this.files.read(containerId, path, startLine, endLine);
  }

  async searchWorkspace(containerId: string, query: string, maxResults: number): Promise<Array<{ path: string; line: number; content: string }>> {
    return this.files.search(containerId, query, maxResults);
  }

  async applyWorkspaceChanges(containerId: string, changes: Array<{ path: string; content: string; expectedContent?: string }>) {
    const results = await this.files.apply(containerId, changes);
    this.snapshots.schedule(containerId);
    return results;
  }

  async runShell(request: ShellRunRequest): Promise<ShellRunResult> {
    if (request.signal?.aborted) throw request.signal.reason;
    await this.ensureContainer(request.containerId);
    const id = createId('proc');
    const process = await this.webcontainer.spawn('jsh', ['-c', request.command], { env: {}, cwd: getContainerRoot(request.containerId) });
    const status: ProcessStatus = {
      id,
      sessionId: request.sessionId,
      runId: request.runId,
      containerId: request.containerId,
      command: request.command,
      isRunning: true,
      output: '',
      cursor: 0,
    };
    this.processes.add(status, process);
    if (request.signal?.aborted) {
      this.processes.stop(id, request);
      throw request.signal.reason;
    }
    let finalStatus: ProcessStatus | null = null;
    const outputDone = process.output.pipeTo(new WritableStream<string>({
      write: (chunk) => this.processes.appendOutput(id, chunk, MAX_PROCESS_OUTPUT),
    })).catch((error) => this.processes.reportError(id, toErrorMessage(error)));
    void Promise.all([process.exit, outputDone]).then(([exitCode]) => {
      const snapshot = this.processes.observe(id, request);
      finalStatus = { ...(snapshot ?? status), isRunning: false, exitCode };
      this.processes.markExited(id, exitCode);
    });

    if (request.mode === 'background') return { process: this.processes.observe(id, request)!, timedOut: false };

    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 30_000, 1_000), 300_000);
    const deadline = Date.now() + timeoutMs;
    let snapshot = this.processes.observe(id, request);
    while (snapshot?.isRunning && Date.now() < deadline) {
      await sleep(40);
      if (request.signal?.aborted) {
        this.processes.stop(id, request);
        throw request.signal.reason;
      }
      snapshot = this.processes.observe(id, request);
    }
    if (!snapshot) return { process: finalStatus ?? { ...status, isRunning: false }, timedOut: false };
    return { process: snapshot, timedOut: snapshot.isRunning };
  }

  observeProcess(processId: string, ownership: ProcessOwnership, cursor = 0): ProcessStatus | null {
    return this.processes.observe(processId, ownership, cursor);
  }

  async sendProcessInput(processId: string, ownership: ProcessOwnership, input: string): Promise<boolean> {
    return this.processes.sendInput(processId, ownership, input);
  }

  stopProcess(processId: string, ownership: ProcessOwnership): boolean {
    return this.processes.stop(processId, ownership);
  }

  stopRun(ownership: ProcessOwnership): void {
    this.processes.stopOwned(ownership);
  }

  getProcesses(ownership?: Partial<ProcessOwnership>): ProcessStatus[] {
    return this.processes.list(ownership);
  }
}
