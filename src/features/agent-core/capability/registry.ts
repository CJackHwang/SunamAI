import type { CapabilityAvailability, CapabilityConfig } from '@/shared/contracts/capability';
import type { RegisteredTool } from '../tools/base';
import type { CapabilityModule } from './module';

/**
 * Capability registry: the module host. The single source of truth for what the Agent
 * may perceive and call.
 *
 *  - `registerModule` validates every tool's `capability.module` against the module id —
 *    the injection invariant holds for extensions too: a plugin cannot expose a tool to
 *    the Agent without a capability declaration.
 *  - `unregisterModule` only accepts `kind: 'extension'`; core modules are non-removable.
 *  - The panel, the engine's tool allow-set, and the prompt all read the live registry,
 *    so hot-plugging an extension (connect/disconnect) is reflected everywhere.
 */
export class CapabilityRegistry {
  private readonly moduleById = new Map<string, CapabilityModule>();
  private readonly byName = new Map<string, RegisteredTool>();
  private readonly listeners = new Set<() => void>();

  registerModule(module: CapabilityModule): void {
    const tools = module.tools();
    for (const tool of tools) {
      if (tool.capability.module !== module.descriptor.id) {
        throw new Error(
          `Tool "${tool.name}" capability.module "${tool.capability.module}" does not match module "${module.descriptor.id}". ` +
            'Every tool must be registered under the module it declares.',
        );
      }
    }
    this.moduleById.set(module.descriptor.id, module);
    for (const tool of tools) this.byName.set(tool.name, tool);
    this.emit();
  }

  /** Only `kind: 'extension'` modules can be unregistered; core is non-removable. */
  unregisterModule(id: string): boolean {
    const module = this.moduleById.get(id);
    if (!module || module.descriptor.kind !== 'extension') return false;
    for (const tool of module.tools()) this.byName.delete(tool.name);
    this.moduleById.delete(id);
    this.emit();
    return true;
  }

  /** Built-in modules first (bootstrap order), then extensions in registration order. */
  modules(): CapabilityModule[] {
    return [...this.moduleById.values()];
  }

  toolsOf(id: string): RegisteredTool[] {
    return this.moduleById.get(id)?.tools() ?? [];
  }

  hasModule(id: string): boolean {
    return this.moduleById.has(id);
  }

  getTool(name: string): RegisteredTool | undefined {
    return this.byName.get(name);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Compute the effective tool allow-set from the persisted config and availability.
   *
   *  - Module master switch off → all its tools forced off.
   *  - Module on → tools follow the config override or their manifest default.
   *  - availability = 'restricted' → the virtual-container module is excluded entirely.
   *  - Dependency closure: enabling a tool auto-enables its declared dependencies.
   */
  resolveEnabledTools(config: CapabilityConfig, availability?: CapabilityAvailability): ReadonlySet<string> {
    const enabled = new Set<string>();
    for (const module of this.moduleById.values()) {
      const isContainer = module.descriptor.id === 'virtual-container';
      const moduleOn = isContainer && availability === 'restricted'
        ? false
        : (config.modules[module.descriptor.id]?.enabled ?? true);
      if (!moduleOn) continue;
      for (const tool of module.tools()) {
        if (config.tools[tool.name] ?? tool.capability.defaultEnabled) enabled.add(tool.name);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const name of [...enabled]) {
        const dependencies = this.byName.get(name)?.capability.dependencies ?? [];
        for (const dependency of dependencies) {
          if (!enabled.has(dependency)) {
            enabled.add(dependency);
            changed = true;
          }
        }
      }
    }
    return enabled;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Singleton shared by the engine wiring, the capability panel, and the bootstrap. */
export const capabilityRegistry = new CapabilityRegistry();
