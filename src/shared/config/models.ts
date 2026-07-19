export const SUNAM_MODELS = [
  'Sunam 1.14 Homo',
  'Sunam 1.14 Saki',
  'Sunam 5.14 Homo',
  'Sunam 5.14 Saki',
  'Sunam NEGA 69B',
] as const;

export type SunamModel = (typeof SUNAM_MODELS)[number];

export const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiModel: 'deepseek-v4-flash',
  sunamModel: 'Sunam 1.14 Homo' as SunamModel,
};

export function isSunamModel(value: string): value is SunamModel {
  return SUNAM_MODELS.includes(value as SunamModel);
}
