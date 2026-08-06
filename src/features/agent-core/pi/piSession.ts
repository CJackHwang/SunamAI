import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage, AgentTool as PiAgentTool, Session } from '@earendil-works/pi-agent-core';
import { createModels, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import type { Api, Message as PiMessage, Model, Models } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { Message } from '@/entities/message/types';
import { ContainerMutationLease } from '../agentFamily';
import type { RegisteredTool, ToolExecutionContext } from '../tools/base';
import type { AgentEvent, AgentPhase, AgentRun, TaskContract } from '../types';
import { IndexedDbSessionRepo } from './indexedDbSessionStorage';
import { createPiAgentTools, resolveEnabledPiTools, UNWIRED_PI_RUNTIME } from './piToolAdapter';

/**
 * P1 pi 通道：单 Agent 纯对话会话。
 *
 * 封装 pi 框架（@earendil-works/pi-agent-core + pi-ai）的 Agent 生命周期：
 * - 创建：pi-ai Models + deepseekProvider + 现有 API key（不硬编码 key）；
 * - prompt() / abort() / destroy()；
 * - 事件订阅：把 pi 事件流翻译成现有 UI 状态层可消费的 AgentEvent。
 *
 * 本模块是唯一静态依赖 pi 包的位置，由 useAgentV2 通过动态 import 懒加载，
 * 以保证 pi 的 ~100KiB gzip 不进初始 bundle。
 */

/** 现有设置默认指向 DeepSeek OpenAI 兼容端点；pi-ai deepseek 提供者与之同源。 */
const PI_PROVIDER_ID = 'deepseek';
const DEFAULT_SYSTEM_PROMPT = 'You are Sunam, a coding assistant. Answer the user request directly, honestly, and concisely.';

export interface PiAgentLike {
  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void;
  prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void>;
  abort(): void;
  waitForIdle(): Promise<void>;
  /** P2 刷新恢复：把持久化会话历史注入 agent 转录，使 Agent 可基于历史继续。 */
  seedHistory?(messages: PiAgentMessage[]): void;
}

export type PiAgentFactory = (input: { models: Models; model: Model<Api>; systemPrompt: string; tools: PiAgentTool[] }) => PiAgentLike;

export interface PiSessionOptions {
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
  /** 测试注入点：替换真实 pi Agent 的构造，避免单测走网络。 */
  createAgent?: PiAgentFactory;
  /** P2 测试注入点：替换会话仓库（默认 IndexedDB 后端）。 */
  createSessionRepo?: () => IndexedDbSessionRepo;
  /** P3：现有 AgentWorkspaceRuntime（容器/进程/资源）。缺省时容器类工具如实报不可用。 */
  runtime?: AgentWorkspaceRuntime;
  /** P3：capability 启用集（resolveEnabledTools 结果）；只注册启用工具（R3）。 */
  enabledTools?: ReadonlySet<string>;
  /** P3：覆盖默认工具装配（测试注入点）；缺省按 enabledTools 过滤 18 工具。 */
  tools?: RegisteredTool[];
  /** P3：覆盖工具执行上下文供应商（测试注入点）；缺省从本会话上下文注入编排上下文。 */
  getToolContext?: () => ToolExecutionContext;
  /** P3：容器可用性（对齐 capability availability），供完成门禁与工具上下文使用。 */
  containerAvailable?: boolean;
}

/** 用于合成中止结算消息的空 usage（pi assistant 消息必填字段）。 */
const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const isTextPart = (part: unknown): part is { type: 'text'; text: string } =>
  typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text' && typeof (part as { text?: string }).text === 'string';

const isThinkingPart = (part: unknown): part is { type: 'thinking'; thinking: string } =>
  typeof part === 'object' && part !== null && (part as { type?: string }).type === 'thinking' && typeof (part as { thinking?: string }).thinking === 'string';

/** 从 pi assistant 消息的 content 块中提取正文文本（流式 delta 累积后的最终值）。 */
export function piAssistantText(message: PiAgentMessage): string {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return message.content.filter(isTextPart).map((part) => part.text).join('');
}

/** 从 pi assistant 消息的 content 块中提取推理文本。 */
export function piAssistantReasoning(message: PiAgentMessage): string {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return '';
  return message.content.filter(isThinkingPart).map((part) => part.thinking).join('');
}

function piUserText(message: PiAgentMessage): string {
  if (message.role !== 'user') return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) return message.content.filter(isTextPart).map((part) => part.text).join('');
  return '';
}

function piToolResultText(message: PiAgentMessage): string {
  if (message.role !== 'toolResult') return '';
  if (Array.isArray(message.content)) return message.content.filter(isTextPart).map((part) => part.text).join('');
  return '';
}

/**
 * pi 消息事件 → 现有 UI 消息模型（ChatMessage 结构）。
 * pi 的 user/toolResult 消息映射为字符串 content；assistant 消息保留正文与推理。
 */
export function piMessageToAppMessage(message: PiAgentMessage): Message {
  if (message.role === 'user') return { role: 'user', content: piUserText(message) };
  if (message.role === 'toolResult') {
    return { role: 'tool', tool_call_id: message.toolCallId, name: message.toolName, content: piToolResultText(message) };
  }
  const content = piAssistantText(message);
  const reasoning = piAssistantReasoning(message);
  return {
    role: 'assistant',
    content,
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  };
}

/**
 * 纯事件翻译器：pi 事件流 → 现有 UI 状态层可消费的 AgentEvent。
 *
 * 事件订阅（R3 核心）：流式回复通过 `assistant_delta`（transient）累积，
 * 最终正文通过 `message`（assistant, 携带相同 streamId）落定；ChatMessageList
 * 的流式 key 会让打字机效果无缝替换为持久消息。
 */
export class PiEventBridge {
  private readonly runId: string;
  private readonly sessionId: string;
  private readonly run: AgentRun;
  private readonly onEvent: (event: AgentEvent) => void;
  private readonly onRunChange: (run: AgentRun) => void;
  private sequence = 0;
  private streamIndex = 0;
  private currentStreamId: string | null = null;

  constructor(options: { runId: string; sessionId: string; run: AgentRun; onEvent: (event: AgentEvent) => void; onRunChange: (run: AgentRun) => void }) {
    this.runId = options.runId;
    this.sessionId = options.sessionId;
    this.run = options.run;
    this.onEvent = options.onEvent;
    this.onRunChange = options.onRunChange;
  }

  handlePiEvent(event: PiAgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.setPhase('planning');
        this.emit('run_started', { run: { ...this.run } });
        this.emit('phase_changed', { phase: 'planning' });
        break;
      case 'message_start':
        if (event.message.role === 'user') {
          this.streamIndex += 1;
          this.emit('message', { message: piMessageToAppMessage(event.message), streamId: `${this.runId}:user-${this.streamIndex}` });
        }
        break;
      case 'message_update': {
        if (event.message.role !== 'assistant') break;
        this.currentStreamId = this.currentStreamId ?? `${this.runId}:msg-${++this.streamIndex}`;
        this.emit('assistant_delta', {
          streamId: this.currentStreamId,
          content: piAssistantText(event.message),
          reasoningContent: piAssistantReasoning(event.message),
          transient: true,
        });
        break;
      }
      case 'message_end': {
        const message = event.message;
        if (message.role !== 'assistant') break;
        const streamId = this.currentStreamId ?? `${this.runId}:msg-${++this.streamIndex}`;
        this.currentStreamId = null;
        this.emit('message', { message: piMessageToAppMessage(message), streamId });
        if (message.stopReason === 'aborted') {
          this.setPhase('cancelled');
          this.emit('phase_changed', { phase: 'cancelled', detail: 'Stopped by user.' });
          this.emit('run_finished', { summary: 'Agent stopped by user.' });
        } else if (message.stopReason === 'error') {
          this.setPhase('failed');
          this.emit('phase_changed', { phase: 'failed', detail: message.errorMessage ?? 'Pi agent failed.' });
          this.emit('run_failed', { error: message.errorMessage ?? 'Pi agent failed.', recoverable: false });
        }
        break;
      }
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end':
        // P3：工具已注册，工具调用结果进入模型转录驱动对话继续；按「UI 视觉零改动」约束，
        // 不在聊天流中渲染工具消息（现有引擎的 tool 消息渲染不变）。
        break;
      case 'turn_end':
        break;
      case 'agent_end': {
        if (this.run.phase === 'cancelled' || this.run.phase === 'failed') break;
        const lastAssistant = event.messages.filter((message): message is Extract<PiAgentMessage, { role: 'assistant' }> => message.role === 'assistant').at(-1);
        const summary = lastAssistant ? piAssistantText(lastAssistant) : '';
        this.setPhase('completed');
        this.emit('phase_changed', { phase: 'completed' });
        this.emit('run_finished', { summary: summary || 'Done.' });
        break;
      }
    }
  }

  private setPhase(phase: AgentPhase): void {
    this.run.phase = phase;
    this.run.updatedAt = Date.now();
    this.onRunChange({ ...this.run, task: { ...this.run.task, plan: [...this.run.task.plan], evidence: [...this.run.task.evidence] } });
  }

  private emit<K extends AgentEvent['kind']>(kind: K, payload: Omit<Extract<AgentEvent, { kind: K }>, 'id' | 'kind' | 'sessionId' | 'runId' | 'sequence' | 'createdAt'>): void {
    this.sequence += 1;
    this.onEvent({
      id: `${this.runId}:pi-${this.sequence}`,
      kind,
      sessionId: this.sessionId,
      runId: this.runId,
      sequence: this.sequence,
      createdAt: Date.now(),
      ...payload,
    } as Extract<AgentEvent, { kind: K }>);
  }
}

function defaultCreateAgent({ models, model, systemPrompt, tools }: { models: Models; model: Model<Api>; systemPrompt: string; tools: PiAgentTool[] }): PiAgentLike {
  const agent = new Agent({
    streamFn: (m, context, options) => models.streamSimple(m, context, options),
    // pi 的 AgentMessage 与 LLM Message 同构（CustomAgentMessages 为空），恒等映射即可。
    convertToLlm: (messages) => messages as PiMessage[],
    initialState: { model, systemPrompt, thinkingLevel: 'off', tools },
    // 并行执行：只读类工具可并发，变更/进程类工具通过 executionMode: 'sequential' 强制串行。
    toolExecution: 'parallel',
  });
  // 包装一层 PiAgentLike：seedHistory 把恢复的会话历史注入 Agent 转录。
  return {
    subscribe: (listener) => agent.subscribe(listener),
    // Agent.prompt 是重载（string | AgentMessage | AgentMessage[]），收敛为联合签名。
    prompt: (input) => (agent.prompt as (value: string | PiAgentMessage | PiAgentMessage[]) => Promise<void>)(input),
    abort: () => agent.abort(),
    waitForIdle: () => agent.waitForIdle(),
    seedHistory: (messages) => {
      agent.state.messages = messages;
    },
  };
}

export class PiSession {
  private readonly options: PiSessionOptions;
  private readonly agent: PiAgentLike;
  private readonly bridge: PiEventBridge;
  private readonly unsubscribe: () => void;
  private readonly ready: Promise<unknown>;
  private readonly abortSignal: AbortSignal | undefined;
  private readonly abortListener: () => void;
  private readonly sessionPromise: Promise<Session>;
  private readonly mutationLease = new ContainerMutationLease();
  private session: Session | null = null;
  private pendingPersist: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: PiSessionOptions) {
    this.options = options;
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(deepseekProvider());
    const credentialsReady = credentials.modify(PI_PROVIDER_ID, async () => ({ type: 'api_key', key: options.apiKey }));
    const baseModel = models.getModel(PI_PROVIDER_ID, options.apiModel)
      ?? models.getModels(PI_PROVIDER_ID)[0];
    if (!baseModel) throw new Error(`Pi provider ${PI_PROVIDER_ID} exposes no models.`);
    // 尊重应用侧的 baseUrl 设置（默认与 deepseek 一致），其余字段沿用 pi 目录。
    const model: Model<Api> = { ...baseModel, baseUrl: options.baseUrl.replace(/\/+$/, '') };
    const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    // P3：按 capability 启用集装配 pi 工具（R3），控制类工具所需的编排上下文从本会话注入（R1）。
    const tools = createPiAgentTools({
      tools: options.tools ?? resolveEnabledPiTools(options.enabledTools),
      getContext: options.getToolContext ?? (() => this.buildToolContext()),
    });
    const createAgent = options.createAgent ?? defaultCreateAgent;
    this.agent = createAgent({ models, model, systemPrompt, tools });
    const createSessionRepo = options.createSessionRepo ?? (() => new IndexedDbSessionRepo());
    // 会话 ID 与现有 UI 会话 ID 对齐：按 sessionId 打开或创建持久化 pi 会话。
    this.sessionPromise = createSessionRepo().openOrCreate(options.sessionId);
    this.bridge = new PiEventBridge({
      runId: options.runId,
      sessionId: options.sessionId,
      run: options.run,
      onEvent: options.onEvent,
      onRunChange: options.onRunChange,
    });
    this.unsubscribe = this.agent.subscribe((event, _signal) => {
      // P1 事件桥接逻辑不动；P2 仅在桥接之后追加会话持久化（尽力而为）。
      this.bridge.handlePiEvent(event);
      this.trackPersist(this.persistEvent(event));
    });
    this.abortSignal = options.signal;
    this.abortListener = () => this.agent.abort();
    if (options.signal) {
      if (options.signal.aborted) this.agent.abort();
      else options.signal.addEventListener('abort', this.abortListener, { once: true });
    }
    // P2 刷新恢复：凭据与会话历史就绪后，把历史 seed 进 agent 转录（agent 是内存态，刷新后重建）。
    this.ready = this.initialize(credentialsReady);
  }

  private async initialize(credentialsReady: Promise<unknown>): Promise<void> {
    await credentialsReady;
    const session = await this.sessionPromise;
    if (this.disposed) return;
    this.session = session;
    const history = await this.loadHistory(session);
    if (history.length > 0) this.agent.seedHistory?.(history);
  }

  /**
   * P3：构建现有工具执行上下文（控制类工具依赖的编排上下文：runId/sessionId/runtime/task）。
   * 每次执行时重建，保证 getTask/updateTask 看到最新任务状态。
   */
  private buildToolContext(): ToolExecutionContext {
    const run = this.options.run;
    const signal = this.abortSignal ?? new AbortController().signal;
    return {
      sessionId: this.options.sessionId,
      runId: this.options.runId,
      containerId: run.containerId,
      runtime: this.options.runtime ?? UNWIRED_PI_RUNTIME,
      signal,
      agentRole: run.agentRole ?? 'root',
      ...(this.options.containerAvailable !== undefined ? { containerAvailable: this.options.containerAvailable } : {}),
      ...(this.options.enabledTools ? { shellAvailable: this.options.enabledTools.has('run_command') } : {}),
      mutationLease: this.mutationLease,
      getTask: () => this.options.run.task,
      updateTask: (updater) => this.applyTaskUpdate(updater),
    };
  }

  /** P3：把工具的任务更新写回 run 并通知 UI 层（对齐现有引擎 updateTask 的克隆语义）。 */
  private applyTaskUpdate(updater: (current: TaskContract) => TaskContract): void {
    const next = updater(this.options.run.task);
    const task: TaskContract = {
      ...next,
      acceptanceCriteria: [...next.acceptanceCriteria],
      constraints: [...next.constraints],
      plan: next.plan.map((item) => ({ ...item, ...(item.evidence ? { evidence: [...item.evidence] } : {}) })),
      evidence: [...next.evidence],
      verificationEvidence: next.verificationEvidence.map((evidence) => ({ ...evidence })),
    };
    const updated = { ...this.options.run, task, updatedAt: Date.now() };
    this.options.run.task = task;
    this.options.run.updatedAt = updated.updatedAt;
    this.options.onRunChange(updated);
  }

  /** 发送一条用户消息并等待该次运行结束（含 agent_end 事件监听器 settle）。 */
  async prompt(text: string): Promise<void> {
    await this.ready;
    if (this.disposed) return;
    if (this.abortSignal?.aborted) {
      // 外部信号在运行真正启动前已中止（launchPiTask 的 import/构造窗口），
      // 合成一次中止结算，避免启动一个注定会被取消的运行。
      this.bridge.handlePiEvent({ type: 'agent_start' });
      this.bridge.handlePiEvent({ type: 'message_end', message: this.abortedMessage() });
      this.bridge.handlePiEvent({ type: 'agent_end', messages: [] });
      return;
    }
    await this.appendUserMessage(text);
    await this.agent.prompt(text);
    // 冲刷本次运行的会话写入，保证 prompt 返回时历史已完整持久化。
    await this.pendingPersist;
  }

  private async loadHistory(session: Session): Promise<PiAgentMessage[]> {
    const entries = await session.findEntries({ type: 'message', order: 'oldestFirst' });
    const messages: PiAgentMessage[] = [];
    for (const entry of entries) {
      if (entry.type === 'message') messages.push(entry.message);
    }
    return messages;
  }

  private async appendUserMessage(text: string): Promise<void> {
    await this.session?.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
  }

  private async persistEvent(event: PiAgentEvent): Promise<void> {
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
    if (!this.session) return;
    try {
      await this.session.appendMessage(event.message);
    } catch {
      // 会话持久化失败不阻断事件桥接（尽力而为）；边界见 TASK-P2 R4。
    }
  }

  private trackPersist(write: Promise<void>): void {
    this.pendingPersist = this.pendingPersist.then(() => write).then(() => undefined, () => undefined);
  }

  private abortedMessage(): Extract<PiAgentMessage, { role: 'assistant' }> {
    return {
      role: 'assistant',
      content: [],
      api: 'anthropic-messages',
      provider: PI_PROVIDER_ID,
      model: '',
      usage: EMPTY_USAGE,
      stopReason: 'aborted',
      errorMessage: 'aborted',
      timestamp: Date.now(),
    };
  }

  /** 中止当前运行；pi 会以 stopReason "aborted" 的 assistant 消息结束并发出 agent_end。 */
  abort(): void {
    this.agent.abort();
  }

  /** 销毁会话：移除订阅与外部信号转发，并中止未完成的运行。 */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortSignal?.removeEventListener('abort', this.abortListener);
    this.unsubscribe();
    this.agent.abort();
  }
}
