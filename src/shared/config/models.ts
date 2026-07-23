export const SUNAM_MODELS = [
  'Sunam 6.9 Pron',
  'Sunam 11.4 Homo',
] as const;

export type SunamModel = (typeof SUNAM_MODELS)[number];

export const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiModel: 'deepseek-v4-flash',
  sunamModel: 'Sunam 6.9 Pron' as SunamModel,
};

export function isSunamModel(value: string): value is SunamModel {
  return SUNAM_MODELS.includes(value as SunamModel);
}
