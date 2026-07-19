import { STORAGE_KEYS, readText, writeText } from '@/shared/lib/storage';

const MAX_HISTORY_LENGTH = 50_000;

export function getAiTerminalHistory(sessionId: string | null): string {
  return sessionId ? readText(`${STORAGE_KEYS.aiTerminalHistoryPrefix}${sessionId}`) : '';
}

export function appendAiTerminalHistory(sessionId: string | null, data: string): void {
  if (!sessionId) return;
  const key = `${STORAGE_KEYS.aiTerminalHistoryPrefix}${sessionId}`;
  const nextHistory = `${readText(key)}${data}`;
  writeText(key, nextHistory.length > MAX_HISTORY_LENGTH ? nextHistory.slice(-MAX_HISTORY_LENGTH) : nextHistory);
}
