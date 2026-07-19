import React, { useState } from 'react';
import type { Message } from '../../entities/message/types.ts';
import { callLLM } from '../../shared/api/llm.ts';
import type { DualTerminalRef } from '../terminal-session/DualTerminal.tsx';
import { useMessageStore } from '../../shared/store/useMessageStore.ts';

const personaPrompts: Record<string, string> = import.meta.glob('../../assets/ACT_system_prompt/*.txt', { query: '?raw', import: 'default', eager: true });

const getSystemPrompt = (sunamModel: string, activeContainerId: string | null) => {
  const containerDir = activeContainerId ? `/containers/${activeContainerId}` : '/';
  const basePrompt = `You are running in a browser-based container environment (WebContainer).
You have maximum privileges in this environment. 
CRITICAL: You are currently isolated in the container directory: ${containerDir}. 
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

  const personaKey = Object.keys(personaPrompts).find(key => key.endsWith(`/${sunamModel}.txt`));
  const personaText = personaKey ? personaPrompts[personaKey].trim() : '';

  if (personaText) {
    return `${personaText}\n\n${basePrompt}`;
  }
  return basePrompt;
};

export const useReActAgent = (apiKey: string, baseUrl: string, apiModel: string, sunamModel: string, terminalRef: React.RefObject<DualTerminalRef | null>, activeSessionId: string | null, activeContainerId: string | null, updateSessionStatus: (id: string, status: 'idle' | 'running' | 'completed_unread' | 'failed_unread') => void) => {
  const { messages, updateMessages: setMessages } = useMessageStore(activeSessionId);
  const [retryCount, setRetryCount] = useState(0);
  const abortControllersRef = React.useRef(new Map<string, AbortController>());

  React.useEffect(() => {
    if (activeSessionId) {
      setMessages(prev => {
        if (prev.length === 0) {
          return [{ role: 'system', content: getSystemPrompt(sunamModel, activeContainerId) }];
        }
        if (prev[0].role === 'system') {
          const newMessages = [...prev];
          newMessages[0].content = getSystemPrompt(sunamModel, activeContainerId);
          return newMessages;
        }
        return prev;
      });
    }
  }, [sunamModel, activeContainerId, activeSessionId, setMessages]);

  const runLoop = async (initialMessages: Message[], sessionId: string, containerId: string | null) => {
    updateSessionStatus(sessionId, 'running');
    setRetryCount(0);
    
    const abortController = new AbortController();
    abortControllersRef.current.set(sessionId, abortController);
    
    let currentMessages = [...initialMessages];
    let currentRetries = 0;
    
    try {
      while (true) {
        if (abortController.signal.aborted) {
          throw new Error("Task was stopped by user.");
        }
        
        const responseMessage = await callLLM(currentMessages, { 
          apiKey, baseUrl, model: apiModel,
          signal: abortController.signal,
          onUpdate: (partial) => {
            setMessages([...currentMessages, partial]);
          }
        });

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
          currentRetries = 0;
          setRetryCount(0);
          currentMessages = [...currentMessages, responseMessage];
          setMessages([...currentMessages]);

          const newToolResults: Message[] = [];
          let shouldBreak = false;

          // Handle ALL tool calls to satisfy API requirements
          for (const toolCall of responseMessage.tool_calls) {
            if (toolCall.function.name === 'tasks_complete') {
              newToolResults.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: 'tasks_complete',
                content: 'Task completed successfully.'
              });
              shouldBreak = true;
            } else if (toolCall.function.name === 'chat') {
              newToolResults.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: 'chat',
                content: 'Message displayed to user. Waiting for user response...'
              });
              shouldBreak = true;
            } else if (toolCall.function.name === 'run_terminal_async') {
              let args = { command: '' };
              try { args = JSON.parse(toolCall.function.arguments); } catch(e) {}
              let output = 'Failed to start.';
              if (terminalRef.current && args.command && containerId) {
                const pid = await terminalRef.current.spawnAiProcess(args.command, containerId);
                output = `Process started in background. Process ID: ${pid}`;
              }
              newToolResults.push({ role: 'tool', tool_call_id: toolCall.id, name: 'run_terminal_async', content: output });
            } else if (toolCall.function.name === 'check_terminal_status') {
              let args = { processId: '' };
              try { args = JSON.parse(toolCall.function.arguments); } catch(e) {}
              let output = 'Invalid process ID.';
              if (terminalRef.current && args.processId) {
                const status = terminalRef.current.getAiProcessStatus(args.processId);
                if (status) {
                  output = `[Running: ${status.isRunning}]\n--- Last 150 Lines ---\n${status.output}`;
                } else {
                  output = 'Process not found.';
                }
              }
              newToolResults.push({ role: 'tool', tool_call_id: toolCall.id, name: 'check_terminal_status', content: output });
            } else if (toolCall.function.name === 'send_terminal_input') {
              let args = { processId: '', input: '' };
              try { args = JSON.parse(toolCall.function.arguments); } catch(e) {}
              let output = 'Failed to send input.';
              if (terminalRef.current && args.processId) {
                const success = await terminalRef.current.sendAiProcessInput(args.processId, args.input);
                output = success ? 'Input sent.' : 'Failed. Process might not be running.';
              }
              newToolResults.push({ role: 'tool', tool_call_id: toolCall.id, name: 'send_terminal_input', content: output });
            } else if (toolCall.function.name === 'kill_terminal_process') {
              let args = { processId: '' };
              try { args = JSON.parse(toolCall.function.arguments); } catch(e) {}
              if (terminalRef.current && args.processId) {
                terminalRef.current.killAiProcess(args.processId);
              }
              newToolResults.push({ role: 'tool', tool_call_id: toolCall.id, name: 'kill_terminal_process', content: 'Kill signal sent.' });
            } else {
              // Fallback for unknown tools
              newToolResults.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: `Error: Tool ${toolCall.function.name} is not available.`
              });
            }
          }

          currentMessages = [...currentMessages, ...newToolResults];
          setMessages([...currentMessages]);

          if (shouldBreak) {
            break;
          }
        } else if (responseMessage.content && responseMessage.content.trim().length > 0) {
          // AI replied with plain text directly. Treat it as a conversational response.
          currentRetries = 0;
          setRetryCount(0);
          currentMessages = [...currentMessages, responseMessage];
          setMessages([...currentMessages]);
          break; // Wait for user response
        } else {
          // AI didn't use a tool and didn't say anything useful. Silent retry.
          currentRetries++;
          setRetryCount(currentRetries);
          if (currentRetries > 5) {
             throw new Error("Max retries exceeded. The model returned empty responses repeatedly.");
          }
          // Do NOT append the faulty response to currentMessages, so it retries the exact same prompt.
          // Restore messages to clean state in UI
          setMessages([...currentMessages]);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Task was stopped by user.') {
         setMessages(prev => [...prev, { role: 'system', content: 'Agent stopped by user.' }]);
         updateSessionStatus(sessionId, 'idle');
      } else {
         const errorMsg: Message = {
           role: 'system',
           content: `Error: ${err.message}`
         };
         setMessages(prev => [...prev, errorMsg]);
         updateSessionStatus(sessionId, 'failed_unread');
      }
    } finally {
      if (!abortController.signal.aborted) {
        updateSessionStatus(sessionId, 'completed_unread');
      }
      abortControllersRef.current.delete(sessionId);
    }
  };


  const startTask = (userPrompt: string) => {
    if (!activeSessionId) return;
    const newUserMsg: Message = { role: 'user', content: userPrompt };
    const newMessages = [...messages, newUserMsg];
    setMessages(newMessages);
    runLoop(newMessages, activeSessionId, activeContainerId);
  };

  const stopTask = () => {
    if (activeSessionId) {
      const controller = abortControllersRef.current.get(activeSessionId);
      if (controller) {
        controller.abort();
      }
    }
  };

  return {
    messages: messages.filter(m => m.role !== 'system' || m.content === 'Agent stopped by user.' || m.content.startsWith('Error:')),
    startTask,
    stopTask,
    retryCount
  };
};
