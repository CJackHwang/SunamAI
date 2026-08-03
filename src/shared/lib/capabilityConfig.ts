import { DEFAULT_CAPABILITY_CONFIG, isCapabilityConfig, type CapabilityConfig } from '@/shared/contracts/capability';
import { readText, writeText } from '@/shared/lib/storage';

/**
 * Persist the capability config as a diff of overrides on top of manifest defaults.
 * Storing only overrides keeps new tools/modules effective by default without a migration.
 */

const CAPABILITY_CONFIG_KEY = 'sunam_v2_capability_config';

export function readCapabilityConfig(): CapabilityConfig {
  const raw = readText(CAPABILITY_CONFIG_KEY);
  if (!raw) return structuredClone(DEFAULT_CAPABILITY_CONFIG);
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCapabilityConfig(parsed) ? parsed : structuredClone(DEFAULT_CAPABILITY_CONFIG);
  } catch {
    return structuredClone(DEFAULT_CAPABILITY_CONFIG);
  }
}

export function saveCapabilityConfig(config: CapabilityConfig): void {
  writeText(CAPABILITY_CONFIG_KEY, JSON.stringify(config));
}

/** Set one module's master switch, persisting only when it differs from the default. */
export function setCapabilityModule(config: CapabilityConfig, moduleId: string, enabled: boolean): CapabilityConfig {
  const next = structuredClone(config);
  next.modules = { ...next.modules, [moduleId]: { enabled } };
  return next;
}

/** Set one tool's override, persisting only when it differs from the default. */
export function setCapabilityTool(config: CapabilityConfig, toolName: string, enabled: boolean): CapabilityConfig {
  const next = structuredClone(config);
  next.tools = { ...next.tools, [toolName]: enabled };
  return next;
}
