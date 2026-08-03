import { z } from 'zod';
import { defineTool, type RegisteredTool } from './base';
import type { AgentPlanItem } from '../types';
import { evaluateCompletionGate } from '../completion';

const AGENT_RUNTIME = { module: 'agent-runtime', defaultEnabled: true, warnOnDisable: true } as const;

export const controlTools: RegisteredTool[] = [
  defineTool({
    name: 'update_plan',
    description: 'Maintain a short execution plan. Root Agents use it for non-trivial work before editing; child plans are optional, but every item in an existing child plan must be completed before completion.',
    schema: z.object({ items: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), status: z.enum(['pending', 'in_progress', 'completed', 'blocked']) })).min(1).max(8) }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'task',
    timeoutMs: 5_000,
    resultType: 'plan',
    capability: AGENT_RUNTIME,
    async execute(input, context) {
      const plan: AgentPlanItem[] = input.items;
      context.updateTask((task) => ({ ...task, plan }));
      return { ok: true, content: `Plan updated with ${plan.length} steps.`, data: plan };
    },
  }),
  defineTool({
    name: 'report_progress',
    description: 'Send a concise public progress update. Do not expose private chain-of-thought.',
    schema: z.object({ message: z.string().min(1).max(800) }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'task',
    timeoutMs: 5_000,
    resultType: 'control',
    capability: AGENT_RUNTIME,
    async execute(input) { return { ok: true, content: input.message, data: { progress: input.message } }; },
  }),
  defineTool({
    name: 'ask_user',
    description: 'Ask only when blocked by missing credentials, an unrecoverable ambiguity, or an action outside the workspace.',
    schema: z.object({ question: z.string().min(1).max(1000) }),
    readOnly: true,
    concurrencySafe: false,
    dataImpact: 'run',
    timeoutMs: 5_000,
    resultType: 'control',
    capability: AGENT_RUNTIME,
    async execute(input) { return { ok: true, content: input.question, stopRun: 'awaiting_user' }; },
  }),
  defineTool({
    name: 'ask_parent',
    description: 'Ask the root Agent for a decision or missing information. This never contacts the end user. It pauses this child until the root Agent sends a follow-up message.',
    schema: z.object({ question: z.string().min(1).max(1_000) }),
    readOnly: true,
    concurrencySafe: false,
    dataImpact: 'run',
    timeoutMs: 5_000,
    resultType: 'control',
    capability: AGENT_RUNTIME,
    async execute(input, context) {
      if (context.agentRole === 'root') return { ok: false, content: 'ask_parent is available only to delegated child agents.' };
      return { ok: true, content: input.question, stopRun: 'awaiting_parent' };
    },
  }),
  defineTool({
    name: 'complete_task',
    description: 'Finish only after the task contract has evidence.',
    schema: z.object({ summary: z.string().min(1).max(2_000), evidence: z.array(z.string().min(1)).min(1).max(12) }),
    readOnly: true,
    concurrencySafe: false,
    dataImpact: 'run',
    timeoutMs: 5_000,
    resultType: 'control',
    capability: AGENT_RUNTIME,
    async execute(input, context) {
      const task = context.getTask();
      const gate = await evaluateCompletionGate({ task, agentRole: context.agentRole, runtime: context.runtime, containerId: context.containerId, containerAvailable: context.containerAvailable ?? true, shellAvailable: context.shellAvailable ?? true });
      context.updateTask(() => gate.task);
      if (!gate.ok) return { ok: false, content: gate.message };
      if (!input.evidence.length) return { ok: false, content: 'Completion blocked: provide structured evidence for the acceptance criteria.' };
      context.updateTask((current) => ({ ...current, evidence: [...current.evidence, ...input.evidence] }));
      return { ok: true, content: input.summary, finalSummary: input.summary, stopRun: 'completed' };
    },
  }),
];
