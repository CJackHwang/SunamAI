import { z } from 'zod';
import type { Message } from '@/shared/contracts/message';
import { LLMError } from './llmError';

const MAX_SSE_BUFFER_BYTES = 1024 * 1024;
const FRAME_INTERVAL_MS = 1000 / 30;

type StreamingDelta = {
  content?: string | undefined;
  reasoning_content?: string | undefined;
  tool_calls?: Array<{ id?: string | undefined; index: number; type?: 'function' | undefined; function?: { name?: string | undefined; arguments?: string | undefined } | undefined }> | undefined;
};

const deltaSchema = z.object({
  content: z.string().optional(),
  reasoning_content: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string().optional(),
    index: z.number().int().nonnegative(),
    type: z.literal('function').optional(),
    function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
  })).optional(),
});
const eventSchema = z.object({ choices: z.array(z.object({ delta: deltaSchema.optional() })).optional(), error: z.unknown().optional() });

function applyDelta(message: Message, delta: StreamingDelta): void {
  if (delta.content) message.content += delta.content;
  if (delta.reasoning_content) message.reasoning_content = `${message.reasoning_content ?? ''}${delta.reasoning_content}`;
  if (!delta.tool_calls) return;
  message.tool_calls ??= [];
  for (const toolCall of delta.tool_calls) {
    const index = toolCall.index;
    if (toolCall.id) {
      message.tool_calls[index] = { id: toolCall.id, type: toolCall.type ?? 'function', function: { name: toolCall.function?.name ?? '', arguments: toolCall.function?.arguments ?? '' } };
    } else if (message.tool_calls[index]) {
      const current = message.tool_calls[index];
      if (toolCall.function?.name) current.function.name = toolCall.function.name;
      if (toolCall.function?.arguments !== undefined) current.function.arguments += toolCall.function.arguments;
    }
  }
}

function cloneStreamingMessage(message: Message): Message {
  return { ...message, ...(message.tool_calls ? { tool_calls: message.tool_calls.map((tool) => ({ ...tool, function: { ...tool.function } })) } : {}), _ui_streaming: true };
}

export async function consumeChatStream(stream: ReadableStream<Uint8Array>, onUpdate: (message: Message) => void): Promise<Message> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const byteCounter = new TextEncoder();
  const message: Message = { role: 'assistant', content: '', reasoning_content: '' };
  let buffer = '';
  let dirty = false;
  let lastFlush = 0;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (!dirty) return;
    dirty = false;
    lastFlush = performance.now();
    onUpdate(cloneStreamingMessage(message));
  };
  const scheduleFlush = () => {
    dirty = true;
    if (flushTimer) return;
    const delay = Math.max(0, FRAME_INTERVAL_MS - (performance.now() - lastFlush));
    flushTimer = setTimeout(() => { flushTimer = undefined; flush(); }, delay);
  };
  const consumeLine = (rawLine: string) => {
    const line = rawLine.replace(/\r$/, '');
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trimStart();
    if (!data || data === '[DONE]') return;
    let decoded: unknown;
    try { decoded = JSON.parse(data); } catch { return; }
    const parsed = eventSchema.safeParse(decoded);
    if (!parsed.success) return;
    if (parsed.data.error !== undefined) throw new LLMError('stream_error', 'The model provider returned an SSE error event.', { retryable: true });
    const delta = parsed.data.choices?.[0]?.delta;
    if (!delta) return;
    applyDelta(message, delta);
    scheduleFlush();
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        if (byteCounter.encode(buffer).byteLength > MAX_SSE_BUFFER_BYTES) throw new LLMError('stream_buffer_limit', 'The model stream exceeded the maximum event buffer.');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(consumeLine);
      }
      if (done) break;
    }
    if (buffer) consumeLine(buffer);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    flush();
    return message;
  } finally {
    if (flushTimer) clearTimeout(flushTimer);
    reader.releaseLock();
  }
}
