import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { CapabilityConfig, CapabilityModuleDescriptor, CapabilityModuleId } from '@/shared/contracts/capability';
import type { RegisteredTool } from '@/features/agent-core/tools/base';
import { capabilityRegistry } from '@/features/agent-core/capability/registry';
import { ensureCapabilityRegistry } from '@/features/agent-core/capability/manifest';
import { readCapabilityConfig, saveCapabilityConfig, setCapabilityModule, setCapabilityTool } from '@/shared/lib/capabilityConfig';
import { useWorkspaceRuntime, type EffectiveContainerState } from '@/features/runtime/WorkspaceRuntimeContext';

export interface CapabilityModuleView {
  descriptor: CapabilityModuleDescriptor;
  tools: RegisteredTool[];
}

export interface CapabilityContextValue {
  modules: CapabilityModuleView[];
  config: CapabilityConfig;
  effectiveContainerState: EffectiveContainerState;
  /** Agent run active (root or subagent) — locks the container master switch. */
  containerSwitchLocked: boolean;
  toggleModule: (id: CapabilityModuleId, enabled: boolean) => void;
  toggleTool: (name: string, enabled: boolean) => void;
  retryContainer: () => Promise<boolean>;
}

export const CapabilityContext = createContext<CapabilityContextValue | null>(null);

function readModules(): CapabilityModuleView[] {
  ensureCapabilityRegistry();
  return capabilityRegistry.modules().map((module) => ({ descriptor: module.descriptor, tools: module.tools() }));
}

/** Drop module/tool overrides that no longer exist in the registry (schema/plugin drift). */
function sanitizeConfig(config: CapabilityConfig): CapabilityConfig {
  ensureCapabilityRegistry();
  const modules = new Set(capabilityRegistry.modules().map((module) => module.descriptor.id));
  const tools = new Set<string>();
  for (const module of capabilityRegistry.modules()) {
    for (const tool of module.tools()) tools.add(tool.name);
  }
  return {
    modules: Object.fromEntries(Object.entries(config.modules).filter(([id]) => modules.has(id))),
    tools: Object.fromEntries(Object.entries(config.tools).filter(([name]) => tools.has(name))),
  };
}

/** Force every tool of a module on — used when the module master switch is turned back on.
 *  Diff-aware: only stores overrides that differ from the tool's manifest default. */
function enableAllTools(config: CapabilityConfig, moduleId: CapabilityModuleId): CapabilityConfig {
  const next = structuredClone(config);
  next.modules = { ...next.modules, [moduleId]: { enabled: true } };
  next.tools = { ...next.tools };
  for (const tool of capabilityRegistry.toolsOf(moduleId)) {
    if (tool.capability.defaultEnabled) delete next.tools[tool.name];
    else next.tools[tool.name] = true;
  }
  return next;
}

/** Reads the live module list from the registry, re-rendering on hot-plug changes. */
function useCapabilityModules(): CapabilityModuleView[] {
  ensureCapabilityRegistry();
  const [modules, setModules] = useState<CapabilityModuleView[]>(readModules);
  useEffect(() => capabilityRegistry.subscribe(() => setModules(readModules())), []);
  return modules;
}

export function CapabilityProvider({ children }: PropsWithChildren) {
  ensureCapabilityRegistry();
  const [config, setConfig] = useState<CapabilityConfig>(() => sanitizeConfig(readCapabilityConfig()));
  const { effectiveContainerState, retryContainer, setContainerEnabled, containerSwitchLocked } = useWorkspaceRuntime();

  const persistConfig = useCallback((next: CapabilityConfig) => {
    setConfig(next);
    saveCapabilityConfig(next);
  }, []);

  const toggleModule = useCallback((id: CapabilityModuleId, enabled: boolean) => {
    if (id === 'virtual-container') {
      setContainerEnabled(enabled);
      // Keep the local config in sync with what the provider persists, so a later
      // tool toggle does not overwrite the container override with a stale snapshot.
      // Re-opening the container also re-enables every container sub-switch.
      setConfig((current) => (enabled ? enableAllTools(current, id) : setCapabilityModule(current, id, enabled)));
      return;
    }
    // Re-opening a module always re-enables every sub-switch.
    persistConfig(enabled ? enableAllTools(config, id) : setCapabilityModule(config, id, enabled));
  }, [config, persistConfig, setContainerEnabled]);

  const toggleTool = useCallback((name: string, enabled: boolean) => {
    const tool = capabilityRegistry.getTool(name);
    let nextConfig = setCapabilityTool(config, name, enabled);
    // Diff-aware: drop the override when it matches the manifest default.
    if (tool && enabled === tool.capability.defaultEnabled) {
      nextConfig = structuredClone(nextConfig);
      delete nextConfig.tools[name];
    }
    // Sync the master switch off when the last tool of a module is disabled.
    const moduleId = tool?.capability.module;
    if (!enabled && moduleId) {
      const anyToolEnabled = capabilityRegistry.toolsOf(moduleId).some(
        (toolInModule) => nextConfig.tools[toolInModule.name] ?? toolInModule.capability.defaultEnabled,
      );
      if (!anyToolEnabled) {
        nextConfig.modules = { ...nextConfig.modules, [moduleId]: { enabled: false } };
      }
    }
    persistConfig(nextConfig);
  }, [config, persistConfig]);

  const modules = useCapabilityModules();

  const value = useMemo<CapabilityContextValue>(() => ({
    modules,
    config,
    effectiveContainerState,
    containerSwitchLocked,
    toggleModule,
    toggleTool,
    retryContainer,
  }), [config, containerSwitchLocked, effectiveContainerState, modules, retryContainer, toggleModule, toggleTool]);

  return <CapabilityContext.Provider value={value}>{children}</CapabilityContext.Provider>;
}

export function useCapabilityContext(): CapabilityContextValue {
  const value = useContext(CapabilityContext);
  if (!value) throw new Error('useCapabilityContext must be used inside CapabilityProvider.');
  return value;
}

/** The capability-derived engine input (config + container availability) for useAgentV2. */
export function useAgentCapabilities(): { config: CapabilityConfig; containerAvailable: boolean } {
  const { config, effectiveContainerState } = useCapabilityContext();
  return useMemo(
    () => ({ config, containerAvailable: effectiveContainerState === 'enabled' }),
    [config, effectiveContainerState],
  );
}
