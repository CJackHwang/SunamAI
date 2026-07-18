import React, { useRef, useState } from 'react';
import DualTerminal from '../../features/terminal-session/DualTerminal.tsx';
import type { DualTerminalRef } from '../../features/terminal-session/DualTerminal.tsx';
import { useReActAgent } from '../../features/chat-agent/useReActAgent.ts';
import { Send } from 'lucide-react';

interface WorkspaceProps {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const Workspace: React.FC<WorkspaceProps> = ({ apiKey, baseUrl, model }) => {
  const terminalRef = useRef<DualTerminalRef>(null);
  const { messages, startTask, isRunning } = useReActAgent(apiKey, baseUrl, model, terminalRef);
  const [input, setInput] = useState('');
  const [isTermReady, setIsTermReady] = useState(false);
  
  const [terminalTab, setTerminalTab] = useState<'ai' | 'user' | 'files'>('ai');
  const [mobileActive, setMobileActive] = useState<'chat' | 'ai' | 'user' | 'files'>('chat');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isRunning || !isTermReady) return;
    startTask(input);
    setInput('');
  };

  return (
    <div className="workspace-container" data-active-tab={mobileActive}>
      {/* Chat Section */}
      <div className="chat-section">
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '24px', paddingTop: '84px', paddingBottom: '120px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: msg.role === 'user' ? 'var(--color-black)' : 'var(--color-surface)',
              color: msg.role === 'user' ? 'var(--color-white)' : 'var(--color-text)',
              padding: '16px 20px',
              borderRadius: 'var(--radius-large)',
              maxWidth: '80%',
              border: msg.role === 'user' ? 'none' : '1px solid var(--color-border)',
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap'
            }}>
              {msg.role === 'tool' ? (
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  <strong>[Tool Output: {msg.name}]</strong><br/>
                  {msg.content.length > 500 ? msg.content.substring(0, 500) + '... (truncated)' : msg.content}
                </div>
              ) : msg.tool_calls ? (
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                  <strong>[Calling Tool: {msg.tool_calls[0].function.name}]</strong>
                </div>
              ) : (
                <div style={{ fontSize: '14px' }}>{msg.content}</div>
              )}
            </div>
          ))}
          {isRunning && (
            <div style={{ alignSelf: 'flex-start', color: 'var(--color-text-secondary)', fontSize: '14px', fontStyle: 'italic' }}>
              Sunam is thinking...
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px', pointerEvents: 'none' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '12px', alignItems: 'center', pointerEvents: 'auto' }}>
            <input 
              className="input-field glass-input"
              style={{ flex: 1, borderRadius: 'var(--radius-large)', padding: '0 20px 6px 20px', height: '44px' }}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isRunning || !isTermReady}
              placeholder={isTermReady ? "Ask Sunam anything..." : "Booting container..."}
            />
            <button 
              type="submit"
              disabled={isRunning || !isTermReady || !input.trim()}
              className="btn btn-primary glass-btn"
              style={{ borderRadius: '50%', width: '44px', height: '44px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <Send size={20} style={{ marginLeft: '-2px' }} />
            </button>
          </form>
        </div>
      </div>
      
      {/* Terminal Section */}
      <div className="terminal-section">
        <DualTerminal 
          ref={terminalRef} 
          onReady={() => setIsTermReady(true)}
          activeTab={terminalTab}
          onTabChange={(tab) => {
            setTerminalTab(tab);
            setMobileActive(tab);
          }}
        />
      </div>

      {/* Mobile Bottom Bar */}
      <div className="mobile-bottom-bar">
        <button 
          className={mobileActive === 'chat' ? 'active' : ''} 
          onClick={() => setMobileActive('chat')}
        >
          对话
        </button>
        <button 
          className={mobileActive === 'ai' ? 'active' : ''} 
          onClick={() => { setMobileActive('ai'); setTerminalTab('ai'); }}
        >
          Sunam的电脑
        </button>
        <button 
          className={mobileActive === 'user' ? 'active' : ''} 
          onClick={() => { setMobileActive('user'); setTerminalTab('user'); }}
        >
          终端
        </button>
        <button 
          className={mobileActive === 'files' ? 'active' : ''} 
          onClick={() => { setMobileActive('files'); setTerminalTab('files'); }}
        >
          文件
        </button>
      </div>
    </div>
  );
};

export default Workspace;
