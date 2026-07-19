import React, { lazy, Suspense, useState } from 'react';
import SettingsModal from '../widgets/settings/SettingsModal.tsx';
import { Sidebar } from '../widgets/sidebar/Sidebar.tsx';
import { useWorkspaceStore } from '../shared/store/useWorkspaceStore.ts';
import { readAppSettings, saveConnectionSettings, saveSunamModel } from '@/shared/lib/settings';
import type { SunamModel } from '@/shared/config/models';
import { useI18n, type Locale } from '@/shared/i18n';

const Workspace = lazy(() => import('../widgets/workspace/Workspace.tsx'));

const MainPage: React.FC = () => {
  const [initialSettings] = useState(readAppSettings);
  const [apiKey, setApiKey] = useState(initialSettings.apiKey);
  const [baseUrl, setBaseUrl] = useState(initialSettings.baseUrl);
  const [apiModel, setApiModel] = useState(initialSettings.apiModel);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { activeSessionId, activeContainerId, updateSessionStatus } = useWorkspaceStore();
  const { locale, setLocale, t } = useI18n();
  const [sunamModel, setSunamModel] = useState<SunamModel>(initialSettings.sunamModel);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(!apiKey);

  const handleSaveSettings = (key: string, url: string, newApiModel: string) => {
    setApiKey(key);
    setBaseUrl(url);
    setApiModel(newApiModel);
    saveConnectionSettings({ apiKey: key, baseUrl: url, apiModel: newApiModel });
    setIsSettingsOpen(false);
  };

  const handleSunamModelChange = (model: SunamModel) => {
    setSunamModel(model);
    saveSunamModel(model);
  };


  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Sidebar 
        onOpenSettings={() => setIsSettingsOpen(true)} 
        isMobileOpen={isMobileOpen} 
        onCloseMobile={() => setIsMobileOpen(false)} 
      />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', backgroundColor: 'var(--color-bg)' }}>
        {/* Main Workspace Area */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {apiKey ? (
            <Suspense fallback={<div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>{t('common.loading')}</div>}>
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
          ) : (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
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
          onClose={() => apiKey && setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export default MainPage;
