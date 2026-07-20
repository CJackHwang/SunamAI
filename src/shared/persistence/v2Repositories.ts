import type { FileSystemTree } from '@webcontainer/api';
import type { WorkspaceState } from '@/entities/workspace/types';
import type { AgentCheckpoint, AgentEvent, AgentRun } from '@/entities/agent/types';
import { requestResult } from './indexedDb';
import { V2Database } from './v2Database';
import { QuarantineRepository, V2RecordStore } from './v2RecordStore';
import { WORKSPACE_ID, isCheckpoint, isEvent, isRun, isWorkspace, type V2ListResult, type V2ReadResult } from './v2Schema';

type TerminalHistory = { sessionId: string; content: string; updatedAt: number };
type WorkspaceSnapshot = { containerId: string; tree: FileSystemTree; updatedAt: number };

const isTerminalHistory = (value: unknown): value is TerminalHistory => Boolean(value && typeof value === 'object' && typeof (value as Partial<TerminalHistory>).content === 'string');
const isSnapshot = (value: unknown): value is WorkspaceSnapshot => Boolean(value && typeof value === 'object' && 'tree' in value);

export class WorkspaceV2Repository {
  private readonly records: V2RecordStore<WorkspaceState>;
  constructor(database: V2Database, quarantine: QuarantineRepository) { this.records = new V2RecordStore(database, quarantine, 'workspace', isWorkspace); }
  load(): Promise<V2ReadResult<WorkspaceState>> { return this.records.get(WORKSPACE_ID); }
  save(workspace: WorkspaceState): Promise<void> { return this.records.put(WORKSPACE_ID, workspace); }
}

export class AgentV2Repository {
  private readonly runs: V2RecordStore<AgentRun>;
  private readonly events: V2RecordStore<AgentEvent>;
  private readonly checkpoints: V2RecordStore<AgentCheckpoint>;
  constructor(database: V2Database, quarantine: QuarantineRepository) {
    this.runs = new V2RecordStore(database, quarantine, 'runs', isRun);
    this.events = new V2RecordStore(database, quarantine, 'events', isEvent);
    this.checkpoints = new V2RecordStore(database, quarantine, 'checkpoints', isCheckpoint);
  }
  saveRun(run: AgentRun): Promise<void> { return this.runs.put(run.id, run, run.updatedAt); }
  loadRun(runId: string): Promise<V2ReadResult<AgentRun>> { return this.runs.get(runId); }
  async listRuns(sessionId?: string): Promise<V2ListResult<AgentRun>> {
    const result = await this.runs.list(sessionId ? { name: 'sessionId', key: sessionId } : undefined);
    return { ...result, value: result.value.sort((left, right) => right.updatedAt - left.updatedAt) };
  }
  appendEvent(event: AgentEvent): Promise<void> { return event.transient ? Promise.resolve() : this.events.put(event.id, event, event.createdAt); }
  async listEvents(sessionId: string): Promise<V2ListResult<AgentEvent>> {
    const result = await this.events.list({ name: 'sessionId', key: sessionId });
    return { ...result, value: result.value.sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence) };
  }
  saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> { return this.checkpoints.put(checkpoint.id, checkpoint, checkpoint.createdAt); }
  async latestCheckpoint(runId: string): Promise<V2ReadResult<AgentCheckpoint>> {
    const result = await this.checkpoints.list({ name: 'runId', key: runId });
    return { value: result.value.sort((left, right) => right.createdAt - left.createdAt)[0] ?? null, issues: result.issues };
  }
  async deleteSession(sessionId: string, transaction: IDBTransaction): Promise<void> {
    for (const storeName of ['runs', 'events', 'checkpoints'] as const) {
      const store = transaction.objectStore(storeName);
      const keys = await requestResult(store.index('sessionId').getAllKeys(IDBKeyRange.only(sessionId)));
      keys.forEach((key) => store.delete(key));
    }
  }
  async deleteContainer(containerId: string, transaction: IDBTransaction): Promise<void> {
    const runs = transaction.objectStore('runs');
    const runKeys = await requestResult(runs.index('containerId').getAllKeys(IDBKeyRange.only(containerId)));
    for (const runId of runKeys) {
      for (const storeName of ['events', 'checkpoints'] as const) {
        const store = transaction.objectStore(storeName);
        const keys = await requestResult(store.index('runId').getAllKeys(IDBKeyRange.only(runId)));
        keys.forEach((key) => store.delete(key));
      }
      runs.delete(runId);
    }
  }
}

export class TerminalV2Repository {
  private readonly records: V2RecordStore<TerminalHistory>;
  constructor(database: V2Database, quarantine: QuarantineRepository) { this.records = new V2RecordStore(database, quarantine, 'terminalHistory', isTerminalHistory); }
  async load(sessionId: string): Promise<V2ReadResult<string>> {
    const result = await this.records.get(sessionId);
    return { value: result.value?.content ?? null, issues: result.issues };
  }
  save(sessionId: string, content: string): Promise<void> { return this.records.put(sessionId, { sessionId, content, updatedAt: Date.now() }); }
}

export class SnapshotV2Repository {
  private readonly records: V2RecordStore<WorkspaceSnapshot>;
  constructor(database: V2Database, quarantine: QuarantineRepository) { this.records = new V2RecordStore(database, quarantine, 'snapshots', isSnapshot); }
  async load(containerId: string): Promise<V2ReadResult<FileSystemTree>> {
    const result = await this.records.get(containerId);
    return { value: result.value?.tree ?? null, issues: result.issues };
  }
  save(containerId: string, tree: FileSystemTree): Promise<void> { return this.records.put(containerId, { containerId, tree, updatedAt: Date.now() }); }
}
