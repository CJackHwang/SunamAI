import { useState } from 'react';
import type { Message } from '../../entities/message/types.ts';
import { callLLM } from '../../shared/api/llm.ts';
import type { DualTerminalRef } from '../terminal-session/DualTerminal.tsx';

const SYSTEM_PROMPT = `You are Sunam, a pure frontend serverless AI assistant.
You are running in a browser-based container environment (WebContainer).
You have maximum privileges in this environment. 
You MUST explore the environment to fulfill user requests. Do not ask for environment info upfront.
You have a dedicated terminal called "Sunam's Computer".
You MUST use a tool (execute_terminal_command or tasks_complete) in EVERY single response.
If you output text without calling a tool, it will be treated as an error and you will be forced to retry.
Keep your text responses concise and professional.
CRITICAL: DO NOT use any emojis in your text output. Emojis are strictly prohibited globally in this UI.`;

export const useReActAgent = (apiKey: string, baseUrl: string, model: string, terminalRef: React.RefObject<DualTerminalRef | null>) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: SYSTEM_PROMPT }
  ]);
  const [isRunning, setIsRunning] = useState(false);



  const runLoop = async (initialMessages: Message[]) => {
    setIsRunning(true);
    let currentMessages = [...initialMessages];
    
    try {
      while (true) {
        const responseMessage = await callLLM(currentMessages, { apiKey, baseUrl, model });
        currentMessages = [...currentMessages, responseMessage];
        setMessages([...currentMessages]);

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          const toolCall = responseMessage.tool_calls[0]; // handle first tool call for simplicity
          
          if (toolCall.function.name === 'tasks_complete') {

            const toolResult: Message = {
              role: 'tool',
              tool_call_id: toolCall.id,
              name: 'tasks_complete',
              content: 'Task completed successfully.'
            };
            currentMessages = [...currentMessages, toolResult];
            setMessages([...currentMessages]);
            break; // Exit loop
          } else if (toolCall.function.name === 'execute_terminal_command') {
            const args = JSON.parse(toolCall.function.arguments);
            
            // Execute in terminal
            let output = 'No terminal available.';
            if (terminalRef.current) {
              output = await terminalRef.current.runAiCommand(args.command);
            }
            
            const toolResult: Message = {
              role: 'tool',
              tool_call_id: toolCall.id,
              name: 'execute_terminal_command',
              content: output
            };
            currentMessages = [...currentMessages, toolResult];
            setMessages([...currentMessages]);
          }
        } else {
          // AI didn't use a tool. Force retry.
          const errorMsg: Message = {
            role: 'user',
            content: 'SYSTEM ERROR: You MUST use a tool (execute_terminal_command or tasks_complete) in every step. Please rethink and call a tool.'
          };
          currentMessages = [...currentMessages, errorMsg];
          setMessages([...currentMessages]);
        }
      }
    } catch (err: any) {
      const errorMsg: Message = {
        role: 'system',
        content: `Error: ${err.message}`
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsRunning(false);
    }
  };

  const startTask = (userPrompt: string) => {
    const newUserMsg: Message = { role: 'user', content: userPrompt };
    const newMessages = [...messages, newUserMsg];
    setMessages(newMessages);
    runLoop(newMessages);
  };

  return {
    messages: messages.filter(m => m.role !== 'system'), // Hide system prompts from UI
    startTask,
    isRunning
  };
};
