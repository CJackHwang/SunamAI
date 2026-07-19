import React, { useState } from 'react';
import Workspace from '../widgets/workspace/Workspace.tsx';
import SettingsModal from '../widgets/settings/SettingsModal.tsx';
import { ChevronDown, PanelLeft } from 'lucide-react';
import { Sidebar } from '../widgets/sidebar/Sidebar.tsx';

const MainPage: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('sunam_api_key') || '');
  const [baseUrl, setBaseUrl] = useState<string>(() => localStorage.getItem('sunam_base_url') || 'https://api.deepseek.com/v1');
  const [model, setModel] = useState<string>(() => {
    const saved = localStorage.getItem('sunam_model');
    const validModels = ['Sunam 1.14 Homo', 'Sunam 1.14 Saki', 'Sunam 5.14 Homo', 'Sunam 5.14 Saki', 'Sunam NEGA 69B'];
    if (saved && validModels.includes(saved)) return saved;
    return 'Sunam 1.14 Homo';
  });
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(!apiKey);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

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

  const handleSelectModel = (selectedModel: string) => {
    setModel(selectedModel);
    localStorage.setItem('sunam_model', selectedModel);
    setIsModelMenuOpen(false);
  };

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Sidebar onOpenSettings={() => setIsSettingsOpen(true)} />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', backgroundColor: 'var(--color-bg)' }}>
        {/* Simplified Header just for Model Selector */}
        <header style={{
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          flexShrink: 0,
          backgroundColor: 'transparent',
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 50
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
            <button className="mobile-sidebar-toggle sidebar-icon-btn" style={{ display: 'none' }}>
              <PanelLeft size={20} />
            </button>
            <button 
              className="model-selector-btn"
              onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '18px',
                fontWeight: 600,
                color: 'var(--color-text)',
                padding: '8px 12px',
                borderRadius: 'var(--radius-small)',
                transition: 'background-color 0.2s',
              }}
            >
              {model}
              <ChevronDown size={18} style={{ color: 'var(--color-text-secondary)' }} />
            </button>

            {isModelMenuOpen && (
              <>
                <div className="context-overlay" onClick={() => setIsModelMenuOpen(false)} style={{ backgroundColor: 'transparent' }} />
                <div className="context-menu" style={{ position: 'absolute', top: '100%', left: '0', marginTop: '4px' }}>
                  <button className="context-item" onClick={() => handleSelectModel('Sunam 1.14 Homo')}>Sunam 1.14 Homo</button>
                  <button className="context-item" onClick={() => handleSelectModel('Sunam 1.14 Saki')}>Sunam 1.14 Saki</button>
                  <button className="context-item" onClick={() => handleSelectModel('Sunam 5.14 Homo')}>Sunam 5.14 Homo</button>
                  <button className="context-item" onClick={() => handleSelectModel('Sunam 5.14 Saki')}>Sunam 5.14 Saki</button>
                  <button className="context-item" onClick={() => handleSelectModel('Sunam NEGA 69B')}>Sunam NEGA 69B</button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Main Workspace Area */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {apiKey ? (
            <Workspace apiKey={apiKey} baseUrl={baseUrl} model={model} />
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
