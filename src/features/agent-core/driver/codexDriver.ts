import type { AgentDriver, AgentDriverCapabilities, AgentDriverId, AgentDriverInit } from './types';

/**
 * Codex 桥骨架（TASK-P6 R3，可选实验）。
 *
 * 与 ClaudeCode 桥（claudeCodeDriver.ts）同构，面向未来本地/混合部署调 codex CLI。
 * **浏览器内不可行**（如实标注）：浏览器壳无法 spawn 外部 CLI。
 *
 * 本次只落骨架：真实 CLI 映射（`codex exec` 调用 + 事件桥接）留 TODO，
 * 结构与 claudeCodeDriver 完全一致（prompt → CLI → 文本 → onEvent 事件流）。
 * 浏览器壳内 prompt() 以 "Codex driver requires a local environment." 优雅拒绝。
 */
const CODEX_REQUIRES_LOCAL = 'Codex driver requires a local environment.';

export class CodexDriver implements AgentDriver {
  readonly id: AgentDriverId = 'codex';
  readonly capabilities: AgentDriverCapabilities = {
    steer: false,
    subagents: false,
    requiresLocalEnvironment: true,
  };

  /** 骨架构造：暂时不消费 init——本地模式真实集成时接收运行上下文与事件回调。 */
  constructor(_init: AgentDriverInit) {}

  async prompt(_text: string): Promise<void> {
    // TODO(本地模式)：`codex exec` → 文本 → onEvent 事件桥接（与 claudeCodeDriver 同构）。
    throw new Error(CODEX_REQUIRES_LOCAL);
  }

  abort(): void {
    // 浏览器壳无运行中的 CLI 进程；本地模式真实集成时终止子进程。
  }

  destroy(): void {
    // 浏览器壳无资源可释放；本地模式真实集成时清理子进程与信号转发。
  }
}

export function createCodexDriver(init: AgentDriverInit): CodexDriver {
  return new CodexDriver(init);
}
