import { useEffect, useState, type ReactNode } from 'react';
import type { SessionStatus } from '@/entities/workspace/types';
import type { ProviderApi } from '@/shared/config/providers';
import type { PersonaSelectorOption } from '@/shared/config/personas';
import { WorkspaceRuntimeProvider } from '@/features/runtime/WorkspaceRuntimeProvider';
import { useWorkspaceRuntime } from '@/features/runtime/WorkspaceRuntimeContext';
import { useAgentV2, type AgentController, type AgentConversationView } from '@/features/agent-core/useAgentV2';
import { CapabilityProvider, useAgentCapabilities } from '@/widgets/capability/CapabilityContext';
import { useI18n } from '@/shared/i18n';
import Workspace from '@/widgets/workspace/Workspace';

interface ConfiguredAgentState {
  agent: AgentController;
  conversationView: AgentConversationView;
  onConversationViewChange: (view: AgentConversationView) => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  containerAvailable: boolean;
}

export type { PersonaSelectorOption };

export interface ConfiguredPageProps {
  apiKey: string;
  baseUrl: string;
  apiModel: string;
  /** 当前皮套显示名（顶部模型选择器 + AgentRun.persona）。 */
  personaName: string;
  /** 皮套自定义系统提示词（R5，chat 构建 chaos contract 用）。 */
  systemPrompt?: string;
  /** 皮套模型参数（温度等，供应商支持时生效）。 */
  samplingParams?: Record<string, unknown>;
  /** 渠道供应商请求 API（R4）。 */
  providerApi?: ProviderApi;
  /** 顶部模型选择器选项（已启用皮套）。 */
  personaOptions: PersonaSelectorOption[];
  onSelectPersona: (personaId: string) => void;
  activeSessionId: string | null;
  activeContainerId: string | null;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
  persistenceError: string | null;
  onReloadWorkspace: () => void;
  children: (state: ConfiguredAgentState) => ReactNode;
}

function ConfiguredPageContent({ apiKey, baseUrl, apiModel, personaName, systemPrompt, samplingParams, providerApi, personaOptions, onSelectPersona, activeSessionId, activeContainerId, updateSessionStatus, persistenceError, onReloadWorkspace, children }: ConfiguredPageProps) {
  const { agentRuntime, effectiveContainerState, setContainerSwitchLocked } = useWorkspaceRuntime();
  const capabilities = useAgentCapabilities();
  const { t } = useI18n();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [conversationView, setConversationView] = useState<AgentConversationView>({ kind: 'root' });
  const agent = useAgentV2(apiKey, baseUrl, apiModel, personaName, agentRuntime, activeSessionId, activeContainerId, updateSessionStatus, conversationView, capabilities, systemPrompt, samplingParams, providerApi);

  useEffect(() => {
    if (conversationView.kind === 'subagent' && conversationView.sessionId !== activeSessionId) setConversationView({ kind: 'root' });
  }, [activeSessionId, conversationView]);

  // Lock the container switch while an Agent run is active (root or subagent via the
  // root's observing phase) so a close cannot tear down a running task. `awaiting_user`
  // and finished runs are not locked.
  const activeRun = agent.activeRun;
  useEffect(() => {
    setContainerSwitchLocked(Boolean(activeRun));
  }, [activeRun, setContainerSwitchLocked]);

  return <div className="app-container">
    {children({ agent, conversationView, onConversationViewChange: setConversationView, isMobileOpen, onCloseMobile: () => setIsMobileOpen(false), containerAvailable: effectiveContainerState === 'enabled' })}
    <main className="app-main">
      {persistenceError && <div className="persistence-error motion-notice-in" role="alert"><span>{t('persistence.unavailable')}: {persistenceError}</span><button className="btn btn-secondary" onClick={onReloadWorkspace}>{t('common.retry')}</button></div>}
      <div className="app-workspace"><Workspace apiKey={apiKey} baseUrl={baseUrl} apiModel={apiModel} personaName={personaName} personaOptions={personaOptions} onSelectPersona={onSelectPersona} onMobileSidebarToggle={() => setIsMobileOpen(true)} activeSessionId={activeSessionId} activeContainerId={activeContainerId} agent={agent} conversationView={conversationView} onConversationViewChange={setConversationView} /></div>
    </main>
  </div>;
}

export default function ConfiguredPage(props: ConfiguredPageProps) {
  return <WorkspaceRuntimeProvider><CapabilityProvider><ConfiguredPageContent {...props} /></CapabilityProvider></WorkspaceRuntimeProvider>;
}
