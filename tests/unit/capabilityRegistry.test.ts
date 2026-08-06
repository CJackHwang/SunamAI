import { beforeAll, describe, expect, it, vi } from 'vitest';
import { capabilityRegistry } from '@/features/agent-core/capability/registry';
import { bootstrapCapabilityRegistry } from '@/features/agent-core/capability/manifest';
import type { CapabilityModule } from '@/features/agent-core/capability/module';
import { defineTool, type RegisteredTool } from '@/features/agent-core/tools/base';
import { z } from 'zod';
import type { CapabilityConfig } from '@/shared/contracts/capability';

const OTHER_THRESHOLD = 1;

function makeExtensionModule(id: string, tools: RegisteredTool[]): CapabilityModule {
  return {
    descriptor: { id, kind: 'extension', labelKey: 'capability.module.other', descriptionKey: 'capability.module.other.description', iconKey: 'package', label: id },
    tools: () => tools,
  };
}

const echoTool: RegisteredTool = defineTool({
  name: 'ext_echo',
  description: 'echo',
  schema: z.object({ text: z.string() }),
  readOnly: true,
  concurrencySafe: true,
  dataImpact: 'none',
  timeoutMs: 1_000,
  resultType: 'text',
  capability: { module: 'ext:echo', defaultEnabled: true },
  async execute(input) { return { ok: true, content: input.text }; },
});

const shellDependentTool: RegisteredTool = defineTool({
  name: 'ext_shell_user',
  description: 'uses shell',
  schema: z.object({}),
  readOnly: true,
  concurrencySafe: true,
  dataImpact: 'none',
  timeoutMs: 1_000,
  resultType: 'text',
  capability: { module: 'ext:echo', defaultEnabled: true, dependencies: ['run_command'] },
  async execute() { return { ok: true, content: 'ok' }; },
});

describe('capabilityRegistry', () => {
  beforeAll(() => {
    bootstrapCapabilityRegistry();
  });

  it('bootstraps every built-in module and covers each tool exactly once', () => {
    const names = new Set<string>();
    for (const module of capabilityRegistry.modules()) {
      for (const tool of module.tools()) {
        expect(names.has(tool.name)).toBe(false);
        names.add(tool.name);
        expect(tool.capability.module).toBe(module.descriptor.id);
      }
    }
    expect(names.size).toBeGreaterThan(15);
    expect(capabilityRegistry.hasModule('agent-runtime')).toBe(true);
    expect(capabilityRegistry.hasModule('virtual-container')).toBe(true);
    expect(capabilityRegistry.hasModule('resources')).toBe(true);
    expect(capabilityRegistry.hasModule('notes')).toBe(true);
  });

  it('keeps the "other" catch-all below the abuse threshold', () => {
    expect(capabilityRegistry.toolsOf('other').length).toBeLessThanOrEqual(OTHER_THRESHOLD);
  });

  it('rejects a module whose tool capability.module does not match its id', () => {
    const rogue = makeExtensionModule('ext:rogue', [echoTool]);
    const copy = {
      ...rogue,
      tools: () => [defineTool({
        ...echoTool,
        capability: { module: 'virtual-container', defaultEnabled: true },
      })],
    };
    expect(() => capabilityRegistry.registerModule(copy)).toThrow(/does not match module/);
  });

  it('registers and unregisters extension modules, but never core modules', () => {
    const extension = makeExtensionModule('ext:echo', [echoTool]);
    capabilityRegistry.registerModule(extension);
    expect(capabilityRegistry.hasModule('ext:echo')).toBe(true);
    expect(capabilityRegistry.getTool('ext_echo')?.name).toBe('ext_echo');

    expect(capabilityRegistry.unregisterModule('ext:echo')).toBe(true);
    expect(capabilityRegistry.hasModule('ext:echo')).toBe(false);

    expect(capabilityRegistry.unregisterModule('virtual-container')).toBe(false);
    expect(capabilityRegistry.hasModule('virtual-container')).toBe(true);
  });

  it('resolveEnabledTools: default config enables all manifest-default tools', () => {
    const enabled = capabilityRegistry.resolveEnabledTools({ modules: {}, tools: {} });
    expect(enabled.has('run_command')).toBe(true);
    expect(enabled.has('workspace_tree')).toBe(true);
    expect(enabled.has('read_resource_text')).toBe(true);
    expect(enabled.has('complete_task')).toBe(true);
  });

  it('resolveEnabledTools: disabling the container module forces its tools off', () => {
    const config: CapabilityConfig = { modules: { 'virtual-container': { enabled: false } }, tools: {} };
    const enabled = capabilityRegistry.resolveEnabledTools(config);
    expect(enabled.has('run_command')).toBe(false);
    expect(enabled.has('workspace_tree')).toBe(false);
    expect(enabled.has('materialize_resource')).toBe(false);
    expect(enabled.has('read_resource_text')).toBe(true);
  });

  it('resolveEnabledTools: per-tool override wins over the default', () => {
    const config: CapabilityConfig = { modules: {}, tools: { workspace_tree: false } };
    const enabled = capabilityRegistry.resolveEnabledTools(config);
    expect(enabled.has('workspace_tree')).toBe(false);
    expect(enabled.has('run_command')).toBe(true);
  });

  it('resolveEnabledTools: a dependency can be disabled together with its dependents', () => {
    const config: CapabilityConfig = {
      modules: {},
      tools: { run_command: false, manage_process: false, read_user_terminal: false },
    };
    const enabled = capabilityRegistry.resolveEnabledTools(config);
    expect(enabled.has('run_command')).toBe(false);
    expect(enabled.has('manage_process')).toBe(false);
  });

  it('resolveEnabledTools: restricted availability excludes the container module even when enabled', () => {
    const config: CapabilityConfig = { modules: {}, tools: {} };
    const enabled = capabilityRegistry.resolveEnabledTools(config, 'restricted');
    expect(enabled.has('run_command')).toBe(false);
    expect(enabled.has('workspace_tree')).toBe(false);
    expect(enabled.has('read_resource_text')).toBe(true);
    expect(enabled.has('complete_task')).toBe(true);
  });

  it('resolveEnabledTools: dependency closure auto-enables declared dependencies', () => {
    const extension = makeExtensionModule('ext:echo', [shellDependentTool]);
    capabilityRegistry.registerModule(extension);
    try {
      const config: CapabilityConfig = { modules: {}, tools: { ext_shell_user: true, run_command: false } };
      const enabled = capabilityRegistry.resolveEnabledTools(config);
      expect(enabled.has('ext_shell_user')).toBe(true);
      expect(enabled.has('run_command')).toBe(true);
    } finally {
      capabilityRegistry.unregisterModule('ext:echo');
    }
  });

  it('notifies subscribers on register/unregister', () => {
    const listener = () => undefined;
    const spy = { listener };
    const spyFn = vi.spyOn(spy, 'listener');
    const unsubscribe = capabilityRegistry.subscribe(spyFn);
    const subTool: RegisteredTool = defineTool({
      name: 'ext_sub_tool',
      description: 'sub',
      schema: z.object({}),
      readOnly: true,
      concurrencySafe: true,
      dataImpact: 'none',
      timeoutMs: 1_000,
      resultType: 'text',
      capability: { module: 'ext:sub', defaultEnabled: true },
      async execute() { return { ok: true, content: 'ok' }; },
    });
    const extension = makeExtensionModule('ext:sub', [subTool]);
    capabilityRegistry.registerModule(extension);
    expect(spyFn).toHaveBeenCalled();
    capabilityRegistry.unregisterModule('ext:sub');
    unsubscribe();
  });

  it('toolsOf returns the tools of a module and [] for unknown ids', () => {
    expect(capabilityRegistry.toolsOf('virtual-container').length).toBeGreaterThan(5);
    expect(capabilityRegistry.toolsOf('ext:missing')).toEqual([]);
  });
});
