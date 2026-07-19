import type { ReactNode, RefObject } from 'react';
import type { Message } from '@/entities/message/types';
import { useI18n } from '@/shared/i18n';
import { ChatMessage } from './ChatMessage';

interface ChatMessageListProps {
  messages: Message[];
  isRunning: boolean;
  retryCount: number;
  containerRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  runBoard?: ReactNode;
}

export function ChatMessageList({ messages, isRunning, retryCount, containerRef, onScroll, runBoard }: ChatMessageListProps) {
  const { t } = useI18n();
  return (
    <div ref={containerRef} onScroll={onScroll} style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '24px', paddingTop: '84px', paddingBottom: '100px', display: 'flex', flexDirection: 'column', gap: '16px', scrollBehavior: 'smooth' }}>
      {runBoard}
      {messages.map((message, index) => <ChatMessage key={`${message.role}-${index}`} message={message} toolOutputs={message.tool_calls ? messages.slice(index + 1).filter((candidate) => candidate.role === 'tool' && message.tool_calls!.some((tool) => tool.id === candidate.tool_call_id)) : []} />)}
      {isRunning && <div style={{ alignSelf: 'flex-start', color: 'var(--color-text-secondary)', fontSize: '14px', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '8px' }}>{t('chat.thinking')}{retryCount > 0 && <span style={{ fontSize: '12px', backgroundColor: 'var(--color-border)', padding: '2px 6px', borderRadius: '12px' }}>{t('chat.retry')}: {retryCount}</span>}</div>}
    </div>
  );
}
