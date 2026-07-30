import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAttachment, Message } from '@/entities/message/types';
import type { SessionStatus } from '@/entities/workspace/types';
import type { SunamModel } from '@/shared/config/models';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import { AgentEngine, type AgentResumeState } from './engine';
import { AgentEventStore } from './eventStore';
import { OpenAIChatModelClient } from './modelClient';
import { projectMessages, projectModelMessages } from './projector';
import { isActiveAgentPhase, normalizeSubagentRole, type AgentEvent, type AgentRun } from './types';
import { toErrorMessage } from '@/shared/lib/errors';
import { AgentFamilyCoordinator } from './subagentCoordinator';
import { registerWorkspaceDeletionPreparation } from '@/entities/workspace/deletionCoordinator';

type UpdateSessionStatus = (id: string, status: SessionStatus) => void;
const MESSAGE_WINDOW_SIZE = 250;
interface ActiveExecution { sessionId: string; containerId: string; controller: AbortController; engine: AgentEngine; coordinator: AgentFamilyCoordinator; completion: Promise<void>; }
interface StreamingState { streamId: string; content: string; reasoning: string; toolCalls: NonNullable<Message['tool_calls']>; }
export type AgentConversationView = { kind: 'root' } | { kind: 'subagent'; sessionId: string; runId: string };

function isRootRun(run: AgentRun): boolean { return (run.depth ?? 0) === 0; }

export function projectConversationEvents(events: AgentEvent[], runs: AgentRun[], view: AgentConversationView): AgentEvent[] {
  if (view.kind === 'subagent') return events.filter((event) => event.sessionId === view.sessionId && event.runId === view.runId);
  const rootRunIds = new Set(runs.filter(isRootRun).map((run) => run.id));
  return events.filter((event) => rootRunIds.has(event.runId));
}

export function selectMessageWindow<T>(messages: T[], end: number | null, size = MESSAGE_WINDOW_SIZE): T[] {
  const boundedEnd = end === null ? messages.length : Math.min(messages.length, Math.max(0, end));
  return messages.slice(Math.max(0, boundedEnd - size), boundedEnd);
}

export function mergeSessionRecords<T extends { id: string; sessionId: string }>(persisted: T[], current: T[], sessionId: string): T[] {
  const byId = new Map(persisted.map((item) => [item.id, item]));
  current.filter((item) => item.sessionId === sessionId).forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
}

export function recoveredSessionStatus(runs: AgentRun[]): SessionStatus | null {
  const latest = runs.filter(isRootRun).sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return latest && (latest.phase === 'interrupted' || latest.phase === 'awaiting_user') ? 'idle' : null;
}

export function detectWorkspaceDrift(checkpointRevision: number | undefined, currentRevision: number): { checkpointRevision: number; currentRevision: number } | undefined {
  return checkpointRevision !== undefined && checkpointRevision !== currentRevision ? { checkpointRevision, currentRevision } : undefined;
}

export function detectEventTailDrift(checkpointSequence: number | undefined, currentSequence: number | undefined): { checkpointSequence: number; currentSequence: number } | undefined {
  return checkpointSequence !== undefined && currentSequence !== undefined && currentSequence > checkpointSequence ? { checkpointSequence, currentSequence } : undefined;
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
  conversationView: AgentConversationView = { kind: 'root' },
) {
  const storeRef = useRef(new AgentEventStore());
  const executionsRef = useRef(new Map<string, ActiveExecution>());
  const recoveredSessionsRef = useRef(new Set<string>());
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [streamingByRunId, setStreamingByRunId] = useState<Record<string, StreamingState>>({});
  const [compactingByRunId, setCompactingByRunId] = useState<Record<string, boolean>>({});
  const [childRunsBySession, setChildRunsBySession] = useState<Record<string, AgentRun[]>>({});
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [hasOlderEvents, setHasOlderEvents] = useState(false);
  const [visibleMessageEnd, setVisibleMessageEnd] = useState<number | null>(null);
  const loadingOlderRef = useRef(false);
  const visibleMessageEndRef = useRef(visibleMessageEnd);
  visibleMessageEndRef.current = visibleMessageEnd;
  const sessionRef = useRef(activeSessionId);
  sessionRef.current = activeSessionId;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const conversationViewRef = useRef(conversationView);
  conversationViewRef.current = conversationView;

  useEffect(() => {
    const executions = executionsRef.current;
    const unregister = registerWorkspaceDeletionPreparation(async (target) => {
      const matches = [...executions.values()].filter((execution) => target.kind === 'session' ? execution.sessionId === target.id : execution.containerId === target.id);
      matches.forEach((execution) => execution.controller.abort(new DOMException(`${target.kind} deleted.`, 'AbortError')));
      await Promise.all(matches.map((execution) => execution.completion));
    });
    return () => {
      unregister();
      executions.forEach((execution) => execution.controller.abort(new DOMException('Agent workspace closed.', 'AbortError')));
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!activeSessionId) {
      setEvents([]);
      setRuns([]);
      setHasOlderEvents(false);
      setVisibleMessageEnd(null);
      return () => { mounted = false; };
    }
    void (async () => {
      const store = storeRef.current;
      const loaded = await store.loadSessionEvents(activeSessionId);
      const hasActiveExecution = [...executionsRef.current.values()].some((execution) => execution.sessionId === activeSessionId);
      const restoredRuns = !recoveredSessionsRef.current.has(activeSessionId) && !hasActiveExecution
        ? await store.markInterruptedRuns(activeSessionId)
        : await store.loadSessionRuns(activeSessionId);
      recoveredSessionsRef.current.add(activeSessionId);
      if (mounted && sessionRef.current === activeSessionId) {
        const recoveredStatus = recoveredSessionStatus(restoredRuns);
        if (recoveredStatus) updateSessionStatus(activeSessionId, recoveredStatus);
        setEvents((previous) => {
          // Loading is asynchronous, so retain events appended while this same
          // session was loading. Never merge the previously selected session.
          return mergeSessionRecords(loaded, previous, activeSessionId).sort((left, right) => left.createdAt - right.createdAt || left.sequence - right.sequence || left.id.localeCompare(right.id));
        });
        setRuns((previous) => {
          return mergeSessionRecords(restoredRuns, previous, activeSessionId).sort((left, right) => right.updatedAt - left.updatedAt);
        });
        setChildRunsBySession((previous) => ({ ...previous, [activeSessionId]: restoredRuns.filter((run) => !isRootRun(run)) }));
        setHasOlderEvents(store.hasOlderSessionEvents(activeSessionId));
        setVisibleMessageEnd(null);
      }
      setPersistenceError(null);
    })().catch((error) => { if (mounted) setPersistenceError(toErrorMessage(error)); });
    return () => { mounted = false; };
  }, [activeSessionId, updateSessionStatus]);

  const appendEvent = useCallback((event: AgentEvent) => {
    if (event.transient) {
      // Live state is keyed by Run so a newly-created session cannot drop its
      // first transient events before React commits the active-session update.
      if (event.kind === 'assistant_delta') {
        setStreamingByRunId((previous) => ({
          ...previous,
          [event.runId]: {
            streamId: event.streamId,
            content: event.content,
            reasoning: event.reasoningContent,
            toolCalls: event.toolCalls?.filter((call) => call.id && call.function.name) ?? [],
          },
        }));
      }
      if (event.kind === 'context_compaction_status') {
        setCompactingByRunId((previous) => {
          if (event.active) return { ...previous, [event.runId]: true };
          if (!previous[event.runId]) return previous;
          const next = { ...previous };
          delete next[event.runId];
          return next;
        });
      }
      return;
    }
    if (event.sessionId === sessionRef.current) {
      setEvents((previous) => previous.some((candidate) => candidate.id === event.id) ? previous : [...previous, event]);
      const view = conversationViewRef.current;
      const run = event.kind === 'run_started' ? event.run : runsRef.current.find((candidate) => candidate.id === event.runId);
      if (view.kind === 'subagent' ? event.runId === view.runId : Boolean(run && isRootRun(run))) setVisibleMessageEnd(null);
    }
    if (event.kind === 'message' && event.message.role === 'assistant' && event.sessionId === sessionRef.current) {
      setStreamingByRunId((previous) => {
        const streaming = previous[event.runId];
        if (!streaming || event.streamId && streaming.streamId !== event.streamId) return previous;
        const next = { ...previous };
        delete next[event.runId];
        return next;
      });
    }
  }, []);

  const updateRun = useCallback((run: AgentRun) => {
    if (isRootRun(run)) updateSessionStatus(run.sessionId, toSessionStatus(run));
    else setChildRunsBySession((previous) => {
      const withoutCurrent = (previous[run.sessionId] ?? []).filter((candidate) => candidate.id !== run.id);
      return { ...previous, [run.sessionId]: [run, ...withoutCurrent].sort((left, right) => left.createdAt - right.createdAt) };
    });
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
    setPersistenceError(null);
    [...executionsRef.current.values()].filter((execution) => execution.sessionId === sessionId).forEach((execution) => execution.controller.abort(new DOMException('Superseded by a newer run.', 'AbortError')));
    const controller = new AbortController();
    const rootEvents = projectConversationEvents(events, runs, { kind: 'root' });
    const initialMessages: Message[] = inheritedMessages ?? (sessionId === sessionRef.current ? projectModelMessages(rootEvents) : []);
    const createClient = () => new OpenAIChatModelClient({ apiKey, baseUrl, model: apiModel }, sessionId);
    const engine = new AgentEngine({
      sessionId,
      containerId,
      persona: sunamModel,
      model: apiModel,
      input: userPrompt.trim(),
      ...(attachments ? { attachments } : {}),
      initialMessages,
      client: createClient(),
      runtime,
      store: storeRef.current,
      signal: controller.signal,
      onEvent: appendEvent,
      onRunChange: updateRun,
      ...(resume ? { resume } : {}),
    });
    const onChildrenPruned = (runIds: string[]) => {
      const removed = new Set(runIds);
      setRuns((previous) => previous.filter((run) => !removed.has(run.id)));
      setEvents((previous) => previous.filter((event) => !removed.has(event.runId)));
      setChildRunsBySession((previous) => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, value.filter((run) => !removed.has(run.id))])));
      setStreamingByRunId((previous) => Object.fromEntries(Object.entries(previous).filter(([runId]) => !removed.has(runId))));
      setCompactingByRunId((previous) => Object.fromEntries(Object.entries(previous).filter(([runId]) => !removed.has(runId))));
    };
    const coordinator = new AgentFamilyCoordinator({
      root: engine, createClient, runtime, store: storeRef.current, signal: controller.signal, persona: sunamModel, model: apiModel, onEvent: appendEvent, onRunChange: updateRun, onChildrenPruned,
    });
    engine.setSubagentHost(coordinator);
    updateRun(engine.getRun());
    const runId = engine.getRun().id;
    const completion = engine.execute()
      .catch((error) => setPersistenceError(toErrorMessage(error)))
      .finally(() => {
        executionsRef.current.delete(runId);
        setCompactingByRunId((previous) => {
          if (!previous[runId]) return previous;
          const next = { ...previous };
          delete next[runId];
          return next;
        });
      });
    executionsRef.current.set(runId, { sessionId, containerId, controller, engine, coordinator, completion });
  }, [activeContainerId, activeSessionId, apiKey, apiModel, appendEvent, baseUrl, events, runs, runtime, sunamModel, updateRun]);

  const startTask = useCallback((userPrompt: string, overrideSessionId?: string, overrideContainerId?: string, attachments?: ChatAttachment[]) => {
    launchTask(userPrompt, overrideSessionId, overrideContainerId, undefined, attachments);
  }, [launchTask]);

  const resumeTask = useCallback((run?: AgentRun | null) => {
    const target = run ?? runs.find((candidate) => candidate.phase === 'interrupted') ?? runs[0] ?? null;
    if (!target || !runtime) return;
    void storeRef.current.latestCheckpoint(target.id).then(async (checkpoint) => {
      await runtime.ensureContainer(target.containerId);
      const currentRevision = await runtime.getWorkspaceRevision(target.containerId);
      const workspaceDrift = detectWorkspaceDrift(checkpoint?.workspaceRevision, currentRevision);
      const currentSequence = await storeRef.current.latestEventSequence(target.id);
      const eventTailDrift = detectEventTailDrift(checkpoint?.eventTailSequence, currentSequence);
      const delegatedTasks = await storeRef.current.listAgentTasks(target.rootRunId ?? target.id);
      const subagentStatus = delegatedTasks.map((task) => `- ${task.runId ?? task.id} [${normalizeSubagentRole(task.role)}/${task.status}] ${task.taskId}: ${task.prompt}${task.summary ? ` — ${task.summary}` : ''}`);
      const inherited = checkpoint?.messages ?? (target.sessionId === sessionRef.current ? projectModelMessages(projectConversationEvents(events, runs, { kind: 'root' })) : []);
      const baseSummary = checkpoint?.summary ?? target.summary ?? 'reassess the interrupted task';
      const recoveryNotes = [
        workspaceDrift ? `Workspace drift detected: checkpoint revision ${workspaceDrift.checkpointRevision}, current revision ${workspaceDrift.currentRevision}. Prior file reads and verification must be refreshed.` : '',
        eventTailDrift ? `Event drift detected: checkpoint tail ${eventTailDrift.checkpointSequence}, persisted run tail ${eventTailDrift.currentSequence}.` : '',
        subagentStatus.length ? `Recovered delegated tasks:\n${subagentStatus.join('\n')}` : '',
      ].filter(Boolean).join('\n\n');
      const checkpointSummary = [baseSummary, recoveryNotes].filter(Boolean).join('\n\n');
      const prompt = `Continue from checkpoint: ${checkpointSummary}. Inspect the current workspace, preserve truthful evidence, and finish only after verification.`;
      launchTask(prompt, target.sessionId, target.containerId, inherited, undefined, { sourceRunId: target.id, task: target.task, summary: checkpointSummary, ...(workspaceDrift ? { workspaceDrift } : {}), ...(eventTailDrift ? { eventTailDrift } : {}), ...(subagentStatus.length ? { subagentStatus } : {}) });
    }).catch((error) => setPersistenceError(toErrorMessage(error)));
  }, [events, launchTask, runs, runtime]);

  const stopTask = useCallback(() => {
    if (activeSessionId) [...executionsRef.current.values()].filter((execution) => execution.sessionId === activeSessionId).forEach((execution) => execution.controller.abort());
  }, [activeSessionId]);

  const stopSubagent = useCallback(async (runId: string): Promise<boolean> => {
    for (const execution of executionsRef.current.values()) {
      if (await execution.coordinator.stopAndWait(runId)) return true;
    }
    return false;
  }, []);

  const guideActiveTask = useCallback(async (message: string): Promise<boolean> => {
    if (!activeSessionId || !message.trim()) return false;
    const execution = [...executionsRef.current.values()].find((candidate) => candidate.sessionId === activeSessionId && isRootRun(candidate.engine.getRun()));
    if (!execution) return false;
    try {
      return await execution.engine.enqueueUserGuidance(message);
    } catch (error) {
      setPersistenceError(toErrorMessage(error));
      return false;
    }
  }, [activeSessionId]);

  const deleteSubagent = useCallback(async (sessionId: string, runId: string): Promise<boolean> => {
    try {
      const target = runsRef.current.find((run) => run.id === runId) ?? (await storeRef.current.loadSessionRuns(sessionId)).find((run) => run.id === runId);
      if (target && (isActiveAgentPhase(target.phase) || target.phase === 'awaiting_user' || target.phase === 'awaiting_parent')) return false;
      const deleted = await storeRef.current.deleteChildRun(runId);
      if (!deleted) return false;
      setRuns((previous) => previous.filter((run) => run.id !== runId));
      setEvents((previous) => previous.filter((event) => event.runId !== runId));
      setChildRunsBySession((previous) => ({ ...previous, [sessionId]: (previous[sessionId] ?? []).filter((run) => run.id !== runId) }));
      setStreamingByRunId((previous) => {
        if (!previous[runId]) return previous;
        const next = { ...previous };
        delete next[runId];
        return next;
      });
      setCompactingByRunId((previous) => {
        if (!previous[runId]) return previous;
        const next = { ...previous };
        delete next[runId];
        return next;
      });
      return true;
    } catch (error) {
      setPersistenceError(toErrorMessage(error));
      return false;
    }
  }, []);

  const loadSessionSubagents = useCallback(async (sessionId: string): Promise<AgentRun[]> => {
    try {
      const children = (await storeRef.current.loadSessionRuns(sessionId)).filter((run) => !isRootRun(run));
      setChildRunsBySession((previous) => ({ ...previous, [sessionId]: children }));
      return children;
    } catch (error) {
      setPersistenceError(toErrorMessage(error));
      return [];
    }
  }, []);

  const loadOlderEvents = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || loadingOlderRef.current || !storeRef.current.hasOlderSessionEvents(sessionId)) return false;
    loadingOlderRef.current = true;
    try {
      const previousMessages = projectMessages(projectConversationEvents(eventsRef.current, runs, { kind: 'root' })).length;
      const previousEnd = visibleMessageEndRef.current ?? previousMessages;
      const page = await storeRef.current.loadOlderSessionEvents(sessionId);
      if (sessionRef.current === sessionId) {
        setEvents(page.events);
        setHasOlderEvents(page.hasMore);
        const nextMessages = projectMessages(projectConversationEvents(page.events, runs, { kind: 'root' })).length;
        const added = Math.max(0, nextMessages - previousMessages);
        setVisibleMessageEnd(Math.min(nextMessages, added + Math.max(0, previousEnd - MESSAGE_WINDOW_SIZE)));
      }
      return true;
    } catch (error) {
      setPersistenceError(toErrorMessage(error));
      return false;
    } finally {
      loadingOlderRef.current = false;
    }
  }, [runs]);

  const loadRunEvents = useCallback(async (runId: string) => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    try {
      const loaded = await storeRef.current.loadRunEvents(sessionId, runId);
      if (sessionRef.current === sessionId) setEvents(loaded);
    } catch (error) {
      setPersistenceError(toErrorMessage(error));
    }
  }, []);

  const viewEvents = useMemo(() => projectConversationEvents(events, runs, conversationView), [conversationView, events, runs]);
  const allMessageEvents = useMemo(() => viewEvents.filter((event): event is Extract<AgentEvent, { kind: 'message' }> => event.kind === 'message'), [viewEvents]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const messageEvents = useMemo(() => {
    return selectMessageWindow(allMessageEvents, conversationView.kind === 'root' ? visibleMessageEnd : null);
  }, [allMessageEvents, conversationView.kind, visibleMessageEnd]);
  const messages = useMemo(() => messageEvents.map((event) => event.message), [messageEvents]);
  const messageKeys = useMemo(() => messageEvents.map((event) => event.streamId ?? event.id), [messageEvents]);
  const hasNewerEvents = conversationView.kind === 'root' && visibleMessageEnd !== null && visibleMessageEnd < allMessageEvents.length;
  const showNewerEvents = useCallback(() => {
    setVisibleMessageEnd((current) => {
      if (current === null) return null;
      const next = Math.min(allMessageEvents.length, current + MESSAGE_WINDOW_SIZE);
      return next >= allMessageEvents.length ? null : next;
    });
  }, [allMessageEvents.length]);
  const rootRuns = useMemo(() => runs.filter(isRootRun), [runs]);
  const activeRun = useMemo(() => rootRuns.find((run) => isActiveAgentPhase(run.phase)) ?? null, [rootRuns]);
  const latestRun = rootRuns[0] ?? null;
  const viewedRun = conversationView.kind === 'subagent' ? runs.find((run) => run.id === conversationView.runId) ?? null : activeRun ?? latestRun;
  const streaming = viewedRun ? streamingByRunId[viewedRun.id] : undefined;
  const isCompacting = Boolean(viewedRun && compactingByRunId[viewedRun.id]);

  return {
    events,
    runs,
    childRunsBySession,
    messages,
    messageKeys,
    activeRun,
    latestRun,
    viewedRun,
    streamingKey: streaming?.streamId,
    streamingContent: streaming?.content ?? '',
    streamingReasoning: streaming?.reasoning ?? '',
    streamingToolCalls: streaming?.toolCalls ?? [],
    isCompacting,
    persistenceError,
    hasOlderEvents: conversationView.kind === 'root' && hasOlderEvents,
    hasNewerEvents,
    loadOlderEvents,
    loadRunEvents,
    loadSessionSubagents,
    showNewerEvents,
    startTask,
    guideActiveTask,
    resumeTask,
    stopTask,
    stopSubagent,
    deleteSubagent,
  };
}

export type AgentController = ReturnType<typeof useAgentV2>;
