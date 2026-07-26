import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import { createId } from '@/shared/lib/ids';
import type { SunamModel } from '@/shared/config/models';
import type { AgentEvent, AgentRole, AgentRun, DelegatedAgentTask, SubagentNotification } from './types';
import type { AgentModelClient } from './modelClient';
import type { AgentEventStore } from './eventStore';
import { AgentEngine } from './engine';
import type { SubagentHost } from './tools/base';
import type { AgentFamilyBudget, ContainerMutationLease } from './agentFamily';

interface FamilyRoot {
  getRun(): AgentRun;
  getFamilyBudget(): AgentFamilyBudget;
  getMutationLease(): ContainerMutationLease;
}

export interface CoordinatorOptions {
  root: FamilyRoot;
  persona: SunamModel;
  model: string;
  runtime: AgentWorkspaceRuntime;
  store: AgentEventStore;
  signal: AbortSignal;
  createClient: () => AgentModelClient;
  onEvent: (event: AgentEvent) => void;
  onRunChange: (run: AgentRun) => void;
}

interface QueuedChild {
  runId: string;
  task: DelegatedAgentTask;
  writeScope: string[] | undefined;
  controller: AbortController;
  messages: string[];
  resolve: (notification: SubagentNotification) => void;
  promise: Promise<SubagentNotification>;
  engine?: AgentEngine;
  startedAt?: number;
}

function statusFor(run: AgentRun): SubagentNotification['status'] {
  if (run.phase === 'completed') return 'completed';
  if (run.phase === 'cancelled') return 'cancelled';
  if (run.phase === 'awaiting_user') return 'blocked';
  if (run.phase === 'interrupted') return 'interrupted';
  return 'failed';
}

export class AgentFamilyCoordinator implements SubagentHost {
  private readonly options: CoordinatorOptions;
  private readonly children = new Map<string, QueuedChild>();
  private readonly queue: QueuedChild[] = [];
  private activeCount = 0;
  private activeExclusive = false;

  constructor(options: CoordinatorOptions) {
    this.options = options;
    options.signal.addEventListener('abort', () => { void this.stopAll(); }, { once: true });
  }

  snapshot(): string[] {
    return [...this.children.values()].map((child) => {
      const summary = child.task.summary ? ` — ${child.task.summary}` : '';
      return `- ${child.runId} [${child.task.role}/${child.task.status}] ${child.task.taskId}: ${child.task.prompt}${summary}`;
    });
  }

  async spawn(input: { taskId: string; role: Exclude<AgentRole, 'root'>; prompt: string; writeScope?: string[] }): Promise<{ runId: string; taskId: string; status: string }> {
    if ((this.options.root.getRun().depth ?? 0) !== 0) throw new Error('Subagents cannot create nested subagents.');
    if (this.children.size >= 6) throw new Error('This root run already created the maximum of 6 subagents.');
    const runId = createId('r-child');
    const now = Date.now();
    const task: DelegatedAgentTask = {
      id: createId('task'), taskId: input.taskId, sessionId: this.options.root.getRun().sessionId, rootRunId: this.options.root.getRun().rootRunId ?? this.options.root.getRun().id,
      parentRunId: this.options.root.getRun().id, runId, role: input.role, prompt: input.prompt, status: 'queued', createdAt: now, updatedAt: now,
      evidence: [], changedPaths: [], verificationRecords: [],
    };
    let resolve: (notification: SubagentNotification) => void = () => undefined;
    const promise = new Promise<SubagentNotification>((done) => { resolve = done; });
    const child: QueuedChild = { runId, task, writeScope: input.writeScope, controller: new AbortController(), messages: [], resolve, promise };
    this.children.set(runId, child);
    this.queue.push(child);
    await this.options.store.saveAgentTask(task);
    this.pump();
    return { runId, taskId: task.taskId, status: task.status };
  }

  async wait(runIds: string[]): Promise<SubagentNotification[]> {
    return Promise.all(runIds.map((runId) => {
      const child = this.children.get(runId);
      if (!child) throw new Error(`Subagent ${runId} does not belong to this root run.`);
      return child.promise;
    }));
  }

  async message(runId: string, message: string): Promise<boolean> {
    const child = this.children.get(runId);
    if (!child || ['completed', 'failed', 'cancelled', 'blocked', 'interrupted'].includes(child.task.status)) return false;
    if (child.engine) child.engine.messageFromParent(message);
    else child.messages.push(message);
    return true;
  }

  async stop(runId: string): Promise<boolean> {
    const child = this.children.get(runId);
    if (!child || ['completed', 'failed', 'cancelled', 'blocked', 'interrupted'].includes(child.task.status)) return false;
    child.controller.abort(new DOMException('Subagent stopped by parent.', 'AbortError'));
    const queuedIndex = this.queue.indexOf(child);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      await this.finishQueuedCancellation(child);
      this.pump();
    }
    return true;
  }

  private pump(): void {
    if (this.activeExclusive) return;
    const next = this.queue[0];
    if (!next) return;
    if (next.task.role !== 'explore') {
      if (this.activeCount === 0) this.start(this.queue.shift()!);
      return;
    }
    while (this.activeCount < 3 && this.queue[0]?.task.role === 'explore') this.start(this.queue.shift()!);
  }

  private start(child: QueuedChild): void {
    this.activeCount += 1;
    this.activeExclusive = child.task.role !== 'explore';
    void this.runChild(child)
      .catch((error) => this.finishUnexpectedFailure(child, error))
      .finally(() => {
        this.activeCount -= 1;
        if (child.task.role !== 'explore') this.activeExclusive = false;
        this.pump();
      });
  }

  private async runChild(child: QueuedChild): Promise<void> {
    child.startedAt = Date.now();
    child.task = { ...child.task, status: 'running', updatedAt: child.startedAt };
    await this.options.store.saveAgentTask(child.task);
    const root = this.options.root.getRun();
    const resources = await this.options.runtime.listResources(root.sessionId);
    const inheritedSummary = [
      `Parent task: ${root.task.objective}`,
      `Parent summary: ${root.summary || 'none'}`,
      `Workspace revision: ${root.task.workspaceRevision}`,
      `Evidence: ${root.task.evidence.join('; ') || 'none'}`,
      `Resource manifest: ${resources.map((resource) => `${resource.id}:${resource.name}:${resource.kind}`).join(', ') || 'none'}`,
      `Delegated goal: ${child.task.prompt}`,
    ].join('\n');
    const childEvents: AgentEvent[] = [];
    const engine = new AgentEngine({
      runId: child.runId, sessionId: root.sessionId, containerId: root.containerId, persona: this.options.persona, model: this.options.model,
      input: child.task.prompt, initialMessages: [], inheritedSummary, client: this.options.createClient(), runtime: this.options.runtime, store: this.options.store,
      signal: child.controller.signal, onEvent: (event) => { childEvents.push(event); this.options.onEvent(event); }, onRunChange: this.options.onRunChange,
      budget: { maxModelTurns: 20, maxToolCalls: 50, maxDurationMs: 5 * 60_000 }, familyBudget: this.options.root.getFamilyBudget(), mutationLease: this.options.root.getMutationLease(),
      lineage: { rootRunId: root.rootRunId ?? root.id, parentRunId: root.id, role: child.task.role, delegatedTaskId: child.task.id, depth: 1, ...(child.writeScope ? { writeScope: child.writeScope } : {}) },
    });
    child.engine = engine;
    child.messages.forEach((message) => engine.messageFromParent(message));
    await engine.execute();
    const run = engine.getRun();
    const changedPaths = childEvents.flatMap((event) => {
      if (event.kind !== 'tool_finished' || !event.result.changedWorkspace) return [];
      const data = event.result.data;
      if (Array.isArray(data)) return data.flatMap((item) => item && typeof item === 'object' && 'path' in item ? [String(item.path)] : []);
      return data && typeof data === 'object' && 'path' in data ? [String(data.path)] : [];
    });
    const notification: SubagentNotification = {
      runId: run.id, taskId: child.task.taskId, role: child.task.role, status: statusFor(run), summary: (run.finalSummary ?? run.error ?? run.summary) || 'Subagent finished without a summary.',
      evidence: [...run.task.evidence], changedPaths: [...new Set(changedPaths)], verificationRecords: [...run.task.verificationEvidence],
      workspaceRevision: await this.options.runtime.getWorkspaceRevision(root.containerId),
      usage: { modelTurns: run.modelTurns, toolCalls: run.toolCalls, durationMs: Date.now() - child.startedAt, ...(run.modelUsage ? { estimatedTokens: run.modelUsage.totalTokens } : {}) },
      ...(run.phase === 'awaiting_user' || run.phase === 'failed' ? { blockedReason: run.error ?? run.finalSummary ?? 'Subagent could not complete its task.' } : {}),
    };
    child.task = { ...child.task, status: notification.status, updatedAt: Date.now(), summary: notification.summary, evidence: notification.evidence, changedPaths: notification.changedPaths, verificationRecords: notification.verificationRecords, usage: notification.usage, ...(notification.blockedReason ? { blockedReason: notification.blockedReason } : {}) };
    await this.options.store.saveAgentTask(child.task);
    child.resolve(notification);
  }

  private async finishUnexpectedFailure(child: QueuedChild, error: unknown): Promise<void> {
    const summary = error instanceof Error ? error.message : String(error);
    const notification: SubagentNotification = {
      runId: child.runId,
      taskId: child.task.taskId,
      role: child.task.role,
      status: child.controller.signal.aborted ? 'cancelled' : 'failed',
      summary,
      evidence: [],
      changedPaths: [],
      verificationRecords: [],
      workspaceRevision: await this.options.runtime.getWorkspaceRevision(this.options.root.getRun().containerId),
      usage: {
        modelTurns: child.engine?.getRun().modelTurns ?? 0,
        toolCalls: child.engine?.getRun().toolCalls ?? 0,
        durationMs: child.startedAt ? Date.now() - child.startedAt : 0,
        ...(child.engine?.getRun().modelUsage ? { estimatedTokens: child.engine.getRun().modelUsage!.totalTokens } : {}),
      },
      blockedReason: summary,
    };
    child.task = {
      ...child.task,
      status: notification.status,
      summary,
      updatedAt: Date.now(),
      usage: notification.usage,
      blockedReason: summary,
    };
    try { await this.options.store.saveAgentTask(child.task); }
    catch { /* The parent still needs a terminal notification when persistence is unavailable. */ }
    child.resolve(notification);
  }

  private async finishQueuedCancellation(child: QueuedChild): Promise<void> {
    const notification: SubagentNotification = { runId: child.runId, taskId: child.task.taskId, role: child.task.role, status: 'cancelled', summary: 'Subagent cancelled before starting.', evidence: [], changedPaths: [], verificationRecords: [], workspaceRevision: await this.options.runtime.getWorkspaceRevision(this.options.root.getRun().containerId), usage: { modelTurns: 0, toolCalls: 0, durationMs: 0 } };
    child.task = { ...child.task, status: 'cancelled', summary: notification.summary, updatedAt: Date.now(), usage: notification.usage };
    await this.options.store.saveAgentTask(child.task);
    child.resolve(notification);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.children.keys()].map((runId) => this.stop(runId)));
    await Promise.all([...this.children.values()].map((child) => child.promise));
  }
}
