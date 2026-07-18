import { WebContainer } from '@webcontainer/api';

const DB_NAME = 'sunam-webcontainer';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'latest';

// Directories to skip when taking a snapshot (node_modules is huge and can be reinstalled)
const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Open (or create) the IndexedDB database.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Recursively read the WebContainer filesystem into a FileSystemTree object.
 * Skips node_modules and .git for performance.
 */
async function readFsTree(fs: WebContainer['fs'], dirPath: string): Promise<Record<string, any>> {
  const tree: Record<string, any> = {};
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const name = entry.name;

    if (SKIP_DIRS.has(name)) continue;

    const fullPath = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`;

    if (entry.isDirectory()) {
      tree[name] = {
        directory: await readFsTree(fs, fullPath),
      };
    } else {
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        tree[name] = {
          file: { contents: content },
        };
      } catch {
        // Skip files that can't be read (binary, special, etc.)
      }
    }
  }

  return tree;
}

/**
 * Save the WebContainer filesystem to IndexedDB as a FileSystemTree.
 * Skips node_modules (can be reinstalled with npm install).
 */
export async function saveSnapshot(wc: WebContainer): Promise<void> {
  try {
    const tree = await readFsTree(wc.fs, '/');
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.put(
      {
        tree,
        timestamp: Date.now(),
      },
      SNAPSHOT_KEY
    );

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    console.log('[Persistence] Snapshot saved.');
  } catch (err) {
    console.error('[Persistence] Failed to save snapshot:', err);
  }
}

/**
 * Load the latest snapshot from IndexedDB.
 * Returns a FileSystemTree suitable for wc.mount(), or null if none exists.
 */
export async function loadSnapshot(): Promise<Record<string, any> | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(SNAPSHOT_KEY);

    const result = await new Promise<any>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();

    if (result?.tree) {
      console.log(`[Persistence] Snapshot loaded (saved at ${new Date(result.timestamp).toLocaleString()}).`);
      return result.tree;
    }

    console.log('[Persistence] No snapshot found.');
    return null;
  } catch (err) {
    console.error('[Persistence] Failed to load snapshot:', err);
    return null;
  }
}

/**
 * Clear the stored snapshot from IndexedDB.
 */
export async function clearSnapshot(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(SNAPSHOT_KEY);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    console.log('[Persistence] Snapshot cleared.');
  } catch (err) {
    console.error('[Persistence] Failed to clear snapshot:', err);
  }
}
