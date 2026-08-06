import { describe, expect, it, vi } from 'vitest';
import { ContextComposer, groupCompleteRounds, microCompact } from '@/features/agent-core/context';
import type { AgentModelClient } from '@/features/agent-core/modelClient';
import { LLMError } from '@/shared/api/llmError';
import type { Message } from '@/entities/message/types';

describe('ContextComposer', () => {
  it('leaves context untouched while it remains below the effective token trigger', async () => {
    const complete = vi.fn();
    const onCompactionStart = vi.fn();
    const messages: Message[] = [{ role: 'user', content: 'short request' }];
    const result = await new ContextComposer('existing').compactIfNeeded(messages, { complete } as unknown as AgentModelClient, new AbortController().signal, { onCompactionStart });
    expect(result).toMatchObject({ compacted: false, fallback: false, summary: 'existing' });
    expect(result.messages).toBe(messages);
    expect(complete).not.toHaveBeenCalled();
    expect(onCompactionStart).not.toHaveBeenCalled();
  });

  it('keeps assistant tool calls and their matching results in one complete group', () => {
    const messages: Message[] = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }, { id: 'search', type: 'function', function: { name: 'search_workspace', arguments: '{"query":"x"}' } }] },
      { role: 'tool', tool_call_id: 'read', content: 'file' },
      { role: 'tool', tool_call_id: 'search', content: 'match' },
      { role: 'user', content: 'continue' },
    ];
    const groups = groupCompleteRounds(messages, (value) => value.length);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.messages).toEqual(messages.slice(0, 3));
  });

  it('micro-compacts stale duplicate reads while preserving failures and writes', () => {
    const round = (id: string, name: string, path: string, content: string): Message[] => [
      { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify({ path }) } }] },
      { role: 'tool', tool_call_id: id, name, content },
    ];
    const messages = [
      ...round('old-read', 'read_file', 'a.ts', 'same body'),
      ...round('same-read', 'read_file', 'a.ts', 'same body'),
      ...round('write', 'run_command', 'a.ts', 'created a.ts'),
      ...round('failure', 'read_file', 'missing.ts', 'Error: not found'),
      ...round('other-1', 'workspace_tree', '', 'tree'),
      ...round('other-2', 'workspace_tree', '', 'tree'),
      ...round('latest-read', 'read_file', 'a.ts', 'same body'),
    ];
    const result = microCompact(messages, (value) => Math.ceil(value.length / 4));
    expect(result.changed).toBe(true);
    expect(result.messages.find((message) => message.tool_call_id === 'old-read')?.content).toContain('micro-compacted read_file a.ts');
    expect(result.messages.find((message) => message.tool_call_id === 'same-read')?.content).toContain('micro-compacted read_file a.ts');
    expect(result.messages.find((message) => message.tool_call_id === 'latest-read')?.content).toBe('same body');
    expect(result.messages.find((message) => message.tool_call_id === 'write')?.content).toBe('created a.ts');
    expect(result.messages.find((message) => message.tool_call_id === 'failure')?.content).toBe('Error: not found');
  });

  it('tracks each result in a parallel tool batch and never deduplicates across a file mutation', () => {
    const messages: Message[] = [
      { role: 'assistant', content: '', tool_calls: [
        { id: 'a-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
        { id: 'b-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.ts"}' } },
      ] },
      { role: 'tool', tool_call_id: 'a-1', name: 'read_file', content: 'A old' },
      { role: 'tool', tool_call_id: 'b-1', name: 'read_file', content: 'B body' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'write-a', type: 'function', function: { name: 'run_command', arguments: '{"command":"cat > a.ts << \'EOF\'","mode":"foreground"}' } }] },
      { role: 'tool', tool_call_id: 'write-a', name: 'run_command', content: 'Updated a.ts' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'a-2', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] },
      { role: 'tool', tool_call_id: 'a-2', name: 'read_file', content: 'A old' },
    ];
    const result = microCompact(messages, (value) => Math.ceil(value.length / 4));
    expect(result.messages.find((message) => message.tool_call_id === 'a-1')?.content).toBe('A old');
    expect(result.messages.find((message) => message.tool_call_id === 'b-1')?.content).toBe('B body');
    expect(result.messages.find((message) => message.tool_call_id === 'a-2')?.content).toBe('A old');
  });

  it('strips media from semantic summaries and automatically rehydrates task state', async () => {
    const requests: Message[][] = [];
    const client: AgentModelClient = {
      getContextProfile: () => ({ contextWindowTokens: 8_192, defaultOutputTokens: 1_024, summaryReserveTokens: 1_024, safetyBufferTokens: 512 }),
      estimateTokens: (value) => Math.ceil(value.length / 4),
      complete: async (messages, options) => {
        requests.push(messages);
        expect(options.tools).toEqual([]);
        return { message: { role: 'assistant' as const, content: 'semantic facts' }, toolCalls: [] };
      },
    };
    const media = `data:image/png;base64,${'A'.repeat(900)}`;
    const messages: Message[] = Array.from({ length: 30 }, (_, index) => ({ role: 'user', content: `${index}:${media}`, contentParts: [{ type: 'image_resource', resourceId: 'res-image' }], resourceIds: ['res-image'] }));
    const result = await new ContextComposer().compactIfNeeded(messages, client, new AbortController().signal, {
      taskContract: 'Ship safely', plan: 'verify', evidence: ['tests passed'], workspaceRevision: 7, eventTailSequence: 42,
      resourceIds: ['res-image', 'res-image'], subagentStatus: ['explore: completed'],
      recentFiles: Array.from({ length: 6 }, (_, index) => ({ path: `${index}.ts`, content: index === 5 ? media : `file ${index}` })),
    });
    expect(requests[0]?.[1]?.content).not.toContain('data:image');
    expect(requests[0]?.[1]?.content).toContain('[image_resource: res-image]');
    expect(result.messages[0]?.content).toContain('TASK CONTRACT:\nShip safely');
    expect(result.messages[0]?.content).toContain('WORKSPACE REVISION: 7');
    expect(result.messages[0]?.content).toContain('EVENT TAIL SEQUENCE: 42');
    expect(result.messages[0]?.content).toContain('SUBAGENT STATUS:\nexplore: completed');
    expect(result.messages[0]?.content).not.toContain('FILE 0.ts');
    expect(result.messages[0]?.content).toContain('FILE 5.ts');
    expect(result.messages[0]?.content).toContain('[embedded media removed]');
    expect(result.rehydratedResourceIds).toEqual(['res-image']);
  });
  it('tries semantic compaction three times before deterministic fallback', async () => {
    const complete = vi.fn(async () => { throw new LLMError('http_error', 'prompt too long for context length', { status: 400 }); });
    const client = { complete } as unknown as AgentModelClient;
    const composer = new ContextComposer('restored checkpoint');
    const messages = Array.from({ length: 30 }, (_, index) => ({ role: 'user' as const, content: `${index}:${'x'.repeat(3_200)}` }));
    const result = await composer.compactIfNeeded(messages, client, new AbortController().signal);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ compacted: true, fallback: true });
    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    expect(composer.getSummary()).toContain('Latest user direction');
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

  it('opens a circuit after three failures and skips later semantic calls', async () => {
    const complete = vi.fn(async () => { throw new LLMError('http_error', 'maximum prompt token length exceeded', { status: 400 }); });
    const client = { complete } as unknown as AgentModelClient;
    const composer = new ContextComposer();
    const messages = Array.from({ length: 30 }, (_, index) => ({ role: 'user' as const, content: `${index}:${'x'.repeat(3_200)}` }));
    await composer.compactIfNeeded(messages, client, new AbortController().signal);
    const second = await composer.compactIfNeeded(messages, client, new AbortController().signal);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(second).toMatchObject({ fallback: true, fallbackReason: 'compaction_circuit_open' });
  });

  it('clips one oversized recent round so compaction always returns inside the effective window', async () => {
    const profile = { contextWindowTokens: 8_192, defaultOutputTokens: 1_024, summaryReserveTokens: 1_024, safetyBufferTokens: 512 };
    const client: AgentModelClient = {
      getContextProfile: () => profile,
      estimateTokens: (value) => Math.ceil(value.length / 4),
      complete: vi.fn(),
    };
    const onCompactionStart = vi.fn();
    const result = await new ContextComposer().compactIfNeeded([{ role: 'user', content: 'x'.repeat(80_000) }], client, new AbortController().signal, { onCompactionStart });
    const effective = profile.contextWindowTokens - profile.defaultOutputTokens - profile.summaryReserveTokens - profile.safetyBufferTokens;
    expect(result).toMatchObject({ compacted: true });
    expect(result.afterTokens).toBeLessThanOrEqual(effective);
    expect(result.messages.at(-1)?.content).toContain('oversized recent message clipped');
    expect(client.complete).not.toHaveBeenCalled();
    expect(onCompactionStart).toHaveBeenCalledOnce();
  });

  it('uses the model estimator when clipping oversized Chinese context and fixed request overhead', async () => {
    const profile = { contextWindowTokens: 8_192, defaultOutputTokens: 1_024, summaryReserveTokens: 1_024, safetyBufferTokens: 512 };
    const client: AgentModelClient = {
      getContextProfile: () => profile,
      estimateTokens: (value) => [...value].reduce((total, character) => total + (/\p{Script=Han}/u.test(character) ? 1 : 0.25), 0),
      complete: vi.fn(),
    };
    const result = await new ContextComposer().compactIfNeeded([{ role: 'user', content: '中文上下文'.repeat(10_000) }], client, new AbortController().signal, { fixedRequestTokens: 700 });
    const effective = profile.contextWindowTokens - profile.defaultOutputTokens - profile.summaryReserveTokens - profile.safetyBufferTokens;
    expect(result.afterTokens).toBeLessThanOrEqual(effective);
    expect(result.messages.at(-1)?.content).toContain('oversized recent message clipped');
  });

  it('keeps only the newest visual reads inside the post-compaction media budget', async () => {
    const client: AgentModelClient = {
      getContextProfile: () => ({ contextWindowTokens: 32_768, defaultOutputTokens: 4_096, summaryReserveTokens: 4_096, safetyBufferTokens: 2_048 }),
      estimateTokens: (value) => Math.ceil(value.length / 4),
      complete: async () => ({ message: { role: 'assistant', content: 'visual facts' }, toolCalls: [] }),
    };
    const messages: Message[] = Array.from({ length: 12 }, (_, index) => ({ role: 'user', content: `${index}:${'x'.repeat(8_000)}`, contentParts: [{ type: 'text', text: `${index}:${'x'.repeat(8_000)}` }, { type: 'image_resource', resourceId: `image-${index}` }], resourceIds: [`image-${index}`] }));
    const result = await new ContextComposer().compactIfNeeded(messages, client, new AbortController().signal, { resourceIds: messages.flatMap((message) => message.resourceIds ?? []) });
    const retainedImages = result.messages.flatMap((message) => message.contentParts ?? []).filter((part) => part.type === 'image_resource');
    expect(retainedImages).toHaveLength(4);
    expect(retainedImages.map((part) => part.type === 'image_resource' ? part.resourceId : '')).toEqual(['image-8', 'image-9', 'image-10', 'image-11']);
    expect(result.rehydratedResourceIds).toHaveLength(12);
  });
});
