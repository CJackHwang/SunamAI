import { describe, expect, it } from 'vitest';
import { appendAgentTerminalBuffer, getAgentTerminalBuffer } from '@/features/terminal-session/agentTerminalBuffer';

describe('agent terminal buffer', () => {
  it('keeps only current-tab terminal output in memory within its size bound', () => {
    const sessionId = `terminal-${Date.now()}`;
    appendAgentTerminalBuffer(sessionId, 'a'.repeat(50_001));
    expect(getAgentTerminalBuffer(sessionId)).toHaveLength(50_000);
    expect(getAgentTerminalBuffer(null)).toBe('');
  });
});
