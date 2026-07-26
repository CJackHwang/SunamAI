import type { Message } from '@/shared/contracts/message';
import { z } from 'zod';
import { consumeChatStream } from './sse';
import { LLMError, sanitizeProviderError } from './llmError';

export type LLMRequestContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type LLMRequestMessage = Omit<Message, 'content'> & {
  content: string | LLMRequestContentPart[];
};

export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
  signal?: AbortSignal;
  onUpdate?: (partialMessage: Message) => void;
  tools?: LLMToolDefinition[];
}

interface LLMResponseUsage { prompt_tokens: number; completion_tokens: number; total_tokens: number; }
export type LLMResponseMessage = Message & { usage?: LLMResponseUsage };

export function buildChatRequest(messages: LLMRequestMessage[], config: LLMConfig) {
  return {
    model: config.model || 'deepseek-chat',
    messages: messages.map(({ _ui_streaming, _ui_displayContent, _ui_attachments, contentParts: _contentParts, resourceIds: _resourceIds, ...message }) => message),
    ...(config.tools?.length ? { tools: config.tools, tool_choice: 'auto' } : {}),
    stream: Boolean(config.onUpdate),
  };
}

export async function callLLM(messages: LLMRequestMessage[], config: LLMConfig): Promise<LLMResponseMessage> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(buildChatRequest(messages, config)),
      ...(config.signal ? { signal: config.signal } : {}),
    });
  } catch (error) {
    if (config.signal?.aborted) throw error;
    throw new LLMError('network_error', 'The model request could not reach the provider.', { retryable: true, cause: error });
  }

  if (!response.ok) {
    throw new LLMError('http_error', `LLM API Error (${response.status}): ${sanitizeProviderError(await response.text())}`, { status: response.status, retryable: response.status === 429 || response.status >= 500 });
  }
  if (!config.onUpdate) {
    const schema = z.object({ choices: z.array(z.object({ message: z.object({
      role: z.enum(['assistant', 'system', 'user', 'tool']),
      content: z.string().nullable().optional(),
      reasoning_content: z.string().optional(),
      tool_calls: z.array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }) })).optional(),
    }) })).min(1), usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() }).optional() });
    let payload: unknown;
    try { payload = await response.json(); }
    catch (error) { throw new LLMError('invalid_response', 'The model provider returned invalid JSON.', { cause: error }); }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new LLMError('invalid_response', 'The model provider returned an invalid response schema.');
    const { content, reasoning_content, tool_calls, ...message } = parsed.data.choices[0]!.message;
    return { ...message, content: content ?? '', ...(reasoning_content ? { reasoning_content } : {}), ...(tool_calls ? { tool_calls } : {}), ...(parsed.data.usage ? { usage: parsed.data.usage } : {}) };
  }
  if (!response.body) throw new Error('No readable stream available');
  return consumeChatStream(response.body, config.onUpdate);
}
