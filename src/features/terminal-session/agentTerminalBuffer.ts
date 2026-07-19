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
  buffers.set(sessionId, next.slice(-MAX_HISTORY_LENGTH));
}
