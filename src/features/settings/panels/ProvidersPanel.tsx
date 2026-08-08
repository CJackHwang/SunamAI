import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, Check } from 'lucide-react';
import { useI18n } from '@/shared/i18n';
import type { AppConfig } from '@/features/settings/useAppConfig';
import type { ProviderApi, ProviderConfig } from '@/shared/config/providers';
import { PROVIDER_PRESETS, getProviderPreset } from '@/features/settings/providerPresets';
import { listModels } from '@/shared/api/models';

interface ProviderFormState {
  presetId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  /** R4：渠道请求 API（预设选择时一并写入，随表单提交）。 */
  api: ProviderApi;
}

const EMPTY_FORM: ProviderFormState = { presetId: 'deepseek', name: '', baseUrl: '', apiKey: '', defaultModel: '', api: 'openai-completions' };

function toFormState(provider: ProviderConfig): ProviderFormState {
  return { presetId: provider.presetId, name: provider.name, baseUrl: provider.baseUrl, apiKey: provider.apiKey, defaultModel: provider.defaultModel, api: provider.api };
}

export function ProvidersPanel({ config }: { config: AppConfig }) {
  const { t } = useI18n();
  const [form, setForm] = useState<ProviderFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Global model selection state
  const [globalModelInput, setGlobalModelInput] = useState(config.globalModel || config.settings?.apiModel || '');
  const [globalModels, setGlobalModels] = useState<string[]>([]);
  const [isFetchingGlobal, setIsFetchingGlobal] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const activeProvider = config.providers.find((provider) => provider.id === config.activeProviderId) ?? config.providers[0];

  useEffect(() => {
    setGlobalModelInput(config.globalModel || activeProvider?.defaultModel || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.activeProviderId]);

  const handlePresetChange = (presetId: string) => {
    const preset = getProviderPreset(presetId);
    // M2（终审组2）：预设选择时把 preset.api 一并写入表单，避免 Anthropic 等预设
    // 落库后仍打 openai-completions（https://api.anthropic.com/v1/chat/completions 404）。
    setForm((current) => ({ ...current, presetId, baseUrl: preset?.defaultBaseUrl ?? '', defaultModel: preset?.defaultModel ?? '', api: preset?.api ?? 'openai-completions' }));
  };

  const startAdd = () => {
    setEditingId(null);
    const deepseek = getProviderPreset('deepseek');
    setForm({ ...EMPTY_FORM, baseUrl: deepseek?.defaultBaseUrl ?? '', defaultModel: deepseek?.defaultModel ?? '', api: deepseek?.api ?? 'openai-completions' });
    setIsFormOpen(true);
  };

  const startEdit = (provider: ProviderConfig) => {
    setEditingId(provider.id);
    setForm(toFormState(provider));
    setIsFormOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.defaultModel.trim()) return;
    if (editingId) {
      const existing = config.providers.find((provider) => provider.id === editingId);
      if (existing) config.updateProvider({ ...existing, ...form, name: form.name.trim(), baseUrl: form.baseUrl.trim(), defaultModel: form.defaultModel.trim() });
    } else {
      config.addProvider({ ...form, name: form.name.trim(), baseUrl: form.baseUrl.trim(), defaultModel: form.defaultModel.trim() });
    }
    setIsFormOpen(false);
    setEditingId(null);
  };

  const handleFetchGlobalModels = async () => {
    if (!activeProvider) return;
    if (!activeProvider.apiKey || !activeProvider.baseUrl) return;
    setIsFetchingGlobal(true);
    setFetchError(null);
    try {
      const ids = await listModels(activeProvider.apiKey, activeProvider.baseUrl);
      setGlobalModels(ids);
      if (ids.length > 0) {
        setGlobalModelInput((current) => (ids.includes(current) ? current : ids[0]!));
        config.selectGlobalModel(activeProvider.id, ids[0]!);
      }
    } catch {
      setFetchError(t('settings.fetchModelsError'));
    } finally {
      setIsFetchingGlobal(false);
    }
  };

  const handleGlobalProviderChange = (providerId: string) => {
    const provider = config.providers.find((item) => item.id === providerId);
    const model = globalModelInput || provider?.defaultModel || '';
    setGlobalModels([]);
    config.selectGlobalModel(providerId, model);
  };

  const handleGlobalModelChange = (modelId: string) => {
    setGlobalModelInput(modelId);
    if (activeProvider) config.selectGlobalModel(activeProvider.id, modelId);
  };

  const selectedPreset = getProviderPreset(form.presetId);

  return (
    <div className="settings-panel">
      {/* Global conversation model */}
      <section className="settings-section">
        <h2 className="settings-section-title">{t('settings.globalModel')}</h2>
        <p className="settings-section-hint">{t('settings.globalModelHint')}</p>
        {config.providers.length === 0 ? (
          <div className="settings-empty">{t('settings.noProviders')}</div>
        ) : (
          <div className="settings-global-row">
            <label className="settings-field-label" htmlFor="settings-global-provider">{t('settings.provider')}</label>
            <div className="settings-global-controls">
              <select
                id="settings-global-provider"
                className="input-field settings-select"
                value={activeProvider?.id ?? ''}
                onChange={(event) => handleGlobalProviderChange(event.target.value)}
              >
                {config.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
              <div className="settings-model-row">
                {globalModels.length > 0 ? (
                  <select
                    className="input-field settings-select"
                    aria-label={t('settings.model')}
                    value={globalModelInput}
                    onChange={(event) => handleGlobalModelChange(event.target.value)}
                  >
                    {globalModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                ) : (
                  <input
                    className="input-field settings-select"
                    aria-label={t('settings.model')}
                    value={globalModelInput}
                    onChange={(event) => handleGlobalModelChange(event.target.value)}
                    placeholder="deepseek-chat"
                  />
                )}
                <button
                  className="btn btn-secondary settings-fetch-button"
                  onClick={() => { void handleFetchGlobalModels(); }}
                  disabled={isFetchingGlobal || !activeProvider?.apiKey || !activeProvider?.baseUrl}
                >
                  {isFetchingGlobal ? <RefreshCw size={16} className="is-spinning" /> : <RefreshCw size={16} />}
                  <span>{t('settings.fetchModels')}</span>
                </button>
              </div>
            </div>
            {fetchError && <div className="settings-error">{fetchError}</div>}
          </div>
        )}
      </section>

      {/* Provider list */}
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">{t('settings.providers')}</h2>
          <button className="btn btn-secondary settings-add-btn" onClick={startAdd}>
            <Plus size={16} />
            <span>{t('settings.addProvider')}</span>
          </button>
        </div>
        {config.providers.length === 0 ? (
          <div className="settings-empty">{t('settings.noProviders')}</div>
        ) : (
          <ul className="settings-list">
            {config.providers.map((provider) => (
              <li key={provider.id} className={`settings-item ${provider.id === config.activeProviderId ? 'is-active' : ''}`}>
                <div className="settings-item-main">
                  <div className="settings-item-title">
                    {provider.name}
                    {provider.id === config.activeProviderId && <span className="settings-active-badge">{t('settings.active')}</span>}
                  </div>
                  <div className="settings-item-sub">{provider.baseUrl}</div>
                  <div className="settings-item-sub">{t('settings.defaultModel')}: {provider.defaultModel || '—'}</div>
                </div>
                <div className="settings-item-actions">
                  <button className="sidebar-icon-btn" onClick={() => startEdit(provider)} title={t('common.edit')}>
                    <Pencil size={16} />
                  </button>
                  <button
                    className="sidebar-icon-btn"
                    onClick={() => { if (window.confirm(t('settings.deleteProviderConfirm'))) config.removeProvider(provider.id); }}
                    title={t('common.delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add / edit form */}
      {isFormOpen && (
        <section className="settings-section settings-form-card">
          <h3 className="settings-form-title">{editingId ? t('settings.editProvider') : t('settings.addProvider')}</h3>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-provider-preset">{t('settings.providerType')}</label>
            <select
              id="settings-provider-preset"
              className="input-field settings-select"
              value={form.presetId}
              onChange={(event) => handlePresetChange(event.target.value)}
            >
              {PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-provider-name">{t('settings.name')}</label>
            <input id="settings-provider-name" className="input-field settings-control" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={selectedPreset?.name} />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-provider-url">{t('settings.baseUrl')}</label>
            <input id="settings-provider-url" className="input-field settings-control" value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.deepseek.com/v1" />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-provider-key">{t('settings.apiKey')}</label>
            <input id="settings-provider-key" className="input-field settings-control" type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="sk-..." />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-provider-model">{t('settings.defaultModel')}</label>
            <input id="settings-provider-model" className="input-field settings-control" value={form.defaultModel} onChange={(event) => setForm((current) => ({ ...current, defaultModel: event.target.value }))} placeholder="deepseek-chat" />
          </div>
          <div className="settings-form-actions">
            <button className="btn btn-secondary" onClick={() => { setIsFormOpen(false); setEditingId(null); }}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={!form.name.trim() || !form.baseUrl.trim() || !form.defaultModel.trim()}>
              <Check size={16} />
              <span>{t('common.save')}</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
