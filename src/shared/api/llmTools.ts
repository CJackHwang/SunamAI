export const LLM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_terminal_async',
      description: 'Executes a background command in the terminal. Returns a Process ID (PID). You MUST use this to explore the environment, write files, install dependencies, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute.' },
          waitTime: { type: 'number', description: 'The wait time (in seconds) to pause after executing the command before checking the results.' },
        },
        required: ['command', 'waitTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_terminal_status',
      description: 'Checks the status of a background terminal process and reads the last 150 lines of its output.',
      parameters: { type: 'object', properties: { processId: { type: 'string', description: 'The Process ID (PID) to check.' } }, required: ['processId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_terminal_input',
      description: 'Sends string input to a running terminal process. Can be used for interactive prompts (e.g. sending "y") or sending interrupt signals (e.g. "\\x03" for Ctrl+C).',
      parameters: {
        type: 'object',
        properties: { processId: { type: 'string', description: 'The Process ID (PID).' }, input: { type: 'string', description: 'The string input to send.' } },
        required: ['processId', 'input'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kill_terminal_process',
      description: 'Forcefully kills a running terminal process.',
      parameters: { type: 'object', properties: { processId: { type: 'string', description: 'The Process ID (PID) to kill.' } }, required: ['processId'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chat',
      description: 'Use this tool to speak directly to the user in the chat interface. Call this when you need to ask for clarification, provide an update, or respond conversationally.',
      parameters: { type: 'object', properties: { message: { type: 'string', description: 'The text message to show to the user.' } }, required: ['message'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tasks_complete',
      description: "Call this tool when you have successfully completed the user's request. Provide a final summary and work status of what you did.",
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: 'A brief summary of what was accomplished.' }, work_status: { type: 'string', description: 'The status and situation of the current work.' } },
        required: ['summary', 'work_status'],
      },
    },
  },
] as const;
