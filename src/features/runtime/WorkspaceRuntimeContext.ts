import { createContext, useContext } from 'react';
import type { WebContainer } from '@webcontainer/api';
import type { AgentWorkspaceRuntime } from '@/shared/contracts/agentRuntime';
import type { CapabilityAvailability } from '@/shared/contracts/capability';
import type { WebContainerAgentRuntime } from '@/features/runtime/WebContainerAgentRuntime';
import { getContainerRoot } from '@/shared/lib/containerPaths';

export type EffectiveContainerState = 'enabled' | 'disabled' | 'restricted';

export interface WorkspaceRuntimeContextValue {
  /** The live WebContainer instance (null when unavailable/disabled). */
  webcontainer: WebContainer | null;
  /** Container-bound runtime for terminal/service UI (null when unavailable/disabled). */
  runtime: WebContainerAgentRuntime | null;
  /** Agent engine runtime — always present (chat-only uses CapabilityAwareRuntime). */
  agentRuntime: AgentWorkspaceRuntime | null;
  error: string | null;
  /** Chat is usable — true whenever a (capability-aware) agent runtime is present. */
  isReady: boolean;
  isRestarting: boolean;
  /** Container availability (session state): 'enabled' | 'restricted'. */
  containerAvailability: CapabilityAvailability;
  /** True while a container boot (initial/retry/re-enable) is in flight. */
  containerStarting: boolean;
  /** Effective container switch state: user preference × availability. */
  effectiveContainerState: EffectiveContainerState;
  /** Re-initialize the container (retry from a restricted state). Returns success. */
  retryContainer: () => Promise<boolean>;
  /** Persist the container module master switch (used by the capability panel). */
  setContainerEnabled: (enabled: boolean) => void;
  /** Whether an Agent run is active (root or subagent) — locks the container switch. */
  containerSwitchLocked: boolean;
  setContainerSwitchLocked: (locked: boolean) => void;
  forceRestart: () => Promise<void>;
  getContainerRoot: typeof getContainerRoot;
}

export const WorkspaceRuntimeContext = createContext<WorkspaceRuntimeContextValue | null>(null);

export function useWorkspaceRuntime(): WorkspaceRuntimeContextValue {
  const value = useContext(WorkspaceRuntimeContext);
  if (!value) throw new Error('useWorkspaceRuntime must be used inside WorkspaceRuntimeProvider.');
  return value;
}
