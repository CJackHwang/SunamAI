import { beforeEach, describe, expect, it } from 'vitest';
import {
  readCapabilityConfig,
  saveCapabilityConfig,
  setCapabilityModule,
  setCapabilityTool,
} from '@/shared/lib/capabilityConfig';

const STORAGE_KEY = 'sunam_v2_capability_config';

describe('capabilityConfig', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns an empty default config when nothing is stored', () => {
    expect(readCapabilityConfig()).toEqual({ modules: {}, tools: {} });
  });

  it('round-trips a persisted config', () => {
    saveCapabilityConfig({ modules: { 'virtual-container': { enabled: false } }, tools: { shell_run: false } });
    expect(readCapabilityConfig()).toEqual({ modules: { 'virtual-container': { enabled: false } }, tools: { shell_run: false } });
  });

  it('falls back to defaults on malformed JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(readCapabilityConfig()).toEqual({ modules: {}, tools: {} });
  });

  it('falls back to defaults when the shape is invalid', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ modules: { x: 'nope' } }));
    expect(readCapabilityConfig()).toEqual({ modules: {}, tools: {} });
  });

  it('keeps only structurally valid partial configs', () => {
    saveCapabilityConfig({ modules: { 'virtual-container': { enabled: true } }, tools: { read_file: false } });
    const config = readCapabilityConfig();
    expect(config.modules['virtual-container']).toEqual({ enabled: true });
    expect(config.tools.read_file).toBe(false);
  });

  it('sets a module master switch without mutating the input', () => {
    const before = readCapabilityConfig();
    const after = setCapabilityModule(before, 'virtual-container', false);
    expect(after.modules['virtual-container']).toEqual({ enabled: false });
    expect(before.modules['virtual-container']).toBeUndefined();
  });

  it('sets a tool override without mutating the input', () => {
    const after = setCapabilityTool(readCapabilityConfig(), 'shell_run', false);
    expect(after.tools.shell_run).toBe(false);
  });
});
