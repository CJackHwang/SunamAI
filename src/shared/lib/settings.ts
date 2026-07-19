import { DEFAULT_SETTINGS, isSunamModel, type SunamModel } from '@/shared/config/models';
import { STORAGE_KEYS, readText, writeText } from '@/shared/lib/storage';

export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  apiModel: string;
  sunamModel: SunamModel;
}

export function readAppSettings(): AppSettings {
  const savedModel = readText(STORAGE_KEYS.sunamModel, DEFAULT_SETTINGS.sunamModel);
  return {
    apiKey: readText(STORAGE_KEYS.apiKey),
    baseUrl: readText(STORAGE_KEYS.baseUrl, DEFAULT_SETTINGS.baseUrl),
    apiModel: readText(STORAGE_KEYS.apiModel, DEFAULT_SETTINGS.apiModel),
    sunamModel: isSunamModel(savedModel) ? savedModel : DEFAULT_SETTINGS.sunamModel,
  };
}

export function saveConnectionSettings(settings: Pick<AppSettings, 'apiKey' | 'baseUrl' | 'apiModel'>): void {
  writeText(STORAGE_KEYS.apiKey, settings.apiKey);
  writeText(STORAGE_KEYS.baseUrl, settings.baseUrl);
  writeText(STORAGE_KEYS.apiModel, settings.apiModel);
}

export function saveSunamModel(model: SunamModel): void {
  writeText(STORAGE_KEYS.sunamModel, model);
}
