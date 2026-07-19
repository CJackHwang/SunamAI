import { lazy, Suspense, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { DualTerminalRef } from '@/features/terminal-session/DualTerminal';
import type { TerminalLayout, TerminalTab } from '@/features/terminal-session/types';
import { useReActAgent } from '@/features/chat-agent/useReActAgent';
import { useChatAutoScroll } from '@/features/chat/hooks/useChatAutoScroll';
import { ChatComposer } from '@/features/chat/ui/ChatComposer';
import { ChatMessageList } from '@/features/chat/ui/ChatMessageList';
import { MobileNavigation } from '@/features/chat/ui/MobileNavigation';
import { ModelSelector } from '@/features/chat/ui/ModelSelector';
import { generateTitle } from '@/features/session/titleService';
import type { SunamModel } from '@/shared/config/models';
import type { SessionStatus } from '@/entities/workspace/types';
import { useWorkspaceStore } from '@/shared/store/useWorkspaceStore';

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

export default function Workspace({ apiKey, baseUrl, apiModel, sunamModel, setSunamModel, onMobileSidebarToggle, activeSessionId, activeContainerId, updateSessionStatus }: WorkspaceProps) {
  const terminalRef = useRef<DualTerminalRef>(null);
  const { messages, startTask, stopTask, retryCount } = useReActAgent(apiKey, baseUrl, apiModel, sunamModel, terminalRef, activeSessionId, activeContainerId, updateSessionStatus);
  const { sessions, createSession, createContainer, renameSession } = useWorkspaceStore();
  const isRunning = sessions.find((session) => session.id === activeSessionId)?.status === 'running';
  const [input, setInput] = useState('');
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [terminalTab, setTerminalTab] = useState<TerminalTab>('ai');
  const [mobileActive, setMobileActive] = useState<'chat' | TerminalTab>('chat');
  const [layoutState, setLayoutState] = useState<TerminalLayout>('half');
  const { containerRef, isAtBottom, onScroll, scrollToBottom } = useChatAutoScroll([messages, isRunning]);

  useEffect(() => {
    const onResize = () => { if (window.innerWidth <= 900) setLayoutState('half'); };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleSubmit = (event?: SyntheticEvent) => {
    event?.preventDefault();
    if (!input.trim() || isRunning || !isTerminalReady) return;
    let isNewSession = false;
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = createSession();
      isNewSession = true;
    } else {
      const session = sessions.find((item) => item.id === sessionId);
      isNewSession = session?.title === '新建对话' || session?.title === '新对话';
    }
    const prompt = input;
    if (isNewSession) {
      void generateTitle(prompt, { apiKey, baseUrl, model: apiModel }).then((title) => { if (title) renameSession(sessionId!, title); }).catch(console.error);
    }
    const containerId = activeContainerId ?? createContainer();
    startTask(prompt, sessionId, containerId);
    setInput('');
  };

  const selectTerminalTab = (tab: TerminalTab) => {
    setTerminalTab(tab);
    setMobileActive(tab);
  };

  return (
    <div className="workspace-container" data-active-tab={mobileActive}>
      <div className="chat-section" style={{ display: layoutState === 'full' ? 'none' : 'flex' }}>
        <ModelSelector model={sunamModel} isOpen={isModelMenuOpen} onToggle={() => setIsModelMenuOpen((open) => !open)} onSelect={(model) => { setSunamModel(model); setIsModelMenuOpen(false); }} onMobileSidebarToggle={onMobileSidebarToggle} />
        <ChatMessageList messages={messages} isRunning={Boolean(isRunning)} retryCount={retryCount} containerRef={containerRef} onScroll={onScroll} />
        <ChatComposer input={input} isRunning={Boolean(isRunning)} isTerminalReady={isTerminalReady} isAtBottom={isAtBottom} onInputChange={(value, element) => { setInput(value); element.style.height = '44px'; element.style.height = `${Math.min(element.scrollHeight, 120)}px`; }} onSubmit={handleSubmit} onStop={stopTask} onScrollToBottom={scrollToBottom} />
      </div>
      <div className="terminal-section" style={{ flex: layoutState === 'collapsed' ? '0 0 56px' : '1', minWidth: layoutState === 'collapsed' ? '56px' : '0', transition: 'all var(--motion-base) var(--motion-ease)', borderLeft: 'none', ...(layoutState === 'full' ? { position: 'fixed', inset: 0, zIndex: 100, paddingTop: 0 } : {}) }}>
        <Suspense fallback={<div className="motion-fade-in" style={{ height: '100%' }} />}>
          <DualTerminal ref={terminalRef} onReady={() => setIsTerminalReady(true)} activeTab={terminalTab} onTabChange={selectTerminalTab} layoutState={layoutState} onLayoutChange={setLayoutState} activeContainerId={activeContainerId} activeSessionId={activeSessionId} />
        </Suspense>
      </div>
      <MobileNavigation active={mobileActive} onChange={(tab) => tab === 'chat' ? setMobileActive('chat') : selectTerminalTab(tab)} />
    </div>
  );
}
