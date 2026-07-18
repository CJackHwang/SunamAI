import React, { useState, useEffect, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Terminal } from '@xterm/xterm';
import { Loader2, Maximize2, PanelRightClose, PanelRight } from 'lucide-react';
import TerminalView from '../../entities/container/TerminalView.tsx';
import { getWebContainer } from '../../shared/lib/webcontainer.ts';
import { saveSnapshot } from '../../shared/lib/persistence.ts';
import FileManager from '../file-manager/FileManager.tsx';

export interface DualTerminalRef {
  runAiCommand: (command: string) => Promise<string>;
}

interface DualTerminalProps {
  onReady?: () => void;
  activeTab: 'ai' | 'user' | 'files';
  onTabChange: (tab: 'ai' | 'user' | 'files') => void;
  layoutState?: 'half' | 'full' | 'collapsed';
  onLayoutCycle?: () => void;
}

const DualTerminal = React.forwardRef<DualTerminalRef, DualTerminalProps>(({ onReady, activeTab, onTabChange, layoutState = 'half', onLayoutCycle }, ref) => {
  const aiTermRef = useRef<Terminal | null>(null);
  const userTermRef = useRef<Terminal | null>(null);
  const [isUserTermReady, setIsUserTermReady] = useState(false);
  const [wc, setWc] = useState<WebContainer | null>(null);
  const [isBooted, setIsBooted] = useState(false);

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

      onDataDisposable = userTermRef.current?.onData((data) => {
        shellWriter.write(data);
      });
    };
    bootShell();

    return () => {
      if (process) process.kill();
      // MUST dispose the listener or it will try to write to a killed shell!
      if (onDataDisposable) onDataDisposable.dispose();
    };
  }, [wc, isUserTermReady]);

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
    runAiCommand: async (command: string): Promise<string> => {
      if (!wc || !aiTermRef.current) return 'Error: WebContainer not ready';

      const term = aiTermRef.current;
      term.writeln(`\r\nAdmin@Sunam ~ # ${command}`);

      try {
        const process = await wc.spawn('jsh', ['-c', command]);
        let output = '';

        process.output.pipeTo(new WritableStream({
          write(data) {
            term.write(data);
            output += data;
          }
        }));

        const exitCode = await process.exit;
        term.writeln(`\r\n[Process exited with code ${exitCode}]`);

        // Save snapshot after each AI command execution
        saveSnapshot(wc);

        return output || '[No Output]';
      } catch (err) {
        term.writeln(`\r\n[Execution Error]: ${err}`);
        return `Error: ${err}`;
      }
    }
  }));
  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '6px 16px 10px',
    borderBottom: '2px solid transparent',
    color: isActive ? 'var(--color-black)' : 'var(--color-text-secondary)',
    fontWeight: isActive ? 600 : 500,
    fontSize: isActive ? '16px' : '15px',
    transition: 'all 0.2s ease',
    whiteSpace: 'nowrap'
  });

  // Decide icon for the button based on current layout state
  const LayoutIcon = layoutState === 'half' ? Maximize2 : 
                     layoutState === 'full' ? PanelRightClose : 
                     PanelRight;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="dual-terminal-tabs" style={{ 
        display: 'flex', 
        gap: '8px', 
        padding: layoutState === 'collapsed' ? '8px 0' : '8px 16px', 
        justifyContent: layoutState === 'collapsed' ? 'center' : 'flex-start',
        borderBottom: '1px solid var(--color-border)', 
        alignItems: 'center', 
        overflowX: 'hidden', 
        flexShrink: 0 
      }}>
        {layoutState !== 'collapsed' && (
          <>
            <button style={tabStyle(activeTab === 'ai')} onClick={() => onTabChange('ai')}>
              Sunam的电脑
            </button>
            <button style={tabStyle(activeTab === 'user')} onClick={() => onTabChange('user')}>
              终端
            </button>
            <button style={tabStyle(activeTab === 'files')} onClick={() => onTabChange('files')}>
              文件
            </button>
          </>
        )}
        {layoutState !== 'collapsed' && <div style={{ flex: 1 }}></div>}
        {onLayoutCycle && (
          <button 
            className="desktop-only-btn" 
            style={{ padding: '6px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center' }} 
            onClick={onLayoutCycle}
            title="Toggle Layout"
          >
            <LayoutIcon size={18} />
          </button>
        )}
      </div>
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
            {isBooted && <FileManager wc={wc} />}
          </div>
        </div>
      </div>
    </div>
  );
});

export default DualTerminal;
