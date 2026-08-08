import { describe, expect, it } from 'vitest';
import { createChaosContract, buildAgentSystemPrompt } from '@/features/agent-core/prompt';
import { BUILTIN_PERSONA_PROMPTS } from '@/shared/config/personaPrompts';
import { DEFAULT_PERSONA_SYSTEM_PROMPT } from '@/shared/config/personas';
import { initialTask } from '@/features/agent-core/task';
import type { ChaosContract, TaskContract } from '@/features/agent-core/types';

function baseTask(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    ...initialTask('prompt render'),
    plan: [{ id: 'p1', title: 'Step one', status: 'completed' }],
    evidence: ['verified the build'],
    ...overrides,
  };
}

function baseChaos(): ChaosContract {
  return createChaosContract('Sunam 6.9 Pron');
}

describe('createChaosContract (R5 persona system prompt)', () => {
  it('uses the provided custom style directive verbatim', () => {
    const chaos = createChaosContract('Custom Agent', 'Be terse and professional.');
    expect(chaos.persona).toBe('Custom Agent');
    expect(chaos.styleDirective).toBe('Be terse and professional.');
    expect(chaos.invariants.length).toBeGreaterThan(0);
  });

  it('falls back to the built-in persona prompt for built-ins with an empty directive', () => {
    const chaos = createChaosContract('Sunam 6.9 Pron', '');
    expect(chaos.styleDirective).toBe(BUILTIN_PERSONA_PROMPTS['Sunam 6.9 Pron']);
  });

  it('falls back to the default prompt for unknown personas', () => {
    const chaos = createChaosContract('Unknown Persona');
    expect(chaos.styleDirective).toBe(DEFAULT_PERSONA_SYSTEM_PROMPT);
  });

  it('prefers a custom directive over the built-in prompt', () => {
    const chaos = createChaosContract('Sunam 6.9 Pron', 'Custom override');
    expect(chaos.styleDirective).toBe('Custom override');
  });
});

describe('buildAgentSystemPrompt (container charter)', () => {
  it('renders the container workspace path and root verification directive', () => {
    const prompt = buildAgentSystemPrompt({ containerId: 'c-1', task: baseTask(), chaos: baseChaos(), summary: '', agentRole: 'root' });
    expect(prompt).toContain('/home/workspace/c-1');
    expect(prompt).toContain('Mandatory Verification');
    expect(prompt).toContain('run_command');
    expect(prompt).toContain('Step one');
  });

  it('renders the no-plan fallback and child verification directive', () => {
    const prompt = buildAgentSystemPrompt({
      containerId: 'c-1',
      task: baseTask({ plan: [], requiresPlan: false }),
      chaos: baseChaos(),
      summary: '',
      agentRole: 'task',
    });
    expect(prompt).toContain('- No plan has been committed yet.');
    expect(prompt).toContain('Optional Child Verification');
    expect(prompt).toContain('ask_parent');
    expect(prompt).not.toContain('Mandatory Verification');
  });

  it('renders recorded evidence and working summary', () => {
    const prompt = buildAgentSystemPrompt({ containerId: 'c-1', task: baseTask(), chaos: baseChaos(), summary: 'half done', agentRole: 'root' });
    expect(prompt).toContain('- verified the build');
    expect(prompt).toContain('half done');
  });

  it('switches to the chat-only charter when the container is unavailable', () => {
    const prompt = buildAgentSystemPrompt({ containerId: '__chat__', task: baseTask(), chaos: baseChaos(), summary: '', agentRole: 'root', containerAvailable: false });
    expect(prompt).toContain('no file system, no terminal, and no processes');
    expect(prompt).not.toContain('run_command');
    expect(prompt).not.toContain('Succinix container workspace');
  });

  it('renders the chat-only child boundary for delegated agents', () => {
    const prompt = buildAgentSystemPrompt({ containerId: '__chat__', task: baseTask(), chaos: baseChaos(), summary: '', agentRole: 'task', containerAvailable: false });
    expect(prompt).toContain('Child Boundary');
    expect(prompt).toContain('ask_parent');
  });
});
