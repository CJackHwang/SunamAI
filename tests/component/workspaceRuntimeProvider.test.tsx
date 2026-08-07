import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/shared/i18n';
import { WorkspaceRuntimeProvider } from '@/features/runtime/WorkspaceRuntimeProvider';
import { useWorkspaceRuntime } from '@/features/runtime/WorkspaceRuntimeContext';
import { STORAGE_KEYS } from '@/shared/lib/storage';

vi.mock('@/features/runtime/runtimeSingleton', () => ({
  getWorkspaceRuntime: vi.fn(),
  waitForWorkspaceHostReady: vi.fn(async () => undefined),
  createChatOnlyAgentRuntime: vi.fn(() => ({}) as never),
  disposeWorkspaceRuntime: vi.fn(async () => undefined),
  forceRestartWorkspaceRuntime: vi.fn(async () => ({ webcontainer: {} as never, runtime: { subscribeErrors: vi.fn(() => () => undefined) } as never }) as never),
}));

vi.mock('@/shared/lib/capabilityConfig', () => ({
  readCapabilityConfig: vi.fn(() => ({ modules: { 'virtual-container': { enabled: true } }, tools: {} })),
  saveCapabilityConfig: vi.fn(),
  setCapabilityModule: vi.fn((config: { modules: Record<string, { enabled: boolean }> }, _id: string, enabled: boolean) => ({ ...config, modules: { ...config.modules, 'virtual-container': { enabled } } })),
}));

import { getWorkspaceRuntime, waitForWorkspaceHostReady } from '@/features/runtime/runtimeSingleton';

const getWorkspaceRuntimeMock = vi.mocked(getWorkspaceRuntime);
const waitForHostReadyMock = vi.mocked(waitForWorkspaceHostReady);

/** A minimal fake runtime that satisfies attachFullRuntime's subscribeErrors call. */
function fakeInstance() {
  return { webcontainer: {} as never, runtime: { subscribeErrors: vi.fn(() => () => undefined) } as never };
}

function Probe() {
  const { containerAvailability, effectiveContainerState, containerStarting, runtime } = useWorkspaceRuntime();
  return (
    <div
      data-testid="probe"
      data-availability={containerAvailability}
      data-state={effectiveContainerState}
      data-starting={containerStarting}
      data-runtime={runtime ? 'yes' : 'no'}
    />
  );
}

function renderProvider() {
  return render(<I18nProvider><WorkspaceRuntimeProvider><Probe /></WorkspaceRuntimeProvider></I18nProvider>);
}

describe('WorkspaceRuntimeProvider restricted-state persistence (R2)', () => {
  beforeEach(() => {
    localStorage.clear();
    getWorkspaceRuntimeMock.mockReset();
    waitForHostReadyMock.mockReset().mockResolvedValue(undefined);
    getWorkspaceRuntimeMock.mockResolvedValue(fakeInstance());
  });

  afterEach(() => cleanup());

  it('does not auto-boot when a restricted marker was recorded on a previous load', () => {
    localStorage.setItem(STORAGE_KEYS.containerUnavailable, '1');
    renderProvider();
    // R2：读取持久化标记 → 不自动开启容器（getWorkspaceRuntime 不被调用）。
    expect(getWorkspaceRuntimeMock).not.toHaveBeenCalled();
    const probe = screen.getByTestId('probe');
    expect(probe).toHaveAttribute('data-availability', 'restricted');
    expect(probe).toHaveAttribute('data-state', 'restricted');
    expect(probe).toHaveAttribute('data-runtime', 'no');
    // 显示"容器环境不可用（已记录），可手动重试"通知。
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/已记录/)).toBeInTheDocument();
  });

  it('auto-boots when no restricted marker is recorded', async () => {
    renderProvider();
    await vi.waitFor(() => expect(getWorkspaceRuntimeMock).toHaveBeenCalled());
  });

  it('clears the marker and re-detects on manual retry', async () => {
    localStorage.setItem(STORAGE_KEYS.containerUnavailable, '1');
    renderProvider();
    expect(getWorkspaceRuntimeMock).not.toHaveBeenCalled();
    // 手动重试：清除标记 → 重新 boot → enabled。
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await vi.waitFor(() => expect(getWorkspaceRuntimeMock).toHaveBeenCalled());
    expect(localStorage.getItem(STORAGE_KEYS.containerUnavailable)).toBeNull();
    await vi.waitFor(() => expect(screen.getByTestId('probe')).toHaveAttribute('data-state', 'enabled'));
  });

  it('auto-boots after the marker is cleared (environment change re-detected)', async () => {
    localStorage.setItem(STORAGE_KEYS.containerUnavailable, '1');
    const first = renderProvider();
    expect(getWorkspaceRuntimeMock).not.toHaveBeenCalled();
    first.unmount();
    cleanup();
    // 模拟用户手动重试成功清除了标记；重新挂载 → 自动 boot。
    localStorage.removeItem(STORAGE_KEYS.containerUnavailable);
    getWorkspaceRuntimeMock.mockClear();
    renderProvider();
    await vi.waitFor(() => expect(getWorkspaceRuntimeMock).toHaveBeenCalled());
  });
});
