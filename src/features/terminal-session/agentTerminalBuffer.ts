import { v2Persistence } from '@/shared/persistence/v2Repository';
import { toErrorMessage } from '@/shared/lib/errors';

const MAX_HISTORY_LENGTH = 50_000;

const buffers = new Map<string, string>();
const persistenceErrors = new Map<string, string>();
const errorListeners = new Set<(sessionId: string, error: string | null) => void>();
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const writeChains = new Map<string, Promise<void>>();

function persistBuffer(sessionId: string): Promise<void> {
  const content = buffers.get(sessionId) ?? '';
  const write = (writeChains.get(sessionId) ?? Promise.resolve())
    .then(() => v2Persistence.saveTerminalHistory(sessionId, content))
    .then(() => {
      if (!persistenceErrors.delete(sessionId)) return;
      errorListeners.forEach((listener) => listener(sessionId, null));
    })
    .catch((error) => {
      const message = toErrorMessage(error);
      persistenceErrors.set(sessionId, message);
      errorListeners.forEach((listener) => listener(sessionId, message));
    });
  writeChains.set(sessionId, write);
  return write;
}

function schedulePersistence(sessionId: string): void {
  const pending = pendingWrites.get(sessionId);
  if (pending) clearTimeout(pending);
  pendingWrites.set(sessionId, setTimeout(() => {
    pendingWrites.delete(sessionId);
    void persistBuffer(sessionId);
  }, 100));
}

export function subscribeAgentTerminalPersistence(listener: (sessionId: string, error: string | null) => void): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

export function getAgentTerminalPersistenceError(sessionId: string | null): string | null {
  return sessionId ? persistenceErrors.get(sessionId) ?? null : null;
}

/** Keeps the live Agent terminal bounded while its history is persisted. */
export function getAgentTerminalBuffer(sessionId: string | null): string {
  return sessionId ? buffers.get(sessionId) ?? '' : '';
}

export function appendAgentTerminalBuffer(sessionId: string | null, data: string): void {
  if (!sessionId || !data) return;
  const next = `${buffers.get(sessionId) ?? ''}${data}`;
  const bounded = next.slice(-MAX_HISTORY_LENGTH);
  buffers.set(sessionId, bounded);
  schedulePersistence(sessionId);
}

export async function flushAgentTerminalBuffers(): Promise<void> {
  const scheduledSessions = [...pendingWrites.keys()];
  scheduledSessions.forEach((sessionId) => {
    clearTimeout(pendingWrites.get(sessionId));
    pendingWrites.delete(sessionId);
  });
  await Promise.all(scheduledSessions.map(persistBuffer));
  await Promise.all(writeChains.values());
}

export async function restoreAgentTerminalBuffer(sessionId: string | null): Promise<string> {
  if (!sessionId) return '';
  if (buffers.has(sessionId)) return buffers.get(sessionId)!;
  const stored = await v2Persistence.loadTerminalHistory(sessionId);
  const content = (stored.value ?? '').slice(-MAX_HISTORY_LENGTH);
  buffers.set(sessionId, content);
  return content;
}
