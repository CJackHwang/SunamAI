export const STORAGE_KEYS = {
  apiKey: 'sunam_api_key',
  baseUrl: 'sunam_base_url',
  apiModel: 'sunam_api_model',
  sunamModel: 'sunam_model',
  locale: 'sunam_locale',
  schemaVersion: 'sunam_storage_schema_version',
  workspace: 'sunam_workspace_state',
  messagesPrefix: 'sunam_messages_',
  aiTerminalHistoryPrefix: 'sunam_ai_term_history_',
} as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const CURRENT_SCHEMA_VERSION = 2;

export function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readText(key: string, fallback = '', storage = getBrowserStorage()): string {
  try {
    return storage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeText(key: string, value: string, storage = getBrowserStorage()): void {
  try {
    storage?.setItem(key, value);
  } catch (error) {
    console.warn(`[Storage] Failed to write ${key}`, error);
  }
}

export function readJson<T>(key: string, fallback: T, storage = getBrowserStorage()): T {
  const raw = readText(key, '', storage);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    // Keep a recoverable copy instead of destroying user data after an interrupted write.
    writeText(`${key}_corrupt_${Date.now()}`, raw, storage);
    console.warn(`[Storage] Failed to parse ${key}; using fallback`, error);
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T, storage = getBrowserStorage()): void {
  writeText(key, JSON.stringify(value), storage);
}

/** Adds a version marker without changing existing Sunam key names or values. */
export function ensureStorageSchema(storage = getBrowserStorage()): void {
  const version = Number(readText(STORAGE_KEYS.schemaVersion, '1', storage));
  if (!Number.isFinite(version) || version < CURRENT_SCHEMA_VERSION) {
    writeText(STORAGE_KEYS.schemaVersion, String(CURRENT_SCHEMA_VERSION), storage);
  }
}
