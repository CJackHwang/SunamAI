import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n';
import { ChatComposer } from '@/features/chat/ui/ChatComposer';

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function ControlledComposer({ onSubmit }: { onSubmit: () => void }) {
  const [input, setInput] = useState('hello');
  return <ChatComposer input={input} isRunning={false} isTerminalReady isAtBottom onInputChange={(value) => setInput(value)} onSubmit={onSubmit} onStop={vi.fn()} onScrollToBottom={vi.fn()} />;
}

describe('ChatComposer', () => {
  afterEach(() => {
    cleanup();
    setViewportWidth(1024);
  });

  it('does not submit until the terminal is ready and submits with Enter afterwards', async () => {
    setViewportWidth(1024);
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onInputChange = vi.fn();
    const { rerender } = render(<I18nProvider><ChatComposer input="" isRunning={false} isTerminalReady={false} isAtBottom onInputChange={onInputChange} onSubmit={onSubmit} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    expect(screen.getByPlaceholderText('容器启动中...')).toBeDisabled();
    rerender(<I18nProvider><ChatComposer input="hello" isRunning={false} isTerminalReady isAtBottom onInputChange={onInputChange} onSubmit={onSubmit} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    await user.type(screen.getByDisplayValue('hello'), '{Enter}');
    expect(onSubmit).toHaveBeenCalled();
  });

  it('inserts a newline with Enter on mobile and submits from the send button', async () => {
    setViewportWidth(390);
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = render(<I18nProvider><ControlledComposer onSubmit={onSubmit} /></I18nProvider>);
    const textarea = screen.getByDisplayValue('hello');
    await user.type(textarea, '{Enter}world');
    expect(textarea).toHaveValue('hello\nworld');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(container.querySelector('.chat-submit') as HTMLButtonElement);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('keeps desktop Shift+Enter as a newline without submitting', async () => {
    setViewportWidth(1024);
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<I18nProvider><ControlledComposer onSubmit={onSubmit} /></I18nProvider>);
    const textarea = screen.getByDisplayValue('hello');
    await user.type(textarea, '{Shift>}{Enter}{/Shift}world');
    expect(textarea).toHaveValue('hello\nworld');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit Enter during IME composition', () => {
    setViewportWidth(1024);
    const onSubmit = vi.fn();
    render(<I18nProvider><ChatComposer input="输入中" isRunning={false} isTerminalReady isAtBottom onInputChange={vi.fn()} onSubmit={onSubmit} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    fireEvent.keyDown(screen.getByDisplayValue('输入中'), { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('updates Enter behavior when the mounted viewport crosses the mobile breakpoint', () => {
    setViewportWidth(1024);
    const onSubmit = vi.fn();
    render(<I18nProvider><ChatComposer input="hello" isRunning={false} isTerminalReady isAtBottom onInputChange={vi.fn()} onSubmit={onSubmit} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    const textarea = screen.getByDisplayValue('hello');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    setViewportWidth(390);
    act(() => window.dispatchEvent(new Event('resize')));
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
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
    const { container } = render(<I18nProvider><ChatComposer input="" attachments={[{ name: 'notes.txt', size: 5, resourceId: 'res-1' }]} isRunning={false} isTerminalReady isAtBottom onInputChange={vi.fn()} onSubmit={vi.fn()} onStop={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    const sendButton = container.querySelector('.glass-btn') as HTMLButtonElement;
    expect(sendButton).toBeEnabled();
  });
});
