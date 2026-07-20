import { V2_PERSISTENCE_DATABASE } from '@/shared/persistence/v2Repository';

export function clearV2Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(V2_PERSISTENCE_DATABASE);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('v2 database deletion was blocked'));
  });
}
