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
  private readonly responses: AgentModelResponse[];

  constructor(responses: AgentModelResponse[]) {
    this.responses = responses;
  }

  async complete(): Promise<AgentModelResponse> {
    const response = this.responses[this.index++];
    if (!response) throw new Error('Unexpected model request');
    return response;
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

describe('Agent Core v2', () => {
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
});
