import { describe, expect, it, vi } from 'vitest';
import type { AgentWorkspaceRuntime, ProcessOwnership, ProcessStatus, RuntimeProcessEvent, ShellRunRequest, ShellRunResult, WorkspaceTreeEntry } from '@/shared/contracts/agentRuntime';
import type { AgentModelClient } from '@/features/agent-core/modelClient';
import type { AgentModelResponse, AgentRun } from '@/features/agent-core/types';
import { ContainerMutationLease } from '@/features/agent-core/agentFamily';
import { AgentFamilyCoordinator } from '@/features/agent-core/subagentCoordinator';
import { AgentEventStore } from '@/features/agent-core/eventStore';

const plainResponse: AgentModelResponse = {
  message: { role: 'assistant', content: '', tool_calls: [{ id: 'deferred-finish', type: 'function', function: { name: 'complete_task', arguments: '{"summary":"Task inspected.","evidence":["Delegated task finished."]}' } }] },
  toolCalls: [{ id: 'deferred-finish', name: 'complete_task', arguments: '{"summary":"Task inspected.","evidence":["Delegated task finished."]}' }],
};

class RuntimeStub implements AgentWorkspaceRuntime {
  async ensureContainer(): Promise<void> {}
  async getWorkspaceRevision(): Promise<number> { return 0; }
  async flushWorkspace(): Promise<void> {}
  async flushSnapshots(): Promise<void> {}
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

function coordinator(clients: AgentModelClient[], signal = new AbortController().signal, run = rootRun(), store = new AgentEventStore(), onRunChange: (run: AgentRun) => void = () => undefined) {
  const lease = new ContainerMutationLease();
  return new AgentFamilyCoordinator({
    root: { getRun: () => run, getMutationLease: () => lease },
    persona: run.persona,
    model: run.model,
    runtime: new RuntimeStub(),
    store,
    signal,
    createClient: () => {
      const next = clients.shift();
      if (!next) throw new Error('No child client was prepared.');
      return next;
    },
    onEvent: () => undefined,
    onRunChange,
  });
}

describe('AgentFamilyCoordinator', () => {
  it('fails closed before creating a child when first-spawn cleanup fails', async () => {
    const cleanupError = new Error('cleanup transaction failed');
    const store = {
      pruneTerminalChildRuns: vi.fn(async () => { throw cleanupError; }),
      saveAgentTask: vi.fn(),
    } as unknown as AgentEventStore;
    const family = coordinator([new DeferredClient()], new AbortController().signal, rootRun(), store);

    await expect(family.spawn({ taskId: 'blocked-by-cleanup', role: 'explore', prompt: 'must not start' })).rejects.toThrow(cleanupError);
    await expect(family.spawn({ taskId: 'still-blocked', role: 'explore', prompt: 'must still not start' })).rejects.toThrow(cleanupError);

    expect(store.pruneTerminalChildRuns).toHaveBeenCalledOnce();
    expect(store.saveAgentTask).not.toHaveBeenCalled();
    expect(family.snapshot()).toEqual([]);
  });

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
    const runIds = spawned.map((child) => child.runId);
    const notifications = [];
    for (const _runId of runIds) notifications.push((await family.wait(runIds))[0]);
    expect(new Set(notifications.map((notification) => notification?.runId))).toEqual(new Set(runIds));
    expect(notifications.every((notification) => notification?.status === 'completed')).toBe(true);
  });

  it('gives each child the full root budget independently of exhausted root and sibling counters', async () => {
    const run = { ...rootRun(), budget: { maxModelTurns: 2, maxToolCalls: 1, maxDurationMs: 11_000 }, modelTurns: 2, toolCalls: 1 };
    const projected: AgentRun[] = [];
    const family = coordinator(
      [
        new ScriptedClient([tool('finish-one', 'complete_task', { summary: 'child one completed', evidence: ['one'] })]),
        new ScriptedClient([tool('finish-two', 'complete_task', { summary: 'child two completed', evidence: ['two'] })]),
      ],
      new AbortController().signal,
      run,
      new AgentEventStore(),
      (childRun) => projected.push(childRun),
    );

    const first = await family.spawn({ taskId: 'same-budget-one', role: 'explore', prompt: 'x' });
    const second = await family.spawn({ taskId: 'same-budget-two', role: 'explore', prompt: 'y' });
    const runIds = [first.runId, second.runId];
    const notifications = [...await family.wait(runIds), ...await family.wait(runIds)];
    expect(notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: first.runId, status: 'completed' }),
      expect.objectContaining({ runId: second.runId, status: 'completed' }),
    ]));
    const childRuns = projected.filter((candidate) => runIds.includes(candidate.id));
    expect(new Set(childRuns.map((candidate) => candidate.id))).toEqual(new Set(runIds));
    expect(childRuns.every((candidate) => candidate.budget.maxModelTurns === run.budget.maxModelTurns && candidate.budget.maxToolCalls === run.budget.maxToolCalls && candidate.budget.maxDurationMs === run.budget.maxDurationMs)).toBe(true);
  });

  it('runs mixed explore and task children concurrently', async () => {
    let active = 0;
    let maximum = 0;
    const first = new DeferredClient(() => { active += 1; maximum = Math.max(maximum, active); }, () => { active -= 1; });
    const second = new DeferredClient(() => { active += 1; maximum = Math.max(maximum, active); }, () => { active -= 1; });
    const family = coordinator([first, second]);
    const implement = await family.spawn({ taskId: 'write', role: 'task', prompt: 'inspect write task' });
    const verify = await family.spawn({ taskId: 'verify', role: 'task', prompt: 'inspect verification task' });
    await Promise.all([first.started, second.started]);
    first.finish();
    const verifyCalls = [
      { id: 'verify-command', name: 'shell_run', arguments: JSON.stringify({ command: 'npm test', mode: 'foreground' }) },
      { id: 'verify-complete', name: 'complete_task', arguments: JSON.stringify({ summary: 'Verification passed.', evidence: ['npm test passed'] }) },
    ];
    second.finish({ message: { role: 'assistant', content: '', tool_calls: verifyCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }, toolCalls: verifyCalls });
    const runIds = [implement.runId, verify.runId];
    await family.wait(runIds);
    await family.wait(runIds);
    expect(maximum).toBe(2);
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

  it('exposes individual and family-level cancellation methods', () => {
    const family = coordinator([]);
    expect(family.stop).toBeTypeOf('function');
    expect(family.stopAndWait).toBeTypeOf('function');
    expect(family.stopAll).toBeTypeOf('function');
  });

  it('returns a failed task notification when a child model fails', async () => {
    const family = coordinator([new FailingClient()]);
    const child = await family.spawn({ taskId: 'fails', role: 'explore', prompt: 'inspect failure' });
    await expect(family.wait([child.runId])).resolves.toMatchObject([{ status: 'failed', blockedReason: 'child model failed' }]);
  });

  it('queues parent messages and rejects foreign run IDs', async () => {
    const active = [new DeferredClient(), new DeferredClient(), new DeferredClient()];
    const queuedClient = new DeferredClient();
    const family = coordinator([...active, queuedClient]);
    const first = await family.spawn({ taskId: 'active-1', role: 'task', prompt: 'inspect active' });
    const second = await family.spawn({ taskId: 'active-2', role: 'explore', prompt: 'inspect active' });
    const third = await family.spawn({ taskId: 'active-3', role: 'task', prompt: 'inspect active' });
    await Promise.all(active.map((client) => client.started));
    const queued = await family.spawn({ taskId: 'queued', role: 'task', prompt: 'inspect queued' });
    await expect(family.message(first.runId, 'new fact')).resolves.toBe(true);
    await expect(family.message(queued.runId, 'queued fact')).resolves.toBe(true);
    await expect(family.wait(['foreign'])).rejects.toThrow('does not belong');
    active.forEach((client) => client.finish());
    await queuedClient.started;
    queuedClient.finish();
    await expect(family.wait([first.runId])).resolves.toMatchObject([{ status: 'completed' }]);
    await expect(family.wait([second.runId])).resolves.toMatchObject([{ status: 'completed' }]);
    await expect(family.wait([third.runId])).resolves.toMatchObject([{ status: 'completed' }]);
    await expect(family.wait([queued.runId])).resolves.toMatchObject([{ status: 'completed' }]);
    await expect(family.message(first.runId, 'too late')).resolves.toBe(false);
    await expect(family.message(queued.runId, 'too late')).resolves.toBe(false);
  });

  it('stops one child and waits for it without cancelling its sibling', async () => {
    const firstClient = new DeferredClient();
    const secondClient = new DeferredClient();
    const family = coordinator([firstClient, secondClient]);
    const first = await family.spawn({ taskId: 'first', role: 'explore', prompt: 'first' });
    const second = await family.spawn({ taskId: 'second', role: 'explore', prompt: 'second' });
    await Promise.all([firstClient.started, secondClient.started]);

    await expect(family.stopAndWait(first.runId)).resolves.toBe(true);
    await expect(family.wait([first.runId])).resolves.toMatchObject([{ status: 'cancelled' }]);
    let siblingFinished = false;
    const siblingNotification = family.wait([second.runId]).then((notifications) => { siblingFinished = true; return notifications; });
    await Promise.resolve();
    expect(siblingFinished).toBe(false);
    secondClient.finish();
    await expect(siblingNotification).resolves.toMatchObject([{ status: 'completed' }]);
    await expect(family.stopAndWait('foreign')).resolves.toBe(false);
  });

  it('enforces depth and six-child limits', async () => {
    const nestedRun = { ...rootRun(), id: 'nested', rootRunId: 'root-run', parentRunId: 'root-run', depth: 1 as const, agentRole: 'explore' as const };
    await expect(coordinator([], new AbortController().signal, nestedRun).spawn({ taskId: 'nested', role: 'explore', prompt: 'inspect' })).rejects.toThrow('nested');

    const controller = new AbortController();
    const active = new DeferredClient();
    const family = coordinator([active], controller.signal);
    const children = [];
    for (let index = 0; index < 6; index += 1) children.push(await family.spawn({ taskId: `limit-${index}`, role: 'task', prompt: `inspect ${index}` }));
    await expect(family.spawn({ taskId: 'limit-7', role: 'explore', prompt: 'inspect' })).rejects.toThrow('maximum of 6');
    controller.abort(new DOMException('stop family', 'AbortError'));
    const runIds = children.map((child) => child.runId);
    const notifications = [];
    for (const _child of children) notifications.push(...await family.wait(runIds));
    expect(notifications).toHaveLength(6);
    await expect(family.wait(runIds)).rejects.toThrow('already been reported');
  });

  it('reports one completed child without changing or completing its running sibling', async () => {
    const firstClient = new DeferredClient();
    const secondClient = new DeferredClient();
    const family = coordinator([firstClient, secondClient]);
    const first = await family.spawn({ taskId: 'first-result', role: 'task', prompt: 'first result' });
    const second = await family.spawn({ taskId: 'second-result', role: 'task', prompt: 'second result' });
    await Promise.all([firstClient.started, secondClient.started]);

    firstClient.finish();
    await expect(family.wait([first.runId, second.runId])).resolves.toMatchObject([{ runId: first.runId, status: 'completed' }]);
    expect(family.snapshot()).toEqual(expect.arrayContaining([
      expect.stringContaining(`[task/completed] ${first.taskId}`),
      expect.stringContaining(`[task/running] ${second.taskId}`),
    ]));

    let remainingReported = false;
    const remaining = family.wait([first.runId, second.runId]).then((notifications) => { remainingReported = true; return notifications; });
    await Promise.resolve();
    expect(remainingReported).toBe(false);
    secondClient.finish();
    await expect(remaining).resolves.toMatchObject([{ runId: second.runId, status: 'completed' }]);
  });

  it('routes ask_parent to the root and resumes the same child after parent guidance', async () => {
    let resolveAwaiting: (() => void) | undefined;
    const awaiting = new Promise<void>((resolve) => { resolveAwaiting = resolve; });
    const blockedFamily = coordinator([
      new ScriptedClient([
        tool('ask-parent', 'ask_parent', { question: 'Which target should I inspect?' }),
        tool('finish-after-parent', 'complete_task', { summary: 'Parent guidance applied.', evidence: ['Inspected the requested target.'] }),
      ]),
    ], new AbortController().signal, rootRun(), new AgentEventStore(), (run) => { if (run.phase === 'awaiting_parent') resolveAwaiting?.(); });
    const blocked = await blockedFamily.spawn({ taskId: 'blocked', role: 'explore', prompt: 'inspect blocked' });
    await awaiting;
    expect(blockedFamily.snapshot()).toEqual([expect.stringContaining('[explore/blocked]')]);
    await expect(blockedFamily.wait([blocked.runId])).resolves.toMatchObject([{
      runId: blocked.runId,
      status: 'blocked',
      summary: 'Which target should I inspect?',
      blockedReason: 'Which target should I inspect?',
    }]);
    await expect(blockedFamily.message(blocked.runId, 'Inspect the mobile composer.')).resolves.toBe(true);
    await expect(blockedFamily.wait([blocked.runId])).resolves.toMatchObject([{ status: 'completed', summary: 'Parent guidance applied.' }]);
    await expect(blockedFamily.wait([blocked.runId])).rejects.toThrow('already been reported');
  });

  it('cancels an awaiting_parent child only when its parent family is cancelled', async () => {
    const controller = new AbortController();
    let resolveAwaiting: (() => void) | undefined;
    const awaiting = new Promise<void>((resolve) => { resolveAwaiting = resolve; });
    const family = coordinator([
      new ScriptedClient([tool('ask-parent-before-cancel', 'ask_parent', { question: 'Need parent direction.' })]),
    ], controller.signal, rootRun(), new AgentEventStore(), (run) => { if (run.phase === 'awaiting_parent') resolveAwaiting?.(); });
    const child = await family.spawn({ taskId: 'waiting-child', role: 'explore', prompt: 'wait for parent' });
    await awaiting;
    await expect(family.wait([child.runId])).resolves.toMatchObject([{ status: 'blocked' }]);

    controller.abort(new DOMException('parent stopped', 'AbortError'));

    await expect(family.wait([child.runId])).resolves.toMatchObject([{ status: 'cancelled' }]);
  });

  it('merges child changed paths and evidence', async () => {
    const implementation = new ScriptedClient([
      tool('patch', 'apply_patch', { changes: [{ path: 'src/new.ts', content: 'export {}' }] }),
      tool('finish', 'complete_task', { summary: 'implemented', evidence: ['file created'] }),
    ]);
    const family = coordinator([implementation]);
    const child = await family.spawn({ taskId: 'implementation', role: 'task', prompt: 'inspect patch', writeScope: ['src'] });
    const [notification] = await family.wait([child.runId]);
    expect(notification?.summary).toBe('implemented');
    expect(notification).toMatchObject({ status: 'completed', changedPaths: ['src/new.ts'], evidence: ['file created'], verificationRecords: [] });
  });
});
