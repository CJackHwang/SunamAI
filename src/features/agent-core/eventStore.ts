import { isActiveAgentPhase, type AgentEvent, type AgentRun } from './types';
import { v3Persistence, type V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import type { AgentCheckpoint, DelegatedAgentTask } from '@/entities/agent/types';

/** Append-only event facade backed by the isolated v3 repository. */
export class AgentEventStore {
  private readonly repository: V3PersistenceRepository;
  private readonly memoryEvents = new Map<string, AgentEvent[]>();
  private readonly memoryRuns = new Map<string, AgentRun>();
  private readonly olderPages = new Map<string, boolean>();

  constructor(repository: V3PersistenceRepository = v3Persistence) {
    this.repository = repository;
  }

  async append(event: AgentEvent): Promise<void> {
    if (event.transient) return;
    const events = this.memoryEvents.get(event.sessionId) ?? [];
    if (!events.some((candidate) => candidate.id === event.id)) this.memoryEvents.set(event.sessionId, [...events, event]);
    if (event.kind === 'run_started') this.memoryRuns.set(event.run.id, event.run);
    await this.repository.appendEvent(event);
    if (event.kind === 'run_started') await this.repository.saveRun(event.run);
  }

  async saveRun(run: AgentRun): Promise<void> {
    this.memoryRuns.set(run.id, run);
    await this.repository.saveRun(run);
  }

  async loadSessionEvents(sessionId: string): Promise<AgentEvent[]> {
    const persisted = await this.repository.listEventPage(sessionId);
    this.olderPages.set(sessionId, persisted.hasMore);
    const merged = new Map<string, AgentEvent>();
    persisted.value.forEach((event) => merged.set(event.id, event));
    (this.memoryEvents.get(sessionId) ?? []).forEach((event) => merged.set(event.id, event));
    const events = [...merged.values()].sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence || left.id.localeCompare(right.id));
    this.memoryEvents.set(sessionId, events);
    return events;
  }

  hasOlderSessionEvents(sessionId: string): boolean { return this.olderPages.get(sessionId) ?? false; }

  async loadOlderSessionEvents(sessionId: string): Promise<{ events: AgentEvent[]; hasMore: boolean }> {
    const current = this.memoryEvents.get(sessionId) ?? [];
    const oldest = current[0];
    const persisted = await this.repository.listEventPage(sessionId, oldest ? { before: { createdAt: oldest.createdAt, sequence: oldest.sequence, id: oldest.id } } : undefined);
    const merged = new Map<string, AgentEvent>();
    persisted.value.forEach((event) => merged.set(event.id, event));
    current.forEach((event) => merged.set(event.id, event));
    const events = [...merged.values()].sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence || left.id.localeCompare(right.id));
    this.memoryEvents.set(sessionId, events);
    this.olderPages.set(sessionId, persisted.hasMore);
    return { events, hasMore: persisted.hasMore };
  }

  async loadRunEvents(sessionId: string, runId: string): Promise<AgentEvent[]> {
    const persisted = await this.repository.listRunEventPage(runId);
    const merged = new Map<string, AgentEvent>();
    (this.memoryEvents.get(sessionId) ?? []).forEach((event) => merged.set(event.id, event));
    persisted.value.filter((event) => event.sessionId === sessionId).forEach((event) => merged.set(event.id, event));
    const events = [...merged.values()].sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence || left.id.localeCompare(right.id));
    this.memoryEvents.set(sessionId, events);
    return events;
  }

  async loadSessionRuns(sessionId: string): Promise<AgentRun[]> {
    const persisted = await this.repository.listRuns(sessionId);
    const merged = new Map<string, AgentRun>();
    persisted.value.forEach((run) => merged.set(run.id, run));
    Array.from(this.memoryRuns.values()).filter((run) => run.sessionId === sessionId).forEach((run) => merged.set(run.id, run));
    const runs = [...merged.values()].sort((left, right) => right.updatedAt - left.updatedAt);
    runs.forEach((run) => this.memoryRuns.set(run.id, run));
    return runs;
  }

  async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> { await this.repository.saveCheckpoint(checkpoint); }
  async latestCheckpoint(runId: string): Promise<AgentCheckpoint | null> { return (await this.repository.latestCheckpoint(runId)).value; }
  async saveAgentTask(task: DelegatedAgentTask): Promise<void> { await this.repository.saveAgentTask(task); }
  async listAgentTasks(rootRunId: string): Promise<DelegatedAgentTask[]> { return (await this.repository.listAgentTasks(rootRunId)).value; }
  latestEventSequence(runId: string): Promise<number | undefined> { return this.repository.latestEventSequence(runId); }

  async deleteChildRun(runId: string): Promise<boolean> {
    const deleted = await this.repository.deleteChildRun(runId);
    if (!deleted) return false;
    this.memoryRuns.delete(runId);
    for (const [sessionId, events] of this.memoryEvents) {
      this.memoryEvents.set(sessionId, events.filter((event) => event.runId !== runId));
    }
    return true;
  }

  async pruneTerminalChildRuns(sessionId: string, keepRootRunId: string): Promise<string[]> {
    const deletedRunIds = await this.repository.pruneTerminalChildRuns(sessionId, keepRootRunId);
    if (!deletedRunIds.length) return [];
    const deleted = new Set(deletedRunIds);
    deletedRunIds.forEach((runId) => this.memoryRuns.delete(runId));
    this.memoryEvents.set(sessionId, (this.memoryEvents.get(sessionId) ?? []).filter((event) => !deleted.has(event.runId)));
    return deletedRunIds;
  }

  async markInterruptedRuns(sessionId: string): Promise<AgentRun[]> {
    const runs = await this.loadSessionRuns(sessionId);
    const active = runs.filter((run) => isActiveAgentPhase(run.phase));
    const interrupted = active.map((run) => ({ ...run, phase: 'interrupted' as const, updatedAt: Date.now(), error: 'Browser session ended before this run could finish.' }));
    for (const run of interrupted) await this.saveRun(run);
    const tasks = (await this.repository.listSessionAgentTasks(sessionId)).value;
    for (const task of tasks.filter((candidate) => candidate.status === 'queued' || candidate.status === 'running')) {
      await this.saveAgentTask({ ...task, status: 'interrupted', updatedAt: Date.now(), blockedReason: 'Browser session ended before this delegated task could finish.' });
    }
    return [...runs.filter((run) => !active.some((candidate) => candidate.id === run.id)), ...interrupted];
  }
}
