import React, { useState } from 'react';
import { listModels } from '@/shared/api/models';
import { SUPPORTED_LOCALES, type Locale, useI18n } from '@/shared/i18n';

interface SettingsModalProps {
  initialApiKey: string;
  initialBaseUrl: string;
  initialModel: string;
  locale: Locale;
  onLocaleChange: (locale: Locale) => Promise<void>;
  onSave: (apiKey: string, baseUrl: string, model: string) => void;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

// Using CSS class from index.css instead of inline style for responsive width

// Using CSS classes from index.css instead of inline styles for responsive width

const SettingsModal: React.FC<SettingsModalProps> = ({ initialApiKey, initialBaseUrl, initialModel, locale, onLocaleChange, onSave, onClose }) => {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [model, setModel] = useState(initialModel);
  const [modelsList, setModelsList] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const handleFetchModels = async () => {
    if (!apiKey || !baseUrl) return;
    setIsFetchingModels(true);
    try {
      const ids = await listModels(apiKey, baseUrl);
      setModelsList(ids);
      if (ids.length > 0 && !ids.includes(model)) {
        setModel(ids[0]);
      }
    } catch (error) {
      console.error(error);
      alert(t('settings.fetchModelsError'));
    } finally {
      setIsFetchingModels(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={(e) => {
      // Allow closing only if API key is set
      if (initialApiKey && e.target === e.currentTarget) {
        onClose();
      }
    }}>
      <div className="settings-modal-content">
        <h2 style={{ fontSize: '24px', fontWeight: 600 }}>{t('settings.title')}</h2>
        
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            {t('settings.baseUrl')}
          </label>
          <input 
            className="input-field"
            style={{ width: '100%' }}
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            {t('settings.apiKey')}
          </label>
          <input 
            className="input-field"
            style={{ width: '100%' }}
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            {t('settings.model')}
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {modelsList.length > 0 ? (
              <select
                className="input-field"
                style={{ flex: 1 }}
                value={model}
                onChange={e => setModel(e.target.value)}
              >
                {modelsList.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input 
                className="input-field"
                style={{ flex: 1 }}
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="deepseek-v4-flash"
              />
            )}
            <button 
              onClick={handleFetchModels}
              disabled={isFetchingModels || !apiKey || !baseUrl}
              className="btn btn-secondary"
              style={{ whiteSpace: 'nowrap' }}
            >
              {isFetchingModels ? t('settings.fetchingModels') : t('settings.fetchModels')}
            </button>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            {t('settings.language')}
          </label>
          <select className="input-field" style={{ width: '100%' }} value={locale} onChange={(event) => { void onLocaleChange(event.target.value as Locale); }}>
            {SUPPORTED_LOCALES.map((supportedLocale) => <option key={supportedLocale} value={supportedLocale}>{supportedLocale}</option>)}
          </select>
        </div>

        <button 
          onClick={() => onSave(apiKey, baseUrl, model)}
          disabled={!apiKey || !model}
          className="btn btn-primary"
          style={{ width: '100%', marginTop: '10px' }}
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
};

export default SettingsModal;
