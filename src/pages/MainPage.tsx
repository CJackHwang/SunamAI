import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import SettingsModal from '../widgets/settings/SettingsModal.tsx';
import { Sidebar } from '../widgets/sidebar/Sidebar.tsx';
import { configureWorkspaceCreationDefaults, useWorkspaceActions, useWorkspaceSelector } from '@/entities/workspace/useWorkspaceStore';
import { readAppSettings, saveConnectionSettings, saveSunamModel } from '@/shared/lib/settings';
import type { SunamModel } from '@/shared/config/models';
import { useI18n, type Locale } from '@/shared/i18n';
import { LoadingState } from '@/shared/ui/AsyncState';
import './MainPage.css';

const ConfiguredPage = lazy(() => import('./ConfiguredPage'));

const MainPage: React.FC = () => {
  const [initialSettings] = useState(readAppSettings);
  const [apiKey, setApiKey] = useState(initialSettings.apiKey);
  const [baseUrl, setBaseUrl] = useState(initialSettings.baseUrl);
  const [apiModel, setApiModel] = useState(initialSettings.apiModel);
  const { locale, setLocale, t } = useI18n();
  configureWorkspaceCreationDefaults({ sessionTitle: t('workspace.defaultSessionName'), containerName: t('workspace.defaultContainerName') });
  const activeSessionId = useWorkspaceSelector((state) => state.activeSessionId);
  const activeContainerId = useWorkspaceSelector((state) => state.activeContainerId);
  const hydrated = useWorkspaceSelector((state) => state.hydrated);
  const persistenceError = useWorkspaceSelector((state) => state.persistenceError);
  const { updateSessionStatus, reloadWorkspace } = useWorkspaceActions();
  const [sunamModel, setSunamModel] = useState<SunamModel>(initialSettings.sunamModel);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(!apiKey);
  const [isSettingsClosing, setIsSettingsClosing] = useState(false);
  const settingsCloseTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (settingsCloseTimer.current !== null) window.clearTimeout(settingsCloseTimer.current);
  }, []);

  const openSettings = () => {
    if (settingsCloseTimer.current !== null) window.clearTimeout(settingsCloseTimer.current);
    settingsCloseTimer.current = null;
    setIsSettingsClosing(false);
    setIsSettingsOpen(true);
  };

  const closeSettings = () => {
    if (isSettingsClosing) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setIsSettingsOpen(false);
      return;
    }
    setIsSettingsClosing(true);
    settingsCloseTimer.current = window.setTimeout(() => {
      setIsSettingsOpen(false);
      setIsSettingsClosing(false);
      settingsCloseTimer.current = null;
    }, 240);
  };

  const handleSaveSettings = (key: string, url: string, newApiModel: string) => {
    setApiKey(key);
    setBaseUrl(url);
    setApiModel(newApiModel);
    saveConnectionSettings({ apiKey: key, baseUrl: url, apiModel: newApiModel });
    closeSettings();
  };

  const handleSunamModelChange = (model: SunamModel) => {
    setSunamModel(model);
    saveSunamModel(model);
  };


  return (
    <>
      {apiKey && hydrated ? <Suspense fallback={<LoadingState className="app-centered-state">{t('common.loading')}</LoadingState>}><ConfiguredPage apiKey={apiKey} baseUrl={baseUrl} apiModel={apiModel} sunamModel={sunamModel} setSunamModel={handleSunamModelChange} activeSessionId={activeSessionId} activeContainerId={activeContainerId} updateSessionStatus={updateSessionStatus} persistenceError={persistenceError} onReloadWorkspace={() => { void reloadWorkspace(); }}>{({ agent, conversationView, onConversationViewChange, isMobileOpen, onCloseMobile, containerAvailable }) => <Sidebar onOpenSettings={openSettings} isMobileOpen={isMobileOpen} onCloseMobile={onCloseMobile} agent={agent} conversationView={conversationView} onConversationViewChange={onConversationViewChange} containerAvailable={containerAvailable} />}</ConfiguredPage></Suspense> : <div className="app-container"><Sidebar onOpenSettings={openSettings} /><main className="app-main">{persistenceError && <div className="persistence-error motion-notice-in" role="alert"><span>{t('persistence.unavailable')}: {persistenceError}</span><button className="btn btn-secondary" onClick={() => { void reloadWorkspace(); }}>{t('common.retry')}</button></div>}<div className="app-workspace">{apiKey ? <LoadingState className="app-centered-state">{persistenceError ? t('persistence.unavailable') : t('common.loading')}</LoadingState> : <div className="app-centered-state"><p>{t('main.configureApiKey')}</p></div>}</div></main></div>}
      {isSettingsOpen && (
        <SettingsModal
          initialApiKey={apiKey}
          initialBaseUrl={baseUrl}
          initialModel={apiModel}
          locale={locale}
          onLocaleChange={(nextLocale: Locale) => setLocale(nextLocale)}
          onSave={handleSaveSettings}
          onClose={() => apiKey && closeSettings()}
          isExiting={isSettingsClosing}
        />
      )}
    </>
  );
};

export default MainPage;
