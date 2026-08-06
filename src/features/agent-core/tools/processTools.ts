import { z } from 'zod';
import type { ProcessOwnership, ProcessStatus } from '@/shared/contracts/agentRuntime';
import { defineTool, type RegisteredTool, type ToolExecutionContext } from './base';

const VIRTUAL_CONTAINER = { module: 'virtual-container', defaultEnabled: true } as const;
const VIRTUAL_CONTAINER_WITH_SHELL = { module: 'virtual-container', defaultEnabled: true, dependencies: ['run_command'] } as const;

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

function processNotFound(processId: string): string {
  return `Process ${processId} not found in the current session and container. Call manage_process with action "list" to refresh the running-process list.`;
}

export const processTools: RegisteredTool[] = [
  defineTool({
    name: 'run_command',
    description: 'Execute a terminal command in the Succinix sandbox (real Unix tools + Node.js + Python with pip). Foreground commands record their real exit status as verification evidence; choose a truthful, relevant check and never mask failures. Use background only for servers. Write files with a heredoc or shell tools (e.g. `cat > path << \'EOF\'`, `sed -i`, `node -e "fs.writeFileSync(...)"`) instead of a dedicated patch tool.',
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
    name: 'manage_process',
    description: 'Manage Agent-owned processes in the Succinix sandbox: list, observe output, stop, or send input. Call with action=list to discover process ids first. Note: interactive stdin is not supported in the Succinix sandbox (file-RPC replaces it); input actions return an explanation instead of failing silently.',
    schema: z.object({
      action: z.enum(['list', 'observe', 'stop', 'input']),
      process_id: z.string().min(1).optional(),
      cursor: z.number().int().min(0).optional(),
      input: z.string().optional(),
    }).superRefine((value, context) => {
      if (value.action !== 'list' && !value.process_id) {
        context.addIssue({ code: 'custom', path: ['process_id'], message: 'process_id is required for observe, stop, and input actions.' });
      }
      if (value.action === 'input' && !value.input) {
        context.addIssue({ code: 'custom', path: ['input'], message: 'input is required for the input action.' });
      }
    }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'process',
    timeoutMs: 5_000,
    resultType: 'process',
    capability: VIRTUAL_CONTAINER_WITH_SHELL,
    async execute(input, context) {
      switch (input.action) {
        case 'list': {
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
        }
        case 'observe': {
          const processId = input.process_id!;
          const accessible = accessibleProcess(context, processId);
          if (!accessible) return { ok: false, content: processNotFound(processId) };
          const process = context.runtime.observeProcess(processId, ownershipOf(accessible), input.cursor);
          if (!process) return { ok: false, content: 'Process exited before it could be observed. Call manage_process with action "list" to refresh the running-process list.' };
          return { ok: true, content: `Running: ${process.isRunning}\nExit: ${process.exitCode ?? 'pending'}\nCursor: ${process.cursor}\n${process.output || '(no new output)'}`, data: process };
        }
        case 'stop': {
          const processId = input.process_id!;
          const process = accessibleProcess(context, processId);
          if (!process) return { ok: false, content: processNotFound(processId) };
          const taskRevisionBeforeStop = context.getTask().workspaceRevision;
          const runtimeRevisionBeforeStop = await context.runtime.getWorkspaceRevision(context.containerId);
          const stopped = await context.runtime.stopProcess(processId, ownershipOf(process));
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
          return { ok: stopped, content: stopped ? 'Process stopped.' : 'Process exited before it could be stopped. Call manage_process with action "list" to refresh the running-process list.' };
        }
        case 'input': {
          const processId = input.process_id!;
          const process = accessibleProcess(context, processId);
          if (!process) return { ok: false, content: processNotFound(processId) };
          // Succinix 无交互 stdin 是物理边界：文件 RPC 取代终端输入，这里如实说明而不假装已发送。
          return { ok: false, content: 'Interactive stdin is not supported in the Succinix sandbox (file-RPC replaces it); input could not be delivered to the process.' };
        }
      }
      return { ok: false, content: 'Unknown manage_process action.' };
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
