import React, { useState } from 'react';
import Workspace from '../widgets/workspace/Workspace.tsx';
import SettingsModal from '../widgets/settings/SettingsModal.tsx';
import { Settings, CircleUser } from 'lucide-react';

const MainPage: React.FC = () => {
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem('sunam_api_key') || '');
  const [baseUrl, setBaseUrl] = useState<string>(() => localStorage.getItem('sunam_base_url') || 'https://api.deepseek.com/v1');
  const [model, setModel] = useState<string>(() => localStorage.getItem('sunam_model') || 'deepseek-v4-flash');
  const [isSettingsOpen, setIsSettingsOpen] = useState(!apiKey);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);

  const handleSaveSettings = (key: string, url: string, newModel: string) => {
    setApiKey(key);
    setBaseUrl(url);
    setModel(newModel);
    localStorage.setItem('sunam_api_key', key);
    localStorage.setItem('sunam_base_url', url);
    localStorage.setItem('sunam_model', newModel);
    setIsSettingsOpen(false);
  };

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
      <header className="glass-header" style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: '60px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/icon.png" alt="Sunam" style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '4px' }} />
          <h1 className="header-title" style={{ fontSize: '24px', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.5px', transform: 'translateY(-4px)' }}>Sunam</h1>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}>
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="header-settings-btn"
            style={{ width: '40px', height: '40px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-black)' }}
          >
            <Settings size={22} />
          </button>
          
          <button
            onClick={() => setIsAvatarMenuOpen(!isAvatarMenuOpen)}
            style={{ width: '40px', height: '40px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-black)' }}
          >
            <img src="/head.jpeg" alt="Avatar" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--color-border)' }} />
          </button>

        </div>
      </header>

      <main style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
        {apiKey ? (
          <Workspace apiKey={apiKey} baseUrl={baseUrl} model={model} />
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
          initialModel={model}
          onSave={handleSaveSettings}
          onClose={() => apiKey && setIsSettingsOpen(false)}
        />
      )}

      {isAvatarMenuOpen && (
        <>
          <div className="context-overlay dimmed" onClick={() => setIsAvatarMenuOpen(false)} />
          <div className="avatar-menu" style={{ position: 'fixed', right: '24px', left: 'auto', top: '56px', zIndex: 1001 }}>
            <button className="context-item" onClick={() => setIsAvatarMenuOpen(false)}>
              <CircleUser size={16} className="context-item-icon" /> 登录 / 注册
            </button>
            <div className="context-divider mobile-only-setting" style={{ margin: '4px 8px' }} />
            <button 
              className="context-item mobile-only-setting" 
              onClick={() => { setIsSettingsOpen(true); setIsAvatarMenuOpen(false); }}
            >
              <Settings size={16} className="context-item-icon" /> 设置
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default MainPage;
