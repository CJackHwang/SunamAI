import { describe, expect, it, vi } from 'vitest';
import { appendAgentTerminalBuffer, flushAgentTerminalBuffers, getAgentTerminalBuffer, getAgentTerminalPersistenceError, subscribeAgentTerminalPersistence } from '@/features/terminal-session/agentTerminalBuffer';
import { v2Persistence } from '@/shared/persistence/v2Repository';

describe('agent terminal buffer', () => {
  it('keeps only current-tab terminal output in memory within its size bound', async () => {
    const sessionId = `terminal-${Date.now()}`;
    appendAgentTerminalBuffer(sessionId, 'a'.repeat(50_001));
    expect(getAgentTerminalBuffer(sessionId)).toHaveLength(50_000);
    expect(getAgentTerminalBuffer(null)).toBe('');
    await flushAgentTerminalBuffers();
  });

  it('publishes terminal-history persistence failures', async () => {
    const sessionId = `terminal-error-${Date.now()}`;
    const listener = vi.fn();
    const unsubscribe = subscribeAgentTerminalPersistence(listener);
    const save = vi.spyOn(v2Persistence, 'saveTerminalHistory').mockRejectedValueOnce(new Error('disk unavailable'));
    appendAgentTerminalBuffer(sessionId, 'output');
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(sessionId, 'disk unavailable'));
    expect(getAgentTerminalPersistenceError(sessionId)).toBe('disk unavailable');
    save.mockRestore();
    unsubscribe();
  });

  it('coalesces terminal chunks before flushing the latest bounded history', async () => {
    const sessionId = `terminal-flush-${Date.now()}`;
    const save = vi.spyOn(v2Persistence, 'saveTerminalHistory').mockResolvedValue(undefined);
    appendAgentTerminalBuffer(sessionId, 'first');
    appendAgentTerminalBuffer(sessionId, '-second');
    await flushAgentTerminalBuffers();
    expect(save).toHaveBeenCalledWith(sessionId, 'first-second');
    expect(save.mock.calls.filter(([candidate]) => candidate === sessionId)).toHaveLength(1);
    save.mockRestore();
  });
});
