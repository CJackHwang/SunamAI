import React, { useState } from 'react';
import Workspace from '../widgets/workspace/Workspace.tsx';
import SettingsModal from '../widgets/settings/SettingsModal.tsx';
import { Sidebar } from '../widgets/sidebar/Sidebar.tsx';
import { useWorkspaceStore } from '../shared/store/useWorkspaceStore.ts';

const MainPage: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('sunam_api_key') || '');
  const [baseUrl, setBaseUrl] = useState<string>(() => localStorage.getItem('sunam_base_url') || 'https://api.deepseek.com/v1');
  const [apiModel, setApiModel] = useState<string>(() => localStorage.getItem('sunam_api_model') || 'deepseek-v4-flash');
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { activeSessionId, activeContainerId, updateSessionStatus } = useWorkspaceStore();
  
  const [sunamModel, setSunamModel] = useState<string>(() => {
    const saved = localStorage.getItem('sunam_model');
    const validModels = ['Sunam 1.14 Homo', 'Sunam 1.14 Saki', 'Sunam 5.14 Homo', 'Sunam 5.14 Saki', 'Sunam NEGA 69B'];
    if (saved && validModels.includes(saved)) return saved;
    return 'Sunam 1.14 Homo';
  });
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(!apiKey);

  const handleSaveSettings = (key: string, url: string, newApiModel: string) => {
    setApiKey(key);
    setBaseUrl(url);
    setApiModel(newApiModel);
    localStorage.setItem('sunam_api_key', key);
    localStorage.setItem('sunam_base_url', url);
    localStorage.setItem('sunam_api_model', newApiModel);
    setIsSettingsOpen(false);
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
            <Workspace 
              apiKey={apiKey} 
              baseUrl={baseUrl} 
              apiModel={apiModel}
              sunamModel={sunamModel} 
              setSunamModel={setSunamModel} 
              onMobileSidebarToggle={() => setIsMobileOpen(true)}
              activeSessionId={activeSessionId}
              activeContainerId={activeContainerId}
              updateSessionStatus={updateSessionStatus}
            />
          ) : (
            <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
              <p>Please configure your API Key to start.</p>
            </div>
          )}
        </div>
      </main>

      {isSettingsOpen && (
        <SettingsModal
          initialApiKey={apiKey}
          initialBaseUrl={baseUrl}
          initialModel={apiModel}
          onSave={handleSaveSettings}
          onClose={() => apiKey && setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export default MainPage;
