import type { AgentCheckpoint, AgentEvent, AgentRun } from '@/entities/agent/types';
import type { Message } from '@/entities/message/types';

const RESOURCE_TEXT_TOOLS = new Set(['read_resource_text']);

function stripEncodedPayloads(value: string): string {
  return value
    .replace(/data:[^;,\s]+(?:;[^,\s]+)*;base64,[a-zA-Z0-9+/=\s]{40,}/g, '[encoded payload omitted]')
    .replace(/[a-zA-Z0-9+/]{800,}={0,2}/g, '[large encoded payload omitted]');
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') return stripEncodedPayloads(value);
  if (typeof Blob !== 'undefined' && value instanceof Blob) return '[Blob omitted]';
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return '[binary payload omitted]';
  if (Array.isArray(value)) return value.map(sanitizeUnknown);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeUnknown(entry)]));
}

function resourceReadMarker(resourceIds: string[] | undefined): string {
  return `[resource text omitted from persistence: ${(resourceIds ?? []).join(', ') || 'unknown resource'}]`;
}

function sanitizeMessageForPersistence(message: Message): Message {
  const sanitized = sanitizeUnknown(message) as Message;
  const attachments = sanitized._ui_attachments?.map(({ file: _file, ...attachment }) => attachment);
  const withoutFiles = { ...sanitized, ...(attachments ? { _ui_attachments: attachments } : {}) };
  if (withoutFiles.role !== 'tool' || !withoutFiles.name || !RESOURCE_TEXT_TOOLS.has(withoutFiles.name)) return withoutFiles;
  return {
    ...withoutFiles,
    content: resourceReadMarker(withoutFiles.resourceIds),
    contentParts: (withoutFiles.contentParts ?? []).filter((part) => part.type !== 'text'),
  };
}

export function sanitizeRunForPersistence(run: AgentRun): AgentRun {
  return sanitizeUnknown(run) as AgentRun;
}

export function sanitizeEventForPersistence(event: AgentEvent): AgentEvent {
  const sanitized = sanitizeUnknown(event) as AgentEvent;
  if (sanitized.kind === 'message') return { ...sanitized, message: sanitizeMessageForPersistence(sanitized.message) };
  if (sanitized.kind === 'tool_finished' && RESOURCE_TEXT_TOOLS.has(sanitized.toolCall.function.name)) {
    const modelContent = sanitized.result.modelContent?.filter((part) => part.type !== 'text');
    return {
      ...sanitized,
      result: {
        ...sanitized.result,
        content: resourceReadMarker(sanitized.result.resourceReferences),
        ...(modelContent ? { modelContent } : {}),
      },
    };
  }
  return sanitized;
}

export function sanitizeCheckpointForPersistence(checkpoint: AgentCheckpoint): AgentCheckpoint {
  const sanitized = sanitizeUnknown(checkpoint) as AgentCheckpoint;
  return { ...sanitized, messages: sanitized.messages.map(sanitizeMessageForPersistence) };
}
