import { useState } from 'react';
import { Plus, Pencil, Trash2, Check } from 'lucide-react';
import { useI18n } from '@/shared/i18n';
import type { AppConfig } from '@/features/settings/useAppConfig';
import type { PersonaConfig } from '@/shared/config/personas';
import { DEFAULT_PERSONA_SYSTEM_PROMPT } from '@/shared/config/personas';
import { BUILTIN_PERSONA_PROMPTS } from '@/shared/config/personaPrompts';

interface PersonaFormState {
  name: string;
  systemPrompt: string;
  modelName: string;
  temperature: string;
  topP: string;
  maxTokens: string;
  bindingMode: 'auto' | 'provider';
  providerId: string;
  modelId: string;
  enabled: boolean;
}

function toFormState(persona: PersonaConfig): PersonaFormState {
  return {
    name: persona.name,
    systemPrompt: persona.systemPrompt,
    modelName: persona.modelName,
    temperature: persona.params.temperature != null ? String(persona.params.temperature) : '',
    topP: persona.params.topP != null ? String(persona.params.topP) : '',
    maxTokens: persona.params.maxTokens != null ? String(persona.params.maxTokens) : '',
    bindingMode: persona.binding.mode,
    providerId: persona.binding.providerId ?? '',
    modelId: persona.binding.modelId ?? '',
    enabled: persona.enabled,
  };
}

function emptyForm(): PersonaFormState {
  return {
    name: '',
    systemPrompt: DEFAULT_PERSONA_SYSTEM_PROMPT,
    modelName: '',
    temperature: '',
    topP: '',
    maxTokens: '',
    bindingMode: 'auto',
    providerId: '',
    modelId: '',
    enabled: true,
  };
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() !== '' ? parsed : undefined;
}

function bindingLabel(persona: PersonaConfig, config: AppConfig): string {
  if (persona.binding.mode === 'provider' && persona.binding.providerId) {
    const provider = config.providers.find((item) => item.id === persona.binding.providerId);
    return `${provider?.name ?? persona.binding.providerId} · ${persona.binding.modelId ?? ''}`;
  }
  return config.activeProviderId ? config.providers.find((item) => item.id === config.activeProviderId)?.name ?? 'auto' : 'auto';
}

export function PersonasPanel({ config }: { config: AppConfig }) {
  const { t } = useI18n();
  const [form, setForm] = useState<PersonaFormState>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const startAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setIsFormOpen(true);
  };

  const startEdit = (persona: PersonaConfig) => {
    setEditingId(persona.id);
    // 内置皮套未编辑时 systemPrompt 为空，编辑表单回填懒加载的全文提示词。
    const hydrated = persona.systemPrompt
      ? persona
      : { ...persona, systemPrompt: BUILTIN_PERSONA_PROMPTS[persona.name] ?? '' };
    setForm(toFormState(hydrated));
    setIsFormOpen(true);
  };

  const submit = () => {
    if (!form.name.trim()) return;
    const params: PersonaConfig['params'] = {};
    const temperature = parseNumber(form.temperature);
    const topP = parseNumber(form.topP);
    const maxTokens = parseNumber(form.maxTokens);
    if (temperature !== undefined) params.temperature = temperature;
    if (topP !== undefined) params.topP = topP;
    if (maxTokens !== undefined) params.maxTokens = maxTokens;
    const binding = form.bindingMode === 'provider'
      ? { mode: 'provider' as const, providerId: form.providerId, modelId: form.modelId.trim() }
      : { mode: 'auto' as const };
    if (editingId) {
      const existing = config.personas.find((item) => item.id === editingId);
      if (existing) config.updatePersona({ ...existing, name: form.name.trim(), systemPrompt: form.systemPrompt, modelName: form.modelName.trim(), params, binding, enabled: form.enabled });
    } else {
      config.addPersona({ name: form.name.trim(), systemPrompt: form.systemPrompt, modelName: form.modelName.trim(), params, binding, enabled: form.enabled });
    }
    setIsFormOpen(false);
    setEditingId(null);
  };

  const toggleEnabled = (persona: PersonaConfig) => {
    config.updatePersona({ ...persona, enabled: !persona.enabled });
  };

  const enabledPersonas = config.personas.filter((persona) => persona.enabled);

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <div className="settings-section-header">
          <h2 className="settings-section-title">{t('settings.personas')}</h2>
          <button className="btn btn-secondary settings-add-btn" onClick={startAdd}>
            <Plus size={16} />
            <span>{t('settings.addPersona')}</span>
          </button>
        </div>
        <p className="settings-section-hint">{t('settings.personasHint')}</p>
        {config.personas.length === 0 ? (
          <div className="settings-empty">{t('settings.noPersonas')}</div>
        ) : (
          <ul className="settings-list">
            {config.personas.map((persona) => (
              <li key={persona.id} className={`settings-item ${persona.id === config.activePersonaId ? 'is-active' : ''}`}>
                <div className="settings-item-main">
                  <div className="settings-item-title">
                    {persona.name}
                    {!persona.enabled && <span className="settings-disabled-badge">{t('settings.disabled')}</span>}
                    {persona.id === config.activePersonaId && <span className="settings-active-badge">{t('settings.active')}</span>}
                  </div>
                  <div className="settings-item-sub">{t('settings.binding')}: {bindingLabel(persona, config)}</div>
                  {Object.keys(persona.params).length > 0 && (
                    <div className="settings-item-sub">{t('settings.params')}: {Object.entries(persona.params).map(([key, value]) => `${key}=${value}`).join(' · ')}</div>
                  )}
                </div>
                <div className="settings-item-actions">
                  <button className="sidebar-icon-btn" onClick={() => toggleEnabled(persona)} title={persona.enabled ? t('settings.disable') : t('settings.enable')}>
                    <Check size={16} className={persona.enabled ? 'is-visible' : 'is-muted'} />
                  </button>
                  <button className="sidebar-icon-btn" onClick={() => startEdit(persona)} title={t('common.edit')}>
                    <Pencil size={16} />
                  </button>
                  <button
                    className="sidebar-icon-btn"
                    onClick={() => { if (window.confirm(t('settings.deletePersonaConfirm'))) config.removePersona(persona.id); }}
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

      {enabledPersonas.length === 0 && config.personas.length > 0 && (
        <div className="settings-warning">{t('settings.noEnabledPersonas')}</div>
      )}

      {isFormOpen && (
        <section className="settings-section settings-form-card">
          <h3 className="settings-form-title">{editingId ? t('settings.editPersona') : t('settings.addPersona')}</h3>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-persona-name">{t('settings.name')}</label>
            <input id="settings-persona-name" className="input-field settings-control" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Sunam 6.9 Pron" />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-persona-prompt">{t('settings.systemPrompt')}</label>
            <textarea id="settings-persona-prompt" className="input-field settings-control settings-textarea" rows={6} value={form.systemPrompt} onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))} />
          </div>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-persona-model">{t('settings.modelName')}</label>
            <input id="settings-persona-model" className="input-field settings-control" value={form.modelName} onChange={(event) => setForm((current) => ({ ...current, modelName: event.target.value }))} placeholder={t('settings.modelNamePlaceholder')} />
          </div>
          <div className="settings-field-grid">
            <div className="settings-field">
              <label className="settings-field-label" htmlFor="settings-persona-temperature">{t('settings.temperature')}</label>
              <input id="settings-persona-temperature" className="input-field settings-control" type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))} placeholder="0.7" />
            </div>
            <div className="settings-field">
              <label className="settings-field-label" htmlFor="settings-persona-topp">{t('settings.topP')}</label>
              <input id="settings-persona-topp" className="input-field settings-control" type="number" step="0.05" min="0" max="1" value={form.topP} onChange={(event) => setForm((current) => ({ ...current, topP: event.target.value }))} placeholder="1.0" />
            </div>
            <div className="settings-field">
              <label className="settings-field-label" htmlFor="settings-persona-maxtokens">{t('settings.maxTokens')}</label>
              <input id="settings-persona-maxtokens" className="input-field settings-control" type="number" step="64" min="0" value={form.maxTokens} onChange={(event) => setForm((current) => ({ ...current, maxTokens: event.target.value }))} placeholder="8192" />
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">{t('settings.binding')}</label>
            <div className="settings-radio-row">
              <label className="settings-radio">
                <input type="radio" checked={form.bindingMode === 'auto'} onChange={() => setForm((current) => ({ ...current, bindingMode: 'auto' }))} />
                <span>{t('settings.bindingAuto')}</span>
              </label>
              <label className="settings-radio">
                <input type="radio" checked={form.bindingMode === 'provider'} onChange={() => setForm((current) => ({ ...current, bindingMode: 'provider' }))} />
                <span>{t('settings.bindingProvider')}</span>
              </label>
            </div>
            {form.bindingMode === 'provider' && (
              <div className="settings-field-grid">
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="settings-persona-provider">{t('settings.provider')}</label>
                  <select id="settings-persona-provider" className="input-field settings-select" value={form.providerId} onChange={(event) => setForm((current) => ({ ...current, providerId: event.target.value }))}>
                    {config.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                  </select>
                </div>
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="settings-persona-provider-model">{t('settings.model')}</label>
                  <input id="settings-persona-provider-model" className="input-field settings-control" value={form.modelId} onChange={(event) => setForm((current) => ({ ...current, modelId: event.target.value }))} placeholder="deepseek-chat" />
                </div>
              </div>
            )}
          </div>
          <div className="settings-field">
            <label className="settings-checkbox">
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} />
              <span>{t('settings.enabled')}</span>
            </label>
          </div>
          <div className="settings-form-actions">
            <button className="btn btn-secondary" onClick={() => { setIsFormOpen(false); setEditingId(null); }}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={submit} disabled={!form.name.trim() || (form.bindingMode === 'provider' && !form.providerId)}>
              <Check size={16} />
              <span>{t('common.save')}</span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
