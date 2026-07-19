import type { Message, ToolCall } from '@/entities/message/types';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { SunamModel } from '@/shared/config/models';
import { ContextComposer } from './context';
import { AgentEventEmitter } from './events';
import type { AgentEventStore } from './eventStore';
import type { AgentModelClient } from './modelClient';
import { buildAgentSystemPrompt, createChaosContract } from './prompt';
import { AgentToolRegistry, type ParsedToolCall, type ToolExecutionContext } from './tools';
import type { AgentBudget, AgentEvent, AgentPhase, AgentRun, AgentToolResult, TaskContract } from './types';

const DEFAULT_BUDGET: AgentBudget = { maxModelTurns: 40, maxToolCalls: 100, maxDurationMs: 15 * 60_000 };
const MAX_READ_ONLY_CONCURRENCY = 4;

function createId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isRetryableModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|\b5\d\d\b|network|fetch/i.test(message);
}

function redact(value: string): string {
  return value
    .replace(/\b(sk-[a-zA-Z0-9_-]{12,})\b/g, '[REDACTED_API_KEY]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED]');
}

function isNonTrivial(prompt: string): boolean {
  return prompt.length > 80 || /(?:build|implement|fix|add|change|create|修改|实现|修复|新增|开发)/i.test(prompt);
}

function initialTask(objective: string): TaskContract {
  return {
    objective,
    acceptanceCriteria: ['Address the user request.', 'Do not fabricate results or verification.', ...(isNonTrivial(objective) ? ['Verify relevant workspace changes before completing.'] : [])],
    constraints: ['Work only inside the active WebContainer.', 'Keep extra chaos reversible and non-destructive.'],
    requiresPlan: isNonTrivial(objective),
    plan: [],
    evidence: [],
    changedWorkspace: false,
    verified: false,
    verificationEvidence: [],
  };
}

export interface AgentEngineOptions {
  sessionId: string;
  containerId: string;
  persona: SunamModel;
  model: string;
  input: string;
  initialMessages: Message[];
  client: AgentModelClient;
  runtime: AgentWorkspaceRuntime;
  store: AgentEventStore;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  onRunChange: (run: AgentRun) => void;
  budget?: Partial<AgentBudget>;
}

export class AgentEngine {
  private readonly options: AgentEngineOptions;
  private readonly registry = new AgentToolRegistry();
  private readonly context = new ContextComposer();
  private readonly run: AgentRun;
  private readonly emitter: AgentEventEmitter;
  private task: TaskContract;
  private transcript: Message[];
  private readonly startedAt = Date.now();
  private readonly signatures = new Map<string, number>();

  constructor(options: AgentEngineOptions) {
    this.options = options;
    const id = createId();
    this.task = initialTask(options.input);
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
      chaos: createChaosContract(options.persona, id),
      budget: { ...DEFAULT_BUDGET, ...options.budget },
      modelTurns: 0,
      toolCalls: 0,
      summary: '',
    };
    this.transcript = options.initialMessages.filter((message) => message.role !== 'system');
    this.emitter = new AgentEventEmitter(options.sessionId, id, async (event) => {
      await this.options.store.append(event);
      this.options.onEvent(event);
    });
  }

  getRun(): AgentRun {
    return this.run;
  }

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
    await this.emitter.emit('phase_changed', { phase, detail });
  }

  private async emitMessage(message: Message): Promise<void> {
    const safeMessage = { ...message, content: redact(message.content) };
    this.transcript.push(safeMessage);
    await this.emitter.emit('message', { message: safeMessage });
  }

  private updateTask(updater: (current: TaskContract) => TaskContract): void {
    this.task = updater(this.task);
    this.run.task = this.task;
  }

  private async reflectTask(): Promise<void> {
    await this.updateRun();
    await this.emitter.emit('plan_updated', { task: this.task });
    const summary = this.context.getSummary() || this.task.evidence.join('\n') || 'Run checkpoint recorded.';
    await this.emitter.emit('checkpoint', { summary });
    await this.options.store.saveCheckpoint({
      id: `cp-${this.run.id}-${Date.now().toString(36)}`,
      runId: this.run.id,
      sessionId: this.run.sessionId,
      containerId: this.run.containerId,
      summary,
      messages: [...this.transcript],
      createdAt: Date.now(),
    });
  }

  private assertBudget(): void {
    if (this.options.signal.aborted) throw new DOMException('Agent stopped by user.', 'AbortError');
    if (Date.now() - this.startedAt > this.run.budget.maxDurationMs) throw new Error('Agent run exceeded its time budget.');
    if (this.run.modelTurns >= this.run.budget.maxModelTurns) throw new Error('Agent run exceeded its model-turn budget.');
    if (this.run.toolCalls >= this.run.budget.maxToolCalls) throw new Error('Agent run exceeded its tool-call budget.');
  }

  private async completeModelRequest(messages: Message[]): Promise<Awaited<ReturnType<AgentModelClient['complete']>> > {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.options.client.complete(messages, {
          signal: this.options.signal,
          tools: this.registry.getApiDefinitions(),
          onDelta: (content) => { void this.emitter.emit('assistant_delta', { content, transient: true }); },
        });
      } catch (error) {
        if (isAbort(error)) throw error;
        lastError = error;
        if (!isRetryableModelError(error) || attempt === 2) break;
        const delayMs = Math.min(8_000, 500 * (2 ** attempt)) + Math.round(Math.random() * 150);
        await this.emitter.emit('model_retry', { attempt: attempt + 1, delayMs, error: error instanceof Error ? error.message : String(error) });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private toToolCall(call: ParsedToolCall): ToolCall {
    return this.registry.toMessageToolCall(call);
  }

  private async executeOne(call: ParsedToolCall): Promise<{ call: ParsedToolCall; result: AgentToolResult }> {
    this.run.toolCalls += 1;
    const signature = `${call.name}:${call.arguments}`;
    const count = (this.signatures.get(signature) ?? 0) + 1;
    this.signatures.set(signature, count);
    if (count >= 3) {
      const message = `Recovery required: ${call.name} was requested with identical arguments ${count} times.`;
      await this.emitter.emit('recovery_hint', { message });
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
      getTask: () => this.task,
      updateTask: (updater) => this.updateTask(updater),
    };
    const result = await this.registry.execute(call, context);
    const safeResult = { ...result, content: redact(result.content) };
    await this.emitter.emit('tool_finished', { toolCall, result: safeResult });
    if (safeResult.data && call.name === 'report_progress') await this.emitter.emit('progress_reported', { message: safeResult.content });
    if (safeResult.verification) {
      await this.emitter.emit('verification', { command: safeResult.verification.command, passed: safeResult.verification.passed, detail: safeResult.content });
      if (!safeResult.verification.passed) await this.emitter.emit('recovery_hint', { message: `Verification failed for ${safeResult.verification.command}; inspect the output and repair before completion.` });
    }
    return { call, result: safeResult };
  }

  private async executeTools(calls: ParsedToolCall[]): Promise<Array<{ call: ParsedToolCall; result: AgentToolResult }>> {
    const results: Array<{ call: ParsedToolCall; result: AgentToolResult }> = [];
    let index = 0;
    while (index < calls.length) {
      this.assertBudget();
      const call = calls[index]!;
      const metadata = this.registry.getMetadata(call.name);
      if (metadata?.concurrencySafe) {
        const batch: ParsedToolCall[] = [];
        while (index < calls.length && this.registry.getMetadata(calls[index]!.name)?.concurrencySafe) batch.push(calls[index++]!);
        for (let cursor = 0; cursor < batch.length; cursor += MAX_READ_ONLY_CONCURRENCY) {
          const group = batch.slice(cursor, cursor + MAX_READ_ONLY_CONCURRENCY);
          const groupResults = await Promise.all(group.map((toolCall) => this.executeOne(toolCall)));
          results.push(...groupResults);
        }
      } else {
        results.push(await this.executeOne(call));
        index += 1;
      }
    }
    return results;
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
      await this.options.store.saveRun(this.run);
      await this.emitter.start(this.run);
      await this.emitMessage({ role: 'user', content: this.options.input });
      await this.phase(isNonTrivial(this.options.input) ? 'planning' : 'acting');
      let emptyResponses = 0;
      let noProgressTurns = 0;

      while (true) {
        this.assertBudget();
        const compacted = await this.context.compactIfNeeded(this.transcript, this.options.client, this.options.signal);
        if (compacted.compacted) {
          this.transcript = compacted.messages;
          await this.emitter.emit('context_compacted', { summary: compacted.summary, fallback: compacted.fallback });
        }
        const system = buildAgentSystemPrompt({ containerId: this.options.containerId, task: this.task, chaos: this.run.chaos, summary: this.context.getSummary() });
        this.run.modelTurns += 1;
        const response = await this.completeModelRequest([{ role: 'system', content: system }, ...this.transcript]);
        if (response.toolCalls.length) {
          emptyResponses = 0;
          const assistant: Message = { ...response.message, content: redact(response.message.content), tool_calls: response.toolCalls.map((call) => this.toToolCall(call)) };
          await this.emitMessage(assistant);
          await this.phase('acting');
          const results = await this.executeTools(response.toolCalls);
          for (const { call, result } of results) {
            await this.emitMessage({ role: 'tool', tool_call_id: call.id, name: call.name, content: result.content });
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
          await this.emitMessage({ role: 'assistant', content: response.message.content });
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
      if (isAbort(error)) {
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
    }
  }
}
