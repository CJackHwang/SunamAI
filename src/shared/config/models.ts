/**
 * 内置皮套显示名（R5：迁移为可配置皮套前的硬编码雏形，仍用于向后兼容与默认值）。
 * 新的皮套模型见 `@/shared/config/personas`，这里保留 SunamModel 作为宽松字符串别名，
 * 使 AgentRun/ChaosContract 的 persona 字段可承载任意皮套名（contracts 文件一字不改）。
 *
 * L3（终审组2）：删除 `isSunamModel` 门卫——SunamModel 是 `string` 别名，`value is SunamModel`
 * 对 string 是重言式，无法提供任何收窄；原实现只拒绝空串，改由调用点直接表达空串回退。
 * 若改成「按 SUNAM_MODELS 集合判断」会错误拒绝自定义皮套名，与 string 别名语义矛盾。
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
