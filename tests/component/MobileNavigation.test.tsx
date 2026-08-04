import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileNavigation } from '@/features/chat/ui/MobileNavigation';
import { I18nProvider } from '@/shared/i18n';

afterEach(() => cleanup());

describe('MobileNavigation', () => {
  it('keeps all page switches accessible and reports the active page', async () => {
    const onChange = vi.fn();
    render(<I18nProvider><MobileNavigation active="chat" onChange={onChange} /></I18nProvider>);

    expect(screen.getByRole('navigation', { name: '对话' })).toBeInTheDocument();
    // 对话 / 电脑 / 能力库 — the user terminal, services, and files merged into 电脑.
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '对话' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Sunam的电脑' }));
    expect(onChange).toHaveBeenCalledWith('ai');
    await userEvent.click(screen.getByRole('button', { name: '能力库' }));
    expect(onChange).toHaveBeenCalledWith('capability');
  });

  it('hides container tabs when the container capability is unavailable', () => {
    render(<I18nProvider><MobileNavigation active="capability" onChange={vi.fn()} showContainerTabs={false} /></I18nProvider>);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '对话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '能力库' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sunam的电脑' })).not.toBeInTheDocument();
  });
});
