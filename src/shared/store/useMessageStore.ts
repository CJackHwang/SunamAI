import { useCallback, useEffect, useState } from 'react';
import { loadMessages, saveMessages } from '@/entities/message/repository';
import type { Message } from '@/entities/message/types';

export function useMessageStore(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    setMessages(sessionId ? loadMessages(sessionId) : []);
  }, [sessionId]);

  const updateMessages = useCallback((nextMessages: Message[] | ((previous: Message[]) => Message[])) => {
    setMessages((previous) => {
      const updated = typeof nextMessages === 'function' ? nextMessages(previous) : nextMessages;
      if (sessionId) saveMessages(sessionId, updated);
      return updated;
    });
  }, [sessionId]);

  return { messages, updateMessages };
}
