import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Terminal } from '@xterm/xterm';
import { Loader2 } from 'lucide-react';
import TerminalView from '../../entities/container/TerminalView.tsx';
import { getWebContainer } from '../../shared/lib/webcontainer.ts';
import { appendAiTerminalHistory, getAiTerminalHistory } from '@/shared/lib/terminalHistory';
import { createSnapshotScheduler } from '@/shared/lib/snapshotScheduler';
import type { AgentRuntime } from '@/shared/contracts/agentRuntime';
import { useI18n } from '@/shared/i18n';
import { CollapsedTerminalNav, TerminalTabs } from './TerminalTabs';
import { ServicesPanel, type ActiveProcess } from './ServicesPanel';
import type { TerminalLayout, TerminalTab } from './types';

const FileManager = lazy(() => import('../file-manager/FileManager.tsx'));

export interface DualTerminalRef extends AgentRuntime {}

interface DualTerminalProps {
  onReady?: () => void;
  activeTab: TerminalTab;
  onTabChange: (tab: TerminalTab) => void;
  layoutState?: TerminalLayout;
  onLayoutChange?: (state: TerminalLayout) => void;
  activeContainerId?: string | null;
  activeSessionId?: string | null;
}

const DualTerminal = React.forwardRef<DualTerminalRef, DualTerminalProps>(({ onReady, activeTab, onTabChange, layoutState = 'half', onLayoutChange, activeContainerId, activeSessionId }, ref) => {
  const { t } = useI18n();
  const aiTermRef = useRef<Terminal | null>(null);
  const userTermRef = useRef<Terminal | null>(null);
  const [isUserTermReady, setIsUserTermReady] = useState(false);
  const [wc, setWc] = useState<WebContainer | null>(null);
  const [isBooted, setIsBooted] = useState(false);
  const [readyContainerId, setReadyContainerId] = useState<string | null>(null);
  const userShellWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  
  // Track active AI processes and trigger UI updates
  const activeAiProcesses = useRef(new Map<string, ActiveProcess>());
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

    const scheduler = createSnapshotScheduler(wc);
    const interval = setInterval(scheduler.schedule, 30_000);

    // Also save once when the page is about to unload
    const handleBeforeUnload = () => { scheduler.schedule(); };
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

  const sessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    sessionIdRef.current = activeSessionId;
    if (aiTermRef.current && activeSessionId) {
      aiTermRef.current.clear();
      const history = getAiTerminalHistory(activeSessionId);
      if (history) {
        aiTermRef.current.write(history);
      }
    }
  }, [activeSessionId]);

  React.useImperativeHandle(ref, () => ({
    spawnAiProcess: async (command: string, containerId: string) => {
      if (!wc) throw new Error("WebContainer not booted");
      
      const term = aiTermRef.current;
      const processId = `proc-${Date.now().toString(36)}`;
      
      if (term) {
        term.writeln(`\r\n[Background Process ${processId}] Admin@Sunam ~ # ${command}`);
      }
      appendAiTerminalHistory(sessionIdRef.current || null, `\r\n[Background Process ${processId}] Admin@Sunam ~ # ${command}\r\n`);

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
          appendAiTerminalHistory(sessionIdRef.current || null, data);
        }
      }));
      
      process.exit.then((code) => {
        procState.isRunning = false;
        forceUpdateProcesses();
        if (term) {
          term.writeln(`\r\n[Process ${processId} exited with code ${code}]`);
        }
        appendAiTerminalHistory(sessionIdRef.current || null, `\r\n[Process ${processId} exited with code ${code}]\r\n`);
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
        appendAiTerminalHistory(sessionIdRef.current || null, `\r\n[Process ${processId} was killed]\r\n`);
      }
    }
  }));


  const killProcessFromServices = (processId: string) => {
    const process = activeAiProcesses.current.get(processId);
    if (!process || !process.isRunning) return;
    process.process.kill();
    process.isRunning = false;
    forceUpdateProcesses();
    aiTermRef.current?.writeln(`\r\n[Process ${processId} was killed by user]`);
    appendAiTerminalHistory(sessionIdRef.current ?? null, `\r\n[Process ${processId} was killed by user]\r\n`);
  };

  return <div style={{ display: 'flex', flexDirection: layoutState === 'collapsed' ? 'row' : 'column', height: '100%', overflow: 'hidden' }}>
    {layoutState === 'collapsed' ? <CollapsedTerminalNav activeTab={activeTab} onTabChange={onTabChange} onExpand={() => onLayoutChange?.('half')} /> : <TerminalTabs activeTab={activeTab} onTabChange={onTabChange} layoutState={layoutState} onLayoutChange={onLayoutChange} />}
    <div style={{ flex: 1, padding: activeTab === 'files' ? '0' : '16px', position: 'relative', overflow: 'hidden', display: layoutState === 'collapsed' ? 'none' : 'block' }}>
      {activeTab === 'services' && <ServicesPanel ports={activePorts} processes={activeAiProcesses.current} onClearPort={(port) => setActivePorts((ports) => ports.filter((item) => item.port !== port))} onKillProcess={killProcessFromServices} />}
      {!isBooted && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-surface)', zIndex: 10 }}><Loader2 className="lucide-spin" style={{ width: '32px', height: '32px', color: 'var(--color-text-secondary)', animation: 'spin 2s linear infinite' }} /><span style={{ marginTop: '16px', color: 'var(--color-text-secondary)', fontSize: '14px' }}>{t('terminal.booting')}</span></div>}
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: activeTab === 'ai' ? 1 : 0, pointerEvents: activeTab === 'ai' ? 'auto' : 'none', zIndex: activeTab === 'ai' ? 2 : 1 }}><TerminalView readOnly onTerminalReady={(term) => { aiTermRef.current = term; const history = getAiTerminalHistory(activeSessionId ?? null); if (history) term.write(history); }} /></div>
        <div style={{ position: 'absolute', inset: 0, opacity: activeTab === 'user' ? 1 : 0, pointerEvents: activeTab === 'user' ? 'auto' : 'none', zIndex: activeTab === 'user' ? 2 : 1 }}><TerminalView readOnly={false} onTerminalReady={(term) => { userTermRef.current = term; setIsUserTermReady(true); }} /></div>
        <div style={{ position: 'absolute', inset: 0, opacity: activeTab === 'files' ? 1 : 0, pointerEvents: activeTab === 'files' ? 'auto' : 'none', zIndex: activeTab === 'files' ? 2 : 1 }}>{isBooted && <Suspense fallback={null}><FileManager wc={wc} rootDir={readyContainerId ? `/${readyContainerId}` : '/'} /></Suspense>}</div>
      </div>
    </div>
  </div>;
});

export default DualTerminal;
