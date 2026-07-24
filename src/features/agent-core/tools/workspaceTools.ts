import { z } from 'zod';
import { defineTool, type RegisteredTool } from './base';

export const workspaceTools: RegisteredTool[] = [
  defineTool({
    name: 'workspace_tree',
    description: 'Inspect the active workspace tree. Use this FIRST to orient yourself in the codebase. node_modules and .git are excluded.',
    schema: z.object({ max_depth: z.number().int().min(1).max(8) }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 10_000,
    resultType: 'tree',
    async execute(input, context) {
      const entries = await context.runtime.listWorkspace(context.containerId, input.max_depth);
      return { ok: true, content: entries.map((entry) => `${entry.isDirectory ? 'dir ' : 'file'} ${entry.path}`).join('\n') || '(workspace is empty)', data: entries };
    },
  }),
  defineTool({
    name: 'read_file',
    description: 'Read a bounded range from a text file in the active workspace. Read before changing an existing file.',
    schema: z.object({ path: z.string().min(1), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).max(10_000).optional() }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 10_000,
    resultType: 'text',
    async execute(input, context) {
      const content = await context.runtime.readWorkspaceFile(context.containerId, input.path, input.start_line, input.end_line);
      return { ok: true, content, data: { path: input.path } };
    },
  }),
  defineTool({
    name: 'search_workspace',
    description: 'Search text files in the active workspace. Use this instead of guessing where code lives.',
    schema: z.object({ query: z.string().min(1), max_results: z.number().int().min(1).max(100).default(30) }),
    readOnly: true,
    concurrencySafe: true,
    dataImpact: 'none',
    timeoutMs: 15_000,
    resultType: 'matches',
    async execute(input, context) {
      const matches = await context.runtime.searchWorkspace(context.containerId, input.query, input.max_results);
      return { ok: true, content: matches.map((match) => `${match.path}:${match.line}: ${match.content}`).join('\n') || '(no matches)', data: matches };
    },
  }),
  defineTool({
    name: 'apply_patch',
    description: 'Apply one or more full-file changes atomically within the active workspace. Use this for ALL file edits. Group multiple file changes into a single array payload to save time.',
    schema: z.object({ changes: z.array(z.object({ path: z.string().min(1), content: z.string(), expected_content: z.string().optional() })).min(1).max(12) }),
    readOnly: false,
    concurrencySafe: false,
    dataImpact: 'workspace',
    timeoutMs: 30_000,
    resultType: 'changes',
    async execute(input, context) {
      const changes = await context.runtime.applyWorkspaceChanges(context.containerId, input.changes.map((change) => ({ path: change.path, content: change.content, expectedContent: change.expected_content })));
      context.updateTask((task) => ({ ...task, changedWorkspace: true, workspaceRevision: task.workspaceRevision + 1, verified: false }));
      return { ok: true, content: changes.map((change) => `${change.kind === 'created' ? 'Created' : 'Updated'} ${change.path} (${change.beforeBytes} → ${change.afterBytes} bytes)`).join('\n'), data: changes, changedWorkspace: true };
    },
  }),
];
