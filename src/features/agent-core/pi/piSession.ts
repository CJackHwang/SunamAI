import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
import { createModels, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import type { Api, Message as PiMessage, Model, Models } from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import type { Message } from '@/entities/message/types';
import type { AgentEvent, AgentPhase, AgentRun } from '../types';

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
}

export type PiAgentFactory = (input: { models: Models; model: Model<Api>; systemPrompt: string }) => PiAgentLike;

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
        // P1 pi 通道未注册工具，模型无法发起工具调用；保留为 no-op。
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

function defaultCreateAgent({ models, model, systemPrompt }: { models: Models; model: Model<Api>; systemPrompt: string }): PiAgentLike {
  return new Agent({
    streamFn: (m, context, options) => models.streamSimple(m, context, options),
    // pi 的 AgentMessage 与 LLM Message 同构（CustomAgentMessages 为空），恒等映射即可。
    convertToLlm: (messages) => messages as PiMessage[],
    initialState: { model, systemPrompt, thinkingLevel: 'off' },
    toolExecution: 'sequential',
  });
}

export class PiSession {
  private readonly agent: PiAgentLike;
  private readonly bridge: PiEventBridge;
  private readonly unsubscribe: () => void;
  private readonly ready: Promise<unknown>;
  private readonly abortSignal: AbortSignal | undefined;
  private readonly abortListener: () => void;
  private disposed = false;

  constructor(options: PiSessionOptions) {
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(deepseekProvider());
    // 复用现有凭据：把应用已配置的 apiKey 注入 pi-ai 凭据存储（deepseek provider 专用）。
    this.ready = credentials.modify(PI_PROVIDER_ID, async () => ({ type: 'api_key', key: options.apiKey }));
    const baseModel = models.getModel(PI_PROVIDER_ID, options.apiModel)
      ?? models.getModels(PI_PROVIDER_ID)[0];
    if (!baseModel) throw new Error(`Pi provider ${PI_PROVIDER_ID} exposes no models.`);
    // 尊重应用侧的 baseUrl 设置（默认与 deepseek 一致），其余字段沿用 pi 目录。
    const model: Model<Api> = { ...baseModel, baseUrl: options.baseUrl.replace(/\/+$/, '') };
    const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const createAgent = options.createAgent ?? defaultCreateAgent;
    this.agent = createAgent({ models, model, systemPrompt });
    this.bridge = new PiEventBridge({
      runId: options.runId,
      sessionId: options.sessionId,
      run: options.run,
      onEvent: options.onEvent,
      onRunChange: options.onRunChange,
    });
    this.unsubscribe = this.agent.subscribe((event, _signal) => this.bridge.handlePiEvent(event));
    this.abortSignal = options.signal;
    this.abortListener = () => this.agent.abort();
    if (options.signal) {
      if (options.signal.aborted) this.agent.abort();
      else options.signal.addEventListener('abort', this.abortListener, { once: true });
    }
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
    await this.agent.prompt(text);
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
