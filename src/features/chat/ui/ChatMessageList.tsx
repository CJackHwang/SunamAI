import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Message } from '@/entities/message/types';
import { useI18n } from '@/shared/i18n';
import { ChatMessage } from './ChatMessage';
import './Chat.css';
import './ChatLayout.css';

interface ChatMessageListProps {
  messages: Message[];
  messageKeys?: readonly string[];
  isRunning: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef?: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  bottomInset?: number;
  streamingContent?: string;
  streamingReasoning?: string;
  streamingToolCalls?: NonNullable<Message['tool_calls']>;
  streamingKey?: string;
  isCompacting?: boolean;
  userMessageEntrance?: UserMessageEntranceRequest;
  onUserMessageEntranceConsumed?: (requestId: number) => void;
}

export interface UserMessageEntranceRequest {
  id: number;
  previousLastMessage: Message | null;
}

interface ActiveUserEntrance { requestId: number; message: Message; }

export function ChatMessageList({ messages, messageKeys, isRunning, containerRef, contentRef, onScroll, bottomInset = 100, streamingContent = '', streamingReasoning = '', streamingToolCalls = [], streamingKey, isCompacting = false, userMessageEntrance, onUserMessageEntranceConsumed }: ChatMessageListProps) {
  const { t } = useI18n();
  const [activeUserEntrance, setActiveUserEntrance] = useState<ActiveUserEntrance | null>(null);
  const completedEntranceIdRef = useRef<number | null>(null);
  const animatedMessagesRef = useRef(new WeakSet<Message>());
  const messageKeysRef = useRef(new WeakMap<Message, string>());
  const nextMessageKeyRef = useRef(0);
  const toolResults = useMemo(() => {
    const index = new Map<string, Message>();
    for (const message of messages) if (message.role === 'tool' && message.tool_call_id) index.set(message.tool_call_id, message);
    return index;
  }, [messages]);
  useLayoutEffect(() => {
    if (!userMessageEntrance) return;
    if (completedEntranceIdRef.current === userMessageEntrance.id) return;
    if (activeUserEntrance?.requestId === userMessageEntrance.id) return;
    const boundaryIndex = userMessageEntrance.previousLastMessage ? messages.lastIndexOf(userMessageEntrance.previousLastMessage) : -1;
    const firstCandidateIndex = userMessageEntrance.previousLastMessage && boundaryIndex < 0 ? Math.max(0, messages.length - 1) : boundaryIndex + 1;
    const message = messages.find((candidate, index) => index >= firstCandidateIndex && candidate.role === 'user');
    if (message) {
      animatedMessagesRef.current.add(message);
      completedEntranceIdRef.current = userMessageEntrance.id;
      setActiveUserEntrance({ requestId: userMessageEntrance.id, message });
      onUserMessageEntranceConsumed?.(userMessageEntrance.id);
    }
  }, [activeUserEntrance?.requestId, messages, onUserMessageEntranceConsumed, userMessageEntrance]);
  const messageNodes = messages.flatMap((message, index) => {
    const entranceRequestId = activeUserEntrance?.message === message ? activeUserEntrance.requestId : null;
    let messageKey = messageKeys?.[index] ?? messageKeysRef.current.get(message);
    if (!messageKey) {
      messageKey = `message-${++nextMessageKeyRef.current}`;
      messageKeysRef.current.set(message, messageKey);
    }
    if (streamingKey && messageKey === streamingKey) return [];
    return [<ChatMessage key={messageKey} message={message} toolOutputs={message.tool_calls?.flatMap((tool) => toolResults.get(tool.id) ?? []) ?? []} userEntrance={entranceRequestId !== null} suppressEntrance={animatedMessagesRef.current.has(message)} {...(entranceRequestId !== null ? { onUserEntranceEnd: () => setActiveUserEntrance((current) => current?.requestId === entranceRequestId && current.message === message ? null : current) } : {})} />];
  });
  if (streamingContent || streamingReasoning || streamingToolCalls.length > 0) {
    messageNodes.push(<ChatMessage key={streamingKey ?? 'streaming-assistant'} message={{ role: 'assistant', content: streamingContent, reasoning_content: streamingReasoning, tool_calls: streamingToolCalls, _ui_streaming: true }} toolOutputs={streamingToolCalls.flatMap((tool) => toolResults.get(tool.id) ?? [])} />);
  }
  return (
    <div ref={containerRef} onScroll={onScroll} className="chat-message-list" style={{ '--chat-bottom-inset': `${bottomInset}px` } as CSSProperties}>
      <div ref={contentRef} className="chat-message-list-content">
        {messageNodes}
        {isRunning && !streamingContent && !streamingReasoning && streamingToolCalls.length === 0 && <div className="chat-thinking-indicator motion-fade-in" role="status">{isCompacting ? t('chat.contextCompacting') : t('chat.thinking')}</div>}
      </div>
    </div>
  );
}
