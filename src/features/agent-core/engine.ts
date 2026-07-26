import type { ChatAttachment, Message, ToolCall } from '@/entities/message/types';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { SunamModel } from '@/shared/config/models';
import { ContextComposer, fitGroupWithinBudget, groupCompleteRounds } from './context';
import { AgentEventEmitter } from './events';
import type { AgentEventStore } from './eventStore';
import type { AgentModelClient } from './modelClient';
import { buildAgentSystemPrompt, createChaosContract } from './prompt';
import { sanitizeToolTranscript } from './projector';
import { AgentToolRegistry, type ParsedToolCall, type ToolExecutionContext } from './tools';
import type { SubagentHost } from './tools/base';
import type { AgentBudget, AgentEvent, AgentPhase, AgentRole, AgentRun, AgentToolResult, TaskContract } from './types';
import { createId } from '@/shared/lib/ids';
import { isAbortError, isPromptTooLongModelError, retryModelRequest } from './modelRetry';
import { scheduleToolBatch } from './toolBatchScheduler';
import { initialTask, isNonTrivial, rebuildTaskForResume } from './task';
import { ResourceProcessorRegistry } from './resourceProcessor';
import { AgentFamilyBudget, ContainerMutationLease } from './agentFamily';
import { canonicalizeMessage } from '@/shared/contracts/message';
import { redactSecrets } from '@/shared/lib/errors';

const DEFAULT_BUDGET: AgentBudget = { maxModelTurns: 60, maxToolCalls: 150, maxDurationMs: 15 * 60_000 };
const MAX_READ_ONLY_CONCURRENCY = 4;

const redact = redactSecrets;

export interface AgentResumeState {
  sourceRunId: string;
  task: TaskContract;
  summary: string;
  workspaceDrift?: { checkpointRevision: number; currentRevision: number };
  eventTailDrift?: { checkpointSequence: number; currentSequence: number };
  subagentStatus?: string[];
}

export interface AgentEngineOptions {
  runId?: string;
  sessionId: string;
  containerId: string;
  persona: SunamModel;
  model: string;
  input: string;
  attachments?: ChatAttachment[];
  initialMessages: Message[];
  client: AgentModelClient;
  runtime: AgentWorkspaceRuntime;
  store: AgentEventStore;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  onRunChange: (run: AgentRun) => void;
  budget?: Partial<AgentBudget>;
  resume?: AgentResumeState;
  inheritedSummary?: string;
  lineage?: { rootRunId: string; parentRunId: string; role: Exclude<AgentRole, 'root'>; delegatedTaskId: string; depth: 1; writeScope?: string[] };
  familyBudget?: AgentFamilyBudget;
  mutationLease?: ContainerMutationLease;
}

const CHILD_COMMON_TOOLS = ['workspace_tree', 'read_file', 'search_workspace', 'list_resources', 'read_resource_text', 'read_resource_image', 'update_plan', 'report_progress', 'ask_user', 'complete_task'];

function toolsForRole(role: AgentRole): string[] | undefined {
  if (role === 'root') return undefined;
  if (role === 'explore') return CHILD_COMMON_TOOLS;
  if (role === 'implement') return [...CHILD_COMMON_TOOLS, 'apply_patch', 'materialize_resource'];
  return [...CHILD_COMMON_TOOLS, 'shell_run'];
}

export class AgentEngine {
  private readonly options: AgentEngineOptions;
  private readonly registry: AgentToolRegistry;
  private readonly resourceProcessor = new ResourceProcessorRegistry();
  private readonly context: ContextComposer;
  private readonly run: AgentRun;
  private readonly emitter: AgentEventEmitter;
  private task: TaskContract;
  private transcript: Message[];
  private readonly startedAt = Date.now();
  private lastToolSignature: string | undefined;
  private repeatedToolCount = 0;
  private readonly executionController = new AbortController();
  private readonly deadlineTimer: ReturnType<typeof setTimeout>;
  private readonly forwardCancellation: () => void;
  private readonly familyBudget: AgentFamilyBudget;
  private readonly mutationLease: ContainerMutationLease;
  private readonly recentFiles = new Map<string, string>();
  private subagentHost: SubagentHost | undefined;

  constructor(options: AgentEngineOptions) {
    this.options = options;
    const id = options.runId ?? createId('r');
    this.task = options.resume ? rebuildTaskForResume(options.resume.task) : initialTask(options.input);
    const driftRecord = [
      options.resume?.workspaceDrift ? `RECOVERY WORKSPACE DRIFT: checkpoint revision ${options.resume.workspaceDrift.checkpointRevision}, current revision ${options.resume.workspaceDrift.currentRevision}. Treat prior workspace reads and verification as stale until re-inspected.` : '',
      options.resume?.eventTailDrift ? `RECOVERY EVENT DRIFT: checkpoint tail ${options.resume.eventTailDrift.checkpointSequence}, persisted run tail ${options.resume.eventTailDrift.currentSequence}. Reconcile post-checkpoint events before acting.` : '',
      options.resume?.subagentStatus?.length ? `RECOVERED SUBAGENT STATUS:\n${options.resume.subagentStatus.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    this.context = new ContextComposer([options.resume?.summary ?? options.inheritedSummary ?? '', driftRecord].filter(Boolean).join('\n\n'));
    this.familyBudget = options.familyBudget ?? new AgentFamilyBudget();
    this.mutationLease = options.mutationLease ?? new ContainerMutationLease();
    const role: AgentRole = options.lineage?.role ?? 'root';
    const toolNames = toolsForRole(role);
    this.registry = new AgentToolRegistry(toolNames ? new Set(toolNames) : undefined);
    this.run = {
      id,
      sessionId: options.sessionId,
      containerId: options.containerId,
      model: options.model,
      persona: options.persona,
      phase: 'preparing',
      createdAt: this.startedAt,
      updatedAt: this.startedAt,
      task: this.task,
      chaos: createChaosContract(options.persona),
      budget: { ...DEFAULT_BUDGET, ...options.budget },
      modelTurns: 0,
      toolCalls: 0,
      summary: '',
      rootRunId: options.lineage?.rootRunId ?? id,
      ...(options.resume ? { parentRunId: options.resume.sourceRunId } : {}),
      agentRole: role,
      ...(options.lineage ? { delegatedTaskId: options.lineage.delegatedTaskId } : {}),
      depth: options.lineage?.depth ?? 0,
      toolPolicy: { role, allowedTools: toolNames ?? this.registry.getApiDefinitions().map((tool) => tool.function.name), ...(options.lineage?.writeScope ? { writeScope: options.lineage.writeScope } : {}) },
    };
    if (options.lineage) this.run.parentRunId = options.lineage.parentRunId;
    this.forwardCancellation = () => this.executionController.abort(new DOMException('Agent stopped by user.', 'AbortError'));
    if (options.signal.aborted) this.forwardCancellation();
    else options.signal.addEventListener('abort', this.forwardCancellation, { once: true });
    this.deadlineTimer = setTimeout(() => this.executionController.abort(new Error('Agent run exceeded its time budget.')), this.run.budget.maxDurationMs);
    this.transcript = options.initialMessages.filter((message) => message.role !== 'system').map(canonicalizeMessage);
    if (driftRecord) this.transcript.push({ role: 'system', content: driftRecord });
    this.emitter = new AgentEventEmitter(options.sessionId, id, async (event) => {
      await this.options.store.append(event);
      this.options.onEvent(event);
    });
  }

  getRun(): AgentRun {
    return this.run;
  }

  getFamilyBudget(): AgentFamilyBudget { return this.familyBudget; }
  getMutationLease(): ContainerMutationLease { return this.mutationLease; }
  setSubagentHost(host: SubagentHost): void { if ((this.run.depth ?? 0) === 0) this.subagentHost = host; }
  messageFromParent(message: string): void { this.transcript.push({ role: 'system', content: `Parent coordinator update: ${message}` }); }

  private async updateRun(): Promise<void> {
    this.run.updatedAt = Date.now();
    this.run.task = this.task;
    this.run.summary = this.context.getSummary();
    await this.options.store.saveRun(this.run);
    this.options.onRunChange({ ...this.run, task: { ...this.run.task, plan: [...this.run.task.plan], evidence: [...this.run.task.evidence] } });
  }

  private async phase(phase: AgentPhase, detail?: string): Promise<void> {
    this.run.phase = phase;
    await this.updateRun();
    await this.emitter.emit('phase_changed', { phase, ...(detail ? { detail } : {}) });
  }

  private async emitMessage(message: Message): Promise<void> {
    const safeMessage = canonicalizeMessage({
      ...message,
      content: redact(message.content),
      ...(message.contentParts ? { contentParts: message.contentParts.map((part) => part.type === 'text' ? { ...part, text: redact(part.text) } : part) } : {}),
    });
    this.transcript.push(safeMessage);
    await this.emitter.emit('message', { message: safeMessage });
  }

  private updateTask(updater: (current: TaskContract) => TaskContract): void {
    this.task = updater(this.task);
    this.run.task = this.task;
  }

  private async reflectTask(): Promise<void> {
    await this.options.runtime.flushWorkspace(this.run.containerId);
    const workspaceRevision = await this.options.runtime.getWorkspaceRevision(this.run.containerId);
    await this.updateRun();
    await this.emitter.emit('plan_updated', { task: this.task });
    const summary = this.context.getSummary() || this.task.evidence.join('\n') || 'Run checkpoint recorded.';
    await this.emitter.emit('checkpoint', { summary });
    const estimate = this.options.client.estimateTokens?.bind(this.options.client) ?? ((value: string) => Math.ceil(value.length / 4));
    const profile = this.options.client.getContextProfile?.() ?? { contextWindowTokens: 32_768, defaultOutputTokens: 4_096, summaryReserveTokens: 4_096, safetyBufferTokens: 2_048 };
    const tailBudget = Math.max(2_048, Math.floor(profile.contextWindowTokens * 0.2));
    const groups = groupCompleteRounds(this.transcript, estimate);
    const tail: Message[] = [];
    let tailTokens = 0;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const original = groups[index]!;
      const group = tail.length === 0 && original.tokens > tailBudget ? fitGroupWithinBudget(original, tailBudget, estimate) : original;
      if (tail.length > 0 && tailTokens + group.tokens > tailBudget) break;
      tail.unshift(...group.messages);
      tailTokens += group.tokens;
    }
    await this.options.store.saveCheckpoint({
      id: this.run.id,
      runId: this.run.id,
      sessionId: this.run.sessionId,
      containerId: this.run.containerId,
      summary,
      messages: tail,
      createdAt: Date.now(),
      eventTailSequence: this.emitter.getSequence(),
      workspaceRevision,
      resourceIds: [...new Set(this.transcript.flatMap((message) => message.resourceIds ?? []))],
    });
  }

  private assertBudget(): void {
    if (this.executionController.signal.aborted) throw this.executionController.signal.reason;
    if (Date.now() - this.startedAt > this.run.budget.maxDurationMs) throw new Error('Agent run exceeded its time budget.');
    if (this.run.modelTurns >= this.run.budget.maxModelTurns) throw new Error('Agent run exceeded its model-turn budget.');
    if (this.run.toolCalls >= this.run.budget.maxToolCalls) throw new Error('Agent run exceeded its tool-call budget.');
  }

  private async completeModelRequest(messages: Message[]): Promise<Awaited<ReturnType<AgentModelClient['complete']>> > {
    return retryModelRequest(async () => {
      let streamedContent = '';
      let streamedReasoning = '';
      const response = await this.options.client.complete(sanitizeToolTranscript(messages), {
        signal: this.executionController.signal,
        tools: this.registry.getApiDefinitions(),
        onDelta: (message) => {
          streamedContent = message.content;
          streamedReasoning = message.reasoning_content ?? '';
          void this.emitter.emit('assistant_delta', { content: streamedContent, reasoningContent: streamedReasoning, transient: true });
        },
      });
      const reasoningContent = response.message.reasoning_content || streamedReasoning;
      this.recordModelUsage(response.usage);
      return { ...response, message: { ...response.message, content: response.message.content || streamedContent, ...(reasoningContent ? { reasoning_content: reasoningContent } : {}) } };
    }, async (attempt, delayMs, error) => this.emitter.emit('model_retry', { attempt, delayMs, error }), this.executionController.signal);
  }

  private recordModelUsage(usage: AgentRun['modelUsage']): void {
    if (!usage) return;
    const previous = this.run.modelUsage;
    this.run.modelUsage = {
      inputTokens: (previous?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (previous?.outputTokens ?? 0) + usage.outputTokens,
      totalTokens: (previous?.totalTokens ?? 0) + usage.totalTokens,
      estimated: (previous?.estimated ?? false) || usage.estimated,
    };
  }

  private toToolCall(call: ParsedToolCall): ToolCall {
    return this.registry.toMessageToolCall(call);
  }

  private async executeOne(call: ParsedToolCall): Promise<{ call: ParsedToolCall; result: AgentToolResult }> {
    this.run.toolCalls += 1;
    const signature = `${call.name}:${call.arguments}`;
    this.repeatedToolCount = signature === this.lastToolSignature ? this.repeatedToolCount + 1 : 1;
    this.lastToolSignature = signature;
    if (this.repeatedToolCount >= 3) {
      const message = `Recovery required: ${call.name} was requested with identical arguments ${this.repeatedToolCount} consecutive times.`;
      await this.emitter.emit('recovery_hint', { message });
      if (this.repeatedToolCount >= 4) throw new Error(`Agent repeated ${call.name} with identical arguments after recovery guidance.`);
      return { call, result: { ok: false, content: message } };
    }
    const toolCall = this.toToolCall(call);
    await this.emitter.emit('tool_requested', { toolCall });
    await this.emitter.emit('tool_started', { toolCall });
    const context: ToolExecutionContext = {
      sessionId: this.options.sessionId,
      runId: this.run.id,
      containerId: this.options.containerId,
      runtime: this.options.runtime,
      signal: this.executionController.signal,
      agentRole: this.run.agentRole ?? 'root',
      ...(this.run.toolPolicy?.writeScope ? { writeScope: this.run.toolPolicy.writeScope } : {}),
      ...(this.subagentHost ? { subagents: this.subagentHost } : {}),
      mutationLease: this.mutationLease,
      getTask: () => this.task,
      updateTask: (updater) => this.updateTask(updater),
    };
    const result = await this.registry.execute(call, context);
    const safeResult = { ...result, content: redact(result.content) };
    if (safeResult.ok && call.name === 'read_file') {
      try {
        const path = String((JSON.parse(call.arguments) as Record<string, unknown>).path ?? '');
        if (path) {
          this.recentFiles.delete(path);
          this.recentFiles.set(path, safeResult.content);
          while (this.recentFiles.size > 10) this.recentFiles.delete(this.recentFiles.keys().next().value!);
        }
      } catch { /* Invalid arguments are reported by the tool registry. */ }
    }
    if (safeResult.changedWorkspace) {
      const changed = Array.isArray(safeResult.data) ? safeResult.data : [safeResult.data];
      changed.forEach((item) => {
        if (item && typeof item === 'object' && 'path' in item) this.recentFiles.delete(String(item.path));
      });
    }
    await this.emitter.emit('tool_finished', { toolCall, result: safeResult });
    if (safeResult.data && call.name === 'report_progress') await this.emitter.emit('progress_reported', { message: safeResult.content });
    if (safeResult.verification) {
      await this.emitter.emit('verification', { command: safeResult.verification.command, passed: safeResult.verification.passed, detail: safeResult.content });
      if (!safeResult.verification.passed) await this.emitter.emit('recovery_hint', { message: `Verification failed for ${safeResult.verification.command}; inspect the output and repair before completion.` });
    }
    return { call, result: safeResult };
  }

  private async rejectOne(call: ParsedToolCall, message: string): Promise<{ call: ParsedToolCall; result: AgentToolResult }> {
    this.run.toolCalls += 1;
    const toolCall = this.toToolCall(call);
    const result = { ok: false, content: message };
    await this.emitter.emit('tool_requested', { toolCall });
    await this.emitter.emit('tool_started', { toolCall });
    await this.emitter.emit('tool_finished', { toolCall, result });
    return { call, result };
  }

  private async executeTools(calls: ParsedToolCall[]): Promise<Array<{ call: ParsedToolCall; result: AgentToolResult }>> {
    const remaining = this.run.budget.maxToolCalls - this.run.toolCalls;
    if (calls.length > remaining) throw new Error(`Agent run tool-call budget cannot execute this batch (${calls.length} requested, ${Math.max(0, remaining)} remaining).`);
    this.familyBudget.reserveToolCalls(calls.length);
    const terminalIndexes = calls.flatMap((call, index) => call.name === 'complete_task' || call.name === 'ask_user' ? [index] : []);
    if (terminalIndexes.length > 1 || terminalIndexes.some((index) => index !== calls.length - 1)) {
      const message = 'Tool batch rejected: complete_task or ask_user must be the single terminal control call at the end of a batch. No requested side effects were executed.';
      const rejected: Array<{ call: ParsedToolCall; result: AgentToolResult }> = [];
      for (const call of calls) rejected.push(await this.rejectOne(call, message));
      return rejected;
    }
    return scheduleToolBatch({
      calls,
      isConcurrencySafe: (call) => Boolean(this.registry.getMetadata(call.name)?.concurrencySafe),
      execute: (call) => this.executeOne(call),
      assertCanContinue: () => this.assertBudget(),
      maxConcurrency: MAX_READ_ONLY_CONCURRENCY,
    });
  }

  private async finish(summary: string, phase: 'completed' | 'awaiting_user' = 'completed'): Promise<void> {
    await this.phase(phase);
    this.run.finalSummary = summary;
    await this.updateRun();
    await this.emitter.emit('run_finished', { summary });
  }

  async execute(): Promise<void> {
    try {
      await this.options.runtime.ensureContainer(this.options.containerId);
      const initialWorkspaceRevision = await this.options.runtime.getWorkspaceRevision(this.options.containerId);
      if (this.task.workspaceRevision !== initialWorkspaceRevision) {
        this.task = { ...this.task, workspaceRevision: initialWorkspaceRevision, verified: false, verifiedRevision: -1 };
        this.run.task = this.task;
      }
      await this.options.store.saveRun(this.run);
      await this.emitter.start(this.run);
      const attachments = this.options.attachments ?? [];
      const resources = await this.resourceProcessor.process(attachments, this.run.sessionId, this.run.id);
      const resourceManifest = resources.length ? `\n\nAttached resources (use resource tools to inspect on demand):\n${resources.map((resource) => `- [${resource.kind}: ${resource.id}] ${resource.name} (${resource.mimeType}, ${resource.size} bytes)`).join('\n')}` : '';
      const modelInput = `${this.options.input}${resourceManifest}`;
      const safeAttachments: ChatAttachment[] = resources.map((resource) => ({ name: resource.name, size: resource.size, type: resource.mimeType, resourceId: resource.id }));
      await this.emitMessage({
        role: 'user', content: modelInput, contentParts: [{ type: 'text', text: this.options.input }, ...resources.map((resource) => ({ type: resource.kind === 'image' ? 'image_resource' as const : 'file_resource' as const, resourceId: resource.id }))],
        resourceIds: resources.map((resource) => resource.id), _ui_displayContent: this.options.input, _ui_attachments: safeAttachments,
      });
      await this.phase(isNonTrivial(this.options.input) ? 'planning' : 'acting');
      let emptyResponses = 0;
      let noProgressTurns = 0;

      while (true) {
        this.assertBudget();
        const workspaceRevision = await this.options.runtime.getWorkspaceRevision(this.options.containerId);
        const system = buildAgentSystemPrompt({ containerId: this.options.containerId, task: this.task, chaos: this.run.chaos, summary: this.context.getSummary() });
        const estimate = this.options.client.estimateTokens?.bind(this.options.client) ?? ((value: string) => Math.ceil(value.length / 4));
        const toolSchemaTokens = estimate(JSON.stringify(this.registry.getApiDefinitions()));
        const mediaTokens = this.transcript.reduce((total, message) => total + (message.contentParts?.filter((part) => part.type === 'image_resource').length ?? 0) * 1_024, 0);
        const contextState = {
          taskContract: `Objective: ${this.task.objective}\nAcceptance criteria: ${this.task.acceptanceCriteria.join('; ')}\nConstraints: ${this.task.constraints.join('; ')}`,
          plan: this.task.plan.map((item) => `[${item.status}] ${item.title}`).join('\n'),
          evidence: this.task.evidence,
          workspaceRevision,
          eventTailSequence: this.emitter.getSequence(),
          resourceIds: [...new Set(this.transcript.flatMap((message) => message.resourceIds ?? []))],
          recentFiles: [...this.recentFiles.entries()].map(([path, content]) => ({ path, content })),
          subagentStatus: this.subagentHost?.snapshot() ?? [],
          fixedRequestTokens: estimate(system) + toolSchemaTokens + mediaTokens,
          onSummaryRequest: () => { this.assertBudget(); this.familyBudget.consumeModelTurn(); this.run.modelTurns += 1; },
          onSummaryUsage: (usage: AgentRun['modelUsage']) => this.recordModelUsage(usage),
        };
        const compacted = await this.context.compactIfNeeded(this.transcript, this.options.client, this.executionController.signal, contextState);
        if (compacted.compacted) {
          this.transcript = compacted.messages;
          await this.emitter.emit('context_compacted', {
            summary: compacted.summary,
            fallback: compacted.fallback,
            beforeTokens: compacted.beforeTokens,
            afterTokens: compacted.afterTokens,
            eventTailSequence: this.emitter.getSequence(),
            workspaceRevision,
            rehydratedResourceIds: compacted.rehydratedResourceIds,
            ...(compacted.fallbackReason ? { fallbackReason: compacted.fallbackReason } : {}),
          });
          await this.reflectTask();
        }
        const requestSystem = compacted.compacted
          ? buildAgentSystemPrompt({ containerId: this.options.containerId, task: this.task, chaos: this.run.chaos, summary: this.context.getSummary() })
          : system;
        let response: Awaited<ReturnType<AgentModelClient['complete']>> | undefined;
        for (let promptAttempt = 1; promptAttempt <= 3; promptAttempt += 1) {
          try {
            this.assertBudget();
            this.familyBudget.consumeModelTurn();
            this.run.modelTurns += 1;
            response = await this.completeModelRequest([{ role: 'system', content: requestSystem }, ...this.transcript]);
            break;
          } catch (error) {
            if (!isPromptTooLongModelError(error)) throw error;
            if (promptAttempt === 3) {
              const fallback = await this.context.compactIfNeeded(this.transcript, this.options.client, this.executionController.signal, { ...contextState, forceCompaction: true, deterministicOnly: true });
              this.transcript = fallback.messages;
              await this.emitter.emit('context_compacted', {
                summary: fallback.summary, fallback: true, beforeTokens: fallback.beforeTokens, afterTokens: fallback.afterTokens,
                eventTailSequence: this.emitter.getSequence(), workspaceRevision, rehydratedResourceIds: fallback.rehydratedResourceIds,
                fallbackReason: fallback.fallbackReason ?? 'main_prompt_too_long',
              });
              await this.reflectTask();
              throw error;
            }
            const groups = groupCompleteRounds(this.transcript, estimate);
            const drop = Math.max(1, Math.ceil(groups.length * 0.2));
            this.transcript = groups.slice(drop).flatMap((group) => group.messages);
            await this.emitter.emit('recovery_hint', { message: `Prompt exceeded the provider limit; removed the oldest 20% of complete message groups before retry ${promptAttempt + 1}/3.` });
          }
        }
        if (!response) throw new Error('The model request ended without a response.');
        if (response.toolCalls.length) {
          emptyResponses = 0;
          const assistant: Message = { ...response.message, content: redact(response.message.content), tool_calls: response.toolCalls.map((call) => this.toToolCall(call)) };
          await this.emitMessage(assistant);
          await this.phase('acting');
          const results = await this.executeTools(response.toolCalls);
          for (const { call, result } of results) {
            await this.emitMessage({ role: 'tool', tool_call_id: call.id, name: call.name, content: result.content, ...(result.modelContent ? { contentParts: result.modelContent } : {}), ...(result.resourceReferences ? { resourceIds: result.resourceReferences } : {}) });
          }
          await this.reflectTask();
          const madeProgress = results.some(({ result }) => result.changedWorkspace || result.verification?.passed || result.stopRun || result.data && typeof result.data === 'object');
          noProgressTurns = madeProgress ? 0 : noProgressTurns + 1;
          if (noProgressTurns >= 2) {
            const message = 'No meaningful progress was recorded. Re-inspect the task contract and workspace, then choose a different corrective action.';
            this.transcript.push({ role: 'system', content: message });
            await this.emitter.emit('recovery_hint', { message });
            noProgressTurns = 0;
          }
          const terminal = results.find(({ result }) => result.stopRun)?.result;
          if (terminal?.stopRun === 'awaiting_user') {
            await this.emitMessage({ role: 'assistant', content: terminal.content });
            await this.finish(terminal.content, 'awaiting_user');
            return;
          }
          if (terminal?.stopRun === 'completed') {
            await this.emitMessage({ role: 'assistant', content: terminal.finalSummary ?? terminal.content });
            await this.finish(terminal.finalSummary ?? terminal.content);
            return;
          }
          await this.phase(this.task.changedWorkspace ? 'verifying' : 'observing');
          continue;
        }
        if (response.message.content.trim()) {
          await this.emitMessage({
            role: 'assistant',
            content: response.message.content,
            ...(response.message.reasoning_content ? { reasoning_content: response.message.reasoning_content } : {}),
          });
          if (this.task.requiresPlan || (this.task.changedWorkspace && !this.task.verified)) {
            this.transcript.push({ role: 'system', content: 'Recovery required: do not end this non-trivial run in plain text. Maintain the plan, verify any changes, and use complete_task with factual evidence.' });
            await this.phase('planning', 'Model attempted an unstructured completion.');
            continue;
          }
          await this.finish(response.message.content);
          return;
        }
        emptyResponses += 1;
        if (emptyResponses > 2) {
          await this.emitter.emit('recovery_hint', { message: 'The model returned empty responses repeatedly; the run cannot make further progress.' });
          throw new Error('The model returned empty responses repeatedly.');
        }
      }
    } catch (error) {
      if (this.options.signal.aborted && isAbortError(error)) {
        await this.phase('cancelling', 'Stopping Agent-owned processes.');
        await this.subagentHost?.stopAll();
        this.options.runtime.stopRun({ sessionId: this.run.sessionId, runId: this.run.id, containerId: this.run.containerId });
        await this.phase('cancelled', 'Stopped by user.');
        await this.emitter.emit('run_finished', { summary: 'Agent stopped by user.' });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.run.error = message;
      this.options.runtime.stopRun({ sessionId: this.run.sessionId, runId: this.run.id, containerId: this.run.containerId });
      await this.phase('failed', message);
      await this.emitter.emit('run_failed', { error: message, recoverable: true });
    } finally {
      clearTimeout(this.deadlineTimer);
      this.options.signal.removeEventListener('abort', this.forwardCancellation);
    }
  }
}
