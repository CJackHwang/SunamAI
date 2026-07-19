import React, { useState, useEffect, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Terminal } from '@xterm/xterm';
import { Loader2, Maximize2, Minimize2, PanelRightClose, Monitor, Terminal as TerminalIcon, Folder } from 'lucide-react';
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
  activeTab: 'ai' | 'user' | 'files';
  onTabChange: (tab: 'ai' | 'user' | 'files') => void;
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
  const activeAiProcesses = useRef(new Map<string, { process: any, output: string, isRunning: boolean }>());

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
      
      const procState = { process, output: '', isRunning: true };
      activeAiProcesses.current.set(processId, procState);
      
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
      }
    }
  }));


  return (
    <div style={{ display: 'flex', flexDirection: layoutState === 'collapsed' ? 'row' : 'column', height: '100%', overflow: 'hidden' }}>
      {layoutState !== 'collapsed' ? (
        <div className="dual-terminal-tabs" style={{ 
          display: 'flex', 
          gap: '8px', 
          padding: '8px 16px', 
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
            <Folder size={18} className="show-on-narrow" />
            <span className="hide-on-narrow">文件</span>
          </button>
          <div style={{ flex: 1 }}></div>
          {onLayoutChange && (
            <div style={{ display: 'flex', gap: '4px' }}>
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
        </div>
      )}
      <div style={{ flex: 1, padding: activeTab === 'files' ? '0' : '16px', position: 'relative', overflow: 'hidden', display: layoutState === 'collapsed' ? 'none' : 'block' }}>
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
