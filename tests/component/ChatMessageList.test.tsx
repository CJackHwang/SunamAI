import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageList } from '@/features/chat/ui/ChatMessageList';
import { I18nProvider } from '@/shared/i18n';

describe('ChatMessageList', () => {
  afterEach(cleanup);

  it('shows the periodic thinking indicator and switches its label during active compaction', () => {
    const props = { messages: [], isRunning: true, containerRef: createRef<HTMLDivElement>(), onScroll: vi.fn() };
    const { container, rerender } = render(<I18nProvider><ChatMessageList {...props} /></I18nProvider>);
    const thinking = screen.getByRole('status');
    expect(thinking).toHaveTextContent('Sunam 正在思考...');
    expect(thinking).toHaveClass('chat-thinking-indicator');

    rerender(<I18nProvider><ChatMessageList {...props} isCompacting /></I18nProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('正在自动压缩上下文');
    expect(container.querySelector('.chat-thinking-indicator')).toBeInTheDocument();
  });

  it('animates only the next submitted user bubble and does not replay it', async () => {
    const previous = { role: 'assistant' as const, content: 'Earlier answer' };
    const submitted = { role: 'user' as const, content: 'New prompt' };
    const onEntranceConsumed = vi.fn();
    const props = { isRunning: true, containerRef: createRef<HTMLDivElement>(), onScroll: vi.fn() };
    const rendered = render(<I18nProvider><ChatMessageList {...props} messages={[previous]} /></I18nProvider>);

    rendered.rerender(<I18nProvider><ChatMessageList {...props} messages={[previous, submitted]} userMessageEntrance={{ id: 1, previousLastMessage: previous }} onUserMessageEntranceConsumed={onEntranceConsumed} /></I18nProvider>);
    const bubble = screen.getByText('New prompt').closest('.chat-message')!;
    expect(bubble).toHaveClass('chat-user-message-sending');
    expect(onEntranceConsumed).toHaveBeenCalledWith(1);

    fireEvent.animationEnd(bubble, { animationName: 'chat-user-message-send' });
    await waitFor(() => expect(bubble).not.toHaveClass('chat-user-message-sending'));
    expect(bubble).not.toHaveClass('motion-fade-in');

    rendered.rerender(<I18nProvider><ChatMessageList {...props} messages={[previous, submitted]} streamingContent="Streaming" /></I18nProvider>);
    expect(bubble).not.toHaveClass('chat-user-message-sending');
    expect(onEntranceConsumed).toHaveBeenCalledTimes(1);

    const older = { role: 'user' as const, content: 'Loaded history' };
    rendered.rerender(<I18nProvider><ChatMessageList {...props} messages={[older, previous, submitted]} /></I18nProvider>);
    expect(screen.getByText('New prompt').closest('.chat-message')).toBe(bubble);
    expect(onEntranceConsumed).toHaveBeenCalledTimes(1);
  });

  it('renders the current SSE content as a streaming assistant message', () => {
    const { container } = render(<I18nProvider><ChatMessageList messages={[]} isRunning containerRef={createRef<HTMLDivElement>()} onScroll={vi.fn()} streamingContent="正在逐字输出" /></I18nProvider>);
    expect(screen.getByText('正在逐字输出')).toBeInTheDocument();
    expect(container.querySelector('.chat-message.streaming')).toBeInTheDocument();
    expect(screen.queryByText('Sunam 正在思考...')).not.toBeInTheDocument();
  });

  it('streams reasoning before answer content is available', () => {
    const { container } = render(<I18nProvider><ChatMessageList messages={[]} isRunning containerRef={createRef<HTMLDivElement>()} onScroll={vi.fn()} streamingReasoning="正在分析附件" /></I18nProvider>);
    expect(screen.getByText('正在分析附件')).toBeInTheDocument();
    expect(container.querySelector('.thinking-process.streaming')).toBeInTheDocument();
    expect(screen.queryByText('Sunam 正在思考...')).not.toBeInTheDocument();
  });

  it('renders completed tool calls collapsed by default and expands their details on demand', async () => {
    const user = userEvent.setup();
    const { container } = render(<I18nProvider><ChatMessageList messages={[
      { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'workspace_tree', arguments: '{"max_depth":3}' } }] },
      { role: 'tool', content: 'src\npackage.json', tool_call_id: 'call-1', name: 'workspace_tree' },
    ]} isRunning={false} containerRef={createRef<HTMLDivElement>()} onScroll={vi.fn()} /></I18nProvider>);
    const disclosure = container.querySelector('details.chat-tool') as HTMLDetailsElement;
    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.getByText('已完成: workspace_tree')).toBeInTheDocument();

    await user.click(screen.getByText('已完成: workspace_tree'));

    expect(disclosure).toHaveAttribute('open');
    expect(disclosure.querySelector('.chat-tool-result-content')).toHaveTextContent('src package.json');

    await user.click(screen.getByText('已完成: workspace_tree'));

    expect(disclosure).not.toHaveAttribute('open');
  });

  it('renders assistant prose with its tool call and bounds expanded tool details', async () => {
    const user = userEvent.setup();
    const { container } = render(<I18nProvider><ChatMessageList messages={[
      { role: 'assistant', content: '先说明结论，再展示工具详情。', tool_calls: [{ id: 'call-prose', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/large.ts', line_end: 5000 }) } }] },
      { role: 'tool', content: 'line\n'.repeat(500), tool_call_id: 'call-prose', name: 'read_file' },
    ]} isRunning={false} containerRef={createRef<HTMLDivElement>()} onScroll={vi.fn()} /></I18nProvider>);

    expect(screen.getByText('先说明结论，再展示工具详情。')).toBeInTheDocument();
    await user.click(screen.getByText('已完成: read_file'));
    const body = container.querySelector('.chat-tool-body') as HTMLElement;
    expect(body).toBeVisible();
    expect(body).toHaveClass('chat-tool-body');
  });

  it('keeps pending tools labelled as running and ask_user prompts directly visible', () => {
    const { container } = render(<I18nProvider><ChatMessageList messages={[
      { role: 'assistant', content: '', tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'shell_run', arguments: '{"command":"npm test"}' } },
        { id: 'call-2', type: 'function', function: { name: 'ask_user', arguments: '{"question":"继续吗？"}' } },
      ] },
    ]} isRunning containerRef={createRef<HTMLDivElement>()} onScroll={vi.fn()} /></I18nProvider>);
    expect(screen.getByText('执行中: shell_run')).toBeInTheDocument();
    expect(screen.getByText(/继续吗/)).toBeInTheDocument();
    expect(container.querySelectorAll('details.chat-tool')).toHaveLength(1);
  });

  it('opens tool details without animation when reduced motion is requested', async () => {
    const user = userEvent.setup();
    const animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    const animate = vi.fn();
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));

    try {
      const { container } = render(<I18nProvider><ChatMessageList messages={[
        { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'workspace_tree', arguments: '{"max_depth":3}' } }] },
      ]} isRunning containerRef={createRef<HTMLDivElement>()} onScroll={vi.fn()} /></I18nProvider>);
      const disclosure = container.querySelector('details.chat-tool') as HTMLDetailsElement;

      await user.click(screen.getByText('执行中: workspace_tree'));

      expect(disclosure).toHaveAttribute('open');
      expect(animate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      if (animateDescriptor) Object.defineProperty(Element.prototype, 'animate', animateDescriptor);
      else Reflect.deleteProperty(Element.prototype, 'animate');
    }
  });
});
