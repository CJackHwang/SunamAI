import React, { useRef, useState } from 'react';
import DualTerminal from '../../features/terminal-session/DualTerminal.tsx';
import type { DualTerminalRef } from '../../features/terminal-session/DualTerminal.tsx';
import { useReActAgent } from '../../features/chat-agent/useReActAgent.ts';

interface WorkspaceProps {
  apiKey: string;
  baseUrl: string;
}

const Workspace: React.FC<WorkspaceProps> = ({ apiKey, baseUrl }) => {
  const terminalRef = useRef<DualTerminalRef>(null);
  const { messages, startTask, isRunning } = useReActAgent(apiKey, baseUrl, terminalRef);
  const [input, setInput] = useState('');
  const [isTermReady, setIsTermReady] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isRunning || !isTermReady) return;
    startTask(input);
    setInput('');
  };

  return (
    <div className="workspace-container">
      {/* Chat Section */}
      <div className="chat-section">
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
        <div style={{ padding: '24px' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '12px' }}>
            <input 
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={isRunning || !isTermReady}
              placeholder={isTermReady ? "Ask Sunam anything..." : "Booting container..."}
              style={{
                flex: 1,
                padding: '16px 24px',
                borderRadius: 'var(--radius-large)',
                border: '1px solid var(--color-border)',
                outline: 'none',
                fontSize: '15px'
              }}
            />
            <button 
              type="submit"
              disabled={isRunning || !isTermReady || !input.trim()}
              style={{
                padding: '0 24px',
                borderRadius: 'var(--radius-large)',
                backgroundColor: (isRunning || !isTermReady || !input.trim()) ? 'var(--color-border)' : 'var(--color-black)',
                color: 'var(--color-white)',
                fontWeight: 600
              }}
            >
              Send
            </button>
          </form>
        </div>
      </div>
      
      {/* Terminal Section */}
      <div className="terminal-section">
        <DualTerminal ref={terminalRef} onReady={() => setIsTermReady(true)} />
      </div>
    </div>
  );
};

export default Workspace;
