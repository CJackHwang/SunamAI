import React, { useState, useEffect, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Terminal } from '@xterm/xterm';
import { Loader2, Maximize2, Minimize2, PanelRightClose, Monitor, Terminal as TerminalIcon, Folder, Server, Trash2, StopCircle } from 'lucide-react';
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
  activeTab: 'ai' | 'user' | 'files' | 'services';
  onTabChange: (tab: 'ai' | 'user' | 'files' | 'services') => void;
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

  // Track exposed ports.
  const [activePorts, setActivePorts] = useState<{ port: number, url: string }[]>([]);

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
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

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

        if (!disposed) {
          unsubscribe = wc.on('server-ready', handleServerReady);
        }
      } catch (err) {
        console.error('Failed to setup container:', err);
      }
    };
    
    void setupContainer();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
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
                      <a
                        href={p.url}
                        target="_blank"
                        rel="opener"
                        style={{ fontSize: '13px', color: 'var(--color-primary)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={p.url}
                      >
                        {p.url} ↗
                      </a>
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
