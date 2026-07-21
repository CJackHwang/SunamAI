import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAttachment, Message } from '@/entities/message/types';
import type { SessionStatus } from '@/entities/workspace/types';
import type { SunamModel } from '@/shared/config/models';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import { AgentEngine, type AgentResumeState } from './engine';
import { AgentEventStore } from './eventStore';
import { OpenAIChatModelClient } from './modelClient';
import { projectMessages, projectModelMessages } from './projector';
import { isActiveAgentPhase, type AgentEvent, type AgentRun } from './types';
import { toErrorMessage } from '@/shared/lib/errors';

type UpdateSessionStatus = (id: string, status: SessionStatus) => void;

export function mergeSessionRecords<T extends { id: string; sessionId: string }>(persisted: T[], current: T[], sessionId: string): T[] {
  const byId = new Map(persisted.map((item) => [item.id, item]));
  current.filter((item) => item.sessionId === sessionId).forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
}

export function recoveredSessionStatus(runs: AgentRun[]): SessionStatus | null {
  const latest = [...runs].sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return latest && (latest.phase === 'interrupted' || latest.phase === 'awaiting_user') ? 'idle' : null;
}

function toSessionStatus(run: AgentRun): SessionStatus {
  if (isActiveAgentPhase(run.phase)) return 'running';
  if (run.phase === 'failed') return 'failed_unread';
  if (run.phase === 'completed') return 'completed_unread';
  return 'idle';
}

export function useAgentV2(
  apiKey: string,
  baseUrl: string,
  apiModel: string,
  sunamModel: SunamModel,
  runtime: AgentWorkspaceRuntime | null,
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
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const sessionRef = useRef(activeSessionId);
  sessionRef.current = activeSessionId;

  useEffect(() => {
    let mounted = true;
    if (!activeSessionId) {
      setEvents([]);
      setRuns([]);
      setStreamingContent('');
      setStreamingReasoning('');
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
        const recoveredStatus = recoveredSessionStatus(restoredRuns);
        if (recoveredStatus) updateSessionStatus(activeSessionId, recoveredStatus);
        setEvents((previous) => {
          // Loading is asynchronous, so retain events appended while this same
          // session was loading. Never merge the previously selected session.
          return mergeSessionRecords(loaded, previous, activeSessionId).sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence);
        });
        setRuns((previous) => {
          return mergeSessionRecords(restoredRuns, previous, activeSessionId).sort((left, right) => right.updatedAt - left.updatedAt);
        });
        setStreamingContent('');
        setStreamingReasoning('');
      }
      setPersistenceError(null);
    })().catch((error) => { if (mounted) setPersistenceError(toErrorMessage(error)); });
    return () => { mounted = false; };
  }, [activeSessionId, updateSessionStatus]);

  const appendEvent = useCallback((event: AgentEvent) => {
    if (event.transient) {
      if (event.kind === 'assistant_delta' && event.sessionId === sessionRef.current) {
        setStreamingContent(event.content);
        setStreamingReasoning(event.reasoningContent);
      }
      return;
    }
    if (event.sessionId === sessionRef.current) {
      setEvents((previous) => previous.some((candidate) => candidate.id === event.id) ? previous : [...previous, event]);
    }
    if (event.kind === 'message' && event.message.role === 'assistant' && event.sessionId === sessionRef.current) {
      setStreamingContent('');
      setStreamingReasoning('');
    }
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

  const launchTask = useCallback((userPrompt: string, overrideSessionId?: string, overrideContainerId?: string, inheritedMessages?: Message[], attachments?: ChatAttachment[], resume?: AgentResumeState) => {
    const sessionId = overrideSessionId ?? activeSessionId;
    const containerId = overrideContainerId ?? activeContainerId;
    if (!sessionId || !containerId || !runtime || !userPrompt.trim()) return;
    if (sessionId === sessionRef.current) setStreamingContent('');
    if (sessionId === sessionRef.current) setStreamingReasoning('');
    controllersRef.current.get(sessionId)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(sessionId, controller);
    const initialMessages: Message[] = inheritedMessages ?? (sessionId === sessionRef.current ? projectModelMessages(events) : []);
    const engine = new AgentEngine({
      sessionId,
      containerId,
      persona: sunamModel,
      model: apiModel,
      input: userPrompt.trim(),
      attachments,
      initialMessages,
      client: new OpenAIChatModelClient({ apiKey, baseUrl, model: apiModel }),
      runtime,
      store: storeRef.current,
      signal: controller.signal,
      onEvent: appendEvent,
      onRunChange: updateRun,
      resume,
    });
    updateRun(engine.getRun());
    void engine.execute()
      .catch((error) => setPersistenceError(toErrorMessage(error)))
      .finally(() => {
        if (controllersRef.current.get(sessionId) === controller) controllersRef.current.delete(sessionId);
      });
  }, [activeContainerId, activeSessionId, apiKey, apiModel, appendEvent, baseUrl, events, runtime, sunamModel, updateRun]);

  const startTask = useCallback((userPrompt: string, overrideSessionId?: string, overrideContainerId?: string, attachments?: ChatAttachment[]) => {
    launchTask(userPrompt, overrideSessionId, overrideContainerId, undefined, attachments);
  }, [launchTask]);

  const resumeTask = useCallback((run?: AgentRun | null) => {
    const target = run ?? runs.find((candidate) => candidate.phase === 'interrupted') ?? runs[0] ?? null;
    if (!target) return;
    void storeRef.current.latestCheckpoint(target.id).then((checkpoint) => {
      const inherited = checkpoint?.messages ?? (target.sessionId === sessionRef.current ? projectModelMessages(events) : []);
      const checkpointSummary = checkpoint?.summary ?? target.summary ?? 'reassess the interrupted task';
      const prompt = `Continue from checkpoint: ${checkpointSummary}. Inspect the current workspace, preserve truthful evidence, and finish only after verification.`;
      launchTask(prompt, target.sessionId, target.containerId, inherited, undefined, { sourceRunId: target.id, task: target.task, summary: checkpointSummary });
    }).catch((error) => setPersistenceError(toErrorMessage(error)));
  }, [events, launchTask, runs]);

  const stopTask = useCallback(() => {
    if (activeSessionId) controllersRef.current.get(activeSessionId)?.abort();
  }, [activeSessionId]);

  const messages = useMemo(() => projectMessages(events), [events]);
  const activeRun = useMemo(() => runs.find((run) => isActiveAgentPhase(run.phase)) ?? null, [runs]);
  const latestRun = runs[0] ?? null;

  return { events, runs, messages, activeRun, latestRun, streamingContent, streamingReasoning, persistenceError, startTask, resumeTask, stopTask };
}
