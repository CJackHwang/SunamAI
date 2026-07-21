import { describe, expect, it, vi } from 'vitest';
import { ContextComposer } from '@/features/agent-core/context';
import type { AgentModelClient } from '@/features/agent-core/modelClient';

describe('ContextComposer', () => {
  it('tries semantic compaction three times before deterministic fallback', async () => {
    const complete = vi.fn(async () => { throw new Error('summarizer unavailable'); });
    const client = { complete } as unknown as AgentModelClient;
    const composer = new ContextComposer('restored checkpoint');
    const messages = Array.from({ length: 30 }, (_, index) => ({ role: 'user' as const, content: `${index}:${'x'.repeat(3_200)}` }));
    const result = await composer.compactIfNeeded(messages, client, new AbortController().signal);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ compacted: true, fallback: true });
    expect(result.messages).toHaveLength(29);
    expect(composer.getSummary()).toContain('USER:');
  });

  it('does not swallow cancellation while compacting context', async () => {
    const controller = new AbortController();
    const complete = vi.fn(async () => {
      controller.abort();
      throw new DOMException('stopped', 'AbortError');
    });
    const composer = new ContextComposer();
    const messages = Array.from({ length: 30 }, () => ({ role: 'user' as const, content: 'x'.repeat(3_200) }));
    await expect(composer.compactIfNeeded(messages, { complete } as unknown as AgentModelClient, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).toHaveBeenCalledOnce();
  });
});
