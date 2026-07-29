import type { Message, MessageContentPart } from '@/entities/message/types';
import type { AgentModelClient, ModelContextProfile } from './modelClient';
import type { ModelTokenUsage } from './types';
import { canonicalContentParts, messageText } from '@/shared/contracts/message';
import { isPromptTooLongModelError } from './modelRetry';

const SUMMARY_MAX_TOKENS = 4_000;
const COMPACTION_TRIGGER_RATIO = 0.9;
const RECENT_CONTEXT_RATIO = 0.48;
const TOOL_OUTPUT_PREVIEW_TOKENS = 160;

export interface ContextRehydrationState {
  taskContract?: string;
  plan?: string;
  evidence?: string[];
  workspaceRevision?: number;
  eventTailSequence?: number;
  resourceIds?: string[];
  recentFiles?: Array<{ path: string; content: string }>;
  subagentStatus?: string[];
  fixedRequestTokens?: number;
  forceCompaction?: boolean;
  deterministicOnly?: boolean;
  onCompactionStart?: () => void | Promise<void>;
  onSummaryRequest?: () => void;
  onSummaryUsage?: (usage: ModelTokenUsage | undefined) => void;
}

export interface ContextCompactionResult {
  messages: Message[];
  compacted: boolean;
  fallback: boolean;
  fallbackReason?: string;
  summary: string;
  beforeTokens: number;
  afterTokens: number;
  rehydratedResourceIds: string[];
}

interface MessageGroup { messages: Message[]; tokens: number; }

function clipTokens(value: string, maxTokens: number, estimate: (value: string) => number = (text) => Math.ceil(text.length / 4)): string {
  if (estimate(value) <= maxTokens) return value;
  const marker = '\n[truncated]';
  const contentBudget = Math.max(0, maxTokens - estimate(marker));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimate(value.slice(0, middle)) <= contentBudget) low = middle;
    else high = middle - 1;
  }
  return `${value.slice(0, low)}${marker}`;
}

function stableDigest(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stripHeavyPayloads(value: string): string {
  return value
    .replace(/data:[^;,\s]+;base64,[a-zA-Z0-9+/=\s]{80,}/g, '[embedded media removed]')
    .replace(/[a-zA-Z0-9+/]{800,}={0,2}/g, '[large encoded payload removed]');
}

function messageTokens(message: Message, estimate: (value: string) => number): number {
  const toolArguments = message.tool_calls?.map((call) => `${call.function.name}:${call.function.arguments}`).join('\n') ?? '';
  const parts = canonicalContentParts(message).filter((part) => part.type !== 'text').map((part) => `[${part.type}: ${part.resourceId}]`).join('\n');
  return 4 + estimate(`${message.role}\n${messageText(message)}\n${toolArguments}\n${parts}`);
}

export function groupCompleteRounds(messages: Message[], estimate: (value: string) => number): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let index = 0;
  while (index < messages.length) {
    const first = messages[index]!;
    const grouped = [first];
    if (first.role === 'assistant' && first.tool_calls?.length) {
      const ids = new Set(first.tool_calls.map((call) => call.id));
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor]!.role === 'tool') {
        const tool = messages[cursor]!;
        if (tool.tool_call_id && ids.has(tool.tool_call_id)) grouped.push(tool);
        cursor += 1;
      }
      index = cursor;
    } else {
      index += 1;
    }
    groups.push({ messages: grouped, tokens: grouped.reduce((total, message) => total + messageTokens(message, estimate), 0) });
  }
  return groups;
}

function toolIdentity(call: NonNullable<Message['tool_calls']>[number]): { name: string; path: string } {
  let path = '';
  try {
    const parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
    path = String(parsed.path ?? parsed.file_path ?? parsed.resource_id ?? parsed.cwd ?? '');
  } catch { path = ''; }
  return { name: call.function.name, path };
}

function isProtectedToolOutput(name: string, content: string): boolean {
  return /apply_patch|write|edit|shell_run|verify|test/i.test(name) || /\b(error|failed|failure|exception|not found|exit code [1-9])\b/i.test(content);
}

export function microCompact(messages: Message[], estimate: (value: string) => number): { messages: Message[]; changed: boolean } {
  const groups = groupCompleteRounds(messages, estimate);
  const metadata = new Map<string, { name: string; path: string; readKey?: string }>();
  const latestRead = new Map<string, string>();
  let globalGeneration = 0;
  const pathGenerations = new Map<string, number>();
  groups.forEach((group, groupIndex) => {
    const calls = new Map((group.messages[0]?.tool_calls ?? []).map((call) => [call.id, call]));
    for (const call of calls.values()) {
      if (call.function.name === 'shell_run') { globalGeneration += 1; continue; }
      if (!/apply_patch|materialize_resource/i.test(call.function.name)) continue;
      try {
        const input = JSON.parse(call.function.arguments) as { path?: unknown; changes?: Array<{ path?: unknown }> };
        const paths = call.function.name === 'apply_patch' ? (input.changes ?? []).map((change) => String(change.path ?? '')) : [String(input.path ?? '')];
        paths.filter(Boolean).forEach((path) => pathGenerations.set(path, (pathGenerations.get(path) ?? 0) + 1));
      } catch { globalGeneration += 1; }
    }
    group.messages.forEach((message, messageIndex) => {
      if (message.role !== 'tool' || !message.tool_call_id) return;
      const call = calls.get(message.tool_call_id);
      if (!call) return;
      const identity = toolIdentity(call);
      const position = `${groupIndex}:${messageIndex}`;
      if (/read_file|read_resource_text/i.test(identity.name)) {
        const readKey = `${identity.name}:${identity.path}:generation=${globalGeneration}:${pathGenerations.get(identity.path) ?? 0}:digest=${stableDigest(message.content)}`;
        metadata.set(position, { ...identity, readKey });
        latestRead.set(readKey, position);
      } else metadata.set(position, identity);
    });
  });
  let changed = false;
  const compacted = groups.flatMap((group, groupIndex) => {
    return group.messages.map((message, messageIndex) => {
      if (message.role !== 'tool') return message;
      const identity = metadata.get(`${groupIndex}:${messageIndex}`);
      if (!identity) return message;
      const duplicateRead = identity.readKey !== undefined && latestRead.get(identity.readKey) !== `${groupIndex}:${messageIndex}`;
      const oldLowValue = groupIndex < groups.length - 4 && !isProtectedToolOutput(identity.name, message.content);
      if (!duplicateRead && !oldLowValue) return message;
      changed = true;
      const preview = clipTokens(stripHeavyPayloads(message.content), TOOL_OUTPUT_PREVIEW_TOKENS, estimate);
      return { ...message, content: `[micro-compacted ${identity.name}${identity.path ? ` ${identity.path}` : ''}; digest=${stableDigest(message.content)}]\n${preview}` };
    });
  });
  return { messages: compacted, changed };
}

function persistedResourceMarker(message: Message): string | null {
  return message.role === 'tool' && message.name === 'read_resource_text'
    ? `[resource text read: ${(message.resourceIds ?? []).join(', ') || 'unknown resource'}; body omitted]`
    : null;
}

function summaryRecord(groups: MessageGroup[], estimate: (value: string) => number): string {
  return groups.flatMap((group) => group.messages.map((message) => {
    const calls = message.tool_calls?.map((call) => `${call.function.name}(${stripHeavyPayloads(call.function.arguments)})`).join(', ');
    const resources = message.resourceIds?.map((id) => `[resource: ${id}]`).join(' ') ?? '';
    const parts = canonicalContentParts(message).filter((part) => part.type !== 'text').map((part) => `[${part.type}: ${part.resourceId}]`).join(' ');
    const body = persistedResourceMarker(message) ?? clipTokens(stripHeavyPayloads(messageText(message) || calls || ''), 320, estimate);
    return `${message.role.toUpperCase()}: ${body}${resources || parts ? `\n${resources} ${parts}` : ''}`;
  })).join('\n');
}

function deterministicSummary(groups: MessageGroup[], estimate: (value: string) => number): string {
  const failures: string[] = [];
  const changes: string[] = [];
  const verification: string[] = [];
  const userFeedback: string[] = [];
  for (const group of groups) {
    for (const message of group.messages) {
      const line = persistedResourceMarker(message) ?? clipTokens(stripHeavyPayloads(message.content), 180, estimate);
      if (message.role === 'user') userFeedback.push(line);
      if (/\b(error|failed|failure|exception|exit code [1-9])\b/i.test(line)) failures.push(line);
      if (/apply_patch|changed|modified|created|deleted/i.test(`${message.name ?? ''} ${line}`)) changes.push(line);
      if (/test|verify|passed|build/i.test(`${message.name ?? ''} ${line}`)) verification.push(line);
    }
  }
  const section = (title: string, values: string[]) => `${title}:\n${values.slice(-8).map((value) => `- ${value}`).join('\n') || '- none'}`;
  return [section('Latest user direction', userFeedback), section('Workspace changes', changes), section('Verification', verification), section('Failures and unresolved risks', failures), `Continuation digest: ${stableDigest(summaryRecord(groups, estimate))}`].join('\n\n');
}

function rehydrationRecord(summary: string, state: ContextRehydrationState, profile: ModelContextProfile, estimate: (value: string) => number): { message: Message; resourceIds: string[] } {
  const maxFileTokens = Math.max(256, Math.floor(profile.contextWindowTokens * 0.025));
  const maxAllFileTokens = Math.max(512, Math.floor(profile.contextWindowTokens * 0.08));
  let remainingFileTokens = maxAllFileTokens;
  const files = (state.recentFiles ?? []).slice(-5).flatMap((file) => {
    if (remainingFileTokens <= 0) return [];
    const allotted = Math.min(maxFileTokens, remainingFileTokens);
    const clipped = clipTokens(stripHeavyPayloads(file.content), allotted, estimate);
    remainingFileTokens -= estimate(clipped);
    return [`FILE ${file.path}:\n${clipped}`];
  });
  const resourceIds = [...new Set(state.resourceIds ?? [])];
  const body = [
    `Compressed working record:\n${clipTokens(summary, SUMMARY_MAX_TOKENS, estimate)}`,
    state.taskContract ? `TASK CONTRACT:\n${state.taskContract}` : '',
    state.plan ? `CURRENT PLAN:\n${state.plan}` : '',
    state.evidence?.length ? `EVIDENCE:\n${state.evidence.map((item) => `- ${item}`).join('\n')}` : '',
    `WORKSPACE REVISION: ${state.workspaceRevision ?? 0}`,
    state.eventTailSequence === undefined ? '' : `EVENT TAIL SEQUENCE: ${state.eventTailSequence}`,
    resourceIds.length ? `ACTIVE RESOURCES: ${resourceIds.map((id) => `[resource: ${id}]`).join(' ')}` : '',
    state.subagentStatus?.length ? `SUBAGENT STATUS:\n${state.subagentStatus.join('\n')}` : '',
    ...files,
  ].filter(Boolean).join('\n\n');
  return { message: { role: 'system', content: body, contentParts: [{ type: 'text', text: body }, ...resourceIds.map((resourceId) => ({ type: 'file_resource' as const, resourceId }))], resourceIds }, resourceIds };
}

export function fitGroupWithinBudget(group: MessageGroup, budget: number, estimate: (value: string) => number): MessageGroup {
  const perMessageBudget = Math.max(64, Math.floor(budget / Math.max(1, group.messages.length)) - 8);
  const messages = group.messages.map((message) => {
    const content = clipTokens(stripHeavyPayloads(messageText(message)), perMessageBudget, estimate);
    const mediaParts = canonicalContentParts(message).filter((part) => part.type !== 'text');
    const tool_calls = message.tool_calls?.map((call) => {
      const argumentsText = stripHeavyPayloads(call.function.arguments);
      const argumentsValue = estimate(argumentsText) <= perMessageBudget
        ? call.function.arguments
        : JSON.stringify({ _compacted: true, digest: stableDigest(call.function.arguments), note: 'Historical tool arguments exceeded the retained context budget.' });
      return { ...call, function: { ...call.function, arguments: argumentsValue } };
    });
    return {
      ...message,
      content: `[oversized recent message clipped; digest=${stableDigest(messageText(message))}]\n${content}`,
      contentParts: [{ type: 'text' as const, text: content }, ...mediaParts],
      ...(tool_calls ? { tool_calls } : {}),
    };
  });
  return { messages, tokens: messages.reduce((total, message) => total + messageTokens(message, estimate), 0) };
}

function recentGroupsWithinBudget(groups: MessageGroup[], budget: number, estimate: (value: string) => number): MessageGroup[] {
  const selected: MessageGroup[] = [];
  let used = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const original = groups[index]!;
    const group = selected.length === 0 && original.tokens > budget ? fitGroupWithinBudget(original, budget, estimate) : original;
    if (selected.length > 0 && used + group.tokens > budget) break;
    selected.unshift(group);
    used += group.tokens;
  }
  return selected;
}

function enforceMediaBudget(messages: Message[], maxImages: number): Message[] {
  let remaining = maxImages;
  return [...messages].reverse().map((message) => {
    const parts = canonicalContentParts(message);
    const nextReversed: MessageContentPart[] = [];
    for (const part of [...parts].reverse()) {
      if (part.type !== 'image_resource') nextReversed.push(part);
      else if (remaining > 0) { remaining -= 1; nextReversed.push(part); }
    }
    const nextParts = nextReversed.reverse();
    const omitted = parts.filter((part) => part.type === 'image_resource').length - nextParts.filter((part) => part.type === 'image_resource').length;
    return omitted > 0 ? { ...message, content: `${message.content}\n[${omitted} older image resource(s) omitted from the media budget; durable IDs remain available.]`, contentParts: nextParts } : message;
  }).reverse();
}

export class ContextComposer {
  private summary: string;
  private circuitOpen = false;

  constructor(initialSummary = '') { this.summary = initialSummary; }
  getSummary(): string { return this.summary; }

  async compactIfNeeded(messages: Message[], client: AgentModelClient, signal: AbortSignal, state: ContextRehydrationState = {}): Promise<ContextCompactionResult> {
    const profile = client.getContextProfile?.() ?? { contextWindowTokens: 32_768, defaultOutputTokens: 4_096, summaryReserveTokens: 4_096, safetyBufferTokens: 2_048 };
    const estimate = client.estimateTokens?.bind(client) ?? ((value: string) => Math.ceil(value.length / 4));
    const fixedRequestTokens = Math.max(0, state.fixedRequestTokens ?? 0);
    const transcriptTokens = messages.reduce((total, message) => total + messageTokens(message, estimate), 0);
    const beforeTokens = fixedRequestTokens + transcriptTokens;
    const effectiveTokens = Math.max(4_096, profile.contextWindowTokens - profile.defaultOutputTokens - profile.summaryReserveTokens - profile.safetyBufferTokens);
    if (!state.forceCompaction && beforeTokens < Math.floor(effectiveTokens * COMPACTION_TRIGGER_RATIO)) {
      return { messages, compacted: false, fallback: false, summary: this.summary, beforeTokens, afterTokens: beforeTokens, rehydratedResourceIds: [] };
    }
    await state.onCompactionStart?.();

    const micro = microCompact(messages, estimate);
    const groups = groupCompleteRounds(micro.messages, estimate);
    const availableTokens = Math.max(1_024, effectiveTokens - fixedRequestTokens);
    const recentBudget = Math.floor(availableTokens * RECENT_CONTEXT_RATIO);
    const recent = recentGroupsWithinBudget(groups, recentBudget, estimate);
    const old = groups.slice(0, Math.max(0, groups.length - recent.length));
    let fallback = this.circuitOpen || Boolean(state.deterministicOnly);
    let fallbackReason = state.deterministicOnly ? 'main_prompt_too_long' : this.circuitOpen ? 'compaction_circuit_open' : undefined;

    if (!fallback && old.length > 0) {
      let candidate = old;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          state.onSummaryRequest?.();
          const response = await client.complete([
            { role: 'system', content: 'Create a compact factual continuation record. Preserve the task, constraints, decisions, file changes, failed attempts, verification evidence, user feedback, active processes, resources by ID, and unresolved risks. Never include hidden reasoning. Tools are disabled.' },
            { role: 'user', content: summaryRecord(candidate, estimate) },
          ], { signal, tools: [], onDelta: () => undefined });
          state.onSummaryUsage?.(response.usage);
          this.summary = clipTokens(response.message.content, SUMMARY_MAX_TOKENS, estimate) || deterministicSummary(candidate, estimate);
          this.circuitOpen = false;
          fallbackReason = undefined;
          break;
        } catch (error) {
          if (signal.aborted || error instanceof DOMException && error.name === 'AbortError') throw error;
          if (!isPromptTooLongModelError(error) || attempt === 3) {
            fallback = true;
            fallbackReason = isPromptTooLongModelError(error)
              ? 'semantic_compaction_prompt_too_long'
              : error instanceof Error ? `semantic_compaction_failed:${error.name}` : 'semantic_compaction_failed';
            this.circuitOpen = true;
            this.summary = deterministicSummary(old, estimate);
            break;
          }
          const drop = Math.max(1, Math.ceil(candidate.length * 0.2));
          candidate = candidate.slice(drop);
        }
      }
    } else if (old.length > 0) {
      this.summary = deterministicSummary(old, estimate);
    } else if (!this.summary) {
      this.summary = deterministicSummary(groups, estimate);
    }

    const rehydrated = rehydrationRecord(this.summary, state, profile, estimate);
    const rehydrationBudget = Math.floor(availableTokens * 0.45);
    const boundedRehydration = messageTokens(rehydrated.message, estimate) > rehydrationBudget
      ? fitGroupWithinBudget({ messages: [rehydrated.message], tokens: messageTokens(rehydrated.message, estimate) }, rehydrationBudget, estimate).messages[0]!
      : rehydrated.message;
    const mediaBudget = profile.contextWindowTokens >= 128_000 ? 8 : 4;
    let nextMessages = [boundedRehydration, ...enforceMediaBudget(recent.flatMap((group) => group.messages), mediaBudget)];
    let afterTokens = fixedRequestTokens + nextMessages.reduce((total, message) => total + messageTokens(message, estimate), 0);
    while (nextMessages.length > 2 && afterTokens > effectiveTokens) {
      const regrouped = groupCompleteRounds(nextMessages.slice(1), estimate);
      regrouped.shift();
      nextMessages = [boundedRehydration, ...regrouped.flatMap((group) => group.messages)];
      afterTokens = fixedRequestTokens + nextMessages.reduce((total, message) => total + messageTokens(message, estimate), 0);
    }
    return { messages: nextMessages, compacted: true, fallback, ...(fallbackReason ? { fallbackReason } : {}), summary: this.summary, beforeTokens, afterTokens, rehydratedResourceIds: rehydrated.resourceIds };
  }
}
