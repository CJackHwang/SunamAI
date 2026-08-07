/**
 * 内置皮套显示名（R5：迁移为可配置皮套前的硬编码雏形，仍用于向后兼容与默认值）。
 * 新的皮套模型见 `@/shared/config/personas`，这里保留 SunamModel 作为宽松字符串别名，
 * 使 AgentRun/ChaosContract 的 persona 字段可承载任意皮套名（contracts 文件一字不改）。
 */
export const SUNAM_MODELS = [
  'Sunam 6.9 Pron',
  'Sunam 11.4 Homo',
] as const;

export type SunamModel = string;

export const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com/v1',
  apiModel: 'deepseek-v4-flash',
  sunamModel: 'Sunam 6.9 Pron' as SunamModel,
};

export function isSunamModel(value: string): value is SunamModel {
  return SUNAM_MODELS.includes(value as (typeof SUNAM_MODELS)[number]) || value.length > 0;
}
