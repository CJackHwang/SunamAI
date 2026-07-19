import type { Message } from '@/entities/message/types';
import type { AgentEvent, AgentRun, TaskContract } from './types';

export function projectMessages(events: AgentEvent[]): Message[] {
  return events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message').map((event) => event.message);
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
