import { describe, expect, it, beforeEach } from 'vitest';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
import { STORAGE_KEYS } from '@/shared/lib/storage';
import { createAgentDriver } from '@/features/agent-core/driver/create';
import { resolveAgentDriverId, setAgentDriverId } from '@/features/agent-core/driver/config';
import { PiDriver, createPiDriver } from '@/features/agent-core/driver/piDriver';
import { createClaudeCodeDriver, type CliSpawner } from '@/features/agent-core/driver/claudeCodeDriver';
import { createCodexDriver } from '@/features/agent-core/driver/codexDriver';
import type { AgentDriverInit } from '@/features/agent-core/driver/types';
import type { AgentEvent, AgentRun } from '@/features/agent-core/types';
import type { PiAgentLike } from '@/features/agent-core/pi/piSession';
import { initialTask } from '@/features/agent-core/task';
import { createChaosContract } from '@/features/agent-core/prompt';

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
    budget: { maxModelTurns: 1, maxToolCalls: 0, maxDurationMs: 5 * 60_000 },
    modelTurns: 0,
    toolCalls: 0,
    summary: '',
    rootRunId: runId,
    agentRole: 'root',
    depth: 0,
    toolPolicy: { role: 'root', allowedTools: [] },
  };
}

function createInit(overrides: Partial<AgentDriverInit> = {}): AgentDriverInit {
  const run = createRun();
  return {
    apiKey: 'test-key',
    baseUrl: 'https://api.deepseek.com/v1',
    apiModel: 'deepseek-v4-flash',
    sessionId: run.sessionId,
    runId: run.id,
    run,
    onEvent: () => undefined,
    onRunChange: () => undefined,
    ...overrides,
  };
}

class FakeSession {
  readonly prompts: string[] = [];
  abortCalls = 0;
  steerCalls = 0;
  destroyCalls = 0;

  prompt(text: string): Promise<void> {
    this.prompts.push(text);
    return Promise.resolve();
  }

  abort(): void { this.abortCalls += 1; }

  steer(_message: string): boolean {
    this.steerCalls += 1;
    return true;
  }

  destroy(): void { this.destroyCalls += 1; }
}

class FakePiAgent implements PiAgentLike {
  listener: ((event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>) | null = null;
  readonly promptInputs: Array<string | PiAgentMessage> = [];

  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  async prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void> {
    this.promptInputs.push(typeof input === 'string' ? input : input as PiAgentMessage);
  }

  abort(): void {}

  waitForIdle(): Promise<void> { return Promise.resolve(); }
}

describe('PiDriver adapter', () => {
  it('forwards prompt/abort/steer/destroy to the wrapped pi session', async () => {
    const session = new FakeSession();
    const driver = new PiDriver(createInit(), () => session);

    expect(driver.id).toBe('pi');
    expect(driver.capabilities).toEqual({ steer: true, subagents: true, requiresLocalEnvironment: false });

    await driver.prompt('hello');
    expect(session.prompts).toEqual(['hello']);

    driver.abort();
    expect(session.abortCalls).toBe(1);

    expect(driver.steer?.('continue')).toBe(true);
    expect(session.steerCalls).toBe(1);

    driver.destroy();
    expect(session.destroyCalls).toBe(1);
  });

  it('createPiDriver lazily wraps a real PiSession (default driver path)', async () => {
    const agent = new FakePiAgent();
    const driver = await createPiDriver({ ...createInit(), createAgent: () => agent, persistSession: false });
    expect(driver.id).toBe('pi');
    await driver.prompt('hello');
    expect(agent.promptInputs).toHaveLength(1);
    expect(agent.promptInputs[0]).toMatchObject({ role: 'user', content: 'hello' });
    driver.destroy();
  });
});

describe('AGENT_DRIVER config', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.agentDriver);
  });

  it('defaults to the built-in pi driver when unconfigured', () => {
    expect(resolveAgentDriverId()).toBe('pi');
  });

  it('reads a configured driver id', () => {
    setAgentDriverId('claude-code');
    expect(resolveAgentDriverId()).toBe('claude-code');
  });

  it('falls back to pi on an invalid stored value', () => {
    localStorage.setItem(STORAGE_KEYS.agentDriver, 'unknown');
    expect(resolveAgentDriverId()).toBe('pi');
  });
});

describe('createAgentDriver config dispatch', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.agentDriver);
  });

  it('defaults to the PiDriver', async () => {
    const driver = await createAgentDriver(createInit());
    expect(driver.id).toBe('pi');
    expect(driver.capabilities.requiresLocalEnvironment).toBe(false);
    driver.destroy();
  });

  it('switches to ClaudeCodeDriver when AGENT_DRIVER=claude-code', async () => {
    setAgentDriverId('claude-code');
    const driver = await createAgentDriver(createInit());
    expect(driver.id).toBe('claude-code');
    expect(driver.capabilities).toEqual({ steer: false, subagents: false, requiresLocalEnvironment: true });
  });

  it('switches to CodexDriver when AGENT_DRIVER=codex', async () => {
    setAgentDriverId('codex');
    const driver = await createAgentDriver(createInit());
    expect(driver.id).toBe('codex');
    expect(driver.capabilities.requiresLocalEnvironment).toBe(true);
  });
});

describe('ClaudeCodeDriver bridge', () => {
  it('rejects gracefully when the environment is not local (browser shell)', async () => {
    const driver = createClaudeCodeDriver(createInit(), { environment: 'browser' });
    await expect(driver.prompt('hello')).rejects.toThrow('ClaudeCode driver requires a local environment.');
  });

  it('runs claude -p in local mode and bridges the reply into the existing event model', async () => {
    const events: AgentEvent[] = [];
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawnCli: CliSpawner = async (command, args) => {
      calls.push({ command, args });
      return { stdout: 'Hello from claude', stderr: '', exitCode: 0 };
    };
    const driver = createClaudeCodeDriver(createInit({ onEvent: (event) => events.push(event) }), {
      environment: 'local',
      spawnCli,
    });

    await driver.prompt('hello');

    expect(calls).toEqual([{ command: 'claude', args: ['-p', 'hello'] }]);
    expect(events.some((event) => event.kind === 'run_started')).toBe(true);
    expect(events.some((event) => event.kind === 'run_finished')).toBe(true);
    const message = events.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message').at(-1);
    expect(message?.message).toEqual({ role: 'assistant', content: 'Hello from claude' });
  });

  it('destroy cleans up the external signal forwarding', () => {
    const controller = new AbortController();
    const driver = createClaudeCodeDriver(createInit({ signal: controller.signal }));
    expect(() => driver.abort()).not.toThrow();
    expect(() => driver.destroy()).not.toThrow();
    // destroy 幂等。
    expect(() => driver.destroy()).not.toThrow();
  });
});

describe('CodexDriver skeleton', () => {
  it('exposes the codex id and local-only capabilities', () => {
    const driver = createCodexDriver(createInit());
    expect(driver.id).toBe('codex');
    expect(driver.capabilities).toEqual({ steer: false, subagents: false, requiresLocalEnvironment: true });
  });

  it('rejects gracefully as a browser-infeasible bridge', async () => {
    const driver = createCodexDriver(createInit());
    await expect(driver.prompt('hello')).rejects.toThrow('Codex driver requires a local environment.');
  });
});
