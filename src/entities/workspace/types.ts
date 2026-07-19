export type SessionStatus = 'idle' | 'running' | 'completed_unread' | 'failed_unread';

export interface Session {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
  status?: SessionStatus;
}

export interface Container {
  id: string;
  name: string;
  updatedAt: number;
  pinned?: boolean;
}

export interface WorkspaceState {
  sessions: Session[];
  containers: Container[];
  activeSessionId: string | null;
  activeContainerId: string | null;
}
