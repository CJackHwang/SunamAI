import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { Loader2 } from 'lucide-react';
import TerminalView from '@/features/terminal-session/TerminalView';
import { useI18n } from '@/shared/i18n';
import { toErrorMessage } from '@/shared/lib/errors';
import { appendAgentTerminalBuffer, flushAgentTerminalBuffers, subscribeAgentTerminalPersistence } from '@/features/terminal-session/agentTerminalBuffer';
import { WebContainerAgentRuntime } from '@/features/runtime/WebContainerAgentRuntime';
import { CollapsedTerminalNav, TerminalTabs } from '@/features/terminal-session/TerminalTabs';
import { ServicesPanel } from '@/features/terminal-session/ServicesPanel';
import { ServicePreviewOverlay } from '@/features/terminal-session/ServicePreviewOverlay';
import type { RuntimePortStatus, TerminalLayout, TerminalTab } from '@/shared/contracts/terminal';
import './DualTerminal.css';
import './DualTerminalLayout.css';
import { AgentTerminalPanel } from '@/features/terminal-session/AgentTerminalPanel';

const FileManager = lazy(() => import('@/features/file-manager/FileManager'));

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
  isRestarting: boolean;
  onForceRestart: () => Promise<void>;
}

const DualTerminal = ({ webcontainer, runtime, rootDir, onReady, activeTab, onTabChange, layoutState = 'half', onLayoutChange, activeContainerId, activeContainerName, activeSessionId, isRestarting, onForceRestart }: DualTerminalProps) => {
  const { t } = useI18n();
  const aiTermRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const userTermRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const [isUserTermReady, setIsUserTermReady] = useState(false);
  const [isBooted, setIsBooted] = useState(false);
  const [, setProcessVersion] = useState(0);
  const [activePorts, setActivePorts] = useState<RuntimePortStatus[]>([]);
  const [activePreview, setActivePreview] = useState<{ port: number; lastUrl: string } | null>(null);
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
      const prefix = event.type === 'started' ? `\r\n[Agent process ${event.process.id}] Admin@Sunam ~ # ${event.process.command}\r\n` : event.type === 'exited' ? `\r\n[Process ${event.process.id} exited with code ${event.process.exitCode}]\r\n` : event.type === 'stopped' ? `\r\n[Process ${event.process.id} stopped]\r\n` : event.type === 'error' ? `\r\n[Process ${event.process.id} output error: ${event.chunk ?? 'unknown error'}]\r\n` : event.chunk ?? '';
      appendAgentTerminalBuffer(event.process.sessionId, prefix);
      if (sessionIdRef.current === event.process.sessionId && prefix) aiTermRef.current?.write(prefix);
      setProcessVersion((version) => version + 1);
    });
  }, [runtime]);

  useEffect(() => {
    if (!runtime || !activeContainerId || !isUserTermReady || !userTermRef.current) return;
    let process: Awaited<ReturnType<WebContainer['spawn']>> | undefined;
    let launchId: string | undefined;
    let onDataDisposable: { dispose(): void } | undefined;
    let active = true;
    void (async () => {
      await runtime.ensureContainer(activeContainerId);
      if (!active) return;
      const spawned = await runtime.spawnUserShell(activeContainerId);
      process = spawned.process;
      launchId = spawned.launchId;
      if (!active) { process.kill(); return; }
      let receivedOutput = false;
      void process.output.pipeTo(new WritableStream<string>({
        write(data) {
          userTermRef.current?.write(data);
          runtime?.appendUserTerminalBuffer(data);
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
      if (launchId) runtime.stopUserShell(launchId);
      else process?.kill();
      userShellWriterRef.current = null;
      onDataDisposable?.dispose();
    };
  }, [activeContainerId, isUserTermReady, runtime]);

  useEffect(() => {
    if (!runtime) { setActivePorts([]); return; }
    const project = () => setActivePorts(runtime.getPorts());
    project();
    return runtime.subscribePorts(project);
  }, [runtime]);

  useEffect(() => {
    const timer = setTimeout(() => { (activeTab === 'user' ? userTermRef.current : aiTermRef.current)?.focus(); }, 50);
    return () => clearTimeout(timer);
  }, [activeTab]);

  const processes = activeContainerId ? runtime?.getProcesses({ containerId: activeContainerId }) ?? [] : [];
  const previewService = activePreview ? activePorts.find((entry) => entry.port === activePreview.port) : undefined;

  return <><div className="dual-terminal" data-layout={layoutState}>
    {layoutState === 'collapsed' ? <CollapsedTerminalNav activeTab={activeTab} onTabChange={onTabChange} onExpand={() => onLayoutChange?.('half')} /> : <TerminalTabs activeTab={activeTab} onTabChange={onTabChange} layoutState={layoutState} {...(onLayoutChange ? { onLayoutChange } : {})} />}
    {layoutState !== 'collapsed' && <div className="terminal-environment-bar" title={activeContainerId ?? undefined}>{containerIdentity}<span className="terminal-environment-path">/</span></div>}
    <div className="terminal-content" data-tab={activeTab}>
      {!isBooted && activeTab !== 'services' && <div className="terminal-boot-state"><Loader2 className="lucide-spin" /><span>{t('terminal.booting')}</span></div>}
      <div className="terminal-panel" data-active={activeTab === 'ai'}><AgentTerminalPanel sessionId={activeSessionId ?? null} terminalRef={aiTermRef} /></div>
      <div className="terminal-panel" data-active={activeTab === 'user'}><TerminalView readOnly={false} onTerminalReady={(terminal) => { userTermRef.current = terminal; setIsUserTermReady(true); }} /></div>
      <div className="terminal-panel terminal-file-panel" data-active={activeTab === 'files'}>{isBooted && <Suspense fallback={null}><FileManager wc={webcontainer} rootDir={rootDir} /></Suspense>}</div>
      {activeTab === 'services' && <div className="terminal-panel terminal-services-panel" data-active="true"><ServicesPanel ports={activePorts} processes={processes} isRestarting={isRestarting} onPreview={(port, url) => setActivePreview({ port, lastUrl: url })} onStopPort={(port) => runtime?.stopPort(port) ?? Promise.resolve(false)} onForceRestart={onForceRestart} onKillProcess={(process) => { void runtime?.stopProcess(process.id, { sessionId: process.sessionId, runId: process.runId, containerId: process.containerId }); }} /></div>}
    </div>
  </div>{activePreview && <ServicePreviewOverlay port={activePreview.port} url={previewService?.url ?? activePreview.lastUrl} isOnline={Boolean(previewService)} onDismiss={() => setActivePreview(null)} />}</>;
};

export default DualTerminal;
