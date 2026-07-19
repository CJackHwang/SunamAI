export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
