import type { FileSystemAPI } from '@webcontainer/api';

// Succinix TerminalExecutor 文件 RPC 客户端。
// 通道：浏览器写 /cmd.json（单槽信箱，一次一个请求）→ host 轮询（50ms）→ 写 /result-<id>.json
// （每请求独立结果文件）→ 浏览器读到即删。
// 协议权威契约见 ~/Desktop/MyProject/WebUnix/docs/PROTOCOL.md；host 忽略非数字 id
// （`typeof req.id !== 'number'` 直接 return），故请求 id 用严格递增的数字而非 createId 字符串。
// 单实例共享：/cmd.json 是单槽信箱，同一容器内必须共享唯一 SuccinixClient 实例——
// 多实例并发会互相覆盖在途 /cmd.json，且各自 id 从 1 递增会撞上 host 的 id 去重，丢请求。

export interface SuccinixRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  runtime?: 'node' | 'lifo' | 'python';
  timedOut: boolean;
  /** host 会话 cwd（Lifo cd 成功后 host 同步并随结果返回；浏览器侧 cd 跟随提示符用）。 */
  cwd?: string;
  /** host 非零失败但无 stdout/stderr 时的错误文案（如 unknown command）。 */
  error?: string;
}

export interface SuccinixProcessEntry {
  pid: number;
  cmd: string;
  status: string;
  startTime: number;
  exitCode?: number;
  outputTail?: string;
  /** 进程归属（TASK-CISOL R1，host ps() 新增字段）：system / container / unknown */
  scope?: 'system' | 'container' | 'unknown';
  /** scope=container 时所属虚拟容器 id（如 c-1） */
  containerId?: string;
}

export interface SuccinixRunOptions {
  /** host 侧命令超时（node/lifo 按路由应用，缺省用 host 默认）。 */
  timeoutMs?: number;
  /** 会话 cwd（run 由调用方 cd 前缀承担，spawn 走 setCwd）。 */
  cwd?: string;
  /** 透传到 node/python 子进程的环境（写入 /etc/succinix.env，host spawn 时合并）。 */
  env?: Record<string, string>;
}

const CMD_FILE = '/cmd.json';
const RESULT_PREFIX = '/result-';
// host 侧 /etc/succinix.env 合并文件：browser wc.fs 根 == host cwd，写到容器根即被 host 读到。
const ENV_FILE = '/etc/succinix.env';
const POLL_INTERVAL_MS = 50;
const RPC_TIMEOUT_BUFFER_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30_000;
// 非 run 协议命令（spawn/ps/kill/cwd/setCwd/ping）的浏览器侧 RPC 等待上限。
const PROTOCOL_COMMAND_TIMEOUT_MS = 5_000;
// ping 是 host 存活探测：host 就绪时 ~50ms 应答。boot 探活要多次快速尝试，
// 故 ping 走独立短截止且不附加 5s 协议缓冲（未就绪 ~500ms 判负），
// 否则 waitForHostReady 单次 ping 最坏阻塞 5s+5s=10s，60 次尝试最坏挂 ~600s（N3）。
const PING_TIMEOUT_MS = 500;
// host 侧超时消息（node 子进程 / lifo 沙箱）统一含 "timed out"。
const TIMEOUT_MESSAGE_PATTERN = /timed out|timeout/i;

interface SuccinixResponse {
  ok?: unknown;
  exitCode?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  runtime?: unknown;
  pid?: unknown;
  killed?: unknown;
  message?: unknown;
  cwd?: unknown;
  processes?: unknown;
  kind?: unknown;
  error?: unknown;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export class SuccinixClient {
  private readonly fs: FileSystemAPI;
  // 单槽通道：/cmd.json 一次一个请求。全部请求经 FIFO 队列串行，单个请求失败不中断链。
  private chain: Promise<unknown> = Promise.resolve();
  private requestId = 0;

  constructor(fs: FileSystemAPI) {
    this.fs = fs;
  }

  /** 执行命令（统一路由：node|npm|npx → 真 Node，其余 → Lifo 沙箱），等待完成返回。 */
  async run(command: string, opts?: SuccinixRunOptions): Promise<SuccinixRunResult> {
    let result: SuccinixResponse;
    try {
      // M6：env 上下文与 run 命令同一原子节点（多容器并发时 env 文件不被其他容器插队串写）。
      result = await this.execWithContext('run', { command, ...(opts?.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}) }, opts, opts?.timeoutMs);
    } catch {
      // 轮询超时：host 无响应（未拉起或已崩溃）。
      return { ok: false, exitCode: -1, stdout: '', stderr: 'Succinix RPC timed out.', timedOut: true };
    }
    const stderr = asString(result.stderr);
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : -1;
    const runtime = result.runtime;
    const cwd = asString(result.cwd);
    const error = asString(result.error);
    return {
      ok: result.ok === true,
      exitCode,
      stdout: asString(result.stdout),
      stderr,
      ...(runtime === 'node' || runtime === 'lifo' || runtime === 'python' ? { runtime } : {}),
      // TASK23：host 在 Lifo cd 成功后随结果返回会话 cwd（浏览器侧整行终端跟随提示符目录）。
      ...(cwd ? { cwd } : {}),
      ...(error ? { error } : {}),
      // H1-2：Lifo 超时以 exitCode 130（AbortError）结算且 stderr 可能为空，需与 stderr 超时消息、
      // 轮询超时（外层 catch）一起判定 timedOut，对齐协议 R1 语义。
      timedOut: exitCode === 130 || TIMEOUT_MESSAGE_PATTERN.test(stderr),
    };
  }

  /** 后台启动 node 系长驻进程，立即返回 pid。 */
  async spawn(command: string, opts?: SuccinixRunOptions): Promise<{ ok: boolean; pid: number }> {
    let result: SuccinixResponse;
    try {
      // M6：setCwd 与 spawn 命令同一原子节点（多容器并发时会话 cwd 不被其他容器插队串写）。
      result = await this.execWithContext('spawn', { command, ...(opts?.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}) }, opts, PROTOCOL_COMMAND_TIMEOUT_MS);
    } catch {
      return { ok: false, pid: -1 };
    }
    return {
      ok: result.ok === true && typeof result.pid === 'number',
      pid: typeof result.pid === 'number' ? result.pid : -1,
    };
  }

  /** 进程表快照（host 拉起的真实子进程）。 */
  async ps(): Promise<SuccinixProcessEntry[]> {
    try {
      const result = await this.exec('ps', undefined, PROTOCOL_COMMAND_TIMEOUT_MS);
      return Array.isArray(result.processes) ? result.processes as SuccinixProcessEntry[] : [];
    } catch {
      return [];
    }
  }

  /** 终止真实子进程（SIGTERM）。 */
  async kill(pid: number): Promise<{ ok: boolean; killed: boolean; message: string }> {
    let result: SuccinixResponse;
    try {
      result = await this.exec('kill', { pid }, PROTOCOL_COMMAND_TIMEOUT_MS);
    } catch {
      return { ok: false, killed: false, message: 'Succinix RPC timed out.' };
    }
    return {
      ok: result.ok === true,
      killed: result.killed === true,
      message: asString(result.message),
    };
  }

  /** 会话工作目录。 */
  async cwd(): Promise<string> {
    try {
      const result = await this.exec('cwd', undefined, PROTOCOL_COMMAND_TIMEOUT_MS);
      return asString(result.cwd);
    } catch {
      return '';
    }
  }

  /** 显式设置会话工作目录。 */
  async setCwd(cwd: string): Promise<{ ok: boolean }> {
    try {
      const result = await this.exec('setCwd', { cwd }, PROTOCOL_COMMAND_TIMEOUT_MS);
      return { ok: result.ok === true };
    } catch {
      return { ok: false };
    }
  }

  /** host 存活探测（协议 ping，返回 pong 即就绪；用于 boot 探活）。 */
  async ping(): Promise<boolean> {
    try {
      const result = await this.exec('ping', undefined, PING_TIMEOUT_MS, 0);
      return result.kind === 'pong';
    } catch {
      return false;
    }
  }

  /**
   * M6（cwd/env 竞态防护）：上下文写入与命令塞进同一个 FIFO 链节点原子执行。
   * Succinix host 是单一会话 cwd（协议无 per-request cwd）与单一 /etc/succinix.env 合并文件
   * ——若 setCwd / env 写入与命令分处两个链节点，多容器并发时另一容器的上下文会在两节点之间
   * 插队，本容器命令就会在错误目录 / 错误环境下执行（实测：A setCwd 后 B setCwd 插队，
   * A 的 spawn 落在 B 目录）。这里把上下文与命令放在同一个链节点内：this.chain 在节点入队时
   * 已指向整条序列，节点内 await 不释放链（后续请求只能排到命令完成之后），宿主侧表现为
   * `setCwd + spawn` / `env 写入 + run` 原子完成。
   * best-effort：上下文任一步失败不阻断命令（命令会在原 cwd / 缺 env 下继续，避免把一次
   * 可用的执行误报为 RPC 超时）。
   */
  private execWithContext(cmd: string, opts: Record<string, unknown> | undefined, context: SuccinixRunOptions | undefined, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SuccinixResponse> {
    const run = this.chain.then(async () => {
      if (context?.cwd) {
        try {
          await this.doExec('setCwd', { cwd: context.cwd }, PROTOCOL_COMMAND_TIMEOUT_MS);
        } catch {
          // 会话 cwd 设置失败不阻断命令
        }
      }
      if (context?.env && Object.keys(context.env).length > 0) {
        try {
          await this.writeEnvFile(context.env);
        } catch {
          // env 文件写入失败不阻断命令
        }
      }
      return this.doExec(cmd, opts, timeoutMs);
    });
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 把环境写入 host 合并文件 /etc/succinix.env（仅供 execWithContext 原子节点内部调用，不占用 FIFO 链）。 */
  private writeEnvFile(entries: Record<string, string>): Promise<void> {
    return (async () => {
      await this.fs.mkdir('/etc', { recursive: true }).catch(() => {});
      const content = `${Object.entries(entries).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
      await this.fs.writeFile(ENV_FILE, content);
    })();
  }

  /** 排队执行：前一个请求 settle（成功或超时）后才写下一个 /cmd.json。 */
  private exec(cmd: string, opts: Record<string, unknown> | undefined, timeoutMs?: number, bufferMs = RPC_TIMEOUT_BUFFER_MS): Promise<SuccinixResponse> {
    const run = this.chain.then(() => this.doExec(cmd, opts, timeoutMs, bufferMs));
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async doExec(cmd: string, opts: Record<string, unknown> | undefined, timeoutMs?: number, bufferMs = RPC_TIMEOUT_BUFFER_MS): Promise<SuccinixResponse> {
    const id = ++this.requestId;
    // 写请求前清理可能残留的旧 /cmd.json（上次超时遗留），host 读到即处理。
    try {
      await this.fs.rm(CMD_FILE, { force: true });
    } catch {
      // 清理失败不影响
    }
    await this.fs.writeFile(CMD_FILE, JSON.stringify({ protocol: 1, id, cmd, opts }));
    const resultFile = `${RESULT_PREFIX}${id}.json`;
    const deadline = Date.now() + (timeoutMs ?? DEFAULT_TIMEOUT_MS) + bufferMs;
    for (;;) {
      try {
        const raw = await this.fs.readFile(resultFile, 'utf-8');
        const parsed = JSON.parse(raw) as SuccinixResponse;
        try {
          await this.fs.rm(resultFile);
        } catch {
          // 清理失败不影响
        }
        return parsed;
      } catch {
        // 结果未就绪：继续轮询
      }
      if (Date.now() >= deadline) throw new Error(`Succinix RPC timed out for command: ${cmd}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}
