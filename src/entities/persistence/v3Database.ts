import { requestResult, requireIndexedDb, transactionDone } from './indexedDb';
import { V3_PERSISTENCE_DATABASE, V3_PERSISTENCE_VERSION, type V3StoreName } from './v3Schema';

function initializeSchema(database: IDBDatabase, transaction: IDBTransaction): void {
  if (!database.objectStoreNames.contains('workspace')) database.createObjectStore('workspace', { keyPath: 'id' });
  if (!database.objectStoreNames.contains('runs')) {
    const store = database.createObjectStore('runs', { keyPath: 'id' });
    store.createIndex('sessionId', 'payload.sessionId');
    store.createIndex('containerId', 'payload.containerId');
    store.createIndex('rootRunId', 'payload.rootRunId');
  }
  let eventStore: IDBObjectStore;
  if (!database.objectStoreNames.contains('events')) {
    eventStore = database.createObjectStore('events', { keyPath: 'id' });
  } else {
    eventStore = transaction.objectStore('events');
  }
  if (!eventStore.indexNames.contains('sessionId')) {
    const store = eventStore;
    store.createIndex('sessionId', 'payload.sessionId');
    store.createIndex('runId', 'payload.runId');
    store.createIndex('sessionSequence', ['payload.sessionId', 'payload.sequence']);
    store.createIndex('sessionTimeline', ['payload.sessionId', 'payload.createdAt', 'payload.sequence']);
    store.createIndex('runSequence', ['payload.runId', 'payload.sequence'], { unique: true });
  }
  if (!eventStore.indexNames.contains('sessionTimelineStable')) eventStore.createIndex('sessionTimelineStable', ['payload.sessionId', 'payload.createdAt', 'payload.sequence', 'payload.id']);
  if (!database.objectStoreNames.contains('checkpoints')) {
    const store = database.createObjectStore('checkpoints', { keyPath: 'id' });
    store.createIndex('sessionId', 'payload.sessionId');
    store.createIndex('runId', 'payload.runId', { unique: true });
  }
  if (!database.objectStoreNames.contains('terminalHistory')) database.createObjectStore('terminalHistory', { keyPath: 'id' });
  if (!database.objectStoreNames.contains('snapshots')) database.createObjectStore('snapshots', { keyPath: 'id' });
  if (!database.objectStoreNames.contains('quarantine')) database.createObjectStore('quarantine', { keyPath: 'id' });
  if (!database.objectStoreNames.contains('resources')) {
    const store = database.createObjectStore('resources', { keyPath: 'id' });
    store.createIndex('sessionId', 'payload.sessionId');
    store.createIndex('sessionSha', ['payload.sessionId', 'payload.sha256'], { unique: true });
    store.createIndex('originatingRunId', 'payload.originatingRunId');
  }
  if (!database.objectStoreNames.contains('agentTasks')) {
    const store = database.createObjectStore('agentTasks', { keyPath: 'id' });
    store.createIndex('sessionId', 'payload.sessionId');
    store.createIndex('rootRunId', 'payload.rootRunId');
    store.createIndex('parentRunId', 'payload.parentRunId');
  }
}

export class V3Database {
  private connection: Promise<IDBDatabase> | null = null;

  open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    this.connection = new Promise((resolve, reject) => {
      const request = requireIndexedDb().open(V3_PERSISTENCE_DATABASE, V3_PERSISTENCE_VERSION);
      request.onupgradeneeded = () => initializeSchema(request.result, request.transaction!);
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); this.connection = null; };
        resolve(database);
      };
      request.onerror = () => { this.connection = null; reject(request.error); };
      request.onblocked = () => { this.connection = null; reject(new Error('The workspace database is blocked by another tab.')); };
    });
    return this.connection;
  }

  async read<T>(store: V3StoreName, operation: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    return requestResult(operation(database.transaction(store, 'readonly').objectStore(store)));
  }

  async write(stores: V3StoreName | V3StoreName[], operation: (transaction: IDBTransaction) => void | Promise<void>): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(stores, 'readwrite');
    try {
      await operation(transaction);
      await transactionDone(transaction);
    } catch (error) {
      try { transaction.abort(); } catch { /* transaction already closed */ }
      throw error;
    }
  }
}
