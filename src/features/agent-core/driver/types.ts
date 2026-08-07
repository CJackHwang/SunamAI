import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { ChatAttachment } from '@/entities/message/types';
import type { AgentEventStore } from '../eventStore';
import type { AgentEvent, AgentRun } from '../types';

/**
 * 主 Agent 驱动抽象（TASK-P6 R1）。
 *
 * 壳（UI）→ AgentDriver 接口 → 实现：
 *   ├─ PiDriver（内置默认，pi 通道，P1-P5 已完成）
 *   ├─ ClaudeCodeDriver（适配器：调 claude CLI -p 模式，可选实验）
 *   └─ CodexDriver（适配器骨架：调 codex CLI，可选实验）
 *
 * 接口对齐 piSession 的能力面（prompt / abort / steer / destroy + 事件桥接），
 * **不绑定 pi 类型**——纯抽象，pi 实现与未来外部 CLI 桥都实现它。
 * 事件桥接沿用现有模型：实现把回复/状态变化翻译成 AgentEvent，经 onEvent 交给
 * useAgentV2（appendEvent），run 状态经 onRunChange 回写（对齐 PiEventBridge）。
 */

/** 驱动能力位（R5）：useAgentV2 据此如实降级不支持的能力。 */
export interface AgentDriverCapabilities {
  /** 中途引导（steer）：pi 通道支持；外部 CLI 桥在真实集成前不支持。 */
  steer: boolean;
  /** 子 agent 编排：pi 通道支持；外部 CLI 桥不暴露（外部 CLI 自身管理子进程）。 */
  subagents: boolean;
  /** 是否要求本地环境：外部 CLI 桥 true（浏览器壳内不可 spawn CLI）；pi 驱动 false。 */
  requiresLocalEnvironment: boolean;
}

export type AgentDriverId = 'pi' | 'claude-code' | 'codex';

/** 主 Agent 驱动接口：与现有 UI 状态层通过 AgentEvent / AgentRun 桥接，不绑定实现。 */
export interface AgentDriver {
  /** 驱动标识（pi / claude-code / codex）。 */
  readonly id: AgentDriverId;
  /** 能力位：供调用方如实降级（如不支持子 agent / 不支持 steer）。 */
  readonly capabilities: AgentDriverCapabilities;
  /** 发送一条用户消息；实现负责把回复与状态变化翻译成 onEvent 事件流。 */
  prompt(text: string): Promise<void>;
  /** 中止当前运行。 */
  abort(): void;
  /** 可选中途引导（capabilities.steer 为 true 时实现；pi 通道面向子 agent 编排）。 */
  steer?(message: string): boolean;
  /** 销毁驱动：释放订阅与外部信号转发，并中止未完成的运行。 */
  destroy(): void;
}

/** 驱动创建入参：运行上下文 + 与 UI 桥接的回调（对齐 piSession 构造入参的公共面）。 */
export interface AgentDriverInit {
  apiKey: string;
  baseUrl: string;
  apiModel: string;
  systemPrompt?: string;
  sessionId: string;
  runId: string;
  run: AgentRun;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  onRunChange: (run: AgentRun) => void;
}

/**
 * 驱动工厂入参（组合根使用）：在 AgentDriverInit 之上叠加应用层运行上下文。
 * 这些字段不是 pi 类型——runtime / store / capability 是应用层概念，各驱动按需消费
 * （PiDriver 转发给 PiSession；CLI 桥忽略）。
 */
export interface AgentDriverFactoryInput extends AgentDriverInit {
  /** R4：渠道供应商请求 API（缺省 openai-completions）。 */
  providerApi?: 'openai-completions' | 'anthropic-messages';
  /** R5：皮套模型参数（温度等，供应商支持时生效）。 */
  samplingParams?: Record<string, unknown>;
  /** P3：现有 AgentWorkspaceRuntime（容器/进程/资源）。缺省时容器类工具如实报不可用。 */
  runtime?: AgentWorkspaceRuntime;
  /** P2：v3 事件仓库（pi 事件同步写 v3，刷新后 UI 列表可恢复）。 */
  store?: AgentEventStore;
  /** P3：capability 启用集（resolveEnabledTools 结果）；只注册启用工具。 */
  enabledTools?: ReadonlySet<string>;
  /** P3：容器可用性（对齐 capability availability）。 */
  containerAvailable?: boolean;
  /** R1：本次启动的附件（pi 驱动嵌入多模态 user 消息；CLI 桥忽略）。 */
  attachments?: ChatAttachment[];
}
