import type {
  AgentWorkspaceRuntime,
  ProcessOwnership,
  ProcessStatus,
  RuntimeProcessEvent,
  RuntimeResourceDescriptor,
  ShellRunRequest,
  ShellRunResult,
  WorkspaceChangeSummary,
  WorkspaceTreeEntry,
} from '@/shared/contracts/agentRuntime';
import { clipTextToTokenBudget } from '@/shared/lib/tokenEstimate';
import type { V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import type { WebContainerAgentRuntime } from './WebContainerAgentRuntime';

const MAX_PROCESS_OUTPUT = 20_000;

/**
 * Capability-aware runtime: implements the `AgentWorkspaceRuntime` boundary while gating the
 * container capability by availability.
 *
 *  - Container available (booted and enabled) → container methods delegate to the real
 *    `WebContainerAgentRuntime`.
 *  - Container unavailable/disabled/restricted → container methods are no-ops/empty; the agent
 *    never sees them because the capability registry prunes the matching tools. Resource
 *    methods always work via IndexedDB (they are container-independent by design).
 *
 * One runtime class serves both "user disabled the container" and "container boot failed" —
 * the constructor's `containerAvailable` is fixed per instance; the provider rebuilds the
 * instance when availability changes.
 */
export class CapabilityAwareRuntime implements AgentWorkspaceRuntime {
  private readonly containerRuntime: WebContainerAgentRuntime | null;
  private readonly containerAvailable: boolean;
  private readonly repository: V3PersistenceRepository;
  private userTerminalBuffer = '';

  constructor(containerRuntime: WebContainerAgentRuntime | null, containerAvailable: boolean, repository: V3PersistenceRepository) {
    this.containerRuntime = containerRuntime;
    this.containerAvailable = containerAvailable;
    this.repository = repository;
  }

  // ---- Container-gated methods ----

  async ensureContainer(_containerId: string): Promise<void> {
    if (this.containerAvailable && this.containerRuntime) await this.containerRuntime.ensureContainer(_containerId);
  }

  async getWorkspaceRevision(_containerId: string): Promise<number> {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.getWorkspaceRevision(_containerId);
    return 0;
  }

  async flushSnapshots(): Promise<void> {
    if (this.containerAvailable && this.containerRuntime) await this.containerRuntime.flushSnapshots();
  }

  async flushWorkspace(_containerId: string): Promise<void> {
    if (this.containerAvailable && this.containerRuntime) await this.containerRuntime.flushWorkspace(_containerId);
  }

  async materializeResource(_sessionId: string, _containerId: string, _resourceId: string, _path: string): Promise<WorkspaceChangeSummary> {
    if (this.containerAvailable && this.containerRuntime) {
      return this.containerRuntime.materializeResource(_sessionId, _containerId, _resourceId, _path);
    }
    throw new Error('Container capability is disabled; resource materialization is unavailable.');
  }

  async listWorkspace(_containerId: string, _maxDepth: number): Promise<WorkspaceTreeEntry[]> {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.listWorkspace(_containerId, _maxDepth);
    return [];
  }

  async readWorkspaceFile(_containerId: string, _path: string, _startLine?: number, _endLine?: number): Promise<string> {
    if (this.containerAvailable && this.containerRuntime) {
      return this.containerRuntime.readWorkspaceFile(_containerId, _path, _startLine, _endLine);
    }
    throw new Error('Container capability is disabled; workspace files are unavailable.');
  }

  async searchWorkspace(_containerId: string, _query: string, _maxResults: number): Promise<Array<{ path: string; line: number; content: string }>> {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.searchWorkspace(_containerId, _query, _maxResults);
    return [];
  }

  async applyWorkspaceChanges(_containerId: string, _changes: Array<{ path: string; content: string; expectedContent?: string }>): Promise<WorkspaceChangeSummary[]> {
    if (this.containerAvailable && this.containerRuntime) {
      return this.containerRuntime.applyWorkspaceChanges(_containerId, _changes);
    }
    throw new Error('Container capability is disabled; workspace changes are unavailable.');
  }

  async runShell(_request: ShellRunRequest): Promise<ShellRunResult> {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.runShell(_request);
    throw new Error('Container capability is disabled; shell commands are unavailable.');
  }

  observeProcess(_processId: string, _ownership: ProcessOwnership, _cursor = 0): ProcessStatus | null {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.observeProcess(_processId, _ownership, _cursor);
    return null;
  }

  async sendProcessInput(_processId: string, _ownership: ProcessOwnership, _input: string): Promise<boolean> {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.sendProcessInput(_processId, _ownership, _input);
    return false;
  }

  async stopProcess(_processId: string, _ownership: ProcessOwnership): Promise<boolean> {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.stopProcess(_processId, _ownership);
    return false;
  }

  stopRun(ownership: ProcessOwnership): void {
    if (this.containerAvailable && this.containerRuntime) this.containerRuntime.stopRun(ownership);
  }

  getProcesses(ownership?: Partial<ProcessOwnership>): ProcessStatus[] {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.getProcesses(ownership);
    return [];
  }

  subscribe(listener: (event: RuntimeProcessEvent) => void): () => void {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.subscribe(listener);
    return () => undefined;
  }

  // ---- Container-independent resource methods (IndexedDB) ----

  async listResources(sessionId: string): Promise<RuntimeResourceDescriptor[]> {
    return (await this.repository.listResources(sessionId)).value;
  }

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

  // ---- User terminal buffer (container-gated) ----

  getUserTerminalBuffer(): string {
    if (this.containerAvailable && this.containerRuntime) return this.containerRuntime.getUserTerminalBuffer();
    return this.userTerminalBuffer;
  }

  appendUserTerminalBuffer(data: string): void {
    if (this.containerAvailable && this.containerRuntime) {
      this.containerRuntime.appendUserTerminalBuffer(data);
      return;
    }
    this.userTerminalBuffer += data;
    if (this.userTerminalBuffer.length > MAX_PROCESS_OUTPUT) {
      this.userTerminalBuffer = this.userTerminalBuffer.slice(-MAX_PROCESS_OUTPUT);
    }
  }
}
