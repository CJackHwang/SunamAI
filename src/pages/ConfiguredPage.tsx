import { useEffect, useState, type ReactNode } from 'react';
import type { SunamModel } from '@/shared/config/models';
import type { SessionStatus } from '@/entities/workspace/types';
import { WorkspaceRuntimeProvider } from '@/features/runtime/WorkspaceRuntimeProvider';
import { useWorkspaceRuntime } from '@/features/runtime/WorkspaceRuntimeContext';
import { useAgentV2, type AgentController, type AgentConversationView } from '@/features/agent-core/useAgentV2';
import { useI18n } from '@/shared/i18n';
import Workspace from '@/widgets/workspace/Workspace';

interface ConfiguredAgentState {
  agent: AgentController;
  conversationView: AgentConversationView;
  onConversationViewChange: (view: AgentConversationView) => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export interface ConfiguredPageProps {
  apiKey: string;
  baseUrl: string;
  apiModel: string;
  sunamModel: SunamModel;
  setSunamModel: (model: SunamModel) => void;
  activeSessionId: string | null;
  activeContainerId: string | null;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
  persistenceError: string | null;
  onReloadWorkspace: () => void;
  children: (state: ConfiguredAgentState) => ReactNode;
}

function ConfiguredPageContent({ apiKey, baseUrl, apiModel, sunamModel, setSunamModel, activeSessionId, activeContainerId, updateSessionStatus, persistenceError, onReloadWorkspace, children }: ConfiguredPageProps) {
  const { runtime } = useWorkspaceRuntime();
  const { t } = useI18n();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [conversationView, setConversationView] = useState<AgentConversationView>({ kind: 'root' });
  const agent = useAgentV2(apiKey, baseUrl, apiModel, sunamModel, runtime, activeSessionId, activeContainerId, updateSessionStatus, conversationView);

  useEffect(() => {
    if (conversationView.kind === 'subagent' && conversationView.sessionId !== activeSessionId) setConversationView({ kind: 'root' });
  }, [activeSessionId, conversationView]);

  return <div className="app-container">
    {children({ agent, conversationView, onConversationViewChange: setConversationView, isMobileOpen, onCloseMobile: () => setIsMobileOpen(false) })}
    <main className="app-main">
      {persistenceError && <div className="persistence-error motion-notice-in" role="alert"><span>{t('persistence.unavailable')}: {persistenceError}</span><button className="btn btn-secondary" onClick={onReloadWorkspace}>{t('common.retry')}</button></div>}
      <div className="app-workspace"><Workspace apiKey={apiKey} baseUrl={baseUrl} apiModel={apiModel} sunamModel={sunamModel} setSunamModel={setSunamModel} onMobileSidebarToggle={() => setIsMobileOpen(true)} activeSessionId={activeSessionId} activeContainerId={activeContainerId} agent={agent} conversationView={conversationView} onConversationViewChange={setConversationView} /></div>
    </main>
  </div>;
}

export default function ConfiguredPage(props: ConfiguredPageProps) {
  return <WorkspaceRuntimeProvider><ConfiguredPageContent {...props} /></WorkspaceRuntimeProvider>;
}
