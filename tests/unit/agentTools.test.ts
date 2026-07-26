import { describe, expect, it, vi } from 'vitest';
import { AgentToolRegistry, type ToolExecutionContext } from '@/features/agent-core/tools';
import type { TaskContract } from '@/features/agent-core/types';
import type { AgentWorkspaceRuntime, ProcessOwnership, ProcessStatus } from '@/shared/contracts/agentRuntime';
import { ContainerMutationLease } from '@/features/agent-core/agentFamily';
import { buildAgentSystemPrompt, createChaosContract } from '@/features/agent-core/prompt';

function createContext() {
  let task: TaskContract = { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: true, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] };
  let workspaceRevision = 0;
  const runtime: AgentWorkspaceRuntime = {
    ensureContainer: vi.fn(async () => undefined),
    getWorkspaceRevision: vi.fn(async () => workspaceRevision),
    flushWorkspace: vi.fn(async () => undefined),
    listResources: vi.fn(async () => []),
    readResourceText: vi.fn(async () => 'resource content'),
    readResourceImage: vi.fn(async () => ({ id: 'res-1', name: 'image.png', kind: 'image' as const, mimeType: 'image/png', size: 4, sha256: 'hash', createdAt: 1 })),
    materializeResource: vi.fn(async (_sessionId, _containerId, _resourceId, path) => { workspaceRevision += 1; return { path, kind: 'created' as const, beforeBytes: 0, afterBytes: 4 }; }),
    listWorkspace: vi.fn(async () => [{ path: 'a.ts', isDirectory: false }]),
    readWorkspaceFile: vi.fn(async () => 'content'),
    searchWorkspace: vi.fn(async () => [{ path: 'a.ts', line: 1, content: 'needle' }]),
    applyWorkspaceChanges: vi.fn(async () => { workspaceRevision += 1; return [{ path: 'a.ts', kind: 'updated' as const, beforeBytes: 1, afterBytes: 2 }]; }),
    runShell: vi.fn(async (request) => ({ timedOut: false, process: { id: 'p-1', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: 'ok', cursor: 2, exitCode: 0 } })),
    observeProcess: vi.fn(() => null),
    sendProcessInput: vi.fn(async () => true),
    stopProcess: vi.fn(async () => true),
    stopRun: vi.fn(),
    getProcesses: vi.fn(() => []),
    subscribe: vi.fn(() => () => undefined),
    getUserTerminalBuffer: vi.fn(() => ''),
    appendUserTerminalBuffer: vi.fn(),
  };
  const context: ToolExecutionContext = { sessionId: 's-1', runId: 'r-1', containerId: 'c-1', runtime, signal: new AbortController().signal, agentRole: 'root', mutationLease: new ContainerMutationLease(), getTask: () => task, updateTask: (updater: (current: TaskContract) => TaskContract) => { task = updater(task); } };
  return { runtime, context, getTask: () => task };
}

describe('AgentToolRegistry', () => {
  it('does not hardcode verification command names, arguments, or ports', async () => {
    const registry = new AgentToolRegistry();
    const { context, getTask } = createContext();
    await registry.execute({ id: 'patch', name: 'apply_patch', arguments: '{"changes":[{"path":"a.ts","content":"next"}]}' }, context);
    for (const [index, command] of ['node --check a.ts', 'curl http://localhost:4173/health', 'custom-project-validator --port 9081', "npm test && echo 'passed'"].entries()) {
      const result = await registry.execute({ id: `verify-${index}`, name: 'shell_run', arguments: JSON.stringify({ command, mode: 'foreground' }) }, context);
      expect(result.verification).toMatchObject({ command, passed: true });
    }
    const inspection = await registry.execute({ id: 'inspect', name: 'shell_run', arguments: '{"command":"cat package.json && git status --short","mode":"foreground"}' }, context);
    expect(inspection.verification?.passed).toBe(true);
    expect(getTask()).toMatchObject({ changedWorkspace: true, verified: true });
    await registry.execute({ id: 'plan', name: 'update_plan', arguments: '{"items":[{"id":"done","title":"Done","status":"completed"}]}' }, context);
    expect((await registry.execute({ id: 'complete', name: 'complete_task', arguments: '{"summary":"done","evidence":["checked"]}' }, context)).stopRun).toBe('completed');
  });

  it('governs verification relevance and truthfulness through the system prompt', () => {
    const { getTask } = createContext();
    const prompt = buildAgentSystemPrompt({ containerId: 'c-1', task: getTask(), chaos: createChaosContract('Sunam 6.9 Pron'), summary: '' });
    expect(prompt).toContain('truthful check that is relevant to the task');
    expect(prompt).toContain('ports, and shell composition are not restricted');
    expect(prompt).toContain('never use forced success or unrelated commands as fake evidence');
    expect(prompt).toContain('later workspace mutation requires another foreground check');
    expect(prompt).toContain('Before managing a previously started service, call `process_list`');
    expect(prompt).toContain('Do not guess OS PIDs or kill by port');
  });

  it('executes workspace, shell, process, and control tools with truthful task updates', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    expect(registry.getApiDefinitions()).toHaveLength(22);
    expect(registry.getMetadata('workspace_tree')).toMatchObject({ concurrencySafe: true, dataImpact: 'none', timeoutMs: 10_000, resultType: 'tree' });
    expect(registry.getMetadata('apply_patch')).toMatchObject({ readOnly: false, dataImpact: 'workspace', resultType: 'changes' });
    expect(registry.getMetadata('missing')).toBeNull();
    expect((await registry.execute({ id: '1', name: 'workspace_tree', arguments: '{bad' }, context)).ok).toBe(false);
    expect((await registry.execute({ id: '1', name: 'missing', arguments: '{}' }, context)).content).toContain('not available');
    expect((await registry.execute({ id: '1', name: 'workspace_tree', arguments: JSON.stringify({ max_depth: 2 }) }, context)).content).toContain('a.ts');
    expect((await registry.execute({ id: '2', name: 'read_file', arguments: JSON.stringify({ path: 'a.ts' }) }, context)).content).toBe('content');
    expect((await registry.execute({ id: '3', name: 'search_workspace', arguments: JSON.stringify({ query: 'needle' }) }, context)).content).toContain('needle');
    expect((await registry.execute({ id: '4', name: 'apply_patch', arguments: JSON.stringify({ changes: [{ path: 'a.ts', content: 'next' }] }) }, context)).changedWorkspace).toBe(true);
    expect(getTask().changedWorkspace).toBe(true);
    const shell = await registry.execute({ id: '5', name: 'shell_run', arguments: JSON.stringify({ command: 'npm test', mode: 'foreground', timeout_ms: 12_345 }) }, context);
    expect(shell.verification?.passed).toBe(true);
    expect(runtime.runShell).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 12_345 }));
    expect(getTask().verificationEvidence).toHaveLength(1);
    const previousRunProcess: ProcessStatus = { id: 'p-1', sessionId: 's-1', runId: 'r-previous', containerId: 'c-1', command: 'npm run dev -- --port 1919', isRunning: true, output: 'ready on 1919', cursor: 13 };
    runtime.getProcesses = vi.fn(() => [previousRunProcess]);
    runtime.observeProcess = vi.fn(() => previousRunProcess);
    expect((await registry.execute({ id: 'process-list', name: 'process_list', arguments: '{}' }, context)).content).toContain('r-previous');
    expect((await registry.execute({ id: '6', name: 'process_observe', arguments: JSON.stringify({ process_id: 'p-1' }) }, context)).ok).toBe(true);
    expect((await registry.execute({ id: '7', name: 'process_input', arguments: JSON.stringify({ process_id: 'p-1', input: 'y' }) }, context)).ok).toBe(true);
    expect((await registry.execute({ id: '8', name: 'process_stop', arguments: JSON.stringify({ process_id: 'p-1' }) }, context)).ok).toBe(true);
    expect(runtime.stopProcess).toHaveBeenCalledWith('p-1', { sessionId: 's-1', runId: 'r-previous', containerId: 'c-1' });
    expect((await registry.execute({ id: '9', name: 'update_plan', arguments: JSON.stringify({ items: [{ id: 'plan', title: 'Done', status: 'completed' }] }) }, context)).ok).toBe(true);
    expect((await registry.execute({ id: 'resource-list', name: 'list_resources', arguments: '{}' }, context)).content).toBe('(no resources)');
    expect((await registry.execute({ id: 'resource-text', name: 'read_resource_text', arguments: '{"resource_id":"res-1","start_line":1}' }, context)).content).toBe('resource content');
    expect((await registry.execute({ id: 'resource-image', name: 'read_resource_image', arguments: '{"resource_id":"res-1"}' }, context)).modelContent).toEqual([{ type: 'image_resource', resourceId: 'res-1' }]);
    expect((await registry.execute({ id: 'resource-file', name: 'materialize_resource', arguments: '{"resource_id":"res-1","path":"assets/image.png"}' }, context)).changedWorkspace).toBe(true);
    expect((await registry.execute({ id: 'resource-verify', name: 'shell_run', arguments: JSON.stringify({ command: 'npm test', mode: 'foreground' }) }, context)).verification?.passed).toBe(true);
    expect((await registry.execute({ id: '10', name: 'report_progress', arguments: JSON.stringify({ message: 'progress' }) }, context)).content).toBe('progress');
    expect((await registry.execute({ id: '11', name: 'ask_user', arguments: JSON.stringify({ question: 'Need input?' }) }, context)).stopRun).toBe('awaiting_user');
    expect((await registry.execute({ id: '12', name: 'complete_task', arguments: JSON.stringify({ summary: 'done', evidence: ['test'] }) }, context)).stopRun).toBe('completed');
    expect(runtime.runShell).toHaveBeenCalled();
  });

  it('lets a root run manage earlier-run processes only inside its session and container', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    let runtimeRevision = 7;
    const processes: ProcessStatus[] = [
      { id: 'p-old', sessionId: 's-1', runId: 'r-old', containerId: 'c-1', command: 'npm run dev -- --port 1919', isRunning: true, output: 'http://localhost:1919', cursor: 21 },
      { id: 'p-other-session', sessionId: 's-2', runId: 'r-other', containerId: 'c-1', command: 'other session', isRunning: true, output: '', cursor: 0 },
      { id: 'p-other-container', sessionId: 's-1', runId: 'r-other', containerId: 'c-2', command: 'other container', isRunning: true, output: '', cursor: 0 },
    ];
    runtime.getProcesses = vi.fn((scope?: Partial<ProcessOwnership>) => processes.filter((process) => !scope
      || (scope.sessionId === undefined || process.sessionId === scope.sessionId)
      && (scope.runId === undefined || process.runId === scope.runId)
      && (scope.containerId === undefined || process.containerId === scope.containerId)));
    runtime.observeProcess = vi.fn((processId, owner) => processes.find((process) => process.id === processId
      && process.sessionId === owner.sessionId
      && process.runId === owner.runId
      && process.containerId === owner.containerId) ?? null);
    runtime.getWorkspaceRevision = vi.fn(async () => runtimeRevision);
    runtime.stopProcess = vi.fn(async () => { runtimeRevision += 1; return true; });
    context.updateTask((task) => ({ ...task, workspaceRevision: runtimeRevision }));

    const listed = await registry.execute({ id: 'list-old', name: 'process_list', arguments: '{}' }, context);
    expect(listed.content).toContain('p-old');
    expect(listed.content).toContain('1919');
    expect(listed.content).not.toContain('p-other-session');
    expect(listed.content).not.toContain('p-other-container');
    expect(runtime.getProcesses).toHaveBeenCalledWith({ sessionId: 's-1', containerId: 'c-1' });

    expect((await registry.execute({ id: 'observe-old', name: 'process_observe', arguments: '{"process_id":"p-old"}' }, context)).ok).toBe(true);
    expect((await registry.execute({ id: 'input-old', name: 'process_input', arguments: '{"process_id":"p-old","input":"\\u0003"}' }, context)).ok).toBe(true);
    expect((await registry.execute({ id: 'stop-old', name: 'process_stop', arguments: '{"process_id":"p-old"}' }, context)).ok).toBe(true);
    expect(runtime.observeProcess).toHaveBeenCalledWith('p-old', { sessionId: 's-1', runId: 'r-old', containerId: 'c-1' }, undefined);
    expect(runtime.sendProcessInput).toHaveBeenCalledWith('p-old', { sessionId: 's-1', runId: 'r-old', containerId: 'c-1' }, '\u0003');
    expect(runtime.stopProcess).toHaveBeenCalledWith('p-old', { sessionId: 's-1', runId: 'r-old', containerId: 'c-1' });
    expect(getTask()).toMatchObject({ workspaceRevision: 8, changedWorkspace: false, verified: false, verifiedRevision: -1 });

    context.agentRole = 'verify';
    const restricted = await registry.execute({ id: 'list-restricted', name: 'process_list', arguments: '{}' }, context);
    expect(restricted.data).toEqual([]);
    expect(runtime.getProcesses).toHaveBeenLastCalledWith({ sessionId: 's-1', containerId: 'c-1', runId: 'r-1' });
  });

  it('preserves pre-stop workspace drift as changed and unverified', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    const process: ProcessStatus = { id: 'p-drift', sessionId: 's-1', runId: 'r-old', containerId: 'c-1', command: 'dev server', isRunning: true, output: '', cursor: 0 };
    let runtimeRevision = 4;
    runtime.getProcesses = vi.fn(() => [process]);
    runtime.getWorkspaceRevision = vi.fn(async () => runtimeRevision);
    runtime.stopProcess = vi.fn(async () => { runtimeRevision += 1; return true; });
    context.updateTask((task) => ({ ...task, workspaceRevision: 3, changedWorkspace: false }));

    expect((await registry.execute({ id: 'stop-drift', name: 'process_stop', arguments: '{"process_id":"p-drift"}' }, context)).ok).toBe(true);
    expect(getTask()).toMatchObject({ workspaceRevision: 5, changedWorkspace: true, verified: false, verifiedRevision: -1 });
  });

  it('preserves additional workspace drift that occurs while a process is stopping', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    const process: ProcessStatus = { id: 'p-stop-drift', sessionId: 's-1', runId: 'r-old', containerId: 'c-1', command: 'dev server', isRunning: true, output: '', cursor: 0 };
    let runtimeRevision = 6;
    runtime.getProcesses = vi.fn(() => [process]);
    runtime.getWorkspaceRevision = vi.fn(async () => runtimeRevision);
    runtime.stopProcess = vi.fn(async () => { runtimeRevision += 2; return true; });
    context.updateTask((task) => ({ ...task, workspaceRevision: runtimeRevision, changedWorkspace: false }));

    expect((await registry.execute({ id: 'stop-with-drift', name: 'process_stop', arguments: '{"process_id":"p-stop-drift"}' }, context)).ok).toBe(true);
    expect(getTask()).toMatchObject({ workspaceRevision: 8, changedWorkspace: true, verified: false, verifiedRevision: -1 });
  });

  it('blocks root completion when verification failed for a changed workspace', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    runtime.runShell = vi.fn(async (request) => ({ timedOut: false, process: { id: 'p-2', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: 'bad', cursor: 3, exitCode: 1 } }));
    await registry.execute({ id: 'patch', name: 'apply_patch', arguments: JSON.stringify({ changes: [{ path: 'a.ts', content: 'next' }] }) }, context);
    await registry.execute({ id: 'shell', name: 'shell_run', arguments: JSON.stringify({ command: 'npm test', mode: 'foreground' }) }, context);
    await registry.execute({ id: 'plan', name: 'update_plan', arguments: JSON.stringify({ items: [{ id: 'plan', title: 'Done', status: 'completed' }] }) }, context);
    const result = await registry.execute({ id: 'complete', name: 'complete_task', arguments: JSON.stringify({ summary: 'done', evidence: ['failed test'] }) }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('shell_run');
    expect(result.content).toContain('mode "foreground"');
    expect(result.content).toContain('exits 0');
    expect(result.content).toContain('does not restrict command names');
    expect(result.content).toContain('ports');
    expect(result.content).toContain('later workspace mutation');
    expect(result.content).toContain('retry complete_task');
    expect(getTask().verificationEvidence[0]?.passed).toBe(false);
  });

  it('treats authoritative revision drift as an unverified workspace change', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    context.updateTask((task) => ({ ...task, requiresPlan: false, changedWorkspace: false, workspaceRevision: 0 }));
    await runtime.materializeResource('s-1', 'c-1', 'res-1', 'external.txt');
    const result = await registry.execute({ id: 'complete-drift', name: 'complete_task', arguments: '{"summary":"done","evidence":["x"]}' }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('passed verification');
    expect(getTask()).toMatchObject({ changedWorkspace: true, workspaceRevision: 1, verified: false, verifiedRevision: -1 });
  });

  it('invalidates successful verification after a later workspace write and blocks stale completion', async () => {
    const registry = new AgentToolRegistry();
    const { context, getTask } = createContext();
    await registry.execute({ id: 'patch-1', name: 'apply_patch', arguments: JSON.stringify({ changes: [{ path: 'a.ts', content: 'one' }] }) }, context);
    await registry.execute({ id: 'verify-1', name: 'shell_run', arguments: JSON.stringify({ command: 'npm test', mode: 'foreground' }) }, context);
    expect(getTask()).toMatchObject({ workspaceRevision: 1, verifiedRevision: 1, verified: true });

    await registry.execute({ id: 'patch-2', name: 'apply_patch', arguments: JSON.stringify({ changes: [{ path: 'a.ts', content: 'two' }] }) }, context);
    await registry.execute({ id: 'plan', name: 'update_plan', arguments: JSON.stringify({ items: [{ id: 'plan', title: 'Done', status: 'completed' }] }) }, context);
    expect(getTask()).toMatchObject({ workspaceRevision: 2, verifiedRevision: -1, verified: false });
    const stale = await registry.execute({ id: 'complete-stale', name: 'complete_task', arguments: JSON.stringify({ summary: 'done', evidence: ['old test'] }) }, context);
    expect(stale.ok).toBe(false);
  });

  it('invalidates an earlier pass when a later verification fails on the same revision', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    await registry.execute({ id: 'patch', name: 'apply_patch', arguments: '{"changes":[{"path":"a.ts","content":"one"}]}' }, context);
    await registry.execute({ id: 'pass', name: 'shell_run', arguments: '{"command":"npm test","mode":"foreground"}' }, context);
    expect(getTask().verified).toBe(true);
    runtime.runShell = vi.fn(async (request) => ({ timedOut: false, process: { id: 'p-fail', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: 'failed', cursor: 6, exitCode: 1 } }));
    await registry.execute({ id: 'fail', name: 'shell_run', arguments: '{"command":"npm test","mode":"foreground"}' }, context);
    expect(getTask()).toMatchObject({ verified: false, verifiedRevision: -1 });
  });

  it('returns useful failures for schema, process, timeout, and completion guard branches', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    runtime.listWorkspace = vi.fn(async () => []);
    runtime.searchWorkspace = vi.fn(async () => []);
    runtime.runShell = vi.fn(async (request) => ({
      timedOut: true,
      process: { id: 'p-live', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: true, output: '', cursor: 0 },
    }));
    runtime.observeProcess = vi.fn(() => ({ id: 'p-live', sessionId: 's-1', runId: 'r-1', containerId: 'c-1', command: 'serve', isRunning: true, output: '', cursor: 0 }));
    runtime.getProcesses = vi.fn(() => [{ id: 'p-live', sessionId: 's-1', runId: 'r-1', containerId: 'c-1', command: 'serve', isRunning: true, output: '', cursor: 0 }]);
    runtime.sendProcessInput = vi.fn(async () => false);
    runtime.stopProcess = vi.fn(async () => false);

    expect((await registry.execute({ id: 'schema', name: 'workspace_tree', arguments: '{}' }, context)).content).toContain('validation failed');
    expect((await registry.execute({ id: 'default-json', name: 'report_progress', arguments: '' }, context)).ok).toBe(false);
    expect((await registry.execute({ id: 'tree', name: 'workspace_tree', arguments: '{"max_depth":2}' }, context)).content).toBe('(workspace is empty)');
    expect((await registry.execute({ id: 'search', name: 'search_workspace', arguments: '{"query":"none"}' }, context)).content).toBe('(no matches)');
    const timedOutForeground = await registry.execute({ id: 'foreground-timeout', name: 'shell_run', arguments: '{"command":"custom-validator","mode":"foreground"}' }, context);
    expect(timedOutForeground.verification).toMatchObject({ command: 'custom-validator', passed: false });
    expect(getTask()).toMatchObject({ verified: false, verifiedRevision: -1 });
    const timedOut = await registry.execute({ id: 'timeout', name: 'shell_run', arguments: '{"command":"serve","mode":"background"}' }, context);
    expect(timedOut.content).toContain('Command still running');
    expect(timedOut.verification).toBeUndefined();
    expect(timedOut.changedWorkspace).toBeUndefined();
    expect(getTask()).toMatchObject({ changedWorkspace: false, verified: false, verifiedRevision: -1 });
    expect((await registry.execute({ id: 'observe', name: 'process_observe', arguments: '{"process_id":"p-live"}' }, context)).content).toContain('(no new output)');
    expect((await registry.execute({ id: 'input', name: 'process_input', arguments: '{"process_id":"p-live","input":"y"}' }, context)).content).toContain('exited before input');
    expect((await registry.execute({ id: 'stop', name: 'process_stop', arguments: '{"process_id":"p-live"}' }, context)).content).toContain('exited before it could be stopped');

    context.updateTask((task) => ({ ...task, changedWorkspace: false }));
    expect((await registry.execute({ id: 'no-plan', name: 'complete_task', arguments: '{"summary":"done","evidence":["x"]}' }, context)).content).toContain('needs a recorded execution plan');
    context.updateTask((task) => ({ ...task, plan: [{ id: 'still-going', title: 'Still going', status: 'in_progress' }] }));
    expect((await registry.execute({ id: 'unfinished', name: 'complete_task', arguments: '{"summary":"done","evidence":["x"]}' }, context)).content).toContain('unfinished or blocked steps');
    context.updateTask((task) => ({ ...task, plan: [{ id: 'blocked', title: 'Blocked', status: 'blocked' }] }));
    expect((await registry.execute({ id: 'blocked', name: 'complete_task', arguments: '{"summary":"done","evidence":["x"]}' }, context)).content).toContain('unfinished or blocked steps');
    expect(getTask().evidence).toEqual(['Failed verification: custom-validator']);
  });

  it('enforces delegated role policies and exposes all subagent control tools', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime } = createContext();
    const notification = { runId: 'child-1', taskId: 'task-1', role: 'explore' as const, status: 'completed' as const, summary: 'done', evidence: ['read'], changedPaths: [], verificationRecords: [], workspaceRevision: 0, usage: { modelTurns: 1, toolCalls: 2, durationMs: 3 } };
    context.subagents = {
      spawn: vi.fn(async () => ({ runId: 'child-1', taskId: 'task-1', status: 'queued' })),
      wait: vi.fn(async () => [notification]),
      message: vi.fn(async () => true),
      stop: vi.fn(async () => true),
      stopAll: vi.fn(async () => undefined),
      snapshot: vi.fn(() => []),
    };
    expect((await registry.execute({ id: 'spawn', name: 'spawn_subagent', arguments: '{"task_id":"task-1","role":"explore","prompt":"inspect"}' }, context)).data).toMatchObject({ runId: 'child-1' });
    expect((await registry.execute({ id: 'wait', name: 'wait_subagents', arguments: '{"run_ids":["child-1"]}' }, context)).data).toEqual([notification]);
    expect((await registry.execute({ id: 'message', name: 'message_subagent', arguments: '{"run_id":"child-1","message":"focus"}' }, context)).ok).toBe(true);
    expect((await registry.execute({ id: 'stop', name: 'stop_subagent', arguments: '{"run_id":"child-1"}' }, context)).ok).toBe(true);

    context.agentRole = 'verify';
    expect((await registry.execute({ id: 'background', name: 'shell_run', arguments: '{"command":"npm test","mode":"background"}' }, context)).content).toContain('foreground');
    context.updateTask((task) => ({ ...task, plan: [{ id: 'verify', title: 'Verify', status: 'completed' }] }));
    const unverified = await registry.execute({ id: 'unverified-complete', name: 'complete_task', arguments: '{"summary":"done","evidence":["x"]}' }, context);
    expect(unverified.content).toContain('shell_run');
    expect(unverified.content).toContain('foreground');
    await registry.execute({ id: 'verify-pass', name: 'shell_run', arguments: '{"command":"custom-project-validator --port 4173","mode":"foreground"}' }, context);
    expect((await registry.execute({ id: 'verified-complete', name: 'complete_task', arguments: '{"summary":"done","evidence":["x"]}' }, context)).stopRun).toBe('completed');
    expect(runtime.runShell).not.toHaveBeenCalledWith(expect.objectContaining({ mode: 'background' }));

    context.agentRole = 'implement';
    context.writeScope = ['src/allowed'];
    expect((await registry.execute({ id: 'outside', name: 'apply_patch', arguments: '{"changes":[{"path":"src/other/a.ts","content":"x"}]}' }, context)).content).toContain('outside');
    expect((await registry.execute({ id: 'scope-traversal', name: 'apply_patch', arguments: '{"changes":[{"path":"src/allowed/../other.ts","content":"x"}]}' }, context)).content).toContain('escapes');
    expect((await registry.execute({ id: 'outside-resource', name: 'materialize_resource', arguments: '{"resource_id":"res-1","path":"public/a.png"}' }, context)).content).toContain('outside');
    expect((await registry.execute({ id: 'inside', name: 'apply_patch', arguments: '{"changes":[{"path":"src/allowed/a.ts","content":"x"}]}' }, context)).ok).toBe(true);
  });

  it('supports role-specific registries and converts thrown tool errors into results', async () => {
    const limited = new AgentToolRegistry(new Set(['spawn_subagent']));
    const { context } = createContext();
    expect(limited.getApiDefinitions().map((tool) => tool.function.name)).toEqual(['spawn_subagent']);
    expect((await limited.execute({ id: 'missing', name: 'workspace_tree', arguments: '{}' }, context)).ok).toBe(false);
    context.subagents = {
      spawn: vi.fn(async () => { throw new Error('delegation unavailable'); }),
      wait: vi.fn(async () => []),
      message: vi.fn(async () => false),
      stop: vi.fn(async () => false),
      stopAll: vi.fn(async () => undefined),
      snapshot: vi.fn(() => []),
    };
    expect((await limited.execute({ id: 'throws', name: 'spawn_subagent', arguments: '{"task_id":"x","role":"explore","prompt":"x"}' }, context)).content).toBe('delegation unavailable');
  });

  it('makes the parent re-enter the current-revision completion gate after child writes', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    runtime.getWorkspaceRevision = vi.fn(async () => 3);
    const implementation = { runId: 'implement', taskId: 'write', role: 'implement' as const, status: 'completed' as const, summary: 'wrote file', evidence: ['file'], changedPaths: ['src/a.ts'], verificationRecords: [], workspaceRevision: 3, usage: { modelTurns: 1, toolCalls: 1, durationMs: 1 } };
    const verification = { runId: 'verify', taskId: 'verify', role: 'verify' as const, status: 'completed' as const, summary: 'tests pass', evidence: ['tests'], changedPaths: [], verificationRecords: [{ command: 'npm test', passed: true, workspaceRevision: 3, createdAt: 1 }], workspaceRevision: 3, usage: { modelTurns: 1, toolCalls: 1, durationMs: 1 } };
    context.subagents = { spawn: vi.fn(), wait: vi.fn().mockResolvedValueOnce([implementation]).mockResolvedValueOnce([verification]), message: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), snapshot: vi.fn(() => []) };
    const writeResult = await registry.execute({ id: 'wait-write', name: 'wait_subagents', arguments: '{"run_ids":["implement"]}' }, context);
    expect(writeResult.changedWorkspace).toBe(true);
    expect(getTask()).toMatchObject({ changedWorkspace: true, workspaceRevision: 3, verified: false });
    expect((await registry.execute({ id: 'too-early', name: 'complete_task', arguments: '{"summary":"done","evidence":["child"]}' }, context)).ok).toBe(false);
    await registry.execute({ id: 'wait-verify', name: 'wait_subagents', arguments: '{"run_ids":["verify"]}' }, context);
    context.updateTask((task) => ({ ...task, plan: [{ id: 'done', title: 'Done', status: 'completed' }] }));
    expect(getTask()).toMatchObject({ workspaceRevision: 3, verified: true, verifiedRevision: 3 });
    expect((await registry.execute({ id: 'complete', name: 'complete_task', arguments: '{"summary":"done","evidence":["verified child"]}' }, context)).stopRun).toBe('completed');
  });

  it('invalidates an earlier parent pass when a later verify child fails', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    runtime.getWorkspaceRevision = vi.fn(async () => 4);
    context.updateTask((task) => ({ ...task, changedWorkspace: true, workspaceRevision: 4, verified: true, verifiedRevision: 4 }));
    const failed = { runId: 'verify-failed', taskId: 'verify-failed', role: 'verify' as const, status: 'failed' as const, summary: 'tests failed', evidence: [], changedPaths: [], verificationRecords: [{ command: 'npm test', passed: false, workspaceRevision: 4, createdAt: 1 }], workspaceRevision: 4, usage: { modelTurns: 1, toolCalls: 1, durationMs: 1 }, blockedReason: 'tests failed' };
    context.subagents = { spawn: vi.fn(), wait: vi.fn(async () => [failed]), message: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), snapshot: vi.fn(() => []) };
    await registry.execute({ id: 'wait-failed', name: 'wait_subagents', arguments: '{"run_ids":["verify-failed"]}' }, context);
    expect(getTask()).toMatchObject({ verified: false, verifiedRevision: -1, workspaceRevision: 4 });
  });
});
