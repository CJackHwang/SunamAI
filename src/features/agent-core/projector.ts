import type { Message } from '@/entities/message/types';
import type { AgentEvent, AgentRun, TaskContract } from './types';

export function sanitizeToolTranscript(messages: Message[]): Message[] {
  const sanitized: Message[] = [];
  let index = 0;
  while (index < messages.length) {
    const message = messages[index]!;
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const requiredIds = new Set(message.tool_calls.map((call) => call.id));
      const toolMessages: Message[] = [];
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor]!.role === 'tool') {
        const toolMessage = messages[cursor]!;
        if (toolMessage.tool_call_id && requiredIds.has(toolMessage.tool_call_id)) toolMessages.push(toolMessage);
        cursor += 1;
      }
      const responseIds = new Set(toolMessages.map((toolMessage) => toolMessage.tool_call_id));
      if ([...requiredIds].every((id) => responseIds.has(id))) {
        sanitized.push(message, ...toolMessages);
      } else if (message.content.trim()) {
        sanitized.push({ ...message, tool_calls: undefined });
      }
      index = cursor;
      continue;
    }
    // A tool message without its immediately preceding assistant tool call is
    // invalid in OpenAI-compatible chat history and cannot be sent upstream.
    if (message.role !== 'tool') sanitized.push(message);
    index += 1;
  }
  return sanitized;
}

export function projectMessages(events: AgentEvent[]): Message[] {
  return sanitizeToolTranscript(events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message').map((event) => event.message));
}

export function projectLatestTask(events: AgentEvent[], run?: AgentRun): TaskContract | null {
  const planEvent = [...events].reverse().find((event) => event.kind === 'plan_updated');
  return planEvent?.task ?? run?.task ?? null;
}

export function projectRunEvents(events: AgentEvent[], runId: string | null): AgentEvent[] {
  return runId ? events.filter((event) => event.runId === runId) : [];
}

export function projectProgress(events: AgentEvent[], runId: string | null): string | null {
  return [...projectRunEvents(events, runId)].reverse().find((event) => event.kind === 'progress_reported')?.message ?? null;
}
