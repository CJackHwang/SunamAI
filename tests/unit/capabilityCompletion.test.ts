import { describe, expect, it } from 'vitest';
import { evaluateCompletionGate } from '@/features/agent-core/completion';
import { buildAgentSystemPrompt, createChaosContract } from '@/features/agent-core/prompt';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { TaskContract } from '@/features/agent-core/types';

function chatOnlyRuntime(): AgentWorkspaceRuntime {
  return {
    ensureContainer: async () => undefined,
    getWorkspaceRevision: async () => 0,
    flushWorkspace: async () => undefined,
    flushSnapshots: async () => undefined,
    listResources: async () => [],
    readResourceText: async () => '',
    readResourceImage: async () => ({ id: 'res', name: 'i.png', kind: 'image', mimeType: 'image/png', size: 1, sha256: 'x', createdAt: 1 }),
    materializeResource: async () => { throw new Error('disabled'); },
    listWorkspace: async () => [],
    readWorkspaceFile: async () => '',
    searchWorkspace: async () => [],
    applyWorkspaceChanges: async () => { throw new Error('disabled'); },
    runShell: async () => { throw new Error('disabled'); },
    observeProcess: () => null,
    sendProcessInput: async () => false,
    stopProcess: async () => false,
    stopRun: () => undefined,
    getProcesses: () => [],
    subscribe: () => () => undefined,
    getUserTerminalBuffer: () => '',
    appendUserTerminalBuffer: () => undefined,
  };
}

function baseTask(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    objective: 'answer', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [],
    evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [],
    ...overrides,
  };
}

describe('completion gate in chat-only mode', () => {
  const runtime = chatOnlyRuntime();

  it('passes a planless, unchanged root task without requiring shell verification', async () => {
    const gate = await evaluateCompletionGate({ task: baseTask(), agentRole: 'root', runtime, containerId: '__chat__' });
    expect(gate.ok).toBe(true);
  });

  it('still enforces plan completion for non-trivial tasks', async () => {
    const gate = await evaluateCompletionGate({
      task: baseTask({ requiresPlan: true, plan: [{ id: 'p1', title: 'step', status: 'pending' }] }),
      agentRole: 'root', runtime, containerId: '__chat__',
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.phase).toBe('planning');
  });

  it('skips workspace verification for a stale changed task in chat-only', async () => {
    const gate = await evaluateCompletionGate({
      task: baseTask({ changedWorkspace: true, verified: false, verifiedRevision: -1 }),
      agentRole: 'root', runtime, containerId: '__chat__', containerAvailable: false,
    });
    expect(gate.ok).toBe(true);
  });

  it('still requires verification when the container is available', async () => {
    const gate = await evaluateCompletionGate({
      task: baseTask({ changedWorkspace: true, verified: false, verifiedRevision: -1 }),
      agentRole: 'root', runtime, containerId: 'c-1', containerAvailable: true,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.phase).toBe('verifying');
      expect(gate.message).toContain('run_command');
    }
  });

  it('does not block on shell verification when run_command is disabled but write tools remain', async () => {
    const gate = await evaluateCompletionGate({
      task: baseTask({ changedWorkspace: true, verified: false, verifiedRevision: -1 }),
      agentRole: 'root', runtime, containerId: 'c-1', containerAvailable: true, shellAvailable: false,
    });
    expect(gate.ok).toBe(true);
  });
});

describe('chat-only system prompt', () => {
  const chaos = createChaosContract('Sunam 6.9 Pron');
  const task = baseTask();

  it('does not reference workspace paths, file tools, or shell', () => {
    const prompt = buildAgentSystemPrompt({ containerId: '__chat__', task, chaos, summary: '', agentRole: 'root', containerAvailable: false });
    expect(prompt).toContain('no file system');
    expect(prompt).not.toContain('run_command');
    expect(prompt).not.toContain('manage_process');
    expect(prompt).not.toContain('workspace_tree');
    expect(prompt).not.toContain('Succinix container workspace');
  });

  it('keeps the container charter when the container is available', () => {
    const prompt = buildAgentSystemPrompt({ containerId: 'c-1', task, chaos, summary: '', agentRole: 'root', containerAvailable: true });
    expect(prompt).toContain('run_command');
    expect(prompt).toContain('Succinix container workspace');
  });
});
