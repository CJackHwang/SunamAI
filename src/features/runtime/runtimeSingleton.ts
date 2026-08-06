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
  runtimePromise ??= getWebContainer().then(async (webcontainer) => {
    const runtime = new WebContainerAgentRuntime(webcontainer);
    // M3 R1 双层恢复顺序：先恢复 Succinix 文件快照（系统层：/etc 状态、.pyodide pip 包、日志，
    // host 权威）→ 再拉起 host（host 启动读取已恢复的配置）→ 工作区 v3 快照在 ensureContainer
    // 时 mount（SunamAI 权威）。v3 mount 只作用于工作区容器目录（mountPoint 作用域 + merge 语义，
    // 实测不会覆盖 /etc 等系统层；见 snapshotCoordinator 注释）。
    await runtime.restoreSuccinixFileSnapshot();
    // H1-1：拉起 Succinix host 守护进程（注入 host.js + spawn node 常驻 + ping 探活），
    // 就绪后才对外暴露 runtime，避免任何文件 RPC 落到无人消费的 /cmd.json。
    await runtime.bootSuccinixHost();
    // M3 R2：host 就绪后启动系统层自动快照（~2.5s + pagehide 兜底），与 v3 工作区快照职责分离。
    runtime.startSuccinixFileSnapshot();
    const value = { webcontainer, runtime };
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
    await current.runtime.flushSuccinixFileSnapshot();
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
    // M3：关闭前兜底保存系统层快照（/etc、.pyodide 等），与 v3 flush 同为双重保险。
    await current.runtime.flushSuccinixFileSnapshot();
    current.runtime.dispose();
    await resetWebContainerIfCurrent(current.webcontainer);
  } else {
    await resetWebContainer();
  }
}
