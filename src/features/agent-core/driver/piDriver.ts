import type { CompactionSettings } from '@earendil-works/pi-agent-core';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { AgentEventStore } from '../eventStore';
import type { SubagentHost } from '../tools/base';
import type { PiCompactionRunner } from '../pi/piCompaction';
import type { IndexedDbSessionRepo } from '../pi/indexedDbSessionStorage';
import type { PiAgentFactory } from '../pi/piSession';
import type { PiSubagentCoordinatorOptions } from '../pi/piSubagentCoordinator';
import type { AgentDriver, AgentDriverCapabilities, AgentDriverId, AgentDriverInit } from './types';

/**
 * PiDriver（TASK-P6 R2）：现有 piSession 的薄适配层，默认驱动。
 *
 * 只做「包一层」：把 PiSession 的能力面（prompt/abort/steer/destroy）对齐 AgentDriver
 * 接口，**piSession 内部逻辑一字不改**。事件桥接仍由 PiSession 的 PiEventBridge 完成，
 * 经 AgentDriverInit.onEvent/onRunChange 交给 useAgentV2——与 P1-P5 行为完全一致。
 *
 * 懒加载：PiSession 经动态 import 按需加载（不静态依赖 pi 包），保证初始 bundle 不含 pi 运行时。
 */

export interface PiDriverOptions extends AgentDriverInit {
  /** P3：现有 AgentWorkspaceRuntime（容器/进程/资源）。 */
  runtime?: AgentWorkspaceRuntime;
  /** P2：v3 事件仓库（pi 事件同步写 v3）。 */
  store?: AgentEventStore;
  /** P3：capability 启用集（只注册启用工具）。 */
  enabledTools?: ReadonlySet<string>;
  /** P3：容器可用性。 */
  containerAvailable?: boolean;
  /** P4：子 agent 场景跳过会话仓库持久化。 */
  persistSession?: boolean;
  /** 测试注入点：替换真实 pi Agent 的构造。 */
  createAgent?: PiAgentFactory;
  /** P2 测试注入点：替换会话仓库。 */
  createSessionRepo?: () => IndexedDbSessionRepo;
  /** P4 测试注入：替换子 agent 编排器构造。 */
  createCoordinator?: (deps: PiSubagentCoordinatorOptions) => SubagentHost;
  /** P5：覆盖压缩设置（测试注入点）。 */
  compactionSettings?: CompactionSettings;
  /** P5：覆盖压缩阈值上下文窗口。 */
  compactionContextWindow?: number;
  /** P5：覆盖压缩摘要生成器。 */
  compactionRunner?: PiCompactionRunner;
}

/** 只暴露 PiSession 与 AgentDriver 对齐的能力面，避免 PiDriver 依赖具体类类型。 */
interface PiSessionLike {
  prompt(text: string): Promise<void>;
  abort(): void;
  steer(message: string): boolean;
  destroy(): void;
}

type PiSessionConstructor = (options: PiDriverOptions) => PiSessionLike;

export class PiDriver implements AgentDriver {
  readonly id: AgentDriverId = 'pi';
  readonly capabilities: AgentDriverCapabilities = {
    steer: true,
    subagents: true,
    requiresLocalEnvironment: false,
  };
  private readonly session: PiSessionLike;

  constructor(options: PiDriverOptions, createSession: PiSessionConstructor) {
    this.session = createSession(options);
  }

  prompt(text: string): Promise<void> {
    return this.session.prompt(text);
  }

  abort(): void {
    this.session.abort();
  }

  /** P4：中途引导（pi 通道面向子 agent 编排；用户中途引导未接入 guideActiveTask）。 */
  steer(message: string): boolean {
    return this.session.steer(message);
  }

  destroy(): void {
    this.session.destroy();
  }
}

/** 懒加载构造 PiDriver：动态 import PiSession，避免 pi 运行时进初始 bundle。 */
export async function createPiDriver(options: PiDriverOptions): Promise<PiDriver> {
  const { PiSession } = await import('../pi/piSession');
  return new PiDriver(options, (sessionOptions) => new PiSession(sessionOptions));
}
