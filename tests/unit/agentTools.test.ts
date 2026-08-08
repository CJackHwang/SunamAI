import { describe, expect, it, vi } from 'vitest';
import { processTools } from '@/features/agent-core/tools/processTools';
import { controlTools } from '@/features/agent-core/tools/controlTools';
import { workspaceTools } from '@/features/agent-core/tools/workspaceTools';
import { resourceTools } from '@/features/agent-core/tools/resourceTools';
import { ContainerMutationLease } from '@/features/agent-core/mutationLease';
import { initialTask } from '@/features/agent-core/task';
import type { ToolExecutionContext, RegisteredTool } from '@/features/agent-core/tools/base';
import type { AgentWorkspaceRuntime, ProcessStatus, RuntimeResourceDescriptor } from '@/shared/contracts/agentRuntime';
import type { TaskContract } from '@/features/agent-core/types';

function makeProcess(overrides: Partial<ProcessStatus> = {}): ProcessStatus {
  return {
    id: 'p-1',
    sessionId: 's1',
    runId: 'r1',
    containerId: 'c1',
    command: 'echo hi',
    isRunning: false,
    output: 'ok',
    cursor: 2,
    ...overrides,
  };
}

interface HarnessOptions {
  agentRole?: ToolExecutionContext['agentRole'];
  containerAvailable?: boolean;
  shellAvailable?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  let task: TaskContract = initialTask('work');
  let workspaceRevision = 0;
  const processes: ProcessStatus[] = [];

  const runShell = vi.fn(async (request: { command: string; mode: string }) => ({
    timedOut: false,
    process: makeProcess({ command: request.command, exitCode: 0 }),
  }));
  const observeProcess = vi.fn((processId: string) => processes.find((process) => process.id === processId) ?? null);
  const stopProcess = vi.fn(async () => true);
  const listWorkspace = vi.fn(async (): Promise<Array<{ path: string; isDirectory: boolean }>> => [{ path: 'a.ts', isDirectory: false }]);
  const readWorkspaceFile = vi.fn(async () => 'file content');
  const searchWorkspace = vi.fn(async (): Promise<Array<{ path: string; line: number; content: string }>> => [{ path: 'a.ts', line: 3, content: 'needle' }]);
  const listResources = vi.fn(async (): Promise<RuntimeResourceDescriptor[]> => []);
  const readResourceText = vi.fn(async () => 'resource text');
  const readResourceImage = vi.fn(async () => ({ id: 'res-1', name: 'image.png', kind: 'image' as const, mimeType: 'image/png', size: 4, sha256: 'hash', createdAt: 1 }));
  const materializeResource = vi.fn(async () => { workspaceRevision += 1; return { path: 'out.txt', kind: 'created' as const, beforeBytes: 0, afterBytes: 4 }; });
  const getWorkspaceRevision = vi.fn(async () => workspaceRevision);
  const getUserTerminalBuffer = vi.fn(() => '');

  const runtime: AgentWorkspaceRuntime = {
    ensureContainer: vi.fn(async () => undefined),
    getWorkspaceRevision,
    flushWorkspace: vi.fn(async () => undefined),
    flushSnapshots: vi.fn(async () => undefined),
    listResources,
    readResourceText,
    readResourceImage,
    materializeResource,
    listWorkspace,
    readWorkspaceFile,
    searchWorkspace,
    applyWorkspaceChanges: vi.fn(async () => []),
    runShell,
    observeProcess,
    sendProcessInput: vi.fn(async () => true),
    stopProcess,
    stopRun: vi.fn(),
    getProcesses: vi.fn(() => [...processes]),
    subscribe: vi.fn(() => () => undefined),
    getUserTerminalBuffer,
    appendUserTerminalBuffer: vi.fn(),
  };

  const context: ToolExecutionContext = {
    sessionId: 's1',
    runId: 'r1',
    containerId: 'c1',
    runtime,
    signal: new AbortController().signal,
    agentRole: options.agentRole ?? 'root',
    ...(options.containerAvailable !== undefined ? { containerAvailable: options.containerAvailable } : {}),
    ...(options.shellAvailable !== undefined ? { shellAvailable: options.shellAvailable } : {}),
    mutationLease: new ContainerMutationLease(),
    getTask: () => task,
    updateTask: (updater: (current: TaskContract) => TaskContract) => { task = updater(task); },
  };

  return {
    runtime,
    context,
    runShell,
    observeProcess,
    stopProcess,
    listWorkspace,
    readWorkspaceFile,
    searchWorkspace,
    listResources,
    getUserTerminalBuffer,
    getTask: () => task,
    setTask: (next: TaskContract) => { task = next; },
    processes,
  };
}

function toolByName(tools: RegisteredTool[], name: string): RegisteredTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool ${name} not found.`);
  return tool;
}

describe('run_command (processTools)', () => {
  it('executes a foreground command and records a successful verification', async () => {
    const { runtime, context, getTask } = createHarness();
    const tool = toolByName(processTools, 'run_command');
    const result = await tool.execute({ command: 'echo hi', mode: 'foreground' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Exit: 0');
    expect(result.content).toContain('Agent process ID: p-1');
    expect(runtime.runShell).toHaveBeenCalledWith(expect.objectContaining({ command: 'echo hi', mode: 'foreground', containerId: 'c1' }));
    expect(result.verification).toEqual({ command: 'echo hi', passed: true });
    const task = getTask();
    expect(task.verified).toBe(true);
    expect(task.verifiedRevision).toBe(0);
    expect(task.evidence).toContain('Verified: echo hi');
    expect(task.verificationEvidence[0]).toMatchObject({ command: 'echo hi', passed: true });
  });

  it('forwards timeout_ms and an abort signal to the runtime', async () => {
    const { runtime, context } = createHarness();
    const tool = toolByName(processTools, 'run_command');
    const signal = new AbortController().signal;
    await tool.execute({ command: 'sleep 1', mode: 'foreground', timeout_ms: 30_000 }, { ...context, signal });
    expect(runtime.runShell).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 30_000, signal }));
  });

  it('marks a non-zero exit as failed verification', async () => {
    const { runShell, context, getTask } = createHarness();
    runShell.mockResolvedValueOnce({ timedOut: false, process: makeProcess({ exitCode: 1, output: 'boom' }) });
    const tool = toolByName(processTools, 'run_command');
    const result = await tool.execute({ command: 'false', mode: 'foreground' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Exit: 1');
    expect(result.verification).toEqual({ command: 'false', passed: false });
    const task = getTask();
    expect(task.verified).toBe(false);
    expect(task.verifiedRevision).toBe(-1);
    expect(task.evidence).toContain('Failed verification: false');
  });

  it('reports a timed-out command without verification', async () => {
    const { runShell, context } = createHarness();
    runShell.mockResolvedValueOnce({ timedOut: true, process: makeProcess({ isRunning: true }) });
    const tool = toolByName(processTools, 'run_command');
    const result = await tool.execute({ command: 'slow', mode: 'foreground' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Command still running after timeout.');
    expect(result.verification).toEqual({ command: 'slow', passed: false });
  });

  it('runs a background command without verification and flags changedWorkspace', async () => {
    const { runShell, context, getTask } = createHarness();
    runShell.mockResolvedValueOnce({ timedOut: false, process: makeProcess({ isRunning: true, output: 'listening' }) });
    const tool = toolByName(processTools, 'run_command');
    const result = await tool.execute({ command: 'serve', mode: 'background' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Exit: running');
    expect(result.verification).toBeUndefined();
    expect(getTask().verified).toBe(false);
  });
});

describe('manage_process (processTools)', () => {
  it('lists processes as JSON summaries without the output tail in data', async () => {
    const { processes, context } = createHarness();
    processes.push(makeProcess({ id: 'p-1', command: 'echo hi', isRunning: true }));
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'list' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('p-1');
    expect(result.content).toContain('echo hi');
    const data = result.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]).not.toHaveProperty('outputTail');
    expect(data[0]).toMatchObject({ processId: 'p-1', command: 'echo hi', isRunning: true });
  });

  it('returns an empty listing message when no processes exist', async () => {
    const { context } = createHarness();
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'list' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('(no running Agent processes in this session and container)');
    expect(result.data).toEqual([]);
  });

  it('scopes root process listing to session + container only', async () => {
    const { runtime, context } = createHarness();
    const tool = toolByName(processTools, 'manage_process');
    await tool.execute({ action: 'list' }, context);
    expect(runtime.getProcesses).toHaveBeenCalledWith({ sessionId: 's1', containerId: 'c1' });
  });

  it('scopes child process listing to include the run id', async () => {
    const { runtime, context } = createHarness({ agentRole: 'task' });
    const tool = toolByName(processTools, 'manage_process');
    await tool.execute({ action: 'list' }, context);
    expect(runtime.getProcesses).toHaveBeenCalledWith({ sessionId: 's1', runId: 'r1', containerId: 'c1' });
  });

  it('observes a running process with cursor and output', async () => {
    const { processes, context } = createHarness();
    processes.push(makeProcess({ id: 'p-1', isRunning: true, output: 'tail', cursor: 5 }));
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'observe', process_id: 'p-1', cursor: 3 }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Running: true');
    expect(result.content).toContain('Cursor: 5');
    expect(result.content).toContain('tail');
  });

  it('reports a missing process on observe', async () => {
    const { context } = createHarness();
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'observe', process_id: 'missing' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Process missing not found in the current session and container');
  });

  it('reports a process that exited before observation', async () => {
    const { processes, observeProcess, context } = createHarness();
    processes.push(makeProcess({ id: 'p-1' }));
    observeProcess.mockReturnValueOnce(null);
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'observe', process_id: 'p-1' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Process exited before it could be observed');
  });

  it('stops a registered process owned by this run', async () => {
    const { processes, runtime, context, getTask } = createHarness();
    processes.push(makeProcess({ id: 'p-1' }));
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'stop', process_id: 'p-1' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('Process stopped.');
    expect(runtime.stopProcess).toHaveBeenCalledWith('p-1', { sessionId: 's1', runId: 'r1', containerId: 'c1' });
    expect(getTask().verified).toBe(false);
  });

  it('reports a process that exited before it could be stopped', async () => {
    const { processes, stopProcess, context } = createHarness();
    processes.push(makeProcess({ id: 'p-1' }));
    stopProcess.mockResolvedValueOnce(false);
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'stop', process_id: 'p-1' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Process exited before it could be stopped');
  });

  it('reports a missing process on stop', async () => {
    const { context } = createHarness();
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'stop', process_id: 'missing' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Process missing not found in the current session and container');
  });

  it('explains that interactive stdin is not supported on input', async () => {
    const { processes, context } = createHarness();
    processes.push(makeProcess({ id: 'p-1' }));
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'input', process_id: 'p-1', input: 'hi' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Interactive stdin is not supported in the Succinix sandbox');
  });

  it('reports a missing process on input', async () => {
    const { context } = createHarness();
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'input', process_id: 'missing', input: 'hi' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Process missing not found in the current session and container');
  });

  it('returns an unknown-action fallback', async () => {
    const { context } = createHarness();
    const tool = toolByName(processTools, 'manage_process');
    const result = await tool.execute({ action: 'bogus' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toBe('Unknown manage_process action.');
  });
});

describe('read_user_terminal (processTools)', () => {
  it('renders the user terminal buffer when output exists', async () => {
    const { getUserTerminalBuffer, context } = createHarness();
    getUserTerminalBuffer.mockReturnValue('some recent output');
    const tool = toolByName(processTools, 'read_user_terminal');
    const result = await tool.execute({}, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('--- USER TERMINAL RECENT OUTPUT ---');
    expect(result.content).toContain('some recent output');
  });

  it('reports an empty user terminal', async () => {
    const { context } = createHarness();
    const tool = toolByName(processTools, 'read_user_terminal');
    const result = await tool.execute({}, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('(User terminal is currently empty or has not received any output yet)');
  });
});

describe('controlTools', () => {
  it('update_plan writes the plan back into the task', async () => {
    const { context, getTask } = createHarness();
    const tool = toolByName(controlTools, 'update_plan');
    const items = [{ id: 'a', title: 'Step A', status: 'in_progress' as const }];
    const result = await tool.execute({ items }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Plan updated with 1 steps.');
    expect(getTask().plan).toEqual(items);
  });

  it('report_progress echoes the public progress message', async () => {
    const { context } = createHarness();
    const tool = toolByName(controlTools, 'report_progress');
    const result = await tool.execute({ message: 'working on it' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('working on it');
    expect(result.data).toEqual({ progress: 'working on it' });
  });

  it('ask_user pauses the run awaiting the user', async () => {
    const { context } = createHarness();
    const tool = toolByName(controlTools, 'ask_user');
    const result = await tool.execute({ question: 'Which port?' }, context);
    expect(result.ok).toBe(true);
    expect(result.stopRun).toBe('awaiting_user');
  });

  it('ask_parent is rejected for root agents', async () => {
    const { context } = createHarness({ agentRole: 'root' });
    const tool = toolByName(controlTools, 'ask_parent');
    const result = await tool.execute({ question: 'Can I proceed?' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('available only to delegated child agents');
  });

  it('ask_parent pauses a child agent awaiting the root', async () => {
    const { context } = createHarness({ agentRole: 'task' });
    const tool = toolByName(controlTools, 'ask_parent');
    const result = await tool.execute({ question: 'Can I proceed?' }, context);
    expect(result.ok).toBe(true);
    expect(result.stopRun).toBe('awaiting_parent');
  });

  it('complete_task requires structured evidence', async () => {
    const { context } = createHarness({ containerAvailable: false });
    const tool = toolByName(controlTools, 'complete_task');
    const result = await tool.execute({ summary: 'done', evidence: [] }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('provide structured evidence');
  });

  it('complete_task completes with evidence when the gate passes', async () => {
    const { context, getTask } = createHarness({ containerAvailable: false });
    const tool = toolByName(controlTools, 'complete_task');
    const result = await tool.execute({ summary: 'done', evidence: ['ran tests'] }, context);
    expect(result.ok).toBe(true);
    expect(result.finalSummary).toBe('done');
    expect(result.stopRun).toBe('completed');
    expect(getTask().evidence).toContain('ran tests');
  });

  it('complete_task blocks while the plan is incomplete', async () => {
    const { context, setTask } = createHarness({ containerAvailable: true });
    setTask({ ...initialTask('non-trivial work'), requiresPlan: true, plan: [{ id: 'p1', title: 's', status: 'pending' }] });
    const tool = toolByName(controlTools, 'complete_task');
    const result = await tool.execute({ summary: 'done', evidence: ['e'] }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('unfinished or blocked steps');
  });

  it('complete_task blocks on unverified workspace changes', async () => {
    const { context, setTask } = createHarness({ containerAvailable: true });
    setTask({ ...initialTask('change code'), changedWorkspace: true, verified: false, verifiedRevision: -1, requiresPlan: false });
    const tool = toolByName(controlTools, 'complete_task');
    const result = await tool.execute({ summary: 'done', evidence: ['e'] }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('verification');
  });
});

describe('workspaceTools', () => {
  it('workspace_tree lists entries with directory prefixes', async () => {
    const { listWorkspace, context } = createHarness();
    listWorkspace.mockResolvedValueOnce([{ path: 'a.ts', isDirectory: false }, { path: 'src', isDirectory: true }]);
    const tool = toolByName(workspaceTools, 'workspace_tree');
    const result = await tool.execute({ max_depth: 3 }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('file a.ts');
    expect(result.content).toContain('dir  src');
    expect(listWorkspace).toHaveBeenCalledWith('c1', 3);
  });

  it('workspace_tree reports an empty workspace', async () => {
    const { listWorkspace, context } = createHarness();
    listWorkspace.mockResolvedValueOnce([]);
    const tool = toolByName(workspaceTools, 'workspace_tree');
    const result = await tool.execute({ max_depth: 3 }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('(workspace is empty)');
  });

  it('read_file returns the bounded file content', async () => {
    const { readWorkspaceFile, context } = createHarness();
    const tool = toolByName(workspaceTools, 'read_file');
    const result = await tool.execute({ path: 'a.ts', start_line: 1, end_line: 10 }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('file content');
    expect(result.data).toEqual({ path: 'a.ts' });
    expect(readWorkspaceFile).toHaveBeenCalledWith('c1', 'a.ts', 1, 10);
  });

  it('search_workspace formats matching lines', async () => {
    const { searchWorkspace, context } = createHarness();
    const tool = toolByName(workspaceTools, 'search_workspace');
    const result = await tool.execute({ query: 'needle', max_results: 10 }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('a.ts:3: needle');
    expect(searchWorkspace).toHaveBeenCalledWith('c1', 'needle', 10);
  });

  it('search_workspace reports no matches', async () => {
    const { searchWorkspace, context } = createHarness();
    searchWorkspace.mockResolvedValueOnce([]);
    const tool = toolByName(workspaceTools, 'search_workspace');
    const result = await tool.execute({ query: 'missing' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('(no matches)');
  });
});

describe('resourceTools', () => {
  it('list_resources renders resource rows and references', async () => {
    const { listResources, context } = createHarness();
    listResources.mockResolvedValueOnce([
      { id: 'res-1', name: 'a.txt', kind: 'text', mimeType: 'text/plain', size: 4, sha256: 'hash', createdAt: 1 },
    ]);
    const tool = toolByName(resourceTools, 'list_resources');
    const result = await tool.execute({}, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('res-1');
    expect(result.content).toContain('a.txt');
    expect(result.resourceReferences).toEqual(['res-1']);
  });

  it('list_resources reports no resources', async () => {
    const { context } = createHarness();
    const tool = toolByName(resourceTools, 'list_resources');
    const result = await tool.execute({}, context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('(no resources)');
  });

  it('read_resource_text passes the bounded range through', async () => {
    const { runtime, context } = createHarness();
    const tool = toolByName(resourceTools, 'read_resource_text');
    const result = await tool.execute({ resource_id: 'res-1', start_line: 1, end_line: 5, max_tokens: 512 }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe('resource text');
    expect(result.resourceReferences).toEqual(['res-1']);
    expect(runtime.readResourceText).toHaveBeenCalledWith('s1', 'res-1', 1, 5, 512);
  });

  it('read_resource_image returns a durable image reference', async () => {
    const { context } = createHarness();
    const tool = toolByName(resourceTools, 'read_resource_image');
    const result = await tool.execute({ resource_id: 'res-1' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('[image: res-1]');
    expect(result.modelContent).toEqual([{ type: 'image_resource', resourceId: 'res-1' }]);
    expect(result.resourceReferences).toEqual(['res-1']);
  });

  it('materialize_resource writes a real file and bumps the revision', async () => {
    const { runtime, context, getTask } = createHarness();
    const tool = toolByName(resourceTools, 'materialize_resource');
    const result = await tool.execute({ resource_id: 'res-1', path: 'out.txt' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('Created out.txt from resource res-1');
    expect(result.changedWorkspace).toBe(true);
    expect(runtime.materializeResource).toHaveBeenCalledWith('s1', 'c1', 'res-1', 'out.txt');
    expect(getTask().changedWorkspace).toBe(true);
    expect(getTask().workspaceRevision).toBe(1);
  });
});
