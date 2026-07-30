import type { Message } from '@/entities/message/types';
import { callLLM, type LLMConfig, type LLMRequestContentPart, type LLMRequestMessage, type LLMToolDefinition } from '@/shared/api/llm';
import { LLMError } from '@/shared/api/llmError';
import { v3Persistence, type V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import type { AgentModelResponse, AgentToolCall, ModelTokenUsage } from './types';
import { canonicalContentParts, messageText } from '@/shared/contracts/message';
import { estimateTextTokens } from '@/shared/lib/tokenEstimate';

export { estimateTextTokens } from '@/shared/lib/tokenEstimate';

export interface ModelContextProfile { contextWindowTokens: number; defaultOutputTokens: number; summaryReserveTokens: number; safetyBufferTokens: number; }
export interface AgentModelCapabilities { vision: boolean | 'unknown'; files: boolean; toolCalls: boolean; }

export function profileForModel(model: string): ModelContextProfile {
  const normalized = model.toLowerCase().trim().split('/').at(-1) ?? '';
  if (/^(?:gpt-4\.1(?:-|$)|gpt-5(?:[.-]\d+)*(?:-|$))/.test(normalized)) return { contextWindowTokens: 1_000_000, defaultOutputTokens: 32_768, summaryReserveTokens: 16_384, safetyBufferTokens: 16_384 };
  if (/^(?:claude-(?:3|4)|o1(?:-|$)|o3(?:-|$)|o4(?:-|$))/.test(normalized)) return { contextWindowTokens: 200_000, defaultOutputTokens: 16_384, summaryReserveTokens: 12_000, safetyBufferTokens: 8_000 };
  if (/^(?:gpt-4o(?:-|$)|deepseek-|qwen(?:\d|2|3|-)|gemini-)/.test(normalized)) return { contextWindowTokens: 128_000, defaultOutputTokens: 8_192, summaryReserveTokens: 8_192, safetyBufferTokens: 4_096 };
  return { contextWindowTokens: 32_768, defaultOutputTokens: 4_096, summaryReserveTokens: 4_096, safetyBufferTokens: 2_048 };
}

export interface AgentModelClient {
  readonly capabilities?: AgentModelCapabilities;
  getContextProfile?(): ModelContextProfile;
  estimateTokens?(value: string): number;
  complete(messages: Message[], options: {
    signal: AbortSignal;
    tools: LLMToolDefinition[];
    onDelta: (message: Pick<Message, 'content' | 'reasoning_content' | 'tool_calls'>) => void;
  }): Promise<AgentModelResponse>;
}

function isUnsupportedVisionError(error: unknown): boolean {
  if (!(error instanceof LLMError) || error.code !== 'http_error') return false;
  if (error.status === 415) return true;
  if (error.status !== 400 && error.status !== 422) return false;
  return /(?:\bvision\b|\bmultimodal\b|image[_ -]?url|image (?:input|content|part)|content[_ -]?part)/i.test(error.message);
}

export class OpenAIChatModelClient implements AgentModelClient {
  private static readonly visionSupport = new Map<string, boolean>();
  private readonly config: Pick<LLMConfig, 'apiKey' | 'baseUrl' | 'model'>;
  private readonly sessionId: string;
  private readonly repository: V3PersistenceRepository;

  constructor(config: Pick<LLMConfig, 'apiKey' | 'baseUrl' | 'model'>, sessionId: string, repository: V3PersistenceRepository = v3Persistence) {
    this.config = config;
    this.sessionId = sessionId;
    this.repository = repository;
    const cached = OpenAIChatModelClient.visionSupport.get(this.capabilityKey());
    if (cached !== undefined) this.capabilities.vision = cached;
  }

  readonly capabilities: AgentModelCapabilities = { vision: 'unknown', files: false, toolCalls: true };
  getContextProfile(): ModelContextProfile { return profileForModel(this.config.model ?? 'unknown'); }
  estimateTokens(value: string): number { return estimateTextTokens(value); }

  private capabilityKey(): string { return `${this.config.baseUrl}:${this.config.model ?? 'unknown'}`; }

  private async blobDataUrl(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  }

  private async mapContent(messages: Message[], includeVision: boolean): Promise<LLMRequestMessage[]> {
    return Promise.all(messages.map(async (message) => {
      const parts = canonicalContentParts(message);
      const text = messageText(message);
      const imageParts = parts.filter((part) => part.type === 'image_resource');
      const fileParts = parts.filter((part) => part.type === 'file_resource');
      if (!imageParts.length) {
        const fileMarkers = fileParts.map((part) => `[file resource: ${part.resourceId}]`).join('\n');
        return { ...message, content: fileMarkers ? `${text}\n${fileMarkers}` : text };
      }
      if (!includeVision) {
        return { ...message, content: `${text}\n${imageParts.map((part) => `[image resource: ${part.resourceId}]`).join('\n')}` };
      }
      const wireParts: LLMRequestContentPart[] = [{ type: 'text', text }];
      for (const part of imageParts) {
        const stored = await this.repository.loadResource(part.resourceId);
        if (!stored.value || stored.value.sessionId !== this.sessionId) { wireParts.push({ type: 'text', text: `[missing image resource: ${part.resourceId}]` }); continue; }
        const blob = stored.value.modelBlob ?? stored.value.blob;
        wireParts.push({ type: 'image_url', image_url: { url: await this.blobDataUrl(blob) } });
      }
      return { ...message, content: wireParts };
    }));
  }

  async complete(messages: Message[], options: { signal: AbortSignal; tools: LLMToolDefinition[]; onDelta: (message: Pick<Message, 'content' | 'reasoning_content' | 'tool_calls'>) => void }): Promise<AgentModelResponse> {
    const hasVision = messages.some((message) => canonicalContentParts(message).some((part) => part.type === 'image_resource'));
    const invoke = async (includeVision: boolean) => callLLM(await this.mapContent(messages, includeVision), {
        ...this.config,
        signal: options.signal,
        tools: options.tools,
        onUpdate: (partial) => options.onDelta({
          content: partial.content,
          ...(partial.reasoning_content ? { reasoning_content: partial.reasoning_content } : {}),
          ...(partial.tool_calls ? { tool_calls: partial.tool_calls } : {}),
        }),
      });
    let response: Awaited<ReturnType<typeof callLLM>>;
    try {
      response = await invoke(hasVision && this.capabilities.vision !== false);
      if (hasVision && this.capabilities.vision === 'unknown') {
        this.capabilities.vision = true;
        OpenAIChatModelClient.visionSupport.set(this.capabilityKey(), true);
      }
    } catch (error) {
      const unsupportedVision = hasVision && this.capabilities.vision !== false && isUnsupportedVisionError(error);
      if (!unsupportedVision) throw error;
      this.capabilities.vision = false;
      OpenAIChatModelClient.visionSupport.set(this.capabilityKey(), false);
      response = await invoke(false);
    }
    const toolCalls: AgentToolCall[] = (response.tool_calls ?? []).map((toolCall) => ({ id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments }));
    const usage: ModelTokenUsage = response.usage
      ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens, estimated: false }
      : (() => {
          const inputTokens = messages.reduce((total, message) => total + this.estimateTokens(messageText(message)), 0);
          const outputTokens = this.estimateTokens(`${response.content}\n${response.reasoning_content ?? ''}\n${toolCalls.map((call) => call.arguments).join('\n')}`);
          return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimated: true };
        })();
    const { usage: _usage, ...message } = response;
    return { message, toolCalls, usage };
  }
}
