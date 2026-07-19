import React, { useState } from 'react';

interface SettingsModalProps {
  initialApiKey: string;
  initialBaseUrl: string;
  initialModel: string;
  onSave: (apiKey: string, baseUrl: string, model: string) => void;
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

// Using CSS classes from index.css instead of inline styles for responsive width

const SettingsModal: React.FC<SettingsModalProps> = ({ initialApiKey, initialBaseUrl, initialModel, onSave, onClose }) => {
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [model, setModel] = useState(initialModel);
  const [modelsList, setModelsList] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const handleFetchModels = async () => {
    if (!apiKey || !baseUrl) return;
    setIsFetchingModels(true);
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/models`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.data && Array.isArray(data.data)) {
          const ids = data.data.map((m: any) => m.id);
          setModelsList(ids);
          if (ids.length > 0 && !ids.includes(model)) {
            setModel(ids[0]);
          }
        }
      } else {
        alert('获取模型列表失败');
      }
    } catch (err) {
      console.error(err);
      alert('获取模型时出错');
    } finally {
      setIsFetchingModels(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={(e) => {
      // Allow closing only if API key is set
      if (initialApiKey && e.target === e.currentTarget) {
        onClose();
      }
    }}>
      <div className="settings-modal-content">
        <h2 style={{ fontSize: '24px', fontWeight: 600 }}>配置</h2>
        
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            接口地址 (OpenAI Compatible)
          </label>
          <input 
            className="input-field"
            style={{ width: '100%' }}
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            API 密钥
          </label>
          <input 
            className="input-field"
            style={{ width: '100%' }}
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            模型
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {modelsList.length > 0 ? (
              <select
                className="input-field"
                style={{ flex: 1 }}
                value={model}
                onChange={e => setModel(e.target.value)}
              >
                {modelsList.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input 
                className="input-field"
                style={{ flex: 1 }}
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="deepseek-v4-flash"
              />
            )}
            <button 
              onClick={handleFetchModels}
              disabled={isFetchingModels || !apiKey || !baseUrl}
              className="btn btn-secondary"
              style={{ whiteSpace: 'nowrap' }}
            >
              {isFetchingModels ? '获取中...' : '获取模型'}
            </button>
          </div>
        </div>

        <button 
          onClick={() => onSave(apiKey, baseUrl, model)}
          disabled={!apiKey || !model}
          className="btn btn-primary"
          style={{ width: '100%', marginTop: '10px' }}
        >
          保存并继续
        </button>
      </div>
    </div>
  );
};

export default SettingsModal;
