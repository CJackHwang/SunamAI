import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import SettingsModal from '../widgets/settings/SettingsModal.tsx';
import { Sidebar } from '../widgets/sidebar/Sidebar.tsx';
import { useWorkspaceStore } from '@/entities/workspace/store';
import { readAppSettings, saveConnectionSettings, saveSunamModel } from '@/shared/lib/settings';
import type { SunamModel } from '@/shared/config/models';
import { useI18n, type Locale } from '@/shared/i18n';
import { LoadingState } from '@/shared/ui/AsyncState';
import './MainPage.css';

const Workspace = lazy(() => import('../widgets/workspace/Workspace.tsx'));

const MainPage: React.FC = () => {
  const [initialSettings] = useState(readAppSettings);
  const [apiKey, setApiKey] = useState(initialSettings.apiKey);
  const [baseUrl, setBaseUrl] = useState(initialSettings.baseUrl);
  const [apiModel, setApiModel] = useState(initialSettings.apiModel);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { activeSessionId, activeContainerId, updateSessionStatus, hydrated, persistenceError, reloadWorkspace } = useWorkspaceStore();
  const { locale, setLocale, t } = useI18n();
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
    <div className="app-container">
      <Sidebar 
        onOpenSettings={openSettings}
        isMobileOpen={isMobileOpen} 
        onCloseMobile={() => setIsMobileOpen(false)} 
      />

      <main className="app-main">
        {persistenceError && <div className="persistence-error motion-notice-in" role="alert"><span>{t('persistence.unavailable')}: {persistenceError}</span><button className="btn btn-secondary" onClick={() => { void reloadWorkspace(); }}>{t('common.retry')}</button></div>}
        {/* Main Workspace Area */}
        <div className="app-workspace">
          {apiKey && hydrated ? (
            <Suspense fallback={<LoadingState className="app-centered-state">{t('common.loading')}</LoadingState>}>
              <Workspace
                apiKey={apiKey}
                baseUrl={baseUrl}
                apiModel={apiModel}
                sunamModel={sunamModel}
                setSunamModel={handleSunamModelChange}
                onMobileSidebarToggle={() => setIsMobileOpen(true)}
                activeSessionId={activeSessionId}
                activeContainerId={activeContainerId}
                updateSessionStatus={updateSessionStatus}
              />
            </Suspense>
          ) : apiKey ? (
            <LoadingState className="app-centered-state">{persistenceError ? t('persistence.unavailable') : t('common.loading')}</LoadingState>
          ) : (
            <div className="app-centered-state">
              <p>{t('main.configureApiKey')}</p>
            </div>
          )}
        </div>
      </main>

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
    </div>
  );
};

export default MainPage;
