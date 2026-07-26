import { createId } from '@/shared/lib/ids';
import type { Session, SessionStatus, WorkspacePersistenceRepository, WorkspaceState } from '@/entities/workspace/types';
import { prepareWorkspaceDeletion } from './deletionCoordinator';

const EMPTY_SESSION_TITLES = new Set(['新对话', '新建对话']);

function isReusableEmptySession(session: Session) {
  return EMPTY_SESSION_TITLES.has(session.title.trim()) && session.status === undefined;
}

export function createSessionActions(
  setState: (updater: (previous: WorkspaceState) => WorkspaceState, options?: { persist?: boolean }) => WorkspaceState,
  getState: () => WorkspaceState,
  isHydratedAndSafe: () => boolean,
  now: () => number,
  repository: WorkspacePersistenceRepository,
  enqueuePersistence: (operation: () => Promise<void>) => Promise<void>
) {
  return {
    createSession: () => {
      const state = getState();
      const emptySessions = state.sessions.filter(isReusableEmptySession);
      const reusable = emptySessions.find((session) => session.id === state.activeSessionId) ?? emptySessions[0];
      
      if (reusable) {
        if (!isHydratedAndSafe()) return reusable.id;
        const redundantIds = new Set(emptySessions.filter((session) => session.id !== reusable.id).map((session) => session.id));
        const next = setState((previous) => previous.activeSessionId === reusable.id && redundantIds.size === 0
          ? previous
          : { ...previous, sessions: previous.sessions.filter((session) => !redundantIds.has(session.id)), activeSessionId: reusable.id }, { persist: false });
        redundantIds.forEach((id) => { void enqueuePersistence(async () => { await prepareWorkspaceDeletion({ kind: 'session', id }); await repository.deleteSession(id, next); }); });
        return reusable.id;
      }
      
      const timestamp = now();
      const session: Session = { id: createId('s'), title: '新对话', updatedAt: timestamp };
      setState((previous) => ({ ...previous, sessions: [session, ...previous.sessions], activeSessionId: session.id }));
      return session.id;
    },
    renameSession: (id: string, title: string) => setState((previous) => {
      const target = previous.sessions.find((session) => session.id === id);
      if (!target || target.title === title) return previous;
      return { ...previous, sessions: previous.sessions.map((session) => session.id === id ? { ...session, title, updatedAt: now() } : session) };
    }),
    deleteSession: (id: string): Promise<void> => {
      if (!getState().sessions.some((session) => session.id === id)) return Promise.resolve();
      return enqueuePersistence(async () => {
        await prepareWorkspaceDeletion({ kind: 'session', id });
        const current = getState();
        const sessions = current.sessions.filter((session) => session.id !== id);
        const next = { ...current, sessions, activeSessionId: current.activeSessionId === id ? sessions[0]?.id ?? null : current.activeSessionId };
        await repository.deleteSession(id, next);
        setState((previous) => {
          const remaining = previous.sessions.filter((session) => session.id !== id);
          return { ...previous, sessions: remaining, activeSessionId: previous.activeSessionId === id ? remaining[0]?.id ?? null : previous.activeSessionId };
        }, { persist: false });
      });
    },
    togglePinSession: (id: string) => setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => session.id === id ? { ...session, pinned: !session.pinned, updatedAt: now() } : session),
    })),
    updateSessionStatus: (id: string, status: SessionStatus) => setState((previous) => {
      const target = previous.sessions.find((session) => session.id === id);
      if (!target || target.status === status) return previous;
      return { ...previous, sessions: previous.sessions.map((session) => session.id === id ? { ...session, status } : session) };
    }),
    selectSession: (id: string) => setState((previous) => {
      const target = previous.sessions.find((session) => session.id === id);
      if (!target) return previous;
      const unread = target.status === 'completed_unread' || target.status === 'failed_unread';
      if (previous.activeSessionId === id && !unread) return previous;
      return {
        ...previous,
        activeSessionId: id,
        sessions: unread ? previous.sessions.map((session) => session.id === id ? { ...session, status: 'idle' } : session) : previous.sessions,
      };
    }),
  };
}
