import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import { createId } from '@/shared/lib/ids';
import type { AgentEventStore } from '../eventStore';
import type { SubagentHost } from '../tools/base';
import type { AgentEvent, AgentRun, DelegatedAgentTask, SubagentNotification, SubagentRole } from '../types';
import { createChaosContract } from '../prompt';
import { initialTask } from '../task';
import type { PiAgentFactory, PiSession, PiSessionOptions } from './piSession';
import { PI_CHILD_NO_DELEGATION } from './piToolAdapter';

/**
 * 子 agent 角色工具集（R4：自 engine.ts 迁出）。旧引擎删除后，这是 pi 通道的
 * 子 agent 工具子集唯一来源——不发明新子集，对齐原 CHILD_COMMON_TOOLS/CHILD_TASK_TOOLS。
 */
export const CHILD_COMMON_TOOLS = ['workspace_tree', 'read_file', 'search_workspace', 'list_resources', 'read_resource_text', 'read_resource_image', 'update_plan', 'report_progress', 'ask_parent', 'complete_task'];
export const CHILD_TASK_TOOLS = [...CHILD_COMMON_TOOLS, 'materialize_resource', 'run_command', 'manage_process', 'read_user_terminal'];

/**
 * P4 pi 通道子 agent 编排器：多 Agent 实例 + 并发池实现子 agent 委派。
 *
 * pi 框架（@earendil-works/pi-agent-core）没有原生子 agent API——子 agent 是
 * 一个独立的 pi Agent 实例（PiSession），由本编排器管理生命周期：
 * - `spawn`：创建子 run/任务，进入并发池；**并发上限 3**（对齐已删除的旧引擎
 *   AgentFamilyCoordinator 三路并发，见下历史说明），超限排队，前一个终态后启动；
 * - `wait`：逐条消费子 agent 生命周期通知（blocked/终态），对齐现有语义；
 * - `message`：向运行中的子 agent 注入父协调消息（pi Agent.steer 队列，
 *   当前 assistant turn 后注入）——R5 边界见下；
 * - `stop`/`stopAll`：abort 子 agent（pi Agent.abort）；根 signal abort → 全停；
 * - 通知：子 agent 事件桥 → `SubagentNotification`（对齐现有结构）。
 *
 * 历史说明（L1 终审组2）：旧引擎的 `AgentFamilyCoordinator`（subagentCoordinator.ts）
 * 已在 R4 删除，本模块是 pi 通道唯一实现——「并行实现」的表述不再成立，并发上限沿用
 * 旧引擎语义（三路并发）作向后兼容，不再有可对比的并行实现。
 *
 * 物理边界（TASK-P4）：两个 contracts 文件、UI、零新增依赖均不越界。
 *
 * R5 边界如实记录：
 * - **内存成本**：每个子 agent 都是一个独立 pi Agent 实例（完整转录 + 上下文窗口，
 *   常驻内存）；并发 3 意味着 3 个独立上下文同时占用。与现有引擎（子 agent 也是
 *   独立 AgentEngine，共享模型客户端但各自维护转录/预算）量级相当，但 pi Agent
 *   额外持有 pi Session 状态与事件订阅。若并发 3 出现内存压力，如实表现为子 agent
 *   提示输入变慢/页面卡顿，不做静默降级。
 * - **消息路由差异**：现有引擎的子 agent 在 `ask_parent` 后进入 `awaiting_parent`
 *   阻塞，`message_subagent` 通过 `messageFromParent` 唤醒同一 run；pi 的
 *   `ask_parent` 在适配层不设阻塞（见 piToolAdapter R4 说明），子 agent 是自治循环，
 *   因此 `message` 用 `steer()` 把消息排队到当前 turn 之后注入，而非唤醒阻塞。
 * - **changedPaths**：pi 事件桥已透传 tool_finished（PITOOLUI 修复），但 toAppToolResult 不设
 *   changedWorkspace，子通知的 changedPaths 保持为空；子 agent 的变更可通过完整任务门禁另行核对。
 * - **mutation 串行**：每个子 PiSession 自带独立 ContainerMutationLease，跨子 agent
 *   的并发写不共享根 lease 串行（现有引擎共享根 lease）。只读并发、写操作由运行时
 *   各自处理，写冲突风险如实保留。
 */

/** 并发上限：沿用旧引擎 AgentFamilyCoordinator 的「三路并发」语义（历史继承，见上）。 */
const MAX_CONCURRENT_SUBAGENTS = 3;
/** 每根 run 最大子 agent 数：对齐现有上限。 */
const MAX_CHILDREN_PER_ROOT = 6;

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** 子 agent 工具集：本文件的 CHILD_COMMON_TOOLS/CHILD_TASK_TOOLS（R4 迁入，不发明新子集）。 */
function childToolsForRole(role: SubagentRole): string[] {
  return role === 'explore' ? CHILD_COMMON_TOOLS : CHILD_TASK_TOOLS;
}

function statusFor(run: AgentRun): SubagentNotification['status'] {
  if (run.phase === 'completed') return 'completed';
  if (run.phase === 'cancelled') return 'cancelled';
  if (run.phase === 'awaiting_user' || run.phase === 'awaiting_parent') return 'blocked';
  if (run.phase === 'interrupted') return 'interrupted';
  return 'failed';
}

/** 子 agent 系统提示：父任务/父摘要作上下文，委派目标作为首条用户消息。 */
function childSystemPrompt(root: AgentRun, task: DelegatedAgentTask): string {
  return [
    'You are a delegated subagent working for a root coding assistant. Complete the delegated goal independently, use your tools as needed, and finish with a concise summary to the root agent.',
    `Parent task: ${root.task.objective}`,
    `Parent summary: ${root.summary || 'none'}`,
    `Delegated task id: ${task.taskId} (${task.role})`,
  ].join('\n');
}

export interface PiSubagentCoordinatorOptions {
  /** 根会话 ID（子 run 与子事件路由到同一 UI 会话）。 */
  sessionId: string;
  /** 根 run：模型/凭据/容器/预算/角色继承来源（R3）。 */
  root: AgentRun;
  apiKey: string;
  baseUrl: string;
  apiModel: string;
  /** 覆盖子 agent 系统提示模板；缺省按父上下文拼接。 */
  systemPrompt?: string;
  runtime: AgentWorkspaceRuntime;
  store?: AgentEventStore;
  /** capability 启用集（与根一致）；子 agent 工具集取其与角色子集的交集。 */
  enabledTools?: ReadonlySet<string>;
  containerAvailable?: boolean;
  /** 根 run 的中止信号：abort → 全部子 agent abort（父子取消级联）。 */
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  onRunChange: (run: AgentRun) => void;
  onChildrenPruned?: (runIds: string[]) => void;
  /** 测试注入：覆盖子 agent 的 pi Agent 构造（createAgent 透传自根）。 */
  createAgent?: PiAgentFactory;
  /**
   * 子 agent 会话工厂：由 root PiSession 注入 `(opts) => new PiSession(opts)`，
   * 避免 piSession ↔ piSubagentCoordinator 的静态循环依赖。
   */
  createSession: (options: PiSessionOptions) => PiSession;
}

interface QueuedChild {
  runId: string;
  task: DelegatedAgentTask & { role: SubagentRole };
  run: AgentRun;
  controller: AbortController;
  messages: string[];
  events: AgentEvent[];
  notifications: SubagentNotification[];
  resolveTerminal: () => void;
  terminalPromise: Promise<void>;
  terminalSettled: boolean;
  session?: PiSession;
  startedAt?: number;
  terminalSummary?: string;
  terminalError?: string;
  /** R6：子 agent 经 ask_parent/ask_user 阻塞等待父协调（会话保留，message() 恢复）。 */
  blocked?: boolean;
}

export class PiSubagentCoordinator implements SubagentHost {
  private readonly options: PiSubagentCoordinatorOptions;
  private readonly children = new Map<string, QueuedChild>();
  private readonly queue: QueuedChild[] = [];
  private readonly notificationWaiters = new Set<() => void>();
  private activeCount = 0;
  private cleanupPromise: Promise<string[]> | null = null;

  constructor(options: PiSubagentCoordinatorOptions) {
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
    if ((this.options.root.depth ?? 0) !== 0) throw new Error('Subagents cannot create nested subagents.');
    if (this.children.size >= MAX_CHILDREN_PER_ROOT) throw new Error(`This root run already created the maximum of ${MAX_CHILDREN_PER_ROOT} subagents.`);
    const root = this.options.root;
    if (this.options.store && !this.cleanupPromise) {
      this.cleanupPromise = this.options.store.pruneTerminalChildRuns(root.sessionId, root.rootRunId ?? root.id);
    }
    const prunedRunIds = this.cleanupPromise ? await this.cleanupPromise : [];
    if (prunedRunIds.length) this.options.onChildrenPruned?.(prunedRunIds);
    const runId = createId('r-child');
    const now = Date.now();
    const task: DelegatedAgentTask & { role: SubagentRole } = {
      id: createId('task'),
      taskId: input.taskId,
      sessionId: root.sessionId,
      rootRunId: root.rootRunId ?? root.id,
      parentRunId: root.id,
      runId,
      role: input.role,
      prompt: input.prompt,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      evidence: [],
      changedPaths: [],
      verificationRecords: [],
    };
    let resolveTerminal: () => void = () => undefined;
    const terminalPromise = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    const child: QueuedChild = {
      runId,
      task,
      run: this.buildChildRun(runId, task),
      controller: new AbortController(),
      messages: [],
      events: [],
      notifications: [],
      resolveTerminal,
      terminalPromise,
      terminalSettled: false,
    };
    this.children.set(runId, child);
    this.queue.push(child);
    await this.saveTask(task);
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
    if (!child || TERMINAL_STATUSES.has(child.task.status)) return false;
    child.task = { ...child.task, status: 'running', updatedAt: Date.now(), summary: `Root Agent guidance: ${message}` };
    await this.saveTask(child.task);
    if (child.blocked && child.session) {
      // R6：恢复阻塞等待的子 agent——阻塞时 loop 已结束（shouldStopAfterTurn），
      // 重新 prompt 启动新 loop，引导消息作为新 user 消息进入转录。
      child.blocked = false;
      void this.resumeBlockedChild(child, message);
      return true;
    }
    if (child.session) {
      // 活跃子 agent：steer 把消息排队到当前 assistant turn 之后注入。
      child.session.steer(message);
    } else {
      // 尚未启动（排队中）：入队，启动后注入。
      child.messages.push(message);
    }
    return true;
  }

  async stop(runId: string): Promise<boolean> {
    const child = this.children.get(runId);
    if (!child || TERMINAL_STATUSES.has(child.task.status)) return false;
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

  async stopAll(): Promise<void> {
    await Promise.all([...this.children.keys()].map((runId) => this.stop(runId)));
    await Promise.all([...this.children.values()].map((child) => child.terminalPromise));
  }

  private buildChildRun(runId: string, task: DelegatedAgentTask & { role: SubagentRole }): AgentRun {
    const root = this.options.root;
    const now = Date.now();
    const roleTools = childToolsForRole(task.role);
    const allowedTools = this.options.enabledTools
      ? roleTools.filter((name) => this.options.enabledTools!.has(name))
      : roleTools;
    return {
      id: runId,
      sessionId: root.sessionId,
      containerId: root.containerId,
      model: root.model,
      persona: root.persona,
      phase: 'preparing',
      createdAt: now,
      updatedAt: now,
      task: initialTask(task.prompt),
      chaos: createChaosContract(root.persona),
      budget: { ...root.budget },
      modelTurns: 0,
      toolCalls: 0,
      summary: '',
      rootRunId: root.rootRunId ?? root.id,
      parentRunId: root.id,
      agentRole: task.role,
      delegatedTaskId: task.id,
      depth: 1,
      toolPolicy: { role: task.role, allowedTools },
    };
  }

  private pump(): void {
    while (this.activeCount < MAX_CONCURRENT_SUBAGENTS && this.queue.length > 0) this.start(this.queue.shift()!);
  }

  private start(child: QueuedChild): void {
    this.activeCount += 1;
    void this.executeChild(child)
      .catch((error) => this.finishUnexpectedFailure(child, error))
      .finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
  }

  private async executeChild(child: QueuedChild): Promise<void> {
    child.startedAt = Date.now();
    child.task = { ...child.task, status: 'running', updatedAt: child.startedAt };
    await this.saveTask(child.task);
    const session = this.createChildSession(child);
    child.session = session;
    // 父协调消息在启动前已到达：启动后立即注入（steer 队列，当前 turn 后生效）。
    for (const message of child.messages) session.steer(message);
    child.messages = [];
    try {
      await session.prompt(child.task.prompt);
    } finally {
      // R6：阻塞等待父协调的子 agent（ask_parent/ask_user）保留会话，供 message() 恢复；
      // 终态子 agent 立即销毁（解除订阅与外部信号转发；已完成运行上 abort 为 no-op）。
      if (child.run.phase !== 'awaiting_parent' && child.run.phase !== 'awaiting_user') {
        session.destroy();
        if (child.session === session) delete child.session;
      }
    }
    if (child.run.phase === 'awaiting_parent' || child.run.phase === 'awaiting_user') {
      await this.publishBlocked(child);
      return;
    }
    await this.finishChild(child, await this.terminalNotification(child));
  }

  /** R6：子 agent 阻塞等待父协调——发布 blocked 通知但不结算终态（不设 terminalSettled）。 */
  private async publishBlocked(child: QueuedChild): Promise<void> {
    // 阻塞摘要取 ask_parent/ask_user 的问题文本（桥接已把问题作为 assistant 消息发出）。
    const question = [...child.events].reverse().find((event): event is Extract<AgentEvent, { kind: 'message'; message: { role: string; content: unknown } }> =>
      event.kind === 'message' && event.message.role === 'assistant');
    if (question && typeof question.message.content === 'string') child.terminalSummary = question.message.content;
    const notification = await this.terminalNotification(child);
    child.blocked = true;
    this.publish(child, notification);
  }

  /** R6：恢复阻塞子 agent——重新 prompt（引导消息作为新 user 消息进入转录），完成后结算终态。
   *  重新 prompt 以「委派目标 + 父引导」拼接为一条 user 消息：子 agent 转录已含委派目标
   *  （首条 user），但恢复轮仍以该目标开头（对齐父协调语义），引导作为追加指令同一轮送达。 */
  private async resumeBlockedChild(child: QueuedChild, message: string): Promise<void> {
    try {
      await child.session?.prompt(`${child.task.prompt}\n\nParent guidance: ${message}`);
    } catch (error) {
      this.finishUnexpectedFailure(child, error);
      return;
    } finally {
      child.session?.destroy();
      delete child.session;
    }
    await this.finishChild(child, await this.terminalNotification(child));
  }

  private createChildSession(child: QueuedChild): PiSession {
    const roleTools = childToolsForRole(child.task.role);
    const enabledTools = this.options.enabledTools
      ? new Set(roleTools.filter((name) => this.options.enabledTools!.has(name)))
      : new Set(roleTools);
    return this.options.createSession({
      apiKey: this.options.apiKey,
      baseUrl: this.options.baseUrl,
      apiModel: this.options.apiModel,
      systemPrompt: this.options.systemPrompt ?? childSystemPrompt(this.options.root, child.task),
      sessionId: this.options.sessionId,
      runId: child.run.id,
      run: child.run,
      signal: child.controller.signal,
      onEvent: (event) => this.forwardChildEvent(child, event),
      onRunChange: this.options.onRunChange,
      runtime: this.options.runtime,
      ...(this.options.store ? { store: this.options.store } : {}),
      enabledTools,
      ...(this.options.containerAvailable !== undefined ? { containerAvailable: this.options.containerAvailable } : {}),
      ...(this.options.createAgent ? { createAgent: this.options.createAgent } : {}),
      // 子 agent 不能再委派：subagent 工具不在子工具集内，host 用如实拒绝的哨兵兜底。
      subagents: PI_CHILD_NO_DELEGATION,
      // 子 run 不占独立 pi 会话：跳过会话仓库持久化，仅走 v3 事件路由（避免历史串扰）。
      persistSession: false,
    });
  }

  private forwardChildEvent(child: QueuedChild, event: AgentEvent): void {
    child.events.push(event);
    if (event.kind === 'run_finished') child.terminalSummary = event.summary;
    if (event.kind === 'run_failed') child.terminalError = event.error;
    this.options.onEvent(event);
  }

  private async terminalNotification(child: QueuedChild): Promise<SubagentNotification> {
    const run = child.run;
    const status = statusFor(run);
    const summary = child.terminalSummary ?? run.error ?? child.terminalError ?? 'Subagent finished without a summary.';
    const workspaceRevision = await this.currentWorkspaceRevision();
    const notification: SubagentNotification = {
      runId: child.runId,
      taskId: child.task.taskId,
      role: child.task.role,
      status,
      summary,
      evidence: [...run.task.evidence],
      changedPaths: this.changedPaths(child.events),
      verificationRecords: run.task.verificationEvidence.map((record) => ({ ...record })),
      workspaceRevision,
      usage: {
        modelTurns: run.modelTurns,
        toolCalls: run.toolCalls,
        durationMs: child.startedAt ? Date.now() - child.startedAt : 0,
        ...(run.modelUsage ? { estimatedTokens: run.modelUsage.totalTokens } : {}),
      },
      ...(status === 'blocked' || status === 'failed' ? { blockedReason: child.terminalError ?? run.error ?? child.task.blockedReason ?? 'Subagent could not complete its task.' } : {}),
    };
    return notification;
  }

  private async finishChild(child: QueuedChild, notification: SubagentNotification): Promise<void> {
    const { blockedReason: _blockedReason, ...finishedTask } = child.task;
    child.task = {
      ...finishedTask,
      status: notification.status,
      updatedAt: Date.now(),
      summary: notification.summary,
      evidence: notification.evidence,
      changedPaths: notification.changedPaths,
      verificationRecords: notification.verificationRecords,
      usage: notification.usage,
      ...(notification.blockedReason ? { blockedReason: notification.blockedReason } : {}),
    };
    await this.saveTask(child.task);
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
      workspaceRevision: await this.currentWorkspaceRevision(),
      usage: {
        modelTurns: child.run.modelTurns,
        toolCalls: child.run.toolCalls,
        durationMs: child.startedAt ? Date.now() - child.startedAt : 0,
        ...(child.run.modelUsage ? { estimatedTokens: child.run.modelUsage.totalTokens } : {}),
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
    try { await this.saveTask(child.task); }
    catch { /* 父 run 仍需要终态通知，持久化失败不阻断。 */ }
    child.terminalSettled = true;
    this.publish(child, notification);
    child.resolveTerminal();
  }

  private async finishQueuedCancellation(child: QueuedChild): Promise<void> {
    const notification: SubagentNotification = {
      runId: child.runId,
      taskId: child.task.taskId,
      role: child.task.role,
      status: 'cancelled',
      summary: 'Subagent cancelled before starting.',
      evidence: [],
      changedPaths: [],
      verificationRecords: [],
      workspaceRevision: await this.currentWorkspaceRevision(),
      usage: { modelTurns: 0, toolCalls: 0, durationMs: 0 },
    };
    child.task = { ...child.task, status: 'cancelled', summary: notification.summary, updatedAt: Date.now(), usage: notification.usage };
    await this.saveTask(child.task);
    child.terminalSettled = true;
    this.publish(child, notification);
    child.resolveTerminal();
  }

  private publish(child: QueuedChild, notification: SubagentNotification): void {
    child.notifications.push(notification);
    const waiters = [...this.notificationWaiters];
    this.notificationWaiters.clear();
    waiters.forEach((resolve) => resolve());
  }

  /** workspaceRevision 尽力而为：运行时就绪时取当前版本，否则 0（不因读版本失败阻断通知）。 */
  private async currentWorkspaceRevision(): Promise<number> {
    try {
      return await this.options.runtime.getWorkspaceRevision(this.options.root.containerId);
    } catch {
      return 0;
    }
  }

  private async saveTask(task: DelegatedAgentTask): Promise<void> {
    if (!this.options.store) return;
    await this.options.store.saveAgentTask(task);
  }
}
