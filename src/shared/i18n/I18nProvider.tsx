import { useCallback, useMemo, useState, type PropsWithChildren } from 'react';
import { STORAGE_KEYS, readText, writeText } from '@/shared/lib/storage';
import { SUPPORTED_LOCALES, type Locale } from './config';
import { I18nContext, type I18nContextValue } from './context';
import { zhCN, type TranslationCatalogue } from './locales/zh-CN';

const catalogues: Partial<Record<Locale, TranslationCatalogue>> = { 'zh-CN': zhCN };
const isLocale = (value: string): value is Locale => SUPPORTED_LOCALES.includes(value as Locale);
async function getCatalogue(locale: Locale): Promise<TranslationCatalogue> {
  if (catalogues[locale]) return catalogues[locale];
  const module = await import('./locales/en-US');
  catalogues['en-US'] = module.enUS;
  return module.enUS;
}

export function I18nProvider({ children }: PropsWithChildren) {
  const savedLocale = readText(STORAGE_KEYS.locale, 'zh-CN');
  const [locale, setCurrentLocale] = useState<Locale>(isLocale(savedLocale) ? savedLocale : 'zh-CN');
  const [catalogue, setCatalogue] = useState<TranslationCatalogue>(() => catalogues[locale] ?? zhCN);
  const setLocale = useCallback(async (nextLocale: Locale) => {
    const nextCatalogue = await getCatalogue(nextLocale);
    setCatalogue(nextCatalogue);
    setCurrentLocale(nextLocale);
    writeText(STORAGE_KEYS.locale, nextLocale);
  }, []);
  const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t: (key) => catalogue[key] ?? zhCN[key], format: (key, values) => Object.entries(values).reduce((message, [name, value]) => message.replaceAll(`{{${name}}}`, String(value)), catalogue[key] ?? zhCN[key]) }), [catalogue, locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
