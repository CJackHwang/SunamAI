import { describe, expect, it } from 'vitest';
import type { AgentWorkspaceRuntime, ProcessOwnership, ProcessStatus, RuntimeProcessEvent, ShellRunRequest, ShellRunResult, WorkspaceTreeEntry } from '@/shared/contracts/agentRuntime';
import type { AgentModelClient } from '@/features/agent-core/modelClient';
import type { AgentModelResponse, AgentRun } from '@/features/agent-core/types';
import { AgentFamilyBudget, ContainerMutationLease } from '@/features/agent-core/agentFamily';
import { AgentFamilyCoordinator } from '@/features/agent-core/subagentCoordinator';
import { AgentEventStore } from '@/features/agent-core/eventStore';

const plainResponse: AgentModelResponse = { message: { role: 'assistant', content: 'Task inspected.' }, toolCalls: [] };

class RuntimeStub implements AgentWorkspaceRuntime {
  async ensureContainer(): Promise<void> {}
  async getWorkspaceRevision(): Promise<number> { return 0; }
  async flushWorkspace(): Promise<void> {}
  async listResources(): Promise<[]> { return []; }
  async readResourceText(): Promise<string> { return ''; }
  async readResourceImage() { return { id: 'resource', name: 'image.png', kind: 'image' as const, mimeType: 'image/png', size: 1, sha256: 'hash', createdAt: 1 }; }
  async materializeResource(_containerId: string, _resourceId: string, path: string) { return { path, kind: 'created' as const, beforeBytes: 0, afterBytes: 1 }; }
  async listWorkspace(): Promise<WorkspaceTreeEntry[]> { return []; }
  async readWorkspaceFile(): Promise<string> { return ''; }
  async searchWorkspace(): Promise<[]> { return []; }
  async applyWorkspaceChanges(_containerId: string, changes: Array<{ path: string; content: string }>) { return changes.map((change) => ({ path: change.path, kind: 'created' as const, beforeBytes: 0, afterBytes: change.content.length })); }
  async runShell(request: ShellRunRequest): Promise<ShellRunResult> { return { timedOut: false, process: { id: 'process', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: '', cursor: 0, exitCode: 0 } }; }
  observeProcess(_processId: string, _ownership: ProcessOwnership): ProcessStatus | null { return null; }
  async sendProcessInput(): Promise<boolean> { return false; }
  async stopProcess(): Promise<boolean> { return false; }
  stopRun(): void {}
  getProcesses(): ProcessStatus[] { return []; }
  subscribe(_listener: (event: RuntimeProcessEvent) => void): () => void { return () => undefined; }
  getUserTerminalBuffer(): string { return ''; }
  appendUserTerminalBuffer(): void {}
}

class DeferredClient implements AgentModelClient {
  private resolve: ((response: AgentModelResponse) => void) | undefined;
  readonly started: Promise<void>;
  private markStarted: (() => void) | undefined;
  private readonly onStart: (() => void) | undefined;
  private readonly onFinish: (() => void) | undefined;

  constructor(onStart?: () => void, onFinish?: () => void) {
    this.onStart = onStart;
    this.onFinish = onFinish;
    this.started = new Promise((resolve) => { this.markStarted = resolve; });
  }

  complete(_messages: Parameters<AgentModelClient['complete']>[0], options: Parameters<AgentModelClient['complete']>[1]): Promise<AgentModelResponse> {
    this.onStart?.();
    this.markStarted?.();
    return new Promise((resolve, reject) => {
      this.resolve = (response) => { this.onFinish?.(); resolve(response); };
      const abort = () => { this.onFinish?.(); reject(options.signal.reason); };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    });
  }

  finish(response: AgentModelResponse = plainResponse): void { this.resolve?.(response); }
}

class FailingClient implements AgentModelClient {
  async complete(): Promise<AgentModelResponse> { throw new Error('child model failed'); }
}

class ScriptedClient implements AgentModelClient {
  private index = 0;
  private readonly responses: AgentModelResponse[];
  constructor(responses: AgentModelResponse[]) { this.responses = responses; }
  async complete(): Promise<AgentModelResponse> {
    const response = this.responses[this.index++];
    if (!response) throw new Error('unexpected child turn');
    return response;
  }
}

function tool(id: string, name: string, args: Record<string, unknown>): AgentModelResponse {
  const call = { id, name, arguments: JSON.stringify(args) };
  return { message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: call.arguments } }] }, toolCalls: [call] };
}

function rootRun(): AgentRun {
  return {
    id: 'root-run', sessionId: 'session', containerId: 'c-container', model: 'model', persona: 'Sunam 6.9 Pron', phase: 'acting', createdAt: 1, updatedAt: 1,
    task: { objective: 'Coordinate work', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
    chaos: { persona: 'Sunam 6.9 Pron', ritual: '', privateGoods: '', styleDirective: '', invariants: [] },
    budget: { maxModelTurns: 60, maxToolCalls: 150, maxDurationMs: 900_000 }, modelTurns: 0, toolCalls: 0, summary: 'Parent facts', rootRunId: 'root-run', agentRole: 'root', depth: 0,
  };
}

function coordinator(clients: AgentModelClient[], signal = new AbortController().signal, run = rootRun()) {
  const budget = new AgentFamilyBudget();
  const lease = new ContainerMutationLease();
  return new AgentFamilyCoordinator({
    root: { getRun: () => run, getFamilyBudget: () => budget, getMutationLease: () => lease },
    persona: run.persona,
    model: run.model,
    runtime: new RuntimeStub(),
    store: new AgentEventStore(),
    signal,
    createClient: () => {
      const next = clients.shift();
      if (!next) throw new Error('No child client was prepared.');
      return next;
    },
    onEvent: () => undefined,
    onRunChange: () => undefined,
  });
}

describe('AgentFamilyCoordinator', () => {
  it('runs up to three explore children concurrently', async () => {
    let active = 0;
    let maximum = 0;
    const clients = Array.from({ length: 3 }, () => new DeferredClient(() => { active += 1; maximum = Math.max(maximum, active); }, () => { active -= 1; }));
    const family = coordinator([...clients]);
    const spawned = [];
    for (let index = 0; index < 3; index += 1) spawned.push(await family.spawn({ taskId: `research-${index}`, role: 'explore', prompt: `inspect ${index}` }));
    await Promise.all(clients.map((client) => client.started));
    expect(maximum).toBe(3);
    clients.forEach((client) => client.finish());
    const notifications = await family.wait(spawned.map((child) => child.runId));
    expect(notifications.every((notification) => notification.status === 'completed')).toBe(true);
  });

  it('serializes implement and verify children', async () => {
    let active = 0;
    let maximum = 0;
    const first = new DeferredClient(() => { active += 1; maximum = Math.max(maximum, active); }, () => { active -= 1; });
    const second = new DeferredClient(() => { active += 1; maximum = Math.max(maximum, active); }, () => { active -= 1; });
    const family = coordinator([first, second]);
    const implement = await family.spawn({ taskId: 'write', role: 'implement', prompt: 'inspect write task' });
    const verify = await family.spawn({ taskId: 'verify', role: 'verify', prompt: 'inspect verification task' });
    await first.started;
    let secondStarted = false;
    void second.started.then(() => { secondStarted = true; });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    first.finish();
    await second.started;
    const verifyCalls = [
      { id: 'verify-command', name: 'shell_run', arguments: JSON.stringify({ command: 'npm test', mode: 'foreground' }) },
      { id: 'verify-complete', name: 'complete_task', arguments: JSON.stringify({ summary: 'Verification passed.', evidence: ['npm test passed'] }) },
    ];
    second.finish({ message: { role: 'assistant', content: '', tool_calls: verifyCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }, toolCalls: verifyCalls });
    await family.wait([implement.runId, verify.runId]);
    expect(maximum).toBe(1);
  });

  it('cascades parent cancellation and resolves waits as cancelled', async () => {
    const controller = new AbortController();
    const client = new DeferredClient();
    const family = coordinator([client], controller.signal);
    const child = await family.spawn({ taskId: 'cancel-me', role: 'explore', prompt: 'inspect cancellation' });
    await client.started;
    controller.abort(new DOMException('parent stopped', 'AbortError'));
    await expect(family.wait([child.runId])).resolves.toMatchObject([{ status: 'cancelled' }]);
  });

  it('returns a failed task notification when a child model fails', async () => {
    const family = coordinator([new FailingClient()]);
    const child = await family.spawn({ taskId: 'fails', role: 'explore', prompt: 'inspect failure' });
    await expect(family.wait([child.runId])).resolves.toMatchObject([{ status: 'failed', blockedReason: 'child model failed' }]);
  });

  it('queues parent messages, cancels queued work, and rejects foreign run IDs', async () => {
    const active = new DeferredClient();
    const family = coordinator([active]);
    const first = await family.spawn({ taskId: 'active', role: 'implement', prompt: 'inspect active' });
    const queued = await family.spawn({ taskId: 'queued', role: 'verify', prompt: 'inspect queued' });
    await active.started;
    await expect(family.message(first.runId, 'new fact')).resolves.toBe(true);
    await expect(family.message(queued.runId, 'queued fact')).resolves.toBe(true);
    await expect(family.stop(queued.runId)).resolves.toBe(true);
    await expect(family.wait([queued.runId])).resolves.toMatchObject([{ status: 'cancelled', usage: { modelTurns: 0, toolCalls: 0 } }]);
    await expect(family.stop(queued.runId)).resolves.toBe(false);
    await expect(family.message(queued.runId, 'too late')).resolves.toBe(false);
    await expect(family.stop('foreign')).resolves.toBe(false);
    await expect(family.wait(['foreign'])).rejects.toThrow('does not belong');
    active.finish();
    await family.wait([first.runId]);
    await expect(family.message(first.runId, 'too late')).resolves.toBe(false);
  });

  it('enforces depth and six-child limits', async () => {
    const nestedRun = { ...rootRun(), id: 'nested', rootRunId: 'root-run', parentRunId: 'root-run', depth: 1 as const, agentRole: 'explore' as const };
    await expect(coordinator([], new AbortController().signal, nestedRun).spawn({ taskId: 'nested', role: 'explore', prompt: 'inspect' })).rejects.toThrow('nested');

    const controller = new AbortController();
    const active = new DeferredClient();
    const family = coordinator([active], controller.signal);
    const children = [];
    for (let index = 0; index < 6; index += 1) children.push(await family.spawn({ taskId: `limit-${index}`, role: 'implement', prompt: `inspect ${index}` }));
    await expect(family.spawn({ taskId: 'limit-7', role: 'explore', prompt: 'inspect' })).rejects.toThrow('maximum of 6');
    controller.abort(new DOMException('stop family', 'AbortError'));
    await expect(family.wait(children.map((child) => child.runId))).resolves.toHaveLength(6);
  });

  it('reports blocked children and merges changed paths and evidence', async () => {
    const blockedFamily = coordinator([new ScriptedClient([tool('ask', 'ask_user', { question: 'Need input' })])]);
    const blocked = await blockedFamily.spawn({ taskId: 'blocked', role: 'explore', prompt: 'inspect blocked' });
    await expect(blockedFamily.wait([blocked.runId])).resolves.toMatchObject([{ status: 'blocked', blockedReason: 'Need input' }]);

    const implementation = new ScriptedClient([
      tool('patch', 'apply_patch', { changes: [{ path: 'src/new.ts', content: 'export {}' }] }),
      tool('finish', 'complete_task', { summary: 'implemented', evidence: ['file created'] }),
    ]);
    const family = coordinator([implementation]);
    const child = await family.spawn({ taskId: 'implementation', role: 'implement', prompt: 'inspect patch', writeScope: ['src'] });
    const [notification] = await family.wait([child.runId]);
    expect(notification?.summary).toBe('implemented');
    expect(notification).toMatchObject({ status: 'completed', changedPaths: ['src/new.ts'], evidence: ['file created'] });
  });
});
