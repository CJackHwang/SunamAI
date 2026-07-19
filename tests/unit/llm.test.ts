import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChatRequest, callLLM } from '@/shared/api/llm';
import { consumeChatStream } from '@/shared/api/sse';
import { listModels } from '@/shared/api/models';

const encoder = new TextEncoder();
function stream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk))); controller.close(); } });
}

describe('LLM protocol', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the OpenAI-compatible request body while excluding UI-only fields', () => {
    const tools = [{ type: 'function' as const, function: { name: 'inspect', description: 'inspect', parameters: { type: 'object' } } }];
    const request = buildChatRequest([{ role: 'user', content: 'hi', _ui_streaming: true }], { apiKey: 'key', baseUrl: 'https://api.test', model: 'm', tools });
    expect(request).toMatchObject({ model: 'm', stream: false, tool_choice: 'auto', messages: [{ role: 'user', content: 'hi' }] });
    expect(request.tools).toEqual(tools);
    expect(buildChatRequest([{ role: 'user', content: 'plain' }], { apiKey: 'key', baseUrl: 'https://api.test' })).not.toHaveProperty('tools');
  });

  it('parses split SSE events, streams updates, and combines tool arguments', async () => {
    const updates: string[] = [];
    const message = await consumeChatStream(stream([
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo"}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"arguments":"{\\"message\\":\\"A"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"report_progress","arguments":"B\\"}"}}]}}]}\n',
      'data: [DONE]\n',
      'not an event\n',
      'data: {bad}\n',
      'data: {"choices":[{}]}\n',
    ]), (partial) => updates.push(partial.content));
    expect(updates).toContain('Hello');
    expect(message).toMatchObject({ role: 'assistant', content: 'Hello', tool_calls: [{ id: 'call-1', function: { name: 'report_progress', arguments: '{"message":"AB"}' } }] });
  });

  it('sends auth headers and handles both JSON and model-list responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'model-a' }, { id: 7 }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callLLM([{ role: 'user', content: 'hello' }], { apiKey: 'secret', baseUrl: 'https://example.test/v1', model: 'x' })).resolves.toMatchObject({ content: 'ok' });
    await expect(listModels('secret', 'https://example.test/v1')).resolves.toEqual(['model-a']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/v1/chat/completions');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
  });

  it('supports streaming model calls and reports a missing stream body', async () => {
    const updates: string[] = [];
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"streamed"}}]}\n\ndata: [DONE]\n', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 })));
    await expect(callLLM([{ role: 'user', content: 'stream' }], { apiKey: 'key', baseUrl: 'https://api.test', onUpdate: (partial) => updates.push(partial.content) })).resolves.toMatchObject({ content: 'streamed' });
    expect(updates).toContain('streamed');
    await expect(callLLM([], { apiKey: 'key', baseUrl: 'https://api.test', onUpdate: () => undefined })).rejects.toThrow('No readable stream available');
  });

  it('propagates provider errors for chat and model discovery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('bad request', { status: 400 })).mockResolvedValueOnce(new Response('', { status: 500 })));
    await expect(callLLM([], { apiKey: 'key', baseUrl: 'https://api.test' })).rejects.toThrow('LLM API Error (400): bad request');
    await expect(listModels('key', 'https://api.test')).rejects.toThrow('Model API Error (500)');
  });
});
