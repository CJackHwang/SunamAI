import React, { useRef, useState, Component } from 'react';
import type { ErrorInfo } from 'react';
import DualTerminal from '../../features/terminal-session/DualTerminal.tsx';
import MarkdownRenderer from '../../components/MarkdownRenderer';
import type { DualTerminalRef } from '../../features/terminal-session/DualTerminal.tsx';
import { useReActAgent } from '../../features/chat-agent/useReActAgent.ts';
import { Send, Square, Terminal, Monitor, Folder, MessageSquare } from 'lucide-react';

// Error boundary to catch rendering errors
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean, error: string }> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: '' }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.toString() }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) { console.error("Error Boundary caught:", error, errorInfo); }
  render() { 
    if (this.state.hasError) return <div style={{ color: 'red' }}>Error: {this.state.error}</div>; 
    return this.props.children; 
  }
}

interface WorkspaceProps {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const ThinkingProcess: React.FC<{ content: string }> = ({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content]);

  return (
    <div style={{ marginBottom: '12px', padding: '12px', backgroundColor: 'var(--color-gray-100)', borderRadius: 'var(--radius-small)', color: 'var(--color-text-secondary)', fontSize: '13px', fontStyle: 'italic', borderLeft: '3px solid var(--color-border)' }}>
      <div style={{ fontWeight: 600, marginBottom: '4px' }}>Thinking Process</div>
      <div ref={containerRef} style={{ whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>
        {content}
      </div>
    </div>
  );
};

const Workspace: React.FC<WorkspaceProps> = ({ apiKey, baseUrl, model }) => {
  const terminalRef = useRef<DualTerminalRef>(null);
  const { messages, startTask, stopTask, isRunning, retryCount } = useReActAgent(apiKey, baseUrl, model, terminalRef);
  const [input, setInput] = useState('');
  const [isTermReady, setIsTermReady] = useState(false);
  
  const [terminalTab, setTerminalTab] = useState<'ai' | 'user' | 'files'>('ai');
  const [mobileActive, setMobileActive] = useState<'chat' | 'ai' | 'user' | 'files'>('chat');
  const [layoutState, setLayoutState] = useState<'half' | 'full' | 'collapsed'>('half');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isRunning || !isTermReady) return;
    startTask(input);
    setInput('');
  };

  React.useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 900) {
        setLayoutState('half');
      }
    };
    
    handleResize(); // Check initially
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="workspace-container" data-active-tab={mobileActive}>
      {/* Chat Section */}
      <div className="chat-section" style={{ display: layoutState === 'full' ? 'none' : 'flex' }}>
        <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '24px', paddingTop: '84px', paddingBottom: '120px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.map((msg, idx) => {
            if (msg.role === 'tool') return null; // Hide tool messages, render them inside the assistant message
            if (msg.role === 'user' && msg.content.startsWith('SYSTEM ERROR:')) return null;
            
            const toolOutputs = msg.tool_calls ? messages.slice(idx + 1).filter(m => m.role === 'tool' && msg.tool_calls!.some(tc => tc.id === m.tool_call_id)) : [];
            
            return (
            <div key={idx} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: msg.role === 'user' ? 'var(--color-black)' : 'var(--color-surface)',
              color: msg.role === 'user' ? 'var(--color-white)' : 'var(--color-text)',
              padding: '16px 20px',
              borderRadius: 'var(--radius-large)',
              maxWidth: msg.role === 'user' ? '80%' : '100%',
              border: msg.role === 'user' ? 'none' : '1px solid var(--color-border)',
              wordBreak: 'break-word',
              /* Markdown renderer handles formatting for AI, user messages keep pre-wrap */
              whiteSpace: msg.role === 'user' ? 'pre-wrap' : 'normal',
              lineHeight: '1.6'
            }}>
              {msg.reasoning_content && <ThinkingProcess content={msg.reasoning_content} />}
              
              {msg.tool_calls ? (
                msg.tool_calls[0].function.name === 'chat' ? (
                  <div style={{ fontSize: '14.5px' }}>
                    <ErrorBoundary>
                      <MarkdownRenderer content={
                        (function() {
                          try {
                            return JSON.parse(msg.tool_calls[0].function.arguments).message || '';
                          } catch (e) {
                            return msg.tool_calls[0].function.arguments;
                          }
                        })()
                      } />
                    </ErrorBoundary>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '13px', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}>
                      <Terminal size={14} /> 
                      Executing: {msg.tool_calls[0].function.name}
                    </div>
                    {msg.tool_calls[0].function.arguments && (
                      <pre style={{ fontSize: '12px', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)', padding: '8px', borderRadius: '4px', overflowX: 'auto', margin: 0 }}>
                        {msg.tool_calls[0].function.arguments}
                      </pre>
                    )}
                    
                    {toolOutputs.length > 0 && (
                      <div style={{ marginTop: '4px', fontSize: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '8px' }}>
                        <div style={{ color: 'var(--color-text-secondary)', fontWeight: 600, marginBottom: '4px' }}>Result</div>
                        <div style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap', maxHeight: '150px', overflowY: 'auto', backgroundColor: 'var(--color-gray-100)', padding: '8px', borderRadius: '4px' }}>
                          {toolOutputs[0].content}
                        </div>
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div style={{ fontSize: '14.5px' }}>
                  {msg.role === 'user' ? (
                    msg.content
                  ) : (
                    <ErrorBoundary>
                      <MarkdownRenderer content={msg.content} />
                    </ErrorBoundary>
                  )}
                </div>
              )}
            </div>
            );
          })}
          {isRunning && (
            <div style={{ alignSelf: 'flex-start', color: 'var(--color-text-secondary)', fontSize: '14px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '8px' }}>
              Sunam is thinking...
              {retryCount > 0 && (
                <span style={{ fontSize: '12px', backgroundColor: 'var(--color-border)', padding: '2px 6px', borderRadius: '12px' }}>
                  Retry: {retryCount}
                </span>
              )}
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
              type={isRunning ? "button" : "submit"}
              onClick={isRunning ? stopTask : undefined}
              disabled={!isRunning && (!isTermReady || !input.trim())}
              className="btn btn-primary glass-btn"
              style={{ borderRadius: '50%', width: '44px', height: '44px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              {isRunning ? <Square size={16} fill="currentColor" /> : <Send size={20} style={{ marginLeft: '-2px' }} />}
            </button>
          </form>
        </div>
      </div>
      
      {/* Terminal Section */}
      <div className="terminal-section" style={{ 
        flex: layoutState === 'collapsed' ? '0 0 48px' : '1',
        minWidth: layoutState === 'collapsed' ? '48px' : '0',
        transition: 'all 0.2s ease',
        borderLeft: layoutState === 'collapsed' ? '1px solid var(--color-border)' : 'none',
        ...(layoutState === 'full' ? {
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          paddingTop: 0
        } : {})
      }}>
        <DualTerminal 
          ref={terminalRef} 
          onReady={() => setIsTermReady(true)}
          activeTab={terminalTab}
          onTabChange={(tab) => {
            setTerminalTab(tab);
            setMobileActive(tab);
          }}
          layoutState={layoutState}
          onLayoutChange={setLayoutState}
        />
      </div>

      {/* Mobile Bottom Bar */}
      <div className="mobile-bottom-bar">
        <button 
          className={mobileActive === 'chat' ? 'active' : ''} 
          onClick={() => setMobileActive('chat')}
          title="对话"
        >
          <MessageSquare size={24} />
        </button>
        <button 
          className={mobileActive === 'ai' ? 'active' : ''} 
          onClick={() => { setMobileActive('ai'); setTerminalTab('ai'); }}
          title="Sunam的电脑"
        >
          <Monitor size={24} />
        </button>
        <button 
          className={mobileActive === 'user' ? 'active' : ''} 
          onClick={() => { setMobileActive('user'); setTerminalTab('user'); }}
          title="终端"
        >
          <Terminal size={24} />
        </button>
        <button 
          className={mobileActive === 'files' ? 'active' : ''} 
          onClick={() => { setMobileActive('files'); setTerminalTab('files'); }}
          title="文件"
        >
          <Folder size={24} />
        </button>
      </div>
    </div>
  );
};

export default Workspace;
