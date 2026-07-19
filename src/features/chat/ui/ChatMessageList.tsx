import type { RefObject } from 'react';
import type { Message } from '@/entities/message/types';
import { useI18n } from '@/shared/i18n';
import { ChatMessage } from './ChatMessage';

interface ChatMessageListProps {
  messages: Message[];
  isRunning: boolean;
  retryCount: number;
  containerRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  bottomInset?: number;
  streamingContent?: string;
  streamingReasoning?: string;
}

export function ChatMessageList({ messages, isRunning, retryCount, containerRef, onScroll, bottomInset = 100, streamingContent = '', streamingReasoning = '' }: ChatMessageListProps) {
  const { t } = useI18n();
  return (
    <div ref={containerRef} onScroll={onScroll} style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '24px', paddingTop: '84px', paddingBottom: `${bottomInset}px`, display: 'flex', flexDirection: 'column', gap: '16px', scrollBehavior: 'smooth', transition: 'padding-bottom var(--motion-fast) var(--motion-ease)' }}>
      {messages.map((message, index) => <ChatMessage key={`${message.role}-${index}`} message={message} toolOutputs={message.tool_calls ? messages.slice(index + 1).filter((candidate) => candidate.role === 'tool' && message.tool_calls!.some((tool) => tool.id === candidate.tool_call_id)) : []} />)}
      {(streamingContent || streamingReasoning) && <ChatMessage message={{ role: 'assistant', content: streamingContent, reasoning_content: streamingReasoning, _ui_streaming: true }} toolOutputs={[]} />}
      {isRunning && !streamingContent && !streamingReasoning && <div style={{ alignSelf: 'flex-start', color: 'var(--color-text-secondary)', fontSize: '14px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '8px' }}>{t('chat.thinking')}{retryCount > 0 && <span style={{ fontSize: '12px', backgroundColor: 'var(--color-border)', padding: '2px 6px', borderRadius: '12px' }}>{t('chat.retry')}: {retryCount}</span>}</div>}
    </div>
  );
}
