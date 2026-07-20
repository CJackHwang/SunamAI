import type { CSSProperties, RefObject } from 'react';
import type { Message } from '@/entities/message/types';
import { useI18n } from '@/shared/i18n';
import { ChatMessage } from './ChatMessage';
import './Chat.css';
import './ChatLayout.css';

interface ChatMessageListProps {
  messages: Message[];
  isRunning: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  bottomInset?: number;
  streamingContent?: string;
  streamingReasoning?: string;
}

export function ChatMessageList({ messages, isRunning, containerRef, onScroll, bottomInset = 100, streamingContent = '', streamingReasoning = '' }: ChatMessageListProps) {
  const { t } = useI18n();
  return (
    <div ref={containerRef} onScroll={onScroll} className="chat-message-list" style={{ '--chat-bottom-inset': `${bottomInset}px` } as CSSProperties}>
      {messages.map((message, index) => <ChatMessage key={`${message.role}-${index}`} message={message} toolOutputs={message.tool_calls ? messages.slice(index + 1).filter((candidate) => candidate.role === 'tool' && message.tool_calls!.some((tool) => tool.id === candidate.tool_call_id)) : []} />)}
      {(streamingContent || streamingReasoning) && <ChatMessage message={{ role: 'assistant', content: streamingContent, reasoning_content: streamingReasoning, _ui_streaming: true }} toolOutputs={[]} />}
      {isRunning && !streamingContent && !streamingReasoning && <div className="chat-thinking-indicator motion-fade-in">{t('chat.thinking')}</div>}
    </div>
  );
}
