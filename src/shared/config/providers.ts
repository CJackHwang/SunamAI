import { createId } from '@/shared/lib/ids';

/**
 * R4：供应商配置模型。预设列表（pi-ai providers 派生）在设置页 feature 内
 * （`@/features/settings/providerPresets`，懒加载），本模块只保留运行期必需的最小面：
 * 类型 + 工厂 + provider id 派生，避免把整份预设清单压进初始 bundle。
 */

/** pi-ai 支持的请求 API（应用侧目前消费 openai-completions 与 anthropic-messages）。 */
export type ProviderApi = 'openai-completions' | 'anthropic-messages';

export interface ProviderConfig {
  /** 唯一 id（uuid）。 */
  id: string;
  /** 预设 id（供应商类型，如 'deepseek'；自定义渠道可为 host 派生）。 */
  presetId: string;
  /** 显示名（如 "DeepSeek"）。 */
  name: string;
  baseUrl: string;
  apiKey: string;
  /** 该供应商的默认模型。 */
  defaultModel: string;
  api: ProviderApi;
  createdAt: number;
  updatedAt: number;
}

export function createProviderConfig(input: {
  presetId: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  api?: ProviderApi;
}): ProviderConfig {
  const now = Date.now();
  return {
    id: createId('prov'),
    presetId: input.presetId,
    name: input.name?.trim() || input.presetId,
    baseUrl: (input.baseUrl?.trim() ?? '').replace(/\/+$/, ''),
    apiKey: input.apiKey ?? '',
    defaultModel: input.defaultModel?.trim() ?? '',
    api: input.api ?? 'openai-completions',
    createdAt: now,
    updatedAt: now,
  };
}

/** 从任意 OpenAI 兼容渠道地址派生稳定 provider id（运行期构造 pi-ai model 用）。 */
export function deriveProviderIdFromUrl(baseUrl: string): string {
  try {
    const slug = new URL(baseUrl).hostname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return slug || 'openai-compatible';
  } catch {
    return 'openai-compatible';
  }
}
