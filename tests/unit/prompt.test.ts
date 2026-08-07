import { describe, expect, it } from 'vitest';
import { createChaosContract } from '@/features/agent-core/prompt';
import { BUILTIN_PERSONA_PROMPTS } from '@/shared/config/personaPrompts';
import { DEFAULT_PERSONA_SYSTEM_PROMPT } from '@/shared/config/personas';

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
