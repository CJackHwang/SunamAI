import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { SUPPORTED_LOCALES, type Locale, useI18n } from '@/shared/i18n';
import type { AppConfig } from '@/features/settings/useAppConfig';
import { ProvidersPanel } from '@/features/settings/panels/ProvidersPanel';
import { PersonasPanel } from '@/features/settings/panels/PersonasPanel';
import { AboutPanel } from '@/features/settings/panels/AboutPanel';
import './SettingsPage.css';

type SettingsTab = 'providers' | 'personas' | 'about';

interface SettingsPageProps {
  config: AppConfig;
  onBack: () => void;
}

/**
 * R3：独立设置页（替代弹窗，为以后扩展留栏目位）。三栏目：供应商 / 皮套 / 关于。
 * 样式对齐现有设计规范（专业克制 / 全英文 / 无 emoji），参考 HeyMean SettingsPage 布局。
 */
export default function SettingsPage({ config, onBack }: SettingsPageProps) {
  const { locale, setLocale, t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>('providers');

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <button className="settings-back-btn" onClick={onBack} aria-label={t('settings.back')}>
          <ArrowLeft size={20} />
        </button>
        <h1 className="settings-page-title">{t('settings.title')}</h1>
        <select
          className="settings-locale-select"
          aria-label={t('settings.language')}
          value={locale}
          onChange={(event) => { void setLocale(event.target.value as Locale); }}
        >
          {SUPPORTED_LOCALES.map((supportedLocale) => <option key={supportedLocale} value={supportedLocale}>{supportedLocale}</option>)}
        </select>
      </header>
      <nav className="settings-tabs" role="tablist" aria-label={t('settings.sections')}>
        {(['providers', 'personas', 'about'] as const).map((candidate) => (
          <button
            key={candidate}
            role="tab"
            aria-selected={tab === candidate}
            className={`settings-tab ${tab === candidate ? 'is-active' : ''}`}
            onClick={() => setTab(candidate)}
          >
            {t(`settings.tab.${candidate}`)}
          </button>
        ))}
      </nav>
      <div className="settings-page-body">
        {tab === 'providers' && <ProvidersPanel config={config} />}
        {tab === 'personas' && <PersonasPanel config={config} />}
        {tab === 'about' && <AboutPanel />}
      </div>
    </div>
  );
}
