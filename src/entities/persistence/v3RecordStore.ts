import { requestResult } from './indexedDb';
import { V3Database } from './v3Database';
import { cloneValue, isStoredValue, V3_PERSISTENCE_VERSION, type QuarantinedValue, type StoredValue, type V3DataIssue, type V3ListResult, type V3ReadResult, type V3StoreName } from './v3Schema';

const MALFORMED_RECORD = 'Unsupported or malformed v3 record. The original value has been retained in quarantine.';

function recordIdOf(raw: unknown): string {
  return raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : 'unknown';
}

export function storedValue<T>(id: string, payload: T, updatedAt = Date.now()): StoredValue<T> {
  return { id, formatVersion: V3_PERSISTENCE_VERSION, updatedAt, payload: cloneValue(payload) };
}

export class V3QuarantineRepository {
  private readonly database: V3Database;
  constructor(database: V3Database) { this.database = database; }

  async retain(store: V3StoreName, recordId: string, raw: unknown): Promise<V3DataIssue> {
    const id = `issue-${store}-${recordId}`;
    const existing = await this.database.read('quarantine', (objectStore) => objectStore.get(id)) as StoredValue<QuarantinedValue> | undefined;
    if (existing && isStoredValue(existing) && existing.payload.issue) return existing.payload.issue;
    const issue: V3DataIssue = { id, store, recordId, message: MALFORMED_RECORD, createdAt: Date.now() };
    await this.database.write('quarantine', (transaction) => { transaction.objectStore('quarantine').put(storedValue(id, { issue, raw }, issue.createdAt)); });
    return issue;
  }

  async list(): Promise<V3DataIssue[]> {
    const records = await this.database.read('quarantine', (store) => store.getAll()) as StoredValue<QuarantinedValue>[];
    return records.filter(isStoredValue).map((record) => record.payload.issue).sort((left, right) => right.createdAt - left.createdAt);
  }
}

export class V3RecordStore<T> {
  private readonly database: V3Database;
  private readonly quarantine: V3QuarantineRepository;
  private readonly store: V3StoreName;
  private readonly validator: (value: unknown) => value is T;
  constructor(
    database: V3Database,
    quarantine: V3QuarantineRepository,
    store: V3StoreName,
    validator: (value: unknown) => value is T,
  ) {
    this.database = database;
    this.quarantine = quarantine;
    this.store = store;
    this.validator = validator;
  }

  async put(id: string, payload: T, updatedAt = Date.now()): Promise<void> {
    await this.database.write(this.store, async (transaction) => { await requestResult(transaction.objectStore(this.store).put(storedValue(id, payload, updatedAt))); });
  }

  async get(id: string): Promise<V3ReadResult<T>> {
    const raw = await this.database.read(this.store, (store) => store.get(id)) as unknown;
    if (raw === undefined || raw === null) return { value: null, issues: [] };
    if (!isStoredValue(raw) || !this.validator(raw.payload)) return { value: null, issues: [await this.quarantine.retain(this.store, id, raw)] };
    return { value: cloneValue(raw.payload), issues: [] };
  }

  async list(index?: { name: string; key: IDBValidKey }): Promise<V3ListResult<T>> {
    const database = await this.database.open();
    const transaction = database.transaction(this.store, 'readonly');
    const objectStore = transaction.objectStore(this.store);
    const records = await requestResult(index ? objectStore.index(index.name).getAll(IDBKeyRange.only(index.key)) : objectStore.getAll()) as unknown[];
    return this.validateMany(records);
  }

  async validateMany(records: unknown[]): Promise<V3ListResult<T>> {
    const value: T[] = [];
    const issues: V3DataIssue[] = [];
    for (const raw of records) {
      if (isStoredValue(raw) && this.validator(raw.payload)) value.push(cloneValue(raw.payload));
      else issues.push(await this.quarantine.retain(this.store, recordIdOf(raw), raw));
    }
    return { value, issues };
  }
}
