import type { AgentEvent, AgentRun } from './types';

const memoryEvents = new Map<string, AgentEvent[]>();
const memoryRuns = new Map<string, AgentRun>();

/** The development v2 keeps its run ledger only for the current page lifetime. */
export class AgentEventStore {
  async append(event: AgentEvent): Promise<void> {
    if (event.transient) return;
    const events = memoryEvents.get(event.sessionId) ?? [];
    if (!events.some((candidate) => candidate.id === event.id)) memoryEvents.set(event.sessionId, [...events, event]);
    if (event.kind === 'run_started') memoryRuns.set(event.run.id, event.run);
  }

  async saveRun(run: AgentRun): Promise<void> {
    memoryRuns.set(run.id, run);
  }

  async loadSessionEvents(sessionId: string): Promise<AgentEvent[]> {
    return [...(memoryEvents.get(sessionId) ?? [])].sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence);
  }

  async loadSessionRuns(sessionId: string): Promise<AgentRun[]> {
    return Array.from(memoryRuns.values()).filter((run) => run.sessionId === sessionId).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async markInterruptedRuns(sessionId: string): Promise<AgentRun[]> {
    const runs = await this.loadSessionRuns(sessionId);
    const active = runs.filter((run) => ['preparing', 'planning', 'acting', 'observing', 'verifying', 'cancelling'].includes(run.phase));
    const interrupted = active.map((run) => ({ ...run, phase: 'interrupted' as const, updatedAt: Date.now(), error: 'Browser session ended before this run could finish.' }));
    for (const run of interrupted) await this.saveRun(run);
    return [...runs.filter((run) => !active.some((candidate) => candidate.id === run.id)), ...interrupted];
  }
}
