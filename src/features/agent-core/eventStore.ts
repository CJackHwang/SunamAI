import type { AgentEvent, AgentRun } from './types';
import { v2Persistence, type AgentCheckpoint, type V2PersistenceRepository } from '@/shared/persistence/v2Repository';

const memoryEvents = new Map<string, AgentEvent[]>();
const memoryRuns = new Map<string, AgentRun>();

/** Append-only v2 event facade. It only delegates to the versioned v2 repository. */
export class AgentEventStore {
  private readonly repository: V2PersistenceRepository;

  constructor(repository: V2PersistenceRepository = v2Persistence) {
    this.repository = repository;
  }

  async append(event: AgentEvent): Promise<void> {
    if (event.transient) return;
    const events = memoryEvents.get(event.sessionId) ?? [];
    if (!events.some((candidate) => candidate.id === event.id)) memoryEvents.set(event.sessionId, [...events, event]);
    if (event.kind === 'run_started') memoryRuns.set(event.run.id, event.run);
    await this.repository.appendEvent(event);
    if (event.kind === 'run_started') await this.repository.saveRun(event.run);
  }

  async saveRun(run: AgentRun): Promise<void> {
    memoryRuns.set(run.id, run);
    await this.repository.saveRun(run);
  }

  async loadSessionEvents(sessionId: string): Promise<AgentEvent[]> {
    const persisted = await this.repository.listEvents(sessionId);
    const merged = new Map<string, AgentEvent>();
    persisted.value.forEach((event) => merged.set(event.id, event));
    (memoryEvents.get(sessionId) ?? []).forEach((event) => merged.set(event.id, event));
    const events = [...merged.values()].sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence);
    memoryEvents.set(sessionId, events);
    return events;
  }

  async loadSessionRuns(sessionId: string): Promise<AgentRun[]> {
    const persisted = await this.repository.listRuns(sessionId);
    const merged = new Map<string, AgentRun>();
    persisted.value.forEach((run) => merged.set(run.id, run));
    Array.from(memoryRuns.values()).filter((run) => run.sessionId === sessionId).forEach((run) => merged.set(run.id, run));
    const runs = [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    runs.forEach((run) => memoryRuns.set(run.id, run));
    return runs;
  }

  async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> { await this.repository.saveCheckpoint(checkpoint); }
  async latestCheckpoint(runId: string): Promise<AgentCheckpoint | null> { return (await this.repository.latestCheckpoint(runId)).value; }

  async markInterruptedRuns(sessionId: string): Promise<AgentRun[]> {
    const runs = await this.loadSessionRuns(sessionId);
    const active = runs.filter((run) => ['preparing', 'planning', 'acting', 'observing', 'verifying', 'cancelling'].includes(run.phase));
    const interrupted = active.map((run) => ({ ...run, phase: 'interrupted' as const, updatedAt: Date.now(), error: 'Browser session ended before this run could finish.' }));
    for (const run of interrupted) await this.saveRun(run);
    return [...runs.filter((run) => !active.some((candidate) => candidate.id === run.id)), ...interrupted];
  }
}
