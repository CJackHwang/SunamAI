import type { Message } from '@/entities/message/types';
import { callLLM, type LLMConfig, type LLMToolDefinition } from '@/shared/api/llm';
import type { AgentModelResponse, AgentToolCall } from './types';

export interface AgentModelClient {
  complete(messages: Message[], options: {
    signal: AbortSignal;
    tools: LLMToolDefinition[];
    onDelta: (content: string) => void;
  }): Promise<AgentModelResponse>;
}

export class OpenAIChatModelClient implements AgentModelClient {
  private readonly config: Pick<LLMConfig, 'apiKey' | 'baseUrl' | 'model'>;

  constructor(config: Pick<LLMConfig, 'apiKey' | 'baseUrl' | 'model'>) {
    this.config = config;
  }

  async complete(messages: Message[], options: { signal: AbortSignal; tools: LLMToolDefinition[]; onDelta: (content: string) => void }): Promise<AgentModelResponse> {
    const response = await callLLM(messages, {
      ...this.config,
      signal: options.signal,
      tools: options.tools,
      onUpdate: (partial) => options.onDelta(partial.content),
    });
    const toolCalls: AgentToolCall[] = (response.tool_calls ?? []).map((toolCall) => ({ id: toolCall.id, name: toolCall.function.name, arguments: toolCall.function.arguments }));
    return { message: response, toolCalls };
  }
}
