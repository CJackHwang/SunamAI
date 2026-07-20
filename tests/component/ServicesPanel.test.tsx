import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n';
import { ServicesPanel } from '@/features/terminal-session/ServicesPanel';

describe('ServicesPanel', () => {
  it('uses safe links and copies ports without exposing a fake clear action', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<I18nProvider><ServicesPanel ports={[{ port: 5173, url: 'https://5173.example.webcontainer-api.io' }]} processes={[]} containerName="demo" onKillProcess={vi.fn()} /></I18nProvider>);
    const link = screen.getByRole('link', { name: /5173\.example/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText('清除记录')).not.toBeInTheDocument();
    expect(container.querySelector('.services-section')).toBeNull();
    expect([...container.querySelectorAll('.services-panel > section')].every((section) => !section.hasAttribute('style'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '复制端口 5173 地址' }));
    expect(writeText).toHaveBeenCalledWith('https://5173.example.webcontainer-api.io');
  });

  it('sanitizes internal paths in process commands', () => {
    render(<I18nProvider><ServicesPanel ports={[]} containerName="demo" processes={[{ id: 'proc-1', sessionId: 's-1', runId: 'r-1', containerId: 'c-1', command: 'node /home/sunam/.sunam/workspaces/c-1/server.js', isRunning: true, output: '', cursor: 0 }]} onKillProcess={vi.fn()} /></I18nProvider>);
    expect(screen.getByText(/\/containers\/demo\/server\.js/)).toBeInTheDocument();
    expect(screen.queryByText(/\.sunam\/workspaces/)).not.toBeInTheDocument();
  });

  it('shows clipboard failures instead of using a legacy copy fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('permission denied'); }) } });
    render(<I18nProvider><ServicesPanel ports={[{ port: 3000, url: 'https://3000.example.test' }]} processes={[]} containerName="demo" onKillProcess={vi.fn()} /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: '复制端口 3000 地址' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
  });
});
