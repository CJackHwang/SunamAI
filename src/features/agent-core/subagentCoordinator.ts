import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import { createId } from '@/shared/lib/ids';
import type { SunamModel } from '@/shared/config/models';
import type { AgentEvent, AgentRun, DelegatedAgentTask, SubagentNotification, SubagentRole } from './types';
import type { AgentModelClient } from './modelClient';
import type { AgentEventStore } from './eventStore';
import { AgentEngine } from './engine';
import type { SubagentHost } from './tools/base';
import { AgentFamilyBudget, type ContainerMutationLease } from './agentFamily';

interface FamilyRoot {
  getRun(): AgentRun;
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
  onChildrenPruned?: (runIds: string[]) => void;
}

interface QueuedChild {
  runId: string;
  task: DelegatedAgentTask & { role: SubagentRole };
  writeScope: string[] | undefined;
  controller: AbortController;
  messages: string[];
  notifications: SubagentNotification[];
  resolveTerminal: () => void;
  terminalPromise: Promise<void>;
  terminalSettled: boolean;
  engine?: AgentEngine;
  startedAt?: number;
}

function statusFor(run: AgentRun): SubagentNotification['status'] {
  if (run.phase === 'completed') return 'completed';
  if (run.phase === 'cancelled') return 'cancelled';
  if (run.phase === 'awaiting_user' || run.phase === 'awaiting_parent') return 'blocked';
  if (run.phase === 'interrupted') return 'interrupted';
  return 'failed';
}

export class AgentFamilyCoordinator implements SubagentHost {
  private readonly options: CoordinatorOptions;
  private readonly children = new Map<string, QueuedChild>();
  private readonly queue: QueuedChild[] = [];
  private readonly notificationWaiters = new Set<() => void>();
  private activeCount = 0;
  private cleanupPromise: Promise<string[]> | null = null;

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

  async spawn(input: { taskId: string; role: SubagentRole; prompt: string; writeScope?: string[] }): Promise<{ runId: string; taskId: string; status: string }> {
    if ((this.options.root.getRun().depth ?? 0) !== 0) throw new Error('Subagents cannot create nested subagents.');
    if (this.children.size >= 6) throw new Error('This root run already created the maximum of 6 subagents.');
    const root = this.options.root.getRun();
    this.cleanupPromise ??= this.options.store.pruneTerminalChildRuns(root.sessionId, root.rootRunId ?? root.id);
    const prunedRunIds = await this.cleanupPromise;
    if (prunedRunIds.length) this.options.onChildrenPruned?.(prunedRunIds);
    const runId = createId('r-child');
    const now = Date.now();
    const task: DelegatedAgentTask & { role: SubagentRole } = {
      id: createId('task'), taskId: input.taskId, sessionId: this.options.root.getRun().sessionId, rootRunId: this.options.root.getRun().rootRunId ?? this.options.root.getRun().id,
      parentRunId: this.options.root.getRun().id, runId, role: input.role, prompt: input.prompt, status: 'queued', createdAt: now, updatedAt: now,
      evidence: [], changedPaths: [], verificationRecords: [],
    };
    let resolveTerminal: () => void = () => undefined;
    const terminalPromise = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    const child: QueuedChild = { runId, task, writeScope: input.writeScope, controller: new AbortController(), messages: [], notifications: [], resolveTerminal, terminalPromise, terminalSettled: false };
    this.children.set(runId, child);
    this.queue.push(child);
    await this.options.store.saveAgentTask(task);
    this.pump();
    return { runId, taskId: task.taskId, status: task.status };
  }

  async wait(runIds: string[]): Promise<SubagentNotification[]> {
    const children = runIds.map((runId) => {
      const child = this.children.get(runId);
      if (!child) throw new Error(`Subagent ${runId} does not belong to this root run.`);
      return child;
    });
    while (true) {
      for (const child of children) {
        const notification = child.notifications.shift();
        if (notification) return [notification];
      }
      if (children.every((child) => child.terminalSettled)) {
        throw new Error('Every requested subagent notification has already been reported.');
      }
      await new Promise<void>((resolve) => { this.notificationWaiters.add(resolve); });
    }
  }

  async message(runId: string, message: string): Promise<boolean> {
    const child = this.children.get(runId);
    if (!child || ['completed', 'failed', 'cancelled', 'interrupted'].includes(child.task.status)) return false;
    if (child.engine) {
      const { blockedReason: _blockedReason, ...activeTask } = child.task;
      child.task = { ...activeTask, status: 'running', updatedAt: Date.now(), summary: `Root Agent guidance: ${message}` };
      await this.options.store.saveAgentTask(child.task);
      child.engine.messageFromParent(message);
    }
    else child.messages.push(message);
    return true;
  }

  async stop(runId: string): Promise<boolean> {
    const child = this.children.get(runId);
    if (!child || ['completed', 'failed', 'cancelled', 'interrupted'].includes(child.task.status)) return false;
    child.controller.abort(new DOMException('Subagent stopped individually.', 'AbortError'));
    const queuedIndex = this.queue.indexOf(child);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      await this.finishQueuedCancellation(child);
      this.pump();
    }
    return true;
  }

  async stopAndWait(runId: string): Promise<boolean> {
    const child = this.children.get(runId);
    if (!child || !await this.stop(runId)) return false;
    await child.terminalPromise;
    return true;
  }

  private publish(child: QueuedChild, notification: SubagentNotification): void {
    child.notifications.push(notification);
    const waiters = [...this.notificationWaiters];
    this.notificationWaiters.clear();
    waiters.forEach((resolve) => resolve());
  }

  private pump(): void {
    while (this.activeCount < 3 && this.queue.length > 0) this.start(this.queue.shift()!);
  }

  private start(child: QueuedChild): void {
    this.activeCount += 1;
    void this.runChild(child)
      .catch((error) => this.finishUnexpectedFailure(child, error))
      .finally(() => {
        this.activeCount -= 1;
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
    const childBudget = { ...root.budget };
    let engine: AgentEngine;
    engine = new AgentEngine({
      runId: child.runId, sessionId: root.sessionId, containerId: root.containerId, persona: this.options.persona, model: this.options.model,
      input: child.task.prompt, initialMessages: [], inheritedSummary, client: this.options.createClient(), runtime: this.options.runtime, store: this.options.store,
      signal: child.controller.signal, onEvent: (event) => { childEvents.push(event); this.options.onEvent(event); }, onRunChange: this.options.onRunChange,
      budget: childBudget,
      familyBudget: new AgentFamilyBudget(childBudget.maxModelTurns, childBudget.maxToolCalls, childBudget.maxDurationMs),
      mutationLease: this.options.root.getMutationLease(),
      lineage: { rootRunId: root.rootRunId ?? root.id, parentRunId: root.id, role: child.task.role, delegatedTaskId: child.task.id, depth: 1, ...(child.writeScope ? { writeScope: child.writeScope } : {}) },
      onAwaitingParent: async (question) => {
        child.task = { ...child.task, status: 'blocked', updatedAt: Date.now(), summary: question, blockedReason: question };
        await this.options.store.saveAgentTask(child.task);
        const run = engine.getRun();
        this.publish(child, {
          runId: run.id,
          taskId: child.task.taskId,
          role: child.task.role,
          status: 'blocked',
          summary: question,
          evidence: [...run.task.evidence],
          changedPaths: [...new Set(this.changedPaths(childEvents))],
          verificationRecords: [...run.task.verificationEvidence],
          workspaceRevision: await this.options.runtime.getWorkspaceRevision(root.containerId),
          usage: { modelTurns: run.modelTurns, toolCalls: run.toolCalls, durationMs: Date.now() - (child.startedAt ?? Date.now()), ...(run.modelUsage ? { estimatedTokens: run.modelUsage.totalTokens } : {}) },
          blockedReason: question,
        });
      },
    });
    child.engine = engine;
    child.messages.forEach((message) => engine.messageFromParent(message));
    await engine.execute();
    const run = engine.getRun();
    const changedPaths = this.changedPaths(childEvents);
    const notification: SubagentNotification = {
      runId: run.id, taskId: child.task.taskId, role: child.task.role, status: statusFor(run), summary: (run.finalSummary ?? run.error ?? run.summary) || 'Subagent finished without a summary.',
      evidence: [...run.task.evidence], changedPaths: [...new Set(changedPaths)], verificationRecords: [...run.task.verificationEvidence],
      workspaceRevision: await this.options.runtime.getWorkspaceRevision(root.containerId),
      usage: { modelTurns: run.modelTurns, toolCalls: run.toolCalls, durationMs: Date.now() - child.startedAt, ...(run.modelUsage ? { estimatedTokens: run.modelUsage.totalTokens } : {}) },
      ...(run.phase === 'awaiting_user' || run.phase === 'awaiting_parent' || run.phase === 'failed' ? { blockedReason: run.error ?? run.finalSummary ?? child.task.blockedReason ?? 'Subagent could not complete its task.' } : {}),
    };
    const { blockedReason: _blockedReason, ...finishedTask } = child.task;
    child.task = { ...finishedTask, status: notification.status, updatedAt: Date.now(), summary: notification.summary, evidence: notification.evidence, changedPaths: notification.changedPaths, verificationRecords: notification.verificationRecords, usage: notification.usage, ...(notification.blockedReason ? { blockedReason: notification.blockedReason } : {}) };
    await this.options.store.saveAgentTask(child.task);
    child.terminalSettled = true;
    this.publish(child, notification);
    child.resolveTerminal();
  }

  private changedPaths(events: AgentEvent[]): string[] {
    return events.flatMap((event) => {
      if (event.kind !== 'tool_finished' || !event.result.changedWorkspace) return [];
      const data = event.result.data;
      if (Array.isArray(data)) return data.flatMap((item) => item && typeof item === 'object' && 'path' in item ? [String(item.path)] : []);
      return data && typeof data === 'object' && 'path' in data ? [String(data.path)] : [];
    });
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
    child.terminalSettled = true;
    this.publish(child, notification);
    child.resolveTerminal();
  }

  private async finishQueuedCancellation(child: QueuedChild): Promise<void> {
    const notification: SubagentNotification = { runId: child.runId, taskId: child.task.taskId, role: child.task.role, status: 'cancelled', summary: 'Subagent cancelled before starting.', evidence: [], changedPaths: [], verificationRecords: [], workspaceRevision: await this.options.runtime.getWorkspaceRevision(this.options.root.getRun().containerId), usage: { modelTurns: 0, toolCalls: 0, durationMs: 0 } };
    child.task = { ...child.task, status: 'cancelled', summary: notification.summary, updatedAt: Date.now(), usage: notification.usage };
    await this.options.store.saveAgentTask(child.task);
    child.terminalSettled = true;
    this.publish(child, notification);
    child.resolveTerminal();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.children.keys()].map((runId) => this.stop(runId)));
    await Promise.all([...this.children.values()].map((child) => child.terminalPromise));
  }
}
