import type { ComponentType } from 'react';
import type { CapabilityAvailability, CapabilityModuleDescriptor } from '@/shared/contracts/capability';
import type { RegisteredTool } from '../tools/base';
import { controlTools } from '../tools/controlTools';
import { processTools } from '../tools/processTools';
import { resourceTools } from '../tools/resourceTools';
import { subagentTools } from '../tools/subagentTools';
import { workspaceTools } from '../tools/workspaceTools';

/**
 * Capability module: a self-contained unit that the registry host mounts as a whole.
 *
 *  - core (agent-runtime / virtual-container / resources / other): built-in, bootstrapped
 *    at startup, never unregistered, not hot-pluggable.
 *  - extension (notes placeholder today; MCP/third-party later): registered/unregistered at
 *    runtime, hot-pluggable. Extensions may declare tool dependencies on core capabilities.
 *
 * Every tool returned by `tools()` must carry `capability.module === descriptor.id`
 * (`registerModule` enforces this). No tool may reach the Agent without a declaration.
 */

/** Minimal context provided to a module's `promptSections` hook (extensions, future). */
export interface PromptContext {
  containerId: string;
  agentRole: string;
  enabledTools: ReadonlySet<string>;
  availability?: CapabilityAvailability;
}

export interface CapabilityModule {
  descriptor: CapabilityModuleDescriptor;
  tools: () => RegisteredTool[];
  /** Availability coordinator (container three-state is this implementation; child task 2). */
  availability?: {
    initialize(): Promise<CapabilityAvailability>;
    retry(): Promise<CapabilityAvailability>;
  };
  /** System-prompt paragraph contribution (extensions; the container prompt itself lives in prompt.ts). */
  promptSections?: (ctx: PromptContext) => string[];
  /** UI slot contributions. Declared now; mounting ships with the extension-host follow-up. */
  ui?: {
    workspace?: ComponentType;
    settings?: ComponentType;
    mobileNav?: ComponentType;
  };
}

export const agentRuntimeModule: CapabilityModule = {
  descriptor: {
    id: 'agent-runtime',
    kind: 'core',
    labelKey: 'capability.module.agent-runtime',
    descriptionKey: 'capability.module.agent-runtime.description',
    iconKey: 'cpu',
  },
  tools: () => [...controlTools, ...subagentTools],
};

export const virtualContainerModule: CapabilityModule = {
  descriptor: {
    id: 'virtual-container',
    kind: 'core',
    labelKey: 'capability.module.virtual-container',
    descriptionKey: 'capability.module.virtual-container.description',
    iconKey: 'box',
  },
  tools: () => [...workspaceTools, ...processTools, ...resourceTools.filter((tool) => tool.name === 'materialize_resource')],
};

export const resourcesModule: CapabilityModule = {
  descriptor: {
    id: 'resources',
    kind: 'core',
    labelKey: 'capability.module.resources',
    descriptionKey: 'capability.module.resources.description',
    iconKey: 'paperclip',
  },
  tools: () => resourceTools.filter((tool) => tool.capability.module === 'resources'),
};

/** Notes: extension testbed placeholder. Ships disabled; the real notes extension
 *  re-registers the same id at the HeyMean merge (see design §4.4). */
export const notesModule: CapabilityModule = {
  descriptor: {
    id: 'notes',
    kind: 'extension',
    labelKey: 'capability.module.notes',
    descriptionKey: 'capability.module.notes.description',
    iconKey: 'notebook',
    reserved: true,
  },
  tools: () => [],
};

export const otherModule: CapabilityModule = {
  descriptor: {
    id: 'other',
    kind: 'core',
    labelKey: 'capability.module.other',
    descriptionKey: 'capability.module.other.description',
    iconKey: 'package',
  },
  tools: () => [],
};
