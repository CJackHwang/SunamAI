import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage, AgentTool as PiAgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream, validateToolArguments } from '@earendil-works/pi-ai';
import type { Api, AssistantMessage, Context as PiContext, Message as PiMessage, Model } from '@earendil-works/pi-ai';
import { createPiAgentTools, PI_TOOL_CATALOG, PI_CHILD_NO_DELEGATION, resolveEnabledPiTools, UNWIRED_PI_RUNTIME } from '@/features/agent-core/pi/piToolAdapter';
import { PiSession, type PiAgentLike } from '@/features/agent-core/pi/piSession';
import type { AgentRun, TaskContract } from '@/features/agent-core/types';
import { ContainerMutationLease } from '@/features/agent-core/agentFamily';
import type { ToolExecutionContext, SubagentHost } from '@/features/agent-core/tools/base';
import type { AgentWorkspaceRuntime, ProcessStatus } from '@/shared/contracts/agentRuntime';
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

function assistantMessage(content: AssistantMessage['content'], stopReason: 'toolUse' | 'stop'): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: usage(),
    stopReason,
    timestamp: 1,
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
    budget: { maxModelTurns: 10, maxToolCalls: 20, maxDurationMs: 5 * 60_000 },
    modelTurns: 0,
    toolCalls: 0,
    summary: '',
    rootRunId: runId,
    agentRole: 'root',
    depth: 0,
    toolPolicy: { role: 'root', allowedTools: [] },
  };
}

/** 构造 mock AgentWorkspaceRuntime + 现有工具执行上下文（与 agentTools.test.ts 同形）。 */
function createHarness() {
  let task: TaskContract = initialTask('work');
  let workspaceRevision = 0;
  const runShell = vi.fn(async (request: { command: string }) => ({
    timedOut: false,
    process: { id: 'p-1', sessionId: 's1', runId: 'r1', containerId: 'c1', command: request.command, isRunning: false, output: 'ok', cursor: 2, exitCode: 0 } satisfies ProcessStatus,
  }));
  const runtime: AgentWorkspaceRuntime = {
    ensureContainer: vi.fn(async () => undefined),
    getWorkspaceRevision: vi.fn(async () => workspaceRevision),
    flushWorkspace: vi.fn(async () => undefined),
    flushSnapshots: vi.fn(async () => undefined),
    listResources: vi.fn(async () => []),
    readResourceText: vi.fn(async () => 'resource content'),
    readResourceImage: vi.fn(async () => ({ id: 'res-1', name: 'image.png', kind: 'image' as const, mimeType: 'image/png', size: 4, sha256: 'hash', createdAt: 1 })),
    materializeResource: vi.fn(async (_s, _c, _r, path) => { workspaceRevision += 1; return { path, kind: 'created' as const, beforeBytes: 0, afterBytes: 4 }; }),
    listWorkspace: vi.fn(async () => [{ path: 'a.ts', isDirectory: false }]),
    readWorkspaceFile: vi.fn(async () => 'content'),
    searchWorkspace: vi.fn(async () => [{ path: 'a.ts', line: 1, content: 'needle' }]),
    applyWorkspaceChanges: vi.fn(async () => { workspaceRevision += 1; return [{ path: 'a.ts', kind: 'updated' as const, beforeBytes: 1, afterBytes: 2 }]; }),
    runShell,
    observeProcess: vi.fn(() => null),
    sendProcessInput: vi.fn(async () => true),
    stopProcess: vi.fn(async () => true),
    stopRun: vi.fn(),
    getProcesses: vi.fn(() => []),
    subscribe: vi.fn(() => () => undefined),
    getUserTerminalBuffer: vi.fn(() => ''),
    appendUserTerminalBuffer: vi.fn(),
  };
  const context: ToolExecutionContext = {
    sessionId: 's1',
    runId: 'r1',
    containerId: 'c1',
    runtime,
    signal: new AbortController().signal,
    agentRole: 'root',
    mutationLease: new ContainerMutationLease(),
    getTask: () => task,
    updateTask: (updater: (current: TaskContract) => TaskContract) => { task = updater(task); },
  };
  return { runtime, context, runShell, getTask: () => task };
}

function piToolByName(tools: PiAgentTool[], name: string): PiAgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Pi tool ${name} not registered.`);
  return tool;
}

class FakePiAgent implements PiAgentLike {
  listener: ((event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>) | null = null;
  readonly promptInputs: string[] = [];
  abortCalls = 0;

  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  async prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void> {
    this.promptInputs.push(typeof input === 'string' ? input : JSON.stringify(input));
  }

  abort(): void { this.abortCalls += 1; }

  waitForIdle(): Promise<void> { return Promise.resolve(); }
}

describe('resolveEnabledPiTools (R3 capability gating)', () => {
  it('returns all 18 catalog tools when no allow-set is provided', () => {
    const tools = resolveEnabledPiTools(undefined);
    expect(tools).toHaveLength(18);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(18);
  });

  it('filters to the enabled capability set only', () => {
    const tools = resolveEnabledPiTools(new Set(['run_command', 'read_file']));
    expect(tools.map((tool) => tool.name).sort()).toEqual(['read_file', 'run_command']);
  });

  it('registers only the wrapped enabled tools through createPiAgentTools', () => {
    const enabled = resolveEnabledPiTools(new Set(['workspace_tree', 'ask_user']));
    const piTools = createPiAgentTools({ tools: enabled, getContext: () => createHarness().context });
    expect(piTools.map((tool) => tool.name).sort()).toEqual(['ask_user', 'workspace_tree']);
  });
});

describe('pi tool schema conversion (zod → TypeBox, handwritten)', () => {
  const harness = createHarness();
  const piTools = createPiAgentTools({ tools: PI_TOOL_CATALOG, getContext: () => harness.context });
  const byName = new Map(piTools.map((tool) => [tool.name, tool]));

  it('covers every catalog tool with a TypeBox parameters schema', () => {
    for (const tool of PI_TOOL_CATALOG) {
      const piTool = byName.get(tool.name);
      expect(piTool).toBeDefined();
      expect(piTool?.parameters).toBeDefined();
      expect(piTool?.label).toBe(tool.name);
      expect(piTool?.description).toBe(tool.description);
    }
  });

  it('accepts valid run_command args and rejects invalid ones', () => {
    const tool = byName.get('run_command')!;
    expect(validateToolArguments(tool, { id: 'c1', name: 'run_command', arguments: { command: 'ls', mode: 'foreground' }, type: 'toolCall' })).toEqual({ command: 'ls', mode: 'foreground' });
    expect(() => validateToolArguments(tool, { id: 'c1', name: 'run_command', arguments: { command: 'ls', mode: 'invalid' }, type: 'toolCall' })).toThrow();
    expect(() => validateToolArguments(tool, { id: 'c1', name: 'run_command', arguments: { command: '', mode: 'foreground' }, type: 'toolCall' })).toThrow();
  });

  it('applies the zod default for search_workspace max_results at execution time', async () => {
    const harness = createHarness();
    const piTools = createPiAgentTools({ tools: PI_TOOL_CATALOG, getContext: () => harness.context });
    const tool = piToolByName(piTools, 'search_workspace');
    // TypeBox 校验只要求形状；zod 的 .default(30) 在 execute 复用现有 schema 时生效。
    await tool.execute('c1', { query: 'needle' }, undefined);
    expect(harness.runtime.searchWorkspace).toHaveBeenCalledWith('c1', 'needle', 30);
  });

  it('rejects manage_process calls that violate cross-field rules via the wrapped zod schema', async () => {
    const tool = byName.get('manage_process')!;
    // TypeBox 只校验形状；superRefine 跨字段规则由 execute 复用的 zod schema 兜底。
    await expect(tool.execute('c1', { action: 'observe' }, undefined)).rejects.toThrow(/process_id is required/);
  });

  it('keeps spawn_subagent strict (additionalProperties: false)', () => {
    const tool = byName.get('spawn_subagent')!;
    expect(() => validateToolArguments(tool, { id: 'c1', name: 'spawn_subagent', arguments: { task_id: 't', role: 'explore', prompt: 'p', extra: 1 }, type: 'toolCall' })).toThrow();
  });
});

describe('pi tool execution (thin wrapper over existing implementations)', () => {
  it('passes run_command through to the existing implementation and maps content', async () => {
    const harness = createHarness();
    const piTools = createPiAgentTools({ tools: PI_TOOL_CATALOG, getContext: () => harness.context });
    const tool = piToolByName(piTools, 'run_command');
    const result = await tool.execute('call-1', { command: 'echo hi', mode: 'foreground' }, undefined);
    expect(harness.runShell).toHaveBeenCalledWith(expect.objectContaining({ command: 'echo hi', mode: 'foreground' }));
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Exit: 0') });
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('ok') });
    expect(result.details).toMatchObject({ id: 'p-1', command: 'echo hi' });
  });

  it('sets executionMode sequential for process tools and parallel for read-only tools', () => {
    const harness = createHarness();
    const piTools = createPiAgentTools({ tools: PI_TOOL_CATALOG, getContext: () => harness.context });
    expect(piToolByName(piTools, 'run_command').executionMode).toBe('sequential');
    expect(piToolByName(piTools, 'manage_process').executionMode).toBe('sequential');
    expect(piToolByName(piTools, 'materialize_resource').executionMode).toBe('sequential');
    expect(piToolByName(piTools, 'read_file').executionMode).toBe('parallel');
    expect(piToolByName(piTools, 'workspace_tree').executionMode).toBe('parallel');
    expect(piToolByName(piTools, 'search_workspace').executionMode).toBe('parallel');
  });

  it('throws instead of encoding ok:false into content (pi execution contract)', async () => {
    const harness = createHarness();
    const failing = {
      name: 'always_fails',
      description: 'fails',
      schema: z.object({}),
      readOnly: false,
      concurrencySafe: false,
      dataImpact: 'run' as const,
      timeoutMs: 5_000,
      resultType: 'control' as const,
      capability: { module: 'agent-runtime', defaultEnabled: true },
      execute: async () => ({ ok: false, content: 'cannot proceed' }),
    };
    const [piTool] = createPiAgentTools({ tools: [failing], getContext: () => harness.context });
    await expect(piTool!.execute('call-1', {}, undefined)).rejects.toThrow('cannot proceed');
  });

  it('throws when the runtime is not wired to the pi channel (UNWIRED_PI_RUNTIME boundary)', async () => {
    const harness = createHarness();
    const unwiredContext: ToolExecutionContext = { ...harness.context, runtime: UNWIRED_PI_RUNTIME };
    const piTools = createPiAgentTools({ tools: PI_TOOL_CATALOG, getContext: () => unwiredContext });
    const tool = piToolByName(piTools, 'run_command');
    await expect(tool.execute('call-1', { command: 'ls', mode: 'foreground' }, undefined)).rejects.toThrow(/no AgentWorkspaceRuntime is wired to the pi channel/);
  });
});

describe('pi Agent end-to-end tool round trip (mock LLM)', () => {
  it('lets the LLM call run_command echo and feeds the result back to continue the conversation', async () => {
    const harness = createHarness();
    const tools = createPiAgentTools({ tools: PI_TOOL_CATALOG, getContext: () => harness.context });
    const contexts: PiContext[] = [];
    let callCount = 0;
    const streamFn: StreamFn = (_model, context) => {
      contexts.push(context);
      callCount += 1;
      const stream = createAssistantMessageEventStream();
      if (callCount === 1) {
        const message = assistantMessage(
          [{ type: 'toolCall', id: 'call-1', name: 'run_command', arguments: { command: 'echo p3-e2e', mode: 'foreground' } }],
          'toolUse',
        );
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'done', reason: 'toolUse', message });
        stream.end(message);
      } else {
        const message = assistantMessage([{ type: 'text', text: 'command executed' }], 'stop');
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end(message);
      }
      return stream;
    };
    const model: Model<Api> = {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      api: 'openai-completions',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 4_096,
    };
    const agent = new Agent({
      streamFn,
      convertToLlm: (messages) => messages as PiMessage[],
      initialState: { model, systemPrompt: 'You are Sunam, a coding assistant.', thinkingLevel: 'off', tools },
      toolExecution: 'parallel',
    });

    await agent.prompt('run echo p3-e2e');

    expect(callCount).toBe(2);
    expect(harness.runShell).toHaveBeenCalledWith(expect.objectContaining({ command: 'echo p3-e2e' }));
    const second = contexts[1];
    expect(second).toBeDefined();
    const toolResult = second!.messages.find((message): message is Extract<PiAgentMessage, { role: 'toolResult' }> => message.role === 'toolResult');
    expect(toolResult).toBeDefined();
    expect(toolResult!.toolName).toBe('run_command');
    const text = toolResult!.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    expect(text).toContain('ok');
    // 对话继续：第二轮 streamFn 收到工具结果并产出最终回复。
    expect(second!.messages.some((message) => message.role === 'assistant' && (message as AssistantMessage).content.some((part) => part.type === 'text' && part.text === 'command executed'))).toBe(true);
  });
});

describe('PiSession tool wiring (R2)', () => {
  it('registers only the capability-enabled tools on the agent', async () => {
    const agent = new FakePiAgent();
    let capturedTools: PiAgentTool[] | undefined;
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun(),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: (input) => {
        capturedTools = input.tools;
        return agent;
      },
      enabledTools: new Set(['run_command', 'read_file']),
    });
    await session.prompt('hello');
    expect(capturedTools).toBeDefined();
    expect(capturedTools!.map((tool) => tool.name).sort()).toEqual(['read_file', 'run_command']);
    expect(agent.promptInputs).toEqual(['hello']);
    session.destroy();
  });

  it('injects orchestration context into control tools (update_plan writes back to the run task)', async () => {
    const agent = new FakePiAgent();
    let capturedTools: PiAgentTool[] | undefined;
    const runChanges: AgentRun[] = [];
    const run = createRun();
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run,
      onEvent: () => undefined,
      onRunChange: (next) => runChanges.push(next),
      createAgent: (input) => {
        capturedTools = input.tools;
        return agent;
      },
    });
    await session.prompt('ignored');
    const updatePlan = capturedTools!.find((tool) => tool.name === 'update_plan')!;
    const result = await updatePlan.execute('call-1', { items: [{ id: 'a', title: 'A', status: 'completed' }] }, undefined);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'Plan updated with 1 steps.' });
    expect(run.task.plan).toEqual([{ id: 'a', title: 'A', status: 'completed' }]);
    expect(runChanges.at(-1)?.task.plan).toEqual([{ id: 'a', title: 'A', status: 'completed' }]);
    session.destroy();
  });
});

describe('pi subagent host wiring (P4-R2)', () => {
  it('keeps the child-agent sentinel rejecting (children cannot delegate)', () => {
    expect(() => PI_CHILD_NO_DELEGATION.spawn({ taskId: 't', role: 'explore', prompt: 'p' })).toThrow(/allowed only from the root agent/);
    expect(() => PI_CHILD_NO_DELEGATION.wait(['r1'])).toThrow(/allowed only from the root agent/);
    expect(() => PI_CHILD_NO_DELEGATION.message('r1', 'hi')).toThrow(/allowed only from the root agent/);
    expect(PI_CHILD_NO_DELEGATION.snapshot()).toEqual([]);
  });

  it('injects the real subagent coordinator into the root pi session tool context', async () => {
    const agent = new FakePiAgent();
    let capturedTools: PiAgentTool[] | undefined;
    const session = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun(),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: (input) => {
        capturedTools = input.tools;
        return agent;
      },
    });
    await session.prompt('ignored');
    const spawn = capturedTools!.find((tool) => tool.name === 'spawn_subagent')!;
    const wait = capturedTools!.find((tool) => tool.name === 'wait_subagents')!;
    const message = capturedTools!.find((tool) => tool.name === 'message_subagent')!;
    expect(spawn).toBeDefined();
    expect(wait).toBeDefined();
    expect(message).toBeDefined();
    // 子 agent 三工具走真 host：spawn 不再抛「不支持」，而是排队创建子 agent。
    const result = await spawn.execute('call-1', { task_id: 't', role: 'explore', prompt: 'p' }, undefined);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('queued as explore') });
    expect(result.details).toMatchObject({ taskId: 't', status: 'queued' });
    expect(result.details).toHaveProperty('runId');
    session.destroy();
  });

  it('spawn_subagent routes to the injected coordinator (createCoordinator injection)', async () => {
    const agent = new FakePiAgent();
    let capturedTools: PiAgentTool[] | undefined;
    const spyHost: SubagentHost = {
      spawn: vi.fn(async () => ({ runId: 'r-child-1', taskId: 't', status: 'queued' })),
      wait: vi.fn(async () => []),
      message: vi.fn(async () => true),
      stop: vi.fn(async () => true),
      stopAll: vi.fn(async () => undefined),
      snapshot: vi.fn(() => []),
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
      createAgent: (input) => {
        capturedTools = input.tools;
        return agent;
      },
      createCoordinator: () => spyHost,
    });
    await session.prompt('ignored');
    const spawn = capturedTools!.find((tool) => tool.name === 'spawn_subagent')!;
    const result = await spawn.execute('call-1', { task_id: 't', role: 'explore', prompt: 'p' }, undefined);
    expect(spyHost.spawn).toHaveBeenCalledWith({ taskId: 't', role: 'explore', prompt: 'p' });
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('queued as explore') });
    expect(result.details).toMatchObject({ runId: 'r-child-1', taskId: 't', status: 'queued' });
    session.destroy();
  });
});
