export const STORAGE_KEYS = {
  apiKey: 'sunam_v2_api_key',
  baseUrl: 'sunam_v2_base_url',
  apiModel: 'sunam_v2_api_model',
  sunamModel: 'sunam_v2_model',
  locale: 'sunam_v2_locale',
} as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

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
    console.warn(`[Storage] Failed to parse ${key}; using fallback`, error);
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T, storage = getBrowserStorage()): void {
  writeText(key, JSON.stringify(value), storage);
}
