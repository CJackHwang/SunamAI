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
// R1：Succinix host boot 后台进行中的信号（resolve=host 就绪；reject=host boot 失败）。
let hostBootPromise: Promise<void> | null = null;

export function getWorkspaceRuntime(): Promise<WorkspaceRuntimeInstance> {
  if (runtimeInstance) return Promise.resolve(runtimeInstance);
  runtimePromise ??= getWebContainer().then(async (webcontainer) => {
    const runtime = new WebContainerAgentRuntime(webcontainer);
    const value = { webcontainer, runtime };
    // R1：WC 容器加载完成即对外暴露 runtime（终端 UI 立即显示），Succinix host boot
    // （恢复系统层快照 → 注入 host.js + spawn + ping 探活 → 系统层自动快照）在后台继续。
    // host 未就绪时任何文件 RPC 会排队/超时，由 UserTerminalSession.boot 等待 host 就绪
    // 后再做自检，避免"等 host 全完成才显示终端"的旧时序。
    runtimeInstance = value;
    hostBootPromise = (async () => {
      await runtime.restoreSuccinixFileSnapshot();
      await runtime.bootSuccinixHost();
      runtime.startSuccinixFileSnapshot();
    })().catch((error) => {
      // host boot 失败：不清空 runtimeInstance（UI 已附加），由调用方（availability
      // controller → provider）负责释放。这里只把错误透传给 waitForWorkspaceHostReady。
      throw error;
    });
    return value;
  }).catch((error) => {
    // WC boot（Phase 1）失败：清空单例，等待下次重试重新初始化。
    runtimePromise = null;
    runtimeInstance = null;
    throw error;
  });
  return runtimePromise;
}

/** R1：等待 Succinix host 就绪（后台 boot 结果）。仅应在 getWorkspaceRuntime() 成功之后调用。
 *  resolve=host 已就绪；reject=host boot 失败（调用方决定转 restricted / chat-only）。 */
export function waitForWorkspaceHostReady(): Promise<void> {
  if (hostBootPromise) return hostBootPromise;
  return Promise.reject(new Error('Succinix host boot has not started.'));
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
  hostBootPromise = null;
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
  hostBootPromise = null;
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
