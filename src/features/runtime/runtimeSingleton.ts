import type { WebContainer } from '@webcontainer/api';
import { detachWebContainer, getWebContainer, resetWebContainer, resetWebContainerIfCurrent } from '@/shared/lib/webcontainer';
import { v3Persistence } from '@/entities/persistence/v3Repository';
import { WebContainerAgentRuntime } from './WebContainerAgentRuntime';
import { CapabilityAwareRuntime } from './CapabilityAwareRuntime';

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

/** Chat-only agent runtime: no container, resources still work via IndexedDB. */
export function createChatOnlyAgentRuntime(): CapabilityAwareRuntime {
  return new CapabilityAwareRuntime(null, false, v3Persistence);
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

/**
 * Close = real shutdown (F3.3/F4.4). Flush pending snapshots to IndexedDB (double
 * insurance over the scheduler), stop services/processes/snapshot watchers, tear down
 * the WebContainer WASM, and clear every singleton so a re-open does a fresh boot and
 * restores the workspace from the IndexedDB snapshot. Same release segment as
 * `forceRestartWorkspaceRuntime` minus the immediate re-boot.
 *
 * Race-safe: the singletons are cleared first, so a fast close→reopen boot creates a new
 * instance instead of grabbing this one; teardown targets the captured instance only.
 */
export async function disposeWorkspaceRuntime(): Promise<void> {
  const current = runtimeInstance ?? await runtimePromise;
  runtimeInstance = null;
  runtimePromise = null;
  if (current) {
    // Detach the webcontainer singleton synchronously BEFORE the async flush, so a fast
    // close→reopen boot creates a fresh instance instead of reusing the one about to be
    // torn down (a concurrent getWebContainer() must never hand back a dying instance).
    detachWebContainer(current.webcontainer);
    await current.runtime.flushSnapshots();
    current.runtime.dispose();
    await resetWebContainerIfCurrent(current.webcontainer);
  } else {
    await resetWebContainer();
  }
}
