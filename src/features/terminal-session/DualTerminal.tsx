import React, { lazy, Suspense, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { Loader2 } from 'lucide-react';
import TerminalView from '@/entities/container/TerminalView';
import { getWebContainer } from '@/shared/lib/webcontainer';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import { useI18n } from '@/shared/i18n';
import { appendAgentTerminalBuffer, getAgentTerminalBuffer } from './agentTerminalBuffer';
import { WebContainerAgentRuntime } from './WebContainerAgentRuntime';
import { CollapsedTerminalNav, TerminalTabs } from './TerminalTabs';
import { ServicesPanel } from './ServicesPanel';
import type { TerminalLayout, TerminalTab } from './types';

const FileManager = lazy(() => import('../file-manager/FileManager'));

export interface DualTerminalRef extends AgentWorkspaceRuntime {}

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
  const aiTermRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const userTermRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const [isUserTermReady, setIsUserTermReady] = useState(false);
  const [wc, setWc] = useState<WebContainer | null>(null);
  const [runtime, setRuntime] = useState<WebContainerAgentRuntime | null>(null);
  const [isBooted, setIsBooted] = useState(false);
  const [readyContainerId, setReadyContainerId] = useState<string | null>(null);
  const [processVersion, setProcessVersion] = useState(0);
  const [activePorts, setActivePorts] = useState<Array<{ port: number; url: string }>>([]);
  const userShellWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const sessionIdRef = useRef(activeSessionId);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  sessionIdRef.current = activeSessionId;

  useImperativeHandle(ref, () => runtime as DualTerminalRef, [runtime]);

  useEffect(() => {
    let mounted = true;
    void getWebContainer().then((instance) => {
      if (!mounted) return;
      setWc(instance);
      setRuntime(new WebContainerAgentRuntime(instance));
      onReadyRef.current?.();
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!runtime) return;
    return runtime.subscribe((event) => {
      const prefix = event.type === 'started' ? `\r\n[Agent process ${event.process.id}] Admin@Sunam ~ # ${event.process.command}\r\n` : event.type === 'exited' ? `\r\n[Process ${event.process.id} exited with code ${event.process.exitCode}]\r\n` : event.type === 'stopped' ? `\r\n[Process ${event.process.id} stopped]\r\n` : event.chunk ?? '';
      appendAgentTerminalBuffer(event.process.sessionId, prefix);
      if (sessionIdRef.current === event.process.sessionId && prefix) aiTermRef.current?.write(prefix);
      setProcessVersion((version) => version + 1);
    });
  }, [runtime]);

  useEffect(() => {
    if (!wc || !isUserTermReady || !userTermRef.current) return;
    let process: Awaited<ReturnType<WebContainer['spawn']>> | undefined;
    let onDataDisposable: { dispose(): void } | undefined;
    let active = true;
    void (async () => {
      process = await wc.spawn('jsh');
      if (!active) { process.kill(); return; }
      let receivedOutput = false;
      void process.output.pipeTo(new WritableStream<string>({
        write(data) {
          userTermRef.current?.write(data);
          if (!receivedOutput) { receivedOutput = true; setIsBooted(true); }
        },
      })).catch(() => undefined);
      const writer = process.input.getWriter();
      userShellWriterRef.current = writer;
      onDataDisposable = userTermRef.current?.onData((data) => { void writer.write(data); });
    })();
    return () => {
      active = false;
      process?.kill();
      userShellWriterRef.current = null;
      onDataDisposable?.dispose();
    };
  }, [isUserTermReady, wc]);

  useEffect(() => {
    if (!wc || !isBooted || !activeContainerId || !runtime) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        await runtime.ensureContainer(activeContainerId);
        userShellWriterRef.current?.write(`cd ~/sunam/${activeContainerId}\r`);
        setReadyContainerId(activeContainerId);
        const onServerReady = (port: number, url: string) => setActivePorts((ports) => [...ports.filter((entry) => entry.port !== port), { port, url }]);
        if (!disposed) unsubscribe = wc.on('server-ready', onServerReady);
      } catch (error) {
        console.error('Failed to prepare container:', error);
      }
    })();
    return () => { disposed = true; unsubscribe?.(); };
  }, [activeContainerId, isBooted, runtime, wc]);

  useEffect(() => {
    const timer = setTimeout(() => { (activeTab === 'user' ? userTermRef.current : aiTermRef.current)?.focus(); }, 50);
    return () => clearTimeout(timer);
  }, [activeTab]);

  useEffect(() => {
    if (!aiTermRef.current) return;
    aiTermRef.current.clear();
    const history = getAgentTerminalBuffer(activeSessionId ?? null);
    if (history) aiTermRef.current.write(history);
  }, [activeSessionId]);

  const processes = runtime?.getProcesses().filter((process) => !activeSessionId || process.sessionId === activeSessionId) ?? [];
  void processVersion;

  return <div style={{ display: 'flex', flexDirection: layoutState === 'collapsed' ? 'row' : 'column', height: '100%', overflow: 'hidden' }}>
    {layoutState === 'collapsed' ? <CollapsedTerminalNav activeTab={activeTab} onTabChange={onTabChange} onExpand={() => onLayoutChange?.('half')} /> : <TerminalTabs activeTab={activeTab} onTabChange={onTabChange} layoutState={layoutState} onLayoutChange={onLayoutChange} />}
    <div style={{ flex: 1, padding: activeTab === 'files' ? '0' : '16px', position: 'relative', overflow: 'hidden', display: layoutState === 'collapsed' ? 'none' : 'block' }}>
      {activeTab === 'services' && <ServicesPanel ports={activePorts} processes={processes} onClearPort={(port) => setActivePorts((ports) => ports.filter((item) => item.port !== port))} onKillProcess={(processId) => runtime?.stopProcess(processId)} />}
      {!isBooted && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-surface)', zIndex: 10 }}><Loader2 className="lucide-spin" style={{ width: '32px', height: '32px', color: 'var(--color-text-secondary)', animation: 'spin 2s linear infinite' }} /><span style={{ marginTop: '16px', color: 'var(--color-text-secondary)', fontSize: '14px' }}>{t('terminal.booting')}</span></div>}
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: activeTab === 'ai' ? 1 : 0, pointerEvents: activeTab === 'ai' ? 'auto' : 'none', zIndex: activeTab === 'ai' ? 2 : 1 }}><TerminalView readOnly onTerminalReady={(terminal) => { aiTermRef.current = terminal; const history = getAgentTerminalBuffer(activeSessionId ?? null); if (history) terminal.write(history); }} /></div>
        <div style={{ position: 'absolute', inset: 0, opacity: activeTab === 'user' ? 1 : 0, pointerEvents: activeTab === 'user' ? 'auto' : 'none', zIndex: activeTab === 'user' ? 2 : 1 }}><TerminalView readOnly={false} onTerminalReady={(terminal) => { userTermRef.current = terminal; setIsUserTermReady(true); }} /></div>
        <div style={{ position: 'absolute', inset: 0, opacity: activeTab === 'files' ? 1 : 0, pointerEvents: activeTab === 'files' ? 'auto' : 'none', zIndex: activeTab === 'files' ? 2 : 1 }}>{isBooted && <Suspense fallback={null}><FileManager wc={wc} rootDir={readyContainerId ? `/${readyContainerId}` : '/'} /></Suspense>}</div>
      </div>
    </div>
  </div>;
});

export default DualTerminal;
