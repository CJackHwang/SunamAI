import { describe, expect, it, vi } from 'vitest';
import { AgentToolRegistry, isVerificationCommand } from '@/features/agent-core/tools';
import type { TaskContract } from '@/features/agent-core/types';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';

function createContext() {
  let task: TaskContract = { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: true, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] };
  const runtime: AgentWorkspaceRuntime = {
    ensureContainer: vi.fn(async () => undefined),
    listWorkspace: vi.fn(async () => [{ path: 'a.ts', isDirectory: false }]),
    readWorkspaceFile: vi.fn(async () => 'content'),
    searchWorkspace: vi.fn(async () => [{ path: 'a.ts', line: 1, content: 'needle' }]),
    applyWorkspaceChanges: vi.fn(async () => [{ path: 'a.ts', kind: 'updated' as const, beforeBytes: 1, afterBytes: 2 }]),
    runShell: vi.fn(async (request) => ({ timedOut: false, process: { id: 'p-1', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: 'ok', cursor: 2, exitCode: 0 } })),
    observeProcess: vi.fn(() => null),
    sendProcessInput: vi.fn(async () => true),
    stopProcess: vi.fn(() => true),
    stopRun: vi.fn(),
    getProcesses: vi.fn(() => []),
    subscribe: vi.fn(() => () => undefined),
  };
  return { runtime, context: { sessionId: 's-1', runId: 'r-1', containerId: 'c-1', runtime, signal: new AbortController().signal, getTask: () => task, updateTask: (updater: (current: TaskContract) => TaskContract) => { task = updater(task); } }, getTask: () => task };
}

describe('AgentToolRegistry', () => {
  it('recognizes actual verification commands without trusting incidental substrings', () => {
    expect(isVerificationCommand('npm run typecheck && vitest run')).toBe(true);
    expect(isVerificationCommand('go test ./...')).toBe(true);
    expect(isVerificationCommand('./scripts/check.sh')).toBe(true);
    expect(isVerificationCommand('echo contest-ready')).toBe(false);
    expect(isVerificationCommand('echo npm test')).toBe(false);
    expect(isVerificationCommand('npm test || true')).toBe(false);
    expect(isVerificationCommand('npm test; exit 0')).toBe(false);
    expect(isVerificationCommand('npm install')).toBe(false);
  });

  it('executes workspace, shell, process, and control tools with truthful task updates', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    expect(registry.getApiDefinitions()).toHaveLength(12);
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
    expect((await registry.execute({ id: '6', name: 'process_observe', arguments: JSON.stringify({ process_id: 'p-1' }) }, context)).ok).toBe(false);
    expect((await registry.execute({ id: '7', name: 'process_input', arguments: JSON.stringify({ process_id: 'p-1', input: 'y' }) }, context)).ok).toBe(true);
    expect((await registry.execute({ id: '8', name: 'process_stop', arguments: JSON.stringify({ process_id: 'p-1' }) }, context)).ok).toBe(true);
    expect((await registry.execute({ id: '9', name: 'update_plan', arguments: JSON.stringify({ items: [{ id: 'plan', title: 'Done', status: 'completed' }] }) }, context)).ok).toBe(true);
    expect((await registry.execute({ id: '10', name: 'report_progress', arguments: JSON.stringify({ message: 'progress' }) }, context)).content).toBe('progress');
    expect((await registry.execute({ id: '11', name: 'ask_user', arguments: JSON.stringify({ question: 'Need input?' }) }, context)).stopRun).toBe('awaiting_user');
    expect((await registry.execute({ id: '12', name: 'complete_task', arguments: JSON.stringify({ summary: 'done', evidence: ['test'] }) }, context)).stopRun).toBe('completed');
    expect(runtime.runShell).toHaveBeenCalled();
  });

  it('does not turn failed verification into a completion pass', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    runtime.runShell = vi.fn(async (request) => ({ timedOut: false, process: { id: 'p-2', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: false, output: 'bad', cursor: 3, exitCode: 1 } }));
    await registry.execute({ id: 'patch', name: 'apply_patch', arguments: JSON.stringify({ changes: [{ path: 'a.ts', content: 'next' }] }) }, context);
    await registry.execute({ id: 'shell', name: 'shell_run', arguments: JSON.stringify({ command: 'npm test', mode: 'foreground' }) }, context);
    await registry.execute({ id: 'plan', name: 'update_plan', arguments: JSON.stringify({ items: [{ id: 'plan', title: 'Done', status: 'completed' }] }) }, context);
    const result = await registry.execute({ id: 'complete', name: 'complete_task', arguments: JSON.stringify({ summary: 'done', evidence: ['failed test'] }) }, context);
    expect(result.ok).toBe(false);
    expect(getTask().verificationEvidence[0]?.passed).toBe(false);
  });

  it('invalidates successful verification after a later workspace write', async () => {
    const registry = new AgentToolRegistry();
    const { context, getTask } = createContext();
    await registry.execute({ id: 'patch-1', name: 'apply_patch', arguments: JSON.stringify({ changes: [{ path: 'a.ts', content: 'one' }] }) }, context);
    await registry.execute({ id: 'verify-1', name: 'shell_run', arguments: JSON.stringify({ command: 'npm test', mode: 'foreground' }) }, context);
    expect(getTask()).toMatchObject({ workspaceRevision: 1, verifiedRevision: 1, verified: true });

    await registry.execute({ id: 'patch-2', name: 'apply_patch', arguments: JSON.stringify({ changes: [{ path: 'a.ts', content: 'two' }] }) }, context);
    await registry.execute({ id: 'plan', name: 'update_plan', arguments: JSON.stringify({ items: [{ id: 'plan', title: 'Done', status: 'completed' }] }) }, context);
    expect(getTask()).toMatchObject({ workspaceRevision: 2, verifiedRevision: 1, verified: false });
    const stale = await registry.execute({ id: 'complete-stale', name: 'complete_task', arguments: JSON.stringify({ summary: 'done', evidence: ['old test'] }) }, context);
    expect(stale.ok).toBe(false);
    expect(stale.content).toContain('current workspace revision');

    await registry.execute({ id: 'verify-2', name: 'shell_run', arguments: JSON.stringify({ command: 'npm test', mode: 'foreground' }) }, context);
    const fresh = await registry.execute({ id: 'complete-fresh', name: 'complete_task', arguments: JSON.stringify({ summary: 'done', evidence: ['fresh test'] }) }, context);
    expect(fresh.stopRun).toBe('completed');
  });

  it('returns useful failures for schema, process, timeout, and completion guard branches', async () => {
    const registry = new AgentToolRegistry();
    const { context, runtime, getTask } = createContext();
    runtime.listWorkspace = vi.fn(async () => []);
    runtime.searchWorkspace = vi.fn(async () => []);
    runtime.runShell = vi.fn(async (request) => ({
      timedOut: true,
      process: { id: 'p-live', sessionId: request.sessionId, runId: request.runId, containerId: request.containerId, command: request.command, isRunning: true, output: '', cursor: 0, exitCode: undefined },
    }));
    runtime.observeProcess = vi.fn(() => ({ id: 'p-live', sessionId: 's-1', runId: 'r-1', containerId: 'c-1', command: 'serve', isRunning: true, output: '', cursor: 0, exitCode: undefined }));
    runtime.sendProcessInput = vi.fn(async () => false);
    runtime.stopProcess = vi.fn(() => false);

    expect((await registry.execute({ id: 'schema', name: 'workspace_tree', arguments: '{}' }, context)).content).toContain('validation failed');
    expect((await registry.execute({ id: 'default-json', name: 'report_progress', arguments: '' }, context)).ok).toBe(false);
    expect((await registry.execute({ id: 'tree', name: 'workspace_tree', arguments: '{"max_depth":2}' }, context)).content).toBe('(workspace is empty)');
    expect((await registry.execute({ id: 'search', name: 'search_workspace', arguments: '{"query":"none"}' }, context)).content).toBe('(no matches)');
    const timedOut = await registry.execute({ id: 'timeout', name: 'shell_run', arguments: '{"command":"serve","mode":"background"}' }, context);
    expect(timedOut.content).toContain('Command still running');
    expect(timedOut.verification).toBeUndefined();
    expect((await registry.execute({ id: 'observe', name: 'process_observe', arguments: '{"process_id":"p-live"}' }, context)).content).toContain('(no new output)');
    expect((await registry.execute({ id: 'input', name: 'process_input', arguments: '{"process_id":"p-live","input":"y"}' }, context)).content).toContain('not running');
    expect((await registry.execute({ id: 'stop', name: 'process_stop', arguments: '{"process_id":"p-live"}' }, context)).content).toContain('not running');

    context.updateTask((task) => ({ ...task, changedWorkspace: true }));
    expect((await registry.execute({ id: 'changed', name: 'complete_task', arguments: '{"summary":"done","evidence":["x"]}' }, context)).content).toContain('no relevant successful verification');
    context.updateTask((task) => ({ ...task, changedWorkspace: false }));
    expect((await registry.execute({ id: 'no-plan', name: 'complete_task', arguments: '{"summary":"done","evidence":["x"]}' }, context)).content).toContain('needs a recorded execution plan');
    context.updateTask((task) => ({ ...task, plan: [{ id: 'still-going', title: 'Still going', status: 'in_progress' }] }));
    expect((await registry.execute({ id: 'unfinished', name: 'complete_task', arguments: '{"summary":"done","evidence":["x"]}' }, context)).content).toContain('unfinished steps');
    expect(getTask().evidence).toEqual([]);
  });
});
