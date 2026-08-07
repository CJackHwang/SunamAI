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
import { SuccinixClient, type SuccinixProcessEntry } from './succinixClient';
import { SuccinixFileSnapshotCoordinator } from './succinixFileSnapshot';
import { bootSuccinixHost, type SuccinixHostHandle } from './succinixHost';
import { isSystemProcess, systemKillRefusal, type SuccinixProcessView } from './succinixProcesses';

const MAX_PROCESS_OUTPUT = 20_000;
// 后台进程表对账间隔：host ps() 数据源映射注册表，检测进程自然退出。
const PS_MONITOR_MS = 1_000;
// V1 H1-2：ps() 快照最佳努力截止 —— Succinix 是单槽 FIFO 链，长前台 run 执行期间占住链，
// ps() 请求排队到 run 完成才发得出（最坏 ~300s）。进程表刷新不应被此阻塞：超过该截止即
// 返回空快照，改用 ProcessRegistry（tracked + run shims）渲染，保证前台 run 进程运行中可见。
const PS_SNAPSHOT_TIMEOUT_MS = 1_000;
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
  private readonly succinixFiles: SuccinixFileSnapshotCoordinator;
  private readonly errorListeners = new Set<(error: string) => void>();
  private userTerminalBuffer = '';
  private psTimer: ReturnType<typeof setTimeout> | null = null;
  private hostHandle: SuccinixHostHandle | null = null;
  // dispose 后不再自动重启 host（看门狗退出守卫，N4）。
  private disposed = false;
  // 防止 host 连续崩溃时并发重启（重启中不重复触发）。
  private hostRestartInFlight = false;

  constructor(webcontainer: WebContainer, repository: V3PersistenceRepository = v3Persistence) {
    this.webcontainer = webcontainer;
    this.files = new WorkspaceFileSystem(webcontainer);
    this.repository = repository;
    this.snapshots = new WorkspaceSnapshotCoordinator(webcontainer, repository);
    // 与 serviceRegistry 共享同一客户端：/cmd.json 是单槽信箱，并发链会覆盖在途请求。
    this.succinix = new SuccinixClient(webcontainer.fs);
    // M3：Succinix 文件快照层（系统层：/etc 状态、.pyodide pip 包、日志等）。与 v3 工作区快照职责分离。
    this.succinixFiles = new SuccinixFileSnapshotCoordinator(webcontainer.fs, 2_500, (error) => this.publishError(error));
    this.services = new RuntimeServiceRegistry(webcontainer, (error) => this.publishError(toErrorMessage(error)), this.succinix);
  }

  /** M3 R1：恢复 Succinix 文件快照（系统层）到容器 FS。须在 bootSuccinixHost 之前调用，
   *  host 启动时会读取已恢复的 /etc/succinix.env / etc/succinix.cwd / .pyodide 等配置。 */
  async restoreSuccinixFileSnapshot(): Promise<void> {
    await this.succinixFiles.restore();
  }

  /** M3 R2：启动 Succinix 文件快照自动保存（~2.5s + pagehide 兜底）。在 host 就绪后调用。 */
  startSuccinixFileSnapshot(): void {
    this.succinixFiles.start();
  }

  /** M3 R3：立即强制保存系统层快照（关闭/重启前兜底）。 */
  async flushSuccinixFileSnapshot(): Promise<void> {
    await this.succinixFiles.flush();
  }

  /** 拉起 Succinix host 守护进程（H1-1）：注入 host.js → spawn node host.js → ping 探活 → lifo-core。 */
  async bootSuccinixHost(): Promise<void> {
    this.hostHandle = await bootSuccinixHost(this.webcontainer, this.succinix);
    this.watchHost(this.hostHandle.hostProcess);
  }

  /**
   * N4：host 崩溃看门狗——常驻 host 进程意外退出时自动重启，避免运行中 host 死 →
   * 全部 RPC 超时只能整体重启 runtime。若 crash 时恰有在途请求，重启的 ping 会排队在
   * 该请求之后（受其 deadline 约束），属已知边界；空闲崩溃则立即重启。
   */
  private watchHost(hostProcess: Awaited<ReturnType<WebContainer['spawn']>>): void {
    void hostProcess.exit.then(async () => {
      if (this.disposed || this.hostRestartInFlight || this.hostHandle?.hostProcess !== hostProcess) return;
      this.hostRestartInFlight = true;
      this.publishError('Succinix host exited unexpectedly; restarting the terminal executor.');
      await this.restartHost().finally(() => { this.hostRestartInFlight = false; });
    }, () => undefined);
  }

  private async restartHost(): Promise<void> {
    try {
      this.hostHandle = await bootSuccinixHost(this.webcontainer, this.succinix);
      this.watchHost(this.hostHandle.hostProcess);
    } catch (error) {
      this.publishError(`Succinix host restart failed: ${toErrorMessage(error)}`);
    }
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
    this.disposed = true;
    if (this.psTimer) { clearTimeout(this.psTimer); this.psTimer = null; }
    this.services.dispose();
    this.snapshots.dispose();
    this.succinixFiles.dispose();
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

  /**
   * M5 R1：展示层进程数据源绑定 Succinix 进程表（host 真实 pid/cmd/status/startTime）。
   * 合并两源：host ps() 全部真实进程 + ProcessRegistry 所有权标注（session/run 关联）。
   * 系统进程（host.js / python daemon / /usr/lib/succinix）标记 protected。
   * 轮询刷新由调用方（ComputerView）按 2-3s 间隔 + 运行时事件驱动调用本方法。
   * M6 R3 边界：ps() 是宿主 OS 全局进程表（含其他容器进程），本方法只做所有权标注、不做
   * 容器过滤——进程表全局可见是 Succinix 语义，虚拟容器隔离是文件系统级而非进程级。
   */
  async getSuccinixProcesses(containerId?: string): Promise<SuccinixProcessView[]> {
    // V1 H1-2：ps() 最佳努力 —— 长前台 run 占住 FIFO 链时 ps() 排队到 run 完成（最坏 ~300s），
    // 进程表刷新不能因此阻塞；超时即用注册表快照（tracked + run shims）渲染。
    const entries = await Promise.race([
      this.succinix.ps(),
      sleep(PS_SNAPSHOT_TIMEOUT_MS).then(() => [] as SuccinixProcessEntry[]),
    ]);
    const tracked = this.processes.listTracked();
    const trackedByPid = new Map<number, ProcessStatus & { pid: number }>();
    for (const process of tracked) {
      if (containerId && process.containerId !== containerId) continue;
      trackedByPid.set(process.pid, process);
    }
    const views: SuccinixProcessView[] = [];
    const seen = new Set<number>();
    for (const entry of entries) {
      if (entry.status !== 'running') continue;
      seen.add(entry.pid);
      const owned = trackedByPid.get(entry.pid);
      views.push(owned ? this.toOwnedProcessView(owned, entry) : this.toUnownedProcessView(entry));
    }
    // ps() 快照缺失（查询失败/退出未反映）时仍保留注册表运行中的 agent 进程，避免 UI 空白。
    for (const process of trackedByPid.values()) {
      if (seen.has(process.pid)) continue;
      views.push(this.toOwnedProcessView(process, {
        pid: process.pid,
        cmd: process.command,
        status: 'running',
        startTime: 0,
      }));
    }
    // V1 H1-2：前台 run 语义进程（无 host pid，Lifo 混合链）也纳入进程表 —— 运行中可见，
    // 无真实 pid 不可 kill（killable:false，UI 禁 stop + 如实标注）。run 执行期间 Succinix
    // FIFO 链被 run 占住、ps() 不可用，run shim（浏览器侧注册表）是运行中前台进程的唯一可见来源。
    for (const process of this.processes.listRunShims(containerId)) {
      views.push(this.toRunProcessView(process));
    }
    return views.sort((left, right) => (left.pid ?? 0) - (right.pid ?? 0));
  }

  /**
   * M5 R2：按 host pid 停止进程（未拥有/系统进程路径），后端 kill 守卫——
   * pid 命中系统进程时拒绝并返回说明（UI 禁 stop + 此处后端拦截双保险）。
   */
  async stopProcessByPid(pid: number): Promise<{ ok: boolean; message: string }> {
    const entries = await this.succinix.ps();
    const refusal = systemKillRefusal(entries, pid);
    if (refusal) return { ok: false, message: refusal };
    const result = await this.succinix.kill(pid);
    return { ok: result.killed, message: result.message };
  }

  /** agent 拥有进程：保留注册表 id/command 与 session/run 所有权，protected 仍按 host cmd 判定。 */
  private toOwnedProcessView(process: ProcessStatus & { pid: number }, entry: SuccinixProcessEntry): SuccinixProcessView {
    const exitCode = entry.exitCode ?? process.exitCode;
    return {
      id: process.id,
      processId: process.id,
      pid: entry.pid,
      command: process.command,
      sessionId: process.sessionId,
      runId: process.runId,
      containerId: process.containerId,
      isRunning: entry.status === 'running' && process.isRunning,
      output: process.output,
      cursor: process.cursor,
      ...(exitCode !== undefined ? { exitCode } : {}),
      protected: isSystemProcess(entry.cmd),
      hostStatus: entry.status,
      startTime: entry.startTime,
    };
  }

  /** 未拥有进程（系统进程 / 用户终端底座等）：id 用 succinix-<pid>，protected 按 host cmd 判定。 */
  private toUnownedProcessView(entry: SuccinixProcessEntry): SuccinixProcessView {
    return {
      id: `succinix-${entry.pid}`,
      pid: entry.pid,
      command: entry.cmd,
      sessionId: '',
      runId: '',
      containerId: '',
      isRunning: entry.status === 'running',
      output: entry.outputTail ?? '',
      cursor: 0,
      ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
      protected: isSystemProcess(entry.cmd),
      hostStatus: entry.status,
      startTime: entry.startTime,
    };
  }

  /**
   * V1 H1-2：前台 run 语义进程视图（无 host pid）。run 走 Succinix 统一路由（Lifo 混合链 /
   * node 直启），执行期间 FIFO 链被占、ps() 不可用；这里把注册表中的运行中 run shim 补进
   * 进程表：命令/所有权（session/run）可见，killable:false 如实标注（无 host pid，运行中
   * 不可中途终止，host 侧超时兜底；进程自然退出即从注册表移除 → 视图消失）。
   */
  private toRunProcessView(process: ProcessStatus): SuccinixProcessView {
    return {
      id: process.id,
      processId: process.id,
      command: process.command,
      sessionId: process.sessionId,
      runId: process.runId,
      containerId: process.containerId,
      isRunning: true,
      output: process.output,
      cursor: process.cursor,
      ...(process.exitCode !== undefined ? { exitCode: process.exitCode } : {}),
      protected: false,
      killable: false,
      hostStatus: 'running',
      startTime: 0,
    };
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
