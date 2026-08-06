import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n';
import { ServicesPanel } from '@/features/terminal-session/ServicesPanel';

describe('ServicesPanel', () => {
  const actions = { isRestarting: false, onStopPort: vi.fn(async () => true), onForceRestart: vi.fn(async () => undefined) };

  it('opens an in-page preview and copies ports without exposing external preview links', async () => {
    const writeText = vi.fn(async () => undefined);
    const onPreview = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<I18nProvider><ServicesPanel ports={[{ port: 5173, url: 'https://5173.example.webcontainer-api.io', state: 'managed' }]} processes={[]} onPreview={onPreview} onKillProcess={vi.fn()} {...actions} /></I18nProvider>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('清除记录')).not.toBeInTheDocument();
    expect(screen.queryByText('已登记')).not.toBeInTheDocument();
    expect(container.querySelector('.services-section')).toBeNull();
    expect([...container.querySelectorAll('.services-panel > section')].every((section) => !section.hasAttribute('style'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '预览端口 5173' }));
    expect(onPreview).toHaveBeenCalledWith(5173, 'https://5173.example.webcontainer-api.io');
    onPreview.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '复制端口 5173 地址' }));
    expect(writeText).toHaveBeenCalledWith('https://5173.example.webcontainer-api.io');
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('shows the real canonical process path without a display-only alias', () => {
    render(<I18nProvider><ServicesPanel ports={[]} processes={[{ id: 'proc-1', sessionId: 's-1', runId: 'r-1', containerId: 'c-1', command: 'node /home/workspace/c-1/server.js', isRunning: true, output: '', cursor: 0 }]} onPreview={vi.fn()} onKillProcess={vi.fn()} {...actions} /></I18nProvider>);
    expect(screen.getByText(/\/home\/workspace\/c-1\/server\.js/)).toBeInTheDocument();
    expect(screen.queryByText(/\/containers\/demo/)).not.toBeInTheDocument();
  });

  it('shows clipboard failures instead of using a legacy copy fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('permission denied'); }) } });
    render(<I18nProvider><ServicesPanel ports={[{ port: 3000, url: 'https://3000.example.test', state: 'managed' }]} processes={[]} onPreview={vi.fn()} onKillProcess={vi.fn()} {...actions} /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: '复制端口 3000 地址' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
  });

  it('marks protected system processes and disables their stop button', () => {
    render(<I18nProvider><ServicesPanel ports={[]} processes={[{ id: 'succinix-1', sessionId: '', runId: '', containerId: '', command: 'node host.js', isRunning: true, output: '', cursor: 0, protected: true }]} onPreview={vi.fn()} onKillProcess={vi.fn()} {...actions} /></I18nProvider>);
    expect(screen.getByText('[系统] succinix-1')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /系统进程/ });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: /强制终止 succinix-1/ })).not.toBeInTheDocument();
  });

  it('stops managed ports and reserves force restart for orphaned ports', async () => {
    const onStopPort = vi.fn(async () => true);
    const onForceRestart = vi.fn(async () => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const view = render(<I18nProvider><ServicesPanel ports={[
      { port: 3000, url: 'https://3000.example.test', state: 'managed', launchId: 'launch-1' },
      { port: 4173, url: 'https://4173.example.test', state: 'orphaned' },
    ]} processes={[]} isRestarting={false} onPreview={vi.fn()} onKillProcess={vi.fn()} onStopPort={onStopPort} onForceRestart={onForceRestart} /></I18nProvider>);

    fireEvent.click(within(view.container).getByRole('button', { name: '停止端口 3000 的服务' }));
    expect(onStopPort).toHaveBeenCalledWith(3000);
    fireEvent.click(within(view.container).getByRole('button', { name: '强制重启关闭' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('所有端口、终端和 Agent 后台进程'));
    expect(onForceRestart).toHaveBeenCalledOnce();
  });
});
