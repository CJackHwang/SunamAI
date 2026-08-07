import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProviderConfig } from '@/shared/config/providers';
import { PROVIDER_PRESETS } from '@/features/settings/providerPresets';
import { BUILTIN_PERSONA_PROMPTS } from '@/shared/config/personaPrompts';
import { createPersonaConfig, builtinPersonas } from '@/shared/config/personas';
import {
  readProviders,
  readPersonas,
  saveProvider,
  deleteProvider,
  savePersona,
  deletePersona,
  setActiveProvider,
  setGlobalModel,
  setActivePersona,
  resolveChatSettings,
  resolveGlobalModel,
} from '@/shared/config/settingsStore';
import { STORAGE_KEYS } from '@/shared/lib/storage';

const PROVIDERS_KEY = 'sunam_v2_providers';
const PERSONAS_KEY = 'sunam_v2_personas';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('provider config (R4)', () => {
  it('creates a provider from explicit config (preset defaults applied by the settings UI)', () => {
    const provider = createProviderConfig({ presetId: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' });
    expect(provider.id).toMatch(/^prov-/);
    expect(provider.presetId).toBe('deepseek');
    expect(provider.name).toBe('DeepSeek');
    expect(provider.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(provider.api).toBe('openai-completions');
    expect(provider.defaultModel).toBe('deepseek-chat');
  });

  it('exposes pi-ai provider presets (openai/anthropic/deepseek etc.)', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
    expect(ids).toContain('deepseek');
    expect(ids).toContain('openrouter');
    const anthropic = PROVIDER_PRESETS.find((preset) => preset.id === 'anthropic');
    expect(anthropic?.api).toBe('anthropic-messages');
  });

  it('persists providers to localStorage and supports delete', () => {
    const provider = createProviderConfig({ presetId: 'deepseek', name: 'DS', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'k', defaultModel: 'mock-a' });
    saveProvider(provider);
    expect(readProviders()).toHaveLength(1);
    expect(readProviders()[0]).toMatchObject({ name: 'DS', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'mock-a' });
    deleteProvider(provider.id);
    expect(readProviders()).toHaveLength(0);
  });

  it('migrates the legacy baseUrl/apiKey/model into a provider on first read', () => {
    localStorage.setItem(STORAGE_KEYS.apiKey, 'legacy-key');
    localStorage.setItem(STORAGE_KEYS.baseUrl, 'https://legacy.test/v1');
    localStorage.setItem(STORAGE_KEYS.apiModel, 'legacy-model');
    const providers = readProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({ apiKey: 'legacy-key', baseUrl: 'https://legacy.test/v1', defaultModel: 'legacy-model' });
  });
});

describe('persona CRUD (R5)', () => {
  it('seeds built-in personas (Sunam 6.9 Pron etc.) on first read', () => {
    const personas = readPersonas();
    expect(personas.map((persona) => persona.name)).toContain('Sunam 6.9 Pron');
    expect(personas.map((persona) => persona.name)).toContain('Sunam 11.4 Homo');
    expect(personas.every((persona) => persona.builtIn)).toBe(true);
  });

  it('migrates the legacy SunamModel selection to the active persona', () => {
    // 先放旧 sunamModel 再触发读取（真实首次加载时序：旧键先于任何新键读取）。
    localStorage.setItem(STORAGE_KEYS.sunamModel, 'Sunam 11.4 Homo');
    const provider = createProviderConfig({ presetId: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'key', defaultModel: 'deepseek-chat' });
    saveProvider(provider);
    setActiveProvider(provider.id);
    readPersonas();
    const settings = resolveChatSettings();
    expect(settings?.personaName).toBe('Sunam 11.4 Homo');
  });

  it('supports create/update/delete of a persona', () => {
    const persona = createPersonaConfig({ name: 'Custom', systemPrompt: 'Be concise.', params: { temperature: 0.2 }, binding: { mode: 'auto' } });
    savePersona(persona);
    expect(readPersonas().some((item) => item.name === 'Custom')).toBe(true);
    savePersona({ ...persona, name: 'Custom 2', enabled: false });
    const updated = readPersonas().find((item) => item.id === persona.id);
    expect(updated?.name).toBe('Custom 2');
    expect(updated?.enabled).toBe(false);
    deletePersona(persona.id);
    expect(readPersonas().some((item) => item.id === persona.id)).toBe(false);
  });
});

describe('model binding resolution (R4/R5)', () => {
  function setup(overrides: { provider?: { baseUrl?: string; defaultModel?: string }; personaBinding?: 'auto' | 'provider'; modelName?: string } = {}) {
    const provider = createProviderConfig({
      presetId: 'deepseek',
      name: 'DeepSeek',
      baseUrl: overrides.provider?.baseUrl ?? 'https://api.deepseek.com/v1',
      apiKey: 'key',
      defaultModel: overrides.provider?.defaultModel ?? 'deepseek-chat',
    });
    saveProvider(provider);
    setActiveProvider(provider.id);
    setGlobalModel('deepseek-v4-flash');
    const persona = createPersonaConfig({
      name: 'Custom',
      binding: overrides.personaBinding === 'provider' ? { mode: 'provider', providerId: provider.id, modelId: 'bound-model' } : { mode: 'auto' },
      ...(overrides.modelName ? { modelName: overrides.modelName } : {}),
    });
    savePersona(persona);
    setActivePersona(persona.id);
    return { provider, persona };
  }

  it('auto-binding follows the global conversation model', () => {
    setup({ personaBinding: 'auto' });
    const settings = resolveChatSettings();
    expect(settings?.apiModel).toBe('deepseek-v4-flash');
    expect(settings?.providerBaseUrl).toBe('https://api.deepseek.com/v1');
    expect(settings?.providerApiKey).toBe('key');
  });

  it('auto-binding falls back to the provider default model when no global model is set', () => {
    setup({ personaBinding: 'auto' });
    localStorage.removeItem('sunam_v2_global_model');
    const settings = resolveChatSettings();
    expect(settings?.apiModel).toBe('deepseek-chat');
  });

  it('provider binding uses the bound provider and model', () => {
    const { provider } = setup({ personaBinding: 'provider', provider: { baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'local-default' } });
    const settings = resolveChatSettings();
    expect(settings?.providerId).toBe(provider.id);
    expect(settings?.providerBaseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(settings?.apiModel).toBe('bound-model');
  });

  it('persona modelName overrides the resolved model in both binding modes', () => {
    setup({ personaBinding: 'auto', modelName: 'override-model' });
    expect(resolveChatSettings()?.apiModel).toBe('override-model');
    setup({ personaBinding: 'provider', modelName: 'override-model' });
    expect(resolveChatSettings()?.apiModel).toBe('override-model');
  });

  it('returns null when no provider is configured (config gate)', () => {
    expect(resolveChatSettings()).toBeNull();
  });

  it('resolveGlobalModel prefers the active provider + stored global model', () => {
    const { provider } = setup({ provider: { defaultModel: 'default-a' } });
    const resolved = resolveGlobalModel();
    expect(resolved?.provider.id).toBe(provider.id);
    expect(resolved?.apiModel).toBe('deepseek-v4-flash');
  });
});

describe('settings store edge cases', () => {
  it('ignores malformed JSON in the providers/personas keys', () => {
    localStorage.setItem(PROVIDERS_KEY, '{broken');
    localStorage.setItem(PERSONAS_KEY, '[]');
    expect(readProviders()).toHaveLength(0);
    expect(readPersonas()).toEqual([]);
  });

  it('keeps built-in persona system prompts available in the lazy prompts map', () => {
    for (const persona of builtinPersonas()) {
      expect(BUILTIN_PERSONA_PROMPTS[persona.name]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
