import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { Loader2 } from 'lucide-react';
import TerminalView from '@/entities/container/TerminalView';
import { useI18n } from '@/shared/i18n';
import { getContainerRoot } from '@/shared/lib/containerPaths';
import { appendAgentTerminalBuffer, getAgentTerminalBuffer, restoreAgentTerminalBuffer } from './agentTerminalBuffer';
import { WebContainerAgentRuntime } from './WebContainerAgentRuntime';
import { CollapsedTerminalNav, TerminalTabs } from './TerminalTabs';
import { ServicesPanel } from './ServicesPanel';
import type { TerminalLayout, TerminalTab } from './types';

const FileManager = lazy(() => import('../file-manager/FileManager'));

function toDisplayShellOutput(value: string, containerName: string): string {
  // WebContainer needs a real per-container cwd, but exposing its generated
  // storage path makes the interactive shell look like an implementation leak.
  // Keep the container identity visible in prompts and `pwd`, while hiding the
  // generated storage path used internally by WebContainer.
  const safeName = Array.from(containerName, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || character === '/' || character === '\\' ? '-' : character;
  }).join('').trim() || 'unnamed';
  const visibleRoot = `/containers/${safeName}`;
  return value.replace(/\/?\.sunam\/workspaces\/c-[a-z0-9_-]+/gi, () => visibleRoot);
}

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
  const [processVersion, setProcessVersion] = useState(0);
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
    if (!runtime) return;
    return runtime.subscribe((event) => {
      const prefix = event.type === 'started' ? `\r\n[Agent process ${event.process.id}] Admin@Sunam ~ # ${event.process.command}\r\n` : event.type === 'exited' ? `\r\n[Process ${event.process.id} exited with code ${event.process.exitCode}]\r\n` : event.type === 'stopped' ? `\r\n[Process ${event.process.id} stopped]\r\n` : event.chunk ?? '';
      appendAgentTerminalBuffer(event.process.sessionId, prefix);
      if (sessionIdRef.current === event.process.sessionId && prefix) aiTermRef.current?.write(prefix);
      setProcessVersion((version) => version + 1);
    });
  }, [runtime]);

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
          userTermRef.current?.write(toDisplayShellOutput(data, containerLabel));
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

  useEffect(() => {
    if (!aiTermRef.current) return;
    aiTermRef.current.clear();
    const history = getAgentTerminalBuffer(activeSessionId ?? null);
    if (history) aiTermRef.current.write(history);
    void restoreAgentTerminalBuffer(activeSessionId ?? null).then((restored) => {
      if (restored && aiTermRef.current) {
        aiTermRef.current.clear();
        aiTermRef.current.write(restored);
      }
    }).catch((error) => console.error('Failed to restore terminal history:', error));
  }, [activeSessionId]);

  const processes = runtime?.getProcesses(activeSessionId ? { sessionId: activeSessionId } : undefined) ?? [];
  void processVersion;

  return <div style={{ display: 'flex', flexDirection: layoutState === 'collapsed' ? 'row' : 'column', height: '100%', overflow: 'hidden' }}>
    {layoutState === 'collapsed' ? <CollapsedTerminalNav activeTab={activeTab} onTabChange={onTabChange} onExpand={() => onLayoutChange?.('half')} /> : <TerminalTabs activeTab={activeTab} onTabChange={onTabChange} layoutState={layoutState} onLayoutChange={onLayoutChange} />}
    {layoutState !== 'collapsed' && <div className="terminal-environment-bar" title={activeContainerId ?? undefined}><span className="terminal-environment-dot" />{containerIdentity}<span className="terminal-environment-path">/containers/{containerLabel}</span></div>}
    <div style={{ flex: 1, padding: activeTab === 'files' ? '0' : '16px', position: 'relative', overflow: 'hidden', display: layoutState === 'collapsed' ? 'none' : 'block' }}>
      {activeTab === 'services' && <ServicesPanel ports={activePorts} processes={processes} onClearPort={(port) => setActivePorts((ports) => ports.filter((item) => item.port !== port))} onKillProcess={(process) => { runtime?.stopProcess(process.id, { sessionId: process.sessionId, runId: process.runId, containerId: process.containerId }); }} />}
      {!isBooted && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--color-surface)', zIndex: 10 }}><Loader2 className="lucide-spin" style={{ width: '32px', height: '32px', color: 'var(--color-text-secondary)', animation: 'spin 2s linear infinite' }} /><span style={{ marginTop: '16px', color: 'var(--color-text-secondary)', fontSize: '14px' }}>{t('terminal.booting')}</span></div>}
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: activeTab === 'ai' ? 1 : 0, pointerEvents: activeTab === 'ai' ? 'auto' : 'none', zIndex: activeTab === 'ai' ? 2 : 1 }}><TerminalView readOnly onTerminalReady={(terminal) => { aiTermRef.current = terminal; const history = getAgentTerminalBuffer(activeSessionId ?? null); if (history) terminal.write(history); void restoreAgentTerminalBuffer(activeSessionId ?? null).then((restored) => { if (restored && aiTermRef.current === terminal) { terminal.clear(); terminal.write(restored); } }).catch((error) => console.error('Failed to restore terminal history:', error)); }} /></div>
        <div style={{ position: 'absolute', inset: 0, opacity: activeTab === 'user' ? 1 : 0, pointerEvents: activeTab === 'user' ? 'auto' : 'none', zIndex: activeTab === 'user' ? 2 : 1 }}><TerminalView readOnly={false} onTerminalReady={(terminal) => { userTermRef.current = terminal; setIsUserTermReady(true); }} /></div>
        <div style={{ position: 'absolute', inset: 0, opacity: activeTab === 'files' ? 1 : 0, pointerEvents: activeTab === 'files' ? 'auto' : 'none', zIndex: activeTab === 'files' ? 2 : 1 }}>{isBooted && <Suspense fallback={null}><FileManager wc={webcontainer} rootDir={rootDir} rootLabel={containerLabel} /></Suspense>}</div>
      </div>
    </div>
  </div>;
};

export default DualTerminal;
