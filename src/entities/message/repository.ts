import type { Message } from './types';
import { STORAGE_KEYS, readJson, writeJson } from '@/shared/lib/storage';

export function getMessageStorageKey(sessionId: string): string {
  return `${STORAGE_KEYS.messagesPrefix}${sessionId}`;
}

export function loadMessages(sessionId: string): Message[] {
  const messages = readJson<unknown>(getMessageStorageKey(sessionId), []);
  return Array.isArray(messages) ? messages as Message[] : [];
}

export function saveMessages(sessionId: string, messages: Message[]): void {
  writeJson(getMessageStorageKey(sessionId), messages);
}
