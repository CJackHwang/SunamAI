import React, { useState } from 'react';

interface SettingsModalProps {
  initialApiKey: string;
  initialBaseUrl: string;
  onSave: (apiKey: string, baseUrl: string) => void;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

// Using CSS class from index.css instead of inline style for responsive width

const inputStyle: React.CSSProperties = {
  padding: '12px',
  borderRadius: 'var(--radius-small)',
  border: '1px solid var(--color-border)',
  width: '100%',
  outline: 'none',
  fontSize: '14px'
};

const SettingsModal: React.FC<SettingsModalProps> = ({ initialApiKey, initialBaseUrl, onSave, onClose }) => {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);

  return (
    <div style={overlayStyle} onClick={(e) => {
      // Allow closing only if API key is set
      if (initialApiKey && e.target === e.currentTarget) {
        onClose();
      }
    }}>
      <div className="settings-modal-content">
        <h2 style={{ fontSize: '24px', fontWeight: 600 }}>Configuration</h2>
        
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            Base URL (OpenAI Compatible)
          </label>
          <input 
            style={inputStyle}
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            API Key
          </label>
          <input 
            style={inputStyle}
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </div>

        <button 
          onClick={() => onSave(apiKey, baseUrl)}
          disabled={!apiKey}
          style={{
            padding: '12px',
            borderRadius: 'var(--radius-small)',
            backgroundColor: apiKey ? 'var(--color-black)' : 'var(--color-border)',
            color: 'var(--color-white)',
            fontWeight: 600,
            marginTop: '10px'
          }}
        >
          Save and Continue
        </button>
      </div>
    </div>
  );
};

export default SettingsModal;
