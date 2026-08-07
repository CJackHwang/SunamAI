import type { SuccinixProcessEntry, SuccinixRunOptions, SuccinixRunResult } from './succinixClient';

// Succinix 整行命令模式用户终端会话（对齐 ~/Desktop/MyProject/WebUnix/src/main.ts 的 REPL 交互）。
//
// 背景：Succinix 的终端是「整行命令模式」——每条命令独立 exec 文件 RPC（/cmd.json 单槽信箱），
// 不是 REPL 进程等待 stdin（AGENTS.md: "Interactive stdin unreliable; file-based RPC replaces it"）。
// 旧实现 spawn 了一个假占位进程（`node -e "...;setInterval"`，不读 stdin 不执行命令）→ 用户终端
// 无法输入、无法操作。本会话替代它：整行命令 → succinixClient.run（cd 前缀同步 Lifo 沙箱 cwd，
// 复用 M1 链路）→ 输出回显 → 下一行提示符。容器 boot 后终端就绪（非 spawn 进程），切换容器/刷新
// 后由宿主重建会话重置状态。
//
// 交互逻辑对齐 Succinix main.ts handleData：Enter 整行执行 / Backspace / Ctrl+C（busy 标记、
// 空闲清行）/ Ctrl+L 清屏 / 空命令换行 / busy 排队（简化版，无上限）。Tab 补全暂不支持。
//
// 物理边界：REPL 类交互进程（python 交互式 / node REPL）仍不可用——整行命令模式如实标注；
// 文件 RPC 的 /cmd.json 是单槽信箱，长前台命令执行期间后续命令排队（busy 队列覆盖浏览器侧）。

const AMBER = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

// 对齐 Succinix main.ts 的 WELCOME_BANNER（版本 + kernel/userland/exec 行）。
export const SUCCINIX_BANNER =
  'Succinix 0.2.0 — kernel: JS runtime + WebContainer | userland: Lifo | exec: TerminalExecutor\n' +
  "Type 'help' to see available commands.";

// 用户终端命令默认超时（对齐 Succinix main.ts execute 的 60s；host 侧 Lifo/node 路由按该值生效）。
const COMMAND_TIMEOUT_MS = 60_000;
// boot 自检里 echo 探路命令的超时（首条 Lifo 命令可能需冷启动沙箱，放宽到 15s）。
const SELF_CHECK_TIMEOUT_MS = 15_000;

/** 宿主把会话输出桥接到 xterm + 用户终端缓冲（Agent 的 read_user_terminal 读取）。 */
export interface UserTerminalOutput {
  write(data: string): void;
  clear(): void;
}

/** 会话所需的最小 SuccinixClient 面（SuccinixClient 天然满足；测试注入 fake）。 */
export interface UserTerminalRpc {
  run(command: string, opts?: SuccinixRunOptions): Promise<SuccinixRunResult>;
  ping(): Promise<boolean>;
  cwd(): Promise<string>;
  ps(): Promise<SuccinixProcessEntry[]>;
}

export interface UserTerminalSessionOptions {
  /** 容器根的 Succinix VFS 绝对路径（/workspace/<containerId>，host 视角的容器根）。 */
  cwd: string;
  /** 注入 host /etc/succinix.env 的环境（与 agent runShell 一致：HOME / SUNAM_WORKSPACE）。 */
  env?: Record<string, string>;
  /** 整行命令执行超时（缺省对齐 Succinix 60s）。 */
  timeoutMs?: number;
}

export class UserTerminalSession {
  readonly containerId: string;
  /** 会话当前 cwd（Succinix VFS 绝对路径），初始 = 容器根；cd 成功后跟随 host 返回值。 */
  private readonly rootCwd: string;
  private readonly env: Record<string, string>;
  private readonly timeoutMs: number;
  private cwd: string;
  private line = '';
  private busy = false;
  private readonly queue: string[] = [];
  private disposed = false;
  private output: UserTerminalOutput = { write: () => {}, clear: () => {} };
  private readonly rpc: UserTerminalRpc;

  constructor(
    rpc: UserTerminalRpc,
    containerId: string,
    options: UserTerminalSessionOptions,
  ) {
    this.rpc = rpc;
    this.containerId = containerId;
    this.rootCwd = options.cwd;
    this.cwd = options.cwd;
    this.env = options.env ?? {};
    this.timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  }

  /** 当前提示符文案（guest@succinix:<短路径>$ ；容器根显示 ~，与 Succinix promptStr 风格对齐）。 */
  getPrompt(): string {
    return `guest@succinix:${this.shortCwd()}$ `;
  }

  /** 会话当前 cwd（供测试 / 宿主展示）。 */
  getCwd(): string {
    return this.cwd;
  }

  /** 绑定终端输出桥（xterm 写入 + 用户终端缓冲）。 */
  attach(output: UserTerminalOutput): void {
    this.output = output;
  }

  /** 按 Succinix main.ts handleData 语义处理 xterm onData 输入。 */
  handleData(data: string): void {
    for (let i = 0; i < data.length; i++) {
      const ch = data.charAt(i);
      if (ch === '\r') {
        this.write('\r\n');
        const cmd = this.line;
        this.line = '';
        const trimmed = cmd.trim();
        if (this.busy) {
          if (trimmed) {
            this.queue.push(trimmed);
            this.write(`${GRAY}queued: will run after the current command finishes${RESET}\r\n`);
          }
          return;
        }
        if (!trimmed) {
          // 空命令：只换到下一行提示符，不发 host（否则 host 回 "empty command" 错误）。
          this.write(this.getPrompt());
          return;
        }
        void this.runCommand(cmd);
        return;
      }
      if (ch === '\u007f' || ch === '\b') {
        if (this.line.length > 0) {
          this.line = this.line.slice(0, -1);
          this.write('\b \b');
        }
        continue;
      }
      if (ch === '\u0003') {
        if (this.busy) {
          this.write(`^C\r\n${GRAY}running, not interrupted${RESET}\r\n`);
        } else {
          this.write('^C\r\n');
          this.prompt();
        }
        continue;
      }
      if (ch === '\u000c') {
        this.output.clear();
        this.write(`${this.getPrompt()}${this.line}`);
        continue;
      }
      if (ch === '\t') continue; // 暂不支持补全
      if (ch >= ' ') {
        this.line += ch;
        this.write(ch);
      }
    }
  }

  /** 写提示符（空行分隔 + 提示符；清空当前输入行）。 */
  prompt(): void {
    this.write(`\r\n${this.getPrompt()}`);
    this.line = '';
  }

  /**
   * 终端就绪引导：Succinix 横幅 → 自检摘要 → REPL 边界标注 → 提示符。
   * 自检期间置 busy，用户输入排队（对齐 Succinix ?test=1 语义）。host boot（bootSuccinixHost）
   * 已做过 ping 探活，但不做功能自检——这里触发一次轻量自检（ping/cwd/echo/ps），如实报告。
   */
  async boot(): Promise<void> {
    this.busy = true;
    try {
      this.write(`${SUCCINIX_BANNER}\r\n`);
      this.write(await this.runSelfCheck());
      this.write(`${GRAY}note: line-command mode — interactive REPL (python / node) is not supported${RESET}\r\n`);
    } finally {
      this.busy = false;
      const next = this.queue.shift();
      if (next) void this.runCommand(next);
      else this.prompt();
    }
  }

  /** 终止会话：丢弃排队输入、抑制后续输出（在途 RPC 结果不再回显）。 */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
  }

  // ─── 内部 ───

  /** 整行命令执行：busy 置位 → execute → 结算出队或提示符（对齐 Succinix runCommand）。 */
  async runCommand(command: string): Promise<void> {
    this.busy = true;
    try {
      await this.execute(command);
    } finally {
      this.busy = false;
      // dispose 后不结算：丢弃排队命令、抑制后续提示符。
      if (!this.disposed) {
        const next = this.queue.shift();
        if (next) void this.runCommand(next);
        else this.prompt();
      }
    }
  }

  private async execute(command: string): Promise<void> {
    this.write('\r\n'); // 输出前空行分隔，可读性好（对齐 Succinix execute）
    const trimmed = command.trim();
    if (this.tryHandleLocalCommand(trimmed)) return;

    // cd 前缀：把 Lifo 沙箱 cwd 与 host 会话 cwd 同步到容器根/当前目录（复用 M1 的 run 路由，
    // 与 serviceRegistry createRunShim 同一模式）。env 由 succinixClient.execWithContext 原子写入
    // /etc/succinix.env（同一 FIFO 链节点，并发容器不插队）。
    const prefixed = `cd ${this.cwd} && ${trimmed}`;
    let result: SuccinixRunResult;
    try {
      result = await this.rpc.run(prefixed, {
        cwd: this.cwd,
        ...(Object.keys(this.env).length > 0 ? { env: this.env } : {}),
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      this.write(`${RED}${error instanceof Error ? error.message : String(error)}${RESET}`);
      return;
    }

    const stdout = result.stdout;
    const stderr = result.stderr;
    if (stdout) this.write(stdout);
    if (stderr) {
      if (stdout && !stdout.endsWith('\n')) this.write('\r\n');
      this.write(`${RED}${stderr}${RESET}`);
    }
    // TASK23：host 在 cd 成功后随结果返回会话 cwd，提示符目录跟随（仅在命令成功时同步）。
    if (result.cwd) this.cwd = result.cwd;
    const code = result.exitCode;
    if (!result.ok && typeof code === 'number' && code !== 0) {
      if ((stdout || stderr) && !(stderr || '').endsWith('\n')) this.write('\r\n');
      this.write(`${GRAY}[${result.timedOut ? 'timed out' : `exit ${code}`}]${RESET}`);
    }
    // stdout/stderr 均空但 host 报 error（如 unknown command）：显示错误，杜绝静默失败。
    if (!result.ok && !stdout && !stderr && result.error) {
      this.write(`${RED}${result.error}${RESET}`);
    }
  }

  /** 浏览器侧本地命令（对齐 Succinix tryHandleLocalCommand 的 help/clear/pwd 子集）。 */
  private tryHandleLocalCommand(trimmed: string): boolean {
    const [word] = trimmed.split(/\s+/);
    switch (word) {
      case 'help':
        this.write(helpText());
        return true;
      case 'clear':
        this.output.clear();
        return true;
      case 'pwd':
        this.write(`${this.cwd}\r\n`);
        return true;
      default:
        return false;
    }
  }

  /** 轻量 host 就绪自检：ping / echo 探路 / cwd / ps，报告通过数（对齐 Succinix boot 摘要形态）。 */
  private async runSelfCheck(): Promise<string> {
    let passed = 0;
    let total = 0;
    const check = async (probe: Promise<boolean>): Promise<void> => {
      total += 1;
      try {
        if (await probe) passed += 1;
      } catch {
        // 计失败
      }
    };
    await check(this.rpc.ping());
    await check(this.rpc.run(`cd ${this.cwd} && echo succinix-self-test-ok`, {
      cwd: this.cwd,
      ...(Object.keys(this.env).length > 0 ? { env: this.env } : {}),
      timeoutMs: SELF_CHECK_TIMEOUT_MS,
    }).then((r) => r.ok && r.stdout.includes('succinix-self-test-ok')));
    await check(this.rpc.cwd().then((c) => c.length > 0));
    await check(this.rpc.ps().then((p) => Array.isArray(p)));
    if (passed === total && total > 0) {
      return `${AMBER}[  OK  ] ${total} checks passed — Succinix host ready${RESET}\r\n`;
    }
    return `${RED}[ FAIL ] ${passed}/${total} checks passed — Succinix host not fully ready${RESET}\r\n`;
  }

  private shortCwd(): string {
    const root = this.rootCwd;
    if (this.cwd === root) return '~';
    if (this.cwd.startsWith(`${root}/`)) return `~/${this.cwd.slice(root.length + 1)}`;
    return this.cwd;
  }

  private write(data: string): void {
    if (this.disposed) return;
    this.output.write(data);
  }
}

/** 本地 help 文案（只列本终端真实支持的命令与边界；其余命令由 Succinix host 执行）。 */
function helpText(): string {
  return [
    'Succinix built-in commands',
    '  help         show this help',
    '  clear        clear the screen (Ctrl+L also works)',
    '  pwd          show the session working directory',
    '  cd <dir>     change directory (prompt follows)',
    'Anything else (ls, echo, cat, node, npm, python ...) runs in the container via the Succinix host.',
    'Note: interactive REPL (python / node) is not supported — line-command mode only.\r\n',
  ].join('\n');
}
