import type { FileSystemTree } from '@webcontainer/api';
import type { Message } from '@/entities/message/types';
import type { Container, Session, WorkspaceState } from '@/entities/workspace/types';
import type { AgentEvent, AgentRun } from '@/features/agent-core/types';

export const V2_PERSISTENCE_DATABASE = 'sunam-v2';
export const V2_PERSISTENCE_VERSION = 2;
export const V2_BACKUP_FORMAT_VERSION = 1;

/** A deliberately narrow JSON marker used only for binary WebContainer files. */
const BINARY_BACKUP_MARKER = '__sunam_v2_bytes__';

type StoreName = 'workspace' | 'runs' | 'events' | 'checkpoints' | 'terminalHistory' | 'snapshots' | 'quarantine';

const STORE_NAMES: StoreName[] = ['workspace', 'runs', 'events', 'checkpoints', 'terminalHistory', 'snapshots', 'quarantine'];
const WORKSPACE_ID = 'current';

export interface AgentCheckpoint {
  id: string;
  runId: string;
  sessionId: string;
  containerId: string;
  summary: string;
  messages: Message[];
  createdAt: number;
}

export interface V2DataIssue {
  id: string;
  store: StoreName;
  recordId: string;
  message: string;
  createdAt: number;
}

export interface V2ReadResult<T> {
  value: T | null;
  issues: V2DataIssue[];
}

export interface V2ListResult<T> {
  value: T[];
  issues: V2DataIssue[];
}

export interface V2PersistenceStats {
  records: Record<StoreName, number>;
  approximateBytes: number;
  issues: V2DataIssue[];
}

export interface V2BackupEnvelope {
  formatVersion: number;
  exportedAt: number;
  payload: {
    workspace: WorkspaceState | null;
    runs: AgentRun[];
    events: AgentEvent[];
    checkpoints: AgentCheckpoint[];
    terminalHistory: Array<{ sessionId: string; content: string; updatedAt: number }>;
    snapshots: Array<{ containerId: string; tree: FileSystemTree; updatedAt: number }>;
  };
}

export interface V2ImportResult {
  sessions: number;
  containers: number;
  runs: number;
  events: number;
  snapshots: number;
}

interface StoredValue<T> {
  id: string;
  formatVersion: number;
  updatedAt: number;
  payload: T;
}

interface QuarantinedValue {
  issue: V2DataIssue;
  raw: unknown;
}

const memoryStores = new Map<StoreName, Map<string, StoredValue<unknown>>>();
const memoryIssues = new Map<string, QuarantinedValue>();

function getMemoryStore(name: StoreName): Map<string, StoredValue<unknown>> {
  let store = memoryStores.get(name);
  if (!store) {
    store = new Map();
    memoryStores.set(name, store);
  }
  return store;
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(V2_PERSISTENCE_DATABASE, V2_PERSISTENCE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('workspace')) database.createObjectStore('workspace', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('runs')) {
        const store = database.createObjectStore('runs', { keyPath: 'id' });
        store.createIndex('sessionId', 'payload.sessionId');
        store.createIndex('containerId', 'payload.containerId');
      }
      if (!database.objectStoreNames.contains('events')) {
        const store = database.createObjectStore('events', { keyPath: 'id' });
        store.createIndex('sessionId', 'payload.sessionId');
        store.createIndex('runId', 'payload.runId');
      }
      if (!database.objectStoreNames.contains('checkpoints')) {
        const store = database.createObjectStore('checkpoints', { keyPath: 'id' });
        store.createIndex('sessionId', 'payload.sessionId');
        store.createIndex('runId', 'payload.runId');
      }
      if (!database.objectStoreNames.contains('terminalHistory')) database.createObjectStore('terminalHistory', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('snapshots')) database.createObjectStore('snapshots', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('quarantine')) database.createObjectStore('quarantine', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function isRecord(value: unknown): value is StoredValue<unknown> {
  return Boolean(value && typeof value === 'object' && typeof (value as Partial<StoredValue<unknown>>).id === 'string' && typeof (value as Partial<StoredValue<unknown>>).formatVersion === 'number' && 'payload' in (value as object));
}

function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WorkspaceState>;
  return Array.isArray(candidate.sessions) && Array.isArray(candidate.containers) && (typeof candidate.activeSessionId === 'string' || candidate.activeSessionId === null) && (typeof candidate.activeContainerId === 'string' || candidate.activeContainerId === null);
}

function isRun(value: unknown): value is AgentRun {
  return Boolean(value && typeof value === 'object' && typeof (value as Partial<AgentRun>).id === 'string' && typeof (value as Partial<AgentRun>).sessionId === 'string' && typeof (value as Partial<AgentRun>).containerId === 'string' && typeof (value as Partial<AgentRun>).phase === 'string' && (value as Partial<AgentRun>).task && typeof (value as Partial<AgentRun>).task === 'object');
}

function isEvent(value: unknown): value is AgentEvent {
  return Boolean(value && typeof value === 'object' && typeof (value as Partial<AgentEvent>).id === 'string' && typeof (value as Partial<AgentEvent>).kind === 'string' && typeof (value as Partial<AgentEvent>).runId === 'string' && typeof (value as Partial<AgentEvent>).sessionId === 'string');
}

function upgradeTaskPayload(value: AgentRun): AgentRun {
  if (Array.isArray(value.task.verificationEvidence)) return value;
  return { ...value, task: { ...value.task, verificationEvidence: [] } };
}

function upgradeRecord(store: StoreName, raw: unknown): StoredValue<unknown> | null {
  if (!isRecord(raw) || raw.formatVersion < 1 || raw.formatVersion > V2_PERSISTENCE_VERSION) return null;
  let payload = deepClone(raw.payload);
  if (store === 'runs' && isRun(payload)) payload = upgradeTaskPayload(payload);
  if (store === 'events' && isEvent(payload) && payload.kind === 'run_started') payload = { ...payload, run: upgradeTaskPayload(payload.run) };
  if (store === 'events' && isEvent(payload) && payload.kind === 'plan_updated' && !Array.isArray(payload.task.verificationEvidence)) payload = { ...payload, task: { ...payload.task, verificationEvidence: [] } };
  return { ...raw, formatVersion: V2_PERSISTENCE_VERSION, payload };
}

function isCheckpoint(value: unknown): value is AgentCheckpoint {
  return Boolean(value && typeof value === 'object' && typeof (value as Partial<AgentCheckpoint>).id === 'string' && typeof (value as Partial<AgentCheckpoint>).runId === 'string' && typeof (value as Partial<AgentCheckpoint>).sessionId === 'string' && Array.isArray((value as Partial<AgentCheckpoint>).messages));
}

function sortEvents(events: AgentEvent[]): AgentEvent[] {
  return [...events].sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence);
}

function deepClone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}

function encodedSize(value: unknown): number {
  try { return new Blob([JSON.stringify(value)]).size; } catch { return 0; }
}

function remapId(prefix: 's' | 'c' | 'r' | 'e' | 'cp', original: string): string {
  return `${prefix}-import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${original.slice(-8).replace(/[^a-z0-9_-]/gi, '') || 'item'}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Avoid exceeding apply()/call() argument limits for a reasonably large asset.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * A backup is JSON on disk, while FileSystemTree also permits Uint8Array file
 * contents. Keep that distinction explicit so a downloaded binary asset can
 * round-trip instead of silently becoming an object with numeric properties.
 */
export function serializeV2Backup(backup: V2BackupEnvelope): string {
  return JSON.stringify(backup, (_key, value: unknown) => value instanceof Uint8Array
    ? { [BINARY_BACKUP_MARKER]: bytesToBase64(value) }
    : value, 2);
}

export function parseV2Backup(serialized: string): unknown {
  return JSON.parse(serialized, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 1 && entries[0]?.[0] === BINARY_BACKUP_MARKER && typeof entries[0][1] === 'string') {
      return base64ToBytes(entries[0][1]);
    }
    return value;
  });
}

/**
 * The only browser database API used by v2. It never looks at legacy keys or
 * legacy IndexedDB databases. The memory fallback is for non-browser tests.
 */
export class V2PersistenceRepository {
  private async quarantine(store: StoreName, recordId: string, message: string, raw: unknown): Promise<V2DataIssue> {
    const issue: V2DataIssue = { id: `issue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, store, recordId, message, createdAt: Date.now() };
    const value: StoredValue<QuarantinedValue> = { id: issue.id, formatVersion: V2_PERSISTENCE_VERSION, updatedAt: issue.createdAt, payload: { issue, raw: deepClone(raw) } };
    memoryIssues.set(issue.id, value.payload);
    if (canUseIndexedDb()) {
      const database = await openDatabase();
      try {
        const transaction = database.transaction('quarantine', 'readwrite');
        transaction.objectStore('quarantine').put(value);
        await transactionDone(transaction);
      } finally { database.close(); }
    }
    return issue;
  }

  private async put<T>(store: StoreName, id: string, payload: T, updatedAt = Date.now()): Promise<void> {
    const value: StoredValue<T> = { id, formatVersion: V2_PERSISTENCE_VERSION, updatedAt, payload: deepClone(payload) };
    getMemoryStore(store).set(id, value as StoredValue<unknown>);
    if (!canUseIndexedDb()) return;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(store, 'readwrite');
      transaction.objectStore(store).put(value);
      await transactionDone(transaction);
    } finally { database.close(); }
  }

  private async get<T>(store: StoreName, id: string, validator: (value: unknown) => value is T): Promise<V2ReadResult<T>> {
    const memory = getMemoryStore(store).get(id);
    let raw: unknown = memory;
    if (canUseIndexedDb()) {
      const database = await openDatabase();
      try {
        const transaction = database.transaction(store, 'readonly');
        raw = await requestResult(transaction.objectStore(store).get(id));
      } finally { database.close(); }
    }
    if (raw === undefined || raw === null) return { value: null, issues: [] };
    const upgraded = upgradeRecord(store, raw);
    if (!upgraded || !validator(upgraded.payload)) {
      return { value: null, issues: [await this.quarantine(store, id, 'Unsupported or malformed v2 record. The original value has been retained in quarantine.', raw)] };
    }
    if (upgraded.formatVersion !== (raw as StoredValue<unknown>).formatVersion) await this.put(store, upgraded.id, upgraded.payload, upgraded.updatedAt);
    return { value: deepClone(upgraded.payload), issues: [] };
  }

  private async list<T>(store: StoreName, validator: (value: unknown) => value is T): Promise<V2ListResult<T>> {
    let records = Array.from(getMemoryStore(store).values());
    if (canUseIndexedDb()) {
      const database = await openDatabase();
      try {
        const transaction = database.transaction(store, 'readonly');
        records = await requestResult(transaction.objectStore(store).getAll()) as StoredValue<unknown>[];
      } finally { database.close(); }
    }
    const values: T[] = [];
    const issues: V2DataIssue[] = [];
    for (const raw of records) {
      const upgraded = upgradeRecord(store, raw);
      if (upgraded && validator(upgraded.payload)) {
        if (upgraded.formatVersion !== raw.formatVersion) await this.put(store, upgraded.id, upgraded.payload, upgraded.updatedAt);
        values.push(deepClone(upgraded.payload));
      } else issues.push(await this.quarantine(store, isRecord(raw) ? raw.id : 'unknown', 'Unsupported or malformed v2 record. The original value has been retained in quarantine.', raw));
    }
    return { value: values, issues };
  }

  private async remove(store: StoreName, id: string): Promise<void> {
    getMemoryStore(store).delete(id);
    if (!canUseIndexedDb()) return;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(store, 'readwrite');
      transaction.objectStore(store).delete(id);
      await transactionDone(transaction);
    } finally { database.close(); }
  }

  async loadWorkspace(): Promise<V2ReadResult<WorkspaceState>> { return this.get('workspace', WORKSPACE_ID, isWorkspace); }
  async saveWorkspace(workspace: WorkspaceState): Promise<void> { await this.put('workspace', WORKSPACE_ID, workspace); }

  async saveRun(run: AgentRun): Promise<void> { await this.put('runs', run.id, run, run.updatedAt); }
  async loadRun(runId: string): Promise<V2ReadResult<AgentRun>> { return this.get('runs', runId, isRun); }
  async listRuns(sessionId?: string): Promise<V2ListResult<AgentRun>> {
    const result = await this.list('runs', isRun);
    return { ...result, value: result.value.filter((run) => !sessionId || run.sessionId === sessionId).sort((left, right) => right.updatedAt - left.updatedAt) };
  }

  async appendEvent(event: AgentEvent): Promise<void> { if (!event.transient) await this.put('events', event.id, event, event.createdAt); }
  async listEvents(sessionId: string): Promise<V2ListResult<AgentEvent>> {
    const result = await this.list('events', isEvent);
    return { ...result, value: sortEvents(result.value.filter((event) => event.sessionId === sessionId)) };
  }

  async saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> { await this.put('checkpoints', checkpoint.id, checkpoint, checkpoint.createdAt); }
  async latestCheckpoint(runId: string): Promise<V2ReadResult<AgentCheckpoint>> {
    const result = await this.list('checkpoints', isCheckpoint);
    const value = result.value.filter((checkpoint) => checkpoint.runId === runId).sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
    return { value, issues: result.issues };
  }

  async loadTerminalHistory(sessionId: string): Promise<V2ReadResult<string>> {
    const result = await this.get('terminalHistory', sessionId, (value): value is { sessionId: string; content: string; updatedAt: number } => Boolean(value && typeof value === 'object' && typeof (value as { content?: unknown }).content === 'string'));
    return { value: result.value?.content ?? null, issues: result.issues };
  }
  async saveTerminalHistory(sessionId: string, content: string): Promise<void> { await this.put('terminalHistory', sessionId, { sessionId, content, updatedAt: Date.now() }); }

  async loadSnapshot(containerId: string): Promise<V2ReadResult<FileSystemTree>> {
    const result = await this.get('snapshots', containerId, (value): value is { containerId: string; tree: FileSystemTree; updatedAt: number } => Boolean(value && typeof value === 'object' && 'tree' in value));
    return { value: result.value?.tree ?? null, issues: result.issues };
  }
  async saveSnapshot(containerId: string, tree: FileSystemTree): Promise<void> { await this.put('snapshots', containerId, { containerId, tree, updatedAt: Date.now() }); }

  async listIssues(): Promise<V2DataIssue[]> {
    let values = Array.from(memoryIssues.values()).map((entry) => entry.issue);
    if (canUseIndexedDb()) {
      const database = await openDatabase();
      try {
        const transaction = database.transaction('quarantine', 'readonly');
        const records = await requestResult(transaction.objectStore('quarantine').getAll()) as StoredValue<QuarantinedValue>[];
        values = records.filter((record) => isRecord(record) && record.formatVersion === V2_PERSISTENCE_VERSION).map((record) => record.payload.issue);
      } finally { database.close(); }
    }
    return values.sort((left, right) => right.createdAt - left.createdAt);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const [runs, events, checkpoints] = await Promise.all([this.listRuns(sessionId), this.listEvents(sessionId), this.list('checkpoints', isCheckpoint)]);
    await Promise.all([
      ...runs.value.map((run) => this.remove('runs', run.id)),
      ...events.value.map((event) => this.remove('events', event.id)),
      ...checkpoints.value.filter((checkpoint) => checkpoint.sessionId === sessionId).map((checkpoint) => this.remove('checkpoints', checkpoint.id)),
      this.remove('terminalHistory', sessionId),
    ]);
  }

  async deleteContainer(containerId: string): Promise<void> {
    const [runs, checkpoints] = await Promise.all([this.listRuns(), this.list('checkpoints', isCheckpoint)]);
    await Promise.all([
      ...runs.value.filter((run) => run.containerId === containerId).map((run) => this.remove('runs', run.id)),
      ...checkpoints.value.filter((checkpoint) => checkpoint.containerId === containerId).map((checkpoint) => this.remove('checkpoints', checkpoint.id)),
      this.remove('snapshots', containerId),
    ]);
  }

  async clearAll(): Promise<void> {
    STORE_NAMES.forEach((store) => getMemoryStore(store).clear());
    memoryIssues.clear();
    if (!canUseIndexedDb()) return;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAMES, 'readwrite');
      STORE_NAMES.forEach((store) => transaction.objectStore(store).clear());
      await transactionDone(transaction);
    } finally { database.close(); }
  }

  async clearIssue(issueId: string): Promise<void> {
    memoryIssues.delete(issueId);
    await this.remove('quarantine', issueId);
  }

  async stats(): Promise<V2PersistenceStats> {
    const [workspace, runs, events, checkpoints, terminalHistory, snapshots, quarantine] = await Promise.all([
      this.list('workspace', isWorkspace), this.list('runs', isRun), this.list('events', isEvent), this.list('checkpoints', isCheckpoint), this.list('terminalHistory', (value): value is { content: string } => Boolean(value && typeof value === 'object' && typeof (value as { content?: unknown }).content === 'string')), this.list('snapshots', (value): value is { tree: FileSystemTree } => Boolean(value && typeof value === 'object' && 'tree' in value)), this.listIssues(),
    ]);
    const payload = [workspace.value, runs.value, events.value, checkpoints.value, terminalHistory.value, snapshots.value];
    return { records: { workspace: workspace.value.length, runs: runs.value.length, events: events.value.length, checkpoints: checkpoints.value.length, terminalHistory: terminalHistory.value.length, snapshots: snapshots.value.length, quarantine: quarantine.length }, approximateBytes: encodedSize(payload), issues: [...workspace.issues, ...runs.issues, ...events.issues, ...checkpoints.issues, ...terminalHistory.issues, ...snapshots.issues, ...quarantine] };
  }

  async exportBackup(): Promise<V2BackupEnvelope> {
    const [workspace, runs, events, checkpoints, terminalHistory, snapshots] = await Promise.all([
      this.loadWorkspace(), this.listRuns(), this.list('events', isEvent), this.list('checkpoints', isCheckpoint), this.list('terminalHistory', (value): value is { sessionId: string; content: string; updatedAt: number } => Boolean(value && typeof value === 'object' && typeof (value as { content?: unknown }).content === 'string')), this.list('snapshots', (value): value is { containerId: string; tree: FileSystemTree; updatedAt: number } => Boolean(value && typeof value === 'object' && 'tree' in value)),
    ]);
    return { formatVersion: V2_BACKUP_FORMAT_VERSION, exportedAt: Date.now(), payload: { workspace: workspace.value, runs: runs.value, events: events.value, checkpoints: checkpoints.value, terminalHistory: terminalHistory.value, snapshots: snapshots.value } };
  }

  async importBackup(input: unknown): Promise<V2ImportResult> {
    if (!input || typeof input !== 'object') throw new Error('Backup must be an object.');
    const backup = input as Partial<V2BackupEnvelope>;
    if (backup.formatVersion !== V2_BACKUP_FORMAT_VERSION || !backup.payload || typeof backup.payload !== 'object') throw new Error('Unsupported v2 backup format.');
    const payload = backup.payload as V2BackupEnvelope['payload'];
    if (payload.workspace && !isWorkspace(payload.workspace)) throw new Error('Backup workspace is malformed.');
    if (!Array.isArray(payload.runs) || !payload.runs.every(isRun) || !Array.isArray(payload.events) || !payload.events.every(isEvent) || !Array.isArray(payload.checkpoints) || !payload.checkpoints.every(isCheckpoint) || !Array.isArray(payload.terminalHistory) || !payload.terminalHistory.every((history) => Boolean(history && typeof history.sessionId === 'string' && typeof history.content === 'string')) || !Array.isArray(payload.snapshots) || !payload.snapshots.every((snapshot) => Boolean(snapshot && typeof snapshot.containerId === 'string' && snapshot.tree && typeof snapshot.tree === 'object'))) throw new Error('Backup contains malformed v2 records.');

    const current = await this.loadWorkspace();
    const sessionIds = new Map<string, string>();
    const containerIds = new Map<string, string>();
    const runIds = new Map<string, string>();
    const importedAt = Date.now();
    const importedSessions: Session[] = (payload.workspace?.sessions ?? []).map((session) => ({ ...session, id: remapId('s', session.id) }));
    const importedContainers: Container[] = (payload.workspace?.containers ?? []).map((container) => ({ ...container, id: remapId('c', container.id) }));
    (payload.workspace?.sessions ?? []).forEach((session, index) => sessionIds.set(session.id, importedSessions[index]!.id));
    (payload.workspace?.containers ?? []).forEach((container, index) => containerIds.set(container.id, importedContainers[index]!.id));
    payload.runs.forEach((run) => runIds.set(run.id, remapId('r', run.id)));
    const importedSessionId = (id: string) => {
      const existing = sessionIds.get(id);
      if (existing) return existing;
      const next = remapId('s', id);
      sessionIds.set(id, next);
      importedSessions.push({ id: next, title: `Imported session ${id.slice(-8) || 'item'}`, updatedAt: importedAt });
      return next;
    };
    const importedContainerId = (id: string) => {
      const existing = containerIds.get(id);
      if (existing) return existing;
      const next = remapId('c', id);
      containerIds.set(id, next);
      importedContainers.push({ id: next, name: `Imported container ${id.slice(-8) || 'item'}`, updatedAt: importedAt });
      return next;
    };
    const importedRunId = (id: string) => {
      const existing = runIds.get(id);
      if (existing) return existing;
      const next = remapId('r', id);
      runIds.set(id, next);
      return next;
    };

    // Discover orphan references before committing workspace metadata. A backup
    // can legitimately contain a run/checkpoint after its old session metadata
    // was removed; importing it must still leave a selectable home for recovery.
    payload.runs.forEach((run) => { importedSessionId(run.sessionId); importedContainerId(run.containerId); importedRunId(run.id); });
    payload.events.forEach((event) => { importedSessionId(event.sessionId); importedRunId(event.runId); if (event.kind === 'run_started') importedContainerId(event.run.containerId); });
    payload.checkpoints.forEach((checkpoint) => { importedSessionId(checkpoint.sessionId); importedContainerId(checkpoint.containerId); importedRunId(checkpoint.runId); });
    payload.terminalHistory.forEach((history) => importedSessionId(history.sessionId));
    payload.snapshots.forEach((snapshot) => importedContainerId(snapshot.containerId));

    const merged: WorkspaceState = {
      sessions: [...importedSessions, ...(current.value?.sessions ?? [])],
      containers: [...importedContainers, ...(current.value?.containers ?? [])],
      activeSessionId: current.value?.activeSessionId ?? importedSessions[0]?.id ?? null,
      activeContainerId: current.value?.activeContainerId ?? importedContainers[0]?.id ?? null,
    };
    await this.saveWorkspace(merged);
    for (const run of payload.runs) await this.saveRun({ ...run, id: importedRunId(run.id), sessionId: importedSessionId(run.sessionId), containerId: importedContainerId(run.containerId), phase: isActivePhase(run.phase) ? 'interrupted' : run.phase, updatedAt: importedAt, error: isActivePhase(run.phase) ? 'Imported run requires explicit user continuation.' : run.error });
    for (const event of payload.events) {
      const importedEvent = { ...event, id: remapId('e', event.id), runId: importedRunId(event.runId), sessionId: importedSessionId(event.sessionId) } as AgentEvent;
      if (importedEvent.kind === 'run_started') {
        const originalRun = importedEvent.run;
        importedEvent.run = { ...originalRun, id: importedRunId(originalRun.id), sessionId: importedSessionId(originalRun.sessionId), containerId: importedContainerId(originalRun.containerId), phase: isActivePhase(originalRun.phase) ? 'interrupted' : originalRun.phase, updatedAt: importedAt };
      }
      await this.appendEvent(importedEvent);
    }
    for (const checkpoint of payload.checkpoints) await this.saveCheckpoint({ ...checkpoint, id: remapId('cp', checkpoint.id), runId: importedRunId(checkpoint.runId), sessionId: importedSessionId(checkpoint.sessionId), containerId: importedContainerId(checkpoint.containerId), createdAt: importedAt });
    for (const history of payload.terminalHistory) {
      if (history && typeof history.sessionId === 'string' && typeof history.content === 'string') await this.saveTerminalHistory(importedSessionId(history.sessionId), history.content);
    }
    for (const snapshot of payload.snapshots) {
      if (snapshot && typeof snapshot.containerId === 'string' && snapshot.tree) await this.saveSnapshot(importedContainerId(snapshot.containerId), snapshot.tree);
    }
    return { sessions: importedSessions.length, containers: importedContainers.length, runs: payload.runs.length, events: payload.events.length, snapshots: payload.snapshots.length };
  }
}

function isActivePhase(phase: AgentRun['phase']): boolean {
  return ['preparing', 'planning', 'acting', 'observing', 'verifying', 'cancelling'].includes(phase);
}

export const v2Persistence = new V2PersistenceRepository();
