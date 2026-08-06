import { describe, expect, it } from 'vitest';
import { PiSession } from '@/features/agent-core/pi/piSession';
import type { AgentEvent, AgentRun } from '@/features/agent-core/types';
import { initialTask } from '@/features/agent-core/task';
import { createChaosContract } from '@/features/agent-core/prompt';

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function createRun(sessionId = 's1', runId = 'r1'): AgentRun {
  const now = Date.now();
  return {
    id: runId,
    sessionId,
    containerId: 'c1',
    model: 'deepseek-v4-flash',
    persona: 'Sunam 6.9 Pron',
    phase: 'preparing',
    createdAt: now,
    updatedAt: now,
    task: initialTask('hello'),
    chaos: createChaosContract('Sunam 6.9 Pron'),
    budget: { maxModelTurns: 1, maxToolCalls: 0, maxDurationMs: 5 * 60_000 },
    modelTurns: 0,
    toolCalls: 0,
    summary: '',
    rootRunId: runId,
    agentRole: 'root',
    depth: 0,
    toolPolicy: { role: 'root', allowedTools: [] },
  };
}

describe('pi real agent over mocked OpenAI-compatible SSE', () => {
  it('streams a deepseek-compatible response into the app message model', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => sseResponse([
      'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello from "},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"pi"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch;

    try {
      const run = createRun();
      const events: AgentEvent[] = [];
      const session = new PiSession({
        apiKey: 'test-key',
        baseUrl: 'https://api.deepseek.com/v1',
        apiModel: 'deepseek-v4-flash',
        sessionId: 's1',
        runId: 'r1',
        run,
        onEvent: (event) => events.push(event),
        onRunChange: () => undefined,
      });
      await session.prompt('hello');

      const deltas = events.filter((event): event is Extract<AgentEvent, { kind: 'assistant_delta' }> => event.kind === 'assistant_delta');
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.every((delta) => delta.transient)).toBe(true);
      // SDK 以累积 partial 逐事件上报，最后一个 delta 应为完整回复。
      expect(deltas.at(-1)?.content).toBe('Hello from pi');
      const messages = events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message');
      expect(messages.some((message) => message.message.role === 'assistant' && message.message.content === 'Hello from pi')).toBe(true);
      expect(events.some((event) => event.kind === 'run_finished')).toBe(true);
      expect(run.phase).toBe('completed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15_000);
});
