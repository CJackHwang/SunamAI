import type { FileSystemAPI } from '@webcontainer/api';

// Succinix TerminalExecutor 文件 RPC 客户端。
// 通道：浏览器写 /cmd.json（单槽信箱，一次一个请求）→ host 轮询（50ms）→ 写 /result-<id>.json
// （每请求独立结果文件）→ 浏览器读到即删。
// 协议权威契约见 ~/Desktop/MyProject/WebUnix/docs/PROTOCOL.md；host 忽略非数字 id
// （`typeof req.id !== 'number'` 直接 return），故请求 id 用严格递增的数字而非 createId 字符串。

export interface SuccinixRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  runtime?: 'node' | 'lifo' | 'python';
  timedOut: boolean;
}

export interface SuccinixProcessEntry {
  pid: number;
  cmd: string;
  status: string;
  startTime: number;
  exitCode?: number;
  outputTail?: string;
}

const CMD_FILE = '/cmd.json';
const RESULT_PREFIX = '/result-';
const POLL_INTERVAL_MS = 50;
const RPC_TIMEOUT_BUFFER_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30_000;
// 非 run 协议命令（spawn/ps/kill/cwd/setCwd）的浏览器侧 RPC 等待上限。
const PROTOCOL_COMMAND_TIMEOUT_MS = 5_000;
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
  async run(command: string, opts?: { timeoutMs?: number }): Promise<SuccinixRunResult> {
    let result: SuccinixResponse;
    try {
      result = await this.exec('run', { command, ...(opts?.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}) }, opts?.timeoutMs);
    } catch {
      // 轮询超时：host 无响应（未拉起或已崩溃）。
      return { ok: false, exitCode: -1, stdout: '', stderr: 'Succinix RPC timed out.', timedOut: true };
    }
    const stderr = asString(result.stderr);
    const runtime = result.runtime;
    return {
      ok: result.ok === true,
      exitCode: typeof result.exitCode === 'number' ? result.exitCode : -1,
      stdout: asString(result.stdout),
      stderr,
      ...(runtime === 'node' || runtime === 'lifo' || runtime === 'python' ? { runtime } : {}),
      timedOut: TIMEOUT_MESSAGE_PATTERN.test(stderr),
    };
  }

  /** 后台启动 node 系长驻进程，立即返回 pid。 */
  async spawn(command: string, opts?: { timeoutMs?: number }): Promise<{ ok: boolean; pid: number }> {
    let result: SuccinixResponse;
    try {
      result = await this.exec('spawn', { command, ...(opts?.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}) }, PROTOCOL_COMMAND_TIMEOUT_MS);
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

  /** 排队执行：前一个请求 settle（成功或超时）后才写下一个 /cmd.json。 */
  private exec(cmd: string, opts: Record<string, unknown> | undefined, timeoutMs?: number): Promise<SuccinixResponse> {
    const run = this.chain.then(() => this.doExec(cmd, opts, timeoutMs));
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async doExec(cmd: string, opts: Record<string, unknown> | undefined, timeoutMs?: number): Promise<SuccinixResponse> {
    const id = ++this.requestId;
    // 写请求前清理可能残留的旧 /cmd.json（上次超时遗留），host 读到即处理。
    try {
      await this.fs.rm(CMD_FILE, { force: true });
    } catch {
      // 清理失败不影响
    }
    await this.fs.writeFile(CMD_FILE, JSON.stringify({ protocol: 1, id, cmd, opts }));
    const resultFile = `${RESULT_PREFIX}${id}.json`;
    const deadline = Date.now() + (timeoutMs ?? DEFAULT_TIMEOUT_MS) + RPC_TIMEOUT_BUFFER_MS;
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
