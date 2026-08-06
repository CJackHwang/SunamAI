import type { WebContainer } from '@webcontainer/api';
import type { RuntimePortStatus, RuntimeServiceSource } from '@/shared/contracts/terminal';
import { createId } from '@/shared/lib/ids';
import { SuccinixClient } from './succinixClient';
import { ensurePythonRuntime, mentionsPython } from './succinixHost';
import { isSystemProcess } from './succinixProcesses';
import { type SuccinixProcessShim } from './processRegistry';

type WebContainerProcess = Awaited<ReturnType<WebContainer['spawn']>>;

const RUNTIME_DIRECTORY = '.sunam/runtime';
const SERVICE_EVENT_PATH = `${RUNTIME_DIRECTORY}/service-events.jsonl`;
// 孤儿分类等待窗：Succinix host 对 spawn 有 2s 启动确认窗口（PROTOCOL §5）——服务进程先绑定端口
// （server-ready 即到），浏览器侧要到确认结果（~2s）才注册 launch。窗口必须覆盖该延迟，否则
// launch 注册前端口已被误判 orphaned（R1 进程→端口推断的注册竞态）。
const ORPHAN_RECONCILIATION_MS = 3_000;
// 孤儿回溯宽限窗：孤儿分类计时器（ORPHAN_RECONCILIATION_MS 3s）可能先于 spawn RPC 确认触发——
// host 确认最坏可到 spawn RPC 浏览器侧等待上限（succinixClient PROTOCOL_COMMAND_TIMEOUT_MS 5s +
// 缓冲 5s）。launch 注册时允许把窗内刚落 orphaned 的声明端口回溯为 managed；超出窗口视为如实
// orphaned（无声明 / 多服务竞态不硬造 managed）。
const ORPHAN_RETROSPECT_MS = 10_000;
const STOP_WAIT_MS = 3_000;
const MAX_EVENT_FILE_BYTES = 256 * 1024;
// 后台/终端 spawn 进程输出尾部同步轮询间隔（host ps() 的 outputTail 字段，M2/M3）。
const SPAWN_OUTPUT_POLL_MS = 1_000;

interface ListenerRecord {
  action: 'listening' | 'closed';
  launchId: string;
  containerId: string;
  pid: number;
  port: number;
  timestamp: number;
}

function isListenerRecord(value: unknown): value is ListenerRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (record.action === 'listening' || record.action === 'closed')
    && typeof record.launchId === 'string' && record.launchId.length > 0
    && typeof record.containerId === 'string' && record.containerId.length > 0
    && typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0
    && typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port <= 65_535
    && typeof record.timestamp === 'number' && Number.isInteger(record.timestamp) && record.timestamp >= 0;
}

interface ManagedLaunch {
  id: string;
  source: RuntimeServiceSource;
  containerId: string;
  command: string;
  /** R1：从命令串解析出的声明端口（--port N / .listen(N) / PORT=N），进程→端口推断的关联依据。 */
  expectedPorts: number[];
  process: SuccinixProcessShim;
  processId?: string;
  sessionId?: string;
  runId?: string;
  startedAt: number;
  status: 'running' | 'stopping' | 'exited';
}

export interface ManagedSpawnRequest {
  source: RuntimeServiceSource;
  containerId: string;
  command: string;
  args?: string[];
  cwd?: string;
  processId?: string;
  sessionId?: string;
  runId?: string;
  env?: Record<string, string>;
  /** 透传给 Succinix host 的命令超时（run 语义下 host 侧超时杀进程）。 */
  timeoutMs?: number;
}

export interface ManagedSpawnResult {
  launchId: string;
  process: WebContainerProcess;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * run 语义进程适配：异步执行 Succinix `run`（统一路由），完成后一次性放出合并输出并结算 exit。
 * Succinix run 无 host pid，无法中途终止（host 侧超时已兜底）；进程对象结构与 WebContainerProcess 兼容。
 * 命令已由调用方按容器根 cd 前缀（M-1），env 由 client 在命令前写入 /etc/succinix.env。
 */
function createRunShim(client: SuccinixClient, command: string, timeoutMs?: number, env?: Record<string, string>): SuccinixProcessShim {
  let resolveExit!: (code: number) => void;
  let controller!: ReadableStreamDefaultController<string>;
  const exit = new Promise<number>((resolve) => { resolveExit = resolve; });
  const shim: SuccinixProcessShim = {
    exit,
    input: new WritableStream<string>({ write() { /* run 语义无交互 stdin，输入丢弃 */ } }),
    output: new ReadableStream<string>({ start(next) { controller = next; } }),
    kill() { /* run 语义无 host pid，无法中途终止；host 侧超时已兜底 */ },
    resize() {},
    succinixPid: null,
    succinixTimedOut: false,
  };
  void client.run(command, { ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(env && Object.keys(env).length > 0 ? { env } : {}) }).then((result) => {
    const merged = `${result.stdout}${result.stderr}`;
    try {
      if (merged) controller.enqueue(merged);
    } catch {
      // 输出流已取消
    }
    try { controller.close(); } catch { /* 输出流已取消 */ }
    shim.succinixTimedOut = result.timedOut;
    resolveExit(result.exitCode);
  }, (error) => {
    // 传输层失败（RPC 超时/host 崩溃）以输出流错误暴露，runShell 的 pipeTo 会发布 error 事件。
    try { controller.error(error instanceof Error ? error : new Error(String(error))); } catch { /* 输出流已取消 */ }
    shim.succinixTimedOut = true;
    resolveExit(-1);
  });
  return shim;
}

/** outputTail（host 保留最近 ~500 字符）相对已放流内容的增量：最长后缀-前缀去重，滚动尾部不丢新内容。
 *  导出供单测覆盖（N6）。 */
export function tailDelta(emitted: string, candidate: string): string {
  if (emitted.endsWith(candidate)) return '';
  let overlap = Math.min(emitted.length, candidate.length);
  while (overlap > 0 && !candidate.startsWith(emitted.slice(-overlap))) overlap -= 1;
  return candidate.slice(overlap);
}

/**
 * spawn 语义进程适配：后台 node 系长驻进程，立即返回 host pid。
 * 交互 stdin 不受支持（文件 RPC 物理边界）；输出经 host ps() 的 outputTail 字段轮询同步
 * （M2/M3）：输出流保持打开按尾部增量放流，进程从 host 进程表消失即结算 exit。
 */
function createSpawnShim(client: SuccinixClient, pid: number, initialOutput = ''): SuccinixProcessShim {
  let killed = false;
  let outputController: ReadableStreamDefaultController<string> | null = null;
  let resolveExit!: (code: number) => void;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  // 已放流内容：计算 outputTail 增量用（initialOutput 计入，避免首拍重复放 banner）。
  let emitted = '';
  let lastTail = '';
  const exit = pid === -1
    ? Promise.resolve(-1)
    : new Promise<number>((resolve) => { resolveExit = resolve; });

  const stopPolling = (): void => {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  };

  const emit = (chunk: string): void => {
    if (!outputController) return;
    try { outputController.enqueue(chunk); } catch { /* 输出流已取消 */ }
  };

  const finish = (code: number): void => {
    if (killed) return;
    killed = true;
    stopPolling();
    try { outputController?.close(); } catch { /* 输出流已取消 */ }
    resolveExit(code);
  };

  const shim: SuccinixProcessShim = {
    exit,
    input: new WritableStream<string>({ write() { /* 无交互 stdin，输入丢弃 */ } }),
    output: new ReadableStream<string>({
      start(controller) {
        outputController = controller;
        if (initialOutput) { emitted = initialOutput; emit(initialOutput); }
      },
      cancel() { stopPolling(); },
    }),
    kill() {
      if (killed) return;
      killed = true;
      stopPolling();
      try { outputController?.close(); } catch { /* 输出流已取消 */ }
      if (pid === -1) resolveExit(-1);
      else void client.kill(pid).then(() => resolveExit(-1), () => resolveExit(-1));
    },
    resize() {},
    succinixPid: pid === -1 ? null : pid,
    succinixTimedOut: false,
  };

  if (pid !== -1) {
    const tick = async (): Promise<void> => {
      if (killed) return;
      try {
        const entries = await client.ps();
        const entry = entries.find((candidate) => candidate.pid === pid);
        if (!entry || entry.status !== 'running') {
          // host 进程表已消失：自然退出结算（exitCode 缺省 -1）。
          finish(entry?.exitCode ?? -1);
          return;
        }
        const candidate = entry.outputTail ?? '';
        if (candidate && candidate !== lastTail) {
          const delta = tailDelta(emitted, candidate);
          if (delta) { emitted += delta; emit(delta); }
          lastTail = candidate;
        }
      } catch {
        // 单次 ps 查询失败：下一拍重试
      }
      if (!killed) pollTimer = setTimeout(() => { void tick(); }, SPAWN_OUTPUT_POLL_MS);
    };
    pollTimer = setTimeout(() => { void tick(); }, SPAWN_OUTPUT_POLL_MS);
  }
  return shim;
}

function assembleCommand(command: string, args?: string[]): string {
  if (!args?.length) return command;
  return `${command} ${args.join(' ')}`;
}

/** 从命令串解析显式声明的端口号（R1 进程→端口推断的声明侧）。覆盖：
 *  `--port N` / `--port=N`、`--server.port=N`（CLI 服务）、`.listen(N)`（node http/express）、
 *  `PORT=N`（env 前置声明）。单横线 `-p` 因与 node `-p`(print) 歧义不纳入，避免误配；
 *  端口必须落在 1–65535（`.listen(0)` 为随机端口，无法作为关联依据）。导出供单测覆盖。 */
export function extractDeclaredPorts(command: string): number[] {
  const ports = new Set<number>();
  const patterns = [
    /(?:^|\s)--port[\s=:]+(\d{1,5})/g,
    /(?:^|\s)--server\.port[\s=:]+(\d{1,5})/g,
    /\.listen\(\s*(\d{1,5})/g,
    /(?:^|\s)PORT=(\d{1,5})/g,
  ];
  for (const pattern of patterns) {
    for (const match of command.matchAll(pattern)) {
      const port = Number(match[1]);
      if (port > 0 && port <= 65_535) ports.add(port);
    }
  }
  return [...ports].sort((left, right) => left - right);
}

export class RuntimeServiceRegistry {
  private readonly webcontainer: WebContainer;
  private readonly onError: (error: unknown) => void;
  private readonly succinix: SuccinixClient;
  private readonly launches = new Map<string, ManagedLaunch>();
  private readonly ports = new Map<number, RuntimePortStatus>();
  private readonly listenersByPort = new Map<number, ListenerRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly orphanTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** M2：端口被孤儿定时器翻为 orphaned 的落定时刻，供 launch 注册时对窗内孤儿端口回溯。 */
  private readonly orphanedAt = new Map<number, number>();
  private readonly launchStopTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly processedRecords = new Set<string>();
  private initializePromise: Promise<void> | null = null;
  private eventWatcher: { close(): void } | null = null;
  private unsubscribePort: (() => void) | null = null;
  private unsubscribeReady: (() => void) | null = null;
  private readQueued = false;

  constructor(webcontainer: WebContainer, onError: (error: unknown) => void, succinix?: SuccinixClient) {
    this.webcontainer = webcontainer;
    this.onError = onError;
    // 单一共享客户端：/cmd.json 是单槽信箱，任何第二条链并发写都会覆盖在途请求。
    this.succinix = succinix ?? new SuccinixClient(webcontainer.fs);
  }

  initialize(): Promise<void> {
    this.initializePromise ??= this.initializeInternal();
    return this.initializePromise;
  }

  private async initializeInternal(): Promise<void> {
    // R2（M2）：service-events.jsonl 监听通道已休眠——NODE_OPTIONS service-hook 随 jsh 迁移移除，
    // 生产环境无进程写该文件；端口归属改由 R1 进程→端口推断（inferManagedPort）承担。保留通道
    //（readEvents / consumeListenerRecord / managedPort）作休眠回退：若历史记录仍出现仍按记录归属，
    // 不删以免动到保留项（webcontainer server-ready/port 监听）。killPid 保留（stopPort pid 分支兜底）。
    await this.webcontainer.fs.mkdir(RUNTIME_DIRECTORY, { recursive: true });
    await this.webcontainer.fs.writeFile(SERVICE_EVENT_PATH, '');
    this.eventWatcher = this.webcontainer.fs.watch(RUNTIME_DIRECTORY, () => this.queueReadEvents());
    this.unsubscribeReady = this.webcontainer.on('server-ready', (port, url) => this.openPort(port, url));
    this.unsubscribePort = this.webcontainer.on('port', (port, type, url) => {
      if (type === 'close') this.closePort(port);
      else this.openPort(port, url);
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPorts(): RuntimePortStatus[] {
    return [...this.ports.values()].sort((left, right) => left.port - right.port).map((port) => ({ ...port }));
  }

  async spawn(request: ManagedSpawnRequest): Promise<ManagedSpawnResult> {
    await this.initialize();
    const launchId = createId('launch');
    // run 语义：source=agent 且 args 为 jsh 式 `-c <cmd>` 组合命令 → Succinix run（统一路由，前台完成）。
    // spawn 语义：其余（后台 node 服务 / 用户终端）→ Succinix spawn（后台长驻进程）。
    const isRunSemantics = request.source === 'agent' && request.args?.length === 2 && request.args[0] === '-c';
    let process: SuccinixProcessShim;
    if (isRunSemantics) {
      const command = request.args![1]!;
      // python/pip 首用前确保运行时资产已注入（幂等，失败不阻断命令——host 会给明确错误）。
      if (mentionsPython(command)) {
        await ensurePythonRuntime(this.webcontainer.fs).catch((error) => this.onError(error));
      }
      // M-1：run 前按容器根 cd 前缀（/workspace/<containerId>）。Lifo 侧 cd 会把会话 cwd 同步到
      // 容器根，node 段经 Lifo 转发时用会话 cwd（真实路径 /home/workspace/<id>）——多容器隔离恢复。
      // N5：cd 前缀引入了 shell 融合（&&），命令因此统一走 Lifo 混合链（Succinix host 上报 runtime
      // 'lifo'），即使命令本身是 node 系；node 子进程由此落在 Lifo 默认超时（~25s）而非 host 的
      // node 专用超时。后续如需 node 直路由，可在 M2/M3 用 setCwd（host 侧会话 cwd）替代 cd 前缀。
      // M6：`cd <root> && <cmd>` 在同一 run 请求内原子执行（host 侧 shlex 解析整条），
      // 并发容器无法在两段之间插队；env 由 client 的 execWithContext 原子节点写入（见 succinixClient）。
      const cwdPrefixed = request.cwd ? `cd ${request.cwd} && ${command}` : command;
      process = createRunShim(this.succinix, cwdPrefixed, request.timeoutMs, request.env);
    } else {
      process = createSpawnShim(this.succinix, await this.spawnBackground(request), request.source === 'terminal' ? 'Succinix terminal ready\n' : '');
    }
    const launch: ManagedLaunch = {
      id: launchId,
      source: request.source,
      containerId: request.containerId,
      command: request.command,
      // run 语义（前台命令）无 host pid，不参与 R1 端口推断，声明端口置空。
      expectedPorts: isRunSemantics ? [] : extractDeclaredPorts(assembleCommand(request.command, request.args)),
      process,
      startedAt: Date.now(),
      status: 'running',
      ...(request.processId ? { processId: request.processId } : {}),
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(request.runId ? { runId: request.runId } : {}),
    };
    this.launches.set(launchId, launch);
    this.reconcileLaunch(launchId);
    void process.exit.then(() => this.markLaunchExited(launchId), (error) => { this.onError(error); this.markLaunchExited(launchId); });
    return { launchId, process };
  }

  stopLaunch(launchId: string): boolean {
    const launch = this.launches.get(launchId);
    if (!launch || launch.status !== 'running') return false;
    launch.status = 'stopping';
    this.markPortsStopping(launchId);
    // R3：Succinix spawn 语义的 launch 持有 host pid，直接经 succinixClient.kill(pid) 终止；
    // run 语义（无 host pid）由 killLaunchProcess 退化为 shim no-op（host 侧超时已兜底）。
    void this.killLaunchProcess(launch).catch((error) => this.onError(error));
    this.scheduleLaunchStopFallback(launchId);
    return true;
  }

  async stopPort(portNumber: number): Promise<boolean> {
    const port = this.ports.get(portNumber);
    if (!port || port.state !== 'managed' || !port.launchId) return false;
    const launch = this.launches.get(port.launchId);
    if (!launch) {
      // 端口仍 managed 但 launch 已不存在（悬空引用）：无法 stop，如实落 orphaned。
      this.updatePort(portNumber, { ...port, state: 'orphaned' });
      return false;
    }
    // L1：launch 已在 stopping（首杀在途）时，二次 stopPort 不得把端口瞬态误标 orphaned——
    // 端口标记 stopping 后等待 close（与首杀路径同一 deadline），close 未按时到达才落 orphaned 兜底。
    if (launch.status === 'stopping') {
      this.updatePort(portNumber, { ...port, state: 'stopping' });
      return this.waitForPortClose(portNumber, { ...port, state: 'stopping' });
    }
    this.updatePort(portNumber, { ...port, state: 'stopping' });
    try {
      if (launch.status === 'running') {
        launch.status = 'stopping';
        this.markPortsStopping(launch.id);
        // R3：managed 端口 stop 时 kill 关联进程的 host pid（succinixClient.kill），
        // 不再走 webcontainer spawn node helper；port.pid 仅作 launch 无 host pid 时的兜底。
        await this.killLaunchProcess(launch, port.pid);
        this.scheduleLaunchStopFallback(launch.id);
      } else {
        // launch 已退出（进程已死）：端口由 WC close 事件移除，无需再 kill。
        this.updatePort(portNumber, { ...port, state: 'orphaned' });
        return false;
      }
    } catch (error) {
      this.onError(error);
      this.updatePort(portNumber, { ...port, state: 'orphaned' });
      return false;
    }
    return this.waitForPortClose(portNumber, port);
  }

  /** stopPort 共用等待：端口在 STOP_WAIT_MS 内被 close 事件移除返回 true，超时落 orphaned 兜底。 */
  private async waitForPortClose(portNumber: number, port: RuntimePortStatus): Promise<boolean> {
    const deadline = Date.now() + STOP_WAIT_MS;
    while (this.ports.has(portNumber) && Date.now() < deadline) await sleep(50);
    if (!this.ports.has(portNumber)) return true;
    this.updatePort(portNumber, { ...port, state: 'orphaned' });
    return false;
  }

  dispose(): void {
    this.unsubscribePort?.();
    this.unsubscribeReady?.();
    this.eventWatcher?.close();
    this.orphanTimers.forEach((timer) => clearTimeout(timer));
    this.orphanTimers.clear();
    this.orphanedAt.clear();
    this.launchStopTimers.forEach((timer) => clearTimeout(timer));
    this.launchStopTimers.clear();
    for (const launch of this.launches.values()) if (launch.status === 'running' || launch.status === 'stopping') launch.process.kill();
    this.launches.clear();
    this.ports.clear();
    this.listenersByPort.clear();
    this.listeners.clear();
    this.processedRecords.clear();
  }

  private async spawnBackground(request: ManagedSpawnRequest): Promise<number> {
    const command = assembleCommand(request.command, request.args);
    // M-1：spawn 无法用 cd 前缀（host 只接受 node 前缀命令），改在命令前 setCwd 到容器根；
    // env 由 client 写入 /etc/succinix.env。M6：setCwd + spawn 在 succinixClient 的
    // execWithContext 原子节点内连续执行（同一 FIFO 链节点），并发容器无法在两段之间插队
    // 串写宿主单一会话 cwd。
    const result = await this.succinix.spawn(command, {
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.cwd ? { cwd: request.cwd } : {}),
      ...(request.env && Object.keys(request.env).length > 0 ? { env: request.env } : {}),
    });
    return result.ok ? result.pid : -1;
  }

  private async killPid(pid: number): Promise<void> {
    const helper = await this.webcontainer.spawn('node', ['-e', "process.kill(Number(process.argv[1]), 'SIGTERM')", String(pid)], { env: {} });
    const exitCode = await Promise.race([helper.exit, sleep(STOP_WAIT_MS).then(() => null)]);
    if (exitCode === null) {
      helper.kill();
      throw new Error(`Timed out while stopping registered service process ${pid}.`);
    }
    if (exitCode !== 0) throw new Error(`Unable to stop registered service process ${pid}.`);
  }

  /**
   * R3：终止 launch 关联的真实进程。Succinix spawn 语义的 launch 持有 host pid
   *（launch.process.succinixPid），直接经 succinixClient.kill(pid) 发 SIGTERM；kill 返回失败
   *（进程已自然退出等）时回退 shim.kill()，让 launch 生命周期照常结算。无 host pid（run 语义
   * shim，kill 为 no-op）且端口仍带 pid 时走保留的 killPid 兜底。
   */
  private async killLaunchProcess(launch: ManagedLaunch, portPid?: number): Promise<void> {
    const hostPid = launch.process.succinixPid;
    if (hostPid !== null && hostPid > 0) {
      // M5：后端 kill 守卫——launch 命令匹配系统进程（host.js / python daemon / /usr/lib/succinix）
      // 时拒绝，防止 stopPort/stopLaunch 误杀系统进程（UI 禁 stop + 此处后端拦截双保险）。
      if (isSystemProcess(launch.command)) return;
      const result = await this.succinix.kill(hostPid);
      if (!result.ok) launch.process.kill();
    } else if (portPid) {
      await this.killPid(portPid);
    } else {
      launch.process.kill();
    }
  }

  private markLaunchExited(launchId: string): void {
    const launch = this.launches.get(launchId);
    if (!launch) return;
    launch.status = 'exited';
    if (![...this.ports.values()].some((port) => port.launchId === launchId)) this.launches.delete(launchId);
  }

  private markPortsStopping(launchId: string): void {
    for (const [portNumber, port] of this.ports) {
      if (port.launchId === launchId) this.updatePort(portNumber, { ...port, state: 'stopping' });
    }
  }

  private scheduleLaunchStopFallback(launchId: string): void {
    const existing = this.launchStopTimers.get(launchId);
    if (existing) clearTimeout(existing);
    this.launchStopTimers.set(launchId, setTimeout(() => {
      this.launchStopTimers.delete(launchId);
      this.markPortsOrphaned(launchId);
    }, STOP_WAIT_MS));
  }

  private markPortsOrphaned(launchId: string): void {
    for (const [portNumber, port] of this.ports) {
      if (port.launchId === launchId) this.updatePort(portNumber, { ...port, state: 'orphaned' });
    }
  }

  private openPort(portNumber: number, url: string): void {
    const existing = this.ports.get(portNumber);
    const listener = this.listenersByPort.get(portNumber);
    // 休眠的 listener 记录通道优先（历史记录仍有权威 pid）；无记录时走 R1 进程→端口推断。
    const managed = listener ? this.managedPort(portNumber, url, listener) : this.inferManagedPort(portNumber, url);
    this.updatePort(portNumber, managed ?? { port: portNumber, url: url || existing?.url || '', state: existing?.state === 'stopping' ? 'stopping' : 'identifying', ...(existing?.source ? { source: existing.source } : {}), ...(existing?.containerId ? { containerId: existing.containerId } : {}), ...(existing?.launchId ? { launchId: existing.launchId } : {}), ...(existing?.processId ? { processId: existing.processId } : {}), ...(existing?.pid ? { pid: existing.pid } : {}) });
    if (!managed && existing?.state !== 'stopping') this.scheduleOrphanClassification(portNumber);
  }

  private closePort(portNumber: number): void {
    const timer = this.orphanTimers.get(portNumber);
    if (timer) clearTimeout(timer);
    this.orphanTimers.delete(portNumber);
    this.orphanedAt.delete(portNumber);
    this.listenersByPort.delete(portNumber);
    const launchId = this.ports.get(portNumber)?.launchId;
    if (this.ports.delete(portNumber)) this.publish();
    if (launchId && ![...this.ports.values()].some((port) => port.launchId === launchId)) {
      const stopTimer = this.launchStopTimers.get(launchId);
      if (stopTimer) clearTimeout(stopTimer);
      this.launchStopTimers.delete(launchId);
      if (this.launches.get(launchId)?.status === 'exited') this.launches.delete(launchId);
    }
  }

  private managedPort(portNumber: number, url: string, record: ListenerRecord): RuntimePortStatus | null {
    const launch = this.launches.get(record.launchId);
    if (!launch || launch.status === 'stopping' || launch.containerId !== record.containerId) return null;
    return {
      port: portNumber,
      url,
      state: 'managed',
      source: launch.source,
      containerId: launch.containerId,
      launchId: launch.id,
      pid: record.pid,
      ...(launch.processId ? { processId: launch.processId } : {}),
    };
  }

  /**
   * R1：进程→端口推断。NODE_OPTIONS service-hook 随 jsh 迁移移除后 listener 记录通道无生产者，
   * 端口归属改由这里推断：server-ready(port) 到来时，把端口关联到声明了该端口的常驻服务进程
   *（`.listen(N)` / `--port N` / `PORT=N`）；命令未声明端口时，仅当容器内只有一个 Agent 服务进程
   *（如 `node server.js`，端口不在命令里）才兜底关联。多服务且端口无声明归属 → 返回 null，落
   * identifying → orphaned（无法可靠关联时如实呈现，不硬造 managed）。终端底座进程（source=terminal）
   * 非服务，声明命中与兜底均不参与，避免把端口误配给只读终端。
   */
  private inferManagedPort(portNumber: number, url = this.ports.get(portNumber)?.url ?? ''): RuntimePortStatus | null {
    const candidates = [...this.launches.values()].filter((launch) =>
      launch.status === 'running'
      && launch.process.succinixPid !== null
      && launch.process.succinixPid > 0);
    if (candidates.length === 0) return null;
    // L2：声明命中同样排除终端底座进程——终端 `node -e "...listen(N)"` 声明了端口也不得归为
    // managed(source=terminal)，只有 Agent 服务进程才参与端口关联。
    const declared = candidates.filter((launch) => launch.source !== 'terminal' && launch.expectedPorts.includes(portNumber));
    const services = candidates.filter((launch) => launch.source !== 'terminal');
    const matched = declared.length === 1
      ? declared[0]
      : declared.length === 0 && services.length === 1
        ? services[0]
        : null;
    if (!matched) return null;
    return {
      port: portNumber,
      url,
      state: 'managed',
      source: matched.source,
      containerId: matched.containerId,
      launchId: matched.id,
      // candidates 已过滤 succinixPid 非空，此处恒为 number（条件展开兼容 exactOptionalPropertyTypes）。
      ...(matched.process.succinixPid !== null ? { pid: matched.process.succinixPid } : {}),
      ...(matched.processId ? { processId: matched.processId } : {}),
    };
  }

  private scheduleOrphanClassification(portNumber: number): void {
    const existing = this.orphanTimers.get(portNumber);
    if (existing) clearTimeout(existing);
    this.orphanTimers.set(portNumber, setTimeout(() => {
      this.orphanTimers.delete(portNumber);
      const port = this.ports.get(portNumber);
      if (port?.state === 'identifying') {
        // M2：记录孤儿落定时刻，供 launch 注册时对窗内孤儿端口回溯（见 reconcileLaunch）。
        this.orphanedAt.set(portNumber, Date.now());
        this.updatePort(portNumber, { ...port, state: 'orphaned' });
      }
    }, ORPHAN_RECONCILIATION_MS));
  }

  /** 取消端口的孤儿分类计时器（端口已被归类 managed 时调用）。 */
  private cancelOrphanTimer(portNumber: number): void {
    const timer = this.orphanTimers.get(portNumber);
    if (timer) clearTimeout(timer);
    this.orphanTimers.delete(portNumber);
  }

  private reconcileLaunch(launchId: string): void {
    const launch = this.launches.get(launchId);
    if (!launch) return;
    // 休眠的 listener 记录通道：launch 注册前已到的记录按记录归属。
    for (const record of this.listenersByPort.values()) {
      if (record.launchId !== launchId) continue;
      const port = this.ports.get(record.port);
      if (!port) continue;
      const managed = this.managedPort(record.port, port.url, record);
      if (managed) this.updatePort(record.port, managed);
    }
    // R1 进程→端口推断：spawn RPC 返回前端口可能已 server-ready（identifying），launch 注册后
    // 重跑推断，命中声明端口即归属 managed（并取消孤儿计时器）。
    // M2：孤儿定时器可能已在 launch 注册前把端口翻为 orphaned（孤儿窗口 3s < spawn RPC 确认上限），
    // 对宽限窗（ORPHAN_RETROSPECT_MS）内刚落 orphaned 的端口同样回溯；超出窗口保持如实 orphaned。
    for (const [portNumber, port] of this.ports) {
      if (port.state !== 'identifying' && port.state !== 'orphaned') continue;
      const managed = this.inferManagedPort(portNumber);
      if (!managed || managed.launchId !== launchId) continue;
      if (port.state === 'orphaned') {
        const orphanedAt = this.orphanedAt.get(portNumber);
        if (orphanedAt === undefined || Date.now() - orphanedAt > ORPHAN_RETROSPECT_MS) continue;
      }
      this.cancelOrphanTimer(portNumber);
      this.updatePort(portNumber, managed);
    }
  }

  private queueReadEvents(): void {
    if (this.readQueued) return;
    this.readQueued = true;
    queueMicrotask(() => {
      this.readQueued = false;
      void this.readEvents().catch(this.onError);
    });
  }

  private async readEvents(): Promise<void> {
    const content = await this.webcontainer.fs.readFile(SERVICE_EVENT_PATH, 'utf-8');
    for (const line of content.split('\n').filter(Boolean)) {
      if (this.processedRecords.has(line)) continue;
      this.processedRecords.add(line);
      let unknownRecord: unknown;
      try { unknownRecord = JSON.parse(line); } catch { this.onError(new Error('Invalid runtime service event JSON.')); continue; }
      if (!isListenerRecord(unknownRecord)) { this.onError(new Error('Invalid runtime service event record.')); continue; }
      this.consumeListenerRecord(unknownRecord);
    }
    if (new TextEncoder().encode(content).byteLength > MAX_EVENT_FILE_BYTES) {
      this.processedRecords.clear();
      await this.webcontainer.fs.writeFile(SERVICE_EVENT_PATH, '');
    }
  }

  private consumeListenerRecord(record: ListenerRecord): void {
    if (record.action === 'closed') {
      const current = this.listenersByPort.get(record.port);
      if (current?.launchId === record.launchId && current.pid === record.pid) this.listenersByPort.delete(record.port);
      return;
    }
    this.listenersByPort.set(record.port, record);
    const port = this.ports.get(record.port);
    if (!port) return;
    const managed = this.managedPort(record.port, port.url, record);
    if (managed) {
      this.cancelOrphanTimer(record.port);
      this.updatePort(record.port, managed);
    }
  }

  private updatePort(portNumber: number, port: RuntimePortStatus): void {
    if (port.state !== 'orphaned') this.orphanedAt.delete(portNumber);
    this.ports.set(portNumber, port);
    this.publish();
  }

  private publish(): void {
    this.listeners.forEach((listener) => listener());
  }
}
