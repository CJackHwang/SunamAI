import { lazy, Suspense, useEffect, useState, type SyntheticEvent } from 'react';
import type { TerminalLayout, TerminalTab } from '@/features/terminal-session/types';
import { RunBoard } from '@/features/agent-core/RunBoard';
import { useAgentV2 } from '@/features/agent-core/useAgentV2';
import { useChatAutoScroll } from '@/features/chat/hooks/useChatAutoScroll';
import { ChatComposer } from '@/features/chat/ui/ChatComposer';
import { ChatMessageList } from '@/features/chat/ui/ChatMessageList';
import { MobileNavigation } from '@/features/chat/ui/MobileNavigation';
import { ModelSelector } from '@/features/chat/ui/ModelSelector';
import { generateTitle } from '@/features/session/titleService';
import type { SunamModel } from '@/shared/config/models';
import type { SessionStatus } from '@/entities/workspace/types';
import type { ChatAttachment } from '@/entities/message/types';
import { useWorkspaceStore } from '@/shared/store/useWorkspaceStore';
import { WorkspaceRuntimeProvider } from '@/features/runtime/WorkspaceRuntimeProvider';
import { useWorkspaceRuntime } from '@/features/runtime/WorkspaceRuntimeContext';
import { readChatAttachments } from '@/features/chat/lib/chatAttachments';
import { useI18n } from '@/shared/i18n';

const DualTerminal = lazy(() => import('@/features/terminal-session/DualTerminal'));

interface WorkspaceProps {
  apiKey: string;
  baseUrl: string;
  apiModel: string;
  sunamModel: SunamModel;
  setSunamModel: (model: SunamModel) => void;
  onMobileSidebarToggle?: () => void;
  activeSessionId: string | null;
  activeContainerId: string | null;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
}

function WorkspaceContent({ apiKey, baseUrl, apiModel, sunamModel, setSunamModel, onMobileSidebarToggle, activeSessionId, activeContainerId, updateSessionStatus }: WorkspaceProps) {
  const { t } = useI18n();
  const { runtime, webcontainer, isReady: isRuntimeReady, error: runtimeError, getContainerRoot } = useWorkspaceRuntime();
  const { events, messages, activeRun, latestRun, streamingContent, startTask, resumeTask, stopTask } = useAgentV2(apiKey, baseUrl, apiModel, sunamModel, runtime, activeSessionId, activeContainerId, updateSessionStatus);
  const { sessions, containers, createSession, createContainer, renameSession } = useWorkspaceStore();
  const isRunning = Boolean(activeRun);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [composerHeight, setComposerHeight] = useState(124);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [terminalTab, setTerminalTab] = useState<TerminalTab>('ai');
  const [mobileActive, setMobileActive] = useState<'chat' | TerminalTab>('chat');
  const [layoutState, setLayoutState] = useState<TerminalLayout>('half');
  const { containerRef, isAtBottom, onScroll, scrollToBottom } = useChatAutoScroll([messages, isRunning, composerHeight]);
  const activeContainer = containers.find((container) => container.id === activeContainerId) ?? null;

  useEffect(() => {
    const onResize = () => { if (window.innerWidth <= 900) setLayoutState('half'); };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleSubmit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isRunning || !isTerminalReady || !isRuntimeReady) return;
    let isNewSession = false;
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = createSession();
      isNewSession = true;
    } else {
      const session = sessions.find((item) => item.id === sessionId);
      isNewSession = session?.title === '新建对话' || session?.title === '新对话';
    }
    const prompt = input.trim() || t('chat.analyzeAttachments');
    if (isNewSession) {
      void generateTitle(prompt, { apiKey, baseUrl, model: apiModel }).then((title) => { if (title) renameSession(sessionId!, title); }).catch(console.error);
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
    <div className="workspace-container" data-active-tab={mobileActive}>
      <div className="chat-section" style={{ display: layoutState === 'full' ? 'none' : 'flex' }}>
        <ModelSelector model={sunamModel} isOpen={isModelMenuOpen} onToggle={() => setIsModelMenuOpen((open) => !open)} onSelect={(model) => { setSunamModel(model); setIsModelMenuOpen(false); }} onMobileSidebarToggle={onMobileSidebarToggle} />
        <ChatMessageList messages={messages} isRunning={isRunning} retryCount={0} containerRef={containerRef} onScroll={onScroll} bottomInset={composerHeight + 16} />
        <ChatComposer input={input} attachments={attachments} attachmentError={attachmentError} isRunning={Boolean(isRunning)} isTerminalReady={isTerminalReady} isAtBottom={isAtBottom} taskList={<RunBoard run={activeRun ?? latestRun} events={events} liveOutput={streamingContent} onResume={() => resumeTask(latestRun)} />} onFilesSelected={(files) => { void readChatAttachments(files).then((next) => { setAttachments((current) => [...current, ...next].slice(0, 8)); setAttachmentError(null); }).catch((error) => setAttachmentError(error instanceof Error ? error.message : String(error))); }} onRemoveAttachment={(index) => setAttachments((current) => current.filter((_attachment, candidateIndex) => candidateIndex !== index))} onInputChange={(value, element) => { setInput(value); element.style.height = '44px'; element.style.height = `${Math.min(element.scrollHeight, 120)}px`; }} onSubmit={handleSubmit} onStop={stopTask} onScrollToBottom={scrollToBottom} onHeightChange={setComposerHeight} />
      </div>
      <div className="terminal-section" style={{ flex: layoutState === 'collapsed' ? '0 0 56px' : '1', minWidth: layoutState === 'collapsed' ? '56px' : '0', transition: 'flex-basis var(--motion-base) var(--motion-ease), min-width var(--motion-base) var(--motion-ease)', borderLeft: 'none', ...(layoutState === 'full' ? { position: 'fixed', inset: 0, zIndex: 100, paddingTop: 0 } : {}) }}>
        <Suspense fallback={<div className="motion-fade-in" style={{ height: '100%' }} />}>
          <DualTerminal runtime={runtime} webcontainer={webcontainer} onReady={() => setIsTerminalReady(true)} activeTab={terminalTab} onTabChange={selectTerminalTab} layoutState={layoutState} onLayoutChange={setLayoutState} activeContainerId={activeContainerId} activeContainerName={activeContainer?.name ?? null} activeSessionId={activeSessionId} rootDir={activeContainerId ? getContainerRoot(activeContainerId) : '/'} />
        </Suspense>
      </div>
      {runtimeError && <div role="alert" style={{ position: 'absolute', right: '16px', bottom: '16px', maxWidth: '420px', padding: '10px 12px', color: '#b91c1c', background: 'var(--color-surface)', border: '1px solid #fecaca', borderRadius: 'var(--radius-small)' }}>{runtimeError}</div>}
      <MobileNavigation active={mobileActive} onChange={(tab) => tab === 'chat' ? setMobileActive('chat') : selectTerminalTab(tab)} />
    </div>
  );
}

export default function Workspace(props: WorkspaceProps) {
  return <WorkspaceRuntimeProvider><WorkspaceContent {...props} /></WorkspaceRuntimeProvider>;
}
