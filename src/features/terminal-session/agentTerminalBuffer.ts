import { v2Persistence } from '@/shared/persistence/v2Repository';

const MAX_HISTORY_LENGTH = 50_000;

const buffers = new Map<string, string>();

/**
 * Keeps the Agent terminal visible while a tab is open, without persisting
 * terminal output across a development reload.
 */
export function getAgentTerminalBuffer(sessionId: string | null): string {
  return sessionId ? buffers.get(sessionId) ?? '' : '';
}

export function appendAgentTerminalBuffer(sessionId: string | null, data: string): void {
  if (!sessionId || !data) return;
  const next = `${buffers.get(sessionId) ?? ''}${data}`;
  const bounded = next.slice(-MAX_HISTORY_LENGTH);
  buffers.set(sessionId, bounded);
  void v2Persistence.saveTerminalHistory(sessionId, bounded).catch((error) => console.error('Failed to persist terminal history:', error));
}

export async function restoreAgentTerminalBuffer(sessionId: string | null): Promise<string> {
  if (!sessionId) return '';
  if (buffers.has(sessionId)) return buffers.get(sessionId)!;
  const stored = await v2Persistence.loadTerminalHistory(sessionId);
  const content = (stored.value ?? '').slice(-MAX_HISTORY_LENGTH);
  buffers.set(sessionId, content);
  return content;
}
