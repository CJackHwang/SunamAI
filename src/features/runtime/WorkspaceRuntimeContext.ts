import { createContext, useContext } from 'react';
import type { WebContainer } from '@webcontainer/api';
import type { WebContainerAgentRuntime } from '@/features/terminal-session/WebContainerAgentRuntime';
import { getContainerRoot } from '@/shared/lib/containerPaths';

export interface WorkspaceRuntimeContextValue {
  webcontainer: WebContainer | null;
  runtime: WebContainerAgentRuntime | null;
  error: string | null;
  isReady: boolean;
  getContainerRoot: typeof getContainerRoot;
}

export const WorkspaceRuntimeContext = createContext<WorkspaceRuntimeContextValue | null>(null);

export function useWorkspaceRuntime(): WorkspaceRuntimeContextValue {
  const value = useContext(WorkspaceRuntimeContext);
  if (!value) throw new Error('useWorkspaceRuntime must be used inside WorkspaceRuntimeProvider.');
  return value;
}
