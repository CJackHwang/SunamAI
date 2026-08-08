import { Agent, buildSessionContext, convertToLlm, estimateContextTokens, prepareCompaction } from '@earendil-works/pi-agent-core';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage, AgentTool as PiAgentTool, CompactionSettings, Session } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, envApiKeyAuth, InMemoryCredentialStore, uuidv7 } from '@earendil-works/pi-ai';
import type { Api, AssistantMessageEventStream, ImageContent, Model, Models, SimpleStreamOptions, TextContent } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import type { ProviderApi } from '@/shared/config/providers';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { ChatAttachment, Message, ToolCall } from '@/entities/message/types';
import type { AgentResource } from '@/entities/resource/types';
import { v3Persistence } from '@/entities/persistence/v3Repository';
import { ContainerMutationLease } from '../mutationLease';
import { ResourceProcessorRegistry } from '../resourceProcessor';
import type { AgentEventStore } from '../eventStore';
import type { RegisteredTool, SubagentHost, ToolExecutionContext } from '../tools/base';
import type { AgentEvent, AgentPhase, AgentRun, AgentToolResult, TaskContract } from '../types';
import { IndexedDbSessionRepo } from './indexedDbSessionStorage';
import {
  PI_COMPACTION_CUSTOM_INSTRUCTIONS,
  buildCompactedAgentMessages,
  buildPiCompactionConfig,
  createDefaultCompactionRunner,
  isCompactionNeeded,
  type PiCompactionRunner,
} from './piCompaction';
import { createPiAgentTools, PI_CHILD_NO_DELEGATION, resolveEnabledPiTools, UNWIRED_PI_RUNTIME } from './piToolAdapter';
import { PiSubagentCoordinator, type PiSubagentCoordinatorOptions } from './piSubagentCoordinator';

/**
 * P1 pi 通道：单 Agent 纯对话会话。
 *
 * 封装 pi 框架（@earendil-works/pi-agent-core + pi-ai）的 Agent 生命周期：
 * - 创建：pi-ai Models + 从现有 modelClient 配置派生的 provider（不硬编码供应商）；
 * - prompt() / abort() / destroy()；
 * - 事件订阅：把 pi 事件流翻译成现有 UI 状态层可消费的 AgentEvent，
 *   并同步写入 v3 event store（P2-M1：刷新后 UI 聊天列表可恢复 pi 消息）；
 * - P4（R2）：根 run 装配 PiSubagentCoordinator 作为子 agent host，子 agent 是
 *   独立 PiSession 实例（persistSession: false，不占独立 pi 会话）。
 * - P5（R1/R2/R4）：上下文压缩对齐——每次 prompt 前检查 pi compaction 阈值，
 *   达到阈值先压缩（摘要 + 保留尾）再继续；压缩结果写回 pi 会话（compaction entry），
 *   刷新后 buildSessionContext 只重建「最新摘要 + 保留尾 + 后续消息」。
 *
 * 本模块是唯一静态依赖 pi 包的位置，由 useAgentV2 通过动态 import 懒加载，
 * 以保证 pi 的 ~100KiB gzip 不进初始 bundle。
 */

const DEFAULT_SYSTEM_PROMPT = 'You are Sunam, a coding assistant. Answer the user request directly, honestly, and concisely.';

/**
 * P1-L4：从现有 modelClient 配置（baseUrl/apiModel）派生 pi provider id。
 * 应用侧统一走 OpenAI 兼容端点（callLLM 发 /chat/completions），pi 通道复用同一配置；
 * 以 baseUrl host 派生稳定 provider id（配置驱动，不硬编码 deepseek），
 * 换供应商时只需改设置，无需改代码。
 */
function deriveProviderId(baseUrl: string): string {
  try {
    const slug = new URL(baseUrl).hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return slug || 'openai-compatible';
  } catch {
    return 'openai-compatible';
  }
}

/**
 * R2：抑制 OpenAI SDK 的 `X-Stainless-*` 遥测头。
 *
 * pi-ai 的 openai-completions 通道用 OpenAI SDK 构造请求，SDK 默认注入
 * `X-Stainless-Lang/OS/Arch/Runtime/…` 自定义头。这些头对普通 HTTPS 网关无碍，
 * 但配置本机（localhost/127.0.0.1）或带端口的自定义渠道（Ollama/LM Studio/自建代理）
 * 时，浏览器会因这些头触发 CORS preflight，而这类服务器通常不会把这些头列入
 * `Access-Control-Allow-Headers`，导致「获取模型/请求」失败。
 *
 * 置为 `null` 会让 OpenAI client 的 buildHeaders 在合并 model.headers 时删除对应默认头
 * （client 在平台头之后合并 defaultHeaders，null 即清除）。全渠道通用：真实网关也不依赖
 * 这些遥测头，移除无害。
 */
const STAINLESS_SUPPRESS_HEADERS: Record<string, string | null> = {
  'X-Stainless-Lang': null,
  'X-Stainless-Package-Version': null,
  'X-Stainless-OS': null,
  'X-Stainless-Arch': null,
  'X-Stainless-Runtime': null,
  'X-Stainless-Runtime-Version': null,
  'X-Stainless-Retry-Count': null,
  'X-Stainless-Timeout': null,
};

/** 从配置构造 pi 模型（默认 api = openai-completions；anthropic 渠道走 anthropic-messages）。 */
export function buildConfigModel(apiModel: string, baseUrl: string, providerId: string, api: ProviderApi = 'openai-completions', samplingParams?: Record<string, unknown>): Model<Api> {
  return {
    id: apiModel,
    name: apiModel,
    api,
    provider: providerId,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    reasoning: false,
    // R1：声明 image 输入，使附件图片（用户消息内嵌 + read_resource_image 工具结果）
    // 能经 openai-completions 通道发送（该通道按 model.input 门控工具结果的图片回传）。
    // R5 如实边界：旧引擎有「模型拒绝 vision 时降级为文本描述」的探测回退；pi 通道无此回退，
    // 若配置的模型不支持图片，带图消息会以供应商错误如实失败（不静默吞图）。
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    // R5：皮套模型参数（温度/top_p/max_tokens 等，供应商支持时生效）。
    ...(samplingParams ? { samplingParams } : {}),
    // R2：清掉 OpenAI SDK 的 X-Stainless-* 默认头（见上），使本机/带端口渠道免于 CORS preflight 失败。
    ...(api === 'openai-completions' ? { headers: STAINLESS_SUPPRESS_HEADERS as Record<string, string> } : {}),
  };
}

export interface PiAgentLike {
  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void;
  prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void>;
  abort(): void;
  waitForIdle(): Promise<void>;
  /** P2 刷新恢复：把持久化会话历史注入 agent 转录，使 Agent 可基于历史继续。 */
  seedHistory?(messages: PiAgentMessage[]): void;
  /** P4 子 agent 编排：把父协调消息排队到当前 assistant turn 之后注入（pi Agent.steer）。 */
  steer?(message: PiAgentMessage): void;
}

export type PiAgentFactory = (input: {
  models: Models;
  model: Model<Api>;
  systemPrompt: string;
  tools: PiAgentTool[];
  transformContext?: (messages: PiAgentMessage[], signal?: AbortSignal) => Promise<PiAgentMessage[]>;
  /**
   * P5：下一轮前的压缩回调（agent loop 的 prepareNextTurnWithContext）。
   * 返回压缩后的上下文消息（无压缩返回 undefined）——pi 是自治循环，用户中途引导经 steer
   * 排队到当前 turn 之后，此回调在 steering 注入前运行，使超大上下文在进入下一轮前先压缩。
   */
  prepareNextTurn?: () => Promise<PiAgentMessage[] | undefined>;
}) => PiAgentLike;

export interface PiSessionOptions {
  apiKey: string;
  baseUrl: string;
  apiModel: string;
  systemPrompt?: string;
  /** R4：供应商渠道的请求 API（缺省 openai-completions，OpenAI 兼容）。 */
  providerApi?: ProviderApi;
  /** R5：皮套模型参数（温度/top_p/max_tokens，供应商支持时生效）。 */
  samplingParams?: Record<string, unknown>;
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
  /** P2：v3 事件仓库。缺省时 pi 事件只进 pi 会话持久化，不写 v3（刷新后 UI 列表不恢复）。 */
  store?: AgentEventStore;
  /** P4：覆盖工具上下文里的子 agent host（子 agent 场景注入如实拒绝的哨兵，跳过编排器构造）。 */
  subagents?: SubagentHost;
  /** P4 测试注入：替换子 agent 编排器构造（缺省 new PiSubagentCoordinator）。 */
  createCoordinator?: (deps: PiSubagentCoordinatorOptions) => SubagentHost;
  /** P4：子 agent 场景——跳过 pi 会话仓库持久化（子 run 不占独立 pi 会话，避免历史串扰）。 */
  persistSession?: boolean;
  /** P4：子 agent 清理——新根 run 启动时编排器剪掉上一根族的终态子 run，通知 UI 移除对应行。 */
  onChildrenPruned?: (runIds: string[]) => void;
  /** P5：覆盖压缩设置（测试注入点）；缺省按 apiModel 对齐现有引擎 90% 语义。 */
  compactionSettings?: CompactionSettings;
  /** P5：覆盖压缩阈值上下文窗口（测试注入点）；缺省取 profileForModel(apiModel).contextWindowTokens。 */
  compactionContextWindow?: number;
  /** P5：覆盖压缩摘要生成器（测试注入点，避免单测走网络）；缺省走 pi compact() 真实 LLM 摘要。 */
  compactionRunner?: PiCompactionRunner;
  /** R1：本次启动的附件（用户发送时附带）。构造为 pi 多模态 user 消息（图片内嵌 + 资源清单）。 */
  attachments?: ChatAttachment[];
  /** R1 测试注入点：覆盖「resourceId → 图片 data/mimeType」加载器；缺省从 v3 资源仓库读取。 */
  loadImageData?: (resourceId: string) => Promise<{ data: string; mimeType: string } | null>;
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

/**
 * 递归剔除 undefined 字段（含数组中的 undefined 元素），使消息可被 pi Session 的
 * assertJsonSerializable 接受（Durable payload 拒收 undefined）。用于会话持久化——
 * 供应商/mock 的可选字段（responseId/rawStopReason 等）未回填时为 undefined，直接写入会抛错。
 */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)).filter((item) => item !== undefined);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      result[key] = stripUndefined(item);
    }
    return result;
  }
  return value;
}

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

const isToolCallPart = (part: unknown): part is { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> } =>
  typeof part === 'object' && part !== null && (part as { type?: string }).type === 'toolCall';

/** pi toolCall 块的 arguments 是解析后的对象；转成现有 ToolCall 模型要求的 JSON 字符串。 */
function toolCallArgumentsString(args: unknown): string {
  if (typeof args === 'string') return args;
  return JSON.stringify(args ?? {});
}

/** 从 pi assistant 消息的 content 块中提取工具调用（pi ToolCall → 现有 ToolCall 结构）。 */
export function piAssistantToolCalls(message: PiAgentMessage): ToolCall[] {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return [];
  return message.content.filter(isToolCallPart).map((part) => ({
    id: part.id,
    type: 'function',
    function: { name: part.name, arguments: toolCallArgumentsString(part.arguments) },
  }));
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
 * pi 的 user/toolResult 消息映射为字符串 content；assistant 消息保留正文、推理
 * 与工具调用（content 中的 toolCall 块 → Message.tool_calls），使气泡叠加渲染
 * 思考 + 工具调用 + 工具结果。
 */
export function piMessageToAppMessage(message: PiAgentMessage): Message {
  if (message.role === 'user') return { role: 'user', content: piUserText(message) };
  if (message.role === 'toolResult') {
    return { role: 'tool', tool_call_id: message.toolCallId, name: message.toolName, content: piToolResultText(message) };
  }
  const content = piAssistantText(message);
  const reasoning = piAssistantReasoning(message);
  const toolCalls = piAssistantToolCalls(message);
  return {
    role: 'assistant',
    content,
    ...(reasoning ? { reasoning_content: reasoning } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

/**
 * 纯事件翻译器：pi 事件流 → 现有 UI 状态层可消费的 AgentEvent。
 *
 * 事件订阅（R3 核心）：流式回复通过 `assistant_delta`（transient）累积，
 * 最终正文通过 `message`（assistant, 携带相同 streamId）落定；ChatMessageList
 * 的流式 key 会让打字机效果无缝替换为持久消息。
 *
 * 工具调用（R1）：assistant 消息的 toolCall 块转成 Message.tool_calls（气泡叠加显示）；
 * `tool_execution_start/end` 透传为 `tool_started`/`tool_finished`（RunBoard/事件订阅消费）；
 * toolResult 消息落定为 role:'tool' 消息事件，供 ChatMessageList 按 tool_call_id 关联结果。
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
  /** P4 L-2 修复：子 agent usage 统计真实化（modelTurns/toolCalls 累计，随 run_finished 上报）。 */
  private readonly usage = { modelTurns: 0, toolCalls: 0 };
  /** R1：工具执行进行中的 toolCallId → 名称/参数，供 tool_execution_end 构造完整 ToolCall。 */
  private readonly pendingToolCalls = new Map<string, { name: string; args: unknown }>();
  /** R1：当前 prompt 的附件元数据（用于 UI 附件 chips；缺省不渲染）。 */
  private readonly getUserAttachments: (() => ChatAttachment[] | undefined) | undefined;
  /** 中止查询：运行中止信号是否已 aborted（区分「停止 Agent」与真实失败）。 */
  private readonly isAborted: () => boolean;
  /**
   * R6：本 turn 工具执行产生的终态标记（旧引擎 stopRun 语义的 pi 通道映射）。
   * 旧引擎在 executeTools 后按首个 stopRun 结算（completed / awaiting_parent / awaiting_user）；
   * pi 是自治循环，工具结果不会自己停 loop，这里在 tool_execution_end 记录标记，
   * 由 agent_end 按它结算 run 终态（见 handlePiEvent 的 agent_end / turn_end 分支）。
   */
  private pendingStopRun: 'completed' | 'awaiting_parent' | 'awaiting_user' | undefined = undefined;
  /** 供 persistCheckpoint 读取当前事件序列（对齐旧引擎 checkpoint 的 eventTailSequence）。 */
  getSequence(): number { return this.sequence; }
  /** 用户中途引导（steer）已即时投递到 UI 的 user 消息——agent 注入时按引用去重，避免双显。 */
  private readonly steeredMessages = new Set<PiAgentMessage>();

  constructor(options: { runId: string; sessionId: string; run: AgentRun; onEvent: (event: AgentEvent) => void; onRunChange: (run: AgentRun) => void; getUserAttachments?: () => ChatAttachment[] | undefined; isAborted?: () => boolean }) {
    this.runId = options.runId;
    this.sessionId = options.sessionId;
    this.run = options.run;
    this.onEvent = options.onEvent;
    this.onRunChange = options.onRunChange;
    this.getUserAttachments = options.getUserAttachments;
    this.isAborted = options.isAborted ?? (() => false);
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
          // P5：用户中途引导（steer）已在 PiSession.steer 即时投递到 UI，agent 注入时按引用去重。
          if (this.steeredMessages.has(event.message)) break;
          this.streamIndex += 1;
          const appMessage = piMessageToAppMessage(event.message);
          const attachments = this.getUserAttachments?.();
          // R1：保留附件元数据到 UI 消息模型（chips 渲染与旧引擎一致）。
          const message = attachments ? { ...appMessage, _ui_displayContent: piUserText(event.message), _ui_attachments: attachments } : appMessage;
          this.emit('message', { message, streamId: `${this.runId}:user-${this.streamIndex}` });
        }
        break;
      case 'message_update': {
        if (event.message.role !== 'assistant') break;
        this.currentStreamId = this.currentStreamId ?? `${this.runId}:msg-${++this.streamIndex}`;
        this.emit('assistant_delta', {
          streamId: this.currentStreamId,
          content: piAssistantText(event.message),
          reasoningContent: piAssistantReasoning(event.message),
          // R1：流式 partial 含 toolCall 块时透传给流式气泡（ChatMessageList 渲染 streamingToolCalls）。
          toolCalls: piAssistantToolCalls(event.message),
          transient: true,
        });
        break;
      }
      case 'message_end': {
        const message = event.message;
        if (message.role === 'toolResult') {
          // R1/R3：工具结果消息 → 现有 role:'tool' 消息事件。ChatMessageList 以 tool_call_id
          // 索引到 assistant 气泡的 ToolDisclosure（toolOutputs），渲染「已完成 + 结果摘要」。
          this.emit('message', { message: piMessageToAppMessage(message), streamId: `${this.runId}:tool-${message.toolCallId}` });
          break;
        }
        if (message.role !== 'assistant') break;
        // P4 L-2 修复：累计模型轮次（子 agent usage 统计真实化）
        this.usage.modelTurns += 1;
        const streamId = this.currentStreamId ?? `${this.runId}:msg-${++this.streamIndex}`;
        this.currentStreamId = null;
        this.emit('message', { message: piMessageToAppMessage(message), streamId });
        if (message.stopReason === 'aborted') {
          this.setPhase('cancelled');
          this.emit('phase_changed', { phase: 'cancelled', detail: 'Stopped by user.' });
          this.emit('run_finished', { summary: 'Agent stopped by user.' });
        } else if (message.stopReason === 'error') {
          // 中止竞态：工具执行中被 abort（如 wait_subagents 等待子 agent 时被停）后，下一轮
          // LLM 调用会以 abort 错误收尾（stopReason='error' 而非 'aborted'）。此时信号已 aborted，
          // 如实映射为 cancelled 而不是 failed，避免「停止主 Agent」落成失败态。
          if (this.isAborted()) {
            this.setPhase('cancelled');
            this.emit('phase_changed', { phase: 'cancelled', detail: 'Stopped by user.' });
            this.emit('run_finished', { summary: 'Agent stopped by user.' });
          } else {
            this.setPhase('failed');
            this.emit('phase_changed', { phase: 'failed', detail: message.errorMessage ?? 'Pi agent failed.' });
            this.emit('run_failed', { error: message.errorMessage ?? 'Pi agent failed.', recoverable: false });
          }
        }
        break;
      }
      case 'tool_execution_start': {
        // R1：工具执行开始 → 现有 tool_started 事件（toolCall 名称/参数），RunBoard/事件列表消费。
        this.pendingToolCalls.set(event.toolCallId, { name: event.toolName, args: event.args });
        this.emit('tool_started', { toolCall: this.toAppToolCall(event.toolCallId, event.toolName, event.args) });
        break;
      }
      case 'tool_execution_update':
        // R1 评估：pi 的 partialResult 是 AgentToolResult（content/details）。现有事件模型没有
        // 工具执行中间态事件（AgentEventKind 无 tool_update），且工具适配层不传 onUpdate
        // （见 piToolAdapter.createPiToolAdapter 的 execute 签名）——实际不会产生本事件；
        // 中间态不落入聊天流，最终结果由 tool_execution_end + tool 消息呈现，忽略并标注。
        break;
      case 'tool_execution_end': {
        // R1：工具执行结束 → 现有 tool_finished 事件（toolCall + result），RunBoard 工具列表、
        // 子 agent changedPaths 与 v3 持久化消费。usage.toolCalls 累计真实化（P4 L-2）。
        this.usage.toolCalls += 1;
        const pending = this.pendingToolCalls.get(event.toolCallId);
        this.pendingToolCalls.delete(event.toolCallId);
        this.emit('tool_finished', {
          toolCall: this.toAppToolCall(event.toolCallId, event.toolName, pending?.args ?? {}),
          result: this.toAppToolResult(event.isError, event.result),
        });
        // report_progress 工具结果同时映射为现有 progress_reported 事件（RunBoard 进度显示与
        // v3 事件消费依赖它；pi 桥接在此补上旧引擎直接发出的 progress_reported）。
        if (event.toolName === 'report_progress' && !event.isError) {
          const content = Array.isArray(event.result?.content) ? event.result.content as Array<{ type: string; text?: string }> : [];
          const text = content.filter(isTextPart).map((part) => part.text).join('');
          if (text) this.emit('progress_reported', { message: text });
        }
        // R6：终态工具（complete_task / ask_parent / ask_user）的 stopRun 标记经
        // piToolAdapter 透传到 tool 结果 details。pi 是自治循环，工具不会自己停 loop，
        // 这里按旧引擎 stopRun 语义记录 pendingStopRun 并补发最终 assistant 消息：
        // - complete_task → 用 finalSummary 发一条 assistant 收尾消息（旧引擎 finish() 语义）；
        // - ask_parent / ask_user → 用问题文本发一条 assistant 消息（子 agent 阻塞展示）。
        // run 终态结算在 agent_end（turn_end 之前 shouldStopAfterTurn 触发 loop 结束）。
        if (!event.isError && event.result?.details) {
          const terminalDetails = event.result.details as { stopRun?: string; finalSummary?: string };
          if (terminalDetails.stopRun === 'completed') {
            const summary = terminalDetails.finalSummary ?? this.toAppToolResult(false, event.result).content;
            this.run.finalSummary = summary;
            this.emit('message', { message: { role: 'assistant', content: summary }, streamId: `${this.runId}:final-${this.sequence}` });
            this.pendingStopRun = 'completed';
          } else if (terminalDetails.stopRun === 'awaiting_parent' || terminalDetails.stopRun === 'awaiting_user') {
            const question = this.toAppToolResult(false, event.result).content;
            if (question) this.emit('message', { message: { role: 'assistant', content: question }, streamId: `${this.runId}:final-${this.sequence}` });
            this.pendingStopRun = terminalDetails.stopRun;
          }
        }
        break;
      }
      case 'turn_end':
        // R6：每个 turn 结束（含工具执行后）记录 checkpoint——对齐旧引擎 reflectTask
        // 在 executeTools 后保存断点的语义。摘要取 run 的最终摘要或任务证据。
        {
          const summary = this.run.summary || this.run.finalSummary || this.run.task.evidence.join('\n') || 'Run checkpoint recorded.';
          this.emit('checkpoint', { summary });
        }
        break;
      case 'agent_end': {
        if (this.run.phase === 'cancelled' || this.run.phase === 'failed') break;
        // R6：阻塞态子 agent（ask_parent / ask_user）不以 completed 结算——loop 因
        // shouldStopAfterTurn 停止，run 保持 awaiting_* 供父协调 message() 恢复。
        if (this.pendingStopRun === 'awaiting_parent' || this.pendingStopRun === 'awaiting_user') {
          const phase = this.pendingStopRun;
          this.pendingStopRun = undefined;
          this.setPhase(phase);
          this.emit('phase_changed', { phase, detail: 'Waiting for a root Agent response.' });
          break;
        }
        const lastAssistant = event.messages.filter((message): message is Extract<PiAgentMessage, { role: 'assistant' }> => message.role === 'assistant').at(-1);
        const summary = this.run.finalSummary || (lastAssistant ? piAssistantText(lastAssistant) : '') || 'Done.';
        this.pendingStopRun = undefined;
        this.setPhase('completed');
        this.emit('phase_changed', { phase: 'completed' });
        this.emit('run_finished', { summary });
        break;
      }
    }
  }

  private setPhase(phase: AgentPhase): void {
    this.run.phase = phase;
    this.run.updatedAt = Date.now();
    // P4 L-2 修复：usage 统计随 run 状态同步（子 agent notification 读 run.modelTurns/toolCalls）
    this.run.modelTurns = this.usage.modelTurns;
    this.run.toolCalls = this.usage.toolCalls;
    this.onRunChange({ ...this.run, task: { ...this.run.task, plan: [...this.run.task.plan], evidence: [...this.run.task.evidence] } });
  }

  /** R1：pi 工具执行事件 → 现有 ToolCall 结构（arguments 转 JSON 字符串）。 */
  private toAppToolCall(toolCallId: string, name: string, args: unknown): ToolCall {
    return { id: toolCallId, type: 'function', function: { name, arguments: toolCallArgumentsString(args) } };
  }

  /** R1：pi 工具执行结果 → 现有 AgentToolResult（文本摘要 + 结构化 data）。 */
  private toAppToolResult(isError: boolean, result: { content: (TextContent | ImageContent)[]; details?: unknown } | undefined): AgentToolResult {
    const content = Array.isArray(result?.content) ? result.content.filter(isTextPart).map((part) => part.text).join('') : '';
    return {
      ok: !isError,
      content,
      ...(result?.details !== undefined ? { data: result.details } : {}),
    };
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

  /** P5：压缩开始/结束的 transient 状态事件（驱动现有 UI 的压缩指示；v3 store 会跳过 transient）。 */
  emitCompactionStatus(active: boolean): void {
    this.emit('context_compaction_status', { active, transient: true });
  }

  /**
   * P5：用户中途引导（steer）即时投递到 UI——对齐旧引擎 enqueueUserGuidance 的
   * emitProjectedMessage 语义（旧引擎在入队时就把 user 消息投影到聊天流）。记录消息引用，
   * 使 agent 在下一轮注入同一 steer 消息时按引用去重（见 message_start 分支）。
   */
  emitUserGuidance(message: PiAgentMessage): void {
    if (message.role !== 'user') return;
    this.steeredMessages.add(message);
    this.streamIndex += 1;
    this.emit('message', { message: piMessageToAppMessage(message), streamId: `${this.runId}:user-${this.streamIndex}` });
  }

  /**
   * P5：压缩完成事件（非 transient，进 v3 事件流）——对齐旧引擎 context_compacted 契约，
   * RunBoard 据此渲染「上下文已自动压缩 · before → after tokens」。
   */
  emitCompacted(stats: { summary: string; beforeTokens: number; afterTokens: number }): void {
    this.emit('context_compacted', { summary: stats.summary, fallback: false, beforeTokens: stats.beforeTokens, afterTokens: stats.afterTokens });
  }
}

/**
 * R6：识别「配置的模型不支持 vision」的供应商错误（对齐旧引擎 modelClient 的探测语义）。
 * 415 或错误文本命中 vision/multimodal/image 关键字即视为视觉不支持。
 */
function isUnsupportedVisionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: number; errorMessage?: string; message?: string };
  if (candidate.status === 415) return true;
  const text = `${candidate.errorMessage ?? ''} ${candidate.message ?? ''}`;
  return /(?:\bvision\b|\bmultimodal\b|image[_ -]?url|image (?:input|content|part)|content[_ -]?part)/i.test(text);
}

/**
 * R6：去掉 user 消息中的图片内容块，替换为 `[image resource: <id>]` 文本标记
 * （对齐旧引擎视觉降级的 `[image resource: ${resourceId}]` 契约）。resourceId 在
 * buildUserMessage 构造图片块时透传（ImageContent 扩展字段），供降级后按资源引用。
 */
function sanitizeImagesToText(context: import('@earendil-works/pi-ai').Context): import('@earendil-works/pi-ai').Context {
  const messages = context.messages.map((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return message;
    const images = message.content.filter((part): part is ImageContent & { resourceId?: string } => part.type === 'image');
    if (images.length === 0) return message;
    const text = message.content.filter((part): part is TextContent => part.type === 'text').map((part) => part.text).join('\n');
    const markers = images.map((image) => `[image resource: ${image.resourceId ?? 'unknown'}]`);
    return { ...message, content: text ? `${text}\n${markers.join('\n')}` : markers.join('\n') };
  });
  return { ...context, messages };
}

/**
 * R6：视觉降级流封装——首次带图请求被模型拒绝（415/vision 错误）时，去掉图片
 * 并以 `[image resource: <id>]` 文本标记重试（旧引擎「探测回退」语义）。pi 是自治
 * 循环，模型请求由 streamFn 发起，这里在流层拦截错误并透明重试，bridge 无需感知。
 *
 * 返回对象对齐 AssistantMessageEventStream 的消费面（[Symbol.asyncIterator] +
 * result()），pi Agent 的 streamAssistantResponse 迭代事件流并在 done/error 后
 * 调 response.result() 取最终消息。
 */
function streamWithVisionFallback(models: Models, model: Model<Api>, context: import('@earendil-works/pi-ai').Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
  let finalMessage: import('@earendil-works/pi-ai').AssistantMessage | undefined;
  const iterator = (async function* (): AsyncGenerator<import('@earendil-works/pi-ai').AssistantMessageEvent> {
    let visionUnsupported = false;
    try {
      for await (const event of models.streamSimple(model, context, options)) {
        if (event.type === 'done') finalMessage = event.message;
        else if (event.type === 'error') {
          if (isUnsupportedVisionError(event.error)) {
            visionUnsupported = true;
            finalMessage = event.error;
            break;
          }
          finalMessage = event.error;
        }
        yield event;
      }
    } catch (error) {
      if (!isUnsupportedVisionError(error)) throw error;
      visionUnsupported = true;
    }
    if (visionUnsupported) {
      const sanitized = sanitizeImagesToText(context);
      for await (const event of models.streamSimple(model, sanitized, options)) {
        if (event.type === 'done') finalMessage = event.message;
        else if (event.type === 'error') finalMessage = event.error;
        yield event;
      }
    }
  })();
  return {
    [Symbol.asyncIterator]: () => iterator[Symbol.asyncIterator](),
    result: async () => finalMessage,
  } as unknown as AssistantMessageEventStream;
}

function defaultCreateAgent({ models, model, systemPrompt, tools, prepareNextTurn }: {
  models: Models;
  model: Model<Api>;
  systemPrompt: string;
  tools: PiAgentTool[];
  prepareNextTurn?: () => Promise<PiAgentMessage[] | undefined>;
}): PiAgentLike {
  const agent = new Agent({
    streamFn: (m, context, options) => streamWithVisionFallback(models, m, context, options),
    // P5：改用 pi 的 convertToLlm——user/assistant/toolResult 透传，compactionSummary/branchSummary
    // 等特殊角色转换为 user 消息（compactionSummary → <summary> 包裹的 user 内容），
    // 否则压缩后的摘要消息会以未知 role 直发 LLM 被供应商拒绝。
    convertToLlm,
    initialState: { model, systemPrompt, thinkingLevel: 'off', tools },
    // 并行执行：只读类工具可并发，变更/进程类工具通过 executionMode: 'sequential' 强制串行。
    toolExecution: 'parallel',
    // R6：对齐旧引擎 stopRun 语义——complete_task / ask_parent / ask_user 的工具结果
    // 在 details.stopRun 透传终态标记（piToolAdapter），turn 结束后据此停 loop：
    // pi 是自治循环，模型不会自己识别完成，必须在此显式终止（旧引擎 executeTools 后结算）。
    // 不设 terminate（`.every()` 语义要求批次全部终止，混合批 update_plan+complete_task 不满足），
    // 改用 shouldStopAfterTurn 在 turn 粒度按「任一终态工具」停止。
    shouldStopAfterTurn: ({ toolResults }) => toolResults.some((result) => {
      const stopRun = (result.details as { stopRun?: string } | undefined)?.stopRun;
      return stopRun === 'completed' || stopRun === 'awaiting_parent' || stopRun === 'awaiting_user';
    }),
    // P5：压缩在 turn 之间发生——prepareNextTurnWithContext 在 steering 注入前运行，
    // 返回压缩后的上下文（摘要 + 保留尾）替换下一轮的 currentContext。
    ...(prepareNextTurn ? {
      prepareNextTurnWithContext: async (nextTurnContext) => {
        const compacted = await prepareNextTurn();
        if (!compacted) return undefined;
        return {
          context: {
            systemPrompt: nextTurnContext.context.systemPrompt,
            messages: compacted,
            ...(nextTurnContext.context.tools ? { tools: nextTurnContext.context.tools } : {}),
          },
        };
      },
    } : {}),
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
    steer: (message) => {
      agent.steer(message);
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
  private readonly sessionPromise: Promise<Session | null>;
  private readonly coordinator: SubagentHost | undefined;
  private readonly mutationLease = new ContainerMutationLease();
  /** R1：附件 → v3 资源仓库持久化（复用现有资源系统，只包不改）。 */
  private readonly resourceProcessor = new ResourceProcessorRegistry();
  /** R1：当前 prompt 的附件元数据（bridge 渲染 UI chips 用；每次 prompt 前更新）。 */
  private pendingUserAttachments: ChatAttachment[] | undefined;
  /** P5：pi compaction 依赖的 models/model（默认摘要生成器需要，浏览器端纯 JS）。 */
  private readonly models: Models;
  private readonly model: Model<Api>;
  /** P5：压缩设置 / 阈值上下文窗口 / 摘要执行器（缺省对齐现有引擎 90% 语义）。 */
  private readonly compactionSettings: CompactionSettings;
  private readonly compactionContextWindow: number;
  private readonly compactRunner: PiCompactionRunner;
  private session: Session | null = null;
  private pendingPersist: Promise<void> = Promise.resolve();
  private disposed = false;
  /** P5：最近一次压缩的前后 token 统计（R2 压缩真实性断言用）。 */
  private lastCompaction: { beforeTokens: number; afterTokens: number; summary: string; at: number } | undefined;

  constructor(options: PiSessionOptions) {
    this.options = options;
    // P1-L4：provider 由现有 modelClient 配置派生（baseUrl host → provider id），不硬编码供应商。
    // R4：渠道供应商类型决定请求 API（openai-completions / anthropic-messages）。
    const providerId = deriveProviderId(options.baseUrl);
    const model = buildConfigModel(options.apiModel, options.baseUrl, providerId, options.providerApi, options.samplingParams);
    this.model = model;
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    this.models = models;
    models.setProvider(createProvider({
      id: providerId,
      name: options.baseUrl,
      baseUrl: model.baseUrl,
      auth: { apiKey: envApiKeyAuth(options.baseUrl, []) },
      models: [model],
      // 多 API 分发：model.api 选择对应实现（anthropic 渠道不暴露 /chat/completions）。
      api: {
        'openai-completions': openAICompletionsApi(),
        'anthropic-messages': anthropicMessagesApi(),
      },
    }));
    // P5：派生压缩配置（阈值/保留量对齐现有引擎），测试可覆盖。
    const compactionConfig = buildPiCompactionConfig(options.apiModel);
    this.compactionSettings = options.compactionSettings ?? compactionConfig.settings;
    this.compactionContextWindow = options.compactionContextWindow ?? compactionConfig.contextWindow;
    this.compactRunner = options.compactionRunner
      ?? createDefaultCompactionRunner(this.models, this.model, PI_COMPACTION_CUSTOM_INSTRUCTIONS, options.signal);
    const credentialsReady = credentials.modify(providerId, async () => ({ type: 'api_key', key: options.apiKey }));
    const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    // P3：按 capability 启用集装配 pi 工具（R3），控制类工具所需的编排上下文从本会话注入（R1）。
    const tools = createPiAgentTools({
      tools: options.tools ?? resolveEnabledPiTools(options.enabledTools),
      getContext: options.getToolContext ?? (() => this.buildToolContext()),
      // R1：read_resource_image 的 modelContent（image_resource 持久引用）转成 pi image 内容块。
      loadImageData: options.loadImageData ?? ((resourceId) => this.loadResourceImageData(resourceId)),
    });
    const createAgent = options.createAgent ?? defaultCreateAgent;
    this.agent = createAgent({
      models,
      model,
      systemPrompt,
      tools,
      // P5：turn 之间压缩——steering 注入前先检查阈值（compactForNextTurn 引用 this.bridge/this.session，
      // 回调在 agent loop 中才执行，彼时构造已完成）。
      prepareNextTurn: () => this.compactForNextTurn(),
    });
    const createSessionRepo = options.createSessionRepo ?? (() => new IndexedDbSessionRepo());
    // 会话 ID 与现有 UI 会话 ID 对齐：按 sessionId 打开或创建持久化 pi 会话。
    // P4：子 agent 场景（persistSession: false）跳过会话仓库，避免子 run 串扰根会话历史。
    this.sessionPromise = options.persistSession === false
      ? Promise.resolve(null)
      : createSessionRepo().openOrCreate(options.sessionId);
    // P4（R2）：把根 run 的 pi 子 agent 编排器注入工具上下文（spawn_subagent 等走真实现）。
    // 子 agent 会话（options.subagents 已注入哨兵）不重复构造编排器。
    this.coordinator = options.subagents
      ? undefined
      : options.createCoordinator
        ? options.createCoordinator(this.buildCoordinatorOptions())
        : new PiSubagentCoordinator(this.buildCoordinatorOptions());
    // P2-M1：桥接事件同步写入 v3 event store（store.append/saveRun 走 pendingPersist 队列串行），
    // 使刷新后 UI 聊天列表能从 v3 恢复 pi 消息；写入尽力而为，失败不阻断事件桥接。
    const onEvent = (event: AgentEvent): void => {
      options.onEvent(event);
      this.trackPersist(this.persistV3Event(event));
    };
    const onRunChange = (run: AgentRun): void => {
      options.onRunChange(run);
      this.trackPersist(this.persistV3Run(run));
    };
    this.bridge = new PiEventBridge({
      runId: options.runId,
      sessionId: options.sessionId,
      run: options.run,
      onEvent,
      onRunChange,
      getUserAttachments: () => this.pendingUserAttachments,
      isAborted: () => this.abortSignal?.aborted ?? false,
    });
    this.unsubscribe = this.agent.subscribe((event, _signal) => {
      // P1 事件桥接逻辑不动；P2 仅在桥接之后追加会话持久化（尽力而为）。
      this.bridge.handlePiEvent(event);
      this.trackPersist(this.persistEvent(event));
      // R6：turn 结束（工具执行完成后）保存 checkpoint 到 v3 checkpoints store——
      // 对齐旧引擎 reflectTask 语义（executeTools 后落盘断点）。checkpoint 只覆盖根 run；
      // 子 agent（persistSession: false）不占独立 pi 会话，也不写独立 checkpoint。
      if (event.type === 'turn_end' && this.options.persistSession !== false) {
        this.trackPersist(this.persistCheckpoint());
      }
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
    // P4：子 agent（persistSession: false）没有会话仓库，session 为 null，不 seed 历史。
    if (!session) return;
    const history = await this.loadHistory(session);
    if (history.length > 0) this.agent.seedHistory?.(history);
  }

  /** P4（R2）：构建根 run 的子 agent 编排器依赖（createSession 注入避免静态循环依赖）。 */
  private buildCoordinatorOptions(): PiSubagentCoordinatorOptions {
    return {
      sessionId: this.options.sessionId,
      root: this.options.run,
      apiKey: this.options.apiKey,
      baseUrl: this.options.baseUrl,
      apiModel: this.options.apiModel,
      ...(this.options.systemPrompt !== undefined ? { systemPrompt: this.options.systemPrompt } : {}),
      runtime: this.options.runtime ?? UNWIRED_PI_RUNTIME,
      ...(this.options.store ? { store: this.options.store } : {}),
      ...(this.options.enabledTools ? { enabledTools: this.options.enabledTools } : {}),
      ...(this.options.containerAvailable !== undefined ? { containerAvailable: this.options.containerAvailable } : {}),
      // 直接用 this.options.signal：buildCoordinatorOptions 在构造早期调用，this.abortSignal 尚未赋值。
      signal: this.options.signal ?? new AbortController().signal,
      onEvent: this.options.onEvent,
      onRunChange: this.options.onRunChange,
      ...(this.options.createAgent ? { createAgent: this.options.createAgent } : {}),
      ...(this.options.onChildrenPruned ? { onChildrenPruned: this.options.onChildrenPruned } : {}),
      createSession: (childOptions) => new PiSession(childOptions),
    };
  }

  /**
   * P3：构建现有工具执行上下文（控制类工具依赖的编排上下文：runId/sessionId/runtime/task）。
   * 每次执行时重建，保证 getTask/updateTask 看到最新任务状态。
   *
   * P4（R2）：`subagents` 注入真实 pi 子 agent 编排器（PiSubagentCoordinator），
   * spawn_subagent/wait_subagents/message_subagent 走真实现；子 agent 会话注入的
   * 仍是如实拒绝的哨兵（子 agent 不能继续委派）。
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
      subagents: this.options.subagents ?? this.coordinator ?? PI_CHILD_NO_DELEGATION,
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

  /**
   * 发送一条用户消息并等待该次运行结束（含 agent_end 事件监听器 settle）。
   * R1：带附件时把附件构造为 pi 多模态 user 消息（图片内嵌 + 资源清单），
   * 使模型直接看到图片（pi 消息类型支持 image block），同时资源工具仍可按需读取。
   */
  async prompt(text: string, attachments?: ChatAttachment[]): Promise<void> {
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
    // P5：发送前先检查上下文是否达到压缩阈值；达到则先压缩（摘要 + 保留尾）再继续。
    await this.compactBeforePrompt();
    // 压缩的 LLM 摘要可能耗时较长，期间外部信号可能已中止；再检查一次，避免启动注定被取消的运行。
    if (this.abortSignal?.aborted) {
      this.bridge.handlePiEvent({ type: 'agent_start' });
      this.bridge.handlePiEvent({ type: 'message_end', message: this.abortedMessage() });
      this.bridge.handlePiEvent({ type: 'agent_end', messages: [] });
      return;
    }
    // R1：附件先经现有资源系统持久化（v3 资源仓库，与旧引擎共用），再构造多模态 user 消息。
    const effectiveAttachments = attachments ?? this.options.attachments;
    const resources = effectiveAttachments?.length
      ? await this.resourceProcessor.process(effectiveAttachments, this.options.sessionId, this.options.runId)
      : [];
    this.pendingUserAttachments = resources.length
      ? resources.map((resource) => ({ name: resource.name, size: resource.size, type: resource.mimeType, resourceId: resource.id }))
      : undefined;
    const userMessage = await this.buildUserMessage(text, resources);
    await this.appendUserMessage(userMessage);
    await this.agent.prompt(userMessage);
    // 冲刷本次运行的会话写入，保证 prompt 返回时历史已完整持久化。
    await this.pendingPersist;
  }

  /**
   * R1：把用户正文 + 资源清单 + 图片内容块构造成 pi user 消息。
   * 图片以 data URL（base64）内嵌为 pi ImageContent；文本/二进制资源只列清单，
   * 模型可经资源工具（read_resource_text/read_resource_image/materialize_resource）按需读取。
   */
  private async buildUserMessage(text: string, resources: AgentResource[]): Promise<Extract<PiAgentMessage, { role: 'user' }>> {
    if (resources.length === 0) {
      return { role: 'user', content: text, timestamp: Date.now() };
    }
    const manifest = `\n\nAttached resources (use resource tools to inspect on demand):\n${resources.map((resource) => `- [${resource.kind}: ${resource.id}] ${resource.name} (${resource.mimeType}, ${resource.size} bytes)`).join('\n')}`;
    const parts: (TextContent | ImageContent)[] = [{ type: 'text', text: `${text}${manifest}` }];
    for (const resource of resources.filter((item) => item.kind === 'image')) {
      const image = await this.loadResourceImageData(resource.id);
      if (image) parts.push({ type: 'image', data: image.data, mimeType: image.mimeType, resourceId: resource.id } as ImageContent & { resourceId: string });
    }
    return { role: 'user', content: parts, timestamp: Date.now() };
  }

  /** R1：从 v3 资源仓库加载图片资源的 modelBlob（无则原始 blob），编码为 base64 data。 */
  private async loadResourceImageData(resourceId: string): Promise<{ data: string; mimeType: string } | null> {
    try {
      const stored = await v3Persistence.loadResource(resourceId);
      if (!stored.value) return null;
      const blob = stored.value.modelBlob ?? stored.value.blob;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
      return { data: btoa(binary), mimeType: stored.value.mimeType };
    } catch {
      // 资源加载失败只降级为文本描述（资源清单已在正文中），不阻断对话。
      return null;
    }
  }

  /**
   * P5：压缩编排（对齐现有引擎 90% 压缩语义）。
   *
   * 从 pi 会话读取条目，估算上下文 token；超过阈值时用 pi 的
   * prepareCompaction + compact（摘要生成）产出「摘要 + 保留尾」，并把压缩 entry
   * 写回会话（持久化），再把 agent 转录重建为压缩上下文——后续 prompt 基于摘要继续（R2）。
   * 刷新后 loadHistory 走 buildSessionContext，只加载最新摘要 + 保留尾 + 后续消息（R4）。
   */
  private async compactBeforePrompt(): Promise<void> {
    if (!this.session || !this.compactionSettings.enabled) return;
    const entries = await this.session.findEntries({ order: 'oldestFirst' });
    if (!isCompactionNeeded(entries, this.compactionContextWindow, this.compactionSettings)) return;
    const compacted = await this.runCompaction(entries);
    if (compacted) this.agent.seedHistory?.(compacted);
  }

  /**
   * P5：turn 之间压缩（agent loop 的 prepareNextTurnWithContext 回调）。
   * pi 是自治循环，用户中途引导经 steer 排队到当前 turn 之后；本回调在 steering 注入前
   * 运行——先冲刷会话写入（使估算覆盖刚落定的超大 assistant 消息），达阈值则压缩并返回
   * 压缩后的上下文（摘要 + 保留尾），由 defaultCreateAgent 替换下一轮的 currentContext。
   */
  private async compactForNextTurn(): Promise<PiAgentMessage[] | undefined> {
    if (!this.session || !this.compactionSettings.enabled) return undefined;
    await this.pendingPersist;
    const entries = await this.session.findEntries({ order: 'oldestFirst' });
    if (!isCompactionNeeded(entries, this.compactionContextWindow, this.compactionSettings)) return undefined;
    const compacted = await this.runCompaction(entries);
    if (compacted) this.agent.seedHistory?.(compacted);
    return compacted;
  }

  /**
   * P5：压缩执行核心——发 transient 状态事件（驱动现有压缩指示）、跑摘要生成、写回
   * 会话 compaction entry、记录前后 token 统计、发非 transient context_compacted 事件
   * （RunBoard 渲染「上下文已自动压缩 · before → after tokens」）。
   * 失败（网络/中止）时跳过压缩并返回 undefined，不阻断对话（R3 差异如实标注）。
   */
  private async runCompaction(entries: import('@earendil-works/pi-agent-core').Entry[]): Promise<PiAgentMessage[] | undefined> {
    this.bridge.emitCompactionStatus(true);
    try {
      const preparationResult = prepareCompaction(entries, this.compactionSettings);
      if (!preparationResult.ok || !preparationResult.value) return undefined;
      const value = await this.compactRunner(preparationResult.value);
      const compactedMessages = buildCompactedAgentMessages(value);
      await this.session!.appendEntry({
        type: 'compaction',
        id: uuidv7(),
        summary: value.summary,
        retainedTail: value.retainedTail,
        tokensBefore: value.tokensBefore,
        ...(value.details !== undefined ? { details: value.details } : {}),
        ...(value.usage !== undefined ? { usage: value.usage } : {}),
      }, 'main');
      const afterTokens = estimateContextTokens(compactedMessages).tokens;
      this.lastCompaction = {
        beforeTokens: value.tokensBefore,
        afterTokens,
        summary: value.summary,
        at: Date.now(),
      };
      this.bridge.emitCompacted({ summary: value.summary, beforeTokens: value.tokensBefore, afterTokens });
      return compactedMessages;
    } catch {
      // 摘要生成失败（网络/中止）：跳过压缩继续对话，不阻断 prompt。
      // R3 差异如实标注：现有引擎有确定性兜底摘要，pi compact() 只走 LLM 摘要。
      return undefined;
    } finally {
      this.bridge.emitCompactionStatus(false);
    }
  }

  /** P5：最近一次压缩的前后 token 统计（R2 压缩真实性断言用；无压缩时为 undefined）。 */
  get lastCompactionStats(): Readonly<{ beforeTokens: number; afterTokens: number; summary: string; at: number }> | undefined {
    return this.lastCompaction;
  }

  /**
   * P5：加载刷新恢复所需的上下文（R4）。
   * 走 pi 的 buildSessionContext：有 compaction entry 时只返回「最新摘要消息 + 保留尾 +
   * 后续消息」，避免把全量历史重新灌入；无压缩时与旧行为一致（全部 message 条目）。
   */
  private async loadHistory(session: Session): Promise<PiAgentMessage[]> {
    const entries = await session.findEntries({ order: 'oldestFirst' });
    return buildSessionContext(entries).messages;
  }

  private async appendUserMessage(message: PiAgentMessage): Promise<void> {
    await this.session?.appendMessage(message);
  }

  private async persistEvent(event: PiAgentEvent): Promise<void> {
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
    if (!this.session) return;
    try {
      // P5：mock/供应商的 assistant 消息可能带 undefined 可选字段（responseId/rawStopReason 等），
      // pi Session.commitEntry 的 assertJsonSerializable 会拒收——持久化前剔除 undefined，使会话可累积。
      await this.session.appendMessage(stripUndefined(event.message) as PiAgentMessage);
    } catch {
      // 会话持久化失败不阻断事件桥接（尽力而为）；边界见 TASK-P2 R4。
    }
  }

  /** P2-M1：把桥接出的 AgentEvent 写入 v3 event store（store.append 自会跳过 transient 事件）。 */
  private async persistV3Event(event: AgentEvent): Promise<void> {
    if (!this.options.store) return;
    try {
      await this.options.store.append(event);
    } catch {
      // v3 持久化失败不阻断事件桥接（对齐现有引擎的尽力而为语义）。
    }
  }

  /** P2-M1：把 run 的最新状态写入 v3（run_started 之外阶段变更由 onRunChange 落库）。 */
  private async persistV3Run(run: AgentRun): Promise<void> {
    if (!this.options.store) return;
    try {
      await this.options.store.saveRun(run);
    } catch {
      // 同上。
    }
  }

  /**
   * R6：保存 checkpoint 到 v3 checkpoints store（复用 eventStore.saveCheckpoint）。
   *
   * 对齐旧引擎 checkpoint 语义（run 中断/关键节点可断点续跑）：
   * - `summary`：run 的最终摘要或任务证据，缺省 'Run checkpoint recorded.'；
   * - `messages`：pi 通道断点恢复以会话历史为权威（PiSession 刷新后自动 seed，
   *   resumeDriverRun 不再读 checkpoint tail），因此尾消息留空——断点能力真实存在
   *   （store 中有记录、runId/sessionId/containerId/sequence/revision 齐备），
   *   只是恢复上下文不经此 tail；
   * - `eventTailSequence` / `workspaceRevision`：尽力而为，读不到不阻断。
   */
  private async persistCheckpoint(): Promise<void> {
    if (!this.options.store) return;
    const run = this.options.run;
    let workspaceRevision: number | undefined;
    if (this.options.runtime) {
      try {
        workspaceRevision = await this.options.runtime.getWorkspaceRevision(run.containerId);
      } catch {
        workspaceRevision = undefined;
      }
    }
    const summary = run.summary || run.finalSummary || run.task.evidence.join('\n') || 'Run checkpoint recorded.';
    try {
      await this.options.store.saveCheckpoint({
        id: run.id,
        runId: run.id,
        sessionId: run.sessionId,
        containerId: run.containerId,
        summary,
        messages: [],
        createdAt: Date.now(),
        eventTailSequence: this.bridge.getSequence(),
        ...(workspaceRevision !== undefined ? { workspaceRevision } : {}),
      });
    } catch {
      // checkpoint 持久化失败不阻断事件桥接（对齐现有引擎尽力而为语义）。
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
      provider: deriveProviderId(this.options.baseUrl),
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

  /**
   * P4 子 agent 编排：把父协调消息注入运行中的 agent（pi Agent.steer 队列，
   * 当前 assistant turn 后生效）。运行未启动/已结束或已销毁时返回 false。
   */
  steer(message: string): boolean {
    if (this.disposed || this.abortSignal?.aborted) return false;
    const steered: PiAgentMessage = { role: 'user', content: message, timestamp: Date.now() };
    // P5：对齐旧引擎 queuedUserGuidance——入队时即时把 user 消息投影到聊天流（UI 立即显示），
    // agent 注入同一引用时 bridge 按引用去重，不双显。
    this.bridge.emitUserGuidance(steered);
    this.agent.steer?.(steered);
    return true;
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
