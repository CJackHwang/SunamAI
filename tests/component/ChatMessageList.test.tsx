import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatMessageList } from '@/features/chat/ui/ChatMessageList';
import { I18nProvider } from '@/shared/i18n';

describe('ChatMessageList', () => {
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
