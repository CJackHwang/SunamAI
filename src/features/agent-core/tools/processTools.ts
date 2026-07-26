import { z } from 'zod';
import { defineTool, isVerificationCommand, type RegisteredTool } from './base';

export const processTools: RegisteredTool[] = [
  defineTool({
    name: 'shell_run',
    description: 'Run a command inside the active WebContainer. Run your verification scripts here (e.g. `npm test`) to prove your code works before completing the task. Use foreground for inspection/tests; use background only for servers.',
    schema: z.object({ command: z.string().min(1), mode: z.enum(['foreground', 'background']), timeout_ms: z.number().int().min(1_000).max(300_000).optional() }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 300_000,
    resultType: 'process',
    async execute(input, context) {
      const result = await context.runtime.runShell({ command: input.command, mode: input.mode, ...(input.timeout_ms ? { timeoutMs: input.timeout_ms } : {}), containerId: context.containerId, sessionId: context.sessionId, runId: context.runId, signal: context.signal });
      const process = result.process;
      const output = process.output || '(no output)';
      const content = `${result.timedOut ? 'Command still running after timeout.' : `Exit: ${process.exitCode ?? 'running'}`}\nPID: ${process.id}\n${output}`;
      const verification = input.mode === 'foreground' && isVerificationCommand(input.command) ? { command: input.command, passed: !result.timedOut && process.exitCode === 0 } : undefined;
      const workspaceRevision = await context.runtime.getWorkspaceRevision(context.containerId);
      if (verification) context.updateTask((task) => ({
        ...task,
        workspaceRevision,
        verified: verification.passed,
        verifiedRevision: verification.passed ? workspaceRevision : -1,
        evidence: [...task.evidence, `${verification.passed ? 'Verified' : 'Failed verification'}: ${input.command}`],
        verificationEvidence: [...task.verificationEvidence, { ...verification, workspaceRevision, createdAt: Date.now() }],
      }));
      else context.updateTask((task) => ({ ...task, changedWorkspace: true, workspaceRevision, verified: false, verifiedRevision: -1 }));
      return { ok: !result.timedOut && (process.exitCode ?? 0) === 0, content, data: process, ...(verification ? { verification } : { changedWorkspace: true }) };
    },
  }),
  defineTool({
    name: 'process_observe',
    description: 'Observe incremental output and exit state of an Agent-owned background process.',
    schema: z.object({ process_id: z.string().min(1), cursor: z.number().int().min(0).optional() }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 5_000,
    resultType: 'process',
    async execute(input, context) {
      const process = context.runtime.observeProcess(input.process_id, { sessionId: context.sessionId, runId: context.runId, containerId: context.containerId }, input.cursor);
      if (!process) return { ok: false, content: 'Process not found.' };
      return { ok: true, content: `Running: ${process.isRunning}\nExit: ${process.exitCode ?? 'pending'}\nCursor: ${process.cursor}\n${process.output || '(no new output)'}`, data: process };
    },
  }),
  defineTool({
    name: 'process_input',
    description: 'Send input to an Agent-owned interactive process. IMPORTANT: To execute a command (press Enter), you MUST append "\\r" to your input. To send Ctrl+C, send "\\x03".',
    schema: z.object({ process_id: z.string().min(1), input: z.string() }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 5_000,
    resultType: 'control',
    async execute(input, context) {
      const sent = await context.runtime.sendProcessInput(input.process_id, { sessionId: context.sessionId, runId: context.runId, containerId: context.containerId }, input.input);
      return { ok: sent, content: sent ? 'Input sent.' : 'Process is not running.' };
    },
  }),
  defineTool({
    name: 'process_stop',
    description: 'Stop an Agent-owned background process that is no longer needed.',
    schema: z.object({ process_id: z.string().min(1) }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 5_000,
    resultType: 'control',
    async execute(input, context) {
      const stopped = context.runtime.stopProcess(input.process_id, { sessionId: context.sessionId, runId: context.runId, containerId: context.containerId });
      return { ok: stopped, content: stopped ? 'Process stopped.' : 'Process is not running.' };
    },
  }),
  defineTool({
    name: 'read_user_terminal',
    description: 'Read the recent output of the user\'s active terminal. Use this when the user asks you to fix an error they encountered, or to check the status of a command the user ran manually.',
    schema: z.object({}),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 5_000,
    resultType: 'text',
    async execute(_input, context) {
      const buffer = context.runtime.getUserTerminalBuffer();
      if (!buffer) return { ok: true, content: '(User terminal is currently empty or has not received any output yet)' };
      return { ok: true, content: `--- USER TERMINAL RECENT OUTPUT ---\n${buffer}\n--- END USER TERMINAL ---` };
    },
  }),
];
