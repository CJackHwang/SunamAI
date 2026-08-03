import { z } from 'zod';
import { defineTool, type RegisteredTool } from './base';

const RESOURCES = { module: 'resources', defaultEnabled: true } as const;
const VIRTUAL_CONTAINER = { module: 'virtual-container', defaultEnabled: true } as const;

export const resourceTools: RegisteredTool[] = [
  defineTool({
    name: 'list_resources', description: 'List resources attached to this session. Resource bodies are not embedded in chat history.', schema: z.object({}),
    readOnly: true, concurrencySafe: true, dataImpact: 'none', timeoutMs: 5_000, resultType: 'resources',
    capability: RESOURCES,
    async execute(_input, context) {
      const resources = await context.runtime.listResources(context.sessionId);
      return { ok: true, content: resources.map((resource) => `${resource.id}\t${resource.kind}\t${resource.mimeType}\t${resource.size}\t${resource.name}`).join('\n') || '(no resources)', data: resources, resourceReferences: resources.map((resource) => resource.id) };
    },
  }),
  defineTool({
    name: 'read_resource_text', description: 'Read a bounded line range from a text resource without copying the whole resource into context.',
    schema: z.object({ resource_id: z.string().min(1), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).max(100_000).optional(), max_tokens: z.number().int().min(64).max(16_000).optional() }),
    readOnly: true, concurrencySafe: true, dataImpact: 'none', timeoutMs: 10_000, resultType: 'text',
    capability: RESOURCES,
    async execute(input, context) { return { ok: true, content: await context.runtime.readResourceText(context.sessionId, input.resource_id, input.start_line, input.end_line, input.max_tokens), data: { resourceId: input.resource_id }, resourceReferences: [input.resource_id] }; },
  }),
  defineTool({
    name: 'read_resource_image', description: 'Inspect an image resource. The durable reference is injected into the next model request within the media budget.',
    schema: z.object({ resource_id: z.string().min(1) }), readOnly: true, concurrencySafe: true, dataImpact: 'none', timeoutMs: 10_000, resultType: 'resource',
    capability: RESOURCES,
    async execute(input, context) {
      const resource = await context.runtime.readResourceImage(context.sessionId, input.resource_id);
      return { ok: true, content: `[image: ${resource.id}] ${resource.name} (${resource.mimeType}, ${resource.size} bytes)`, data: resource, modelContent: [{ type: 'image_resource', resourceId: resource.id }], resourceReferences: [resource.id] };
    },
  }),
  defineTool({
    name: 'materialize_resource', description: 'Copy a resource into the active workspace only when the task requires a real file.',
    schema: z.object({ resource_id: z.string().min(1), path: z.string().min(1) }), readOnly: false, concurrencySafe: false, dataImpact: 'workspace', timeoutMs: 20_000, resultType: 'changes',
    capability: VIRTUAL_CONTAINER,
    async execute(input, context) {
      const change = await context.runtime.materializeResource(context.sessionId, context.containerId, input.resource_id, input.path);
      const workspaceRevision = await context.runtime.getWorkspaceRevision(context.containerId);
      context.updateTask((task) => ({ ...task, changedWorkspace: true, workspaceRevision, verified: false, verifiedRevision: -1 }));
      return { ok: true, content: `${change.kind === 'created' ? 'Created' : 'Updated'} ${change.path} from resource ${input.resource_id} (${change.afterBytes} bytes)`, data: change, changedWorkspace: true, resourceReferences: [input.resource_id] };
    },
  }),
];
