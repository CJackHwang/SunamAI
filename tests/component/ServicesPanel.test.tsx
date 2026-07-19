import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n';
import { ServicesPanel } from '@/features/terminal-session/ServicesPanel';

describe('ServicesPanel', () => {
  it('opens WebContainer service URLs without retaining an opener window', () => {
    render(<I18nProvider><ServicesPanel ports={[{ port: 5173, url: 'https://5173.example.webcontainer-api.io' }]} processes={[]} onClearPort={vi.fn()} onKillProcess={vi.fn()} /></I18nProvider>);
    const link = screen.getByRole('link', { name: /5173\.example/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).not.toHaveAttribute('rel', 'opener');
  });
});
