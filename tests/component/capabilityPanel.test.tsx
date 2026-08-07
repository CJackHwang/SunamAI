import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@/shared/i18n';
import { WorkspaceRuntimeContext, type WorkspaceRuntimeContextValue } from '@/features/runtime/WorkspaceRuntimeContext';
import { CapabilityProvider } from '@/widgets/capability/CapabilityContext';
import { CapabilityPanel } from '@/widgets/capability/CapabilityPanel';
import { readCapabilityConfig } from '@/shared/lib/capabilityConfig';

afterEach(() => cleanup());

function fakeRuntime(overrides: Partial<WorkspaceRuntimeContextValue> = {}): WorkspaceRuntimeContextValue {
  return {
    webcontainer: null,
    runtime: null,
    agentRuntime: null,
    error: null,
    isReady: false,
    isRestarting: false,
    containerAvailability: 'enabled',
    containerStarting: false,
    effectiveContainerState: 'enabled',
    retryContainer: vi.fn(async () => true),
    setContainerEnabled: vi.fn(),
    containerSwitchLocked: false,
    setContainerSwitchLocked: vi.fn(),
    forceRestart: vi.fn(async () => undefined),
    getContainerRoot: (id: string) => `/containers/${id}`,
    ...overrides,
  };
}

function renderPanel(value: WorkspaceRuntimeContextValue) {
  return render(
    <I18nProvider>
      <WorkspaceRuntimeContext.Provider value={value}>
        <CapabilityProvider>
          <CapabilityPanel />
        </CapabilityProvider>
      </WorkspaceRuntimeContext.Provider>
    </I18nProvider>,
  );
}

describe('CapabilityPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the four core modules plus the notes extension placeholder', () => {
    renderPanel(fakeRuntime());
    expect(screen.getByText('Agent运行时')).toBeInTheDocument();
    expect(screen.getByText('虚拟容器')).toBeInTheDocument();
    expect(screen.getByText('资源附件')).toBeInTheDocument();
    expect(screen.getByText('笔记管理')).toBeInTheDocument();
    expect(screen.getByText('其他')).toBeInTheDocument();
    expect(screen.getByText('能力库')).toBeInTheDocument();
  });

  it('labels the panel as the model-tool and module manager and describes each module', () => {
    renderPanel(fakeRuntime());
    expect(screen.getByText(/管理 AI 可调用的模型工具与功能模块/)).toBeInTheDocument();
    expect(screen.getByText('Succinix：文件、终端、进程与服务（Succinix 环境）')).toBeInTheDocument();
  });

  it('shows the tool intro under each tool name', () => {
    renderPanel(fakeRuntime());
    fireEvent.click(screen.getByText('资源附件'));
    expect(screen.getByText(/Read a bounded line range/)).toBeInTheDocument();
  });

  it('opens a dialog with the full tool description and closes on Escape', () => {
    renderPanel(fakeRuntime());
    fireEvent.click(screen.getByText('资源附件'));
    fireEvent.click(screen.getByRole('button', { name: /Read a bounded line range/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent(/without copying the whole resource into context/);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('turns the module master off when every tool in it is disabled', () => {
    renderPanel(fakeRuntime());
    fireEvent.click(screen.getByText('资源附件'));
    for (const tool of ['list_resources', 'read_resource_text', 'read_resource_image']) {
      fireEvent.click(screen.getByRole('switch', { name: tool }));
    }
    expect(screen.getByRole('switch', { name: '资源附件' })).toHaveAttribute('aria-checked', 'false');
  });

  it('re-enables every sub-switch when the module master is turned back on', () => {
    renderPanel(fakeRuntime());
    fireEvent.click(screen.getByText('资源附件'));
    for (const tool of ['list_resources', 'read_resource_text', 'read_resource_image']) {
      fireEvent.click(screen.getByRole('switch', { name: tool }));
    }
    const master = screen.getByRole('switch', { name: '资源附件' });
    fireEvent.click(master);
    expect(master).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'read_resource_text' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'list_resources' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps the container override persisted when a tool is toggled afterwards', () => {
    renderPanel(fakeRuntime());
    // Turn the container module off, then toggle an unrelated tool. The later persist
    // must not wipe the container override with a stale config snapshot.
    fireEvent.click(screen.getByRole('switch', { name: '虚拟容器' }));
    fireEvent.click(screen.getByText('资源附件'));
    fireEvent.click(screen.getByRole('switch', { name: 'list_resources' }));
    expect(readCapabilityConfig().modules['virtual-container']).toEqual({ enabled: false });
  });

  it('disables the container switch while an Agent run is active', () => {
    renderPanel(fakeRuntime({ containerSwitchLocked: true }));
    const containerSwitch = screen.getByRole('switch', { name: '虚拟容器' });
    expect(containerSwitch).toBeDisabled();
    expect(containerSwitch).toHaveAttribute('title', '任务结束后可关闭');
  });

  it('does not retry from a restricted state while locked', () => {
    const retryContainer = vi.fn(async () => true);
    renderPanel(fakeRuntime({ effectiveContainerState: 'restricted', containerAvailability: 'restricted', containerSwitchLocked: true, retryContainer }));
    fireEvent.click(screen.getByRole('switch', { name: '虚拟容器' }));
    expect(retryContainer).not.toHaveBeenCalled();
  });

  it('expands a module to reveal its tools and persists a tool toggle', () => {
    renderPanel(fakeRuntime());
    fireEvent.click(screen.getByText('Agent运行时'));
    expect(screen.getByText('Agent运行时').closest('details')).toHaveAttribute('open', '');
    fireEvent.click(screen.getByText('资源附件'));
    fireEvent.click(screen.getByRole('switch', { name: 'read_resource_text' }));
    expect(readCapabilityConfig().tools.read_resource_text).toBe(false);
  });

  it('warns before disabling a not-recommended tool and skips on cancel', () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    renderPanel(fakeRuntime());
    fireEvent.click(screen.getByText('Agent运行时'));
    const completeTask = screen.getByRole('switch', { name: 'complete_task' });
    fireEvent.click(completeTask);
    expect(confirmMock).toHaveBeenCalled();
    expect(readCapabilityConfig().tools.complete_task).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('persists a confirmed disable of a not-recommended tool', () => {
    const confirmMock = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmMock);
    renderPanel(fakeRuntime());
    fireEvent.click(screen.getByText('Agent运行时'));
    fireEvent.click(screen.getByRole('switch', { name: 'complete_task' }));
    expect(readCapabilityConfig().tools.complete_task).toBe(false);
    vi.unstubAllGlobals();
  });

  it('hides tool sub-switches under a module whose master switch is off', () => {
    renderPanel(fakeRuntime());
    fireEvent.click(screen.getByText('资源附件'));
    const master = screen.getByRole('switch', { name: '资源附件' });
    fireEvent.click(master);
    const toolSwitch = screen.getByRole('switch', { name: 'read_resource_text' });
    expect(toolSwitch).toBeDisabled();
  });

  it('shows restricted status for the container and retries on toggle', () => {
    const retryContainer = vi.fn(async () => true);
    const setContainerEnabled = vi.fn();
    renderPanel(fakeRuntime({ effectiveContainerState: 'restricted', containerAvailability: 'restricted', retryContainer, setContainerEnabled }));
    expect(screen.getByText('启动受限 · 点击重试')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: '虚拟容器' }));
    expect(retryContainer).toHaveBeenCalledOnce();
    expect(setContainerEnabled).not.toHaveBeenCalled();
  });

  it('shows the container switch off while restricted so it can never misalign with a stopped container', () => {
    renderPanel(fakeRuntime({ effectiveContainerState: 'restricted', containerAvailability: 'restricted' }));
    expect(screen.getByRole('switch', { name: '虚拟容器' })).toHaveAttribute('aria-checked', 'false');
  });

  it('turning the container module off calls setContainerEnabled(false)', () => {
    const setContainerEnabled = vi.fn();
    renderPanel(fakeRuntime({ setContainerEnabled }));
    fireEvent.click(screen.getByRole('switch', { name: '虚拟容器' }));
    expect(setContainerEnabled).toHaveBeenCalledWith(false);
  });

  it('does not expand the container module while restricted', () => {
    renderPanel(fakeRuntime({ effectiveContainerState: 'restricted', containerAvailability: 'restricted' }));
    fireEvent.click(screen.getByText('虚拟容器'));
    expect(screen.getByText('虚拟容器').closest('details')).not.toHaveAttribute('open');
  });

  it('renders the notes module as a reserved placeholder without a switch', () => {
    renderPanel(fakeRuntime());
    expect(screen.getByText('笔记管理')).toBeInTheDocument();
    expect(screen.getByText('即将随产品线合并以扩展模块上线')).toBeInTheDocument();
    const notesRow = screen.getByText('笔记管理').closest('section');
    expect(within(notesRow!).queryByRole('switch')).not.toBeInTheDocument();
  });
});
