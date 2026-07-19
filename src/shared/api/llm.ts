import type { Message } from '@/entities/message/types';
import { consumeChatStream } from './sse';
import { LLM_TOOLS } from './llmTools';

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
  signal?: AbortSignal;
  onUpdate?: (partialMessage: Message) => void;
}

export function buildChatRequest(messages: Message[], config: LLMConfig) {
  return {
    model: config.model || 'deepseek-chat',
    messages: messages.map(({ _ui_streaming, _ui_retryCount, ...message }) => message),
    tools: LLM_TOOLS,
    tool_choice: 'auto',
    stream: Boolean(config.onUpdate),
  };
}

export async function callLLM(messages: Message[], config: LLMConfig): Promise<Message> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(buildChatRequest(messages, config)),
    signal: config.signal,
  });

  if (!response.ok) {
    throw new Error(`LLM API Error (${response.status}): ${await response.text()}`);
  }
  if (!config.onUpdate) {
    const data = await response.json() as { choices: Array<{ message: Message }> };
    return data.choices[0].message;
  }
  if (!response.body) throw new Error('No readable stream available');
  return consumeChatStream(response.body, config.onUpdate);
}
