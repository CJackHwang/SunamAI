import { useCallback, useMemo, useState } from 'react';
import {
  readProviders,
  readPersonas,
  readActiveProviderId,
  readGlobalModel,
  readActivePersonaId,
  resolveChatSettings,
  saveProvider,
  deleteProvider,
  savePersona,
  deletePersona,
  setActiveProvider,
  setGlobalModel,
  setActivePersona,
} from '@/shared/config/settingsStore';
import { createProviderConfig, type ProviderApi, type ProviderConfig } from '@/shared/config/providers';
import { createPersonaConfig, type PersonaConfig } from '@/shared/config/personas';

export interface AddProviderInput {
  presetId: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  /** R4：渠道请求 API（preset 派生；缺省 openai-completions）。 */
  api?: ProviderApi;
}

export interface AddPersonaInput {
  name: string;
  systemPrompt?: string;
  modelName?: string;
  params?: PersonaConfig['params'];
  binding?: PersonaConfig['binding'];
  enabled?: boolean;
}

/**
 * R4/R5/R7：应用配置 hook（MainPage + 设置页共用）。
 *
 * 所有读操作从 localStorage 同步解析（resolveChatSettings 已做旧配置迁移），
 * 任何写操作先落盘再 bump version 触发重解析——聊天/顶部选择器即时生效（热插拔）。
 */
export function useAppConfig() {
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  const providers = useMemo(() => readProviders(), [version]);
  const personas = useMemo(() => readPersonas(), [version]);
  const settings = useMemo(() => resolveChatSettings(), [version]);
  const activeProviderId = useMemo(() => readActiveProviderId(), [version]);
  const globalModel = useMemo(() => readGlobalModel(), [version]);
  const activePersonaId = useMemo(() => readActivePersonaId(), [version]);

  const addProvider = useCallback((input: AddProviderInput): ProviderConfig => {
    const provider = createProviderConfig(input);
    saveProvider(provider);
    setActiveProvider(provider.id);
    refresh();
    return provider;
  }, [refresh]);

  const updateProvider = useCallback((provider: ProviderConfig): void => {
    saveProvider(provider);
    refresh();
  }, [refresh]);

  const removeProvider = useCallback((providerId: string): void => {
    deleteProvider(providerId);
    refresh();
  }, [refresh]);

  const selectGlobalModel = useCallback((providerId: string, modelId: string): void => {
    setActiveProvider(providerId);
    setGlobalModel(modelId);
    refresh();
  }, [refresh]);

  const addPersona = useCallback((input: AddPersonaInput): PersonaConfig => {
    const persona = createPersonaConfig(input);
    savePersona(persona);
    refresh();
    return persona;
  }, [refresh]);

  const updatePersona = useCallback((persona: PersonaConfig): void => {
    savePersona(persona);
    refresh();
  }, [refresh]);

  const removePersona = useCallback((personaId: string): void => {
    deletePersona(personaId);
    refresh();
  }, [refresh]);

  const selectPersona = useCallback((personaId: string): void => {
    setActivePersona(personaId);
    refresh();
  }, [refresh]);

  return {
    settings,
    providers,
    personas,
    activeProviderId,
    globalModel,
    activePersonaId,
    addProvider,
    updateProvider,
    removeProvider,
    selectGlobalModel,
    addPersona,
    updatePersona,
    removePersona,
    selectPersona,
  };
}

export type AppConfig = ReturnType<typeof useAppConfig>;
