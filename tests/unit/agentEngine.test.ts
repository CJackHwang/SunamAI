import { describe, expect, it } from 'vitest';
import type { AgentWorkspaceRuntime, ProcessStatus, RuntimeProcessEvent, ShellRunRequest, ShellRunResult, WorkspaceTreeEntry } from '@/shared/contracts/agentRuntime';
import { AgentEngine } from '@/features/agent-core/engine';
import { AgentEventStore } from '@/features/agent-core/eventStore';
import type { AgentModelClient } from '@/features/agent-core/modelClient';
import type { AgentEvent, AgentModelResponse } from '@/features/agent-core/types';

function tool(id: string, name: string, args: Record<string, unknown>): AgentModelResponse {
  return { message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] };
}

class ScriptedClient implements AgentModelClient {
  private index = 0;
  private readonly responses: Array<AgentModelResponse | Error>;

  constructor(responses: Array<AgentModelResponse | Error>) {
    this.responses = responses;
  }

  async complete(): Promise<AgentModelResponse> {
    const response = this.responses[this.index++];
    if (!response) throw new Error('Unexpected model request');
    if (response instanceof Error) throw response;
    return response;
  }
}

class DeltaOnlyReasoningClient implements AgentModelClient {
  private index = 0;

  async complete(_messages: Parameters<AgentModelClient['complete']>[0], options: Parameters<AgentModelClient['complete']>[1]): Promise<AgentModelResponse> {
    this.index += 1;
    if (this.index === 1) {
      options.onDelta({ content: '', reasoning_content: 'This streamed reasoning must survive.' });
      return tool('inspect', 'workspace_tree', { max_depth: 1 });
    }
    return tool('finish', 'complete_task', { summary: 'Inspected.', evidence: ['Workspace tree inspected.'] });
  }
}

class FakeRuntime implements AgentWorkspaceRuntime {
  readonly files = new Map<string, string>();
  readonly commands: string[] = [];

  async ensureContainer(): Promise<void> {}
  async listWorkspace(): Promise<WorkspaceTreeEntry[]> { return []; }
  async readWorkspaceFile(_containerId: string, path: string): Promise<string> { return this.files.get(path) ?? ''; }
  async searchWorkspace(): Promise<Array<{ path: string; line: number; content: string }>> { return []; }
  async applyWorkspaceChanges(_containerId: string, changes: Array<{ path: string; content: string }>): Promise<Array<{ path: string; diff: string }>> { changes.forEach((change) => this.files.set(change.path, change.content)); return changes.map((change) => ({ path: change.path, diff: `+++ ${change.path}` })); }
  async runShell(request: ShellRunRequest): Promise<ShellRunResult> { this.commands.push(request.command); return { timedOut: false, process: { id: 'p-1', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: 'passed', cursor: 6, exitCode: 0 } }; }
  observeProcess(): ProcessStatus | null { return null; }
  async sendProcessInput(): Promise<boolean> { return false; }
  stopProcess(): boolean { return false; }
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

describe('Agent Core v2', () => {
  it('persists reasoning that a provider returns only through streaming deltas', async () => {
    const events: AgentEvent[] = [];
    const engine = new AgentEngine({ sessionId: 's-reasoning', containerId: 'c-reasoning', persona: 'Sunam 1.14 Homo', model: 'model', input: 'Inspect this.', initialMessages: [], client: new DeltaOnlyReasoningClient(), runtime: new FakeRuntime(), store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    const assistant = events.find((event) => event.kind === 'message' && event.message.role === 'assistant' && event.message.tool_calls?.[0]?.id === 'inspect');
    expect(assistant).toMatchObject({ kind: 'message', message: { reasoning_content: 'This streamed reasoning must survive.' } });
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
      sessionId: 's-1', containerId: 'c-1', persona: 'Sunam 1.14 Homo', model: 'model', input: 'Implement the requested workspace change and test it.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined,
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
      sessionId: 's-2', containerId: 'c-2', persona: 'Sunam 1.14 Saki', model: 'model', input: 'Inspect this.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined,
    });
    await engine.execute();
    expect(engine.getRun().phase).toBe('completed');
    expect(events.some((event) => event.kind === 'tool_finished' && event.result.content.includes('invalid JSON'))).toBe(true);
  });

  it('caps read-only tool execution at four concurrent calls while preserving result order', async () => {
    const runtime = new ConcurrentReadRuntime();
    const events: AgentEvent[] = [];
    const reads = Array.from({ length: 6 }, (_, index) => ({ id: `read-${index}`, name: 'workspace_tree', arguments: JSON.stringify({ max_depth: index + 1 }) }));
    const client = new ScriptedClient([
      { message: { role: 'assistant', content: '', tool_calls: reads.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }, toolCalls: reads },
      tool('finish', 'complete_task', { summary: 'Inspected.', evidence: ['Workspace tree inspected.'] }),
    ]);
    const engine = new AgentEngine({ sessionId: 's-3', containerId: 'c-3', persona: 'Sunam 1.14 Homo', model: 'model', input: 'Inspect this workspace.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    expect(runtime.maxReads).toBe(4);
    expect(events.filter((event) => event.kind === 'tool_finished').slice(0, 6).map((event) => event.toolCall.id)).toEqual(reads.map((call) => call.id));
  });

  it('records a failed verification and refuses to finish the changed workspace run', async () => {
    const runtime = new FailingVerificationRuntime();
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([
      tool('plan', 'update_plan', { items: [{ id: 'deliver', title: 'Change file', status: 'completed' }] }),
      tool('patch', 'apply_patch', { changes: [{ path: 'broken.txt', content: 'broken' }] }),
      tool('verify', 'shell_run', { command: 'npm test', mode: 'foreground' }),
      tool('finish', 'complete_task', { summary: 'not actually done', evidence: ['npm test failed'] }),
    ]);
    const engine = new AgentEngine({ sessionId: 's-4', containerId: 'c-4', persona: 'Sunam 5.14 Saki', model: 'model', input: 'Implement and test a workspace change.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    expect(engine.getRun().phase).toBe('failed');
    expect(events.some((event) => event.kind === 'verification' && !event.passed)).toBe(true);
    expect(events.some((event) => event.kind === 'tool_finished' && event.toolCall.function.name === 'complete_task' && !event.result.ok)).toBe(true);
  });

  it('emits an exponential retry event for retryable model failures and can finish afterwards', async () => {
    const runtime = new FakeRuntime();
    const events: AgentEvent[] = [];
    const client = new ScriptedClient([new Error('LLM API Error (429): busy'), { message: { role: 'assistant', content: 'Recovered.' }, toolCalls: [] }]);
    const engine = new AgentEngine({ sessionId: 's-5', containerId: 'c-5', persona: 'Sunam 1.14 Homo', model: 'model', input: 'Say hi.', initialMessages: [], client, runtime, store: new AgentEventStore(), signal: new AbortController().signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    expect(engine.getRun().phase).toBe('completed');
    expect(events.some((event) => event.kind === 'model_retry' && event.delayMs >= 500)).toBe(true);
  });

  it('cancels its owned run before the first model turn when its signal is aborted', async () => {
    const runtime = new FakeRuntime();
    const events: AgentEvent[] = [];
    const controller = new AbortController();
    controller.abort();
    const engine = new AgentEngine({ sessionId: 's-6', containerId: 'c-6', persona: 'Sunam 1.14 Homo', model: 'model', input: 'Stop.', initialMessages: [], client: new ScriptedClient([]), runtime, store: new AgentEventStore(), signal: controller.signal, onEvent: (event) => events.push(event), onRunChange: () => undefined });
    await engine.execute();
    expect(engine.getRun().phase).toBe('cancelled');
    expect(events.at(-1)).toMatchObject({ kind: 'run_finished', summary: 'Agent stopped by user.' });
  });
});
