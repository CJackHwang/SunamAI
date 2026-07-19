import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n';
import { ChatComposer } from '@/features/chat/ui/ChatComposer';

describe('ChatComposer', () => {
  it('does not submit until the terminal is ready and submits with Enter afterwards', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onInputChange = vi.fn();
    const { rerender } = render(<I18nProvider><ChatComposer input="" isRunning={false} isTerminalReady={false} isAtBottom onInputChange={onInputChange} onSubmit={onSubmit} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    expect(screen.getByPlaceholderText('容器启动中...')).toBeDisabled();
    rerender(<I18nProvider><ChatComposer input="hello" isRunning={false} isTerminalReady isAtBottom onInputChange={onInputChange} onSubmit={onSubmit} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    await user.type(screen.getByDisplayValue('hello'), '{Enter}');
    expect(onSubmit).toHaveBeenCalled();
  });
});
