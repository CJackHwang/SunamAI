import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatMessageList } from '@/features/chat/ui/ChatMessageList';
import { I18nProvider } from '@/shared/i18n';

describe('ChatMessageList', () => {
  it('renders the current SSE content as a streaming assistant message', () => {
    const { container } = render(<I18nProvider><ChatMessageList messages={[]} isRunning retryCount={0} containerRef={createRef<HTMLDivElement>()} onScroll={vi.fn()} streamingContent="正在逐字输出" /></I18nProvider>);
    expect(screen.getByText('正在逐字输出')).toBeInTheDocument();
    expect(container.querySelector('.chat-message.streaming')).toBeInTheDocument();
    expect(screen.queryByText('Sunam 正在思考...')).not.toBeInTheDocument();
  });

  it('streams reasoning before answer content is available', () => {
    const { container } = render(<I18nProvider><ChatMessageList messages={[]} isRunning retryCount={0} containerRef={createRef<HTMLDivElement>()} onScroll={vi.fn()} streamingReasoning="正在分析附件" /></I18nProvider>);
    expect(screen.getByText('正在分析附件')).toBeInTheDocument();
    expect(container.querySelector('.thinking-process.streaming')).toBeInTheDocument();
    expect(screen.queryByText('Sunam 正在思考...')).not.toBeInTheDocument();
  });
});
