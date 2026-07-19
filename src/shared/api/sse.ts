import type { Message } from '@/entities/message/types';

type StreamingDelta = {
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id?: string;
    index: number;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
};

function applyDelta(message: Message, delta: StreamingDelta): void {
  if (delta.content) message.content += delta.content;
  if (delta.reasoning_content) message.reasoning_content = `${message.reasoning_content ?? ''}${delta.reasoning_content}`;
  if (!delta.tool_calls) return;

  message.tool_calls ??= [];
  for (const toolCall of delta.tool_calls) {
    const index = toolCall.index;
    if (toolCall.id) {
      message.tool_calls[index] = {
        id: toolCall.id,
        type: toolCall.type ?? 'function',
        function: { name: toolCall.function?.name ?? '', arguments: toolCall.function?.arguments ?? '' },
      };
    } else if (message.tool_calls[index]) {
      const current = message.tool_calls[index];
      if (toolCall.function?.name) current.function.name = toolCall.function.name;
      if (toolCall.function?.arguments !== undefined) current.function.arguments += toolCall.function.arguments;
    }
  }
}

export async function consumeChatStream(
  stream: ReadableStream<Uint8Array>,
  onUpdate: (message: Message) => void,
): Promise<Message> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const message: Message = { role: 'assistant', content: '', reasoning_content: '', tool_calls: undefined };
  let buffer = '';

  const consumeLine = (line: string) => {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') return;
    try {
      const payload = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: StreamingDelta }> };
      const delta = payload.choices?.[0]?.delta;
      if (!delta) return;
      applyDelta(message, delta);
      onUpdate({ ...message, tool_calls: message.tool_calls?.map((tool) => ({ ...tool, function: { ...tool.function } })), _ui_streaming: true });
    } catch {
      // A malformed provider event must not terminate an otherwise valid response stream.
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach((line) => consumeLine(line.replace(/\r$/, '')));
    }
    if (done) break;
  }
  if (buffer) consumeLine(buffer.replace(/\r$/, ''));
  return message;
}
