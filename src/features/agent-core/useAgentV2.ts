import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '@/entities/message/types';
import type { SessionStatus } from '@/entities/workspace/types';
import type { SunamModel } from '@/shared/config/models';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import { AgentEngine } from './engine';
import { AgentEventStore } from './eventStore';
import { OpenAIChatModelClient } from './modelClient';
import { projectMessages } from './projector';
import type { AgentEvent, AgentRun } from './types';

type UpdateSessionStatus = (id: string, status: SessionStatus) => void;

function toSessionStatus(run: AgentRun): SessionStatus {
  if (['preparing', 'planning', 'acting', 'observing', 'verifying', 'cancelling'].includes(run.phase)) return 'running';
  if (run.phase === 'failed') return 'failed_unread';
  if (run.phase === 'completed') return 'completed_unread';
  return 'idle';
}

export function useAgentV2(
  apiKey: string,
  baseUrl: string,
  apiModel: string,
  sunamModel: SunamModel,
  runtimeRef: React.RefObject<AgentWorkspaceRuntime | null>,
  activeSessionId: string | null,
  activeContainerId: string | null,
  updateSessionStatus: UpdateSessionStatus,
) {
  const storeRef = useRef(new AgentEventStore());
  const controllersRef = useRef(new Map<string, AbortController>());
  const recoveredSessionsRef = useRef(new Set<string>());
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const sessionRef = useRef(activeSessionId);
  sessionRef.current = activeSessionId;

  useEffect(() => {
    let mounted = true;
    if (!activeSessionId) {
      setEvents([]);
      setRuns([]);
      setStreamingContent('');
      return () => { mounted = false; };
    }
    void (async () => {
      const store = storeRef.current;
      const loaded = await store.loadSessionEvents(activeSessionId);
      const restoredRuns = !recoveredSessionsRef.current.has(activeSessionId) && !controllersRef.current.has(activeSessionId)
        ? await store.markInterruptedRuns(activeSessionId)
        : await store.loadSessionRuns(activeSessionId);
      recoveredSessionsRef.current.add(activeSessionId);
      if (mounted && sessionRef.current === activeSessionId) {
        setEvents((previous) => {
          const byId = new Map(loaded.map((event) => [event.id, event]));
          previous.forEach((event) => byId.set(event.id, event));
          return Array.from(byId.values()).sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence);
        });
        setRuns((previous) => {
          const byId = new Map(restoredRuns.map((run) => [run.id, run]));
          previous.forEach((run) => byId.set(run.id, run));
          return Array.from(byId.values()).sort((left, right) => right.updatedAt - left.updatedAt);
        });
      }
    })();
    return () => { mounted = false; };
  }, [activeSessionId]);

  const appendEvent = useCallback((event: AgentEvent) => {
    if (event.transient) {
      if (event.kind === 'assistant_delta' && event.sessionId === sessionRef.current) setStreamingContent(event.content);
      return;
    }
    if (event.sessionId === sessionRef.current) {
      setEvents((previous) => previous.some((candidate) => candidate.id === event.id) ? previous : [...previous, event]);
    }
    if (event.kind === 'message' && event.message.role === 'assistant' && event.sessionId === sessionRef.current) setStreamingContent('');
  }, []);

  const updateRun = useCallback((run: AgentRun) => {
    updateSessionStatus(run.sessionId, toSessionStatus(run));
    if (run.sessionId === sessionRef.current) {
      setRuns((previous) => {
        const withoutCurrent = previous.filter((candidate) => candidate.id !== run.id);
        return [run, ...withoutCurrent].sort((left, right) => right.updatedAt - left.updatedAt);
      });
    }
  }, [updateSessionStatus]);

  const startTask = useCallback((userPrompt: string, overrideSessionId?: string, overrideContainerId?: string) => {
    const sessionId = overrideSessionId ?? activeSessionId;
    const containerId = overrideContainerId ?? activeContainerId;
    const runtime = runtimeRef.current;
    if (!sessionId || !containerId || !runtime || !userPrompt.trim()) return;
    if (sessionId === sessionRef.current) setStreamingContent('');
    controllersRef.current.get(sessionId)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(sessionId, controller);
    const initialMessages: Message[] = sessionId === sessionRef.current ? projectMessages(events) : [];
    const engine = new AgentEngine({
      sessionId,
      containerId,
      persona: sunamModel,
      model: apiModel,
      input: userPrompt.trim(),
      initialMessages,
      client: new OpenAIChatModelClient({ apiKey, baseUrl, model: apiModel }),
      runtime,
      store: storeRef.current,
      signal: controller.signal,
      onEvent: appendEvent,
      onRunChange: updateRun,
    });
    updateRun(engine.getRun());
    void engine.execute().finally(() => {
      if (controllersRef.current.get(sessionId) === controller) controllersRef.current.delete(sessionId);
    });
  }, [activeContainerId, activeSessionId, apiKey, apiModel, appendEvent, baseUrl, events, runtimeRef, sunamModel, updateRun]);

  const stopTask = useCallback(() => {
    if (activeSessionId) controllersRef.current.get(activeSessionId)?.abort();
  }, [activeSessionId]);

  const messages = useMemo(() => projectMessages(events), [events]);
  const activeRun = useMemo(() => runs.find((run) => ['preparing', 'planning', 'acting', 'observing', 'verifying', 'cancelling'].includes(run.phase)) ?? null, [runs]);
  const latestRun = runs[0] ?? null;

  return { events, runs, messages, activeRun, latestRun, streamingContent, startTask, stopTask };
}
