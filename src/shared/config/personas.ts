import { createId } from '@/shared/lib/ids';

/**
 * R5：皮套（Agent 配置）数据模型 + 内置皮套元数据。
 *
 * 对齐旧 `models.ts` 的 SunamModel + `prompt.ts` 的系统提示词雏形，但可配置化：
 * 皮套名 / 系统提示词 / 模型名（覆盖）/ 模型参数（温度等，供应商支持时）/ 绑定模式
 * （自动跟随全局对话模型，或指定某供应商某模型）。内置皮套保留旧文案——但长文案
 * 放在 `@/shared/config/personaPrompts`（懒加载），这里只留元数据，避免初始 bundle 膨胀。
 */

export interface PersonaParams {
  /** 采样温度。 */
  temperature?: number;
  /** top_p。 */
  topP?: number;
  /** 单次回复最大 token。 */
  maxTokens?: number;
}

export type PersonaBindingMode = 'auto' | 'provider';

export interface PersonaBinding {
  mode: PersonaBindingMode;
  /** mode === 'provider' 时绑定的供应商 id。 */
  providerId?: string;
  /** mode === 'provider' 时绑定的模型 id。 */
  modelId?: string;
}

export interface PersonaConfig {
  id: string;
  /** 皮套显示名（如 "Sunam 6.9 Pron"，也是顶部模型选择器条目）。 */
  name: string;
  /** 自定义系统提示词。内置皮套未编辑时为空，运行期经 BUILTIN_PERSONA_PROMPTS 回填。 */
  systemPrompt: string;
  /** 自定义模型名（非空时覆盖绑定解析出的模型 id；空则按绑定跟随）。 */
  modelName: string;
  params: PersonaParams;
  binding: PersonaBinding;
  enabled: boolean;
  /** 内置皮套标记（迁移自旧硬编码，可编辑但删除时由 migrate 重建）。 */
  builtIn?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 顶部模型选择器的皮套选项（id + 显示名）。 */
export interface PersonaSelectorOption {
  id: string;
  name: string;
}

export const DEFAULT_PERSONA_SYSTEM_PROMPT = 'You are Sunam, an elite, rigorous coding assistant. Answer the user request directly, honestly, and concisely.';

/** 内置皮套元数据（迁移自旧 SunamModel 硬编码；提示词全文懒加载回填）。 */
export function builtinPersonas(): PersonaConfig[] {
  const now = Date.now();
  return [
    {
      id: 'persona-sunam-69-pron',
      name: 'Sunam 6.9 Pron',
      systemPrompt: '',
      modelName: '',
      params: {},
      binding: { mode: 'auto' },
      enabled: true,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'persona-sunam-114-homo',
      name: 'Sunam 11.4 Homo',
      systemPrompt: '',
      modelName: '',
      params: {},
      binding: { mode: 'auto' },
      enabled: true,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createPersonaConfig(input: {
  name: string;
  systemPrompt?: string;
  modelName?: string;
  params?: PersonaParams;
  binding?: PersonaBinding;
  enabled?: boolean;
}): PersonaConfig {
  const now = Date.now();
  return {
    id: createId('persona'),
    name: input.name.trim() || 'New persona',
    systemPrompt: input.systemPrompt ?? '',
    modelName: input.modelName ?? '',
    params: input.params ?? {},
    binding: input.binding ?? { mode: 'auto' },
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 皮套运行期系统提示词。内置皮套未编辑时返回空串——调用方（createChaosContract）
 * 会按皮套名回填 BUILTIN_PERSONA_PROMPTS 全文；自定义皮套返回其存储的自定义提示词。
 */
export function personaSystemPrompt(persona: Pick<PersonaConfig, 'systemPrompt'>): string {
  return persona.systemPrompt ?? '';
}
