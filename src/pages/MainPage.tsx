import React, { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Sidebar } from '../widgets/sidebar/Sidebar.tsx';
import { configureWorkspaceCreationDefaults, useWorkspaceActions, useWorkspaceSelector } from '@/entities/workspace/useWorkspaceStore';
import { useAppConfig } from '@/features/settings/useAppConfig';
import { useI18n } from '@/shared/i18n';
import { LoadingState } from '@/shared/ui/AsyncState';
import './MainPage.css';

const ConfiguredPage = lazy(() => import('./ConfiguredPage'));
const SettingsPage = lazy(() => import('./SettingsPage'));

const MainPage: React.FC = () => {
  const config = useAppConfig();
  const { t } = useI18n();
  configureWorkspaceCreationDefaults({ sessionTitle: t('workspace.defaultSessionName'), containerName: t('workspace.defaultContainerName') });
  const activeSessionId = useWorkspaceSelector((state) => state.activeSessionId);
  const activeContainerId = useWorkspaceSelector((state) => state.activeContainerId);
  const hydrated = useWorkspaceSelector((state) => state.hydrated);
  const persistenceError = useWorkspaceSelector((state) => state.persistenceError);
  const { updateSessionStatus, reloadWorkspace } = useWorkspaceActions();

  const [view, setView] = useState<'main' | 'settings'>(() => (config.settings ? 'main' : 'settings'));

  const handleOpenSettings = useCallback(() => setView('settings'), []);
  const handleBackToMain = useCallback(() => setView('main'), []);

  const personaOptions = useMemo(
    () => config.personas.filter((persona) => persona.enabled).map((persona) => ({ id: persona.id, name: persona.name })),
    [config.personas],
  );

  const settings = config.settings;
  const activeProviderApi = settings ? config.providers.find((provider) => provider.id === settings.providerId)?.api : undefined;

  // 未配置供应商 → 直接进入独立设置页（替代旧弹窗配置门）。
  if (!settings || view === 'settings') {
    return <Suspense fallback={<LoadingState className="app-centered-state">{t('common.loading')}</LoadingState>}><SettingsPage config={config} onBack={settings ? handleBackToMain : () => undefined} /></Suspense>;
  }

  return (
    <>
      {settings && hydrated ? <Suspense fallback={<LoadingState className="app-centered-state">{t('common.loading')}</LoadingState>}><ConfiguredPage apiKey={settings.providerApiKey} baseUrl={settings.providerBaseUrl} apiModel={settings.apiModel} personaName={settings.personaName} systemPrompt={settings.systemPrompt} samplingParams={settings.params as Record<string, unknown>} {...(activeProviderApi ? { providerApi: activeProviderApi } : {})} personaOptions={personaOptions} onSelectPersona={config.selectPersona} activeSessionId={activeSessionId} activeContainerId={activeContainerId} updateSessionStatus={updateSessionStatus} persistenceError={persistenceError} onReloadWorkspace={() => { void reloadWorkspace(); }}>{({ agent, conversationView, onConversationViewChange, isMobileOpen, onCloseMobile, containerAvailable }) => <Sidebar onOpenSettings={handleOpenSettings} isMobileOpen={isMobileOpen} onCloseMobile={onCloseMobile} agent={agent} conversationView={conversationView} onConversationViewChange={onConversationViewChange} containerAvailable={containerAvailable} />}</ConfiguredPage></Suspense> : <div className="app-container"><Sidebar onOpenSettings={handleOpenSettings} /><main className="app-main">{persistenceError && <div className="persistence-error motion-notice-in" role="alert"><span>{t('persistence.unavailable')}: {persistenceError}</span><button className="btn btn-secondary" onClick={() => { void reloadWorkspace(); }}>{t('common.retry')}</button></div>}<div className="app-workspace"><LoadingState className="app-centered-state">{persistenceError ? t('persistence.unavailable') : t('common.loading')}</LoadingState></div></main></div>}
    </>
  );
};

export default MainPage;
