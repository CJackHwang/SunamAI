import { describe, expect, it, vi } from 'vitest';
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage, StreamFn } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, Message as PiMessage } from '@earendil-works/pi-ai';
import type { AgentWorkspaceRuntime, ProcessStatus, ShellRunRequest, ShellRunResult, WorkspaceTreeEntry } from '@/shared/contracts/agentRuntime';
import type { AgentRun } from '@/features/agent-core/types';
import { CHILD_COMMON_TOOLS, CHILD_TASK_TOOLS } from '@/features/agent-core/engine';
import { PiSession, type PiAgentFactory, type PiAgentLike } from '@/features/agent-core/pi/piSession';
import { PiSubagentCoordinator, type PiSubagentCoordinatorOptions } from '@/features/agent-core/pi/piSubagentCoordinator';

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

function assistantMessage(content: string, stopReason: 'stop' | 'aborted' | 'error' = 'stop'): Extract<PiAgentMessage, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: usage(),
    stopReason,
    ...(stopReason === 'error' ? { errorMessage: 'boom' } : {}),
    timestamp: 1,
  };
}

class RuntimeStub implements AgentWorkspaceRuntime {
  async ensureContainer(): Promise<void> {}
  async getWorkspaceRevision(): Promise<number> { return 0; }
  async flushWorkspace(): Promise<void> {}
  async flushSnapshots(): Promise<void> {}
  async listResources(): Promise<[]> { return []; }
  async readResourceText(): Promise<string> { return ''; }
  async readResourceImage() { return { id: 'r', name: 'i.png', kind: 'image' as const, mimeType: 'image/png', size: 1, sha256: 'h', createdAt: 1 }; }
  async materializeResource(_sessionId: string, _containerId: string, _resourceId: string, path: string) { return { path, kind: 'created' as const, beforeBytes: 0, afterBytes: 1 }; }
  async listWorkspace(): Promise<WorkspaceTreeEntry[]> { return []; }
  async readWorkspaceFile(): Promise<string> { return ''; }
  async searchWorkspace(): Promise<[]> { return []; }
  async applyWorkspaceChanges(_containerId: string, changes: Array<{ path: string; content: string }>) { return changes.map((change) => ({ path: change.path, kind: 'created' as const, beforeBytes: 0, afterBytes: change.content.length })); }
  async runShell(request: ShellRunRequest): Promise<ShellRunResult> { return { timedOut: false, process: { id: 'p', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: '', cursor: 0, exitCode: 0 } }; }
  observeProcess(): ProcessStatus | null { return null; }
  async sendProcessInput(): Promise<boolean> { return false; }
  async stopProcess(): Promise<boolean> { return false; }
  stopRun(): void {}
  getProcesses(): ProcessStatus[] { return []; }
  subscribe(): () => void { return () => undefined; }
  getUserTerminalBuffer(): string { return ''; }
  appendUserTerminalBuffer(): void {}
}

class FakePiAgent implements PiAgentLike {
  listener: ((event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>) | null = null;
  readonly promptInputs: string[] = [];
  readonly steered: string[] = [];
  abortCalls = 0;
  private readonly controller = new AbortController();
  private readonly promptGate: Promise<void>;
  private resolvePrompt: (() => void) | undefined;

  constructor() {
    this.promptGate = new Promise((resolve) => { this.resolvePrompt = resolve; });
  }

  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  async prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void> {
    this.promptInputs.push(typeof input === 'string' ? input : JSON.stringify(input));
    await this.promptGate;
  }

  steer(message: PiAgentMessage): void {
    const content = 'content' in message && typeof message.content === 'string' ? message.content : '';
    this.steered.push(content);
  }

  abort(): void { this.abortCalls += 1; this.controller.abort(); }

  waitForIdle(): Promise<void> { return Promise.resolve(); }

  finishPrompt(): void { this.resolvePrompt?.(); }

  async emit(event: PiAgentEvent): Promise<void> {
    await this.listener?.(event, this.controller.signal);
  }
}

function rootRun(): AgentRun {
  return {
    id: 'root-run',
    sessionId: 'session',
    containerId: 'c-container',
    model: 'deepseek-v4-flash',
    persona: 'Sunam 6.9 Pron',
    phase: 'acting',
    createdAt: 1,
    updatedAt: 1,
    task: { objective: 'Coordinate work', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
    chaos: { persona: 'Sunam 6.9 Pron', ritual: '', privateGoods: '', styleDirective: '', invariants: [] },
    budget: { maxModelTurns: 60, maxToolCalls: 150, maxDurationMs: 900_000 },
    modelTurns: 0,
    toolCalls: 0,
    summary: 'Parent facts',
    rootRunId: 'root-run',
    agentRole: 'root',
    depth: 0,
  };
}

function makeCoordinator(signal = new AbortController().signal, options: Partial<PiSubagentCoordinatorOptions> = {}) {
  const agents: FakePiAgent[] = [];
  const createdTools: string[][] = [];
  const coordinator = new PiSubagentCoordinator({
    sessionId: 'session',
    root: rootRun(),
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com/v1',
    apiModel: 'deepseek-v4-flash',
    runtime: new RuntimeStub(),
    signal,
    onEvent: () => undefined,
    onRunChange: () => undefined,
    createSession: (childOptions) => new PiSession({
      ...childOptions,
      createAgent: (input) => {
        const agent = new FakePiAgent();
        createdTools.push(input.tools.map((tool) => tool.name));
        agents.push(agent);
        return agent;
      },
    }),
    ...options,
  });
  return { coordinator, agents, createdTools };
}

/** 让子 agent 正常完成：agent_start → assistant → agent_end，再释放 prompt gate。 */
async function completeChild(agent: FakePiAgent, text = 'done'): Promise<void> {
  await agent.emit({ type: 'agent_start' });
  await agent.emit({ type: 'message_end', message: assistantMessage(text) });
  await agent.emit({ type: 'agent_end', messages: [assistantMessage(text)] });
  agent.finishPrompt();
}

describe('PiSubagentCoordinator', () => {
  it('runs at most three children concurrently and queues the fourth (limit 3)', async () => {
    const { coordinator, agents } = makeCoordinator();
    const results = await Promise.all([1, 2, 3, 4].map((i) => coordinator.spawn({ taskId: `t${i}`, role: 'explore', prompt: `task ${i}` })));
    expect(results.map((result) => result.status)).toEqual(['queued', 'queued', 'queued', 'queued']);
    await vi.waitFor(() => expect(agents.length).toBe(3));
    expect(coordinator.snapshot()).toHaveLength(4);
    // 第 4 个仍排队：snapshot 里可见 status queued。
    expect(coordinator.snapshot().some((line) => line.includes('queued'))).toBe(true);
  });

  it('starts the queued child after an active child finishes', async () => {
    const { coordinator, agents } = makeCoordinator();
    await Promise.all([1, 2, 3, 4].map((i) => coordinator.spawn({ taskId: `t${i}`, role: 'explore', prompt: `task ${i}` })));
    await vi.waitFor(() => expect(agents.length).toBe(3));
    await completeChild(agents[0]!);
    await vi.waitFor(() => expect(agents.length).toBe(4));
    expect(agents[3]!.promptInputs[0]).toContain('task 4');
  });

  it('wait returns the terminal notification for a completed child', async () => {
    const { coordinator, agents } = makeCoordinator();
    const { runId } = await coordinator.spawn({ taskId: 't1', role: 'explore', prompt: 'task 1' });
    await vi.waitFor(() => expect(agents.length).toBe(1));
    await completeChild(agents[0]!, 'all done');
    const notifications = await coordinator.wait([runId]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ runId, taskId: 't1', role: 'explore', status: 'completed' });
    expect(notifications[0]!.summary).toBe('all done');
  });

  it('rejects re-waiting after every notification has been reported', async () => {
    const { coordinator, agents } = makeCoordinator();
    const { runId } = await coordinator.spawn({ taskId: 't1', role: 'explore', prompt: 'task 1' });
    await vi.waitFor(() => expect(agents.length).toBe(1));
    await completeChild(agents[0]!);
    const first = await coordinator.wait([runId]);
    expect(first[0]!.status).toBe('completed');
    await expect(coordinator.wait([runId])).rejects.toThrow(/already been reported/);
  });

  it('message() steers an active child and queues guidance for a queued child', async () => {
    const { coordinator, agents } = makeCoordinator();
    const results = await Promise.all([1, 2, 3, 4].map((i) => coordinator.spawn({ taskId: `t${i}`, role: 'explore', prompt: `task ${i}` })));
    await vi.waitFor(() => expect(agents.length).toBe(3));
    // 活跃子 agent：立即 steer。
    expect(await coordinator.message(results[0]!.runId, 'active guidance')).toBe(true);
    await vi.waitFor(() => expect(agents[0]!.steered).toEqual(['active guidance']));
    // 排队子 agent：入队，启动后注入。
    expect(await coordinator.message(results[3]!.runId, 'queued guidance')).toBe(true);
    await completeChild(agents[0]!);
    await vi.waitFor(() => expect(agents.length).toBe(4));
    await vi.waitFor(() => expect(agents[3]!.steered).toEqual(['queued guidance']));
  });

  it('returns false when messaging a terminal child', async () => {
    const { coordinator, agents } = makeCoordinator();
    const { runId } = await coordinator.spawn({ taskId: 't1', role: 'explore', prompt: 'task 1' });
    await vi.waitFor(() => expect(agents.length).toBe(1));
    await completeChild(agents[0]!);
    await coordinator.wait([runId]);
    expect(await coordinator.message(runId, 'late')).toBe(false);
  });

  it('aborting the root signal cancels every child (parent-child cascade)', async () => {
    const controller = new AbortController();
    const { coordinator, agents } = makeCoordinator(controller.signal);
    const results = await Promise.all([1, 2, 3].map((i) => coordinator.spawn({ taskId: `t${i}`, role: 'explore', prompt: `task ${i}` })));
    await vi.waitFor(() => expect(agents.length).toBe(3));
    controller.abort();
    await vi.waitFor(() => expect(agents.every((agent) => agent.abortCalls >= 1)).toBe(true));
    for (let i = 0; i < 3; i += 1) {
      await agents[i]!.emit({ type: 'agent_start' });
      await agents[i]!.emit({ type: 'message_end', message: assistantMessage('', 'aborted') });
      await agents[i]!.emit({ type: 'agent_end', messages: [assistantMessage('', 'aborted')] });
      agents[i]!.finishPrompt();
    }
    const n1 = await coordinator.wait([results[0]!.runId]);
    const n2 = await coordinator.wait([results[0]!.runId, results[1]!.runId]);
    const n3 = await coordinator.wait([results[0]!.runId, results[1]!.runId, results[2]!.runId]);
    expect(n1[0]!.status).toBe('cancelled');
    expect(n2[0]!.status).toBe('cancelled');
    expect(n3[0]!.status).toBe('cancelled');
  });

  it('stop() cancels one child and lets siblings continue', async () => {
    const { coordinator, agents } = makeCoordinator();
    const results = await Promise.all([1, 2].map((i) => coordinator.spawn({ taskId: `t${i}`, role: 'explore', prompt: `task ${i}` })));
    await vi.waitFor(() => expect(agents.length).toBe(2));
    expect(await coordinator.stop(results[0]!.runId)).toBe(true);
    await agents[0]!.emit({ type: 'agent_start' });
    await agents[0]!.emit({ type: 'message_end', message: assistantMessage('', 'aborted') });
    await agents[0]!.emit({ type: 'agent_end', messages: [assistantMessage('', 'aborted')] });
    agents[0]!.finishPrompt();
    const stopped = await coordinator.wait([results[0]!.runId]);
    expect(stopped[0]!.status).toBe('cancelled');
    // 兄弟继续：仍可完成。
    await completeChild(agents[1]!);
    const sibling = await coordinator.wait([results[1]!.runId]);
    expect(sibling[0]!.status).toBe('completed');
  });

  it('stop() on a queued child cancels it before starting and pumps the next', async () => {
    const { coordinator, agents } = makeCoordinator();
    const results = await Promise.all([1, 2, 3, 4].map((i) => coordinator.spawn({ taskId: `t${i}`, role: 'explore', prompt: `task ${i}` })));
    await vi.waitFor(() => expect(agents.length).toBe(3));
    expect(await coordinator.stop(results[3]!.runId)).toBe(true);
    const stopped = await coordinator.wait([results[3]!.runId]);
    expect(stopped[0]!).toMatchObject({ runId: results[3]!.runId, status: 'cancelled' });
    expect(stopped[0]!.summary).toBe('Subagent cancelled before starting.');
    // 排队空位不被填充：并发池始终只有 3 个活跃。
    expect(agents.length).toBe(3);
  });

  it('wires the root PiSession abort signal into the coordinator (cascade through session)', async () => {
    const controller = new AbortController();
    const childAgents: FakePiAgent[] = [];
    const run = rootRun();
    let coordinator: PiSubagentCoordinator | undefined;
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: run.sessionId,
      runId: run.id,
      run,
      signal: controller.signal,
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createCoordinator: (deps) => {
        const child = new PiSubagentCoordinator({
          ...deps,
          createSession: (childOptions) => new PiSession({
            ...childOptions,
            createAgent: (_input) => {
              const fake = new FakePiAgent();
              childAgents.push(fake);
              return fake;
            },
          }),
        });
        coordinator = child;
        return child;
      },
    });
    const { runId } = await coordinator!.spawn({ taskId: 't1', role: 'explore', prompt: 'task 1' });
    await vi.waitFor(() => expect(childAgents.length).toBe(1));
    controller.abort();
    await vi.waitFor(() => expect(childAgents[0]!.abortCalls).toBeGreaterThanOrEqual(1));
    await childAgents[0]!.emit({ type: 'agent_start' });
    await childAgents[0]!.emit({ type: 'message_end', message: assistantMessage('', 'aborted') });
    await childAgents[0]!.emit({ type: 'agent_end', messages: [assistantMessage('', 'aborted')] });
    childAgents[0]!.finishPrompt();
    const notifications = await coordinator!.wait([runId]);
    expect(notifications[0]!.status).toBe('cancelled');
    session.destroy();
  });

  it('gives children the role-appropriate tool subset without delegation tools (R3)', async () => {
    const { coordinator, createdTools } = makeCoordinator();
    await coordinator.spawn({ taskId: 'e1', role: 'explore', prompt: 'read only' });
    await coordinator.spawn({ taskId: 't1', role: 'task', prompt: 'write' });
    await vi.waitFor(() => expect(createdTools.length).toBe(2));
    expect(new Set(createdTools[0])).toEqual(new Set(CHILD_COMMON_TOOLS));
    expect(new Set(createdTools[1])).toEqual(new Set(CHILD_TASK_TOOLS));
    expect(createdTools[0]).not.toContain('spawn_subagent');
    expect(createdTools[1]).not.toContain('wait_subagents');
    expect(createdTools[1]).not.toContain('message_subagent');
  });

  it('filters the child tool subset by the root enabledTools capability set', async () => {
    const { coordinator, createdTools } = makeCoordinator(new AbortController().signal, {
      enabledTools: new Set(['workspace_tree', 'read_file', 'run_command']),
    });
    await coordinator.spawn({ taskId: 't1', role: 'task', prompt: 'write' });
    await vi.waitFor(() => expect(createdTools.length).toBe(1));
    expect(new Set(createdTools[0])).toEqual(new Set(['workspace_tree', 'read_file', 'run_command']));
  });

  it('rejects nested spawns from a child run', async () => {
    const childRun = rootRun();
    childRun.depth = 1;
    childRun.agentRole = 'task';
    const childCoordinator = new PiSubagentCoordinator({
      sessionId: 'session',
      root: childRun,
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      runtime: new RuntimeStub(),
      signal: new AbortController().signal,
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createSession: (childOptions) => new PiSession({ ...childOptions }),
    });
    await expect(childCoordinator.spawn({ taskId: 't', role: 'explore', prompt: 'nested' })).rejects.toThrow(/cannot create nested subagents/);
  });
});

function e2eAssistant(content: AssistantMessage['content'], stopReason: 'toolUse' | 'stop'): AssistantMessage {
  return { role: 'assistant', content, api: 'openai-completions', provider: 'deepseek', model: 'deepseek-v4-flash', usage: usage(), stopReason, timestamp: 1 };
}

describe('PiSubagentCoordinator E2E (mock LLM through the real Agent loop)', () => {
  it('root agent spawns a child, wait_subagents receives its terminal notification, then completes', async () => {
    const childAgents: FakePiAgent[] = [];
    const streamCalls: PiAgentMessage[][] = [];
    let callCount = 0;
    const streamFn: StreamFn = (_model, context) => {
      streamCalls.push(context.messages);
      callCount += 1;
      const stream = createAssistantMessageEventStream();
      if (callCount === 1) {
        const message = e2eAssistant([{ type: 'toolCall', id: 'call-1', name: 'spawn_subagent', arguments: { task_id: 't1', role: 'explore', prompt: 'find facts' } }], 'toolUse');
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'done', reason: 'toolUse', message });
        stream.end(message);
      } else if (callCount === 2) {
        // 从上一轮的工具结果里取 spawn 返回的 runId（真实模型也会如此构造 wait 参数）。
        const spawnResult = [...context.messages].reverse().find((message): message is Extract<PiAgentMessage, { role: 'toolResult' }> => message.role === 'toolResult' && message.toolName === 'spawn_subagent');
        const runId = (spawnResult?.details as { runId?: string } | undefined)?.runId;
        const message = e2eAssistant([{ type: 'toolCall', id: 'call-2', name: 'wait_subagents', arguments: { run_ids: [runId] } }], 'toolUse');
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'done', reason: 'toolUse', message });
        stream.end(message);
      } else {
        const message = e2eAssistant([{ type: 'text', text: 'child completed' }], 'stop');
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
      }
      return stream;
    };
    const rootAgentFactory: PiAgentFactory = ({ model, systemPrompt, tools }) => {
      const agent = new Agent({
        streamFn,
        convertToLlm: (messages) => messages as PiMessage[],
        initialState: { model, systemPrompt, thinkingLevel: 'off', tools },
        toolExecution: 'parallel',
      });
      return {
        subscribe: (listener) => agent.subscribe(listener),
        prompt: (input) => (agent.prompt as (value: string | PiAgentMessage | PiAgentMessage[]) => Promise<void>)(input),
        abort: () => agent.abort(),
        waitForIdle: () => agent.waitForIdle(),
        seedHistory: (messages) => { agent.state.messages = messages; },
        steer: (message) => { agent.steer(message); },
      } satisfies PiAgentLike;
    };
    const run = rootRun();
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: run.sessionId,
      runId: run.id,
      run,
      runtime: new RuntimeStub(),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: rootAgentFactory,
      createCoordinator: (deps) => new PiSubagentCoordinator({
        ...deps,
        createSession: (childOptions) => new PiSession({
          ...childOptions,
          createAgent: (_input) => {
            const fake = new FakePiAgent();
            childAgents.push(fake);
            return fake;
          },
        }),
      }),
    });
    // wait_subagents 会阻塞根循环：测试在独立异步流里完成子 agent。
    const completer = (async () => {
      await vi.waitFor(() => expect(childAgents.length).toBe(1));
      await completeChild(childAgents[0]!, 'explored');
    })();
    await Promise.all([session.prompt('delegate work'), completer]);
    // 根 agent 经过 spawn → wait → 终轮，共三次 LLM 调用。
    expect(callCount).toBe(3);
    expect(childAgents).toHaveLength(1);
    // 第二轮上下文里携带了 wait 返回的通知 JSON（含子 agent 摘要）。
    const waitTurn = streamCalls[1];
    expect(waitTurn).toBeDefined();
    const waitText = waitTurn!.filter((message): message is Extract<PiAgentMessage, { role: 'toolResult' }> => message.role === 'toolResult')
      .map((message) => message.content.map((part) => part.type === 'text' ? part.text : '').join(''))
      .join('');
    expect(waitText).toContain('explored');
    session.destroy();
  });
});
