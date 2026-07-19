import React, { useState } from 'react';
import Workspace from '../widgets/workspace/Workspace.tsx';
import SettingsModal from '../widgets/settings/SettingsModal.tsx';
import { Sidebar } from '../widgets/sidebar/Sidebar.tsx';

const MainPage: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('sunam_api_key') || '');
  const [baseUrl, setBaseUrl] = useState<string>(() => localStorage.getItem('sunam_base_url') || 'https://api.deepseek.com/v1');
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [model, setModel] = useState<string>(() => {
    const saved = localStorage.getItem('sunam_model');
    const validModels = ['Sunam 1.14 Homo', 'Sunam 1.14 Saki', 'Sunam 5.14 Homo', 'Sunam 5.14 Saki', 'Sunam NEGA 69B'];
    if (saved && validModels.includes(saved)) return saved;
    return 'Sunam 1.14 Homo';
  });
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(!apiKey);

  const handleSaveSettings = (key: string, url: string, newModel: string) => {
    setApiKey(key);
    setBaseUrl(url);
    // Only update model from settings if we want to override, but typically we want it independent now
    // Actually let's keep it syncing for now
    setModel(newModel);
    localStorage.setItem('sunam_api_key', key);
    localStorage.setItem('sunam_base_url', url);
    localStorage.setItem('sunam_model', newModel);
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
              model={model} 
              setModel={setModel} 
              onMobileSidebarToggle={() => setIsMobileOpen(true)} 
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
          initialModel={model}
          onSave={handleSaveSettings}
          onClose={() => apiKey && setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export default MainPage;
