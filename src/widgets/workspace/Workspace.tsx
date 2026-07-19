import React, { useRef, useState, useEffect, Component } from 'react';
import type { ErrorInfo } from 'react';
import DualTerminal from '../../features/terminal-session/DualTerminal.tsx';
import MarkdownRenderer from '../../components/MarkdownRenderer';
import type { DualTerminalRef } from '../../features/terminal-session/DualTerminal.tsx';
import { useReActAgent } from '../../features/chat-agent/useReActAgent.ts';
import { useWorkspaceStore } from '../../shared/store/useWorkspaceStore.ts';
import { MessageSquare, Terminal, Monitor, Folder, Send, Server, PanelLeft, Square, ArrowDown } from 'lucide-react';

// Error boundary to catch rendering errors
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean, error: string }> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: '' }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.toString() }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) { console.error("Error Boundary caught:", error, errorInfo); }
  render() {
    if (this.state.hasError) return <div style={{ color: 'red' }}>错误: {this.state.error}</div>;
    return this.props.children;
  }
}

interface WorkspaceProps {
  apiKey: string;
  baseUrl: string;
  apiModel: string;
  sunamModel: string;
  setSunamModel: (model: string) => void;
  onMobileSidebarToggle?: () => void;
  activeSessionId: string | null;
  activeContainerId: string | null;
  updateSessionStatus: (id: string, status: any) => void;
}

/** 
 * Safely extracts the 'message' field from incomplete JSON during streaming.
 * This enables real-time Markdown rendering without exposing raw JSON syntax.
 */
function extractChatContent(argsString: string): string {
  if (!argsString) return '';
  try {
    return JSON.parse(argsString).message || '';
  } catch (e) {
    // If JSON is incomplete (streaming), extract the string using Regex
    const match = argsString.match(/"message"\s*:\s*"([\s\S]*)/);
    if (match) {
      let content = match[1];
      // Best-effort unescaping for markdown content
      content = content.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return content;
    }
    return ''; // Return empty string instead of raw JSON if not matched yet
  }
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
      <div style={{ fontWeight: 600, marginBottom: '4px' }}>思考过程</div>
      <div ref={containerRef} style={{ whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto' }}>
        {content}
      </div>
    </div>
  );
};

const Workspace: React.FC<WorkspaceProps> = ({ apiKey, baseUrl, apiModel, sunamModel, setSunamModel, onMobileSidebarToggle, activeSessionId, activeContainerId, updateSessionStatus }) => {
  const terminalRef = useRef<DualTerminalRef>(null);
  const { messages, startTask, stopTask, retryCount } = useReActAgent(apiKey, baseUrl, apiModel, sunamModel, terminalRef, activeSessionId, activeContainerId, updateSessionStatus);
  const { sessions, createSession, createContainer } = useWorkspaceStore();
  const isRunning = sessions.find(s => s.id === activeSessionId)?.status === 'running';
  
  const [input, setInput] = useState('');
  const [isTermReady, setIsTermReady] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  const [terminalTab, setTerminalTab] = useState<'ai' | 'user' | 'files' | 'services'>('ai');
  const [mobileActive, setMobileActive] = useState<'chat' | 'ai' | 'user' | 'files' | 'services'>('chat');
  const [layoutState, setLayoutState] = useState<'half' | 'full' | 'collapsed'>('half');
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const handleScroll = () => {
    const container = chatContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setIsAtBottom(atBottom);
  };

  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [messages, isRunning]);

  const handleSubmit = (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isRunning || !isTermReady) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = createSession();
    }
    
    let containerId = activeContainerId;
    if (!containerId) {
      containerId = createContainer();
    }

    startTask(input, sessionId, containerId);
    setInput('');
  };

  React.useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 900;
      if (mobile) {
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
        <header style={{
          height: '54px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          flexShrink: 0,
          backgroundColor: 'color-mix(in srgb, var(--color-bg) 75%, transparent)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: 'none',
          position: 'absolute',
          top: 0, left: 0, right: 0,
          zIndex: 50
        }}>
          <div className="workspace-header-left" style={{ margin: 0 }}>
            <button className="mobile-sidebar-toggle sidebar-icon-btn" style={{ display: 'none' }} onClick={onMobileSidebarToggle}>
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
                border: 'none',
                background: 'transparent',
                cursor: 'pointer'
              }}
            >
              {sunamModel}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-secondary)' }}><path d="m6 9 6 6 6-6" /></svg>
            </button>

            {isModelMenuOpen && (
              <>
                <div 
                  className="context-overlay dimmed"
                  onClick={() => setIsModelMenuOpen(false)} 
                  style={{ 
                    top: '-100vh', bottom: '-100vh', left: '-100vw', right: '-100vw', 
                    zIndex: 900
                  }} 
                />
                <div style={{ 
                  position: 'absolute', top: '100%', left: '0', marginTop: '4px',
                  backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-medium)',
                  boxShadow: 'var(--elevation-4)', padding: '4px', minWidth: '180px', zIndex: 1001,
                  display: 'flex', flexDirection: 'column'
                }}>
                  <button className="context-item" onClick={() => { setSunamModel('Sunam 1.14 Homo'); localStorage.setItem('sunam_model', 'Sunam 1.14 Homo'); setIsModelMenuOpen(false); }}>Sunam 1.14 Homo</button>
                  <button className="context-item" onClick={() => { setSunamModel('Sunam 1.14 Saki'); localStorage.setItem('sunam_model', 'Sunam 1.14 Saki'); setIsModelMenuOpen(false); }}>Sunam 1.14 Saki</button>
                  <button className="context-item" onClick={() => { setSunamModel('Sunam 5.14 Homo'); localStorage.setItem('sunam_model', 'Sunam 5.14 Homo'); setIsModelMenuOpen(false); }}>Sunam 5.14 Homo</button>
                  <button className="context-item" onClick={() => { setSunamModel('Sunam 5.14 Saki'); localStorage.setItem('sunam_model', 'Sunam 5.14 Saki'); setIsModelMenuOpen(false); }}>Sunam 5.14 Saki</button>
                  <button className="context-item" onClick={() => { setSunamModel('Sunam NEGA 69B'); localStorage.setItem('sunam_model', 'Sunam NEGA 69B'); setIsModelMenuOpen(false); }}>Sunam NEGA 69B</button>
                </div>
              </>
            )}
          </div>
        </header>
        <div ref={chatContainerRef} onScroll={handleScroll} style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '24px', paddingTop: '84px', paddingBottom: '100px', display: 'flex', flexDirection: 'column', gap: '16px', scrollBehavior: 'smooth' }}>
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

                {msg.content && msg.content.trim() && msg.role !== 'user' && (
                  <div style={{ fontSize: '14.5px', marginBottom: msg.tool_calls ? '12px' : '0' }}>
                    <ErrorBoundary>
                      <MarkdownRenderer content={msg.content} />
                    </ErrorBoundary>
                  </div>
                )}
                
                {msg.role === 'user' && !msg.tool_calls && (
                  <div style={{ fontSize: '14.5px' }}>
                    {msg.content}
                  </div>
                )}

                {msg.tool_calls && (
                  msg.tool_calls[0].function.name === 'chat' ? (
                    <div style={{ fontSize: '14.5px' }}>
                      <ErrorBoundary>
                        <MarkdownRenderer content={extractChatContent(msg.tool_calls[0].function.arguments)} />
                      </ErrorBoundary>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ fontSize: '13px', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}>
                        <Terminal size={14} />
                        执行中: {msg.tool_calls[0].function.name}
                      </div>
                      {msg.tool_calls[0].function.arguments && (
                        <pre style={{ fontSize: '12px', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)', padding: '8px', borderRadius: '4px', overflowX: 'auto', margin: 0 }}>
                          {msg.tool_calls[0].function.arguments}
                        </pre>
                      )}

                      {toolOutputs.length > 0 && (
                        <div style={{ marginTop: '4px', fontSize: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '8px' }}>
                          <div style={{ color: 'var(--color-text-secondary)', fontWeight: 600, marginBottom: '4px' }}>结果</div>
                          <div style={{ color: 'var(--color-text)', whiteSpace: 'pre-wrap', maxHeight: '150px', overflowY: 'auto', backgroundColor: 'var(--color-gray-100)', padding: '8px', borderRadius: '4px' }}>
                            {toolOutputs[0].content}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            );
          })}
          {isRunning && (
            <div style={{ alignSelf: 'flex-start', color: 'var(--color-text-secondary)', fontSize: '14px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '8px' }}>
              Sunam 正在思考...
              {retryCount > 0 && (
                <span style={{ fontSize: '12px', backgroundColor: 'var(--color-border)', padding: '2px 6px', borderRadius: '12px' }}>
                  重试: {retryCount}
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 24px', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px' }}>
          {!isAtBottom && (
            <button 
              onClick={scrollToBottom}
              className="glass-input"
              style={{
                pointerEvents: 'auto',
                width: '44px', height: '44px', borderRadius: '50%', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
                color: 'var(--color-text)',
                transition: 'filter 0.2s'
              }}
              onMouseOver={e => e.currentTarget.style.filter = 'brightness(0.95)'}
              onMouseOut={e => e.currentTarget.style.filter = 'none'}
              title="回到底部"
            >
              <ArrowDown size={16} />
            </button>
          )}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', pointerEvents: 'auto', width: '100%' }}>
            <textarea
              className="input-field glass-input"
              rows={1}
              style={{ 
                flex: 1, 
                borderRadius: '22px', 
                padding: '10px 20px', 
                minHeight: '44px', 
                height: '44px',
                maxHeight: '120px', 
                resize: 'none',
                overflowY: 'auto',
                lineHeight: '24px',
                fontFamily: 'inherit',
                boxSizing: 'border-box'
              }}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                e.target.style.height = '44px';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                  setTimeout(scrollToBottom, 50);
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = '44px';
                }
              }}
              disabled={isRunning || !isTermReady}
              placeholder={isTermReady ? "问 Sunam 任何问题..." : "容器启动中..."}
            />
            <button
              type="button"
              onClick={(e) => {
                if (isRunning) {
                  stopTask();
                } else {
                  handleSubmit(e);
                  setTimeout(scrollToBottom, 50);
                  const textarea = e.currentTarget.previousElementSibling as HTMLTextAreaElement;
                  if (textarea) textarea.style.height = '44px';
                }
              }}
              disabled={!isRunning && (!isTermReady || !input.trim())}
              className="btn btn-primary glass-btn"
              style={{ borderRadius: '50%', width: '44px', height: '44px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: '0' }}
            >
              {isRunning ? <Square size={16} fill="currentColor" /> : <Send size={20} style={{ marginLeft: '-2px' }} />}
            </button>
          </div>
        </div>
      </div>

      <div className="terminal-section" style={{
        flex: layoutState === 'collapsed' ? '0 0 56px' : '1',
        minWidth: layoutState === 'collapsed' ? '56px' : '0',
        transition: 'all 0.2s ease',
        borderLeft: 'none',
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
          activeContainerId={activeContainerId}
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
        <button
          className={mobileActive === 'services' ? 'active' : ''}
          onClick={() => { setMobileActive('services'); setTerminalTab('services'); }}
          title="服务"
        >
          <Server size={24} />
        </button>
      </div>
    </div>
  );
};

export default Workspace;
