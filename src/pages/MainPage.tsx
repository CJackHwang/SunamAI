import React, { useState } from 'react';
import Workspace from '../widgets/workspace/Workspace.tsx';
import SettingsModal from '../widgets/settings/SettingsModal.tsx';

const MainPage: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('sunam_api_key') || '');
  const [baseUrl, setBaseUrl] = useState<string>(() => localStorage.getItem('sunam_base_url') || 'https://api.deepseek.com/v1');
  const [isSettingsOpen, setIsSettingsOpen] = useState(!apiKey);

  const handleSaveSettings = (key: string, url: string) => {
    setApiKey(key);
    setBaseUrl(url);
    localStorage.setItem('sunam_api_key', key);
    localStorage.setItem('sunam_base_url', url);
    setIsSettingsOpen(false);
  };

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        height: '60px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        backgroundColor: 'var(--color-surface)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/icon.png" alt="Sunam" style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '4px' }} />
          <h1 style={{ fontSize: '24px', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.5px', transform: 'translateY(-4px)' }}>Sunam</h1>
        </div>
        <button 
          onClick={() => setIsSettingsOpen(true)}
          className="btn btn-secondary"
        >
          Settings
        </button>
      </header>

      <main style={{ flex: 1, overflow: 'hidden' }}>
        {apiKey ? (
          <Workspace apiKey={apiKey} baseUrl={baseUrl} />
        ) : (
          <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <p>Please configure your API Key to start.</p>
          </div>
        )}
      </main>

      {isSettingsOpen && (
        <SettingsModal
          initialApiKey={apiKey}
          initialBaseUrl={baseUrl}
          onSave={handleSaveSettings}
          onClose={() => apiKey && setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};

export default MainPage;
