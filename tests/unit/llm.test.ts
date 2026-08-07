import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildChatRequest, callLLM } from '@/shared/api/llm';
import { consumeChatStream } from '@/shared/api/sse';
import { listModels } from '@/shared/api/models';
import { estimateTextTokens, profileForModel } from '@/features/agent-core/modelClient';
import { toErrorMessage } from '@/shared/lib/errors';

const encoder = new TextEncoder();
function stream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk))); controller.close(); } });
}

describe('LLM protocol', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('redacts secrets from errors before they can reach persistence or UI surfaces', () => {
    expect(toErrorMessage(new Error('failed with sk-abcdefghijkl and Bearer secret-token api_key=visible'))).toBe('failed with [REDACTED_API_KEY] and Bearer [REDACTED] api_key=[REDACTED]');
  });

  it('preserves the OpenAI-compatible request body while excluding UI-only fields', () => {
    const tools = [{ type: 'function' as const, function: { name: 'inspect', description: 'inspect', parameters: { type: 'object' } } }];
    const request = buildChatRequest([{ role: 'user', content: 'hi', _ui_streaming: true, _ui_displayContent: 'visible', _ui_attachments: [{ name: 'a.txt', size: 1, resourceId: 'res-a' }] }], { apiKey: 'key', baseUrl: 'https://api.test', model: 'm', tools });
    expect(request).toMatchObject({ model: 'm', stream: false, tool_choice: 'auto', messages: [{ role: 'user', content: 'hi' }] });
    expect(request.tools).toEqual(tools);
    expect(buildChatRequest([{ role: 'user', content: 'plain' }], { apiKey: 'key', baseUrl: 'https://api.test' })).not.toHaveProperty('tools');
  });

  it('parses split SSE events, streams updates, and combines tool arguments', async () => {
    const updates: string[] = [];
    const reasoningUpdates: string[] = [];
    const message = await consumeChatStream(stream([
      'data: {"choices":[{"delta":{"content":null,"reasoning_content":"First inspect"}}]}\n',
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo"}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"arguments":"{\\"message\\":\\"A"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"report_progress","arguments":"B\\"}"}}]}}]}\n',
      'data: [DONE]\n',
      'not an event\n',
      'data: {bad}\n',
      'data: {"choices":[{}]}\n',
    ]), (partial) => { updates.push(partial.content); reasoningUpdates.push(partial.reasoning_content ?? ''); });
    expect(updates).toContain('Hello');
    expect(reasoningUpdates).toContain('First inspect');
    expect(message).toMatchObject({ role: 'assistant', content: 'Hello', reasoning_content: 'First inspect', tool_calls: [{ id: 'call-1', function: { name: 'report_progress', arguments: '{"message":"AB"}' } }] });
  });

  it('accepts nullable reasoning fields in non-streaming provider responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok', reasoning_content: null } }] }), { status: 200 })));
    await expect(callLLM([{ role: 'user', content: 'hello' }], { apiKey: 'key', baseUrl: 'https://example.test/v1' })).resolves.toEqual({ role: 'assistant', content: 'ok' });
  });

  it('coalesces a 1,000-delta burst and force-flushes the exact final content', async () => {
    const updates: string[] = [];
    const chunks = Array.from({ length: 1_000 }, () => 'data: {"choices":[{"delta":{"content":"x"}}]}\n');
    chunks.push('data: [DONE]\n');
    const message = await consumeChatStream(stream(chunks), (partial) => updates.push(partial.content));
    expect(message.content).toBe('x'.repeat(1_000));
    expect(updates.at(-1)).toBe(message.content);
    expect(updates.length).toBeLessThanOrEqual(2);
  });

  it('surfaces structured SSE errors and bounds an unterminated provider buffer', async () => {
    await expect(consumeChatStream(stream(['data: {"error":{"message":"overloaded"}}\n']), () => undefined)).rejects.toMatchObject({ code: 'stream_error' });
    await expect(consumeChatStream(stream([`data: ${'x'.repeat(1024 * 1024 + 1)}`]), () => undefined)).rejects.toMatchObject({ code: 'stream_buffer_limit' });
    await expect(consumeChatStream(stream([`data: ${'界'.repeat(350_000)}`]), () => undefined)).rejects.toMatchObject({ code: 'stream_buffer_limit' });
  });

  it('sends auth headers and handles both JSON and model-list responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callLLM([{ role: 'user', content: 'hello' }], { apiKey: 'secret', baseUrl: 'https://example.test/v1', model: 'x' })).resolves.toMatchObject({ content: 'ok', usage: { total_tokens: 5 } });
    await expect(listModels('secret', 'https://example.test/v1')).resolves.toEqual(['model-a']);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://example.test/v1/chat/completions');
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer secret');
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

  it('classifies invalid JSON and model-list schemas as structured provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{broken', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 7 }] }), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('network unavailable')));
    await expect(callLLM([], { apiKey: 'key', baseUrl: 'https://api.test' })).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(listModels('key', 'https://api.test')).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(listModels('key', 'https://api.test')).rejects.toMatchObject({ code: 'network_error', retryable: true });
  });

  it('selects model context profiles and estimates mixed-language tokens conservatively', () => {
    expect(profileForModel('gpt-5.1').contextWindowTokens).toBe(1_000_000);
    expect(profileForModel('openai/gpt-5.1-mini').contextWindowTokens).toBe(1_000_000);
    expect(profileForModel('claude-4').contextWindowTokens).toBe(200_000);
    expect(profileForModel('deepseek-chat').contextWindowTokens).toBe(128_000);
    expect(profileForModel('private-model').contextWindowTokens).toBe(32_768);
    expect(profileForModel('private-gpt-5-compatible').contextWindowTokens).toBe(32_768);
    expect(estimateTextTokens('abcd')).toBe(1);
    expect(estimateTextTokens('中文')).toBe(2);
    expect(estimateTextTokens('かな한글')).toBe(4);
    expect(estimateTextTokens('😀😀')).toBe(2);
  });
});
