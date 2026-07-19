import React, { useState, useEffect, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Terminal } from '@xterm/xterm';
import { Loader2, Maximize2, Minimize2, PanelRightClose, Monitor, Terminal as TerminalIcon, Folder, Server, Trash2, StopCircle, Globe, RotateCw, Search, ArrowLeft } from 'lucide-react';
import TerminalView from '../../entities/container/TerminalView.tsx';
import { getWebContainer } from '../../shared/lib/webcontainer.ts';
import { saveSnapshot } from '../../shared/lib/persistence.ts';
import FileManager from '../file-manager/FileManager.tsx';

export interface DualTerminalRef {
  spawnAiProcess: (command: string, containerId: string) => Promise<string>;
  getAiProcessStatus: (processId: string) => { isRunning: boolean; output: string } | null;
  sendAiProcessInput: (processId: string, input: string) => Promise<boolean>;
  killAiProcess: (processId: string) => void;
}

interface DualTerminalProps {
  onReady?: () => void;
  activeTab: 'ai' | 'user' | 'files' | 'services' | 'preview';
  onTabChange: (tab: 'ai' | 'user' | 'files' | 'services' | 'preview') => void;
  layoutState?: 'half' | 'full' | 'collapsed';
  onLayoutChange?: (state: 'half' | 'full' | 'collapsed') => void;
  activeContainerId?: string | null;
}

const DualTerminal = React.forwardRef<DualTerminalRef, DualTerminalProps>(({ onReady, activeTab, onTabChange, layoutState = 'half', onLayoutChange, activeContainerId }, ref) => {
  const aiTermRef = useRef<Terminal | null>(null);
  const userTermRef = useRef<Terminal | null>(null);
  const [isUserTermReady, setIsUserTermReady] = useState(false);
  const [wc, setWc] = useState<WebContainer | null>(null);
  const [isBooted, setIsBooted] = useState(false);
  const [readyContainerId, setReadyContainerId] = useState<string | null>(null);
  const userShellWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  
  // Track active AI processes and trigger UI updates
  const activeAiProcesses = useRef(new Map<string, { process: any, output: string, isRunning: boolean, command: string }>());
  const [, setProcessVersion] = useState(0);
  const forceUpdateProcesses = () => setProcessVersion(v => v + 1);

  // Track exposed ports and preview URL
  const [activePorts, setActivePorts] = useState<{ port: number, url: string }[]>([]);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);

  // Store onReady in a ref to prevent infinite loops if parent passes inline function
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let mounted = true;
    getWebContainer().then(instance => {
      if (mounted) {
        setWc(instance);
        onReadyRef.current?.();
      }
    });
    return () => { mounted = false; };
  }, []);

  // Boot user terminal shell when WC and user term are ready
  useEffect(() => {
    if (!wc || !isUserTermReady || !userTermRef.current) return;

    let process: any;
    let onDataDisposable: any;
    const bootShell = async () => {
      process = await wc.spawn('jsh');

      let hasReceivedOutput = false;

      process.output.pipeTo(new WritableStream({
        write(data) {
          userTermRef.current?.write(data);
          if (!hasReceivedOutput) {
            hasReceivedOutput = true;
            setIsBooted(true); // Now we only hide the loader when the shell ACTUALLY prints the prompt!
          }
        }
      }));

      const shellWriter = process.input.getWriter();
      userShellWriterRef.current = shellWriter;

      onDataDisposable = userTermRef.current?.onData((data) => {
        shellWriter.write(data);
      });
    };
    bootShell();

    return () => {
      if (process) process.kill();
      userShellWriterRef.current = null;
      // MUST dispose the listener or it will try to write to a killed shell!
      if (onDataDisposable) onDataDisposable.dispose();
    };
  }, [wc, isUserTermReady]);

  // Setup active container directory
  useEffect(() => {
    if (!wc || !isBooted || !activeContainerId) return;
    
    const setupContainer = async () => {
      try {
        const containerPath = `/${activeContainerId}`;
        await wc.fs.mkdir(containerPath, { recursive: true });
        
        // Change user terminal working directory
        if (userShellWriterRef.current) {
          userShellWriterRef.current.write(`cd ~/sunam${containerPath}\r`);
        }
        
        // Signal FileManager that the directory is ready
        setReadyContainerId(activeContainerId);

        // Attach server-ready listener
        const handleServerReady = (port: number, url: string) => {
          setActivePorts(prev => {
            const filtered = prev.filter(p => p.port !== port);
            return [...filtered, { port, url }];
          });
        };
        
        wc.on('server-ready', handleServerReady);
      } catch (err) {
        console.error('Failed to setup container:', err);
      }
    };
    
    setupContainer();
  }, [wc, isBooted, activeContainerId]);

  // Auto-save filesystem snapshot every 30s while container is running
  useEffect(() => {
    if (!wc || !isBooted) return;

    const interval = setInterval(() => {
      saveSnapshot(wc);
    }, 30_000);

    // Also save once when the page is about to unload
    const handleBeforeUnload = () => { saveSnapshot(wc); };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [wc, isBooted]);

  // Refocus terminal when switching tabs so the cursor reappears
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === 'user') {
        userTermRef.current?.focus();
      } else {
        aiTermRef.current?.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [activeTab]);

  React.useImperativeHandle(ref, () => ({
    spawnAiProcess: async (command: string, containerId: string) => {
      if (!wc) throw new Error("WebContainer not booted");
      
      const term = aiTermRef.current;
      const processId = `proc-${Date.now().toString(36)}`;
      
      if (term) {
        term.writeln(`\r\n[Background Process ${processId}] Admin@Sunam ~ # ${command}`);
      }

      const spawnCwd = `/${containerId}`;
      const process = await wc.spawn('jsh', ['-c', command], { env: {}, cwd: spawnCwd });
      
      const procState = { process, output: '', isRunning: true, command };
      activeAiProcesses.current.set(processId, procState);
      forceUpdateProcesses();
      
      process.output.pipeTo(new WritableStream({
        write(data) {
          procState.output += data;
          if (procState.output.length > 20000) {
            procState.output = procState.output.slice(-10000);
          }
          if (term) {
            term.write(data);
          }
        }
      }));
      
      process.exit.then((code) => {
        procState.isRunning = false;
        forceUpdateProcesses();
        if (term) {
          term.writeln(`\r\n[Process ${processId} exited with code ${code}]`);
        }
      });
      
      return processId;
    },
    getAiProcessStatus: (processId: string) => {
      const procState = activeAiProcesses.current.get(processId);
      if (!procState) return null;
      const lines = procState.output.split('\n');
      const tail = lines.slice(-150).join('\n');
      return { isRunning: procState.isRunning, output: tail };
    },
    sendAiProcessInput: async (processId: string, input: string) => {
      const procState = activeAiProcesses.current.get(processId);
      if (!procState || !procState.isRunning) return false;
      
      const writer = procState.process.input.getWriter();
      await writer.write(input);
      writer.releaseLock();
      return true;
    },
    killAiProcess: (processId: string) => {
      const procState = activeAiProcesses.current.get(processId);
      if (procState && procState.isRunning) {
        procState.process.kill();
        procState.isRunning = false;
        forceUpdateProcesses();
        
        const term = aiTermRef.current;
        if (term) {
          term.writeln(`\r\n[Process ${processId} was killed]`);
        }
      }
    }
  }));


  return (
    <div style={{ display: 'flex', flexDirection: layoutState === 'collapsed' ? 'row' : 'column', height: '100%', overflow: 'hidden' }}>
      {layoutState !== 'collapsed' ? (
        <div className="dual-terminal-tabs" style={{ 
          display: 'flex', 
          gap: '8px', 
          padding: '0 16px', 
          height: '54px',
          borderBottom: '1px solid var(--color-border)', 
          alignItems: 'center', 
          overflowX: 'auto', 
          flexShrink: 0 
        }}>
          <button className={`terminal-tab-btn ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => onTabChange('ai')}>
            <Monitor size={18} className="show-on-narrow" />
            <span className="hide-on-narrow">Sunam的电脑</span>
          </button>
          <button className={`terminal-tab-btn ${activeTab === 'user' ? 'active' : ''}`} onClick={() => onTabChange('user')}>
            <TerminalIcon size={18} className="show-on-narrow" />
            <span className="hide-on-narrow">终端</span>
          </button>
          <button className={`terminal-tab-btn ${activeTab === 'files' ? 'active' : ''}`} onClick={() => onTabChange('files')}>
            <Folder size={16} className="show-on-narrow" />
            <span className="hide-on-narrow">文件</span>
          </button>
          <button className={`terminal-tab-btn ${activeTab === 'services' ? 'active' : ''}`} onClick={() => onTabChange('services')}>
            <Server size={16} className="show-on-narrow" />
            <span className="hide-on-narrow">服务</span>
          </button>
          <button className={`terminal-tab-btn ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => onTabChange('preview')}>
            <Globe size={16} className="show-on-narrow" />
            <span className="hide-on-narrow">预览</span>
          </button>
          <div style={{ flex: 1 }}></div>
          {onLayoutChange && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--color-border)', margin: '0 12px 0 8px' }}></div>
              {layoutState === 'half' ? (
                <button 
                  className="desktop-only-btn terminal-icon-btn" 
                  onClick={() => onLayoutChange('full')}
                  title="全屏模式"
                >
                  <Maximize2 size={18} />
                </button>
              ) : (
                <button 
                  className="desktop-only-btn terminal-icon-btn" 
                  onClick={() => onLayoutChange('half')}
                  title="半屏模式"
                >
                  <Minimize2 size={18} />
                </button>
              )}
              <button 
                className="desktop-only-btn terminal-icon-btn" 
                onClick={() => onLayoutChange('collapsed')}
                title="收起"
              >
                <PanelRightClose size={18} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="desktop-only-btn" style={{ display: 'flex', flexDirection: 'column', width: '56px', height: '100%', alignItems: 'center', paddingTop: '16px', gap: '12px', backgroundColor: 'var(--color-surface)' }}>
           <button className={`right-sidebar-btn ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => { onTabChange('ai'); onLayoutChange?.('half'); }} title="Sunam的电脑">
             <Monitor size={20} />
           </button>
           <button className={`right-sidebar-btn ${activeTab === 'user' ? 'active' : ''}`} onClick={() => { onTabChange('user'); onLayoutChange?.('half'); }} title="终端">
             <TerminalIcon size={20} />
           </button>
           <button className={`right-sidebar-btn ${activeTab === 'files' ? 'active' : ''}`} onClick={() => { onTabChange('files'); onLayoutChange?.('half'); }} title="文件">
             <Folder size={20} />
           </button>
           <button className={`right-sidebar-btn ${activeTab === 'services' ? 'active' : ''}`} onClick={() => { onTabChange('services'); onLayoutChange?.('half'); }} title="服务">
             <Server size={20} />
           </button>
           <button className={`right-sidebar-btn ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => { onTabChange('preview'); onLayoutChange?.('half'); }} title="预览">
             <Globe size={20} />
           </button>
        </div>
      )}
      <div style={{ flex: 1, padding: activeTab === 'files' ? '0' : '16px', position: 'relative', overflow: 'hidden', display: layoutState === 'collapsed' ? 'none' : 'block' }}>

      {activeTab === 'services' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', backgroundColor: 'var(--color-bg)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>
          
          <div className="services-section">
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-success)' }}></div>
              内网穿透端口
            </h3>
            {activePorts.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', padding: '16px', border: '1px dashed var(--color-border)', borderRadius: '6px', textAlign: 'center' }}>
                暂无已映射的端口。请在终端或后台启动服务（如 npm run dev）。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {activePorts.map((p, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', border: '1px solid var(--color-border)', borderRadius: '6px', backgroundColor: 'var(--color-surface)', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>端口 {p.port}</div>
                      <button 
                        onClick={() => { setActivePreviewUrl(p.url); onTabChange('preview'); }} 
                        style={{ fontSize: '13px', color: 'var(--color-primary)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }} 
                        title={p.url}
                      >
                        {p.url} ↗
                      </button>
                    </div>
                    <button 
                      onClick={() => setActivePorts(prev => prev.filter(x => x.port !== p.port))}
                      style={{ background: 'none', border: 'none', color: '#ff4d4f', cursor: 'pointer', padding: '6px', borderRadius: '4px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                      onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                      title="清除记录"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="services-section">
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-primary)' }}></div>
              后台进程管理
            </h3>
            {Array.from(activeAiProcesses.current.entries()).filter(([_, state]) => state.isRunning).length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', padding: '16px', border: '1px dashed var(--color-border)', borderRadius: '6px', textAlign: 'center' }}>
                暂无运行中的后台进程。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Array.from(activeAiProcesses.current.entries()).map(([pid, state]) => {
                  if (!state.isRunning) return null;
                  return (
                    <div key={pid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', border: '1px solid var(--color-border)', borderRadius: '6px', backgroundColor: 'var(--color-surface)', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden', minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>{pid}</div>
                        <div style={{ fontSize: '14px', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`$ ${state.command}`}>
                          $ {state.command}
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          state.process.kill();
                          state.isRunning = false;
                          forceUpdateProcesses();
                          if (aiTermRef.current) aiTermRef.current.writeln(`\r\n[Process ${pid} was killed by user]`);
                        }}
                        style={{ flexShrink: 0, background: 'none', border: 'none', color: '#ff4d4f', cursor: 'pointer', padding: '6px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                        onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        title="强制终止"
                      >
                        <StopCircle size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}

      {activeTab === 'preview' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#fff', overflow: 'hidden' }}>
          {activePreviewUrl ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', gap: '12px' }}>
                <button 
                  onClick={() => setActivePreviewUrl(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', borderRadius: '4px', gap: '4px' }}
                  onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                  onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  title="退出预览"
                >
                  <ArrowLeft size={16} />
                </button>
                <button 
                  onClick={() => {
                    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
                    if (iframe) iframe.src = iframe.src;
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--color-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px', borderRadius: '4px' }}
                  onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                  onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  title="刷新"
                >
                  <RotateCw size={16} />
                </button>
                <div style={{ flex: 1, backgroundColor: 'var(--color-bg)', padding: '6px 12px', borderRadius: '4px', fontSize: '13px', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activePreviewUrl}
                </div>
                <a href={activePreviewUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', padding: '6px', borderRadius: '4px' }} title="在新标签页中尝试打开" onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <Maximize2 size={16} />
                </a>
              </div>
              <div style={{ flex: 1, position: 'relative' }}>
                <iframe 
                  id="preview-iframe"
                  src={activePreviewUrl} 
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                  allow="cross-origin-isolated"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                />
              </div>
            </>
          ) : (
            <div style={{ containerType: 'inline-size', width: '100%', height: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: '#fff', fontFamily: 'arial, sans-serif', padding: '0 20px' }}>
                <div style={{ fontSize: 'clamp(32px, 15cqw, 84px)', fontWeight: 500, letterSpacing: '-1px', marginBottom: '24px', fontFamily: '"Product Sans", "Google Sans", "Helvetica Neue", Helvetica, Arial, sans-serif', userSelect: 'none', whiteSpace: 'nowrap' }}>
                <span style={{ color: '#4285F4' }}>G</span>
                <span style={{ color: '#EA4335' }}>o</span>
                <span style={{ color: '#FBBC05' }}>l</span>
                <span style={{ color: '#4285F4' }}>o</span>
                <span style={{ color: '#34A853' }}>g</span>
                <span style={{ color: '#EA4335' }}>o</span>
                <span style={{ color: '#FBBC05' }}>l</span>
                <span style={{ color: '#4285F4' }}>o</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', width: '100%', maxWidth: '584px', padding: '0 14px', height: '46px', borderRadius: '24px', border: '1px solid #dfe1e5', boxShadow: 'none', transition: 'box-shadow 200ms cubic-bezier(0.4, 0.0, 0.2, 1)' }}
                   onMouseOver={e => e.currentTarget.style.boxShadow = '0 1px 6px rgba(32,33,36,.28)'}
                   onMouseOut={e => e.currentTarget.style.boxShadow = 'none'}>
                 <Search size={20} color="#9aa0a6" />
                 <input 
                   type="text" 
                   readOnly
                   placeholder="请在右侧“服务”面板中点击端口进行内网预览..." 
                   style={{ flex: 1, border: 'none', outline: 'none', padding: '0 12px', fontSize: '16px', color: '#202124', backgroundColor: 'transparent', width: '100%', textOverflow: 'ellipsis' }}
                 />
              </div>
              <div style={{ marginTop: '28px', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '12px' }}>
                <button onClick={() => onTabChange('services')} style={{ backgroundColor: '#f8f9fa', border: '1px solid #f8f9fa', borderRadius: '4px', color: '#3c4043', fontSize: '14px', padding: '0 16px', height: '36px', whiteSpace: 'nowrap', cursor: 'pointer' }} onMouseOver={e => { e.currentTarget.style.border = '1px solid #dadce0'; e.currentTarget.style.boxShadow = '0 1px 1px rgba(0,0,0,.1)'; }} onMouseOut={e => { e.currentTarget.style.border = '1px solid #f8f9fa'; e.currentTarget.style.boxShadow = 'none'; }}>
                  打开服务面板
                </button>
                <button onClick={() => onTabChange('services')} style={{ backgroundColor: '#f8f9fa', border: '1px solid #f8f9fa', borderRadius: '4px', color: '#3c4043', fontSize: '14px', padding: '0 16px', height: '36px', whiteSpace: 'nowrap', cursor: 'pointer' }} onMouseOver={e => { e.currentTarget.style.border = '1px solid #dadce0'; e.currentTarget.style.boxShadow = '0 1px 1px rgba(0,0,0,.1)'; }} onMouseOut={e => { e.currentTarget.style.border = '1px solid #f8f9fa'; e.currentTarget.style.boxShadow = 'none'; }}>
                  手气不错
                </button>
              </div>
            </div>
          </div>
          )}
        </div>
      )}
        {!isBooted && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-surface)', zIndex: 10
          }}>
            <Loader2 className="lucide-spin" style={{ width: '32px', height: '32px', color: 'var(--color-text-secondary)', animation: 'spin 2s linear infinite' }} />
            <span style={{ marginTop: '16px', color: 'var(--color-text-secondary)', fontSize: '14px' }}>Booting container...</span>
            <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* We use absolute positioning with opacity to hide terminals instead of display:none. 
            This completely prevents xterm.js from losing its rendering context or getting 0x0 dimensions! */}
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div style={{
            position: 'absolute', inset: 0,
            opacity: activeTab === 'ai' ? 1 : 0,
            pointerEvents: activeTab === 'ai' ? 'auto' : 'none',
            zIndex: activeTab === 'ai' ? 2 : 1
          }}>
            <TerminalView readOnly={true} onTerminalReady={(term) => { aiTermRef.current = term; }} />
          </div>
          <div style={{
            position: 'absolute', inset: 0,
            opacity: activeTab === 'user' ? 1 : 0,
            pointerEvents: activeTab === 'user' ? 'auto' : 'none',
            zIndex: activeTab === 'user' ? 2 : 1
          }}>
            <TerminalView readOnly={false} onTerminalReady={(term) => { userTermRef.current = term; setIsUserTermReady(true); }} />
          </div>
          <div style={{
            position: 'absolute', inset: 0,
            opacity: activeTab === 'files' ? 1 : 0,
            pointerEvents: activeTab === 'files' ? 'auto' : 'none',
            zIndex: activeTab === 'files' ? 2 : 1
          }}>
            {isBooted && <FileManager wc={wc} rootDir={readyContainerId ? `/${readyContainerId}` : '/'} />}
          </div>
        </div>
      </div>
    </div>
  );
});

export default DualTerminal;
