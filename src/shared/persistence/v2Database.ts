import { requestResult, requireIndexedDb, transactionDone } from './indexedDb';
import { V2_PERSISTENCE_DATABASE, V2_PERSISTENCE_VERSION, type V2StoreName } from './v2Schema';

function initializeSchema(database: IDBDatabase): void {
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
}

export class V2Database {
  private connection: Promise<IDBDatabase> | null = null;

  open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    this.connection = new Promise((resolve, reject) => {
      const request = requireIndexedDb().open(V2_PERSISTENCE_DATABASE, V2_PERSISTENCE_VERSION);
      request.onupgradeneeded = () => initializeSchema(request.result);
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

  async read<T>(store: V2StoreName, operation: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    return requestResult(operation(database.transaction(store, 'readonly').objectStore(store)));
  }

  async write(stores: V2StoreName | V2StoreName[], operation: (transaction: IDBTransaction) => void | Promise<void>): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(stores, 'readwrite');
    try {
      await operation(transaction);
      await transactionDone(transaction);
    } catch (error) {
      try { transaction.abort(); } catch { /* already completed or aborted */ }
      throw error;
    }
  }
}
