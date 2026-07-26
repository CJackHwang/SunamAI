import type { FileSystemTree } from '@webcontainer/api';
import type { AgentCheckpoint, AgentEvent, AgentRun, DelegatedAgentTask } from '@/entities/agent/types';
import type { AgentResource, StoredAgentResource } from '@/entities/resource/types';
import type { WorkspaceState } from '@/entities/workspace/types';
import { requestResult } from './indexedDb';
import { V3Database } from './v3Database';
import { AgentV3Repository, putWorkspace, ResourceV3Repository, SnapshotV3Repository, TerminalV3Repository, WorkspaceV3Repository, type WorkspaceSnapshot } from './v3Repositories';
import { storedValue, V3QuarantineRepository } from './v3RecordStore';
import { isStoredValue, type StoredValue, type V3DataIssue, type V3EventCursor, type V3EventPage, type V3ListResult, type V3ReadResult } from './v3Schema';
import { sanitizeCheckpointForPersistence, sanitizeEventForPersistence, sanitizeRunForPersistence } from './persistenceSanitizer';

export { EVENT_PAGE_SIZE, V3_PERSISTENCE_DATABASE, V3_PERSISTENCE_VERSION } from './v3Schema';
export type { V3DataIssue, V3EventPage, V3ListResult, V3ReadResult } from './v3Schema';

export const SNAPSHOT_MAX_FILES = 10_000;
export const SNAPSHOT_MAX_BYTES = 100 * 1024 * 1024;
const EXCLUDED_SNAPSHOT_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage', 'playwright-report', 'test-results', '.cache', '.vite', '.turbo', '.next', '.nuxt', '.parcel-cache']);

function collectResourceIds(value: unknown, result = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return result;
  if (Array.isArray(value)) {
    value.forEach((entry) => collectResourceIds(entry, result));
    return result;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'resourceId' && typeof entry === 'string') result.add(entry);
    else if (key === 'resourceIds' && Array.isArray(entry)) entry.forEach((id) => { if (typeof id === 'string') result.add(id); });
    collectResourceIds(entry, result);
  }
  return result;
}

export class SnapshotLimitError extends Error {
  readonly fileCount: number;
  readonly byteSize: number;
  constructor(fileCount: number, byteSize: number) {
    super(`Workspace snapshot exceeds the safe limit (${fileCount} files, ${byteSize} bytes). The last complete snapshot was kept.`);
    this.name = 'SnapshotLimitError';
    this.fileCount = fileCount;
    this.byteSize = byteSize;
  }
}

function contentBytes(contents: string | Uint8Array): number {
  return typeof contents === 'string' ? new TextEncoder().encode(contents).byteLength : contents.byteLength;
}

export function sanitizeSnapshotTree(tree: FileSystemTree): { tree: FileSystemTree; fileCount: number; byteSize: number } {
  let fileCount = 0;
  let byteSize = 0;
  const visit = (source: FileSystemTree): FileSystemTree => {
    const clean: FileSystemTree = {};
    for (const [name, entry] of Object.entries(source)) {
      if ('directory' in entry) {
        if (EXCLUDED_SNAPSHOT_DIRECTORIES.has(name)) continue;
        clean[name] = { directory: visit(entry.directory) };
        continue;
      }
      if ('file' in entry) {
        fileCount += 1;
        if ('contents' in entry.file) byteSize += contentBytes(entry.file.contents);
        if (fileCount > SNAPSHOT_MAX_FILES || byteSize > SNAPSHOT_MAX_BYTES) throw new SnapshotLimitError(fileCount, byteSize);
        clean[name] = structuredClone(entry);
      }
    }
    return clean;
  };
  const sanitized = visit(tree);
  return { tree: sanitized, fileCount, byteSize };
}

/** The active persistence facade. It never opens or reads the legacy sunam-v2 database. */
export class V3PersistenceRepository {
  private readonly database = new V3Database();
  private readonly quarantine = new V3QuarantineRepository(this.database);
  private readonly workspace = new WorkspaceV3Repository(this.database, this.quarantine);
  private readonly agent = new AgentV3Repository(this.database, this.quarantine);
  private readonly terminal = new TerminalV3Repository(this.database, this.quarantine);
  private readonly snapshots = new SnapshotV3Repository(this.database, this.quarantine);
  private readonly resources = new ResourceV3Repository(this.database, this.quarantine);
  private workspaceWrite = Promise.resolve();
  private runWrite = Promise.resolve();
  private checkpointWrite = Promise.resolve();
  private terminalWrite = Promise.resolve();
  private snapshotWrite = Promise.resolve();

  private serialize(queue: 'workspaceWrite' | 'runWrite' | 'checkpointWrite' | 'terminalWrite' | 'snapshotWrite', operation: () => Promise<void>): Promise<void> {
    const next = this[queue].catch(() => undefined).then(operation);
    this[queue] = next;
    return next;
  }

  loadWorkspace(): Promise<V3ReadResult<WorkspaceState>> { return this.workspace.load(); }
  saveWorkspace(workspace: WorkspaceState): Promise<void> { return this.serialize('workspaceWrite', () => this.workspace.save(workspace)); }
  saveRun(run: AgentRun): Promise<void> { return this.serialize('runWrite', () => this.agent.saveRun(sanitizeRunForPersistence(run))); }
  loadRun(runId: string): Promise<V3ReadResult<AgentRun>> { return this.agent.loadRun(runId); }
  listRuns(sessionId?: string): Promise<V3ListResult<AgentRun>> { return this.agent.listRuns(sessionId); }
  appendEvent(event: AgentEvent): Promise<void> { return this.agent.appendEvent(sanitizeEventForPersistence(event)); }
  listEventPage(sessionId: string, options?: { before?: V3EventCursor; limit?: number }): Promise<V3EventPage> { return this.agent.listEventPage(sessionId, options); }
  listRunEventPage(runId: string, options?: { beforeSequence?: number; limit?: number }): Promise<V3EventPage> { return this.agent.listRunEventPage(runId, options); }
  listEvents(sessionId: string): Promise<V3ListResult<AgentEvent>> { return this.agent.listEvents(sessionId); }
  latestEventSequence(runId: string): Promise<number | undefined> { return this.agent.latestEventSequence(runId); }
  saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> { return this.serialize('checkpointWrite', () => this.agent.saveCheckpoint(sanitizeCheckpointForPersistence(checkpoint))); }
  latestCheckpoint(runId: string): Promise<V3ReadResult<AgentCheckpoint>> { return this.agent.latestCheckpoint(runId); }
  saveAgentTask(task: DelegatedAgentTask): Promise<void> { return this.agent.saveTask(task); }
  listAgentTasks(rootRunId: string): Promise<V3ListResult<DelegatedAgentTask>> { return this.agent.listTasks(rootRunId); }
  listSessionAgentTasks(sessionId: string): Promise<V3ListResult<DelegatedAgentTask>> { return this.agent.listSessionTasks(sessionId); }
  loadTerminalHistory(sessionId: string): Promise<V3ReadResult<string>> { return this.terminal.load(sessionId); }
  saveTerminalHistory(sessionId: string, content: string): Promise<void> { return this.serialize('terminalWrite', () => this.terminal.save(sessionId, content)); }
  loadSnapshot(containerId: string): Promise<V3ReadResult<FileSystemTree>> { return this.snapshots.load(containerId); }
  loadSnapshotState(containerId: string): Promise<V3ReadResult<WorkspaceSnapshot>> { return this.snapshots.loadState(containerId); }
  saveSnapshot(containerId: string, tree: FileSystemTree, revision = 0): Promise<void> {
    return this.serialize('snapshotWrite', async () => {
      const clean = sanitizeSnapshotTree(tree);
      await this.snapshots.save(containerId, clean.tree, clean.fileCount, clean.byteSize, revision);
    });
  }
  saveResource(resource: StoredAgentResource): Promise<void> { return this.resources.save(resource); }
  saveResources(resources: StoredAgentResource[]): Promise<void> { return this.resources.saveMany(resources); }
  loadResource(resourceId: string): Promise<V3ReadResult<StoredAgentResource>> { return this.resources.load(resourceId); }
  findResourceBySha(sessionId: string, sha256: string): Promise<V3ReadResult<StoredAgentResource>> { return this.resources.findBySha(sessionId, sha256); }
  listResources(sessionId: string): Promise<V3ListResult<AgentResource>> { return this.resources.list(sessionId); }
  listIssues(): Promise<V3DataIssue[]> { return this.quarantine.list(); }

  deleteSession(sessionId: string, nextWorkspace?: WorkspaceState): Promise<void> {
    return this.serialize('workspaceWrite', async () => {
      const stores = ['runs', 'events', 'checkpoints', 'terminalHistory', 'resources', 'agentTasks', ...(nextWorkspace ? ['workspace'] as const : [])] as const;
      await this.database.write([...stores], async (transaction) => {
        for (const storeName of ['runs', 'events', 'checkpoints', 'resources', 'agentTasks'] as const) {
          await this.agent.deleteByIndex(transaction, storeName, 'sessionId', sessionId);
        }
        transaction.objectStore('terminalHistory').delete(sessionId);
        if (nextWorkspace) putWorkspace(transaction, nextWorkspace);
      });
    });
  }

  deleteContainer(containerId: string, nextWorkspace?: WorkspaceState): Promise<void> {
    return this.serialize('workspaceWrite', async () => {
      const stores = ['runs', 'events', 'checkpoints', 'snapshots', 'resources', 'agentTasks', ...(nextWorkspace ? ['workspace'] as const : [])] as const;
      await this.database.write([...stores], async (transaction) => {
        const runKeys = await this.agent.runIdsForContainer(transaction, containerId);
        const deletedRunIds = new Set(runKeys.map(String));
        const survivingReferences = new Map<string, string>();
        for (const storeName of ['events', 'checkpoints'] as const) {
          const records = await requestResult(transaction.objectStore(storeName).getAll()) as unknown[];
          for (const raw of records) {
            if (!isStoredValue(raw) || !raw.payload || typeof raw.payload !== 'object') continue;
            const runId = 'runId' in raw.payload && typeof raw.payload.runId === 'string' ? raw.payload.runId : null;
            if (!runId || deletedRunIds.has(runId)) continue;
            collectResourceIds(raw.payload).forEach((resourceId) => { if (!survivingReferences.has(resourceId)) survivingReferences.set(resourceId, runId); });
          }
        }
        const resourceCandidates = new Map<string, StoredValue<StoredAgentResource>>();
        for (const runKey of runKeys) {
          const records = await requestResult(transaction.objectStore('resources').index('originatingRunId').getAll(IDBKeyRange.only(runKey))) as unknown[];
          for (const raw of records) if (isStoredValue(raw)) resourceCandidates.set(raw.id, raw as StoredValue<StoredAgentResource>);
        }
        for (const [resourceId, record] of resourceCandidates) {
          const nextOrigin = survivingReferences.get(resourceId);
          if (nextOrigin) transaction.objectStore('resources').put(storedValue(resourceId, { ...record.payload, originatingRunId: nextOrigin }, record.updatedAt));
          else transaction.objectStore('resources').delete(resourceId);
        }
        for (const runKey of runKeys) {
          await this.agent.deleteByIndex(transaction, 'events', 'runId', runKey);
          await this.agent.deleteByIndex(transaction, 'checkpoints', 'runId', runKey);
          await this.agent.deleteByIndex(transaction, 'agentTasks', 'rootRunId', runKey);
          await this.agent.deleteByIndex(transaction, 'agentTasks', 'parentRunId', runKey);
          transaction.objectStore('runs').delete(runKey);
        }
        transaction.objectStore('snapshots').delete(containerId);
        if (nextWorkspace) putWorkspace(transaction, nextWorkspace);
      });
    });
  }

  async countCheckpoints(): Promise<number> {
    const database = await this.database.open();
    return requestResult(database.transaction('checkpoints', 'readonly').objectStore('checkpoints').count());
  }
}

export const v3Persistence = new V3PersistenceRepository();
