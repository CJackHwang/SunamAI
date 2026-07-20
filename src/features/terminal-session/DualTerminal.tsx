import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { Loader2 } from 'lucide-react';
import TerminalView from './TerminalView';
import { useI18n } from '@/shared/i18n';
import { getContainerRoot } from '@/shared/lib/containerPaths';
import { toErrorMessage } from '@/shared/lib/errors';
import { appendAgentTerminalBuffer, flushAgentTerminalBuffers, subscribeAgentTerminalPersistence } from './agentTerminalBuffer';
import { WebContainerAgentRuntime } from './WebContainerAgentRuntime';
import { CollapsedTerminalNav, TerminalTabs } from './TerminalTabs';
import { ServicesPanel } from './ServicesPanel';
import type { TerminalLayout, TerminalTab } from './types';
import { toDisplayWorkspacePath } from './displayPaths';
import './DualTerminal.css';
import './DualTerminalLayout.css';
import { AgentTerminalPanel } from './AgentTerminalPanel';

const FileManager = lazy(() => import('../file-manager/FileManager'));

interface DualTerminalProps {
  webcontainer: WebContainer | null;
  runtime: WebContainerAgentRuntime | null;
  rootDir: string;
  onReady?: () => void;
  activeTab: TerminalTab;
  onTabChange: (tab: TerminalTab) => void;
  layoutState?: TerminalLayout;
  onLayoutChange?: (state: TerminalLayout) => void;
  activeContainerId?: string | null;
  activeContainerName?: string | null;
  activeSessionId?: string | null;
}

const DualTerminal = ({ webcontainer, runtime, rootDir, onReady, activeTab, onTabChange, layoutState = 'half', onLayoutChange, activeContainerId, activeContainerName, activeSessionId }: DualTerminalProps) => {
  const { t } = useI18n();
  const aiTermRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const userTermRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const [isUserTermReady, setIsUserTermReady] = useState(false);
  const [isBooted, setIsBooted] = useState(false);
  const [, setProcessVersion] = useState(0);
  const [activePorts, setActivePorts] = useState<Array<{ port: number; url: string }>>([]);
  const userShellWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const sessionIdRef = useRef(activeSessionId);
  sessionIdRef.current = activeSessionId;
  const containerLabel = activeContainerName?.trim() || t('sidebar.newContainer');
  const containerIdentity = activeContainerId ? `${containerLabel} · ${activeContainerId.slice(-6)}` : containerLabel;

  useEffect(() => {
    if (runtime) onReady?.();
  }, [onReady, runtime]);

  useEffect(() => {
    const unsubscribe = subscribeAgentTerminalPersistence((sessionId, error) => {
      if (error && sessionIdRef.current === sessionId) aiTermRef.current?.write(`\r\n[Terminal history persistence error: ${error}]\r\n`);
    });
    const flush = () => { void flushAgentTerminalBuffers(); };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!runtime) return;
    return runtime.subscribe((event) => {
      const command = toDisplayWorkspacePath(event.process.command, containerLabel);
      const prefix = event.type === 'started' ? `\r\n[Agent process ${event.process.id}] Admin@Sunam ~ # ${command}\r\n` : event.type === 'exited' ? `\r\n[Process ${event.process.id} exited with code ${event.process.exitCode}]\r\n` : event.type === 'stopped' ? `\r\n[Process ${event.process.id} stopped]\r\n` : event.type === 'error' ? `\r\n[Process ${event.process.id} output error: ${event.chunk ?? 'unknown error'}]\r\n` : event.chunk ?? '';
      appendAgentTerminalBuffer(event.process.sessionId, prefix);
      if (sessionIdRef.current === event.process.sessionId && prefix) aiTermRef.current?.write(prefix);
      setProcessVersion((version) => version + 1);
    });
  }, [containerLabel, runtime]);

  useEffect(() => {
    if (!webcontainer || !isUserTermReady || !userTermRef.current) return;
    let process: Awaited<ReturnType<WebContainer['spawn']>> | undefined;
    let onDataDisposable: { dispose(): void } | undefined;
    let active = true;
    void (async () => {
      if (activeContainerId && runtime) await runtime.ensureContainer(activeContainerId);
      if (!active) return;
      // Keep implementation paths out of the user's command history and prompt.
      process = await webcontainer.spawn('jsh', {
        cwd: activeContainerId ? getContainerRoot(activeContainerId) : undefined,
        env: {},
      });
      if (!active) { process.kill(); return; }
      let receivedOutput = false;
      void process.output.pipeTo(new WritableStream<string>({
        write(data) {
          userTermRef.current?.write(toDisplayWorkspacePath(data, containerLabel));
          if (!receivedOutput) { receivedOutput = true; setIsBooted(true); }
        },
      })).catch((error) => {
        userTermRef.current?.write(`\r\n[Terminal output error: ${toErrorMessage(error)}]\r\n`);
        setIsBooted(true);
      });
      const writer = process.input.getWriter();
      userShellWriterRef.current = writer;
      onDataDisposable = userTermRef.current?.onData((data) => { void writer.write(data).catch((error) => userTermRef.current?.write(`\r\n[Terminal input error: ${toErrorMessage(error)}]\r\n`)); });
    })().catch((error) => { userTermRef.current?.write(`\r\n[Terminal startup error: ${toErrorMessage(error)}]\r\n`); setIsBooted(true); });
    return () => {
      active = false;
      process?.kill();
      userShellWriterRef.current = null;
      onDataDisposable?.dispose();
    };
  }, [activeContainerId, containerLabel, isUserTermReady, runtime, webcontainer]);

  useEffect(() => {
    if (!webcontainer) return;
    const onServerReady = (port: number, url: string) => setActivePorts((ports) => [...ports.filter((entry) => entry.port !== port), { port, url }]);
    const onPort = (port: number, type: 'open' | 'close', url: string) => setActivePorts((ports) => type === 'open' ? [...ports.filter((entry) => entry.port !== port), { port, url }] : ports.filter((entry) => entry.port !== port));
    const stopReady = webcontainer.on('server-ready', onServerReady);
    const stopPort = webcontainer.on('port', onPort);
    return () => { stopReady(); stopPort(); };
  }, [webcontainer]);

  useEffect(() => {
    const timer = setTimeout(() => { (activeTab === 'user' ? userTermRef.current : aiTermRef.current)?.focus(); }, 50);
    return () => clearTimeout(timer);
  }, [activeTab]);

  const processes = activeContainerId ? runtime?.getProcesses({ containerId: activeContainerId }) ?? [] : [];

  return <div className="dual-terminal" data-layout={layoutState}>
    {layoutState === 'collapsed' ? <CollapsedTerminalNav activeTab={activeTab} onTabChange={onTabChange} onExpand={() => onLayoutChange?.('half')} /> : <TerminalTabs activeTab={activeTab} onTabChange={onTabChange} layoutState={layoutState} onLayoutChange={onLayoutChange} />}
    {layoutState !== 'collapsed' && <div className="terminal-environment-bar" title={activeContainerId ?? undefined}>{containerIdentity}<span className="terminal-environment-path">/containers/{containerLabel}</span></div>}
    <div className="terminal-content" data-tab={activeTab}>
      {!isBooted && activeTab !== 'services' && <div className="terminal-boot-state"><Loader2 className="lucide-spin" /><span>{t('terminal.booting')}</span></div>}
      <div className="terminal-panel" data-active={activeTab === 'ai'}><AgentTerminalPanel sessionId={activeSessionId ?? null} terminalRef={aiTermRef} /></div>
      <div className="terminal-panel" data-active={activeTab === 'user'}><TerminalView readOnly={false} onTerminalReady={(terminal) => { userTermRef.current = terminal; setIsUserTermReady(true); }} /></div>
      <div className="terminal-panel terminal-file-panel" data-active={activeTab === 'files'}>{isBooted && <Suspense fallback={null}><FileManager wc={webcontainer} rootDir={rootDir} rootLabel={containerLabel} /></Suspense>}</div>
      {activeTab === 'services' && <div className="terminal-panel terminal-services-panel" data-active="true"><ServicesPanel ports={activePorts} processes={processes} containerName={containerLabel} onKillProcess={(process) => { runtime?.stopProcess(process.id, { sessionId: process.sessionId, runId: process.runId, containerId: process.containerId }); }} /></div>}
    </div>
  </div>;
};

export default DualTerminal;
