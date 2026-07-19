import { useState, useEffect, useCallback } from 'react';
import type { Message } from '../../entities/message/types';

const STORAGE_PREFIX = 'sunam_messages_';

export function useMessageStore(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);

  // Load messages from localStorage when sessionId changes
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    const saved = localStorage.getItem(`${STORAGE_PREFIX}${sessionId}`);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse messages', e);
        setMessages([]);
      }
    } else {
      setMessages([]);
    }
  }, [sessionId]);

  const updateMessages = useCallback((newMessages: Message[] | ((prev: Message[]) => Message[])) => {
    setMessages(prev => {
      const updated = typeof newMessages === 'function' ? newMessages(prev) : newMessages;
      if (sessionId) {
        localStorage.setItem(`${STORAGE_PREFIX}${sessionId}`, JSON.stringify(updated));
      }
      return updated;
    });
  }, [sessionId]);

  return { messages, updateMessages };
}
