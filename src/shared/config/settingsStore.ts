import { readText, writeText, removeText, STORAGE_KEYS } from '@/shared/lib/storage';
import { DEFAULT_SETTINGS, isSunamModel } from '@/shared/config/models';
import {
  createProviderConfig,
  deriveProviderIdFromUrl,
  type ProviderConfig,
} from '@/shared/config/providers';
import {
  builtinPersonas,
  createPersonaConfig,
  DEFAULT_PERSONA_SYSTEM_PROMPT,
  personaSystemPrompt,
  type PersonaConfig,
  type PersonaParams,
} from '@/shared/config/personas';

/**
 * R4/R5/R7：应用设置仓库（供应商 + 皮套 + 全局对话模型）。
 *
 * 持久化到 localStorage，兼容旧配置结构：
 * - 旧键 `sunam_v2_api_key/base_url/api_model` + `sunam_v2_model`（SunamModel 硬编码）
 *   在首次读取时迁移为供应商 + 内置皮套；
 * - 新键 `sunam_v2_providers` / `sunam_v2_personas` 为 JSON 数组，之后以新结构为准。
 */

export interface ResolvedChatSettings {
  providerId: string;
  providerName: string;
  providerApiKey: string;
  providerBaseUrl: string;
  /** 实际使用的模型 id（皮套绑定解析结果）。 */
  apiModel: string;
  /** 皮套显示名（顶部模型选择器 + AgentRun.persona）。 */
  personaName: string;
  persona: PersonaConfig;
  /** 皮套系统提示词。 */
  systemPrompt: string;
  params: PersonaParams;
}

const STORE_KEYS = {
  providers: 'sunam_v2_providers',
  personas: 'sunam_v2_personas',
  activeProvider: 'sunam_v2_active_provider',
  globalModel: 'sunam_v2_global_model',
  activePersona: 'sunam_v2_active_persona',
} as const;

function parseJsonArray<T>(value: string | null): T[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function isProviderConfig(value: unknown): value is ProviderConfig {
  return typeof value === 'object' && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { baseUrl?: unknown }).baseUrl === 'string'
    && typeof (value as { apiKey?: unknown }).apiKey === 'string';
}

function isPersonaConfig(value: unknown): value is PersonaConfig {
  return typeof value === 'object' && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { name?: unknown }).name === 'string'
    && typeof (value as { systemPrompt?: unknown }).systemPrompt === 'string';
}

/** 旧配置迁移：把 sunam_v2_api_key/base_url/api_model 落成一个供应商（DeepSeek 兼容渠道）。 */
export function migrateLegacyConnection(): void {
  if (readText(STORE_KEYS.providers)) return;
  const legacyBaseUrl = readText(STORAGE_KEYS.baseUrl);
  const legacyApiKey = readText(STORAGE_KEYS.apiKey);
  const legacyModel = readText(STORAGE_KEYS.apiModel);
  if (!legacyBaseUrl && !legacyApiKey && !legacyModel) return;
  const provider = createProviderConfig({
    presetId: deriveProviderIdFromUrl(legacyBaseUrl || DEFAULT_SETTINGS.baseUrl),
    name: 'Provider',
    baseUrl: legacyBaseUrl || DEFAULT_SETTINGS.baseUrl,
    apiKey: legacyApiKey,
    defaultModel: legacyModel || DEFAULT_SETTINGS.apiModel,
  });
  writeText(STORE_KEYS.providers, JSON.stringify([provider]));
  writeText(STORE_KEYS.activeProvider, provider.id);
  if (legacyModel) writeText(STORE_KEYS.globalModel, legacyModel);
}

/** 旧配置迁移：把 sunam_v2_model（SunamModel 硬编码）映射为内置皮套。 */
export function migrateLegacyPersona(): void {
  if (readText(STORE_KEYS.personas)) return;
  const savedModel = readText(STORAGE_KEYS.sunamModel, DEFAULT_SETTINGS.sunamModel);
  const personas = builtinPersonas();
  writeText(STORE_KEYS.personas, JSON.stringify(personas));
  const matched = isSunamModel(savedModel) && personas.some((persona) => persona.name === savedModel)
    ? personas.find((persona) => persona.name === savedModel)?.id
    : undefined;
  if (matched) writeText(STORE_KEYS.activePersona, matched);
}

/** 确保迁移已执行（读路径前调用）。 */
export function ensureMigrated(): void {
  migrateLegacyConnection();
  migrateLegacyPersona();
}

export function readProviders(): ProviderConfig[] {
  ensureMigrated();
  const stored = parseJsonArray<unknown>(readText(STORE_KEYS.providers));
  if (!stored) return [];
  return stored.filter(isProviderConfig);
}

export function readPersonas(): PersonaConfig[] {
  ensureMigrated();
  const stored = parseJsonArray<unknown>(readText(STORE_KEYS.personas));
  if (!stored) return builtinPersonas();
  return stored.filter(isPersonaConfig);
}

export function writeProviders(providers: ProviderConfig[]): void {
  writeText(STORE_KEYS.providers, JSON.stringify(providers));
}

export function writePersonas(personas: PersonaConfig[]): void {
  writeText(STORE_KEYS.personas, JSON.stringify(personas));
}

export function saveProvider(provider: ProviderConfig): ProviderConfig[] {
  const providers = readProviders();
  const index = providers.findIndex((item) => item.id === provider.id);
  const next = { ...provider, updatedAt: Date.now() };
  if (index === -1) providers.unshift(next);
  else providers[index] = next;
  writeProviders(providers);
  if (!readText(STORE_KEYS.activeProvider)) writeText(STORE_KEYS.activeProvider, next.id);
  return providers;
}

export function deleteProvider(providerId: string): ProviderConfig[] {
  const providers = readProviders().filter((item) => item.id !== providerId);
  writeProviders(providers);
  if (readText(STORE_KEYS.activeProvider) === providerId) {
    removeText(STORE_KEYS.activeProvider);
    removeText(STORE_KEYS.globalModel);
  }
  return providers;
}

export function savePersona(persona: PersonaConfig): PersonaConfig[] {
  const personas = readPersonas();
  const index = personas.findIndex((item) => item.id === persona.id);
  const next = { ...persona, updatedAt: Date.now() };
  if (index === -1) personas.push(next);
  else personas[index] = next;
  writePersonas(personas);
  if (!readText(STORE_KEYS.activePersona)) writeText(STORE_KEYS.activePersona, next.id);
  return personas;
}

export function deletePersona(personaId: string): PersonaConfig[] {
  const personas = readPersonas().filter((item) => item.id !== personaId);
  writePersonas(personas);
  if (readText(STORE_KEYS.activePersona) === personaId) removeText(STORE_KEYS.activePersona);
  return personas;
}

export function setActiveProvider(providerId: string): void {
  writeText(STORE_KEYS.activeProvider, providerId);
}

export function setGlobalModel(modelId: string): void {
  writeText(STORE_KEYS.globalModel, modelId);
}

export function setActivePersona(personaId: string): void {
  writeText(STORE_KEYS.activePersona, personaId);
}

export function readActiveProviderId(): string | null {
  return readText(STORE_KEYS.activeProvider) || null;
}

export function readGlobalModel(): string {
  return readText(STORE_KEYS.globalModel) || '';
}

export function readActivePersonaId(): string | null {
  return readText(STORE_KEYS.activePersona) || null;
}

export function findProvider(providerId: string | undefined | null): ProviderConfig | null {
  if (!providerId) return null;
  return readProviders().find((item) => item.id === providerId) ?? null;
}

export function findPersona(personaId: string | undefined | null): PersonaConfig | null {
  if (!personaId) return null;
  return readPersonas().find((item) => item.id === personaId) ?? null;
}

/** 全局对话模型解析：优先 activeProvider + globalModel，其次第一个供应商的默认模型。 */
export function resolveGlobalModel(): { provider: ProviderConfig; apiModel: string } | null {
  const providers = readProviders();
  if (providers.length === 0) return null;
  const active = findProvider(readActiveProviderId()) ?? providers[0]!;
  const globalModel = readGlobalModel();
  return { provider: active, apiModel: globalModel || active.defaultModel };
}

/**
 * 解析当前对话运行设置（R4/R5 核心）：
 * - 皮套绑定 'provider' → 用绑定供应商 + 绑定模型；
 * - 皮套绑定 'auto' → 跟随全局对话模型（activeProvider + globalModel）；
 * - 皮套 modelName 非空时覆盖解析出的模型 id。
 * 没有供应商时返回 null（应用进入配置门）。
 */
export function resolveChatSettings(): ResolvedChatSettings | null {
  ensureMigrated();
  const providers = readProviders();
  if (providers.length === 0) return null;
  const personas = readPersonas();
  if (personas.length === 0) return null;
  // 优先当前激活皮套；若被停用则回退到第一个启用皮套（顶部选择器只列启用皮套）。
  const activeById = findPersona(readActivePersonaId());
  const activePersona = activeById && activeById.enabled
    ? activeById
    : personas.find((persona) => persona.enabled) ?? activeById ?? personas[0];
  if (!activePersona) return null;

  const global = resolveGlobalModel();
  let provider: ProviderConfig;
  let model: string;
  if (activePersona.binding.mode === 'provider' && activePersona.binding.providerId) {
    const bound = findProvider(activePersona.binding.providerId) ?? (global?.provider ?? null);
    if (!bound) return null;
    provider = bound;
    model = activePersona.binding.modelId ?? bound.defaultModel;
  } else {
    if (!global) return null;
    provider = global.provider;
    model = global.apiModel;
  }
  if (activePersona.modelName) model = activePersona.modelName;

  return {
    providerId: provider.id,
    providerName: provider.name,
    providerApiKey: provider.apiKey,
    providerBaseUrl: provider.baseUrl,
    apiModel: model,
    personaName: activePersona.name,
    persona: activePersona,
    systemPrompt: personaSystemPrompt(activePersona),
    params: activePersona.params,
  };
}

/** 直接以「指定供应商 + 指定模型」解析（供应商栏目里切换全局模型时预览用）。 */
export function resolveProviderModel(providerId: string, modelId: string): { provider: ProviderConfig; apiModel: string } | null {
  const provider = findProvider(providerId);
  if (!provider) return null;
  return { provider, apiModel: modelId || provider.defaultModel };
}

export { DEFAULT_PERSONA_SYSTEM_PROMPT };
export { createPersonaConfig };
