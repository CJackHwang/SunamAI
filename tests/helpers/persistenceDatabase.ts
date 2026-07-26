import type { WorkspaceState } from '@/entities/workspace/types';
import { V3_PERSISTENCE_DATABASE } from '@/entities/persistence/v3Repository';

const LEGACY_V2_DATABASE = 'sunam-v2';
const LEGACY_V2_VERSION = 2;

function deleteDatabase(name: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`${label} database deletion was blocked`));
  });
}

export function clearLegacyV2Database(): Promise<void> {
  return deleteDatabase(LEGACY_V2_DATABASE, 'legacy v2');
}

export function clearV3Database(): Promise<void> {
  return deleteDatabase(V3_PERSISTENCE_DATABASE, 'v3');
}

export async function seedLegacyV2Workspace(workspace: WorkspaceState): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_V2_DATABASE, LEGACY_V2_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('workspace')) request.result.createObjectStore('workspace', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('workspace', 'readwrite');
      transaction.objectStore('workspace').put({ id: 'current', formatVersion: LEGACY_V2_VERSION, updatedAt: 1, payload: workspace });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function readLegacyV2Workspace(): Promise<WorkspaceState | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_V2_DATABASE, LEGACY_V2_VERSION);
    request.onsuccess = () => {
      const database = request.result;
      const get = database.transaction('workspace', 'readonly').objectStore('workspace').get('current');
      get.onsuccess = () => { database.close(); resolve((get.result as { payload?: WorkspaceState } | undefined)?.payload ?? null); };
      get.onerror = () => reject(get.error);
    };
    request.onerror = () => reject(request.error);
  });
}
