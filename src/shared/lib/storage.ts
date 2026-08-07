export const STORAGE_KEYS = {
  apiKey: 'sunam_v2_api_key',
  baseUrl: 'sunam_v2_base_url',
  apiModel: 'sunam_v2_api_model',
  sunamModel: 'sunam_v2_model',
  locale: 'sunam_v2_locale',
  capabilityConfig: 'sunam_v2_capability_config',
  piEngine: 'sunam_v2_feature_pi_engine',
  agentDriver: 'sunam_v2_agent_driver',
  terminalLayout: 'sunam_v2_terminal_layout',
  // R2：受限环境持久化标记（环境不支持 Succinix → 记录一次，下次不自动开启）。
  containerUnavailable: 'sunam_container_unavailable',
} as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): StorageLike | null {
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

export function removeText(key: string, storage = getBrowserStorage()): void {
  try {
    storage?.removeItem(key);
  } catch (error) {
    console.warn(`[Storage] Failed to remove ${key}`, error);
  }
}
