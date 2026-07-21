import { requestResult } from './indexedDb';
import { V2Database } from './v2Database';
import { cloneValue, isStoredValue, upgradeRecord, V2_PERSISTENCE_VERSION, type QuarantinedValue, type StoredValue, type V2DataIssue, type V2ListResult, type V2ReadResult, type V2StoreName } from './v2Schema';

const MALFORMED_RECORD = 'Unsupported or malformed v2 record. The original value has been retained in quarantine.';

function recordIdOf(raw: unknown): string {
  return raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string'
    ? (raw as { id: string }).id
    : 'unknown';
}

export class QuarantineRepository {
  private readonly database: V2Database;
  constructor(database: V2Database) { this.database = database; }

  async retain(store: V2StoreName, recordId: string, raw: unknown): Promise<V2DataIssue> {
    const id = `issue-${store}-${recordId}`;
    const existing = await this.database.read('quarantine', (objectStore) => objectStore.get(id)) as StoredValue<QuarantinedValue> | undefined;
    if (existing && isStoredValue(existing) && existing.payload.issue) return existing.payload.issue;
    const issue: V2DataIssue = { id, store, recordId, message: MALFORMED_RECORD, createdAt: Date.now() };
    const value: StoredValue<QuarantinedValue> = { id: issue.id, formatVersion: V2_PERSISTENCE_VERSION, updatedAt: issue.createdAt, payload: { issue, raw: cloneValue(raw) } };
    await this.database.write('quarantine', (transaction) => { transaction.objectStore('quarantine').put(value); });
    return issue;
  }

  async list(): Promise<V2DataIssue[]> {
    const records = await this.database.read('quarantine', (store) => store.getAll()) as StoredValue<QuarantinedValue>[];
    return records.filter((record) => isStoredValue(record) && record.formatVersion === V2_PERSISTENCE_VERSION).map((record) => record.payload.issue).sort((left, right) => right.createdAt - left.createdAt);
  }
}

export class V2RecordStore<T> {
  private readonly database: V2Database;
  private readonly quarantine: QuarantineRepository;
  private readonly store: V2StoreName;
  private readonly validator: (value: unknown) => value is T;

  constructor(database: V2Database, quarantine: QuarantineRepository, store: V2StoreName, validator: (value: unknown) => value is T) {
    this.database = database;
    this.quarantine = quarantine;
    this.store = store;
    this.validator = validator;
  }

  async put(id: string, payload: T, updatedAt = Date.now()): Promise<void> {
    const value: StoredValue<T> = { id, formatVersion: V2_PERSISTENCE_VERSION, updatedAt, payload: cloneValue(payload) };
    await this.database.write(this.store, (transaction) => { transaction.objectStore(this.store).put(value); });
  }

  async get(id: string): Promise<V2ReadResult<T>> {
    const raw = await this.database.read(this.store, (store) => store.get(id)) as unknown;
    if (raw === undefined || raw === null) return { value: null, issues: [] };
    const upgraded = upgradeRecord(this.store, raw);
    if (!upgraded || !this.validator(upgraded.record.payload)) return { value: null, issues: [await this.quarantine.retain(this.store, id, raw)] };
    if (upgraded.changed) await this.put(upgraded.record.id, upgraded.record.payload as T, upgraded.record.updatedAt);
    return { value: cloneValue(upgraded.record.payload as T), issues: [] };
  }

  async list(index?: { name: string; key: IDBValidKey }): Promise<V2ListResult<T>> {
    const database = await this.database.open();
    const transaction = database.transaction(this.store, 'readonly');
    const objectStore = transaction.objectStore(this.store);
    const records = await requestResult(index ? objectStore.index(index.name).getAll(IDBKeyRange.only(index.key)) : objectStore.getAll()) as StoredValue<unknown>[];
    const value: T[] = [];
    const issues: V2DataIssue[] = [];
    for (const raw of records) {
      const upgraded = upgradeRecord(this.store, raw);
      if (upgraded && this.validator(upgraded.record.payload)) {
        if (upgraded.changed) await this.put(upgraded.record.id, upgraded.record.payload as T, upgraded.record.updatedAt);
        value.push(cloneValue(upgraded.record.payload as T));
      } else {
        issues.push(await this.quarantine.retain(this.store, recordIdOf(raw), raw));
      }
    }
    return { value, issues };
  }
}
