import { z } from 'zod';
import type { ProcessOwnership, ProcessStatus } from '@/shared/contracts/agentRuntime';
import { defineTool, type RegisteredTool, type ToolExecutionContext } from './base';

const VIRTUAL_CONTAINER = { module: 'virtual-container', defaultEnabled: true } as const;
const VIRTUAL_CONTAINER_WITH_SHELL = { module: 'virtual-container', defaultEnabled: true, dependencies: ['shell_run'] } as const;

function processScope(context: ToolExecutionContext): Partial<ProcessOwnership> {
  const scope = { sessionId: context.sessionId, containerId: context.containerId };
  return context.agentRole === 'root' ? scope : { ...scope, runId: context.runId };
}

function accessibleProcesses(context: ToolExecutionContext): ProcessStatus[] {
  return context.runtime.getProcesses(processScope(context));
}

function accessibleProcess(context: ToolExecutionContext, processId: string): ProcessStatus | undefined {
  return accessibleProcesses(context).find((process) => process.id === processId);
}

function ownershipOf(process: ProcessStatus): ProcessOwnership {
  return { sessionId: process.sessionId, runId: process.runId, containerId: process.containerId };
}

export const processTools: RegisteredTool[] = [
  defineTool({
    name: 'shell_run',
    description: 'Run any project command inside the active WebContainer. Foreground commands record their real exit status as current-revision verification evidence; choose a truthful, relevant check and never mask failures. Use background only for servers.',
    schema: z.object({ command: z.string().min(1), mode: z.enum(['foreground', 'background']), timeout_ms: z.number().int().min(1_000).max(300_000).optional() }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 300_000,
    resultType: 'process',
    capability: VIRTUAL_CONTAINER,
    async execute(input, context) {
      const result = await context.runtime.runShell({ command: input.command, mode: input.mode, ...(input.timeout_ms ? { timeoutMs: input.timeout_ms } : {}), containerId: context.containerId, sessionId: context.sessionId, runId: context.runId, signal: context.signal });
      const process = result.process;
      const output = process.output || '(no output)';
      const content = `${result.timedOut ? 'Command still running after timeout.' : `Exit: ${process.exitCode ?? 'running'}`}\nAgent process ID: ${process.id}\n${output}`;
      const verification = input.mode === 'foreground' ? { command: input.command, passed: !result.timedOut && process.exitCode === 0 } : undefined;
      const workspaceRevision = await context.runtime.getWorkspaceRevision(context.containerId);
      if (verification) context.updateTask((task) => ({
        ...task,
        workspaceRevision,
        verified: verification.passed,
        verifiedRevision: verification.passed ? workspaceRevision : -1,
        evidence: [...task.evidence, `${verification.passed ? 'Verified' : 'Failed verification'}: ${input.command}`],
        verificationEvidence: [...task.verificationEvidence, { ...verification, workspaceRevision, createdAt: Date.now() }],
      }));
      else context.updateTask((task) => ({ ...task, changedWorkspace: task.changedWorkspace || input.mode === 'foreground', workspaceRevision, verified: false, verifiedRevision: -1 }));
      return { ok: !result.timedOut && (process.exitCode ?? 0) === 0, content, data: process, ...(verification ? { verification } : {}) };
    },
  }),
  defineTool({
    name: 'process_list',
    description: 'List running Agent-owned processes in the current session and container, including processes started by earlier root runs. Use this before observing, sending input to, or stopping a previously started service; do not guess operating-system PIDs or kill by port.',
    schema: z.object({}),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 5_000,
    resultType: 'process',
    capability: VIRTUAL_CONTAINER_WITH_SHELL,
    async execute(_input, context) {
      const processes = accessibleProcesses(context);
      if (!processes.length) return { ok: true, content: '(no running Agent processes in this session and container)', data: [] };
      const summaries = processes.map((process) => ({
        processId: process.id,
        ownerRunId: process.runId,
        command: process.command,
        isRunning: process.isRunning,
        outputTail: process.output.slice(-1_000),
      }));
      const processMetadata = summaries.map(({ outputTail: _outputTail, ...process }) => process);
      return { ok: true, content: JSON.stringify(summaries, null, 2), data: processMetadata };
    },
  }),
  defineTool({
    name: 'process_observe',
    description: 'Observe incremental output and exit state of an Agent-owned process in the current session and container. Call process_list first when the process was started by an earlier run.',
    schema: z.object({ process_id: z.string().min(1), cursor: z.number().int().min(0).optional() }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 5_000,
    resultType: 'process',
    capability: VIRTUAL_CONTAINER_WITH_SHELL,
    async execute(input, context) {
      const accessible = accessibleProcess(context, input.process_id);
      if (!accessible) return { ok: false, content: 'Process not found in the current session and container. Call process_list to refresh the running-process list.' };
      const process = context.runtime.observeProcess(input.process_id, ownershipOf(accessible), input.cursor);
      if (!process) return { ok: false, content: 'Process exited before it could be observed. Call process_list to refresh the running-process list.' };
      return { ok: true, content: `Running: ${process.isRunning}\nExit: ${process.exitCode ?? 'pending'}\nCursor: ${process.cursor}\n${process.output || '(no new output)'}`, data: process };
    },
  }),
  defineTool({
    name: 'process_input',
    description: 'Send input to an Agent-owned interactive process in the current session and container, including one started by an earlier root run. Call process_list first. IMPORTANT: To execute a command (press Enter), append "\\r"; to send Ctrl+C, send "\\x03".',
    schema: z.object({ process_id: z.string().min(1), input: z.string() }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 5_000,
    resultType: 'control',
    capability: VIRTUAL_CONTAINER_WITH_SHELL,
    async execute(input, context) {
      const process = accessibleProcess(context, input.process_id);
      if (!process) return { ok: false, content: 'Process not found in the current session and container. Call process_list to refresh the running-process list.' };
      const sent = await context.runtime.sendProcessInput(input.process_id, ownershipOf(process), input.input);
      return { ok: sent, content: sent ? 'Input sent.' : 'Process exited before input could be sent. Call process_list to refresh the running-process list.' };
    },
  }),
  defineTool({
    name: 'process_stop',
    description: 'Stop an Agent-owned process in the current session and container, including a service started by an earlier root run. Call process_list first and stop the registered process ID instead of guessing a PID or killing by port.',
    schema: z.object({ process_id: z.string().min(1) }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 5_000,
    resultType: 'control',
    capability: VIRTUAL_CONTAINER_WITH_SHELL,
    async execute(input, context) {
      const process = accessibleProcess(context, input.process_id);
      if (!process) return { ok: false, content: 'Process not found in the current session and container. Call process_list to refresh the running-process list.' };
      const taskRevisionBeforeStop = context.getTask().workspaceRevision;
      const runtimeRevisionBeforeStop = await context.runtime.getWorkspaceRevision(context.containerId);
      const stopped = await context.runtime.stopProcess(input.process_id, ownershipOf(process));
      if (stopped) {
        const workspaceRevision = await context.runtime.getWorkspaceRevision(context.containerId);
        context.updateTask((task) => ({
          ...task,
          changedWorkspace: task.changedWorkspace
            || taskRevisionBeforeStop !== runtimeRevisionBeforeStop
            || workspaceRevision !== runtimeRevisionBeforeStop + 1,
          workspaceRevision,
          verified: false,
          verifiedRevision: -1,
        }));
      }
      return { ok: stopped, content: stopped ? 'Process stopped.' : 'Process exited before it could be stopped. Call process_list to refresh the running-process list.' };
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
    capability: VIRTUAL_CONTAINER_WITH_SHELL,
    async execute(_input, context) {
      const buffer = context.runtime.getUserTerminalBuffer();
      if (!buffer) return { ok: true, content: '(User terminal is currently empty or has not received any output yet)' };
      return { ok: true, content: `--- USER TERMINAL RECENT OUTPUT ---\n${buffer}\n--- END USER TERMINAL ---` };
    },
  }),
];
