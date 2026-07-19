import type { Message } from '@/entities/message/types';
import type { AgentRuntime } from '@/shared/contracts/agentRuntime';
import { callLLM, type LLMConfig } from '@/shared/api/llm';

export type AgentStatus = 'idle' | 'running' | 'completed_unread' | 'failed_unread';

export interface AgentLoopOptions {
  initialMessages: Message[];
  sessionId: string;
  containerId: string | null;
  runtime: AgentRuntime | null;
  llmConfig: Pick<LLMConfig, 'apiKey' | 'baseUrl' | 'model'>;
  signal: AbortSignal;
  onMessages: (messages: Message[]) => void;
  onStatus: (sessionId: string, status: AgentStatus) => void;
  onRetry: (retryCount: number) => void;
  onStreamingMessage: (messages: Message[]) => void;
}

function parseArguments<T extends object>(value: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(value) };
  } catch {
    return fallback;
  }
}

async function executeToolCall(
  message: Message,
  runtime: AgentRuntime | null,
  containerId: string | null,
): Promise<{ results: Message[]; shouldStop: boolean }> {
  const results: Message[] = [];
  let shouldStop = false;

  for (const toolCall of message.tool_calls ?? []) {
    const name = toolCall.function.name;
    if (name === 'tasks_complete') {
      results.push({ role: 'tool', tool_call_id: toolCall.id, name, content: 'Task completed successfully.' });
      shouldStop = true;
      continue;
    }
    if (name === 'chat') {
      results.push({ role: 'tool', tool_call_id: toolCall.id, name, content: 'Message displayed to user. Waiting for user response...' });
      shouldStop = true;
      continue;
    }
    if (name === 'run_terminal_async') {
      const args = parseArguments(toolCall.function.arguments, { command: '', waitTime: 0 });
      let content = 'Failed to start.';
      if (runtime && args.command && containerId) {
        const processId = await runtime.spawnAiProcess(args.command, containerId);
        content = `Process started in background. Process ID: ${processId}`;
        if (typeof args.waitTime === 'number' && args.waitTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(args.waitTime * 1000, 300_000)));
        }
      }
      results.push({ role: 'tool', tool_call_id: toolCall.id, name, content });
      continue;
    }
    if (name === 'check_terminal_status') {
      const args = parseArguments(toolCall.function.arguments, { processId: '' });
      const status = runtime && args.processId ? runtime.getAiProcessStatus(args.processId) : null;
      const content = status ? `[Running: ${status.isRunning}]\n--- Last 150 Lines ---\n${status.output}` : 'Process not found.';
      results.push({ role: 'tool', tool_call_id: toolCall.id, name, content });
      continue;
    }
    if (name === 'send_terminal_input') {
      const args = parseArguments(toolCall.function.arguments, { processId: '', input: '' });
      const sent = Boolean(runtime && args.processId && await runtime.sendAiProcessInput(args.processId, args.input));
      results.push({ role: 'tool', tool_call_id: toolCall.id, name, content: sent ? 'Input sent.' : 'Failed. Process might not be running.' });
      continue;
    }
    if (name === 'kill_terminal_process') {
      const args = parseArguments(toolCall.function.arguments, { processId: '' });
      if (runtime && args.processId) runtime.killAiProcess(args.processId);
      results.push({ role: 'tool', tool_call_id: toolCall.id, name, content: 'Kill signal sent.' });
      continue;
    }
    results.push({ role: 'tool', tool_call_id: toolCall.id, name, content: `Error: Tool ${name} is not available.` });
  }

  return { results, shouldStop };
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<void> {
  let messages = [...options.initialMessages];
  let retries = 0;
  options.onStatus(options.sessionId, 'running');
  options.onRetry(0);

  try {
    while (true) {
      if (options.signal.aborted) throw new DOMException('Task was stopped by user.', 'AbortError');
      const response = await callLLM(messages, {
        ...options.llmConfig,
        signal: options.signal,
        onUpdate: (partial) => options.onStreamingMessage([...messages, partial]),
      });

      if (response.tool_calls?.length) {
        retries = 0;
        options.onRetry(0);
        messages = [...messages, response];
        options.onMessages(messages);
        const execution = await executeToolCall(response, options.runtime, options.containerId);
        messages = [...messages, ...execution.results];
        options.onMessages(messages);
        if (execution.shouldStop) break;
        continue;
      }
      if (response.content.trim()) {
        messages = [...messages, response];
        options.onMessages(messages);
        break;
      }

      retries += 1;
      options.onRetry(retries);
      if (retries > 5) throw new Error('Max retries exceeded. The model returned empty responses repeatedly.');
      options.onMessages(messages);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      options.onMessages([...messages, { role: 'system', content: 'Agent stopped by user.' }]);
      options.onStatus(options.sessionId, 'idle');
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    options.onMessages([...messages, { role: 'system', content: `Error: ${message}` }]);
    options.onStatus(options.sessionId, 'failed_unread');
    return;
  }

  options.onStatus(options.sessionId, 'completed_unread');
}
