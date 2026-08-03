/**
 * Capability model: the single source of truth for what the Agent may perceive and call.
 *
 * Layer: shared (pure types + constants). The registry/module host that consumes these
 * types lives in `features/agent-core/capability/`. UI reads the same contract.
 *
 * Model: two tiers of modules.
 *  - core (agent-runtime / virtual-container / resources / other): built-in, bootstrapped
 *    at startup, never unregistered, not hot-pluggable.
 *  - extension (e.g. `ext:notes`, MCP/third-party): registered/unregistered at runtime,
 *    hot-pluggable. Extensions may declare dependencies on core capabilities.
 *
 * Invariant: no tool may be exposed to the Agent without a `capability` declaration
 * (`registerModule` enforces `tool.capability.module === descriptor.id`).
 */

export const CAPABILITY_BUILTIN_MODULES = ['agent-runtime', 'virtual-container', 'resources', 'notes', 'other'] as const;
export type CapabilityBuiltinModuleId = (typeof CAPABILITY_BUILTIN_MODULES)[number];

/** Open id: built-in enum ∪ `ext:<pluginId>` (e.g. `ext:mcp:serverId`). */
export type CapabilityModuleId = string;

/** core = built-in (static, non-removable); extension = hot-pluggable. */
export type CapabilityModuleKind = 'core' | 'extension';

/** Container availability (session state, volatile). `restricted` = boot failed, user may retry. */
export type CapabilityAvailability = 'enabled' | 'disabled' | 'restricted';

/** Tool-level capability declaration, injected via `defineTool`. */
export interface ToolCapabilityDeclaration {
  /** Required. Built-in enum or `ext:<pluginId>`; `other` is a genuine catch-all only. */
  module: CapabilityModuleId;
  /** Whether the tool is exposed to the AI by default. */
  defaultEnabled: boolean;
  /** true = Agent-runtime class tools: show a "not recommended to disable" warning. */
  warnOnDisable?: boolean;
  /** Tool names this tool requires; enabling it auto-enables its dependencies. */
  dependencies?: readonly string[];
}

/** Module display metadata. `labelKey`/`descriptionKey` are i18n keys. */
export interface CapabilityModuleDescriptor {
  id: CapabilityModuleId;
  kind: CapabilityModuleKind;
  labelKey: string;
  descriptionKey: string;
  iconKey: string;
  /** Reserved placeholder module (e.g. notes testbed): shown but disabled until it ships. */
  reserved?: boolean;
  /** Extension-provided display name (overrides the i18n-key fallback). */
  label?: string;
}

/** Persisted user configuration. Only stores overrides; defaults come from the manifest. */
export interface CapabilityConfig {
  modules: Partial<Record<CapabilityModuleId, { enabled: boolean }>>;
  tools: Partial<Record<string, boolean>>;
}

export const DEFAULT_CAPABILITY_CONFIG: CapabilityConfig = { modules: {}, tools: {} };

/**
 * Sentinel container id used to bind chat-only runs. Never registered in the workspace
 * store, never snapshot-materialized, never matches a real container's deletion flow.
 */
export const CHAT_ONLY_CONTAINER_ID = '__chat__';

export function isCapabilityBuiltinModuleId(value: unknown): value is CapabilityBuiltinModuleId {
  return typeof value === 'string' && (CAPABILITY_BUILTIN_MODULES as readonly string[]).includes(value);
}

export function isCapabilityConfig(value: unknown): value is CapabilityConfig {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.modules !== undefined) {
    if (!record.modules || typeof record.modules !== 'object') return false;
    for (const entry of Object.values(record.modules as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') return false;
      const moduleState = entry as { enabled?: unknown };
      if (typeof moduleState.enabled !== 'boolean') return false;
    }
  }
  if (record.tools !== undefined) {
    if (!record.tools || typeof record.tools !== 'object') return false;
    for (const enabled of Object.values(record.tools as Record<string, unknown>)) {
      if (typeof enabled !== 'boolean') return false;
    }
  }
  return true;
}
