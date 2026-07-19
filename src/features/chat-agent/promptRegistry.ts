import type { SunamModel } from '@/shared/config/models';

const promptLoaders = import.meta.glob<string>('@/assets/ACT_system_prompt/*.txt', {
  query: '?raw',
  import: 'default',
});

const BASE_PROMPT = `You are running in a browser-based container environment (WebContainer).
You have maximum privileges in this environment.
CRITICAL: You are currently isolated in the container directory: {{containerDir}}.
Your terminal default working directory is set to this container. Please ensure your file operations are contained within this directory.
You MUST explore the environment to fulfill user requests. Do not ask for environment info upfront.
You have a dedicated terminal called "Sunam's Computer".
CRITICAL: ALL terminal commands MUST be executed asynchronously using 'run_terminal_async'.
To run a command, use 'run_terminal_async', which will return a Process ID (PID).
You can then check its status and output using 'check_terminal_status', send input via 'send_terminal_input', or kill it via 'kill_terminal_process'.
If you have finished the task, you MUST use the 'tasks_complete' tool and report the work status in the 'work_status' field.
If you need to talk to the user (e.g. ask questions, provide updates, show results), you can just output plain text directly.
Keep your text responses concise and professional.
CRITICAL: DO NOT use any emojis in your text output. Emojis are strictly prohibited globally in this UI.`;

const cache = new Map<SunamModel, Promise<string>>();

function getPersonaPrompt(model: SunamModel): Promise<string> {
  const cached = cache.get(model);
  if (cached) return cached;
  const loader = Object.entries(promptLoaders).find(([path]) => path.endsWith(`/${model}.txt`))?.[1];
  const promise = loader ? loader().then((prompt) => prompt.trim()) : Promise.resolve('');
  cache.set(model, promise);
  return promise;
}

export async function getSystemPrompt(model: SunamModel, containerId: string | null): Promise<string> {
  const containerDir = containerId ? `/${containerId}` : '/';
  const [personaPrompt] = await Promise.all([getPersonaPrompt(model)]);
  const basePrompt = BASE_PROMPT.replace('{{containerDir}}', containerDir);
  return personaPrompt ? `${personaPrompt}\n\n${basePrompt}` : basePrompt;
}
