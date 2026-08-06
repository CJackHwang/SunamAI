import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
import { PiEventBridge, PiSession, piAssistantReasoning, piAssistantText, piMessageToAppMessage, type PiAgentLike } from '@/features/agent-core/pi/piSession';
import { isPiEngineEnabled, setPiEngineEnabled } from '@/features/agent-core/pi/featureFlag';
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
});

class FakePiAgent implements PiAgentLike {
  listener: ((event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>) | null = null;
  readonly promptInputs: string[] = [];
  abortCalls = 0;
  private readonly controller = new AbortController();

  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  async prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void> {
    this.promptInputs.push(typeof input === 'string' ? input : JSON.stringify(input));
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
    expect(agent.promptInputs).toEqual(['hello']);
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

describe('pi engine feature flag', () => {
  it('defaults to off and toggles through the stored flag', () => {
    setPiEngineEnabled(false);
    expect(isPiEngineEnabled()).toBe(false);
    setPiEngineEnabled(true);
    expect(isPiEngineEnabled()).toBe(true);
    setPiEngineEnabled(false);
  });
});
