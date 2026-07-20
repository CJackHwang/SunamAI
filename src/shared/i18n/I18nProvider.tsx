import { useCallback, useMemo, useState, type PropsWithChildren } from 'react';
import { STORAGE_KEYS, readText, writeText } from '@/shared/lib/storage';
import { SUPPORTED_LOCALES, type Locale } from './config';
import { I18nContext, type I18nContextValue } from './context';
import { zhCN, type TranslationCatalogue } from './locales/zh-CN';
import { enUS } from './locales/en-US';
import { jaJP } from './locales/ja-JP';

const catalogues: Record<Locale, TranslationCatalogue> = { 'zh-CN': zhCN, 'en-US': enUS, 'ja-JP': jaJP };
const isLocale = (value: string): value is Locale => SUPPORTED_LOCALES.includes(value as Locale);

export function I18nProvider({ children }: PropsWithChildren) {
  const savedLocale = readText(STORAGE_KEYS.locale, 'zh-CN');
  const [locale, setCurrentLocale] = useState<Locale>(isLocale(savedLocale) ? savedLocale : 'zh-CN');
  const catalogue = catalogues[locale];
  const setLocale = useCallback(async (nextLocale: Locale) => {
    setCurrentLocale(nextLocale);
    writeText(STORAGE_KEYS.locale, nextLocale);
  }, []);
  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t: (key) => catalogue[key], format: (key, values) => Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{{${name}}}`, String(value)), catalogue[key]) }), [catalogue, locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
