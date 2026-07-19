import type { Message } from '@/entities/message/types';
import type { AgentModelClient } from './modelClient';

const MAX_CONTEXT_CHARS = 90_000;
const MAX_RECENT_MESSAGES = 28;

function clip(value: string, size: number): string {
  return value.length > size ? `${value.slice(0, size)}\n[truncated]` : value;
}

function deterministicSummary(messages: Message[]): string {
  return messages.slice(-MAX_RECENT_MESSAGES).map((message) => {
    const role = message.role.toUpperCase();
    const body = clip(message.content || message.tool_calls?.map((call) => `${call.function.name}(${call.function.arguments})`).join(', ') || '', 900);
    return `${role}: ${body}`;
  }).join('\n');
}

export class ContextComposer {
  private failures = 0;
  private summary = '';

  getSummary(): string {
    return this.summary;
  }

  async compactIfNeeded(messages: Message[], client: AgentModelClient, signal: AbortSignal): Promise<{ messages: Message[]; compacted: boolean; fallback: boolean; summary: string }> {
    const size = messages.reduce((total, message) => total + message.content.length + (message.tool_calls?.reduce((toolTotal, call) => toolTotal + call.function.arguments.length, 0) ?? 0), 0);
    if (size < MAX_CONTEXT_CHARS) return { messages, compacted: false, fallback: false, summary: this.summary };
    const preserved = messages.slice(-MAX_RECENT_MESSAGES);
    const oldMessages = messages.slice(0, -MAX_RECENT_MESSAGES);
    if (this.failures >= 3) {
      this.summary = deterministicSummary(oldMessages);
      return { messages: [{ role: 'system', content: `Compressed working record:\n${this.summary}` }, ...preserved], compacted: true, fallback: true, summary: this.summary };
    }
    try {
      const response = await client.complete([
        { role: 'system', content: 'Summarize the prior coding work into a compact factual continuation record. Preserve goals, constraints, changed files, commands, results, active processes, decisions, and unresolved risks. Do not include chain-of-thought.' },
        { role: 'user', content: deterministicSummary(oldMessages) },
      ], { signal, tools: [], onDelta: () => undefined });
      this.summary = clip(response.message.content, 12_000) || deterministicSummary(oldMessages);
      this.failures = 0;
      return { messages: [{ role: 'system', content: `Compressed working record:\n${this.summary}` }, ...preserved], compacted: true, fallback: false, summary: this.summary };
    } catch {
      this.failures += 1;
      this.summary = deterministicSummary(oldMessages);
      return { messages: [{ role: 'system', content: `Compressed working record:\n${this.summary}` }, ...preserved], compacted: true, fallback: true, summary: this.summary };
    }
  }
}
