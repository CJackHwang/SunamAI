import { Session, SessionError } from '@earendil-works/pi-agent-core';
import type {
  BranchBounds,
  Entry,
  EntryOrder,
  EntryQuery,
  ForkOptions,
  LanePointer,
  LaneRecord,
  LogItem,
  LogOptions,
  NewRecord,
  OperationStartedRecord,
  ProvisionedEntry,
  RecordQuery,
  SessionCreateOptions,
  SessionMetadata,
  SessionRepo,
  SessionStats,
  SessionStorage,
} from '@earendil-works/pi-agent-core';
import { uuidv7 } from '@earendil-works/pi-ai';

/**
 * P2 pi 会话持久化：IndexedDB 版 SessionStorage / SessionRepo。
 *
 * 参考 pi 的 InMemorySessionStorage（内存）与 JsonlSessionStorage（文件追加日志）形态：
 * - 内存态保留一份完整会话状态（复刻 SessionState 语义），所有读走内存；
 * - 每次写操作先落一条「mutation」到 IndexedDB（追加式，按 [sessionId, seq] 唯一），
 *   再应用到内存态；刷新/重建时按 seq 顺序重放全部 mutation，恢复完整会话。
 * - 用浏览器原生 IndexedDB API，不引第三方库；数据库 `sunam-pi-sessions` 独立于 v3。
 *
 * 边界（TASK-P2 R4，如实标注）：
 * - 仅单标签页、单写入者模型：不跨设备、不跨标签页同步（多写入者需外部协调，P5 候选）。
 * - 受浏览器存储配额限制：QuotaExceededError / 事务失败会如实向上抛出，不静默回退内存。
 * - 与现有 v3 持久化（v3Repository，sunam-v3 库）完全独立，互不混用、互不迁移。
 * - 会话 ID 复用现有 UI 会话 ID；删除工作区时不会自动清理 pi 会话记录（需外部接入，P5 候选）。
 * - 本模块只负责 pi 会话历史持久化；pi 事件流的 UI 消息列表仍走现有 v3 事件存储，
 *   P1 未把 pi 事件写入 v3 store，因此刷新后 UI 列表不恢复 pi 消息（useAgentV2 逻辑零改动）。
 */

/** pi 会话 IndexedDB 数据库名（与 v3 的 sunam-v3 完全独立）。 */
export const PI_SESSIONS_DATABASE = 'sunam-pi-sessions';
export const PI_SESSIONS_DATABASE_VERSION = 1;

const META_STORE = 'meta';
const MUTATIONS_STORE = 'mutations';
const MUTATIONS_BY_SESSION_INDEX = 'bySession';

/** 持久化的 mutation：与 pi SessionState.applyMutation 接收的形状一致。 */
type PersistedMutation =
  | { kind: 'entry'; lane?: string; entry: Entry }
  | { kind: 'record'; record: LaneRecord }
  | { kind: 'lane'; seq: number; lane: string; leafId: string | null }
  | { kind: 'fact'; seq: number; fact: 'name'; name: string }
  | { kind: 'fact'; seq: number; fact: 'label'; targetId: string; label: string | undefined };

interface MutationRecord {
  sessionId: string;
  seq: number;
  mutation: PersistedMutation;
}

// ---- IndexedDB 连接与事务辅助 ----

const connectionCache = new Map<string, Promise<IDBDatabase>>();

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

function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, PI_SESSIONS_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MUTATIONS_STORE)) {
        const store = db.createObjectStore(MUTATIONS_STORE, { keyPath: ['sessionId', 'seq'] });
        store.createIndex(MUTATIONS_BY_SESSION_INDEX, 'sessionId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 按数据库名缓存连接；同库的所有 storage/repo 共享同一连接。 */
function getDatabase(dbName: string): Promise<IDBDatabase> {
  let cached = connectionCache.get(dbName);
  if (!cached) {
    cached = openDatabase(dbName);
    connectionCache.set(dbName, cached);
  }
  return cached;
}

/** 关闭并移除缓存连接（测试隔离用；应用生命周期内无需调用）。 */
export async function disposeIndexedDb(dbName: string): Promise<void> {
  const cached = connectionCache.get(dbName);
  connectionCache.delete(dbName);
  if (cached) {
    try {
      (await cached).close();
    } catch {
      // 连接打开失败则无需关闭。
    }
  }
}

/** 删除整个数据库（测试隔离用）。 */
export async function deleteIndexedDb(dbName: string): Promise<void> {
  await disposeIndexedDb(dbName);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`deleteDatabase blocked for ${dbName}`));
  });
}

async function putMeta(db: IDBDatabase, metadata: SessionMetadata): Promise<void> {
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put(metadata);
  await transactionDone(tx);
}

async function getMeta(db: IDBDatabase, sessionId: string): Promise<SessionMetadata | undefined> {
  const tx = db.transaction(META_STORE, 'readonly');
  const request = tx.objectStore(META_STORE).get(sessionId);
  return (await requestResult(request)) as SessionMetadata | undefined;
}

async function listMeta(db: IDBDatabase): Promise<SessionMetadata[]> {
  const tx = db.transaction(META_STORE, 'readonly');
  const request = tx.objectStore(META_STORE).getAll();
  const records = (await requestResult(request)) as SessionMetadata[];
  return records.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

async function putMutation(db: IDBDatabase, sessionId: string, seq: number, mutation: PersistedMutation): Promise<void> {
  const tx = db.transaction(MUTATIONS_STORE, 'readwrite');
  tx.objectStore(MUTATIONS_STORE).put({ sessionId, seq, mutation });
  await transactionDone(tx);
}

async function readMutations(db: IDBDatabase, sessionId: string): Promise<PersistedMutation[]> {
  const tx = db.transaction(MUTATIONS_STORE, 'readonly');
  const request = tx.objectStore(MUTATIONS_STORE).index(MUTATIONS_BY_SESSION_INDEX).getAll(sessionId);
  const records = (await requestResult(request)) as MutationRecord[];
  records.sort((left, right) => left.seq - right.seq);
  return records.map((record) => record.mutation);
}

/** 同一事务内删除 meta 记录与该会话的全部 mutations（游标逐条删除，避免异步间隙导致事务失活）。 */
async function deleteSession(db: IDBDatabase, sessionId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([META_STORE, MUTATIONS_STORE], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    tx.objectStore(META_STORE).delete(sessionId);
    const index = tx.objectStore(MUTATIONS_STORE).index(MUTATIONS_BY_SESSION_INDEX);
    const cursorRequest = index.openCursor(IDBKeyRange.only(sessionId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  });
}

function mutationSeq(mutation: PersistedMutation): number {
  if (mutation.kind === 'entry') return mutation.entry.seq;
  if (mutation.kind === 'record') return mutation.record.seq;
  return mutation.seq;
}

// ---- 查询参数校验（对齐 pi SessionState） ----

function assertValidLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new SessionError('invalid_query', 'limit must be a positive integer');
  }
}

function assertValidCursor(afterSeq: number | undefined): void {
  if (afterSeq !== undefined && (!Number.isInteger(afterSeq) || afterSeq < 0)) {
    throw new SessionError('invalid_query', 'cursor sequence must be a non-negative integer');
  }
}

function* ordered<T>(items: T[], order?: EntryOrder): Generator<T> {
  if (order === 'oldestFirst') {
    yield* items;
    return;
  }
  for (let index = items.length - 1; index >= 0; index--) yield items[index]!;
}

// ---- 会话状态（复刻 pi SessionState 语义） ----

/**
 * 内存态会话状态：复刻 @earendil-works/pi-agent-core 内部 SessionState 的行为
 * （seq 连续分配、usedIds 去重、lane 链校验、log 有序、stats 累计、fork 语义），
 * 使 IndexedDB 后端与 InMemory 后端的读/校验行为完全一致。此类不直接暴露。
 */
class IndexedDbSessionState {
  sequence = 0;
  usedIds = new Set<string>();
  entries: Entry[] = [];
  entriesById = new Map<string, Entry>();
  records: LaneRecord[] = [];
  openOperationsByLane = new Map<string, Map<string, OperationStartedRecord>>();
  lanes = new Map<string, string | null>([['main', null]]);
  log: LogItem[] = [];
  stats: SessionStats = {
    messageCount: 0,
    cachedTokens: 0,
    uncachedTokens: 0,
    totalTokens: 0,
    costTotal: 0,
  };
  name: string | undefined;
  labels = new Map<string, string>();

  get nextSequence(): number {
    return this.sequence + 1;
  }

  getLanes(): LanePointer[] {
    return [...this.lanes].map(([lane, leafId]) => ({ lane, leafId }));
  }

  requireLane(lane: string): string | null {
    const leafId = this.lanes.get(lane);
    if (leafId === undefined) throw new SessionError('invalid_lane', `Lane not found: ${lane}`);
    return leafId;
  }

  validateNewLane(lane: string): void {
    if (this.lanes.has(lane)) throw new SessionError('already_exists', `Lane already exists: ${lane}`);
  }

  validateTarget(targetId: string | null): void {
    if (targetId !== null && !this.entriesById.has(targetId)) {
      throw new SessionError('not_found', `Entry not found: ${targetId}`);
    }
  }

  validateUnusedId(id: string): void {
    if (this.usedIds.has(id)) throw new SessionError('already_exists', `Session id already exists: ${id}`);
  }

  applyMutation(mutation: PersistedMutation): void {
    const seq = mutation.kind === 'entry' ? mutation.entry.seq : mutation.kind === 'record' ? mutation.record.seq : mutation.seq;
    if (seq !== this.sequence + 1) {
      throw new SessionError('invalid_entry', `Invalid session mutation: has non-consecutive seq ${seq}`);
    }
    switch (mutation.kind) {
      case 'entry': {
        if (this.usedIds.has(mutation.entry.id)) {
          throw new SessionError('invalid_entry', `Invalid session mutation: contains duplicate id ${mutation.entry.id}`);
        }
        if (mutation.lane !== undefined) {
          const leafId = this.lanes.get(mutation.lane);
          if (leafId === undefined) {
            throw new SessionError('invalid_entry', `Invalid session mutation: references missing lane ${mutation.lane}`);
          }
          if (mutation.entry.parentId !== leafId) {
            throw new SessionError('invalid_entry', 'Invalid session mutation: does not chain to the lane leaf');
          }
        }
        if (mutation.entry.parentId !== null && !this.entriesById.has(mutation.entry.parentId)) {
          throw new SessionError('invalid_entry', `Invalid session mutation: references missing parent ${mutation.entry.parentId}`);
        }
        this.sequence = seq;
        this.usedIds.add(mutation.entry.id);
        this.entries.push(mutation.entry);
        this.entriesById.set(mutation.entry.id, mutation.entry);
        if (mutation.lane !== undefined) this.lanes.set(mutation.lane, mutation.entry.id);
        this.log.push({ kind: 'entry', seq, entry: mutation.entry });
        if (mutation.entry.type === 'message') this.stats.messageCount += 1;
        break;
      }
      case 'record': {
        if (!this.lanes.has(mutation.record.lane)) {
          throw new SessionError('invalid_entry', `Invalid session mutation: references missing lane ${mutation.record.lane}`);
        }
        if (this.usedIds.has(mutation.record.id)) {
          throw new SessionError('invalid_entry', `Invalid session mutation: contains duplicate id ${mutation.record.id}`);
        }
        this.sequence = seq;
        this.usedIds.add(mutation.record.id);
        this.records.push(mutation.record);
        if (mutation.record.type === 'operation_started') {
          let openOperations = this.openOperationsByLane.get(mutation.record.lane);
          if (!openOperations) {
            openOperations = new Map();
            this.openOperationsByLane.set(mutation.record.lane, openOperations);
          }
          openOperations.set(mutation.record.id, mutation.record);
        } else if (mutation.record.type === 'operation_finished') {
          this.openOperationsByLane.get(mutation.record.lane)?.delete(mutation.record.runId);
        }
        this.log.push({ kind: 'record', seq, record: mutation.record });
        if (mutation.record.type === 'usage') {
          this.stats.cachedTokens += mutation.record.usage.cacheRead;
          this.stats.uncachedTokens += mutation.record.usage.input + mutation.record.usage.cacheWrite;
          this.stats.totalTokens += mutation.record.usage.totalTokens;
          this.stats.costTotal += mutation.record.usage.cost.total;
        }
        break;
      }
      case 'lane':
        if (mutation.leafId !== null && !this.entriesById.has(mutation.leafId)) {
          throw new SessionError('invalid_entry', `Invalid session mutation: references missing lane target ${mutation.leafId}`);
        }
        this.sequence = seq;
        this.lanes.set(mutation.lane, mutation.leafId);
        this.log.push({ kind: 'lane', seq, lane: mutation.lane, leafId: mutation.leafId });
        break;
      case 'fact':
        if (mutation.fact === 'label' && !this.entriesById.has(mutation.targetId)) {
          throw new SessionError('invalid_entry', `Invalid session mutation: references missing label target ${mutation.targetId}`);
        }
        this.sequence = seq;
        if (mutation.fact === 'name') {
          this.name = mutation.name;
          this.log.push({ kind: 'fact', seq, fact: 'name', name: mutation.name });
        } else {
          if (mutation.label === undefined) this.labels.delete(mutation.targetId);
          else this.labels.set(mutation.targetId, mutation.label);
          this.log.push({ kind: 'fact', seq, fact: 'label', targetId: mutation.targetId, label: mutation.label });
        }
        break;
    }
  }

  getEntry(id: string): Entry | undefined {
    return this.entriesById.get(id);
  }

  findEntries(query: EntryQuery = {}): Entry[] {
    assertValidLimit(query.limit);
    assertValidCursor(query.cursor?.afterSeq);
    const results: Entry[] = [];
    for (const entry of ordered(this.entries, query.order)) {
      if (!this.matchesEntryQuery(entry, query)) continue;
      results.push(entry);
      if (results.length === query.limit) break;
    }
    return results;
  }

  findEntriesOnBranch(query: EntryQuery & BranchBounds & { start: string }): Entry[] {
    assertValidLimit(query.limit);
    assertValidCursor(query.cursor?.afterSeq);
    const results: Entry[] = [];
    if (query.order === 'oldestFirst') {
      for (const entry of [...this.walkToRoot(query.start)].reverse()) {
        const reachedBound = entry.id === query.stopAtId || entry.type === query.stopAtType;
        if (this.matchesEntryQuery(entry, query)) results.push(entry);
        if (reachedBound || results.length === query.limit) break;
      }
    } else {
      for (const entry of this.walkToRoot(query.start, query)) {
        if (this.matchesEntryQuery(entry, query)) results.push(entry);
        if (results.length === query.limit) break;
      }
    }
    return results;
  }

  findRecords(query: RecordQuery = {}): LaneRecord[] {
    assertValidLimit(query.limit);
    assertValidCursor(query.afterSeq);
    const results: LaneRecord[] = [];
    for (const record of ordered(this.records, query.order)) {
      if (!this.matchesRecordQuery(record, query)) continue;
      results.push(record);
      if (results.length === query.limit) break;
    }
    return results;
  }

  findOpenOperations(lane: string, options?: { limit?: number }): OperationStartedRecord[] {
    assertValidLimit(options?.limit);
    const openOperationsById = this.openOperationsByLane.get(lane);
    const openOperations = openOperationsById ? [...openOperationsById.values()].reverse() : [];
    return options?.limit === undefined ? openOperations : openOperations.slice(0, options.limit);
  }

  getLog(options: LogOptions = {}): LogItem[] {
    assertValidLimit(options.limit);
    assertValidCursor(options.afterSeq);
    const results: LogItem[] = [];
    for (const item of this.log) {
      if (options.afterSeq !== undefined && item.seq <= options.afterSeq) continue;
      results.push(item);
      if (results.length === options.limit) break;
    }
    return results;
  }

  getName(): string | undefined {
    return this.name;
  }

  getLabel(id: string): string | undefined {
    return this.labels.get(id);
  }

  getStats(): SessionStats {
    return this.stats;
  }

  /** 复刻 SessionState.createForkMutations：产出可在新会话重放的 mutation 序列。 */
  createForkMutations(options: ForkOptions): PersistedMutation[] {
    let copiedEntries: Entry[];
    let forkLanes: LanePointer[];
    if (options.scope === 'tree') {
      copiedEntries = this.findEntries({ order: 'oldestFirst' });
      forkLanes = this.getLanes();
    } else {
      const selectedEntryId = options.entryId ?? this.requireLane('main');
      let targetId: string | null = null;
      if (selectedEntryId !== null) {
        const entry = this.getEntry(selectedEntryId);
        if (!entry || entry.type !== 'message') {
          throw new SessionError('invalid_fork_target', `Fork target is not a message entry: ${selectedEntryId}`);
        }
        const position = options.position ?? (options.entryId === undefined ? 'at' : 'before');
        targetId = position === 'at' ? entry.id : entry.parentId;
      }
      copiedEntries = targetId === null ? [] : this.findEntriesOnBranch({ start: targetId, order: 'oldestFirst' });
      forkLanes = [{ lane: 'main', leafId: targetId }];
    }
    const mutations: PersistedMutation[] = [];
    let sequence = 1;
    for (const sourceEntry of copiedEntries) {
      mutations.push({ kind: 'entry', entry: { ...structuredClone(sourceEntry), seq: sequence++ } as Entry });
    }
    for (const pointer of forkLanes) {
      mutations.push({ kind: 'lane', seq: sequence++, lane: pointer.lane, leafId: pointer.leafId });
    }
    if (this.name !== undefined) {
      mutations.push({ kind: 'fact', seq: sequence++, fact: 'name', name: this.name });
    }
    for (const entry of copiedEntries) {
      const label = this.labels.get(entry.id);
      if (label !== undefined) {
        mutations.push({ kind: 'fact', seq: sequence++, fact: 'label', targetId: entry.id, label });
      }
    }
    return mutations;
  }

  private *walkToRoot(start: string, bounds?: BranchBounds): Generator<Entry> {
    const visited = new Set<string>();
    let current = this.entriesById.get(start);
    if (!current) throw new SessionError('not_found', `Entry not found: ${start}`);
    while (current) {
      if (visited.has(current.id)) {
        throw new SessionError('invalid_entry', `Session branch contains a cycle at ${current.id}`);
      }
      visited.add(current.id);
      yield current;
      if (current.id === bounds?.stopAtId || current.type === bounds?.stopAtType || current.parentId === null) break;
      const parentId = current.parentId;
      const parent = this.entriesById.get(parentId);
      if (!parent) throw new SessionError('invalid_entry', `Entry not found: ${parentId}`);
      current = parent;
    }
  }

  private matchesEntryQuery(entry: Entry, query: EntryQuery): boolean {
    return (query.type === undefined || entry.type === query.type)
      && (query.customType === undefined || (entry.type === 'custom' && entry.customType === query.customType))
      && (query.cursor === undefined
        || (query.order === 'oldestFirst' ? entry.seq > query.cursor.afterSeq : entry.seq < query.cursor.afterSeq));
  }

  private matchesRecordQuery(record: LaneRecord, query: RecordQuery): boolean {
    return (query.lane === undefined || record.lane === query.lane)
      && (query.type === undefined || record.type === query.type)
      && (query.runId === undefined
        || (record.type === 'operation_started'
          ? record.id === query.runId
          : 'runId' in record && record.runId === query.runId))
      && (query.operationKind === undefined
        || (record.type === 'operation_started' && record.intent.kind === query.operationKind))
      && (query.afterSeq === undefined || record.seq > query.afterSeq);
  }
}

// ---- IndexedDbSessionStorage ----

/**
 * IndexedDB 持久化的 SessionStorage。语义与 InMemorySessionStorage 完全一致，
 * 每次写操作把 mutation 追加写入 IndexedDB，读取全部走内存态；构造时可选
 * 从已有 mutation 日志重放恢复（刷新持久化的核心）。
 */
export class IndexedDbSessionStorage implements SessionStorage<SessionMetadata> {
  private readonly dbName: string;
  private readonly db: Promise<IDBDatabase>;
  private readonly metadata: SessionMetadata;
  private readonly state: IndexedDbSessionState;
  private tail: Promise<unknown> = Promise.resolve();

  private constructor(dbName: string, metadata: SessionMetadata, state: IndexedDbSessionState) {
    this.dbName = dbName;
    this.db = getDatabase(dbName);
    this.metadata = structuredClone(metadata);
    this.state = state;
  }

  /** 新建会话：写入 meta 记录并返回空状态 storage。 */
  static async create(dbName: string, metadata: SessionMetadata): Promise<IndexedDbSessionStorage> {
    const db = await getDatabase(dbName);
    await putMeta(db, metadata);
    return new IndexedDbSessionStorage(dbName, metadata, new IndexedDbSessionState());
  }

  /** 加载已有会话：读取 meta 并重放 mutation 日志；不存在返回 undefined。 */
  static async load(dbName: string, sessionId: string): Promise<IndexedDbSessionStorage | undefined> {
    const db = await getDatabase(dbName);
    const metadata = await getMeta(db, sessionId);
    if (metadata === undefined) return undefined;
    const mutations = await readMutations(db, sessionId);
    const state = new IndexedDbSessionState();
    for (const mutation of mutations) state.applyMutation(mutation);
    return new IndexedDbSessionStorage(dbName, metadata, state);
  }

  /** 派生新会话：复刻 source 的 fork mutation 到全新 storage 并持久化。 */
  fork(metadata: SessionMetadata, options: ForkOptions & SessionCreateOptions): Promise<IndexedDbSessionStorage> {
    return this.enqueue(async () => {
      const mutations = this.state.createForkMutations(options);
      const storage = await IndexedDbSessionStorage.create(this.dbName, metadata);
      for (const mutation of mutations) {
        await storage.appendMutation(mutation);
        storage.state.applyMutation(mutation);
      }
      return storage;
    });
  }

  /** 等待所有已入队的写操作完成（测试/销毁前冲刷用）。 */
  async drain(): Promise<void> {
    await this.tail;
  }

  async getMetadata(): Promise<SessionMetadata> {
    return structuredClone(this.metadata);
  }

  async getLanes(): Promise<LanePointer[]> {
    return structuredClone(this.state.getLanes());
  }

  createLane(lane: string, at: string | null): Promise<void> {
    return this.enqueue(async () => {
      this.state.validateNewLane(lane);
      this.state.validateTarget(at);
      const mutation: PersistedMutation = { kind: 'lane', seq: this.state.nextSequence, lane, leafId: at };
      await this.appendMutation(mutation);
      this.state.applyMutation(mutation);
    });
  }

  moveLane(lane: string, to: string | null): Promise<void> {
    return this.enqueue(async () => {
      this.state.requireLane(lane);
      this.state.validateTarget(to);
      const mutation: PersistedMutation = { kind: 'lane', seq: this.state.nextSequence, lane, leafId: to };
      await this.appendMutation(mutation);
      this.state.applyMutation(mutation);
    });
  }

  appendEntry<TEntry extends Entry>(newEntry: ProvisionedEntry<TEntry>, lane: string): Promise<TEntry> {
    return this.enqueue(async () => {
      const parentId = this.state.requireLane(lane);
      this.state.validateUnusedId(newEntry.id);
      const entry = {
        ...structuredClone(newEntry),
        parentId,
        seq: this.state.nextSequence,
        timestamp: Date.now(),
      } as unknown as TEntry;
      const mutation: PersistedMutation = { kind: 'entry', lane, entry };
      await this.appendMutation(mutation);
      this.state.applyMutation(mutation);
      return structuredClone(entry);
    });
  }

  appendRecord<TRecord extends LaneRecord>(newRecord: NewRecord<TRecord>): Promise<TRecord> {
    return this.enqueue(async () => {
      this.state.requireLane(newRecord.lane);
      this.state.validateUnusedId(newRecord.id);
      const currentOpenOperationId = this.state.findOpenOperations(newRecord.lane, { limit: 1 })[0]?.id;
      if (newRecord.type === 'operation_started' && currentOpenOperationId !== undefined) {
        throw new SessionError('storage', `Lane ${newRecord.lane} already has an open operation ${currentOpenOperationId}`);
      }
      const record = {
        ...structuredClone(newRecord),
        seq: this.state.nextSequence,
        timestamp: Date.now(),
      } as unknown as TRecord;
      const mutation: PersistedMutation = { kind: 'record', record };
      await this.appendMutation(mutation);
      this.state.applyMutation(mutation);
      return structuredClone(record);
    });
  }

  async getEntry(id: string): Promise<Entry | undefined> {
    const entry = this.state.getEntry(id);
    return entry === undefined ? undefined : structuredClone(entry);
  }

  async findEntries(query: EntryQuery = {}): Promise<Entry[]> {
    return structuredClone(this.state.findEntries(query));
  }

  async findEntriesOnBranch(query: EntryQuery & BranchBounds & { start: string }): Promise<Entry[]> {
    return structuredClone(this.state.findEntriesOnBranch(query));
  }

  findRecords<K extends LaneRecord['type']>(query: RecordQuery & { type: K }): Promise<Extract<LaneRecord, { type: K }>[]>;
  findRecords(query?: RecordQuery): Promise<LaneRecord[]>;
  findRecords(query: RecordQuery = {}): Promise<LaneRecord[]> {
    return Promise.resolve(structuredClone(this.state.findRecords(query)));
  }

  async findOpenOperations(lane: string, options?: { limit?: number }): Promise<OperationStartedRecord[]> {
    return structuredClone(this.state.findOpenOperations(lane, options));
  }

  async getLog(options: LogOptions = {}): Promise<LogItem[]> {
    return structuredClone(this.state.getLog(options));
  }

  async getName(): Promise<string | undefined> {
    return this.state.getName();
  }

  setName(name: string): Promise<void> {
    return this.enqueue(async () => {
      const mutation: PersistedMutation = { kind: 'fact', seq: this.state.nextSequence, fact: 'name', name };
      await this.appendMutation(mutation);
      this.state.applyMutation(mutation);
    });
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.state.getLabel(id);
  }

  setLabel(id: string, label: string | undefined): Promise<void> {
    return this.enqueue(async () => {
      this.state.validateTarget(id);
      const mutation: PersistedMutation = { kind: 'fact', seq: this.state.nextSequence, fact: 'label', targetId: id, label };
      await this.appendMutation(mutation);
      this.state.applyMutation(mutation);
    });
  }

  async getStats(): Promise<SessionStats> {
    return structuredClone(this.state.getStats());
  }

  /** 串行化本实例的所有写操作（对齐 JsonlSessionStorage 的 tail 队列）。 */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async appendMutation(mutation: PersistedMutation): Promise<void> {
    await putMutation(await this.db, this.metadata.id, mutationSeq(mutation), mutation);
  }
}

// ---- IndexedDbSessionRepo ----

/**
 * IndexedDB 持久化的 SessionRepo：多会话元数据持久化在 meta store，
 * 会话内容以 mutation 日志持久化在 mutations store。
 */
export class IndexedDbSessionRepo implements SessionRepo<SessionMetadata, SessionCreateOptions, void> {
  private readonly dbName: string;

  constructor(dbName: string = PI_SESSIONS_DATABASE) {
    this.dbName = dbName;
  }

  async create(options: SessionCreateOptions = {}): Promise<Session<SessionMetadata>> {
    const db = await getDatabase(this.dbName);
    const id = options.id ?? uuidv7();
    if ((await getMeta(db, id)) !== undefined) {
      throw new SessionError('already_exists', `Session already exists: ${id}`);
    }
    const metadata: SessionMetadata = {
      id,
      createdAt: Date.now(),
      ...(options.parentSessionId !== undefined ? { parentSessionId: options.parentSessionId } : {}),
    };
    const storage = await IndexedDbSessionStorage.create(this.dbName, metadata);
    return new Session(storage);
  }

  async open(metadata: SessionMetadata): Promise<Session<SessionMetadata>> {
    const storage = await IndexedDbSessionStorage.load(this.dbName, metadata.id);
    if (!storage) throw new SessionError('not_found', `Session not found: ${metadata.id}`);
    return new Session(storage);
  }

  /** 打开已有会话；不存在则按给定 id 创建（会话 ID 与现有 UI 会话 ID 对齐）。 */
  async openOrCreate(sessionId: string): Promise<Session<SessionMetadata>> {
    const storage = await IndexedDbSessionStorage.load(this.dbName, sessionId);
    if (storage) return new Session(storage);
    return this.create({ id: sessionId });
  }

  async list(): Promise<SessionMetadata[]> {
    const db = await getDatabase(this.dbName);
    return listMeta(db);
  }

  async delete(metadata: SessionMetadata): Promise<void> {
    const db = await getDatabase(this.dbName);
    await deleteSession(db, metadata.id);
  }

  async fork(source: SessionMetadata, options: ForkOptions & SessionCreateOptions = {}): Promise<Session<SessionMetadata>> {
    const sourceStorage = await IndexedDbSessionStorage.load(this.dbName, source.id);
    if (!sourceStorage) throw new SessionError('not_found', `Session not found: ${source.id}`);
    const id = options.id ?? uuidv7();
    const db = await getDatabase(this.dbName);
    if ((await getMeta(db, id)) !== undefined) {
      throw new SessionError('already_exists', `Session already exists: ${id}`);
    }
    const metadata: SessionMetadata = {
      id,
      createdAt: Date.now(),
      parentSessionId: options.parentSessionId ?? source.id,
    };
    const storage = await sourceStorage.fork(metadata, options);
    return new Session(storage);
  }
}
