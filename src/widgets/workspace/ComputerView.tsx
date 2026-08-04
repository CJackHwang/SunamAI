import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { WebContainer } from '@webcontainer/api';
import { Loader2 } from 'lucide-react';
import TerminalView from '@/features/terminal-session/TerminalView';
import { useI18n } from '@/shared/i18n';
import { toErrorMessage } from '@/shared/lib/errors';
import { appendAgentTerminalBuffer, flushAgentTerminalBuffers, subscribeAgentTerminalPersistence } from '@/features/terminal-session/agentTerminalBuffer';
import { WebContainerAgentRuntime } from '@/features/runtime/WebContainerAgentRuntime';
import { CollapsedTerminalNav, TerminalTabs } from '@/features/terminal-session/TerminalTabs';
import { ContainerCapsule } from '@/widgets/workspace/ContainerCapsule';
import { ServicesPanel } from '@/features/terminal-session/ServicesPanel';
import { ServicePreviewOverlay } from '@/features/terminal-session/ServicePreviewOverlay';
import { CapabilityPanel } from '@/widgets/capability/CapabilityPanel';
import type { ContainerSegment, RuntimePortStatus, TerminalLayout, TerminalTab } from '@/shared/contracts/terminal';
import './ComputerView.css';
import './ComputerViewLayout.css';
import { AgentTerminalPanel } from '@/features/terminal-session/AgentTerminalPanel';

const FileManager = lazy(() => import('@/features/file-manager/FileManager'));

// Sub-view order inside the merged "Sunam的电脑" tab; unchanged from the former tabs.
const SEGMENT_ORDER: ContainerSegment[] = ['ai', 'user', 'services', 'files'];
const SWIPE_THRESHOLD_PX = 48;

interface ComputerViewProps {
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
  /** Whether container entries (terminal/files/services) are usable. */
  containerAvailable?: boolean;
  /** Whether a container boot is in flight — shows the container tabs with their booting state. */
  containerStarting?: boolean;
}

const ComputerView = ({ webcontainer, runtime, rootDir, onReady, activeTab, onTabChange, layoutState = 'half', onLayoutChange, activeContainerId, activeContainerName, activeSessionId, isRestarting, onForceRestart, containerAvailable = true, containerStarting = false }: ComputerViewProps) => {
  const { t } = useI18n();
  const containerTabsVisible = containerAvailable || containerStarting;
  const aiTermRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const userTermRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const [isUserTermReady, setIsUserTermReady] = useState(false);
  const [isBooted, setIsBooted] = useState(false);
  const [, setProcessVersion] = useState(0);
  const [activePorts, setActivePorts] = useState<RuntimePortStatus[]>([]);
  const [activePreview, setActivePreview] = useState<{ port: number; lastUrl: string } | null>(null);
  // Sub-view inside the merged "Sunam的电脑" tab: 电脑 / 终端 / 服务.
  const [containerSegment, setContainerSegment] = useState<ContainerSegment>('ai');
  const contentRef = useRef<HTMLDivElement>(null);
  const userShellWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const sessionIdRef = useRef(activeSessionId);
  sessionIdRef.current = activeSessionId;
  const containerLabel = activeContainerName?.trim() || t('sidebar.newContainer');
  const containerIdentity = activeContainerId ? `${containerLabel} · ${activeContainerId.slice(-6)}` : containerLabel;

  useEffect(() => {
    if (runtime) onReady?.();
  }, [onReady, runtime]);

  // Reset the booted flag when there is no live container (dispose/chat-only) so a
  // re-boot shows the "booting" loading state again instead of a stale live terminal.
  useEffect(() => {
    if (!runtime) setIsBooted(false);
  }, [runtime]);

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
    if (window.innerWidth <= 900) return;
    // Only autofocus a terminal view; services/files/capability keep focus where it is.
    const visibleTerminal = activeTab === 'user' ? 'user' : activeTab === 'ai' ? containerSegment : null;
    if (!visibleTerminal) return;
    const timer = setTimeout(() => { (visibleTerminal === 'user' ? userTermRef.current : aiTermRef.current)?.focus(); }, 50);
    return () => clearTimeout(timer);
  }, [activeTab, containerSegment]);

  // Reset to the computer sub-view when a container boot begins so the booting state
  // (which lives on the 电脑/终端 segments) is visible again.
  useEffect(() => {
    if (containerStarting) setContainerSegment('ai');
  }, [containerStarting]);

  // Horizontal-dominant touch drags switch the 电脑 / 终端 / 服务 sub-view inside the
  // merged Sunam computer tab. Vertical drags are already claimed by the terminal's
  // own touch-scroll handler, so only horizontal intent reaches here; mouse users click
  // the capsule instead.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || activeTab !== 'ai') return;
    let startX = 0;
    let startY = 0;
    let armed = false;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { armed = false; return; }
      armed = true;
      startX = event.touches[0]!.clientX;
      startY = event.touches[0]!.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!armed || event.touches.length !== 1) return;
      const currentX = event.touches[0]!.clientX;
      const currentY = event.touches[0]!.clientY;
      const deltaX = currentX - startX;
      const deltaY = currentY - startY;
      if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      armed = false;
      const currentIndex = SEGMENT_ORDER.indexOf(containerSegment);
      const segment = SEGMENT_ORDER[deltaX < 0 ? currentIndex + 1 : currentIndex - 1];
      if (segment) setContainerSegment(segment);
    };
    const disarm = () => { armed = false; };
    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchmove', onTouchMove, { passive: false });
    content.addEventListener('touchend', disarm, { passive: true });
    content.addEventListener('touchcancel', disarm, { passive: true });
    return () => {
      content.removeEventListener('touchstart', onTouchStart);
      content.removeEventListener('touchmove', onTouchMove);
      content.removeEventListener('touchend', disarm);
      content.removeEventListener('touchcancel', disarm);
    };
  }, [activeTab, containerSegment]);

  const processes = activeContainerId ? runtime?.getProcesses({ containerId: activeContainerId }) ?? [] : [];
  const previewService = activePreview ? activePorts.find((entry) => entry.port === activePreview.port) : undefined;

  return <><div className="dual-terminal" data-layout={layoutState}>
    {layoutState === 'collapsed' ? <CollapsedTerminalNav activeTab={activeTab} onTabChange={onTabChange} onExpand={() => onLayoutChange?.('half')} containerAvailable={containerTabsVisible} /> : <TerminalTabs activeTab={activeTab} onTabChange={onTabChange} layoutState={layoutState} containerAvailable={containerTabsVisible} {...(onLayoutChange ? { onLayoutChange } : {})} />}
    {layoutState !== 'collapsed' && activeTab !== 'capability' && <div className="terminal-environment-bar" title={activeContainerId ?? undefined}>{containerIdentity}</div>}
    <div ref={contentRef} className="terminal-content" data-tab={activeTab} data-capsule={activeTab === 'ai' ? 'true' : undefined}>
      {!isBooted && activeTab !== 'capability' && !(activeTab === 'ai' && containerSegment === 'services') && <div className="terminal-boot-state"><Loader2 className="lucide-spin" /><span>{t('terminal.booting')}</span></div>}
      <div className="terminal-panel terminal-shell-panel" id="terminal-segment-panel-ai" role="tabpanel" aria-labelledby="terminal-segment-ai" data-active={activeTab === 'ai' && containerSegment === 'ai'}><AgentTerminalPanel sessionId={activeSessionId ?? null} terminalRef={aiTermRef} /></div>
      <div className="terminal-panel terminal-shell-panel" id="terminal-segment-panel-user" role="tabpanel" aria-labelledby="terminal-segment-user" data-active={activeTab === 'ai' && containerSegment === 'user'}><TerminalView readOnly={false} onTerminalReady={(terminal) => { userTermRef.current = terminal; setIsUserTermReady(true); }} /></div>
      {activeTab === 'ai' && <div className="terminal-panel terminal-services-panel" id="terminal-segment-panel-services" role="tabpanel" aria-labelledby="terminal-segment-services" data-active={containerSegment === 'services'}><ServicesPanel ports={activePorts} processes={processes} isRestarting={isRestarting} onPreview={(port, url) => setActivePreview({ port, lastUrl: url })} onStopPort={(port) => runtime?.stopPort(port) ?? Promise.resolve(false)} onForceRestart={onForceRestart} onKillProcess={(process) => { void runtime?.stopProcess(process.id, { sessionId: process.sessionId, runId: process.runId, containerId: process.containerId }); }} /></div>}
      <div className="terminal-panel terminal-file-panel" id="terminal-segment-panel-files" role="tabpanel" aria-labelledby="terminal-segment-files" data-active={activeTab === 'ai' && containerSegment === 'files'}>{isBooted && <Suspense fallback={null}><FileManager wc={webcontainer} rootDir={rootDir} /></Suspense>}</div>
      <div className="terminal-panel terminal-capability-panel" data-active={activeTab === 'capability'}><CapabilityPanel /></div>
      {activeTab === 'ai' && <ContainerCapsule active={containerSegment} onChange={setContainerSegment} />}
    </div>
  </div>{activePreview && <ServicePreviewOverlay port={activePreview.port} url={previewService?.url ?? activePreview.lastUrl} isOnline={Boolean(previewService)} onDismiss={() => setActivePreview(null)} />}</>;
};

export default ComputerView;
