import React, { useState } from 'react';
import type { Message } from '../../entities/message/types.ts';
import { callLLM } from '../../shared/api/llm.ts';
import type { DualTerminalRef } from '../terminal-session/DualTerminal.tsx';

const SYSTEM_PROMPT = `You are Sunam, a pure frontend serverless AI assistant.
You are running in a browser-based container environment (WebContainer).
You have maximum privileges in this environment. 
You MUST explore the environment to fulfill user requests. Do not ask for environment info upfront.
You have a dedicated terminal called "Sunam's Computer".
You MUST use a tool (execute_terminal_command, chat, or tasks_complete) in EVERY single response.
If you need to talk to the user (e.g. ask questions, provide updates, show results), use the 'chat' tool.
If you use the 'chat' tool, the loop will pause and wait for the user to respond.
If you need to execute commands in the terminal, use the 'execute_terminal_command' tool.
If you have finished the task, you MUST use the 'tasks_complete' tool and report the work status in the 'work_status' field.
If you output text without calling a tool, it will be treated as an error and you will be forced to retry.
Keep your text responses concise and professional.
CRITICAL: DO NOT use any emojis in your text output. Emojis are strictly prohibited globally in this UI.`;

export const useReActAgent = (apiKey: string, baseUrl: string, model: string, terminalRef: React.RefObject<DualTerminalRef | null>) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: SYSTEM_PROMPT }
  ]);
  const [isRunning, setIsRunning] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const abortControllerRef = React.useRef<AbortController | null>(null);



  const runLoop = async (initialMessages: Message[]) => {
    setIsRunning(true);
    setRetryCount(0);
    abortControllerRef.current = new AbortController();
    let currentMessages = [...initialMessages];
    let currentRetries = 0;
    
    try {
      while (true) {
        if (abortControllerRef.current.signal.aborted) {
          throw new Error("Task was stopped by user.");
        }
        
        const responseMessage = await callLLM(currentMessages, { 
          apiKey, baseUrl, model,
          signal: abortControllerRef.current.signal,
          onUpdate: (partial) => {
            setMessages([...currentMessages, partial]);
          }
        });

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          currentRetries = 0;
          setRetryCount(0);
          currentMessages = [...currentMessages, responseMessage];
          setMessages([...currentMessages]);

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
          } else if (toolCall.function.name === 'chat') {
            const toolResult: Message = {
              role: 'tool',
              tool_call_id: toolCall.id,
              name: 'chat',
              content: 'Message displayed to user. Waiting for user response...'
            };
            currentMessages = [...currentMessages, toolResult];
            setMessages([...currentMessages]);
            break; // Exit loop to wait for user
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
          // AI didn't use a tool. Silent retry.
          currentRetries++;
          setRetryCount(currentRetries);
          if (currentRetries > 5) {
             throw new Error("Max retries exceeded. The model is failing to use tools.");
          }
          // Do NOT append the faulty response to currentMessages, so it retries the exact same prompt.
          // Restore messages to clean state in UI
          setMessages([...currentMessages]);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Task was stopped by user.') {
         setMessages(prev => [...prev, { role: 'system', content: 'Agent stopped by user.' }]);
      } else {
         const errorMsg: Message = {
           role: 'system',
           content: `Error: ${err.message}`
         };
         setMessages(prev => [...prev, errorMsg]);
      }
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

  const stopTask = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  return {
    messages: messages.filter(m => m.role !== 'system' || m.content === 'Agent stopped by user.' || m.content.startsWith('Error:')), // Hide system prompts from UI, except errors
    startTask,
    stopTask,
    isRunning,
    retryCount
  };
};
