import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { detectEventTailDrift, detectWorkspaceDrift, mergeSessionRecords, projectConversationEvents, recoveredSessionStatus, selectMessageWindow, useAgentV2 } from '@/features/agent-core/useAgentV2';
import type { AgentEvent } from '@/features/agent-core/types';
import type { AgentRun } from '@/features/agent-core/types';
import { DEFAULT_CAPABILITY_CONFIG } from '@/shared/contracts/capability';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import { BUILTIN_PERSONA_PROMPTS } from '@/shared/config/personaPrompts';
import { STORAGE_KEYS } from '@/shared/lib/storage';
import { setPiEngineEnabled } from '@/features/agent-core/pi/featureFlag';

/** 捕获 createAgentDriver 收到的驱动入参（M1/M3 用），避免单测走真实 pi 动态 import。 */
const driverInputs = vi.hoisted(() => {
  const inputs: Array<Record<string, unknown>> = [];
  return {
    inputs,
    createAgentDriver: vi.fn(async (input: Record<string, unknown>) => {
      inputs.push(input);
      return {
        id: 'pi',
        capabilities: { steer: true, subagents: true, requiresLocalEnvironment: false },
        prompt: async () => undefined,
        abort: () => undefined,
        steer: () => true,
        destroy: () => undefined,
      };
    }),
  };
});

vi.mock('@/features/agent-core/driver/create', () => ({
  createAgentDriver: driverInputs.createAgentDriver,
}));

describe('useAgentV2 session isolation', () => {
  it('retains concurrent records for the active session without leaking the previous session', () => {
    const persisted = [{ id: 'new-persisted', sessionId: 's-new', value: 1 }];
    const current = [
      { id: 'old', sessionId: 's-old', value: 2 },
      { id: 'new-live', sessionId: 's-new', value: 3 },
    ];

    expect(mergeSessionRecords(persisted, current, 's-new')).toEqual([
      { id: 'new-persisted', sessionId: 's-new', value: 1 },
      { id: 'new-live', sessionId: 's-new', value: 3 },
    ]);
  });

  it('clears a stale running badge when the newest recovered run is interrupted', () => {
    const run = (id: string, phase: AgentRun['phase'], updatedAt: number): AgentRun => ({
      id, phase, updatedAt, sessionId: 's-1', containerId: 'c-1', model: 'm', persona: 'Sunam 6.9 Pron', createdAt: 1,
      task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
      chaos: { persona: 'Sunam 6.9 Pron', ritual: '', privateGoods: '', styleDirective: '', invariants: [] },
      budget: { maxModelTurns: 1, maxToolCalls: 1, maxDurationMs: 1 }, modelTurns: 0, toolCalls: 0, summary: '',
    });

    expect(recoveredSessionStatus([run('old', 'completed', 1), run('latest', 'interrupted', 2)])).toBe('idle');
    expect(recoveredSessionStatus([run('active', 'acting', 3)])).toBeNull();
    const child = { ...run('child', 'interrupted', 4), depth: 1, parentRunId: 'active', rootRunId: 'active', agentRole: 'explore' as const };
    expect(recoveredSessionStatus([run('active', 'completed', 3), child])).toBeNull();
  });

  it('projects root and selected child conversations without mixing their events', () => {
    const root = (id: string): AgentRun => ({
      id, phase: 'completed', updatedAt: 1, sessionId: 's-1', containerId: 'c-1', model: 'm', persona: 'Sunam 6.9 Pron', createdAt: 1,
      task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
      chaos: { persona: 'Sunam 6.9 Pron', ritual: '', privateGoods: '', styleDirective: '', invariants: [] },
      budget: { maxModelTurns: 1, maxToolCalls: 1, maxDurationMs: 1 }, modelTurns: 0, toolCalls: 0, summary: '', rootRunId: id, depth: 0, agentRole: 'root',
    });
    const parent = root('root');
    const child = { ...root('child'), rootRunId: parent.id, parentRunId: parent.id, depth: 1, agentRole: 'explore' as const };
    const event = (runId: string, content: string): AgentEvent => ({ id: `${runId}:1`, kind: 'message', sessionId: 's-1', runId, sequence: 1, createdAt: 1, message: { role: 'user', content } });
    const events = [event(parent.id, 'parent'), event(child.id, 'child')];

    expect(projectConversationEvents(events, [parent, child], { kind: 'root' })).toEqual([events[0]]);
    expect(projectConversationEvents(events, [parent, child], { kind: 'subagent', sessionId: 's-1', runId: child.id })).toEqual([events[1]]);
  });

  it('detects resume drift only when a checkpoint revision is known and differs', () => {
    expect(detectWorkspaceDrift(undefined, 4)).toBeUndefined();
    expect(detectWorkspaceDrift(4, 4)).toBeUndefined();
    expect(detectWorkspaceDrift(3, 4)).toEqual({ checkpointRevision: 3, currentRevision: 4 });
  });

  it('detects persisted events that landed after the checkpoint tail', () => {
    expect(detectEventTailDrift(undefined, 5)).toBeUndefined();
    expect(detectEventTailDrift(5, 5)).toBeUndefined();
    expect(detectEventTailDrift(5, 7)).toEqual({ checkpointSequence: 5, currentSequence: 7 });
  });

  it('keeps a 5,000-message history inside the fixed 250-message DOM window', () => {
    const messages = Array.from({ length: 5_000 }, (_, index) => index);
    expect(selectMessageWindow(messages, null)).toEqual(messages.slice(4_750));
    expect(selectMessageWindow(messages, 2_500)).toEqual(messages.slice(2_250, 2_500));
    expect(selectMessageWindow(messages, 100)).toHaveLength(100);
  });
});

describe('useAgentV2 pi engine escape hatch (M1)', () => {
  // 只作启动门禁的 truthiness 检查；驱动层已被 mock，不触碰 runtime 方法。
  const fakeRuntime = { ensureContainer: async () => undefined } as unknown as AgentWorkspaceRuntime;

  function renderAgent() {
    return renderHook(() => useAgentV2(
      'key', 'https://api.test/v1', 'model-a', 'Sunam 6.9 Pron', fakeRuntime,
      's1', 'c1', () => undefined, { kind: 'root' },
      { config: DEFAULT_CAPABILITY_CONFIG, containerAvailable: true },
      '',
    ));
  }

  it('does not launch an Agent run when the pi engine is disabled (chat-only)', () => {
    setPiEngineEnabled(false);
    localStorage.setItem(STORAGE_KEYS.piEngine, '0');
    const rendered = renderAgent();
    act(() => rendered.result.current.startTask('hello'));
    expect(rendered.result.current.runs).toHaveLength(0);
    expect(rendered.result.current.activeRun).toBeNull();
    expect(driverInputs.inputs).toHaveLength(0);
  });

  it('launches an Agent run when the pi engine is enabled', () => {
    setPiEngineEnabled(true);
    localStorage.setItem(STORAGE_KEYS.piEngine, '1');
    const rendered = renderAgent();
    act(() => rendered.result.current.startTask('hello'));
    expect(rendered.result.current.runs).toHaveLength(1);
    expect(driverInputs.inputs).toHaveLength(1);
    expect(driverInputs.inputs[0]!.apiModel).toBe('model-a');
  });
});

describe('useAgentV2 builtin persona system prompt (M3)', () => {
  const fakeRuntime = { ensureContainer: async () => undefined } as unknown as AgentWorkspaceRuntime;

  function renderAgent(persona: string) {
    return renderHook(() => useAgentV2(
      'key', 'https://api.test/v1', 'model-a', persona, fakeRuntime,
      's1', 'c1', () => undefined, { kind: 'root' },
      { config: DEFAULT_CAPABILITY_CONFIG, containerAvailable: true },
      '',
    ));
  }

  it('passes the builtin Sunam 6.9 Pron prompt as the driver systemPrompt when personaStyle is empty', () => {
    localStorage.setItem(STORAGE_KEYS.piEngine, '1');
    driverInputs.inputs.length = 0;
    const rendered = renderAgent('Sunam 6.9 Pron');
    act(() => rendered.result.current.startTask('hello'));
    expect(driverInputs.inputs).toHaveLength(1);
    expect(driverInputs.inputs[0]!.systemPrompt).toBe(BUILTIN_PERSONA_PROMPTS['Sunam 6.9 Pron']);
  });

  it('switches to the Sunam 11.4 Homo prompt when the persona changes', () => {
    localStorage.setItem(STORAGE_KEYS.piEngine, '1');
    driverInputs.inputs.length = 0;
    const rendered = renderAgent('Sunam 11.4 Homo');
    act(() => rendered.result.current.startTask('hello'));
    expect(driverInputs.inputs).toHaveLength(1);
    expect(driverInputs.inputs[0]!.systemPrompt).toBe(BUILTIN_PERSONA_PROMPTS['Sunam 11.4 Homo']);
  });
});
