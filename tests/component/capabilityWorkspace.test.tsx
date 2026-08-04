import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@/shared/i18n';
import { WorkspaceRuntimeContext, type WorkspaceRuntimeContextValue } from '@/features/runtime/WorkspaceRuntimeContext';
import { CapabilityProvider } from '@/widgets/capability/CapabilityContext';
import Workspace from '@/widgets/workspace/Workspace';
import type { AgentController } from '@/features/agent-core/useAgentV2';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';

afterEach(() => cleanup());

function runtimeValue(overrides: Partial<WorkspaceRuntimeContextValue> = {}): WorkspaceRuntimeContextValue {
  return {
    webcontainer: null,
    runtime: null,
    agentRuntime: {} as AgentWorkspaceRuntime,
    error: null,
    isReady: true,
    isRestarting: false,
    containerAvailability: 'restricted',
    containerStarting: false,
    effectiveContainerState: 'restricted',
    retryContainer: vi.fn(async () => false),
    setContainerEnabled: vi.fn(),
    containerSwitchLocked: false,
    setContainerSwitchLocked: vi.fn(),
    forceRestart: vi.fn(async () => undefined),
    getContainerRoot: (id: string) => `/containers/${id}`,
    ...overrides,
  };
}

function fakeAgent(): AgentController {
  return {
    events: [], runs: [], messages: [], messageKeys: [],
    activeRun: null, latestRun: null, viewedRun: null,
    streamingKey: null, streamingContent: '', streamingReasoning: '', streamingToolCalls: [],
    isCompacting: false, persistenceError: null,
    hasOlderEvents: false, hasNewerEvents: false,
    loadOlderEvents: vi.fn(async () => false), loadRunEvents: vi.fn(async () => undefined), showNewerEvents: vi.fn(),
    startTask: vi.fn(), guideActiveTask: vi.fn(async () => true), resumeTask: vi.fn(), stopTask: vi.fn(), stopSubagent: vi.fn(async () => true),
  } as unknown as AgentController;
}

function renderWorkspace(value: WorkspaceRuntimeContextValue) {
  return render(
    <I18nProvider>
      <WorkspaceRuntimeContext.Provider value={value}>
        <CapabilityProvider>
          <Workspace apiKey="" baseUrl="" apiModel="" sunamModel="Sunam 6.9 Pron" setSunamModel={vi.fn()} activeSessionId={null} activeContainerId={null} agent={fakeAgent()} conversationView={{ kind: 'root' }} onConversationViewChange={vi.fn()} />
        </CapabilityProvider>
      </WorkspaceRuntimeContext.Provider>
    </I18nProvider>,
  );
}

describe('Workspace in chat-only (restricted container)', () => {
  it('keeps the composer enabled so the user can chat while the container is restricted', () => {
    renderWorkspace(runtimeValue());
    const composer = screen.getByPlaceholderText('问 Sunam 任何问题...');
    expect(composer).toBeEnabled();
    expect(composer).toHaveAttribute('placeholder', '问 Sunam 任何问题...');
  });

  it('shows the container-booting state in the composer while a boot is in flight', () => {
    renderWorkspace(runtimeValue({ containerStarting: true }));
    const composer = screen.getByPlaceholderText('容器启动中...');
    expect(composer).toBeDisabled();
  });

  it('keeps the capability rail present and hides container entry tabs', async () => {
    renderWorkspace(runtimeValue());
    // ComputerView is lazy — wait for it to resolve, then the capability panel appears.
    expect(await screen.findByText(/管理 AI 可调用的模型工具与功能模块/)).toBeInTheDocument();
    expect(screen.getByText(/开关改动在下一轮任务生效/)).toBeInTheDocument();
    expect(screen.queryByText('服务')).not.toBeInTheDocument();
    expect(screen.queryByText('终端')).not.toBeInTheDocument();
  });

  it('defaults the mobile view to the chat page (not the capability page) when the container is off', () => {
    const { container } = renderWorkspace(runtimeValue());
    expect(container.querySelector('.workspace-container')).toHaveAttribute('data-active-tab', 'chat');
  });

  it('stays on the chat page during the automatic initial boot (container was on at load)', () => {
    const { container } = renderWorkspace(runtimeValue({ containerAvailability: 'enabled', effectiveContainerState: 'enabled', containerStarting: true }));
    expect(container.querySelector('.workspace-container')).toHaveAttribute('data-active-tab', 'chat');
  });

  it('jumps to the Sunam computer tab on a user-initiated boot after the container was closed at load', () => {
    const { container } = renderWorkspace(runtimeValue({ containerStarting: true }));
    expect(container.querySelector('.workspace-container')).toHaveAttribute('data-active-tab', 'ai');
  });

  it('shows the container tabs in the bottom nav while the container is starting so the indicator can track the ai page', () => {
    renderWorkspace(runtimeValue({ containerStarting: true }));
    const nav = screen.getByRole('navigation', { name: '对话' });
    expect(within(nav).getByRole('button', { name: 'Sunam的电脑' })).toBeInTheDocument();
  });

  it('shows the container entry tabs when the container is enabled', async () => {
    renderWorkspace(runtimeValue({ containerAvailability: 'enabled', effectiveContainerState: 'enabled' }));
    // Collapsed rail renders container tabs as icon buttons carrying their label as a title.
    expect(await screen.findByTitle('Sunam的电脑')).toBeInTheDocument();
    expect(screen.getByTitle('能力库')).toBeInTheDocument();
  });
});
