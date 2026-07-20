import { useState } from 'react';
import { listModels } from '@/shared/api/models';
import { SUPPORTED_LOCALES, type Locale, useI18n } from '@/shared/i18n';
import { Modal } from '@/shared/ui/Modal';
import { ErrorState } from '@/shared/ui/AsyncState';
import './SettingsModal.css';
import './SettingsLayout.css';

interface SettingsModalProps {
  initialApiKey: string;
  initialBaseUrl: string;
  initialModel: string;
  locale: Locale;
  onLocaleChange: (locale: Locale) => Promise<void>;
  onSave: (apiKey: string, baseUrl: string, model: string) => void;
  onClose: () => void;
  isExiting?: boolean;
}

const SettingsModal = ({ initialApiKey, initialBaseUrl, initialModel, locale, onLocaleChange, onSave, onClose, isExiting = false }: SettingsModalProps) => {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [model, setModel] = useState(initialModel);
  const [modelsList, setModelsList] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const handleFetchModels = async () => {
    if (!apiKey || !baseUrl) return;
    setIsFetchingModels(true);
    setFetchError(null);
    try {
      const ids = await listModels(apiKey, baseUrl);
      setModelsList(ids);
      if (ids.length > 0 && !ids.includes(model)) {
        setModel(ids[0]);
      }
    } catch {
      setFetchError(t('settings.fetchModelsError'));
    } finally {
      setIsFetchingModels(false);
    }
  };

  return (
    <Modal title={t('settings.title')} onDismiss={initialApiKey ? onClose : undefined} isExiting={isExiting}>
        
        <div className="settings-field">
          <label>
            {t('settings.baseUrl')}
          </label>
          <input 
            className="input-field settings-control"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
        </div>

        <div className="settings-field">
          <label>
            {t('settings.apiKey')}
          </label>
          <input 
            className="input-field settings-control"
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </div>

        <div className="settings-field">
          <label>
            {t('settings.model')}
          </label>
          <div className="settings-model-row">
            {modelsList.length > 0 ? (
              <select
                className="input-field settings-model-control"
                value={model}
                onChange={e => setModel(e.target.value)}
              >
                {modelsList.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input 
                className="input-field settings-model-control"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="deepseek-v4-flash"
              />
            )}
            <button 
              onClick={handleFetchModels}
              disabled={isFetchingModels || !apiKey || !baseUrl}
              className="btn btn-secondary settings-fetch-button"
            >
              {isFetchingModels ? t('settings.fetchingModels') : t('settings.fetchModels')}
            </button>
          </div>
        </div>

        <div className="settings-field">
          <label>
            {t('settings.language')}
          </label>
          <select className="input-field settings-control" value={locale} onChange={(event) => { void onLocaleChange(event.target.value as Locale); }}>
            {SUPPORTED_LOCALES.map((supportedLocale) => <option key={supportedLocale} value={supportedLocale}>{supportedLocale}</option>)}
          </select>
        </div>

        {fetchError && <ErrorState>{fetchError}</ErrorState>}

        <button 
          onClick={() => onSave(apiKey, baseUrl, model)}
          disabled={!apiKey || !model}
          className="btn btn-primary settings-save-button"
        >
          {t('common.save')}
        </button>
    </Modal>
  );
};

export default SettingsModal;
