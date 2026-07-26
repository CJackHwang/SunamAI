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
import { AgentFamilyCoordinator } from './subagentCoordinator';
import { registerWorkspaceDeletionPreparation } from '@/entities/workspace/deletionCoordinator';

type UpdateSessionStatus = (id: string, status: SessionStatus) => void;
const MESSAGE_WINDOW_SIZE = 250;
interface ActiveExecution { sessionId: string; containerId: string; controller: AbortController; completion: Promise<void>; }

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
  const latest = [...runs].sort((left, right) => right.updatedAt - left.updatedAt)[0];
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
) {
  const storeRef = useRef(new AgentEventStore());
  const executionsRef = useRef(new Map<string, ActiveExecution>());
  const recoveredSessionsRef = useRef(new Set<string>());
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [hasOlderEvents, setHasOlderEvents] = useState(false);
  const [visibleMessageEnd, setVisibleMessageEnd] = useState<number | null>(null);
  const loadingOlderRef = useRef(false);
  const visibleMessageEndRef = useRef(visibleMessageEnd);
  visibleMessageEndRef.current = visibleMessageEnd;
  const sessionRef = useRef(activeSessionId);
  sessionRef.current = activeSessionId;

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
      setStreamingContent('');
      setStreamingReasoning('');
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
        setStreamingContent('');
        setStreamingReasoning('');
        setHasOlderEvents(store.hasOlderSessionEvents(activeSessionId));
        setVisibleMessageEnd(null);
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
      setVisibleMessageEnd(null);
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
    setPersistenceError(null);
    if (sessionId === sessionRef.current) setStreamingContent('');
    if (sessionId === sessionRef.current) setStreamingReasoning('');
    [...executionsRef.current.values()].filter((execution) => execution.sessionId === sessionId).forEach((execution) => execution.controller.abort(new DOMException('Superseded by a newer run.', 'AbortError')));
    const controller = new AbortController();
    const initialMessages: Message[] = inheritedMessages ?? (sessionId === sessionRef.current ? projectModelMessages(events) : []);
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
    engine.setSubagentHost(new AgentFamilyCoordinator({
      root: engine, createClient, runtime, store: storeRef.current, signal: controller.signal, persona: sunamModel, model: apiModel, onEvent: appendEvent, onRunChange: updateRun,
    }));
    updateRun(engine.getRun());
    const runId = engine.getRun().id;
    const completion = engine.execute()
      .catch((error) => setPersistenceError(toErrorMessage(error)))
      .finally(() => {
        executionsRef.current.delete(runId);
      });
    executionsRef.current.set(runId, { sessionId, containerId, controller, completion });
  }, [activeContainerId, activeSessionId, apiKey, apiModel, appendEvent, baseUrl, events, runtime, sunamModel, updateRun]);

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
      const subagentStatus = delegatedTasks.map((task) => `- ${task.runId ?? task.id} [${task.role}/${task.status}] ${task.taskId}: ${task.prompt}${task.summary ? ` — ${task.summary}` : ''}`);
      const inherited = checkpoint?.messages ?? (target.sessionId === sessionRef.current ? projectModelMessages(events) : []);
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

  const loadOlderEvents = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || loadingOlderRef.current || !storeRef.current.hasOlderSessionEvents(sessionId)) return false;
    loadingOlderRef.current = true;
    try {
      const previousMessages = projectMessages(eventsRef.current).length;
      const previousEnd = visibleMessageEndRef.current ?? previousMessages;
      const page = await storeRef.current.loadOlderSessionEvents(sessionId);
      if (sessionRef.current === sessionId) {
        setEvents(page.events);
        setHasOlderEvents(page.hasMore);
        const nextMessages = projectMessages(page.events).length;
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
  }, []);

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

  const allMessages = useMemo(() => projectMessages(events), [events]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const messages = useMemo(() => {
    return selectMessageWindow(allMessages, visibleMessageEnd);
  }, [allMessages, visibleMessageEnd]);
  const hasNewerEvents = visibleMessageEnd !== null && visibleMessageEnd < allMessages.length;
  const showNewerEvents = useCallback(() => {
    setVisibleMessageEnd((current) => {
      if (current === null) return null;
      const next = Math.min(allMessages.length, current + MESSAGE_WINDOW_SIZE);
      return next >= allMessages.length ? null : next;
    });
  }, [allMessages.length]);
  const activeRun = useMemo(() => runs.find((run) => isActiveAgentPhase(run.phase)) ?? null, [runs]);
  const latestRun = runs[0] ?? null;

  return { events, runs, messages, activeRun, latestRun, streamingContent, streamingReasoning, persistenceError, hasOlderEvents, hasNewerEvents, loadOlderEvents, loadRunEvents, showNewerEvents, startTask, resumeTask, stopTask };
}
