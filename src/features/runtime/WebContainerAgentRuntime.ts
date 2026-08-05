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
import type { RuntimePortStatus } from '@/shared/contracts/terminal';
import { getContainerPublicPath, getContainerRoot, WEB_CONTAINER_HOME } from '@/shared/lib/containerPaths';
import { toErrorMessage } from '@/shared/lib/errors';
import { clipTextToTokenBudget } from '@/shared/lib/tokenEstimate';
import { createId } from '@/shared/lib/ids';
import { v3Persistence, type V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import { ProcessRegistry, type SuccinixProcessShim } from './processRegistry';
import { WorkspaceSnapshotCoordinator } from './snapshotCoordinator';
import { WorkspaceFileSystem } from './workspaceFileSystem';
import { RuntimeServiceRegistry, type ManagedSpawnRequest } from './serviceRegistry';
import { SuccinixClient } from './succinixClient';
import { bootSuccinixHost, type SuccinixHostHandle } from './succinixHost';

const MAX_PROCESS_OUTPUT = 20_000;
// 后台进程表对账间隔：host ps() 数据源映射注册表，检测进程自然退出。
const PS_MONITOR_MS = 1_000;
// 用户终端无交互 stdin（文件 RPC 物理边界），spawn 一个常驻 node 进程作为"只读"终端底座。
// 输出文案与 createSpawnShim 的初始 banner 保持一致，避免 ps() outputTail 首拍重复放流。
const USER_SHELL_COMMAND = `node -e "console.log('Succinix terminal ready');setInterval(()=>{},1e9)"`;

/** Succinix host 视角的容器根绝对路径（Lifo /workspace 挂载下，host 映射到 process.cwd()/<id>）。 */
function containerSuccinixCwd(containerId: string): string {
  return `/workspace/${getContainerRoot(containerId)}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Owns Agent-launched processes instead of leaking them through a terminal component.
 * A terminal may observe this class, but process ownership always remains with its Run.
 *
 * 执行底层已从 WebContainer jsh 切换到 Succinix TerminalExecutor 文件 RPC：
 * 前台命令走 `run`（统一路由），后台服务走 `spawn`；进程注册表经 host `ps()` 对账。
 * 容器 boot 后需调用 `bootSuccinixHost()` 拉起 host 守护进程（注入 host.js + spawn + ping）。
 */
export class WebContainerAgentRuntime implements AgentWorkspaceRuntime {
  private readonly webcontainer: WebContainer;
  private readonly files: WorkspaceFileSystem;
  private readonly processes = new ProcessRegistry();
  private readonly snapshots: WorkspaceSnapshotCoordinator;
  private readonly services: RuntimeServiceRegistry;
  private readonly repository: V3PersistenceRepository;
  private readonly succinix: SuccinixClient;
  private readonly errorListeners = new Set<(error: string) => void>();
  private userTerminalBuffer = '';
  private psTimer: ReturnType<typeof setTimeout> | null = null;
  private hostHandle: SuccinixHostHandle | null = null;

  constructor(webcontainer: WebContainer, repository: V3PersistenceRepository = v3Persistence) {
    this.webcontainer = webcontainer;
    this.files = new WorkspaceFileSystem(webcontainer);
    this.repository = repository;
    this.snapshots = new WorkspaceSnapshotCoordinator(webcontainer, repository);
    // 与 serviceRegistry 共享同一客户端：/cmd.json 是单槽信箱，并发链会覆盖在途请求。
    this.succinix = new SuccinixClient(webcontainer.fs);
    this.services = new RuntimeServiceRegistry(webcontainer, (error) => this.publishError(toErrorMessage(error)), this.succinix);
  }

  /** 拉起 Succinix host 守护进程（H1-1）：注入 host.js → spawn node host.js → ping 探活 → lifo-core。 */
  async bootSuccinixHost(): Promise<void> {
    this.hostHandle = await bootSuccinixHost(this.webcontainer, this.succinix);
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

  subscribeErrors(listener: (error: string) => void): () => void {
    const unsubscribeSnapshots = this.snapshots.subscribeErrors(listener);
    this.errorListeners.add(listener);
    return () => { unsubscribeSnapshots(); this.errorListeners.delete(listener); };
  }

  private publishError(message: string): void {
    this.errorListeners.forEach((listener) => listener(message));
  }

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
    if (this.psTimer) { clearTimeout(this.psTimer); this.psTimer = null; }
    this.services.dispose();
    this.snapshots.dispose();
    this.processes.dispose();
    this.errorListeners.clear();
    this.hostHandle?.hostProcess.kill();
    this.hostHandle = null;
  }

  getPorts(): RuntimePortStatus[] { return this.services.getPorts(); }
  subscribePorts(listener: () => void): () => void { return this.services.subscribe(listener); }
  stopPort(port: number): Promise<boolean> { return this.services.stopPort(port); }

  async spawnUserShell(containerId: string): Promise<{ launchId: string; process: Awaited<ReturnType<WebContainer['spawn']>> }> {
    await this.ensureContainer(containerId);
    return this.services.spawn({
      source: 'terminal',
      containerId,
      command: USER_SHELL_COMMAND,
      args: [],
      cwd: containerSuccinixCwd(containerId),
      env: { HOME: WEB_CONTAINER_HOME, SUNAM_WORKSPACE: getContainerPublicPath(containerId) },
    });
  }

  stopUserShell(launchId: string): boolean { return this.services.stopLaunch(launchId); }

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
    // 后台服务走 Succinix spawn（长驻进程，立即返回 pid）；前台命令走 run（-c 组合命令，统一路由）。
    const spawnRequest: ManagedSpawnRequest = {
      source: 'agent',
      containerId: request.containerId,
      command: request.command,
      args: request.mode === 'background' ? [] : ['-c', request.command],
      cwd: containerSuccinixCwd(request.containerId),
      env: { HOME: WEB_CONTAINER_HOME, SUNAM_WORKSPACE: getContainerPublicPath(request.containerId) },
      processId: id,
      sessionId: request.sessionId,
      runId: request.runId,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    };
    const { process } = await this.services.spawn(spawnRequest);
    const shim = process as SuccinixProcessShim;
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
    this.processes.add(status, shim);
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

    if (request.mode === 'background') {
      this.schedulePsMonitor();
      return { process: this.processes.observe(id, request)!, timedOut: false };
    }

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
    if (!snapshot) return { process: finalStatus ?? { ...status, isRunning: false }, timedOut: shim.succinixTimedOut };
    return { process: snapshot, timedOut: shim.succinixTimedOut || snapshot.isRunning };
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

  /** 后台进程表对账：注册表与 Succinix ps() 同步，检测自然退出；无后台进程时自停。 */
  private schedulePsMonitor(): void {
    if (this.psTimer) return;
    const tick = async (): Promise<void> => {
      try {
        const entries = await this.succinix.ps();
        this.processes.reconcile(entries);
      } catch {
        // 单次查询失败：下一拍重试
      }
      if (this.processes.hasTrackedPids()) this.psTimer = setTimeout(() => { void tick(); }, PS_MONITOR_MS);
      else this.psTimer = null;
    };
    this.psTimer = setTimeout(() => { void tick(); }, PS_MONITOR_MS);
  }
}
