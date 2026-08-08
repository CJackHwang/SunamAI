import { afterEach, describe, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage, CompactionSettings } from '@earendil-works/pi-agent-core';
import { PiEventBridge, PiSession, buildConfigModel, piAssistantReasoning, piAssistantText, piAssistantToolCalls, piMessageToAppMessage, type PiAgentLike } from '@/features/agent-core/pi/piSession';
import { IndexedDbSessionRepo, deleteIndexedDb } from '@/features/agent-core/pi/indexedDbSessionStorage';
import type { PiCompactionRunner } from '@/features/agent-core/pi/piCompaction';
import type { PiSubagentCoordinatorOptions } from '@/features/agent-core/pi/piSubagentCoordinator';
import type { SubagentHost } from '@/features/agent-core/tools/base';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
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

/** 每个测试用独立库名，避免 fake-indexeddb 在同文件内跨测试串扰（对齐 piCompaction.test.ts）。 */
const createdDatabases = new Set<string>();
function trackDb(dbName: string): string {
  createdDatabases.add(dbName);
  return dbName;
}

afterEach(async () => {
  for (const dbName of createdDatabases) await deleteIndexedDb(dbName);
  createdDatabases.clear();
});

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

  it('projects a steered user message and ignores non-user messages (P5 emitUserGuidance)', () => {
    const { bridge, events } = makeBridge();
    const steered: PiAgentMessage = { role: 'user', content: 'steer me', timestamp: 1 };
    bridge.emitUserGuidance(steered);
    // 非 user 消息不投影（也不进 steeredMessages Set）。
    bridge.emitUserGuidance(assistantMessage({ content: [{ type: 'text', text: 'nope' }] }));
    const userMessages = events.filter(
      (event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'user',
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.message).toEqual({ role: 'user', content: 'steer me' });
    // agent 注入同一引用时按引用去重（steeredMessages Set 命中 → 跳过，不双显）。
    bridge.handlePiEvent({ type: 'message_start', message: steered });
    expect(events.filter((event) => event.kind === 'message' && event.message.role === 'user')).toHaveLength(1);
  });

  it('emits a non-transient context_compacted event with summary and token stats (P5 emitCompacted)', () => {
    const { bridge, events } = makeBridge();
    bridge.emitCompacted({ summary: '## Goal\nShip it.', beforeTokens: 10_000, afterTokens: 1_200 });
    const compacted = events.find((event): event is Extract<AgentEvent, { kind: 'context_compacted' }> => event.kind === 'context_compacted');
    expect(compacted).toMatchObject({
      summary: '## Goal\nShip it.',
      fallback: false,
      beforeTokens: 10_000,
      afterTokens: 1_200,
    });
    expect(compacted?.transient).toBeUndefined();
  });

  it('renders a multimodal user message (array content) into the app message model', () => {
    const { bridge, events } = makeBridge();
    bridge.handlePiEvent({
      type: 'message_start',
      message: { role: 'user', content: [{ type: 'text', text: 'look at this' }, { type: 'image', data: 'data', mimeType: 'image/png' }], timestamp: 1 },
    });
    const userMessage = events.find(
      (event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'user',
    );
    expect(userMessage?.message).toEqual({ role: 'user', content: 'look at this' });
  });

  it('carries attachment metadata onto the projected user message (R1 UI chips)', () => {
    const run = createRun();
    const events: AgentEvent[] = [];
    const bridge = new PiEventBridge({
      runId: run.id,
      sessionId: run.sessionId,
      run,
      onEvent: (event) => events.push(event),
      onRunChange: () => undefined,
      getUserAttachments: () => [{ name: 'a.png', size: 1, type: 'image/png', resourceId: 'r1' }],
    });
    bridge.handlePiEvent({ type: 'message_start', message: { role: 'user', content: 'look', timestamp: 1 } });
    const userMessage = events.find(
      (event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'user',
    );
    expect(userMessage?.message).toMatchObject({
      role: 'user',
      content: 'look',
      _ui_displayContent: 'look',
      _ui_attachments: [{ name: 'a.png', size: 1, type: 'image/png', resourceId: 'r1' }],
    });
  });

  it('settles a completed run when complete_task carries a stopRun terminal marker (R6)', () => {
    const { bridge, events, run } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({ type: 'tool_execution_start', toolCallId: 'call-9', toolName: 'complete_task', args: { finalSummary: 'done' } });
    bridge.handlePiEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-9',
      toolName: 'complete_task',
      result: { content: [{ type: 'text', text: 'summary' }], details: { stopRun: 'completed', finalSummary: 'All done.' } },
      isError: false,
    });
    bridge.handlePiEvent({ type: 'message_end', message: assistantMessage({ content: [{ type: 'text', text: 'summary' }] }) });
    bridge.handlePiEvent({ type: 'turn_end', message: assistantMessage(), toolResults: [] });
    bridge.handlePiEvent({ type: 'agent_end', messages: [assistantMessage({ content: [{ type: 'text', text: 'summary' }] })] });

    // complete_task 补发最终 assistant 消息并结算 completed。
    const finals = events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'assistant');
    expect(finals.some((event) => event.message.content === 'All done.')).toBe(true);
    expect(run.finalSummary).toBe('All done.');
    expect(run.phase).toBe('completed');
    expect(events.at(-1)).toMatchObject({ kind: 'run_finished' });
  });

  it('keeps the run awaiting_parent when ask_parent carries a stopRun marker (R6)', () => {
    const { bridge, events, run, runChanges } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({ type: 'tool_execution_start', toolCallId: 'call-8', toolName: 'ask_parent', args: { question: 'which path?' } });
    bridge.handlePiEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-8',
      toolName: 'ask_parent',
      result: { content: [{ type: 'text', text: 'which path?' }], details: { stopRun: 'awaiting_parent' } },
      isError: false,
    });
    bridge.handlePiEvent({ type: 'message_end', message: assistantMessage({ content: [{ type: 'text', text: 'which path?' }] }) });
    bridge.handlePiEvent({ type: 'turn_end', message: assistantMessage(), toolResults: [] });
    bridge.handlePiEvent({ type: 'agent_end', messages: [assistantMessage({ content: [{ type: 'text', text: 'which path?' }] })] });

    // ask_parent 阻塞：问题文本作为 assistant 消息发出，run 保持 awaiting_parent（不结算终态）。
    const finals = events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'assistant');
    expect(finals.some((event) => event.message.content === 'which path?')).toBe(true);
    expect(run.phase).toBe('awaiting_parent');
    expect(runChanges.at(-1)?.phase).toBe('awaiting_parent');
    expect(events.some((event) => event.kind === 'run_finished')).toBe(false);
  });

  it('falls back to a Done summary when the final run has no assistant message', () => {
    const { bridge, events, run } = makeBridge();
    bridge.handlePiEvent({ type: 'agent_start' });
    bridge.handlePiEvent({ type: 'agent_end', messages: [] });
    expect(run.phase).toBe('completed');
    expect(events.at(-1)).toMatchObject({ kind: 'run_finished', summary: 'Done.' });
  });
});

class FakePiAgent implements PiAgentLike {
  listener: ((event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>) | null = null;
  readonly promptInputs: Array<string | PiAgentMessage> = [];
  abortCalls = 0;
  /** P5：记录 steer 注入的 user 消息（正文 + 原始引用，供桥接去重断言）。 */
  readonly steered: string[] = [];
  readonly steeredMessages: PiAgentMessage[] = [];
  /** P5：记录 seedHistory 注入的上下文（压缩重建断言）。 */
  seededHistory: PiAgentMessage[] | null = null;
  private readonly controller = new AbortController();

  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  async prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void> {
    this.promptInputs.push(typeof input === 'string' ? input : input as PiAgentMessage);
  }

  steer(message: PiAgentMessage): void {
    const content = 'content' in message && typeof message.content === 'string' ? message.content : '';
    this.steered.push(content);
    this.steeredMessages.push(message);
  }

  seedHistory(messages: PiAgentMessage[]): void { this.seededHistory = messages; }

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

  it('settles an error-ending run as cancelled when the external signal aborts mid-run (abort race)', async () => {
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
    await agent.emit({ type: 'agent_start' });
    // 工具执行中被中止 → 下一轮 LLM 以 abort 错误收尾（stopReason error），但信号已 aborted → 映射为 cancelled。
    await agent.emit({ type: 'message_end', message: assistantMessage({ stopReason: 'error', errorMessage: 'aborted mid-tool' }) });
    await agent.emit({ type: 'agent_end', messages: [assistantMessage({ stopReason: 'error', errorMessage: 'aborted mid-tool' })] });

    expect(run.phase).toBe('cancelled');
    expect(events.some((event) => event.kind === 'run_finished')).toBe(true);
    session.destroy();
  });

  it('settles an error-ending run as failed when the external signal is not aborted', async () => {
    const agent = new FakePiAgent();
    const events: AgentEvent[] = [];
    const run = createRun();
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run,
      onEvent: (event) => events.push(event),
      onRunChange: () => undefined,
      createAgent: () => agent,
    });
    await agent.emit({ type: 'agent_start' });
    await agent.emit({ type: 'message_end', message: assistantMessage({ stopReason: 'error', errorMessage: 'boom' }) });
    await agent.emit({ type: 'agent_end', messages: [assistantMessage({ stopReason: 'error', errorMessage: 'boom' })] });

    expect(run.phase).toBe('failed');
    expect(events.at(-1)).toMatchObject({ kind: 'run_failed', error: 'boom', recoverable: false });
    session.destroy();
  });

  it('settles as cancelled when the external signal aborts during pre-prompt compaction', async () => {
    const dbName = trackDb('pi-sessions-abort-during-compaction');
    const repo = new IndexedDbSessionRepo(dbName);
    const session = await repo.create({ id: 's1' });
    await session.appendMessage({ role: 'user', content: 'x'.repeat(400), timestamp: 1 });
    await session.appendMessage(assistantMessage({ content: [{ type: 'text', text: 'y'.repeat(400) }] }));

    const agent = new FakePiAgent();
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const run = createRun();
    const runner: PiCompactionRunner = async (preparation) => {
      // 压缩（LLM 摘要）期间外部信号中止 → prompt 第二道中止检查命中。
      controller.abort();
      return { summary: '## Goal', tokensBefore: preparation.tokensBefore, retainedTail: preparation.retainedTail };
    };
    const piSession = new PiSession({
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
      createSessionRepo: () => new IndexedDbSessionRepo(dbName),
      compactionSettings: { enabled: true, reserveTokens: 1_000_000, keepRecentTokens: 40 },
      compactionRunner: runner,
    });
    await piSession.prompt('hello');
    expect(agent.promptInputs).toEqual([]);
    expect(run.phase).toBe('cancelled');
    expect(events.some((event) => event.kind === 'run_finished')).toBe(true);
    piSession.destroy();
  });

  it('saves a checkpoint with workspace revision on turn_end when a runtime is available (P2/R6)', async () => {
    const repository = new V3PersistenceRepository();
    await clearV3Database();
    const store = new AgentEventStore(repository);
    const agent = new FakePiAgent();
    const run = createRun();
    const runtime = { getWorkspaceRevision: async () => 42 } as unknown as AgentWorkspaceRuntime;
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
      runtime,
      createCoordinator: () => ({
        spawn: async () => { throw new Error('not used'); },
        wait: async () => [],
        message: async () => false,
        stop: async () => false,
        stopAll: async () => undefined,
        snapshot: () => [],
      }) as SubagentHost,
    });
    await session.prompt('hello');
    await agent.emit({ type: 'agent_start' });
    await agent.emit({ type: 'message_end', message: assistantMessage({ content: [{ type: 'text', text: 'hi' }] }) });
    await agent.emit({ type: 'turn_end', message: assistantMessage(), toolResults: [] });
    await agent.emit({ type: 'agent_end', messages: [assistantMessage({ content: [{ type: 'text', text: 'hi' }] })] });

    await vi.waitFor(async () => {
      const checkpoint = await store.latestCheckpoint(run.id);
      expect(checkpoint?.workspaceRevision).toBe(42);
      expect(checkpoint?.eventTailSequence).toBeGreaterThan(0);
    });
    session.destroy();
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

describe('PiSession steer (P4/P5 user guidance)', () => {
  function makeSteerableSession() {
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
    return { agent, events, session };
  }

  it('steers a user message into the agent and projects it to the UI immediately', () => {
    const { agent, events, session } = makeSteerableSession();
    const ok = session.steer('continue please');
    expect(ok).toBe(true);
    // agent 收到同一 steer 消息（pi Agent.steer 队列，当前 turn 后注入）。
    expect(agent.steered).toEqual(['continue please']);
    // UI 即时出现用户消息（对齐旧引擎 enqueueUserGuidance 投影语义）。
    const userMessage = events.find(
      (event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'user',
    );
    expect(userMessage?.message).toEqual({ role: 'user', content: 'continue please' });
    session.destroy();
  });

  it('deduplicates the steered user message when the agent injects the same reference', async () => {
    const { agent, events, session } = makeSteerableSession();
    session.steer('continue please');
    const userMessages = () => events.filter(
      (event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'user',
    );
    expect(userMessages()).toHaveLength(1);
    // agent 下一轮注入同一 steer 消息引用（pi Agent 回放 steering 队列）。
    const steered = agent.steeredMessages[0]!;
    await agent.emit({ type: 'message_start', message: steered });
    // 不双显：steeredMessages Set 命中 → bridge 跳过重复 user 消息。
    expect(userMessages()).toHaveLength(1);
    session.destroy();
  });

  it('returns false after destroy and does not forward the message', () => {
    const { agent, session } = makeSteerableSession();
    session.destroy();
    expect(session.steer('too late')).toBe(false);
    expect(agent.steered).toEqual([]);
  });

  it('returns false when the external signal is already aborted', () => {
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
    expect(session.steer('ignored')).toBe(false);
    expect(agent.steered).toEqual([]);
    session.destroy();
  });
});

describe('PiSession subagent coordinator wiring (P4)', () => {
  function makeCoordinatorHost() {
    const runIds: string[][] = [];
    const captured: PiSubagentCoordinatorOptions[] = [];
    const host: SubagentHost = {
      spawn: vi.fn(async () => {
        captured[0]?.onChildrenPruned?.(['child-1']);
        return { runId: 'child-1', taskId: 't1', status: 'completed' };
      }),
      wait: vi.fn(async () => []),
      message: vi.fn(async () => true),
      stop: vi.fn(async () => true),
      stopAll: vi.fn(async () => undefined),
      snapshot: () => [],
    };
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun(),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => new FakePiAgent(),
      createCoordinator: (deps) => {
        captured.push(deps);
        return host;
      },
      onChildrenPruned: (ids) => runIds.push(ids),
    });
    return { host, captured, runIds, session };
  }

  it('forwards onChildrenPruned into the coordinator options and fires it when the coordinator prunes', async () => {
    const { host, captured, runIds, session } = makeCoordinatorHost();
    // 接线：createCoordinator 收到的依赖里带 onChildrenPruned（用户回调）。
    expect(captured[0]?.onChildrenPruned).toBeDefined();
    // 真实链路：协调器 spawn 时按 prune 结果调用 onChildrenPruned → 通知 UI 移除子 run 行。
    await host.spawn({ taskId: 't1', role: 'explore', prompt: 'find facts' });
    expect(runIds).toEqual([['child-1']]);
    session.destroy();
  });
});

describe('PiSession compaction events (P5)', () => {
  async function seedSession(dbName: string, rounds: number): Promise<void> {
    const repo = new IndexedDbSessionRepo(dbName);
    const session = await repo.create({ id: 's1' });
    for (let i = 1; i <= rounds; i += 1) {
      await session.appendMessage({ role: 'user', content: `User message ${i} with enough content to estimate tokens accurately.`, timestamp: i });
      await session.appendMessage(assistantMessage({ content: [{ type: 'text', text: `Assistant reply ${i} continuing the conversation with detail.` }] }));
    }
  }

  const forcedSettings: CompactionSettings = { enabled: true, reserveTokens: 1_000_000, keepRecentTokens: 40 };

  it('emits a context_compacted event with before/after token stats after a prompt-triggered compaction', async () => {
    const dbName = trackDb('pi-sessions-context-compacted');
    await seedSession(dbName, 4);
    const events: AgentEvent[] = [];
    const agent = new FakePiAgent();
    const runner: PiCompactionRunner = async (preparation) => ({
      summary: '## Goal\nShip it.',
      tokensBefore: preparation.tokensBefore,
      retainedTail: preparation.retainedTail,
      details: { kept: 4 },
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    });
    const piSession = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun('s1', 'r1'),
      onEvent: (event) => events.push(event),
      onRunChange: () => undefined,
      createAgent: () => agent,
      createSessionRepo: () => new IndexedDbSessionRepo(dbName),
      compactionSettings: forcedSettings,
      compactionRunner: runner,
    });
    await piSession.prompt('continue the work');

    // 非 transient 的 context_compacted 进 v3 事件流（RunBoard 渲染 before → after tokens）。
    const compacted = events.find((event): event is Extract<AgentEvent, { kind: 'context_compacted' }> => event.kind === 'context_compacted');
    expect(compacted).toBeDefined();
    expect(compacted!.summary).toContain('## Goal');
    expect(compacted!.fallback).toBe(false);
    expect(compacted!.beforeTokens).toBeGreaterThan(0);
    expect(compacted!.afterTokens).toBeGreaterThan(0);
    expect(compacted!.afterTokens).toBeLessThanOrEqual(compacted!.beforeTokens!);
    // transient 状态事件括起压缩过程。
    const statuses = events.filter((event): event is Extract<AgentEvent, { kind: 'context_compaction_status' }> => event.kind === 'context_compaction_status');
    expect(statuses.some((event) => event.active)).toBe(true);
    expect(statuses.some((event) => !event.active)).toBe(true);

    // 压缩 entry 携带 details/usage（覆盖 runCompaction 的条件分支）。
    const reopened = await new IndexedDbSessionRepo(dbName).open({ id: 's1', createdAt: 0 });
    const compactionEntries = (await reopened.findEntries({ type: 'compaction', order: 'oldestFirst' })).filter(
      (entry): entry is Extract<typeof entry, { type: 'compaction' }> => entry.type === 'compaction',
    );
    expect(compactionEntries.length).toBe(1);
    expect(compactionEntries[0]!.details).toEqual({ kept: 4 });
    expect(compactionEntries[0]!.usage).toBeDefined();
    piSession.destroy();
  });

  it('runs compaction through the prepareNextTurn callback (agent-loop compaction)', async () => {
    const dbName = trackDb('pi-sessions-prepare-next-turn');
    await seedSession(dbName, 4);
    const events: AgentEvent[] = [];
    const agent = new FakePiAgent();
    let capturedPrepareNextTurn: (() => Promise<PiAgentMessage[] | undefined>) | undefined;
    const runner: PiCompactionRunner = async (preparation) => ({
      summary: '## Goal\nShip it.',
      tokensBefore: preparation.tokensBefore,
      retainedTail: preparation.retainedTail,
    });
    const piSession = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun('s1', 'r1'),
      onEvent: (event) => events.push(event),
      onRunChange: () => undefined,
      createAgent: (opts) => {
        capturedPrepareNextTurn = opts.prepareNextTurn;
        return agent;
      },
      createSessionRepo: () => new IndexedDbSessionRepo(dbName),
      compactionSettings: forcedSettings,
      compactionRunner: runner,
    });
    // 先让 initialize 完成（this.session 就绪），再直接调用 prepareNextTurn 回调。
    await piSession.prompt('seed the session');
    const compacted = await capturedPrepareNextTurn!();
    expect(compacted).toBeDefined();
    expect(compacted![0]?.role).toBe('compactionSummary');
    // 压缩上下文重建为「摘要 + 保留尾」并注入 agent 转录。
    expect(agent.seededHistory).toEqual(compacted);
    expect(piSession.lastCompactionStats).toBeDefined();
    expect(events.some((event) => event.kind === 'context_compacted')).toBe(true);
    piSession.destroy();
  });
});

describe('PiSession agent-loop compaction over the real agent (P5 prepareNextTurnWithContext)', () => {
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

  it('compacts inside prepareNextTurnWithContext and swaps the loop context', async () => {
    const dbName = trackDb('pi-sessions-loop-compaction-real');
    const repo = new IndexedDbSessionRepo(dbName);
    const session = await repo.create({ id: 's1' });
    for (let i = 1; i <= 4; i += 1) {
      await session.appendMessage({ role: 'user', content: `User message ${i} with enough content to estimate tokens accurately.`, timestamp: i });
      await session.appendMessage(assistantMessage({ content: [{ type: 'text', text: `Assistant reply ${i} continuing the conversation with detail.` }] }));
    }

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => sseResponse([
      'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello from "},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"pi"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch;

    try {
      const events: AgentEvent[] = [];
      const run = createRun('s1', 'r1');
      const runner: PiCompactionRunner = async (preparation) => ({
        summary: '## Goal\nShip it.',
        tokensBefore: preparation.tokensBefore,
        retainedTail: preparation.retainedTail,
      });
      const piSession = new PiSession({
        apiKey: 'test-key',
        baseUrl: 'https://api.deepseek.com/v1',
        apiModel: 'deepseek-v4-flash',
        sessionId: 's1',
        runId: 'r1',
        run,
        onEvent: (event) => events.push(event),
        onRunChange: () => undefined,
        createSessionRepo: () => new IndexedDbSessionRepo(dbName),
        compactionSettings: { enabled: true, reserveTokens: 1_000_000, keepRecentTokens: 40 },
        compactionRunner: runner,
      });
      await piSession.prompt('continue the work');

      // prompt 前压缩一次（compactBeforePrompt）+ turn 之间再压缩一次（prepareNextTurnWithContext）。
      const compactedEvents = events.filter((event): event is Extract<AgentEvent, { kind: 'context_compacted' }> => event.kind === 'context_compacted');
      expect(compactedEvents.length).toBeGreaterThanOrEqual(2);
      expect(piSession.lastCompactionStats).toBeDefined();
      expect(run.phase).toBe('completed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15_000);
});

describe('PiSession vision fallback over the real agent (R6)', () => {
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

  it('retries with sanitized context when the model rejects the request with a vision error', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      if (callCount === 1) {
        // 模型拒绝图像输入（415，错误文本含 vision 关键字）→ 触发视觉降级重试。
        return new Response('{"error":{"message":"This model does not support image input."}}', {
          status: 415,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return sseResponse([
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"Fallback ok"},"finish_reason":null}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
        'data: [DONE]\n\n',
      ]);
    }) as typeof fetch;

    try {
      const events: AgentEvent[] = [];
      const run = createRun();
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

      // 首次被拒后以降级上下文重试成功，消息如实送达。
      expect(callCount).toBe(2);
      const messages = events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message');
      expect(messages.some((event) => event.message.role === 'assistant' && event.message.content === 'Fallback ok')).toBe(true);
      expect(run.phase).toBe('completed');
      session.destroy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 15_000);
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
