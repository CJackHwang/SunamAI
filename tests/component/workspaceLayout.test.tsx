import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/shared/i18n';
import { WorkspaceRuntimeContext, type WorkspaceRuntimeContextValue } from '@/features/runtime/WorkspaceRuntimeContext';
import { CapabilityProvider } from '@/widgets/capability/CapabilityContext';
import Workspace from '@/widgets/workspace/Workspace';
import type { AgentController } from '@/features/agent-core/useAgentV2';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import { STORAGE_KEYS } from '@/shared/lib/storage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

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

describe('Workspace terminal sidebar layout (TASK-UX1)', () => {
  it('defaults the right sidebar to half and persists a manual collapse', async () => {
    const { container } = renderWorkspace(runtimeValue({ containerAvailability: 'enabled', effectiveContainerState: 'enabled' }));
    // Wait for the lazy ComputerView so the expanded tab bar (with layout actions) mounts.
    await screen.findByText('Sunam的电脑');
    expect(container.querySelector('.workspace-container')).toHaveAttribute('data-layout', 'half');
    expect(localStorage.getItem(STORAGE_KEYS.terminalLayout)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '收起' }));
    await waitFor(() => expect(container.querySelector('.workspace-container')).toHaveAttribute('data-layout', 'collapsed'));
    expect(localStorage.getItem(STORAGE_KEYS.terminalLayout)).toBe('collapsed');
  });

  it('restores a persisted layout on mount', async () => {
    localStorage.setItem(STORAGE_KEYS.terminalLayout, 'full');
    const { container } = renderWorkspace(runtimeValue({ containerAvailability: 'enabled', effectiveContainerState: 'enabled' }));
    await screen.findByText('Sunam的电脑');
    expect(container.querySelector('.workspace-container')).toHaveAttribute('data-layout', 'full');
  });
});
