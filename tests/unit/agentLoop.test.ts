import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgentLoop } from '@/features/chat-agent/agentLoop';

describe('agent loop tool orchestration', () => {
  afterEach(() => vi.unstubAllGlobals());

  const sse = (delta: unknown) => new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n`, { status: 200 });
  const baseOptions = (overrides: Partial<Parameters<typeof runAgentLoop>[0]> = {}) => {
    const runtime = { spawnAiProcess: vi.fn().mockResolvedValue('p-1'), getAiProcessStatus: vi.fn().mockReturnValue({ isRunning: true, output: 'out' }), sendAiProcessInput: vi.fn().mockResolvedValue(true), killAiProcess: vi.fn() };
    const messages: unknown[][] = [];
    const statuses: string[] = [];
    return {
      runtime,
      messages,
      statuses,
      options: {
        initialMessages: [{ role: 'system' as const, content: 'system' }, { role: 'user' as const, content: 'do work' }], sessionId: 's-1', containerId: 'c-1', runtime, llmConfig: { apiKey: 'key', baseUrl: 'https://api.test', model: 'm' }, signal: new AbortController().signal, onMessages: (next: unknown[]) => messages.push(next), onStreamingMessage: () => undefined, onStatus: (_id: string, status: string) => statuses.push(status), onRetry: () => undefined,
        ...overrides,
      } as Parameters<typeof runAgentLoop>[0],
    };
  };

  it('runs terminal tools and terminates after tasks_complete without changing protocol behavior', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sse({ tool_calls: [{ index: 0, id: 'call-run', type: 'function', function: { name: 'run_terminal_async', arguments: '{"command":"pwd","waitTime":0}' } }] }))
      .mockResolvedValueOnce(sse({ tool_calls: [{ index: 0, id: 'call-finish', type: 'function', function: { name: 'tasks_complete', arguments: '{}' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { runtime, messages: snapshots, statuses, options } = baseOptions();
    await runAgentLoop(options);
    expect(runtime.spawnAiProcess).toHaveBeenCalledWith('pwd', 'c-1');
    expect(snapshots.at(-1)).toHaveLength(6);
    expect(statuses).toEqual(['running', 'completed_unread']);
  });

  it('supports status, input, kill, unknown and chat tools in one tool turn', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(sse({ tool_calls: [
        { index: 0, id: 'status', type: 'function', function: { name: 'check_terminal_status', arguments: '{"processId":"p-1"}' } },
        { index: 1, id: 'input', type: 'function', function: { name: 'send_terminal_input', arguments: '{"processId":"p-1","input":"y"}' } },
        { index: 2, id: 'kill', type: 'function', function: { name: 'kill_terminal_process', arguments: '{"processId":"p-1"}' } },
        { index: 3, id: 'unknown', type: 'function', function: { name: 'unknown_tool', arguments: '{}' } },
      ] }))
      .mockResolvedValueOnce(sse({ tool_calls: [{ index: 0, id: 'chat', type: 'function', function: { name: 'chat', arguments: '{"message":"need input"}' } }] })));
    const { runtime, messages, statuses, options } = baseOptions();
    await runAgentLoop(options);
    expect(runtime.getAiProcessStatus).toHaveBeenCalledWith('p-1');
    expect(runtime.sendAiProcessInput).toHaveBeenCalledWith('p-1', 'y');
    expect(runtime.killAiProcess).toHaveBeenCalledWith('p-1');
    expect(JSON.stringify(messages)).toContain('Tool unknown_tool is not available');
    expect(statuses).toEqual(['running', 'completed_unread']);
  });

  it('handles plain responses, provider failures, retries and cancellation deterministically', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(sse({ content: 'plain response' })));
    const plain = baseOptions();
    await runAgentLoop(plain.options);
    expect(JSON.stringify(plain.messages)).toContain('plain response');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
    const failure = baseOptions();
    await runAgentLoop(failure.options);
    expect(JSON.stringify(failure.messages)).toContain('LLM API Error (503)');
    expect(failure.statuses.at(-1)).toBe('failed_unread');

    const controller = new AbortController();
    controller.abort();
    const stopped = baseOptions({ signal: controller.signal });
    await runAgentLoop(stopped.options);
    expect(JSON.stringify(stopped.messages)).toContain('Agent stopped by user.');
    expect(stopped.statuses.at(-1)).toBe('idle');
  });
});
