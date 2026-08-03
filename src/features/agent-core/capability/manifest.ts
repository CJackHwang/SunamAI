import { agentRuntimeModule, notesModule, otherModule, resourcesModule, virtualContainerModule } from './module';
import { capabilityRegistry } from './registry';

let bootstrapped = false;

/**
 * Register the built-in modules into the registry host. Idempotent — call at app startup
 * (main.tsx) and safely from engine wiring so direct engine tests get a populated registry.
 */
export function bootstrapCapabilityRegistry(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  capabilityRegistry.registerModule(agentRuntimeModule);
  capabilityRegistry.registerModule(virtualContainerModule);
  capabilityRegistry.registerModule(resourcesModule);
  capabilityRegistry.registerModule(notesModule);
  capabilityRegistry.registerModule(otherModule);
}

/** Alias with a self-documenting name for call sites that only need the guarantee. */
export function ensureCapabilityRegistry(): void {
  bootstrapCapabilityRegistry();
}
