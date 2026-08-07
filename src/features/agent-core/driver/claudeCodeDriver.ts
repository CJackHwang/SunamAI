import type { AgentEvent } from '../types';
import type { AgentDriver, AgentDriverCapabilities, AgentDriverId, AgentDriverInit } from './types';

/**
 * ClaudeCodeDriver 桥（TASK-P6 R3，可选实验）。
 *
 * 实现 AgentDriver 接口，调用 Claude Code CLI（`claude -p` 模式）。
 *
 * **浏览器内不可行**（如实标注）：浏览器壳（WebContainer 静态页面）无法 spawn 外部 CLI，
 * 本桥面向**未来本地/混合部署**（Tauri/Electron/本地服务器模式）。接口 + 配置开关先行，
 * 配置 `AGENT_DRIVER=claude-code` 后，浏览器壳内 prompt() 会以
 * "ClaudeCode driver requires a local environment." 优雅拒绝（R5 边界如实）。
 *
 * 本地模式的 spawn 示例实现：Node 22+ 经 `process.getBuiltinModule('node:child_process')`
 * 惰性加载内置模块——避免在浏览器打包器里静态 import node:child_process 导致解析失败。
 * 真实切换验证是后续工作（外部 CLI 在浏览器环境不可行，接口先行）。
 */
const CLAUDE_CODE_REQUIRES_LOCAL = 'ClaudeCode driver requires a local environment.';

/** CLI 执行器：spawn 外部 CLI 并返回完整输出（本地模式；浏览器壳不可达）。 */
export interface CliSpawner {
  (command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export type ClaudeCodeEnvironment = 'local' | 'browser';

export interface ClaudeCodeDriverOptions {
  /** 覆盖环境探测（测试注入点）；缺省自动探测。浏览器壳固定 'browser'。 */
  environment?: ClaudeCodeEnvironment;
  /** CLI 可执行文件路径；缺省 'claude'。 */
  cliPath?: string;
  /** 覆盖 CLI 执行器（测试注入点）；缺省本地 spawn 实现。 */
  spawnCli?: CliSpawner;
}

interface NodeProcessLike {
  getBuiltinModule?(name: string): unknown;
}

interface ChildProcessLike {
  stdout: { on(event: 'data', listener: (chunk: { toString(): string }) => void): void };
  stderr: { on(event: 'data', listener: (chunk: { toString(): string }) => void): void };
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'close', listener: (code: number | null) => void): void;
}

interface ChildProcessModuleLike {
  spawn: (command: string, args: string[], options: { stdio: readonly string[]; signal: AbortSignal }) => ChildProcessLike;
}

/** 环境探测：无 Node 运行时能力即为浏览器壳（外部 CLI 桥不可用）。 */
function detectEnvironment(): ClaudeCodeEnvironment {
  const nodeProcess = (globalThis as { process?: NodeProcessLike }).process;
  if (!nodeProcess || typeof nodeProcess.getBuiltinModule !== 'function') return 'browser';
  return 'local';
}

/** 本地模式默认执行器：`claude -p <text>` → 完整输出。浏览器壳内不可达。 */
function createLocalCliSpawner(signal: AbortSignal): CliSpawner {
  return async (command, args) => {
    const getBuiltinModule = (globalThis as { process?: NodeProcessLike }).process?.getBuiltinModule;
    if (typeof getBuiltinModule !== 'function') {
      throw new Error(CLAUDE_CODE_REQUIRES_LOCAL);
    }
    const childProcess = getBuiltinModule('node:child_process') as ChildProcessModuleLike;
    return new Promise((resolve, reject) => {
      const child = childProcess.spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (error) => { reject(error); });
      child.on('close', (code) => { resolve({ stdout, stderr, exitCode: code ?? -1 }); });
    });
  };
}

export class ClaudeCodeDriver implements AgentDriver {
  readonly id: AgentDriverId = 'claude-code';
  readonly capabilities: AgentDriverCapabilities = {
    steer: false,
    subagents: false,
    requiresLocalEnvironment: true,
  };
  private readonly init: AgentDriverInit;
  private readonly options: ClaudeCodeDriverOptions;
  private readonly spawnCli: CliSpawner;
  private readonly runController = new AbortController();
  private readonly abortListener: () => void;
  private sequence = 0;
  private disposed = false;

  constructor(init: AgentDriverInit, options: ClaudeCodeDriverOptions = {}) {
    this.init = init;
    this.options = options;
    this.spawnCli = options.spawnCli ?? createLocalCliSpawner(this.runController.signal);
    this.abortListener = () => this.runController.abort();
    if (init.signal) {
      if (init.signal.aborted) this.runController.abort();
      else init.signal.addEventListener('abort', this.abortListener, { once: true });
    }
  }

  async prompt(text: string): Promise<void> {
    const environment = this.options.environment ?? detectEnvironment();
    if (environment !== 'local') {
      // R5 如实边界：浏览器壳内不能 spawn 外部 CLI——接口先行、本地/混合部署后补。
      throw new Error(CLAUDE_CODE_REQUIRES_LOCAL);
    }
    this.emit('run_started', { run: this.init.run });
    const cliPath = this.options.cliPath ?? 'claude';
    const result = await this.spawnCli(cliPath, ['-p', text]);
    const content = result.stdout.trim() || result.stderr.trim() || `(exit ${result.exitCode})`;
    this.emit('message', { message: { role: 'assistant', content } });
    this.emit('run_finished', { summary: content });
  }

  abort(): void {
    this.runController.abort();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.init.signal?.removeEventListener('abort', this.abortListener);
    this.runController.abort();
  }

  private emit<K extends AgentEvent['kind']>(kind: K, payload: Omit<Extract<AgentEvent, { kind: K }>, 'id' | 'kind' | 'sessionId' | 'runId' | 'sequence' | 'createdAt'>): void {
    this.sequence += 1;
    this.init.onEvent({
      id: `${this.init.runId}:cc-${this.sequence}`,
      kind,
      sessionId: this.init.sessionId,
      runId: this.init.runId,
      sequence: this.sequence,
      createdAt: Date.now(),
      ...payload,
    } as Extract<AgentEvent, { kind: K }>);
  }
}

export function createClaudeCodeDriver(init: AgentDriverInit, options?: ClaudeCodeDriverOptions): ClaudeCodeDriver {
  return new ClaudeCodeDriver(init, options);
}
