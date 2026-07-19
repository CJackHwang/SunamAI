export const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ja-JP'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
