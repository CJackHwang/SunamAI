import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MobileNavigation } from '@/features/chat/ui/MobileNavigation';
import { I18nProvider } from '@/shared/i18n';

describe('MobileNavigation', () => {
  it('keeps all five page switches accessible and reports the active page', async () => {
    const onChange = vi.fn();
    render(<I18nProvider><MobileNavigation active="chat" onChange={onChange} /></I18nProvider>);

    expect(screen.getByRole('navigation', { name: '对话' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '对话' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: '服务' }));
    expect(onChange).toHaveBeenCalledWith('services');
  });
});
