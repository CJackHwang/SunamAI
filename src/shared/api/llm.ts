import type { Message } from '../../entities/message/types.ts';

interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
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
      name: 'tasks_complete',
      description: 'Call this tool when you have successfully completed the user\'s request. Provide a final summary of what you did.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'A brief summary of what was accomplished.'
          }
        },
        required: ['summary']
      }
    }
  }
];

export const callLLM = async (messages: Message[], config: LLMConfig) => {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: config.model || 'deepseek-chat',
    messages,
    tools: TOOLS,
    tool_choice: 'auto'
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LLM API Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message;
};
