import { render, screen, within } from '@testing-library/react';
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

  it('places a chat attachment control beside the task-list slot and reports selected files', async () => {
    const user = userEvent.setup();
    const onFilesSelected = vi.fn();
    const { container } = render(<I18nProvider><ChatComposer input="hello" isRunning={false} isTerminalReady isAtBottom taskList={<div>task list</div>} onFilesSelected={onFilesSelected} onInputChange={vi.fn()} onSubmit={vi.fn()} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['notes'], 'notes.txt', { type: 'text/plain' }));
    expect(onFilesSelected).toHaveBeenCalledWith([expect.objectContaining({ name: 'notes.txt' })]);
    expect(within(container).getByRole('button', { name: '添加聊天附件' })).toBeInTheDocument();
  });

  it('keeps the scroll control in the independent right-side action column', () => {
    const { container } = render(<I18nProvider><ChatComposer input="" isRunning={false} isTerminalReady isAtBottom={false} onInputChange={vi.fn()} onSubmit={vi.fn()} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    expect(within(container).getByRole('button', { name: '回到底部' })).toHaveClass('chat-scroll-bottom-btn');
  });

  it('allows sending attachments without requiring typed text', () => {
    const { container } = render(<I18nProvider><ChatComposer input="" attachments={[{ name: 'notes.txt', size: 5, content: 'hello' }]} isRunning={false} isTerminalReady isAtBottom onInputChange={vi.fn()} onSubmit={vi.fn()} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    const sendButton = container.querySelector('.glass-btn') as HTMLButtonElement;
    expect(sendButton).toBeEnabled();
  });
});
