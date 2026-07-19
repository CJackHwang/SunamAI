import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@/entities/message/types';
import { saveMessages } from '@/entities/message/repository';
import type { AgentRuntime } from '@/shared/contracts/agentRuntime';
import type { SunamModel } from '@/shared/config/models';
import { useMessageStore } from '@/shared/store/useMessageStore';
import type { SessionStatus } from '@/entities/workspace/types';
import { runAgentLoop } from './agentLoop';
import { getSystemPrompt } from './promptRegistry';

type UpdateSessionStatus = (id: string, status: SessionStatus) => void;

export function useReActAgent(
  apiKey: string,
  baseUrl: string,
  apiModel: string,
  sunamModel: SunamModel,
  runtimeRef: React.RefObject<AgentRuntime | null>,
  activeSessionId: string | null,
  activeContainerId: string | null,
  updateSessionStatus: UpdateSessionStatus,
) {
  const { messages, updateMessages } = useMessageStore(activeSessionId);
  const [retryCount, setRetryCount] = useState(0);
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const animationFrameRef = useRef<number | null>(null);
  const pendingMessagesRef = useRef<Message[] | null>(null);
  const pendingWriterRef = useRef<((messages: Message[]) => void) | null>(null);

  const flushStreamingMessages = useCallback(() => {
    animationFrameRef.current = null;
    const pending = pendingMessagesRef.current;
    const writer = pendingWriterRef.current;
    pendingMessagesRef.current = null;
    pendingWriterRef.current = null;
    if (pending && writer) writer(pending);
  }, []);

  const publishStreamingMessages = useCallback((nextMessages: Message[], writer: (messages: Message[]) => void) => {
    pendingMessagesRef.current = nextMessages;
    pendingWriterRef.current = writer;
    if (animationFrameRef.current !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      flushStreamingMessages();
      return;
    }
    animationFrameRef.current = requestAnimationFrame(flushStreamingMessages);
  }, [flushStreamingMessages]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    pendingMessagesRef.current = null;
    pendingWriterRef.current = null;
  }, []);

  const startTask = useCallback((userPrompt: string, overrideSessionId?: string, overrideContainerId?: string) => {
    const sessionId = overrideSessionId ?? activeSessionId;
    const containerId = overrideContainerId ?? activeContainerId;
    if (!sessionId) return;

    void (async () => {
      const systemPrompt = await getSystemPrompt(sunamModel, containerId);
      const isNewSession = Boolean(overrideSessionId && overrideSessionId !== activeSessionId) || messages.length === 0;
      const initialMessages = isNewSession
        ? [{ role: 'system', content: systemPrompt } satisfies Message]
        : messages.map((message, index) => index === 0 && message.role === 'system' ? { ...message, content: systemPrompt } : message);
      const nextMessages = [...initialMessages, { role: 'user', content: userPrompt } satisfies Message];

      const writeTaskMessages = overrideSessionId && overrideSessionId !== activeSessionId
        ? (updated: Message[]) => saveMessages(overrideSessionId, updated)
        : updateMessages;
      writeTaskMessages(nextMessages);

      const controller = new AbortController();
      abortControllersRef.current.set(sessionId, controller);
      await runAgentLoop({
        initialMessages: nextMessages,
        sessionId,
        containerId,
        runtime: runtimeRef.current,
        llmConfig: { apiKey, baseUrl, model: apiModel },
        signal: controller.signal,
        onMessages: writeTaskMessages,
        onStreamingMessage: (updated) => publishStreamingMessages(updated, writeTaskMessages),
        onStatus: updateSessionStatus,
        onRetry: setRetryCount,
      });
      abortControllersRef.current.delete(sessionId);
    })();
  }, [activeContainerId, activeSessionId, apiKey, apiModel, baseUrl, messages, publishStreamingMessages, runtimeRef, sunamModel, updateMessages, updateSessionStatus]);

  const stopTask = useCallback(() => {
    if (activeSessionId) abortControllersRef.current.get(activeSessionId)?.abort();
  }, [activeSessionId]);

  return {
    messages: messages.filter((message) => message.role !== 'system' || message.content === 'Agent stopped by user.' || message.content.startsWith('Error:')),
    startTask,
    stopTask,
    retryCount,
  };
}
