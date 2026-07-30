import { describe, expect, it } from 'vitest';
import type { AgentWorkspaceRuntime, ProcessStatus, RuntimeProcessEvent, ShellRunRequest, ShellRunResult, WorkspaceTreeEntry } from '@/shared/contracts/agentRuntime';
import { AgentEngine } from '@/features/agent-core/engine';
import { AgentEventStore } from '@/features/agent-core/eventStore';
import type { AgentModelClient } from '@/features/agent-core/modelClient';
import type { AgentEvent, AgentModelResponse, AgentRun, TaskContract } from '@/features/agent-core/types';
import { LLMError } from '@/shared/api/llmError';

function tool(id: string, name: string, args: Record<string, unknown>): AgentModelResponse {
  return { message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] };
}

class ScriptedClient implements AgentModelClient {
  private index = 0;
  private readonly responses: Array<AgentModelResponse | Error>;

  constructor(responses: Array<AgentModelResponse | Error>) {
    this.responses = responses;
  }

  async complete(_messages: Parameters<AgentModelClient['complete']>[0], _options: Parameters<AgentModelClient['complete']>[1]): Promise<AgentModelResponse> {
    const response = this.responses[this.index++];
    if (!response) throw new Error('Unexpected model request');
    if (response instanceof Error) throw response;
    return response;
  }
}

class CapturingClient extends ScriptedClient {
  messages: Parameters<AgentModelClient['complete']>[0] = [];
  tools: Parameters<AgentModelClient['complete']>[1]['tools'] = [];

  override async complete(messages: Parameters<AgentModelClient['complete']>[0], options: Parameters<AgentModelClient['complete']>[1]): Promise<AgentModelResponse> {
    this.messages = messages;
    this.tools = options.tools;
    return super.complete(messages, options);
  }
}

class GuidanceClient implements AgentModelClient {
  readonly calls: Array<Parameters<AgentModelClient['complete']>[0]> = [];
  readonly firstStarted: Promise<void>;
  private markFirstStarted: (() => void) | undefined;
  private resolveFirst: ((response: AgentModelResponse) => void) | undefined;

  constructor() {
    this.firstStarted = new Promise((resolve) => { this.markFirstStarted = resolve; });
  }

  async complete(messages: Parameters<AgentModelClient['complete']>[0]): Promise<AgentModelResponse> {
    this.calls.push(messages);
    if (this.calls.length === 1) {
      this.markFirstStarted?.();
      return new Promise((resolve) => { this.resolveFirst = resolve; });
    }
    return tool('guided-finish', 'complete_task', { summary: 'Guidance applied.', evidence: ['Guidance reached the next model turn.'] });
  }

  finishFirst(response: AgentModelResponse = { message: { role: 'assistant', content: 'Initial answer before guidance.' }, toolCalls: [] }): void {
    this.resolveFirst?.(response);
  }
}

class DeltaOnlyReasoningClient implements AgentModelClient {
  private index = 0;

  async complete(_messages: Parameters<AgentModelClient['complete']>[0], options: Parameters<AgentModelClient['complete']>[1]): Promise<AgentModelResponse> {
    this.index += 1;
    if (this.index === 1) {
      options.onDelta({ content: '', reasoning_content: 'This streamed reasoning must survive.', tool_calls: [{ id: 'inspect', type: 'function', function: { name: 'workspace_tree', arguments: '{"max_depth":1}' } }] });
      return tool('inspect', 'workspace_tree', { max_depth: 1 });
    }
    return tool('finish', 'complete_task', { summary: 'Inspected.', evidence: ['Workspace tree inspected.'] });
  }
}

class AbortAwareHangingClient implements AgentModelClient {
  async complete(_messages: Parameters<AgentModelClient['complete']>[0], options: Parameters<AgentModelClient['complete']>[1]): Promise<AgentModelResponse> {
    return new Promise((_resolve, reject) => {
      if (options.signal.aborted) reject(options.signal.reason);
      else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  }
}

class FakeRuntime implements AgentWorkspaceRuntime {
  readonly files = new Map<string, string>();
  readonly commands: string[] = [];

  async ensureContainer(): Promise<void> {}
  async getWorkspaceRevision(): Promise<number> { return 0; }
  async flushWorkspace(): Promise<void> {}
  async listResources(): Promise<[]> { return []; }
  async readResourceText(): Promise<string> { return ''; }
  async readResourceImage() { return { id: 'res', name: 'image.png', kind: 'image' as const, mimeType: 'image/png', size: 1, sha256: 'x', createdAt: 1 }; }
  async materializeResource(_containerId: string, _resourceId: string, path: string) { return { path, kind: 'created' as const, beforeBytes: 0, afterBytes: 1 }; }
  async listWorkspace(): Promise<WorkspaceTreeEntry[]> { return []; }
  getUserTerminalBuffer(): string { return ''; }
  appendUserTerminalBuffer(_data: string): void {}
  async readWorkspaceFile(_containerId: string, path: string): Promise<string> { return this.files.get(path) ?? ''; }
  async searchWorkspace(): Promise<Array<{ path: string; line: number; content: string }>> { return []; }
  async applyWorkspaceChanges(_containerId: string, changes: Array<{ path: string; content: string }>) { changes.forEach((change) => this.files.set(change.path, change.content)); return changes.map((change) => ({ path: change.path, kind: 'updated' as const, beforeBytes: 0, afterBytes: change.content.length })); }
  async runShell(request: ShellRunRequest): Promise<ShellRunResult> { this.commands.push(request.command); return { timedOut: false, process: { id: 'p-1', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: 'passed', cursor: 6, exitCode: 0 } }; }
  observeProcess(): ProcessStatus | null { return null; }
  async sendProcessInput(): Promise<boolean> { return false; }
  async stopProcess(): Promise<boolean> { return false; }
  stopRun(): void {}
  getProcesses(): ProcessStatus[] { return []; }
  subscribe(_listener: (event: RuntimeProcessEvent) => void): () => void { return () => undefined; }
}

class ConcurrentReadRuntime extends FakeRuntime {
  activeReads = 0;
  maxReads = 0;

  override async listWorkspace(): Promise<WorkspaceTreeEntry[]> {
    this.activeReads += 1;
    this.maxReads = Math.max(this.maxReads, this.activeReads);
    await new Promise((resolve) => setTimeout(resolve, 15));
    this.activeReads -= 1;
    return [];
  }
}

class FailingVerificationRuntime extends FakeRuntime {
  override async runShell(request: ShellRunRequest): Promise<ShellRunResult> {
    this.commands.push(request.command);
    return { timedOut: false, process: { id: 'p-fail', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: 'failing assertion', cursor: 17, exitCode: 1 } };
  }
}

class BackgroundServerRuntime extends FakeRuntime {
  readonly process: ProcessStatus = { id: 'server-1', sessionId: 'server-session', runId: 'server-run', containerId: 'c-server-container', command: 'npm run dev', isRunning: true, output: 'ready', cursor: 5 };
  stopRunCalls = 0;

  override async runShell(request: ShellRunRequest): Promise<ShellRunResult> {
    this.commands.push(request.command);
    return { timedOut: false, process: { ...this.process, sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command } };
  }

  override stopRun(): void { this.stopRunCalls += 1; }
  override getProcesses(): ProcessStatus[] { return [this.process]; }
}

class HangingCheckpointRuntime extends FakeRuntime {
  override async flushWorkspace(): Promise<void> {
    return new Promise(() => undefined);
  }
}

class ToggleHangingRunStore extends AgentEventStore {
  hangRunWrites = false;

  override async saveRun(run: AgentRun): Promise<void> {
    if (this.hangRunWrites) return new Promise(() => undefined);
    return super.saveRun(run);
  }
}

class TrackingCheckpointStore extends AgentEventStore {
  savedCheckpointCount = 0;

  override async saveCheckpoint(checkpoint: Parameters<AgentEventStore['saveCheckpoint']>[0]): Promise<void> {
    this.savedCheckpointCount += 1;
    return super.saveCheckpoint(checkpoint);
  }
}

class GuidanceFailingStore extends AgentEventStore {
  failGuidance = false;

  override async append(event: AgentEvent): Promise<void> {
    if (this.failGuidance && event.kind === 'message' && event.message.role === 'user' && event.message.content === 'Rejected guidance.') throw new Error('guidance persistence failed');
    await super.append(event);
  }
}

class CompletionPausingStore extends AgentEventStore {
  readonly finalMessageStarted: Promise<void>;
  private markFinalMessageStarted: (() => void) | undefined;
  private releaseFinalMessage: (() => void) | undefined;
  private readonly finalMessageGate: Promise<void>;

  constructor() {
    super();
    this.finalMessageStarted = new Promise((resolve) => { this.markFinalMessageStarted = resolve; });
    this.finalMessageGate = new Promise((resolve) => { this.releaseFinalMessage = resolve; });
  }

  override async append(event: AgentEvent): Promise<void> {
    if (event.kind === 'message' && event.message.role === 'assistant' && event.message.content === 'Atomic completion.') {
      this.markFinalMessageStarted?.();
      await this.finalMessageGate;
    }
    await super.append(event);
  }

  release(): void { this.releaseFinalMessage?.(); }
}

describe('Agent Core v2', () => {
  it('gives explore children read-only tools and task children the complete non-delegating toolset', async () => {
    const exploreClient = new CapturingClient([tool('explore-finish', 'complete_task', { summary: 'Explored.', evidence: ['Files inspected.'] })]);
    const taskClient = new CapturingClient([tool('task-finish', 'complete_task', { summary: 'Implemented.', evidence: ['Task completed.'] })]);
    const base = { sessionId: 's-role', containerId: 'c-role', persona: 'Sunam 6.9 Pron' as const, model: 'model', input: 'Inspect.', initialMessages: [], runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: () => undefined, onRunChange: () => undefined };
    const explore = new AgentEngine({ ...base, client: exploreClient, lineage: { rootRunId: 'root', parentRunId: 'root', role: 'explore', delegatedTaskId: 'read', depth: 1 } });
    const task = new AgentEngine({ ...base, client: taskClient, lineage: { rootRunId: 'root', parentRunId: 'root', role: 'task', delegatedTaskId: 'work', depth: 1 } });

    await Promise.all([explore.execute(), task.execute()]);

    const exploreTools = exploreClient.tools.map((tool) => tool.function.name);
    const taskTools = taskClient.tools.map((tool) => tool.function.name);
    expect(exploreTools).toEqual(expect.arrayContaining(['workspace_tree', 'read_file', 'search_workspace', 'ask_parent', 'complete_task']));
    expect(exploreTools).not.toEqual(expect.arrayContaining(['ask_user', 'apply_patch', 'shell_run', 'process_list', 'spawn_subagent']));
    expect(taskTools).toEqual(expect.arrayContaining(['apply_patch', 'materialize_resource', 'shell_run', 'process_list', 'process_stop', 'read_user_terminal', 'ask_parent', 'complete_task']));
    expect(taskTools).not.toEqual(expect.arrayContaining(['ask_user', 'spawn_subagent', 'wait_subagents', 'message_subagent', 'stop_subagent']));
  });

  it('keeps child plain responses non-terminal until complete_task is called', async () => {
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([
      { message: { role: 'assistant', content: 'I inspected the task.' }, toolCalls: [] },
      tool('finish-child', 'complete_task', { summary: 'Child complete.', evidence: ['Inspection finished.'] }),
    ]);
    const engine = new AgentEngine({
      sessionId: 's-child-plain', containerId: 'c-child-plain', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect.', initialMessages: [], client,
      runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined,
      lineage: { rootRunId: 'root', parentRunId: 'root', role: 'explore', delegatedTaskId: 'inspect', depth: 1 },
    });

    await engine.execute();

    expect(engine.getRun()).toMatchObject({ phase: 'completed', modelTurns: 2 });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'phase_changed', phase: 'acting', detail: expect.stringContaining('plain response') }));
    expect(events.some((event) => event.kind === 'tool_finished' && event.toolCall.function.name === 'complete_task')).toBe(true);
  });

  it('queues root guidance for the next model turn without cancelling the current run', async () => {
    const events: AgentEvent[] = [];
    const client = new GuidanceClient();
    const engine = new AgentEngine({ sessionId: 's-guidance', containerId: 'c-guidance', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Start work.', initialMessages: [], client, runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    const execution = engine.execute();
    await client.firstStarted;

    await expect(engine.enqueueUserGuidance('Prioritize mobile behavior.')).resolves.toBe(true);
    await expect(engine.enqueueUserGuidance('Keep the composer styling unchanged.')).resolves.toBe(true);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.some((message) => message.content === 'Prioritize mobile behavior.')).toBe(false);
    client.finishFirst(tool('premature-finish', 'complete_task', { summary: 'Premature completion.', evidence: ['Initial work finished.'] }));
    await execution;

    expect(client.calls).toHaveLength(2);
    const nextTurnGuidance = client.calls[1]?.filter((message) => message.role === 'user').slice(-2).map((message) => message.content);
    expect(nextTurnGuidance).toEqual(['Prioritize mobile behavior.', 'Keep the composer styling unchanged.']);
    expect(events.filter((event) => event.kind === 'message' && event.message.role === 'user' && event.message.content === 'Prioritize mobile behavior.')).toHaveLength(1);
    expect(events.some((event) => event.kind === 'message' && event.message.role === 'assistant' && event.message.content === 'Premature completion.')).toBe(false);
    expect(engine.getRun().phase).toBe('completed');
  });

  it('rejects failed guidance persistence without leaking it into model context', async () => {
    const client = new GuidanceClient();
    const store = new GuidanceFailingStore();
    const engine = new AgentEngine({ sessionId: 's-guidance-failure', containerId: 'c-guidance-failure', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Start work.', initialMessages: [], client, runtime: new FakeRuntime(), store, signal: new AbortController().signal, onEvent: () => undefined, onRunChange: () => undefined });
    const execution = engine.execute();
    await client.firstStarted;
    store.failGuidance = true;

    await expect(engine.enqueueUserGuidance('Rejected guidance.')).rejects.toThrow('guidance persistence failed');
    client.finishFirst();
    await execution;

    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.some((message) => message.content === 'Rejected guidance.')).toBe(false);
    expect(engine.getRun().phase).toBe('completed');
  });

  it('rejects guidance once completion wins the atomic race', async () => {
    const events: AgentEvent[] = [];
    const store = new CompletionPausingStore();
    const engine = new AgentEngine({
      sessionId: 's-guidance-completion-race', containerId: 'c-guidance-completion-race', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Finish atomically.', initialMessages: [],
      client: new ScriptedClient([tool('atomic-finish', 'complete_task', { summary: 'Atomic completion.', evidence: ['Completion won.'] })]),
      runtime: new FakeRuntime(), store, signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined,
    });
    const execution = engine.execute();
    await store.finalMessageStarted;

    await expect(engine.enqueueUserGuidance('Too late for this run.')).resolves.toBe(false);
    store.release();
    await execution;

    expect(events.some((event) => event.kind === 'message' && event.message.role === 'user' && event.message.content === 'Too late for this run.')).toBe(false);
    expect(engine.getRun().phase).toBe('completed');
  });

  it('preserves reasoning on a final plain assistant message', async () => {
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([{
      message: { role: 'assistant', content: 'Hello.', reasoning_content: 'Checked the request first.' },
      toolCalls: [],
    }]);
    const engine = new AgentEngine({ sessionId: 's-plain-reasoning', containerId: 'c-plain-reasoning', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Hi', initialMessages: [], client, runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    const assistant = events.find((event) => event.kind === 'message' && event.message.role === 'assistant');
    expect(assistant).toMatchObject({ kind: 'message', message: { content: 'Hello.', reasoning_content: 'Checked the request first.' } });
  });

  it('finishes a server-start task from one plain response and keeps the background process alive', async () => {
    const runtime = new BackgroundServerRuntime();
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([
      tool('server', 'shell_run', { command: 'npm run dev', mode: 'background' }),
      { message: { role: 'assistant', content: 'Server is running at http://localhost:3000.' }, toolCalls: [] },
    ]);
    const engine = new AgentEngine({ sessionId: 'server-session', containerId: 'c-server-container', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Start the server', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });

    await engine.execute();

    expect(engine.getRun()).toMatchObject({ phase: 'completed', modelTurns: 2, task: { changedWorkspace: false, verified: false } });
    expect(runtime.stopRunCalls).toBe(0);
    expect(runtime.getProcesses()[0]).toMatchObject({ isRunning: true });
    expect(events.filter((event) => event.kind === 'message' && event.message.role === 'assistant' && event.message.content.includes('Server is running'))).toHaveLength(1);
  });

  it('allows a verified non-trivial task to finish from a final plain response', async () => {
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([
      tool('plan', 'update_plan', { items: [{ id: 'deliver', title: 'Implement and verify', status: 'in_progress' }] }),
      tool('patch', 'apply_patch', { changes: [{ path: 'demo.txt', content: 'done' }] }),
      tool('verify', 'shell_run', { command: 'npm test', mode: 'foreground' }),
      tool('plan-done', 'update_plan', { items: [{ id: 'deliver', title: 'Implement and verify', status: 'completed' }] }),
      { message: { role: 'assistant', content: 'Implemented and verified.' }, toolCalls: [] },
    ]);
    const engine = new AgentEngine({ sessionId: 's-implicit', containerId: 'c-implicit', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Implement and test the requested workspace change.', initialMessages: [], client, runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });

    await engine.execute();

    expect(engine.getRun()).toMatchObject({ phase: 'completed', modelTurns: 5, task: { changedWorkspace: true, verified: true, verifiedRevision: 0 } });
    expect(events.some((event) => event.kind === 'tool_requested' && event.toolCall.function.name === 'complete_task')).toBe(false);
    expect(events.at(-1)).toMatchObject({ kind: 'run_finished', summary: 'Implemented and verified.' });
  });

  it('withholds a plain completion while the execution plan is unfinished', async () => {
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([
      tool('plan', 'update_plan', { items: [{ id: 'deliver', title: 'Finish the requested work', status: 'in_progress' }] }),
      { message: { role: 'assistant', content: 'Finished before the plan.' }, toolCalls: [] },
      tool('plan-done', 'update_plan', { items: [{ id: 'deliver', title: 'Finish the requested work', status: 'completed' }] }),
      { message: { role: 'assistant', content: 'Finished after the plan.' }, toolCalls: [] },
    ]);
    const engine = new AgentEngine({ sessionId: 's-plan-gate', containerId: 'c-plan-gate', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Complete this non-trivial request.', initialMessages: [], client, runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });

    await engine.execute();

    const assistantText = events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'assistant').map((event) => event.message.content);
    expect(assistantText).not.toContain('Finished before the plan.');
    expect(assistantText).toContain('Finished after the plan.');
    expect(events).toContainEqual(expect.objectContaining({ kind: 'phase_changed', phase: 'planning' }));
    expect(engine.getRun().phase).toBe('completed');
  });

  it('withholds a premature plain completion until current-revision verification passes', async () => {
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([
      tool('plan', 'update_plan', { items: [{ id: 'deliver', title: 'Implement and verify', status: 'completed' }] }),
      tool('patch', 'apply_patch', { changes: [{ path: 'demo.txt', content: 'done' }] }),
      { message: { role: 'assistant', content: 'Finished too early.' }, toolCalls: [] },
      tool('verify', 'shell_run', { command: 'npm test', mode: 'foreground' }),
      { message: { role: 'assistant', content: 'Finished after verification.' }, toolCalls: [] },
    ]);
    const engine = new AgentEngine({ sessionId: 's-withheld', containerId: 'c-withheld', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Implement and test the requested workspace change.', initialMessages: [], client, runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });

    await engine.execute();

    const assistantText = events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message' && event.message.role === 'assistant').map((event) => event.message.content);
    expect(assistantText).not.toContain('Finished too early.');
    expect(assistantText).toContain('Finished after verification.');
    expect(events).toContainEqual(expect.objectContaining({ kind: 'assistant_delta', transient: true, content: '', reasoningContent: '' }));
    expect(events).toContainEqual(expect.objectContaining({ kind: 'phase_changed', phase: 'verifying' }));
    expect(engine.getRun().phase).toBe('completed');
  });

  it('persists reasoning that a provider returns only through streaming deltas', async () => {
    const events: AgentEvent[] = [];
    const engine = new AgentEngine({ sessionId: 's-reasoning', containerId: 'c-reasoning', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect this.', initialMessages: [], client: new DeltaOnlyReasoningClient(), runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    const assistant = events.find((event) => event.kind === 'message' && event.message.role === 'assistant' && event.message.tool_calls?.[0]?.id === 'inspect');
    expect(assistant).toMatchObject({ kind: 'message', message: { reasoning_content: 'This streamed reasoning must survive.' } });
    const delta = events.find((event) => event.kind === 'assistant_delta' && event.toolCalls?.[0]?.id === 'inspect');
    expect(delta).toMatchObject({ kind: 'assistant_delta', streamId: expect.stringContaining(':model-'), toolCalls: [{ function: { name: 'workspace_tree' } }] });
    expect(assistant).toMatchObject({ streamId: (delta as Extract<AgentEvent, { kind: 'assistant_delta' }>).streamId });
  });

  it('blocks premature completion, verifies a workspace change, and records a completed Run', async () => {
    const runtime = new FakeRuntime();
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([
      tool('plan', 'update_plan', { items: [{ id: 'deliver', title: 'Make and verify the workspace change', status: 'in_progress' }] }),
      tool('patch', 'apply_patch', { changes: [{ path: 'demo.txt', content: 'works' }] }),
      tool('early-complete', 'complete_task', { summary: 'definitely done', evidence: ['trust me'] }),
      tool('verify', 'shell_run', { command: 'npm test', mode: 'foreground' }),
      tool('plan-complete', 'update_plan', { items: [{ id: 'deliver', title: 'Make and verify the workspace change', status: 'completed' }] }),
      tool('finish', 'complete_task', { summary: 'Done with evidence.', evidence: ['npm test passed'] }),
    ]);
    const engine = new AgentEngine({
      sessionId: 's-1', containerId: 'c-1', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Implement the requested workspace change and test it.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined,
    });
    await engine.execute();
    expect(engine.getRun().phase).toBe('completed');
    expect(runtime.files.get('demo.txt')).toBe('works');
    expect(runtime.commands).toEqual(['npm test']);
    expect(events.some((event) => event.kind === 'tool_finished' && event.toolCall.function.name === 'complete_task' && !event.result.ok)).toBe(true);
    expect(events.some((event) => event.kind === 'verification' && event.passed)).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: 'run_finished', summary: 'Done with evidence.' });
  });

  it('serializes malformed tool calls into observable tool results instead of crashing', async () => {
    const runtime = new FakeRuntime();
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([
      { message: { role: 'assistant', content: '', tool_calls: [{ id: 'bad', type: 'function', function: { name: 'workspace_tree', arguments: '{bad' } }] }, toolCalls: [{ id: 'bad', name: 'workspace_tree', arguments: '{bad' }] },
      tool('finish', 'complete_task', { summary: 'No changes needed.', evidence: ['Observed malformed tool request safely.'] }),
    ]);
    const engine = new AgentEngine({
      sessionId: 's-2', containerId: 'c-2', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect this.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined,
    });
    await engine.execute();
    expect(engine.getRun().phase).toBe('completed');
    expect(events.some((event) => event.kind === 'tool_finished' && event.result.content.includes('invalid JSON'))).toBe(true);
  });

  it('stops an identical rejected tool loop after one recovery turn', async () => {
    const events: AgentEvent[] = [];
    const repeated = Array.from({ length: 4 }, (_, index) => tool(`repeat-${index}`, 'complete_task', { summary: 'Done.', evidence: ['claim'] }));
    const engine = new AgentEngine({ sessionId: 's-repeat', containerId: 'c-repeat', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Check this workspace.', initialMessages: [], client: new ScriptedClient(repeated), runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });

    await engine.execute();

    expect(engine.getRun()).toMatchObject({ phase: 'failed', modelTurns: 4, toolCalls: 4, error: 'Agent repeated complete_task with identical arguments after recovery guidance.' });
    expect(events.filter((event) => event.kind === 'recovery_hint' && event.message.includes('consecutive times'))).toHaveLength(2);
  });

  it('caps read-only tool execution at four concurrent calls while preserving result order', async () => {
    const runtime = new ConcurrentReadRuntime();
    const events: AgentEvent[] = [];
    const reads = Array.from({ length: 6 }, (_, index) => ({ id: `read-${index}`, name: 'workspace_tree', arguments: JSON.stringify({ max_depth: index + 1 }) }));
    const client = new ScriptedClient([
      { message: { role: 'assistant', content: '', tool_calls: reads.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }, toolCalls: reads },
      tool('finish', 'complete_task', { summary: 'Inspected.', evidence: ['Workspace tree inspected.'] }),
    ]);
    const engine = new AgentEngine({ sessionId: 's-3', containerId: 'c-3', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect this workspace.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    expect(runtime.maxReads).toBeGreaterThan(1);
    expect(runtime.maxReads).toBeLessThanOrEqual(4);
    expect(events.filter((event) => event.kind === 'tool_finished').slice(0, 6).map((event) => event.toolCall.id)).toEqual(reads.map((call) => call.id));
  });

  it('records a failed verification and refuses to complete the stale workspace revision', async () => {
    const runtime = new FailingVerificationRuntime();
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([
      tool('plan', 'update_plan', { items: [{ id: 'deliver', title: 'Change file', status: 'completed' }] }),
      tool('patch', 'apply_patch', { changes: [{ path: 'broken.txt', content: 'broken' }] }),
      tool('verify', 'shell_run', { command: 'npm test', mode: 'foreground' }),
      tool('finish', 'complete_task', { summary: 'not actually done', evidence: ['npm test failed'] }),
    ]);
    const engine = new AgentEngine({ sessionId: 's-4', containerId: 'c-4', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Implement and test a workspace change.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    expect(engine.getRun().phase).toBe('failed');
    expect(events.some((event) => event.kind === 'verification' && !event.passed)).toBe(true);
    expect(events.some((event) => event.kind === 'tool_finished' && event.toolCall.function.name === 'complete_task' && !event.result.ok && event.result.content.includes('current workspace revision'))).toBe(true);
  });

  it('emits an exponential retry event for retryable model failures and can finish afterwards', async () => {
    const runtime = new FakeRuntime();
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([new Error('LLM API Error (429): busy'), { message: { role: 'assistant', content: 'Recovered.' }, toolCalls: [] }]);
    const engine = new AgentEngine({ sessionId: 's-5', containerId: 'c-5', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Say hi.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    expect(engine.getRun().phase).toBe('completed');
    expect(events.some((event) => event.kind === 'model_retry' && event.delayMs >= 500)).toBe(true);
  });

  it('backs off a prompt-too-long request three times by complete groups and persists deterministic fallback state', async () => {
    const events: AgentEvent[] = [];
    const tooLong = () => new LLMError('http_error', 'maximum context token length exceeded by prompt', { status: 400 });
    const engine = new AgentEngine({
      sessionId: 's-ptl', containerId: 'c-ptl', persona: 'Sunam 6.9 Pron', model: 'private-model', input: 'Inspect.',
      initialMessages: Array.from({ length: 20 }, (_, index) => ({ role: 'user' as const, content: `history-${index}` })),
      client: new ScriptedClient([tooLong(), tooLong(), tooLong()]), runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal,
      onEvent: (event) => events.push(event), onRunChange: () => undefined,
    });
    await engine.execute();
    expect(engine.getRun()).toMatchObject({ phase: 'failed', modelTurns: 3 });
    expect(events.filter((event) => event.kind === 'recovery_hint' && event.message.includes('oldest 20%'))).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'context_compacted', fallback: true, fallbackReason: 'main_prompt_too_long' }));
    expect(events.filter((event) => event.kind === 'context_compaction_status').map((event) => event.active)).toEqual([true, false]);
    expect(events.some((event) => event.kind === 'checkpoint')).toBe(true);
  });

  it('cancels immediately while waiting for a model retry', async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const engine = new AgentEngine({
      sessionId: 's-retry-cancel', containerId: 'c-retry-cancel', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Say hi.', initialMessages: [],
      client: new ScriptedClient([new Error('LLM API Error (429): busy'), { message: { role: 'assistant', content: 'Must not complete.' }, toolCalls: [] }]),
      runtime: new FakeRuntime(), store: new AgentEventStore(), signal: controller.signal,
      onEvent: (event) => { events.push(event); if (event.kind === 'model_retry') controller.abort(); }, onRunChange: () => undefined,
    });
    await engine.execute();
    expect(engine.getRun().phase).toBe('cancelled');
    expect(events.some((event) => event.kind === 'message' && event.message.content === 'Must not complete.')).toBe(false);
  });

  it('cancels its owned run before the first model turn when its signal is aborted', async () => {
    const runtime = new FakeRuntime();
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    controller.abort();
    const engine = new AgentEngine({ sessionId: 's-6', containerId: 'c-6', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Stop.', initialMessages: [], client: new ScriptedClient([]), runtime, store: new AgentEventStore(), signal: controller.signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    expect(engine.getRun().phase).toBe('cancelled');
    expect(events.filter((event) => event.kind === 'phase_changed').map((event) => event.phase)).toEqual(expect.arrayContaining(['cancelling', 'cancelled']));
    expect(events.at(-1)).toMatchObject({ kind: 'run_finished', summary: 'Agent stopped by user.' });
  });

  it('rebuilds a resumed run with the original task contract and explicit lineage', async () => {
    const task: TaskContract = {
      objective: 'Implement the original feature.', acceptanceCriteria: ['Original acceptance'], constraints: ['Original constraint'], requiresPlan: true,
      plan: [{ id: 'done', title: 'Implement and verify', status: 'completed' }], evidence: ['Existing evidence'], changedWorkspace: true,
      workspaceRevision: 2, verified: true, verifiedRevision: 2, verificationEvidence: [{ command: 'npm test', passed: true, workspaceRevision: 2, createdAt: 1 }],
    };
    const client = new CapturingClient([
      tool('verify-again', 'shell_run', { command: 'npm test', mode: 'foreground' }),
      tool('finish', 'complete_task', { summary: 'Resumed and complete.', evidence: ['Resumed workspace was verified again.'] }),
    ]);
    const engine = new AgentEngine({
      sessionId: 's-resume', containerId: 'c-resume', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Continue from checkpoint.', initialMessages: [],
      client, runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: () => undefined, onRunChange: () => undefined,
      resume: { sourceRunId: 'r-old', task, summary: 'Checkpoint facts.', workspaceDrift: { checkpointRevision: 2, currentRevision: 3 } },
    });
    await engine.execute();
    expect(engine.getRun()).toMatchObject({ phase: 'completed', parentRunId: 'r-old', task: { objective: 'Implement the original feature.', acceptanceCriteria: ['Original acceptance'] } });
    expect(engine.getRun().task.verificationEvidence).toHaveLength(2);
    expect(client.messages[0]?.content).toContain('Objective: Implement the original feature.');
    expect(client.messages[0]?.content).toContain('Checkpoint facts.');
    expect(client.messages.some((message) => message.content.includes('RECOVERY WORKSPACE DRIFT'))).toBe(true);
  });

  it('rejects an oversized tool batch before partially executing it', async () => {
    const events: AgentEvent[] = [];
    const calls = [
      { id: 'one', name: 'workspace_tree', arguments: JSON.stringify({ max_depth: 1 }) },
      { id: 'two', name: 'workspace_tree', arguments: JSON.stringify({ max_depth: 1 }) },
    ];
    const client = new ScriptedClient([{ message: { role: 'assistant', content: '', tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }, toolCalls: calls }]);
    const engine = new AgentEngine({ sessionId: 's-budget', containerId: 'c-budget', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect.', initialMessages: [], client, runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined, budget: { maxToolCalls: 1 } });
    await engine.execute();
    expect(engine.getRun()).toMatchObject({ phase: 'failed', toolCalls: 0 });
    expect(events.some((event) => event.kind === 'tool_requested')).toBe(false);
  });

  it('enforces the wall-clock budget during an in-flight model request', async () => {
    const engine = new AgentEngine({ sessionId: 's-deadline', containerId: 'c-deadline', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect.', initialMessages: [], client: new AbortAwareHangingClient(), runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: () => undefined, onRunChange: () => undefined, budget: { maxDurationMs: 25 } });
    await engine.execute();
    expect(engine.getRun()).toMatchObject({ phase: 'failed', error: 'Agent run exceeded its time budget.' });
  });

  it('fails visibly when post-tool checkpoint synchronization hangs', async () => {
    const runChanges: AgentRun[] = [];
    const store = new TrackingCheckpointStore();
    const engine = new AgentEngine({
      sessionId: 's-checkpoint-timeout', containerId: 'c-checkpoint-timeout', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect.', initialMessages: [],
      client: new ScriptedClient([tool('inspect', 'workspace_tree', { max_depth: 1 })]), runtime: new HangingCheckpointRuntime(), store,
      signal: new AbortController().signal, onEvent: () => undefined, onRunChange: (run) => runChanges.push(run), checkpointTimeoutMs: 20,
    });

    await engine.execute();

    expect(engine.getRun()).toMatchObject({ phase: 'failed', error: expect.stringContaining('checkpoint synchronization timed out') });
    expect(runChanges.at(-1)).toMatchObject({ phase: 'failed', error: expect.stringContaining('last successful checkpoint was preserved') });
    expect(store.savedCheckpointCount).toBe(0);
  });

  it('projects a failed terminal state before a hanging Run persistence write can finish', async () => {
    const store = new ToggleHangingRunStore();
    const runChanges: AgentRun[] = [];
    const engine = new AgentEngine({
      sessionId: 's-run-write-timeout', containerId: 'c-run-write-timeout', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect.', initialMessages: [],
      client: new ScriptedClient([tool('inspect', 'workspace_tree', { max_depth: 1 })]), runtime: new FakeRuntime(), store,
      signal: new AbortController().signal,
      onEvent: (event) => { if (event.kind === 'tool_finished') store.hangRunWrites = true; },
      onRunChange: (run) => runChanges.push(run), checkpointTimeoutMs: 20,
    });

    await engine.execute();

    expect(runChanges.at(-1)).toMatchObject({ phase: 'failed', error: expect.stringContaining('checkpoint synchronization timed out') });
    expect(engine.getRun().phase).toBe('failed');
  });

  it('cancels a Run while checkpoint synchronization is hanging', async () => {
    const controller = new AbortController();
    const engine = new AgentEngine({
      sessionId: 's-checkpoint-cancel', containerId: 'c-checkpoint-cancel', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect.', initialMessages: [],
      client: new ScriptedClient([tool('inspect', 'workspace_tree', { max_depth: 1 })]), runtime: new HangingCheckpointRuntime(), store: new AgentEventStore(),
      signal: controller.signal, onEvent: (event) => { if (event.kind === 'tool_finished') setTimeout(() => controller.abort(), 0); }, onRunChange: () => undefined, checkpointTimeoutMs: 200,
    });

    await engine.execute();

    expect(engine.getRun().phase).toBe('cancelled');
  });

  it('rejects a terminal control call that appears before a side effect in the same batch', async () => {
    const runtime = new FakeRuntime();
    const events: AgentEvent[] = [];
    const unsafe = [
      { id: 'finish-early', name: 'complete_task', arguments: JSON.stringify({ summary: 'Done too early.', evidence: ['claim'] }) },
      { id: 'write-late', name: 'apply_patch', arguments: JSON.stringify({ changes: [{ path: 'late.txt', content: 'unverified' }] }) },
    ];
    const client = new ScriptedClient([
      { message: { role: 'assistant', content: '', tool_calls: unsafe.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }, toolCalls: unsafe },
      tool('finish-safe', 'complete_task', { summary: 'Safely finished without side effects.', evidence: ['Unsafe mixed batch was rejected.'] }),
    ]);
    const engine = new AgentEngine({ sessionId: 's-terminal-order', containerId: 'c-terminal-order', persona: 'Sunam 6.9 Pron', model: 'model', input: 'Inspect.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    expect(engine.getRun().phase).toBe('completed');
    expect(runtime.files.has('late.txt')).toBe(false);
    const rejected = events.filter((event): event is Extract<AgentEvent, { kind: 'tool_finished' }> => event.kind === 'tool_finished' && ['finish-early', 'write-late'].includes(event.toolCall.id));
    expect(rejected).toHaveLength(2);
    expect(rejected.every((event) => !event.result.ok)).toBe(true);
  });
});
