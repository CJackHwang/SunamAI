import type { Message } from '../../entities/message/types.ts';

interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
  signal?: AbortSignal;
  onUpdate?: (partialMessage: Message) => void;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'execute_terminal_command',
      description: 'Executes a command in the terminal (Sunam\'s Computer). Highest privilege. You must use this to explore the environment, write files, install dependencies, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute.'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'chat',
      description: 'Use this tool to speak directly to the user in the chat interface. Call this when you need to ask for clarification, provide an update, or respond conversationally.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The text message to show to the user.'
          }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'tasks_complete',
      description: 'Call this tool when you have successfully completed the user\'s request. Provide a final summary and work status of what you did.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'A brief summary of what was accomplished.'
          },
          work_status: {
            type: 'string',
            description: 'The status and situation of the current work.'
          }
        },
        required: ['summary', 'work_status']
      }
    }
  }
];

export const callLLM = async (messages: Message[], config: LLMConfig): Promise<Message> => {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const isStreaming = !!config.onUpdate;
  
  const cleanMessages = messages.map(msg => {
    const { _ui_streaming, ...rest } = msg as any;
    return rest;
  });

  const body = {
    model: config.model || 'deepseek-chat',
    messages: cleanMessages,
    tools: TOOLS,
    tool_choice: 'auto',
    stream: isStreaming
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body),
    signal: config.signal
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API Error (${response.status}): ${errText}`);
  }

  if (!isStreaming) {
    const data = await response.json();
    return data.choices[0].message;
  }

  // Handle SSE streaming
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No readable stream available");

  const decoder = new TextDecoder("utf-8");
  let done = false;

  const currentMessage: Message = {
    role: 'assistant',
    content: '',
    reasoning_content: '',
    tool_calls: undefined
  };

  let buffer = '';

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last incomplete line in buffer
      
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices[0].delta;
            
            if (delta.content) currentMessage.content += delta.content;
            if (delta.reasoning_content) currentMessage.reasoning_content += delta.reasoning_content;
            
            if (delta.tool_calls) {
              if (!currentMessage.tool_calls) currentMessage.tool_calls = [];
              
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  // New tool call
                  currentMessage.tool_calls[tc.index] = {
                    id: tc.id,
                    type: tc.type || 'function',
                    function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' }
                  };
                } else if (currentMessage.tool_calls[tc.index]) {
                  // Append arguments
                  if (tc.function?.arguments) {
                    currentMessage.tool_calls[tc.index].function.arguments += tc.function.arguments;
                  }
                }
              }
            }
            
            // Clone the object to ensure React triggers re-render
            config.onUpdate!({ ...currentMessage, _ui_streaming: true });
          } catch (e) {
            // Ignore parse errors on partial lines
          }
        }
      }
    }
  }
  
  delete currentMessage._ui_streaming;
  return currentMessage;
};
