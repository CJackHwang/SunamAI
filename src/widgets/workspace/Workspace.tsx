import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type AnimationEvent, type SyntheticEvent } from 'react';
import type { TerminalLayout, TerminalTab } from '@/shared/contracts/terminal';
import { RunBoard } from '@/features/agent-core/RunBoard';
import type { AgentController, AgentConversationView } from '@/features/agent-core/useAgentV2';
import { isActiveAgentPhase } from '@/features/agent-core/types';
import { useChatAutoScroll } from '@/features/chat/hooks/useChatAutoScroll';
import { ChatComposer } from '@/features/chat/ui/ChatComposer';
import { ChatMessageList } from '@/features/chat/ui/ChatMessageList';
import { MobileNavigation } from '@/features/chat/ui/MobileNavigation';
import { ModelSelector } from '@/features/chat/ui/ModelSelector';
import { SubagentFooter } from '@/features/chat/ui/SubagentFooter';
import { generateTitle } from '@/features/session/titleService';
import type { SunamModel } from '@/shared/config/models';
import type { ChatAttachment } from '@/entities/message/types';
import { useWorkspaceActions, useWorkspaceSelector } from '@/entities/workspace/useWorkspaceStore';
import { useWorkspaceRuntime } from '@/features/runtime/WorkspaceRuntimeContext';
import { readChatAttachments } from '@/features/chat/lib/chatAttachments';
import { useI18n } from '@/shared/i18n';
import { toErrorMessage } from '@/shared/lib/errors';
import { isDefaultSessionTitle } from '@/entities/workspace/defaults';
import './Workspace.css';

const DualTerminal = lazy(() => import('@/widgets/workspace/DualTerminal'));

interface WorkspaceProps {
  apiKey: string;
  baseUrl: string;
  apiModel: string;
  sunamModel: SunamModel;
  setSunamModel: (model: SunamModel) => void;
  onMobileSidebarToggle?: () => void;
  activeSessionId: string | null;
  activeContainerId: string | null;
  agent: AgentController;
  conversationView: AgentConversationView;
  onConversationViewChange: (view: AgentConversationView) => void;
}

export default function Workspace({ apiKey, baseUrl, apiModel, sunamModel, setSunamModel, onMobileSidebarToggle, activeSessionId, activeContainerId, agent, conversationView, onConversationViewChange }: WorkspaceProps) {
  const { t } = useI18n();
  const { runtime, webcontainer, isReady: isRuntimeReady, error: runtimeError, isRestarting, forceRestart, getContainerRoot } = useWorkspaceRuntime();
  const { events, runs, messages, activeRun, latestRun, viewedRun, streamingContent, streamingReasoning, isCompacting, persistenceError: agentPersistenceError, hasOlderEvents, hasNewerEvents, loadOlderEvents, loadRunEvents, showNewerEvents, startTask, guideActiveTask, resumeTask, stopTask, stopSubagent } = agent;
  const sessions = useWorkspaceSelector((state) => state.sessions);
  const containers = useWorkspaceSelector((state) => state.containers);
  const { createSession, createContainer, renameSession } = useWorkspaceActions();
  const isSubagentView = conversationView.kind === 'subagent';
  const isRunning = isSubagentView ? Boolean(viewedRun && (isActiveAgentPhase(viewedRun.phase) || viewedRun.phase === 'awaiting_parent')) : Boolean(activeRun);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [composerHeight, setComposerHeight] = useState(124);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [terminalTab, setTerminalTab] = useState<TerminalTab>('ai');
  const [mobileActive, setMobileActive] = useState<'chat' | TerminalTab>('chat');
  const [layoutState, setLayoutState] = useState<TerminalLayout>('collapsed');
  const [layoutTransition, setLayoutTransition] = useState<'from-full' | null>(null);
  const scrollPositionsRef = useRef(new Map<string, number>());
  const previousViewKeyRef = useRef('root');
  const { containerRef, isAtBottom, onScroll, scrollToBottom } = useChatAutoScroll([messages, isRunning, streamingContent, streamingReasoning, composerHeight]);
  const activeContainer = containers.find((container) => container.id === activeContainerId) ?? null;
  const viewKey = isSubagentView ? conversationView.runId : 'root';

  useEffect(() => {
    if (conversationView.kind === 'subagent' && conversationView.sessionId === activeSessionId) void loadRunEvents(conversationView.runId);
  }, [activeSessionId, conversationView, loadRunEvents]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    scrollPositionsRef.current.set(previousViewKeyRef.current, container.scrollTop);
    const nextPosition = scrollPositionsRef.current.get(viewKey);
    container.scrollTop = nextPosition ?? container.scrollHeight;
    previousViewKeyRef.current = viewKey;
  }, [containerRef, viewKey]);
  const handleChatScroll = () => {
    onScroll();
    const container = containerRef.current;
    if (!container) return;
    if (container.scrollHeight - container.scrollTop - container.clientHeight < 120 && hasNewerEvents) {
      showNewerEvents();
      return;
    }
    if (container.scrollTop > 120 || !hasOlderEvents) return;
    const previousHeight = container.scrollHeight;
    void loadOlderEvents().then((loaded) => {
      if (!loaded) return;
      requestAnimationFrame(() => { if (containerRef.current === container) container.scrollTop += container.scrollHeight - previousHeight; });
    });
  };

  useEffect(() => {
    let wasMobile = window.innerWidth <= 900;
    const onResize = () => { 
      const isMobile = window.innerWidth <= 900;
      if (isMobile && !wasMobile) {
        setLayoutTransition(null);
        setLayoutState('half');
      } else if (!isMobile && wasMobile) {
        setLayoutTransition(null);
        setLayoutState('collapsed');
      }
      wasMobile = isMobile;
    };
    if (window.innerWidth <= 900) setLayoutState('half');
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const changeTerminalLayout = (nextLayout: TerminalLayout) => {
    const restoreFromFull = layoutState === 'full' && nextLayout !== 'full' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLayoutTransition(restoreFromFull ? 'from-full' : null);
    setLayoutState(nextLayout);
  };

  const finishLayoutTransition = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.animationName === 'workspace-model-header-settle') setLayoutTransition(null);
  };

  const handleSubmit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    if (!isTerminalReady || !isRuntimeReady) return;
    if (isRunning) {
      if (!input.trim()) return;
      const guidance = input.trim();
      setInput('');
      setAttachmentError(null);
      void guideActiveTask(guidance).then((accepted) => { if (!accepted) setAttachmentError(t('chat.guidanceFailed')); });
      return;
    }
    if (!input.trim() && attachments.length === 0) return;
    let isNewSession = false;
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = createSession();
      isNewSession = true;
    } else {
      const session = sessions.find((item) => item.id === sessionId);
      isNewSession = Boolean(session && isDefaultSessionTitle(session.title));
    }
    const prompt = input.trim() || t('chat.analyzeAttachments');
    if (isNewSession) {
      void generateTitle(prompt, { apiKey, baseUrl, model: apiModel }).then((title) => { if (title) renameSession(sessionId!, title); }).catch((error) => setAttachmentError(toErrorMessage(error)));
    }
    const containerId = activeContainerId ?? createContainer();
    startTask(prompt, sessionId, containerId, attachments);
    setInput('');
    setAttachments([]);
    setAttachmentError(null);
  };

  const selectTerminalTab = (tab: TerminalTab) => {
    setTerminalTab(tab);
    setMobileActive(tab);
  };

  return (
    <div className="workspace-container" data-active-tab={mobileActive} data-layout={layoutState} data-layout-transition={layoutTransition ?? undefined} onAnimationEnd={finishLayoutTransition}>
      <div className="chat-section">
        <ModelSelector model={sunamModel} isOpen={isModelMenuOpen} onToggle={() => setIsModelMenuOpen((open) => !open)} onSelect={(model) => { setSunamModel(model); setIsModelMenuOpen(false); }} {...(onMobileSidebarToggle ? { onMobileSidebarToggle } : {})} />
        <ChatMessageList messages={messages} isRunning={isRunning} containerRef={containerRef} onScroll={handleChatScroll} bottomInset={(isSubagentView ? 68 : composerHeight) + 16} streamingContent={streamingContent} streamingReasoning={streamingReasoning} isCompacting={isCompacting} />
        {isSubagentView ? <SubagentFooter isRunning={isRunning} isAtBottom={isAtBottom} taskList={viewedRun && viewedRun.task.plan.length > 0 ? <RunBoard run={viewedRun} events={events} liveOutput={streamingContent} /> : undefined} onStop={() => { void stopSubagent(conversationView.runId); }} onReturn={() => onConversationViewChange({ kind: 'root' })} onScrollToBottom={scrollToBottom} /> : <ChatComposer input={input} attachments={attachments} attachmentError={attachmentError} isRunning={Boolean(isRunning)} isTerminalReady={isTerminalReady} isAtBottom={isAtBottom} taskList={<RunBoard run={activeRun ?? latestRun} runs={runs} events={events} liveOutput={streamingContent} {...(isRuntimeReady ? { onResume: () => resumeTask(latestRun) } : {})} onLoadRunEvents={loadRunEvents} />} onFilesSelected={(files) => { void readChatAttachments([...attachments.flatMap((attachment) => attachment.file ?? []), ...files]).then((next) => { setAttachments(next); setAttachmentError(null); }).catch((error) => setAttachmentError(error instanceof Error ? error.message : String(error))); }} onRemoveAttachment={(index) => setAttachments((current) => current.filter((_attachment, candidateIndex) => candidateIndex !== index))} onInputChange={(value, element) => { setInput(value); element.style.height = '44px'; element.style.height = `${Math.min(element.scrollHeight, 120)}px`; }} onSubmit={handleSubmit} onStop={stopTask} onScrollToBottom={scrollToBottom} onHeightChange={setComposerHeight} />}
      </div>
      <div className="terminal-section">
        <Suspense fallback={<div className="motion-fade-in workspace-lazy-state" />}>
          <DualTerminal runtime={runtime} webcontainer={webcontainer} onReady={() => setIsTerminalReady(true)} activeTab={terminalTab} onTabChange={selectTerminalTab} layoutState={layoutState} onLayoutChange={changeTerminalLayout} activeContainerId={activeContainerId} activeContainerName={activeContainer?.name ?? null} activeSessionId={activeSessionId} rootDir={activeContainerId ? getContainerRoot(activeContainerId) : '/'} isRestarting={isRestarting} onForceRestart={forceRestart} />
        </Suspense>
      </div>
      {(runtimeError || agentPersistenceError) && <div role="alert" className="workspace-runtime-error motion-notice-in">{runtimeError || agentPersistenceError}</div>}
      <MobileNavigation active={mobileActive} onChange={(tab) => tab === 'chat' ? setMobileActive('chat') : selectTerminalTab(tab)} />
    </div>
  );
}
