import type { FileSystemTree } from '@webcontainer/api';
import type { AgentCheckpoint, AgentEvent, AgentRun, DelegatedAgentTask } from '@/entities/agent/types';
import type { AgentResource, StoredAgentResource } from '@/entities/resource/types';
import type { WorkspaceState } from '@/entities/workspace/types';
import { requestResult } from './indexedDb';
import { V3Database } from './v3Database';
import { storedValue, V3QuarantineRepository, V3RecordStore } from './v3RecordStore';
import { EVENT_PAGE_SIZE, WORKSPACE_ID, isAgentTask, isCheckpoint, isEvent, isResource, isRun, isStoredValue, isWorkspace, type StoredValue, type V3EventCursor, type V3EventPage, type V3ListResult, type V3ReadResult } from './v3Schema';

type TerminalHistory = { sessionId: string; content: string; updatedAt: number };
export type WorkspaceSnapshot = { containerId: string; tree: FileSystemTree; fileCount: number; byteSize: number; revision: number; updatedAt: number };

const isTerminalHistory = (value: unknown): value is TerminalHistory => Boolean(value && typeof value === 'object' && typeof (value as Partial<TerminalHistory>).content === 'string');
const isSnapshot = (value: unknown): value is WorkspaceSnapshot => Boolean(value && typeof value === 'object' && 'tree' in value && Number.isFinite((value as Partial<WorkspaceSnapshot>).fileCount) && Number.isFinite((value as Partial<WorkspaceSnapshot>).byteSize) && ((value as Partial<WorkspaceSnapshot>).revision === undefined || Number.isInteger((value as Partial<WorkspaceSnapshot>).revision)));

export class WorkspaceV3Repository {
  private readonly records: V3RecordStore<WorkspaceState>;
  constructor(database: V3Database, quarantine: V3QuarantineRepository) { this.records = new V3RecordStore(database, quarantine, 'workspace', isWorkspace); }
  load(): Promise<V3ReadResult<WorkspaceState>> { return this.records.get(WORKSPACE_ID); }
  save(workspace: WorkspaceState): Promise<void> { return this.records.put(WORKSPACE_ID, workspace); }
}

export class AgentV3Repository {
  private readonly database: V3Database;
  private readonly runs: V3RecordStore<AgentRun>;
  private readonly events: V3RecordStore<AgentEvent>;
  private readonly checkpoints: V3RecordStore<AgentCheckpoint>;
  private readonly tasks: V3RecordStore<DelegatedAgentTask>;
  constructor(database: V3Database, quarantine: V3QuarantineRepository) {
    this.database = database;
    this.runs = new V3RecordStore(database, quarantine, 'runs', isRun);
    this.events = new V3RecordStore(database, quarantine, 'events', isEvent);
    this.checkpoints = new V3RecordStore(database, quarantine, 'checkpoints', isCheckpoint);
    this.tasks = new V3RecordStore(database, quarantine, 'agentTasks', isAgentTask);
  }
  saveRun(run: AgentRun): Promise<void> { return this.runs.put(run.id, run, run.updatedAt); }
  loadRun(runId: string): Promise<V3ReadResult<AgentRun>> { return this.runs.get(runId); }
  async listRuns(sessionId?: string): Promise<V3ListResult<AgentRun>> {
    const result = await this.runs.list(sessionId ? { name: 'sessionId', key: sessionId } : undefined);
    return { ...result, value: result.value.sort((left, right) => right.updatedAt - left.updatedAt) };
  }
  appendEvent(event: AgentEvent): Promise<void> { return event.transient ? Promise.resolve() : this.events.put(event.id, event, event.createdAt); }

  async listEventPage(sessionId: string, options: { before?: V3EventCursor; limit?: number } = {}): Promise<V3EventPage> {
    const limit = Math.max(1, Math.min(options.limit ?? EVENT_PAGE_SIZE, EVENT_PAGE_SIZE));
    const database = await this.database.open();
    const transaction = database.transaction('events', 'readonly');
    const index = transaction.objectStore('events').index('sessionTimelineStable');
    const lower = [sessionId, 0, 0, ''];
    const upper = options.before
      ? [sessionId, options.before.createdAt, options.before.sequence, options.before.id]
      : [sessionId, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, '\uffff'];
    const range = IDBKeyRange.bound(lower, upper, false, Boolean(options.before));
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const values: unknown[] = [];
      const request = index.openCursor(range, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || values.length >= limit + 1) { resolve(values); return; }
        values.push(cursor.value);
        cursor.continue();
      };
    });
    const hasMore = records.length > limit;
    const validated = await this.events.validateMany(records.slice(0, limit));
    const value = validated.value.sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence || left.id.localeCompare(right.id));
    return { ...validated, value, hasMore, oldestSequence: value[0]?.sequence ?? null, newestSequence: value.at(-1)?.sequence ?? null };
  }

  async listRunEventPage(runId: string, options: { beforeSequence?: number; limit?: number } = {}): Promise<V3EventPage> {
    const limit = Math.max(1, Math.min(options.limit ?? EVENT_PAGE_SIZE, EVENT_PAGE_SIZE));
    const database = await this.database.open();
    const index = database.transaction('events', 'readonly').objectStore('events').index('runSequence');
    const upperSequence = options.beforeSequence ?? Number.MAX_SAFE_INTEGER;
    const range = IDBKeyRange.bound([runId, 0], [runId, upperSequence], false, options.beforeSequence !== undefined);
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const values: unknown[] = [];
      const request = index.openCursor(range, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || values.length >= limit + 1) { resolve(values); return; }
        values.push(cursor.value);
        cursor.continue();
      };
    });
    const hasMore = records.length > limit;
    const validated = await this.events.validateMany(records.slice(0, limit));
    const value = validated.value.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
    return { ...validated, value, hasMore, oldestSequence: value[0]?.sequence ?? null, newestSequence: value.at(-1)?.sequence ?? null };
  }

  async listEvents(sessionId: string): Promise<V3ListResult<AgentEvent>> {
    const result = await this.events.list({ name: 'sessionId', key: sessionId });
    return { ...result, value: result.value.sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence) };
  }
  async latestEventSequence(runId: string): Promise<number | undefined> {
    const database = await this.database.open();
    const index = database.transaction('events', 'readonly').objectStore('events').index('runSequence');
    const range = IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
    const raw = await requestResult(index.openCursor(range, 'prev')) as IDBCursorWithValue | null;
    if (!raw || !isStoredValue(raw.value) || !isEvent(raw.value.payload)) return undefined;
    return raw.value.payload.sequence;
  }
  saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> {
    const normalized = { ...checkpoint, id: checkpoint.runId };
    return this.checkpoints.put(checkpoint.runId, normalized, checkpoint.createdAt);
  }
  latestCheckpoint(runId: string): Promise<V3ReadResult<AgentCheckpoint>> { return this.checkpoints.get(runId); }
  saveTask(task: DelegatedAgentTask): Promise<void> { return this.tasks.put(task.id, task, task.updatedAt); }
  async listTasks(rootRunId: string): Promise<V3ListResult<DelegatedAgentTask>> {
    const result = await this.tasks.list({ name: 'rootRunId', key: rootRunId });
    return { ...result, value: result.value.sort((left, right) => left.createdAt - right.createdAt) };
  }
  async listSessionTasks(sessionId: string): Promise<V3ListResult<DelegatedAgentTask>> {
    const result = await this.tasks.list({ name: 'sessionId', key: sessionId });
    return { ...result, value: result.value.sort((left, right) => left.createdAt - right.createdAt) };
  }

  async deleteByIndex(transaction: IDBTransaction, storeName: 'runs' | 'events' | 'checkpoints' | 'resources' | 'agentTasks', indexName: string, key: IDBValidKey): Promise<void> {
    const store = transaction.objectStore(storeName);
    const keys = await requestResult(store.index(indexName).getAllKeys(IDBKeyRange.only(key)));
    keys.forEach((recordKey) => store.delete(recordKey));
  }

  async runIdsForContainer(transaction: IDBTransaction, containerId: string): Promise<IDBValidKey[]> {
    return requestResult(transaction.objectStore('runs').index('containerId').getAllKeys(IDBKeyRange.only(containerId)));
  }
}

export class ResourceV3Repository {
  private readonly records: V3RecordStore<StoredAgentResource>;
  private readonly database: V3Database;
  constructor(database: V3Database, quarantine: V3QuarantineRepository) { this.database = database; this.records = new V3RecordStore(database, quarantine, 'resources', isResource); }
  save(resource: StoredAgentResource): Promise<void> { return this.records.put(resource.id, resource, resource.createdAt); }
  async saveMany(resources: StoredAgentResource[]): Promise<void> {
    if (!resources.length) return;
    await this.database.write('resources', async (transaction) => {
      const store = transaction.objectStore('resources');
      for (const resource of resources) await requestResult(store.put(storedValue(resource.id, resource, resource.createdAt)));
    });
  }
  load(resourceId: string): Promise<V3ReadResult<StoredAgentResource>> { return this.records.get(resourceId); }
  async findBySha(sessionId: string, sha256: string): Promise<V3ReadResult<StoredAgentResource>> {
    const database = await this.database.open();
    const raw = await requestResult(database.transaction('resources', 'readonly').objectStore('resources').index('sessionSha').get([sessionId, sha256])) as StoredValue<StoredAgentResource> | undefined;
    if (!raw) return { value: null, issues: [] };
    if (!isResource(raw.payload)) return { value: null, issues: [await this.records.validateMany([raw]).then((result) => result.issues[0]!)] };
    return { value: structuredClone(raw.payload), issues: [] };
  }
  async list(sessionId: string): Promise<V3ListResult<AgentResource>> {
    const result = await this.records.list({ name: 'sessionId', key: sessionId });
    return { ...result, value: result.value.map(({ blob: _blob, modelBlob: _modelBlob, ...resource }) => resource).sort((left, right) => right.createdAt - left.createdAt) };
  }
}

export class TerminalV3Repository {
  private readonly records: V3RecordStore<TerminalHistory>;
  constructor(database: V3Database, quarantine: V3QuarantineRepository) { this.records = new V3RecordStore(database, quarantine, 'terminalHistory', isTerminalHistory); }
  async load(sessionId: string): Promise<V3ReadResult<string>> { const result = await this.records.get(sessionId); return { value: result.value?.content ?? null, issues: result.issues }; }
  save(sessionId: string, content: string): Promise<void> { return this.records.put(sessionId, { sessionId, content, updatedAt: Date.now() }); }
}

export class SnapshotV3Repository {
  private readonly records: V3RecordStore<WorkspaceSnapshot>;
  constructor(database: V3Database, quarantine: V3QuarantineRepository) { this.records = new V3RecordStore(database, quarantine, 'snapshots', isSnapshot); }
  async load(containerId: string): Promise<V3ReadResult<FileSystemTree>> { const result = await this.loadState(containerId); return { value: result.value?.tree ?? null, issues: result.issues }; }
  async loadState(containerId: string): Promise<V3ReadResult<WorkspaceSnapshot>> {
    const result = await this.records.get(containerId);
    return { value: result.value ? { ...result.value, revision: result.value.revision ?? 0 } : null, issues: result.issues };
  }
  save(containerId: string, tree: FileSystemTree, fileCount: number, byteSize: number, revision: number): Promise<void> { return this.records.put(containerId, { containerId, tree, fileCount, byteSize, revision, updatedAt: Date.now() }); }
}

export function putWorkspace(transaction: IDBTransaction, workspace: WorkspaceState): void {
  transaction.objectStore('workspace').put(storedValue(WORKSPACE_ID, workspace));
}
