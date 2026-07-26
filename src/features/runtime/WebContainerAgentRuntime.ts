import type { WebContainer } from '@webcontainer/api';
import type {
  AgentWorkspaceRuntime,
  ProcessOwnership,
  ProcessStatus,
  RuntimeProcessEvent,
  ShellRunRequest,
  ShellRunResult,
  WorkspaceTreeEntry,
  RuntimeResourceDescriptor,
} from '@/shared/contracts/agentRuntime';
import { getContainerRoot } from '@/shared/lib/containerPaths';
import { toErrorMessage } from '@/shared/lib/errors';
import { clipTextToTokenBudget } from '@/shared/lib/tokenEstimate';
import { createId } from '@/shared/lib/ids';
import { v3Persistence, type V3PersistenceRepository } from '@/entities/persistence/v3Repository';
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
  private readonly repository: V3PersistenceRepository;
  private userTerminalBuffer = '';

  constructor(webcontainer: WebContainer, repository: V3PersistenceRepository = v3Persistence) {
    this.webcontainer = webcontainer;
    this.files = new WorkspaceFileSystem(webcontainer);
    this.repository = repository;
    this.snapshots = new WorkspaceSnapshotCoordinator(webcontainer, repository);
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

  async getWorkspaceRevision(containerId: string): Promise<number> {
    await this.ensureContainer(containerId);
    return this.snapshots.getRevision(containerId);
  }

  async flushSnapshots(): Promise<void> { await this.snapshots.flushAll(); }
  async flushWorkspace(containerId: string): Promise<void> { await this.snapshots.flush(containerId); }

  async listResources(sessionId: string): Promise<RuntimeResourceDescriptor[]> { return (await this.repository.listResources(sessionId)).value; }

  private async loadSessionResource(sessionId: string, resourceId: string) {
    const stored = await this.repository.loadResource(resourceId);
    if (!stored.value || stored.value.sessionId !== sessionId) throw new Error(`Resource ${resourceId} was not found in this session.`);
    return stored.value;
  }

  async readResourceText(sessionId: string, resourceId: string, startLine = 1, endLine = 240, maxTokens = 4_000): Promise<string> {
    const resource = await this.loadSessionResource(sessionId, resourceId);
    if (resource.kind !== 'text') throw new Error(`Resource ${resourceId} is not a text resource.`);
    const lines = (await resource.blob.text()).split('\n');
    const start = Math.max(1, startLine);
    const end = Math.max(start, Math.min(endLine, start + 499));
    const content = lines.slice(start - 1, end).map((line, index) => `${String(start + index).padStart(4, ' ')} | ${line}`).join('\n');
    const boundedTokens = Math.max(1, Math.min(maxTokens, 16_000));
    return clipTextToTokenBudget(content, boundedTokens, `\n[resource range truncated at ${boundedTokens} tokens]`);
  }

  async readResourceImage(sessionId: string, resourceId: string): Promise<RuntimeResourceDescriptor> {
    const stored = await this.loadSessionResource(sessionId, resourceId);
    if (stored.kind !== 'image') throw new Error(`Resource ${resourceId} is not an image resource.`);
    const { blob: _blob, modelBlob: _modelBlob, sessionId: _sessionId, originatingRunId: _originatingRunId, ...resource } = stored;
    return resource;
  }

  async materializeResource(sessionId: string, containerId: string, resourceId: string, path: string) {
    const stored = await this.loadSessionResource(sessionId, resourceId);
    const result = await this.files.materialize(containerId, path, new Uint8Array(await stored.blob.arrayBuffer()));
    this.snapshots.bumpRevision(containerId);
    this.snapshots.schedule(containerId);
    return result;
  }

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
    this.snapshots.bumpRevision(containerId);
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
      if (!snapshot) return;
      // A shell command is an opaque mutation boundary. Bump once at process
      // completion even when filesystem watch delivery is delayed, so a
      // verification record can never certify a pre-command revision.
      this.snapshots.bumpRevision(request.containerId);
      this.processes.markExited(id, exitCode);
      this.snapshots.schedule(request.containerId);
      void this.snapshots.flush(request.containerId).catch(() => undefined);
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

  async stopProcess(processId: string, ownership: ProcessOwnership): Promise<boolean> {
    const stopped = this.processes.stop(processId, ownership);
    if (!stopped) return false;
    // Explicit process shutdown is a runtime boundary just like natural exit,
    // but the registry entry is already gone. Advance and flush here so the
    // caller can bind its task state to the post-stop revision exactly once.
    this.snapshots.bumpRevision(ownership.containerId);
    this.snapshots.schedule(ownership.containerId);
    await this.snapshots.flush(ownership.containerId);
    return true;
  }

  stopRun(ownership: ProcessOwnership): void {
    this.processes.stopOwned(ownership);
  }

  getProcesses(ownership?: Partial<ProcessOwnership>): ProcessStatus[] {
    return this.processes.list(ownership);
  }
}
