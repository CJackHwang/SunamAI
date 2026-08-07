import { describe, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
import { PiEventBridge, PiSession, buildConfigModel, piAssistantReasoning, piAssistantText, piAssistantToolCalls, piMessageToAppMessage, type PiAgentLike } from '@/features/agent-core/pi/piSession';
import { isPiEngineEnabled, setPiEngineEnabled } from '@/features/agent-core/pi/featureFlag';
import { STORAGE_KEYS } from '@/shared/lib/storage';
import { AgentEventStore } from '@/features/agent-core/eventStore';
import { V3PersistenceRepository } from '@/entities/persistence/v3Repository';
import { clearV3Database } from '../helpers/persistenceDatabase';
import type { AgentEvent, AgentRun } from '@/features/agent-core/types';
import { initialTask } from '@/features/agent-core/task';
import { createChaosContract } from '@/features/agent-core/prompt';

function usage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(overrides: Partial<Extract<PiAgentMessage, { role: 'assistant' }>> = {}): Extract<PiAgentMessage, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    api: 'anthropic-messages',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 1,
    ...overrides,
  };
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

describe('pi message conversion', () => {
  it('converts a pi user message with string content', () => {
    const message = piMessageToAppMessage({ role: 'user', content: 'hello', timestamp: 1 });
    expect(message).toEqual({ role: 'user', content: 'hello' });
  });

  it('converts a pi assistant message preserving text and reasoning', () => {
    const piMessage = assistantMessage({
      content: [{ type: 'thinking', thinking: 'reasoning draft' }, { type: 'text', text: 'Hello world' }],
    });
    const message = piMessageToAppMessage(piMessage);
    expect(message.role).toBe('assistant');
    expect(message.content).toBe('Hello world');
    expect(message.reasoning_content).toBe('reasoning draft');
  });

  it('converts a pi toolResult message into the app tool role', () => {
    const message = piMessageToAppMessage({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'run_command',
      content: [{ type: 'text', text: 'output' }],
      isError: false,
      timestamp: 1,
    });
    expect(message).toEqual({ role: 'tool', tool_call_id: 'call-1', name: 'run_command', content: 'output' });
  });

  it('extracts text and reasoning from content blocks', () => {
    const message = assistantMessage({
      content: [
        { type: 'text', text: 'a' },
        { type: 'thinking', thinking: 't' },
        { type: 'text', text: 'b' },
      ],
    });
    expect(piAssistantText(message)).toBe('ab');
    expect(piAssistantReasoning(message)).toBe('t');
  });

  it('converts a pi assistant message with a toolCall block into Message.tool_calls (R1)', () => {
    const piMessage = assistantMessage({
      content: [
        { type: 'thinking', thinking: 'I should inspect the workspace.' },
        { type: 'text', text: 'Let me check.' },
        { type: 'toolCall', id: 'call-1', name: 'workspace_tree', arguments: { max_depth: 2 } },
      ],
    });
    const message = piMessageToAppMessage(piMessage);
    expect(message.role).toBe('assistant');
    expect(message.content).toBe('Let me check.');
    expect(message.reasoning_content).toBe('I should inspect the workspace.');
    expect(message.tool_calls).toEqual([
      { id: 'call-1', type: 'function', function: { name: 'workspace_tree', arguments: '{"max_depth":2}' } },
    ]);
  });

  it('extracts multiple toolCall blocks into ToolCall[] preserving order', () => {
    const message = assistantMessage({
      content: [
        { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'a.ts' } },
        { type: 'toolCall', id: 'call-2', name: 'search_workspace', arguments: { query: 'foo' } },
      ],
    });
    expect(piAssistantToolCalls(message)).toEqual([
      { id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
      { id: 'call-2', type: 'function', function: { name: 'search_workspace', arguments: '{"query":"foo"}' } },
    ]);
  });

  it('does not attach tool_calls when the assistant message has no toolCall blocks', () => {
    const message = piMessageToAppMessage(assistantMessage({ content: [{ type: 'text', text: 'hi' }] }));
    expect(message.tool_calls).toBeUndefined();
  });
});

describe('PiEventBridge', () => {
  function makeBridge() {
    const run = createRun();
    const events: AgentEvent[] = [];
    const runChanges: AgentRun[] = [];
    const bridge = new PiEventBridge({
      runId: run.id,
      sessionId: run.sessionId,
      run,
      onEvent: (event) => events.push(event),
      onRunChange: (next) => runChanges.push(next),
    });
    return { bridge, events, runChanges, run };
  }

  it('subscribes to a streaming turn and settles with a completed run', () => {
    const { bridge, events, runChanges, run } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({ type: 'message_start', message: { role: 'user', content: 'hello', timestamp: 1 } });
    bridge.handlePiEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hel', partial: assistantMessage({ content: [{ type: 'text', text: 'Hel' }] }) },
      message: assistantMessage({ content: [{ type: 'text', text: 'Hel' }] }),
    });
    bridge.handlePiEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'lo', partial: assistantMessage({ content: [{ type: 'text', text: 'Hello' }] }) },
      message: assistantMessage({ content: [{ type: 'text', text: 'Hello' }] }),
    });
    bridge.handlePiEvent({ type: 'message_end', message: assistantMessage({ content: [{ type: 'text', text: 'Hello' }] }) });
    bridge.handlePiEvent({ type: 'turn_end', message: assistantMessage({ content: [{ type: 'text', text: 'Hello' }] }), toolResults: [] });
    bridge.handlePiEvent({ type: 'agent_end', messages: [assistantMessage({ content: [{ type: 'text', text: 'Hello' }] })] });

    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain('run_started');
    expect(kinds).toContain('message');
    expect(kinds).toContain('assistant_delta');
    expect(kinds).toContain('run_finished');

    // 用户消息与最终 assistant 消息都进入 UI 消息模型。
    const messages = events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message');
    expect(messages.at(0)?.message).toEqual({ role: 'user', content: 'hello' });
    expect(messages.at(1)?.message.role).toBe('assistant');
    expect(messages.at(1)?.message.content).toBe('Hello');

    // 流式 delta 累积 + 打字机 streamId 与持久消息一致。
    const deltas = events.filter((event): event is Extract<AgentEvent, { kind: 'assistant_delta' }> => event.kind === 'assistant_delta');
    expect(deltas.map((delta) => delta.content)).toEqual(['Hel', 'Hello']);
    expect(deltas.every((delta) => delta.transient)).toBe(true);
    expect(messages.at(1)?.streamId).toBe(deltas.at(0)?.streamId);

    // 运行结束：phase completed + run_finished summary 取 assistant 正文。
    expect(run.phase).toBe('completed');
    expect(runChanges.at(-1)?.phase).toBe('completed');
    expect(events.at(-1)).toMatchObject({ kind: 'run_finished', summary: 'Hello' });
  });

  it('marks the run cancelled and emits run_finished on abort', () => {
    const { bridge, events, run } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({ type: 'message_end', message: assistantMessage({ stopReason: 'aborted', errorMessage: 'aborted' }) });
    bridge.handlePiEvent({ type: 'agent_end', messages: [assistantMessage({ stopReason: 'aborted' })] });

    expect(run.phase).toBe('cancelled');
    const terminal = events.at(-1);
    expect(terminal).toMatchObject({ kind: 'run_finished', summary: 'Agent stopped by user.' });
  });

  it('marks the run failed and emits run_failed on error', () => {
    const { bridge, events, run } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({ type: 'message_end', message: assistantMessage({ stopReason: 'error', errorMessage: 'boom' }) });
    bridge.handlePiEvent({ type: 'agent_end', messages: [assistantMessage({ stopReason: 'error' })] });

    expect(run.phase).toBe('failed');
    expect(events.at(-1)).toMatchObject({ kind: 'run_failed', error: 'boom', recoverable: false });
  });

  it('bridges tool_execution_start/end into tool_started/tool_finished events (R1)', () => {
    const { bridge, events, run } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'report_progress',
      args: { message: 'step 1' },
    });
    bridge.handlePiEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'report_progress',
      result: { content: [{ type: 'text', text: 'step 1' }], details: { progress: 'step 1' } },
      isError: false,
    });
    bridge.handlePiEvent({ type: 'message_end', message: assistantMessage({ content: [{ type: 'text', text: 'done' }] }) });
    bridge.handlePiEvent({ type: 'turn_end', message: assistantMessage({ content: [{ type: 'text', text: 'done' }] }), toolResults: [] });
    bridge.handlePiEvent({ type: 'agent_end', messages: [assistantMessage({ content: [{ type: 'text', text: 'done' }] })] });

    const expectedToolCall = { id: 'call-1', type: 'function' as const, function: { name: 'report_progress', arguments: '{"message":"step 1"}' } };
    const started = events.find((event): event is Extract<AgentEvent, { kind: 'tool_started' }> => event.kind === 'tool_started');
    expect(started?.toolCall).toEqual(expectedToolCall);
    const finished = events.find((event): event is Extract<AgentEvent, { kind: 'tool_finished' }> => event.kind === 'tool_finished');
    expect(finished?.toolCall).toEqual(expectedToolCall);
    expect(finished?.result).toEqual({ ok: true, content: 'step 1', data: { progress: 'step 1' } });

    // usage 统计真实化：tool_execution_end 累计后随 agent_end 同步到 run.toolCalls。
    expect(run.toolCalls).toBe(1);
  });

  it('marks tool_finished result as failed when the tool errors', () => {
    const { bridge, events } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({ type: 'tool_execution_start', toolCallId: 'call-2', toolName: 'run_command', args: { command: 'ls' } });
    bridge.handlePiEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-2',
      toolName: 'run_command',
      result: { content: [{ type: 'text', text: 'boom' }] },
      isError: true,
    });
    const finished = events.find((event): event is Extract<AgentEvent, { kind: 'tool_finished' }> => event.kind === 'tool_finished');
    expect(finished?.result.ok).toBe(false);
    expect(finished?.result.content).toBe('boom');
  });

  it('bridges a pi toolResult message into a role:tool message event (R3)', () => {
    const { bridge, events } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'report_progress',
        content: [{ type: 'text', text: 'step 1' }],
        isError: false,
        timestamp: 1,
      },
    });
    const toolMessage = events.find((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'tool');
    expect(toolMessage?.message).toEqual({ role: 'tool', tool_call_id: 'call-1', name: 'report_progress', content: 'step 1' });
    expect(toolMessage?.streamId).toBe('r1:tool-call-1');
  });

  it('includes toolCalls in the streaming assistant_delta when the partial message has toolCall blocks (R1)', () => {
    const { bridge, events } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: { type: 'toolCall', id: 'call-1', name: 'report_progress', arguments: { message: 'step 1' } },
        partial: assistantMessage(),
      },
      message: assistantMessage({
        content: [
          { type: 'text', text: 'working' },
          { type: 'toolCall', id: 'call-1', name: 'report_progress', arguments: { message: 'step 1' } },
        ],
      }),
    });
    const deltas = events.filter((event): event is Extract<AgentEvent, { kind: 'assistant_delta' }> => event.kind === 'assistant_delta');
    expect(deltas.at(0)?.content).toBe('working');
    expect(deltas.at(0)?.toolCalls).toEqual([
      { id: 'call-1', type: 'function', function: { name: 'report_progress', arguments: '{"message":"step 1"}' } },
    ]);
    expect(deltas.every((delta) => delta.transient)).toBe(true);
  });
});

class FakePiAgent implements PiAgentLike {
  listener: ((event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>) | null = null;
  readonly promptInputs: Array<string | PiAgentMessage> = [];
  abortCalls = 0;
  private readonly controller = new AbortController();

  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  async prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void> {
    this.promptInputs.push(typeof input === 'string' ? input : input as PiAgentMessage);
  }

  abort(): void { this.abortCalls += 1; this.controller.abort(); }

  waitForIdle(): Promise<void> { return Promise.resolve(); }

  async emit(event: PiAgentEvent): Promise<void> {
    await this.listener?.(event, this.controller.signal);
  }
}

describe('PiSession lifecycle', () => {
  it('forwards prompt() to the pi agent and subscribes to its events', async () => {
    const agent = new FakePiAgent();
    const events: AgentEvent[] = [];
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun(),
      onEvent: (event) => events.push(event),
      onRunChange: () => undefined,
      createAgent: () => agent,
    });
    await session.prompt('hello');
    expect(agent.promptInputs).toHaveLength(1);
    expect(agent.promptInputs[0]).toMatchObject({ role: 'user', content: 'hello' });
    expect(agent.listener).not.toBeNull();

    await agent.emit({ type: 'agent_start' });
    await agent.emit({ type: 'message_end', message: assistantMessage({ content: [{ type: 'text', text: 'hi' }] }) });
    await agent.emit({ type: 'agent_end', messages: [assistantMessage({ content: [{ type: 'text', text: 'hi' }] })] });
    expect(events.some((event) => event.kind === 'run_started')).toBe(true);
    expect(events.some((event) => event.kind === 'run_finished')).toBe(true);
  });

  it('aborts the pi agent when the external signal aborts', async () => {
    const agent = new FakePiAgent();
    const controller = new AbortController();
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun(),
      signal: controller.signal,
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => agent,
    });
    controller.abort();
    expect(agent.abortCalls).toBe(1);
    session.destroy();
  });

  it('destroy() unsubscribes and aborts the pi agent', async () => {
    const agent = new FakePiAgent();
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun(),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => agent,
    });
    session.destroy();
    expect(agent.abortCalls).toBe(1);
    expect(agent.listener).toBeNull();
    // 销毁后 prompt 不再向底层 agent 发送。
    await session.prompt('ignored');
    expect(agent.promptInputs).toEqual([]);
  });

  it('settles as cancelled when the external signal aborts before the run starts', async () => {
    const agent = new FakePiAgent();
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const run = createRun();
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
      onRunChange: () => undefined,
      createAgent: () => agent,
    });
    controller.abort();
    await session.prompt('hello');
    expect(agent.promptInputs).toEqual([]);
    expect(run.phase).toBe('cancelled');
    expect(events.some((event) => event.kind === 'run_finished')).toBe(true);
  });

  it('persists pi bridge events and run state to the v3 event store (P2-M1 refresh restore)', async () => {
    const repository = new V3PersistenceRepository();
    await clearV3Database();
    const store = new AgentEventStore(repository);
    const agent = new FakePiAgent();
    const run = createRun();
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: run.sessionId,
      runId: run.id,
      run,
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => agent,
      store,
    });
    await session.prompt('hello');
    await agent.emit({ type: 'agent_start' });
    await agent.emit({ type: 'message_start', message: { role: 'user', content: 'hello', timestamp: Date.now() } });
    await agent.emit({ type: 'message_end', message: assistantMessage({ content: [{ type: 'text', text: 'hi' }] }) });
    await agent.emit({ type: 'agent_end', messages: [assistantMessage({ content: [{ type: 'text', text: 'hi' }] })] });

    await vi.waitFor(async () => {
      const persisted = await store.loadSessionEvents(run.sessionId);
      const messages = persisted.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message');
      expect(messages.some((event) => event.message.role === 'user' && event.message.content === 'hello')).toBe(true);
      expect(messages.some((event) => event.message.role === 'assistant' && event.message.content === 'hi')).toBe(true);
    });
    const runs = await store.loadSessionRuns(run.sessionId);
    expect(runs.find((candidate) => candidate.id === run.id)?.phase).toBe('completed');
    session.destroy();
  });
});

describe('PiSession attachments (R1)', () => {
  it('embeds an image attachment as pi image content alongside the text prompt and resource manifest', async () => {
    await clearV3Database();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })));
    try {
      const agent = new FakePiAgent();
      const session = new PiSession({
        apiKey: 'test-key',
        baseUrl: 'https://api.deepseek.com/v1',
        apiModel: 'deepseek-v4-flash',
        sessionId: 's1',
        runId: 'r1',
        run: createRun(),
        onEvent: () => undefined,
        onRunChange: () => undefined,
        createAgent: () => agent,
      });
      const png = new NodeFile([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], 'diagram.png', { type: 'image/png' }) as unknown as File;
      await session.prompt('看图', [{ name: png.name, size: png.size, type: png.type, file: png }]);

      const input = agent.promptInputs[0] as Extract<PiAgentMessage, { role: 'user' }>;
      expect(input.role).toBe('user');
      expect(Array.isArray(input.content)).toBe(true);
      const content = input.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      const text = content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('');
      expect(text).toContain('看图');
      expect(text).toContain('Attached resources');
      expect(text).toContain('diagram.png');
      const images = content.filter((part) => part.type === 'image');
      expect(images).toHaveLength(1);
      const image = images[0];
      expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
      expect(typeof image?.data).toBe('string');
      expect(image?.data?.length ?? 0).toBeGreaterThan(0);
      session.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a plain prompt as string user content when no attachments are supplied', async () => {
    await clearV3Database();
    const agent = new FakePiAgent();
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun(),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => agent,
    });
    await session.prompt('hello');
    expect(agent.promptInputs[0]).toMatchObject({ role: 'user', content: 'hello' });
    session.destroy();
  });
});

describe('pi config model (R2 localhost/port address fix)', () => {
  it('normalizes trailing slashes and preserves image input on the configured model', () => {
    const model = buildConfigModel('mock-model-a', 'http://127.0.0.1:11434/v1/', 'localhost');
    expect(model.id).toBe('mock-model-a');
    expect(model.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(model.api).toBe('openai-completions');
    expect(model.input).toContain('image');
  });

  it('suppresses the OpenAI SDK X-Stainless-* telemetry headers so local/port endpoints pass CORS preflight', () => {
    const model = buildConfigModel('mock-model-a', 'http://localhost:11434/v1', 'localhost');
    const stainless = Object.keys(model.headers ?? {}).filter((key) => key.toLowerCase().startsWith('x-stainless'));
    // Every stainless header the OpenAI client injects by default must be cleared (null).
    expect(stainless).toContain('X-Stainless-OS');
    expect(stainless).toContain('X-Stainless-Lang');
    expect(stainless).toContain('X-Stainless-Runtime');
    for (const key of stainless) expect(model.headers?.[key]).toBeNull();
    // 常规请求头不受影响（真实网关不依赖遥测头，移除无害）。
    expect(model.headers?.['X-Stainless-OS']).toBeNull();
  });

  it('routes anthropic channels to the anthropic-messages api without stainless suppression', () => {
    const model = buildConfigModel('claude-sonnet-4-5', 'https://api.anthropic.com', 'anthropic', 'anthropic-messages');
    expect(model.api).toBe('anthropic-messages');
    expect(model.headers).toBeUndefined();
  });

  it('carries persona sampling params onto the configured model', () => {
    const model = buildConfigModel('mock-model-a', 'http://127.0.0.1:11434/v1', 'localhost', 'openai-completions', { temperature: 0.2, top_p: 0.9, max_tokens: 2048 });
    expect(model.samplingParams).toEqual({ temperature: 0.2, top_p: 0.9, max_tokens: 2048 });
  });
});

describe('pi engine feature flag', () => {
  it('defaults to on (pi is the default engine) with localStorage as an escape hatch', () => {
    localStorage.removeItem(STORAGE_KEYS.piEngine);
    expect(isPiEngineEnabled()).toBe(true);
    setPiEngineEnabled(false);
    expect(isPiEngineEnabled()).toBe(false);
    setPiEngineEnabled(true);
    expect(isPiEngineEnabled()).toBe(true);
    // 逃生门：显式 '0' 关闭；非 '0'/未设置回到默认开。
    localStorage.setItem(STORAGE_KEYS.piEngine, '0');
    expect(isPiEngineEnabled()).toBe(false);
    localStorage.setItem(STORAGE_KEYS.piEngine, '1');
    expect(isPiEngineEnabled()).toBe(true);
    localStorage.removeItem(STORAGE_KEYS.piEngine);
    expect(isPiEngineEnabled()).toBe(true);
  });
});
