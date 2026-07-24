import { createId } from '@/shared/lib/ids';
import type { Session, SessionStatus, WorkspaceState } from '@/entities/workspace/types';
import type { V2PersistenceRepository } from '@/shared/persistence/v2Repository';

const EMPTY_SESSION_TITLES = new Set(['新对话', '新建对话']);

function isReusableEmptySession(session: Session) {
  return EMPTY_SESSION_TITLES.has(session.title.trim()) && session.status === undefined;
}

export function createSessionActions(
  setState: (updater: (previous: WorkspaceState) => WorkspaceState) => void,
  getState: () => WorkspaceState,
  isHydratedAndSafe: () => boolean,
  now: () => number,
  repository: V2PersistenceRepository,
  reportPersistenceError: (error: unknown) => void
) {
  return {
    createSession: () => {
      const state = getState();
      const emptySessions = state.sessions.filter(isReusableEmptySession);
      const reusable = emptySessions.find((session) => session.id === state.activeSessionId) ?? emptySessions[0];
      
      if (reusable) {
        if (!isHydratedAndSafe()) return reusable.id;
        const redundantIds = new Set(emptySessions.filter((session) => session.id !== reusable.id).map((session) => session.id));
        setState((previous) => previous.activeSessionId === reusable.id && redundantIds.size === 0
          ? previous
          : { ...previous, sessions: previous.sessions.filter((session) => !redundantIds.has(session.id)), activeSessionId: reusable.id });
        redundantIds.forEach((id) => { void repository.deleteSession(id).catch(reportPersistenceError); });
        return reusable.id;
      }
      
      const timestamp = now();
      const session: Session = { id: createId('s'), title: '新对话', updatedAt: timestamp };
      setState((previous) => ({ ...previous, sessions: [session, ...previous.sessions], activeSessionId: session.id }));
      return session.id;
    },
    renameSession: (id: string, title: string) => setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => session.id === id ? { ...session, title, updatedAt: now() } : session),
    })),
    deleteSession: (id: string) => setState((previous) => {
      const sessions = previous.sessions.filter((session) => session.id !== id);
      void repository.deleteSession(id).catch(reportPersistenceError);
      return { ...previous, sessions, activeSessionId: previous.activeSessionId === id ? sessions[0]?.id ?? null : previous.activeSessionId };
    }),
    togglePinSession: (id: string) => setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => session.id === id ? { ...session, pinned: !session.pinned, updatedAt: now() } : session),
    })),
    updateSessionStatus: (id: string, status: SessionStatus) => setState((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => session.id === id ? { ...session, status } : session),
    })),
    selectSession: (id: string) => setState((previous) => ({
      ...previous,
      activeSessionId: id,
      sessions: previous.sessions.map((session) => session.id === id && (session.status === 'completed_unread' || session.status === 'failed_unread')
        ? { ...session, status: 'idle' }
        : session),
    })),
  };
}
