import type { WebContainer } from '@webcontainer/api';
import { getWebContainer, resetWebContainer } from '@/shared/lib/webcontainer';
import { WebContainerAgentRuntime } from './WebContainerAgentRuntime';

export interface WorkspaceRuntimeInstance {
  webcontainer: WebContainer;
  runtime: WebContainerAgentRuntime;
}

let runtimeInstance: WorkspaceRuntimeInstance | null = null;
let runtimePromise: Promise<WorkspaceRuntimeInstance> | null = null;

export function getWorkspaceRuntime(): Promise<WorkspaceRuntimeInstance> {
  if (runtimeInstance) return Promise.resolve(runtimeInstance);
  runtimePromise ??= getWebContainer().then((webcontainer) => {
    const value = { webcontainer, runtime: new WebContainerAgentRuntime(webcontainer) };
    runtimeInstance = value;
    return value;
  }).catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

export async function forceRestartWorkspaceRuntime(onRuntimeDiscarded?: () => void): Promise<WorkspaceRuntimeInstance> {
  const current = runtimeInstance ?? await runtimePromise;
  if (current) {
    await current.runtime.flushSnapshots();
    onRuntimeDiscarded?.();
    current.runtime.dispose();
  }
  runtimeInstance = null;
  runtimePromise = null;
  await resetWebContainer();
  return getWorkspaceRuntime();
}
